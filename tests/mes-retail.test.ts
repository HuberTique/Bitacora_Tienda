import { describe, expect, it } from "vitest";
import { construirPeriodo, diasEntre, mesesCalendario, semanaDe, type MesRetail } from "@/lib/mes-retail";

const retail = {
  anio: 2026,
  mes: 9,
  inicio: "2026-08-30",
  fin: "2026-10-03",
  semanas: [
    { numero: 1, inicio: "2026-08-30", fin: "2026-09-05" },
    { numero: 2, inicio: "2026-09-06", fin: "2026-09-12" },
  ],
} as unknown as MesRetail;

describe("mes retail", () => {
  it("septiembre 2026 retail tiene 35 dias y cruza tres meses calendario", () => {
    const p = construirPeriodo(2026, 9, retail);
    expect(p.esRetail).toBe(true);
    expect(p.fechas).toHaveLength(35);
    expect(p.fechas[0].fecha).toBe("2026-08-30");
    expect(p.fechas[34].fecha).toBe("2026-10-03");
    expect(mesesCalendario(p)).toEqual([
      { anio: 2026, mes: 8 },
      { anio: 2026, mes: 9 },
      { anio: 2026, mes: 10 },
    ]);
  });

  it("sin mes retail usa el mes calendario (febrero bisiesto incluido)", () => {
    expect(construirPeriodo(2026, 2).fechas).toHaveLength(28);
    expect(construirPeriodo(2028, 2).fechas).toHaveLength(29);
    expect(construirPeriodo(2026, 12).fin).toBe("2026-12-31");
  });

  it("diasEntre cruza fin de anio y marca el dia de la semana", () => {
    const d = diasEntre("2026-12-30", "2027-01-02");
    expect(d.map((x) => x.fecha)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(d[0].weekday).toBe(3);
  });

  it("semanaDe ubica la fecha o devuelve 0", () => {
    const p = construirPeriodo(2026, 9, retail);
    expect(semanaDe(p, "2026-09-08")).toBe(2);
    expect(semanaDe(p, "2026-10-01")).toBe(0);
  });
});
