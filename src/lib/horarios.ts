// Generador automático de horarios — reglas actualizadas por jefatura
// (Sep 2026). Los valores por defecto siguen siendo un punto de partida:
// jefatura ajusta manualmente cuando la operación lo requiere (dinámica
// comercial, DSM, recepción de mercancía, reuniones, universidad de PTs).
//
// FULL-TIME / CAJEROS / JEFE / SUBJEFE: 42h/semana trabajadas, 5 días de
// trabajo y 2 de descanso. Las celdas MUESTRAN horas de turno (9h y 10h
// que incluyen 1h de almuerzo, no horas efectivas de trabajo) porque es
// lo que jefatura necesita ver para asignar horarios de piso.
//   - Patrón semanal: 2 días de 10h de turno + 3 días de 9h de turno.
//   - JEFE / SUBJEFE: 8 días de descanso al mes (2/semana). Regla mensual:
//     1 fin de semana completo pegado (sábado + domingo) + 1 domingo adicional
//     suelto. NUNCA pegar el lunes al fin de semana libre (no 3 días seguidos).
//   - CAJEROS / FT: 2 domingos de descanso al mes. Por default no pegan
//     sábado libre; jefatura puede pegarlo si la operación lo permite.
//   - FT: por default no pegan domingo con lunes; jefatura puede pegarlo
//     si la operación lo permite.
//
// PART-TIME: 6 días/semana × 4h = 24h. Prioriza fin de semana (cierre y
// mayor carga comercial). Respeta la disponibilidad individual (días
// bloqueados por universidad/estudios) configurada en `disponibilidad_pt`.
// Excepción para PTs con horario universitario: los días bloqueados se
// leen de esa configuración (proximamente vía IA que lee el horario oficial).
//
// Todos respetan:
//   - Días libres solicitados en Requerimientos (tipo "dia_libre") — pendiente
//     mientras se implementa ese módulo, hoy va vacío.
//   - Días bloqueados por jefatura (dias_bloqueados) — feriados, inventarios,
//     capacitaciones colectivas.

import type { Persona } from "./types";

// ---------- Tipos ----------

export type DiaCalendario = { dia: number; weekday: number };
export type CeldaHorario = { horas: number; tipo: "trabajo" | "descanso" | "libre" };
export type GridHorario = {
  [personaId: string]: {
    dias: { [dia: number]: CeldaHorario };
    total: number;
  };
};
export type ResultadoGenerador = {
  dias: DiaCalendario[];
  grid: GridHorario;
};

export type DisponibilidadPT = {
  persona_id: string;
  dias_bloqueados: number[]; // 0=domingo, 6=sábado
};

export type DiaBloqueado = {
  fecha: string; // YYYY-MM-DD
  motivo: string;
};

export type RequerimientoDiaLibre = {
  persona_id: string;
  fecha: string; // YYYY-MM-DD
};

// ---------- Helpers puros ----------

export function esCargoPartTime(cargo: string | null | undefined): boolean {
  const c = (cargo || "").toUpperCase();
  return c.includes("PART-TIME") || c.includes("PART TIME");
}

export function esCargoJefeOSubjefe(cargo: string | null | undefined): boolean {
  return (cargo || "").toUpperCase().includes("JEFE");
}

export function diasDelMes(anio: number, mes: number): DiaCalendario[] {
  const n = new Date(anio, mes, 0).getDate();
  const arr: DiaCalendario[] = [];
  for (let d = 1; d <= n; d++) {
    arr.push({ dia: d, weekday: new Date(anio, mes - 1, d).getDay() });
  }
  return arr;
}

function agruparPorSemana(dias: DiaCalendario[]): number[][] {
  const semanas: number[][] = [];
  let actual: number[] = [];
  dias.forEach(({ dia, weekday }) => {
    actual.push(dia);
    if (weekday === 0) {
      semanas.push(actual);
      actual = [];
    }
  });
  if (actual.length) semanas.push(actual);
  return semanas;
}

/**
 * Reparte 2 días de 10h + 3 días de 9h de turno por semana completa (horas
 * incluyen 1h de almuerzo cada una → 42h efectivas de trabajo). Para semanas
 * parciales (inicio/fin de mes) escala proporcionalmente 2:3.
 */
function patronHorasFT(numTrabajo: number): number[] {
  if (numTrabajo <= 0) return [];
  const num10h = Math.round((numTrabajo * 2) / 5);
  const num9h = numTrabajo - num10h;
  return [...Array(num9h).fill(9), ...Array(num10h).fill(10)];
}

/**
 * Elige los 2 domingos de descanso del mes para una persona FT. Jefes/subjefes:
 * uno de esos domingos va pegado a su sábado anterior. Cajeros y demás FT:
 * los 2 domingos NUNCA van pegados a un sábado libre.
 */
function elegirDomingosDescanso(
  domingos: number[],
  idxFT: number,
  esJefeOSubjefe: boolean,
): { domUnicos: number[]; sabadoPegado: number | null } {
  const misDomingos: number[] = [];
  if (domingos.length > 0) misDomingos.push(domingos[idxFT % domingos.length]);
  if (domingos.length > 1) misDomingos.push(domingos[(idxFT + 2) % domingos.length]);
  const domUnicos = [...new Set(misDomingos)];
  let sabadoPegado: number | null = null;
  if (esJefeOSubjefe && domUnicos.length > 0) {
    const candidato = domUnicos[0] - 1;
    if (candidato >= 1) sabadoPegado = candidato;
  }
  return { domUnicos, sabadoPegado };
}

// ---------- Generador ----------

export type OpcionesGenerador = {
  personal: Persona[];             // roster activo
  disponibilidadPT: DisponibilidadPT[];
  diasBloqueados: DiaBloqueado[];   // días bloqueados por jefatura (feriados, etc.)
  requerimientosLibre: RequerimientoDiaLibre[]; // días libres solicitados por asesores para este mes
};

export function generarHorarioAutomatico(
  anio: number,
  mes: number,
  opts: OpcionesGenerador,
): ResultadoGenerador {
  const dias = diasDelMes(anio, mes);
  const semanas = agruparPorSemana(dias);
  const domingosDelMes = dias.filter((d) => d.weekday === 0).map((d) => d.dia);
  const grid: GridHorario = {};
  let idxFT = 0;
  let idxPT = 0;

  // Días libres solicitados por persona para este mes
  const prefijoMes = `${anio}-${String(mes).padStart(2, "0")}-`;
  const librePorPersona = new Map<string, Set<number>>();
  opts.requerimientosLibre.forEach((r) => {
    if (!r.fecha.startsWith(prefijoMes)) return;
    const dia = parseInt(r.fecha.split("-")[2], 10);
    if (!librePorPersona.has(r.persona_id)) librePorPersona.set(r.persona_id, new Set());
    librePorPersona.get(r.persona_id)!.add(dia);
  });

  // Días bloqueados por jefatura → aplican a todos
  const bloqueadosTienda = new Set<number>();
  opts.diasBloqueados.forEach((b) => {
    if (b.fecha.startsWith(prefijoMes)) {
      bloqueadosTienda.add(parseInt(b.fecha.split("-")[2], 10));
    }
  });

  // Índice rápido de disponibilidad PT
  const disponibilidadMap = new Map<string, number[]>();
  opts.disponibilidadPT.forEach((d) => disponibilidadMap.set(d.persona_id, d.dias_bloqueados));

  for (const p of opts.personal) {
    const dayMap: { [dia: number]: CeldaHorario } = {};
    const diasLibreForzados = librePorPersona.get(p.id) ?? new Set<number>();

    if (!esCargoPartTime(p.cargo)) {
      // ===== FT / CAJEROS / JEFE / SUBJEFE =====
      const esJefeOSubjefe = esCargoJefeOSubjefe(p.cargo);
      const { domUnicos, sabadoPegado } = elegirDomingosDescanso(
        domingosDelMes,
        idxFT,
        esJefeOSubjefe,
      );

      semanas.forEach((semDias, si) => {
        const forzadosLibre = semDias.filter((d) => diasLibreForzados.has(d));
        const forzadosBloqueoTienda = semDias.filter((d) => bloqueadosTienda.has(d));
        const forzadosDomingo = semDias.filter((d) => domUnicos.includes(d));
        const forzadosSabado = semDias.filter((d) => d === sabadoPegado);
        const yaForzados = [
          ...new Set([
            ...forzadosLibre,
            ...forzadosBloqueoTienda,
            ...forzadosDomingo,
            ...forzadosSabado,
          ]),
        ];
        const domingoSuelto = forzadosDomingo.length > 0 && forzadosSabado.length === 0;

        // Relleno solo entre L-V; sábado y domingo controlados por la regla mensual
        const restantes = semDias.filter(
          (d) =>
            !yaForzados.includes(d) &&
            ![0, 6].includes(new Date(anio, mes - 1, d).getDay()),
        );
        const descansosNecesarios = Math.max(
          0,
          Math.min(2, Math.round((semDias.length * 2) / 7)) - yaForzados.length,
        );

        const elegidosDescanso: number[] = [];
        if (descansosNecesarios > 0 && restantes.length > 0) {
          const offset = (idxFT + si) % restantes.length;
          const ordenRotado = [...restantes.slice(offset), ...restantes.slice(0, offset)];
          for (const d of ordenRotado) {
            if (elegidosDescanso.length >= descansosNecesarios) break;
            const esSabado = new Date(anio, mes - 1, d).getDay() === 6;
            if (domingoSuelto && esSabado) continue;
            const esLunesTrasLibre =
              new Date(anio, mes - 1, d).getDay() === 1 &&
              (forzadosLibre.includes(d - 1) ||
                forzadosDomingo.includes(d - 1) ||
                elegidosDescanso.includes(d - 1));
            if (esLunesTrasLibre) continue;
            elegidosDescanso.push(d);
          }
          if (elegidosDescanso.length < descansosNecesarios) {
            for (const d of ordenRotado) {
              if (elegidosDescanso.length >= descansosNecesarios) break;
              if (!elegidosDescanso.includes(d)) elegidosDescanso.push(d);
            }
          }
        }

        const diasDescanso = [...yaForzados, ...elegidosDescanso];
        const diasTrabajo = semDias.filter((d) => !diasDescanso.includes(d));
        const patronHoras = patronHorasFT(diasTrabajo.length);
        const offsetPatron = patronHoras.length ? idxFT % patronHoras.length : 0;
        const patronRotado = [
          ...patronHoras.slice(offsetPatron),
          ...patronHoras.slice(0, offsetPatron),
        ];
        diasTrabajo.forEach((d, i) => {
          dayMap[d] = { horas: patronRotado[i], tipo: "trabajo" };
        });
        diasDescanso.forEach((d) => {
          const esLibreSolicitado = forzadosLibre.includes(d);
          dayMap[d] = { horas: 0, tipo: esLibreSolicitado ? "libre" : "descanso" };
        });
      });
      idxFT++;
    } else {
      // ===== PART-TIME =====
      // Objetivo: 6 días × 4h = 24h/semana, priorizando fin de semana (cierre
      // y mayor carga comercial). Respeta días bloqueados por estudios y
      // días bloqueados por jefatura. Si un día tiene bloqueo, se salta y
      // no se compensa (el asesor termina con menos horas esa semana).
      const HORAS_PT = 4;
      const DIAS_OBJETIVO = 6;
      const bloqueadosPersona = disponibilidadMap.get(p.id) ?? [];
      semanas.forEach((semDias) => {
        const forzadosLibre = new Set(semDias.filter((d) => diasLibreForzados.has(d)));
        const forzadosBloqueoTienda = new Set(
          semDias.filter((d) => bloqueadosTienda.has(d)),
        );
        const disponibles = semDias.filter(
          (d) =>
            !forzadosLibre.has(d) &&
            !forzadosBloqueoTienda.has(d) &&
            !bloqueadosPersona.includes(new Date(anio, mes - 1, d).getDay()),
        );
        // Fines de semana primero (prioridad), luego llenar hasta 6 con L-V
        const finde = disponibles.filter((d) => {
          const w = new Date(anio, mes - 1, d).getDay();
          return w === 0 || w === 6;
        });
        const entreSemana = disponibles.filter((d) => !finde.includes(d));
        const trabaja = new Set<number>();
        finde.forEach((d) => trabaja.add(d));
        for (const d of entreSemana) {
          if (trabaja.size >= DIAS_OBJETIVO) break;
          trabaja.add(d);
        }

        semDias.forEach((d) => {
          if (forzadosLibre.has(d)) {
            dayMap[d] = { horas: 0, tipo: "libre" };
          } else if (trabaja.has(d)) {
            dayMap[d] = { horas: HORAS_PT, tipo: "trabajo" };
          } else {
            dayMap[d] = { horas: 0, tipo: "descanso" };
          }
        });
      });
      idxPT++;
    }

    const total = Object.values(dayMap).reduce((s, d) => s + d.horas, 0);
    grid[p.id] = { dias: dayMap, total };
  }

  return { dias, grid };
}

// ---------- Helpers de display ----------

export const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const DIAS_SEMANA_CORTO = ["D", "L", "M", "X", "J", "V", "S"];
