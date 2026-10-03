"use client";

// PDF de la "Evaluación del vendedor — Magia con una sonrisa" (formatos
// Concept y Outlet). No hay plantilla PDF oficial, solo los Word: se dibuja
// desde cero con la misma información y el mismo orden, pero con la tabla
// M-A-G-I-A alineada. Un archivo por asesor y mes (hay una evaluación al mes):
// la hoja de la evaluación y la "Plantilla de resultados" con la cuadrícula
// Gestión/Resultados, donde también salen los meses anteriores (tendencia).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { NOMBRES_MES } from "./horarios";
import { MAGIA_PUNTOS_MAX, totalMagia, type MagiaEvaluacion } from "./ranking";
import {
  COLOR_CUADRANTE,
  MAGIA_ITEMS,
  avanceEnCasilla,
  criteriosMagia,
  cuadranteMagia,
  escalaMagia,
  labelFormato,
  normalizarFormato,
  promedioMagia,
  redondear1,
  type FormatoTienda,
  type NivelMagia,
} from "./magia";
import { downloadBlob, wrapText } from "./pdfs";

export type DatosMagiaPdf = {
  evaluado: string;
  tienda: string;
  /** La evaluación del mes. */
  evaluacion: MagiaEvaluacion;
  /** Evaluaciones de meses anteriores de la misma persona, para la tendencia. */
  anteriores?: MagiaEvaluacion[];
  /** Nombre de quien evaluó, a partir de su id. */
  nombreEvaluador: (id: string | null) => string;
};

// Carta (Letter), en puntos. Las posiciones se piensan desde ARRIBA de la hoja
// (`top`) y se convierten al origen inferior de pdf-lib al dibujar.
const W = 612;
const H = 792;
const M = 42;
const CW = W - 2 * M;

function hex(h: string): RGB {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const NAVY = hex("#223354");
const ORO = hex("#E0A526");
const TINTA = rgb(0.11, 0.12, 0.14);
const MUTED = rgb(0.4, 0.44, 0.5);
const LINEA = rgb(0.78, 0.81, 0.86);
const SUAVE = rgb(0.95, 0.96, 0.975);
const BLANCO = rgb(1, 1, 1);

type Fuentes = { reg: PDFFont; bold: PDFFont; obl: PDFFont };

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
function fmt(n: number, dec = 1): string {
  return redondear1(n).toFixed(dec).replace(".", ",");
}

function periodoTitulo(anio: number, mes: number): string {
  const m = NOMBRES_MES[mes - 1] ?? "";
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${anio}`;
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

function texto(page: PDFPage, s: string, x: number, top: number, size: number, font: PDFFont, color: RGB = TINTA) {
  page.drawText(seguro(s), { x, y: H - top, size, font, color });
}

function centrado(page: PDFPage, s: string, cx: number, top: number, size: number, font: PDFFont, color: RGB = TINTA) {
  const t = seguro(s);
  page.drawText(t, { x: cx - font.widthOfTextAtSize(t, size) / 2, y: H - top, size, font, color });
}

function derecha(page: PDFPage, s: string, xDer: number, top: number, size: number, font: PDFFont, color: RGB = TINTA) {
  const t = seguro(s);
  page.drawText(t, { x: xDer - font.widthOfTextAtSize(t, size), y: H - top, size, font, color });
}

function caja(
  page: PDFPage,
  x: number,
  top: number,
  w: number,
  h: number,
  o: { fill?: RGB; border?: RGB; grosor?: number; opacidad?: number },
) {
  page.drawRectangle({
    x,
    y: H - top - h,
    width: w,
    height: h,
    color: o.fill,
    opacity: o.fill ? (o.opacidad ?? 1) : undefined,
    borderColor: o.border,
    borderWidth: o.border ? (o.grosor ?? 0.8) : 0,
  });
}

function linea(page: PDFPage, x1: number, top1: number, x2: number, top2: number, grosor = 0.8, color: RGB = LINEA) {
  page.drawLine({ start: { x: x1, y: H - top1 }, end: { x: x2, y: H - top2 }, thickness: grosor, color });
}

function circulo(page: PDFPage, cx: number, topC: number, r: number, o: { fill?: RGB; border?: RGB; grosor?: number }) {
  page.drawCircle({
    x: cx,
    y: H - topC,
    size: r,
    color: o.fill,
    borderColor: o.border,
    borderWidth: o.border ? (o.grosor ?? 0.8) : 0,
  });
}

/** Estrella de cinco puntas centrada en (cx, topC). */
function estrella(page: PDFPage, cx: number, topC: number, R: number, color: RGB) {
  const r = R * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(Math.cos(ang) * rad).toFixed(2)} ${(Math.sin(ang) * rad).toFixed(2)}`);
  }
  page.drawSvgPath(`M ${pts.join(" L ")} Z`, { x: cx, y: H - topC, color });
}

/** Texto con salto de línea automático; devuelve cuántas líneas dibujó. */
function parrafo(
  page: PDFPage,
  s: string,
  x: number,
  top: number,
  size: number,
  font: PDFFont,
  maxWidth: number,
  interlineado: number,
  maxLineas: number,
  color: RGB = TINTA,
): number {
  const lineas = wrapText(seguro(s), font, size, maxWidth);
  const visibles = lineas.slice(0, maxLineas);
  if (lineas.length > maxLineas && visibles.length > 0) {
    // Sin espacio para todo: se marca que el texto sigue.
    let ult = visibles[visibles.length - 1];
    while (ult.length > 1 && font.widthOfTextAtSize(ult + "...", size) > maxWidth) ult = ult.slice(0, -1);
    visibles[visibles.length - 1] = ult + "...";
  }
  visibles.forEach((l, i) => page.drawText(l, { x, y: H - (top + i * interlineado), size, font, color }));
  return visibles.length;
}

// ---------- Piezas comunes a las dos hojas ----------

function encabezado(page: PDFPage, f: Fuentes, titulo: string, formato: FormatoTienda, detalle: string) {
  caja(page, M, 36, CW, 54, { fill: NAVY });
  texto(page, titulo, M + 16, 59, 15, f.bold, BLANCO);
  texto(page, "Magia con una sonrisa", M + 16, 76, 10, f.reg, rgb(0.82, 0.86, 0.93));

  const etiqueta = `TIENDAS ${labelFormato(formato).toUpperCase()}`;
  const wEt = f.bold.widthOfTextAtSize(etiqueta, 9.5) + 20;
  caja(page, W - M - 16 - wEt, 46, wEt, 18, { fill: BLANCO });
  centrado(page, etiqueta, W - M - 16 - wEt / 2, 58.5, 9.5, f.bold, NAVY);
  derecha(page, detalle, W - M - 16, 79, 9, f.reg, rgb(0.82, 0.86, 0.93));
}

function filaDatos(page: PDFPage, f: Fuentes, top: number, items: { label: string; valor: string; w: number }[]) {
  const sep = 8;
  const total = CW - sep * (items.length - 1);
  let x = M;
  for (const it of items) {
    const w = total * it.w;
    caja(page, x, top, w, 40, { border: LINEA });
    texto(page, it.label.toUpperCase(), x + 9, top + 13, 6.8, f.bold, MUTED);
    let valor = seguro(it.valor || "-");
    while (valor.length > 1 && f.bold.widthOfTextAtSize(valor, 11) > w - 18) valor = valor.slice(0, -1);
    texto(page, valor, x + 9, top + 30, 11, f.bold);
    x += w + sep;
  }
}

function firmas(page: PDFPage, f: Fuentes, top: number, evaluado: string, evaluador: string) {
  const sep = 22;
  const w = (CW - sep * 2) / 3;
  const cols = [
    { titulo: "Firma del Evaluado", nombre: evaluado },
    { titulo: "Firma del Evaluador", nombre: evaluador },
    { titulo: "Firma del District Manager", nombre: "" },
  ];
  cols.forEach((c, i) => {
    const x = M + i * (w + sep);
    linea(page, x, top, x + w, top, 0.9, TINTA);
    centrado(page, c.titulo, x + w / 2, top + 12, 8.5, f.bold);
    if (c.nombre) centrado(page, c.nombre, x + w / 2, top + 23, 8, f.reg, MUTED);
  });
}

function pie(page: PDFPage, f: Fuentes, tienda: string) {
  const hoy = new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
  centrado(page, `${tienda} · Generado desde Digital Logbook el ${hoy}`, W / 2, 776, 7, f.reg, MUTED);
}

/**
 * Cuadrícula Gestión / Resultados. La casilla 3 queda arriba a la izquierda,
 * la 4 arriba a la derecha, la 1 abajo a la izquierda y la 2 abajo a la
 * derecha, igual que en la plantilla impresa.
 */
function cuadricula(
  page: PDFPage,
  f: Fuentes,
  x: number,
  top: number,
  w: number,
  h: number,
  promedio: number,
  anteriores: { promedio: number; etiqueta: string }[],
) {
  const casilla = cuadranteMagia(promedio);
  const zw = w / 2;
  const zh = h / 2;
  // Dentro de su casilla el punto avanza en diagonal (de abajo-izquierda a
  // arriba-derecha) según el decimal del promedio, para que se vea la tendencia.
  const lugar = (prom: number) => {
    const c = cuadranteMagia(prom);
    const t = avanceEnCasilla(prom);
    return { c, x: zona[c].x + 40 + t * (zw - 80), top: zona[c].top + zh - 36 - t * (zh - 72) };
  };
  caja(page, x, top, w, h, { fill: BLANCO, border: LINEA });
  const cx = x + w / 2;
  const cy = top + h / 2;
  const zona: Record<NivelMagia, { x: number; top: number }> = {
    3: { x, top },
    4: { x: cx, top },
    1: { x, top: cy },
    2: { x: cx, top: cy },
  };

  caja(page, zona[casilla].x, zona[casilla].top, zw, zh, { fill: hex(COLOR_CUADRANTE[casilla]), opacidad: 0.1 });

  // Ejes
  linea(page, cx, top + 12, cx, top + h - 12, 1.6, TINTA);
  linea(page, x + 12, cy, x + w - 12, cy, 1.6, TINTA);
  texto(page, "Gestión", cx + 6, top + 23, 8, f.bold);
  centrado(page, "+", cx - 9, top + 25, 12, f.bold, MUTED);
  linea(page, cx - 13, top + h - 20, cx - 5, top + h - 20, 1.2, MUTED);
  derecha(page, "Resultados", x + w - 28, cy + 13, 8, f.bold);
  centrado(page, "+", x + w - 19, cy - 6, 12, f.bold, MUTED);
  linea(page, x + 15, cy - 9, x + 23, cy - 9, 1.2, MUTED);

  // Número de cada casilla, en su esquina exterior
  const lado = 17;
  const esquina: Record<NivelMagia, { x: number; top: number }> = {
    3: { x: x + 8, top: top + 8 },
    4: { x: x + w - 8 - lado, top: top + 8 },
    1: { x: x + 8, top: top + h - 8 - lado },
    2: { x: x + w - 8 - lado, top: top + h - 8 - lado },
  };
  ([1, 2, 3, 4] as NivelMagia[]).forEach((n) => {
    const e = esquina[n];
    const activo = casilla === n;
    caja(page, e.x, e.top, lado, lado, {
      fill: activo ? hex(COLOR_CUADRANTE[n]) : BLANCO,
      border: hex(COLOR_CUADRANTE[n]),
      grosor: 1,
    });
    centrado(page, String(n), e.x + lado / 2, e.top + 12.3, 10, f.bold, activo ? BLANCO : hex(COLOR_CUADRANTE[n]));
  });

  // Meses anteriores: círculos huecos, más pequeños, con su mes.
  for (const ant of anteriores) {
    const l = lugar(ant.promedio);
    circulo(page, l.x, l.top, 6, { fill: BLANCO, border: hex(COLOR_CUADRANTE[l.c]), grosor: 1.6 });
    centrado(page, `${ant.etiqueta} ${fmt(ant.promedio)}`, l.x, l.top + 15, 6.5, f.reg, MUTED);
  }

  // La evaluación de este mes: figura llena con su promedio.
  const l = lugar(promedio);
  const color = hex(COLOR_CUADRANTE[casilla]);
  if (casilla === 4) estrella(page, l.x, l.top, 15, color);
  else circulo(page, l.x, l.top, 11, { fill: color, border: rgb(0.2, 0.2, 0.2), grosor: 0.6 });
  centrado(page, fmt(promedio), l.x, l.top - 15, 9.5, f.bold);
}

// ---------- Hoja de una evaluación ----------

function hojaEvaluacion(pdf: PDFDocument, f: Fuentes, d: DatosMagiaPdf) {
  const page = pdf.addPage([W, H]);
  const e = d.evaluacion;
  const formato = normalizarFormato(e.formato);
  const criterios = criteriosMagia(formato);
  const escala = escalaMagia(formato);
  const evaluador = d.nombreEvaluador(e.evaluador_id);

  encabezado(page, f, "EVALUACIÓN DEL VENDEDOR", formato, `Evaluación de ${periodoTitulo(e.anio, e.mes)}`);
  filaDatos(page, f, 102, [
    { label: "Nombre del evaluado", valor: d.evaluado, w: 0.46 },
    { label: "Tienda", valor: d.tienda, w: 0.32 },
    { label: "Fecha", valor: fechaCorta(e.fecha), w: 0.22 },
  ]);

  // Escala
  texto(page, "ESCALA DE EVALUACIÓN", M, 160, 6.8, f.bold, MUTED);
  const wEsc = CW / 4;
  escala.forEach((n, i) => {
    const x = M + i * wEsc;
    circulo(page, x + 8, 173, 8, { fill: NAVY });
    centrado(page, String(n.v), x + 8, 176.4, 9.5, f.bold, BLANCO);
    texto(page, n.label, x + 21, 176.2, 9.2, f.reg);
  });

  // Tabla M-A-G-I-A: letra | criterio | 1 | 2 | 3 | 4
  const wLetra = 44;
  const wNivel = 46;
  const wTexto = CW - wLetra - wNivel * 4;
  const xTexto = M + wLetra;
  const xNiveles = xTexto + wTexto;
  const cxNivel = (v: number) => xNiveles + (v - 1) * wNivel + wNivel / 2;
  const hCab = 22;
  const hFila = 44;
  const hFinal = 34;
  const hTotal = 28;
  const topTabla = 190;

  caja(page, M, topTabla, CW, hCab, { fill: SUAVE });
  texto(page, "CRITERIO", xTexto + 12, topTabla + 14.5, 7.2, f.bold, MUTED);
  for (let v = 1; v <= 4; v++) centrado(page, String(v), cxNivel(v), topTabla + 15.5, 10.5, f.bold, NAVY);

  const marcas = (top: number, alto: number, valor: number) => {
    for (let v = 1; v <= 4; v++) {
      const cy = top + alto / 2;
      if (v === valor) {
        circulo(page, cxNivel(v), cy, 10, { fill: NAVY });
        centrado(page, String(v), cxNivel(v), cy + 3.6, 10.5, f.bold, BLANCO);
      } else {
        circulo(page, cxNivel(v), cy, 10, { border: LINEA, grosor: 0.9 });
      }
    }
  };

  let top = topTabla + hCab;
  for (const c of criterios) {
    caja(page, M, top, wLetra, hFila, { fill: NAVY });
    centrado(page, c.letra, M + wLetra / 2, top + hFila / 2 + 7.2, 20, f.bold, BLANCO);
    const lineas = wrapText(seguro(c.texto), f.reg, 10, wTexto - 24).slice(0, 3);
    const inter = 12.5;
    const base = top + hFila / 2 - ((lineas.length - 1) * inter) / 2 + 3.5;
    lineas.forEach((l, i) => texto(page, l, xTexto + 12, base + i * inter, 10, f.reg));
    marcas(top, hFila, e[c.key]);
    top += hFila;
    linea(page, M, top, M + CW, top, 0.8, LINEA);
  }

  // Impresión final
  caja(page, M, top, wLetra, hFinal, { fill: ORO });
  estrella(page, M + wLetra / 2, top + hFinal / 2, 9, BLANCO);
  texto(page, "IMPRESIÓN FINAL", xTexto + 12, top + hFinal / 2 + 3.8, 10.5, f.bold);
  marcas(top, hFinal, e.impresion_final);
  top += hFinal;

  // Total: puntos acumulados en cada columna
  caja(page, M, top, CW, hTotal, { fill: SUAVE });
  texto(page, "TOTAL", xTexto + 12, top + hTotal / 2 + 3.8, 10.5, f.bold);
  const valores = [...criterios.map((c) => e[c.key]), e.impresion_final];
  for (let v = 1; v <= 4; v++) {
    const sub = valores.filter((x) => x === v).length * v;
    centrado(page, sub > 0 ? String(sub) : "-", cxNivel(v), top + hTotal / 2 + 4, 11, sub > 0 ? f.bold : f.reg, sub > 0 ? TINTA : MUTED);
  }
  top += hTotal;

  // Divisiones verticales y borde
  linea(page, xTexto, topTabla, xTexto, top, 0.8, LINEA);
  for (let v = 0; v < 4; v++) linea(page, xNiveles + v * wNivel, topTabla, xNiveles + v * wNivel, top, 0.8, LINEA);
  caja(page, M, topTabla, CW, top - topTabla, { border: NAVY, grosor: 1.1 });

  // Resumen: puntaje, promedio y casilla
  const total = totalMagia(e);
  const prom = promedioMagia(e);
  const casilla = cuadranteMagia(prom);
  const topRes = top + 12;
  const sep = 8;
  const wRes = (CW - sep * 2) / 3;
  const resumen = [
    { label: "Puntaje total", valor: `${total} / ${MAGIA_PUNTOS_MAX}` },
    { label: `Promedio (total ÷ ${MAGIA_ITEMS} ítems)`, valor: fmt(prom) },
  ];
  resumen.forEach((r, i) => {
    const x = M + i * (wRes + sep);
    caja(page, x, topRes, wRes, 46, { border: LINEA });
    texto(page, r.label.toUpperCase(), x + 10, topRes + 14, 6.8, f.bold, MUTED);
    texto(page, r.valor, x + 10, topRes + 35, 16, f.bold, NAVY);
  });
  {
    const x = M + 2 * (wRes + sep);
    const color = hex(COLOR_CUADRANTE[casilla]);
    caja(page, x, topRes, wRes, 46, { border: color, grosor: 1.2 });
    texto(page, "CASILLA EN LA CUADRÍCULA", x + 10, topRes + 14, 6.8, f.bold, MUTED);
    if (casilla === 4) estrella(page, x + 20, topRes + 30, 10, color);
    else circulo(page, x + 20, topRes + 30, 8.5, { fill: color });
    texto(page, `${casilla} · ${escala[casilla - 1].label}`, x + 36, topRes + 34.5, 12, f.bold);
  }

  // Fortalezas y oportunidades
  const topDet = topRes + 62;
  texto(page, "DETALLE DE FORTALEZAS Y OPORTUNIDADES PARA MEJORAR", M, topDet, 6.8, f.bold, MUTED);
  const wDet = (CW - sep) / 2;
  const hDet = 92;
  [
    { titulo: "Fortalezas", cuerpo: e.fortalezas },
    { titulo: "Oportunidades para mejorar", cuerpo: e.oportunidades },
  ].forEach((b, i) => {
    const x = M + i * (wDet + sep);
    caja(page, x, topDet + 8, wDet, hDet, { border: LINEA });
    texto(page, b.titulo, x + 10, topDet + 23, 9, f.bold, NAVY);
    if (b.cuerpo?.trim()) parrafo(page, b.cuerpo.trim(), x + 10, topDet + 38, 9.2, f.reg, wDet - 20, 11.6, 5);
    else texto(page, "Sin observaciones registradas.", x + 10, topDet + 38, 9, f.obl, MUTED);
  });

  // Confirmación del evaluado
  const topConf = topDet + 8 + hDet + 16;
  if (e.confirmada_at) {
    const cuando = new Date(e.confirmada_at).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
    const nota = e.comentario_evaluado?.trim() ? ` Comentario: "${e.comentario_evaluado.trim()}"` : "";
    parrafo(page, `Revisada y confirmada por el evaluado en la aplicación el ${cuando}.${nota}`, M, topConf, 8.5, f.obl, CW, 11, 2, MUTED);
  } else {
    texto(page, "Pendiente de confirmación del evaluado en la aplicación.", M, topConf, 8.5, f.obl, MUTED);
  }

  firmas(page, f, 732, d.evaluado, evaluador);
  pie(page, f, d.tienda);
}

// ---------- Hoja de resultados del mes ----------

function hojaResultados(pdf: PDFDocument, f: Fuentes, d: DatosMagiaPdf) {
  const page = pdf.addPage([W, H]);
  const e = d.evaluacion;
  const periodo = periodoTitulo(e.anio, e.mes);
  const formato = normalizarFormato(e.formato);
  const escala = escalaMagia(formato);
  const promedio = promedioMagia(e);
  const casilla = cuadranteMagia(promedio);

  // Meses anteriores, del más reciente al más antiguo (hasta cinco).
  const previas = [...(d.anteriores ?? [])]
    .sort((a, b) => b.anio * 12 + b.mes - (a.anio * 12 + a.mes))
    .slice(0, 5);
  const abrev = (x: MagiaEvaluacion) => `${(NOMBRES_MES[x.mes - 1] ?? "").slice(0, 3)} ${String(x.anio).slice(2)}`;

  encabezado(page, f, "PLANTILLA DE RESULTADOS", formato, periodo);
  filaDatos(page, f, 102, [
    { label: "Nombre del evaluado", valor: d.evaluado, w: 0.46 },
    { label: "Tienda", valor: d.tienda, w: 0.32 },
    { label: "Periodo", valor: periodo, w: 0.22 },
  ]);

  // Puntaje | Promedio | Casilla
  const sep = 8;
  const wCaja = (CW - sep * 2) / 3;
  const topCajas = 158;
  caja(page, M, topCajas, wCaja, 64, { border: LINEA });
  texto(page, "PUNTAJE", M + 12, topCajas + 16, 7, f.bold, MUTED);
  texto(page, `${totalMagia(e)} / ${MAGIA_PUNTOS_MAX}`, M + 12, topCajas + 42, 20, f.bold, NAVY);
  texto(page, `Evaluación del ${fechaCorta(e.fecha)}`, M + 12, topCajas + 56, 8, f.reg, MUTED);

  const xProm = M + wCaja + sep;
  caja(page, xProm, topCajas, wCaja, 64, { fill: NAVY });
  texto(page, "PROMEDIO DEL MES", xProm + 12, topCajas + 16, 7, f.bold, rgb(0.82, 0.86, 0.93));
  texto(page, fmt(promedio), xProm + 12, topCajas + 42, 20, f.bold, BLANCO);
  texto(page, `Puntaje ÷ ${MAGIA_ITEMS} ítems · va al ranking`, xProm + 12, topCajas + 56, 8, f.reg, rgb(0.82, 0.86, 0.93));

  const xCas = M + 2 * (wCaja + sep);
  const colorCasilla = hex(COLOR_CUADRANTE[casilla]);
  caja(page, xCas, topCajas, wCaja, 64, { border: colorCasilla, grosor: 1.2 });
  texto(page, "CASILLA EN LA CUADRÍCULA", xCas + 12, topCajas + 16, 7, f.bold, MUTED);
  if (casilla === 4) estrella(page, xCas + 22, topCajas + 38, 11, colorCasilla);
  else circulo(page, xCas + 22, topCajas + 38, 9, { fill: colorCasilla });
  texto(page, `${casilla} · ${escala[casilla - 1].label}`, xCas + 40, topCajas + 43, 13, f.bold);

  // Planilla Gestión / Resultados (izquierda) y últimas evaluaciones (derecha)
  const topPlan = 250;
  texto(page, "PLANILLA GESTIÓN / RESULTADOS", M, topPlan, 9.5, f.bold, NAVY);
  linea(page, M, topPlan + 7, M + CW, topPlan + 7, 1, NAVY);

  const wG = 336;
  const hG = 268;
  const topG = topPlan + 22;
  cuadricula(
    page,
    f,
    M,
    topG,
    wG,
    hG,
    promedio,
    previas.map((x) => ({ promedio: promedioMagia(x), etiqueta: abrev(x) })),
  );

  // Tabla de tendencia
  const xT = M + wG + 18;
  const wT = CW - wG - 18;
  texto(page, "ÚLTIMAS EVALUACIONES", xT, topG + 8, 6.8, f.bold, MUTED);
  const filasT = [e, ...previas];
  filasT.forEach((x, i) => {
    const top = topG + 16 + i * 34;
    const prom = promedioMagia(x);
    const c = cuadranteMagia(prom);
    const actual = i === 0;
    caja(page, xT, top, wT, 30, actual ? { fill: SUAVE, border: NAVY, grosor: 1 } : { border: LINEA });
    texto(page, periodoTitulo(x.anio, x.mes), xT + 9, top + 13, 8.5, actual ? f.bold : f.reg);
    texto(page, `${totalMagia(x)}/${MAGIA_PUNTOS_MAX} · casilla ${c}`, xT + 9, top + 24, 7, f.reg, MUTED);
    derecha(page, fmt(prom), xT + wT - 24, top + 20, 13, f.bold, NAVY);
    circulo(page, xT + wT - 12, top + 15, 5, { fill: hex(COLOR_CUADRANTE[c]) });
  });
  const topTend = topG + 16 + filasT.length * 34 + 10;
  if (previas.length > 0) {
    const dif = redondear1(redondear1(promedio) - redondear1(promedioMagia(previas[0])));
    const frase =
      dif > 0
        ? `Sube ${fmt(dif)} frente a ${periodoTitulo(previas[0].anio, previas[0].mes)}.`
        : dif < 0
          ? `Baja ${fmt(-dif)} frente a ${periodoTitulo(previas[0].anio, previas[0].mes)}.`
          : `Igual que en ${periodoTitulo(previas[0].anio, previas[0].mes)}.`;
    parrafo(page, `Tendencia: ${frase}`, xT, topTend, 8.5, f.bold, wT, 11, 3, dif < 0 ? hex("#B4232F") : TINTA);
  } else {
    parrafo(page, "Primera evaluación registrada: aún no hay meses anteriores para comparar.", xT, topTend, 8, f.obl, wT, 10.5, 3, MUTED);
  }

  // Convenciones
  const topLey = topG + hG + 26;
  texto(page, "CONVENCIONES", M, topLey, 6.8, f.bold, MUTED);
  const wLey = CW / 4;
  escala.forEach((n, i) => {
    const x = M + i * wLey;
    const color = hex(COLOR_CUADRANTE[n.v]);
    if (n.v === 4) estrella(page, x + 7, topLey + 15, 8, color);
    else circulo(page, x + 7, topLey + 15, 6, { fill: color });
    texto(page, `${n.v} · ${n.label}`, x + 19, topLey + 18.2, 9, f.reg);
  });
  parrafo(
    page,
    `El promedio es la suma de los puntajes dividida entre los ${MAGIA_ITEMS} ítems evaluados, con un decimal. Define la casilla (redondeado al entero más cercano) y la posición del punto dentro de ella: más arriba y a la derecha cuanto más cerca está de la casilla siguiente. La figura llena es este mes; los círculos huecos son meses anteriores.`,
    M,
    topLey + 40,
    8.2,
    f.obl,
    CW,
    11,
    4,
    MUTED,
  );

  firmas(page, f, 732, d.evaluado, d.nombreEvaluador(e.evaluador_id));
  pie(page, f, d.tienda);
}

/** Arma el PDF de la evaluación (sin descargarlo). Separado para poder revisarlo en pruebas. */
export async function construirMagiaPdf(d: DatosMagiaPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const f: Fuentes = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    obl: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const e = d.evaluacion;
  pdf.setTitle(`Magia con una sonrisa - ${seguro(d.evaluado)} - ${periodoTitulo(e.anio, e.mes)}`);
  hojaEvaluacion(pdf, f, d);
  hojaResultados(pdf, f, d);
  return pdf.save();
}

export async function generarMagiaPdf(d: DatosMagiaPdf): Promise<void> {
  const bytes = await construirMagiaPdf(d);
  const nombre = d.evaluado
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]/g, "");
  const mm = String(d.evaluacion.mes).padStart(2, "0");
  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `Magia_${nombre}_${d.evaluacion.anio}-${mm}.pdf`);
}
