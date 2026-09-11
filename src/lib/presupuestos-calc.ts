// Cálculo de metas y cumplimiento cruzando presupuestos + horarios.
//
// Regla base (heredada del artifact original):
//   meta_dia_asesor = horas_trabajadas_ese_dia × venta_por_hora
//
// Donde:
//   - horas_trabajadas: sale del generador de horarios (celda 9h, 10h, 4h PT)
//     Es horas de TURNO (incluye almuerzo); el artifact usa este valor como
//     aproximación de horas de piso. Si más adelante quieres netear el
//     almuerzo, cámbialo aquí.
//   - venta_por_hora: viene del último upload de KPIS SEM. del mes
//
// La distribución diaria se recalcula on-the-fly cada vez que se abre la
// vista — así, si jefatura edita horarios o sube nuevo Excel, la próxima
// carga refleja el cambio sin necesidad de reprocesar todo.

import type { Horario, Persona, PresupuestoUpload } from "./types";

export type MetaDiaria = {
  persona_id: string;
  fecha: string; // YYYY-MM-DD
  horas: number;
  meta: number;
  tipo: "trabajo" | "descanso" | "libre";
};

export type DistribucionAsesor = {
  persona: Persona;
  diaria: Map<string, MetaDiaria>; // key: YYYY-MM-DD
  metaMes: number;
  horasMes: number;
  diasTrabajo: number;
  diasDescanso: number;
};

/**
 * Cruza horarios del mes + venta/hora del último upload para producir la
 * meta diaria de cada asesor. Devuelve un Map por persona con la
 * distribución detallada.
 */
export function distribuirMetasDiarias(opts: {
  anio: number;
  mes: number;
  personal: Persona[];
  horarios: Horario[];       // filas del mes
  ultimoUpload: PresupuestoUpload | null;
}): Map<string, DistribucionAsesor> {
  const { anio, mes, personal, horarios, ultimoUpload } = opts;
  const ventaPorHora = ultimoUpload?.venta_por_hora ?? 0;
  const result = new Map<string, DistribucionAsesor>();

  // Índice de horarios por persona+día
  const horariosMap = new Map<string, Horario>();
  for (const h of horarios) {
    horariosMap.set(`${h.persona_id}|${h.dia}`, h);
  }

  const diasEnMes = new Date(anio, mes, 0).getDate();

  for (const p of personal) {
    if (!p.activo) continue;
    const diaria = new Map<string, MetaDiaria>();
    let metaMes = 0;
    let horasMes = 0;
    let diasTrabajo = 0;
    let diasDescanso = 0;

    for (let d = 1; d <= diasEnMes; d++) {
      const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const h = horariosMap.get(`${p.id}|${d}`);
      const horas = h?.tipo === "trabajo" ? h.horas : 0;
      const tipo = (h?.tipo ?? "descanso") as MetaDiaria["tipo"];
      const meta = horas * ventaPorHora;
      diaria.set(fecha, {
        persona_id: p.id,
        fecha,
        horas,
        meta,
        tipo,
      });
      metaMes += meta;
      horasMes += horas;
      if (tipo === "trabajo") diasTrabajo++;
      else if (tipo === "descanso") diasDescanso++;
    }

    result.set(p.id, {
      persona: p,
      diaria,
      metaMes,
      horasMes,
      diasTrabajo,
      diasDescanso,
    });
  }
  return result;
}

/**
 * Agrupa metas diarias por semana (Lun-Dom) para una persona. Devuelve
 * arreglo de semanas con inicio, fin, metaSemana, horasSemana.
 */
export function agruparMetasPorSemana(
  dist: DistribucionAsesor,
  anio: number,
  mes: number,
): Array<{
  labelSemana: string;
  inicio: string;
  fin: string;
  metaSemana: number;
  horasSemana: number;
}> {
  const diasEnMes = new Date(anio, mes, 0).getDate();
  const semanas: Array<{
    labelSemana: string;
    inicio: string;
    fin: string;
    metaSemana: number;
    horasSemana: number;
  }> = [];
  let currentSem: { inicio: string; fin: string; meta: number; horas: number } | null = null;

  for (let d = 1; d <= diasEnMes; d++) {
    const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const wday = new Date(anio, mes - 1, d).getDay();
    const md = dist.diaria.get(fecha);
    if (!currentSem) {
      currentSem = { inicio: fecha, fin: fecha, meta: 0, horas: 0 };
    }
    if (md) {
      currentSem.meta += md.meta;
      currentSem.horas += md.horas;
      currentSem.fin = fecha;
    }
    if (wday === 0) {
      semanas.push({
        labelSemana: `Sem ${semanas.length + 1}`,
        inicio: currentSem.inicio,
        fin: currentSem.fin,
        metaSemana: currentSem.meta,
        horasSemana: currentSem.horas,
      });
      currentSem = null;
    }
  }
  if (currentSem) {
    semanas.push({
      labelSemana: `Sem ${semanas.length + 1}`,
      inicio: currentSem.inicio,
      fin: currentSem.fin,
      metaSemana: currentSem.meta,
      horasSemana: currentSem.horas,
    });
  }
  return semanas;
}

export const DIAS_CORTOS = ["D", "L", "M", "X", "J", "V", "S"];
