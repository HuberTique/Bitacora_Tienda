"use client";

import { estiloCumplimiento, fmtMoneyCompacto } from "@/lib/cumplimiento";
import { fmtMoney } from "@/lib/types";
import { useMountedAnimado } from "./hooks";

export type DiaBarra = {
  key: string;        // fecha YYYY-MM-DD
  labelCorto: string;  // "L 15"
  meta: number;
  venta: number | null;
  cumplimiento: number | null;
  esHoy?: boolean;
};

/**
 * Barras animadas meta-vs-venta por día. La meta se dibuja como línea
 * punteada de referencia; la venta es la barra sólida, coloreada por
 * cumplimiento de ESE día. Días sin cierre registrado quedan como barra
 * fantasma (contorno) hasta la altura de la meta. Pensado para /mi-presupuesto
 * (semana en curso) — el tipo de gráfico que un asesor entiende de un
 * vistazo: "¿la barra llega a la línea o no?".
 */
export function BarrasSemana({ dias }: { dias: DiaBarra[] }) {
  const animado = useMountedAnimado();
  const maxValor = Math.max(1, ...dias.map((d) => Math.max(d.meta, d.venta ?? 0)));
  const ALTO = 120;

  return (
    <div className="flex items-end justify-between gap-2 px-1" style={{ height: ALTO + 44 }}>
      {dias.map((d, i) => {
        const estilo = estiloCumplimiento(d.cumplimiento);
        const altoMeta = (d.meta / maxValor) * ALTO;
        const altoVenta = d.venta != null ? (d.venta / maxValor) * ALTO : 0;
        const sinCierre = d.venta == null;

        return (
          <div
            key={d.key}
            className="flex-1 flex flex-col items-center group"
            title={
              sinCierre
                ? `${d.labelCorto} · meta ${fmtMoney(d.meta)} · sin cierre registrado`
                : `${d.labelCorto} · meta ${fmtMoney(d.meta)} · venta ${fmtMoney(d.venta)} · ${Math.round((d.cumplimiento ?? 0) * 100)}%`
            }
          >
            <div className="relative w-full flex items-end justify-center" style={{ height: ALTO }}>
              {/* Línea punteada de meta */}
              {d.meta > 0 && (
                <div
                  className="absolute left-0 right-0 border-t-2 border-dashed border-ink/25"
                  style={{ bottom: animado ? altoMeta : 0, transition: "bottom 0.8s ease-out" }}
                />
              )}
              {sinCierre ? (
                // Barra fantasma: contorno hasta la meta, sin relleno
                d.meta > 0 && (
                  <div
                    className="w-[60%] rounded-t-md border-2 border-dashed border-line bg-transparent transition-[height] duration-700 ease-out group-hover:scale-105"
                    style={{
                      height: animado ? altoMeta : 0,
                      transitionDelay: `${i * 60}ms`,
                    }}
                  />
                )
              ) : (
                <div
                  className="w-[60%] rounded-t-md transition-[height] duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
                  style={{
                    height: animado ? Math.max(altoVenta, 2) : 0,
                    backgroundColor: estilo.hex,
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
              )}
            </div>
            <div className={"text-[10px] mt-1.5 " + (d.esHoy ? "font-bold text-brand" : "text-muted")}>
              {d.labelCorto}
            </div>
            <div className="text-[9px] font-mono text-muted">
              {sinCierre ? "" : fmtMoneyCompacto(d.venta)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
