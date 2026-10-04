import { describe, expect, it } from "vitest";
import { matchearEmpleadosConRoster } from "@/lib/ventas-pdf";
import { distribuirMetasDiarias, rankingCumplimiento, semanasDelPeriodo } from "@/lib/presupuestos-calc";

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

  it("meta del dia = presupuesto del mes repartido por las horas de cada dia, en un mes que cruza dos meses calendario", () => {
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
      presupuestos: new Map([["a", 1200], ["b", 900]]),
      ventas: [{ persona_id: "a", fecha: "2026-08-30", venta: 1200 }] as never,
      periodo,
    });
    const a = r.get("a")!;
    expect(a.metaMes).toBe(1200);
    // 8 h de 12 → 800; 4 h de 12 → 400: la suma cuadra con el presupuesto.
    expect(a.diaria.get("2026-08-30")!.meta).toBe(800);
    expect(a.diaria.get("2026-09-01")!.meta).toBe(400);
    expect(a.horasMes).toBe(12);
    expect(a.diasTrabajo).toBe(2);
    expect(a.diasDescanso).toBe(1);
    expect(a.ventaMes).toBe(1200);
    expect(a.metaConVenta).toBe(800);
    expect(a.cumplimientoMes).toBeCloseTo(1.5);
    expect(a.sinHorario).toBe(false);
    // Beto tiene presupuesto pero no horario: meta del mes conocida, sin reparto por dia.
    const b = r.get("b")!;
    expect(b.metaMes).toBe(900);
    expect(b.sinHorario).toBe(true);
    expect([...b.diaria.values()].every((d) => d.meta === 0)).toBe(true);
    expect(b.cumplimientoMes).toBeNull();
  });

  it("con venta por hora guardada: meta = venta por hora vigente × horas de venta del día", () => {
    const fechas = ["2026-10-04", "2026-10-05", "2026-10-06"].map((fecha, i) => ({ fecha, dia: 4 + i, mes: 10, anio: 2026, weekday: i }));
    const periodo = { inicio: "2026-10-04", fin: "2026-10-06", esRetail: false, semanas: [], fechas };
    const geo = (dia: number, horas: number) => ({ persona_id: "a", anio: 2026, mes: 10, dia, tipo: "trabajo", horas, origen: "geovictoria" }) as never;
    const r = distribuirMetasDiarias({
      anio: 2026,
      mes: 10,
      personal: [p("a", "Ana", "1")],
      horarios: [geo(4, 8), geo(5, 8), geo(6, 9)],
      presupuestos: new Map([["a", 999]]),
      periodo,
      // Hasta el 4 rige 1.000/h; desde el 5, 1.500/h (se recalculó con GeoVictoria).
      tarifas: new Map([["a", [{ desde: "2026-10-01", venta_hora: 1000 }, { desde: "2026-10-05", venta_hora: 1500 }]]]),
      factores: { jefe: 0.25, subjefe: 1 / 3, cajero: 0.5 },
    });
    const a = r.get("a")!;
    expect(a.diaria.get("2026-10-04")!.meta).toBe(8000); // las horas de GeoVictoria ya son netas
    expect(a.diaria.get("2026-10-05")!.meta).toBe(12000);
    expect(a.diaria.get("2026-10-06")!.meta).toBe(13500);
  });

  it("sin presupuesto la meta es 0 y no se rompe", () => {
    const r = distribuirMetasDiarias({ anio: 2026, mes: 2, personal, horarios: [], presupuestos: new Map() });
    expect(r.get("a")!.metaMes).toBe(0);
    expect(r.get("a")!.sinHorario).toBe(false);
  });

  it("semanasDelPeriodo: retail de domingo a sabado", () => {
    const fechas = Array.from({ length: 10 }, (_, i) => ({ fecha: `d${i}`, dia: i + 1, mes: 9, anio: 2026, weekday: i % 7 }));
    const semanas = semanasDelPeriodo({ inicio: "d0", fin: "d9", esRetail: true, semanas: [], fechas } as never);
    expect(semanas.map((s) => s.length)).toEqual([7, 3]);
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
