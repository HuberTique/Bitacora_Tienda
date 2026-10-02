// Lector de reglas de horarios: convierte lo que la IA leyó de un correo de la
// DSM en una propuesta que jefatura revisa antes de guardar. Aquí no se llama a
// la IA ni a la base: solo se compara la lectura con lo que ya está
// configurado, para mostrar únicamente lo que cambiaría.

import type { ConfigHorarios } from "./horarios";
import type { Frecuencia } from "./recurrentes";

/** Lo que devuelve la Edge Function `leer-reglas-horario`. */
export type LecturaReglas = {
  resumen?: string;
  parametros?: {
    pt_dias_semana?: number | null;
    ft_dias_turno_largo?: number | null;
    ft_descansos_semana?: number | null;
    ft_domingos_descanso?: number | null;
    ft_cortos_lun_jue?: boolean | null;
    jefe_cierre_quincena?: boolean | null;
  };
  festivos?: { fecha?: string; nombre?: string }[];
  tareas?: {
    titulo?: string;
    descripcion?: string;
    frecuencia?: string;
    dias_semana?: number[];
    dia_mes?: number | null;
  }[];
  otras_reglas?: string[];
  truncado?: boolean;
};

export type CambioParametro = {
  clave: keyof ConfigHorarios;
  etiqueta: string;
  actual: string;
  propuesto: string;
  valor: number | boolean;
  incluir: boolean;
};

export type FestivoPropuesto = { fecha: string; nombre: string; incluir: boolean };

export type TareaPropuesta = {
  titulo: string;
  descripcion: string;
  frecuencia: Frecuencia;
  dias_semana: number[];
  dia_mes: number | null;
  incluir: boolean;
};

export type PropuestaReglas = {
  resumen: string;
  cambios: CambioParametro[];
  /** Reglas del correo que ya coinciden con lo configurado (solo informativo). */
  yaCoinciden: string[];
  festivos: FestivoPropuesto[];
  festivosYaRegistrados: string[];
  tareas: TareaPropuesta[];
  otrasReglas: string[];
  truncado: boolean;
};

type DefNumero = { clave: "ptDiasSemana" | "ftDiasTurnoLargo" | "ftDescansosSemana" | "ftDomingosDescanso"; campo: keyof NonNullable<LecturaReglas["parametros"]>; etiqueta: string; min: number; max: number };
type DefBool = { clave: "ftCortosLunJue" | "jefeCierreQuincena"; campo: keyof NonNullable<LecturaReglas["parametros"]>; etiqueta: string };

const NUMEROS: DefNumero[] = [
  { clave: "ptDiasSemana", campo: "pt_dias_semana", etiqueta: "Part-time: días por semana", min: 1, max: 7 },
  { clave: "ftDiasTurnoLargo", campo: "ft_dias_turno_largo", etiqueta: "FT: días de turno largo (10h de turno) por semana", min: 0, max: 6 },
  { clave: "ftDescansosSemana", campo: "ft_descansos_semana", etiqueta: "FT: días de descanso por semana", min: 1, max: 3 },
  { clave: "ftDomingosDescanso", campo: "ft_domingos_descanso", etiqueta: "FT: domingos de descanso al mes", min: 0, max: 2 },
];
const BOOLEANOS: DefBool[] = [
  { clave: "ftCortosLunJue", campo: "ft_cortos_lun_jue", etiqueta: "Días cortos de lunes a jueves (turno largo de viernes a domingo, como preferencia)" },
  { clave: "jefeCierreQuincena", campo: "jefe_cierre_quincena", etiqueta: "Jefe de tienda a cierre los fines de semana de quincena" },
];

const siNo = (b: boolean) => (b ? "Sí" : "No");
const FRECUENCIAS: Frecuencia[] = ["diaria", "semanal", "mensual"];

export function propuestaDesdeLectura(
  lectura: LecturaReglas,
  ctx: { config: ConfigHorarios; festivosRegistrados: string[] },
): PropuestaReglas {
  const p = lectura.parametros ?? {};
  const cambios: CambioParametro[] = [];
  const yaCoinciden: string[] = [];

  for (const def of NUMEROS) {
    const v = p[def.campo];
    if (typeof v !== "number" || !Number.isInteger(v) || v < def.min || v > def.max) continue;
    const actual = ctx.config[def.clave];
    if (v === actual) yaCoinciden.push(`${def.etiqueta}: ${v}`);
    else cambios.push({ clave: def.clave, etiqueta: def.etiqueta, actual: String(actual), propuesto: String(v), valor: v, incluir: true });
  }
  for (const def of BOOLEANOS) {
    const v = p[def.campo];
    if (typeof v !== "boolean") continue;
    const actual = ctx.config[def.clave];
    if (v === actual) yaCoinciden.push(`${def.etiqueta}: ${siNo(v)}`);
    else cambios.push({ clave: def.clave, etiqueta: def.etiqueta, actual: siNo(actual), propuesto: siNo(v), valor: v, incluir: true });
  }

  const registrados = new Set(ctx.festivosRegistrados);
  const vistos = new Set<string>();
  const festivos: FestivoPropuesto[] = [];
  const festivosYaRegistrados: string[] = [];
  for (const f of lectura.festivos ?? []) {
    const fecha = String(f?.fecha ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha + "T12:00:00Z")) || vistos.has(fecha)) continue;
    vistos.add(fecha);
    if (registrados.has(fecha)) festivosYaRegistrados.push(fecha);
    else festivos.push({ fecha, nombre: String(f?.nombre ?? "").trim().slice(0, 80) || "Festivo", incluir: true });
  }
  festivos.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const tareas: TareaPropuesta[] = [];
  for (const t of lectura.tareas ?? []) {
    const titulo = String(t?.titulo ?? "").trim().slice(0, 160);
    const frecuencia = FRECUENCIAS.find((f) => f === t?.frecuencia);
    if (!titulo || !frecuencia) continue;
    const dias = [...new Set((t?.dias_semana ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    const diaMes = typeof t?.dia_mes === "number" && t.dia_mes >= 1 && t.dia_mes <= 31 ? Math.round(t.dia_mes) : null;
    if (frecuencia === "semanal" && dias.length === 0) continue;
    if (frecuencia === "mensual" && diaMes === null) continue;
    tareas.push({
      titulo,
      descripcion: String(t?.descripcion ?? "").trim().slice(0, 1200),
      frecuencia,
      dias_semana: frecuencia === "semanal" ? dias : [],
      dia_mes: frecuencia === "mensual" ? diaMes : null,
      incluir: true,
    });
  }

  return {
    resumen: String(lectura.resumen ?? "").trim(),
    cambios,
    yaCoinciden,
    festivos,
    festivosYaRegistrados,
    tareas,
    otrasReglas: (lectura.otras_reglas ?? []).map((r) => String(r ?? "").trim()).filter(Boolean),
    truncado: !!lectura.truncado,
  };
}

/** Configuración resultante de aplicar los cambios marcados. */
export function aplicarCambios(config: ConfigHorarios, cambios: CambioParametro[]): ConfigHorarios {
  const nueva = { ...config } as Record<keyof ConfigHorarios, number | boolean>;
  for (const c of cambios) if (c.incluir) nueva[c.clave] = c.valor;
  return nueva as unknown as ConfigHorarios;
}

/** Por qué una configuración no se puede guardar; null si es válida. */
export function problemaConfig(c: ConfigHorarios): string | null {
  if (c.ftDiasTurnoLargo > 7 - c.ftDescansosSemana) {
    return "Los días de turno largo no pueden superar los días trabajados por semana.";
  }
  return null;
}
