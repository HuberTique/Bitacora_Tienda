"use client";

// Lee la hoja "Target" del planeador de la tienda: define el MES RETAIL de la
// compañía (rango de fechas propio, p. ej. 30-ago a 3-oct) y trae, por día, la
// meta (TARGET), la venta del año anterior, la venta con IVA y la venta REAL.

import ExcelJS from "exceljs";
import { NOMBRES_MES } from "./horarios";
import type { SemanaRetail } from "./mes-retail";

export type DiaTarget = {
  fecha: string; // YYYY-MM-DD
  target: number | null;
  anioAnterior: number | null;
  ventaConIva: number | null;
  real: number | null;
};

export type TargetParsed = {
  hoja: string;
  nombreMes: string; // p. ej. "septiembre"
  anio: number;
  mes: number; // mes retail 1..12
  tienda: string | null;
  inicio: string;
  fin: string;
  presupuesto: number;
  dias: DiaTarget[];
  semanas: SemanaRetail[];
  /** Último día con venta real cargada: hasta ahí llegan los datos. */
  fechaCorte: string | null;
  metaACorte: number;
  ventaACorte: number;
};

const norm = (v: unknown): string =>
  (v == null ? "" : String(v))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

function valor(cell: ExcelJS.Cell): unknown {
  let v: unknown = cell.value;
  if (v && typeof v === "object" && !(v instanceof Date) && "result" in v) {
    v = (v as { result?: unknown }).result;
  }
  if (v && typeof v === "object" && !(v instanceof Date) && "richText" in v) {
    v = (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join("");
  }
  return v;
}

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

function aFecha(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const c = v.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (c) {
      const y = c[3].length === 2 ? 2000 + Number(c[3]) : Number(c[3]);
      return `${y}-${c[2].padStart(2, "0")}-${c[1].padStart(2, "0")}`;
    }
  }
  return null;
}

const suma = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

export async function leerTargetDesdeArchivo(
  file: File | ArrayBuffer,
): Promise<TargetParsed | { error: string }> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const hoja = wb.worksheets.find((w) => norm(w.name) === "target");
  if (!hoja) return { error: 'No encontré la hoja "Target" (calendario y metas por día).' };

  // Encabezado: fila con "FECHA" y "TARGET".
  let filaH = 0;
  hoja.eachRow({ includeEmpty: false }, (row, n) => {
    if (filaH) return;
    const et: string[] = [];
    for (let c = 1; c <= hoja.columnCount; c++) et.push(norm(valor(row.getCell(c))));
    if (et.includes("fecha") && et.includes("target")) filaH = n;
  });
  if (!filaH) return { error: 'No encontré el encabezado de la hoja Target ("FECHA", "TARGET").' };

  const cab: string[] = [];
  for (let c = 1; c <= hoja.columnCount; c++) cab.push(norm(valor(hoja.getRow(filaH).getCell(c))));
  const col = (pred: (e: string) => boolean) => cab.findIndex(pred) + 1;
  const cFecha = col((e) => e === "fecha");
  const cTarget = col((e) => e === "target");
  const cAnt = col((e) => /^\d{4}$/.test(e)); // columna del año anterior ("2025")
  const cIva = col((e) => e.includes("venta con iva"));
  const cReal = col((e) => e === "real");

  const nombreMes = String(valor(hoja.getRow(filaH).getCell(1)) ?? "").trim();
  const idxMes = NOMBRES_MES.findIndex((m) => norm(m) === norm(nombreMes));

  const dias: DiaTarget[] = [];
  for (let n = filaH + 1; n <= hoja.rowCount; n++) {
    const row = hoja.getRow(n);
    const fecha = aFecha(valor(row.getCell(cFecha)));
    if (!fecha) {
      if (dias.length > 0) break;
      continue;
    }
    dias.push({
      fecha,
      target: num(valor(row.getCell(cTarget))),
      anioAnterior: cAnt ? num(valor(row.getCell(cAnt))) : null,
      ventaConIva: cIva ? num(valor(row.getCell(cIva))) : null,
      real: cReal ? num(valor(row.getCell(cReal))) : null,
    });
  }
  if (dias.length === 0) return { error: "La hoja Target no tiene fechas." };

  // Mes retail = el mes que nombra el título; el año, el de los días que caen en ese mes.
  const mes = idxMes >= 0 ? idxMes + 1 : Number(dias[Math.floor(dias.length / 2)].fecha.slice(5, 7));
  const delMes = dias.find((d) => Number(d.fecha.slice(5, 7)) === mes) ?? dias[0];
  const anio = Number(delMes.fecha.slice(0, 4));

  // Semanas: de domingo a sábado.
  const semanas: SemanaRetail[] = [];
  let grupo: DiaTarget[] = [];
  const cerrar = () => {
    if (grupo.length === 0) return;
    semanas.push({
      numero: semanas.length + 1,
      inicio: grupo[0].fecha,
      fin: grupo[grupo.length - 1].fecha,
      target: suma(grupo.map((g) => g.target)),
      anio_anterior: suma(grupo.map((g) => g.anioAnterior)),
      real: suma(grupo.map((g) => g.real)),
    });
    grupo = [];
  };
  for (const d of dias) {
    const [y, m, dd] = d.fecha.split("-").map(Number);
    if (new Date(y, m - 1, dd).getDay() === 0) cerrar();
    grupo.push(d);
  }
  cerrar();

  const conReal = dias.filter((d) => d.real != null);
  const fechaCorte = conReal.length ? conReal[conReal.length - 1].fecha : null;
  const hastaCorte = fechaCorte ? dias.filter((d) => d.fecha <= fechaCorte) : [];
  const tiendaCel = valor(hoja.getCell("D1"));
  return {
    fechaCorte,
    metaACorte: hastaCorte.reduce((a, d) => a + (d.target ?? 0), 0),
    ventaACorte: hastaCorte.reduce((a, d) => a + (d.real ?? 0), 0),
    hoja: hoja.name,
    nombreMes: nombreMes.toLowerCase(),
    anio,
    mes,
    tienda: tiendaCel == null ? null : String(tiendaCel),
    inicio: dias[0].fecha,
    fin: dias[dias.length - 1].fecha,
    presupuesto: dias.reduce((a, d) => a + (d.target ?? 0), 0),
    dias,
    semanas,
  };
}
