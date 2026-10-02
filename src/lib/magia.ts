// "Magia con una sonrisa": textos de cada formato de tienda (Concept / Outlet),
// promedio de una evaluación y casilla que le corresponde en la cuadrícula
// Gestión / Resultados. Lógica pura, sin React ni Supabase, para poder probarla.

import { MAGIA_PUNTOS_MAX, totalMagia, type MagiaEvaluacion } from "./ranking";

export type FormatoTienda = "concept" | "outlet";

export const FORMATOS_TIENDA: { id: FormatoTienda; label: string }[] = [
  { id: "concept", label: "Concept" },
  { id: "outlet", label: "Outlet" },
];

/** Cualquier valor desconocido (o la columna aún sin crear) cae en Concept. */
export function normalizarFormato(v: unknown): FormatoTienda {
  return v === "outlet" ? "outlet" : "concept";
}

export function labelFormato(f: FormatoTienda): string {
  return f === "outlet" ? "Outlet" : "Concept";
}

export type ClaveCriterio = "c_sonrisa" | "c_preguntas" | "c_experiencia" | "c_tecnologias" | "c_cierre";

export type CriterioMagia = { key: ClaveCriterio; letra: string; texto: string };

// Las columnas de la tabla son las mismas para los dos formatos: lo que cambia
// es qué se evalúa en la 2.ª y 3.ª letra (A y G). c_preguntas y c_experiencia
// conservan su nombre original de Concept; en Outlet guardan los criterios de
// reposición y de guía hacia promociones.
const CRITERIOS: Record<FormatoTienda, CriterioMagia[]> = {
  concept: [
    {
      key: "c_sonrisa",
      letra: "M",
      texto: "Muestro una sonrisa con entusiasmo y autenticidad al saludar y recibir al cliente",
    },
    {
      key: "c_preguntas",
      letra: "A",
      texto: "Realizo preguntas abiertas generando compromiso e interacción con el cliente",
    },
    {
      key: "c_experiencia",
      letra: "G",
      texto: "Genero una experiencia excepcional a todos los clientes",
    },
    {
      key: "c_tecnologias",
      letra: "I",
      texto: "Informo a los clientes sobre las tecnologías de comodidad Skechers",
    },
    {
      key: "c_cierre",
      letra: "A",
      texto: "Al cerrar la venta agradezco con una sonrisa y le invito a volver",
    },
  ],
  outlet: [
    {
      key: "c_sonrisa",
      letra: "M",
      texto: "Muestro una sonrisa con entusiasmo y autenticidad al saludar y recibir al cliente",
    },
    {
      key: "c_preguntas",
      letra: "A",
      texto: "Atiendo a las tareas de reposición, etiquetado y limpieza",
    },
    {
      key: "c_experiencia",
      letra: "G",
      texto: "Guío a los clientes hacia los productos y las promociones actuales",
    },
    {
      key: "c_tecnologias",
      letra: "I",
      texto: "Informo a los clientes sobre las tecnologías de comodidad Skechers",
    },
    {
      key: "c_cierre",
      letra: "A",
      texto: "Al cerrar la venta agradezco con una sonrisa y le invito a volver",
    },
  ],
};

export function criteriosMagia(formato: FormatoTienda): CriterioMagia[] {
  return CRITERIOS[formato];
}

export type NivelMagia = 1 | 2 | 3 | 4;

/** La escala es igual en ambos formatos salvo el nombre del nivel 4. */
export function escalaMagia(formato: FormatoTienda): { v: NivelMagia; label: string }[] {
  return [
    { v: 1, label: "Bajo expectativa" },
    { v: 2, label: "Por mejorar" },
    { v: 3, label: "Bueno" },
    { v: 4, label: formato === "outlet" ? "Supera expectativa" : "Cumple expectativa" },
  ];
}

/** Ítems calificados en cada evaluación: las cinco letras + la impresión final. */
export const MAGIA_ITEMS = 6;

type Puntajes = Pick<
  MagiaEvaluacion,
  "c_sonrisa" | "c_preguntas" | "c_experiencia" | "c_tecnologias" | "c_cierre" | "impresion_final"
>;

/** Promedio de una evaluación en la escala 1 a 4: la suma dividida entre los ítems evaluados. */
export function promedioMagia(e: Puntajes): number {
  return totalMagia(e as MagiaEvaluacion) / MAGIA_ITEMS;
}

/** Lleva un total sobre 24 (o un promedio de totales) a la escala 1 a 4. */
export function promedioDesdeTotal(total: number): number {
  return (total / MAGIA_PUNTOS_MAX) * 4;
}

/**
 * Los promedios se manejan con UN decimal: es lo que se muestra, lo que ubica
 * el punto en la cuadrícula y lo que permite ver la tendencia entre una
 * evaluación y la siguiente.
 */
export function redondear1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Casilla de la cuadrícula Gestión / Resultados para un promedio 1 a 4: el
 * promedio a un decimal se redondea al entero más cercano (2,5 sube a 3;
 * 3,5 sube a 4) y se acota al rango de la escala.
 */
export function cuadranteMagia(promedio: number): NivelMagia {
  const n = Math.floor(redondear1(promedio) + 0.5);
  return Math.min(4, Math.max(1, n)) as NivelMagia;
}

/**
 * Qué tan avanzado va un promedio dentro de su casilla, de 0 (recién entró,
 * viene de la casilla anterior) a 1 (a punto de pasar a la siguiente). Con
 * esto el punto no cae siempre en el centro: se dibuja más abajo a la
 * izquierda o más arriba a la derecha según el decimal, y se ve la tendencia.
 * Ej.: 2,5 → 0; 3,0 → 0,5; 3,4 → 0,9.
 */
export function avanceEnCasilla(promedio: number): number {
  const p = redondear1(promedio);
  const casilla = cuadranteMagia(p);
  return Math.min(1, Math.max(0, redondear1(p - (casilla - 0.5))));
}

// ---------- Ventana de evaluación ----------

// Hay UNA evaluación por persona y por mes, y la de cada mes se hace en los
// primeros 5 días de ESE mes (la de octubre, del 1 al 5 de octubre). Pasado
// el día 5 el plazo está vencido; un mes anterior sin evaluar queda atrasado.
// Se empieza a contar desde septiembre de 2026.

/** Último día del mes para hacer la evaluación de ese mes. */
export const MAGIA_DIA_LIMITE = 5;

/** Primer mes que se evalúa; antes de este no se avisa ni se espera nada. */
export const MAGIA_INICIO = { anio: 2026, mes: 9 };

const indiceMes = (anio: number, mes: number) => anio * 12 + (mes - 1);
const INDICE_INICIO = indiceMes(MAGIA_INICIO.anio, MAGIA_INICIO.mes);

export type VentanaMagia =
  // `anio`/`mes`: el mes en curso, que es el que toca evaluar.
  | { estado: "abierta"; anio: number; mes: number; diasRestantes: number } // contando hoy
  | { estado: "vencida"; anio: number; mes: number; diasDeAtraso: number }
  | { estado: "sin_aviso" }; // todavía no ha empezado el conteo

/** Cómo va hoy el plazo de la evaluación del mes en curso. */
export function ventanaMagia(hoy: Date): VentanaMagia {
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  if (indiceMes(anio, mes) < INDICE_INICIO) return { estado: "sin_aviso" };
  const dia = hoy.getDate();
  if (dia <= MAGIA_DIA_LIMITE) return { estado: "abierta", anio, mes, diasRestantes: MAGIA_DIA_LIMITE - dia + 1 };
  return { estado: "vencida", anio, mes, diasDeAtraso: dia - MAGIA_DIA_LIMITE };
}

/**
 * Meses anteriores al actual que ya entran en el conteo (desde el inicio), del
 * más reciente al más antiguo. Si a alguien le falta la evaluación de uno de
 * estos, está atrasada. Se acota para no revisar años enteros.
 */
export function mesesAnterioresMagia(hoy: Date, max = 6): { anio: number; mes: number }[] {
  const actual = indiceMes(hoy.getFullYear(), hoy.getMonth() + 1);
  const meses: { anio: number; mes: number }[] = [];
  for (let i = actual - 1; i >= INDICE_INICIO && meses.length < max; i--) {
    meses.push({ anio: Math.floor(i / 12), mes: (i % 12) + 1 });
  }
  return meses;
}

/** ¿Este mes ya entra en el conteo de evaluaciones? */
export function mesCuentaParaMagia(anio: number, mes: number): boolean {
  return indiceMes(anio, mes) >= INDICE_INICIO;
}

/** ¿Se puede registrar hoy la evaluación de este mes? (ya cuenta y no es un mes futuro) */
export function mesEvaluableMagia(hoy: Date, anio: number, mes: number): boolean {
  return mesCuentaParaMagia(anio, mes) && indiceMes(anio, mes) <= indiceMes(hoy.getFullYear(), hoy.getMonth() + 1);
}

/** Color fijo de cada casilla, igual al de la plantilla impresa. */
export const COLOR_CUADRANTE: Record<NivelMagia, string> = {
  1: "#B4232F", // rojo
  2: "#E0A526", // amarillo
  3: "#2E9CC4", // azul
  4: "#1F9D4D", // verde
};

/**
 * Resumen de un conjunto de evaluaciones (un mes, o todo el histórico de una
 * persona): puntaje promedio sobre 24, promedio 1 a 4 con un decimal y casilla.
 */
export function resumenMesMagia(evals: Puntajes[]): {
  totalPromedio: number;
  promedio: number;
  cuadrante: NivelMagia;
} | null {
  if (evals.length === 0) return null;
  const totalPromedio = evals.reduce((a, e) => a + totalMagia(e as MagiaEvaluacion), 0) / evals.length;
  const promedio = redondear1(promedioDesdeTotal(totalPromedio));
  return { totalPromedio, promedio, cuadrante: cuadranteMagia(promedio) };
}
