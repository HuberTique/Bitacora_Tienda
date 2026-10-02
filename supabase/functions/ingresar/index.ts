// Edge Function: ingresar
//
// Ingreso a la app sin exponer la lista de personas.
//   - Jefatura y DSM: correo + clave.
//   - Asesores: CM + PIN.
//   - Transición: una jefatura que aún no tiene correo registrado entra con su CM.
//
// Busca a la persona con la llave de servicio, inicia la sesión con su usuario
// interno de Supabase Auth y devuelve los tokens; el navegador los instala con
// supabase.auth.setSession().
//
// Bloqueo: tras 5 intentos fallidos con el mismo usuario en 15 minutos, no se
// intenta más hasta que pase ese tiempo (o una jefatura restablezca la clave).
// El mensaje de error es siempre el mismo, exista o no el usuario, para no
// revelar quién está registrado.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const MAX_FALLOS = 5;
const VENTANA_MIN = 15;
const ERROR_GENERICO = "Usuario o clave incorrectos.";

type Body = { usuario?: string; clave?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return json({ error: "Faltan variables de entorno." }, 500);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }
  const usuario = (body.usuario ?? "").trim();
  const clave = body.clave ?? "";
  if (!usuario || !clave) return json({ error: "Escribe tu usuario y tu clave." }, 400);
  if (usuario.length > 200 || clave.length > 200) return json({ error: ERROR_GENERICO }, 401);
  const llave = usuario.toLowerCase();

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const { count: fallos, error: cErr } = await admin
    .from("intentos_ingreso")
    .select("*", { count: "exact", head: true })
    .eq("usuario", llave)
    .gte("creado_at", desde);
  // Si la tabla de intentos aún no existe (migración 0034 sin aplicar) se entra
  // sin bloqueo, en vez de dejar a todos por fuera.
  if (!cErr && (fallos ?? 0) >= MAX_FALLOS) {
    return json(
      { error: `Demasiados intentos fallidos. Espera ${VENTANA_MIN} minutos o pide a tu jefatura que te restablezca la clave.` },
      429,
    );
  }

  const fallar = async () => {
    await admin.from("intentos_ingreso").insert({ usuario: llave });
    return json({ error: ERROR_GENERICO }, 401);
  };

  // Correo (jefatura / DSM) o CM (asesores, y jefaturas que aún no tienen correo).
  const porCorreo = usuario.includes("@");
  type Fila = { id: string; rol: string; correo?: string | null; auth_user_id: string | null };
  let personas: Fila[] | null = null;
  {
    const r = await admin
      .from("personal")
      .select("id, rol, correo, auth_user_id")
      .eq(porCorreo ? "correo" : "codigo", porCorreo ? llave : usuario)
      .eq("activo", true)
      .limit(2);
    if (!r.error) {
      personas = r.data as Fila[];
    } else if (!porCorreo) {
      // Antes de la migración 0034 no existe la columna correo: se busca solo por CM.
      const r2 = await admin
        .from("personal")
        .select("id, rol, auth_user_id")
        .eq("codigo", usuario)
        .eq("activo", true)
        .limit(2);
      if (r2.error) return json({ error: "No se pudo validar el ingreso. Intenta de nuevo." }, 500);
      personas = r2.data as Fila[];
    } else {
      return json({ error: "No se pudo validar el ingreso. Intenta de nuevo." }, 500);
    }
  }
  const persona = personas?.length === 1 ? personas[0] : null;
  if (!persona?.auth_user_id) return await fallar();
  // Quien ya tiene correo registrado entra con el correo, no con el CM.
  if (!porCorreo && persona.rol !== "asesor" && persona.correo) return await fallar();

  const { data: usr, error: uErr } = await admin.auth.admin.getUserById(persona.auth_user_id);
  if (uErr || !usr?.user?.email) return await fallar();

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ses, error: sErr } = await anon.auth.signInWithPassword({ email: usr.user.email, password: clave });
  if (sErr || !ses?.session) return await fallar();

  // Ingreso correcto: se limpian sus fallos y los intentos viejos de todos.
  await admin.from("intentos_ingreso").delete().eq("usuario", llave);
  await admin
    .from("intentos_ingreso")
    .delete()
    .lt("creado_at", new Date(Date.now() - 24 * 3600_000).toISOString());

  return json({ access_token: ses.session.access_token, refresh_token: ses.session.refresh_token });
});
