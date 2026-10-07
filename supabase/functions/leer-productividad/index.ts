// Edge Function: leer-productividad
//
// Lee el informe "Productividad de empleado" de Xstore (PDF o foto) para la
// TRX y el UPT de cada asesor (Huber, 7-oct-2026): por cada ID trae
// Transacciones, Artículos promedio por transacción (= UPT), Importe promedio y
// Ventas netas, para un rango de fechas. Devuelve JSON:
//   { tienda, rangoTexto, rango:[desde,hasta], totalVentas, filas:[{id,nombre,trx,upt,importe,ventas}] }
// El cruce con la planta y el guardado se hacen en la app (la jefatura revisa).
//
// Requiere ANTHROPIC_API_KEY como secret.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { esJefatura } from "../_shared/rol.ts";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `Extraes datos del informe "Productividad de empleado" del sistema de caja (Xstore) de una tienda Skechers en Colombia. La entrada puede ser un PDF o una foto (de papel o de la pantalla), o solo un PEDAZO de una foto. Responde ÚNICAMENTE con un JSON compacto:

{
  "titulo": "Productividad de empleado",
  "tienda": "691 - BOGOTA-CENTRO MAYOR",
  "rangoTexto": "<el rango EXACTAMENTE como aparece, ej. 04-10-2026 - 06-10-2026>",
  "rango": ["YYYY-MM-DD", "YYYY-MM-DD"],
  "totalVentas": <número o null>,
  "filas": [
    ["<ID>", "<Nombre>", <Transacciones>, <Artículos promedio>, <Importe promedio>, <Ventas>],
    ...
  ]
}

REGLAS:
1. Columnas de la tabla: ID | Nombre | Transacciones | Datos de media (Artículos, Importe) | Datos de porcentaje (Rebaja, Devoluciones) | Valor neto (Devoluciones, Ventas). Toma: ID, Nombre, Transacciones, Artículos (de "Datos de media"), Importe (de "Datos de media") y Ventas (la ÚLTIMA columna, "Valor neto - Ventas"). Ignora Rebaja, los porcentajes y las devoluciones.
2. NÚMEROS en formato colombiano: punto = miles, coma = decimales. "11.816.832,79" = 11816832.79; "1,20" = 1.2; "41" = 41. Transacciones es un entero. Artículos es un decimal pequeño (1 a 5).
3. Un nombre puede ocupar dos renglones ("CASTANEDA TAVERA," / "JHONNATHAN"): es UNA sola fila; júntalo.
4. Incluye TODAS las filas, también "COLOMBIA, ON-LINE" y "ACCOUNT, HOUSE" (la app decide qué hacer con ellas).
5. RANGO DE FECHAS: copia en rangoTexto lo que dice "Rango de fechas". Para "rango" conviértelo a ISO tomando el formato DÍA-MES-AÑO.
6. Si la imagen es solo un pedazo: extrae solo las filas COMPLETAS que veas; lo que no aparezca (tienda, rango, total) ponlo en null.
7. Nunca inventes dígitos; si un valor no se lee, pon null en ese campo.
Si no es este informe, devuelve {"titulo": "<lo que diga>", "filas": []}. No agregues texto fuera del JSON.`;

type ArchivoPayload = { base64: string; mime: string };
const MIME_IMAGEN = /^image\/(jpeg|jpg|png|webp|gif)$/i;
const MAX_ARCHIVOS = 6;
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
  const { data: caller } = await supabaseAsUser.from("personal").select("rol").eq("auth_user_id", user.id).maybeSingle();
  if (!caller || !(await esJefatura(supabaseAsUser, caller.rol))) {
    return json({ error: "Solo la jefatura puede leer este informe." }, 403);
  }

  let body: { archivos?: ArchivoPayload[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }
  const archivos = body.archivos ?? [];
  if (archivos.length === 0 || archivos.some((a) => !a?.base64 || !a?.mime)) return json({ error: "Falta el archivo." }, 400);
  if (archivos.length > MAX_ARCHIVOS) return json({ error: `Máximo ${MAX_ARCHIVOS} archivos por lectura.` }, 400);
  const invalido = archivos.find((a) => !/^application\/pdf$/i.test(a.mime) && !MIME_IMAGEN.test(a.mime));
  if (invalido) return json({ error: `Formato "${invalido.mime}" no soportado. Usa PDF o imágenes.` }, 400);
  if (archivos.reduce((t, a) => t + a.base64.length, 0) > MAX_BASE64_TOTAL) {
    return json({ error: "Los archivos pesan demasiado." }, 400);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
            ...archivos.map((a) =>
              /^application\/pdf$/i.test(a.mime)
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } }
                : {
                    type: "image",
                    source: { type: "base64", media_type: a.mime.toLowerCase().replace("image/jpg", "image/jpeg"), data: a.base64 },
                  },
            ),
            { type: "text", text: "Extrae el informe en el formato JSON indicado, con todas las filas." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    return json({ error: `Error de la IA (${res.status}): ${t.slice(0, 300)}` }, 502);
  }
  const data = await res.json();
  const texto: string = (data?.content ?? [])
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("");
  const p = parsear(texto);
  if (!p) return json({ error: `No pude interpretar la respuesta de la IA: ${texto.slice(0, 300)}` }, 502);

  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const filas = (p.filas ?? [])
    .map((r) => {
      const a = Array.isArray(r) ? r : [];
      return {
        id: String(a[0] ?? "").replace(/\D/g, ""),
        nombre: String(a[1] ?? "").trim(),
        trx: num(a[2]),
        upt: num(a[3]),
        importe: num(a[4]),
        ventas: num(a[5]),
      };
    })
    .filter((f) => f.id || f.nombre);

  return json({
    titulo: p.titulo ?? null,
    tienda: p.tienda ?? null,
    rangoTexto: p.rangoTexto ?? null,
    rango: Array.isArray(p.rango) && p.rango.length === 2 && p.rango[0] && p.rango[1] ? p.rango : null,
    totalVentas: num(p.totalVentas),
    filas,
    truncado: data?.stop_reason === "max_tokens",
  });
});

function parsear(texto: string): {
  titulo?: string | null;
  tienda?: string | null;
  rangoTexto?: string | null;
  rango?: string[] | null;
  totalVentas?: number | null;
  filas?: unknown[];
} | null {
  const limpio = texto.replace(/```(?:json)?/gi, "").trim();
  for (const t of [limpio, limpio.slice(limpio.indexOf("{"), limpio.lastIndexOf("}") + 1)]) {
    try {
      return JSON.parse(t);
    } catch {
      /* siguiente intento */
    }
  }
  return null;
}
