"use client";

// Calificaciones del mejor vendedor (Huber, 8-oct-2026): Puntualidad, Trabajo en
// equipo e Iniciativa no salen de datos; las califica la jefatura del día 1 al 5
// del mes siguiente (después aparece vencida hasta que se califique). Es una tarea
// automática del sistema para todas las tiendas: no hay que crearla.

import { supabase } from "./supabase";
import { parseYmd, ymd } from "./mes-retail";
import type { CalificacionVendedor } from "./ranking";

export const DIAS_PARA_CALIFICAR = 5;
export const ITEMS_MANUALES = ["puntualidad", "trabajo_equipo", "iniciativa"] as const;

export type TareaCalificacion = {
  /** Mes que se califica (el anterior al actual). */
  anio: number;
  mes: number;
  estado: "abierta" | "vencida";
  /** Último día para calificar (YYYY-MM-DD). */
  vence: string;
  diasRestantes: number;
  diasDeAtraso: number;
  faltan: number;
};

const mesAnterior = (anio: number, mes: number) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });

/**
 * Pura: dado hoy y el mes en curso (retail si se conoce su inicio; si no, el
 * calendario), qué mes toca calificar y si la tarea está abierta o vencida.
 */
export function ventanaCalificacion(
  hoy: Date,
  actual: { anio: number; mes: number; inicio: string | null } | null,
): { anio: number; mes: number; vence: string; dia: number } {
  const anio = actual?.anio ?? hoy.getFullYear();
  const mes = actual?.mes ?? hoy.getMonth() + 1;
  const inicio = actual?.inicio ? parseYmd(actual.inicio) : new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const vence = new Date(inicio);
  vence.setDate(vence.getDate() + DIAS_PARA_CALIFICAR - 1);
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dia = Math.round((hoy0.getTime() - inicio.getTime()) / 86_400_000) + 1;
  return { ...mesAnterior(anio, mes), vence: ymd(vence), dia };
}

/** La tarea de calificar el mes anterior, o null si ya está hecha (o no aplica). */
export async function cargarTareaCalificacion(hoy = new Date()): Promise<TareaCalificacion | null> {
  const f = ymd(hoy);
  const { data: mr } = await supabase.from("meses_retail").select("anio, mes, inicio").lte("inicio", f).gte("fin", f).limit(1);
  const actual = (mr as { anio: number; mes: number; inicio: string }[] | null)?.[0] ?? null;
  const v = ventanaCalificacion(hoy, actual);
  // Solo si el mes anterior tuvo ranking (hay presupuesto cargado): una tienda nueva no tiene qué calificar.
  const [{ count: conKpis }, cal] = await Promise.all([
    supabase.from("kpis_mensuales").select("id", { count: "exact", head: true }).eq("anio", v.anio).eq("mes", v.mes),
    supabase.from("calificaciones_vendedor").select("item").eq("anio", v.anio).eq("mes", v.mes),
  ]);
  if (cal.error || !conKpis) return null;
  const hechas = new Set(((cal.data as { item: string }[] | null) ?? []).map((c) => c.item));
  const faltan = ITEMS_MANUALES.filter((i) => !hechas.has(i)).length;
  if (faltan === 0) return null;
  return {
    anio: v.anio,
    mes: v.mes,
    estado: v.dia <= DIAS_PARA_CALIFICAR ? "abierta" : "vencida",
    vence: v.vence,
    diasRestantes: Math.max(0, DIAS_PARA_CALIFICAR - v.dia + 1),
    diasDeAtraso: Math.max(0, v.dia - DIAS_PARA_CALIFICAR),
    faltan,
  };
}

export async function cargarCalificaciones(anio: number, mes: number): Promise<CalificacionVendedor[]> {
  const { data } = await supabase.from("calificaciones_vendedor").select("*").eq("anio", anio).eq("mes", mes);
  return (data as CalificacionVendedor[] | null) ?? [];
}
