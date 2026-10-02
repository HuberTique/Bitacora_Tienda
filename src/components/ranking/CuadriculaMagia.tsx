"use client";

import { COLOR_CUADRANTE, type NivelMagia } from "@/lib/magia";

export type PuntoCuadricula = {
  casilla: NivelMagia;
  /** Texto corto bajo la figura (ej. "Eval 1" o "sep26-1"). */
  etiqueta: string;
  /** Detalle que se ve al pasar el cursor. */
  detalle?: string;
};

// Lienzo fijo; el SVG se escala al ancho disponible.
const ANCHO = 320;
const ALTO = 240;
const CX = ANCHO / 2;
const CY = ALTO / 2;
const MAX_POR_CASILLA = 9;

// Igual que la plantilla impresa: 3 arriba-izquierda, 4 arriba-derecha,
// 1 abajo-izquierda, 2 abajo-derecha.
const ZONA: Record<NivelMagia, { x: number; y: number }> = {
  3: { x: 0, y: 0 },
  4: { x: CX, y: 0 },
  1: { x: 0, y: CY },
  2: { x: CX, y: CY },
};

function estrella(cx: number, cy: number, R: number): string {
  const r = R * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + Math.cos(ang) * rad).toFixed(1)},${(cy + Math.sin(ang) * rad).toFixed(1)}`);
  }
  return pts.join(" ");
}

/**
 * Cuadrícula Gestión / Resultados de "Magia con una sonrisa". Cada punto se
 * dibuja en la casilla (1 a 4) que le corresponde por su promedio; la casilla
 * 4 usa una estrella, como en el formato impreso.
 */
export function CuadriculaMagia({ puntos, className = "" }: { puntos: PuntoCuadricula[]; className?: string }) {
  const porCasilla = ([1, 2, 3, 4] as NivelMagia[]).map((n) => ({
    n,
    lista: puntos.filter((p) => p.casilla === n),
  }));

  return (
    <div className={"border border-line rounded-md bg-white p-2 text-ink " + className}>
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="w-full h-auto block"
        role="img"
        aria-label={
          "Cuadrícula Gestión y Resultados. " +
          porCasilla
            .filter((c) => c.lista.length > 0)
            .map((c) => `Casilla ${c.n}: ${c.lista.map((p) => p.etiqueta).join(", ")}`)
            .join(". ")
        }
      >
        {/* Casillas con al menos un punto, resaltadas */}
        {porCasilla.map(
          ({ n, lista }) =>
            lista.length > 0 && (
              <rect
                key={`fondo-${n}`}
                x={ZONA[n].x}
                y={ZONA[n].y}
                width={CX}
                height={CY}
                fill={COLOR_CUADRANTE[n]}
                fillOpacity={0.12}
              />
            ),
        )}

        {/* Ejes */}
        <line x1={CX} y1={10} x2={CX} y2={ALTO - 10} stroke="currentColor" strokeWidth={2} />
        <line x1={10} y1={CY} x2={ANCHO - 10} y2={CY} stroke="currentColor" strokeWidth={2} />
        <text x={CX + 6} y={20} fontSize={9} fontWeight={700} fill="currentColor">
          Gestión
        </text>
        <text x={CX - 9} y={22} fontSize={13} fontWeight={700} textAnchor="middle" fill="currentColor" opacity={0.55}>
          +
        </text>
        <text x={CX - 9} y={ALTO - 14} fontSize={13} fontWeight={700} textAnchor="middle" fill="currentColor" opacity={0.55}>
          −
        </text>
        <text x={ANCHO - 30} y={CY + 13} fontSize={9} fontWeight={700} textAnchor="end" fill="currentColor">
          Resultados
        </text>
        <text x={ANCHO - 19} y={CY - 5} fontSize={13} fontWeight={700} textAnchor="middle" fill="currentColor" opacity={0.55}>
          +
        </text>
        <text x={19} y={CY - 5} fontSize={13} fontWeight={700} textAnchor="middle" fill="currentColor" opacity={0.55}>
          −
        </text>

        {/* Número de cada casilla en su esquina exterior */}
        {porCasilla.map(({ n, lista }) => {
          const lado = 18;
          const x = ZONA[n].x === 0 ? 6 : ANCHO - 6 - lado;
          const y = ZONA[n].y === 0 ? 6 : ALTO - 6 - lado;
          const activo = lista.length > 0;
          return (
            <g key={`num-${n}`}>
              <rect
                x={x}
                y={y}
                width={lado}
                height={lado}
                rx={2}
                fill={activo ? COLOR_CUADRANTE[n] : "none"}
                stroke={COLOR_CUADRANTE[n]}
                strokeWidth={1.2}
              />
              <text
                x={x + lado / 2}
                y={y + 13}
                fontSize={11}
                fontWeight={700}
                textAnchor="middle"
                fill={activo ? "#fff" : COLOR_CUADRANTE[n]}
              >
                {n}
              </text>
            </g>
          );
        })}

        {/* Puntos: se reparten en filas de tres, centrados en su casilla */}
        {porCasilla.map(({ n, lista }) => {
          const visibles = lista.slice(0, MAX_POR_CASILLA);
          const ocultos = lista.length - visibles.length;
          const cols = Math.min(visibles.length, 3);
          const filas = Math.ceil(visibles.length / 3);
          const x0 = ZONA[n].x + CX / 2 - ((cols - 1) * 40) / 2;
          const y0 = ZONA[n].y + 58 - ((filas - 1) * 30) / 2;
          return (
            <g key={`pts-${n}`}>
              {visibles.map((p, i) => {
                const px = x0 + (i % 3) * 40;
                const py = y0 + Math.floor(i / 3) * 30;
                return (
                  <g key={i}>
                    <title>{p.detalle ?? p.etiqueta}</title>
                    {n === 4 ? (
                      <polygon points={estrella(px, py - 1, 11)} fill={COLOR_CUADRANTE[n]} />
                    ) : (
                      <circle cx={px} cy={py} r={8} fill={COLOR_CUADRANTE[n]} stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} />
                    )}
                    <text x={px} y={py + 19} fontSize={7.5} textAnchor="middle" fill="currentColor" opacity={0.8}>
                      {p.etiqueta}
                    </text>
                  </g>
                );
              })}
              {ocultos > 0 && (
                <text
                  x={ZONA[n].x + CX / 2}
                  y={ZONA[n].y + CY - 6}
                  fontSize={7.5}
                  textAnchor="middle"
                  fill="currentColor"
                  opacity={0.7}
                >
                  +{ocultos} más
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
