import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { esCuentaSinPersona, personasPorCodigo } from "@/lib/productividad";
import { avisoCorteSemana } from "@/lib/periodos";

describe("cuentas de la tienda (9999 / 989999) y asesores sin CM propio", () => {
  it("si un asesor tiene el 989999 (mientras le llega su CM), sus ventas son de él", () => {
    const m = personasPorCodigo([
      { id: "jeyson", codigo: "989999" },
      { id: "ana", codigo: "981404" },
    ]);
    expect(m.get("989999")).toBe("jeyson");
    expect(esCuentaSinPersona("989999", m)).toBe(false);
    expect(esCuentaSinPersona("9999", m)).toBe(true);
  });

  it("también por código alterno aprobado", () => {
    const m = personasPorCodigo([{ id: "jeyson", codigo: null }], [{ persona_id: "jeyson", codigo: "989999", estado: "aprobado" }]);
    expect(m.get("989999")).toBe("jeyson");
    expect(personasPorCodigo([], [{ persona_id: "x", codigo: "123", estado: "pendiente" }]).has("123")).toBe(false);
  });

  it("sin nadie con ese código, es venta en línea", () => {
    expect(esCuentaSinPersona("989999", personasPorCodigo([{ id: "ana", codigo: "981404" }]))).toBe(true);
  });
});

describe("corte de la semana retail (domingo a sábado)", () => {
  it("un informe hasta el sábado o hasta el fin del mes está bien", () => {
    expect(avisoCorteSemana("2026-10-10", "2026-10-31")).toBeNull(); // sábado
    expect(avisoCorteSemana("2026-10-31", "2026-10-31")).toBeNull();
  });
  it("hasta el domingo o un día de semana, avisa", () => {
    expect(avisoCorteSemana("2026-10-11", "2026-10-31")).toMatch(/domingo.*sábado/);
    expect(avisoCorteSemana("2026-10-06", "2026-10-31")).toMatch(/sábado/);
  });
});
