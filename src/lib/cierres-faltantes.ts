"use client";

// Días del mes retail a los que les falta el cierre (Huber, 8-oct-2026): la venta
// en pesos sale SOLO de los cierres del día, así que si falta uno la venta queda
// incompleta y hay que avisarlo. Se revisa hasta AYER (el cierre de hoy se sube
// al terminar el día) y solo los días con meta (un día con meta 0 no abrió).

import { supabase } from "./supabase";
import { diasEntre, parseYmd, ymd, type MesRetail } from "./mes-retail";

export type EstadoCierres = {
  /** Último día que debería tener cierre: ayer, o el fin del mes si ya terminó. */
  hasta: string | null;
  faltan: string[];
  ultimoCierre: string | null;
};

export const ayer = (hoy = new Date()) => {
  const d = new Date(hoy);
  d.setDate(d.getDate() - 1);
  return ymd(d);
};

/** Fecha corta para avisos: "dom 5-oct". */
export function fechaCorta(f: string): string {
  return parseYmd(f)
    .toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })
    .replace(/\./g, "")
    .replace(/ de /g, "-")
    .replace(/,/g, "");
}

/** Pura: qué días esperados (con meta, del inicio hasta `hasta`) no tienen cierre. */
export function diasSinCierre(
  inicio: string,
  fin: string,
  hasta: string,
  conCierre: Set<string>,
  metas?: Map<string, number | null>,
): string[] {
  const tope = hasta < fin ? hasta : fin;
  if (tope < inicio) return [];
  const conMetas = !!metas && [...metas.values()].some((m) => (m ?? 0) > 0);
  return diasEntre(inicio, tope)
    .map((d) => d.fecha)
    .filter((f) => !conCierre.has(f) && (!conMetas || (metas!.get(f) ?? 0) > 0));
}

/** Consulta los cierres cargados del mes retail y dice qué días faltan. */
export async function cargarEstadoCierres(mes: MesRetail | null, hoy = new Date()): Promise<EstadoCierres> {
  if (!mes) return { hasta: null, faltan: [], ultimoCierre: null };
  const hasta = ayer(hoy) < mes.fin ? ayer(hoy) : mes.fin;
  if (hasta < mes.inicio) return { hasta: null, faltan: [], ultimoCierre: null };
  // El cierre guarda la venta de la tienda en presupuestos_diarios (una fila por día); las filas por
  // asesor completan los cierres viejos que no la guardaban.
  const [v, d] = await Promise.all([
    supabase.from("ventas_asesor_dia").select("fecha").gte("fecha", mes.inicio).lte("fecha", mes.fin).order("fecha", { ascending: false }),
    supabase.from("presupuestos_diarios").select("fecha, meta, venta").gte("fecha", mes.inicio).lte("fecha", mes.fin),
  ]);
  const dias = (d.data as { fecha: string; meta: number | null; venta: number | null }[] | null) ?? [];
  const fechas = new Set([
    ...((v.data as { fecha: string }[] | null) ?? []).map((x) => x.fecha),
    ...dias.filter((x) => x.venta != null).map((x) => x.fecha),
  ]);
  const metas = new Map(dias.map((x) => [x.fecha, x.meta]));
  const ultimoCierre = [...fechas].sort().at(-1) ?? null;
  return { hasta, faltan: diasSinCierre(mes.inicio, mes.fin, hasta, fechas, metas), ultimoCierre };
}

/** Texto del aviso: "Faltan los cierres de 2 días: dom 5-oct, mar 7-oct." */
export function textoFaltan(faltan: string[], max = 8): string {
  const lista = faltan.slice(0, max).map(fechaCorta).join(", ");
  const mas = faltan.length > max ? ` y ${faltan.length - max} más` : "";
  return faltan.length === 1 ? `Falta el cierre del ${lista}.` : `Faltan los cierres de ${faltan.length} días: ${lista}${mas}.`;
}
