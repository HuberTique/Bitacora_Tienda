// Edge Function: resetear-clave
//
// Solo jefatura puede reiniciar la clave de otra persona (o de sí misma).
// Valida la clave según la regla del rol de la persona objetivo, luego usa
// admin.updateUserById en el auth user enlazado.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

type Body = { persona_id?: string; clave?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    return json({ error: "Faltan variables de entorno de Supabase." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Falta encabezado Authorization." }, 401);

  const supabaseAsUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAsUser.auth.getUser();
  if (userErr || !user) return json({ error: "Sesión inválida o expirada." }, 401);

  const { data: caller } = await supabaseAsUser
    .from("personal")
    .select("rol")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!caller || caller.rol !== "jefatura") {
    return json({ error: "Solo la jefatura puede restablecer claves." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo no es JSON válido." }, 400);
  }

  const personaId = body.persona_id?.trim();
  const clave = body.clave;
  if (!personaId) return json({ error: "Falta persona_id." }, 400);
  if (!clave) return json({ error: "Falta la nueva clave." }, 400);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Buscar la persona objetivo — necesitamos su rol para validar la clave,
  // y su auth_user_id para el updateUserById.
  const { data: persona, error: pErr } = await admin
    .from("personal")
    .select("id, rol, auth_user_id, nombre, activo")
    .eq("id", personaId)
    .maybeSingle();
  if (pErr) return json({ error: `Error leyendo persona: ${pErr.message}` }, 500);
  if (!persona) return json({ error: "Persona no encontrada." }, 404);
  if (!persona.auth_user_id) {
    return json({ error: `${persona.nombre} no tiene usuario de auth enlazado.` }, 409);
  }

  if (persona.rol === "jefatura") {
    if (!(clave.length >= 8 && /[A-Za-z]/.test(clave) && /[0-9]/.test(clave))) {
      return json(
        { error: "Clave de jefatura: mínimo 8 caracteres, con letras y números." },
        400,
      );
    }
  } else {
    if (!/^[0-9]{6,8}$/.test(clave)) {
      return json({ error: "Clave de asesor: PIN de 6 a 8 dígitos." }, 400);
    }
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(persona.auth_user_id, {
    password: clave,
  });
  if (updErr) return json({ error: `Error actualizando clave: ${updErr.message}` }, 500);

  return json({ ok: true, persona_id: persona.id, nombre: persona.nombre });
});
