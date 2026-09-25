import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { leerKpisMensualDesdeArchivo, type KpisMensualParsed, type PersonaMatch } from "@/lib/kpis-mensual-excel";

const roster: PersonaMatch[] = [
  { id: "yaj", nombre: "Yajaira Rodriguez Suarez", cedula: "1", codigo: "981404", activo: true, rol_jerarquico: "jefe_tienda" },
  { id: "joh", nombre: "John Ediber Bonilla Moreno", cedula: "2", codigo: "981730", activo: true, rol_jerarquico: "subjefe" },
  { id: "and", nombre: "Andrea Carolina Quintana", cedula: "3", codigo: "980431", activo: true, rol_jerarquico: "cajero" },
  { id: "lis", nombre: "Lisseth Dayanna Salazar Sanchez", cedula: "4", codigo: "981416", activo: true, rol_jerarquico: "asesor_full" },
  { id: "mac", nombre: "Andres Camilo Macias", cedula: "5", codigo: "981549", activo: true, rol_jerarquico: "asesor_part" },
  { id: "yun", nombre: "Yunli Meiling Fonseca Ramirez", cedula: "6", codigo: "981558", activo: true, rol_jerarquico: "asesor_full" },
];

/** Libro con la misma estructura del planeador: cuadro superior con CM y cuadro de KPIs sin CM. */
async function libro(filasTop: [string, string, string, number][], filasKpi: [string, string, number, number][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kpis mensual");
  ws.getCell("A1").value = "SEPTIEMBRE";
  ws.getCell("A2").value = "Presupuesto MES";
  ws.getCell("C2").value = 500000;
  ws.getCell("A3").value = "Horas Laboradas";
  ws.getCell("C3").value = 900;
  ws.getRow(5).values = ["CM", "CARGO", "NOMBRE", "PRESUPUESTO MENSUAL", "HORAS"];
  let r = 6;
  for (const [cm, cargo, nombre, pto] of filasTop) ws.getRow(r++).values = [cm, cargo, nombre, pto, 40];
  ws.getRow(r++).values = ["", "TOTAL", "TOTAL", 1, 1];
  r++;
  ws.getRow(r++).values = ["", "CUADRO KPIS"];
  ws.getRow(r++).values = ["", "NOMBRE", "NOMBRE", "PTO", "ACUMULADO BRUTO", "ACUMULADO NETO", "%"];
  ws.getRow(r++).values = ["", "NOMBRE", "NOMBRE", "PTO", "ACUMULADO BRUTO", "ACUMULADO NETO", "%"];
  for (const [cargo, nombre, pto, neto] of filasKpi) {
    ws.getRow(r++).values = ["", cargo, nombre, pto, neto * 1.1, neto, neto / pto];
  }
  ws.getRow(r++).values = ["", "TOTAL", "TOTAL", 1, 1, 1, 1];

  const pl = wb.addWorksheet("Plantilla");
  pl.getRow(1).values = ["COLABORADOR", "CEDULA", "CARGO", "CM"];
  pl.getRow(2).values = ["Andres Camilo Macias", "5", "Part Time", "981549"];
  pl.getRow(3).values = ["Lisseth Dayanna Salazar Sanchez", "4", "Full Time", "981416"];
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

function ok(r: KpisMensualParsed | { error: string }): KpisMensualParsed {
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("leerKpisMensualDesdeArchivo", () => {
  const top: [string, string, string, number][] = [
    ["981404", "JEFE", "YAJAIRA", 100],
    ["981730", "SUB.JEFE", "JOHN", 100],
    ["980431", "CAJERA", "ANDREA", 100],
    ["981416", "FULL", "DAYANA", 100],
    ["981549", "PAR TIME", "ANDRES", 100],
    ["980111", "FULL", "GERALDINE", 100],
  ];
  const kpi: [string, string, number, number][] = [
    ["JEFE", "YAJAIRA", 100, 50],
    ["SUB.JEFE", "JOHN", 100, 50],
    ["CAJERA", "ANDREA", 100, 120],
    ["FULL", "DAYANA", 100, 90],
    ["PAR TIME", "ANDRES", 100, 80],
    ["FULL", "GERALDINE", 100, 70],
  ];

  it("toma el CM del cuadro superior y cruza con Personal", async () => {
    const p = ok(await leerKpisMensualDesdeArchivo(await libro(top, kpi), roster));
    const f = (n: string) => p.filas.find((x) => x.nombreExcel === n)!;
    expect(f("ANDRES").cmExcel).toBe("981549");
    expect(f("ANDRES").personaId).toBe("mac");
    expect(f("ANDRES").metodo).toBe("cm");
  });

  it("DAYANA (nombre distinto) se asigna por el CM a Lisseth Dayanna, con aviso", async () => {
    const p = ok(await leerKpisMensualDesdeArchivo(await libro(top, kpi), roster));
    const d = p.filas.find((x) => x.nombreExcel === "DAYANA")!;
    expect(d.personaId).toBe("lis");
    expect(d.alertas.some((a) => a.nivel === "aviso" && /parecido/.test(a.texto))).toBe(true);
    expect(d.alertas.some((a) => a.nivel === "error")).toBe(false);
  });

  it("un CM que no esta en Personal se marca con error y no se asigna", async () => {
    const p = ok(await leerKpisMensualDesdeArchivo(await libro(top, kpi), roster));
    const g = p.filas.find((x) => x.nombreExcel === "GERALDINE")!;
    expect(g.personaId).toBeNull();
    expect(g.alertas.some((a) => a.nivel === "error" && /no est/.test(a.texto))).toBe(true);
  });

  it("jefe y subjefe se omiten (auditan)", async () => {
    const p = ok(await leerKpisMensualDesdeArchivo(await libro(top, kpi), roster));
    expect(p.filas.filter((f) => f.omitir).map((f) => f.nombreExcel).sort()).toEqual(["JOHN", "YAJAIRA"]);
  });

  it("un CM de otra persona con nombre que no se parece es error, no se asigna", async () => {
    const malo: [string, string, string, number][] = top.map((t) => (t[2] === "ANDRES" ? ["980431", t[1], t[2], t[3]] : t));
    const p = ok(await leerKpisMensualDesdeArchivo(await libro(malo, kpi), roster));
    const a = p.filas.find((x) => x.nombreExcel === "ANDRES")!;
    expect(a.personaId).toBeNull();
    expect(a.alertas.some((x) => x.nivel === "error")).toBe(true);
  });

  it("dos filas que apuntan a la misma persona no se asignan solas", async () => {
    const dup: [string, string, number, number][] = [...kpi, ["FULL", "ANDRES", 100, 10]];
    const p = ok(await leerKpisMensualDesdeArchivo(await libro(top, dup), roster));
    const filas = p.filas.filter((x) => x.nombreExcel === "ANDRES");
    expect(filas).toHaveLength(2);
    filas.forEach((f) => expect(f.personaId).toBeNull());
  });

  it("detecta el mes y valida numeros (neto sin presupuesto)", async () => {
    const p = ok(await leerKpisMensualDesdeArchivo(await libro(top, kpi), roster));
    expect(p.mesDetectado).toBe(9);
    expect(p.presupuestoTotal).toBe(500000);
  });

  it("archivo sin hoja de KPIs devuelve error legible", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Otra");
    const r = await leerKpisMensualDesdeArchivo((await wb.xlsx.writeBuffer()) as ArrayBuffer, roster);
    expect("error" in r && /Kpis mensual/.test(r.error)).toBe(true);
  });
});
