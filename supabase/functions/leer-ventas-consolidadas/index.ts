// Edge Function: leer-ventas-consolidadas
//
// Lee el reporte "Visión general de ventas" (ventas consolidadas del mes retail hasta una
// fecha de corte) que genera el sistema de la tienda. Suele ser un ESCANEO (sin texto) de
// varias páginas y girado. Como es largo, el cliente lo parte en trozos de 1-2 páginas y llama
// a esta función varias veces en paralelo; cada llamada devuelve lo que encuentre en sus páginas:
//
//   - "resumen": una fila por empleado de la tabla "Resumen" (ventas brutas y netas).
//   - "detalle": una fila por (empleado, tipo) de los bloques "Empleado: <cm> - <nombre>"
//                con las ventas NETAS por tipo (Footwear = pares, Apparel = ropa, Accessories).
//
// El cliente une los trozos, valida contra el total del reporte y cruza el CM con Personal.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  `Eres un asistente que extrae datos del reporte "Visión general de ventas" de una tienda Skechers en Colombia. Recibes UNA o DOS páginas escaneadas (pueden venir giradas 90°; léelas en su orientación correcta). Responde ÚNICAMENTE con un JSON compacto:

{
  "rango": ["YYYY-MM-DD", "YYYY-MM-DD"] | null,
  "tienda": "690 - BOGOTA-CALIMA" | null,
  "total": { "brutaRec": <n>, "brutaImp": <n>, "netaRec": <n>, "netaImp": <n> } | null,
  "resumen": [ ["<cm>", "<nombre>", <brutaRec>, <brutaImp>, <netaRec>, <netaImp>], ... ],
  "detalle": [ ["<cm>", "Footwear"|"Apparel"|"Accessories", <netaRec>, <netaImp>], ... ]
}

REGLAS:

1. "rango": aparece arriba como "Rango de fechas: 30-08-2026 - 22-09-2026" (formato colombiano DÍA-MES-AÑO). Conviértelo a ISO. Si la página no lo trae, null.

2. FORMATO DE NÚMEROS COLOMBIANOS: PUNTO = separador de miles, COMA = decimal.
   - "$29.529.300,00" = 29529300.00; "$4.122.480,00" = 4122480; "-$74.970,00" = -74970.
   - Las cifras largas pueden partirse en dos líneas en el escaneo (ej. "$512.703.460," y debajo "00"): únelas ("$512.703.460,00").
   - "Recuento" es la cantidad de artículos (ej. "1.746,00" = 1746; "194,00" = 194).

3. "resumen": SOLO de la tabla titulada "Resumen" (una fila por empleado: código de 6 dígitos, nombre "APELLIDO, NOMBRE", y las columnas Ventas brutas [Recuento, Importe], Datos de devoluciones, Datos de descuentos, Ventas netas [Recuento, Importe]). Devuelve [cm, nombre, brutaRec, brutaImp, netaRec, netaImp] usando Ventas brutas y Ventas netas (ignora devoluciones y descuentos). La tabla puede continuar en la página siguiente. La fila final "Total" NO va en "resumen": va en "total".

4. "detalle": de los bloques "Empleado: <cm> - <NOMBRE>" con filas por Tipo (Footwear, Apparel, Accessories) y una fila "Total". Devuelve una fila por (empleado, tipo) con las VENTAS NETAS de ese tipo: [cm, tipo, netaRec, netaImp]. No incluyas las filas "Total". Toma el cm del encabezado "Empleado: <cm> - ...". Un empleado puede aparecer cortado entre dos páginas: devuelve solo las filas de tipo que veas.
   Si un bloque solo muestra "Total" (sin tipos), no devuelvas filas para él.

5. Si una página no tiene una de las partes, deja esa lista vacía ([]). Si un valor no es legible, ponlo en 0. NUNCA inventes dígitos.

6. Códigos (cm): números de 6 dígitos tal cual, como texto (ej. "981549"); "9999" es "ACCOUNT, HOUSE".

No agregues texto fuera del JSON.`;

type Archivo = { base64: string; mime: string };
type Body = { archivos?: Archivo[] };

const MAX_ARCHIVOS = 3;
const MAX_BASE64_TOTAL = 12_000_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!url || !anonKey || !anthropicKey) return json({ error: "Faltan variables de entorno." }, 500);

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
  const archivos = body.archivos ?? [];
  if (archivos.length === 0 || archivos.some((a) => !a?.base64 || !a?.mime)) {
    return json({ error: "Falta el archivo (base64 + mime)." }, 400);
  }
  if (archivos.length > MAX_ARCHIVOS) return json({ error: `Máximo ${MAX_ARCHIVOS} archivos por llamada.` }, 400);
  if (archivos.some((a) => !/^application\/pdf$/i.test(a.mime) && !/^image\/(jpeg|png|webp)$/i.test(a.mime))) {
    return json({ error: "Formato no soportado. Usa PDF o imágenes." }, 400);
  }
  if (archivos.reduce((t, a) => t + a.base64.length, 0) > MAX_BASE64_TOTAL) {
    return json({ error: "El archivo pesa demasiado." }, 400);
  }

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
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } }
                : { type: "image", source: { type: "base64", media_type: a.mime.toLowerCase(), data: a.base64 } },
            ),
            { type: "text", text: "Extrae los datos de estas páginas en el formato JSON indicado." },
          ],
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return json({ error: `Error de Anthropic (${anthropicRes.status}): ${errText.slice(0, 400)}` }, 502);
  }

  const anthropicJson = await anthropicRes.json();
  const text: string = anthropicJson?.content?.[0]?.text ?? "";
  const truncado = anthropicJson?.stop_reason === "max_tokens";
  const parsed = tryParseJson(text);
  if (!parsed) return json({ error: `No pude interpretar la respuesta de la IA: ${text.slice(0, 300)}` }, 502);

  const num = (v: unknown) => Number(v) || 0;
  const resumen = (Array.isArray(parsed.resumen) ? parsed.resumen : [])
    .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 6)
    .map((r) => ({
      cm: String(r[0] ?? "").replace(/\D/g, ""),
      nombre: String(r[1] ?? "").trim(),
      brutaRec: num(r[2]),
      brutaImp: num(r[3]),
      netaRec: num(r[4]),
      netaImp: num(r[5]),
    }))
    .filter((r) => r.cm.length > 0);
  const detalle = (Array.isArray(parsed.detalle) ? parsed.detalle : [])
    .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 4)
    .map((r) => ({
      cm: String(r[0] ?? "").replace(/\D/g, ""),
      tipo: String(r[1] ?? "").trim(),
      netaRec: num(r[2]),
      netaImp: num(r[3]),
    }))
    .filter((r) => r.cm.length > 0 && /^(footwear|apparel|accessor)/i.test(r.tipo));

  return json({
    rango: Array.isArray(parsed.rango) ? parsed.rango : null,
    tienda: parsed.tienda ?? null,
    total: parsed.total ?? null,
    resumen,
    detalle,
    truncado,
  });
});

function tryParseJson(text: string): Record<string, unknown> | null {
  const attempts = [
    text.trim(),
    text.replace(/```(?:json|JSON)?[\r\n]*/g, "").replace(/```/g, "").trim(),
  ];
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) attempts.push(text.slice(s, e + 1));
  for (const c of attempts) {
    try {
      const p = JSON.parse(c);
      if (p && typeof p === "object") return p as Record<string, unknown>;
    } catch {
      /* siguiente */
    }
  }
  return null;
}
