"use client";

// Helper para crear notificaciones — usado por el flujo de Requerimientos
// (nuevo/aprobado/rechazado) y disponible para cualquier módulo futuro que
// necesite avisar a una persona específica o a toda la jefatura.

import { supabase } from "./supabase";

export type TipoNotificacion =
  | "requerimiento_nuevo"
  | "requerimiento_aprobado"
  | "requerimiento_rechazado";

/**
 * Crea una notificación dirigida a UNA persona (destinatarioPersonaId) o a
 * TODA la jefatura (destinatarioJefatura=true) — nunca ambos. `refFecha` +
 * `refTabla`/`refId` permiten que al hacer click se navegue directo al
 * recurso relacionado (ej. el día del calendario de Requerimientos).
 */
export async function crearNotificacion(opts: {
  tipo: TipoNotificacion | string;
  mensaje: string;
  destinatarioPersonaId?: string;
  destinatarioJefatura?: boolean;
  refFecha?: string;
  refTabla?: string;
  refId?: string;
}): Promise<void> {
  const { error } = await supabase.from("notificaciones").insert({
    tipo: opts.tipo,
    mensaje: opts.mensaje,
    destinatario_persona_id: opts.destinatarioPersonaId ?? null,
    destinatario_jefatura: opts.destinatarioJefatura ?? false,
    ref_fecha: opts.refFecha ?? null,
    ref_tabla: opts.refTabla ?? null,
    ref_id: opts.refId ?? null,
  });
  if (error) {
    // No bloqueamos el flujo principal (ej. aprobar un requerimiento) por
    // un fallo al notificar — solo lo dejamos en consola para depurar.
    console.error("[notificaciones] Error creando notificación:", error.message);
  }
}
