// Edge Function: leer-retardos-imagen
//
// Recibe UNA imagen en base64 de un reporte de control de horario (tipo
// GeoVictoria) y le pide a Claude que extraiga los atrasos como una lista
// de tuplas [nombre, fecha, minutos]. El match contra el roster de personal
// y la escalación se hacen del lado cliente (necesitan interacción de
// jefatura para confirmar cada fila antes de registrar).
//
// Requiere ANTHROPIC_API_KEY como secret:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

// Snapshot pinneado (pre-4.6 generation): `claude-haiku-4-5` es el alias, pero
// pinnear a la versión dated evita que un cambio de alias por parte de Anthropic
// degrade silenciosamente la extracción. Vision + JSON estructurado, $1/$5 por
// 1M tokens, 200K contexto — sobra para screenshots de control de horario.
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  `Eres un asistente que extrae datos de reportes de asistencia/atrasos de un sistema de control de horario (tipo GeoVictoria) de una tienda retail en Colombia. Analiza la imagen (puede traer muchas personas o varios días) y responde ÚNICAMENTE con un JSON compacto: {"registros":[[nombre,fecha,minutos], ...]}. Cada elemento es un arreglo de 3 valores (NO un objeto, para ahorrar espacio): [0]=nombre completo de la persona tal como aparece en la imagen (apellidos y nombres), [1]=fecha en formato YYYY-MM-DD (la imagen puede traer DD-MM-YYYY o DD/MM/YYYY, conviértelas), [2]=minutos de atraso como número entero. Incluye SOLO llegadas tarde reales (minutos de atraso mayor a 0, con hora de llegada posterior al inicio de turno o marcada explícitamente como 'Atraso'). Ignora días sin atraso, sin planificar, en descanso, o sin marcación. Incluye a TODAS las personas/días con atraso que veas, sin quedarte corto — es más importante incluir a todos que dar detalle extra. Si no encuentras ninguna llegada tarde, responde con registros como arreglo vacío. No agregues texto fuera del JSON.`;

type ImagePayload = { base64: string; mime: string };
type Body = { image?: ImagePayload };
type RegistroTuple = [string, string, number];

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
    return json({ error: "Solo la jefatura puede leer imágenes." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }

  const image = body.image;
  if (!image?.base64 || !image?.mime) {
    return json({ error: "Falta la imagen (base64 + mime)." }, 400);
  }
  if (!/^image\/(jpeg|jpg|png|gif|webp)$/i.test(image.mime)) {
    return json({ error: `Formato "${image.mime}" no soportado. Usa JPG, PNG, GIF o WEBP.` }, 400);
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: image.mime, data: image.base64 },
            },
            {
              type: "text",
              text: "Extrae los registros de llegada tarde de esta imagen, en el formato compacto de arreglos indicado.",
            },
          ],
        },
      ],
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
  const stopReason: string = anthropicJson?.stop_reason ?? "";
  const truncado = stopReason === "max_tokens";

  // Parse JSON — tolerante a fences ```json y a que el modelo agregue prefacio antes del JSON
  let parsed: { registros?: (RegistroTuple | Record<string, unknown>)[] } = {};
  try {
    const cleaned = text
      .replace(/```json\n?|```/g, "")
      .trim();
    // Encontrar la primera { y la última }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } else {
      parsed = { registros: [] };
    }
  } catch (_e) {
    return json(
      { error: `No pude interpretar la respuesta de la IA: ${text.slice(0, 200)}` },
      502,
    );
  }

  const registros = (parsed.registros ?? [])
    .map((r) => {
      if (Array.isArray(r)) {
        return {
          nombre: String(r[0] ?? ""),
          fecha: String(r[1] ?? ""),
          minutos: Number(r[2]) || 0,
        };
      }
      if (r && typeof r === "object") {
        const o = r as Record<string, unknown>;
        return {
          nombre: String(o.nombre ?? ""),
          fecha: String(o.fecha ?? ""),
          minutos: Number(o.minutos) || 0,
        };
      }
      return null;
    })
    .filter((r): r is { nombre: string; fecha: string; minutos: number } => r !== null && r.minutos > 0);

  return json({ registros, truncado });
});
