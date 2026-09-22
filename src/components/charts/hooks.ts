"use client";

import { useEffect, useRef, useState } from "react";

/**
 * true en el primer render, pasa a false un tick después de montar (vía
 * requestAnimationFrame). Los gráficos lo usan para arrancar en su estado
 * "vacío" (0%, barras en 0) y animar hacia el valor real — el efecto visual
 * de "llenado" que hace que los números se sientan vivos en vez de estáticos.
 */
export function useMountedAnimado(): boolean {
  const [animado, setAnimado] = useState(false);
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setAnimado(true));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, []);
  return animado;
}

/**
 * Anima un número desde 0 hasta `target` en `durationMs`, con easing suave.
 * Se re-dispara cuando cambia `target`. Usado para los porcentajes grandes
 * de los gauges — un conteo ascendente llama mucho más la atención que un
 * número que simplemente aparece.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [valor, setValor] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const inicio = performance.now();
    const desde = 0;

    function tick(ahora: number) {
      const t = Math.min(1, (ahora - inicio) / durationMs);
      // easeOutCubic — arranca rápido, desacelera al llegar
      const eased = 1 - Math.pow(1 - t, 3);
      setValor(desde + (target - desde) * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return valor;
}
