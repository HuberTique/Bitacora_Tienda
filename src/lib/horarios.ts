// Generador automático de horarios — port directo de la lógica del artifact
// original, validada con datos reales de la tienda.
//
// Reglas resumidas:
//  - FULL-TIME / CAJEROS / JEFE / SUBJEFE: 42h/semana, 5 días de trabajo (3 de
//    8h + 2 de 9h) y 2 de descanso. Descansan 2 domingos al mes.
//    - JEFE / SUBJEFE: uno de esos domingos va pegado al sábado anterior
//      (fin de semana completo libre).
//    - FT / CAJEROS: nunca pegan un sábado libre a un domingo libre.
//  - PART-TIME: 25h/semana fijas (tope), énfasis en 8-9h fin de semana, resto
//    en bloques de 4-5h entre semana. Respeta la disponibilidad individual
//    (días bloqueados por estudio) configurada en `disponibilidad_pt`.
//  - Todos respetan los días libres solicitados en `requerimientos` (tipo
//    "dia_libre") para el mes.
//  - Días bloqueados por jefatura (dias_bloqueados) también fuerzan descanso.

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

/** Reparte 3 días de 8h + 2 días de 9h por semana completa, o escala proporcionalmente. */
function patronHorasFT(numTrabajo: number): number[] {
  if (numTrabajo <= 0) return [];
  const num9h = Math.round((numTrabajo * 2) / 5);
  const num8h = numTrabajo - num9h;
  return [...Array(num8h).fill(8), ...Array(num9h).fill(9)];
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
      const bloqueadosPersona = disponibilidadMap.get(p.id) ?? [];
      semanas.forEach((semDias, si) => {
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
        const finde = disponibles.filter((d) => {
          const w = new Date(anio, mes - 1, d).getDay();
          return w === 0 || w === 6;
        });
        const entreSemana = disponibles.filter((d) => !finde.includes(d));
        const TOPE = 25;
        let total = 0;
        const asignados: { [dia: number]: number } = {};

        finde.forEach((d, i) => {
          if (total >= TOPE) return;
          const horas = Math.min((i + idxPT) % 2 === 0 ? 9 : 8, TOPE - total);
          if (horas > 0) {
            asignados[d] = horas;
            total += horas;
          }
        });
        let wi = entreSemana.length ? idxPT % entreSemana.length : 0;
        let guard = 0;
        while (total < TOPE && entreSemana.length > 0 && guard < entreSemana.length * 3) {
          const d = entreSemana[wi % entreSemana.length];
          if (!(d in asignados)) {
            const horas = Math.min(guard % 2 === 0 ? 5 : 4, TOPE - total);
            if (horas > 0) {
              asignados[d] = horas;
              total += horas;
            }
          }
          wi++;
          guard++;
        }

        semDias.forEach((d) => {
          if (forzadosLibre.has(d)) {
            dayMap[d] = { horas: 0, tipo: "libre" };
          } else if (
            forzadosBloqueoTienda.has(d) ||
            bloqueadosPersona.includes(new Date(anio, mes - 1, d).getDay())
          ) {
            dayMap[d] = { horas: 0, tipo: "descanso" };
          } else if (d in asignados) {
            dayMap[d] = { horas: asignados[d], tipo: "trabajo" };
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
