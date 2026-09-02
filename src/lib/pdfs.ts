"use client";

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { FaltaConfig, Persona, Retardo } from "./types";

const NOMBRE_TIENDA = "Outlet de las Américas";

// Fuentes: pdf-lib no embebe Calibri por defecto; usamos Helvetica que es
// visualmente muy cercana. Si en el futuro queremos usar la tipografía exacta
// de la plantilla, hay que embeber un TTF con embedFont(fetch(...)).

// ---------- Helpers ----------

function fmtDateHuman(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtDateSlashes(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Corta un texto en líneas que no excedan `maxWidth` puntos con la fuente dada. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split(/\n/);
  for (const p of paragraphs) {
    if (!p.trim()) {
      lines.push("");
      continue;
    }
    const words = p.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function drawWrapped(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; maxWidth: number; lineHeight?: number; maxLines?: number },
): void {
  const { x, y, size, font, maxWidth } = opts;
  const lh = opts.lineHeight ?? size * 1.25;
  const maxLines = opts.maxLines ?? Infinity;
  const lines = wrapText(text, font, size, maxWidth).slice(0, maxLines);
  lines.forEach((line, i) => {
    page.drawText(line, { x, y: y - i * lh, size, font, color: rgb(0, 0, 0) });
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadTemplate(path: string): Promise<PDFDocument> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`No pude cargar la plantilla ${path}: ${res.status}`);
  const bytes = await res.arrayBuffer();
  return PDFDocument.load(bytes);
}

// ================================================================
// FEEDBACK
// ================================================================
//
// Coordenadas medidas visualmente sobre el render a 100 DPI de la plantilla A4
// (595.32 × 841.92 pt). Origen pdf-lib: bottom-left. Si al probar quedan
// desalineadas, ajustar aquí — cada tira "Ajuste:" indica la referencia visual.

export async function generarFeedbackPdf(datos: {
  retardo: Retardo;
  persona: Persona;
  jefatura: Persona;
  falta: FaltaConfig;
}): Promise<void> {
  const { retardo, persona, jefatura, falta } = datos;
  const pdf = await loadTemplate("/plantillas/formato-feedback.pdf");
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const S = 10; // tamaño base

  // Cabecera (filas Fecha / Área / Nombre-Cédula)
  page.drawText(fmtDateHuman(todayIso()), { x: 140, y: 733, size: S, font, color: rgb(0, 0, 0) });
  page.drawText(NOMBRE_TIENDA, { x: 140, y: 712, size: S, font, color: rgb(0, 0, 0) });
  page.drawText(persona.nombre, { x: 140, y: 685, size: S, font, color: rgb(0, 0, 0) });
  page.drawText(persona.cedula ?? "—", { x: 500, y: 685, size: S, font, color: rgb(0, 0, 0) });

  // Motivo del Feedback: mostramos la acción del ladder + tipo de falta
  const motivo = `${falta.nombre} — Acción: ${retardo.accion} (Ocurrencia #${retardo.ocurrencia})`;
  drawWrapped(page, motivo, {
    x: 60, y: 640, size: 12, font: bold, maxWidth: 470, lineHeight: 15, maxLines: 3,
  });

  // Descripción de la Situación: párrafo único que no se cuele en la siguiente sección.
  // La sección "Comentarios del Jefe Inmediato" empieza en ~pdf_y 521.
  const minutosTxt = retardo.minutos != null ? ` con ${retardo.minutos} minuto(s) de atraso registrados` : "";
  const obsTxt = retardo.observacion?.trim() ? ` Contexto: ${retardo.observacion.trim()}` : "";
  const descripcion = `El día ${fmtDateHuman(retardo.fecha)}, ${persona.nombre} presentó ${falta.nombre.toLowerCase()}${minutosTxt}.${obsTxt}`;
  drawWrapped(page, descripcion, {
    x: 60, y: 590, size: S, font, maxWidth: 475, lineHeight: 13, maxLines: 5,
  });

  // Firmas (parte inferior).
  // Labels medidas con pdftotext -bbox: "Nombre:" empleado en (x≈24, yMax≈771) →
  // pdf_y baseline ≈ 71. "Cedula:" en yMax≈782 → pdf_y ≈ 60. Empleado a la izquierda,
  // jefe empieza en x≈294. Dato justo a la derecha del ":".
  page.drawText(persona.nombre, { x: 60, y: 71, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(persona.cedula ?? "—", { x: 60, y: 60, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(jefatura.nombre, { x: 330, y: 71, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(jefatura.cedula ?? "—", { x: 330, y: 60, size: 9, font, color: rgb(0, 0, 0) });

  const bytes = await pdf.save();
  const fileSafe = persona.nombre.replace(/\s+/g, "_");
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `Feedback_${fileSafe}_${retardo.fecha}.pdf`);
}

// ================================================================
// PLAN DE TRABAJO
// ================================================================
//
// Plantilla Letter (612 × 792 pt), 2 páginas. Los campos son mayormente
// libres — jefatura ingresa contenido en un modal antes de generar.

export type DatosPlanTrabajo = {
  responsables: string[];      // nombres de personas
  planDeTrabajo: string;       // texto libre (sección 2)
  comentario: string;          // texto libre (sección 5)
  compromisosAcordados: string; // texto libre (sección 6)
  jefatura: Persona;           // quién realiza el feedback
  fecha: string;               // YYYY-MM-DD
};

export async function generarPlanTrabajoPdf(datos: DatosPlanTrabajo): Promise<void> {
  const pdf = await loadTemplate("/plantillas/formato-plan-trabajo.pdf");
  const p1 = pdf.getPage(0);
  const p2 = pdf.getPage(1);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const S = 10;

  // Coordenadas Letter (612×792 pt). Medidas con pdftotext -bbox.

  // Coordenadas: la primera línea de cada sección va ~15pt por debajo del baseline
  // del header para caer sobre la primera línea del cuadro (no encima del título).

  // ---------- Página 1 ----------
  // Sección 1 header baseline ≈ 573
  const respLineas = datos.responsables.length > 0 ? datos.responsables : ["—"];
  respLineas.slice(0, 5).forEach((nombre, i) => {
    p1.drawText(nombre, { x: 100, y: 545 - i * 15, size: S, font, color: rgb(0, 0, 0) });
  });

  // Sección 2 header baseline ≈ 454
  drawWrapped(p1, datos.planDeTrabajo || "—", {
    x: 100, y: 425, size: S, font, maxWidth: 460, lineHeight: 14, maxLines: 10,
  });

  // ---------- Página 2 ----------
  // Sección 5 header baseline ≈ 510 pero es de DOS líneas (el título se
  // desborda), así que la caja de datos empieza ~30pt debajo.
  drawWrapped(p2, datos.comentario || "—", {
    x: 100, y: 460, size: S, font, maxWidth: 460, lineHeight: 14, maxLines: 8,
  });

  // Sección 6 header baseline ≈ 330
  drawWrapped(p2, datos.compromisosAcordados || "—", {
    x: 100, y: 300, size: S, font, maxWidth: 460, lineHeight: 14, maxLines: 8,
  });

  // Pie de página 2 — nombre/cargo del jefe al lado derecho de sus labels
  p2.drawText(datos.jefatura.nombre, { x: 305, y: 197, size: S, font: bold, color: rgb(0, 0, 0) });
  p2.drawText(datos.jefatura.cargo || "—", { x: 305, y: 177, size: S, font: bold, color: rgb(0, 0, 0) });

  // Fecha partida en los tres slots "__ /__ /____"
  const d = new Date(datos.fecha + "T00:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  p2.drawText(dd, { x: 476, y: 108, size: S, font, color: rgb(0, 0, 0) });
  p2.drawText(mm, { x: 502, y: 108, size: S, font, color: rgb(0, 0, 0) });
  p2.drawText(yyyy, { x: 530, y: 108, size: S, font, color: rgb(0, 0, 0) });

  const bytes = await pdf.save();
  const fileSafe = datos.jefatura.nombre.replace(/\s+/g, "_");
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `Plan_Trabajo_${fileSafe}_${datos.fecha}.pdf`);
}
