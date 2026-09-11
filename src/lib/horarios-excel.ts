"use client";

// Exportador de horarios al formato oficial de la tienda.
//
// APPROACH: construye la hoja desde cero, sin cargar la plantilla. El layout
// replica visualmente la plantilla oficial HORARIOS_TEMPLATE.xlsx (hoja
// "HORARIOS FEBRERO" tomada como referencia canónica de formato). Ver
// scripts/inspect-template.mjs para inspección detallada.
//
// LAYOUT por bloque de semana:
//   B  = CARGO (mergeado verticalmente para agrupar personas del mismo cargo)
//   C  = NOMBRE
//   D-F = LUNES (ENT, SAL, ALM)     — header "LUNES X" repetido en las 3 cols
//   G-I = MARTES,  J-L = MIÉRCOLES,  M-O = JUEVES,
//   P-R = VIERNES, S-U = SÁBADO,     V-X = DOMINGO
//   Y  = TOTAL con fórmula:
//        =SUM(E-D-F+H-G-I+K-J-L+N-M-O+Q-P-R+T-S-U+W-V-X)
//   Fila COUNT debajo del bloque cuenta personas programadas por día.
//
// Reglas hora-del-día (memoria: project-horarios-reglas):
//  - Turno 9h (apertura): L-J 6-15, V-S 7-16, D 8-17 + 1h alm.
//  - Turno 10h (cierre): L-J 10.5-20.5, V-S 11-21, D 10-20 + 1h alm.
//  - PT 4h: 15-19 (finde 16-20).

import ExcelJS from "exceljs";
import { NOMBRES_MES, type ResultadoGenerador } from "./horarios";
import type { Horario, Persona, RolJerarquico } from "./types";

const NOMBRES_DIAS = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];

// Orden L-M-X-J-V-S-D (estándar del template)
const ORDEN_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

// ---------- Estilos alineados con la plantilla oficial ----------
// La plantilla es minimalista: casi todas las celdas son blancas, solo el
// texto de sábado y domingo va en ROJO. No usa fills salvo excepciones.
// Agregamos coloreado suave por grupo de rol (visual coding) — mejora de
// legibilidad sobre la plantilla original, ayuda a jefatura a identificar
// visualmente cada grupo cuando lo presenta al DSM.
const COLOR = {
  textFinde: "FFFF0000",       // ROJO para sábado/domingo (texto)
  textLunes: "FFFF0000",       // ROJO también para lunes (convención plantilla)
  descansoFill: "FFA6A6A6",    // gris medio para descanso
  libreFill: "FFFFE699",       // amarillo pálido para libre solicitado
  countFill: "FFF2F2F2",       // gris muy claro para fila COUNT
  aperturaFill: "FFFFD9B3",    // naranja pálido — resalta APERTURAS (shift 9)
  actividadFill: "FFEDEDED",   // gris muy claro para banda de actividades
  border: "FF000000",          // negro para bordes
};

// Fills suaves por grupo de rol — colores pastel muy tenues que no
// interfieren con la legibilidad de los números.
const FILL_POR_ROL: Record<RolJerarquico, string> = {
  jefe_tienda: "FFFCE4EC",  // rosa pálido
  subjefe: "FFFFF9C4",       // amarillo pálido
  cajero: "FFE1F5FE",        // cyan pálido
  full_time: "FFE8F5E9",     // verde pálido
  part_time: "FFF3E5F5",     // violeta pálido
};

// ---------- Orden y etiqueta por rol jerárquico ----------

const ORDEN_ROL: Record<RolJerarquico, number> = {
  jefe_tienda: 1,
  subjefe: 2,
  cajero: 3,
  full_time: 4,
  part_time: 5,
};

// Labels EXACTOS como los usa la plantilla oficial (incluye espacios finales
// donde aplica — respeta las convenciones que ya conocen DSM y jefatura).
const LABEL_ROL_BASE: Record<RolJerarquico, string> = {
  jefe_tienda: "JEFE ",
  subjefe: "SUB JEFE ",
  cajero: "CAJEROS",
  full_time: "FULL-TIME",
  part_time: "PART-TIME",
};

function cargoLabel(persona: Persona): string {
  const base = LABEL_ROL_BASE[persona.rol_jerarquico];
  const c = (persona.cargo || "").toUpperCase();
  if (c.includes("TEMPORAL")) {
    if (persona.rol_jerarquico === "part_time") return "PART-TIME TEMP";
    if (persona.rol_jerarquico === "full_time") return "FULL-TIME TEMP";
  }
  return base;
}

// ---------- Cálculo de turno ----------

type Turno = { entrada: number; salida: number; almuerzo: number };

function calcularTurno(weekday: number, shift: number): Turno | null {
  const esLJ = weekday >= 1 && weekday <= 4;
  const esVS = weekday === 5 || weekday === 6;
  const esD = weekday === 0;

  if (shift === 4) {
    if (weekday === 0 || weekday === 6) return { entrada: 16, salida: 20, almuerzo: 0 };
    return { entrada: 15, salida: 19, almuerzo: 0 };
  }
  if (shift === 9) {
    if (esLJ) return { entrada: 6, salida: 15, almuerzo: 1 };
    if (esVS) return { entrada: 7, salida: 16, almuerzo: 1 };
    if (esD) return { entrada: 8, salida: 17, almuerzo: 1 };
  }
  if (shift === 10) {
    if (esLJ) return { entrada: 10.5, salida: 20.5, almuerzo: 1 };
    if (esVS) return { entrada: 11, salida: 21, almuerzo: 1 };
    if (esD) return { entrada: 10, salida: 20, almuerzo: 1 };
  }
  if (shift > 0) {
    return { entrada: 10, salida: 10 + shift, almuerzo: shift >= 6 ? 1 : 0 };
  }
  return null;
}

// ---------- Cálculo de semanas del mes ----------

/**
 * Un día dentro de una semana renderizada. `enMesObjetivo` indica si el
 * día pertenece al mes que estamos exportando. Días fuera del mes se
 * muestran igual (para que jefatura vea el CONTEXTO de las semanas
 * boundary — ej. Ago 31 en la primera semana de Sept). Sus datos vienen
 * de `horariosContexto` (mes previo/siguiente ya guardado).
 */
type DiaSemana = {
  diaMes: number;
  weekday: number;
  anio: number;
  mes: number;
  clave: string; // YYYY-MM-DD
  enMesObjetivo: boolean;
};

/**
 * Devuelve semanas L-D COMPLETAS de 7 días que tocan el mes objetivo,
 * incluyendo días de meses adyacentes en los bordes.
 */
function computarSemanasCompletas(anio: number, mes: number): DiaSemana[][] {
  const primerDia = new Date(anio, mes - 1, 1);
  const primerWeekday = primerDia.getDay();
  const diasHastaLunes = primerWeekday === 0 ? 6 : primerWeekday - 1;
  const inicio = new Date(primerDia);
  inicio.setDate(inicio.getDate() - diasHastaLunes);

  const ultimoDia = new Date(anio, mes, 0);
  const ultimoWeekday = ultimoDia.getDay();
  const diasHastaDomingo = ultimoWeekday === 0 ? 0 : 7 - ultimoWeekday;
  const fin = new Date(ultimoDia);
  fin.setDate(fin.getDate() + diasHastaDomingo);

  const semanas: DiaSemana[][] = [];
  const cursor = new Date(inicio);
  while (cursor <= fin) {
    const semana: DiaSemana[] = [];
    for (let i = 0; i < 7; i++) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const d = cursor.getDate();
      semana.push({
        diaMes: d,
        weekday: cursor.getDay(),
        anio: y,
        mes: m,
        clave: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        enMesObjetivo: y === anio && m === mes,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

// ---------- Helpers ----------

function borderAll(argb = COLOR.border) {
  return {
    top: { style: "thin" as const, color: { argb } },
    left: { style: "thin" as const, color: { argb } },
    bottom: { style: "thin" as const, color: { argb } },
    right: { style: "thin" as const, color: { argb } },
  };
}

function fill(argb: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } };
}

function numToColLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ---------- Layout constants ----------
// Coincide con la plantilla FEBRERO extendido con col HORAS EXTRAS:
//   B=CARGO(2), C=NOMBRE(3), D-X=días (4..24), Y=TRABAJA(25), Z=H.EXTRAS(26)
const COL_CARGO = 2;
const COL_NOMBRE = 3;
const COL_PRIMER_DIA = 4;
const COL_TOTAL = 25;
const COL_HORAS_EXTRAS = 26;

function configurarAnchosColumnas(sheet: ExcelJS.Worksheet, roster: Persona[]) {
  // Ancho de NOMBRE calculado según el nombre más largo del roster (para
  // que no se corte visualmente). Ancho de CARGO fijo — cabe cualquiera
  // de las etiquetas conocidas (FULL-TIME TEMP, PART-TIME TEMP).
  const maxNombre = Math.max(
    12,
    ...roster.map((p) => p.nombre.length),
  );
  const maxCargo = Math.max(
    10,
    ...roster.map((p) => cargoLabel(p).length),
  );

  sheet.getColumn(1).width = 3;
  sheet.getColumn(COL_CARGO).width = maxCargo + 2;
  sheet.getColumn(COL_NOMBRE).width = maxNombre + 3;
  for (let i = 0; i < 21; i++) {
    sheet.getColumn(COL_PRIMER_DIA + i).width = 6.6;
  }
  sheet.getColumn(COL_TOTAL).width = 8;
  sheet.getColumn(COL_HORAS_EXTRAS).width = 10;
}

/**
 * Devuelve el color de texto correcto según el día. La plantilla marca en
 * rojo el LUNES y el fin de semana (SÁBADO, DOMINGO). El resto va en negro.
 */
function colorTextoDia(weekday: number): string {
  if (weekday === 0 || weekday === 6) return COLOR.textFinde;  // dom/sab
  if (weekday === 1) return COLOR.textLunes;                    // lunes
  return "FF000000";                                             // negro
}

// ---------- Construcción de bloque de semana ----------

/**
 * Escribe el header de una semana en la fila `filaHeader`: repite el nombre
 * del día ("LUNES X") en las 3 subcolumnas de cada día — mismo estilo que
 * la plantilla oficial (más simple, sin sub-header ENT/SAL/ALM).
 */
function escribirHeaderSemana(
  sheet: ExcelJS.Worksheet,
  filaHeader: number,
  semana: DiaSemana[],
) {
  const row = sheet.getRow(filaHeader);
  row.height = 22;

  const cellCargo = row.getCell(COL_CARGO);
  cellCargo.value = "CARGO";
  aplicarEstiloHeader(cellCargo, 3, true);

  const cellNombre = row.getCell(COL_NOMBRE);
  cellNombre.value = "NOMBRE";
  aplicarEstiloHeader(cellNombre, 3, true);

  // Mergea las 3 subcolumnas de cada día en una sola celda de encabezado.
  // Muestra el día real (incluso si es de otro mes — ej. "LUN 31" para
  // Ago 31 en la primera semana de septiembre).
  for (let i = 0; i < 7; i++) {
    const weekday = ORDEN_WEEKDAYS[i];
    const startCol = COL_PRIMER_DIA + i * 3;
    const dia = semana.find((d) => d.weekday === weekday);
    const nombreDia = NOMBRES_DIAS[weekday];
    const label = dia ? `${nombreDia} ${dia.diaMes}` : nombreDia;

    const rangeMerge = `${numToColLetter(startCol)}${filaHeader}:${numToColLetter(startCol + 2)}${filaHeader}`;
    try {
      sheet.mergeCells(rangeMerge);
    } catch {
      // ignora si ya está mergeado
    }
    const cell = sheet.getCell(`${numToColLetter(startCol)}${filaHeader}`);
    cell.value = label;
    aplicarEstiloHeader(cell, weekday, dia?.enMesObjetivo ?? true);
  }

  const cellTotal = row.getCell(COL_TOTAL);
  cellTotal.value = "TRABAJA";
  aplicarEstiloHeader(cellTotal, 3, true);

  const cellExtras = row.getCell(COL_HORAS_EXTRAS);
  cellExtras.value = "H. EXTRAS";
  aplicarEstiloHeader(cellExtras, 3, true);
}

function aplicarEstiloHeader(cell: ExcelJS.Cell, weekday: number, enMes = true) {
  cell.font = {
    bold: true,
    size: 8,
    name: "Aptos Narrow",
    color: { argb: colorTextoDia(weekday) },
    italic: !enMes,
  };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = borderAll();
  if (!enMes) {
    // Días del mes adyacente: fondo gris muy claro para distinguirlos
    cell.fill = fill("FFE7E6E6");
  }
}

/**
 * Escribe todas las filas de personas del bloque. Devuelve el número de la
 * última fila usada (útil para calcular el rango de la fila COUNT).
 */
function escribirPersonas(
  sheet: ExcelJS.Worksheet,
  filaInicio: number,
  personas: Persona[],
  semana: DiaSemana[],
  resultado: ResultadoGenerador,
  contextoMap: Map<string, { horas: number; tipo: "trabajo" | "descanso" | "libre" }>,
): number {
  personas.forEach((persona, idx) => {
    const filaNum = filaInicio + idx;
    const row = sheet.getRow(filaNum);
    row.height = 20;
    // Fill suave por rol jerárquico (visual coding para jefatura).
    const rolFill = FILL_POR_ROL[persona.rol_jerarquico];

    // Col CARGO (siempre escrita; luego se mergea por grupos)
    const cellCargo = row.getCell(COL_CARGO);
    cellCargo.value = cargoLabel(persona);
    cellCargo.font = { bold: true, size: 9, name: "Aptos Narrow" };
    cellCargo.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cellCargo.border = borderAll();
    cellCargo.fill = fill(rolFill);

    // Col NOMBRE (en mayúsculas, bold como el template)
    const cellNombre = row.getCell(COL_NOMBRE);
    cellNombre.value = persona.nombre.toUpperCase();
    cellNombre.font = { bold: true, size: 9, name: "Aptos Narrow" };
    cellNombre.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cellNombre.border = borderAll();
    cellNombre.fill = fill(rolFill);

    // Días
    for (let i = 0; i < 7; i++) {
      const weekday = ORDEN_WEEKDAYS[i];
      const startCol = COL_PRIMER_DIA + i * 3;
      const colorTexto = colorTextoDia(weekday);
      const dia = semana.find((d) => d.weekday === weekday);

      // Fuente de datos: si es del mes objetivo, del `resultado` generado
      // ahora; si es de mes adyacente (boundary), del contexto ya guardado
      // en la base. Así Ago 31 aparece en la primera semana de Sept con
      // los turnos que ya se le asignaron cuando se generó agosto.
      let celda: { horas: number; tipo: "trabajo" | "descanso" | "libre" } | undefined;
      if (dia) {
        if (dia.enMesObjetivo) {
          celda = resultado.grid[persona.id]?.dias[dia.diaMes];
        } else {
          celda = contextoMap.get(`${persona.id}|${dia.clave}`);
        }
      }

      const cellEnt = row.getCell(startCol);
      const cellSal = row.getCell(startCol + 1);
      const cellAlm = row.getCell(startCol + 2);
      const celdas = [cellEnt, cellSal, cellAlm];

      const esOtroMes = !!dia && !dia.enMesObjetivo;
      celdas.forEach((c) => {
        c.font = {
          bold: true,
          size: 9,
          name: "Aptos Narrow",
          color: { argb: colorTexto },
          italic: esOtroMes,
        };
        c.alignment = { vertical: "middle", horizontal: "center" };
        c.border = borderAll();
      });

      if (!celda || !dia) {
        // Sin celda ni contexto: pintar gris muy claro si es de otro mes
        // (marca visual de "día no perteneciente al mes")
        if (esOtroMes) celdas.forEach((c) => (c.fill = fill("FFF2F2F2")));
        continue;
      }

      if (celda.tipo === "trabajo" && celda.horas > 0) {
        const turno = calcularTurno(weekday, celda.horas);
        if (turno) {
          cellEnt.value = turno.entrada;
          cellSal.value = turno.salida;
          cellAlm.value = turno.almuerzo;
          if (celda.horas === 9 && !esOtroMes) {
            celdas.forEach((c) => (c.fill = fill(COLOR.aperturaFill)));
          }
          // Días boundary de otro mes: fondo tenue para diferenciarlos
          if (esOtroMes) celdas.forEach((c) => (c.fill = fill("FFF2F2F2")));
        }
      } else if (celda.tipo === "libre") {
        celdas.forEach((c) => (c.fill = fill(COLOR.libreFill)));
      } else {
        celdas.forEach((c) => (c.fill = fill(COLOR.descansoFill)));
      }
    }

    // TRABAJA — misma fórmula que la plantilla FEBRERO/JULIO:
    // =SUM(E-D-F+H-G-I+K-J-L+N-M-O+Q-P-R+T-S-U+W-V-X)
    const partes: string[] = [];
    for (let i = 0; i < 7; i++) {
      const startCol = COL_PRIMER_DIA + i * 3;
      const eCol = numToColLetter(startCol);
      const sCol = numToColLetter(startCol + 1);
      const aCol = numToColLetter(startCol + 2);
      partes.push(`${sCol}${filaNum}-${eCol}${filaNum}-${aCol}${filaNum}`);
    }
    const cellTotal = row.getCell(COL_TOTAL);
    cellTotal.value = { formula: `SUM(${partes.join("+")})`, result: 0 };
    cellTotal.font = { bold: true, size: 9, name: "Aptos Narrow" };
    cellTotal.alignment = { vertical: "middle", horizontal: "center" };
    cellTotal.border = borderAll();
    cellTotal.fill = fill(rolFill);

    // Col HORAS EXTRAS — vacía, para que jefatura la llene manual.
    const cellExtras = row.getCell(COL_HORAS_EXTRAS);
    cellExtras.font = { bold: true, size: 9, name: "Aptos Narrow" };
    cellExtras.alignment = { vertical: "middle", horizontal: "center" };
    cellExtras.border = borderAll();
    cellExtras.fill = fill(rolFill);
  });

  return filaInicio + personas.length - 1;
}

/**
 * Mergea la col CARGO verticalmente para agrupar personas del mismo cargo.
 * Igual que la plantilla oficial (ver B10:B12 = CAJEROS, B13:B20 = FULL-TIME).
 */
function mergearGruposCargo(
  sheet: ExcelJS.Worksheet,
  filaInicio: number,
  personas: Persona[],
) {
  let grupoInicio = 0;
  let grupoLabel = personas[0] ? cargoLabel(personas[0]) : "";
  const cierraGrupo = (finExclusive: number) => {
    const largo = finExclusive - grupoInicio;
    if (largo >= 2) {
      const filaTop = filaInicio + grupoInicio;
      const filaBot = filaInicio + finExclusive - 1;
      const range = `${numToColLetter(COL_CARGO)}${filaTop}:${numToColLetter(COL_CARGO)}${filaBot}`;
      try {
        sheet.mergeCells(range);
        // Reafirma estilo del merge master
        const cell = sheet.getCell(`${numToColLetter(COL_CARGO)}${filaTop}`);
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      } catch {
        // Ignora si el rango ya está en un merge por alguna razón
      }
    }
  };

  for (let i = 1; i < personas.length; i++) {
    const label = cargoLabel(personas[i]);
    if (label !== grupoLabel) {
      cierraGrupo(i);
      grupoInicio = i;
      grupoLabel = label;
    }
  }
  cierraGrupo(personas.length);
}

/**
 * Fila COUNT: cuenta personas programadas por día (una celda merge por día).
 */
function escribirFilaCount(
  sheet: ExcelJS.Worksheet,
  fila: number,
  personaRowStart: number,
  personaRowEnd: number,
) {
  const row = sheet.getRow(fila);
  row.height = 16;

  const cellCargo = row.getCell(COL_CARGO);
  cellCargo.fill = fill(COLOR.countFill);
  cellCargo.border = borderAll();
  const cellNombre = row.getCell(COL_NOMBRE);
  cellNombre.value = "PERSONAS";
  cellNombre.font = { bold: true, italic: true, size: 9, name: "Aptos Narrow" };
  cellNombre.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
  cellNombre.fill = fill(COLOR.countFill);
  cellNombre.border = borderAll();

  for (let i = 0; i < 7; i++) {
    const weekday = ORDEN_WEEKDAYS[i];
    const startCol = COL_PRIMER_DIA + i * 3;
    const rangeMerge = `${numToColLetter(startCol)}${fila}:${numToColLetter(startCol + 2)}${fila}`;
    try {
      sheet.mergeCells(rangeMerge);
    } catch {
      // ignora
    }
    const cell = sheet.getCell(`${numToColLetter(startCol)}${fila}`);
    const eCol = numToColLetter(startCol);
    cell.value = {
      formula: `COUNT(${eCol}${personaRowStart}:${eCol}${personaRowEnd})`,
      result: 0,
    };
    cell.font = {
      bold: true,
      size: 10,
      name: "Aptos Narrow",
      color: { argb: colorTextoDia(weekday) },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = fill(COLOR.countFill);
    cell.border = borderAll();
  }

  const cellTotal = row.getCell(COL_TOTAL);
  const colTotalLetter = numToColLetter(COL_TOTAL);
  cellTotal.value = {
    formula: `SUM(${colTotalLetter}${personaRowStart}:${colTotalLetter}${personaRowEnd})`,
    result: 0,
  };
  cellTotal.font = { bold: true, size: 10, name: "Aptos Narrow" };
  cellTotal.alignment = { vertical: "middle", horizontal: "center" };
  cellTotal.fill = fill(COLOR.countFill);
  cellTotal.border = borderAll();

  // Total horas extras del bloque
  const cellExtras = row.getCell(COL_HORAS_EXTRAS);
  const colExtrasLetter = numToColLetter(COL_HORAS_EXTRAS);
  cellExtras.value = {
    formula: `SUM(${colExtrasLetter}${personaRowStart}:${colExtrasLetter}${personaRowEnd})`,
    result: 0,
  };
  cellExtras.font = { bold: true, size: 10, name: "Aptos Narrow" };
  cellExtras.alignment = { vertical: "middle", horizontal: "center" };
  cellExtras.fill = fill(COLOR.countFill);
  cellExtras.border = borderAll();
}

/**
 * Banda de "ACTIVIDADES / EVENTOS DEL DÍA": 1 fila etiqueta + 2 filas de
 * anotación (EMBARQUE, REUNION DISTRITO, RECEPCION TRASPASO, etc.). Cada
 * día tiene sus 3 subcolumnas mergeadas en una celda ancha para escribir
 * cómodo. La banda va ANTES del header de cada semana (excepto la 1ª).
 */
function escribirFilasActividades(sheet: ExcelJS.Worksheet, filaInicio: number) {
  // Fila 1: etiqueta "ACTIVIDADES / EVENTOS"
  const filaLabel = filaInicio;
  const rowLabel = sheet.getRow(filaLabel);
  rowLabel.height = 15;

  const labelRange = `${numToColLetter(COL_CARGO)}${filaLabel}:${numToColLetter(COL_NOMBRE)}${filaLabel}`;
  try { sheet.mergeCells(labelRange); } catch { /* ignora */ }
  const cellLabel = sheet.getCell(`${numToColLetter(COL_CARGO)}${filaLabel}`);
  cellLabel.value = "ACTIVIDADES / EVENTOS";
  cellLabel.font = { bold: true, italic: true, size: 8, name: "Aptos Narrow" };
  cellLabel.alignment = { vertical: "middle", horizontal: "center" };
  cellLabel.fill = fill(COLOR.actividadFill);
  cellLabel.border = borderAll();

  for (let i = 0; i < 7; i++) {
    const startCol = COL_PRIMER_DIA + i * 3;
    const rangeMerge = `${numToColLetter(startCol)}${filaLabel}:${numToColLetter(startCol + 2)}${filaLabel}`;
    try { sheet.mergeCells(rangeMerge); } catch { /* ignora */ }
    const cell = sheet.getCell(`${numToColLetter(startCol)}${filaLabel}`);
    cell.fill = fill(COLOR.actividadFill);
    cell.border = borderAll();
  }
  [COL_TOTAL, COL_HORAS_EXTRAS].forEach((col) => {
    const c = rowLabel.getCell(col);
    c.fill = fill(COLOR.actividadFill);
    c.border = borderAll();
  });

  // Filas 2-3: espacio libre para anotar eventos
  for (let f = 1; f <= 2; f++) {
    const filaEvento = filaInicio + f;
    const row = sheet.getRow(filaEvento);
    row.height = 15;
    [COL_CARGO, COL_NOMBRE].forEach((col) => {
      const c = row.getCell(col);
      c.border = borderAll();
    });
    for (let i = 0; i < 7; i++) {
      const startCol = COL_PRIMER_DIA + i * 3;
      const rangeMerge = `${numToColLetter(startCol)}${filaEvento}:${numToColLetter(startCol + 2)}${filaEvento}`;
      try { sheet.mergeCells(rangeMerge); } catch { /* ignora */ }
      const cell = sheet.getCell(`${numToColLetter(startCol)}${filaEvento}`);
      cell.font = { bold: true, size: 8, name: "Aptos Narrow" };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = borderAll();
    }
    [COL_TOTAL, COL_HORAS_EXTRAS].forEach((col) => {
      const c = row.getCell(col);
      c.border = borderAll();
    });
  }
}

/**
 * Bloque de firmas al final de la hoja: 3 espacios (Elaborado / Revisado /
 * Aprobado) con línea de firma y etiqueta debajo, más fecha de generación.
 */
function escribirBloqueFirmas(sheet: ExcelJS.Worksheet, filaInicio: number) {
  sheet.getRow(filaInicio).height = 30; // aire

  const filaLinea = filaInicio + 1;
  const filaLabel = filaInicio + 2;
  sheet.getRow(filaLinea).height = 24;
  sheet.getRow(filaLabel).height = 16;

  const rangosFirma: Array<[number, number, string]> = [
    [COL_CARGO, 8, "ELABORADO POR (Jefe de tienda)"],
    [11, 17, "REVISADO POR (Subjefe)"],
    [20, COL_HORAS_EXTRAS, "APROBADO POR (DSM)"],
  ];

  for (const [colStart, colEnd, label] of rangosFirma) {
    // Línea de firma (borde bottom)
    const rangeLinea = `${numToColLetter(colStart)}${filaLinea}:${numToColLetter(colEnd)}${filaLinea}`;
    try { sheet.mergeCells(rangeLinea); } catch { /* ignora */ }
    const cellLinea = sheet.getCell(`${numToColLetter(colStart)}${filaLinea}`);
    cellLinea.border = {
      bottom: { style: "medium" as const, color: { argb: "FF000000" } },
    };

    // Etiqueta debajo
    const rangeLabel = `${numToColLetter(colStart)}${filaLabel}:${numToColLetter(colEnd)}${filaLabel}`;
    try { sheet.mergeCells(rangeLabel); } catch { /* ignora */ }
    const cellLabel = sheet.getCell(`${numToColLetter(colStart)}${filaLabel}`);
    cellLabel.value = label;
    cellLabel.font = { bold: true, size: 9, name: "Aptos Narrow" };
    cellLabel.alignment = { vertical: "top", horizontal: "center" };
  }

  // Fecha de generación
  const filaFecha = filaInicio + 4;
  sheet.getRow(filaFecha).height = 18;
  const rangeFecha = `${numToColLetter(COL_CARGO)}${filaFecha}:${numToColLetter(COL_HORAS_EXTRAS)}${filaFecha}`;
  try { sheet.mergeCells(rangeFecha); } catch { /* ignora */ }
  const cellFecha = sheet.getCell(`${numToColLetter(COL_CARGO)}${filaFecha}`);
  const fechaTxt = new Date().toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  cellFecha.value = `Documento generado por Bitácora Digital — ${fechaTxt}`;
  cellFecha.font = { italic: true, size: 8, name: "Aptos Narrow", color: { argb: "FF7F7F7F" } };
  cellFecha.alignment = { vertical: "middle", horizontal: "center" };
}

// ---------- Exportador principal ----------

export async function exportarHorarioExcel(opts: {
  anio: number;
  mes: number;
  roster: Persona[];
  resultado: ResultadoGenerador;
  /**
   * Horarios ya guardados de meses adyacentes (mes previo y mes siguiente).
   * Se usan para renderizar los días boundary — ej. si sept arranca en martes 1,
   * el lunes 31 de agosto se muestra en la primera semana con los turnos que
   * ya se le asignaron cuando se generó agosto.
   */
  horariosContexto?: Horario[];
}): Promise<void> {
  const { anio, mes, roster, resultado, horariosContexto = [] } = opts;
  const nombreMes = NOMBRES_MES[mes - 1].toUpperCase();

  // Índice rápido para lookup por persona + fecha
  const contextoMap = new Map<string, { horas: number; tipo: "trabajo" | "descanso" | "libre" }>();
  for (const h of horariosContexto) {
    const clave = `${h.persona_id}|${h.anio}-${String(h.mes).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`;
    contextoMap.set(clave, { horas: h.horas, tipo: h.tipo });
  }

  const rosterOrdenado = roster
    .filter((p) => p.activo)
    .sort((a, b) => {
      const oa = ORDEN_ROL[a.rol_jerarquico] ?? 99;
      const ob = ORDEN_ROL[b.rol_jerarquico] ?? 99;
      if (oa !== ob) return oa - ob;
      return a.nombre.localeCompare(b.nombre);
    });

  if (rosterOrdenado.length === 0) {
    throw new Error("No hay personal activo para exportar.");
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Bitácora Digital — Outlet Américas";
  wb.created = new Date();

  const sheetName = `HORARIOS ${nombreMes} ${anio}`.slice(0, 31);
  const sheet = wb.addWorksheet(sheetName, {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    // Sin freeze panes: cuando se hace scroll, no se dejan filas fijas
    // arriba (jefatura reportó confusión con las fechas de la semana 1
    // quedándose visibles al bajar a la semana 2+).
    views: [],
  });

  configurarAnchosColumnas(sheet, rosterOrdenado);

  // Título del mes: mergeado B3:C4 con font Arial Black 15 (igual a plantilla).
  const tituloRange = `${numToColLetter(COL_CARGO)}3:${numToColLetter(COL_NOMBRE)}4`;
  sheet.mergeCells(tituloRange);
  const cellTitulo = sheet.getCell(`${numToColLetter(COL_CARGO)}3`);
  cellTitulo.value = `${nombreMes} ${anio}`;
  cellTitulo.font = { bold: true, size: 15, name: "Arial Black" };
  cellTitulo.alignment = { vertical: "middle", horizontal: "center" };
  cellTitulo.border = borderAll();
  sheet.getRow(3).height = 20;
  sheet.getRow(4).height = 20;

  // Bloques por semana. Estructura por bloque (igual a plantilla FEBRERO):
  //   [2 filas actividades — solo para semanas 2+, semana 1 va después del título]
  //   fila header (CARGO/NOMBRE/día X)
  //   filas de personas
  //   fila COUNT
  const semanasCompletas = computarSemanasCompletas(anio, mes);
  let filaActual = 5; // primer header en fila 5 (igual que FEBRERO)

  for (let wIdx = 0; wIdx < semanasCompletas.length; wIdx++) {
    const semana = semanasCompletas[wIdx];

    // Para semanas 2+, dejamos 2 filas de actividades ANTES del header
    // (donde jefatura anota EMBARQUE, REUNION DISTRITO, etc.).
    if (wIdx > 0) {
      escribirFilasActividades(sheet, filaActual);
      filaActual += 2;
    }

    const filaHeader = filaActual;
    const filaPersonaStart = filaHeader + 1;

    escribirHeaderSemana(sheet, filaHeader, semana);
    const filaPersonaEnd = escribirPersonas(
      sheet,
      filaPersonaStart,
      rosterOrdenado,
      semana,
      resultado,
      contextoMap,
    );
    mergearGruposCargo(sheet, filaPersonaStart, rosterOrdenado);
    const filaCount = filaPersonaEnd + 1;
    escribirFilaCount(sheet, filaCount, filaPersonaStart, filaPersonaEnd);

    // Espaciado antes del siguiente bloque: count + 1 fila aire
    filaActual = filaCount + 2;
  }

  // Bloque de firmas al final de la hoja
  escribirBloqueFirmas(sheet, filaActual + 1);

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
