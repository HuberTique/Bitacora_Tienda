// Edge Function: crear-persona
//
// Registra una persona nueva en el sistema:
//   1. Valida que el caller esté autenticado y sea jefatura.
//   2. Valida los datos (nombre, cédula, rol, y la clave según la regla del rol).
//   3. Inserta la fila en public.personal (usando service_role para bypass RLS
//      — nuestras políticas ya autorizan a jefatura, pero service_role permite
//      operación atómica sin depender del contexto del JWT en la conexión).
//   4. Crea el auth user con email sintético ${persona.id}@bitacora-tienda.local.
//   5. Enlaza personal.auth_user_id.
//
// Si el paso 4 falla, borra la fila de public.personal (rollback manual).
// Si el paso 5 falla, devuelve error pero la fila queda creada (raro; el
// admin puede corregir manualmente ejecutando el UPDATE en el dashboard).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

type Body = {
  nombre?: string;
  cedula?: string;
  cargo?: string;
  rol?: string;
  codigo?: string | null;
  clave?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido." }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    return json({ error: "Faltan variables de entorno de Supabase." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Falta encabezado Authorization." }, 401);
  }

  // Cliente con el JWT del caller — para verificar identidad y rol.
  const supabaseAsUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAsUser.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Sesión inválida o expirada." }, 401);
  }

  const { data: caller, error: callerErr } = await supabaseAsUser
    .from("personal")
    .select("rol")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (callerErr) {
    return json({ error: `Error leyendo caller: ${callerErr.message}` }, 500);
  }
  if (!caller || caller.rol !== "jefatura") {
    return json({ error: "Solo la jefatura puede registrar personal." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo no es JSON válido." }, 400);
  }

  const nombre = body.nombre?.trim();
  const cedula = body.cedula?.trim();
  const rol = body.rol;
  const clave = body.clave;
  const cargo = (body.cargo?.trim() || "—") || "—";
  const codigo = body.codigo?.trim() || null;

  if (!nombre) return json({ error: "El nombre es obligatorio." }, 400);
  if (!cedula) return json({ error: "La cédula es obligatoria." }, 400);
  if (rol !== "jefatura" && rol !== "asesor") {
    return json({ error: "Rol inválido (usa 'jefatura' o 'asesor')." }, 400);
  }
  if (!clave) return json({ error: "La clave es obligatoria." }, 400);

  if (rol === "jefatura") {
    if (!(clave.length >= 8 && /[A-Za-z]/.test(clave) && /[0-9]/.test(clave))) {
      return json(
        { error: "Clave de jefatura: mínimo 8 caracteres, con letras y números." },
        400,
      );
    }
  } else {
    if (!/^[0-9]{4,6}$/.test(clave)) {
      return json({ error: "Clave de asesor: PIN de 4 a 6 dígitos." }, 400);
    }
  }

  // Cliente admin (service_role) para las escrituras.
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Insertar fila en public.personal
  const { data: persona, error: pErr } = await admin
    .from("personal")
    .insert({ nombre, cedula, cargo, rol, codigo, activo: true })
    .select()
    .single();

  if (pErr) {
    if (pErr.code === "23505") {
      return json({ error: "Ya existe una persona con esa cédula." }, 409);
    }
    return json({ error: `Error creando persona: ${pErr.message}` }, 500);
  }

  // 2) Crear auth user con email sintético
  const email = `${persona.id}@bitacora-tienda.local`;
  const { data: authRes, error: aErr } = await admin.auth.admin.createUser({
    email,
    password: clave,
    email_confirm: true,
  });

  if (aErr || !authRes.user) {
    // Rollback de la fila
    await admin.from("personal").delete().eq("id", persona.id);
    return json(
      { error: `Error creando usuario de auth: ${aErr?.message ?? "desconocido"}` },
      500,
    );
  }

  // 3) Enlazar
  const { error: linkErr } = await admin
    .from("personal")
    .update({ auth_user_id: authRes.user.id })
    .eq("id", persona.id);

  if (linkErr) {
    return json(
      {
        error: `Persona y usuario creados, pero no enlazados: ${linkErr.message}`,
        persona_id: persona.id,
        auth_user_id: authRes.user.id,
      },
      500,
    );
  }

  return json(
    {
      persona: {
        ...persona,
        auth_user_id: authRes.user.id,
      },
    },
    201,
  );
});
