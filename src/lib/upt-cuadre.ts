// UPT: manda el de Xstore (columna Artículos de "Productividad de empleado"),
// pero se coteja con unidades de la consolidada ÷ TRX, que es como lo calcula el
// Excel de la tienda (Huber, 8-oct-2026). Solo se comparan si las dos cargas
// llegan a la MISMA fecha de corte; si difieren en más de 0,1 se avisa.

export const TOLERANCIA_UPT = 0.1;

/** Unidades ÷ TRX, o null si falta alguno. */
export function uptCalculado(unidades: number | null | undefined, trx: number | null | undefined): number | null {
  return unidades != null && trx != null && trx > 0 ? unidades / trx : null;
}

/** El UPT calculado si NO cuadra con el de Xstore; null si cuadra o no se puede comparar. */
export function uptQueNoCuadra(
  uptXstore: number | null | undefined,
  unidades: number | null | undefined,
  trx: number | null | undefined,
): number | null {
  const calc = uptCalculado(unidades, trx);
  if (calc == null || uptXstore == null) return null;
  return Math.abs(calc - uptXstore) > TOLERANCIA_UPT ? calc : null;
}

/** Texto cuando los cortes no coinciden y por eso no se compara. */
export function textoCortesDistintos(corteConsolidada: string, corteXstore: string): string {
  return `No se coteja el UPT con unidades ÷ TRX: la consolidada llega hasta el ${corteConsolidada} y Xstore hasta el ${corteXstore}. Sube los dos con la misma fecha de corte para compararlos.`;
}
