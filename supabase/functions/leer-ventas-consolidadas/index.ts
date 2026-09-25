// Edge Function: leer-ventas-consolidadas
//
// Lee el informe "Visión general de ventas" (ventas consolidadas del mes retail hasta una fecha de
// corte) de la tienda. Es un ESCANEO de ~10 páginas. Para leerlo con precisión y rápido, el cliente
// endereza las páginas y hace DOS tipos de llamada, cada una con instrucciones concretas de dónde mirar:
//
//   modo "resumen": páginas 1-2. Encabezado (nombre del informe, tienda, rango de fechas) y el PRIMER
//                   cuadro ("Resumen"): por empleado su CM, nombre, y de la sección "Ventas netas"
//                   el Recuento y el Importe; más la fila "Total" del final.
//   modo "detalle": páginas 2-10 en tramos de 2. Bloques "Empleado: <cm> - <nombre>": por cada Tipo
//                   (Footwear=pares, Apparel=ropa, Accessories=accesorios) el Recuento de "Ventas netas".

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const MODEL = "claude-haiku-4-5-20251001";

const REGLAS_NUMEROS = `FORMATO DE NÚMEROS (Colombia): el PUNTO separa miles y la COMA separa decimales. "$46.308.592,27" = 46308592 pesos. IGNORA los decimales: devuelve pesos ENTEROS.
En el escaneo las celdas angostas parten el número en DOS líneas: los últimos dígitos quedan solos debajo (ej. "$22.431.253,7" y debajo "6" = 22.431.253,76). Ese dígito suelto pertenece a la cifra de ARRIBA en la MISMA columna; no es otra fila ni otra persona. Como ignoras decimales, solo asegúrate de no confundir ese dígito suelto con el recuento de otra fila.
Los "Recuento" son cantidades de artículos con dos decimales (",00"): "194,00" = 194; "1.746,00" = 1746; valores negativos llevan "-".`;

const PROMPT_RESUMEN = `Eres un lector de informes. Recibes las páginas 1 y 2 (escaneadas, ya enderezadas) del informe "Visión general de ventas" de una tienda Skechers en Colombia. Responde ÚNICAMENTE con un JSON.

DÓNDE MIRAR:
- TÍTULO: arriba al centro, dice "Visión general de ventas".
- TIENDA: arriba a la derecha, "Tienda: 690 - BOGOTA-CALIMA".
- RANGO DE FECHAS: arriba a la izquierda, "Rango de fechas: 30-08-2026 - 22-09-2026" (formato DÍA-MES-AÑO; conviértelo a ISO YYYY-MM-DD).
- El PRIMER CUADRO se titula "Resumen". Es una tabla con una fila por empleado. La columna "Empleado" tiene el CÓDIGO (6 dígitos, a la izquierda, ej. 981549; también existe el código 9999 "ACCOUNT, HOUSE") y el NOMBRE ("APELLIDOS, NOMBRES", a veces en dos líneas). A la derecha hay 4 grupos de columnas, cada uno con "Recuento" e "Importe": Ventas brutas, Datos de devoluciones, Datos de descuentos y, al final del todo, VENTAS NETAS. SOLO te interesa el último grupo, "Ventas netas": su "Importe" es la ÚLTIMA columna (la más a la derecha de toda la tabla) y su "Recuento" es la penúltima.
- La tabla empieza en la página 1 y CONTINÚA en la página 2 (más empleados). Al FINAL de la tabla hay una fila "Total": su Importe de la última columna es la venta neta total de la tienda y su Recuento es el total de artículos.
- Debajo de la tabla, en la página 2, empieza la segunda parte (bloques "Empleado: ..."); NO la leas.

${REGLAS_NUMEROS}

RESPUESTA:
{
  "titulo": "Visión general de ventas" | null,
  "tienda": "690 - BOGOTA-CALIMA" | null,
  "rango": ["2026-08-30", "2026-09-22"] | null,
  "total": { "netaRec": <n>, "netaImp": <n> } | null,
  "filas": [ ["<cm>", "<nombre>", <netaRec>, <netaImp>], ... ]
}

REGLAS:
1. Una entrada en "filas" por CADA empleado del cuadro Resumen, de la primera a la última fila, en el orden en que aparecen, en las dos páginas. NO omitas empleados aunque sus cifras sean 0,00. NO incluyas la fila "Total".
2. El CM se escribe tal cual (solo dígitos). El nombre sirve solo de referencia: transcríbelo lo mejor que puedas.
3. Si un dato no se ve, ponlo en 0 o null; NUNCA inventes dígitos.
4. No agregues texto fuera del JSON.`;

const PROMPT_DETALLE = `Eres un lector de informes. Recibes 1 o 2 páginas (escaneadas, ya enderezadas) de la SEGUNDA PARTE del informe "Visión general de ventas" de una tienda Skechers en Colombia. Responde ÚNICAMENTE con un JSON.

DÓNDE MIRAR:
- La segunda parte son bloques, uno por empleado, que empiezan con el encabezado "Empleado: <CM> - <NOMBRE>" (ej. "Empleado: 981566 - AGUILAR, JOSE ALEXA"). El CM son 6 dígitos (o 9999).
- Cada bloque es una tabla con la columna "Tipo" y filas: Accessories (a veces partido como "Accessorie" / "s"), Apparel, Footwear, y una fila final "Total". A la derecha hay los grupos Ventas brutas, Datos de devoluciones, Datos de descuentos y, al final, VENTAS NETAS con tres columnas: Recuento, Importe y %.
- De cada fila de Tipo SOLO necesitas el "Recuento" del grupo "Ventas netas" (es la TERCERA columna contando desde la derecha: Recuento | Importe | %).
- IMPORTANTE: cuando un bloque cae entre dos páginas, el encabezado "Empleado: ..." se REPITE en la página siguiente con el resto de sus filas (por ejemplo la fila Total). Es la MISMA persona: no es otra. Devuelve solo las filas de Tipo que veas (sin la fila Total). Un bloque que solo muestra "Total" no genera filas.
- Los nombres pueden salir cortados o truncados ("AGUILAR, JOSE ALEXA"): no importa, lo que identifica a la persona es el CM.

${REGLAS_NUMEROS}

RESPUESTA:
{ "filas": [ ["<cm>", "<nombre>", "Footwear"|"Apparel"|"Accessories", <netaRec>], ... ] }

REGLAS:
1. Una entrada por cada (empleado, tipo) que veas en estas páginas. Footwear = pares, Apparel = ropa, Accessories = accesorios.
2. No incluyas filas "Total". No incluyas la tabla "Resumen" de la primera parte si aparece en estas páginas.
3. Si un dato no se ve, ponlo en 0; NUNCA inventes dígitos. No agregues texto fuera del JSON.`;

type Archivo = { base64: string; mime: string };
type Body = { archivos?: Archivo[]; modo?: "resumen" | "detalle" };

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
  const modo = body.modo === "detalle" ? "detalle" : "resumen";
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
      system: modo === "resumen" ? PROMPT_RESUMEN : PROMPT_DETALLE,
      messages: [
        {
          role: "user",
          content: [
            ...archivos.map((a) =>
              /^application\/pdf$/i.test(a.mime)
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } }
                : { type: "image", source: { type: "base64", media_type: a.mime.toLowerCase(), data: a.base64 } },
            ),
            { type: "text", text: "Extrae los datos en el formato JSON indicado." },
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
  const filasCrudas = (Array.isArray(parsed.filas) ? parsed.filas : []).filter(
    (r): r is unknown[] => Array.isArray(r),
  );

  if (modo === "resumen") {
    const filas = filasCrudas
      .filter((r) => r.length >= 4)
      .map((r) => ({
        cm: String(r[0] ?? "").replace(/\D/g, ""),
        nombre: String(r[1] ?? "").trim(),
        netaRec: num(r[2]),
        netaImp: num(r[3]),
      }))
      .filter((r) => r.cm.length > 0);
    const t = parsed.total as { netaRec?: unknown; netaImp?: unknown } | null;
    return json({
      modo,
      titulo: parsed.titulo ?? null,
      tienda: parsed.tienda ?? null,
      rango: Array.isArray(parsed.rango) ? parsed.rango : null,
      total: t ? { netaRec: num(t.netaRec), netaImp: num(t.netaImp) } : null,
      filas,
      truncado,
    });
  }

  const filas = filasCrudas
    .filter((r) => r.length >= 4)
    .map((r) => ({
      cm: String(r[0] ?? "").replace(/\D/g, ""),
      nombre: String(r[1] ?? "").trim(),
      tipo: String(r[2] ?? "").trim(),
      netaRec: num(r[3]),
    }))
    .filter((r) => r.cm.length > 0 && /^(footwear|apparel|accessor)/i.test(r.tipo));
  return json({ modo, filas, truncado });
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
