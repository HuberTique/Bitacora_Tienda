"use client";

// Fotos del personal (podio del Ranking de ventas). Viven en el bucket
// privado `fotos-personal`; la ruta se guarda en personal.foto_path y se
// muestran con URLs firmadas de corta duración.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const BUCKET = "fotos-personal";
const LADO_MAX = 480; // px; suficiente para el podio y mantiene el archivo liviano

/** Reduce y centra la imagen en un cuadrado JPEG (evita subir fotos de varios MB). */
async function recortarCuadrado(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const lado = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - lado) / 2;
  const sy = (bitmap.height - lado) / 2;
  const salida = Math.min(LADO_MAX, lado);
  const canvas = document.createElement("canvas");
  canvas.width = salida;
  canvas.height = salida;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");
  ctx.drawImage(bitmap, sx, sy, lado, lado, 0, 0, salida, salida);
  return await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("No se pudo convertir la imagen."))),
      "image/jpeg",
      0.85,
    ),
  );
}

/** Sube la foto de una persona y actualiza personal.foto_path. Devuelve la nueva ruta. */
export async function subirFotoPersona(
  personaId: string,
  file: File,
  rutaAnterior: string | null,
): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen.");
  const blob = await recortarCuadrado(file);
  const path = `${personaId}/foto-${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { error: dbErr } = await supabase
    .from("personal")
    .update({ foto_path: path })
    .eq("id", personaId);
  if (dbErr) throw new Error(dbErr.message);
  if (rutaAnterior) await supabase.storage.from(BUCKET).remove([rutaAnterior]);
  return path;
}

/** URLs firmadas para las fotos de una lista de personas: { personaId: url }. */
export function useFotos(personas: { id: string; foto_path: string | null }[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const clave = useMemo(
    () =>
      personas
        .filter((p) => p.foto_path)
        .map((p) => `${p.id}:${p.foto_path}`)
        .sort()
        .join("|"),
    [personas],
  );

  useEffect(() => {
    let alive = true;
    const conFoto = personas.filter((p) => p.foto_path) as { id: string; foto_path: string }[];
    if (conFoto.length === 0) {
      setUrls({});
      return;
    }
    supabase.storage
      .from(BUCKET)
      .createSignedUrls(
        conFoto.map((p) => p.foto_path),
        3600,
      )
      .then(({ data }) => {
        if (!alive || !data) return;
        const mapa: Record<string, string> = {};
        data.forEach((d, i) => {
          if (d.signedUrl) mapa[conFoto[i].id] = d.signedUrl;
        });
        setUrls(mapa);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return urls;
}
