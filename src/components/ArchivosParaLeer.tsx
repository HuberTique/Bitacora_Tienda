"use client";

// Elegir los archivos de un informe para leerlos con IA (Huber, 8-oct-2026):
// en el celular la cámara toma UNA foto por vez, así que las hojas se van
// sumando ("Agregar otra foto") y al final se leen todas juntas. Cada archivo
// se revisa por su contenido (un "PDF" que en verdad es una foto se acepta como
// foto; uno dañado se rechaza con un mensaje claro).

import { useRef, useState } from "react";
import { prepararArchivo } from "@/lib/ventas-pdf";

const peso = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function ArchivosParaLeer({
  archivos,
  onCambio,
  onLeer,
  leyendo,
  avance,
  soloPdf = false,
}: {
  archivos: File[];
  onCambio: (a: File[]) => void;
  onLeer: () => void;
  leyendo: boolean;
  avance?: { hechas: number; total: number } | null;
  /** Si el informe solo se puede leer en PDF (sin fotos). */
  soloPdf?: boolean;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function agregar(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!nuevos.length) return;
    setError(null);
    const buenos: File[] = [];
    const errores: string[] = [];
    for (const f of nuevos) {
      try {
        const p = await prepararArchivo(f);
        if (soloPdf && p.type !== "application/pdf") errores.push(`"${f.name}" no es un PDF.`);
        else buenos.push(p);
      } catch (err) {
        errores.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (errores.length) setError(errores.join(" "));
    if (buenos.length) onCambio([...archivos, ...buenos]);
  }

  const boton = "px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-50";
  const hay = archivos.length > 0;
  return (
    <div className="space-y-2">
      {hay && (
        <ol className="space-y-1">
          {archivos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[12.5px] border border-line rounded-md bg-white px-2.5 py-1.5">
              <span className="text-muted w-5">{i + 1}.</span>
              <span className="flex-1 min-w-0 truncate">
                {f.type === "application/pdf" ? "📄" : "📷"} {f.name}
              </span>
              <span className="text-[11px] text-muted">{peso(f.size)}</span>
              <button
                type="button"
                disabled={leyendo}
                onClick={() => onCambio(archivos.filter((_, k) => k !== i))}
                className="text-warn text-xs font-semibold px-1 disabled:opacity-40"
                aria-label={`Quitar ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2 flex-wrap">
        {!soloPdf && (
          <button
            type="button"
            disabled={leyendo}
            onClick={() => camara.current?.click()}
            className={boton + " border border-brand text-brand bg-white hover:bg-brand/5"}
          >
            📷 {hay ? "Agregar otra foto" : "Tomar foto"}
          </button>
        )}
        <button
          type="button"
          disabled={leyendo}
          onClick={() => galeria.current?.click()}
          className={boton + " border border-line bg-white hover:bg-paper"}
        >
          📎 {hay ? "Agregar archivo" : soloPdf ? "Elegir PDF" : "Elegir PDF o fotos"}
        </button>
        {hay && (
          <button type="button" disabled={leyendo} onClick={onLeer} className={boton + " bg-brand text-white hover:bg-brand-light"}>
            {leyendo
              ? `Leyendo con IA…${avance && avance.total > 1 ? ` (${avance.hechas} de ${avance.total} partes)` : ""}`
              : `Leer ${archivos.length} ${archivos.length === 1 ? "archivo" : "archivos"} con IA`}
          </button>
        )}
      </div>
      {!soloPdf && !hay && (
        <p className="text-[11.5px] text-muted">
          ¿El informe tiene varias hojas? Toma una foto por hoja con <strong>Agregar otra foto</strong> y, cuando estén todas, toca{" "}
          <strong>Leer</strong>.
        </p>
      )}
      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={agregar} />
      <input
        ref={galeria}
        type="file"
        accept={soloPdf ? "application/pdf" : "application/pdf,image/*"}
        multiple
        className="hidden"
        onChange={agregar}
      />
      {error && <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-[12.5px]">{error}</div>}
    </div>
  );
}
