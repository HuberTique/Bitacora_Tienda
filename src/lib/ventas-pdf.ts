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

/**
 * Sube el PDF a la Edge Function. Convierte a base64 primero.
 */
const LADO_MAX_FOTO = 2000; // px: suficiente para leer cifras y mantiene la foto liviana

function aBase64(bytes: Uint8Array): string {
  // btoa no soporta caracteres > 0xff; convertimos por bloques.
  let binary = "";
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) {
    binary += String.fromCharCode(...bytes.subarray(i, i + bloque));
  }
  return btoa(binary);
}

/**
 * Prepara un archivo para enviarlo a la IA. Las fotos del celular pesan varios
 * MB, así que se reducen a JPEG (máx. ${LADO_MAX_FOTO}px); los PDF van tal cual.
 */
async function prepararArchivo(file: File): Promise<{ base64: string; mime: string }> {
  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAX_FOTO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la imagen.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo convertir la imagen."))), "image/jpeg", 0.88),
    );
    return { base64: aBase64(new Uint8Array(await blob.arrayBuffer())), mime: "image/jpeg" };
  }
  return { base64: aBase64(new Uint8Array(await file.arrayBuffer())), mime: file.type || "application/pdf" };
}

/** Lee un PDF o una o varias fotos del reporte "Ventas rápidas por empleado". */
export async function leerVentasPdf(files: File | File[]): Promise<VentasPdfResponse> {
  const lista = Array.isArray(files) ? files : [files];
  const archivos = await Promise.all(lista.map(prepararArchivo));

  // Timeout defensivo: si la Edge Function se cuelga (Sonnet 5 en PDFs
  // grandes puede tardar 20-40s), abortamos a los 60s para no dejar la
  // UI colgada. Supabase también tiene su propio timeout (25s en free).
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);

  const invokePromise = supabase.functions.invoke("leer-ventas-pdf", {
    body: { archivos },
  });
  const timeoutPromise = new Promise<{ data: null; error: Error }>((_, rej) => {
    setTimeout(
      () =>
        rej(
          new Error(
            "La lectura del PDF tardó más de 60 segundos. Puede ser un archivo muy pesado o problema con el modelo de IA. Revisa los logs de la Edge Function en Supabase.",
          ),
        ),
      60000,
    );
  });

  let data: unknown, error: unknown;
  try {
    const result = await Promise.race([invokePromise, timeoutPromise]);
    data = (result as { data: unknown }).data;
    error = (result as { error: unknown }).error;
  } finally {
    clearTimeout(timeoutId);
    abortController.abort();
  }
  const errorObj = error as { message?: string; context?: { response?: Response } } | null;
  if (errorObj) {
    let bodyErr: string | null = null;
    try {
      if (errorObj.context?.response) {
        const bodyText = await errorObj.context.response.text();
        try {
          const parsed = JSON.parse(bodyText);
          bodyErr = parsed?.error ?? bodyText;
        } catch {
          bodyErr = bodyText;
        }
      }
    } catch {
      // ignora
    }
    const errMsg =
      bodyErr ??
      (data as { error?: string } | null)?.error ??
      errorObj.message ??
      "No se pudo leer el PDF.";
    throw new Error(errMsg);
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error);
  }
  const res = data as VentasPdfResponse;
  // Con varias fotos que se solapan, un mismo empleado puede salir dos veces con
  // exactamente los mismos números: se cuenta una sola vez.
  const vistos = new Set<string>();
  res.empleados = res.empleados.filter((e) => {
    const k = `${e.codigo}|${e.nombre}|${e.articulos}|${e.venta}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return res;
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
