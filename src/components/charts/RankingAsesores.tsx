"use client";

import { estiloCumplimiento, fmtMoneyCompacto } from "@/lib/cumplimiento";
import { useMountedAnimado } from "./hooks";

const MEDALLAS = ["🥇", "🥈", "🥉"];

export type RankingItem = {
  personaId: string;
  nombre: string;
  cumplimiento: number | null;
  venta: number;
  meta: number;
};

/**
 * Ranking animado de cumplimiento del mes. Barras horizontales que crecen
 * al montar, con medalla en los primeros 3 puestos — la pieza central para
 * "llamar la atención" del equipo en la vista de jefatura y en la demo del
 * MVP. Espera `items` ya ordenados (usar rankingCumplimiento de presupuestos-calc).
 */
export function RankingAsesores({ items }: { items: RankingItem[] }) {
  const animado = useMountedAnimado();
  // Sin metas no hay cumplimiento: las barras muestran la venta relativa al mejor.
  const modoVenta = items.length > 0 && items.every((it) => it.cumplimiento == null) && items.some((it) => it.venta > 0);
  const maxVenta = Math.max(0, ...items.map((it) => it.venta));

  if (items.length === 0) {
    return <div className="text-center py-6 text-muted text-sm">Sin datos todavía.</div>;
  }

  return (
    <div className="space-y-2.5">
      {items.map((it, i) => {
        const estilo = modoVenta
          ? { hex: "#2F4A7A", text: "text-ink", bg: "", border: "", emoji: "" }
          : estiloCumplimiento(it.cumplimiento);
        const anchoFill = modoVenta
          ? maxVenta > 0
            ? (it.venta / maxVenta) * 100
            : 0
          : it.cumplimiento != null
            ? Math.min(1, it.cumplimiento) * 100
            : 0;
        const sinDato = modoVenta ? it.venta <= 0 : it.cumplimiento == null;

        return (
          <div key={it.personaId} className="flex items-center gap-2.5">
            <div className="w-6 text-center text-sm shrink-0" aria-hidden>
              {i < 3 && !sinDato ? MEDALLAS[i] : (
                <span className="text-[10px] text-muted font-mono">{i + 1}</span>
              )}
            </div>
            <div className="w-[120px] shrink-0 text-[12.5px] truncate" title={it.nombre}>
              {it.nombre}
            </div>
            <div className="flex-1 relative h-6 rounded-full bg-neutral-100/70 overflow-hidden">
              {!sinDato && (
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] ease-out"
                  style={{
                    width: animado ? `${anchoFill}%` : "0%",
                    backgroundColor: estilo.hex,
                    transitionDuration: "900ms",
                    transitionDelay: `${i * 70}ms`,
                  }}
                />
              )}
              {/* Marca de 100% como referencia visual */}
              <div className="absolute inset-y-0 left-full w-px bg-ink/10" style={{ left: "100%" }} />
            </div>
            <div
              className={
                "w-14 shrink-0 text-right text-[12px] font-mono font-semibold tabular-nums " +
                (sinDato ? "text-muted" : estilo.text)
              }
            >
              {sinDato ? "—" : modoVenta ? fmtMoneyCompacto(it.venta) : `${Math.round(it.cumplimiento! * 100)}%`}
            </div>
            <div className="w-16 shrink-0 text-right text-[10px] text-muted font-mono hidden sm:block">
              {sinDato || modoVenta ? "" : fmtMoneyCompacto(it.venta)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
