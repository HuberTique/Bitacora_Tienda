// Mapea, para una hoja específica del template, todos los bloques de semana:
// dónde empieza el header ("CARGO | NOMBRE | LUNES X"), qué columnas son
// entrada/salida/almuerzo, y qué rango de filas ocupan las personas.

import ExcelJS from "exceljs";

const path = process.argv[2];
const hojaNombre = process.argv[3] ?? "HORARIOS FEBRERO";
if (!path) {
  console.error("Uso: node scripts/map-week-blocks.mjs <path xlsx> [nombre hoja]");
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const ws = wb.getWorksheet(hojaNombre);
if (!ws) {
  console.error(`Hoja no encontrada: "${hojaNombre}". Disponibles:`, wb.worksheets.map(w => w.name));
  process.exit(1);
}

console.log(`\n=== ${ws.name} (${ws.rowCount} filas × ${ws.columnCount} cols) ===\n`);

// Buscar filas que sean "header de semana" — contienen "CARGO" en B/C/D y "LUNES" en alguna celda
const headerRows = [];
for (let r = 1; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  let esHeader = false;
  let cargoCol = null;
  let nombreCol = null;
  let primerDiaCol = null;
  let primerDiaTxt = null;
  for (let c = 1; c <= 5; c++) {
    const v = String(row.getCell(c).value ?? "").trim().toUpperCase();
    if (v === "CARGO") cargoCol = c;
    if (v === "NOMBRE") nombreCol = c;
  }
  if (cargoCol && nombreCol) {
    // Buscar primera celda con "LUNES", "MARTES", etc.
    for (let c = nombreCol + 1; c <= ws.columnCount; c++) {
      const v = String(row.getCell(c).value ?? "").trim().toUpperCase();
      if (/^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)/.test(v)) {
        primerDiaCol = c;
        primerDiaTxt = v;
        esHeader = true;
        break;
      }
    }
  }
  if (esHeader) {
    headerRows.push({ r, cargoCol, nombreCol, primerDiaCol, primerDiaTxt });
  }
}

console.log(`Filas header de semana encontradas: ${headerRows.length}\n`);
for (const h of headerRows) {
  console.log(`  Fila ${h.r}: CARGO col ${h.cargoCol}, NOMBRE col ${h.nombreCol}, primer día "${h.primerDiaTxt}" en col ${h.primerDiaCol}`);
}

// Para el primer header, imprimir todas las columnas de días (7 días × 3 sub-cols = 21 cols)
if (headerRows.length > 0) {
  const h0 = headerRows[0];
  console.log(`\nColumnas de días del primer header (fila ${h0.r}):`);
  for (let c = h0.primerDiaCol; c < h0.primerDiaCol + 22; c++) {
    const v = String(ws.getRow(h0.r).getCell(c).value ?? "").trim();
    console.log(`  col ${c} (${excelCol(c)}): "${v}"`);
  }
}

// Distancia entre headers de semana (útil para calcular altura de cada bloque)
if (headerRows.length > 1) {
  console.log(`\nDistancia entre headers de semana:`);
  for (let i = 1; i < headerRows.length; i++) {
    console.log(`  Semana ${i} a Semana ${i + 1}: ${headerRows[i].r - headerRows[i - 1].r} filas`);
  }
}

// Fila de conteo (COUNT formulas) — está justo antes del siguiente bloque o al final del último
console.log(`\nBuscando filas de conteo (COUNT formulas) por bloque:`);
for (const h of headerRows) {
  const inicioRango = h.r + 1;
  const finRango = ws.rowCount; // buscar hasta el final
  for (let r = inicioRango; r <= finRango; r++) {
    const cell = ws.getRow(r).getCell(h.primerDiaCol);
    if (cell.formula?.startsWith("COUNT")) {
      console.log(`  Header fila ${h.r} → COUNT en fila ${r} (${r - h.r - 1} filas de personas)`);
      break;
    }
  }
}

function excelCol(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
