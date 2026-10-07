"use client";

// Operaciones sobre las cargas del mes (presupuesto, ventas consolidadas,
// transacciones) e historial. Lo vendido en los cierres del día nunca se toca.

import { supabase } from "@/lib/supabase";
import type { MesRetail } from "@/lib/mes-retail";

export type Carga = {
  id: string;
  anio: number;
  mes: number;
  tipo: "presupuesto" | "ventas_consolidadas" | "transacciones";
  origen: "planeador" | "manual" | "pdf" | "xstore";
  archivo: string | null;
  resumen: Record<string, unknown>;
  cargado_por: string | null;
  cargado_at: string;
  vigente: boolean;
  eliminado_at: string | null;
};

export async function cargasDelMes(anio: number, mes: number): Promise<Carga[]> {
  const { data } = await supabase
    .from("cargas_datos")
    .select("*")
    .eq("anio", anio)
    .eq("mes", mes)
    .is("eliminado_at", null)
    .order("cargado_at", { ascending: false });
  return (data as Carga[] | null) ?? [];
}

/**
 * UPT = unidades ÷ TRX, para quien tenga las dos cosas en el mes y aún no tenga
 * UPT: el que viene del informe de Xstore (Productividad de empleado) manda.
 */
export async function recalcularUpt(anio: number, mes: number): Promise<void> {
  const { data } = await supabase.from("kpis_mensuales").select("id, unidades, trx, upt").eq("anio", anio).eq("mes", mes);
  const filas = (data as { id: string; unidades: number | null; trx: number | null; upt: number | null }[] | null) ?? [];
  for (const f of filas) {
    if (f.upt != null) continue;
    const upt = f.trx && f.trx > 0 && f.unidades != null ? Math.round((f.unidades / f.trx) * 100) / 100 : null;
    await supabase.from("kpis_mensuales").update({ upt }).eq("id", f.id);
  }
}

/**
 * Borra el presupuesto del mes (planeador o provisional): presupuesto y metas
 * de cada persona, meta de cada día y mes retail. Lo vendido se conserva.
 */
export async function borrarPresupuestoMes(anio: number, mes: number, mesInfo: MesRetail | null): Promise<string | null> {
  const { error: e1 } = await supabase
    .from("kpis_mensuales")
    .update({ presupuesto: null, pares_meta: null, acc_meta: null, ropa_meta: null, horas: null, horas_venta: null, horas_plan: null, presupuesto_manual: false })
    .eq("anio", anio)
    .eq("mes", mes);
  if (e1) return e1.message;
  // Filas que quedaron vacías (sin nada vendido) se eliminan.
  await supabase
    .from("kpis_mensuales")
    .delete()
    .eq("anio", anio)
    .eq("mes", mes)
    .is("corte_ventas", null)
    .is("acumulado_neto", null)
    .is("acumulado_bruto", null)
    .is("trx", null);
  if (mesInfo) {
    const { error: e2 } = await supabase.from("presupuestos_diarios").update({ meta: null }).gte("fecha", mesInfo.inicio).lte("fecha", mesInfo.fin);
    if (e2) return e2.message;
    await supabase.from("presupuestos_diarios").delete().gte("fecha", mesInfo.inicio).lte("fecha", mesInfo.fin).is("venta", null);
    // El mes retail se conserva si ya tiene ventas consolidadas cargadas.
    const { error: e3 } = mesInfo.ventas_archivo
      ? await supabase
          .from("meses_retail")
          .update({
            presupuesto: null,
            archivo: null,
            provisional: false,
            precio_pares: null,
            precio_calzado: null,
            precio_accesorios: null,
            precio_ropa: null,
            semanas: mesInfo.semanas.map((s) => ({ ...s, target: null })),
          })
          .eq("anio", anio)
          .eq("mes", mes)
      : await supabase.from("meses_retail").delete().eq("anio", anio).eq("mes", mes);
    if (e3) return e3.message;
  }
  await supabase.from("presupuestos_uploads").delete().eq("anio", anio).eq("mes", mes);
  await supabase.from("tarifas_venta_hora").delete().eq("anio", anio).eq("mes", mes);
  return null;
}

/** Borra lo cargado de las ventas consolidadas del mes (venta acumulada y unidades). */
export async function borrarVentasMes(anio: number, mes: number): Promise<string | null> {
  const { error } = await supabase
    .from("kpis_mensuales")
    .update({
      acumulado_bruto: null,
      acumulado_neto: null,
      cumplimiento: null,
      unidades: null,
      pares_venta: null,
      acc_venta: null,
      ropa_venta: null,
      upt: null,
      corte_ventas: null,
    })
    .eq("anio", anio)
    .eq("mes", mes);
  if (error) return error.message;
  await supabase
    .from("meses_retail")
    .update({ ventas_archivo: null, ventas_cargado_por: null, ventas_cargado_en: null, ventas_corte: null, ventas_total: null })
    .eq("anio", anio)
    .eq("mes", mes);
  return null;
}

/** Borra la TRX cargada del mes (y con ella el UPT). */
export async function borrarTrxMes(anio: number, mes: number): Promise<string | null> {
  const { error } = await supabase.from("kpis_mensuales").update({ trx: null, upt: null }).eq("anio", anio).eq("mes", mes);
  return error?.message ?? null;
}

/**
 * Elimina una carga del historial. Si es la vigente, también deshace sus datos
 * (y la anterior NO vuelve sola: hay que cargarla de nuevo).
 */
export async function eliminarCarga(c: Carga, mesInfo: MesRetail | null, quien: string): Promise<string | null> {
  if (c.vigente) {
    const err =
      c.tipo === "presupuesto"
        ? await borrarPresupuestoMes(c.anio, c.mes, mesInfo)
        : c.tipo === "ventas_consolidadas"
          ? await borrarVentasMes(c.anio, c.mes)
          : await borrarTrxMes(c.anio, c.mes);
    if (err) return err;
  }
  const { error } = await supabase
    .from("cargas_datos")
    .update({ vigente: false, eliminado_at: new Date().toISOString(), eliminado_por: quien })
    .eq("id", c.id);
  return error?.message ?? null;
}
