import { describe, expect, it } from "vitest";
import {
  RANKING_CONFIG_DEFAULT as CFG,
  avanceAl,
  calcularRanking,
  repartoVentas,
  type KpiMensual,
  type PersonaRk,
} from "@/lib/ranking";

// Reglas de Huber, 8-oct-2026 (validación de los Excel de KPIs y de Mejor vendedor).

const persona = (id: string, nombre: string): PersonaRk =>
  ({ id, nombre, cargo: "cargo", rol_jerarquico: "full_time", foto_path: null }) as PersonaRk;
const kpi = (persona_id: string, o: Partial<KpiMensual> = {}): KpiMensual =>
  ({
    id: persona_id,
    persona_id,
    anio: 2026,
    mes: 10,
    presupuesto: 1000,
    acumulado_bruto: null,
    acumulado_neto: null,
    cumplimiento: null,
    pares_meta: null,
    pares_venta: null,
    acc_meta: null,
    acc_venta: null,
    ropa_meta: null,
    ropa_venta: null,
    unidades: null,
    trx: null,
    upt: null,
    horas: null,
    corte_ventas: null,
    ...o,
  }) as KpiMensual;
const venta = (persona_id: string, v: number) => ({ persona_id, venta: v, articulos: 1, dias: 1, ultimo_dia: null });
const base = { magia: [], maximizador: [], faltas: [], config: CFG };

describe("reparto de ventas", () => {
  it("sin ropa: pesos 50 % y unidades 50 % (pares 40, accesorios 60)", () => {
    expect(repartoVentas(CFG, false)).toEqual({ pesos: 0.5, unidades: 0.5, pares: 0.4, acc: 0.6, ropa: 0 });
  });
  it("con ropa: pares 40, accesorios 30, ropa 30", () => {
    const r = repartoVentas(CFG, true);
    expect([r.pares, r.acc, r.ropa]).toEqual([0.4, 0.3, 0.3]);
  });
  it("la tienda puede fijar su propio reparto", () => {
    const r = repartoVentas({ ...CFG, reparto_pesos: 70, reparto_pares: 50, reparto_acc: 50 }, false);
    expect(r).toEqual({ pesos: 0.7, unidades: expect.closeTo(0.3), pares: 0.5, acc: 0.5, ropa: 0 });
  });
  it("avance a la fecha de corte con la meta de cada día", () => {
    const d = [
      { fecha: "2026-10-04", meta: 100 },
      { fecha: "2026-10-05", meta: 300 },
      { fecha: "2026-10-06", meta: 600 },
    ];
    expect(avanceAl(d, "2026-10-05")).toBe(0.4);
    expect(avanceAl(d, null)).toBeNull();
  });
});

describe("puntaje de ventas con unidades", () => {
  it("cumplir pesos y unidades da 100 en ventas", () => {
    const r = calcularRanking({
      ...base,
      vendeRopa: false,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a", { pares_meta: 40, pares_venta: 20, acc_meta: 10, acc_venta: 5, corte_ventas: "2026-10-15" })],
      ventas: [venta("a", 500)],
      avance: 0.5,
      avanceUnidades: 0.5,
    });
    expect(r[0].scores.ventas).toBeCloseTo(100);
    expect(r[0].cumplUnidades).toEqual({ pares: 1, acc: 1, ropa: null });
  });

  it("va al 100 % en pesos pero al 50 % en pares: ventas = 50·100 + 50·(40·50 + 60·100)", () => {
    const r = calcularRanking({
      ...base,
      vendeRopa: false,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a", { pares_meta: 40, pares_venta: 10, acc_meta: 10, acc_venta: 5, corte_ventas: "2026-10-15" })],
      ventas: [venta("a", 500)],
      avance: 0.5,
      avanceUnidades: 0.5,
    });
    expect(r[0].scores.ventas).toBeCloseTo(0.5 * 100 + 0.5 * (0.4 * 50 + 0.6 * 100));
  });

  it("sin consolidada, ventas es solo pesos", () => {
    const r = calcularRanking({ ...base, personas: [persona("a", "Ana")], kpis: [kpi("a")], ventas: [venta("a", 400)], avance: 0.5 });
    expect(r[0].scores.ventas).toBeCloseTo(80);
  });
});

describe("faltas y Magia", () => {
  it("los reclamos restan de Magia; el resto, de puntualidad", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a")],
      magia: [{ persona_id: "a", promedio: 24, evaluaciones: 1 }],
      faltas: [{ persona_id: "a", faltas: 2, penalizacion: 25, penal_magia: 20, reclamos: 1 }],
    });
    expect(r[0].scores.magia).toBe(80);
    expect(r[0].scores.puntualidad).toBe(75);
  });

  it("el maximizador ya no cuenta", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a")],
      maximizador: [{ persona_id: "a", puntaje: 1, dias: 3 }],
    });
    expect(r[0].scores.maximizador).toBeUndefined();
  });
});

describe("8 reconocimientos de 1,25 con ganadores distintos", () => {
  const equipo = () =>
    calcularRanking({
      ...base,
      vendeRopa: false,
      personas: [persona("a", "Ana"), persona("b", "Beto"), persona("c", "Caro"), persona("d", "Dani"), persona("e", "Eva")],
      kpis: [
        // Ana vende más pares; Beto más accesorios; Caro el mejor promedio; Dani más TRX por hora; Eva mejor % en pesos.
        kpi("a", { pares_meta: 100, pares_venta: 90, acc_meta: 20, acc_venta: 2, trx: 10, horas: 100, corte_ventas: "2026-10-31" }),
        kpi("b", { pares_meta: 100, pares_venta: 80, acc_meta: 20, acc_venta: 30, trx: 10, horas: 100, corte_ventas: "2026-10-31" }),
        kpi("c", { pares_meta: 50, pares_venta: 60, acc_meta: 10, acc_venta: 12, upt: 1.8, trx: 10, horas: 100, corte_ventas: "2026-10-31" }),
        kpi("d", { pares_meta: 100, pares_venta: 50, acc_meta: 20, acc_venta: 10, trx: 90, horas: 100, corte_ventas: "2026-10-31" }),
        kpi("e", { pares_meta: 100, pares_venta: 40, acc_meta: 20, acc_venta: 8, trx: 5, horas: 100, corte_ventas: "2026-10-31" }),
      ],
      ventas: [venta("a", 900), venta("b", 900), venta("c", 1100), venta("d", 1000), venta("e", 1300)],
      avance: 1,
      avanceUnidades: 1,
      calificaciones: [{ item: "trabajo_equipo", persona_id: "e" }],
    });

  it("cada ítem automático excluye a los ganadores anteriores", () => {
    const r = equipo();
    const de = (id: string) => r.find((f) => f.persona.id === id)!.reconocimientos;
    expect(de("a")).toEqual(["pares"]);
    expect(de("b")).toEqual(["acc_ropa"]);
    expect(de("c")).toEqual(["kpis"]);
    // Ganando clientes: entre quienes cumplen su meta en pesos (c ya ganó; d cumple con 90 TRX).
    expect(de("d")).toEqual(["ganando_clientes"]);
    // Ventas y la calificación manual de trabajo en equipo.
    expect(de("e")).toEqual(["ventas", "trabajo_equipo"]);
  });

  it("cada reconocimiento suma 1,25 al puntaje", () => {
    const r = equipo();
    const eva = r.find((f) => f.persona.id === "e")!;
    expect(eva.bonus.reconocimientos).toBeCloseTo(2.5);
    expect(eva.puntaje! - eva.puntajeBase!).toBeCloseTo(2.5 + eva.bonus.ayA + eva.bonus.extra + eva.bonus.constancia);
  });
});
