"use client";

// Cliente para el informe "Visión general de ventas" (ventas consolidadas del mes retail hasta una
// fecha de corte). De este informe la app toma SOLO las UNIDADES por categoría de cada asesor
// (Footwear = pares, Accessories = accesorios, Apparel = ropa); la venta en pesos sale de los
// cierres del día (Huber, 8-oct-2026).
//
// Se puede subir el PDF o FOTOS de las hojas:
//   - PDF: es un escaneo de ~10 páginas que viene girado. Se ENDEREZAN las páginas con pdf-lib y se
//     hacen dos lecturas (Edge Function leer-ventas-consolidadas):
//        "resumen": páginas 1-2 → encabezado (título, tienda, rango) y el cuadro Resumen: CM, nombre y
//                   recuento neto de cada empleado (sirve para verificar las unidades).
//        "detalle": páginas 2-10 en tramos de 2 → por empleado (CM), el recuento neto de cada tipo.
//   - Fotos: cada foto COMPLETA (girada si se elige la orientación) se lee en modo "foto", que trae lo que se vea
//     del encabezado, del Resumen y de los bloques por empleado.
// Todo se une por CM (los encabezados repetidos al cambiar de hoja son la misma persona).

import { PDFDocument, degrees } from "pdf-lib";
import { supabase } from "./supabase";
import { fotoCompleta, type ArchivoIA } from "./ventas-pdf";

export type Giro = "auto" | 0 | 90 | 180 | 270;

export type EmpleadoConsolidado = {
  cm: string;
  nombre: string;
  /** Recuento neto del cuadro Resumen (todas las unidades); null si no se leyó. */
  unidades: number | null;
  /** 9999 / 989999: cuenta de la tienda; solo es de alguien si un asesor tiene ese código. */
  cuentaTienda: boolean;
  pares: number | null; // Footwear
  ropa: number | null; // Apparel
  acc: number | null; // Accessories
};

export type VentasConsolidadas = {
  titulo: string | null;
  tienda: string | null;
  rango: [string, string] | null; // [desde, hasta] en ISO
  /** Recuento neto de la fila "Total" del Resumen (solo con el PDF). */
  totalUnidades: number | null;
  empleados: EmpleadoConsolidado[]; // todas las filas (las cuentas de la tienda van marcadas)
  sinDetalle: string[]; // CM con unidades pero sin detalle por tipo leído
  avisos: string[];
};

type FilaResumen = { cm: string; nombre: string; netaRec: number };
type FilaDetalle = { cm: string; nombre: string; tipo: string; netaRec: number };
/** Lo que trae cada llamada a la IA, sea del PDF o de una foto. */
export type LecturaConsolidada = {
  titulo?: string | null;
  tienda?: string | null;
  rango?: string[] | null;
  total?: { netaRec: number } | null;
  resumen?: FilaResumen[];
  detalle?: FilaDetalle[];
  truncado?: boolean;
};

/** Cuentas que no son personas: venta a empleados / de la tienda y venta en línea. */
const CM_NO_PERSONA = new Set(["9999", "989999"]);

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

async function invocar(modo: "resumen" | "detalle" | "foto", archivo: ArchivoIA): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("leer-ventas-consolidadas", {
    body: { modo, archivos: [archivo] },
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
  const d = data as (Record<string, unknown> & { error?: string }) | null;
  if (!d || d.error) throw new Error(d?.error ?? "Respuesta vacía.");
  return d;
}

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Une las lecturas (del PDF y/o de las fotos) en el resultado por asesor. */
export function unirLecturas(lecturas: LecturaConsolidada[], fallidas = 0, total = lecturas.length): VentasConsolidadas {
  const avisos: string[] = [];
  if (fallidas > 0)
    avisos.push(
      `${fallidas} de ${total} partes del informe no se pudieron leer: puede faltar el detalle de algunos asesores. Complétalo a mano o vuelve a subir esas hojas.`,
    );
  if (lecturas.some((l) => l.truncado)) avisos.push("La IA cortó la lectura de una parte; revisa que estén todos los asesores.");

  const primero = <K extends keyof LecturaConsolidada>(k: K) => lecturas.find((l) => l[k] != null)?.[k] ?? null;

  // Resumen: una fila por CM (en los pedazos que se solapan, la lectura mayor: la que perdió dígitos es menor).
  const res = new Map<string, FilaResumen>();
  for (const l of lecturas)
    for (const f of lista<FilaResumen>(l.resumen)) {
      if (!f?.cm) continue;
      const p = res.get(f.cm);
      if (!p || f.netaRec > p.netaRec) res.set(f.cm, f);
    }
  // Detalle por tipo: si el encabezado se repite en la hoja siguiente es la misma persona (vale el primero
  // que traiga un número distinto de 0).
  const det = new Map<string, number>(); // "cm|F"
  const nombreDet = new Map<string, string>();
  for (const l of lecturas)
    for (const f of lista<FilaDetalle>(l.detalle)) {
      if (!f?.cm) continue;
      const t = /^foot/i.test(f.tipo) ? "F" : /^app/i.test(f.tipo) ? "A" : "C";
      const k = `${f.cm}|${t}`;
      if (!det.has(k) || (det.get(k) === 0 && f.netaRec !== 0)) det.set(k, f.netaRec);
      if (!nombreDet.has(f.cm)) nombreDet.set(f.cm, f.nombre);
    }
  const tieneDetalle = (cm: string) => ["F", "A", "C"].some((t) => det.has(`${cm}|${t}`));

  const cms = [...new Set([...res.keys(), ...nombreDet.keys()])];
  const empleados: EmpleadoConsolidado[] = cms.map((cm) => ({
    cm,
    nombre: res.get(cm)?.nombre || nombreDet.get(cm) || "",
    unidades: res.get(cm)?.netaRec ?? null,
    cuentaTienda: CM_NO_PERSONA.has(cm),
    pares: tieneDetalle(cm) ? (det.get(`${cm}|F`) ?? 0) : null,
    ropa: tieneDetalle(cm) ? (det.get(`${cm}|A`) ?? 0) : null,
    acc: tieneDetalle(cm) ? (det.get(`${cm}|C`) ?? 0) : null,
  }));
  if (empleados.length === 0) throw new Error("No encontré las unidades por empleado en el informe.");

  const sinDetalle = empleados.filter((e) => !e.cuentaTienda && (e.unidades ?? 0) !== 0 && e.pares == null).map((e) => e.cm);
  if (sinDetalle.length > 0)
    avisos.push(
      `No se leyeron los pares, accesorios y ropa de ${sinDetalle.length} asesor(es) con ventas: ${sinDetalle.join(", ")}. Escríbelos a mano en la tabla o sube la hoja donde aparecen.`,
    );
  const descuadre = empleados.filter(
    (e) => e.unidades != null && e.pares != null && Math.abs((e.pares ?? 0) + (e.ropa ?? 0) + (e.acc ?? 0) - e.unidades) >= 1,
  );
  if (descuadre.length > 0)
    avisos.push(
      `En ${descuadre.length} asesor(es) pares + accesorios + ropa no da las unidades del Resumen (${descuadre.map((e) => e.cm).join(", ")}): revisa esas cifras contra el informe.`,
    );

  const totalUnidades = (primero("total") as { netaRec: number } | null)?.netaRec ?? null;
  if (totalUnidades != null && totalUnidades > 0 && res.size > 0) {
    const suma = [...res.values()].reduce((a, f) => a + f.netaRec, 0);
    if (Math.abs(suma - totalUnidades) >= 1)
      avisos.push(
        `Las unidades del Resumen suman ${suma} y el total del informe dice ${totalUnidades}: puede faltar algún asesor o una cifra mal leída.`,
      );
  }

  const rango = primero("rango") as string[] | null;
  return {
    titulo: (primero("titulo") as string | null) ?? null,
    tienda: (primero("tienda") as string | null) ?? null,
    rango: rango && rango.length === 2 && rango[0] && rango[1] ? [rango[0], rango[1]] : null,
    totalUnidades,
    empleados,
    sinDetalle,
    avisos,
  };
}

/** Lee el informe desde un PDF y/o fotos de sus hojas. */
export async function leerVentasConsolidadas(
  archivos: File | File[],
  giro: Giro = "auto",
  alAvanzar?: (hechas: number, total: number) => void,
): Promise<VentasConsolidadas> {
  const files = Array.isArray(archivos) ? archivos : [archivos];
  const tareas: { obligatoria: boolean; correr: () => Promise<LecturaConsolidada> }[] = [];

  for (const f of files.filter((x) => !x.type.startsWith("image/"))) {
    let original: PDFDocument;
    try {
      original = await PDFDocument.load(await f.arrayBuffer());
    } catch {
      throw new Error(`"${f.name}" no se pudo abrir como PDF (está dañado o no es un PDF). Descárgalo de nuevo o tómale fotos a las hojas.`);
    }
    const n = original.getPageCount();
    if (n > 16) throw new Error(`El PDF tiene ${n} páginas; el máximo es 16.`);
    // Resumen: páginas 1 y 2 (el primer cuadro empieza en la 1 y sigue en la 2).
    const idxResumen = [0, ...(n > 1 ? [1] : [])];
    tareas.push({
      obligatoria: true,
      correr: async () => {
        const r = await invocar("resumen", { base64: await trozo(original, idxResumen, giro), mime: "application/pdf" });
        return {
          titulo: r.titulo as string | null,
          tienda: r.tienda as string | null,
          rango: r.rango as string[] | null,
          total: r.total as { netaRec: number } | null,
          resumen: lista<FilaResumen>(r.filas),
          truncado: !!r.truncado,
        };
      },
    });
    // Detalle: desde la página 2 en tramos de 2 (la segunda parte empieza al final de la página 2).
    for (let i = 1; i < n; i += 2) {
      const idx = [i, ...(i + 1 < n ? [i + 1] : [])];
      tareas.push({
        obligatoria: false,
        correr: async () => {
          const r = await invocar("detalle", { base64: await trozo(original, idx, giro), mime: "application/pdf" });
          return { detalle: lista<FilaDetalle>(r.filas), truncado: !!r.truncado };
        },
      });
    }
  }
  // Cada foto va COMPLETA (partida en mitades, una foto vertical con el informe de lado no se lee).
  for (const f of files.filter((x) => x.type.startsWith("image/")))
    tareas.push({
      obligatoria: false,
      correr: async () => {
        const r = await invocar("foto", await fotoCompleta(f, giro === "auto" ? 0 : giro));
        return {
          titulo: r.titulo as string | null,
          tienda: r.tienda as string | null,
          rango: r.rango as string[] | null,
          resumen: lista<FilaResumen>(r.resumen),
          detalle: lista<FilaDetalle>(r.filas),
          truncado: !!r.truncado,
        };
      },
    });
  if (tareas.length === 0) throw new Error("Elige el PDF o las fotos del informe.");

  // De a 3 lecturas a la vez.
  const resultados: PromiseSettledResult<LecturaConsolidada>[] = new Array(tareas.length);
  let siguiente = 0;
  let hechas = 0;
  alAvanzar?.(0, tareas.length);
  async function trabajador() {
    while (siguiente < tareas.length) {
      const i = siguiente++;
      try {
        resultados[i] = { status: "fulfilled", value: await tareas[i].correr() };
      } catch (e) {
        resultados[i] = { status: "rejected", reason: e };
      }
      alAvanzar?.(++hechas, tareas.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, tareas.length) }, trabajador));

  const fallo = resultados.find((r, i) => tareas[i].obligatoria && r.status === "rejected") as PromiseRejectedResult | undefined;
  if (fallo) throw fallo.reason instanceof Error ? fallo.reason : new Error("No se pudo leer el primer cuadro.");
  const buenas = resultados.filter((r): r is PromiseFulfilledResult<LecturaConsolidada> => r.status === "fulfilled").map((r) => r.value);
  if (buenas.length === 0) {
    const r = resultados[0] as PromiseRejectedResult;
    throw r.reason instanceof Error ? r.reason : new Error("No se pudo leer el informe.");
  }
  return unirLecturas(buenas, resultados.length - buenas.length, resultados.length);
}
