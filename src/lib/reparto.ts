// Reparto del presupuesto de la tienda entre las personas, por HORAS DE VENTA,
// y metas por categoría. Funciones puras (sin base de datos).
//
// Reglas de la tienda (Huber, 2-oct-2026):
//   horas de venta = horas trabajadas × factor del cargo
//     jefe de tienda ¼, subjefe ⅓, cajero ½, full time y part time 1
//   venta por hora = presupuesto de la tienda ÷ horas de venta de todos
//   presupuesto de cada persona = venta por hora × sus horas de venta
//   (si la jefatura fija a mano el de alguien, el resto se reparte entre los demás)
//
//   metas por categoría (fórmula del Excel de la tienda, con los precios bien puestos):
//     pares       = presupuesto ÷ precio del par
//     accesorios  = presupuesto × % accesorios ÷ precio de accesorios
//     ropa        = presupuesto × % ropa ÷ precio de ropa (solo si la tienda vende ropa)

import type { RolJerarquico } from "./types";

export type Factores = { jefe: number; subjefe: number; cajero: number };
export const FACTORES_DEFAULT: Factores = { jefe: 0.25, subjefe: 1 / 3, cajero: 0.5 };

export type ParametrosMetas = {
  precioPares: number;
  precioAccesorios: number;
  precioRopa: number | null;
  pctAccesorios: number; // 0..100
  pctRopa: number; // 0..100
  vendeRopa: boolean;
};

export type PersonaReparto = {
  persona_id: string;
  rol_jerarquico: RolJerarquico;
  horas: number;
  /** Presupuesto fijado a mano por la jefatura (no se recalcula). */
  manual?: number | null;
};

export type FilaReparto = {
  persona_id: string;
  rol_jerarquico: RolJerarquico;
  horas: number;
  horas_venta: number;
  presupuesto: number;
  manual: boolean;
  pares_meta: number | null;
  acc_meta: number | null;
  ropa_meta: number | null;
};

/**
 * Horas de VENTA por semana de cada cargo (Huber, 6-oct-2026): con ellas arranca
 * el reparto al cargar el planeador o el provisional, × las semanas del mes.
 * Ya son horas de venta: no se les vuelve a aplicar el factor del cargo.
 */
export const HORAS_VENTA_SEMANA: Record<RolJerarquico, number> = {
  full_time: 42,
  part_time: 24,
  cajero: 18,
  subjefe: 12,
  jefe_tienda: 10,
};

/**
 * Horas por defecto de una persona en un mes de `dias` días: sus horas de venta
 * por semana × semanas, expresadas como horas trabajadas (÷ el factor del
 * cargo) para que el reparto, que multiplica por el factor, llegue justo a
 * esas horas de venta. Devuelve ambas, con dos decimales.
 */
export function horasPorDefecto(rol: RolJerarquico, dias: number, f: Factores): { horas: number; horasVenta: number } {
  const horasVenta = r2((HORAS_VENTA_SEMANA[rol] * dias) / 7);
  const factor = factorDe(rol, f);
  return { horas: factor > 0 ? r2(horasVenta / factor) : 0, horasVenta };
}

export function factorDe(rol: RolJerarquico, f: Factores): number {
  if (rol === "jefe_tienda") return f.jefe;
  if (rol === "subjefe") return f.subjefe;
  if (rol === "cajero") return f.cajero;
  return 1;
}

/** Redondea a 2 decimales (horas). */
const r2 = (n: number) => Math.round(n * 100) / 100;

export function metasCategoria(
  presupuesto: number,
  p: ParametrosMetas | null,
): { pares_meta: number | null; acc_meta: number | null; ropa_meta: number | null } {
  if (!p) return { pares_meta: null, acc_meta: null, ropa_meta: null };
  const u = (valor: number, precio: number | null) => (precio && precio > 0 ? Math.round(valor / precio) : null);
  return {
    pares_meta: u(presupuesto, p.precioPares),
    acc_meta: u((presupuesto * p.pctAccesorios) / 100, p.precioAccesorios),
    ropa_meta: p.vendeRopa ? u((presupuesto * p.pctRopa) / 100, p.precioRopa) : null,
  };
}

/**
 * Reparte el presupuesto. Quien tiene presupuesto a mano lo conserva; el
 * resto se reparte entre los demás según sus horas de venta. El último peso
 * de redondeo se ajusta en la persona con más horas para que la suma cuadre.
 */
export function repartir(
  presupuestoTienda: number,
  personas: PersonaReparto[],
  factores: Factores,
  metas: ParametrosMetas | null,
): { ventaPorHora: number; horasVentaTotal: number; filas: FilaReparto[]; sobrante: number } {
  const conHv = personas.map((p) => ({ ...p, horas_venta: r2(Math.max(0, p.horas) * factorDe(p.rol_jerarquico, factores)) }));
  const fijos = conHv.filter((p) => p.manual != null && p.manual >= 0);
  const libres = conHv.filter((p) => !(p.manual != null && p.manual >= 0));
  const totalFijo = fijos.reduce((a, p) => a + (p.manual ?? 0), 0);
  const aRepartir = Math.max(0, presupuestoTienda - totalFijo);
  const horasLibres = libres.reduce((a, p) => a + p.horas_venta, 0);
  const ventaPorHora = horasLibres > 0 ? aRepartir / horasLibres : 0;

  const filas: FilaReparto[] = conHv.map((p) => {
    const esManual = p.manual != null && p.manual >= 0;
    const presupuesto = esManual ? Math.round(p.manual!) : Math.round(ventaPorHora * p.horas_venta);
    return {
      persona_id: p.persona_id,
      rol_jerarquico: p.rol_jerarquico,
      horas: p.horas,
      horas_venta: p.horas_venta,
      presupuesto,
      manual: esManual,
      ...metasCategoria(presupuesto, metas),
    };
  });

  // Ajuste de redondeo para que la suma de los repartidos sea exacta.
  const repartidos = filas.filter((f) => !f.manual && f.horas_venta > 0);
  if (repartidos.length > 0) {
    const diferencia = aRepartir - repartidos.reduce((a, f) => a + f.presupuesto, 0);
    const mayor = repartidos.reduce((m, f) => (f.horas_venta > m.horas_venta ? f : m), repartidos[0]);
    mayor.presupuesto += diferencia;
    Object.assign(mayor, metasCategoria(mayor.presupuesto, metas));
  }
  const total = filas.reduce((a, f) => a + f.presupuesto, 0);
  return {
    ventaPorHora,
    horasVentaTotal: conHv.reduce((a, p) => a + p.horas_venta, 0),
    filas,
    sobrante: presupuestoTienda - total,
  };
}

// ---------------------------------------------------------------------------
// Recalcular el reparto del mes cuando llegan horarios reales (GeoVictoria).
// Reglas de Huber, 4-oct-2026:
//   * Los días ya pasados quedan CONGELADOS: lo que cada persona ya "consumió"
//     de su presupuesto (horas de venta de esos días × la venta por hora que
//     regía) no cambia.
//   * Lo que falta del presupuesto de la tienda se reparte entre los días que
//     vienen: días con horario → horas reales; días sin horario → las horas
//     del planeador en proporción (horas del mes ÷ días del mes).
//   * Quien tiene presupuesto fijado a mano lo conserva; el resto se reparte
//     entre los demás con una misma venta por hora.
// ---------------------------------------------------------------------------

export type Tarifa = { desde: string; venta_hora: number };

export type PersonaRecalculo = {
  persona_id: string;
  rol_jerarquico: RolJerarquico;
  /** Presupuesto actual del mes (0 si es nueva en el reparto). */
  presupuesto: number;
  manual: boolean;
  /** Horas del mes según el planeador o el provisional (0 si no hay). */
  horasPlan: number;
  /** Venta por hora guardada con la fecha desde la que rige (si hay). */
  tarifas: Tarifa[];
};

export type EntradaRecalculo = {
  presupuestoTienda: number;
  /** Días del mes (retail o calendario), YYYY-MM-DD en orden. */
  fechas: string[];
  hoy: string;
  personas: PersonaRecalculo[];
  /** Horas netas por persona y fecha ANTES y DESPUÉS de subir el horario. */
  horasAntes: Map<string, Map<string, number>>;
  horasDespues: Map<string, Map<string, number>>;
  factores: Factores;
  metas: ParametrosMetas | null;
};

export type FilaRecalculo = {
  persona_id: string;
  rol_jerarquico: RolJerarquico;
  manual: boolean;
  presupuestoAntes: number;
  presupuesto: number;
  /** Parte del presupuesto que ya corresponde a días pasados (no cambia). */
  congelado: number;
  /** Horas netas del mes (reales donde hay horario, del planeador donde no). */
  horas: number;
  horas_venta: number;
  /** Venta por hora que rige desde el corte. */
  venta_hora: number;
  /** Venta por hora que regía justo antes del corte (la implícita si no había tramos guardados). */
  venta_hora_antes: number;
  pares_meta: number | null;
  acc_meta: number | null;
  ropa_meta: number | null;
};

/** Venta por hora que rige un día: el último tramo cuyo "desde" es ese día o antes. */
export function ventaHoraVigente(tarifas: Tarifa[], fecha: string): number | null {
  let v: number | null = null;
  let desde = "";
  for (const t of tarifas) if (t.desde <= fecha && t.desde >= desde) {
    desde = t.desde;
    v = t.venta_hora;
  }
  return v;
}

export function recalcularReparto(e: EntradaRecalculo): { corte: string | null; filas: FilaRecalculo[]; sobrante: number } {
  const N = e.fechas.length;
  const ultimo = e.fechas[N - 1];
  // Desde qué día se recalcula: hoy, o el primer día si el mes no ha empezado.
  const corte = N === 0 || e.hoy > ultimo ? null : e.hoy < e.fechas[0] ? e.fechas[0] : e.hoy;

  const hDia = (p: PersonaRecalculo, mapa: Map<string, Map<string, number>>, f: string) => {
    const real = mapa.get(p.persona_id);
    return real && real.has(f) ? real.get(f)! : N > 0 ? p.horasPlan / N : 0;
  };

  const base = e.personas.map((p) => {
    const factor = factorDe(p.rol_jerarquico, e.factores);
    const hvAntes = e.fechas.map((f) => hDia(p, e.horasAntes, f) * factor);
    const hvDespues = e.fechas.map((f) => hDia(p, e.horasDespues, f) * factor);
    const horas = r2(e.fechas.reduce((a, f) => a + hDia(p, e.horasDespues, f), 0));
    // Venta por hora implícita si no hay tramos guardados.
    const totalHvAntes = hvAntes.reduce((a, v) => a + v, 0);
    const implicita = totalHvAntes > 0 ? p.presupuesto / totalHvAntes : 0;
    let congelado = 0;
    let hvFuturo = 0;
    e.fechas.forEach((f, i) => {
      if (corte && f < corte) congelado += hvAntes[i] * (ventaHoraVigente(p.tarifas, f) ?? implicita);
      else hvFuturo += hvDespues[i];
    });
    const ayer = corte ? e.fechas.filter((f) => f < corte).pop() : ultimo;
    const antesDelCorte = (ayer ? ventaHoraVigente(p.tarifas, ayer) : null) ?? implicita;
    return { p, horas, horasVenta: r2(hvDespues.reduce((a, v) => a + v, 0)), congelado, hvFuturo, antesDelCorte };
  });

  // Mes terminado: no se recalcula nada.
  if (!corte) {
    return {
      corte: null,
      filas: base.map((b) => ({
        persona_id: b.p.persona_id,
        rol_jerarquico: b.p.rol_jerarquico,
        manual: b.p.manual,
        presupuestoAntes: b.p.presupuesto,
        presupuesto: b.p.presupuesto,
        congelado: b.p.presupuesto,
        horas: b.horas,
        horas_venta: b.horasVenta,
        venta_hora: 0,
        venta_hora_antes: b.antesDelCorte,
        ...metasCategoria(b.p.presupuesto, e.metas),
      })),
      sobrante: e.presupuestoTienda - base.reduce((a, b) => a + b.p.presupuesto, 0),
    };
  }

  const manuales = base.filter((b) => b.p.manual);
  const libres = base.filter((b) => !b.p.manual);
  const futuroManual = (b: (typeof base)[number]) => Math.max(0, b.p.presupuesto - b.congelado);
  const bolsa = Math.max(
    0,
    e.presupuestoTienda - base.reduce((a, b) => a + b.congelado, 0) - manuales.reduce((a, b) => a + futuroManual(b), 0),
  );
  const hvLibres = libres.reduce((a, b) => a + b.hvFuturo, 0);
  const tarifaLibre = hvLibres > 0 ? bolsa / hvLibres : 0;

  const filas: FilaRecalculo[] = base.map((b) => {
    const futuro = b.p.manual ? futuroManual(b) : tarifaLibre * b.hvFuturo;
    const presupuesto = b.p.manual ? Math.round(b.p.presupuesto) : Math.round(b.congelado + futuro);
    return {
      persona_id: b.p.persona_id,
      rol_jerarquico: b.p.rol_jerarquico,
      manual: b.p.manual,
      presupuestoAntes: b.p.presupuesto,
      presupuesto,
      congelado: Math.round(b.congelado),
      horas: b.horas,
      horas_venta: b.horasVenta,
      venta_hora: b.p.manual ? (b.hvFuturo > 0 ? futuro / b.hvFuturo : 0) : tarifaLibre,
      venta_hora_antes: b.antesDelCorte,
      ...metasCategoria(presupuesto, e.metas),
    };
  });

  // El último peso de redondeo va a quien más horas tiene por delante.
  const ajustables = filas.filter((f, i) => !f.manual && base[i].hvFuturo > 0);
  if (ajustables.length > 0 && hvLibres > 0) {
    const dif = e.presupuestoTienda - filas.reduce((a, f) => a + f.presupuesto, 0);
    const idx = filas.indexOf(
      ajustables.reduce((m, f) => (base[filas.indexOf(f)].hvFuturo > base[filas.indexOf(m)].hvFuturo ? f : m), ajustables[0]),
    );
    if (Math.abs(dif) < filas.length + 1) {
      filas[idx].presupuesto += dif;
      Object.assign(filas[idx], metasCategoria(filas[idx].presupuesto, e.metas));
    }
  }
  return { corte, filas, sobrante: e.presupuestoTienda - filas.reduce((a, f) => a + f.presupuesto, 0) };
}
