// Tipos y cálculo del "Ranking de ventas": combina KPIs de venta, UPT, Magia
// con una sonrisa, puntualidad/llamados de atención y checklist del maximizador.

import type { RolJerarquico } from "./types";

/** Datos mínimos de una persona para el ranking (vienen de roster_publico). */
export type PersonaRk = {
  id: string;
  nombre: string;
  cargo: string;
  rol_jerarquico: RolJerarquico;
  foto_path: string | null;
};

// ---------- Tipos de tablas ----------

export type KpiMensual = {
  id: string;
  persona_id: string;
  anio: number;
  mes: number;
  presupuesto: number | null;
  acumulado_bruto: number | null;
  acumulado_neto: number | null;
  cumplimiento: number | null;
  pares_meta: number | null;
  pares_venta: number | null;
  acc_meta: number | null;
  acc_venta: number | null;
  ropa_meta: number | null;
  ropa_venta: number | null;
  unidades: number | null;
  trx: number | null;
  upt: number | null;
  horas: number | null;
  corte_ventas: string | null; // fecha hasta la que llegan las ventas cargadas (ventas consolidadas)
  /** Horas base del mes (planeador) con las que se reparte el presupuesto en los días sin horario. */
  horas_plan?: number | null;
  /** La jefatura fijó a mano su presupuesto: el resto se reparte entre los demás. */
  presupuesto_manual?: boolean;
};

export type MagiaEvaluacion = {
  id: string;
  persona_id: string;
  evaluador_id: string | null;
  anio: number;
  mes: number;
  numero: 1 | 2;
  fecha: string;
  c_sonrisa: number;
  c_preguntas: number;
  c_experiencia: number;
  c_tecnologias: number;
  c_cierre: number;
  impresion_final: number;
  fortalezas: string;
  oportunidades: string;
  confirmada_at: string | null;
  comentario_evaluado: string;
  /** Formato de tienda con el que se hizo la evaluación (define los textos de A y G). */
  formato: "concept" | "outlet";
};

export type MaximizadorItem = {
  id: string;
  texto: string;
  activo: boolean;
  posicion: number;
};

export type MaximizadorRegistro = {
  id: string;
  fecha: string;
  persona_id: string;
  evaluador_id: string | null;
  items: Record<string, boolean>;
  puntaje: number;
  observaciones: string;
};

export type RankingConfig = {
  peso_ventas: number;
  peso_upt: number;
  peso_magia: number;
  peso_puntualidad: number;
  /** Fuera del puntaje desde oct-2026 (0): su flujo no es parejo para todos. */
  peso_maximizador: number;
  /** Lo que se reparte entre los 8 reconocimientos (1,25 cada uno con 10). */
  peso_reconocimientos: number;
  /** De ventas, cuánto es cumplimiento en pesos (el resto, unidades). */
  reparto_pesos: number;
  /** Reparto de las unidades; null = por defecto (40/60, o 40/30/30 con ropa). */
  reparto_pares: number | null;
  reparto_acc: number | null;
  reparto_ropa: number | null;
  /** Puntos propios de la tienda por tipo de falta (si no, los de Feedbacks). */
  puntos_faltas: Record<string, number>;
  upt_meta: number;
  bonus_aya: number; // puntos por cumplir la meta de accesorios y por la de ropa
  bonus_constancia: number; // puntos por cada mes consecutivo previo en el podio (tope 3)
};

export const RANKING_CONFIG_DEFAULT: RankingConfig = {
  peso_ventas: 40,
  peso_upt: 10,
  peso_magia: 25,
  peso_puntualidad: 15,
  peso_maximizador: 0,
  peso_reconocimientos: 10,
  reparto_pesos: 50,
  reparto_pares: null,
  reparto_acc: null,
  reparto_ropa: null,
  puntos_faltas: {},
  upt_meta: 1.5,
  bonus_aya: 2,
  bonus_constancia: 1,
};

/**
 * Cómo se reparte el componente de ventas (Huber, 8-oct-2026): una parte por
 * cumplimiento en pesos y otra por unidades; las unidades, pares 40 /
 * accesorios 60, o pares 40 / accesorios 30 / ropa 30 si la tienda vende ropa.
 * Devuelve fracciones: pesos + unidades = 1 y pares + acc + ropa = 1.
 */
export function repartoVentas(c: RankingConfig, vendeRopa: boolean) {
  const pesos = Math.min(100, Math.max(0, c.reparto_pesos ?? 50)) / 100;
  const def = vendeRopa ? { pares: 40, acc: 30, ropa: 30 } : { pares: 40, acc: 60, ropa: 0 };
  const pares = c.reparto_pares ?? def.pares;
  const acc = c.reparto_acc ?? def.acc;
  const ropa = vendeRopa ? (c.reparto_ropa ?? def.ropa) : 0;
  const t = pares + acc + ropa;
  return {
    pesos,
    unidades: 1 - pesos,
    pares: t > 0 ? pares / t : 0,
    acc: t > 0 ? acc / t : 0,
    ropa: t > 0 ? ropa / t : 0,
  };
}

/** Fracción de la meta del mes que ya debía llevarse a una fecha (con la meta de cada día). */
export function avanceAl(metasDia: { fecha: string; meta: number | null }[], fecha: string | null): number | null {
  if (!fecha) return null;
  const total = metasDia.reduce((a, d) => a + Number(d.meta ?? 0), 0);
  if (total <= 0) return null;
  return Math.min(1, metasDia.filter((d) => d.fecha <= fecha).reduce((a, d) => a + Number(d.meta ?? 0), 0) / total);
}

// ---------- Reconocimientos (los 8 del Excel de KPIs) ----------

export type ItemReconocimiento =
  | "pares"
  | "acc_ropa"
  | "kpis"
  | "ganando_clientes"
  | "ventas"
  | "puntualidad"
  | "trabajo_equipo"
  | "iniciativa";

/**
 * En este orden y con ganadores DISTINTOS: cada ítem automático excluye a los
 * ganadores anteriores. Los 3 últimos los califica la jefatura del día 1 al 5
 * del mes siguiente (Iniciativa, el jefe de tienda).
 */
export const ITEMS_RECONOCIMIENTO: { id: ItemReconocimiento; titulo: string; manual: boolean; ayuda: string }[] = [
  { id: "pares", titulo: "Mejor vendedor en pares", manual: false, ayuda: "Más pares vendidos." },
  { id: "acc_ropa", titulo: "Mejor en accesorios y ropa", manual: false, ayuda: "Más accesorios + ropa vendidos." },
  { id: "kpis", titulo: "KPIs", manual: false, ayuda: "Mejor promedio de cumplimiento: ventas, pares, accesorios, ropa y UPT frente a su meta." },
  { id: "ganando_clientes", titulo: "Ganando clientes", manual: false, ayuda: "Más transacciones por hora trabajada entre quienes cumplen su meta en pesos." },
  { id: "ventas", titulo: "Ventas", manual: false, ayuda: "Mejor cumplimiento del presupuesto en pesos." },
  { id: "puntualidad", titulo: "Puntualidad", manual: true, ayuda: "La califica la jefatura." },
  { id: "trabajo_equipo", titulo: "Trabajo en equipo", manual: true, ayuda: "La califica la jefatura." },
  { id: "iniciativa", titulo: "Iniciativa", manual: true, ayuda: "La califica el jefe de tienda." },
];

export type GanadorItem = { item: ItemReconocimiento; persona_id: string; valor: number | null; detalle: string };

/** Calificación manual guardada (tabla calificaciones_vendedor). */
export type CalificacionVendedor = {
  id: string;
  anio: number;
  mes: number;
  item: "puntualidad" | "trabajo_equipo" | "iniciativa";
  persona_id: string;
  nota: string;
  calificado_por: string | null;
  calificado_at: string;
};

export type PuntoExtra = {
  id: string;
  persona_id: string;
  anio: number;
  mes: number;
  puntos: number;
  motivo: string;
  registrado_por: string | null;
  created_at: string;
};

export type HistorialRanking = {
  id: string;
  anio: number;
  mes: number;
  persona_id: string;
  nombre: string;
  puesto: number;
  puntaje: number;
};

// Resúmenes que devuelven las funciones ranking_* (solo agregados).
export type ResumenMagia = { persona_id: string; promedio: number; evaluaciones: number };
export type ResumenMaximizador = { persona_id: string; puntaje: number; dias: number };
export type ResumenFaltas = {
  persona_id: string;
  faltas: number;
  /** Descuento de puntualidad (llegadas, ausencias, errores operacionales…), ya × recurrencia. */
  penalizacion: number;
  /** Descuento de Magia por reclamos de clientes. */
  penal_magia?: number;
  reclamos?: number;
};

/** Venta acumulada de cada persona con los cierres del día cargados (ranking_ventas). */
export type ResumenVentas = {
  persona_id: string;
  venta: number;
  articulos: number;
  dias: number;
  ultimo_dia: string | null;
};

/** Avance del mes: hasta qué día hay cierres y cuánta meta debía llevarse (ranking_avance). */
export type AvanceMes = {
  ultimo_cierre: string | null;
  dias_cerrados: number;
  meta_total: number;
  meta_a_cierre: number;
  venta_total: number;
};

// ---------- Magia con una sonrisa ----------

// Los textos de cada criterio y la escala dependen del formato de la tienda
// (Concept u Outlet): viven en ./magia.ts.

/** 5 criterios + impresión final, cada uno de 1 a 4. */
export const MAGIA_PUNTOS_MAX = 24;

export function totalMagia(e: MagiaEvaluacion | Omit<MagiaEvaluacion, "id" | "evaluador_id" | "fecha" | "fortalezas" | "oportunidades" | "persona_id" | "anio" | "mes" | "numero">): number {
  return (
    e.c_sonrisa +
    e.c_preguntas +
    e.c_experiencia +
    e.c_tecnologias +
    e.c_cierre +
    e.impresion_final
  );
}

// ---------- KPIs: helpers ----------

/** UPT de una persona: el guardado o, si falta, unidades ÷ facturas (cuando se tienen ambos). */
export function uptDe(k: Pick<KpiMensual, "upt" | "unidades" | "trx"> | null | undefined): number | null {
  if (!k) return null;
  if (k.upt != null) return k.upt;
  if (k.unidades != null && k.trx != null && k.trx > 0) return k.unidades / k.trx;
  return null;
}

export function ventaTotalAyA(k: KpiMensual): number {
  return (k.acc_venta ?? 0) + (k.ropa_venta ?? 0);
}

// ---------- Puntaje compuesto ----------

export type Componente = "ventas" | "upt" | "magia" | "puntualidad" | "maximizador";

export type FilaRanking = {
  persona: PersonaRk;
  kpi: KpiMensual | null;
  scores: Partial<Record<Componente, number>>; // 0..120, 100 = meta cumplida
  magia: ResumenMagia | null;
  maximizador: ResumenMaximizador | null;
  faltas: ResumenFaltas | null;
  /** Venta acumulada de los cierres del día cargados hasta hoy (null si aún no hay cierres). */
  ventaAcum: number | null;
  /** Presupuesto del mes de la persona × avance esperado a la fecha del último cierre. */
  metaFecha: number | null;
  /** ventaAcum ÷ metaFecha: lo que lleva frente a lo que ya debía llevar. */
  cumplimientoFecha: number | null;
  /** Cumplimiento de la meta de unidades a la fecha de la consolidada (null sin datos). */
  cumplUnidades: { pares: number | null; acc: number | null; ropa: number | null };
  /** Unidades que ya debía llevar a la fecha de corte de la consolidada (meta × avance). */
  metaUnidadesFecha: { pares: number | null; acc: number | null; ropa: number | null };
  puntajeBase: number | null; // componentes ponderados (sobre su parte del 100)
  /** Reconocimientos ganados este mes (cada uno suma peso_reconocimientos ÷ 8). */
  reconocimientos: ItemReconocimiento[];
  /** Por qué ganó cada uno ("Ana con 120 pares"). */
  detalleReconocimientos: Partial<Record<ItemReconocimiento, string>>;
  bonus: { ayA: number; extra: number; constancia: number; reconocimientos: number; total: number };
  puntaje: number | null; // base + bonos
};

const TOPE_SCORE = 120; // premia superar la meta, sin desbalancear el ranking

/**
 * Puntaje de cada componente en escala 0..120 (100 = cumple la meta):
 *  - ventas: cumplimiento del presupuesto del mes.
 *  - upt: UPT del asesor / meta de UPT.
 *  - magia: promedio de la evaluación del mes (1 a 4, un decimal) / 4.
 *  - puntualidad: 100 menos los puntos de penalización por llamados del mes.
 *  - maximizador: % de ítems cumplidos (solo quien ejerció la función).
 * El puntaje final es el promedio ponderado de los componentes DISPONIBLES:
 * si una persona no tiene evaluación Magia o nunca fue maximizador, ese
 * componente no le suma ni le resta (los pesos se reparten entre los demás).
 */
export function calcularRanking(opts: {
  personas: PersonaRk[];
  kpis: KpiMensual[];
  magia: ResumenMagia[];
  maximizador: ResumenMaximizador[];
  faltas: ResumenFaltas[];
  extras?: PuntoExtra[];
  rachas?: Record<string, number>;
  /** Venta acumulada por persona según los cierres del día cargados. */
  ventas?: ResumenVentas[];
  /** Fracción del presupuesto del mes que ya debía llevarse a la fecha del último cierre (0..1). */
  avance?: number | null;
  /** Fracción de la meta que debía llevarse a la fecha de corte de la consolidada (unidades). */
  avanceUnidades?: number | null;
  vendeRopa?: boolean;
  /** Ganadores de Puntualidad, Trabajo en equipo e Iniciativa que calificó la jefatura. */
  calificaciones?: Pick<CalificacionVendedor, "item" | "persona_id">[];
  config: RankingConfig;
}): FilaRanking[] {
  const { personas, config } = opts;
  const vendeRopa = opts.vendeRopa !== false;
  const extraPor = new Map<string, number>();
  (opts.extras ?? []).forEach((e) =>
    extraPor.set(e.persona_id, (extraPor.get(e.persona_id) ?? 0) + Number(e.puntos)),
  );
  const kpiPor = new Map(opts.kpis.map((k) => [k.persona_id, k]));
  const magiaPor = new Map(opts.magia.map((m) => [m.persona_id, m]));
  const maxPor = new Map(opts.maximizador.map((m) => [m.persona_id, m]));
  const faltasPor = new Map(opts.faltas.map((f) => [f.persona_id, f]));
  const ventaPor = new Map((opts.ventas ?? []).map((v) => [v.persona_id, v]));
  const hayCierres = (opts.ventas ?? []).length > 0;

  const filas: FilaRanking[] = personas.map((persona) => {
    const kpi = kpiPor.get(persona.id) ?? null;
    const magia = magiaPor.get(persona.id) ?? null;
    const maximizador = maxPor.get(persona.id) ?? null;
    const faltas = faltasPor.get(persona.id) ?? null;

    const scores: Partial<Record<Componente, number>> = {};
    // Las ventas salen de los cierres del día que se van cargando; el presupuesto de cada
    // persona es el dato inicial. A mitad de mes se compara contra lo que ya debía llevar.
    const pto = kpi?.presupuesto ?? null;
    const av = opts.avance && opts.avance > 0 ? Math.min(1, opts.avance) : null;
    const metaFecha = pto && pto > 0 && av ? pto * av : null;
    const ventaAcum = hayCierres ? Number(ventaPor.get(persona.id)?.venta ?? 0) : null;
    const cumplimientoFecha = metaFecha && ventaAcum != null ? ventaAcum / metaFecha : null;
    // Ventas = parte en pesos (cumplimiento a la fecha) + parte en unidades (pares, accesorios y
    // ropa frente a su meta a la fecha de la consolidada). Lo que no tiene datos no cuenta.
    const tope = (v: number) => Math.max(0, Math.min(TOPE_SCORE, v * 100));
    const rv = repartoVentas(config, vendeRopa);
    const avU = opts.avanceUnidades && opts.avanceUnidades > 0 ? Math.min(1, opts.avanceUnidades) : null;
    const cumplU = (venta: number | null | undefined, meta: number | null | undefined) =>
      kpi?.corte_ventas && avU && meta != null && meta > 0 && venta != null ? venta / (meta * avU) : null;
    const cumplUnidades = {
      pares: cumplU(kpi?.pares_venta, kpi?.pares_meta),
      acc: cumplU(kpi?.acc_venta, kpi?.acc_meta),
      ropa: vendeRopa ? cumplU(kpi?.ropa_venta, kpi?.ropa_meta) : null,
    };
    const metaU = (meta: number | null | undefined) => (kpi?.corte_ventas && avU && meta != null && meta > 0 ? meta * avU : null);
    const metaUnidadesFecha = { pares: metaU(kpi?.pares_meta), acc: metaU(kpi?.acc_meta), ropa: vendeRopa ? metaU(kpi?.ropa_meta) : null };
    let sU = 0;
    let wU = 0;
    for (const [w, c] of [[rv.pares, cumplUnidades.pares], [rv.acc, cumplUnidades.acc], [rv.ropa, cumplUnidades.ropa]] as const) {
      if (w > 0 && c != null) {
        sU += w * tope(c);
        wU += w;
      }
    }
    const partes: [number, number][] = [];
    if (cumplimientoFecha != null && rv.pesos > 0) partes.push([rv.pesos, tope(cumplimientoFecha)]);
    if (wU > 0 && rv.unidades > 0) partes.push([rv.unidades, sU / wU]);
    if (partes.length > 0) {
      scores.ventas = partes.reduce((a, [w, v]) => a + w * v, 0) / partes.reduce((a, [w]) => a + w, 0);
    }
    const uptKpi = uptDe(kpi);
    if (uptKpi != null && config.upt_meta > 0) {
      scores.upt = Math.max(0, Math.min(TOPE_SCORE, (uptKpi / config.upt_meta) * 100));
    }
    // Magia entra al ranking por su PROMEDIO (puntaje ÷ 6 ítems, a un decimal,
    // en la escala 1 a 4), el mismo número que se ve en la evaluación y en la
    // cuadrícula. `magia.promedio` llega como puntaje sobre 24.
    // Los reclamos de clientes (Feedbacks) restan de Magia.
    const penalMagia = Number(faltas?.penal_magia ?? 0);
    if (magia || penalMagia > 0) {
      const base = magia ? (Math.round((Number(magia.promedio) / (MAGIA_PUNTOS_MAX / 4)) * 10) / 10 / 4) * 100 : 100;
      scores.magia = Math.max(0, base - penalMagia);
    }
    // Puntualidad: solo cuenta si ya hay datos del mes (kpi cargado); sin
    // llamados de atención parte de 100.
    if (kpi) scores.puntualidad = Math.max(0, 100 - Number(faltas?.penalizacion ?? 0));
    if (maximizador && config.peso_maximizador > 0) scores.maximizador = Number(maximizador.puntaje) * 100;

    const pesos: Record<Componente, number> = {
      ventas: config.peso_ventas,
      upt: config.peso_upt,
      magia: config.peso_magia,
      puntualidad: config.peso_puntualidad,
      maximizador: config.peso_maximizador,
    };
    let suma = 0;
    let pesoTotal = 0;
    (Object.keys(scores) as Componente[]).forEach((c) => {
      suma += (scores[c] as number) * pesos[c];
      pesoTotal += pesos[c];
    });
    // Los componentes pesan su parte del 100; el resto (peso_reconocimientos) lo ganan los 8 reconocimientos.
    const pesoComponentes = Object.values(pesos).reduce((a, p) => a + p, 0);
    const escala = pesoComponentes + config.peso_reconocimientos > 0 ? pesoComponentes / (pesoComponentes + config.peso_reconocimientos) : 1;
    const puntajeBase = pesoTotal > 0 ? (suma / pesoTotal) * escala : null;

    // Bonos: meta de accesorios y de ropa cumplidas (automático), puntos extra
    // que registra jefatura y constancia (meses consecutivos previos en el podio).
    const cumple = (v: number | null | undefined, m: number | null | undefined) =>
      m != null && m > 0 && v != null && v >= m ? config.bonus_aya : 0;
    const ayA = kpi ? cumple(kpi.acc_venta, kpi.acc_meta) + cumple(kpi.ropa_venta, kpi.ropa_meta) : 0;
    const extra = extraPor.get(persona.id) ?? 0;
    const constancia = Math.min(opts.rachas?.[persona.id] ?? 0, 3) * config.bonus_constancia;
    const bonus = { ayA, extra, constancia, reconocimientos: 0, total: ayA + extra + constancia };
    const puntaje = puntajeBase != null ? puntajeBase + bonus.total : null;

    return {
      persona,
      kpi,
      scores,
      magia,
      maximizador,
      faltas,
      ventaAcum,
      metaFecha,
      cumplimientoFecha,
      cumplUnidades,
      metaUnidadesFecha,
      puntajeBase,
      reconocimientos: [] as ItemReconocimiento[],
      detalleReconocimientos: {} as Partial<Record<ItemReconocimiento, string>>,
      bonus,
      puntaje,
    };
  });

  // Reconocimientos: los 5 automáticos (ganadores distintos) + los 3 que califica la jefatura.
  const pesoTotalConfig =
    config.peso_ventas + config.peso_upt + config.peso_magia + config.peso_puntualidad + config.peso_maximizador + config.peso_reconocimientos;
  const valorItem = pesoTotalConfig > 0 ? ((config.peso_reconocimientos / ITEMS_RECONOCIMIENTO.length) * 100) / pesoTotalConfig : 0;
  const ganadores: { item: ItemReconocimiento; persona_id: string; detalle?: string }[] = [
    ...ganadoresAutomaticos(filas, config, vendeRopa),
    ...(opts.calificaciones ?? []).map((c) => ({ ...c, detalle: "Calificado por la jefatura" })),
  ];
  for (const g of ganadores) {
    const f = filas.find((x) => x.persona.id === g.persona_id);
    if (!f) continue;
    f.reconocimientos.push(g.item);
    if (g.detalle) f.detalleReconocimientos[g.item] = g.detalle;
    if (f.puntaje == null) continue;
    f.bonus.reconocimientos += valorItem;
    f.bonus.total += valorItem;
    f.puntaje += valorItem;
  }

  return filas.sort((a, b) => {
    if (a.puntaje == null && b.puntaje == null) return a.persona.nombre.localeCompare(b.persona.nombre);
    if (a.puntaje == null) return 1;
    if (b.puntaje == null) return -1;
    return b.puntaje - a.puntaje;
  });
}

/**
 * Ganadores de los 5 reconocimientos automáticos, en orden y sin repetir persona
 * (como el Excel de KPIs). Empates: gana quien mejor cumple su meta en pesos.
 */
export function ganadoresAutomaticos(
  filas: Pick<FilaRanking, "persona" | "kpi" | "cumplimientoFecha" | "cumplUnidades">[],
  config: Pick<RankingConfig, "upt_meta">,
  vendeRopa: boolean,
): GanadorItem[] {
  const usados = new Set<string>();
  const out: GanadorItem[] = [];
  const nombre = (f: (typeof filas)[number]) => f.persona.nombre.trim().split(/\s+/)[0];
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const elegir = (
    item: ItemReconocimiento,
    valor: (f: (typeof filas)[number]) => number | null,
    detalle: (f: (typeof filas)[number], v: number) => string,
    candidatos = filas,
  ) => {
    let mejor: { f: (typeof filas)[number]; v: number } | null = null;
    for (const f of candidatos) {
      if (usados.has(f.persona.id)) continue;
      const v = valor(f);
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      if (!mejor || v > mejor.v || (v === mejor.v && (f.cumplimientoFecha ?? 0) > (mejor.f.cumplimientoFecha ?? 0))) mejor = { f, v };
    }
    if (!mejor) return;
    usados.add(mejor.f.persona.id);
    out.push({ item, persona_id: mejor.f.persona.id, valor: mejor.v, detalle: detalle(mejor.f, mejor.v) });
  };

  elegir("pares", (f) => f.kpi?.pares_venta ?? null, (f, v) => `${nombre(f)} con ${Math.round(v)} pares`);
  elegir(
    "acc_ropa",
    (f) => (f.kpi ? (f.kpi.acc_venta ?? 0) + (f.kpi.ropa_venta ?? 0) : null),
    (f, v) => `${nombre(f)} con ${Math.round(v)} accesorios y ropa`,
  );
  elegir(
    "kpis",
    (f) => {
      const upt = uptDe(f.kpi);
      const v = [
        f.cumplimientoFecha,
        f.cumplUnidades.pares,
        f.cumplUnidades.acc,
        vendeRopa ? f.cumplUnidades.ropa : null,
        upt != null && config.upt_meta > 0 ? upt / config.upt_meta : null,
      ].filter((x): x is number => x != null);
      // Cada parte con tope de 120 % (como el puntaje): un dato exagerado no decide el ítem solo.
      return v.length >= 2 ? v.reduce((a, x) => a + Math.min(TOPE_SCORE / 100, x), 0) / v.length : null;
    },
    (f, v) => `${nombre(f)} con ${pct(v)} de promedio en sus KPIs`,
  );
  // Ganando clientes: TRX por hora trabajada entre quienes cumplen su meta en pesos (si nadie la
  // cumple aún, entre todos).
  const trxHora = (f: (typeof filas)[number]) =>
    f.kpi?.trx != null && f.kpi.trx > 0 ? (f.kpi.horas && f.kpi.horas > 0 ? f.kpi.trx / f.kpi.horas : f.kpi.trx) : null;
  const cumplen = filas.filter((f) => (f.cumplimientoFecha ?? 0) >= 1 && !usados.has(f.persona.id) && trxHora(f) != null);
  elegir(
    "ganando_clientes",
    trxHora,
    (f) => `${nombre(f)} con ${Math.round(f.kpi!.trx!)} transacciones${f.kpi?.horas ? ` (${trxHora(f)!.toFixed(2).replace(".", ",")} por hora)` : ""}`,
    cumplen.length > 0 ? cumplen : filas,
  );
  elegir("ventas", (f) => f.cumplimientoFecha, (f, v) => `${nombre(f)} con ${pct(v)} de su meta en pesos`);
  return out;
}

/** Quienes compiten en el ranking: jefe de tienda y subjefes auditan. */
export function compiteEnRanking(p: PersonaRk): boolean {
  return p.rol_jerarquico !== "jefe_tienda" && p.rol_jerarquico !== "subjefe";
}

export const NOMBRE_COMPONENTE: Record<Componente, string> = {
  ventas: "Ventas",
  upt: "UPT",
  magia: "Magia",
  puntualidad: "Puntualidad",
  maximizador: "Maximizador",
};

/**
 * Meses consecutivos inmediatamente anteriores a (anio, mes) en los que cada
 * persona quedó en el podio (puestos 1 a 3). Premia la constancia.
 */
export function calcularRachas(
  historial: HistorialRanking[],
  anio: number,
  mes: number,
): Record<string, number> {
  const podioPorMes = new Map<string, Set<string>>();
  historial.forEach((h) => {
    if (h.puesto > 3) return;
    const k = `${h.anio}-${h.mes}`;
    if (!podioPorMes.has(k)) podioPorMes.set(k, new Set());
    podioPorMes.get(k)!.add(h.persona_id);
  });
  const ids = new Set(historial.map((h) => h.persona_id));
  const rachas: Record<string, number> = {};
  ids.forEach((id) => {
    let a = anio;
    let m = mes;
    let n = 0;
    for (let i = 0; i < 12; i++) {
      m -= 1;
      if (m === 0) {
        m = 12;
        a -= 1;
      }
      if (podioPorMes.get(`${a}-${m}`)?.has(id)) n += 1;
      else break;
    }
    if (n > 0) rachas[id] = n;
  });
  return rachas;
}
