// Lectura de imágenes o PDF para la Bitácora: convierte lo que propone la IA
// (Edge Function leer-pendientes-archivo) en borradores de pendiente válidos
// para el tablero. Lógica pura, sin React ni Supabase, para poder probarla.
//
// La IA solo PROPONE: aquí se valida cada campo contra lo que el tablero
// acepta y se enlaza a las personas reales del equipo; jefatura revisa y
// decide qué se registra.

import { AREAS, TURNOS, type AreaId, type RosterPublico, type Turno } from "./types";

/** Un pendiente tal como lo devuelve la IA (todo sin confiar). */
export type PendienteIA = {
  titulo?: unknown;
  area?: unknown;
  turno?: unknown;
  fecha_ejecucion?: unknown;
  asesor?: unknown;
  descripcion?: unknown;
};

export type LecturaIA = { contexto?: unknown; pendientes?: unknown; truncado?: unknown };

/** Borrador editable en la pantalla de revisión. */
export type BorradorPendiente = {
  incluir: boolean;
  titulo: string;
  area: AreaId;
  turno: Turno;
  fechaEjecucion: string; // YYYY-MM-DD o ""
  responsableId: string;
  asesorId: string; // "" = ninguno
  descripcion: string;
  /** Nombre que mencionó el documento y no se pudo enlazar a nadie del equipo. */
  personaSinEnlazar: string | null;
};

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Enlaza un nombre mencionado en el documento con una persona del equipo.
 * Primero por nombre idéntico; si no, por palabras en común, exigiendo al
 * menos dos y que no haya empate: ante la duda es mejor no asignar a nadie
 * que asignarle el pendiente a la persona equivocada.
 */
export function enlazarPersona<T extends { id: string; nombre: string }>(nombre: string, equipo: T[]): T | null {
  const buscado = normalizar(nombre);
  if (!buscado) return null;
  const exacto = equipo.find((p) => normalizar(p.nombre) === buscado);
  if (exacto) return exacto;

  const palabras = buscado.split(" ").filter((t) => t.length > 2);
  if (palabras.length === 0) return null;
  let mejor: T | null = null;
  let mejorPuntaje = 0;
  let empate = false;
  for (const p of equipo) {
    const propias = normalizar(p.nombre).split(" ");
    const puntaje = palabras.filter((t) => propias.includes(t)).length;
    if (puntaje > mejorPuntaje) {
      mejor = p;
      mejorPuntaje = puntaje;
      empate = false;
    } else if (puntaje === mejorPuntaje && puntaje > 0) {
      empate = true;
    }
  }
  return mejorPuntaje >= 2 && !empate ? mejor : null;
}

/** Turno según la hora local, para cuando el documento no lo dice. */
export function turnoPorHora(hora: number): Turno {
  if (hora < 12) return "Mañana";
  if (hora < 17) return "Tarde";
  return "Cierre";
}

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00"));

/**
 * Convierte la respuesta de la IA en borradores listos para revisar.
 * - Área y turno fuera de las opciones del tablero caen en "otros" y en el turno por defecto.
 * - Una persona mencionada que es jefatura queda como responsable; si es asesor, como asesor relacionado.
 * - Sin responsable identificado, el responsable es quien está leyendo el archivo.
 */
export function borradoresDesdeLectura(
  lectura: LecturaIA,
  opciones: { roster: RosterPublico[]; responsablePorDefecto: string; turnoPorDefecto: Turno },
): { contexto: string; borradores: BorradorPendiente[]; truncado: boolean } {
  const { roster, responsablePorDefecto, turnoPorDefecto } = opciones;
  const areasValidas = AREAS.map((a) => a.id) as readonly string[];
  const turnosValidos = TURNOS as readonly string[];
  const crudos = Array.isArray(lectura.pendientes) ? (lectura.pendientes as PendienteIA[]) : [];

  const borradores: BorradorPendiente[] = [];
  for (const p of crudos) {
    if (!p || typeof p !== "object") continue;
    const titulo = String(p.titulo ?? "").trim();
    if (!titulo) continue;

    const area = String(p.area ?? "").toLowerCase().trim();
    const turno = String(p.turno ?? "").trim();
    const fecha = String(p.fecha_ejecucion ?? "").trim();
    const mencionada = typeof p.asesor === "string" ? p.asesor.trim() : "";
    const persona = mencionada ? enlazarPersona(mencionada, roster) : null;

    borradores.push({
      incluir: true,
      titulo,
      area: (areasValidas.includes(area) ? area : "otros") as AreaId,
      turno: (turnosValidos.includes(turno) ? turno : turnoPorDefecto) as Turno,
      fechaEjecucion: esFecha(fecha) ? fecha : "",
      responsableId: persona?.rol === "jefatura" ? persona.id : responsablePorDefecto,
      asesorId: persona?.rol === "asesor" ? persona.id : "",
      descripcion: String(p.descripcion ?? "").trim(),
      personaSinEnlazar: mencionada && !persona ? mencionada : null,
    });
  }

  return {
    contexto: String(lectura.contexto ?? "").trim(),
    borradores,
    truncado: lectura.truncado === true,
  };
}

/** Fila lista para insertar en `pendientes` a partir de un borrador revisado. */
export function filaPendiente(
  b: BorradorPendiente,
  datos: { creadoPor: string; origen: string; contexto: string | null },
): Record<string, unknown> {
  const partes = [b.descripcion.trim()];
  if (datos.contexto) partes.push(`Contexto: ${datos.contexto}`);
  partes.push(`Origen: ${datos.origen}`);
  return {
    titulo: b.titulo.trim(),
    area: b.area,
    turno: b.turno,
    responsable_id: b.responsableId,
    asesor_id: b.asesorId || null,
    descripcion: partes.filter(Boolean).join("\n\n"),
    estado: "abierto",
    created_by: datos.creadoPor,
    ...(b.fechaEjecucion ? { fecha_ejecucion: b.fechaEjecucion } : {}),
  };
}

/** Por qué un borrador marcado no se puede guardar todavía (o null si está bien). */
export function problemaBorrador(b: BorradorPendiente): string | null {
  if (!b.titulo.trim()) return "le falta el título";
  if (!b.responsableId) return "le falta el responsable";
  return null;
}
