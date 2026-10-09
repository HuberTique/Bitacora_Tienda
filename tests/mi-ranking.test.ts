import { describe, expect, it } from "vitest";
import { RANKING_CONFIG_DEFAULT as CFG, calcularRanking, type HistorialRanking, type KpiMensual, type PersonaRk } from "@/lib/ranking";
import { aspectosDe, carreraTrimestre, fortalezasYOportunidades, mesesDelTrimestre, miPosicion } from "@/lib/mi-ranking";

const persona = (id: string, nombre: string): PersonaRk => ({ id, nombre, cargo: "c", rol_jerarquico: "full_time", foto_path: null }) as PersonaRk;
const kpi = (persona_id: string, o: Partial<KpiMensual> = {}): KpiMensual =>
  ({
    id: persona_id,
    persona_id,
    anio: 2026,
    mes: 10,
    presupuesto: 1000,
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

const filas = calcularRanking({
  magia: [{ persona_id: "a", promedio: 18, evaluaciones: 1 }],
  maximizador: [],
  faltas: [{ persona_id: "a", faltas: 2, penalizacion: 25, penal_magia: 20, reclamos: 1 }],
  config: CFG,
  vendeRopa: false,
  personas: [persona("a", "Ana"), persona("b", "Beto")],
  kpis: [
    kpi("a", { pares_meta: 100, pares_venta: 40, acc_meta: 20, acc_venta: 12, upt: 1.2, corte_ventas: "2026-10-17" }),
    kpi("b", { pares_meta: 100, pares_venta: 60 }),
  ],
  ventas: [venta("a", 400), venta("b", 600)],
  avance: 0.5,
  avanceUnidades: 0.5,
});
const ana = filas.find((f) => f.persona.id === "a")!;

describe("fortalezas y oportunidades con datos", () => {
  const asp = aspectosDe(ana, CFG, false, { oportunidades: "Ofrecer alternativas" });
  const txt = (id: string) => asp.find((a) => a.id === id)!.texto;

  it("cuánto le falta en pesos y en unidades", () => {
    expect(txt("pesos")).toBe("Llevas 80 % de tu meta a la fecha: te faltan $100 para estar al día.");
    expect(txt("pares")).toBe("Llevas 40 pares de 50 a la fecha: te faltan 10 para ir al día.");
    expect(txt("acc")).toMatch(/por encima de los 10/);
  });

  it("UPT, Magia con reclamos y la oportunidad de su evaluación, y Feedbacks", () => {
    expect(txt("upt")).toMatch(/^Tu UPT es 1,20 y la meta 1,50: suma 0,30 artículos/);
    expect(txt("magia")).toBe("Promedio 3,0 de 4 en Magia con una sonrisa. 1 reclamo(s) de clientes te restan 20 puntos. A mejorar según tu evaluación: Ofrecer alternativas");
    expect(txt("puntualidad")).toMatch(/^2 registro\(s\) en Feedbacks .* te restan 25 puntos\.$/);
  });

  it("fortalezas = lo que está al día; oportunidades = lo más bajo primero", () => {
    const fo = fortalezasYOportunidades(asp);
    expect(fo.fortalezas.map((a) => a.id)).toEqual(["acc"]);
    // Magia 55 (75 − 20 por el reclamo), puntualidad 75; pesos, pares y UPT empatan en 80 (queda pesos).
    expect(fo.oportunidades.map((a) => a.id)).toEqual(["magia", "puntualidad", "pesos"]);
  });
});

describe("puesto y cuánto falta para subir", () => {
  it("el 2.º sabe cuánto le falta para el 1.º", () => {
    const p = miPosicion(filas, filas[1].persona.id)!;
    expect(p.puesto).toBe(2);
    expect(p.paraSubir).toBeCloseTo(filas[0].puntaje! - filas[1].puntaje!);
    expect(miPosicion(filas, filas[0].persona.id)!.paraSubir).toBeNull();
  });
});

describe("carrera del trimestre", () => {
  const h = (mes: number, persona_id: string, puntaje: number): HistorialRanking =>
    ({ id: `${mes}${persona_id}`, anio: 2026, mes, persona_id, nombre: persona_id, puesto: 1, puntaje }) as HistorialRanking;

  it("octubre está en el 4.º trimestre (oct, nov, dic)", () => {
    expect(mesesDelTrimestre(10)).toEqual([10, 11, 12]);
    expect(mesesDelTrimestre(2)).toEqual([1, 2, 3]);
  });

  it("suma los meses cerrados y el mes en curso en vivo; reconoce a quien más mejoró", () => {
    const vivos = [
      { persona: persona("a", "Ana"), puntaje: 90 },
      { persona: persona("b", "Beto"), puntaje: 95 },
    ] as unknown as Parameters<typeof carreraTrimestre>[1];
    const r = carreraTrimestre([h(10, "a", 80), h(10, "b", 70)], vivos, 2026, 11);
    expect(r.meses).toEqual([10, 11, 12]);
    expect(r.filas.map((f) => [f.persona_id, f.total])).toEqual([
      ["b", 165],
      ["a", 170],
    ].sort((x, y) => (y[1] as number) - (x[1] as number)));
    expect(r.masMejoro?.persona_id).toBe("b"); // de 70 a 95
    expect(r.sinCerrar).toEqual([]);
  });

  it("avisa si un mes anterior del trimestre no se cerró", () => {
    expect(carreraTrimestre([], [], 2026, 12).sinCerrar).toEqual([10, 11]);
  });
});
