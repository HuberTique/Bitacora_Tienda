"use client";

/**
 * Redimensiona una imagen a JPEG con maxDim de lado mayor.
 * Fotos de celular pueden pesar varios MB en base64 y hacer fallar la
 * llamada al backend. Este resize las lleva a un tamaño razonable sin
 * perder legibilidad para OCR/vision.
 */
export function resizeImage(
  file: File,
  maxDim = 1600,
  quality = 0.85,
): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D no disponible."));
          return;
        }
        // Fondo blanco por si la imagen tiene transparencia (evita JPEG con bordes negros)
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mime: "image/jpeg" });
      };
      img.onerror = () =>
        reject(
          new Error(
            "No se pudo decodificar esta imagen (¿formato no compatible como HEIC, o archivo dañado?).",
          ),
        );
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

/** Normaliza: quita acentos, minúsculas, sólo letras y espacios. */
export function normText(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

/**
 * Match aproximado por tokens: cuenta cuántos tokens (>2 chars) del nombre
 * detectado están en el nombre de una persona del roster; devuelve el mejor
 * puntaje (o null si no hay coincidencia).
 */
export function matchPersonaPorNombre<T extends { id: string; nombre: string }>(
  nombreDetectado: string,
  roster: T[],
): T | null {
  const tokensDet = normText(nombreDetectado)
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokensDet.length === 0) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const p of roster) {
    const tokensP = normText(p.nombre)
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const score = tokensP.filter((t) => tokensDet.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Elige el tipo de falta apropiado según los minutos de atraso. */
export function tipoIdPorMinutos<T extends { tipo_id: string; requiere_minutos: boolean }>(
  min: number,
  tipos: T[],
): string | null {
  let candidato: T | undefined;
  if (min < 10) candidato = tipos.find((t) => t.tipo_id === "llegada_menor10");
  else if (min < 45) candidato = tipos.find((t) => t.tipo_id === "llegada_10_45");
  else candidato = tipos.find((t) => t.tipo_id === "llegada_mayor45");
  if (!candidato) candidato = tipos.find((t) => t.requiere_minutos);
  return candidato?.tipo_id ?? null;
}
