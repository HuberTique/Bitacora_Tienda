"use client";

// Extrae el texto (con su posición) del PDF de GeoVictoria en el navegador,
// con pdf.js. El worker está copiado en public/pdf.worker.min.mjs desde
// node_modules/pdfjs-dist/build: si se actualiza pdfjs-dist, hay que volver a
// copiarlo (las versiones deben coincidir).

import { assetPath } from "./asset-path";
import { parsearGeoVictoria, type HorarioGeo, type ItemTexto } from "./geovictoria";

export async function leerHorarioGeoVictoria(archivo: ArrayBuffer): Promise<HorarioGeo> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = assetPath("/pdf.worker.min.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(archivo) }).promise;
  } catch {
    throw new Error("No pude abrir el PDF. Descárgalo de nuevo desde GeoVictoria.");
  }
  const items: ItemTexto[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const alto = page.getViewport({ scale: 1 }).height;
    const contenido = await page.getTextContent();
    for (const it of contenido.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      items.push({ pagina: n, x: it.transform[4], top: alto - it.transform[5], ancho: it.width, texto: it.str });
    }
  }
  if (items.length === 0) throw new Error("El PDF no tiene texto: parece una imagen escaneada. Descárgalo directo desde GeoVictoria.");
  return parsearGeoVictoria(items);
}
