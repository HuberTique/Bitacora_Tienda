-- 0015_horarios_config.sql
-- Parámetros editables del generador de horarios (una sola fila).
-- Las horas de turno (4h PT, 9h y 10h FT) NO son configurables: el
-- exportador a Excel las traduce a horas de entrada/salida fijas.
-- Idempotente.

create table if not exists public.horarios_config (
  id                    boolean primary key default true check (id),
  pt_dias_semana        integer not null default 6 check (pt_dias_semana between 1 and 7),
  ft_dias_turno_largo   integer not null default 2 check (ft_dias_turno_largo between 0 and 6),
  ft_descansos_semana   integer not null default 2 check (ft_descansos_semana between 1 and 3),
  ft_domingos_descanso  integer not null default 2 check (ft_domingos_descanso between 0 and 2),
  updated_at            timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.horarios_config;
create trigger set_updated_at
  before update on public.horarios_config
  for each row execute function public.tg_set_updated_at();

insert into public.horarios_config (id) values (true) on conflict (id) do nothing;

alter table public.horarios_config enable row level security;
grant all privileges on public.horarios_config to service_role, authenticated;

drop policy if exists "authenticated_read_horarios_config" on public.horarios_config;
drop policy if exists "jefatura_write_horarios_config"    on public.horarios_config;

create policy "authenticated_read_horarios_config"
  on public.horarios_config for select to authenticated using (true);

create policy "jefatura_write_horarios_config"
  on public.horarios_config for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');
