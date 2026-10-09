// Resultados y proyección por día, semana y mes (Huber, 8-oct-2026).
//
// - Pesos: de los cierres del día (sirven para cualquier rango).
// - Pares, accesorios, ropa (consolidada) y TRX/UPT (Xstore) llegan ACUMULADOS hasta una fecha de
//   corte; se guarda cada carga como corte (tabla cortes_kpis). Lo de un periodo = el último corte
//   del periodo − el último corte de antes de que empiece (el primer periodo del mes parte de 0).
// - La meta del periodo es la meta del mes de cada persona × la parte de la meta de la tienda que
//   cae en esos días; la proyección = lo logrado ÷ la parte de la meta que ya transcurrió.

export type FuenteCorte = "consolidada" | "xstore";

export type Corte = {
  fuente: FuenteCorte;
  corte: string;
  persona_id: string;
  pares: number | null;
  acc: number | null;
  ropa: number | null;
  unidades: number | null;
  trx: number | null;
  upt: number | null;
};

export type Delta = { pares: number; acc: number; ropa: number; unidades: number; trx: number; articulosXstore: number };

export type ResultadoCortes =
  | { estado: "ok"; desde: string | null; hasta: string; porPersona: Map<string, Delta> }
  | { estado: "sin_datos" }
  | { estado: "falta_inicio"; necesita: string; hasta: string };

const dia = (f: string, n: number) => {
  const d = new Date(f + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** El último corte de una fuente en [desde, hasta] (desde opcional). */
export function ultimoCorte(cortes: Corte[], fuente: FuenteCorte, hasta: string, desde?: string): string | null {
  let mejor: string | null = null;
  for (const c of cortes)
    if (c.fuente === fuente && c.corte <= hasta && (!desde || c.corte >= desde) && (!mejor || c.corte > mejor)) mejor = c.corte;
  return mejor;
}

const vacio = (): Delta => ({ pares: 0, acc: 0, ropa: 0, unidades: 0, trx: 0, articulosXstore: 0 });

function foto(cortes: Corte[], fuente: FuenteCorte, corte: string | null): Map<string, Delta> {
  const m = new Map<string, Delta>();
  if (!corte) return m;
  for (const c of cortes) {
    if (c.fuente !== fuente || c.corte !== corte) continue;
    m.set(c.persona_id, {
      pares: Number(c.pares ?? 0),
      acc: Number(c.acc ?? 0),
      ropa: Number(c.ropa ?? 0),
      unidades: Number(c.unidades ?? (c.pares ?? 0) + (c.acc ?? 0) + (c.ropa ?? 0)),
      trx: Number(c.trx ?? 0),
      // Xstore da el UPT (artículos ÷ transacciones): los artículos son UPT × TRX.
      articulosXstore: Number(c.upt ?? 0) * Number(c.trx ?? 0),
    });
  }
  return m;
}

/**
 * Lo de una fuente en el periodo [inicio, fin]. Si el periodo no empieza el primer día del mes
 * hace falta un corte de ANTES de que empiece; si no lo hay, no se inventa.
 */
export function deltaPeriodo(cortes: Corte[], fuente: FuenteCorte, inicio: string, fin: string, inicioMes: string): ResultadoCortes {
  const hasta = ultimoCorte(cortes, fuente, fin, inicio);
  if (!hasta) return { estado: "sin_datos" };
  const desde = inicio <= inicioMes ? null : ultimoCorte(cortes, fuente, dia(inicio, -1));
  if (inicio > inicioMes && !desde) return { estado: "falta_inicio", necesita: dia(inicio, -1), hasta };
  const a = foto(cortes, fuente, hasta);
  const b = foto(cortes, fuente, desde);
  const porPersona = new Map<string, Delta>();
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) ?? vacio();
    const y = b.get(id) ?? vacio();
    porPersona.set(id, {
      pares: x.pares - y.pares,
      acc: x.acc - y.acc,
      ropa: x.ropa - y.ropa,
      unidades: x.unidades - y.unidades,
      trx: x.trx - y.trx,
      articulosXstore: x.articulosXstore - y.articulosXstore,
    });
  }
  return { estado: "ok", desde, hasta, porPersona };
}

type MetaDia = { fecha: string; meta: number | null };
const sumaMeta = (m: MetaDia[], desde: string, hasta: string) =>
  m.filter((d) => d.fecha >= desde && d.fecha <= hasta).reduce((a, d) => a + Number(d.meta ?? 0), 0);

/** Qué parte de la meta del MES cae en el periodo (0..1). Sin metas por día, por número de días. */
export function partePeriodo(metas: MetaDia[], inicio: string, fin: string, inicioMes: string, finMes: string): number {
  const total = sumaMeta(metas, inicioMes, finMes);
  if (total > 0) return sumaMeta(metas, inicio, fin) / total;
  const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
  return dias(inicio, fin) / dias(inicioMes, finMes);
}

/** Qué parte de la meta del PERIODO ya transcurrió a una fecha (0..1). */
export function avancePeriodo(metas: MetaDia[], inicio: string, fin: string, a: string | null): number | null {
  if (!a || a < inicio) return null;
  if (a >= fin) return 1;
  const total = sumaMeta(metas, inicio, fin);
  if (total > 0) return sumaMeta(metas, inicio, a) / total;
  const dias = (x: string, y: string) => Math.round((Date.parse(y) - Date.parse(x)) / 86_400_000) + 1;
  return dias(inicio, a) / dias(inicio, fin);
}

/**
 * La semana retail va de domingo a sábado: para medirla, el informe acumulado debe llegar hasta
 * un SÁBADO (o hasta el último día del mes). Se puede subir el sábado o el domingo; lo que cuenta
 * es la fecha final del informe. Devuelve el aviso o null si está bien.
 */
export function avisoCorteSemana(hasta: string, finMes: string): string | null {
  if (hasta === finMes) return null;
  const d = new Date(hasta + "T12:00:00");
  if (d.getDay() === 6) return null;
  const nombre = d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "short" });
  return `El informe llega hasta el ${nombre}. La semana retail va de domingo a sábado: para medir la semana, sácalo con fecha final del sábado (puedes subirlo el sábado o el domingo). Igual se guarda, pero esa semana quedará partida.`;
}

/** Al ritmo actual: lo logrado ÷ la parte transcurrida. null si no hay con qué proyectar. */
export function proyectar(logrado: number | null, avance: number | null): number | null {
  if (logrado == null || avance == null || avance <= 0) return null;
  return logrado / avance;
}
