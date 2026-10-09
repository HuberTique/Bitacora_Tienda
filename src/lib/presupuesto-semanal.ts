// Presupuesto por semana retail (domingo a sábado). Reglas de Huber, 7-oct-2026
// (ver supabase/migrations/0043_novedades_semanas.sql):
//
//   * La meta de la tienda de cada semana (la meta diaria del planeador) se
//     reparte entre el equipo por HORAS DE VENTA (horas × factor del cargo).
//   * PROYECTADO: con las horas programadas (horario de GeoVictoria; los días
//     sin horario, las horas base del mes ÷ días del mes).
//   * RECALCULADO, al cerrar la semana: con las horas reales. Lo que alguien no
//     cubrió por una novedad justificada (incapacidad, vacaciones, licencia,
//     calamidad) pasa a los demás de esa semana. Con una ausencia injustificada
//     o retardo, conserva su presupuesto: se reparte con sus horas programadas.
//   * Quien tiene presupuesto fijado a mano lo conserva: su parte de cada
//     semana sale de su presupuesto del mes según sus horas de esa semana.
//   * El presupuesto del mes de cada persona = suma de sus semanas
//     (recalculadas las cerradas, proyectadas las abiertas).
//
// Funciones puras, sin base de datos.

import { factorDe, type Factores, type Tarifa } from "./reparto";
import type { RolJerarquico } from "./types";

export const NOVEDADES = {
  incapacidad: { label: "Incapacidad", justificada: true },
  vacaciones: { label: "Vacaciones", justificada: true },
  licencia: { label: "Licencia o permiso", justificada: true },
  calamidad: { label: "Calamidad", justificada: true },
  ausencia: { label: "Ausencia injustificada", justificada: false },
  retardo: { label: "Retardo o salida temprano", justificada: false },
  horas_extra: { label: "Horas extra", justificada: true },
} as const;
export type Novedad = keyof typeof NOVEDADES;

export type DiaHoras = {
  /** Horas netas programadas (sin almuerzo). */
  programadas: number;
  /** Horas netas que de verdad trabajó. */
  reales: number;
  novedad: Novedad | null;
};

export type PersonaSemanal = {
  persona_id: string;
  rol_jerarquico: RolJerarquico;
  /** Presupuesto fijado a mano por la jefatura (se conserva). */
  manual: number | null;
  /** Horas base del mes (planeador/provisional) para los días sin horario. */
  horasPlan: number;
};

export type SemanaEntrada = {
  inicio: string;
  fin: string;
  /** Meta de la tienda para la semana. */
  meta: number;
  /** Si está cerrada: el presupuesto que quedó de cada persona. */
  cerrada: Map<string, number> | null;
};

export type FilaSemana = {
  persona_id: string;
  proyectada: number;
  /** Con las horas reales (lo que quedaría al cerrar). */
  recalculada: number;
  /** La que rige: la guardada si la semana está cerrada, si no la proyectada. */
  vigente: number;
  horasProgramadas: number;
  horasReales: number;
  /** Horas de venta con las que se calcula la vigente. */
  horasVenta: number;
};

export type ResultadoSemanal = {
  semanas: (SemanaEntrada & { filas: FilaSemana[] })[];
  porPersona: Map<string, { presupuesto: number; horas: number; horasVenta: number; tramos: Tarifa[] }>;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fechas de una semana (de inicio a fin, ambos incluidos). */
function fechasDe(inicio: string, fin: string): string[] {
  const out: string[] = [];
  const d = new Date(inicio + "T12:00:00Z");
  const f = new Date(fin + "T12:00:00Z");
  while (d <= f) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Reparte una meta por horas de venta, con los fijos a mano aparte; cuadra al peso. */
function repartirSemana(meta: number, hv: Map<string, number>, fijos: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const totalFijo = [...fijos.values()].reduce((a, v) => a + v, 0);
  for (const [id, v] of fijos) out.set(id, Math.round(v));
  const libres = [...hv].filter(([id]) => !fijos.has(id));
  const horas = libres.reduce((a, [, h]) => a + h, 0);
  const bolsa = Math.max(0, meta - totalFijo);
  for (const [id, h] of libres) out.set(id, horas > 0 ? Math.round((bolsa * h) / horas) : 0);
  // El último peso de redondeo, a quien más horas tiene.
  if (horas > 0 && libres.length) {
    const dif = Math.round(bolsa) - libres.reduce((a, [id]) => a + (out.get(id) ?? 0), 0);
    const mayor = libres.reduce((m, x) => (x[1] > m[1] ? x : m), libres[0]);
    out.set(mayor[0], (out.get(mayor[0]) ?? 0) + dif);
  }
  return out;
}

export function calcularPresupuestoSemanal(e: {
  semanas: SemanaEntrada[];
  personas: PersonaSemanal[];
  /** Días con horario cargado, por persona y fecha. */
  dias: Map<string, Map<string, DiaHoras>>;
  /** Días del mes (para pasar las horas base del mes a horas por día). */
  diasMes: number;
  factores: Factores;
}): ResultadoSemanal {
  const porDia = (p: PersonaSemanal, f: string) => {
    const d = e.dias.get(p.persona_id)?.get(f);
    if (d) {
      const justificada = d.novedad ? NOVEDADES[d.novedad].justificada : true;
      return { prog: d.programadas, real: d.reales, paraReparto: justificada ? d.reales : d.programadas };
    }
    const plan = e.diasMes > 0 ? p.horasPlan / e.diasMes : 0;
    return { prog: plan, real: plan, paraReparto: plan };
  };

  // Horas de venta programadas de cada persona en todo el mes (para la parte semanal de los fijos a mano).
  const factor = new Map(e.personas.map((p) => [p.persona_id, factorDe(p.rol_jerarquico, e.factores)]));
  const hvMesProg = new Map<string, number>();
  for (const s of e.semanas) for (const f of fechasDe(s.inicio, s.fin))
    for (const p of e.personas) hvMesProg.set(p.persona_id, (hvMesProg.get(p.persona_id) ?? 0) + porDia(p, f).prog * factor.get(p.persona_id)!);

  const acumulado = new Map<string, { presupuesto: number; horas: number; horasVenta: number; tramos: Tarifa[] }>();
  const semanas = e.semanas.map((s) => {
    const fechas = fechasDe(s.inicio, s.fin);
    const prog = new Map<string, number>();
    const reparto = new Map<string, number>();
    const horasProg = new Map<string, number>();
    const horasReales = new Map<string, number>();
    for (const p of e.personas) {
      let hp = 0, hr = 0, hvp = 0, hvr = 0;
      for (const f of fechas) {
        const d = porDia(p, f);
        hp += d.prog;
        hr += d.real;
        hvp += d.prog * factor.get(p.persona_id)!;
        hvr += d.paraReparto * factor.get(p.persona_id)!;
      }
      prog.set(p.persona_id, hvp);
      reparto.set(p.persona_id, hvr);
      horasProg.set(p.persona_id, hp);
      horasReales.set(p.persona_id, hr);
    }
    // Fijos a mano: su presupuesto del mes según sus horas programadas de esta semana.
    const fijos = new Map<string, number>();
    for (const p of e.personas) {
      if (p.manual == null) continue;
      const total = hvMesProg.get(p.persona_id) ?? 0;
      fijos.set(p.persona_id, total > 0 ? (p.manual * (prog.get(p.persona_id) ?? 0)) / total : 0);
    }
    const proyectada = repartirSemana(s.meta, prog, fijos);
    const recalculada = repartirSemana(s.meta, reparto, fijos);

    const filas: FilaSemana[] = e.personas.map((p) => {
      const id = p.persona_id;
      const vigente = s.cerrada ? (s.cerrada.get(id) ?? 0) : (proyectada.get(id) ?? 0);
      const hvVigente = s.cerrada ? (reparto.get(id) ?? 0) : (prog.get(id) ?? 0);
      const a = acumulado.get(id) ?? { presupuesto: 0, horas: 0, horasVenta: 0, tramos: [] };
      a.presupuesto += vigente;
      a.horas += s.cerrada ? (horasReales.get(id) ?? 0) : (horasProg.get(id) ?? 0);
      a.horasVenta += hvVigente;
      a.tramos.push({ desde: s.inicio, venta_hora: hvVigente > 0 ? vigente / hvVigente : 0 });
      acumulado.set(id, a);
      return {
        persona_id: id,
        proyectada: proyectada.get(id) ?? 0,
        recalculada: recalculada.get(id) ?? 0,
        vigente,
        horasProgramadas: r2(horasProg.get(id) ?? 0),
        horasReales: r2(horasReales.get(id) ?? 0),
        horasVenta: r2(hvVigente),
      };
    });
    return { ...s, filas };
  });

  for (const a of acumulado.values()) {
    a.horas = r2(a.horas);
    a.horasVenta = r2(a.horasVenta);
  }
  return { semanas, porPersona: acumulado };
}
