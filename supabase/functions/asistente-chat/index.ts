// Edge Function: asistente-chat
//
// Fase 4 — Asistente: chat con IA para el asesor, con contexto de sus propios
// datos (pendientes, feedbacks/faltas, presupuesto del mes, requerimientos).
// Portado del artifact original (renderAsistente/sendChat) — misma idea de
// "stateless por turno" (no se reenvía el historial completo al modelo, se
// reconstruye el contexto fresco en cada pregunta), pero ahora el contexto
// sale de Supabase (RLS ya lo deja scoped al asesor que llama) en vez de un
// STATE en memoria del navegador.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { contextoEmpresa } from "../_shared/contexto-empresa.ts";

const MODEL = "claude-haiku-4-5-20251001";

// Debe coincidir con el hardcode de public.compute_ocurrencia (0005_feedbacks.sql).
const VIGENCIA_MESES = 4;

type Body = { mensaje?: string };

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
    .select("id, nombre, rol")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!caller) return json({ error: "No se encontró tu persona asociada." }, 403);
  if (caller.rol !== "asesor") {
    return json({ error: "El Asistente está disponible solo para asesores." }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }
  const mensaje = (body.mensaje ?? "").trim();
  if (!mensaje) return json({ error: "Escribe una pregunta." }, 400);

  const hoy = new Date().toISOString().slice(0, 10);
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));

  // Todas las consultas siguientes viajan con el JWT del asesor: RLS ya las
  // deja scoped a lo suyo (pendientes donde participa, retardos/presupuesto/
  // requerimientos propios) — no hace falta filtrar por persona_id acá.
  const [pendientesRes, retardosRes, faltasConfigRes, presupuestoRes, requerimientosRes] =
    await Promise.all([
      supabaseAsUser
        .from("pendientes")
        .select("titulo, area, turno, estado")
        .neq("estado", "cerrado")
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAsUser
        .from("retardos")
        .select("fecha, tipo_id, ocurrencia, accion, estado, faltas_config(nombre)")
        .order("fecha", { ascending: false })
        .limit(8),
      supabaseAsUser
        .from("faltas_config")
        .select("nombre, ladder")
        .order("posicion", { ascending: true }),
      supabaseAsUser
        .from("presupuestos_semanales")
        .select("meta, venta")
        .eq("anio", anio)
        .eq("mes", mes),
      supabaseAsUser
        .from("requerimientos")
        .select("fecha, tipo, estado")
        .gte("fecha", hoy)
        .order("fecha", { ascending: true })
        .limit(5),
    ]);

  const pendientesTxt =
    (pendientesRes.data ?? [])
      .map((p) => `- [${p.estado}] ${p.titulo} (${p.area}, turno ${p.turno})`)
      .join("\n") || "Ninguno";

  const retardosTxt =
    (retardosRes.data ?? [])
      .map((r) => {
        // El join anidado de PostgREST puede venir como objeto o array según
        // la relación — cubrimos ambos casos sin asumir la forma exacta.
        const faltaRel = r.faltas_config as unknown;
        const nombre = Array.isArray(faltaRel)
          ? (faltaRel[0] as { nombre?: string } | undefined)?.nombre
          : (faltaRel as { nombre?: string } | null)?.nombre;
        return `- ${r.fecha}: ${nombre ?? r.tipo_id}, ${r.ocurrencia}ª vez → ${r.accion} [${r.estado}]`;
      })
      .join("\n") || "Ninguna";

  const faltasConfigTxt =
    (faltasConfigRes.data ?? [])
      .map((t) => `${t.nombre}: ${(t.ladder as string[]).join(" → ")}`)
      .join(" / ") || "Sin configurar";

  const filasPresupuesto = presupuestoRes.data ?? [];
  const metaTotal = filasPresupuesto.reduce((acc, r) => acc + (r.meta ?? 0), 0);
  const ventaTotal = filasPresupuesto.reduce((acc, r) => acc + (r.venta ?? 0), 0);
  const presupuestoTxt =
    filasPresupuesto.length === 0
      ? "Jefatura aún no ha subido el presupuesto de este mes."
      : `Meta acumulada del mes: $${Math.round(metaTotal).toLocaleString("es-CO")}. Venta acumulada: $${Math.round(
          ventaTotal,
        ).toLocaleString("es-CO")}. Cumplimiento: ${
          metaTotal > 0 ? Math.round((ventaTotal / metaTotal) * 100) + "%" : "—"
        }.`;

  const requerimientosTxt =
    (requerimientosRes.data ?? [])
      .map((r) => `- ${r.fecha}: ${r.tipo} [${r.estado}]`)
      .join("\n") || "Ninguno próximo";

  const sistema = `Eres el asistente interno de una tienda retail, hablas con un asesor de tienda llamado ${caller.nombre}. Responde en español, en tono cercano y breve (máximo 100 palabras). Usa solo la información de contexto dada; si no sabes algo, dilo y sugiere con quién hablar (su jefe/subjefe). Si preguntan dónde consultar algo, menciona la plataforma correspondiente del contexto de la empresa.

Responde en texto plano: NUNCA uses markdown (nada de **negrita**, #títulos, guiones de lista, etc.) — el chat lo muestra tal cual, sin interpretar formato.

${await contextoEmpresa(supabaseAsUser)}

Matriz de faltas vigente (una reincidencia deja de contar pasados ${VIGENCIA_MESES} meses): ${faltasConfigTxt}

Pendientes de este asesor:
${pendientesTxt}

Feedbacks/faltas de este asesor:
${retardosTxt}

Presupuesto de este asesor (mes actual):
${presupuestoTxt}

Requerimientos de este asesor (próximos o del día):
${requerimientosTxt}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: sistema,
      messages: [{ role: "user", content: mensaje }],
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
  const respuesta: string = anthropicJson?.content?.[0]?.text ?? "";
  if (!respuesta) {
    return json({ error: "La IA no devolvió una respuesta." }, 502);
  }

  return json({ respuesta });
});
