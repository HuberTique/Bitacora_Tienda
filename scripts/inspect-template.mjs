// Inspecciona la estructura de la plantilla oficial de horarios para entender:
//   - Cuántas hojas tiene y sus nombres
//   - Dimensiones (rango usado) de cada hoja
//   - Fórmulas presentes (celda → fórmula) y referencias entre hojas
//   - Merges (celdas combinadas)
//   - Contenido de las primeras 30 filas × 20 columnas por hoja
//
// Uso: node scripts/inspect-template.mjs "<path al xlsx>"

import ExcelJS from "exceljs";

const path = process.argv[2];
if (!path) {
  console.error("Uso: node scripts/inspect-template.mjs <ruta al xlsx>");
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);

console.log(`\n=== ARCHIVO: ${path} ===`);
console.log(`Hojas: ${wb.worksheets.length}\n`);

for (const ws of wb.worksheets) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`HOJA: "${ws.name}"  (id=${ws.id}, state=${ws.state})`);
  console.log(`Dimensiones: ${ws.rowCount} filas × ${ws.columnCount} columnas`);
  console.log(`Rango usado: ${ws.dimensions?.model?.tl ?? "?"} → ${ws.dimensions?.model?.br ?? "?"}`);

  // Merges
  if (ws.model?.merges?.length) {
    console.log(`Merges (${ws.model.merges.length}):`);
    ws.model.merges.slice(0, 20).forEach((m) => console.log(`  - ${m}`));
    if (ws.model.merges.length > 20) console.log(`  ... y ${ws.model.merges.length - 20} más`);
  }

  // Contenido de las primeras filas
  console.log(`\nContenido (primeras 35 filas, hasta col 20):`);
  const maxRows = Math.min(35, ws.rowCount);
  const maxCols = Math.min(20, ws.columnCount);
  for (let r = 1; r <= maxRows; r++) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= maxCols; c++) {
      const cell = row.getCell(c);
      let v = cell.value;
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "object" && "formula" in v) {
        cells.push(`${cell.address}=${JSON.stringify(v)}`);
      } else if (typeof v === "object" && "richText" in v) {
        cells.push(`${cell.address}="${v.richText.map((rt) => rt.text).join("")}"`);
      } else {
        const s = String(v).replace(/\s+/g, " ").slice(0, 40);
        cells.push(`${cell.address}="${s}"`);
      }
    }
    if (cells.length) console.log(`  R${r}: ${cells.join(" | ")}`);
  }

  // Fórmulas (todas, no solo las primeras filas)
  console.log(`\nTodas las fórmulas de esta hoja:`);
  let formulaCount = 0;
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.formula || cell.type === ExcelJS.ValueType.Formula) {
        formulaCount++;
        if (formulaCount <= 30) {
          console.log(`  ${cell.address}: =${cell.formula ?? cell.value?.formula}`);
        }
      }
    });
  });
  if (formulaCount > 30) console.log(`  ... y ${formulaCount - 30} más (total ${formulaCount})`);
  else if (formulaCount === 0) console.log(`  (ninguna)`);
}

console.log(`\n${"=".repeat(70)}\nFIN\n`);
