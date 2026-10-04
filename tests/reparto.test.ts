import { describe, expect, it } from "vitest";
import {
  FACTORES_DEFAULT,
  metasCategoria,
  recalcularReparto,
  repartir,
  ventaHoraVigente,
  type PersonaReparto,
  type PersonaRecalculo,
} from "@/lib/reparto";

// Planta de la 690 en septiembre (horas del Excel de la tienda).
const SEPTIEMBRE: PersonaReparto[] = [
  { persona_id: "yajaira", rol_jerarquico: "jefe_tienda", horas: 28 },
  { persona_id: "john", rol_jerarquico: "subjefe", horas: 48 },
  { persona_id: "andrea", rol_jerarquico: "cajero", horas: 68 },
  { persona_id: "jeison", rol_jerarquico: "cajero", horas: 72 },
  { persona_id: "geraldine", rol_jerarquico: "full_time", horas: 138 },
  { persona_id: "alexander", rol_jerarquico: "full_time", horas: 147 },
  { persona_id: "dayana", rol_jerarquico: "full_time", horas: 130 },
  { persona_id: "sofia", rol_jerarquico: "part_time", horas: 51 },
  { persona_id: "andres", rol_jerarquico: "part_time", horas: 53 },
  { persona_id: "sebastian", rol_jerarquico: "part_time", horas: 106 },
  { persona_id: "yulieth", rol_jerarquico: "part_time", horas: 97 },
];
const PRESUPUESTO = 509_942_741;
const METAS = { precioPares: 243_000, precioAccesorios: 79_900, precioRopa: 180_000, pctAccesorios: 8, pctRopa: 4, vendeRopa: true };

describe("reparto por horas de venta", () => {
  const r = repartir(PRESUPUESTO, SEPTIEMBRE, FACTORES_DEFAULT, METAS);
  const de = (id: string) => r.filas.find((f) => f.persona_id === id)!;

  it("jefe ¼, subjefe ⅓, cajero ½ de sus horas; asesores todas", () => {
    expect(de("yajaira").horas_venta).toBe(7);
    expect(de("john").horas_venta).toBe(16);
    expect(de("andrea").horas_venta).toBe(34);
    expect(de("geraldine").horas_venta).toBe(138);
    expect(r.horasVentaTotal).toBe(815);
  });

  it("la suma cuadra exacto con el presupuesto de la tienda", () => {
    expect(r.filas.reduce((a, f) => a + f.presupuesto, 0)).toBe(PRESUPUESTO);
    expect(r.sobrante).toBe(0);
  });

  it("cada uno recibe venta por hora × sus horas de venta", () => {
    expect(r.ventaPorHora).toBeCloseTo(PRESUPUESTO / 815, 3);
    expect(de("sofia").presupuesto).toBe(Math.round((PRESUPUESTO / 815) * 51));
  });

  it("si la jefatura fija a mano a alguien, el resto se reparte entre los demás", () => {
    const conManual = SEPTIEMBRE.map((p) => (p.persona_id === "yajaira" ? { ...p, manual: 10_000_000 } : p));
    const m = repartir(PRESUPUESTO, conManual, FACTORES_DEFAULT, METAS);
    expect(m.filas.find((f) => f.persona_id === "yajaira")).toMatchObject({ presupuesto: 10_000_000, manual: true });
    expect(m.filas.reduce((a, f) => a + f.presupuesto, 0)).toBe(PRESUPUESTO);
  });

  it("si nadie tiene horas, avisa lo que quedó sin repartir", () => {
    const sinHoras = repartir(1_000_000, [{ persona_id: "a", rol_jerarquico: "full_time", horas: 0 }], FACTORES_DEFAULT, null);
    expect(sinHoras.sobrante).toBe(1_000_000);
  });
});

describe("metas por categoría (fórmula del Excel, precios corregidos)", () => {
  it("pares sobre todo el presupuesto; accesorios 8 % y ropa 4 % con su propio precio", () => {
    const m = metasCategoria(15_222_171, METAS);
    expect(m.pares_meta).toBe(Math.round(15_222_171 / 243_000)); // 63
    expect(m.acc_meta).toBe(Math.round((15_222_171 * 0.08) / 79_900)); // 15
    expect(m.ropa_meta).toBe(Math.round((15_222_171 * 0.04) / 180_000)); // 3
  });

  it("sin ropa no hay meta de ropa", () => {
    expect(metasCategoria(10_000_000, { ...METAS, vendeRopa: false }).ropa_meta).toBeNull();
  });

  it("sin precios no se inventan metas", () => {
    expect(metasCategoria(10_000_000, null)).toEqual({ pares_meta: null, acc_meta: null, ropa_meta: null });
  });
});

describe("recalcular el reparto con horarios reales (GeoVictoria)", () => {
  // Mes de 10 días; hoy es el día 5. Dos full time con 80 h planeadas (8 h/día).
  const fechas = Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const hoy = "2026-10-05";
  const persona = (id: string, extra: Partial<PersonaRecalculo> = {}): PersonaRecalculo => ({
    persona_id: id,
    rol_jerarquico: "full_time",
    presupuesto: 500_000,
    manual: false,
    horasPlan: 80,
    tarifas: [],
    ...extra,
  });
  const semana = (horas: number) => new Map(fechas.slice(4, 9).map((f) => [f, horas]));

  it("congela lo pasado y reparte lo que falta con las horas reales", () => {
    const r = recalcularReparto({
      presupuestoTienda: 1_000_000,
      fechas,
      hoy,
      personas: [persona("a"), persona("b")],
      horasAntes: new Map(),
      horasDespues: new Map([["a", semana(10)], ["b", semana(8)]]),
      factores: FACTORES_DEFAULT,
      metas: null,
    });
    const a = r.filas.find((f) => f.persona_id === "a")!;
    const b = r.filas.find((f) => f.persona_id === "b")!;
    expect(r.corte).toBe(hoy);
    // 4 días pasados de 10, a 8 h/día: 40 % de 500.000.
    expect(a.congelado).toBe(200_000);
    expect(b.congelado).toBe(200_000);
    // Quedan 600.000 para 58 h (A: 5×10 + 8) y 48 h (B: 5×8 + 8).
    expect(Math.abs(a.presupuesto - (200_000 + (600_000 * 58) / 106))).toBeLessThanOrEqual(1);
    expect(a.presupuesto + b.presupuesto).toBe(1_000_000);
    expect(a.horas).toBe(4 * 8 + 5 * 10 + 8);
    expect(a.venta_hora).toBeCloseTo(600_000 / 106, 6);
    // Sin tramos guardados, la que regía era la implícita: 500.000 ÷ 80 h.
    expect(a.venta_hora_antes).toBeCloseTo(6_250, 6);
  });

  it("respeta la venta por hora guardada de los días pasados", () => {
    const r = recalcularReparto({
      presupuestoTienda: 1_000_000,
      fechas,
      hoy,
      personas: [persona("a", { tarifas: [{ desde: "2026-10-01", venta_hora: 7_000 }] }), persona("b")],
      horasAntes: new Map(),
      horasDespues: new Map(),
      factores: FACTORES_DEFAULT,
      metas: null,
    });
    expect(r.filas.find((f) => f.persona_id === "a")!.congelado).toBe(4 * 8 * 7_000);
    expect(r.filas.reduce((s, f) => s + f.presupuesto, 0)).toBe(1_000_000);
  });

  it("quien está a mano conserva su presupuesto", () => {
    const r = recalcularReparto({
      presupuestoTienda: 1_000_000,
      fechas,
      hoy,
      personas: [persona("a", { manual: true, presupuesto: 300_000 }), persona("b", { presupuesto: 700_000 })],
      horasAntes: new Map(),
      horasDespues: new Map([["b", semana(10)]]),
      factores: FACTORES_DEFAULT,
      metas: null,
    });
    expect(r.filas.find((f) => f.persona_id === "a")!.presupuesto).toBe(300_000);
    expect(r.filas.find((f) => f.persona_id === "b")!.presupuesto).toBe(700_000);
  });

  it("el jefe aporta ¼ de sus horas también al recalcular", () => {
    const r = recalcularReparto({
      presupuestoTienda: 1_000_000,
      fechas,
      hoy: "2026-09-30", // el mes aún no empieza: nada congelado
      personas: [persona("j", { rol_jerarquico: "jefe_tienda", presupuesto: 0 }), persona("a", { presupuesto: 0 })],
      horasAntes: new Map(),
      horasDespues: new Map(),
      factores: FACTORES_DEFAULT,
      metas: null,
    });
    const j = r.filas.find((f) => f.persona_id === "j")!;
    expect(j.congelado).toBe(0);
    expect(j.horas_venta).toBe(20);
    expect(j.presupuesto).toBe(Math.round((1_000_000 * 20) / 100));
  });

  it("con el mes terminado no cambia nada", () => {
    const r = recalcularReparto({
      presupuestoTienda: 1_000_000,
      fechas,
      hoy: "2026-11-02",
      personas: [persona("a"), persona("b")],
      horasAntes: new Map(),
      horasDespues: new Map([["a", semana(10)]]),
      factores: FACTORES_DEFAULT,
      metas: null,
    });
    expect(r.corte).toBeNull();
    expect(r.filas.map((f) => f.presupuesto)).toEqual([500_000, 500_000]);
  });

  it("ventaHoraVigente toma el último tramo que ya empezó", () => {
    const t = [{ desde: "2026-10-01", venta_hora: 5 }, { desde: "2026-10-05", venta_hora: 9 }];
    expect(ventaHoraVigente(t, "2026-10-04")).toBe(5);
    expect(ventaHoraVigente(t, "2026-10-05")).toBe(9);
    expect(ventaHoraVigente(t, "2026-09-30")).toBeNull();
  });
});
