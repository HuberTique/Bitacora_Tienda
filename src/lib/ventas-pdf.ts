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
export async function leerVentasPdf(file: File): Promise<VentasPdfResponse> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // btoa no soporta caracteres > 0xff; convertimos byte a byte.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  // Timeout defensivo: si la Edge Function se cuelga (Sonnet 5 en PDFs
  // grandes puede tardar 20-40s), abortamos a los 60s para no dejar la
  // UI colgada. Supabase también tiene su propio timeout (25s en free).
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);

  const invokePromise = supabase.functions.invoke("leer-ventas-pdf", {
    body: { pdf: { base64, mime: file.type || "application/pdf" } },
  });
  const timeoutPromise = new Promise<{ data: null; error: Error }>((_, rej) => {
    setTimeout(
      () =>
        rej(
          new Error(
            "La lectura del PDF tardó más de 60 segundos. Puede ser un PDF muy pesado o problema con el modelo de IA. Revisa los logs de la Edge Function en Supabase.",
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
  return data as VentasPdfResponse;
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
  horarios?: { persona_id: string; dia: number; tipo: string }[];
  diaDelMes?: number;
}): FilaVenta[] {
  const { empleadosPdf, personal, codigosAlternos, horarios = [], diaDelMes } = opts;
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
    if (diaDelMes != null) {
      const h = horarios.find((x) => x.persona_id === p.id && x.dia === diaDelMes);
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
}): Promise<{ insertados: number; huerfanos: number }> {
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
  if (rows.length === 0) return { insertados: 0, huerfanos };
  const { error } = await supabase
    .from("ventas_asesor_dia")
    .upsert(rows, { onConflict: "persona_id,fecha" });
  if (error) throw new Error(error.message);
  return { insertados: rows.length, huerfanos };
}
