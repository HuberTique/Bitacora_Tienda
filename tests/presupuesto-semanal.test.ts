import { describe, expect, it } from "vitest";
import { calcularPresupuestoSemanal, type DiaHoras, type PersonaSemanal } from "@/lib/presupuesto-semanal";
import { FACTORES_DEFAULT } from "@/lib/reparto";

// Una semana retail (dom 04 a sáb 10 de octubre) con meta de tienda de 7.000.000
// y tres full time con 6 días de 7 h programadas (42 h).
const SEMANA = { inicio: "2026-10-04", fin: "2026-10-10", meta: 7_000_000, cerrada: null };
const fechas = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const ft = (id: string, extra: Partial<PersonaSemanal> = {}): PersonaSemanal => ({
  persona_id: id,
  rol_jerarquico: "full_time",
  manual: null,
  horasPlan: 0,
  ...extra,
});
const semanaDe = (cambios: Record<string, Partial<DiaHoras>> = {}) =>
  new Map(fechas.map((f) => [f, { programadas: 7, reales: 7, novedad: null, ...(cambios[f] ?? {}) } as DiaHoras]));

function calcular(dias: Record<string, Map<string, DiaHoras>>, extra: { cerrada?: Map<string, number>; personas?: PersonaSemanal[] } = {}) {
  return calcularPresupuestoSemanal({
    semanas: [{ ...SEMANA, cerrada: extra.cerrada ?? null }],
    personas: extra.personas ?? [ft("a"), ft("b"), ft("c")],
    dias: new Map(Object.entries(dias)),
    diasMes: 7,
    factores: FACTORES_DEFAULT,
  });
}
const fila = (r: ReturnType<typeof calcular>, id: string) => r.semanas[0].filas.find((f) => f.persona_id === id)!;

describe("presupuesto por semana: proyectado y recalculado", () => {
  it("proyectado: la meta de la semana se reparte por horas programadas", () => {
    const r = calcular({ a: semanaDe(), b: semanaDe(), c: semanaDe() });
    expect(r.semanas[0].filas.map((f) => f.proyectada).sort()).toEqual([2_333_333, 2_333_333, 2_333_334]);
    expect(r.semanas[0].filas.reduce((s, f) => s + f.proyectada, 0)).toBe(7_000_000);
  });

  it("incapacidad toda la semana: su parte pasa a los demás de esa semana", () => {
    const incapacitado = semanaDe(Object.fromEntries(fechas.map((f) => [f, { reales: 0, novedad: "incapacidad" }])));
    const r = calcular({ a: incapacitado, b: semanaDe(), c: semanaDe() });
    expect(fila(r, "a").recalculada).toBe(0);
    expect(fila(r, "b").recalculada + fila(r, "c").recalculada).toBe(7_000_000);
    // Mientras la semana no se cierre, rige la proyectada.
    expect(fila(r, "a").vigente).toBe(fila(r, "a").proyectada);
  });

  it("ausencia injustificada: conserva su presupuesto (el equipo no carga con ella)", () => {
    const falto = semanaDe({ "2026-10-06": { reales: 0, novedad: "ausencia" } });
    const r = calcular({ a: falto, b: semanaDe(), c: semanaDe() });
    expect(fila(r, "a").recalculada).toBe(fila(r, "a").proyectada);
    expect(fila(r, "a").horasReales).toBe(35);
  });

  it("horas extra: trabaja más y le toca más", () => {
    // Un día de más (sábado 10): 49 h reales frente a 42 de los demás.
    const extra = semanaDe();
    extra.set("2026-10-10", { programadas: 0, reales: 7, novedad: "horas_extra" });
    const r = calcular({ a: extra, b: semanaDe(), c: semanaDe() });
    expect(Math.abs(fila(r, "a").recalculada - (7_000_000 * 49) / 133)).toBeLessThanOrEqual(1);
    expect(fila(r, "a").recalculada).toBeGreaterThan(fila(r, "b").recalculada);
  });

  it("semana cerrada: rige lo guardado y el mes suma las semanas", () => {
    const guardado = new Map([["a", 0], ["b", 3_500_000], ["c", 3_500_000]]);
    const r = calcular({ a: semanaDe(), b: semanaDe(), c: semanaDe() }, { cerrada: guardado });
    expect(fila(r, "b").vigente).toBe(3_500_000);
    expect(r.porPersona.get("b")!.presupuesto).toBe(3_500_000);
    expect(r.porPersona.get("a")!.presupuesto).toBe(0);
  });

  it("días sin horario: se usan las horas base del mes ÷ días del mes", () => {
    const r = calcular({}, { personas: [ft("a", { horasPlan: 70 }), ft("b", { horasPlan: 35 })] });
    expect(fila(r, "a").horasProgramadas).toBe(70);
    expect(fila(r, "a").proyectada).toBeCloseTo((7_000_000 * 2) / 3, -1);
  });

  it("quien está a mano conserva su presupuesto y el resto se reparte", () => {
    const r = calcular(
      { a: semanaDe(), b: semanaDe(), c: semanaDe() },
      { personas: [ft("a", { manual: 1_000_000 }), ft("b"), ft("c")] },
    );
    expect(fila(r, "a").proyectada).toBe(1_000_000);
    expect(fila(r, "b").proyectada + fila(r, "c").proyectada).toBe(6_000_000);
  });

  it("la venta por hora de la semana queda como tramo desde su inicio", () => {
    const r = calcular({ a: semanaDe(), b: semanaDe(), c: semanaDe() });
    const t = r.porPersona.get("b")!.tramos[0];
    expect(t.desde).toBe("2026-10-04");
    expect(t.venta_hora).toBeCloseTo(2_333_333 / 42, 0);
  });
});
