"use client";

// Mes RETAIL. El calendario de la compañía define cada "mes" con fechas
// propias (p. ej. septiembre = 30-ago a 3-oct, 5 semanas de domingo a sábado).
// Si el mes retail aún no está cargado (hoja "Target" del planeador), se usa el
// mes calendario como respaldo, así nada se rompe.

import { supabase } from "./supabase";

export type SemanaRetail = {
  numero: number;
  inicio: string; // YYYY-MM-DD
  fin: string;
  target: number | null;
  anio_anterior: number | null;
  real: number | null;
};

export type MesRetail = {
  anio: number;
  mes: number;
  nombre: string;
  inicio: string;
  fin: string;
  presupuesto: number | null;
  tienda: string | null;
  semanas: SemanaRetail[];
  // Carga del planeador
  archivo: string | null;
  cargado_por: string | null;
  cargado_en: string | null;
  fecha_corte: string | null; // hasta qué día llegan los datos
  meta_a_corte: number | null; // meta acumulada hasta la fecha de corte
  venta_a_corte: number | null; // venta real acumulada hasta la fecha de corte
  // Carga de ventas consolidadas (PDF "Visión general de ventas")
  ventas_archivo: string | null;
  ventas_cargado_por: string | null;
  ventas_cargado_en: string | null;
  ventas_corte: string | null;
  ventas_total: number | null; // venta neta total de la tienda según las ventas consolidadas
};

export type DiaPeriodo = {
  fecha: string; // YYYY-MM-DD
  dia: number; // día del mes calendario (puede haber dos "30" en un mes retail)
  mes: number; // mes calendario del día
  anio: number;
  weekday: number; // 0=domingo
};

export type Periodo = {
  inicio: string;
  fin: string;
  fechas: DiaPeriodo[];
  esRetail: boolean;
  semanas: SemanaRetail[];
};

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Lista de días entre dos fechas (inclusive). */
export function diasEntre(inicio: string, fin: string): DiaPeriodo[] {
  const out: DiaPeriodo[] = [];
  const c = parseYmd(inicio);
  const f = parseYmd(fin);
  while (c <= f) {
    out.push({
      fecha: ymd(c),
      dia: c.getDate(),
      mes: c.getMonth() + 1,
      anio: c.getFullYear(),
      weekday: c.getDay(),
    });
    c.setDate(c.getDate() + 1);
  }
  return out;
}

/** Periodo de un (anio, mes) etiqueta: el mes retail si existe, si no el mes calendario. */
export function construirPeriodo(anio: number, mes: number, retail?: MesRetail | null): Periodo {
  if (retail) {
    return {
      inicio: retail.inicio,
      fin: retail.fin,
      fechas: diasEntre(retail.inicio, retail.fin),
      esRetail: true,
      semanas: retail.semanas,
    };
  }
  const ultimo = new Date(anio, mes, 0).getDate();
  const inicio = `${anio}-${pad(mes)}-01`;
  const fin = `${anio}-${pad(mes)}-${pad(ultimo)}`;
  return { inicio, fin, fechas: diasEntre(inicio, fin), esRetail: false, semanas: [] };
}

/** Lee el mes retail cargado (o null si no hay). */
export async function cargarMesRetail(anio: number, mes: number): Promise<MesRetail | null> {
  const { data } = await supabase
    .from("meses_retail")
    .select("*")
    .eq("anio", anio)
    .eq("mes", mes)
    .maybeSingle();
  return (data as MesRetail | null) ?? null;
}

/** Años calendario que cubre un periodo (para consultar horarios en 2 meses/años). */
export function mesesCalendario(p: Periodo): { anio: number; mes: number }[] {
  const s = new Set<string>();
  p.fechas.forEach((d) => s.add(`${d.anio}-${d.mes}`));
  return [...s].map((k) => {
    const [anio, mes] = k.split("-").map(Number);
    return { anio, mes };
  });
}

/** Semana (índice 1..n) a la que pertenece una fecha dentro del periodo, o 0. */
export function semanaDe(p: Periodo, fecha: string): number {
  const s = p.semanas.find((x) => fecha >= x.inicio && fecha <= x.fin);
  return s?.numero ?? 0;
}

/**
 * Mes retail en el que cae HOY (p. ej. el 1-oct sigue siendo "septiembre" retail
 * si el mes va del 30-ago al 3-oct). null si aún no hay ninguno cargado.
 */
export async function mesRetailDeHoy(): Promise<{ anio: number; mes: number } | null> {
  const hoy = ymd(new Date());
  const { data } = await supabase
    .from("meses_retail")
    .select("anio, mes")
    .lte("inicio", hoy)
    .gte("fin", hoy)
    .limit(1);
  const fila = (data as { anio: number; mes: number }[] | null)?.[0];
  return fila ?? null;
}
