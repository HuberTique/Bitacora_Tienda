"use client";

// Subir el horario de GeoVictoria: unir cada fila con la planta por cédula,
// calcular cómo cambia el reparto del presupuesto (para mostrarlo antes de
// guardar) y guardar todo. Reglas en supabase/migrations/0041_horarios_geovictoria.sql.

import { supabase } from "./supabase";
import { diasEntre } from "./mes-retail";
import { calcular, cargarDatosMes, recalcularYGuardarMes, type Contexto } from "./presupuesto-semanal-datos";
import type { FilaGeo, HorarioGeo } from "./geovictoria";
import type { Persona } from "./types";

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

export type EfectoMes = {
  anio: number;
  mes: number;
  nombre: string;
  filas: { persona_id: string; nombre: string; manual: boolean; presupuestoAntes: number; presupuesto: number; horas: number }[];
};

/**
 * Calcula, sin guardar nada, cómo queda el presupuesto de cada persona en cada
 * mes que toca el archivo (solo meses con presupuesto). Usa el presupuesto por
 * semana: las semanas abiertas se proyectan con el horario nuevo; las cerradas
 * no cambian.
 */
export async function calcularEfecto(horario: HorarioGeo, emparejadas: Emparejada[], ctx: Contexto): Promise<EfectoMes[]> {
  const { data: mesesData, error } = await supabase
    .from("meses_retail")
    .select("anio, mes, presupuesto")
    .lte("inicio", horario.hasta)
    .gte("fin", horario.desde);
  if (error) throw new Error(error.message);
  const periodo = diasEntre(horario.desde, horario.hasta).map((d) => d.fecha);
  const out: EfectoMes[] = [];
  for (const m of ((mesesData as { anio: number; mes: number; presupuesto: number | null }[] | null) ?? []).filter((x) => Number(x.presupuesto) > 0)) {
    const d = await cargarDatosMes(m.anio, m.mes);
    if (!d) continue;
    // Lo del archivo reemplaza esos días (sin novedades: es lo programado).
    const dias = new Map([...d.dias].map(([k, v]) => [k, new Map(v)]));
    for (const e of emparejadas) {
      const mapa = dias.get(e.persona.id) ?? new Map();
      for (const f of periodo) mapa.delete(f);
      for (const t of e.fila.turnos) {
        const h = t.tipo === "trabajo" ? t.horas : 0;
        if (d.fechas.includes(t.fecha)) mapa.set(t.fecha, { programadas: h, reales: h, novedad: null });
      }
      dias.set(e.persona.id, mapa);
    }
    // Quien entra por el archivo y aún no estaba en el reparto.
    for (const e of emparejadas) {
      if (!d.personas.some((p) => p.persona_id === e.persona.id) && e.fila.turnos.some((t) => d.fechas.includes(t.fecha))) {
        d.personas.push({ persona_id: e.persona.id, nombre: e.persona.nombre, rol_jerarquico: e.persona.rol_jerarquico, manual: null, horasPlan: 0 });
      }
    }
    const r = calcular(d, ctx, dias);
    out.push({
      anio: m.anio,
      mes: m.mes,
      nombre: d.mes.nombre ?? `${m.mes}/${m.anio}`,
      filas: d.personas.map((p) => ({
        persona_id: p.persona_id,
        nombre: p.nombre,
        manual: p.manual != null,
        presupuestoAntes: Number(d.kpis.get(p.persona_id)?.presupuesto ?? 0),
        presupuesto: Math.round(r.porPersona.get(p.persona_id)?.presupuesto ?? 0),
        horas: r.porPersona.get(p.persona_id)?.horas ?? 0,
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

/** Vuelve a calcular y guardar el presupuesto del mes con lo que quedó en Horarios. */
export async function aplicarEfecto(ef: EfectoMes, ctx: Contexto, subidoPor: string): Promise<void> {
  await recalcularYGuardarMes(ef.anio, ef.mes, ctx, subidoPor);
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
