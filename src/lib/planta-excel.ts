// Carga de planta desde Excel: el jefe de tienda sube un archivo con su equipo,
// revisa lo que se leyó y lo aprueba. Aquí está la parte que no toca la base:
// leer las filas, validarlas y generar las claves temporales.

import ExcelJS from "exceljs";
import type { RolJerarquico } from "./types";

export const COLUMNAS_PLANTA = ["Nombre", "ID empleado (CM)", "Cédula", "Cargo", "Rol", "Correo (solo subjefes)"] as const;

export type FilaPlanta = {
  fila: number; // número de fila en el Excel, para ubicarla
  nombre: string;
  codigo: string;
  cedula: string;
  cargo: string;
  rolTexto: string;
  rol_jerarquico: RolJerarquico | null;
  correo: string;
  problemas: string[];
};

const norm = (v: unknown): string =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Rol escrito en el Excel → rol jerárquico de la app. */
export function rolDesdeTexto(texto: string): RolJerarquico | null {
  const t = norm(texto).replace(/[-_]/g, " ");
  if (!t) return null;
  if (/jefe de tienda|^jefe$|store manager/.test(t)) return "jefe_tienda";
  if (/sub ?jefe/.test(t)) return "subjefe";
  if (/cajer/.test(t)) return "cajero";
  if (/part ?time|medio tiempo|^pt$/.test(t)) return "part_time";
  if (/full ?time|tiempo completo|asesor|vendedor|^ft$/.test(t)) return "full_time";
  return null;
}

/** Texto de una celda (fórmulas, enlaces y textos enriquecidos incluidos). */
function textoCelda(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
  }
  return String(v);
}

/**
 * Valida las filas leídas. `existentes` son los CM y cédulas que ya están en
 * la planta; `puedeSubjefes` dice si quien carga puede registrar subjefes
 * (solo el jefe de tienda o el administrador).
 */
export function validarPlanta(
  crudas: Omit<FilaPlanta, "problemas" | "rol_jerarquico">[],
  existentes: { codigos: Set<string>; cedulas: Set<string> },
  puedeSubjefes: boolean,
): FilaPlanta[] {
  const vistosCm = new Map<string, number>();
  const vistasCed = new Map<string, number>();
  crudas.forEach((f) => {
    if (f.codigo) vistosCm.set(f.codigo, (vistosCm.get(f.codigo) ?? 0) + 1);
    if (f.cedula) vistasCed.set(f.cedula, (vistasCed.get(f.cedula) ?? 0) + 1);
  });
  return crudas.map((f) => {
    const problemas: string[] = [];
    const rol = rolDesdeTexto(f.rolTexto);
    if (!f.nombre) problemas.push("Falta el nombre.");
    if (!f.codigo) problemas.push("Falta el ID de empleado (CM): es su usuario para entrar.");
    else if (!/^[0-9]{3,12}$/.test(f.codigo)) problemas.push("El CM debe tener solo números (mínimo 3).");
    else if (existentes.codigos.has(f.codigo)) problemas.push("Ese CM ya está registrado.");
    else if ((vistosCm.get(f.codigo) ?? 0) > 1) problemas.push("Ese CM está repetido en el archivo.");
    if (f.cedula && existentes.cedulas.has(f.cedula)) problemas.push("Esa cédula ya está registrada.");
    else if (f.cedula && (vistasCed.get(f.cedula) ?? 0) > 1) problemas.push("Esa cédula está repetida en el archivo.");
    if (!rol) problemas.push(`No reconozco el rol "${f.rolTexto || "(vacío)"}". Usa: Subjefe, Cajero, Full time o Part time.`);
    else if (rol === "jefe_tienda") problemas.push("Al jefe de tienda lo registra el administrador.");
    else if (rol === "subjefe") {
      if (!puedeSubjefes) problemas.push("A un subjefe lo registra el jefe de tienda.");
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.correo)) problemas.push("Un subjefe necesita su correo de ingreso.");
    }
    return { ...f, correo: rol === "subjefe" ? f.correo.toLowerCase() : "", rol_jerarquico: rol, problemas };
  });
}

/** Lee la primera hoja del Excel: busca la fila de encabezados y toma las columnas por nombre. */
export async function leerPlanta(archivo: ArrayBuffer): Promise<Omit<FilaPlanta, "problemas" | "rol_jerarquico">[] | { error: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(archivo);
  } catch {
    return { error: "No pude abrir el archivo. Debe ser un Excel (.xlsx)." };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { error: "El archivo no tiene hojas." };

  // Fila de encabezados: la primera (de las 10 primeras) que tenga "nombre".
  let filaEnc = 0;
  const col: Record<"nombre" | "codigo" | "cedula" | "cargo" | "rol" | "correo", number> = {
    nombre: 0, codigo: 0, cedula: 0, cargo: 0, rol: 0, correo: 0,
  };
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !filaEnc; r++) {
    const fila = ws.getRow(r);
    fila.eachCell((celda, c) => {
      const t = norm(textoCelda(celda.value));
      if (t === "nombre" || t.startsWith("nombre")) col.nombre ||= c;
      else if (t.includes("cm") || t.includes("id empleado") || t.includes("codigo")) col.codigo ||= c;
      else if (t.includes("cedula") || t.includes("documento")) col.cedula ||= c;
      else if (t.includes("cargo")) col.cargo ||= c;
      else if (t === "rol" || t.startsWith("rol")) col.rol ||= c;
      else if (t.includes("correo") || t.includes("email")) col.correo ||= c;
    });
    if (col.nombre) filaEnc = r;
  }
  if (!filaEnc) return { error: 'No encontré la fila de encabezados (debe tener una columna "Nombre"). Usa la plantilla.' };
  if (!col.codigo || !col.rol) return { error: 'Faltan columnas: el archivo debe tener "ID empleado (CM)" y "Rol". Usa la plantilla.' };

  const filas: Omit<FilaPlanta, "problemas" | "rol_jerarquico">[] = [];
  for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
    const fila = ws.getRow(r);
    const leer = (c: number) => (c ? textoCelda(fila.getCell(c).value).trim() : "");
    const nombre = leer(col.nombre).replace(/\s+/g, " ");
    const codigo = leer(col.codigo).replace(/\D/g, "");
    if (!nombre && !codigo) continue; // fila vacía
    filas.push({
      fila: r,
      nombre,
      codigo,
      cedula: leer(col.cedula).replace(/[^0-9A-Za-z]/g, ""),
      cargo: leer(col.cargo),
      rolTexto: leer(col.rol),
      correo: leer(col.correo).toLowerCase(),
    });
  }
  if (filas.length === 0) return { error: "El archivo no tiene personas debajo de los encabezados." };
  return filas;
}

/** Plantilla vacía para que el jefe la llene. */
export async function plantillaPlanta(): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Digital Logbook";
  const ws = wb.addWorksheet("Planta");
  ws.addRow([...COLUMNAS_PLANTA]);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c, i) => (c.width = [32, 18, 16, 22, 14, 30][i]));
  ws.addRow(["Ana Pérez Gómez", "981702", "1012345678", "Asesora de ventas", "Full time", ""]);
  ws.addRow(["Luis Rojas", "981703", "1023456789", "Subjefe", "Subjefe", "luis.rojas@empresa.com"]);
  const notas = wb.addWorksheet("Instrucciones");
  [
    "Una persona por fila. Borra las dos filas de ejemplo antes de subir el archivo.",
    "ID empleado (CM): obligatorio, solo números. Es el usuario con el que la persona entra.",
    "Rol: Subjefe, Cajero, Full time o Part time. El jefe de tienda lo registra el administrador.",
    "Correo: solo para subjefes; es su usuario de ingreso.",
    "Las claves se generan solas y son temporales: cada persona la cambia en su primer ingreso.",
  ].forEach((t) => notas.addRow([t]));
  notas.getColumn(1).width = 110;
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Clave temporal: PIN de 6 dígitos para asesores; 10 caracteres con letras y números para subjefes. */
export function claveTemporal(rol: RolJerarquico, aleatorio: (n: number) => number = aleatorioSeguro): string {
  if (rol === "subjefe" || rol === "jefe_tienda") {
    const letras = "abcdefghjkmnpqrstuvwxyz"; // sin i, l, o para no confundir
    const digitos = "23456789";
    const todos = letras + letras.toUpperCase() + digitos;
    let c = letras[aleatorio(letras.length)] + digitos[aleatorio(digitos.length)];
    while (c.length < 10) c += todos[aleatorio(todos.length)];
    return c;
  }
  let pin = String(1 + aleatorio(9)); // sin cero inicial
  while (pin.length < 6) pin += String(aleatorio(10));
  return pin;
}

function aleatorioSeguro(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

/** Excel con los usuarios y claves temporales creados, para entregarlos. */
export async function excelClaves(
  creados: { nombre: string; usuario: string; clave: string; rol: string }[],
  tienda: string,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Digital Logbook";
  const ws = wb.addWorksheet("Accesos");
  ws.addRow([`Accesos temporales — ${tienda}`]);
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.addRow(["Cada persona debe cambiar su clave en el primer ingreso. Entrega cada acceso en privado."]);
  ws.addRow([]);
  ws.addRow(["Nombre", "Rol", "Usuario (CM o correo)", "Clave temporal"]);
  ws.getRow(4).font = { bold: true };
  creados.forEach((c) => ws.addRow([c.nombre, c.rol, c.usuario, c.clave]));
  ws.columns.forEach((c, i) => (c.width = [34, 14, 30, 16][i]));
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
