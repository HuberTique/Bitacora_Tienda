// Inspecciona ESTILOS (fills, fonts, bordes, num formats) de una hoja de Excel
// para compararla con otra. Útil para replicar look-and-feel entre plantillas.
//
// Uso: node scripts/inspect-styles.mjs <path xlsx> [nombre hoja] [maxRows]

import ExcelJS from "exceljs";

const path = process.argv[2];
const hojaNombre = process.argv[3] ?? null;
const maxRows = parseInt(process.argv[4] ?? "45", 10);
if (!path) {
  console.error("Uso: node scripts/inspect-styles.mjs <path xlsx> [nombre hoja] [maxRows]");
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const ws = hojaNombre ? wb.getWorksheet(hojaNombre) : wb.worksheets.find((w) => w.state === "visible") ?? wb.worksheets[0];
if (!ws) {
  console.error("No se encontró hoja");
  process.exit(1);
}

console.log(`\n=== ${path} → "${ws.name}" (${ws.rowCount}×${ws.columnCount}) ===\n`);

// Anchos de columnas
console.log("ANCHOS DE COLUMNA (primeras 26):");
for (let c = 1; c <= Math.min(26, ws.columnCount); c++) {
  const col = ws.getColumn(c);
  console.log(`  ${excelCol(c)}: width=${col.width ?? "auto"}`);
}

// Alturas de fila (primeras N)
console.log(`\nALTURAS DE FILA (primeras ${maxRows}):`);
for (let r = 1; r <= Math.min(maxRows, ws.rowCount); r++) {
  const row = ws.getRow(r);
  if (row.height) console.log(`  R${r}: height=${row.height}`);
}

// Estilos por celda (primeras filas × primeras cols)
console.log(`\nESTILOS DE CELDA (primeras ${maxRows} filas × cols B-Y):`);
for (let r = 1; r <= Math.min(maxRows, ws.rowCount); r++) {
  const row = ws.getRow(r);
  for (let c = 2; c <= Math.min(25, ws.columnCount); c++) {
    const cell = row.getCell(c);
    const parts = [];
    // Valor
    let v = cell.value;
    if (v !== null && v !== undefined && v !== "") {
      if (typeof v === "object" && "formula" in v) parts.push(`f=${v.formula}`);
      else if (typeof v === "object" && "richText" in v) parts.push(`t="${v.richText.map((rt) => rt.text).join("")}"`);
      else parts.push(`v="${String(v).slice(0, 20)}"`);
    }
    // Fill
    if (cell.fill && cell.fill.type === "pattern" && cell.fill.pattern === "solid") {
      const argb = cell.fill.fgColor?.argb;
      if (argb) parts.push(`fill=#${argb.slice(-6)}`);
    }
    // Font
    if (cell.font) {
      const font = cell.font;
      const fp = [];
      if (font.bold) fp.push("B");
      if (font.italic) fp.push("I");
      if (font.size) fp.push(`sz${font.size}`);
      if (font.name && font.name !== "Calibri") fp.push(font.name);
      if (font.color?.argb) fp.push(`col#${font.color.argb.slice(-6)}`);
      if (fp.length) parts.push(`font[${fp.join(",")}]`);
    }
    // Border (solo si hay algo)
    if (cell.border) {
      const bp = [];
      for (const side of ["top", "left", "bottom", "right"]) {
        const b = cell.border[side];
        if (b?.style) bp.push(`${side[0]}${b.style[0]}`);
      }
      if (bp.length) parts.push(`bd[${bp.join(",")}]`);
    }
    // Alignment
    if (cell.alignment) {
      const a = cell.alignment;
      const ap = [];
      if (a.horizontal) ap.push(a.horizontal[0]);
      if (a.vertical) ap.push("v" + a.vertical[0]);
      if (a.wrapText) ap.push("wrap");
      if (ap.length) parts.push(`al[${ap.join(",")}]`);
    }
    // NumFmt
    if (cell.numFmt && cell.numFmt !== "General") parts.push(`fmt="${cell.numFmt}"`);
    if (parts.length > 0) {
      console.log(`  ${cell.address}: ${parts.join(" | ")}`);
    }
  }
}

// Merges
console.log(`\nMERGES (todos):`);
const merges = ws.model.merges ?? [];
for (const m of merges.slice(0, 60)) console.log(`  ${m}`);
if (merges.length > 60) console.log(`  ... y ${merges.length - 60} más (total ${merges.length})`);

function excelCol(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
