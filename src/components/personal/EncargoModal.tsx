"use client";

// Encargo temporal (migración 0039): la DSM o el administrador le dan a una
// persona acceso de jefatura por un tiempo (p. ej. el jefe está incapacitado).
// La persona conserva su cargo: horarios, presupuesto y ranking no cambian.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { fechaCorta } from "@/lib/ambito";
import { ENCARGO_LABEL, ROL_JERARQUICO_LABEL, type Encargo, type Persona } from "@/lib/types";

export type EncargoFila = Encargo & {
  persona_id: string;
  motivo: string;
  cerrado_at: string | null;
  asignado_at: string;
};

/** Fecha de hoy en Bogotá (YYYY-MM-DD). */
export function hoyBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function sumarDias(ymd: string, dias: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El encargo abierto de una persona (vigente o por vencer), si tiene. */
export function encargoAbierto(encargos: EncargoFila[], personaId: string): EncargoFila | null {
  const hoy = hoyBogota();
  return encargos.find((e) => e.persona_id === personaId && !e.cerrado_at && e.hasta >= hoy) ?? null;
}

export function EncargoModal({
  persona,
  encargos,
  onClose,
  onCambio,
}: {
  persona: Persona;
  /** Encargos de la tienda (todos), para mostrar el abierto y el historial. */
  encargos: EncargoFila[];
  onClose: () => void;
  onCambio: () => void;
}) {
  const hoy = hoyBogota();
  const maximo = sumarDias(hoy, 180);
  const abierto = encargoAbierto(encargos, persona.id);
  const historial = encargos.filter((e) => e.persona_id === persona.id && e.id !== abierto?.id);
  const opciones: Encargo["cargo"][] = persona.rol_jerarquico === "subjefe" ? ["jefe_tienda"] : ["subjefe", "jefe_tienda"];

  const [cargo, setCargo] = useState<Encargo["cargo"]>(opciones[0]);
  const [hasta, setHasta] = useState(abierto?.hasta ?? "");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ejecutar(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    setGuardando(true);
    const { error } = await fn();
    setGuardando(false);
    if (error) {
      setError(error.message);
      return;
    }
    onCambio();
  }

  function asignar() {
    if (!hasta) return setError("Pon la fecha fin del encargo.");
    ejecutar(() =>
      supabase.rpc("asignar_encargo", { p_persona: persona.id, p_cargo: cargo, p_hasta: hasta, p_motivo: motivo.trim() }),
    );
  }

  function extender() {
    if (!abierto || !hasta) return setError("Pon la nueva fecha fin.");
    ejecutar(() => supabase.rpc("extender_encargo", { p_id: abierto.id, p_hasta: hasta }));
  }

  function cerrar() {
    if (!abierto) return;
    if (!confirm(`¿Cerrar el encargo de ${persona.nombre}? Pierde el acceso de jefatura desde ya.`)) return;
    ejecutar(() => supabase.rpc("cerrar_encargo", { p_id: abierto.id }));
  }

  const etiqueta = "block text-xs text-muted uppercase tracking-wider mb-1";
  const campo = "w-full px-3 py-2 border border-line rounded-md bg-white text-sm";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-panel rounded-[10px] p-6 max-w-md w-full relative shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto"
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
        <h3 className="font-display font-semibold text-base mb-1 pr-8">Encargo temporal — {persona.nombre}</h3>
        <p className="text-muted text-[12.5px] mb-4">
          Mientras dure, tiene acceso de jefatura en esta tienda. Sigue siendo{" "}
          <strong>{ROL_JERARQUICO_LABEL[persona.rol_jerarquico].toLowerCase()}</strong>: sus horarios, su presupuesto y
          el ranking no cambian. Entra con su mismo usuario y clave, y el acceso se quita solo en la fecha fin.
        </p>

        {abierto ? (
          <>
            <div className="bg-ventas/10 text-ventas border border-ventas/30 rounded-md px-3 py-2 text-[12.5px] mb-4">
              <strong>{ENCARGO_LABEL[abierto.cargo]}</strong> desde el {fechaCorta(abierto.desde)} hasta el{" "}
              {fechaCorta(abierto.hasta)}
              {abierto.motivo && <> · {abierto.motivo}</>}
            </div>
            <label className={etiqueta}>Nueva fecha fin</label>
            <input type="date" value={hasta} min={hoy} max={maximo} onChange={(e) => setHasta(e.target.value)} className={campo} />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={extender}
                disabled={guardando || hasta === abierto.hasta}
                className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
              >
                Cambiar fecha fin
              </button>
              <button
                type="button"
                onClick={cerrar}
                disabled={guardando}
                className="flex-1 py-2.5 border border-warn text-warn bg-white rounded-md font-semibold text-sm hover:bg-warn-soft disabled:opacity-50"
              >
                Cerrar encargo ahora
              </button>
            </div>
          </>
        ) : (
          <>
            <label className={etiqueta}>Queda como</label>
            <select value={cargo} onChange={(e) => setCargo(e.target.value as Encargo["cargo"])} className={campo}>
              {opciones.map((c) => (
                <option key={c} value={c}>
                  {ENCARGO_LABEL[c]}
                </option>
              ))}
            </select>
            <label className={etiqueta + " mt-3"}>Hasta (fecha fin)</label>
            <input type="date" value={hasta} min={hoy} max={maximo} onChange={(e) => setHasta(e.target.value)} className={campo} />
            <p className="text-[11.5px] text-muted mt-1">Máximo 180 días; si se necesita más, se extiende al vencer.</p>
            <label className={etiqueta + " mt-3"}>Motivo</label>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Incapacidad del jefe de tienda"
              maxLength={200}
              className={campo}
            />
            <button
              type="button"
              onClick={asignar}
              disabled={guardando}
              className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
            >
              {guardando ? "Guardando…" : "Asignar encargo"}
            </button>
          </>
        )}

        {error && (
          <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
        )}

        {historial.length > 0 && (
          <div className="mt-5 border-t border-line pt-3">
            <div className="text-xs text-muted uppercase tracking-wider mb-1.5">Encargos anteriores</div>
            <ul className="text-[12px] space-y-1">
              {historial.map((e) => (
                <li key={e.id}>
                  {ENCARGO_LABEL[e.cargo]} · {fechaCorta(e.desde)} al {fechaCorta(e.hasta)}
                  {e.cerrado_at && " (cerrado antes)"}
                  {e.motivo && <span className="text-muted"> · {e.motivo}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
