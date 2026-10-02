// Tareas recurrentes de la Bitácora (ej. "verificar caja menor todos los
// lunes"): cuándo le toca a cada una. Lógica pura, sin React ni Supabase.
//
// La misma regla vive en la base, en generar_pendientes_recurrentes(), que es
// la que crea el pendiente del día; aquí se usa para mostrar el calendario,
// la próxima fecha y el texto de la repetición. Si se cambia una, hay que
// cambiar la otra.

import type { AreaId, Turno } from "./types";

export type Frecuencia = "diaria" | "semanal" | "mensual";

export type TareaRecurrente = {
  id: string;
  titulo: string;
  area: AreaId;
  turno: Turno;
  descripcion: string;
  responsable_id: string;
  asesor_id: string | null;
  frecuencia: Frecuencia;
  dias_semana: number[]; // semanal: 0=domingo .. 6=sábado
  dia_mes: number | null; // mensual: 1..31 (si el mes es más corto, el último día)
  hora: string | null; // "HH:MM:SS" o null
  fecha_inicio: string; // YYYY-MM-DD
  fecha_fin: string | null;
  activa: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** Lo que define cuándo se repite una tarea (para poder probarlo sin la fila completa). */
export type Repeticion = Pick<
  TareaRecurrente,
  "frecuencia" | "dias_semana" | "dia_mes" | "fecha_inicio" | "fecha_fin" | "activa"
>;

export const DIAS_SEMANA: { n: number; corto: string; largo: string }[] = [
  { n: 1, corto: "L", largo: "lunes" },
  { n: 2, corto: "M", largo: "martes" },
  { n: 3, corto: "X", largo: "miércoles" },
  { n: 4, corto: "J", largo: "jueves" },
  { n: 5, corto: "V", largo: "viernes" },
  { n: 6, corto: "S", largo: "sábado" },
  { n: 0, corto: "D", largo: "domingo" },
];

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDe(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fecha local a partir de YYYY-MM-DD (sin corrimientos por zona horaria). */
export function fechaDe(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

const ultimoDiaDelMes = (anio: number, mes1a12: number) => new Date(anio, mes1a12, 0).getDate();

/** ¿A esta tarea le toca en la fecha dada? */
export function ocurreEn(t: Repeticion, iso: string): boolean {
  if (!t.activa) return false;
  if (iso < t.fecha_inicio) return false;
  if (t.fecha_fin && iso > t.fecha_fin) return false;
  const d = fechaDe(iso);
  if (t.frecuencia === "diaria") return true;
  if (t.frecuencia === "semanal") return t.dias_semana.includes(d.getDay());
  // Mensual: un "día 31" en un mes de 30 cae el 30; en febrero, el último día.
  if (t.dia_mes == null) return false;
  return d.getDate() === Math.min(t.dia_mes, ultimoDiaDelMes(d.getFullYear(), d.getMonth() + 1));
}

/** Próxima fecha en que toca, desde `desdeIso` inclusive; null si ya no vuelve a tocar. */
export function proximaOcurrencia(t: Repeticion, desdeIso: string): string | null {
  const d = fechaDe(desdeIso < t.fecha_inicio ? t.fecha_inicio : desdeIso);
  // Un año cubre cualquier repetición mensual, incluso el día 31.
  for (let i = 0; i < 370; i++) {
    const iso = isoDe(d);
    if (t.fecha_fin && iso > t.fecha_fin) return null;
    if (ocurreEn(t, iso)) return iso;
    d.setDate(d.getDate() + 1);
  }
  return null;
}

/** Todas las tareas que tocan cada día de un mes: { "2026-10-05": [tarea, …], … }. */
export function ocurrenciasDelMes<T extends Repeticion>(tareas: T[], anio: number, mes1a12: number): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  const dias = ultimoDiaDelMes(anio, mes1a12);
  for (let dia = 1; dia <= dias; dia++) {
    const iso = `${anio}-${pad(mes1a12)}-${pad(dia)}`;
    const delDia = tareas.filter((t) => ocurreEn(t, iso));
    if (delDia.length > 0) mapa.set(iso, delDia);
  }
  return mapa;
}

/** "09:30:00" → "9:30 a. m." */
export function horaLegible(hora: string | null): string {
  if (!hora) return "";
  const [h, m] = hora.split(":").map(Number);
  const sufijo = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${sufijo}`;
}

/** Texto de la repetición: "Todos los lunes", "Lunes, miércoles y viernes", "El día 15 de cada mes"… */
export function describirRepeticion(t: Pick<TareaRecurrente, "frecuencia" | "dias_semana" | "dia_mes" | "hora">): string {
  let base: string;
  if (t.frecuencia === "diaria") {
    base = "Todos los días";
  } else if (t.frecuencia === "semanal") {
    const dias = DIAS_SEMANA.filter((d) => t.dias_semana.includes(d.n)).map((d) => d.largo);
    if (dias.length === 0) base = "Semanal (sin días)";
    else if (dias.length === 7) base = "Todos los días";
    else if (dias.length === 1) base = `Todos los ${dias[0] === "sábado" || dias[0] === "domingo" ? dias[0] + "s" : dias[0]}`;
    else base = `Cada ${dias.slice(0, -1).join(", ")} y ${dias[dias.length - 1]}`;
  } else {
    base = t.dia_mes == null ? "Mensual" : t.dia_mes >= 29 ? `El día ${t.dia_mes} de cada mes (o el último)` : `El día ${t.dia_mes} de cada mes`;
  }
  return t.hora ? `${base}, ${horaLegible(t.hora)}` : base;
}

/** Revisa lo mínimo antes de guardar; devuelve el problema o null. */
export function problemaRepeticion(t: Pick<TareaRecurrente, "frecuencia" | "dias_semana" | "dia_mes" | "fecha_inicio" | "fecha_fin">): string | null {
  if (t.frecuencia === "semanal" && t.dias_semana.length === 0) return "Elige al menos un día de la semana.";
  if (t.frecuencia === "mensual" && (t.dia_mes == null || t.dia_mes < 1 || t.dia_mes > 31)) return "Elige el día del mes (1 a 31).";
  if (!t.fecha_inicio) return "Elige desde cuándo empieza.";
  if (t.fecha_fin && t.fecha_fin < t.fecha_inicio) return "La fecha de fin no puede ser anterior al inicio.";
  return null;
}
