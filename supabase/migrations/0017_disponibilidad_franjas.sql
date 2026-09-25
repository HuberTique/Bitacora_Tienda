-- 0017_disponibilidad_franjas.sql
-- Disponibilidad de part-time por franja (mañana / tarde), no solo por día.
--
--  * disponibilidad_pt.franjas_bloqueadas: {"1":"manana","4":"tarde"}
--    (clave = día de la semana 0=dom..6=sáb; valor = franja en la que la
--    persona NO puede trabajar). Los días completos siguen en dias_bloqueados.
--  * horarios.franja: 'manana' si el turno de 4h de ese día es en la mañana
--    (por defecto el turno PT es en la tarde/cierre y queda en null).
--
-- Idempotente.

alter table public.disponibilidad_pt
  add column if not exists franjas_bloqueadas jsonb not null default '{}'::jsonb;

alter table public.horarios
  add column if not exists franja text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'horarios_franja_chk'
  ) then
    alter table public.horarios
      add constraint horarios_franja_chk check (franja in ('manana','tarde'));
  end if;
end $$;
