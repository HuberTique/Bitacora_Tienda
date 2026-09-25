// Edge Function: leer-ventas-pdf
//
// Recibe UN PDF en base64 con el reporte "Ventas rápidas por empleado" que
// genera el sistema de la tienda al cierre de la jornada. Se lo pasa a
// Claude Haiku 4.5 (que lee PDFs nativamente, incluso escaneos con OCR
// integrado) y devuelve un JSON estructurado con:
//   { fecha, tienda, empleados:[{codigo,nombre,articulos,venta}], totalArticulos, totalVenta }
//
// El match contra el roster y el manejo de motivos "no vendió" se hacen del
// lado cliente (necesitan interacción de jefatura).
//
// Requiere ANTHROPIC_API_KEY como secret.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

// Modelo. Probamos:
//   - Haiku 4.5: 10-15s, pierde dígitos en escaneos con formato colombiano
//     $124.552.872,98 (leía $10.244.853). Se compensa con prompt explícito.
//   - Sonnet 5: mucho más preciso pero tarda 36s-2min con PDFs escaneados,
//     lo cual excede el timeout de 25s de Supabase Edge Functions (free).
// Usamos Haiku 4.5 con prompt reforzado que incluye ejemplos concretos
// del formato colombiano y una validación de suma-vs-total.
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  `Eres un asistente que extrae datos del reporte "Ventas rápidas por empleado" que genera el sistema de una tienda Skechers en Colombia al cierre de la jornada. La entrada puede ser un PDF, un escaneo o una o varias FOTOS del reporte tomadas con el celular (perspectiva torcida, reflejos, sombras o dedos en el borde). Analiza y responde ÚNICAMENTE con un JSON compacto:

{
  "fecha": "YYYY-MM-DD",
  "tienda": "1029 - OUTLET DE LAS AMERICAS",
  "totalArticulos": <número>,
  "totalVenta": <número decimal>,
  "empleados": [
    ["<codigo>", "<nombre>", <articulos>, <venta>],
    ...
  ]
}

REGLAS:

1. FORMATO DE FECHA COLOMBIANO — MUY IMPORTANTE:
   La fecha aparece como "Fecha: DD-MM-YYYY" o "DD/MM/YYYY". Colombia usa DÍA-MES-AÑO (NO el formato americano MM-DD).
   - "02-08-2026" es 2 de AGOSTO de 2026 → "2026-08-02" en ISO
   - "15-03-2026" es 15 de MARZO de 2026 → "2026-03-15" en ISO
   - "01-12-2026" es 1 de DICIEMBRE de 2026 → "2026-12-01" en ISO
   El primer número (0-31) es el DÍA, el segundo (1-12) es el MES. NUNCA los inviertas.

2. La tienda aparece en la esquina superior derecha (ej. "1029 - OUTLET DE LAS AMERICAS").

3. FORMATO DE NÚMEROS COLOMBIANOS — MUY IMPORTANTE:
   Los números en el PDF usan formato colombiano: PUNTO como separador de MILES y COMA como separador DECIMAL.
   - "$124.552.872,98" significa CIENTO VEINTICUATRO MILLONES = 124552872.98
   - "$10.780.384,03" significa DIEZ MILLONES setecientos ochenta mil = 10780384.03
   - "$9.819.097,48" significa NUEVE MILLONES ochocientos diecinueve mil = 9819097.48
   - "$580,00" significa quinientos ochenta pesos = 580.00
   Para convertir a número JSON: QUITA todos los puntos y REEMPLAZA la coma final por punto.
   NUNCA confundas los puntos de miles con decimales. Los valores de venta siempre son millones o cientos de miles — si te da menos de 100 mil, revisa por error de OCR.

4. Cada empleado es una fila con [ID, Nombre, Recuento de artículos, Ventas netas]:
   - ID: número entero de 6 dígitos (ej. 981702) — tal cual como texto.
   - Nombre: formato "APELLIDO APELLIDO, NOMBRE NOMBRE" (mayúsculas).
   - Recuento de artículos: entero pequeño (0-200).
   - Ventas netas: número decimal según regla 3.

5. La sección "Resumen" al inicio tiene el TOTAL de la tienda:
   - "Total" con recuento y total ventas — de ahí extraes totalArticulos y totalVenta.
   - Ese total DEBE ser aproximadamente igual a la suma de todos los empleados. Si no es coherente, revisa el OCR de los números.

6. Si un valor no es legible, ponlo como 0 y sigue. En FOTOS, si una fila queda cortada o borrosa, incluye solo lo que alcances a leer con certeza: NUNCA inventes dígitos.

7. El reporte puede tener MÚLTIPLES PÁGINAS o venir en VARIAS FOTOS/archivos. Recorre TODOS y combina los empleados en una sola lista (sin duplicar; si una fila se repite entre dos fotos por solapamiento, cuéntala una sola vez).

8. IGNORA filas de encabezado, pie de página, "Fecha de ejecución", "Página N de M", "Powered by CamScanner", etc.

VALIDACIÓN FINAL: antes de responder, verifica que la suma aproximada de ventas de empleados esté en el mismo orden de magnitud que totalVenta. Si difieren mucho (ej. total=124M pero suma=10M), es un error de lectura — vuelve a revisar los ceros y separadores.

Si el PDF no es un reporte de "Ventas rápidas por empleado" o no logras extraer nada, devuelve {"fecha":null,"empleados":[]}. No agregues texto fuera del JSON.`;

type ArchivoPayload = { base64: string; mime: string };
type Body = { pdf?: ArchivoPayload; archivos?: ArchivoPayload[] };

const MIME_IMAGEN = /^image\/(jpeg|jpg|png|webp|gif)$/i;
const MAX_ARCHIVOS = 6;
const MAX_BASE64_TOTAL = 12_000_000; // ~9 MB de archivos; el cliente reduce las fotos antes de enviarlas
type EmpleadoTuple = [string, string, number, number];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  console.log("[leer-ventas-pdf] Invocation start", {
    method: req.method,
    hasUrl: !!url,
    hasAnonKey: !!anonKey,
    hasAnthropicKey: !!anthropicKey,
  });

  if (!url || !anonKey) {
    return json({ error: "Faltan SUPABASE_URL o SUPABASE_ANON_KEY." }, 500);
  }
  if (!anthropicKey) {
    return json(
      { error: "Falta ANTHROPIC_API_KEY en Supabase Secrets. Configúrala con: supabase secrets set ANTHROPIC_API_KEY=sk-ant-..." },
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
    return json({ error: "Solo la jefatura puede leer el reporte de ventas." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }

  // Acepta la lista nueva (`archivos`: PDF y/o fotos) o el campo anterior (`pdf`).
  const archivos = body.archivos ?? (body.pdf ? [body.pdf] : []);
  if (archivos.length === 0 || archivos.some((a) => !a?.base64 || !a?.mime)) {
    return json({ error: "Falta el archivo (base64 + mime)." }, 400);
  }
  if (archivos.length > MAX_ARCHIVOS) {
    return json({ error: `Máximo ${MAX_ARCHIVOS} archivos por lectura.` }, 400);
  }
  const invalido = archivos.find(
    (a) => !/^application\/pdf$/i.test(a.mime) && !MIME_IMAGEN.test(a.mime),
  );
  if (invalido) {
    return json(
      { error: `Formato "${invalido.mime}" no soportado. Usa PDF o imágenes (JPG, PNG, WEBP).` },
      400,
    );
  }
  if (archivos.reduce((t, a) => t + a.base64.length, 0) > MAX_BASE64_TOTAL) {
    return json({ error: "Los archivos pesan demasiado. Sube menos fotos o reduce su tamaño." }, 400);
  }

  console.log("[leer-ventas-pdf] Calling Anthropic", {
    archivos: archivos.map((a) => ({ mime: a.mime, base64Length: a.base64.length })),
    model: MODEL,
  });

  // Claude API con soporte de PDF (document type). Se envía el header
  // "anthropic-beta: pdfs-2024-09-25" por compatibilidad — en modelos que
  // ya lo tienen GA no molesta, en los que aún requieren beta habilita.
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...archivos.map((a) =>
              /^application\/pdf$/i.test(a.mime)
                ? {
                    type: "document",
                    source: { type: "base64", media_type: "application/pdf", data: a.base64 },
                  }
                : {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: a.mime.toLowerCase().replace("image/jpg", "image/jpeg"),
                      data: a.base64,
                    },
                  },
            ),
            {
              type: "text",
              text: "Extrae los datos del reporte en el formato JSON indicado. Incluye TODOS los empleados de TODAS las páginas y archivos.",
            },
          ],
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    console.error("[leer-ventas-pdf] Anthropic error", {
      status: anthropicRes.status,
      body: errText.slice(0, 500),
    });
    return json(
      { error: `Error de Anthropic (${anthropicRes.status}): ${errText.slice(0, 400)}` },
      502,
    );
  }

  console.log("[leer-ventas-pdf] Anthropic OK, parsing response");

  const anthropicJson = await anthropicRes.json();
  const text: string = anthropicJson?.content?.[0]?.text ?? "";
  const stopReason: string = anthropicJson?.stop_reason ?? "";
  const truncado = stopReason === "max_tokens";

  const parsed = tryParseJson(text);
  if (!parsed) {
    return json(
      { error: `No pude interpretar la respuesta de la IA: ${text.slice(0, 400)}` },
      502,
    );
  }

  const empleados = (parsed.empleados ?? [])
    .map((r) => {
      if (Array.isArray(r)) {
        return {
          codigo: String(r[0] ?? "").trim(),
          nombre: String(r[1] ?? "").trim(),
          articulos: Number(r[2]) || 0,
          venta: Number(r[3]) || 0,
        };
      }
      if (r && typeof r === "object") {
        const o = r as Record<string, unknown>;
        return {
          codigo: String(o.codigo ?? o.id ?? "").trim(),
          nombre: String(o.nombre ?? "").trim(),
          articulos: Number(o.articulos) || 0,
          venta: Number(o.venta) || 0,
        };
      }
      return null;
    })
    .filter(
      (e): e is { codigo: string; nombre: string; articulos: number; venta: number } =>
        e !== null && (e.nombre.length > 0 || e.codigo.length > 0),
    );

  const debug =
    empleados.length === 0
      ? { raw_preview: text.slice(0, 800), stop_reason: stopReason }
      : undefined;

  return json({
    fecha: parsed.fecha ?? null,
    tienda: parsed.tienda ?? null,
    totalArticulos: parsed.totalArticulos ?? null,
    totalVenta: parsed.totalVenta ?? null,
    empleados,
    truncado,
    debug,
  });
});

function tryParseJson(text: string): {
  fecha?: string | null;
  tienda?: string | null;
  totalArticulos?: number | null;
  totalVenta?: number | null;
  empleados?: (EmpleadoTuple | Record<string, unknown>)[];
} | null {
  const attempts: string[] = [];
  attempts.push(text.trim());
  attempts.push(
    text
      .replace(/```(?:json|JSON)?[\r\n]*/g, "")
      .replace(/```/g, "")
      .trim(),
  );
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) attempts.push(text.slice(s, e + 1));

  for (const candidate of attempts) {
    try {
      const p = JSON.parse(candidate);
      if (p && typeof p === "object") return p;
    } catch {
      // sigue
    }
  }
  return null;
}
