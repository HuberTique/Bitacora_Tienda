"use client";

// Client helper para leer el PDF "Ventas rápidas por empleado" que genera
// el sistema oficial de la tienda al cierre de jornada.
//
// Flujo:
//   1. leerVentasPdf(file) → llama a la Edge Function `leer-ventas-pdf` con
//      el archivo en base64. La Edge Function usa Claude Haiku 4.5 para
//      extraer los datos y devuelve JSON estructurado.
//   2. matchearEmpleadosConRoster(...) → cruza los empleados detectados
//      con el roster de personal, marca códigos huérfanos (código no
//      encontrado) y personas del roster que NO aparecieron en el PDF.

import { supabase } from "./supabase";
import { matchPersonaPorNombre } from "./imagenIA";
import type {
  MotivoNoVenta,
  Persona,
  PersonalCodigoAlterno,
  VentaAsesorDia,
} from "./types";

// ---------- Tipos de la respuesta del Edge Function ----------

export type EmpleadoPdf = {
  codigo: string;
  nombre: string;
  articulos: number;
  venta: number;
};

export type VentasPdfResponse = {
  fecha: string | null;
  /** La fecha tal como viene impresa en el reporte. */
  fechaTexto?: string | null;
  tienda: string | null;
  totalArticulos: number | null;
  totalVenta: number | null;
  empleados: EmpleadoPdf[];
  truncado?: boolean;
  debug?: unknown;
};

// ---------- Estructura del preview ----------

/**
 * Estado de matching de un empleado del PDF contra el roster.
 *  - MATCHED: aparece en el PDF con venta y matcheó a una persona conocida.
 *    Si el código estaba compartido entre varios asesores (distribucion_pct
 *    < 1), se genera UNA fila por asesor con la venta prorrateada.
 *  - HUERFANO: aparece en el PDF pero código+nombre no matchean.
 *  - AUSENTE: no aparece en el PDF pero es persona activa del roster.
 */
export type FilaVenta = {
  tipo: "matched" | "huerfano" | "ausente";
  // Datos del PDF (undefined si tipo=ausente)
  empleadoPdf?: EmpleadoPdf;
  // Cuando el código estaba compartido (distribucion_pct < 1), la fila
  // muestra la porción asignada a esta persona en particular.
  ventaAsignada?: number;
  articulosAsignados?: number;
  distribucionPct?: number; // 0..1
  compartido?: boolean;      // true si el código PDF cubre varias personas
  // Persona del roster asignada
  personaId: string | null;
  personaNombre: string | null;
  // Solo aplica cuando NO hay venta o venta=0
  motivo: MotivoNoVenta | null;
  motivoDetalle: string;
  matchScore: number;
};

// ---------- Endpoint ----------

// Lectura del reporte (6-oct-2026, tras la prueba en Centro Mayor):
//   * Las fotos se procesan UNA A LA VEZ y se libera la memoria de cada una
//     (el celular de la tienda se quedaba sin memoria con varias fotos a la vez).
//   * Cada foto se parte en dos pedazos con un poco de solape y cada pedazo se
//     lee por separado: la IA ve las cifras más grandes (las imágenes que
//     recibe se reducen a ~1.500 px) y no pierde precisión al subir más fotos.
//     Las filas repetidas por el solape se cuentan una sola vez.
//   * El PDF va completo en una sola lectura.

/** Lado máximo de cada pedazo que se envía (la IA reduce las imágenes más grandes). */
const LADO_MAX_PEDAZO = 1568;
/** Cuántas lecturas a la vez (para no saturar el celular ni la función). */
const LECTURAS_SIMULTANEAS = 3;

export type ArchivoIA = { base64: string; mime: string };

/**
 * Revisa qué es de verdad un archivo por sus primeros bytes (no por el nombre):
 * en el celular llegan "PDF" que son fotos o páginas guardadas desde WhatsApp,
 * Drive o el correo. Devuelve el archivo con su tipo real, o un error claro.
 */
export async function prepararArchivo(f: File): Promise<File> {
  const b = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
  const ascii = (desde: number, n: number) => String.fromCharCode(...b.subarray(desde, desde + n));
  const conTipo = (mime: string) => (f.type === mime ? f : new File([f], f.name, { type: mime, lastModified: f.lastModified }));
  if (String.fromCharCode(...b).includes("%PDF-")) return conTipo("application/pdf");
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return conTipo("image/jpeg");
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return conTipo("image/png");
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return conTipo("image/webp");
  if (ascii(4, 4) === "ftyp" && /^(heic|heix|mif1|msf1)$/.test(ascii(8, 4)))
    throw new Error(`"${f.name}" es una foto HEIC del iPhone. Tómala de nuevo desde la app o envíala como JPG.`);
  throw new Error(
    `"${f.name}" no es un PDF ni una foto válida (está dañado o es otro tipo de archivo con nombre .pdf). Descárgalo de nuevo o tómale fotos a las hojas.`,
  );
}

export function blobABase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("No se pudo leer el archivo."));
    r.readAsDataURL(blob);
  });
}

async function decodificar(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `No se pudo abrir la foto "${file.name}". Si el celular dice que no tiene memoria, cierra otras apps o toma la foto con la cámara, guárdala y súbela desde la galería; o mejor, sube el PDF del reporte.`,
    );
  }
}

/**
 * Parte una foto en pedazos legibles: las fotos verticales de una página en
 * dos mitades (arriba y abajo) con 12 % de solape; las demás, completas.
 */
export async function pedazosDeFoto(file: File): Promise<ArchivoIA[]> {
  const bitmap = await decodificar(file);
  try {
    const { width: w, height: h } = bitmap;
    const vertical = h > w * 1.15;
    const cortes: [number, number][] = vertical ? [[0, 0.56], [0.44, 1]] : [[0, 1]];
    const out: ArchivoIA[] = [];
    for (const [desde, hasta] of cortes) {
      const sy = Math.round(h * desde);
      const sh = Math.round(h * (hasta - desde));
      const escala = Math.min(1, LADO_MAX_PEDAZO / Math.max(w, sh));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * escala));
      canvas.height = Math.max(1, Math.round(sh * escala));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo procesar la imagen.");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, sy, w, sh, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo convertir la imagen."))), "image/jpeg", 0.9),
      );
      // Soltar la memoria del lienzo antes del siguiente pedazo.
      canvas.width = 0;
      canvas.height = 0;
      out.push({ base64: await blobABase64(blob), mime: "image/jpeg" });
    }
    return out;
  } finally {
    bitmap.close();
  }
}

/**
 * La foto completa (sin partir), girada si se pide, con el lado mayor en 1568 px.
 * Para informes apaisados como "Visión general de ventas": partida en mitades,
 * una foto vertical con el informe de lado ya no se lee; completa, sí.
 */
export async function fotoCompleta(file: File, giro: 0 | 90 | 180 | 270 = 0): Promise<ArchivoIA> {
  const bitmap = await decodificar(file);
  try {
    const { width: w, height: h } = bitmap;
    const escala = Math.min(1, LADO_MAX_PEDAZO / Math.max(w, h));
    const [dw, dh] = [Math.max(1, Math.round(w * escala)), Math.max(1, Math.round(h * escala))];
    const lado = giro === 90 || giro === 270;
    const canvas = document.createElement("canvas");
    canvas.width = lado ? dh : dw;
    canvas.height = lado ? dw : dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la imagen.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((giro * Math.PI) / 180);
    ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo convertir la imagen."))), "image/jpeg", 0.9),
    );
    canvas.width = 0;
    canvas.height = 0;
    return { base64: await blobABase64(blob), mime: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}

/** Une varias lecturas (pedazos de foto o archivos) en una sola. */
export function combinarLecturas(lecturas: VentasPdfResponse[]): VentasPdfResponse {
  const conTotal = lecturas.filter((l) => l.totalVenta != null && l.totalVenta > 0);
  const mayor = conTotal.sort((a, b) => (b.totalVenta ?? 0) - (a.totalVenta ?? 0))[0];
  // Las filas repetidas por el solape se cuentan una vez; si dos lecturas de la
  // misma fila difieren, se queda la de mayor venta (la que perdió dígitos es menor).
  const porClave = new Map<string, EmpleadoPdf>();
  for (const l of lecturas) {
    for (const e of l.empleados) {
      const clave = e.codigo?.trim() ? `c:${e.codigo.trim()}` : `n:${e.nombre.trim().toUpperCase()}`;
      const previo = porClave.get(clave);
      if (!previo || e.venta > previo.venta) porClave.set(clave, e);
    }
  }
  const fechas = lecturas.map((l) => l.fecha).filter((f): f is string => !!f);
  const fechaMasVista = fechas.sort((a, b) => fechas.filter((x) => x === b).length - fechas.filter((x) => x === a).length)[0] ?? null;
  return {
    fecha: fechaMasVista,
    fechaTexto: lecturas.find((l) => l.fechaTexto)?.fechaTexto ?? null,
    tienda: lecturas.find((l) => l.tienda)?.tienda ?? null,
    totalVenta: mayor?.totalVenta ?? null,
    totalArticulos: mayor?.totalArticulos ?? lecturas.find((l) => l.totalArticulos != null)?.totalArticulos ?? null,
    empleados: [...porClave.values()],
    truncado: lecturas.some((l) => l.truncado),
  };
}

/**
 * La fecha del informe: el sistema de caja puede imprimirla día-mes o mes-día.
 * Si con el día y el mes al revés coincide con la fecha elegida, es esa; si no,
 * se propone la interpretación más cercana a la fecha elegida.
 */
export function resolverFechaInforme(leida: string | null, seleccionada: string): { fecha: string | null; coincide: boolean } {
  if (!leida || !/^\d{4}-\d{2}-\d{2}$/.test(leida)) return { fecha: null, coincide: true };
  const [y, m, d] = leida.split("-");
  const candidatas = [leida];
  if (Number(d) >= 1 && Number(d) <= 12 && d !== m) candidatas.push(`${y}-${d}-${m}`);
  if (candidatas.includes(seleccionada)) return { fecha: seleccionada, coincide: true };
  const dias = (f: string) => Math.abs(new Date(f + "T12:00:00Z").getTime() - new Date(seleccionada + "T12:00:00Z").getTime());
  return { fecha: candidatas.sort((a, b) => dias(a) - dias(b))[0], coincide: false };
}

/**
 * Rango de fechas de un informe (p. ej. ventas consolidadas) frente al mes
 * retail: si leído tal cual queda fuera del mes pero con día y mes al revés
 * cae dentro, se usa al revés (el sistema de caja puede imprimir mes-día).
 */
export function ajustarRangoInforme(
  rango: [string, string] | null,
  inicio?: string | null,
  fin?: string | null,
): { rango: [string, string] | null; invertido: boolean } {
  if (!rango || !inicio || !fin) return { rango, invertido: false };
  const dentro = (r: [string, string]) => r[1] >= inicio && r[1] <= fin;
  if (dentro(rango)) return { rango, invertido: false };
  const voltear = (f: string) => {
    const [y, m, d] = f.split("-");
    return Number(d) >= 1 && Number(d) <= 12 ? `${y}-${d}-${m}` : f;
  };
  const alt: [string, string] = [voltear(rango[0]), voltear(rango[1])];
  if (alt[0] <= alt[1] && dentro(alt)) return { rango: alt, invertido: true };
  return { rango, invertido: false };
}

async function llamarLector(archivos: ArchivoIA[]): Promise<VentasPdfResponse> {
  const timeoutPromise = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("La lectura tardó más de 60 segundos. Intenta de nuevo o sube el PDF del reporte.")), 60000),
  );
  const result = await Promise.race([supabase.functions.invoke("leer-ventas-pdf", { body: { archivos } }), timeoutPromise]);
  const { data, error } = result as { data: unknown; error: unknown };
  const errorObj = error as { message?: string; context?: Response | { response?: Response } } | null;
  if (errorObj) {
    let bodyErr: string | null = null;
    const resp = errorObj.context instanceof Response ? errorObj.context : errorObj.context?.response;
    try {
      if (resp) {
        const bodyText = await resp.clone().text();
        try {
          bodyErr = JSON.parse(bodyText)?.error ?? bodyText;
        } catch {
          bodyErr = bodyText;
        }
      }
    } catch {
      /* ignora */
    }
    throw new Error(bodyErr ?? (data as { error?: string } | null)?.error ?? errorObj.message ?? "No se pudo leer el reporte.");
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  return data as VentasPdfResponse;
}

/** Lee un PDF o una o varias fotos del reporte "Ventas rápidas por empleado". */
export async function leerVentasPdf(files: File | File[], alAvanzar?: (hechas: number, total: number) => void): Promise<VentasPdfResponse> {
  const lista = Array.isArray(files) ? files : [files];
  const pdfs = lista.filter((f) => !f.type.startsWith("image/"));
  const fotos = lista.filter((f) => f.type.startsWith("image/"));

  // Una tarea por PDF y por pedazo de foto. Las fotos se preparan de a una.
  const tareas: ArchivoIA[][] = [];
  for (const f of pdfs) tareas.push([{ base64: await blobABase64(f), mime: f.type || "application/pdf" }]);
  for (const f of fotos) for (const p of await pedazosDeFoto(f)) tareas.push([p]);

  const lecturas: VentasPdfResponse[] = new Array(tareas.length);
  let siguiente = 0;
  let hechas = 0;
  alAvanzar?.(0, tareas.length);
  async function trabajador() {
    while (siguiente < tareas.length) {
      const i = siguiente++;
      lecturas[i] = await llamarLector(tareas[i]);
      alAvanzar?.(++hechas, tareas.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LECTURAS_SIMULTANEAS, tareas.length) }, trabajador));
  return combinarLecturas(lecturas);
}

// ---------- Matching ----------

/**
 * Cruza los empleados del PDF con el roster y con los códigos alternos ya
 * registrados. Devuelve las 3 categorías de filas.
 *
 * Reglas de matching (en orden):
 *  1. Match por código EXACTO en personal.codigo
 *  2. Match por código EXACTO en personal_codigos_alternos.codigo
 *  3. Match por NOMBRE aproximado (>=2 tokens comunes)
 *  4. Si ninguna → huérfano
 */
export function matchearEmpleadosConRoster(opts: {
  empleadosPdf: EmpleadoPdf[];
  personal: Persona[];
  codigosAlternos: PersonalCodigoAlterno[];
  horarios?: { persona_id: string; dia: number; tipo: string; anio?: number; mes?: number }[];
  diaDelMes?: number;
  /** Fecha del cierre (YYYY-MM-DD). Con ella se ubica el horario exacto aunque el mes retail cruce dos meses. */
  fecha?: string;
}): FilaVenta[] {
  const { empleadosPdf, personal, codigosAlternos, horarios = [], diaDelMes, fecha } = opts;
  const activos = personal.filter((p) => p.activo);
  const usadosIds = new Set<string>();
  const filas: FilaVenta[] = [];

  // Códigos alternos aprobados agrupados por código: un código puede
  // corresponder a VARIAS personas con distribución en porcentajes.
  const alternosPorCodigo = new Map<string, PersonalCodigoAlterno[]>();
  for (const ca of codigosAlternos) {
    if (ca.estado !== "aprobado") continue;
    if (!alternosPorCodigo.has(ca.codigo)) alternosPorCodigo.set(ca.codigo, []);
    alternosPorCodigo.get(ca.codigo)!.push(ca);
  }

  // Índice del código PROPIO de cada persona → persona
  const codigoPropio = new Map<string, string>();
  for (const p of activos) {
    if (p.codigo) codigoPropio.set(p.codigo.trim(), p.id);
  }

  const nombrePersona = (id: string) =>
    personal.find((p) => p.id === id)?.nombre ?? null;

  for (const emp of empleadosPdf) {
    const codigo = emp.codigo?.trim() ?? "";

    // 1. Match por CÓDIGO PROPIO (personal.codigo) — venta entera para la persona.
    const propioId = codigo ? codigoPropio.get(codigo) : undefined;
    if (propioId) {
      usadosIds.add(propioId);
      filas.push({
        tipo: "matched",
        empleadoPdf: emp,
        ventaAsignada: emp.venta,
        articulosAsignados: emp.articulos,
        distribucionPct: 1,
        compartido: false,
        personaId: propioId,
        personaNombre: nombrePersona(propioId),
        motivo: emp.venta > 0 ? null : "solo_operacion",
        motivoDetalle: "",
        matchScore: 100,
      });
      continue;
    }

    // 2. Match por CÓDIGO ALTERNO (compartido o único) — distribuye la venta.
    const asignaciones = codigo ? alternosPorCodigo.get(codigo) : undefined;
    if (asignaciones && asignaciones.length > 0) {
      const compartido = asignaciones.length > 1;
      for (const ca of asignaciones) {
        usadosIds.add(ca.persona_id);
        filas.push({
          tipo: "matched",
          empleadoPdf: emp,
          ventaAsignada: emp.venta * ca.distribucion_pct,
          articulosAsignados: Math.round(emp.articulos * ca.distribucion_pct),
          distribucionPct: ca.distribucion_pct,
          compartido,
          personaId: ca.persona_id,
          personaNombre: nombrePersona(ca.persona_id),
          motivo: emp.venta > 0 ? null : "solo_operacion",
          motivoDetalle: compartido ? "Código compartido — venta prorrateada" : "",
          matchScore: 90,
        });
      }
      continue;
    }

    // 3. Match por NOMBRE aproximado.
    if (emp.nombre) {
      const p = matchPersonaPorNombre(reordenarApellidoNombre(emp.nombre), activos);
      if (p && !usadosIds.has(p.id)) {
        usadosIds.add(p.id);
        filas.push({
          tipo: "matched",
          empleadoPdf: emp,
          ventaAsignada: emp.venta,
          articulosAsignados: emp.articulos,
          distribucionPct: 1,
          compartido: false,
          personaId: p.id,
          personaNombre: p.nombre,
          motivo: emp.venta > 0 ? null : "solo_operacion",
          motivoDetalle: "",
          matchScore: 60,
        });
        continue;
      }
    }

    // 4. Huérfano — nada matcheó.
    filas.push({
      tipo: "huerfano",
      empleadoPdf: emp,
      ventaAsignada: emp.venta,
      articulosAsignados: emp.articulos,
      distribucionPct: 1,
      compartido: false,
      personaId: null,
      personaNombre: null,
      motivo: emp.venta > 0 ? null : "solo_operacion",
      motivoDetalle: "",
      matchScore: 0,
    });
  }

  // 5. Ausentes: personas activas no cubiertas.
  for (const p of activos) {
    if (usadosIds.has(p.id)) continue;
    let motivoDefault: MotivoNoVenta | null = null;
    if (diaDelMes != null || fecha) {
      const h = horarios.find((x) => {
        if (x.persona_id !== p.id) return false;
        if (fecha && x.anio != null && x.mes != null) {
          return `${x.anio}-${String(x.mes).padStart(2, "0")}-${String(x.dia).padStart(2, "0")}` === fecha;
        }
        return x.dia === diaDelMes;
      });
      if (h?.tipo === "descanso") motivoDefault = "descanso";
      else if (h?.tipo === "libre") motivoDefault = "libre_solicitado";
    }
    filas.push({
      tipo: "ausente",
      personaId: p.id,
      personaNombre: p.nombre,
      motivo: motivoDefault,
      motivoDetalle: "",
      matchScore: 0,
    });
  }

  return filas;
}

/**
 * El PDF viene con nombres en formato "APELLIDO APELLIDO, NOMBRE NOMBRE".
 * Nuestro roster lo tiene como "NOMBRE APELLIDO". Volteamos antes de
 * matchear por nombre.
 */
function reordenarApellidoNombre(nombre: string): string {
  const parts = nombre.split(",");
  if (parts.length !== 2) return nombre;
  return (parts[1].trim() + " " + parts[0].trim()).trim();
}

// ---------- Guardado en Supabase ----------

/**
 * Persiste todas las filas del preview en `ventas_asesor_dia`. Usa upsert
 * por (persona_id, fecha) para permitir re-subir el mismo día.
 */
export async function guardarVentasDia(opts: {
  fecha: string;
  filas: FilaVenta[];
  registradoPorId: string;
}): Promise<{ insertados: number; huerfanos: number; fusionadas: number }> {
  const { fecha, filas, registradoPorId } = opts;
  const rows: Omit<
    VentaAsesorDia,
    "id" | "created_at" | "updated_at"
  >[] = [];
  let huerfanos = 0;

  for (const f of filas) {
    if (f.tipo === "huerfano" && !f.personaId) {
      huerfanos++;
      continue;
    }
    if (!f.personaId) continue;
    rows.push({
      persona_id: f.personaId,
      fecha,
      // Usa la venta prorrateada si el código estaba compartido, si no la
      // venta completa del PDF.
      venta: f.ventaAsignada ?? f.empleadoPdf?.venta ?? 0,
      articulos: f.articulosAsignados ?? f.empleadoPdf?.articulos ?? 0,
      motivo_no_venta: f.motivo,
      motivo_detalle: f.motivoDetalle?.trim() || null,
      fuente: "pdf",
      registrado_por: registradoPorId,
    });
  }
  if (rows.length === 0) return { insertados: 0, huerfanos, fusionadas: 0 };

  // Postgres no permite dos filas con la misma (persona_id, fecha) en un mismo
  // upsert ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  // Pasa cuando una persona aparece en varias filas del preview: vendió con su
  // código y con uno alterno, se asignó a mano un huérfano a alguien que ya
  // tenía fila, o el mismo empleado salió en dos fotos. En ese caso se suman
  // sus ventas y artículos en una sola fila.
  const porPersona = new Map<string, (typeof rows)[number]>();
  let fusionadas = 0;
  for (const r of rows) {
    const previa = porPersona.get(r.persona_id);
    if (!previa) {
      porPersona.set(r.persona_id, { ...r });
      continue;
    }
    fusionadas++;
    previa.venta = (previa.venta ?? 0) + (r.venta ?? 0);
    previa.articulos = (previa.articulos ?? 0) + (r.articulos ?? 0);
    // Si alguna de las filas trae venta, ya no aplica el motivo de "no vendió".
    if ((previa.venta ?? 0) > 0) {
      previa.motivo_no_venta = null;
      previa.motivo_detalle = null;
    } else {
      previa.motivo_no_venta = previa.motivo_no_venta ?? r.motivo_no_venta;
      previa.motivo_detalle = previa.motivo_detalle ?? r.motivo_detalle;
    }
  }
  const unicas = [...porPersona.values()];

  const { error } = await supabase
    .from("ventas_asesor_dia")
    .upsert(unicas, { onConflict: "persona_id,fecha" });
  if (error) throw new Error(error.message);
  return { insertados: unicas.length, huerfanos, fusionadas };
}
