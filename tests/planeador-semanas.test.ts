import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { leerTargetDesdeArchivo } from "@/lib/planeador-excel";

// Hoja Target como la de octubre 2026 de la 691: 35 fechas, pero la "Semana 5"
// (1 al 7 de noviembre) viene sin meta ni venta. El mes retail son 4 semanas.
async function hojaTarget(diasConMeta: number, diasTotales: number, inicio = "2026-10-04"): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Target");
  ws.getCell("D1").value = "691 CENTRO MAYOR";
  ws.addRow([]);
  ws.addRow(["Octubre", "FECHA", "TARGET", "2025", "REAL"]);
  const d0 = new Date(inicio + "T00:00:00Z");
  for (let i = 0; i < diasTotales; i++) {
    const f = new Date(d0.getTime() + i * 86_400_000);
    ws.addRow([null, f, i < diasConMeta ? 1_000_000 : null, i < diasConMeta ? 900_000 : null, null]);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("hoja Target: el mes retail son las semanas con datos", () => {
  it("octubre: 35 fechas con la semana 5 en blanco → 4 semanas, 4-oct a 31-oct", async () => {
    const t = await leerTargetDesdeArchivo(await hojaTarget(28, 35));
    if ("error" in t) throw new Error(t.error);
    expect(t.inicio).toBe("2026-10-04");
    expect(t.fin).toBe("2026-10-31");
    expect(t.dias).toHaveLength(28);
    expect(t.semanas).toHaveLength(4);
    expect(t.semanas.at(-1)).toMatchObject({ inicio: "2026-10-25", fin: "2026-10-31" });
    expect(t.presupuesto).toBe(28_000_000);
  });

  it("un mes de 5 semanas con datos se queda con sus 5", async () => {
    const t = await leerTargetDesdeArchivo(await hojaTarget(35, 35));
    if ("error" in t) throw new Error(t.error);
    expect(t.semanas).toHaveLength(5);
    expect(t.fin).toBe("2026-11-07");
  });

  it("sin ninguna meta avisa en vez de inventar el mes", async () => {
    const t = await leerTargetDesdeArchivo(await hojaTarget(0, 35));
    expect("error" in t && t.error).toMatch(/no tiene metas/);
  });
});
