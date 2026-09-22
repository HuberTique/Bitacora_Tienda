// Escala de color única para "cumplimiento" (venta / meta) en toda la app.
// Reusa los tokens de la paleta (globals.css) en vez de inventar hex nuevos:
//   operaciones (verde) = cumpliendo o por encima de meta
//   ventas (ámbar)      = cerca pero por debajo
//   warn (rojo)         = lejos de la meta
//   line/muted (gris)   = sin dato de venta todavía (día futuro o no cerrado)

export type NivelCumplimiento = "alto" | "medio" | "bajo" | "sin_dato";

export function nivelCumplimiento(pct: number | null | undefined): NivelCumplimiento {
  if (pct == null || !isFinite(pct)) return "sin_dato";
  if (pct >= 1) return "alto";
  if (pct >= 0.8) return "medio";
  return "bajo";
}

export type EstiloCumplimiento = {
  hex: string;       // color sólido — para SVG (stroke/fill)
  bg: string;        // clase tailwind de fondo suave
  text: string;       // clase tailwind de texto
  border: string;     // clase tailwind de borde
  emoji: string;      // acento visual para destacar en UI
};

export const ESTILO_CUMPLIMIENTO: Record<NivelCumplimiento, EstiloCumplimiento> = {
  alto: {
    hex: "#1F8A70",
    bg: "bg-operaciones/10",
    text: "text-operaciones",
    border: "border-operaciones/40",
    emoji: "🔥",
  },
  medio: {
    hex: "#D98A2B",
    bg: "bg-ventas/10",
    text: "text-ventas",
    border: "border-ventas/40",
    emoji: "⚡",
  },
  bajo: {
    hex: "#B4472A",
    bg: "bg-warn-soft",
    text: "text-warn",
    border: "border-warn-border",
    emoji: "📉",
  },
  sin_dato: {
    hex: "#B7BDC6",
    bg: "bg-neutral-100/60",
    text: "text-muted",
    border: "border-line",
    emoji: "",
  },
};

export function estiloCumplimiento(pct: number | null | undefined): EstiloCumplimiento {
  return ESTILO_CUMPLIMIENTO[nivelCumplimiento(pct)];
}

/** Formatea un monto grande de forma compacta para caber en celdas chicas: $1.2M / $850K. */
export function fmtMoneyCompacto(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  return "$" + Math.round(v / 1000) + "K";
}
