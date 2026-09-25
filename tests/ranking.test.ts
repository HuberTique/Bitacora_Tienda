import { describe, expect, it } from "vitest";
import {
  RANKING_CONFIG_DEFAULT as CFG,
  calcularRachas,
  calcularRanking,
  compiteEnRanking,
  totalMagia,
  uptDe,
  type KpiMensual,
  type PersonaRk,
} from "@/lib/ranking";
import { estiloCumplimiento, nivelCumplimiento } from "@/lib/cumplimiento";

const persona = (id: string, nombre: string, rol = "asesor_full"): PersonaRk =>
  ({ id, nombre, cargo: "cargo", rol_jerarquico: rol, foto_path: null }) as PersonaRk;

const kpi = (persona_id: string, o: Partial<KpiMensual> = {}): KpiMensual =>
  ({
    id: persona_id,
    persona_id,
    anio: 2026,
    mes: 9,
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
    ...o,
  }) as KpiMensual;

const venta = (persona_id: string, v: number) => ({ persona_id, venta: v, articulos: 1, dias: 1, ultimo_dia: null });

describe("uptDe", () => {
  it("usa el UPT guardado", () => expect(uptDe({ upt: 2, unidades: 10, trx: 10 })).toBe(2));
  it("calcula unidades / facturas cuando falta", () => expect(uptDe({ upt: null, unidades: 30, trx: 20 })).toBe(1.5));
  it("devuelve null sin facturas o con 0", () => {
    expect(uptDe({ upt: null, unidades: 30, trx: null })).toBeNull();
    expect(uptDe({ upt: null, unidades: 30, trx: 0 })).toBeNull();
    expect(uptDe(null)).toBeNull();
  });
});

describe("calcularRanking", () => {
  const base = { magia: [], maximizador: [], faltas: [], config: CFG };

  it("sin cierres ni datos nadie tiene puntaje", () => {
    const r = calcularRanking({ ...base, personas: [persona("a", "Ana")], kpis: [] });
    expect(r[0].puntaje).toBeNull();
    expect(r[0].ventaAcum).toBeNull();
  });

  it("ventas se mide contra la meta a la fecha (presupuesto x avance)", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a", { presupuesto: 1000 })],
      ventas: [venta("a", 300)],
      avance: 0.5,
    });
    expect(r[0].metaFecha).toBe(500);
    expect(r[0].cumplimientoFecha).toBeCloseTo(0.6);
    expect(r[0].scores.ventas).toBeCloseTo(60);
  });

  it("topa el score en 120", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a", { presupuesto: 1000 })],
      ventas: [venta("a", 5000)],
      avance: 0.5,
    });
    expect(r[0].scores.ventas).toBe(120);
  });

  it("quien tiene kpi pero no aparece en ventas queda en 0%, no null", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana"), persona("b", "Beto")],
      kpis: [kpi("a"), kpi("b")],
      ventas: [venta("a", 500)],
      avance: 0.5,
    });
    const b = r.find((f) => f.persona.id === "b")!;
    expect(b.ventaAcum).toBe(0);
    expect(b.scores.ventas).toBe(0);
  });

  it("los pesos se reparten entre los componentes disponibles", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a", { presupuesto: 1000 })],
      ventas: [venta("a", 500)],
      avance: 0.5,
      magia: [{ persona_id: "a", promedio: 24, evaluaciones: 1 }],
    });
    expect(r[0].puntajeBase).toBeCloseTo(100);
  });

  it("puntualidad resta la penalizacion", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a", { presupuesto: null })],
      faltas: [{ persona_id: "a", faltas: 2, penalizacion: 30 }],
    });
    expect(r[0].scores.puntualidad).toBe(70);
  });

  it("suma bonos: A&A, extras y constancia (tope 3 meses)", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("a", "Ana")],
      kpis: [kpi("a", { presupuesto: null, acc_meta: 10, acc_venta: 12, ropa_meta: 5, ropa_venta: 2 })],
      extras: [{ id: "1", persona_id: "a", puntos: 3 } as never],
      rachas: { a: 7 },
    });
    expect(r[0].bonus.ayA).toBe(CFG.bonus_aya);
    expect(r[0].bonus.extra).toBe(3);
    expect(r[0].bonus.constancia).toBe(3 * CFG.bonus_constancia);
  });

  it("ordena por puntaje y deja a los sin datos al final", () => {
    const r = calcularRanking({
      ...base,
      personas: [persona("c", "Carla"), persona("a", "Ana"), persona("b", "Beto")],
      kpis: [kpi("a"), kpi("b")],
      ventas: [venta("a", 200), venta("b", 500)],
      avance: 0.5,
    });
    expect(r.map((f) => f.persona.id)).toEqual(["b", "a", "c"]);
  });

  it("avance invalido (0, negativo, null, mayor a 1) no rompe", () => {
    for (const avance of [0, -1, null, undefined, 3]) {
      const r = calcularRanking({
        ...base,
        personas: [persona("a", "Ana")],
        kpis: [kpi("a")],
        ventas: [venta("a", 10)],
        avance,
      });
      expect(Number.isFinite(r[0].puntaje ?? 0)).toBe(true);
    }
  });
});

describe("otros helpers del ranking", () => {
  it("jefe y subjefe no compiten", () => {
    expect(compiteEnRanking(persona("a", "x", "jefe_tienda"))).toBe(false);
    expect(compiteEnRanking(persona("a", "x", "subjefe"))).toBe(false);
    expect(compiteEnRanking(persona("a", "x", "cajero"))).toBe(true);
  });

  it("totalMagia suma los 6 criterios", () => {
    expect(
      totalMagia({ c_sonrisa: 4, c_preguntas: 3, c_experiencia: 2, c_tecnologias: 1, c_cierre: 4, impresion_final: 4 } as never),
    ).toBe(18);
  });

  it("rachas: meses consecutivos previos en el podio, incluso cruzando de anio", () => {
    const h = (anio: number, mes: number, puesto: number) => ({ anio, mes, puesto, persona_id: "a" }) as never;
    const r = calcularRachas([h(2026, 8, 1), h(2026, 7, 3), h(2026, 6, 4), h(2025, 12, 1)], 2026, 9);
    expect(r.a).toBe(2);
    const r2 = calcularRachas([h(2025, 12, 2), h(2025, 11, 1)], 2026, 1);
    expect(r2.a).toBe(2);
  });
});

describe("cumplimiento", () => {
  it("niveles", () => {
    expect(nivelCumplimiento(1)).toBe("alto");
    expect(nivelCumplimiento(0.8)).toBe("medio");
    expect(nivelCumplimiento(0.79)).toBe("bajo");
    expect(nivelCumplimiento(null)).toBe("sin_dato");
    expect(nivelCumplimiento(NaN)).toBe("sin_dato");
    expect(estiloCumplimiento(2).text).toBe("text-operaciones");
  });
});
