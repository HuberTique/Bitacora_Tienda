import { describe, expect, it } from "vitest";
import {
  FACTORES_DEFAULT,
  horasPorDefecto,
  metasCategoria,
  repartir,
  ventaHoraVigente,
  type PersonaReparto,
} from "@/lib/reparto";
import type { RolJerarquico } from "@/lib/types";

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

describe("venta por hora por tramos", () => {
  it("ventaHoraVigente toma el último tramo que ya empezó", () => {
    const t = [{ desde: "2026-10-01", venta_hora: 5 }, { desde: "2026-10-05", venta_hora: 9 }];
    expect(ventaHoraVigente(t, "2026-10-04")).toBe(5);
    expect(ventaHoraVigente(t, "2026-10-05")).toBe(9);
    expect(ventaHoraVigente(t, "2026-09-30")).toBeNull();
  });
});

describe("horas por defecto: horas de venta por semana × semanas del mes", () => {
  it("octubre (35 días = 5 semanas): full 210, part 120, cajero 90, subjefe 60, jefe 50 horas de venta", () => {
    const hv = (rol: RolJerarquico) => horasPorDefecto(rol, 35, FACTORES_DEFAULT).horasVenta;
    expect([hv("full_time"), hv("part_time"), hv("cajero"), hv("subjefe"), hv("jefe_tienda")]).toEqual([210, 120, 90, 60, 50]);
  });

  it("las horas trabajadas son las de venta ÷ el factor: el reparto llega justo a la tabla", () => {
    const jefe = horasPorDefecto("jefe_tienda", 28, FACTORES_DEFAULT);
    expect(jefe).toEqual({ horas: 160, horasVenta: 40 });
    const r = repartir(1_000_000, [{ persona_id: "j", rol_jerarquico: "jefe_tienda", horas: jefe.horas }], FACTORES_DEFAULT, null);
    expect(r.filas[0].horas_venta).toBe(40);
  });
});
