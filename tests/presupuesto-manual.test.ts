import { describe, expect, it } from "vitest";
import {
  calcularMetas,
  fechasPropuestas,
  horasTrabajadas,
  metasDiarias,
  problemaMezcla,
  semanasRetail,
  variacion,
} from "@/lib/presupuesto-manual";

describe("horas trabajadas", () => {
  it("tiempo completo descuenta la hora de almuerzo; part-time no", () => {
    expect(horasTrabajadas(10, false)).toBe(9);
    expect(horasTrabajadas(9, false)).toBe(8);
    expect(horasTrabajadas(4, true)).toBe(4);
    expect(horasTrabajadas(0, false)).toBe(0);
  });
});

describe("mezcla de la tienda", () => {
  it("debe estar completa y sumar 100", () => {
    expect(problemaMezcla({ calzado: 80, accesorios: 15, ropa: 5 }, true)).toBeNull();
    expect(problemaMezcla({ calzado: 80, accesorios: 20, ropa: 0 }, false)).toBeNull();
    expect(problemaMezcla({ calzado: 80, accesorios: 15 }, true)).toMatch(/no está configurada/);
    expect(problemaMezcla({ calzado: 70, accesorios: 15, ropa: 5 }, true)).toMatch(/suma 90/);
  });
});

describe("reparto por horas", () => {
  const mezcla = { calzado: 80, accesorios: 15, ropa: 5 };
  const precios = { calzado: 200_000, accesorios: 50_000, ropa: 100_000 };

  it("cada asesor recibe venta por hora × sus horas", () => {
    const r = calcularMetas(30_000_000, [
      { persona_id: "a", horas: 180 },
      { persona_id: "b", horas: 90 },
      { persona_id: "c", horas: 30 },
    ], mezcla, precios, true);
    expect(r.horasTotal).toBe(300);
    expect(r.ventaPorHora).toBe(100_000);
    expect(r.filas.map((f) => f.presupuesto)).toEqual([18_000_000, 9_000_000, 3_000_000]);
  });

  it("convierte pesos en unidades con la mezcla y el precio promedio", () => {
    const [a] = calcularMetas(10_000_000, [{ persona_id: "a", horas: 100 }], mezcla, precios, true).filas;
    expect(a.pares_meta).toBe(40); // 10M × 80 % ÷ 200.000
    expect(a.acc_meta).toBe(30); // 10M × 15 % ÷ 50.000
    expect(a.ropa_meta).toBe(5); // 10M × 5 % ÷ 100.000
  });

  it("sin ropa no hay meta de ropa, y quien no tiene horas queda fuera", () => {
    const r = calcularMetas(1_000_000, [
      { persona_id: "a", horas: 10 },
      { persona_id: "b", horas: 0 },
    ], { calzado: 85, accesorios: 15, ropa: 0 }, { ...precios, ropa: null }, false);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].ropa_meta).toBeNull();
  });
});

describe("metas por día y semanas", () => {
  it("en partes iguales suma exactamente el presupuesto", () => {
    const m = metasDiarias(1_000_000, "2026-10-04", "2026-10-10");
    expect(m).toHaveLength(7);
    expect(m.reduce((a, x) => a + x.meta, 0)).toBe(1_000_000);
  });

  it("con el mes anterior, respeta el peso de cada día de la semana", () => {
    // Mes anterior: los sábados vendían el doble que el resto.
    const anteriores = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(2026, 8, 6 + i); // 6-sep-2026 es domingo
      const fecha = `2026-09-${String(6 + i).padStart(2, "0")}`;
      return { fecha, meta: d.getDay() === 6 ? 200 : 100 };
    });
    const m = metasDiarias(800_000, "2026-10-04", "2026-10-10", anteriores);
    const sabado = m.find((x) => x.fecha === "2026-10-10")!.meta;
    const martes = m.find((x) => x.fecha === "2026-10-06")!.meta;
    expect(sabado).toBe(200_000);
    expect(martes).toBe(100_000);
    expect(m.reduce((a, x) => a + x.meta, 0)).toBe(800_000);
  });

  it("las semanas van de domingo a sábado y suman la meta del mes", () => {
    const metas = metasDiarias(3_500_000, "2026-10-04", "2026-10-31");
    const s = semanasRetail("2026-10-04", "2026-10-31", metas);
    expect(s.map((x) => [x.inicio, x.fin])).toEqual([
      ["2026-10-04", "2026-10-10"],
      ["2026-10-11", "2026-10-17"],
      ["2026-10-18", "2026-10-24"],
      ["2026-10-25", "2026-10-31"],
    ]);
    expect(s.reduce((a, x) => a + (x.target ?? 0), 0)).toBe(3_500_000);
  });
});

describe("fechas propuestas y avisos", () => {
  it("empieza el día después del mes anterior y termina el sábado del último día del mes", () => {
    expect(fechasPropuestas("2026-10-03", 2026, 10)).toEqual({ inicio: "2026-10-04", fin: "2026-10-31" });
  });
  it("sin mes anterior empieza el domingo de la semana del día 1", () => {
    expect(fechasPropuestas(null, 2026, 10).inicio).toBe("2026-09-27");
  });
  it("variación de precio frente al mes anterior", () => {
    expect(variacion(130, 100)).toBeCloseTo(0.3);
    expect(variacion(100, null)).toBeNull();
  });
});
