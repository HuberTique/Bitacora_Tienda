// Presupuesto manual provisional: cuando termina el mes retail y aún no llega el
// planeador nuevo, la jefatura escribe el presupuesto de la tienda y los precios
// promedio, y de ahí salen las metas. Funciones puras: no tocan la base.
//
//   venta por hora = presupuesto de la tienda ÷ horas trabajadas de todos
//   presupuesto de cada asesor = venta por hora × sus horas
//   meta en unidades = presupuesto × % de la categoría ÷ precio promedio
//
// Jefe de tienda y subjefes no llevan presupuesto (auditan), igual que en el
// planeador.

import { diasEntre, parseYmd, ymd, type SemanaRetail } from "./mes-retail";

export type Mezcla = { calzado: number; accesorios: number; ropa: number };
export type Precios = { calzado: number; accesorios: number; ropa: number | null };

export type FilaHoras = { persona_id: string; horas: number };

export type MetaAsesor = {
  persona_id: string;
  horas: number;
  presupuesto: number;
  pares_meta: number;
  acc_meta: number;
  ropa_meta: number | null;
};

/** Horas trabajadas de un turno: los de tiempo completo incluyen 1 h de almuerzo; el part-time (4 h) no. */
export function horasTrabajadas(horasTurno: number, esPartTime: boolean): number {
  if (horasTurno <= 0) return 0;
  return esPartTime ? horasTurno : Math.max(0, horasTurno - 1);
}

/**
 * Horas trabajadas de un día de Horarios: las del generador son horas de turno
 * (se descuenta el almuerzo); las de GeoVictoria ya vienen netas.
 */
export function horasNetasHorario(h: { horas: number; tipo: string; origen?: string | null }, esPartTime: boolean): number {
  if (h.tipo !== "trabajo") return 0;
  return h.origen === "geovictoria" ? Number(h.horas) : horasTrabajadas(Number(h.horas), esPartTime);
}

/** Por qué una mezcla no sirve; null si está bien. */
export function problemaMezcla(m: Partial<Mezcla>, vendeRopa: boolean): string | null {
  const vals = [m.calzado, m.accesorios, ...(vendeRopa ? [m.ropa] : [])];
  if (vals.some((v) => v == null || !Number.isFinite(v) || v < 0 || v > 100)) {
    return "La mezcla de la tienda no está configurada. Defínela en Personal → Datos de la tienda.";
  }
  const total = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  if (Math.abs(total - 100) > 0.01) return `La mezcla de la tienda suma ${total} % y debe sumar 100 %.`;
  return null;
}

/** Reparte el presupuesto de la tienda entre los asesores según sus horas. */
export function calcularMetas(
  presupuestoTienda: number,
  horas: FilaHoras[],
  mezcla: Mezcla,
  precios: Precios,
  vendeRopa: boolean,
): { ventaPorHora: number; horasTotal: number; filas: MetaAsesor[] } {
  const conHoras = horas.filter((h) => h.horas > 0);
  const horasTotal = conHoras.reduce((a, h) => a + h.horas, 0);
  const ventaPorHora = horasTotal > 0 ? presupuestoTienda / horasTotal : 0;
  const unidades = (pto: number, pct: number, precio: number | null) =>
    precio && precio > 0 ? Math.round((pto * pct) / 100 / precio) : 0;
  const filas = conHoras.map((h) => {
    const presupuesto = Math.round(ventaPorHora * h.horas);
    return {
      persona_id: h.persona_id,
      horas: h.horas,
      presupuesto,
      pares_meta: unidades(presupuesto, mezcla.calzado, precios.calzado),
      acc_meta: unidades(presupuesto, mezcla.accesorios, precios.accesorios),
      ropa_meta: vendeRopa ? unidades(presupuesto, mezcla.ropa, precios.ropa) : null,
    };
  });
  return { ventaPorHora, horasTotal, filas };
}

/**
 * Meta de cada día del mes retail. Si hay un mes anterior con metas por día, se
 * reparte con el mismo peso de cada día de la semana (un sábado pesa más que un
 * martes); si no, en partes iguales. Lo que sobra por redondeo va al último día.
 */
export function metasDiarias(
  presupuestoTienda: number,
  inicio: string,
  fin: string,
  metasAnteriores: { fecha: string; meta: number | null }[] = [],
): { fecha: string; meta: number }[] {
  const dias = diasEntre(inicio, fin);
  if (dias.length === 0) return [];
  const suma = [0, 0, 0, 0, 0, 0, 0];
  const cuenta = [0, 0, 0, 0, 0, 0, 0];
  for (const m of metasAnteriores) {
    if (m.meta == null || m.meta <= 0) continue;
    const wd = parseYmd(m.fecha).getDay();
    suma[wd] += m.meta;
    cuenta[wd] += 1;
  }
  const hayPesos = cuenta.every((c) => c > 0);
  const peso = (wd: number) => (hayPesos ? suma[wd] / cuenta[wd] : 1);
  const totalPeso = dias.reduce((a, d) => a + peso(d.weekday), 0);
  const metas = dias.map((d) => ({ fecha: d.fecha, meta: Math.round((presupuestoTienda * peso(d.weekday)) / totalPeso) }));
  const diferencia = presupuestoTienda - metas.reduce((a, m) => a + m.meta, 0);
  metas[metas.length - 1].meta += diferencia;
  return metas;
}

/** Semanas del mes retail: de domingo a sábado desde el inicio, con su meta. */
export function semanasRetail(inicio: string, fin: string, metas: { fecha: string; meta: number }[]): SemanaRetail[] {
  const semanas: SemanaRetail[] = [];
  const c = parseYmd(inicio);
  const f = parseYmd(fin);
  let numero = 1;
  while (c <= f) {
    const ini = ymd(c);
    const finSemana = new Date(c);
    finSemana.setDate(finSemana.getDate() + (6 - c.getDay())); // hasta el sábado
    const finReal = finSemana > f ? f : finSemana;
    const finIso = ymd(finReal);
    const target = metas.filter((m) => m.fecha >= ini && m.fecha <= finIso).reduce((a, m) => a + m.meta, 0);
    semanas.push({ numero, inicio: ini, fin: finIso, target, anio_anterior: null, real: null });
    numero += 1;
    c.setTime(finReal.getTime());
    c.setDate(c.getDate() + 1);
  }
  return semanas;
}

/** Fechas propuestas para un mes retail nuevo: el día siguiente al fin del anterior y 5 semanas si no hay referencia. */
export function fechasPropuestas(finAnterior: string | null, anio: number, mes: number): { inicio: string; fin: string } {
  let inicio: Date;
  if (finAnterior) {
    inicio = parseYmd(finAnterior);
    inicio.setDate(inicio.getDate() + 1);
  } else {
    // Domingo de la semana en que cae el día 1 del mes.
    inicio = new Date(anio, mes - 1, 1);
    inicio.setDate(inicio.getDate() - inicio.getDay());
  }
  const fin = new Date(inicio);
  // Hasta el sábado de la semana del último día del mes calendario.
  const ultimo = new Date(anio, mes, 0);
  fin.setTime(ultimo.getTime());
  fin.setDate(fin.getDate() + (6 - fin.getDay()));
  if (fin <= inicio) {
    fin.setTime(inicio.getTime());
    fin.setDate(fin.getDate() + 34);
  }
  return { inicio: ymd(inicio), fin: ymd(fin) };
}

/** Diferencia relativa entre un precio y el del mes anterior (0.3 = 30 %), o null. */
export function variacion(actual: number | null, anterior: number | null | undefined): number | null {
  if (!actual || !anterior) return null;
  return Math.abs(actual - anterior) / anterior;
}
