// Cálculo de metas y cumplimiento cruzando presupuestos + horarios + venta real.
//
// Regla (Huber, 3-oct-2026): la meta del día sale del presupuesto del mes de
// la persona (el del cuadro, ya repartido por horas de venta) dividido entre
// los días que trabaja, en proporción a las horas de cada día:
//
//   meta_dia = presupuesto_mes × horas_ese_dia ÷ horas_del_mes_en_el_horario
//
// Así la suma de los días siempre cuadra con el cuadro. Si la persona no tiene
// horario cargado, su meta del mes se conoce pero no se reparte por día
// (`sinHorario`): la pantalla avisa, no inventa días.
//
// Desde los horarios de GeoVictoria (4-oct-2026) el reparto se recalcula con
// cada semana subida y la venta por hora de cada persona queda guardada con la
// fecha desde la que rige. Cuando se conoce (tramos guardados, o el presupuesto
// y las horas de venta del mes):
//
//   meta_dia = venta por hora vigente ese día × horas de venta del día
//
// (horas sin almuerzo × el factor del cargo). Así los días ya pasados no cambian
// cuando se recalcula, y una semana subida proyecta su meta sin tener el mes
// completo. Sin esa información se usa la regla de arriba.
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
import { horasNetasHorario } from "./presupuesto-manual";
import { factorDe, ventaHoraVigente, type Factores, type Tarifa } from "./reparto";
import type { Horario, Persona, VentaAsesorDia } from "./types";

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
  /** Presupuesto del mes de la persona (el del cuadro). */
  metaMes: number;
  /** Tiene presupuesto pero no horario en el periodo: no se puede repartir por día. */
  sinHorario: boolean;
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
 * Cruza el presupuesto del mes de cada persona + sus horarios + ventas reales
 * por día para producir la meta y el cumplimiento diario de cada asesor.
 */
export function distribuirMetasDiarias(opts: {
  anio: number;
  mes: number;
  personal: Persona[];
  horarios: Horario[];       // filas de los meses calendario que toca el periodo
  /** Presupuesto del mes por persona (kpis_mensuales.presupuesto). */
  presupuestos: Map<string, number>;
  ventas?: VentaAsesorDia[]; // filas del periodo (opcional — sin esto, venta queda null)
  /** Mes retail: rango de fechas propio de la compañía. Sin él se usa el mes calendario. */
  periodo?: Periodo;
  /** Venta por hora guardada por persona, con la fecha desde la que rige. */
  tarifas?: Map<string, Tarifa[]>;
  /** Horas de venta del mes por persona (kpis_mensuales.horas_venta). */
  horasVenta?: Map<string, number>;
  /** Factores de horas de venta de la tienda (jefe ¼, subjefe ⅓, cajero ½). */
  factores?: Factores;
}): Map<string, DistribucionAsesor> {
  const { anio, mes, personal, horarios, presupuestos, ventas = [], periodo, tarifas, horasVenta, factores } = opts;
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
    const presupuesto = presupuestos.get(p.id) ?? 0;
    // Horas de turno de la persona en todo el periodo: base del reparto.
    let horasPeriodo = 0;
    for (const { fecha } of fechasPeriodo) {
      const h = horariosMap.get(`${p.id}|${fecha}`);
      if (h?.tipo === "trabajo") horasPeriodo += h.horas;
    }
    const ventaPorHora = horasPeriodo > 0 ? presupuesto / horasPeriodo : 0;
    // Venta por hora conocida: tramos guardados o presupuesto ÷ horas de venta del mes.
    const tramos = tarifas?.get(p.id) ?? [];
    const hvMes = horasVenta?.get(p.id) ?? 0;
    const tarifaMes = hvMes > 0 ? presupuesto / hvMes : null;
    const porTarifa = !!factores && (tramos.length > 0 || tarifaMes != null);
    const factor = factores ? factorDe(p.rol_jerarquico, factores) : 1;

    const diaria = new Map<string, MetaDiaria>();
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
      const meta = porTarifa
        ? (h ? horasNetasHorario(h, p.rol_jerarquico === "part_time") : 0) * factor * (ventaHoraVigente(tramos, fecha) ?? tarifaMes ?? 0)
        : horas * ventaPorHora;

      const registroVenta = ventasMap.get(`${p.id}|${fecha}`);
      const venta = registroVenta?.venta ?? null;
      const cumplimiento = venta != null && meta > 0 ? venta / meta : null;

      diaria.set(fecha, { persona_id: p.id, fecha, horas, meta, tipo, venta, cumplimiento });
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
      metaMes: presupuesto,
      sinHorario: presupuesto > 0 && horasPeriodo === 0,
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

/**
 * Parte los días del periodo en semanas: retail de domingo a sábado,
 * calendario de lunes a domingo (igual que agruparMetasPorSemana).
 */
export function semanasDelPeriodo(periodo: Periodo): Periodo["fechas"][] {
  const diaCierre = periodo.esRetail ? 6 : 0;
  const semanas: Periodo["fechas"][] = [];
  let actual: Periodo["fechas"] = [];
  for (const d of periodo.fechas) {
    actual.push(d);
    if (d.weekday === diaCierre) {
      semanas.push(actual);
      actual = [];
    }
  }
  if (actual.length) semanas.push(actual);
  return semanas;
}

export const DIAS_CORTOS = ["D", "L", "M", "X", "J", "V", "S"];
