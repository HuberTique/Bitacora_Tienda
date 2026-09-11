import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(process.argv[2]);
const hoja = process.argv[3];
const ws = hoja ? wb.getWorksheet(hoja) : wb.worksheets.find((w) => w.state === "visible") ?? wb.worksheets[0];
if (!ws) { console.error("hoja no"); process.exit(1); }
const colors = new Map();
ws.eachRow((row) => {
  row.eachCell((cell) => {
    if (cell.fill?.type === "pattern" && cell.fill?.pattern === "solid") {
      const argb = cell.fill.fgColor?.argb;
      if (argb) {
        if (!colors.has(argb)) colors.set(argb, []);
        colors.get(argb).push(cell.address);
      }
    }
  });
});
console.log(`Hoja: "${ws.name}" — ${colors.size} colores únicos:`);
for (const [c, cells] of colors) {
  console.log(`  ${c} (${cells.length} celdas): ${cells.slice(0, 12).join(", ")}${cells.length > 12 ? ` ... +${cells.length - 12}` : ""}`);
}

// También muestra número formats únicos
const fmts = new Map();
ws.eachRow((row) => {
  row.eachCell((cell) => {
    if (cell.numFmt) {
      if (!fmts.has(cell.numFmt)) fmts.set(cell.numFmt, 0);
      fmts.set(cell.numFmt, fmts.get(cell.numFmt) + 1);
    }
  });
});
console.log("\nFormatos numéricos únicos:");
for (const [f, n] of fmts) console.log(`  "${f}" — ${n} celdas`);
