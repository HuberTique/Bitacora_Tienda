// Edge Function: recuperar-clave
//
// Auto-recuperación de clave SIN sesión activa. Existe para el caso que
// rompía el flujo anterior: si la única jefatura pierde su clave, no hay
// nadie con sesión de jefatura que pueda usar `resetear-clave` por ella.
//
// Verificación: persona_id (del roster público) + cédula tal como está en
// Personal. Es un factor débil para un sistema expuesto a internet, pero
// este es un uso interno de tienda sin datos financieros ni PII sensible
// más allá de lo operativo — el mismo nivel de exposición que ya asume el
// login (el roster con nombres completos ya es público). Si esto pasa a
// Etapa B (producción real, fuera de la tienda), vale la pena reforzar
// este factor (ej. código de empleado + pregunta de seguridad, o que
// jefatura apruebe la solicitud).
//
// No requiere Authorization header — es la única función pública que
// escribe en auth.users. Usa service_role internamente; el cliente nunca
// ve la cédula real, solo un sí/no de verificación.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

type Body = { persona_id?: string; cedula?: string; clave?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    return json({ error: "Faltan variables de entorno de Supabase." }, 500);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo no es JSON válido." }, 400);
  }

  const personaId = body.persona_id?.trim();
  const cedula = body.cedula?.trim();
  const clave = body.clave;

  if (!personaId) return json({ error: "Falta seleccionar la persona." }, 400);
  if (!cedula) return json({ error: "Falta la cédula." }, 400);
  if (!clave) return json({ error: "Falta la nueva clave." }, 400);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: persona, error: pErr } = await admin
    .from("personal")
    .select("id, rol, auth_user_id, nombre, activo, cedula")
    .eq("id", personaId)
    .maybeSingle();
  if (pErr) return json({ error: `Error leyendo persona: ${pErr.message}` }, 500);
  if (!persona) return json({ error: "Persona no encontrada." }, 404);
  if (!persona.activo) {
    return json({ error: "Esta persona está dada de baja. Contacta a jefatura." }, 409);
  }
  if (!persona.auth_user_id) {
    return json({ error: `${persona.nombre} no tiene usuario de acceso enlazado.` }, 409);
  }
  if (!persona.cedula) {
    return json(
      { error: "No hay cédula registrada para verificar tu identidad. Pide a jefatura que te restablezca la clave manualmente." },
      409,
    );
  }
  if (persona.cedula.trim() !== cedula) {
    return json({ error: "La cédula no coincide con la registrada." }, 401);
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

  return json({ ok: true, nombre: persona.nombre });
});
