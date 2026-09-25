// Cálculo de metas y cumplimiento cruzando presupuestos + horarios + venta real.
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
// La venta REAL de cada día (cuando jefatura ya registró el cierre vía PDF
// en `ventas_asesor_dia`) se cruza aquí para poder mostrar cumplimiento
// (venta/meta), no solo la meta. Un día sin venta registrada queda con
// venta=null — se distingue de "vendió $0" (motivo_no_venta explica el $0).
//
// La distribución diaria se recalcula on-the-fly cada vez que se abre la
// vista — así, si jefatura edita horarios, sube nuevo Excel o registra un
// cierre de día, la próxima carga refleja el cambio sin reprocesar nada.

import { construirPeriodo, type Periodo } from "./mes-retail";
import type { Horario, Persona, PresupuestoUpload, VentaAsesorDia } from "./types";

export type MetaDiaria = {
  persona_id: string;
  fecha: string; // YYYY-MM-DD
  horas: number;
  meta: number;
  tipo: "trabajo" | "descanso" | "libre";
  /** Venta real del día. null = todavía no se registró el cierre de ese día. */
  venta: number | null;
  /** venta/meta. null si no hay meta (no trabajó) o no hay venta registrada. */
  cumplimiento: number | null;
};

export type DistribucionAsesor = {
  persona: Persona;
  diaria: Map<string, MetaDiaria>; // key: YYYY-MM-DD
  metaMes: number;
  horasMes: number;
  diasTrabajo: number;
  diasDescanso: number;
  /** Suma de venta en los días que YA tienen cierre registrado. */
  ventaMes: number;
  /** Suma de meta solo de los días con venta registrada — así el % no se
   *  ve artificialmente bajo a inicio de mes (compara venta vs meta de lo
   *  que ya transcurrió, no contra el mes completo). */
  metaConVenta: number;
  /** ventaMes / metaConVenta. null si aún no hay ningún día cerrado. */
  cumplimientoMes: number | null;
  diasConVenta: number;
};

/**
 * Cruza horarios + venta/hora del último upload + ventas reales por día
 * para producir la meta y el cumplimiento diario de cada asesor.
 */
export function distribuirMetasDiarias(opts: {
  anio: number;
  mes: number;
  personal: Persona[];
  horarios: Horario[];       // filas de los meses calendario que toca el periodo
  ultimoUpload: PresupuestoUpload | null;
  ventas?: VentaAsesorDia[]; // filas del periodo (opcional — sin esto, venta queda null)
  /** Mes retail: rango de fechas propio de la compañía. Sin él se usa el mes calendario. */
  periodo?: Periodo;
}): Map<string, DistribucionAsesor> {
  const { anio, mes, personal, horarios, ultimoUpload, ventas = [], periodo } = opts;
  const ventaPorHora = ultimoUpload?.venta_por_hora ?? 0;
  const result = new Map<string, DistribucionAsesor>();

  // Los horarios se guardan por mes calendario; se indexan por fecha completa
  // para que un mes retail (que cruza dos meses) encuentre cada día.
  const horariosMap = new Map<string, Horario>();
  for (const h of horarios) {
    horariosMap.set(
      `${h.persona_id}|${h.anio}-${String(h.mes).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`,
      h,
    );
  }
  const ventasMap = new Map<string, VentaAsesorDia>();
  for (const v of ventas) {
    ventasMap.set(`${v.persona_id}|${v.fecha}`, v);
  }

  const fechasPeriodo = (periodo ?? construirPeriodo(anio, mes)).fechas;

  for (const p of personal) {
    if (!p.activo) continue;
    const diaria = new Map<string, MetaDiaria>();
    let metaMes = 0;
    let horasMes = 0;
    let diasTrabajo = 0;
    let diasDescanso = 0;
    let ventaMes = 0;
    let metaConVenta = 0;
    let diasConVenta = 0;

    for (const { fecha } of fechasPeriodo) {
      const h = horariosMap.get(`${p.id}|${fecha}`);
      const horas = h?.tipo === "trabajo" ? h.horas : 0;
      const tipo = (h?.tipo ?? "descanso") as MetaDiaria["tipo"];
      const meta = horas * ventaPorHora;

      const registroVenta = ventasMap.get(`${p.id}|${fecha}`);
      const venta = registroVenta?.venta ?? null;
      const cumplimiento = venta != null && meta > 0 ? venta / meta : null;

      diaria.set(fecha, { persona_id: p.id, fecha, horas, meta, tipo, venta, cumplimiento });
      metaMes += meta;
      horasMes += horas;
      if (tipo === "trabajo") diasTrabajo++;
      else if (tipo === "descanso") diasDescanso++;

      if (venta != null) {
        ventaMes += venta;
        metaConVenta += meta;
        diasConVenta++;
      }
    }

    result.set(p.id, {
      persona: p,
      diaria,
      metaMes,
      horasMes,
      diasTrabajo,
      diasDescanso,
      ventaMes,
      metaConVenta,
      cumplimientoMes: metaConVenta > 0 ? ventaMes / metaConVenta : null,
      diasConVenta,
    });
  }
  return result;
}

/**
 * Ranking de asesores por cumplimiento del mes (venta/meta acumulada hasta
 * el último día cerrado). Los sin dato quedan al final.
 */
export function rankingCumplimiento(
  distribuciones: DistribucionAsesor[],
): DistribucionAsesor[] {
  return [...distribuciones].sort((a, b) => {
    if (a.cumplimientoMes == null && b.cumplimientoMes == null) return 0;
    if (a.cumplimientoMes == null) return 1;
    if (b.cumplimientoMes == null) return -1;
    return b.cumplimientoMes - a.cumplimientoMes;
  });
}

export type SemanaResumen = {
  labelSemana: string;
  inicio: string;
  fin: string;
  metaSemana: number;
  horasSemana: number;
  /** Suma de venta de los días de la semana que ya tienen cierre registrado. */
  ventaSemana: number;
  /** Suma de meta solo de los días con venta (para % consistente con metaConVenta). */
  metaConVentaSemana: number;
  /** ventaSemana / metaConVentaSemana. null si ningún día de la semana cerró aún. */
  cumplimientoSemana: number | null;
};

/**
 * Agrupa metas diarias por semana (Lun-Dom) para una persona, incluyendo
 * venta real y cumplimiento cuando hay cierres registrados.
 */
export function agruparMetasPorSemana(
  dist: DistribucionAsesor,
  anio: number,
  mes: number,
  periodo?: Periodo,
): SemanaResumen[] {
  const fechas = (periodo ?? construirPeriodo(anio, mes)).fechas;
  // Semana retail: de domingo a sábado. Mes calendario: de lunes a domingo.
  const diaCierre = periodo?.esRetail ? 6 : 0;
  const semanas: SemanaResumen[] = [];
  let acc: {
    inicio: string;
    fin: string;
    meta: number;
    horas: number;
    venta: number;
    metaConVenta: number;
  } | null = null;

  const cerrar = () => {
    if (!acc) return;
    semanas.push({
      labelSemana: `Sem ${semanas.length + 1}`,
      inicio: acc.inicio,
      fin: acc.fin,
      metaSemana: acc.meta,
      horasSemana: acc.horas,
      ventaSemana: acc.venta,
      metaConVentaSemana: acc.metaConVenta,
      cumplimientoSemana: acc.metaConVenta > 0 ? acc.venta / acc.metaConVenta : null,
    });
    acc = null;
  };

  for (const { fecha, weekday: wday } of fechas) {
    const md = dist.diaria.get(fecha);
    if (!acc) acc = { inicio: fecha, fin: fecha, meta: 0, horas: 0, venta: 0, metaConVenta: 0 };
    if (md) {
      acc.meta += md.meta;
      acc.horas += md.horas;
      acc.fin = fecha;
      if (md.venta != null) {
        acc.venta += md.venta;
        acc.metaConVenta += md.meta;
      }
    }
    if (wday === diaCierre) cerrar();
  }
  cerrar();
  return semanas;
}

export const DIAS_CORTOS = ["D", "L", "M", "X", "J", "V", "S"];
