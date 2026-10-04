"use client";

// Subir el horario de GeoVictoria: unir cada fila con la planta por cédula,
// calcular cómo cambia el reparto del presupuesto (para mostrarlo antes de
// guardar) y guardar todo. Reglas en supabase/migrations/0041_horarios_geovictoria.sql.

import { supabase } from "./supabase";
import { diasEntre, type MesRetail } from "./mes-retail";
import { horasNetasHorario } from "./presupuesto-manual";
import {
  recalcularReparto,
  type Factores,
  type FilaRecalculo,
  type ParametrosMetas,
  type PersonaRecalculo,
  type Tarifa,
} from "./reparto";
import type { FilaGeo, HorarioGeo } from "./geovictoria";
import type { Persona, RolJerarquico } from "./types";

export type Emparejada = { fila: FilaGeo; persona: Persona };
export type Emparejamiento = {
  emparejadas: Emparejada[];
  /** No están en la planta de la tienda: se pueden registrar. */
  nuevas: FilaGeo[];
  /** Están en la planta pero dadas de baja. */
  inactivas: Emparejada[];
};

const soloDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Une cada fila del archivo con una persona de la planta por su cédula. */
export function emparejar(horario: HorarioGeo, planta: Persona[]): Emparejamiento {
  const porCedula = new Map(planta.filter((p) => soloDigitos(p.cedula)).map((p) => [soloDigitos(p.cedula), p]));
  const r: Emparejamiento = { emparejadas: [], nuevas: [], inactivas: [] };
  for (const fila of horario.filas) {
    const p = porCedula.get(soloDigitos(fila.cedula));
    if (!p) r.nuevas.push(fila);
    else if (!p.activo) r.inactivas.push({ fila, persona: p });
    else r.emparejadas.push({ fila, persona: p });
  }
  return r;
}

/** Fecha de hoy en Bogotá (YYYY-MM-DD). */
export function hoyBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

const partes = (f: string) => ({ anio: Number(f.slice(0, 4)), mes: Number(f.slice(5, 7)), dia: Number(f.slice(8, 10)) });

type MesConPresupuesto = MesRetail & { presupuesto: number };

export type EfectoMes = {
  anio: number;
  mes: number;
  nombre: string;
  /** Primer día del mes. */
  inicio: string;
  corte: string | null;
  filas: (FilaRecalculo & { nombre: string; horas_plan: number })[];
  /** Si el mes no tiene precios, las metas por categoría no se tocan. */
  conMetas: boolean;
};

type Contexto = {
  tiendaFactores: Factores;
  pctAccesorios: number;
  pctRopa: number;
  vendeRopa: boolean;
};

/**
 * Calcula, sin guardar nada, cómo queda el reparto de cada mes que toca el
 * archivo (solo meses con presupuesto cargado).
 */
export async function calcularEfecto(
  horario: HorarioGeo,
  emparejadas: Emparejada[],
  planta: Persona[],
  ctx: Contexto,
): Promise<EfectoMes[]> {
  const { data: mesesData, error } = await supabase
    .from("meses_retail")
    .select("*")
    .lte("inicio", horario.hasta)
    .gte("fin", horario.desde);
  if (error) throw new Error(error.message);
  const meses = ((mesesData as MesConPresupuesto[] | null) ?? []).filter((m) => Number(m.presupuesto) > 0);
  const hoy = hoyBogota();
  const out: EfectoMes[] = [];

  for (const m of meses) {
    const fechas = diasEntre(m.inicio, m.fin).map((d) => d.fecha);
    const enMes = new Set(fechas);
    const [{ data: kp }, { data: tf }] = await Promise.all([
      supabase.from("kpis_mensuales").select("persona_id, presupuesto, presupuesto_manual, horas, horas_plan").eq("anio", m.anio).eq("mes", m.mes),
      supabase.from("tarifas_venta_hora").select("persona_id, desde, venta_hora").eq("anio", m.anio).eq("mes", m.mes),
    ]);
    const kpis = (kp as { persona_id: string; presupuesto: number | null; presupuesto_manual: boolean; horas: number | null; horas_plan: number | null }[] | null) ?? [];
    const tarifas = (tf as ({ persona_id: string } & Tarifa)[] | null) ?? [];

    // Quiénes entran al reparto: los que ya tienen presupuesto y los del archivo con turnos este mes.
    const ids = new Set(kpis.filter((k) => Number(k.presupuesto) > 0 || k.presupuesto_manual).map((k) => k.persona_id));
    for (const e of emparejadas) if (e.fila.turnos.some((t) => enMes.has(t.fecha))) ids.add(e.persona.id);
    if (ids.size === 0) continue;

    const rolDe = new Map<string, RolJerarquico>(planta.map((p) => [p.id, p.rol_jerarquico]));
    const faltan = [...ids].filter((id) => !rolDe.has(id));
    const nombreDe = new Map(planta.map((p) => [p.id, p.nombre]));
    if (faltan.length) {
      const { data: otras } = await supabase.from("personal").select("id, nombre, rol_jerarquico").in("id", faltan);
      for (const o of (otras as { id: string; nombre: string; rol_jerarquico: RolJerarquico }[] | null) ?? []) {
        rolDe.set(o.id, o.rol_jerarquico);
        nombreDe.set(o.id, o.nombre);
      }
    }

    // Horas antes: lo que ya hay en Horarios para estos días.
    const calMeses = [...new Set(fechas.map((f) => `${partes(f).anio}-${partes(f).mes}`))].map((k) => k.split("-").map(Number));
    const antes = new Map<string, Map<string, number>>();
    for (const [a, mm] of calMeses) {
      const { data: hs } = await supabase
        .from("horarios")
        .select("persona_id, anio, mes, dia, horas, tipo, origen")
        .eq("anio", a)
        .eq("mes", mm)
        .in("persona_id", [...ids]);
      for (const h of (hs as { persona_id: string; anio: number; mes: number; dia: number; horas: number; tipo: string; origen: string }[] | null) ?? []) {
        const f = `${h.anio}-${String(h.mes).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`;
        if (!enMes.has(f)) continue;
        if (!antes.has(h.persona_id)) antes.set(h.persona_id, new Map());
        antes.get(h.persona_id)!.set(f, horasNetasHorario(h, rolDe.get(h.persona_id) === "part_time"));
      }
    }
    // Horas después: lo del archivo reemplaza los días del período.
    const despues = new Map([...antes].map(([k, v]) => [k, new Map(v)]));
    const periodo = diasEntre(horario.desde, horario.hasta).map((d) => d.fecha);
    for (const e of emparejadas) {
      const mapa = despues.get(e.persona.id) ?? new Map<string, number>();
      for (const f of periodo) mapa.delete(f);
      for (const t of e.fila.turnos) if (enMes.has(t.fecha)) mapa.set(t.fecha, t.tipo === "trabajo" ? t.horas : 0);
      despues.set(e.persona.id, mapa);
    }

    const kpiDe = new Map(kpis.map((k) => [k.persona_id, k]));
    const personas: PersonaRecalculo[] = [...ids].map((id) => {
      const k = kpiDe.get(id);
      return {
        persona_id: id,
        rol_jerarquico: rolDe.get(id) ?? "full_time",
        presupuesto: Number(k?.presupuesto ?? 0),
        manual: !!k?.presupuesto_manual,
        horasPlan: Number(k?.horas_plan ?? k?.horas ?? 0),
        tarifas: tarifas.filter((t) => t.persona_id === id).map((t) => ({ desde: t.desde, venta_hora: Number(t.venta_hora) })),
      };
    });

    const precioPares = Number((m as unknown as { precio_pares?: number }).precio_pares ?? m.precio_calzado ?? 0);
    const conMetas = precioPares > 0 && Number(m.precio_accesorios ?? 0) > 0;
    const metas: ParametrosMetas | null = conMetas
      ? {
          precioPares,
          precioAccesorios: Number(m.precio_accesorios),
          precioRopa: m.precio_ropa != null ? Number(m.precio_ropa) : null,
          pctAccesorios: ctx.pctAccesorios,
          pctRopa: ctx.pctRopa,
          vendeRopa: ctx.vendeRopa,
        }
      : null;

    const r = recalcularReparto({
      presupuestoTienda: Number(m.presupuesto),
      fechas,
      hoy,
      personas,
      horasAntes: antes,
      horasDespues: despues,
      factores: ctx.tiendaFactores,
      metas,
    });

    out.push({
      anio: m.anio,
      mes: m.mes,
      nombre: m.nombre ?? `${m.mes}/${m.anio}`,
      corte: r.corte,
      conMetas,
      inicio: fechas[0],
      filas: r.filas.map((f) => ({
        ...f,
        nombre: nombreDe.get(f.persona_id) ?? "—",
        horas_plan: personas.find((x) => x.persona_id === f.persona_id)!.horasPlan,
      })),
    });
  }
  return out;
}

/** Guarda los turnos del archivo (reemplaza los días del período de esas personas). */
export async function guardarHorarios(horario: HorarioGeo, emparejadas: Emparejada[]): Promise<number> {
  const periodo = diasEntre(horario.desde, horario.hasta).map((d) => partes(d.fecha));
  const ids = emparejadas.map((e) => e.persona.id);
  const porMes = new Map<string, number[]>();
  for (const p of periodo) {
    const k = `${p.anio}-${p.mes}`;
    porMes.set(k, [...(porMes.get(k) ?? []), p.dia]);
  }
  for (const [k, dias] of porMes) {
    const [anio, mes] = k.split("-").map(Number);
    const { error } = await supabase.from("horarios").delete().eq("anio", anio).eq("mes", mes).in("dia", dias).in("persona_id", ids);
    if (error) throw new Error("No se pudieron reemplazar los días: " + error.message);
  }
  const filas = emparejadas.flatMap((e) =>
    e.fila.turnos.map((t) => {
      const p = partes(t.fecha);
      return {
        persona_id: e.persona.id,
        anio: p.anio,
        mes: p.mes,
        dia: p.dia,
        horas: t.horas,
        tipo: t.tipo,
        origen: "geovictoria",
        entrada: t.entrada,
        salida: t.salida,
        descanso_min: t.tipo === "trabajo" ? t.descansoMin : null,
        notas: t.nota,
        franja: null,
      };
    }),
  );
  if (filas.length) {
    const { error } = await supabase.from("horarios").insert(filas);
    if (error) throw new Error("No se guardaron los turnos: " + error.message);
  }
  return filas.length;
}

/** Aplica el nuevo reparto de un mes: presupuesto por persona y venta por hora desde el corte. */
export async function aplicarEfecto(ef: EfectoMes, subidoPor: string): Promise<void> {
  if (!ef.corte) return;
  const { error: e1 } = await supabase.from("kpis_mensuales").upsert(
    ef.filas.map((f) => ({
      persona_id: f.persona_id,
      anio: ef.anio,
      mes: ef.mes,
      presupuesto: f.presupuesto,
      horas: f.horas,
      horas_venta: f.horas_venta,
      horas_plan: f.horas_plan,
      presupuesto_manual: f.manual,
      subido_por: subidoPor,
      ...(ef.conMetas ? { pares_meta: f.pares_meta, acc_meta: f.acc_meta, ropa_meta: f.ropa_meta } : {}),
    })),
    { onConflict: "persona_id,anio,mes" },
  );
  if (e1) throw new Error("No se actualizó el presupuesto por persona: " + e1.message);

  // Tramos de venta por hora: lo de antes del corte queda como estaba.
  const ids = ef.filas.map((f) => f.persona_id);
  const { data: existentes } = await supabase
    .from("tarifas_venta_hora")
    .select("persona_id, desde")
    .eq("anio", ef.anio)
    .eq("mes", ef.mes)
    .in("persona_id", ids);
  const tiene = new Set(((existentes as { persona_id: string; desde: string }[] | null) ?? []).filter((t) => t.desde < ef.corte!).map((t) => t.persona_id));
  await supabase.from("tarifas_venta_hora").delete().eq("anio", ef.anio).eq("mes", ef.mes).in("persona_id", ids).gte("desde", ef.corte);
  const filas = ef.filas.flatMap((f) => [
    // Sin tramos guardados, el primero arranca el día 1 con la venta por hora que regía.
    ...(!tiene.has(f.persona_id) && ef.corte! > ef.inicio && f.venta_hora_antes > 0
      ? [{ persona_id: f.persona_id, anio: ef.anio, mes: ef.mes, desde: ef.inicio, venta_hora: f.venta_hora_antes, creado_por: subidoPor }]
      : []),
    { persona_id: f.persona_id, anio: ef.anio, mes: ef.mes, desde: ef.corte!, venta_hora: f.venta_hora, creado_por: subidoPor },
  ]);
  const { error: e2 } = await supabase.from("tarifas_venta_hora").upsert(filas, { onConflict: "persona_id,anio,mes,desde" });
  if (e2) throw new Error("No se guardó la venta por hora: " + e2.message);
}

export async function registrarCarga(horario: HorarioGeo, archivo: string, modo: "semanal" | "mensual", personas: number, subidoPor: string) {
  const p = partes(horario.desde);
  await supabase.from("cargas_datos").insert({
    anio: p.anio,
    mes: p.mes,
    tipo: "horarios",
    origen: "geovictoria",
    archivo,
    resumen: {
      desde: horario.desde,
      hasta: horario.hasta,
      modo,
      personas,
      horas: horario.filas.reduce((a, f) => a + f.totalCalculado, 0),
    },
    cargado_por: subidoPor,
  });
}
