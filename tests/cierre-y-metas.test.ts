import { describe, expect, it } from "vitest";
import { matchearEmpleadosConRoster } from "@/lib/ventas-pdf";
import { distribuirMetasDiarias, rankingCumplimiento } from "@/lib/presupuestos-calc";

const p = (id: string, nombre: string, codigo: string | null, activo = true) =>
  ({ id, nombre, codigo, activo, rol_jerarquico: "asesor_full" }) as never;

describe("matchearEmpleadosConRoster (cierre del dia)", () => {
  const personal = [p("a", "Andrea Carolina Quintana", "980431"), p("b", "Jose Alexander Aguilar", "981566"), p("c", "Sofia Murcia", "981429")];

  it("cruza por codigo propio, marca huerfanos y ausentes", () => {
    const filas = matchearEmpleadosConRoster({
      empleadosPdf: [
        { codigo: "980431", nombre: "QUINTANA, ANDREA", articulos: 3, venta: 300 },
        { codigo: "555555", nombre: "DESCONOCIDO PEREZ", articulos: 1, venta: 50 },
      ],
      personal,
      codigosAlternos: [],
    });
    expect(filas.find((f) => f.personaId === "a")?.tipo).toBe("matched");
    expect(filas.find((f) => f.empleadoPdf?.codigo === "555555")?.tipo).toBe("huerfano");
    expect(filas.filter((f) => f.tipo === "ausente").map((f) => f.personaId).sort()).toEqual(["b", "c"]);
  });

  it("codigo compartido reparte la venta por porcentaje", () => {
    const filas = matchearEmpleadosConRoster({
      empleadosPdf: [{ codigo: "777", nombre: "CAJA", articulos: 10, venta: 1000 }],
      personal,
      codigosAlternos: [
        { codigo: "777", persona_id: "a", distribucion_pct: 0.6, estado: "aprobado" },
        { codigo: "777", persona_id: "b", distribucion_pct: 0.4, estado: "aprobado" },
      ] as never,
    });
    const m = filas.filter((f) => f.tipo === "matched");
    expect(m.map((f) => f.ventaAsignada)).toEqual([600, 400]);
    expect(m.every((f) => f.compartido)).toBe(true);
  });

  it("codigos alternos no aprobados se ignoran", () => {
    const filas = matchearEmpleadosConRoster({
      empleadosPdf: [{ codigo: "888", nombre: "X", articulos: 1, venta: 10 }],
      personal,
      codigosAlternos: [{ codigo: "888", persona_id: "a", distribucion_pct: 1, estado: "pendiente" }] as never,
    });
    expect(filas.find((f) => f.empleadoPdf)?.tipo).toBe("huerfano");
  });

  it("un ausente con horario de descanso ese dia recibe el motivo por defecto", () => {
    const filas = matchearEmpleadosConRoster({
      empleadosPdf: [],
      personal: [p("a", "Andrea", "1")],
      codigosAlternos: [],
      horarios: [{ persona_id: "a", dia: 30, tipo: "descanso", anio: 2026, mes: 8 }],
      fecha: "2026-08-30",
    });
    expect(filas[0].tipo).toBe("ausente");
    expect(filas[0].motivo).toBe("descanso");
  });

  it("personas inactivas no aparecen como ausentes", () => {
    const filas = matchearEmpleadosConRoster({
      empleadosPdf: [],
      personal: [p("a", "Andrea", "1", false)],
      codigosAlternos: [],
    });
    expect(filas).toHaveLength(0);
  });
});

describe("distribuirMetasDiarias", () => {
  const personal = [p("a", "Ana", "1"), p("b", "Beto", "2")];
  const h = (persona_id: string, anio: number, mes: number, dia: number, tipo: string, horas: number) =>
    ({ persona_id, anio, mes, dia, tipo, horas }) as never;

  it("meta del dia = horas x venta por hora, en un mes que cruza dos meses calendario", () => {
    const periodo = {
      inicio: "2026-08-30",
      fin: "2026-09-01",
      esRetail: true,
      semanas: [],
      fechas: [
        { fecha: "2026-08-30", dia: 30, mes: 8, anio: 2026, weekday: 0 },
        { fecha: "2026-08-31", dia: 31, mes: 8, anio: 2026, weekday: 1 },
        { fecha: "2026-09-01", dia: 1, mes: 9, anio: 2026, weekday: 2 },
      ],
    };
    const r = distribuirMetasDiarias({
      anio: 2026,
      mes: 9,
      personal,
      horarios: [h("a", 2026, 8, 30, "trabajo", 8), h("a", 2026, 8, 31, "descanso", 0), h("a", 2026, 9, 1, "trabajo", 4)],
      ultimoUpload: { venta_por_hora: 100 } as never,
      ventas: [{ persona_id: "a", fecha: "2026-08-30", venta: 1200 }] as never,
      periodo,
    });
    const a = r.get("a")!;
    expect(a.metaMes).toBe(1200);
    expect(a.horasMes).toBe(12);
    expect(a.diasTrabajo).toBe(2);
    expect(a.diasDescanso).toBe(1);
    expect(a.ventaMes).toBe(1200);
    expect(a.metaConVenta).toBe(800);
    expect(a.cumplimientoMes).toBeCloseTo(1.5);
    // Beto sin horarios: todo descanso, meta 0 y sin cumplimiento.
    expect(r.get("b")!.metaMes).toBe(0);
    expect(r.get("b")!.cumplimientoMes).toBeNull();
  });

  it("sin upload la meta es 0 y no se rompe", () => {
    const r = distribuirMetasDiarias({ anio: 2026, mes: 2, personal, horarios: [], ultimoUpload: null });
    expect(r.get("a")!.metaMes).toBe(0);
  });

  it("rankingCumplimiento deja a los sin dato al final", () => {
    const lista = [
      { cumplimientoMes: null, persona: { id: "x" } },
      { cumplimientoMes: 0.5, persona: { id: "y" } },
      { cumplimientoMes: 1.2, persona: { id: "z" } },
    ] as never;
    expect(rankingCumplimiento(lista).map((d: { persona: { id: string } }) => d.persona.id)).toEqual(["z", "y", "x"]);
  });
});
