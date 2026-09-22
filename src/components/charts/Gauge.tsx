"use client";

import { estiloCumplimiento, nivelCumplimiento } from "@/lib/cumplimiento";
import { useCountUp, useMountedAnimado } from "./hooks";

/**
 * Gauge circular animado de cumplimiento (venta/meta). Arranca en 0% y se
 * "llena" hacia el valor real al montar, con el número central contando
 * hacia arriba en paralelo — pensado para ser el elemento que capture la
 * atención en /mi-presupuesto y en la presentación del MVP.
 *
 * pct=null → estado neutro "sin datos" (aro gris, sin animación de conteo).
 */
export function Gauge({
  pct,
  size = 132,
  strokeWidth = 12,
  label,
  sublabel,
}: {
  pct: number | null;
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
}) {
  const animado = useMountedAnimado();
  const estilo = estiloCumplimiento(pct);
  const nivel = nivelCumplimiento(pct);

  const pctClamped = pct != null ? Math.max(0, Math.min(1, pct)) : 0;
  const pctMostrado = useCountUp(pct != null ? (animado ? pct * 100 : 0) : 0, 1100);

  const r = (size - strokeWidth) / 2;
  const circunferencia = 2 * Math.PI * r;
  const offset = circunferencia * (1 - (animado ? pctClamped : 0));

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size }}>
      {nivel === "alto" && (
        <div
          className="absolute inset-0 rounded-full blur-xl opacity-30 pointer-events-none"
          style={{ background: estilo.hex }}
          aria-hidden
        />
      )}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#E7E9E4"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={estilo.hex}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {pct == null ? (
          <span className="text-muted text-lg font-display font-semibold">—</span>
        ) : (
          <span
            className="font-display font-bold tabular-nums"
            style={{ fontSize: size * 0.22, color: estilo.hex }}
          >
            {Math.round(pctMostrado)}%
          </span>
        )}
        {nivel === "alto" && (
          <span className="absolute -top-1 -right-1 text-base animate-pulse" aria-hidden>
            {estilo.emoji}
          </span>
        )}
      </div>
      {(label || sublabel) && (
        <div className="text-center mt-2">
          {label && <div className="text-[11px] font-semibold text-ink">{label}</div>}
          {sublabel && <div className="text-[10px] text-muted">{sublabel}</div>}
        </div>
      )}
    </div>
  );
}
