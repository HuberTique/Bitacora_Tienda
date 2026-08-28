-- 0001_personal.sql
-- Fase 0 — módulo Personal
-- Idempotente: se puede volver a correr sin romper nada existente.

-- ================================================================
-- Tabla personal
-- ================================================================
create table if not exists public.personal (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  nombre        text not null,
  codigo        text,
  cedula        text not null,
  cargo         text not null default '—',
  rol           text not null check (rol in ('jefatura','asesor')),
  activo        boolean not null default true,
  motivo_baja   text,
  fecha_baja    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists personal_cedula_uniq on public.personal (cedula);
create index if not exists personal_activo_idx on public.personal (activo);
create index if not exists personal_rol_idx on public.personal (rol);

-- ================================================================
-- Trigger: updated_at automático
-- ================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists set_updated_at on public.personal;
create trigger set_updated_at
  before update on public.personal
  for each row execute function public.tg_set_updated_at();

-- ================================================================
-- Helper: rol del usuario autenticado (SECURITY DEFINER para saltar RLS)
--   Devuelve null si no hay sesión o no hay fila en personal.
-- ================================================================
create or replace function public.current_persona_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.personal where auth_user_id = auth.uid() limit 1;
$$;

grant execute on function public.current_persona_rol() to anon, authenticated;

-- ================================================================
-- Row Level Security
-- ================================================================
alter table public.personal enable row level security;

-- Limpia políticas previas (idempotencia)
drop policy if exists "jefatura all"       on public.personal;
drop policy if exists "asesor select own"  on public.personal;
drop policy if exists "asesor update own"  on public.personal;

-- Jefatura autenticada: acceso total
create policy "jefatura all"
  on public.personal
  for all
  to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Asesor autenticado: solo ve su propia fila
create policy "asesor select own"
  on public.personal
  for select
  to authenticated
  using (auth_user_id = auth.uid());

-- Asesor autenticado: puede actualizar solo su propia fila (sin cambiar rol/activo)
create policy "asesor update own"
  on public.personal
  for update
  to authenticated
  using      (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid()
              and rol    = (select rol    from public.personal where auth_user_id = auth.uid())
              and activo = (select activo from public.personal where auth_user_id = auth.uid()));

-- ================================================================
-- RPC público: roster mínimo para el dropdown de login
--   Solo columnas seguras (id, nombre, cargo, rol) — sin cédula ni código.
--   SECURITY DEFINER para saltar RLS y responder también a anon.
-- ================================================================
create or replace function public.roster_publico()
returns table (id uuid, nombre text, cargo text, rol text)
language sql
stable
security definer
set search_path = public
as $$
  select id, nombre, cargo, rol
  from public.personal
  where activo = true
  order by nombre;
$$;

grant execute on function public.roster_publico() to anon, authenticated;
