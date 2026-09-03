-- 0006_horarios.sql
-- Fase 2 — módulo Horarios (Sprint 1: schema + generador básico)
-- Idempotente.

-- ================================================================
-- Disponibilidad individual de Part-Time (días de semana bloqueados
-- por estudios, otro trabajo, etc.). Una fila por persona; días de
-- semana como array de enteros 0..6 (0=domingo, 6=sábado).
-- ================================================================
create table if not exists public.disponibilidad_pt (
  persona_id       uuid primary key references public.personal(id) on delete cascade,
  dias_bloqueados  integer[] not null default '{}',
  updated_at       timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.disponibilidad_pt;
create trigger set_updated_at
  before update on public.disponibilidad_pt
  for each row execute function public.tg_set_updated_at();

alter table public.disponibilidad_pt enable row level security;
grant all privileges on public.disponibilidad_pt to service_role, authenticated;

drop policy if exists "jefatura_all_disponibilidad"      on public.disponibilidad_pt;
drop policy if exists "asesor_read_own_disponibilidad"   on public.disponibilidad_pt;

create policy "jefatura_all_disponibilidad"
  on public.disponibilidad_pt for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "asesor_read_own_disponibilidad"
  on public.disponibilidad_pt for select to authenticated
  using (persona_id = public.current_persona_id());

-- ================================================================
-- Días bloqueados por jefatura (feriados, capacitaciones colectivas,
-- inventarios) que el generador de horario debe respetar. Únicos por
-- fecha (no tiene sentido bloquear dos veces el mismo día).
-- ================================================================
create table if not exists public.dias_bloqueados (
  id           uuid primary key default gen_random_uuid(),
  fecha        date not null unique,
  motivo       text not null,
  creado_por   uuid references public.personal(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists dias_bloqueados_fecha_idx on public.dias_bloqueados (fecha);

alter table public.dias_bloqueados enable row level security;
grant all privileges on public.dias_bloqueados to service_role, authenticated;

drop policy if exists "authenticated_read_dias_bloqueados" on public.dias_bloqueados;
drop policy if exists "jefatura_write_dias_bloqueados"    on public.dias_bloqueados;

create policy "authenticated_read_dias_bloqueados"
  on public.dias_bloqueados for select to authenticated using (true);

create policy "jefatura_write_dias_bloqueados"
  on public.dias_bloqueados for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- ================================================================
-- Horarios generados. Una fila por (persona, año, mes, día). El
-- generador escribe todos los días del mes por cada persona activa
-- (día de trabajo o descanso), y jefatura puede editar filas puntuales.
-- ================================================================
create table if not exists public.horarios (
  id           uuid primary key default gen_random_uuid(),
  persona_id   uuid not null references public.personal(id) on delete cascade,
  anio         integer not null,
  mes          integer not null check (mes between 1 and 12),
  dia          integer not null check (dia between 1 and 31),
  horas        numeric(3,1) not null default 0,
  tipo         text not null check (tipo in ('trabajo','descanso','libre')),
  notas        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (persona_id, anio, mes, dia)
);

create index if not exists horarios_persona_mes_idx on public.horarios (persona_id, anio, mes);
create index if not exists horarios_mes_idx         on public.horarios (anio, mes);

drop trigger if exists set_updated_at on public.horarios;
create trigger set_updated_at
  before update on public.horarios
  for each row execute function public.tg_set_updated_at();

alter table public.horarios enable row level security;
grant all privileges on public.horarios to service_role, authenticated;

drop policy if exists "jefatura_all_horarios"      on public.horarios;
drop policy if exists "asesor_read_own_horarios"   on public.horarios;

create policy "jefatura_all_horarios"
  on public.horarios for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "asesor_read_own_horarios"
  on public.horarios for select to authenticated
  using (persona_id = public.current_persona_id());
