"use client";

// PDF de la "Evaluación del vendedor — Magia con una sonrisa" sobre los
// FORMATOS OFICIALES de la compañía (public/plantillas/magia-concept.pdf y
// magia-outlet.pdf, entregados por Huber el 4-oct-2026). No se dibuja ningún
// formato propio: solo se escriben los resultados encima, sin tocar el diseño.
//
// Un archivo por persona y BIMESTRE (enero-febrero, marzo-abril, …):
//   * Hojas 1 y 2 del formato, una vez por cada evaluación del bimestre:
//     nombre, tienda y fecha; una X en la casilla 1-4 de cada letra y de la
//     impresión final; en TOTAL, los puntos de cada columna; fortalezas y
//     oportunidades en las líneas del detalle, y el punto del mes en la
//     cuadrícula Gestión/Resultados, en su casilla y con el color del ejemplo.
//   * Hoja 3 (plantilla de resultados): Evaluación 1 (primer mes), Evaluación 2
//     (segundo mes) y el promedio del bimestre. La imagen de ejemplo de esa
//     hoja no se toca. El histórico completo queda en la app.
// Las firmas quedan en blanco para firmar a mano.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { NOMBRES_MES } from "./horarios";
import { MAGIA_PUNTOS_MAX, totalMagia, type MagiaEvaluacion } from "./ranking";
import {
  COLOR_CUADRANTE,
  MAGIA_ITEMS,
  avanceEnCasilla,
  cuadranteMagia,
  normalizarFormato,
  promedioMagia,
  redondear1,
  type FormatoTienda,
  type NivelMagia,
} from "./magia";
import { downloadBlob, wrapText } from "./pdfs";
import { assetPath } from "./asset-path";

export type DatosMagiaPdf = {
  evaluado: string;
  /** Como debe salir en el formato, p. ej. "690 · MALL PLAZA NQS". */
  tienda: string;
  anio: number;
  /** Primer mes del bimestre (1, 3, 5, 7, 9 u 11). */
  mesInicio: number;
  /** Evaluación del primer mes y del segundo (null si aún no se ha hecho). */
  evaluacion1: MagiaEvaluacion | null;
  evaluacion2: MagiaEvaluacion | null;
};

export type PlantillasMagia = Record<FormatoTienda, ArrayBuffer | Uint8Array>;

/** Primer mes del bimestre al que pertenece un mes: 9 y 10 → 9; 11 y 12 → 11. */
export function inicioBimestre(mes: number): number {
  return mes % 2 === 1 ? mes : mes - 1;
}

export function nombreBimestre(anio: number, mesInicio: number): string {
  const a = NOMBRES_MES[mesInicio - 1] ?? "";
  const b = NOMBRES_MES[mesInicio] ?? "";
  const may = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${may(a)}-${b} ${anio}`;
}

// ---------- Medidas de los formatos (puntos, medidas desde ARRIBA de la hoja) ----------

type Hoja1 = {
  /** Borde izquierdo de la tabla. */
  izq: number;
  /** Borde derecho de la columna de textos y de las columnas 1, 2, 3 y 4. */
  cols: [number, number, number, number, number];
  /** Filas M, A, G, I, A, impresión final y TOTAL: [arriba, abajo]. */
  filas: [number, number][];
};
type Hoja2 = {
  /** Líneas de "Detalle fortalezas y oportunidades para mejorar". */
  lineasDetalle: number[];
  /** Centro de la cruz y extremos de los ejes. */
  cruz: { cx: number; cy: number; x0: number; x1: number; y0: number; y1: number };
};
type Hoja3 = {
  /** Columnas Evaluación 1, Evaluación 2 y Promedio Mes: [izquierda, derecha]. */
  tabla: [number, number][];
  /** Línea base de los valores de la tabla. */
  topValores: number;
  /** Renglones (borde inferior) de los cuadros "Evaluación 1" y "Evaluación 2". */
  renglones1: number[];
  renglones2: number[];
};

const HOJA1: Record<FormatoTienda, Hoja1> = {
  concept: {
    izq: 79.5,
    cols: [187.3, 270.5, 354, 437, 520.5],
    filas: [[283.5, 349], [349, 426.8], [426.8, 491.8], [491.8, 544], [544, 621.8], [621.8, 660.5], [660.5, 699]],
  },
  outlet: {
    izq: 85.8,
    cols: [193.3, 276.5, 360, 443.5, 526.8],
    filas: [[283.5, 361.8], [361.8, 426.8], [426.8, 504.5], [504.5, 569.5], [569.5, 647.3], [647.3, 686.3], [686.3, 724.5]],
  },
};
const HOJA2: Record<FormatoTienda, Hoja2> = {
  concept: { lineasDetalle: [105.5, 118.5, 131, 143.5], cruz: { cx: 289.8, cy: 302.5, x0: 113, x1: 475, y0: 156, y1: 461 } },
  outlet: { lineasDetalle: [104.5, 117, 130, 142.5], cruz: { cx: 288.8, cy: 356.5, x0: 110, x1: 486, y0: 215, y1: 518 } },
};
const HOJA3: Record<FormatoTienda, Hoja3> = {
  concept: {
    tabla: [[85, 152], [152, 220], [220, 314.5]],
    topValores: 312,
    renglones1: [467, 477.8, 488.5],
    renglones2: [558.8, 569.3, 580, 590.8, 605, 619.8],
  },
  outlet: {
    tabla: [[85, 157], [157, 229], [229, 301]],
    topValores: 298,
    renglones1: [439.5, 450, 460.8],
    renglones2: [510.5, 521, 531.5, 542.3, 556.8, 571.5],
  },
};

const TINTA = rgb(0.06, 0.09, 0.2);

function hex(h: string): RGB {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Texto apto para las fuentes estándar del PDF (Latin-1). Las comillas y rayas
 * tipográficas se pasan a su equivalente simple; cualquier otro carácter que
 * la fuente no tenga (emoji, etc.) se reemplaza para que el PDF no falle.
 */
function seguro(s: string): string {
  return (s ?? "")
    .replace(/[—–−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, "...")
    .replace(/•/g, "·")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

/** Los promedios van siempre con un decimal. */
function fmt(n: number): string {
  return redondear1(n).toFixed(1).replace(".", ",");
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

function mesLargo(mes: number): string {
  const m = NOMBRES_MES[mes - 1] ?? "";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function mesCorto(mes: number): string {
  const m = NOMBRES_MES[mes - 1] ?? "";
  return m.charAt(0).toUpperCase() + m.slice(1, 3);
}

// Todas las posiciones se dan desde arriba; pdf-lib mide desde abajo.
const y = (page: PDFPage, top: number) => page.getHeight() - top;

function texto(page: PDFPage, s: string, x: number, top: number, size: number, font: PDFFont, maxW?: number) {
  let t = seguro(s);
  if (maxW) while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -1);
  page.drawText(t, { x, y: y(page, top), size, font, color: TINTA });
}

function centrado(page: PDFPage, s: string, cx: number, top: number, size: number, font: PDFFont, color: RGB = TINTA) {
  const t = seguro(s);
  page.drawText(t, { x: cx - font.widthOfTextAtSize(t, size) / 2, y: y(page, top), size, font, color });
}

/** Reparte un texto en renglones; si no cabe, prueba letra más pequeña y al final corta con "...". */
function enRenglones(s: string, font: PDFFont, ancho: number, renglones: number, tamanos: number[]): { lineas: string[]; size: number } {
  const t = seguro(s).replace(/\s+/g, " ").trim();
  for (const size of tamanos) {
    const lineas = wrapText(t, font, size, ancho);
    if (lineas.length <= renglones) return { lineas, size };
  }
  const size = tamanos[tamanos.length - 1];
  const lineas = wrapText(t, font, size, ancho).slice(0, renglones);
  let ult = lineas[renglones - 1] ?? "";
  while (ult.length > 1 && font.widthOfTextAtSize(ult + "...", size) > ancho) ult = ult.slice(0, -1);
  lineas[renglones - 1] = ult + "...";
  return { lineas, size };
}

function marcaX(page: PDFPage, cx: number, cy: number, r: number) {
  const o = { thickness: 2.2, color: TINTA };
  page.drawLine({ start: { x: cx - r, y: y(page, cy - r) }, end: { x: cx + r, y: y(page, cy + r) }, ...o });
  page.drawLine({ start: { x: cx - r, y: y(page, cy + r) }, end: { x: cx + r, y: y(page, cy - r) }, ...o });
}

function estrella(page: PDFPage, cx: number, cy: number, R: number, color: RGB) {
  const r = R * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(Math.cos(ang) * rad).toFixed(2)} ${(Math.sin(ang) * rad).toFixed(2)}`);
  }
  page.drawSvgPath(`M ${pts.join(" L ")} Z`, { x: cx, y: y(page, cy), color, borderColor: TINTA, borderWidth: 0.6 });
}

type Fuentes = { reg: PDFFont; bold: PDFFont };

// ---------- Hoja 1: la evaluación ----------

function llenarHoja1(page: PDFPage, f: Fuentes, formato: FormatoTienda, d: DatosMagiaPdf, e: MagiaEvaluacion) {
  const m = HOJA1[formato];
  texto(page, d.evaluado, 196, 160.5, 10.5, f.bold, 330);
  texto(page, d.tienda, 122, 174.5, 10.5, f.reg, 400);
  texto(page, fechaCorta(e.fecha), 180, 188, 10.5, f.reg);

  const puntajes = [e.c_sonrisa, e.c_preguntas, e.c_experiencia, e.c_tecnologias, e.c_cierre, e.impresion_final];
  const anchoCol = m.cols[1] - m.cols[0];
  const centroCol = (v: number) => m.cols[v - 1] + anchoCol / 2;

  puntajes.forEach((v, i) => {
    if (v < 1 || v > 4) return;
    const [arriba, abajo] = m.filas[i];
    marcaX(page, centroCol(v), (arriba + abajo) / 2, Math.min(11, (abajo - arriba) / 3));
  });

  // TOTAL: los puntos de cada columna (X marcadas en ella × su valor).
  const [tArriba, tAbajo] = m.filas[6];
  for (let v = 1; v <= 4; v++) {
    const puntos = puntajes.filter((p) => p === v).length * v;
    centrado(page, String(puntos), centroCol(v), (tArriba + tAbajo) / 2 + 5, 13, f.bold);
  }
  const total = totalMagia(e);
  const promedio = promedioMagia(e);
  texto(
    page,
    `Total: ${total} de ${MAGIA_PUNTOS_MAX} puntos  ·  Promedio: ${fmt(promedio)} (${total} ÷ ${MAGIA_ITEMS})  ·  Casilla ${cuadranteMagia(promedio)}`,
    m.izq,
    tAbajo + 17,
    10,
    f.bold,
  );
}

// ---------- Hoja 2: detalle y cuadrícula ----------

function puntoEnCruz(cruz: Hoja2["cruz"], promedio: number): { x: number; y: number; casilla: NivelMagia } {
  const casilla = cuadranteMagia(promedio);
  // 3 | 4  arriba;  1 | 2  abajo. Dentro de la casilla, el punto avanza en
  // diagonal hacia arriba a la derecha según el decimal (más alto = mejor).
  const derecha = casilla === 2 || casilla === 4;
  const arriba = casilla === 3 || casilla === 4;
  const xa = derecha ? cruz.cx : cruz.x0;
  const xb = derecha ? cruz.x1 : cruz.cx;
  const ya = arriba ? cruz.cy : cruz.y1; // borde de abajo de la casilla
  const yb = arriba ? cruz.y0 : cruz.cy; // borde de arriba
  const t = 0.2 + 0.6 * avanceEnCasilla(promedio);
  return { x: xa + (xb - xa) * t, y: ya + (yb - ya) * t, casilla };
}

function llenarHoja2(page: PDFPage, f: Fuentes, formato: FormatoTienda, e: MagiaEvaluacion) {
  const m = HOJA2[formato];
  const partes = [
    e.fortalezas?.trim() ? `Fortalezas: ${e.fortalezas.trim()}` : "",
    e.oportunidades?.trim() ? `Oportunidades: ${e.oportunidades.trim()}` : "",
  ].filter(Boolean);
  const renglones = m.lineasDetalle.length;
  // Fortalezas y oportunidades, cada una desde su propio renglón si caben así.
  let lineas: string[] = [];
  let size = 7.5;
  for (const s of [9.5, 8.5, 7.5]) {
    const separadas = partes.flatMap((p) => wrapText(seguro(p), f.reg, s, 436));
    if (separadas.length <= renglones) {
      lineas = separadas;
      size = s;
      break;
    }
  }
  if (lineas.length === 0) {
    ({ lineas, size } = enRenglones(partes.join("  ·  ") || "Sin observaciones registradas.", f.reg, 436, renglones, [7.5]));
  }
  lineas.forEach((l, i) => texto(page, l, 87, m.lineasDetalle[i] - 2.5, size, f.reg));

  const promedio = promedioMagia(e);
  const p = puntoEnCruz(m.cruz, promedio);
  const color = hex(COLOR_CUADRANTE[p.casilla]);
  if (p.casilla === 4) estrella(page, p.x, p.y, 11, color);
  else page.drawCircle({ x: p.x, y: y(page, p.y), size: 8, color, borderColor: TINTA, borderWidth: 0.6 });
  centrado(page, `${mesCorto(e.mes)} · ${fmt(promedio)}`, p.x, p.y + 22, 9, f.bold);
}

// ---------- Hoja 3: plantilla de resultados del bimestre ----------

function resumenTexto(e: MagiaEvaluacion): string {
  const promedio = promedioMagia(e);
  const partes = [
    `${mesLargo(e.mes)} ${e.anio}:${totalMagia(e)}/${MAGIA_PUNTOS_MAX} puntos, promedio ${fmt(promedio)}, casilla ${cuadranteMagia(promedio)}.`,
    e.fortalezas?.trim() ? `Fortalezas: ${e.fortalezas.trim()}.` : "",
    e.oportunidades?.trim() ? `Oportunidades: ${e.oportunidades.trim()}.` : "",
  ];
  return partes.filter(Boolean).join(" ").replace(/\.\./g, ".");
}

function llenarHoja3(page: PDFPage, f: Fuentes, formato: FormatoTienda, d: DatosMagiaPdf) {
  const m = HOJA3[formato];
  texto(page, d.evaluado, 212, 150, 10.5, f.bold, 300);

  const evals = [d.evaluacion1, d.evaluacion2];
  const promedios = evals.map((e) => (e ? promedioMagia(e) : null));
  const hechos = promedios.filter((p): p is number => p != null);
  const valores = [
    ...promedios.map((p) => (p == null ? "" : fmt(p))),
    hechos.length ? fmt(hechos.reduce((a, b) => a + b, 0) / hechos.length) : "",
  ];
  valores.forEach((v, i) => {
    if (!v) return;
    const [a, b] = m.tabla[i];
    centrado(page, v, (a + b) / 2, m.topValores, 13, f.bold);
  });

  evals.forEach((e, i) => {
    if (!e) return;
    const renglones = i === 0 ? m.renglones1 : m.renglones2;
    const { lineas, size } = enRenglones(resumenTexto(e), f.reg, 432, renglones.length, [7.5, 7, 6.5]);
    lineas.forEach((l, k) => texto(page, l, 94, renglones[k] - 2.4, size, f.reg));
  });
}

// ---------- Armado ----------

/** Arma el PDF del bimestre (sin descargarlo). Separado para poder revisarlo en pruebas. */
export async function construirMagiaPdf(d: DatosMagiaPdf, plantillas: PlantillasMagia): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const f: Fuentes = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const cache = new Map<FormatoTienda, PDFDocument>();
  const plantilla = async (formato: FormatoTienda) => {
    if (!cache.has(formato)) cache.set(formato, await PDFDocument.load(plantillas[formato]));
    return cache.get(formato)!;
  };

  const evals = [d.evaluacion1, d.evaluacion2].filter((e): e is MagiaEvaluacion => !!e);
  if (evals.length === 0) throw new Error("No hay evaluaciones en este bimestre.");

  // Hojas 1 y 2 por cada evaluación, cada una en el formato con que se hizo.
  for (const e of evals) {
    const formato = normalizarFormato(e.formato);
    const [h1, h2] = await pdf.copyPages(await plantilla(formato), [0, 1]);
    pdf.addPage(h1);
    pdf.addPage(h2);
    llenarHoja1(h1, f, formato, d, e);
    llenarHoja2(h2, f, formato, e);
  }

  // Hoja 3 en el formato de la evaluación más reciente.
  const formato3 = normalizarFormato(evals[evals.length - 1].formato);
  const [h3] = await pdf.copyPages(await plantilla(formato3), [2]);
  pdf.addPage(h3);
  llenarHoja3(h3, f, formato3, d);

  pdf.setTitle(`Magia con una sonrisa - ${seguro(d.evaluado)} - ${nombreBimestre(d.anio, d.mesInicio)}`);
  return pdf.save();
}

async function cargarPlantilla(formato: FormatoTienda): Promise<ArrayBuffer> {
  const ruta = assetPath(`/plantillas/magia-${formato}.pdf`);
  const res = await fetch(ruta);
  if (!res.ok) throw new Error(`No pude cargar el formato ${formato} (${res.status}).`);
  return res.arrayBuffer();
}

export async function generarMagiaPdf(d: DatosMagiaPdf): Promise<void> {
  const formatos = new Set(
    [d.evaluacion1, d.evaluacion2].filter((e): e is MagiaEvaluacion => !!e).map((e) => normalizarFormato(e.formato)),
  );
  const plantillas = {} as PlantillasMagia;
  for (const fm of formatos) plantillas[fm] = await cargarPlantilla(fm);
  const bytes = await construirMagiaPdf(d, plantillas);
  const nombre = d.evaluado
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]/g, "");
  const mm = String(d.mesInicio).padStart(2, "0");
  const mm2 = String(d.mesInicio + 1).padStart(2, "0");
  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `Magia_${nombre}_${d.anio}-${mm}-${mm2}.pdf`);
}
