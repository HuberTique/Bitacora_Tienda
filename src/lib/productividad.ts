"use client";

// Informe "Productividad de empleado" de Xstore: TRX y UPT de cada asesor
// (Huber, 7-oct-2026). Cada informe es el acumulado del mes retail hasta una
// fecha: la carga REEMPLAZA la TRX del mes de cada persona, y el UPT sale del
// mismo informe (columna Artículos de "Datos de media").

import { supabase } from "./supabase";
import { blobABase64, pedazosDeFoto, type ArchivoIA } from "./ventas-pdf";

export type FilaProductividad = {
  id: string;
  nombre: string;
  trx: number | null;
  upt: number | null;
  importe: number | null;
  ventas: number | null;
};

export type InformeProductividad = {
  titulo: string | null;
  tienda: string | null;
  rangoTexto: string | null;
  rango: [string, string] | null;
  totalVentas: number | null;
  filas: FilaProductividad[];
};

/**
 * IDs de cuentas de la tienda: venta en línea y cuenta de la tienda. Solo se tratan
 * como "no es una persona" si NADIE de la planta tiene ese código: a un asesor sin
 * CM propio se le puede asignar uno de estos (p. ej. el 989999 mientras le llega el
 * suyo) y entonces sus ventas son de él (Huber, 9-oct-2026).
 */
export const IDS_NO_PERSONA: Record<string, string> = {
  "989999": "Venta en línea (no es una persona)",
  "9999": "Cuenta de la tienda (no es una persona)",
};

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Código → persona: el CM de cada uno y sus códigos alternos aprobados. */
export function personasPorCodigo(
  planta: { id: string; codigo: string | null }[],
  alternos: { persona_id: string; codigo: string; estado?: string | null }[] = [],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of alternos) if (!a.estado || a.estado === "aprobado") if (digitos(a.codigo)) m.set(digitos(a.codigo), a.persona_id);
  for (const p of planta) if (digitos(p.codigo)) m.set(digitos(p.codigo), p.id);
  return m;
}

/** ¿Es una cuenta de la tienda que no está asignada a nadie? */
export function esCuentaSinPersona(id: string, porCodigo: Map<string, string>): boolean {
  return !!IDS_NO_PERSONA[digitos(id)] && !porCodigo.has(digitos(id));
}

/** Une las lecturas de varios pedazos: una fila por ID (la más completa). */
export function combinarInformes(lecturas: InformeProductividad[]): InformeProductividad {
  const porId = new Map<string, FilaProductividad>();
  const completa = (f: FilaProductividad) => [f.trx, f.upt, f.importe, f.ventas].filter((v) => v != null).length;
  for (const l of lecturas)
    for (const f of l.filas) {
      const k = f.id || f.nombre.toUpperCase();
      const previa = porId.get(k);
      if (!previa || completa(f) > completa(previa) || (completa(f) === completa(previa) && (f.ventas ?? 0) > (previa.ventas ?? 0)))
        porId.set(k, f);
    }
  return {
    titulo: lecturas.find((l) => l.titulo)?.titulo ?? null,
    tienda: lecturas.find((l) => l.tienda)?.tienda ?? null,
    rangoTexto: lecturas.find((l) => l.rangoTexto)?.rangoTexto ?? null,
    rango: lecturas.find((l) => l.rango)?.rango ?? null,
    totalVentas: lecturas.map((l) => l.totalVentas).filter((v): v is number => v != null).sort((a, b) => b - a)[0] ?? null,
    filas: [...porId.values()],
  };
}

async function llamar(archivos: ArchivoIA[]): Promise<InformeProductividad> {
  const { data, error } = await supabase.functions.invoke("leer-productividad", { body: { archivos } });
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const cuerpo = (await ctx.clone().json()) as { error?: string };
        if (cuerpo?.error) throw new Error(cuerpo.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw new Error(error.message || "No se pudo leer el informe.");
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as InformeProductividad;
}

/** Lee el informe (PDF o fotos; cada foto vertical en dos pedazos). */
export async function leerProductividad(files: File[], alAvanzar?: (hechas: number, total: number) => void): Promise<InformeProductividad> {
  const tareas: ArchivoIA[][] = [];
  for (const f of files.filter((x) => !x.type.startsWith("image/")))
    tareas.push([{ base64: await blobABase64(f), mime: f.type || "application/pdf" }]);
  for (const f of files.filter((x) => x.type.startsWith("image/"))) for (const p of await pedazosDeFoto(f)) tareas.push([p]);
  const lecturas: InformeProductividad[] = [];
  let hechas = 0;
  alAvanzar?.(0, tareas.length);
  for (let i = 0; i < tareas.length; i += 3) {
    const lote = await Promise.all(tareas.slice(i, i + 3).map(llamar));
    lecturas.push(...lote);
    hechas += lote.length;
    alAvanzar?.(hechas, tareas.length);
  }
  return combinarInformes(lecturas);
}
