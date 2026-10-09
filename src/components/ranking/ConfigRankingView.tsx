"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useTienda } from "@/lib/tienda-config";
import { repartoVentas, type RankingConfig } from "@/lib/ranking";
import { inputCls } from "./ui";

type PesoKey = "peso_ventas" | "peso_upt" | "peso_magia" | "peso_puntualidad" | "peso_reconocimientos";

const CAMPOS: { key: PesoKey; label: string; ayuda: string }[] = [
  { key: "peso_ventas", label: "Ventas", ayuda: "Cumplimiento en pesos y en unidades (pares, accesorios, ropa); el reparto se define abajo." },
  { key: "peso_upt", label: "UPT", ayuda: "UPT del asesor frente a la meta de UPT." },
  { key: "peso_magia", label: "Magia con una sonrisa", ayuda: "Promedio de la evaluación; los reclamos de clientes (Feedbacks) restan aquí." },
  {
    key: "peso_puntualidad",
    label: "Puntualidad y operación",
    ayuda: "Parte de 100 y resta por llegadas tarde, ausencias, traspasos, irrespeto y errores operacionales registrados en Feedbacks.",
  },
  {
    key: "peso_reconocimientos",
    label: "Reconocimientos (8 ítems)",
    ayuda: "Se reparte entre los 8 reconocimientos del mejor vendedor: cada ganador suma este valor ÷ 8.",
  },
];

type TipoFalta = { tipo_id: string; nombre: string; puntos: number | null; resta_de: "puntualidad" | "magia" };

export function ConfigRankingView({
  config,
  onGuardado,
}: {
  config: RankingConfig;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const vendeRopa = tienda.vende_ropa !== false;
  const [draft, setDraft] = useState<RankingConfig>(config);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tipos, setTipos] = useState<TipoFalta[]>([]);

  useEffect(() => {
    let vivo = true;
    supabase
      .from("faltas_config")
      .select("tipo_id, nombre, puntos, resta_de")
      .order("posicion")
      .then(({ data }) => {
        if (vivo) setTipos((data as TipoFalta[] | null) ?? []);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const totalPesos = CAMPOS.reduce((a, c) => a + (draft[c.key] ?? 0), 0);
  const rv = repartoVentas(draft, vendeRopa);
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v) || 0));

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
    const { error } = await supabase.from("ranking_config").upsert({ id: true, ...draft, peso_maximizador: 0 });
    setGuardando(false);
    if (error) {
      setMsg(`❌ ${error.message}`);
      return;
    }
    setMsg("✓ Guardado. El ranking ya usa esta configuración.");
    onGuardado();
  }

  const fila = "flex items-center gap-3";
  const numero = inputCls + " w-20 text-right";
  return (
    <div className="bg-panel border border-line rounded-[10px] p-4 max-w-2xl">
      <h4 className="text-sm font-semibold mb-1">Cómo se calcula el ranking</h4>
      <p className="text-[12.5px] text-muted mb-4">
        Cada componente se califica de 0 a 100 (100 = meta cumplida) y pesa su parte del total; lo que aún no tiene datos no
        suma ni resta. El Maximizador ya no cuenta en el puntaje. Vienen con valores por defecto en cada tienda y los puedes
        ajustar.
      </p>
      <div className="space-y-3">
        {CAMPOS.map((c) => (
          <label key={c.key} className={fila}>
            <div className="flex-1">
              <div className="text-[13px] font-semibold">{c.label}</div>
              <div className="text-[11.5px] text-muted">{c.ayuda}</div>
            </div>
            <input
              type="number"
              min={0}
              value={draft[c.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [c.key]: Math.max(0, Number(e.target.value) || 0) }))}
              className={numero}
            />
          </label>
        ))}

        <div className="border-t border-line pt-3">
          <div className="text-[13px] font-semibold">Reparto de ventas</div>
          <div className="text-[11.5px] text-muted mb-2">
            Ahora: {Math.round(rv.pesos * 100)} % pesos y {Math.round(rv.unidades * 100)} % unidades; las unidades, pares{" "}
            {Math.round(rv.pares * 100)} % · accesorios {Math.round(rv.acc * 100)} %
            {vendeRopa ? ` · ropa ${Math.round(rv.ropa * 100)} %` : " (la tienda no vende ropa)"}. Deja vacío para usar el valor por
            defecto.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
            <label>
              % en pesos
              <input
                type="number"
                min={0}
                max={100}
                value={draft.reparto_pesos}
                onChange={(e) => setDraft((d) => ({ ...d, reparto_pesos: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
                className={numero + " block mt-1"}
              />
            </label>
            {(
              [
                ["reparto_pares", "Pares", 40],
                ["reparto_acc", "Accesorios", vendeRopa ? 30 : 60],
                ...(vendeRopa ? ([["reparto_ropa", "Ropa", 30]] as const) : []),
              ] as const
            ).map(([k, label, def]) => (
              <label key={k}>
                {label}
                <input
                  type="number"
                  min={0}
                  placeholder={String(def)}
                  value={draft[k] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: num(e.target.value) }))}
                  className={numero + " block mt-1"}
                />
              </label>
            ))}
          </div>
        </div>

        {tipos.length > 0 && (
          <div className="border-t border-line pt-3">
            <div className="text-[13px] font-semibold">Puntos que resta cada registro de Feedbacks</div>
            <div className="text-[11.5px] text-muted mb-2">
              Si la falta se repite en 4 meses: la 2.ª vez resta ×1,5 y de la 3.ª en adelante ×2. Deja vacío para usar el valor de
              la compañía.
            </div>
            <div className="space-y-1.5">
              {tipos.map((t) => (
                <label key={t.tipo_id} className={fila + " text-[12.5px]"}>
                  <span className="flex-1">
                    {t.nombre}{" "}
                    <span className="text-[11px] text-muted">(resta de {t.resta_de === "magia" ? "Magia" : "puntualidad"})</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    placeholder={t.puntos != null ? String(t.puntos) : "20"}
                    value={draft.puntos_faltas?.[t.tipo_id] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => {
                        const pf = { ...(d.puntos_faltas ?? {}) };
                        const v = num(e.target.value);
                        if (v == null) delete pf[t.tipo_id];
                        else pf[t.tipo_id] = v;
                        return { ...d, puntos_faltas: pf };
                      })
                    }
                    className={numero}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <label className={fila + " border-t border-line pt-3"}>
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
            className={numero}
          />
        </label>
        <label className={fila}>
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
            className={numero}
          />
        </label>
        <label className={fila + " border-t border-line pt-3"}>
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
            className={numero}
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
