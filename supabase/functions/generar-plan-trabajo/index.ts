// Edge Function: generar-plan-trabajo
//
// Recibe { responsables, contexto, fecha } y le pide a Claude que redacte el
// contenido de un Plan de Trabajo oficial. Devuelve JSON con planTrabajo,
// compromisos[], responsabilidadesJefe[], comentario y compromisosTrabajador,
// listo para mostrar en un modal de revisión donde jefatura ajusta antes de
// generar el PDF.
//
// System prompt portado del artifact original (validado en producción con la
// tienda). Modelo: Haiku 4.5 (rápido, barato, suficiente para redacción
// estructurada corta). Requiere ANTHROPIC_API_KEY como secret.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  `Eres un asistente de gestión de tienda retail en Colombia. A partir del contexto de una situación, redactas el contenido de un formato oficial 'Plan de Trabajo' para dejar constancia por escrito de compromisos entre jefatura y colaborador(es). Responde ÚNICAMENTE con un JSON con las claves:

- planTrabajo (string, hasta 90 palabras, describe el plan a seguir de forma clara y profesional, en tono constructivo, sin ser punitivo)
- compromisos (array de hasta 6 objetos {texto, fecha}, cada texto una tarea concreta y accionable de máximo 12 palabras, fecha en formato DD/MM/AAAA con una fecha razonable de cumplimiento a partir de la fecha del plan)
- responsabilidadesJefe (array de hasta 6 objetos {texto, fecha}, compromisos de acompañamiento/capacitación de parte de jefatura, mismo formato)
- comentario (string, hasta 40 palabras, contexto adicional relevante; cadena vacía si no aplica)
- compromisosTrabajador (string, hasta 60 palabras, redactado en primera persona como si lo dijera el propio trabajador aceptando el plan)

No inventes cifras ni fechas anteriores a la fecha del plan. No agregues texto fuera del JSON.

Reglas de caracteres: usa SOLO letras del alfabeto español (incluye á é í ó ú ñ ü ¿ ¡), dígitos, y puntuación estándar (. , : ; ! ? ' " ( ) - / %). NO uses símbolos matemáticos (≥, ≤, ≠, ±, ×, ÷), guiones tipográficos (— –), comillas curly (' ' " "), bullets (•), flechas, ni caracteres Unicode fuera del rango Latin-1 — la fuente del PDF final no los soporta. En vez de "≥" escribe ">=" o "al menos"; en vez de "—" usa "-".`;

type Body = {
  responsables?: string;
  contexto?: string;
  fecha?: string;
};

type Compromiso = { texto: string; fecha: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!url || !anonKey || !anthropicKey) {
    return json(
      { error: "Faltan variables de entorno (SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY)." },
      500,
    );
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
    return json({ error: "Solo la jefatura puede generar planes de trabajo." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }

  const responsables = body.responsables?.trim();
  const contexto = body.contexto?.trim();
  const fecha = body.fecha?.trim();
  if (!responsables) return json({ error: "Falta responsables." }, 400);
  if (!contexto) return json({ error: "Falta contexto." }, 400);
  if (!fecha) return json({ error: "Falta fecha." }, 400);

  const userMsg = `Responsable(s) del plan: ${responsables}
Fecha del plan: ${fecha}
Situación / contexto: ${contexto}

Genera el JSON solicitado.`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return json(
      { error: `Error de Anthropic (${anthropicRes.status}): ${errText.slice(0, 400)}` },
      502,
    );
  }

  const anthropicJson = await anthropicRes.json();
  const text: string = anthropicJson?.content?.[0]?.text ?? "";

  const parsed = tryParseJson(text);
  if (!parsed) {
    return json(
      { error: `No pude interpretar la respuesta de la IA: ${text.slice(0, 400)}` },
      502,
    );
  }

  // Normalización defensiva de la salida
  const compromisos = normalizarLista(parsed.compromisos).slice(0, 7);
  const responsabilidadesJefe = normalizarLista(parsed.responsabilidadesJefe).slice(0, 7);

  return json({
    planTrabajo: String(parsed.planTrabajo ?? ""),
    compromisos,
    responsabilidadesJefe,
    comentario: String(parsed.comentario ?? ""),
    compromisosTrabajador: String(parsed.compromisosTrabajador ?? ""),
  });
});

function tryParseJson(text: string): Record<string, unknown> | null {
  const attempts: string[] = [];
  attempts.push(text.trim());
  attempts.push(text.replace(/```(?:json|JSON)?[\r\n]*/g, "").replace(/```/g, "").trim());
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) attempts.push(text.slice(s, e + 1));

  for (const c of attempts) {
    try {
      const p = JSON.parse(c);
      if (p && typeof p === "object") return p as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalizarLista(v: unknown): Compromiso[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const o = it as Record<string, unknown>;
      const texto = String(o.texto ?? "").trim();
      const fecha = String(o.fecha ?? "").trim();
      return texto ? { texto, fecha } : null;
    })
    .filter((x): x is Compromiso => x !== null);
}
