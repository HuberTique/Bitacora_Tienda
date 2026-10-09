"use client";

// Enlaces y archivos de los pendientes (Huber, 9-oct-2026): para que al gestionar la tarea un toque
// lleve a la página donde se monta la información, o al documento de soporte. Los archivos son
// privados (los ve quien ve el pendiente) y se borran a los 90 días de cerrado el pendiente; los
// enlaces se quedan. Al crear un pendiente parecido a uno anterior se sugieren sus adjuntos.

import { supabase } from "./supabase";

export const BUCKET_ADJUNTOS = "pendientes-adjuntos";
export const MAX_ARCHIVOS = 5;
export const MAX_BYTES = 10 * 1024 * 1024;
export const ACEPTA_ARCHIVOS = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.docx,.doc,.csv";

export type Adjunto = {
  id: string;
  pendiente_id: string;
  tipo: "enlace" | "archivo";
  nombre: string;
  url: string | null;
  path: string | null;
  mime: string | null;
  tamano: number | null;
  created_at: string;
};

/** Lo que se va a guardar: un enlace nuevo, un archivo nuevo o una copia de un archivo anterior. */
export type AdjuntoNuevo =
  | { tipo: "enlace"; nombre: string; url: string }
  | { tipo: "archivo"; file: File }
  | { tipo: "copia"; nombre: string; path: string; mime: string | null; tamano: number | null };

/** Pura: deja un enlace listo (agrega https:// si falta) o null si no es una dirección web. */
export function normalizarUrl(texto: string): string | null {
  let t = texto.trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    if (/^[a-z]+:/i.test(t)) return null; // javascript:, mailto:, etc.
    t = "https://" + t;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const VACIAS = new Set(["para", "por", "con", "del", "las", "los", "una", "uno", "que", "the", "and", "de", "la", "el", "en", "y", "a"]);
const palabras = (s: string) =>
  new Set(
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !VACIAS.has(w) && !/^\d+$/.test(w)),
  );

/** Pura: qué tan parecidos son dos títulos (0 a 1), por palabras en común. */
export function similitudTitulos(a: string, b: string): number {
  const x = palabras(a);
  const y = palabras(b);
  if (x.size === 0 || y.size === 0) return 0;
  let comunes = 0;
  for (const w of x) if (y.has(w)) comunes++;
  return comunes / Math.min(x.size, y.size);
}

export async function cargarAdjuntos(pendienteId: string): Promise<Adjunto[]> {
  const { data } = await supabase.from("pendiente_adjuntos").select("*").eq("pendiente_id", pendienteId).order("created_at");
  return (data as Adjunto[] | null) ?? [];
}

const nombreSeguro = (n: string) =>
  n
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(-80);

/** Guarda los adjuntos nuevos de un pendiente. Devuelve el primer error o null. */
export async function guardarAdjuntos(tiendaId: string, pendienteId: string, nuevos: AdjuntoNuevo[], quien: string): Promise<string | null> {
  for (const a of nuevos) {
    if (a.tipo === "enlace") {
      const url = normalizarUrl(a.url);
      if (!url) return `"${a.url}" no es una dirección web.`;
      const { error } = await supabase
        .from("pendiente_adjuntos")
        .insert({ pendiente_id: pendienteId, tipo: "enlace", nombre: a.nombre.trim() || new URL(url).hostname, url, creado_por: quien });
      if (error) return error.message;
      continue;
    }
    const sello = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const nombre = a.tipo === "archivo" ? a.file.name : a.nombre;
    const path = `${tiendaId}/${pendienteId}/${sello}-${nombreSeguro(nombre)}`;
    if (a.tipo === "archivo") {
      if (a.file.size > MAX_BYTES) return `"${a.file.name}" pesa más de 10 MB.`;
      const { error } = await supabase.storage.from(BUCKET_ADJUNTOS).upload(path, a.file, { contentType: a.file.type || undefined });
      if (error) return `No se pudo subir "${a.file.name}": ${error.message}`;
    } else {
      const { error } = await supabase.storage.from(BUCKET_ADJUNTOS).copy(a.path, path);
      if (error) return `No se pudo reutilizar "${a.nombre}": ${error.message}`;
    }
    const { error } = await supabase.from("pendiente_adjuntos").insert({
      pendiente_id: pendienteId,
      tipo: "archivo",
      nombre,
      path,
      mime: a.tipo === "archivo" ? a.file.type || null : a.mime,
      tamano: a.tipo === "archivo" ? a.file.size : a.tamano,
      creado_por: quien,
    });
    if (error) {
      await supabase.storage.from(BUCKET_ADJUNTOS).remove([path]);
      return error.message;
    }
  }
  return null;
}

export async function quitarAdjunto(a: Adjunto): Promise<string | null> {
  const { error } = await supabase.from("pendiente_adjuntos").delete().eq("id", a.id);
  if (error) return error.message;
  if (a.path) await supabase.storage.from(BUCKET_ADJUNTOS).remove([a.path]);
  return null;
}

/** Enlace temporal (1 hora) para abrir un archivo privado. */
export async function abrirArchivo(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET_ADJUNTOS).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** Borra los archivos de pendientes cerrados hace más de 90 días (la jefatura, al abrir la Bitácora). */
export async function purgarAdjuntosVencidos(): Promise<void> {
  const { data } = await supabase.rpc("purgar_adjuntos_vencidos");
  const paths = ((data as { path: string }[] | null) ?? []).map((x) => x.path).filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET_ADJUNTOS).remove(paths);
}

/** Antes de eliminar un pendiente: borra sus archivos del almacenamiento. */
export async function borrarArchivosDe(pendienteId: string): Promise<void> {
  const lista = await cargarAdjuntos(pendienteId);
  const paths = lista.map((a) => a.path).filter((p): p is string => !!p);
  if (paths.length) await supabase.storage.from(BUCKET_ADJUNTOS).remove(paths);
}

export type Sugerencia = { titulo: string; fecha: string; adjuntos: Adjunto[] };

/** El pendiente anterior más parecido (por título) que tenga adjuntos, para reutilizarlos. */
export async function buscarSimilar(titulo: string): Promise<Sugerencia | null> {
  if (palabras(titulo).size === 0) return null;
  const { data } = await supabase
    .from("pendiente_adjuntos")
    .select("*, pendientes(titulo, created_at)")
    .order("created_at", { ascending: false })
    .limit(300);
  const filas = (data as (Adjunto & { pendientes: { titulo: string; created_at: string } | null })[] | null) ?? [];
  const porPendiente = new Map<string, Sugerencia & { score: number }>();
  for (const f of filas) {
    if (!f.pendientes) continue;
    const s = porPendiente.get(f.pendiente_id) ?? {
      titulo: f.pendientes.titulo,
      fecha: f.pendientes.created_at,
      adjuntos: [],
      score: similitudTitulos(titulo, f.pendientes.titulo),
    };
    s.adjuntos.push(f);
    porPendiente.set(f.pendiente_id, s);
  }
  const mejor = [...porPendiente.values()]
    .filter((s) => s.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.fecha.localeCompare(a.fecha))[0];
  return mejor ? { titulo: mejor.titulo, fecha: mejor.fecha, adjuntos: mejor.adjuntos } : null;
}
