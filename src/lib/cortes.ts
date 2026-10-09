"use client";

// Cada carga de la consolidada o de Xstore se guarda como un CORTE (foto por persona a esa fecha)
// para poder sacar lo de cada semana restando cortes (ver periodos.ts). Un informe más nuevo con la
// misma fecha reemplaza ese corte; eliminar la carga vigente borra su corte.

import { supabase } from "./supabase";
import type { Corte, FuenteCorte } from "./periodos";

export type FilaCorte = Partial<Omit<Corte, "fuente" | "corte" | "persona_id">> & { persona_id: string };

export async function guardarCorte(
  anio: number,
  mes: number,
  fuente: FuenteCorte,
  corte: string | null,
  filas: FilaCorte[],
  quien: string,
): Promise<string | null> {
  if (!corte) return null;
  const { error: e1 } = await supabase.from("cortes_kpis").delete().eq("anio", anio).eq("mes", mes).eq("fuente", fuente).eq("corte", corte);
  if (e1) return e1.message;
  if (filas.length === 0) return null;
  const { error } = await supabase.from("cortes_kpis").insert(
    filas.map((f) => ({
      anio,
      mes,
      fuente,
      corte,
      persona_id: f.persona_id,
      pares: f.pares ?? null,
      acc: f.acc ?? null,
      ropa: f.ropa ?? null,
      unidades: f.unidades ?? null,
      trx: f.trx ?? null,
      upt: f.upt ?? null,
      cargado_por: quien,
    })),
  );
  return error?.message ?? null;
}

export async function borrarCorte(anio: number, mes: number, fuente: FuenteCorte, corte: string | null | undefined) {
  if (!corte) return;
  await supabase.from("cortes_kpis").delete().eq("anio", anio).eq("mes", mes).eq("fuente", fuente).eq("corte", corte);
}

export async function cargarCortes(anio: number, mes: number): Promise<Corte[]> {
  const { data } = await supabase
    .from("cortes_kpis")
    .select("fuente, corte, persona_id, pares, acc, ropa, unidades, trx, upt")
    .eq("anio", anio)
    .eq("mes", mes);
  return (data as Corte[] | null) ?? [];
}
