import { describe, expect, it } from "vitest";
import { avancePeriodo, deltaPeriodo, partePeriodo, proyectar, ultimoCorte, type Corte } from "@/lib/periodos";

const c = (fuente: Corte["fuente"], corte: string, persona_id: string, o: Partial<Corte>): Corte => ({
  fuente,
  corte,
  persona_id,
  pares: null,
  acc: null,
  ropa: null,
  unidades: null,
  trx: null,
  upt: null,
  ...o,
});

// Octubre retail: 4-oct a 31-oct; semanas 4–10, 11–17, 18–24, 25–31.
const cortes: Corte[] = [
  c("consolidada", "2026-10-10", "ana", { pares: 30, acc: 6, ropa: 0 }),
  c("consolidada", "2026-10-17", "ana", { pares: 70, acc: 15, ropa: 0 }),
  c("consolidada", "2026-10-17", "beto", { pares: 12, acc: 2, ropa: 0 }),
  c("xstore", "2026-10-06", "ana", { trx: 20, upt: 1.5 }),
  c("xstore", "2026-10-17", "ana", { trx: 60, upt: 1.4 }),
];

describe("cortes de la consolidada y Xstore", () => {
  it("la primera semana parte de cero", () => {
    const r = deltaPeriodo(cortes, "consolidada", "2026-10-04", "2026-10-10", "2026-10-04");
    expect(r.estado).toBe("ok");
    if (r.estado === "ok") expect(r.porPersona.get("ana")).toMatchObject({ pares: 30, acc: 6 });
  });

  it("la segunda semana = corte del sábado − corte del sábado anterior; quien no estaba parte de 0", () => {
    const r = deltaPeriodo(cortes, "consolidada", "2026-10-11", "2026-10-17", "2026-10-04");
    if (r.estado !== "ok") throw new Error(r.estado);
    expect(r.desde).toBe("2026-10-10");
    expect(r.porPersona.get("ana")).toMatchObject({ pares: 40, acc: 9 });
    expect(r.porPersona.get("beto")).toMatchObject({ pares: 12 });
  });

  it("si no hay corte antes de que empiece la semana, no se inventa", () => {
    const r = deltaPeriodo(cortes, "xstore", "2026-10-11", "2026-10-17", "2026-10-04");
    // Hay un corte el 6 (antes del 11), así que sí se puede: 60 − 20 TRX.
    if (r.estado !== "ok") throw new Error(r.estado);
    expect(r.porPersona.get("ana")!.trx).toBe(40);
    // UPT de la semana = artículos de la semana ÷ TRX de la semana = (60·1,4 − 20·1,5) ÷ 40.
    expect(r.porPersona.get("ana")!.articulosXstore / r.porPersona.get("ana")!.trx).toBeCloseTo(1.35);
    const sinBase = deltaPeriodo([c("xstore", "2026-10-17", "ana", { trx: 60 })], "xstore", "2026-10-11", "2026-10-17", "2026-10-04");
    expect(sinBase).toEqual({ estado: "falta_inicio", necesita: "2026-10-10", hasta: "2026-10-17" });
  });

  it("una semana sin cortes no tiene datos", () => {
    expect(deltaPeriodo(cortes, "consolidada", "2026-10-18", "2026-10-24", "2026-10-04")).toEqual({ estado: "sin_datos" });
    expect(ultimoCorte(cortes, "consolidada", "2026-10-31")).toBe("2026-10-17");
  });
});

describe("meta y proyección del periodo", () => {
  const metas = [
    { fecha: "2026-10-04", meta: 100 },
    { fecha: "2026-10-05", meta: 100 },
    { fecha: "2026-10-06", meta: 200 },
    { fecha: "2026-10-07", meta: 600 },
  ];
  it("la parte del mes que cae en el periodo, con la meta de cada día", () => {
    expect(partePeriodo(metas, "2026-10-04", "2026-10-05", "2026-10-04", "2026-10-07")).toBe(0.2);
  });
  it("sin metas por día, por número de días", () => {
    expect(partePeriodo([], "2026-10-04", "2026-10-10", "2026-10-04", "2026-10-31")).toBe(0.25);
  });
  it("avance y proyección al ritmo actual", () => {
    expect(avancePeriodo(metas, "2026-10-04", "2026-10-07", "2026-10-06")).toBe(0.4);
    expect(avancePeriodo(metas, "2026-10-04", "2026-10-07", "2026-10-09")).toBe(1);
    expect(avancePeriodo(metas, "2026-10-04", "2026-10-07", null)).toBeNull();
    expect(proyectar(400, 0.4)).toBe(1000);
    expect(proyectar(400, null)).toBeNull();
  });
});
