-- 0043_novedades_semanas.sql
--
-- Novedades de horario y presupuesto por semana. Reglas de Huber, 7-oct-2026:
--
--   * El horario de GeoVictoria es lo PROGRAMADO. En el calendario la jefatura
--     registra lo que de verdad pasó cada día: horas reales y la novedad
--     (incapacidad, vacaciones, licencia, calamidad, ausencia injustificada,
--     retardo o salida temprano, horas extra). Se guardan las dos cosas.
--   * Presupuesto por SEMANA RETAIL (domingo a sábado): la meta de la tienda
--     de esa semana (la meta diaria del planeador) se reparte entre el equipo
--     por horas de venta. Al inicio de la semana es PROYECTADO (horas
--     programadas); la jefatura CIERRA la semana y se RECALCULA con las horas
--     reales: lo que no cubrió alguien por una novedad justificada pasa a los
--     demás de esa semana. Con una ausencia injustificada (o retardo) la
--     persona CONSERVA su presupuesto: se reparte con sus horas programadas.
--   * Una semana cerrada se puede reabrir y corregir.
--
-- Idempotente.

-- ================================================================
-- 1) Lo que de verdad pasó cada día
-- ================================================================
alter table public.horarios
  add column if not exists horas_reales  numeric(4,2),
  add column if not exists novedad       text,
  add column if not exists novedad_nota  text,
  add column if not exists novedad_por   uuid references public.personal(id) on delete set null,
  add column if not exists novedad_at    timestamptz;

alter table public.horarios drop constraint if exists horarios_novedad_chk;
alter table public.horarios add constraint horarios_novedad_chk check (novedad in (
  'incapacidad', 'vacaciones', 'licencia', 'calamidad',   -- justificadas: se reparte a los demás
  'ausencia', 'retardo',                                   -- injustificadas: conserva su presupuesto
  'horas_extra'                                            -- trabajó más de lo programado
));

-- ================================================================
-- 2) Semanas cerradas y lo que quedó de cada persona
-- ================================================================
create table if not exists public.semanas_presupuesto (
  id          uuid primary key default gen_random_uuid(),
  tienda_id   uuid not null default public.current_tienda_id() references public.tiendas(id) on delete cascade,
  anio        integer not null,
  mes         integer not null check (mes between 1 and 12),
  inicio      date not null,
  fin         date not null,
  meta_tienda numeric not null default 0,
  cerrada_por uuid references public.personal(id) on delete set null,
  cerrada_at  timestamptz not null default now(),
  unique (tienda_id, inicio)
);

create table if not exists public.presupuesto_semana_persona (
  id                uuid primary key default gen_random_uuid(),
  tienda_id         uuid not null default public.current_tienda_id() references public.tiendas(id) on delete cascade,
  semana_id         uuid not null references public.semanas_presupuesto(id) on delete cascade,
  persona_id        uuid not null references public.personal(id) on delete cascade,
  meta_proyectada   numeric not null default 0,
  meta              numeric not null default 0,
  horas_programadas numeric not null default 0,
  horas_reales      numeric not null default 0,
  horas_venta       numeric not null default 0,
  unique (semana_id, persona_id)
);

do $$
declare t text;
begin
  foreach t in array array['semanas_presupuesto', 'presupuesto_semana_persona'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', 'tienda_' || t, t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (tienda_id = (select public.current_tienda_id()))
         with check (tienda_id = (select public.current_tienda_id()))', 'tienda_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'leer ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', 'leer ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'jefatura escribe ' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select public.current_persona_rol()) = ''jefatura'')
         with check ((select public.current_persona_rol()) = ''jefatura'')', 'jefatura escribe ' || t, t);
    execute format('drop trigger if exists huella_reemplazo on public.%I', t);
    execute format(
      'create trigger huella_reemplazo after insert or update or delete on public.%I
         for each statement execute function public.tg_huella_carga()', t);
  end loop;
end $$;
create index if not exists semanas_presupuesto_mes_idx on public.semanas_presupuesto (tienda_id, anio, mes);
create index if not exists presupuesto_semana_persona_idx on public.presupuesto_semana_persona (semana_id);
