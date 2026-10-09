import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { ventanaCalificacion } from "@/lib/calificaciones";

describe("tarea de calificar al mejor vendedor (días 1 a 5 del mes siguiente)", () => {
  it("con mes retail: se cuenta desde su primer día y califica el mes anterior", () => {
    const v = ventanaCalificacion(new Date(2026, 10, 3), { anio: 2026, mes: 11, inicio: "2026-11-01" });
    expect(v).toEqual({ anio: 2026, mes: 10, vence: "2026-11-05", dia: 3 });
  });

  it("el día 6 ya está vencida", () => {
    expect(ventanaCalificacion(new Date(2026, 10, 6), { anio: 2026, mes: 11, inicio: "2026-11-01" }).dia).toBe(6);
  });

  it("un mes retail que empieza otro día (30-ago) también cuenta desde ahí", () => {
    const v = ventanaCalificacion(new Date(2026, 8, 1), { anio: 2026, mes: 9, inicio: "2026-08-30" });
    expect(v).toMatchObject({ anio: 2026, mes: 8, vence: "2026-09-03", dia: 3 });
  });

  it("sin mes retail usa el calendario; en enero califica diciembre del año anterior", () => {
    expect(ventanaCalificacion(new Date(2027, 0, 2), null)).toEqual({ anio: 2026, mes: 12, vence: "2027-01-05", dia: 2 });
  });
});
