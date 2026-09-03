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

  const persona = { nombre: "Adriana Yizeth Castillo Cuevas", cedula: "1031122487" };
  const jefatura = { nombre: "Huber Tique Poloche", cedula: "1031125767" };
  const descripcion = "Llegada tarde de 2 minutos al turno del 20 de julio de 2026, primera vez en el periodo.";
  const comentariosJefe = "Adriana, recuerda que el horario de la tienda se publica todos los viernes con anticipación para la semana siguiente. Esto te permite programar tu ruta y llegar al menos 5 minutos antes del turno. Cuento contigo para mantener la puntualidad y dar buen ejemplo al equipo.";
  const planAccion = "Adriana se compromete a llegar 5 minutos antes de la hora de entrada durante las próximas 2 semanas. Jefatura hará seguimiento diario la primera semana y retroalimentación al cierre del periodo.";

  // whiteOut watermarks
  const wo = (x, yTop, x1, yBottom) => page.drawRectangle({
    x, y: 841.92 - yBottom, width: x1 - x, height: yBottom - yTop, color: rgb(1, 1, 1),
  });
  wo(25, 193, 561, 314.5);
  wo(25, 591.7, 561, 689.1);

  page.drawText(fmtDateHuman("2026-09-02"), { x: 120, y: 728, size: 10, font, color: rgb(0, 0, 0) });
  page.drawText(NOMBRE_TIENDA, { x: 120, y: 708, size: 10, font, color: rgb(0, 0, 0) });
  page.drawText(persona.nombre, { x: 120, y: 685, size: 10, font, color: rgb(0, 0, 0) });
  page.drawText(persona.cedula, { x: 480, y: 680, size: 10, font, color: rgb(0, 0, 0) });
  drawWrapped(page, descripcion, { x: 40, y: 636, size: 9.5, font, maxWidth: 500, lineHeight: 12, maxLines: 9 });
  drawWrapped(page, comentariosJefe, { x: 40, y: 491, size: 9.5, font, maxWidth: 500, lineHeight: 12, maxLines: 10 });
  drawWrapped(page, planAccion, { x: 40, y: 238, size: 9.5, font, maxWidth: 500, lineHeight: 12, maxLines: 8 });
  page.drawText(persona.nombre, { x: 58, y: 71, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(persona.cedula, { x: 55, y: 60, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(jefatura.nombre, { x: 328, y: 71, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(jefatura.cedula, { x: 325, y: 60, size: 9, font, color: rgb(0, 0, 0) });

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

  const responsables = "Adriana Yizeth Castillo Cuevas, Andres Macias";
  const jefatura = { nombre: "Huber Tique Poloche", cargo: "SUBJEFE" };
  const planText = "Reforzar el cumplimiento del horario de entrada mediante seguimiento semanal. Se acuerda revisar los tiempos de traslado al inicio del turno de tarde y coordinar una llegada al menos 5 minutos antes del turno oficial durante las próximas 2 semanas.";
  const compromisosTrabajador = "Me comprometo a llegar al menos 5 minutos antes del inicio de mi turno durante las próximas 2 semanas y a reportar cualquier eventualidad que pueda afectar mi puntualidad con anticipación.";
  const comentario = "Feedback verbal sin novedad. La colaboradora comprende y acepta el plan.";
  const compromisos = [
    { texto: "Llegar 5 min antes del turno", fecha: "16/09/2026" },
    { texto: "Reporte diario a jefatura primera semana", fecha: "09/09/2026" },
    { texto: "Ajustar ruta de traslado", fecha: "05/09/2026" },
  ];
  const responsabilidadesJefe = [
    { texto: "Seguimiento semanal a puntualidad", fecha: "16/09/2026" },
    { texto: "Retroalimentación al final de las 2 semanas", fecha: "16/09/2026" },
  ];

  // Sección 1: responsables (texto libre)
  drawWrapped(p1, responsables, { x: 100, y: 545, size: S, font, maxWidth: 430, lineHeight: 15, maxLines: 5 });
  // Sección 2: plan
  drawWrapped(p1, planText, { x: 100, y: 425, size: S, font, maxWidth: 425, lineHeight: 14, maxLines: 10 });
  // Sección 3: tabla compromisos (7 filas máx)
  compromisos.slice(0, 7).forEach((r, i) => {
    const y = 202 - i * 16;
    if (r.texto) p1.drawText(r.texto, { x: 95, y, size: 9, font, color: rgb(0, 0, 0) });
    if (r.fecha) p1.drawText(r.fecha, { x: 435, y, size: 9, font, color: rgb(0, 0, 0) });
  });
  // Sección 4: tabla responsabilidades (página 2)
  responsabilidadesJefe.slice(0, 7).forEach((r, i) => {
    const y = 637 - i * 16;
    if (r.texto) p2.drawText(r.texto, { x: 95, y, size: 9, font, color: rgb(0, 0, 0) });
    if (r.fecha) p2.drawText(r.fecha, { x: 435, y, size: 9, font, color: rgb(0, 0, 0) });
  });
  // Sección 5: comentario
  drawWrapped(p2, comentario, { x: 100, y: 462, size: S, font, maxWidth: 425, lineHeight: 14, maxLines: 8 });
  // Sección 6: compromisos del trabajador
  drawWrapped(p2, compromisosTrabajador, { x: 100, y: 300, size: S, font, maxWidth: 425, lineHeight: 14, maxLines: 8 });
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
