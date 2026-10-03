// Precios promedio del bloque "PRECIO PROMEDIO" de la hoja Kpis mensual del
// planeador (PARES / ROPA / ACCESORIOS con su valor al lado). Si no está, null.

import ExcelJS from "exceljs";

export type PreciosLeidos = { pares: number | null; accesorios: number | null; ropa: number | null };

const norm = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

function valor(c: ExcelJS.Cell): unknown {
  const v = c.value as unknown;
  if (v && typeof v === "object" && "result" in (v as object)) return (v as { result?: unknown }).result;
  return v;
}

export async function leerPreciosPromedio(archivo: ArrayBuffer): Promise<PreciosLeidos | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(archivo);
  } catch {
    return null;
  }
  for (const ws of wb.worksheets) {
    let filaTitulo = 0;
    ws.eachRow((row, r) => {
      if (filaTitulo) return;
      row.eachCell((c) => {
        if (norm(valor(c)) === "precio promedio") filaTitulo = r;
      });
    });
    if (!filaTitulo) continue;
    const out: PreciosLeidos = { pares: null, accesorios: null, ropa: null };
    for (let r = filaTitulo + 1; r <= Math.min(ws.rowCount, filaTitulo + 6); r++) {
      const row = ws.getRow(r);
      let etiqueta = "";
      let numero: number | null = null;
      row.eachCell((c) => {
        const v = valor(c);
        const t = norm(v);
        if (t === "pares" || t === "calzado") etiqueta = "pares";
        else if (t.startsWith("accesorio") || t === "acc") etiqueta = "accesorios";
        else if (t === "ropa") etiqueta = "ropa";
        else if (typeof v === "number" && v > 1000) numero = v;
      });
      if (etiqueta && numero != null) out[etiqueta as keyof PreciosLeidos] = numero;
    }
    if (out.pares || out.accesorios || out.ropa) return out;
  }
  return null;
}
