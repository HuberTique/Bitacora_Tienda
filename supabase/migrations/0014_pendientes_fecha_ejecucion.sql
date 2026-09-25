-- 0014_pendientes_fecha_ejecucion.sql
-- Bitácora: fecha límite de ejecución de un pendiente (opcional), para
-- mostrar cuándo toca ejecutarlo y avisar si ya está vencido.
--
-- Idempotente.

alter table public.pendientes
  add column if not exists fecha_ejecucion date;
