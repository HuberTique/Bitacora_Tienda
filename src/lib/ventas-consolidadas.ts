"use client";

// Cliente para el informe "Visión general de ventas" (ventas consolidadas del mes retail hasta una
// fecha de corte). Es un escaneo de ~10 páginas que viene girado. Para leerlo con precisión:
//   1. Se ENDEREZAN las páginas con pdf-lib (giro de 270° si son verticales con el texto de lado).
//   2. Se hacen dos tipos de lectura con instrucciones distintas (Edge Function leer-ventas-consolidadas):
//        - "resumen": páginas 1-2 → encabezado (nombre del informe, tienda, rango) y el primer cuadro:
//                     CM, nombre y "Ventas netas" (recuento e importe) de cada empleado, más el Total.
//        - "detalle": páginas 2-10 en tramos de 2 → por empleado (CM), el recuento neto de cada tipo
//                     (Footwear = pares, Apparel = ropa, Accessories = accesorios).
//   3. Se unen por CM (los encabezados repetidos al cambiar de hoja son la misma persona).

import { PDFDocument, degrees } from "pdf-lib";
import { supabase } from "./supabase";

export type Giro = "auto" | 0 | 90 | 180 | 270;

export type EmpleadoConsolidado = {
  cm: string;
  nombre: string;
  netaRec: number; // artículos netos
  netaImp: number; // venta neta ($)
  pares: number | null; // Footwear
  ropa: number | null; // Apparel
  acc: number | null; // Accessories
};

export type VentasConsolidadas = {
  titulo: string | null;
  tienda: string | null;
  rango: [string, string] | null; // [desde, hasta] en ISO
  totalNetaImp: number | null; // fila "Total" del primer cuadro
  empleados: EmpleadoConsolidado[]; // asesores (sin el código 9999)
  ventaEmpleados: number | null; // código 9999: venta a empleados
  sumaNetaImp: number; // suma de todas las filas (incluye 9999)
  sinDetalle: string[]; // CM con venta pero sin detalle por tipo leído
  avisos: string[];
};

type RespResumen = {
  titulo: string | null;
  tienda: string | null;
  rango: [string, string] | null;
  total: { netaRec: number; netaImp: number } | null;
  filas: { cm: string; nombre: string; netaRec: number; netaImp: number }[];
  truncado?: boolean;
};
type RespDetalle = {
  filas: { cm: string; nombre: string; tipo: string; netaRec: number }[];
  truncado?: boolean;
};

const CM_EMPLEADOS = "9999"; // venta a empleados

function aBase64(bytes: Uint8Array): string {
  let binary = "";
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) binary += String.fromCharCode(...bytes.subarray(i, i + bloque));
  return btoa(binary);
}

/** Copia las páginas indicadas a un PDF nuevo, enderezadas. */
async function trozo(original: PDFDocument, indices: number[], giro: Giro): Promise<string> {
  const doc = await PDFDocument.create();
  const paginas = await doc.copyPages(original, indices);
  paginas.forEach((p) => {
    const { width, height } = p.getSize();
    const actual = p.getRotation().angle;
    // Auto: página vertical con el informe apaisado de lado → se gira 270° para dejarlo derecho.
    const extra = giro === "auto" ? (height > width ? 270 : 0) : giro;
    if (extra) p.setRotation(degrees((actual + extra) % 360));
    doc.addPage(p);
  });
  return aBase64(await doc.save());
}

async function invocar<T>(modo: "resumen" | "detalle", base64: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("leer-ventas-consolidadas", {
    body: { modo, archivos: [{ base64, mime: "application/pdf" }] },
  });
  if (error) {
    let msg = (error as { message?: string }).message ?? "No se pudo leer el reporte.";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx instanceof Response) {
        const b = await ctx.clone().json();
        if (b?.error) msg = b.error;
      }
    } catch {
      /* usa el mensaje genérico */
    }
    throw new Error(msg);
  }
  const d = data as (T & { error?: string }) | null;
  if (!d || d.error) throw new Error(d?.error ?? "Respuesta vacía.");
  return d;
}

export async function leerVentasConsolidadas(file: File, giro: Giro = "auto"): Promise<VentasConsolidadas> {
  const original = await PDFDocument.load(await file.arrayBuffer());
  const n = original.getPageCount();
  if (n > 16) throw new Error(`El PDF tiene ${n} páginas; el máximo es 16.`);

  // Resumen: páginas 1 y 2 (el primer cuadro empieza en la 1 y sigue en la 2).
  const idxResumen = [0, ...(n > 1 ? [1] : [])];
  // Detalle: desde la página 2 en tramos de 2 (la segunda parte empieza al final de la página 2).
  const tramosDetalle: number[][] = [];
  for (let i = 1; i < n; i += 2) tramosDetalle.push([i, ...(i + 1 < n ? [i + 1] : [])]);

  const [resResumen, ...resDetalle] = await Promise.allSettled([
    trozo(original, idxResumen, giro).then((b) => invocar<RespResumen>("resumen", b)),
    ...tramosDetalle.map((idx) => trozo(original, idx, giro).then((b) => invocar<RespDetalle>("detalle", b))),
  ]);

  if (resResumen.status === "rejected") {
    throw resResumen.reason instanceof Error ? resResumen.reason : new Error("No se pudo leer el primer cuadro.");
  }
  const r = resResumen.value;
  const avisos: string[] = [];
  const detalleFallido = resDetalle.filter((x) => x.status === "rejected").length;
  if (detalleFallido > 0) {
    avisos.push(
      `${detalleFallido} de ${tramosDetalle.length} tramos del detalle por tipo no se pudieron leer: faltan pares/ropa/accesorios de algunos asesores. Puedes completarlos a mano o volver a subir el archivo.`,
    );
  }
  if (r.truncado) avisos.push("La IA cortó la lectura del primer cuadro; revisa que estén todos los empleados.");

  // Primer cuadro: una fila por CM (si un CM se repite, se conserva la primera).
  const porCm = new Map<string, RespResumen["filas"][number]>();
  for (const f of r.filas ?? []) if (!porCm.has(f.cm)) porCm.set(f.cm, f);

  // Detalle por tipo: se une por CM; si el encabezado se repite en la hoja siguiente es la misma persona.
  const det = new Map<string, number>(); // "cm|F"
  for (const x of resDetalle) {
    if (x.status !== "fulfilled") continue;
    for (const f of x.value.filas ?? []) {
      const t = /^foot/i.test(f.tipo) ? "F" : /^app/i.test(f.tipo) ? "A" : "C";
      const k = `${f.cm}|${t}`;
      if (!det.has(k)) det.set(k, f.netaRec);
    }
  }
  const tieneDetalle = (cm: string) => ["F", "A", "C"].some((t) => det.has(`${cm}|${t}`));

  const todas = [...porCm.values()];
  const suma = todas.reduce((a, e) => a + e.netaImp, 0);
  const ventaEmp = porCm.get(CM_EMPLEADOS)?.netaImp ?? null;

  const empleados: EmpleadoConsolidado[] = todas
    .filter((e) => e.cm !== CM_EMPLEADOS)
    .map((e) => ({
      cm: e.cm,
      nombre: e.nombre,
      netaRec: e.netaRec,
      netaImp: e.netaImp,
      pares: tieneDetalle(e.cm) ? (det.get(`${e.cm}|F`) ?? 0) : null,
      ropa: tieneDetalle(e.cm) ? (det.get(`${e.cm}|A`) ?? 0) : null,
      acc: tieneDetalle(e.cm) ? (det.get(`${e.cm}|C`) ?? 0) : null,
    }));
  if (empleados.length === 0) throw new Error("No encontré la tabla de ventas por empleado en el PDF.");

  const sinDetalle = empleados.filter((e) => e.netaImp > 0 && e.pares == null).map((e) => e.cm);
  if (sinDetalle.length > 0) {
    avisos.push(
      `No se leyó el detalle por tipo (pares, ropa, accesorios) de ${sinDetalle.length} asesor(es) con ventas: ${sinDetalle.join(", ")}. Puedes escribirlo a mano en la vista previa.`,
    );
  }

  const total = r.total?.netaImp && r.total.netaImp > 0 ? r.total.netaImp : null;
  if (total) {
    const dif = Math.abs(suma - total) / total;
    if (dif > 0.01) {
      avisos.push(
        `La suma de las ventas netas (${Math.round(suma).toLocaleString("es-CO")}) no cuadra con el total del reporte (${Math.round(total).toLocaleString("es-CO")}): diferencia de ${(dif * 100).toFixed(1)}%. Revisa las cifras contra el informe (puedes corregirlas en la tabla).`,
      );
    }
  } else {
    avisos.push("No pude leer el total del primer cuadro; no se pudo verificar que las ventas cuadren.");
  }

  return {
    titulo: r.titulo,
    tienda: r.tienda,
    rango: r.rango && r.rango.length === 2 && r.rango[0] && r.rango[1] ? [r.rango[0], r.rango[1]] : null,
    totalNetaImp: total,
    empleados,
    ventaEmpleados: ventaEmp,
    sumaNetaImp: suma,
    sinDetalle,
    avisos,
  };
}
