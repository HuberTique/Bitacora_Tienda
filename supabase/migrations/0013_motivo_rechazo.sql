-- 0013_motivo_rechazo.sql
-- Fase 3 — Requerimientos: motivo obligatorio al rechazar.
--
-- Jefatura pidió que un requerimiento rechazado siempre traiga explicación
-- (para que el asesor sepa por qué, no solo que "no"), y que se distinga
-- visualmente en la campana de notificaciones.
--
-- Idempotente.

alter table public.requerimientos
  add column if not exists motivo_rechazo text;
