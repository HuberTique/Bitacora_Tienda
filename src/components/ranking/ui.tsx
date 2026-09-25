"use client";

import { useRef, useState } from "react";
import { subirFotoPersona } from "@/lib/fotos";

export function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

const ANILLO: Record<string, string> = {
  oro: "ring-[3px] ring-[#E0A526]",
  plata: "ring-[3px] ring-[#9AA3AF]",
  bronce: "ring-[3px] ring-[#C0763F]",
  ninguno: "ring-1 ring-line",
};

/**
 * Foto circular de una persona (o sus iniciales si aún no tiene). Si
 * `editable`, muestra un botón de cámara para subir/cambiar la foto.
 */
export function Avatar({
  nombre,
  url,
  tam = 40,
  anillo = "ninguno",
  editable,
  personaId,
  rutaFoto,
  onCambio,
}: {
  nombre: string;
  url?: string;
  tam?: number;
  anillo?: "oro" | "plata" | "bronce" | "ninguno";
  editable?: boolean;
  personaId?: string;
  rutaFoto?: string | null;
  onCambio?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function elegido(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !personaId) return;
    setError(null);
    setSubiendo(true);
    try {
      await subirFotoPersona(personaId, f, rutaFoto ?? null);
      onCambio?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto.");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="relative shrink-0" style={{ width: tam, height: tam }} title={error ?? undefined}>
      <div
        className={"w-full h-full rounded-full overflow-hidden bg-[#E8ECF4] flex items-center justify-center " + ANILLO[anillo]}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={nombre} className="w-full h-full object-cover" />
        ) : (
          <span className="font-semibold text-brand" style={{ fontSize: tam * 0.36 }}>
            {iniciales(nombre)}
          </span>
        )}
      </div>
      {editable && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              input.current?.click();
            }}
            disabled={subiendo}
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-line text-[10px] leading-none shadow-sm hover:bg-paper disabled:opacity-50"
            aria-label={`Subir foto de ${nombre}`}
            title="Subir foto"
          >
            {subiendo ? "…" : "📷"}
          </button>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={elegido} />
        </>
      )}
      {error && (
        <div className="absolute top-full left-0 mt-1 z-10 w-40 bg-warn-soft text-warn border border-warn-border rounded px-1.5 py-1 text-[10px]">
          {error}
        </div>
      )}
    </div>
  );
}

export function Modal({
  titulo,
  onClose,
  children,
  ancho = "max-w-2xl",
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
  ancho?: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className={
          "bg-panel rounded-[10px] p-6 w-full relative shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto " +
          ancho
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-muted hover:text-ink text-lg leading-none"
          aria-label="Cerrar"
        >
          ✕
        </button>
        <h3 className="font-display font-semibold text-base mb-4 pr-8">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

export function Tile({
  valor,
  etiqueta,
  color = "text-ink",
}: {
  valor: string;
  etiqueta: string;
  color?: string;
}) {
  return (
    <div className="bg-panel border border-line rounded-[10px] px-4 py-3">
      <div className={"text-[22px] font-display font-bold leading-tight " + color}>{valor}</div>
      <div className="text-[11.5px] text-muted mt-0.5">{etiqueta}</div>
    </div>
  );
}

export const inputCls =
  "px-3 py-2 border border-line rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30";
