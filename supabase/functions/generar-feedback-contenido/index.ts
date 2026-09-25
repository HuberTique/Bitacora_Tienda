// Edge Function: generar-feedback-contenido
//
// Recibe los datos de un retardo/falta y le pide a Claude que redacte los tres
// campos libres del Formato de Feedback oficial (Descripción de la Situación,
// Comentarios del Jefe Inmediato y Plan de Acción) para que jefatura los
// revise y ajuste antes de descargar el PDF.
//
// System prompt portado del artifact original — la clave está en la regla de
// NUNCA mencionar términos del sistema (bitácora, ocurrencia, matriz…) para
// que suene a documento firmado por un humano de RRHH, no a salida de app.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { contextoEmpresa } from "../_shared/contexto-empresa.ts";

const MODEL = "claude-haiku-4-5-20251001";

const systemPrompt = (CONTEXTO_EMPRESA: string) =>
  `${CONTEXTO_EMPRESA}

TAREA: eres un profesional de recursos humanos de esta tienda que redacta el contenido de un 'Formato de Feedback' oficial en papel, listo para entregarse físicamente al colaborador. Escribe como se escribiría a mano en ese formato impreso: lenguaje natural de recursos humanos, con los hechos concretos (fechas, horas, nombres) que se te den. NUNCA menciones software, sistemas de bitácora, 'matriz de faltas', 'ocurrencia', 'vigencia', ni ningún término técnico o administrativo interno del sistema de gestión — eso nunca debe aparecer en el documento que lee el colaborador. (Sí puedes mencionar plataformas operativas del CONTEXTO como GeoVictoria si la situación lo amerita.)

Responde ÚNICAMENTE con un JSON con las claves:
- situacion (string, MUY PUNTUAL Y BREVE, máximo 25 palabras, UNA sola frase directa que indique qué pasó, cuándo y el dato concreto — sin rodeos, sin justificaciones, sin adjetivos, solo el hecho objetivo)
- comentarioJefe (string, hasta 90 palabras, escrito en PRIMERA PERSONA por el jefe inmediato dirigiéndose al colaborador — un comentario cercano pero profesional que dé contexto práctico y prevención a futuro)
- planAccion (string, hasta 70 palabras, compromisos concretos y verificables de ambas partes)

Reglas de caracteres: usa SOLO letras del alfabeto español (á é í ó ú ñ ü ¿ ¡), dígitos y puntuación estándar (. , : ; ! ? ' " ( ) - / %). NO uses símbolos matemáticos (≥, ≤, ≠), guiones tipográficos (— –), comillas curly (' ' " "), bullets (•), flechas, ni caracteres Unicode fuera del rango Latin-1 — la fuente del PDF final no los soporta.

No inventes hechos que no estén en los datos dados. No agregues texto fuera del JSON.`;

type Body = {
  falta_nombre?: string;
  falta_tipo_id?: string;
  colaborador?: string;
  fecha?: string;
  minutos?: number | null;
  observacion?: string;
  ocurrencia?: number;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!url || !anonKey || !anthropicKey) {
    return json({ error: "Faltan variables de entorno." }, 500);
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
    return json({ error: "Solo jefatura puede generar feedback." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }

  const esLlegadaTarde = (body.falta_tipo_id || "").startsWith("llegada");
  const userMsg =
    `Situación a documentar (uso interno para redactar, no debe aparecer citado literalmente):
- Motivo general: ${body.falta_nombre ?? ""}
- Colaborador: ${body.colaborador ?? ""}
- Fecha del hecho: ${body.fecha ?? ""}
${body.minutos != null ? `- Minutos de retraso: ${body.minutos}\n` : ""}- Es una reincidencia: ${
      (body.ocurrencia ?? 1) > 1
        ? `sí, van ${body.ocurrencia} veces en el periodo reciente`
        : "no, es la primera vez"
    }
- Contexto de la situación dado por jefatura: ${body.observacion?.trim() || "sin contexto adicional, básate solo en los datos anteriores"}
${esLlegadaTarde ? "- Recuerda: el horario de la tienda se publica todos los viernes con anticipación para la semana siguiente." : ""}

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
      max_tokens: 1200,
      system: systemPrompt(await contextoEmpresa(supabaseAsUser)),
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

  return json({
    situacion: String(parsed.situacion ?? ""),
    comentarioJefe: String(parsed.comentarioJefe ?? ""),
    planAccion: String(parsed.planAccion ?? ""),
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
