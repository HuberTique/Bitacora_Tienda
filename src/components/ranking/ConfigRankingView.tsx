"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RankingConfig } from "@/lib/ranking";
import { inputCls } from "./ui";

const CAMPOS: { key: keyof RankingConfig; label: string; ayuda: string }[] = [
  { key: "peso_ventas", label: "Ventas (cumplimiento del presupuesto)", ayuda: "Venta neta del mes / presupuesto." },
  { key: "peso_upt", label: "UPT", ayuda: "UPT del asesor frente a la meta de UPT." },
  { key: "peso_magia", label: "Magia con una sonrisa", ayuda: "Promedio de las evaluaciones del mes." },
  {
    key: "peso_puntualidad",
    label: "Puntualidad y llamados de atención",
    ayuda: "Parte de 100 y resta puntos por cada llegada tarde, ausencia o falta del mes.",
  },
  { key: "peso_maximizador", label: "Maximizador", ayuda: "Checklist del maximizador (solo quien ejerció la función)." },
];

export function ConfigRankingView({
  config,
  onGuardado,
}: {
  config: RankingConfig;
  onGuardado: () => void;
}) {
  const [draft, setDraft] = useState<RankingConfig>(config);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const totalPesos =
    draft.peso_ventas + draft.peso_upt + draft.peso_magia + draft.peso_puntualidad + draft.peso_maximizador;

  async function guardar() {
    setMsg(null);
    if (totalPesos <= 0) {
      setMsg("Al menos un componente debe tener peso mayor a cero.");
      return;
    }
    if (draft.upt_meta <= 0) {
      setMsg("La meta de UPT debe ser mayor a cero.");
      return;
    }
    setGuardando(true);
    const { error } = await supabase.from("ranking_config").upsert({ id: true, ...draft });
    setGuardando(false);
    if (error) {
      setMsg(`❌ ${error.message}`);
      return;
    }
    setMsg("✓ Guardado. El ranking ya usa estos pesos.");
    onGuardado();
  }

  return (
    <div className="bg-panel border border-line rounded-[10px] p-4 max-w-2xl">
      <h4 className="text-sm font-semibold mb-1">Cómo se calcula el ranking</h4>
      <p className="text-[12.5px] text-muted mb-4">
        Cada componente se califica de 0 a 100 (100 = meta cumplida). El puntaje final es el promedio
        ponderado de los componentes que tengan datos; los pesos no necesitan sumar 100, se reparten
        proporcionalmente.
      </p>
      <div className="space-y-3">
        {CAMPOS.map((c) => (
          <label key={c.key} className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[13px] font-semibold">{c.label}</div>
              <div className="text-[11.5px] text-muted">{c.ayuda}</div>
            </div>
            <input
              type="number"
              min={0}
              value={draft[c.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [c.key]: Math.max(0, Number(e.target.value) || 0) }))}
              className={inputCls + " w-20 text-right"}
            />
          </label>
        ))}
        <label className="flex items-center gap-3 border-t border-line pt-3">
          <div className="flex-1">
            <div className="text-[13px] font-semibold">Bonus por meta de accesorios / de ropa</div>
            <div className="text-[11.5px] text-muted">Puntos que se suman por cada una que cumpla (según el Excel de KPIs).</div>
          </div>
          <input
            type="number"
            step="0.5"
            min={0}
            value={draft.bonus_aya}
            onChange={(e) => setDraft((d) => ({ ...d, bonus_aya: Math.max(0, Number(e.target.value) || 0) }))}
            className={inputCls + " w-20 text-right"}
          />
        </label>
        <label className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[13px] font-semibold">Bonus de constancia</div>
            <div className="text-[11.5px] text-muted">Puntos por cada mes consecutivo anterior en el podio (máximo 3 meses).</div>
          </div>
          <input
            type="number"
            step="0.5"
            min={0}
            value={draft.bonus_constancia}
            onChange={(e) => setDraft((d) => ({ ...d, bonus_constancia: Math.max(0, Number(e.target.value) || 0) }))}
            className={inputCls + " w-20 text-right"}
          />
        </label>
        <label className="flex items-center gap-3 border-t border-line pt-3">
          <div className="flex-1">
            <div className="text-[13px] font-semibold">Meta de UPT</div>
            <div className="text-[11.5px] text-muted">Unidades por transacción objetivo de la tienda.</div>
          </div>
          <input
            type="number"
            step="0.05"
            min={0.1}
            value={draft.upt_meta}
            onChange={(e) => setDraft((d) => ({ ...d, upt_meta: Number(e.target.value) || d.upt_meta }))}
            className={inputCls + " w-20 text-right"}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="px-4 py-2 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
        >
          {guardando ? "Guardando…" : "Guardar configuración"}
        </button>
        <span className="text-[11.5px] text-muted">Suma de pesos: {totalPesos}</span>
        {msg && <span className="text-xs">{msg}</span>}
      </div>
    </div>
  );
}
