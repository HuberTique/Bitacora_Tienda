// Genera muestras de los PDFs con datos mock para iterar coordenadas visualmente
// sin necesidad de arrancar el navegador o loguear sesión.
//
// Uso: node scripts/test-pdfs.mjs
// Salida: ./out-pdfs/feedback-sample.pdf, plan-sample.pdf

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const NOMBRE_TIENDA = "Outlet de las Américas";

function fmtDateHuman(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
}
function fmtDateSlashes(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const p of text.split(/\n/)) {
    if (!p.trim()) { lines.push(""); continue; }
    const words = p.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function drawWrapped(page, text, { x, y, size, font, maxWidth, lineHeight, maxLines }) {
  const lh = lineHeight ?? size * 1.25;
  const lines = wrapText(text, font, size, maxWidth).slice(0, maxLines ?? Infinity);
  lines.forEach((line, i) => page.drawText(line, { x, y: y - i * lh, size, font, color: rgb(0, 0, 0) }));
}

// ---------- FEEDBACK ----------
async function generarFeedback() {
  const bytes = readFileSync("public/plantillas/formato-feedback.pdf");
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const S = 10;

  const persona = { nombre: "Adriana Yizeth Castillo Cuevas", cedula: "1031122487", cargo: "ASOCIADO DE VENTAS" };
  const jefatura = { nombre: "Huber Tique Poloche", cedula: "1031125767", cargo: "SUBJEFE" };
  const retardo = { fecha: "2026-07-20", minutos: 2, observacion: "Llegada tarde detectada en el reporte de GeoVictoria del 20-07-2026." };
  const falta = { nombre: "Llegada tarde menor a 10 min" };
  const motivo = `${falta.nombre} — Acción: Feedback Verbal (Ocurrencia #1)`;
  const descripcion = `El día ${fmtDateHuman(retardo.fecha)}, ${persona.nombre} presentó ${falta.nombre.toLowerCase()} con ${retardo.minutos} minuto(s) de atraso registrados. Contexto: ${retardo.observacion}`;

  page.drawText(fmtDateHuman("2026-09-02"), { x: 140, y: 733, size: S, font, color: rgb(0, 0, 0) });
  page.drawText(NOMBRE_TIENDA, { x: 140, y: 712, size: S, font, color: rgb(0, 0, 0) });
  page.drawText(persona.nombre, { x: 140, y: 685, size: S, font, color: rgb(0, 0, 0) });
  page.drawText(persona.cedula, { x: 500, y: 685, size: S, font, color: rgb(0, 0, 0) });
  drawWrapped(page, motivo, { x: 60, y: 640, size: 12, font: bold, maxWidth: 470, lineHeight: 15, maxLines: 3 });
  drawWrapped(page, descripcion, { x: 60, y: 590, size: S, font, maxWidth: 475, lineHeight: 13, maxLines: 5 });
  page.drawText(persona.nombre, { x: 60, y: 71, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(persona.cedula, { x: 60, y: 60, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(jefatura.nombre, { x: 330, y: 71, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(jefatura.cedula, { x: 330, y: 60, size: 9, font, color: rgb(0, 0, 0) });

  const out = await pdf.save();
  writeFileSync("out-pdfs/feedback-sample.pdf", out);
  console.log(`✓ feedback-sample.pdf (${out.byteLength} bytes)`);
}

// ---------- PLAN DE TRABAJO ----------
async function generarPlan() {
  const bytes = readFileSync("public/plantillas/formato-plan-trabajo.pdf");
  const pdf = await PDFDocument.load(bytes);
  const p1 = pdf.getPage(0);
  const p2 = pdf.getPage(1);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const S = 10;

  const responsables = ["Adriana Yizeth Castillo Cuevas", "Andres Macias"];
  const jefatura = { nombre: "Huber Tique Poloche", cargo: "SUBJEFE" };
  const planText = "Reforzar cumplimiento de horario de entrada. Se acuerda revisar los tiempos de traslado al inicio del turno de tarde y coordinar una llegada 5 minutos antes del turno oficial durante las próximas 2 semanas.";
  const comentario = "Se realizó feedback verbal sin novedad. Adriana comprende y acepta el plan.";
  const compromisos = "1) Llegada 5 min antes durante las próximas 2 semanas. 2) Reporte diario a jefatura la primera semana.";

  responsables.slice(0, 5).forEach((n, i) => p1.drawText(n, { x: 100, y: 545 - i * 15, size: S, font, color: rgb(0, 0, 0) }));
  drawWrapped(p1, planText, { x: 100, y: 425, size: S, font, maxWidth: 460, lineHeight: 14, maxLines: 10 });
  drawWrapped(p2, comentario, { x: 100, y: 460, size: S, font, maxWidth: 460, lineHeight: 14, maxLines: 8 });
  drawWrapped(p2, compromisos, { x: 100, y: 300, size: S, font, maxWidth: 460, lineHeight: 14, maxLines: 8 });
  p2.drawText(jefatura.nombre, { x: 305, y: 197, size: S, font: bold, color: rgb(0, 0, 0) });
  p2.drawText(jefatura.cargo, { x: 305, y: 177, size: S, font: bold, color: rgb(0, 0, 0) });
  const fd = new Date("2026-09-02T00:00:00");
  p2.drawText(String(fd.getDate()).padStart(2, "0"), { x: 476, y: 108, size: S, font, color: rgb(0, 0, 0) });
  p2.drawText(String(fd.getMonth() + 1).padStart(2, "0"), { x: 502, y: 108, size: S, font, color: rgb(0, 0, 0) });
  p2.drawText(String(fd.getFullYear()), { x: 530, y: 108, size: S, font, color: rgb(0, 0, 0) });

  const out = await pdf.save();
  writeFileSync("out-pdfs/plan-sample.pdf", out);
  console.log(`✓ plan-sample.pdf (${out.byteLength} bytes)`);
}

mkdirSync("out-pdfs", { recursive: true });
await generarFeedback();
await generarPlan();
