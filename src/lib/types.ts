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
