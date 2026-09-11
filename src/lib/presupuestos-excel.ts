"use client";

// Parser del Excel oficial de presupuestos — hoja "KPIS SEM.".
// Puerto TS del `parseKpisPeriodoRows` del artifact original.
//
// La hoja tiene 2 tablas:
//   1) METAS por persona: cargo | nombre | presupuesto | horas
//   2) REALES por persona: cargo | nombre | pto | acumulado bruto | acumulado neto
//      | % | pares M | pares V | acc M | acc V | ropa M | ropa V | unds | trx | upt
//      | horas trabajadas
// La detección de columnas es por ETIQUETA (no por posición fija) porque el
// archivo cambia de layout entre semanas.
//
// Además detecta totales de la hoja: presupuesto semanal, horas laboradas
// total, y venta/hora (si no viene explícita se deriva de los dos anteriores).

import ExcelJS from "exceljs";
import { matchPersonaPorNombre } from "./imagenIA";
import type { Persona } from "./types";

// ---------- Tipos ----------

export type MetaPersona = {
  cargo: string;
  nombre: string;
  presupuesto: number;
  horas: number | null;
};

export type RealPersona = {
  cargo: string;
  nombre: string;
  pto: number | null;
  acumuladoBruto: number | null;
  acumuladoNeto: number | null;
  cumplimiento: number | null;
  paresVenta: number | null;
  accVenta: number | null;
  ropaVenta: number | null;
  undsVendidas: number | null;
  trx: number | null;
  upt: number | null;
  horasTrabajadas: number | null;
};

export type KpisSemParsed = {
  semanaLabel: string | null;
  presupuestoSemanaTotal: number | null;
  horasLaboradasTotal: number | null;
  ventaPorHora: number | null;
  metas: MetaPersona[];
  reales: RealPersona[];
};

/**
 * Fila unificada por persona (join de meta + real). Con `persona_id` del
 * roster ya matcheado; si no hay match, queda null y se muestra en la
 * preview para que jefatura decida (asignar manual / ignorar).
 */
export type FilaUnificada = {
  nombreExcel: string;
  cargoExcel: string;
  meta: number | null;
  venta: number | null;
  cumplimiento: number | null;
  horasReportadas: number | null;
  personaId: string | null;
  personaNombre: string | null;
};

// ---------- Parser core ----------

const norm = (v: unknown): string =>
  (v == null ? "" : String(v)).trim().toLowerCase();

const esVacio = (v: unknown): boolean =>
  v == null || v === "" || norm(v) === "#ref!";

const colDe = (headerRow: unknown[], ...opciones: string[]): number => {
  for (let i = 0; i < headerRow.length; i++) {
    if (opciones.includes(norm(headerRow[i]))) return i;
  }
  for (let i = 0; i < headerRow.length; i++) {
    if (opciones.some((o) => norm(headerRow[i]).includes(o))) return i;
  }
  return -1;
};

const CARGOS_CONOCIDOS_TEST = (v: unknown): boolean => {
  const u = String(v ?? "").trim().toUpperCase();
  if (!u) return false;
  return (
    u.startsWith("CAJERO") ||
    u.includes("FULLTIME") ||
    u.includes("FULL TIME") ||
    u.includes("FULL-TIME") ||
    u.includes("PARTIME") ||
    u.includes("PART TIME") ||
    u.includes("PART-TIME") ||
    u.startsWith("JEFE") ||
    u.startsWith("SUBJEFE") ||
    u.includes("SIN CARGO")
  );
};

function detectarColumnasPersona(
  header: unknown[],
  rows: unknown[][],
  desdeIdx: number,
): { cCargo: number; cNombre: number } {
  let cCargo = colDe(header, "cargo");
  let cNombre = colDe(header, "nombre");
  // Caso: la columna rotulada "NOMBRE" en realidad tiene el cargo (a veces
  // pasa en archivos donde no hay columna "CARGO" separada). Se valida
  // contra una fila real de datos.
  if (cCargo < 0 && cNombre >= 0) {
    let filaDatos: unknown[] | null = null;
    for (let k = desdeIdx; k < Math.min(desdeIdx + 6, rows.length); k++) {
      if (rows[k] && !esVacio(rows[k][cNombre])) {
        filaDatos = rows[k];
        break;
      }
    }
    if (filaDatos && CARGOS_CONOCIDOS_TEST(String(filaDatos[cNombre] ?? "").trim())) {
      cCargo = cNombre;
      cNombre = cNombre + 1;
    }
  }
  return { cCargo, cNombre };
}

/**
 * Extrae el label del período de la primera celda "titular" de la hoja.
 * Puede venir como texto ("CIERRE SEMANA 27") o como Date. En el segundo
 * caso, si es válida se formatea; si no, devuelve null (evita mostrar
 * "Invalid Date" en la UI).
 */
function extraerPeriodoLabel(cell: unknown): string | null {
  if (cell == null || cell === "") return null;
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return null;
    return cell.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }
  const s = String(cell).trim();
  return s === "" || s.toLowerCase() === "invalid date" ? null : s;
}

export function parseKpisPeriodoRows(rows: unknown[][]): KpisSemParsed | null {
  let presupuestoTotal: number | null = null;
  let horasLaboradasTotal: number | null = null;
  let ventaPorHora: number | null = null;
  const periodoLabel = extraerPeriodoLabel(rows[0]?.[1]);

  rows.forEach((r) => {
    if (!r) return;
    const b = norm(r[1]);
    if (b.startsWith("presupuesto ") && typeof r[3] === "number") {
      presupuestoTotal = r[3] as number;
    }
    if (b === "horas laboradas" && typeof r[3] === "number") {
      horasLaboradasTotal = r[3] as number;
    }
    if (b.includes("vta x hora") && typeof r[3] === "number") {
      ventaPorHora = r[3] as number;
    }
  });
  if (ventaPorHora == null && presupuestoTotal != null && horasLaboradasTotal != null) {
    ventaPorHora = presupuestoTotal / horasLaboradasTotal;
  }

  // Tabla 1: metas
  const metas: MetaPersona[] = [];
  const i1 = rows.findIndex(
    (r) =>
      r &&
      r.some((c) => norm(c) === "nombre") &&
      r.some((c) => norm(c).includes("presupuesto")),
  );
  if (i1 >= 0) {
    const header = rows[i1];
    const { cCargo, cNombre } = detectarColumnasPersona(header, rows, i1 + 1);
    const cPresupuesto = header.findIndex((c) => norm(c).includes("presupuesto"));
    const cHoras = header.findIndex((c) => norm(c).includes("horas"));
    let vacias = 0;
    for (let i = i1 + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) {
        vacias++;
        if (vacias > 3) break;
        continue;
      }
      const nombreVal = r[cNombre];
      if (norm(nombreVal) === "nombre") break;
      if (norm(nombreVal) === "total") break;
      if (esVacio(nombreVal) || typeof r[cPresupuesto] !== "number") {
        vacias++;
        if (vacias > 5) break; // más tolerante — 5 vacías seguidas para cortar
        continue;
      }
      vacias = 0;
      metas.push({
        cargo: cCargo >= 0 ? String(r[cCargo] ?? "").trim() : "",
        nombre: String(nombreVal).trim(),
        presupuesto: r[cPresupuesto] as number,
        horas: cHoras >= 0 && typeof r[cHoras] === "number" ? (r[cHoras] as number) : null,
      });
    }
  }
  // Silenciar el helper — antes se usaba para cortar la tabla, ahora es
  // opcional (jefatura puede revisar visualmente en el preview si algo
  // extraño se coló).
  void CARGOS_CONOCIDOS_TEST;

  // Tabla 2: reales
  const reales: RealPersona[] = [];
  const i2Idx = rows.findIndex(
    (r, idx) =>
      idx > i1 &&
      r &&
      r.some((c) => norm(c) === "nombre") &&
      r.some((c) => norm(c) === "pto"),
  );
  if (i2Idx >= 0) {
    const header = rows[i2Idx];
    const { cCargo, cNombre } = detectarColumnasPersona(header, rows, i2Idx + 1);
    const cPto = colDe(header, "pto");
    const cBruto = header.findIndex((c) => norm(c).includes("acumulado bruto"));
    const cNeto = header.findIndex((c) => norm(c).includes("acumulado neto"));
    const cPct = colDe(header, "%");
    const cParesM = header.findIndex((c) => norm(c).includes("pares"));
    const cParesV = cParesM >= 0 ? cParesM + 1 : -1;
    const cAccM = header.findIndex((c) => norm(c).includes("acc"));
    const cAccV = cAccM >= 0 ? cAccM + 1 : -1;
    const cRopaM = header.findIndex((c) => norm(c).includes("ropa"));
    const cRopaV = cRopaM >= 0 ? cRopaM + 1 : -1;
    const cUnds = header.findIndex((c) => norm(c).includes("unds"));
    const cTrx = colDe(header, "trx");
    const cUpt = colDe(header, "upt");
    const cHorasTrab = header.findIndex((c) => norm(c).includes("horas trabajadas"));

    let vacias = 0;
    for (let i = i2Idx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) {
        vacias++;
        if (vacias > 4) break;
        continue;
      }
      const nombreVal = r[cNombre];
      if (norm(nombreVal) === "nombre") break;
      if (esVacio(nombreVal)) {
        vacias++;
        if (vacias > 6) break;
        continue;
      }
      vacias = 0;
      const numOrNull = (idx: number): number | null =>
        idx >= 0 && typeof r[idx] === "number" ? (r[idx] as number) : null;
      reales.push({
        cargo: cCargo >= 0 ? String(r[cCargo] ?? "").trim() : "",
        nombre: String(nombreVal).trim(),
        pto: numOrNull(cPto),
        acumuladoBruto: numOrNull(cBruto),
        acumuladoNeto: numOrNull(cNeto),
        cumplimiento: numOrNull(cPct),
        paresVenta: numOrNull(cParesV),
        accVenta: numOrNull(cAccV),
        ropaVenta: numOrNull(cRopaV),
        undsVendidas: numOrNull(cUnds),
        trx: numOrNull(cTrx),
        upt: numOrNull(cUpt),
        horasTrabajadas: numOrNull(cHorasTrab),
      });
    }
  }

  if (metas.length === 0 && reales.length === 0) return null;
  return {
    semanaLabel: periodoLabel,
    presupuestoSemanaTotal: presupuestoTotal,
    horasLaboradasTotal,
    ventaPorHora,
    metas,
    reales,
  };
}

// ---------- Lectura del archivo Excel ----------

/** Encuentra el nombre de hoja "KPIS SEM" (o cualquier hoja con "KPI"). */
function nombreHojaKpis(wb: ExcelJS.Workbook): string | null {
  const sheets = wb.worksheets.map((w) => w.name);
  const conSem = sheets.find((n) => {
    const u = n.toUpperCase();
    return u.includes("KPI") && u.includes("SEM");
  });
  if (conSem) return conSem;
  return sheets.find((n) => n.toUpperCase().includes("KPI")) ?? null;
}

/**
 * Convierte una ExcelJS.Worksheet a array-of-arrays (index 1-based del Excel
 * se preserva en `rows[filaExcel - 1][colExcel - 1]`). Necesario para reusar
 * la lógica del parser original que asume acceso posicional r[0], r[1], etc.
 */
function worksheetToRows(sheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const arr: unknown[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = row.getCell(c);
      let v: unknown = cell.value;
      // Fórmulas: leer el resultado
      if (v && typeof v === "object" && "result" in v) {
        v = (v as { result?: unknown }).result;
      }
      // Rich text: aplanar
      if (v && typeof v === "object" && "richText" in v) {
        v = (v as { richText: Array<{ text: string }> }).richText
          .map((rt) => rt.text)
          .join("");
      }
      arr[c - 1] = v ?? "";
    }
    rows[rowNumber - 1] = arr;
  });
  return rows;
}

/** Lee un archivo Excel y parsea la hoja KPIS SEM. */
export async function leerKpisSemDesdeArchivo(
  file: File | ArrayBuffer,
): Promise<{ hojaUsada: string | null; parsed: KpisSemParsed | null; hojasDisponibles: string[] }> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const hojasDisponibles = wb.worksheets.map((w) => w.name);
  const hojaUsada = nombreHojaKpis(wb);
  if (!hojaUsada) return { hojaUsada: null, parsed: null, hojasDisponibles };
  const sheet = wb.getWorksheet(hojaUsada);
  if (!sheet) return { hojaUsada, parsed: null, hojasDisponibles };
  const rows = worksheetToRows(sheet);
  const parsed = parseKpisPeriodoRows(rows);
  return { hojaUsada, parsed, hojasDisponibles };
}

// ---------- Unificación meta + real + matching a personal ----------

/**
 * Combina metas + reales por nombre, matchea cada uno al roster de personal
 * y devuelve una lista lista para preview y para inserción en Supabase.
 * Un asesor que aparece en metas pero no en reales conserva meta con
 * venta=null (esperando cierre de semana), y viceversa.
 */
export function unificarPresupuestos(
  parsed: KpisSemParsed,
  roster: Persona[],
): FilaUnificada[] {
  const map = new Map<string, FilaUnificada>();
  const activo = roster.filter((p) => p.activo);

  const upsert = (nombreExcel: string, cargoExcel: string) => {
    const key = nombreExcel.toLowerCase().trim();
    if (!map.has(key)) {
      const persona = matchPersonaPorNombre(nombreExcel, activo);
      map.set(key, {
        nombreExcel,
        cargoExcel,
        meta: null,
        venta: null,
        cumplimiento: null,
        horasReportadas: null,
        personaId: persona?.id ?? null,
        personaNombre: persona?.nombre ?? null,
      });
    }
    return map.get(key)!;
  };

  for (const m of parsed.metas) {
    const f = upsert(m.nombre, m.cargo);
    f.meta = m.presupuesto;
    if (m.horas != null) f.horasReportadas = m.horas;
  }
  for (const r of parsed.reales) {
    const f = upsert(r.nombre, r.cargo);
    if (r.pto != null) f.meta = r.pto;
    if (r.acumuladoNeto != null) f.venta = r.acumuladoNeto;
    if (r.cumplimiento != null) f.cumplimiento = r.cumplimiento;
    if (r.horasTrabajadas != null) f.horasReportadas = r.horasTrabajadas;
  }

  return [...map.values()].sort((a, b) => (b.meta ?? 0) - (a.meta ?? 0));
}

// ============================================================
// Parser de la hoja "Target" — presupuesto y venta por día del mes.
// ============================================================

export type FilaTarget = {
  fecha: string;          // YYYY-MM-DD
  weekday: string;        // "domingo", "lunes", ...
  target: number | null;  // meta del día
  ventaBruta: number | null; // venta con IVA
  ventaNeta: number | null;  // venta real (sin IVA)
};

export type TargetParsed = {
  filas: FilaTarget[];
  totalMes: number | null;
  ventaAcumulada: number | null;
};

/**
 * Parser de la hoja "Target": tabla diaria con fecha | meta | venta neta.
 * Estructura típica (columnas):
 *   A=día(texto), B=fecha, C=target, D=año anterior, E=%, F=venta iva,
 *   G=real (venta neta), H=var $, I=var %
 * Cortamos cuando encontramos la fila TOTAL o cuando no hay fecha.
 */
export function parseTargetRows(rows: unknown[][]): TargetParsed | null {
  // Encontrar la fila de header (contiene "TARGET" y "FECHA")
  const headerIdx = rows.findIndex(
    (r) =>
      r &&
      r.some((c) => norm(c) === "fecha") &&
      r.some((c) => norm(c) === "target"),
  );
  if (headerIdx < 0) return null;
  const header = rows[headerIdx];
  const cFecha = colDe(header, "fecha");
  const cTarget = colDe(header, "target");
  const cVentaIva = header.findIndex((c) => norm(c).includes("venta con iva"));
  const cReal = colDe(header, "real");

  const filas: FilaTarget[] = [];
  let totalMes: number | null = null;
  let ventaAcumulada: number | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rawFecha = r[cFecha];
    const rawWeekday = String(r[0] ?? "").trim().toLowerCase();

    // Fila TOTAL: acumular y salir
    if (rawWeekday === "total" || norm(r[cFecha]) === "total") {
      if (typeof r[cTarget] === "number") totalMes = r[cTarget] as number;
      if (cReal >= 0 && typeof r[cReal] === "number") ventaAcumulada = r[cReal] as number;
      break;
    }

    // Sin fecha válida → fila vacía o de fórmula rota, saltar
    let fecha: string | null = null;
    if (rawFecha instanceof Date && !isNaN(rawFecha.getTime())) {
      fecha = rawFecha.toISOString().slice(0, 10);
    } else if (typeof rawFecha === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawFecha)) {
      fecha = rawFecha.slice(0, 10);
    }
    if (!fecha) continue;

    const numOrNull = (idx: number): number | null =>
      idx >= 0 && typeof r[idx] === "number" ? (r[idx] as number) : null;

    filas.push({
      fecha,
      weekday: rawWeekday,
      target: numOrNull(cTarget),
      ventaBruta: numOrNull(cVentaIva),
      ventaNeta: numOrNull(cReal),
    });
  }

  // Si no encontramos TOTAL, calcular como suma de targets
  if (totalMes == null && filas.length > 0) {
    totalMes = filas.reduce((s, f) => s + (f.target ?? 0), 0);
  }
  if (ventaAcumulada == null && filas.length > 0) {
    const suma = filas.reduce((s, f) => s + (f.ventaNeta ?? 0), 0);
    if (suma > 0) ventaAcumulada = suma;
  }

  if (filas.length === 0) return null;
  return { filas, totalMes, ventaAcumulada };
}

/** Busca la hoja "Target" en el workbook (case-insensitive). */
function nombreHojaTarget(wb: ExcelJS.Workbook): string | null {
  return wb.worksheets.map((w) => w.name).find((n) => n.toUpperCase() === "TARGET") ?? null;
}

/** Lee un archivo y parsea AMBAS hojas si existen (KPIS SEM. y Target). */
export async function leerPresupuestoDesdeArchivo(
  file: File | ArrayBuffer,
): Promise<{
  hojasDisponibles: string[];
  kpis: {
    hojaUsada: string | null;
    parsed: KpisSemParsed | null;
  };
  target: {
    hojaUsada: string | null;
    parsed: TargetParsed | null;
  };
}> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const hojasDisponibles = wb.worksheets.map((w) => w.name);

  // KPIS SEM.
  const hojaKpis = nombreHojaKpis(wb);
  let kpisParsed: KpisSemParsed | null = null;
  if (hojaKpis) {
    const rows = worksheetToRows(wb.getWorksheet(hojaKpis)!);
    kpisParsed = parseKpisPeriodoRows(rows);
  }

  // Target
  const hojaTarget = nombreHojaTarget(wb);
  let targetParsed: TargetParsed | null = null;
  if (hojaTarget) {
    const rows = worksheetToRows(wb.getWorksheet(hojaTarget)!);
    targetParsed = parseTargetRows(rows);
  }

  return {
    hojasDisponibles,
    kpis: { hojaUsada: hojaKpis, parsed: kpisParsed },
    target: { hojaUsada: hojaTarget, parsed: targetParsed },
  };
}
