import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { ayer, diasSinCierre, textoFaltan } from "@/lib/cierres-faltantes";

describe("días sin cierre", () => {
  const conCierre = new Set(["2026-10-04", "2026-10-06"]);

  it("revisa del inicio del mes hasta el día indicado (ayer)", () => {
    expect(diasSinCierre("2026-10-04", "2026-10-31", "2026-10-07", conCierre)).toEqual(["2026-10-05", "2026-10-07"]);
  });

  it("un día con meta 0 no abrió: no se pide su cierre", () => {
    const metas = new Map<string, number | null>([
      ["2026-10-04", 100],
      ["2026-10-05", 0],
      ["2026-10-06", 100],
      ["2026-10-07", 100],
    ]);
    expect(diasSinCierre("2026-10-04", "2026-10-31", "2026-10-07", conCierre, metas)).toEqual(["2026-10-07"]);
  });

  it("nunca pasa del fin del mes ni pide nada antes de que empiece", () => {
    expect(diasSinCierre("2026-10-04", "2026-10-05", "2026-10-20", new Set())).toEqual(["2026-10-04", "2026-10-05"]);
    expect(diasSinCierre("2026-10-04", "2026-10-31", "2026-10-03", new Set())).toEqual([]);
  });

  it("ayer y el texto del aviso", () => {
    expect(ayer(new Date(2026, 9, 8))).toBe("2026-10-07");
    expect(textoFaltan(["2026-10-05"])).toMatch(/^Falta el cierre del /);
    expect(textoFaltan(["2026-10-05", "2026-10-07"])).toMatch(/^Faltan los cierres de 2 días: /);
  });
});
