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
  peso_maximizador: number;
  upt_meta: number;
  bonus_aya: number; // puntos por cumplir la meta de accesorios y por la de ropa
  bonus_constancia: number; // puntos por cada mes consecutivo previo en el podio (tope 3)
};

export const RANKING_CONFIG_DEFAULT: RankingConfig = {
  peso_ventas: 40,
  peso_upt: 10,
  peso_magia: 25,
  peso_puntualidad: 15,
  peso_maximizador: 10,
  upt_meta: 1.5,
  bonus_aya: 2,
  bonus_constancia: 1,
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

export type ResumenSemanal = {
  persona_id: string;
  semana_label: string;
  meta: number | null;
  venta: number | null;
  cumplimiento: number | null;
};

// Resúmenes que devuelven las funciones ranking_* (solo agregados).
export type ResumenMagia = { persona_id: string; promedio: number; evaluaciones: number };
export type ResumenMaximizador = { persona_id: string; puntaje: number; dias: number };
export type ResumenFaltas = { persona_id: string; faltas: number; penalizacion: number };

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

export const MAGIA_CRITERIOS = [
  {
    key: "c_sonrisa",
    letra: "M",
    texto: "Muestro una sonrisa con entusiasmo y autenticidad al saludar y recibir al cliente",
  },
  {
    key: "c_preguntas",
    letra: "A",
    texto: "Realizo preguntas abiertas generando compromiso e interacción con el cliente",
  },
  {
    key: "c_experiencia",
    letra: "G",
    texto: "Genero una experiencia excepcional a todos los clientes",
  },
  {
    key: "c_tecnologias",
    letra: "I",
    texto: "Informo a los clientes sobre las tecnologías de comodidad Skechers",
  },
  {
    key: "c_cierre",
    letra: "A",
    texto: "Al cerrar la venta agradezco con una sonrisa y le invito a volver",
  },
] as const;

export const MAGIA_ESCALA = [
  { v: 1, label: "Bajo expectativa" },
  { v: 2, label: "Por mejorar" },
  { v: 3, label: "Bueno" },
  { v: 4, label: "Cumple expectativa" },
];

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
  puntajeBase: number | null; // promedio ponderado de componentes
  bonus: { ayA: number; extra: number; constancia: number; total: number };
  puntaje: number | null; // base + bonos
};

const TOPE_SCORE = 120; // premia superar la meta, sin desbalancear el ranking

/**
 * Puntaje de cada componente en escala 0..120 (100 = cumple la meta):
 *  - ventas: cumplimiento del presupuesto del mes.
 *  - upt: UPT del asesor / meta de UPT.
 *  - magia: promedio de evaluaciones / 24 puntos.
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
  config: RankingConfig;
}): FilaRanking[] {
  const { personas, config } = opts;
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
    if (cumplimientoFecha != null) {
      scores.ventas = Math.max(0, Math.min(TOPE_SCORE, cumplimientoFecha * 100));
    }
    if (kpi?.upt != null && config.upt_meta > 0) {
      scores.upt = Math.max(0, Math.min(TOPE_SCORE, (kpi.upt / config.upt_meta) * 100));
    }
    if (magia) scores.magia = (Number(magia.promedio) / MAGIA_PUNTOS_MAX) * 100;
    // Puntualidad: solo cuenta si ya hay datos del mes (kpi cargado); sin
    // llamados de atención parte de 100.
    if (kpi) scores.puntualidad = Math.max(0, 100 - Number(faltas?.penalizacion ?? 0));
    if (maximizador) scores.maximizador = Number(maximizador.puntaje) * 100;

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
    const puntajeBase = pesoTotal > 0 ? suma / pesoTotal : null;

    // Bonos: meta de accesorios y de ropa cumplidas (automático), puntos extra
    // que registra jefatura y constancia (meses consecutivos previos en el podio).
    const cumple = (v: number | null | undefined, m: number | null | undefined) =>
      m != null && m > 0 && v != null && v >= m ? config.bonus_aya : 0;
    const ayA = kpi ? cumple(kpi.acc_venta, kpi.acc_meta) + cumple(kpi.ropa_venta, kpi.ropa_meta) : 0;
    const extra = extraPor.get(persona.id) ?? 0;
    const constancia = Math.min(opts.rachas?.[persona.id] ?? 0, 3) * config.bonus_constancia;
    const bonus = { ayA, extra, constancia, total: ayA + extra + constancia };
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
      puntajeBase,
      bonus,
      puntaje,
    };
  });

  return filas.sort((a, b) => {
    if (a.puntaje == null && b.puntaje == null) return a.persona.nombre.localeCompare(b.persona.nombre);
    if (a.puntaje == null) return 1;
    if (b.puntaje == null) return -1;
    return b.puntaje - a.puntaje;
  });
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
