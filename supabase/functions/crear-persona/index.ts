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
import { esJefatura } from "../_shared/rol.ts";

type Body = {
  nombre?: string;
  cedula?: string;
  cargo?: string;
  rol?: string;
  rol_jerarquico?: string;
  codigo?: string | null;
  clave?: string;
  correo?: string | null;
  /** Solo el administrador: registrar en otra tienda (p. ej. el jefe de una tienda nueva). */
  tienda_id?: string | null;
};

const ROLES_JERARQUICOS = [
  "jefe_tienda",
  "subjefe",
  "cajero",
  "full_time",
  "part_time",
] as const;

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
    .select("rol, rol_jerarquico, es_admin")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (callerErr) {
    return json({ error: `Error leyendo caller: ${callerErr.message}` }, 500);
  }
  if (!caller || !(await esJefatura(supabaseAsUser, caller.rol))) {
    return json({ error: "Solo la jefatura puede registrar personal." }, 403);
  }
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo no es JSON válido." }, 400);
  }

  // La persona nueva queda en la tienda en la que está parada la jefatura; el
  // administrador puede indicar otra (al dar de alta una tienda y su jefe).
  let tiendaId: string | null = null;
  if (body.tienda_id) {
    if (!caller.es_admin) {
      return json({ error: "Solo el administrador registra personal en otra tienda." }, 403);
    }
    const { data: t } = await supabaseAsUser.from("tiendas").select("id").eq("id", body.tienda_id).maybeSingle();
    if (!t) return json({ error: "Esa tienda no existe." }, 400);
    tiendaId = t.id;
  } else {
    const { data: actual, error: tErr } = await supabaseAsUser.rpc("current_tienda_id");
    if (tErr || !actual) {
      return json({ error: "No se pudo determinar tu tienda." }, 403);
    }
    tiendaId = actual as string;
  }

  const nombre = body.nombre?.trim();
  const cedula = body.cedula?.trim() || null;
  const rol = body.rol;
  const rolJerarquico = body.rol_jerarquico ?? "full_time";
  const clave = body.clave;
  const cargo = (body.cargo?.trim() || "—") || "—";
  const codigo = body.codigo?.trim() || null;

  if (!nombre) return json({ error: "El nombre es obligatorio." }, 400);
  if (rol !== "jefatura" && rol !== "asesor") {
    return json({ error: "Rol inválido (usa 'jefatura' o 'asesor')." }, 400);
  }
  if (!ROLES_JERARQUICOS.includes(rolJerarquico as typeof ROLES_JERARQUICOS[number])) {
    return json({ error: `Rol jerárquico inválido. Usa uno de: ${ROLES_JERARQUICOS.join(", ")}` }, 400);
  }
  // El rol de acceso "jefatura" es solo para jefe de tienda y subjefes.
  const esMando = rolJerarquico === "jefe_tienda" || rolJerarquico === "subjefe";
  if ((rol === "jefatura") !== esMando) {
    return json(
      { error: "El rol de acceso Jefatura es únicamente para jefe de tienda y subjefes; los demás cargos entran como Asesor." },
      400,
    );
  }
  if (!clave) return json({ error: "La clave es obligatoria." }, 400);

  // Usuario de ingreso: jefatura entra con correo; asesores con su CM.
  const correo = rol === "jefatura" ? (body.correo ?? "").trim().toLowerCase() : "";
  if (rol === "jefatura") {
    // El correo lo registra quien crea la cuenta: el administrador para un
    // jefe de tienda; el jefe de tienda (o el administrador) para un subjefe.
    if (rolJerarquico === "jefe_tienda" && !caller.es_admin) {
      return json({ error: "Solo el administrador puede registrar a un jefe de tienda." }, 403);
    }
    if (rolJerarquico === "subjefe" && !caller.es_admin && caller.rol_jerarquico !== "jefe_tienda") {
      return json({ error: "A un subjefe lo registra el jefe de tienda o el administrador." }, 403);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      return json({ error: "Escribe el correo con el que esta persona va a ingresar." }, 400);
    }
  } else if (!codigo) {
    return json({ error: "El ID de empleado (CM) es obligatorio: es el usuario con el que el asesor ingresa." }, 400);
  }

  if (rol === "jefatura") {
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

  // Cliente admin (service_role) para las escrituras.
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Insertar fila en public.personal
  const { data: persona, error: pErr } = await admin
    .from("personal")
    .insert({
      nombre,
      cedula,
      cargo,
      rol,
      rol_jerarquico: rolJerarquico,
      codigo,
      correo: correo || null,
      activo: true,
      tienda_id: tiendaId,
      // La clave inicial es temporal: se cambia en el primer ingreso.
      debe_cambiar_clave: true,
    })
    .select()
    .single();

  if (pErr) {
    if (pErr.code === "23505") {
      return json({ error: "Ya existe una persona con esa cédula, ese ID de empleado (CM) o ese correo." }, 409);
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
