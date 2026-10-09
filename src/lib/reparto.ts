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
// Venta por hora por tramos: el presupuesto por semana (presupuesto-semanal.ts)
// guarda la venta por hora de cada persona desde el inicio de cada semana, y la
// meta del día = venta por hora vigente ese día × horas de venta del día.
// ---------------------------------------------------------------------------

export type Tarifa = { desde: string; venta_hora: number };

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
