"use client";

// Exportador de horarios al formato oficial de la tienda (plantilla que se
// presenta al DSM). Carga HORARIOS_TEMPLATE.xlsx, elige la hoja base "HORARIOS
// FEBRERO" (col B=CARGO, C=NOMBRE, D-X=7 días × 3 subcol entrada/salida/
// almuerzo, Y=total con fórmula SUM), borra las demás hojas, la renombra al
// mes objetivo, y llena las celdas conservando fórmulas y merges.
//
// Reglas de asignación de hora-del-día (memoria: project-horarios-reglas):
//  - Turno 9h (apertura): L-J 6:00-15:00, V-S 7:00-16:00, D 8:00-17:00 + 1h alm.
//  - Turno 10h (cierre): L-J 10:30-20:30, V-S 11:00-21:00, D 10:00-20:00 + 1h alm.
//  - PT 4h: 15:00-19:00 sin almuerzo (fin de semana puede ser refuerzo cierre).
// Niveles de seguridad (J=5, SJ=4, Cajero=4, FT=3, PT=2) están DIFERIDOS —
// jefatura ajusta manualmente los casos donde un PT/FT quede solo cerrando.
//
// Orden de filas: Jefe → Subjefes → Cajeros → Full-time → Part-time. Solo
// personas ACTIVAS — las inactivas no aparecen porque ya no trabajan en la
// tienda (regla aclarada por Huber tras el primer test).

import ExcelJS from "exceljs";
import { NOMBRES_MES, type ResultadoGenerador } from "./horarios";
import type { Persona } from "./types";

const SHEET_BASE = "HORARIOS FEBRERO";
const NOMBRES_DIAS_LARGOS = [
  "DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO",
];

// ---------- Orden y etiqueta por rol ----------

function ordenExcel(persona: Persona): number {
  const c = (persona.cargo || "").toUpperCase();
  if (c.includes("JEFE") && !c.includes("SUB")) return 1;
  if (c.includes("SUB")) return 2;
  if (c.includes("CAJERO")) return 3;
  if (c.includes("PART")) return 5;
  return 4; // full-time (incluye "asociado de ventas", "full-time temporal", etc.)
}

function cargoLabel(persona: Persona): string {
  const c = (persona.cargo || "").toUpperCase();
  if (c.includes("JEFE") && !c.includes("SUB")) return "JEFE";
  if (c.includes("SUB")) return "SUB JEFE";
  if (c.includes("CAJERO")) return "CAJEROS";
  if (c.includes("PART TIME TEMPORAL") || c.includes("PART-TIME TEMPORAL")) return "PART-TIME TEMP";
  if (c.includes("PART")) return "PART-TIME";
  if (c.includes("FULL TIME TEMPORAL") || c.includes("FULL-TIME TEMPORAL")) return "FULL-TIME TEMP";
  return "FULL-TIME";
}

// ---------- Cálculo de turno según reglas hora-del-día ----------

type Turno = { entrada: number; salida: number; almuerzo: number };

function calcularTurno(weekday: number, shift: number): Turno | null {
  // weekday: 0=D, 1=L, ..., 6=S
  const esLJ = weekday >= 1 && weekday <= 4;
  const esVS = weekday === 5 || weekday === 6;
  const esD = weekday === 0;

  if (shift === 4) {
    // PT (sin almuerzo). Finde puede ser refuerzo cierre.
    if (weekday === 0 || weekday === 6) return { entrada: 16, salida: 20, almuerzo: 0 };
    return { entrada: 15, salida: 19, almuerzo: 0 };
  }
  if (shift === 9) {
    // Apertura
    if (esLJ) return { entrada: 6, salida: 15, almuerzo: 1 };
    if (esVS) return { entrada: 7, salida: 16, almuerzo: 1 };
    if (esD) return { entrada: 8, salida: 17, almuerzo: 1 };
  }
  if (shift === 10) {
    // Cierre — salida = hora de cierre del personal
    if (esLJ) return { entrada: 10.5, salida: 20.5, almuerzo: 1 };
    if (esVS) return { entrada: 11, salida: 21, almuerzo: 1 };
    if (esD) return { entrada: 10, salida: 20, almuerzo: 1 };
  }
  // Fallback para otros valores
  if (shift > 0) {
    return { entrada: 10, salida: 10 + shift, almuerzo: shift >= 6 ? 1 : 0 };
  }
  return null;
}

// ---------- Detección de bloques semanales en la hoja ----------

type BloqueSemana = {
  headerRow: number;
  cargoCol: number;
  nombreCol: number;
  primerDiaCol: number;
  ordenDias: Array<{ startCol: number; weekday: number }>; // orden real de días en las 7 columnas
  personaRowStart: number;
  personaRowEnd: number; // exclusive of count row
};

function detectarBloques(sheet: ExcelJS.Worksheet): BloqueSemana[] {
  const bloques: BloqueSemana[] = [];
  const maxRows = sheet.rowCount;

  for (let r = 1; r <= maxRows; r++) {
    const row = sheet.getRow(r);
    let cargoCol: number | null = null;
    let nombreCol: number | null = null;
    for (let c = 1; c <= 5; c++) {
      const v = String(row.getCell(c).value ?? "").trim().toUpperCase();
      if (v === "CARGO") cargoCol = c;
      if (v === "NOMBRE") nombreCol = c;
    }
    if (!cargoCol || !nombreCol) continue;

    // Primer día
    let primerDiaCol: number | null = null;
    for (let c = nombreCol + 1; c <= sheet.columnCount; c++) {
      const v = String(row.getCell(c).value ?? "").trim().toUpperCase();
      if (/^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)/.test(v)) {
        primerDiaCol = c;
        break;
      }
    }
    if (!primerDiaCol) continue;

    // Orden de días: buscamos labels reales en las 7 posiciones × 3 cols.
    // Si un bloque de la plantilla fue diseñado para menos días (ej. FEBRERO
    // bloque 1 solo tiene DOMINGO en col 22 porque feb 1 2026 era domingo),
    // extendemos artificialmente el orden a los 7 días asumiendo la posición
    // estándar de las columnas de la plantilla: la primera columna con día
    // detectado nos da el offset, y desde ahí L-M-X-J-V-S-D en pasos de 3.
    const ordenDiasReal: Array<{ startCol: number; weekday: number }> = [];
    for (let d = 0; d < 7; d++) {
      const col = primerDiaCol + d * 3;
      const txt = String(row.getCell(col).value ?? "").trim().toUpperCase();
      const wd = mapDiaNombreAWeekday(txt);
      if (wd !== null) ordenDiasReal.push({ startCol: col, weekday: wd });
    }

    // Si hay menos de 7 días detectados, forzamos las 7 posiciones estándar
    // (L, M, X, J, V, S, D) empezando en la columna donde estaría el LUNES
    // (col 4 = D en el layout FEBRERO). Esto permite que la exportación
    // funcione para meses cuyo calendario no coincide con el del template.
    const ORDEN_STANDARD_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // L, M, X, J, V, S, D
    const primerDiaLunesCol = 4; // col D — inicio estándar en plantilla FEBRERO
    const ordenDias = ordenDiasReal.length === 7
      ? ordenDiasReal
      : ORDEN_STANDARD_WEEKDAYS.map((wd, i) => ({
          startCol: primerDiaLunesCol + i * 3,
          weekday: wd,
        }));

    // Fila COUNT
    let countRow: number | null = null;
    for (let rr = r + 1; rr <= Math.min(maxRows, r + 40); rr++) {
      const cell = sheet.getRow(rr).getCell(primerDiaCol);
      const f = cell.formula ?? (cell.value as { formula?: string } | null)?.formula;
      if (typeof f === "string" && f.toUpperCase().startsWith("COUNT")) {
        countRow = rr;
        break;
      }
    }

    bloques.push({
      headerRow: r,
      cargoCol,
      nombreCol,
      primerDiaCol,
      ordenDias,
      personaRowStart: r + 1,
      personaRowEnd: countRow ? countRow - 1 : r + 22,
    });
  }
  return bloques;
}

function mapDiaNombreAWeekday(txt: string): number | null {
  if (txt.startsWith("LUNES")) return 1;
  if (txt.startsWith("MARTES")) return 2;
  if (txt.startsWith("MIERCOLES") || txt.startsWith("MIÉRCOLES")) return 3;
  if (txt.startsWith("JUEVES")) return 4;
  if (txt.startsWith("VIERNES")) return 5;
  if (txt.startsWith("SABADO") || txt.startsWith("SÁBADO")) return 6;
  if (txt.startsWith("DOMINGO")) return 0;
  return null;
}

// ---------- Cálculo de semanas del mes ----------

type DiaMes = { diaMes: number; weekday: number };

function computarSemanasDelMes(anio: number, mes: number): DiaMes[][] {
  const diasEnMes = new Date(anio, mes, 0).getDate();
  const semanas: DiaMes[][] = [];
  let semanaActual: DiaMes[] = [];

  for (let d = 1; d <= diasEnMes; d++) {
    const w = new Date(anio, mes - 1, d).getDay();
    semanaActual.push({ diaMes: d, weekday: w });
    if (w === 0) {
      semanas.push(semanaActual);
      semanaActual = [];
    }
  }
  if (semanaActual.length) semanas.push(semanaActual);
  return semanas;
}

// ---------- Exportador principal ----------

export async function exportarHorarioExcel(opts: {
  anio: number;
  mes: number;
  roster: Persona[]; // activos + inactivos — todos, ordenados aquí adentro
  resultado: ResultadoGenerador;
}): Promise<void> {
  const { anio, mes, roster, resultado } = opts;

  // Cargar plantilla
  const resp = await fetch("/plantillas/HORARIOS_TEMPLATE.xlsx");
  if (!resp.ok) throw new Error(`No pude cargar la plantilla (${resp.status}).`);
  const bytes = await resp.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);

  const sheet = wb.getWorksheet(SHEET_BASE);
  if (!sheet) {
    throw new Error(
      `La plantilla no tiene la hoja "${SHEET_BASE}". Hojas disponibles: ${wb.worksheets
        .map((w) => w.name)
        .join(", ")}`,
    );
  }

  // Borrar otras hojas
  for (const ws of wb.worksheets.slice()) {
    if (ws.id !== sheet.id) wb.removeWorksheet(ws.id);
  }

  // Renombrar y hacer visible
  const nombreMes = NOMBRES_MES[mes - 1].toUpperCase();
  sheet.name = `HORARIOS ${nombreMes} ${anio}`.slice(0, 30); // Excel limita 31 chars
  sheet.state = "visible";

  // Ordenar roster: SOLO activos (inactivos no trabajan en la tienda).
  const rosterOrdenado = roster
    .filter((p) => p.activo)
    .sort((a, b) => {
      const oa = ordenExcel(a);
      const ob = ordenExcel(b);
      if (oa !== ob) return oa - ob;
      return a.nombre.localeCompare(b.nombre);
    });

  // Detectar bloques y semanas del mes objetivo
  const bloques = detectarBloques(sheet);
  const semanasMes = computarSemanasDelMes(anio, mes);

  // Actualizar cabecera con el mes/año — la plantilla tiene "FEBRERO" fijo en varias celdas
  // Estrategia mínima: reemplazar "FEBRERO" (case-insensitive) por el nombre del mes objetivo
  // en las primeras 5 filas de las columnas B-C (donde suele estar el título).
  for (let r = 1; r <= 5; r++) {
    for (let c = 1; c <= 5; c++) {
      const cell = sheet.getRow(r).getCell(c);
      const v = cell.value;
      if (typeof v === "string" && /FEBRERO/i.test(v)) {
        cell.value = v.replace(/FEBRERO/gi, `${nombreMes} ${anio}`);
      }
    }
  }

  // Llenar cada bloque de semana con los datos correspondientes
  for (let wIdx = 0; wIdx < bloques.length; wIdx++) {
    const bloque = bloques[wIdx];
    const semana = semanasMes[wIdx]; // undefined si el mes tiene menos semanas que el template

    // 1) Actualizar day headers con las fechas de la semana objetivo (o dejar solo el nombre si no hay semana)
    for (const od of bloque.ordenDias) {
      const dia = semana?.find((d) => d.weekday === od.weekday);
      const label = dia
        ? `${NOMBRES_DIAS_LARGOS[od.weekday]} ${dia.diaMes}`
        : NOMBRES_DIAS_LARGOS[od.weekday];
      sheet.getRow(bloque.headerRow).getCell(od.startCol).value = label;
    }

    // 2) Limpiar celdas de personas del bloque anterior (valores previos del template)
    for (let r = bloque.personaRowStart; r <= bloque.personaRowEnd; r++) {
      const row = sheet.getRow(r);
      row.getCell(bloque.cargoCol).value = null;
      row.getCell(bloque.nombreCol).value = null;
      for (const od of bloque.ordenDias) {
        for (let sub = 0; sub < 3; sub++) {
          row.getCell(od.startCol + sub).value = null;
        }
      }
    }

    // 3) Llenar con el roster
    const filas = bloque.personaRowEnd - bloque.personaRowStart + 1;
    const personasAMostrar = rosterOrdenado.slice(0, filas);
    personasAMostrar.forEach((persona, pIdx) => {
      const rowNum = bloque.personaRowStart + pIdx;
      const row = sheet.getRow(rowNum);
      row.getCell(bloque.cargoCol).value = cargoLabel(persona);
      row.getCell(bloque.nombreCol).value = persona.nombre;

      if (!semana) return;

      // Horas por día
      for (const od of bloque.ordenDias) {
        const dia = semana.find((d) => d.weekday === od.weekday);
        if (!dia) continue;
        const celda = resultado.grid[persona.id]?.dias[dia.diaMes];
        if (!celda || celda.tipo !== "trabajo" || celda.horas <= 0) continue;
        const turno = calcularTurno(od.weekday, celda.horas);
        if (!turno) continue;
        row.getCell(od.startCol).value = turno.entrada;
        row.getCell(od.startCol + 1).value = turno.salida;
        row.getCell(od.startCol + 2).value = turno.almuerzo;
      }
    });
  }

  // Descargar
  const outBuf = await wb.xlsx.writeBuffer();
  const blob = new Blob([outBuf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Horarios_${nombreMes}_${anio}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
