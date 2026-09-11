import ExcelJS from "exceljs";
const path = process.argv[2];
const hoja = process.argv[3];
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const s = wb.getWorksheet(hoja);
if (!s) { console.error("Sin hoja"); process.exit(1); }
console.log(`=== ${hoja} (${s.rowCount}x${s.columnCount}) ===`);
for (let r = 1; r <= Math.min(45, s.rowCount); r++) {
  const row = s.getRow(r);
  const cells = [];
  for (let c = 1; c <= Math.min(12, s.columnCount); c++) {
    const cell = row.getCell(c);
    let v = cell.value;
    if (v && typeof v === "object" && "result" in v) v = v.result;
    if (v && typeof v === "object" && "richText" in v) v = v.richText.map(rt => rt.text).join("");
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    v = String(v ?? "").slice(0, 22);
    cells.push(v);
  }
  console.log(`R${r}: ${cells.map(c => `"${c}"`).join(" | ")}`);
}
