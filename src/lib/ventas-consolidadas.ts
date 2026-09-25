"use client";

// Cliente para el reporte "Visión general de ventas" (ventas consolidadas del mes retail hasta
// una fecha de corte). Es un escaneo largo (10+ páginas, girado): se parte en trozos de 2 páginas
// con pdf-lib y se leen en paralelo con la Edge Function `leer-ventas-consolidadas`; luego se unen
// los resultados y se valida la suma contra el total del propio reporte.

import { PDFDocument } from "pdf-lib";
import { supabase } from "./supabase";

export type EmpleadoConsolidado = {
  cm: string;
  nombre: string;
  brutaImp: number;
  netaRec: number; // artículos netos
  netaImp: number; // venta neta ($)
  pares: number | null; // Footwear
  ropa: number | null; // Apparel
  acc: number | null; // Accessories
};

export type VentasConsolidadas = {
  rango: [string, string] | null; // [desde, hasta] en ISO
  tienda: string | null;
  totalNetaImp: number | null;
  empleados: EmpleadoConsolidado[];
  sumaNetaImp: number;
  avisos: string[];
};

type Trozo = {
  rango: [string, string] | null;
  tienda: string | null;
  total: { netaImp?: number } | null;
  resumen: { cm: string; nombre: string; brutaRec: number; brutaImp: number; netaRec: number; netaImp: number }[];
  detalle: { cm: string; tipo: string; netaRec: number; netaImp: number }[];
  truncado?: boolean;
};

const PAGINAS_POR_TROZO = 2;
const MAX_PAGINAS = 16;

function aBase64(bytes: Uint8Array): string {
  let binary = "";
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) binary += String.fromCharCode(...bytes.subarray(i, i + bloque));
  return btoa(binary);
}

async function partirPdf(file: File): Promise<string[]> {
  const original = await PDFDocument.load(await file.arrayBuffer());
  const n = original.getPageCount();
  if (n > MAX_PAGINAS) throw new Error(`El PDF tiene ${n} páginas; el máximo es ${MAX_PAGINAS}.`);
  const trozos: string[] = [];
  for (let i = 0; i < n; i += PAGINAS_POR_TROZO) {
    const doc = await PDFDocument.create();
    const idx = Array.from({ length: Math.min(PAGINAS_POR_TROZO, n - i) }, (_, k) => i + k);
    const paginas = await doc.copyPages(original, idx);
    paginas.forEach((p) => doc.addPage(p));
    trozos.push(aBase64(await doc.save()));
  }
  return trozos;
}

async function leerTrozo(base64: string): Promise<Trozo> {
  const { data, error } = await supabase.functions.invoke("leer-ventas-consolidadas", {
    body: { archivos: [{ base64, mime: "application/pdf" }] },
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
  const d = data as (Trozo & { error?: string }) | null;
  if (!d || d.error) throw new Error(d?.error ?? "Respuesta vacía.");
  return d;
}

export async function leerVentasConsolidadas(file: File): Promise<VentasConsolidadas> {
  const partes = await partirPdf(file);
  // En paralelo, pero sin saturar: hasta 4 a la vez.
  const resultados: PromiseSettledResult<Trozo>[] = [];
  for (let i = 0; i < partes.length; i += 4) {
    resultados.push(...(await Promise.allSettled(partes.slice(i, i + 4).map(leerTrozo))));
  }
  const fallidos = resultados.filter((r) => r.status === "rejected");
  const buenos = resultados
    .filter((r): r is PromiseFulfilledResult<Trozo> => r.status === "fulfilled")
    .map((r) => r.value);
  if (buenos.length === 0) {
    const causa = (fallidos[0] as PromiseRejectedResult | undefined)?.reason;
    throw new Error(causa instanceof Error ? causa.message : "No se pudo leer el reporte.");
  }

  const avisos: string[] = [];
  if (fallidos.length > 0) {
    avisos.push(
      `${fallidos.length} de ${partes.length} tramos del PDF no se pudieron leer; faltan datos. Vuelve a subir el archivo.`,
    );
  }
  if (buenos.some((b) => b.truncado)) avisos.push("La IA cortó una respuesta larga; revisa que estén todos los empleados.");

  const resumen = new Map<string, Trozo["resumen"][number]>();
  const detalle = new Map<string, Trozo["detalle"][number]>();
  let rango: [string, string] | null = null;
  let tienda: string | null = null;
  let totalNetaImp: number | null = null;
  for (const b of buenos) {
    if (!rango && b.rango && b.rango.length === 2 && b.rango[0] && b.rango[1]) rango = [b.rango[0], b.rango[1]];
    if (!tienda && b.tienda) tienda = b.tienda;
    if (totalNetaImp == null && b.total?.netaImp) totalNetaImp = Number(b.total.netaImp);
    for (const r of b.resumen) if (!resumen.has(r.cm)) resumen.set(r.cm, r);
    for (const d of b.detalle) {
      const t = /^foot/i.test(d.tipo) ? "F" : /^app/i.test(d.tipo) ? "A" : "C";
      const k = `${d.cm}|${t}`;
      if (!detalle.has(k)) detalle.set(k, d);
    }
  }

  const empleados: EmpleadoConsolidado[] = [...resumen.values()].map((r) => {
    const get = (t: string) => detalle.get(`${r.cm}|${t}`);
    const tieneDetalle = ["F", "A", "C"].some((t) => detalle.has(`${r.cm}|${t}`));
    return {
      cm: r.cm,
      nombre: r.nombre,
      brutaImp: r.brutaImp,
      netaRec: r.netaRec,
      netaImp: r.netaImp,
      // Si el detalle no trae un tipo, ese empleado no vendió de ese tipo.
      pares: tieneDetalle ? (get("F")?.netaRec ?? 0) : null,
      ropa: tieneDetalle ? (get("A")?.netaRec ?? 0) : null,
      acc: tieneDetalle ? (get("C")?.netaRec ?? 0) : null,
    };
  });
  if (empleados.length === 0) throw new Error("No encontré la tabla de ventas por empleado en el PDF.");

  const sumaNetaImp = empleados.reduce((a, e) => a + e.netaImp, 0);
  if (totalNetaImp && totalNetaImp > 0) {
    const dif = Math.abs(sumaNetaImp - totalNetaImp) / totalNetaImp;
    if (dif > 0.02) {
      avisos.push(
        `La suma de las ventas netas por empleado (${Math.round(sumaNetaImp).toLocaleString("es-CO")}) no cuadra con el total del reporte (${Math.round(totalNetaImp).toLocaleString("es-CO")}): diferencia de ${Math.round(dif * 100)}%. Puede faltar una fila o haberse leído mal una cifra; revisa antes de guardar.`,
      );
    }
  } else {
    avisos.push("No pude leer el total del reporte; no se pudo verificar que las ventas cuadren.");
  }

  return { rango, tienda, totalNetaImp, empleados, sumaNetaImp, avisos };
}
