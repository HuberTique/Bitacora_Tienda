"use client";

// Lee de la base lo que necesita el presupuesto por semana, lo calcula
// (presupuesto-semanal.ts) y guarda el resultado: presupuesto del mes de cada
// persona (kpis_mensuales) y su venta por hora de cada semana (tramos en
// tarifas_venta_hora, para la meta del día). También cierra y reabre semanas.

import { supabase } from "./supabase";
import { cargarMesRetail, diasEntre, type MesRetail } from "./mes-retail";
import { horasNetasHorario } from "./presupuesto-manual";
import { metasCategoria, type Factores, type ParametrosMetas } from "./reparto";
import {
  calcularPresupuestoSemanal,
  type DiaHoras,
  type Novedad,
  type PersonaSemanal,
  type ResultadoSemanal,
  type SemanaEntrada,
} from "./presupuesto-semanal";
import { tiendaActualId } from "./planta";
import type { Persona, RolJerarquico } from "./types";

export type FilaHorario = {
  id: string;
  persona_id: string;
  anio: number;
  mes: number;
  dia: number;
  horas: number;
  tipo: string;
  origen: string | null;
  entrada: string | null;
  salida: string | null;
  descanso_min: number | null;
  horas_reales: number | null;
  novedad: Novedad | null;
  novedad_nota: string | null;
  /** Novedad de GeoVictoria en días libres (vacaciones, incapacidad…). */
  notas: string | null;
};

export type DatosMes = {
  mes: MesRetail;
  fechas: string[];
  semanas: (SemanaEntrada & { id: string | null; numero: number })[];
  personas: (PersonaSemanal & { nombre: string })[];
  /** Filas de Horarios del mes, por persona y fecha. */
  horarios: Map<string, Map<string, FilaHorario>>;
  dias: Map<string, Map<string, DiaHoras>>;
  kpis: Map<string, { presupuesto: number | null }>;
};

export type Contexto = { factores: Factores; pctAccesorios: number; pctRopa: number; vendeRopa: boolean };

const fechaDe = (h: { anio: number; mes: number; dia: number }) =>
  `${h.anio}-${String(h.mes).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`;

/** Horas programadas y reales de una fila de Horarios. */
export function horasDeFila(h: FilaHorario, rol: RolJerarquico): DiaHoras {
  const programadas = horasNetasHorario(h, rol === "part_time");
  return { programadas, reales: h.horas_reales != null ? Number(h.horas_reales) : programadas, novedad: h.novedad };
}

export async function cargarDatosMes(anio: number, mes: number): Promise<DatosMes | null> {
  const mr = await cargarMesRetail(anio, mes);
  if (!mr || !Number(mr.presupuesto)) return null;
  const fechas = diasEntre(mr.inicio, mr.fin).map((d) => d.fecha);
  const calMeses = [...new Set(fechas.map((f) => f.slice(0, 7)))].map((k) => k.split("-").map(Number));
  const [tid, perRes, kpRes, diaRes, semRes, ...horRes] = await Promise.all([
    tiendaActualId(),
    supabase.from("personal").select("id, nombre, rol_jerarquico, activo, tienda_id"),
    supabase.from("kpis_mensuales").select("persona_id, presupuesto, presupuesto_manual, horas, horas_plan").eq("anio", anio).eq("mes", mes),
    supabase.from("presupuestos_diarios").select("fecha, meta").gte("fecha", mr.inicio).lte("fecha", mr.fin),
    supabase.from("semanas_presupuesto").select("id, inicio, fin, presupuesto_semana_persona(persona_id, meta)").eq("anio", anio).eq("mes", mes),
    ...calMeses.map(([a, m]) =>
      supabase
        .from("horarios")
        .select("id, persona_id, anio, mes, dia, horas, tipo, origen, entrada, salida, descanso_min, horas_reales, novedad, novedad_nota, notas")
        .eq("anio", a)
        .eq("mes", m),
    ),
  ]);
  const personal = (perRes.data as (Pick<Persona, "id" | "nombre" | "rol_jerarquico" | "activo"> & { tienda_id: string })[] | null) ?? [];
  const kpis = (kpRes.data as { persona_id: string; presupuesto: number | null; presupuesto_manual: boolean; horas: number | null; horas_plan: number | null }[] | null) ?? [];
  const kpiDe = new Map(kpis.map((k) => [k.persona_id, k]));

  // En el reparto: la planta activa de la tienda y quien ya tenga presupuesto este mes.
  const ids = new Set([...personal.filter((p) => p.activo && (!tid || p.tienda_id === tid)).map((p) => p.id), ...kpis.map((k) => k.persona_id)]);
  const personas = personal
    .filter((p) => ids.has(p.id))
    .map((p) => {
      const k = kpiDe.get(p.id);
      return {
        persona_id: p.id,
        nombre: p.nombre,
        rol_jerarquico: p.rol_jerarquico,
        manual: k?.presupuesto_manual ? Number(k.presupuesto ?? 0) : null,
        horasPlan: Number(k?.horas_plan ?? k?.horas ?? 0),
      };
    });
  const rolDe = new Map(personas.map((p) => [p.persona_id, p.rol_jerarquico]));

  const enMes = new Set(fechas);
  const horarios = new Map<string, Map<string, FilaHorario>>();
  const dias = new Map<string, Map<string, DiaHoras>>();
  for (const r of horRes) {
    for (const h of (r.data as FilaHorario[] | null) ?? []) {
      const f = fechaDe(h);
      if (!enMes.has(f) || !rolDe.has(h.persona_id)) continue;
      if (!horarios.has(h.persona_id)) horarios.set(h.persona_id, new Map());
      horarios.get(h.persona_id)!.set(f, h);
      if (!dias.has(h.persona_id)) dias.set(h.persona_id, new Map());
      dias.get(h.persona_id)!.set(f, horasDeFila(h, rolDe.get(h.persona_id)!));
    }
  }

  // Semanas retail del mes y su meta (la meta diaria del planeador).
  const metaDia = new Map(((diaRes.data as { fecha: string; meta: number | null }[] | null) ?? []).map((d) => [d.fecha, Number(d.meta ?? 0)]));
  const cerradas = new Map(
    ((semRes.data as { id: string; inicio: string; presupuesto_semana_persona: { persona_id: string; meta: number }[] }[] | null) ?? []).map((s) => [
      s.inicio,
      { id: s.id, metas: new Map(s.presupuesto_semana_persona.map((x) => [x.persona_id, Number(x.meta)])) },
    ]),
  );
  const tramos = mr.semanas?.length ? mr.semanas.map((s) => ({ inicio: s.inicio, fin: s.fin })) : semanasCalendario(fechas);
  const sumaMetas = fechas.reduce((a, f) => a + (metaDia.get(f) ?? 0), 0);
  const semanas = tramos.map((s, i) => {
    const fs = diasEntre(s.inicio, s.fin).map((d) => d.fecha);
    const meta =
      sumaMetas > 0 ? fs.reduce((a, f) => a + (metaDia.get(f) ?? 0), 0) : (Number(mr.presupuesto) * fs.length) / fechas.length;
    const c = cerradas.get(s.inicio);
    return { numero: i + 1, inicio: s.inicio, fin: s.fin, meta: Math.round(meta), cerrada: c?.metas ?? null, id: c?.id ?? null };
  });

  return {
    mes: mr,
    fechas,
    semanas,
    personas,
    horarios,
    dias,
    kpis: new Map(kpis.map((k) => [k.persona_id, { presupuesto: k.presupuesto }])),
  };
}

/** Semanas de domingo a sábado cuando el mes retail no trae las suyas. */
function semanasCalendario(fechas: string[]): { inicio: string; fin: string }[] {
  const out: { inicio: string; fin: string }[] = [];
  let actual: { inicio: string; fin: string } | null = null;
  for (const f of fechas) {
    if (!actual) actual = { inicio: f, fin: f };
    actual.fin = f;
    if (new Date(f + "T12:00:00Z").getUTCDay() === 6) {
      out.push(actual);
      actual = null;
    }
  }
  if (actual) out.push(actual);
  return out;
}

export function calcular(d: DatosMes, ctx: Contexto, dias = d.dias): ResultadoSemanal {
  return calcularPresupuestoSemanal({ semanas: d.semanas, personas: d.personas, dias, diasMes: d.fechas.length, factores: ctx.factores });
}

function parametrosMetas(m: MesRetail, ctx: Contexto): ParametrosMetas | null {
  const pares = Number(m.precio_pares ?? m.precio_calzado ?? 0);
  if (!(pares > 0) || !(Number(m.precio_accesorios ?? 0) > 0)) return null;
  return {
    precioPares: pares,
    precioAccesorios: Number(m.precio_accesorios),
    precioRopa: m.precio_ropa != null ? Number(m.precio_ropa) : null,
    pctAccesorios: ctx.pctAccesorios,
    pctRopa: ctx.pctRopa,
    vendeRopa: ctx.vendeRopa,
  };
}

/** Guarda el resultado: presupuesto del mes de cada persona y su venta por hora de cada semana. */
export async function aplicarResultado(d: DatosMes, r: ResultadoSemanal, ctx: Contexto, subidoPor: string): Promise<void> {
  const metas = parametrosMetas(d.mes, ctx);
  const filas = [...r.porPersona].map(([id, x]) => ({
    persona_id: id,
    anio: d.mes.anio,
    mes: d.mes.mes,
    presupuesto: Math.round(x.presupuesto),
    horas: x.horas,
    horas_venta: x.horasVenta,
    horas_plan: d.personas.find((p) => p.persona_id === id)?.horasPlan ?? 0,
    presupuesto_manual: d.personas.find((p) => p.persona_id === id)?.manual != null,
    subido_por: subidoPor,
    ...(metas ? metasCategoria(Math.round(x.presupuesto), metas) : {}),
  }));
  const { error } = await supabase.from("kpis_mensuales").upsert(filas, { onConflict: "persona_id,anio,mes" });
  if (error) throw new Error("No se guardó el presupuesto por persona: " + error.message);

  await supabase.from("tarifas_venta_hora").delete().eq("anio", d.mes.anio).eq("mes", d.mes.mes);
  const tramos = [...r.porPersona].flatMap(([id, x]) =>
    x.tramos.map((t) => ({ persona_id: id, anio: d.mes.anio, mes: d.mes.mes, desde: t.desde, venta_hora: t.venta_hora, creado_por: subidoPor })),
  );
  if (tramos.length) {
    const { error: e2 } = await supabase.from("tarifas_venta_hora").insert(tramos);
    if (e2) throw new Error("No se guardó la venta por hora: " + e2.message);
  }
}

/** Recalcula todo el mes con lo que hay en la base y lo guarda. */
export async function recalcularYGuardarMes(anio: number, mes: number, ctx: Contexto, subidoPor: string): Promise<boolean> {
  const d = await cargarDatosMes(anio, mes);
  if (!d) return false;
  await aplicarResultado(d, calcular(d, ctx), ctx, subidoPor);
  return true;
}

/** Cierra una semana: guarda el presupuesto recalculado con las horas reales y actualiza el mes. */
export async function cerrarSemana(d: DatosMes, numero: number, ctx: Contexto, subidoPor: string): Promise<void> {
  const r = calcular(d, ctx);
  const s = r.semanas[numero - 1];
  const { data, error } = await supabase
    .from("semanas_presupuesto")
    .insert({ anio: d.mes.anio, mes: d.mes.mes, inicio: s.inicio, fin: s.fin, meta_tienda: s.meta, cerrada_por: subidoPor })
    .select("id")
    .single();
  if (error) throw new Error("No se pudo cerrar la semana: " + error.message);
  const { error: e2 } = await supabase.from("presupuesto_semana_persona").insert(
    s.filas.map((f) => ({
      semana_id: (data as { id: string }).id,
      persona_id: f.persona_id,
      meta_proyectada: f.proyectada,
      meta: f.recalculada,
      horas_programadas: f.horasProgramadas,
      horas_reales: f.horasReales,
      horas_venta: f.horasVenta,
    })),
  );
  if (e2) {
    await supabase.from("semanas_presupuesto").delete().eq("id", (data as { id: string }).id);
    throw new Error("No se pudo guardar la semana: " + e2.message);
  }
  await recalcularYGuardarMes(d.mes.anio, d.mes.mes, ctx, subidoPor);
}

export async function reabrirSemana(d: DatosMes, numero: number, ctx: Contexto, subidoPor: string): Promise<void> {
  const s = d.semanas[numero - 1];
  if (!s.id) return;
  const { error } = await supabase.from("semanas_presupuesto").delete().eq("id", s.id);
  if (error) throw new Error("No se pudo reabrir la semana: " + error.message);
  await recalcularYGuardarMes(d.mes.anio, d.mes.mes, ctx, subidoPor);
}

/** Registra lo que de verdad pasó un día (o lo borra si se deja sin novedad). */
export async function guardarNovedad(opts: {
  fila: FilaHorario | null;
  personaId: string;
  fecha: string;
  novedad: Novedad | null;
  horasReales: number | null;
  nota: string;
  por: string;
}): Promise<void> {
  const cambios = {
    novedad: opts.novedad,
    horas_reales: opts.novedad ? opts.horasReales : null,
    novedad_nota: opts.novedad ? opts.nota.trim() || null : null,
    novedad_por: opts.novedad ? opts.por : null,
    novedad_at: opts.novedad ? new Date().toISOString() : null,
  };
  if (opts.fila) {
    const { error } = await supabase.from("horarios").update(cambios).eq("id", opts.fila.id);
    if (error) throw new Error(error.message);
    return;
  }
  if (!opts.novedad) return;
  // Un día sin horario (p. ej. horas extra en su descanso): se crea como descanso con la novedad.
  const [anio, mes, dia] = opts.fecha.split("-").map(Number);
  const { error } = await supabase
    .from("horarios")
    .insert({ persona_id: opts.personaId, anio, mes, dia, horas: 0, tipo: "descanso", origen: "geovictoria", ...cambios });
  if (error) throw new Error(error.message);
}

/**
 * Tras cargar un presupuesto nuevo del mes: las semanas que estaban cerradas se
 * vuelven a cerrar con la meta nueva (y sus horas reales), y el resto se proyecta.
 */
export async function rehacerMes(anio: number, mes: number, ctx: Contexto, subidoPor: string): Promise<void> {
  const antes = await cargarDatosMes(anio, mes);
  if (!antes) return;
  const cerradas = antes.semanas.filter((s) => s.id).map((s) => s.numero);
  if (cerradas.length) await supabase.from("semanas_presupuesto").delete().eq("anio", anio).eq("mes", mes);
  for (const n of cerradas) {
    const d = await cargarDatosMes(anio, mes);
    if (d) await cerrarSemana(d, n, ctx, subidoPor);
  }
  if (!cerradas.length) await recalcularYGuardarMes(anio, mes, ctx, subidoPor);
}
