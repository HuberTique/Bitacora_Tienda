"use client";

import { useEffect, useMemo, useState } from "react";
import { estiloCumplimiento } from "@/lib/cumplimiento";
import { fmtMoney } from "@/lib/types";
import type { PersonaRk, ResumenSemanal } from "@/lib/ranking";
import { compiteEnRanking } from "@/lib/ranking";
import { useMountedAnimado } from "@/components/charts/hooks";
import { Avatar, inputCls } from "./ui";

const MEDALLA = ["🥇", "🥈", "🥉"];
const ANILLOS = ["oro", "plata", "bronce"] as const;

/** Ranking de la semana: venta frente a la meta semanal de cada asesor. */
export function SemanalView({
  personas,
  semanal,
  fotos,
}: {
  personas: PersonaRk[];
  semanal: ResumenSemanal[];
  fotos: Record<string, string>;
}) {
  const animado = useMountedAnimado();
  const semanas = useMemo(() => [...new Set(semanal.map((s) => s.semana_label))], [semanal]);
  const [semana, setSemana] = useState("");

  useEffect(() => {
    if (!semanas.includes(semana)) setSemana(semanas[semanas.length - 1] ?? "");
  }, [semanas, semana]);

  const compiten = useMemo(() => new Map(personas.filter(compiteEnRanking).map((p) => [p.id, p])), [personas]);

  const filas = useMemo(() => {
    return semanal
      .filter((s) => s.semana_label === semana && compiten.has(s.persona_id))
      .map((s) => ({ p: compiten.get(s.persona_id)!, s }))
      .sort((a, b) => (b.s.cumplimiento ?? -1) - (a.s.cumplimiento ?? -1));
  }, [semanal, semana, compiten]);

  if (semanas.length === 0) {
    return (
      <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
        No hay semanas cargadas este mes. Jefatura las sube en <strong>Presupuestos</strong> (Excel de
        KPIs semanales).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[11px] text-muted uppercase tracking-wider">
          Semana
          <select
            value={semana}
            onChange={(e) => setSemana(e.target.value)}
            className={inputCls + " block mt-1"}
          >
            {semanas.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-muted flex-1 min-w-[200px]">
          Ordenado por cumplimiento del presupuesto de la semana.
        </p>
      </div>

      {filas.slice(0, 3).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {filas.slice(0, 3).map(({ p, s }, i) => (
            <div
              key={p.id}
              className={
                "bg-panel border rounded-[12px] px-3 pt-4 pb-3 flex flex-col items-center text-center " +
                (i === 0 ? "border-[#E0A526] shadow-md" : "border-line")
              }
            >
              <div className="text-2xl leading-none mb-2" aria-hidden>
                {MEDALLA[i]}
              </div>
              <Avatar nombre={p.nombre} url={fotos[p.id]} tam={i === 0 ? 76 : 62} anillo={ANILLOS[i]} />
              <div className="mt-2 font-display font-bold text-[15px] leading-tight">
                {p.nombre.trim().split(/\s+/)[0]}
              </div>
              <div className={"text-[14px] font-semibold " + estiloCumplimiento(s.cumplimiento).text}>
                {s.cumplimiento != null ? `${Math.round(s.cumplimiento * 100)} %` : "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {filas.map(({ p, s }, i) => {
          const est = estiloCumplimiento(s.cumplimiento);
          return (
            <div
              key={p.id}
              className="bg-panel border border-line rounded-[10px] px-3 py-2.5 flex items-center gap-3"
            >
              <div className="w-7 text-center font-display font-bold text-[18px] text-muted">{i + 1}</div>
              <Avatar nombre={p.nombre} url={fotos[p.id]} tam={36} />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-[13.5px] truncate">{p.nombre}</span>
                  <span className={"font-display font-bold " + est.text}>
                    {s.cumplimiento != null ? `${Math.round(s.cumplimiento * 100)} %` : "—"}
                  </span>
                </div>
                <div className="relative h-2.5 rounded-full bg-neutral-100 mt-1 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] ease-out"
                    style={{
                      width: animado ? `${Math.min(100, (s.cumplimiento ?? 0) * 100)}%` : "0%",
                      backgroundColor: est.hex,
                      transitionDuration: "900ms",
                      transitionDelay: `${i * 50}ms`,
                    }}
                  />
                </div>
                <div className="text-[11px] text-muted mt-1">
                  {fmtMoney(s.venta)} de {fmtMoney(s.meta)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
