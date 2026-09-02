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
  `Eres un asistente que extrae datos de reportes de asistencia/atrasos de un sistema de control de horario (tipo GeoVictoria) de una tienda retail en Colombia. Analiza la imagen y responde ÚNICAMENTE con un JSON compacto: {"registros":[[nombre,fecha,minutos], ...]}.

Cada elemento es un arreglo de 3 valores (NO un objeto):
  [0] = nombre completo de la persona tal como aparece en la imagen (apellidos y nombres)
  [1] = fecha en formato YYYY-MM-DD (la imagen puede traer DD-MM-YYYY o DD/MM/YYYY, conviértelas)
  [2] = minutos de atraso como número entero POSITIVO

REGLAS CRÍTICAS PARA DECIDIR SI UNA FILA ES UN ATRASO:

1. La forma más confiable es buscar la palabra "Atraso" (o "Atrasos", "Retardo", "Tardanza") escrita explícitamente en la fila, usualmente en color rojo o naranja. Cuando aparece "00:HH Atraso" o "HH:MM Atraso", esos son los MINUTOS de atraso (convierte HH:MM a minutos totales: p.ej. "00:02 Atraso" = 2 minutos, "01:15 Atraso" = 75 minutos).

2. Si NO ves la palabra "Atraso" en la fila, NO inventes un atraso. Muchos reportes tienen una columna "Entrada" con la hora en que la persona marcó su llegada (formato HH:MM); esa hora NO es minutos de atraso. Por ejemplo, si el Turno es "16:30 - 20:30" y la Entrada es "16:29", esa persona llegó 1 minuto ANTES — NO es atraso. Si la Entrada es "16:35" con turno "16:30 - 20:30", solo cuéntalo como atraso si el reporte lo marca explícitamente como "Atraso"; NO calcules tú la diferencia.

3. Ignora filas de días "Sin Planificar", "Descanso", "Permiso", "No Planificado", sin marcación, o cualquier estado que no sea trabajo cumplido con atraso.

4. Cada fila del reporte es UN día para UNA persona. Si hay varias personas o varios días, genera un registro por cada atraso encontrado.

Incluye a TODAS las personas/días con atraso REAL que veas — no te quedes corto — pero NUNCA inventes atrasos que no estén marcados explícitamente. Si no encuentras ningún atraso real, responde con "registros": []. No agregues texto fuera del JSON.`;

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

  // Parse JSON — múltiples estrategias en cascada por si el modelo agrega fences,
  // prefacio, texto trailing, o distintos tipos de espacio en blanco.
  const parsed = tryParseRegistrosJson(text);
  if (!parsed) {
    return json(
      { error: `No pude interpretar la respuesta de la IA: ${text.slice(0, 400)}` },
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

  // Cuando registros sale vacío, incluimos un preview de lo que devolvió Claude
  // para poder diagnosticar (¿mala lectura?, ¿formato inesperado?, ¿decidió que
  // no había atrasos "reales"?). Eliminar este debug field cuando la extracción
  // esté estable en producción.
  const debug =
    registros.length === 0
      ? { raw_preview: text.slice(0, 800), stop_reason: stopReason }
      : undefined;

  return json({ registros, truncado, debug });
});

/**
 * Extrae { registros: [...] } de la respuesta cruda de la IA. Intenta:
 *  1) JSON.parse directo.
 *  2) Después de quitar fences de código markdown (```json ... ```).
 *  3) Buscando el primer '{' y el último '}' del texto.
 *  4) Buscando específicamente la palabra "registros" y extrayendo su valor.
 * Devuelve null si ninguna estrategia funciona.
 */
function tryParseRegistrosJson(
  text: string,
): { registros?: (RegistroTuple | Record<string, unknown>)[] } | null {
  const attempts: string[] = [];
  attempts.push(text.trim());
  attempts.push(
    text
      .replace(/```(?:json|JSON)?[\r\n]*/g, "")
      .replace(/```/g, "")
      .trim(),
  );
  // Del primer { al último }
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) attempts.push(text.slice(s, e + 1));

  for (const candidate of attempts) {
    try {
      const p = JSON.parse(candidate);
      if (p && typeof p === "object") return p;
    } catch {
      // sigue con la próxima estrategia
    }
  }
  return null;
}
