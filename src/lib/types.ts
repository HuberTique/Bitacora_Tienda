export type Rol = "jefatura" | "asesor";

// Rol jerárquico: reemplaza la inferencia frágil desde texto libre de `cargo`.
// El generador y exportador de horarios usan este campo para clasificar,
// asignar niveles de seguridad y ordenar filas. `cargo` sigue siendo texto
// libre para info adicional (TEMPORAL, EMBARQUE OFICIAL, APOYO DSM, etc).
export type RolJerarquico =
  | "jefe_tienda"
  | "subjefe"
  | "cajero"
  | "full_time"
  | "part_time";

export const ROL_JERARQUICO_LABEL: Record<RolJerarquico, string> = {
  jefe_tienda: "Jefe de tienda",
  subjefe: "Subjefe",
  cajero: "Cajero",
  full_time: "Full-time",
  part_time: "Part-time",
};

// Nivel de seguridad por rol jerárquico. Usado en la lógica apertura/cierre
// del generador de horarios (memoria: project-horarios-reglas).
export const NIVEL_SEGURIDAD: Record<RolJerarquico, number> = {
  jefe_tienda: 5,
  subjefe: 4,
  cajero: 4,
  full_time: 3,
  part_time: 2,
};

export type Persona = {
  id: string;
  auth_user_id: string | null;
  nombre: string;
  codigo: string | null;
  cedula: string;
  cargo: string;
  rol: Rol;
  rol_jerarquico: RolJerarquico;
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
  rol_jerarquico: RolJerarquico;
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

// ---------- Feedbacks / Retardos ----------

export type FaltaConfig = {
  tipo_id: string;
  nombre: string;
  requiere_minutos: boolean;
  ladder: string[];
  posicion: number;
};

export const ESTADOS_RETARDO = ["pendiente", "realizada"] as const;
export type EstadoRetardo = (typeof ESTADOS_RETARDO)[number];

export type Retardo = {
  id: string;
  persona_id: string;
  tipo_id: string;
  fecha: string;
  minutos: number | null;
  observacion: string;
  ocurrencia: number;
  accion: string;
  estado: EstadoRetardo;
  registrado_por: string;
  created_at: string;
  updated_at: string;
};

export function labelEstadoRetardo(e: EstadoRetardo): string {
  return e === "pendiente" ? "Pendiente" : "Realizada";
}

// ---------- Horarios ----------

export type TipoDiaHorario = "trabajo" | "descanso" | "libre";

export type Horario = {
  id: string;
  persona_id: string;
  anio: number;
  mes: number;
  dia: number;
  horas: number;
  tipo: TipoDiaHorario;
  notas: string | null;
  created_at: string;
  updated_at: string;
};

export type DisponibilidadPTRow = {
  persona_id: string;
  dias_bloqueados: number[];
  updated_at: string;
};

export type DiaBloqueadoRow = {
  id: string;
  fecha: string;
  motivo: string;
  creado_por: string | null;
  created_at: string;
};

// ---------- Presupuestos ----------

export type PresupuestoUpload = {
  id: string;
  anio: number;
  mes: number;
  semana_label: string | null;
  nombre_archivo: string | null;
  subido_por: string | null;
  presupuesto_total: number | null;
  horas_total: number | null;
  venta_por_hora: number | null;
  created_at: string;
};

export type PresupuestoSemanal = {
  id: string;
  upload_id: string | null;
  persona_id: string;
  anio: number;
  mes: number;
  semana_label: string;
  meta: number | null;
  venta: number | null;
  cumplimiento: number | null;
  horas_reportadas: number | null;
  created_at: string;
  updated_at: string;
};

export type PresupuestoDiario = {
  id: string;
  fecha: string;
  meta: number | null;
  venta: number | null;
  accesorios_pct: number | null;
  ropa_pct: number | null;
  responsable_id: string | null;
  registrado_por: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
};

// ---------- Ventas por asesor por día ----------

// Motivos por los que un asesor no vendió (o su venta se perdió). Coincide
// con el enum motivo_no_venta_t de la migración 0010.
export type MotivoNoVenta =
  // Trabajó pero no vendió
  | "solo_operacion"
  // Ausencias justificadas
  | "incapacidad"
  | "calamidad"
  | "libre_solicitado"
  // Ausencia no justificada
  | "no_fue"
  // Programado según horario
  | "descanso"
  // Código incorrecto (venta existe pero mal atribuida)
  | "codigo_temporal_dsm"
  | "codigo_mal_digitado"
  | "venta_otra_tienda"
  // Otro (usar motivo_detalle)
  | "otro";

export const MOTIVO_NO_VENTA_LABEL: Record<MotivoNoVenta, string> = {
  solo_operacion: "Solo hizo operación (sin venta)",
  incapacidad: "Incapacidad médica",
  calamidad: "Calamidad doméstica",
  libre_solicitado: "Día libre solicitado",
  no_fue: "No se presentó",
  descanso: "Descanso programado",
  codigo_temporal_dsm: "Código temporal de DSM/Jefe (venta suya)",
  codigo_mal_digitado: "Código mal digitado por cajero",
  venta_otra_tienda: "Cambio/traspaso — venta de otra tienda",
  otro: "Otro (especificar)",
};

export type VentaAsesorDia = {
  id: string;
  persona_id: string;
  fecha: string;
  venta: number | null;
  articulos: number | null;
  motivo_no_venta: MotivoNoVenta | null;
  motivo_detalle: string | null;
  fuente: string;
  registrado_por: string | null;
  created_at: string;
  updated_at: string;
};

export type EstadoCodigoAlterno = "pendiente" | "aprobado" | "rechazado";

export type PersonalCodigoAlterno = {
  id: string;
  persona_id: string;
  codigo: string;
  motivo: string | null;
  activo_desde: string | null;
  activo_hasta: string | null;
  distribucion_pct: number;      // 0.01..1.0 — proporción de la venta del código
  estado: EstadoCodigoAlterno;
  aprobado_por: string | null;
  aprobado_at: string | null;
  created_at: string;
};

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return "$" + Math.round(v).toLocaleString("es-CO");
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v * 100) + "%";
}

// ---------- Requerimientos ----------

export type TipoRequerimiento = "dia_libre" | "salida_temprano" | "permiso" | "otro";

export const TIPOS_REQUERIMIENTO: { id: TipoRequerimiento; label: string }[] = [
  { id: "dia_libre", label: "Día libre" },
  { id: "salida_temprano", label: "Salida temprano" },
  { id: "permiso", label: "Permiso / llegada tarde autorizada" },
  { id: "otro", label: "Otro" },
];

export function labelTipoRequerimiento(tipo: string): string {
  return TIPOS_REQUERIMIENTO.find((t) => t.id === tipo)?.label ?? tipo;
}

export type EstadoRequerimiento = "pendiente" | "aprobado" | "rechazado";

export function labelEstadoRequerimiento(e: EstadoRequerimiento): string {
  if (e === "aprobado") return "Aprobado";
  if (e === "rechazado") return "Rechazado";
  return "Pendiente de revisión";
}

export type Requerimiento = {
  id: string;
  fecha: string; // YYYY-MM-DD
  persona_id: string;
  tipo: TipoRequerimiento;
  detalle: string;
  estado: EstadoRequerimiento;
  evidencia_path: string | null;
  evidencia_nombre: string | null;
  registrado_por: string;
  motivo_rechazo: string | null;
  revisado_por: string | null;
  fecha_revision: string | null;
  created_at: string;
  updated_at: string;
};

// ---------- Notificaciones ----------

export type Notificacion = {
  id: string;
  tipo: string;
  destinatario_persona_id: string | null;
  destinatario_jefatura: boolean;
  mensaje: string;
  ref_fecha: string | null;
  ref_tabla: string | null;
  ref_id: string | null;
  leida: boolean;
  created_at: string;
};
