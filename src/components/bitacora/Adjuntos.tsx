"use client";

// Enlaces y archivos de un pendiente: verlos (un toque abre la página o el documento) y
// editarlos (agregar, quitar y reutilizar los de un pendiente parecido anterior).

import { useEffect, useRef, useState } from "react";
import {
  ACEPTA_ARCHIVOS,
  MAX_ARCHIVOS,
  MAX_BYTES,
  abrirArchivo,
  buscarSimilar,
  normalizarUrl,
  type Adjunto,
  type AdjuntoNuevo,
  type Sugerencia,
} from "@/lib/adjuntos";

const peso = (b: number | null) => (b == null ? "" : b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const campo = "w-full px-3 py-2 border border-line rounded-md bg-white text-sm";

async function abrir(a: Adjunto) {
  if (a.tipo === "enlace" && a.url) {
    window.open(a.url, "_blank", "noopener,noreferrer");
    return;
  }
  // Se abre la pestaña de una vez (el celular bloquea las que se abren después de esperar).
  const w = window.open("", "_blank");
  const url = a.path ? await abrirArchivo(a.path) : null;
  if (url && w) w.location.href = url;
  else {
    w?.close();
    alert("No se pudo abrir el archivo (puede que ya se haya borrado: los archivos se borran a los 90 días de cerrado el pendiente).");
  }
}

export function AdjuntosVista({ adjuntos }: { adjuntos: Adjunto[] }) {
  if (adjuntos.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-xs uppercase tracking-wider text-muted mb-1.5">Enlaces y archivos</div>
      <ul className="space-y-1.5">
        {adjuntos.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => abrir(a)}
              className="w-full text-left flex items-center gap-2 px-3 py-2 border border-line rounded-md bg-white hover:bg-paper text-sm"
            >
              <span aria-hidden>{a.tipo === "enlace" ? "🔗" : "📄"}</span>
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-brand truncate block">{a.nombre}</span>
                <span className="text-[11px] text-muted truncate block">{a.tipo === "enlace" ? a.url : peso(a.tamano)}</span>
              </span>
              <span className="text-[11px] text-muted">Abrir ↗</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdjuntosEditor({
  titulo,
  existentes = [],
  onQuitarExistente,
  nuevos,
  onCambio,
}: {
  /** Título del pendiente: con él se busca uno parecido anterior para sugerir sus adjuntos. */
  titulo: string;
  existentes?: Adjunto[];
  onQuitarExistente?: (a: Adjunto) => void;
  nuevos: AdjuntoNuevo[];
  onCambio: (n: AdjuntoNuevo[]) => void;
}) {
  const archivo = useRef<HTMLInputElement>(null);
  const [nombre, setNombre] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);
  const [descartada, setDescartada] = useState(false);

  // Sugerencia: pendiente anterior con título parecido que tenga enlaces o archivos.
  useEffect(() => {
    if (descartada || titulo.trim().length < 6) return;
    let vivo = true;
    const t = setTimeout(() => {
      buscarSimilar(titulo).then((s) => vivo && setSugerencia(s));
    }, 600);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [titulo, descartada]);

  const totalArchivos = existentes.filter((a) => a.tipo === "archivo").length + nuevos.filter((n) => n.tipo !== "enlace").length;

  function agregarEnlace() {
    setError(null);
    const u = normalizarUrl(url);
    if (!u) return setError("Escribe una dirección web válida (por ejemplo https://forms.office.com/...).");
    onCambio([...nuevos, { tipo: "enlace", nombre: nombre.trim() || new URL(u).hostname, url: u }]);
    setNombre("");
    setUrl("");
  }

  function agregarArchivos(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const fs = Array.from(e.target.files ?? []);
    e.target.value = "";
    const grandes = fs.filter((f) => f.size > MAX_BYTES).map((f) => f.name);
    const buenos = fs.filter((f) => f.size <= MAX_BYTES).slice(0, Math.max(0, MAX_ARCHIVOS - totalArchivos));
    if (grandes.length) setError(`Pesan más de 10 MB: ${grandes.join(", ")}.`);
    else if (buenos.length < fs.length) setError(`Máximo ${MAX_ARCHIVOS} archivos por pendiente.`);
    if (buenos.length) onCambio([...nuevos, ...buenos.map((file) => ({ tipo: "archivo" as const, file }))]);
  }

  function reutilizar(s: Sugerencia) {
    const ya = new Set(nuevos.map((n) => (n.tipo === "enlace" ? n.url : n.tipo === "copia" ? n.path : "")));
    const extra: AdjuntoNuevo[] = s.adjuntos.flatMap((a): AdjuntoNuevo[] =>
      a.tipo === "enlace" && a.url && !ya.has(a.url)
        ? [{ tipo: "enlace", nombre: a.nombre, url: a.url }]
        : a.tipo === "archivo" && a.path && !ya.has(a.path)
          ? [{ tipo: "copia", nombre: a.nombre, path: a.path, mime: a.mime, tamano: a.tamano }]
          : [],
    );
    onCambio([...nuevos, ...extra]);
    setDescartada(true);
    setSugerencia(null);
  }

  return (
    <div className="space-y-2">
      {sugerencia && !descartada && (
        <div className="bg-brand/5 border border-brand/30 rounded-md px-3 py-2 text-[12.5px]">
          <div>
            💡 En <strong>&quot;{sugerencia.titulo}&quot;</strong> ({new Date(sugerencia.fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}) usaste:{" "}
            {sugerencia.adjuntos.map((a) => a.nombre).join(", ")}.
          </div>
          <div className="flex gap-3 mt-1.5">
            <button type="button" onClick={() => reutilizar(sugerencia)} className="text-brand font-semibold hover:underline">
              Usarlos en este pendiente
            </button>
            <button type="button" onClick={() => setDescartada(true)} className="text-muted hover:underline">
              No, gracias
            </button>
          </div>
        </div>
      )}

      {(existentes.length > 0 || nuevos.length > 0) && (
        <ul className="space-y-1">
          {existentes.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-[12.5px] border border-line rounded-md bg-white px-2.5 py-1.5">
              <span aria-hidden>{a.tipo === "enlace" ? "🔗" : "📄"}</span>
              <span className="flex-1 min-w-0 truncate">
                <strong>{a.nombre}</strong> <span className="text-muted">{a.tipo === "enlace" ? a.url : peso(a.tamano)}</span>
              </span>
              {onQuitarExistente && (
                <button type="button" onClick={() => onQuitarExistente(a)} className="text-warn text-xs font-semibold" aria-label={`Quitar ${a.nombre}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {nuevos.map((n, i) => (
            <li key={i} className="flex items-center gap-2 text-[12.5px] border border-dashed border-brand/40 rounded-md bg-white px-2.5 py-1.5">
              <span aria-hidden>{n.tipo === "enlace" ? "🔗" : "📄"}</span>
              <span className="flex-1 min-w-0 truncate">
                <strong>{n.tipo === "archivo" ? n.file.name : n.nombre}</strong>{" "}
                <span className="text-muted">{n.tipo === "enlace" ? n.url : n.tipo === "archivo" ? peso(n.file.size) : "reutilizado"}</span>
              </span>
              <button
                type="button"
                onClick={() => onCambio(nuevos.filter((_, k) => k !== i))}
                className="text-warn text-xs font-semibold"
                aria-label="Quitar"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej. Formulario de inventario)" className={campo} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), agregarEnlace())}
          placeholder="https://…"
          inputMode="url"
          className={campo}
        />
        <button type="button" onClick={agregarEnlace} className="px-3 py-2 border border-brand text-brand rounded-md text-sm font-semibold bg-white hover:bg-brand/5">
          🔗 Agregar enlace
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => archivo.current?.click()}
          disabled={totalArchivos >= MAX_ARCHIVOS}
          className="px-3 py-2 border border-line rounded-md text-sm font-semibold bg-white hover:bg-paper disabled:opacity-50"
        >
          📎 Adjuntar archivo
        </button>
        <span className="text-[11px] text-muted">
          PDF, fotos, Excel o Word · hasta {MAX_ARCHIVOS} de 10 MB · se borran a los 90 días de cerrado el pendiente
        </span>
        <input ref={archivo} type="file" accept={ACEPTA_ARCHIVOS} multiple className="hidden" onChange={agregarArchivos} />
      </div>
      {error && <div className="text-[12px] text-warn">{error}</div>}
    </div>
  );
}
