// Cierre de sesión por inactividad (Huber, 5-oct-2026): 15 minutos sin uso,
// igual para todos los roles, con aviso un minuto antes.
//
// La última actividad se guarda en localStorage para que cuente lo que se hace
// en cualquier pestaña de la app, y para cerrar la sesión si alguien vuelve a
// abrir la app después de que pasó el tiempo (los celulares duermen las
// pestañas y los temporizadores no corren con la app cerrada).

export const LIMITE_INACTIVIDAD_MS = 15 * 60 * 1000;
export const AVISO_ANTES_MS = 60 * 1000;

const CLAVE = "dl-ultima-actividad";
const CLAVE_CIERRE = "dl-cierre-por-inactividad";

export function marcarActividad(ahora = Date.now()): void {
  try {
    localStorage.setItem(CLAVE, String(ahora));
  } catch {
    /* almacenamiento bloqueado: solo cuenta el temporizador de esta pestaña */
  }
}

export function ultimaActividad(): number | null {
  try {
    const v = Number(localStorage.getItem(CLAVE));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Qué toca hacer con la sesión según cuánto lleva sin uso. */
export function estadoInactividad(ultima: number | null, ahora: number): { accion: "nada" | "avisar" | "cerrar"; restanteMs: number } {
  if (ultima == null) return { accion: "nada", restanteMs: LIMITE_INACTIVIDAD_MS };
  const restante = LIMITE_INACTIVIDAD_MS - (ahora - ultima);
  if (restante <= 0) return { accion: "cerrar", restanteMs: 0 };
  if (restante <= AVISO_ANTES_MS) return { accion: "avisar", restanteMs: restante };
  return { accion: "nada", restanteMs: restante };
}

/** Deja una marca para que la pantalla de ingreso explique por qué se cerró. */
export function marcarCierrePorInactividad(): void {
  try {
    sessionStorage.setItem(CLAVE_CIERRE, "1");
  } catch {
    /* sin almacenamiento: no se muestra el aviso */
  }
}

export function tomarCierrePorInactividad(): boolean {
  try {
    const v = sessionStorage.getItem(CLAVE_CIERRE) === "1";
    sessionStorage.removeItem(CLAVE_CIERRE);
    return v;
  } catch {
    return false;
  }
}
