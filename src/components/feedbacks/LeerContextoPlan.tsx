"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { resizeImage } from "@/lib/imagenIA";
import { enlazarPersona } from "@/lib/pendientes-ia";

const MAX_ARCHIVOS = 4;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export type ContextoLeido = {
  contexto: string;
  /** Personas del equipo que menciona el documento. */
  personaIds: string[];
  /** Nombres que menciona pero que no se pudieron ubicar en el equipo. */
  sinIdentificar: string[];
};

function leerBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    r.readAsDataURL(file);
  });
}

async function mensajeDeError(error: unknown, data: unknown): Promise<string> {
  const d = data as { error?: string } | null;
  if (d?.error) return d.error;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const cuerpo = (await ctx.clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      /* la respuesta no era JSON */
    }
  }
  return error instanceof Error ? error.message : "No se pudo leer el archivo.";
}

/**
 * Plan de Trabajo → "Contexto desde foto o PDF": lee cualquier documento (un
 * correo, un acta, un reporte, una captura) con IA y devuelve el contexto del
 * plan y las personas que menciona. Nada se guarda: queda en el formulario
 * para que la jefatura lo revise.
 */
export function LeerContextoPlan({
  roster,
  onLeido,
}: {
  roster: { id: string; nombre: string }[];
  onLeido: (r: ContextoLeido) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []).slice(0, MAX_ARCHIVOS);
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (archivos.length === 0) return;
    setError(null);
    setLeyendo(true);
    try {
      const preparados: { base64: string; mime: string }[] = [];
      for (const f of archivos) {
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
          if (f.size > MAX_PDF_BYTES) throw new Error(`${f.name} pesa más de 8 MB.`);
          preparados.push({ base64: await leerBase64(f), mime: "application/pdf" });
        } else if (f.type.startsWith("image/")) {
          // Las fotos del celular pesan varios MB: se reducen antes de enviarlas.
          preparados.push(await resizeImage(f));
        } else {
          throw new Error(`${f.name}: formato no soportado. Usa imágenes (JPG, PNG) o PDF.`);
        }
      }
      const { data, error: fnError } = await supabase.functions.invoke("leer-contexto-plan", {
        body: { archivos: preparados },
      });
      if (fnError) throw new Error(await mensajeDeError(fnError, data));
      const r = (data ?? {}) as { contexto?: string; personas?: string[]; legible?: boolean };
      if (r.legible === false || !r.contexto) {
        throw new Error(r.contexto || "No se pudo sacar un contexto de ese archivo. Prueba con una imagen más clara.");
      }
      const personaIds: string[] = [];
      const sinIdentificar: string[] = [];
      for (const nombre of r.personas ?? []) {
        const p = enlazarPersona(nombre, roster);
        if (p) {
          if (!personaIds.includes(p.id)) personaIds.push(p.id);
        } else if (!sinIdentificar.includes(nombre)) {
          sinIdentificar.push(nombre);
        }
      }
      onLeido({ contexto: r.contexto, personaIds, sinIdentificar });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <div className="mb-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        hidden
        onChange={elegir}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={leyendo}
        className="w-full border-2 border-dashed border-line rounded-lg py-3 text-[13px] text-muted hover:bg-paper disabled:opacity-50 transition-colors"
      >
        {leyendo ? "Leyendo el documento…" : "📎 Contexto desde foto o PDF"}
        <span className="block text-[11.5px] mt-0.5">
          Un correo, un acta, un reporte o una captura: la IA escribe el contexto y marca a las personas que menciona.
        </span>
      </button>
      {error && (
        <div className="mt-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
      )}
    </div>
  );
}
