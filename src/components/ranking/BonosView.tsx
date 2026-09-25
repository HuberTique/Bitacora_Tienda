"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { PersonaRk, PuntoExtra, RankingConfig } from "@/lib/ranking";
import { inputCls } from "./ui";

const SUGERENCIAS = [
  "Asistió puntual a la OPM",
  "Meta de accesorios cumplida en la semana",
  "Apoyó una operación fuera de su turno",
  "Reconocimiento de un cliente",
];

/**
 * Bonos: puntos extra (o descuentos) que jefatura suma al ranking con un
 * motivo visible. Además del bonus automático por cumplir la meta de
 * accesorios y de ropa, y la constancia en el podio (ver Configuración).
 */
export function BonosView({
  personas,
  extras,
  config,
  anio,
  mes,
  esJefatura,
  registradoPor,
  onGuardado,
}: {
  personas: PersonaRk[];
  extras: PuntoExtra[];
  config: RankingConfig;
  anio: number;
  mes: number;
  esJefatura: boolean;
  registradoPor: string;
  onGuardado: () => void;
}) {
  const [personaId, setPersonaId] = useState("");
  const [puntos, setPuntos] = useState(1);
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const nombreDe = new Map(personas.map((p) => [p.id, p.nombre]));

  async function agregar() {
    setMsg(null);
    if (!personaId || !motivo.trim() || !puntos) {
      setMsg("Elige la persona, los puntos y escribe el motivo.");
      return;
    }
    const { error } = await supabase.from("puntos_extra").insert({
      persona_id: personaId,
      anio,
      mes,
      puntos,
      motivo: motivo.trim(),
      registrado_por: registradoPor,
    });
    if (error) {
      setMsg(`❌ ${error.message}`);
      return;
    }
    setMotivo("");
    setMsg("✓ Bono registrado.");
    onGuardado();
  }

  async function quitar(id: string) {
    if (!confirm("¿Quitar este bono?")) return;
    const { error } = await supabase.from("puntos_extra").delete().eq("id", id);
    if (error) {
      setMsg(`❌ ${error.message}`);
      return;
    }
    onGuardado();
  }

  return (
    <div className="space-y-4">
      <div className="bg-panel border border-line rounded-[10px] p-4 text-[12.5px] text-muted">
        <strong className="text-ink">Cómo suman los bonos al puntaje:</strong>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>
            <strong>Automático A&A:</strong> +{config.bonus_aya} por cumplir la meta de accesorios y +
            {config.bonus_aya} por la de ropa (según el Excel de KPIs).
          </li>
          <li>
            <strong>Constancia:</strong> +{config.bonus_constancia} por cada mes consecutivo anterior en
            el podio (hasta 3 meses).
          </li>
          <li>
            <strong>Bonos manuales:</strong> los que registres aquí, con su motivo (asistencia a la OPM,
            apoyo, reconocimientos). También puedes descontar con puntos negativos.
          </li>
        </ul>
      </div>

      {esJefatura && (
        <div className="bg-panel border border-line rounded-[10px] p-4">
          <h4 className="text-sm font-semibold mb-3">Registrar bono</h4>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px] gap-3">
            <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} className={inputCls}>
              <option value="">— Persona —</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={-20}
              max={20}
              step={0.5}
              value={puntos}
              onChange={(e) => setPuntos(Number(e.target.value))}
              className={inputCls + " text-right"}
              aria-label="Puntos"
            />
          </div>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            list="bonos-sugerencias"
            placeholder="Motivo (visible para el equipo)"
            className={inputCls + " w-full mt-3"}
          />
          <datalist id="bonos-sugerencias">
            {SUGERENCIAS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={agregar}
              className="px-4 py-2 bg-brand text-white rounded-md font-semibold text-sm hover:bg-brand-light"
            >
              Agregar bono
            </button>
            {msg && <span className="text-xs">{msg}</span>}
          </div>
        </div>
      )}

      <div className="bg-panel border border-line rounded-[10px] p-4">
        <h4 className="text-sm font-semibold mb-2">Bonos del mes</h4>
        {extras.length === 0 ? (
          <div className="text-muted text-sm">No hay bonos manuales este mes.</div>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {extras.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5">{nombreDe.get(e.persona_id) ?? "—"}</td>
                  <td
                    className={
                      "py-1.5 text-right font-mono font-semibold " +
                      (Number(e.puntos) >= 0 ? "text-operaciones" : "text-warn")
                    }
                  >
                    {Number(e.puntos) > 0 ? "+" : ""}
                    {e.puntos}
                  </td>
                  <td className="py-1.5 pl-3 text-muted">{e.motivo}</td>
                  <td className="py-1.5 text-right">
                    {esJefatura && (
                      <button
                        type="button"
                        onClick={() => quitar(e.id)}
                        className="text-warn text-xs hover:underline"
                      >
                        Quitar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
