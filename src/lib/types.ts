export type Rol = "jefatura" | "asesor";

export type Persona = {
  id: string;
  auth_user_id: string | null;
  nombre: string;
  codigo: string | null;
  cedula: string;
  cargo: string;
  rol: Rol;
  activo: boolean;
  motivo_baja: string | null;
  fecha_baja: string | null;
  created_at: string;
  updated_at: string;
};

export type RosterPublico = {
  id: string;
  nombre: string;
  cargo: string;
  rol: Rol;
};

export const MOTIVOS_BAJA = [
  "Cambio de tienda",
  "Renuncia",
  "Cancelación de contrato",
  "Otros",
] as const;

export type MotivoBaja = (typeof MOTIVOS_BAJA)[number];

/** Convierte un id de persona al email sintético usado para Supabase Auth. */
export function emailFor(personaId: string): string {
  return `${personaId}@bitacora-tienda.local`;
}

// ---------- Bitácora ----------

export const AREAS = [
  { id: "rrhh", label: "Recursos Humanos" },
  { id: "visual", label: "Visual" },
  { id: "operaciones", label: "Operaciones" },
  { id: "ventas", label: "Ventas" },
  { id: "mantenimiento", label: "Mantenimiento" },
  { id: "otros", label: "Otros" },
] as const;

export type AreaId = (typeof AREAS)[number]["id"];

export const TURNOS = ["Mañana", "Tarde", "Cierre"] as const;
export type Turno = (typeof TURNOS)[number];

export const ESTADOS_PENDIENTE = ["abierto", "progreso", "cerrado"] as const;
export type EstadoPendiente = (typeof ESTADOS_PENDIENTE)[number];

export type Pendiente = {
  id: string;
  titulo: string;
  area: AreaId;
  turno: Turno;
  responsable_id: string;
  asesor_id: string | null;
  descripcion: string;
  estado: EstadoPendiente;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
  updated_at: string;
};

export function labelArea(areaId: string): string {
  return AREAS.find((a) => a.id === areaId)?.label ?? areaId;
}

export function labelEstado(e: EstadoPendiente): string {
  return e === "abierto" ? "Abierto" : e === "progreso" ? "En progreso" : "Cerrado";
}
