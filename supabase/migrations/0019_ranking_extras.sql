-- 0019_ranking_extras.sql
-- Ranking de ventas, segunda parte:
--   * ranking semanal (función de resumen)
--   * confirmación de la evaluación Magia por el evaluado
--   * historial de podios ("Gran maestro del mes") y constancia
--   * bonos manuales (p. ej. asistencia a la OPM) y bonos automáticos A&A
-- Idempotente.

-- ================================================================
-- 1) Magia: confirmación del evaluado
-- ================================================================
alter table public.magia_evaluaciones
  add column if not exists confirmada_at timestamptz,
  add column if not exists comentario_evaluado text not null default '';

-- El evaluado no puede editar la evaluación (RLS solo le deja leer), pero sí
-- confirmarla y dejar un comentario: se hace con esta función acotada.
create or replace function public.confirmar_magia(p_id uuid, p_comentario text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.magia_evaluaciones
     set confirmada_at = now(),
         comentario_evaluado = coalesce(p_comentario, '')
   where id = p_id
     and persona_id = public.current_persona_id();
  if not found then
    raise exception 'No puedes confirmar esta evaluación.';
  end if;
end
$$;

grant execute on function public.confirmar_magia(uuid, text) to authenticated;

-- ================================================================
-- 2) Historial de podios (foto fija del ranking al cerrar cada mes)
-- ================================================================
create table if not exists public.ranking_historial (
  id          uuid primary key default gen_random_uuid(),
  anio        integer not null,
  mes         integer not null check (mes between 1 and 12),
  persona_id  uuid not null references public.personal(id) on delete cascade,
  nombre      text not null,
  puesto      integer not null,
  puntaje     numeric not null,
  created_at  timestamptz not null default now(),
  unique (anio, mes, persona_id)
);

create index if not exists ranking_historial_periodo_idx on public.ranking_historial (anio, mes);

alter table public.ranking_historial enable row level security;
grant all privileges on public.ranking_historial to service_role, authenticated;

drop policy if exists "leer historial ranking"    on public.ranking_historial;
drop policy if exists "jefatura escribe historial" on public.ranking_historial;

create policy "leer historial ranking" on public.ranking_historial
  for select to authenticated using (true);

create policy "jefatura escribe historial" on public.ranking_historial
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- ================================================================
-- 3) Bonos manuales (puntos extra con motivo)
-- ================================================================
create table if not exists public.puntos_extra (
  id             uuid primary key default gen_random_uuid(),
  persona_id     uuid not null references public.personal(id) on delete cascade,
  anio           integer not null,
  mes            integer not null check (mes between 1 and 12),
  puntos         numeric not null check (puntos between -20 and 20),
  motivo         text not null,
  registrado_por uuid references public.personal(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists puntos_extra_periodo_idx on public.puntos_extra (anio, mes);

alter table public.puntos_extra enable row level security;
grant all privileges on public.puntos_extra to service_role, authenticated;

drop policy if exists "leer puntos extra"           on public.puntos_extra;
drop policy if exists "jefatura escribe puntos extra" on public.puntos_extra;

create policy "leer puntos extra" on public.puntos_extra
  for select to authenticated using (true);

create policy "jefatura escribe puntos extra" on public.puntos_extra
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- ================================================================
-- 4) Configuración: valor de los bonos
-- ================================================================
alter table public.ranking_config
  add column if not exists bonus_aya        numeric not null default 2,
  add column if not exists bonus_constancia numeric not null default 1;

-- ================================================================
-- 5) Ranking semanal: venta y meta por persona y semana (agregados)
--    Un asesor solo puede leer sus filas de presupuestos_semanales; esta
--    función expone las cifras de venta de todo el equipo, igual que el
--    ranking mensual.
-- ================================================================
create or replace function public.ranking_semanal(p_anio integer, p_mes integer)
returns table (persona_id uuid, semana_label text, meta numeric, venta numeric, cumplimiento numeric)
language sql stable security definer set search_path = public
as $$
  select s.persona_id, s.semana_label, s.meta, s.venta, s.cumplimiento
  from public.presupuestos_semanales s
  where s.anio = p_anio and s.mes = p_mes;
$$;

grant execute on function public.ranking_semanal(integer, integer) to authenticated;
