-- 0003_pendientes.sql
-- Fase 1 — módulo Bitácora
-- Idempotente.

-- ================================================================
-- Helper: id de la persona autenticada actual
-- ================================================================
create or replace function public.current_persona_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.personal where auth_user_id = auth.uid() limit 1;
$$;

grant execute on function public.current_persona_id() to anon, authenticated;

-- ================================================================
-- Tabla pendientes
-- ================================================================
create table if not exists public.pendientes (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  area           text not null check (area in ('rrhh','visual','operaciones','ventas','mantenimiento','otros')),
  turno          text not null check (turno in ('Mañana','Tarde','Cierre')),
  responsable_id uuid not null references public.personal(id) on delete restrict,
  asesor_id      uuid references public.personal(id) on delete set null,
  descripcion    text not null default '',
  estado         text not null default 'abierto' check (estado in ('abierto','progreso','cerrado')),
  created_by     uuid not null references public.personal(id) on delete restrict,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      uuid references public.personal(id) on delete set null,
  updated_at     timestamptz not null default now()
);

create index if not exists pendientes_estado_idx      on public.pendientes (estado);
create index if not exists pendientes_area_idx        on public.pendientes (area);
create index if not exists pendientes_asesor_idx      on public.pendientes (asesor_id);
create index if not exists pendientes_responsable_idx on public.pendientes (responsable_id);
create index if not exists pendientes_created_by_idx  on public.pendientes (created_by);
create index if not exists pendientes_created_at_idx  on public.pendientes (created_at desc);

drop trigger if exists set_updated_at on public.pendientes;
create trigger set_updated_at
  before update on public.pendientes
  for each row execute function public.tg_set_updated_at();

-- ================================================================
-- RLS
-- ================================================================
alter table public.pendientes enable row level security;

drop policy if exists "jefatura_all_pendientes"       on public.pendientes;
drop policy if exists "asesor_read_own_pendientes"    on public.pendientes;
drop policy if exists "asesor_insert_own_pendientes"  on public.pendientes;
drop policy if exists "asesor_update_own_pendientes"  on public.pendientes;

-- Jefatura: acceso total
create policy "jefatura_all_pendientes"
  on public.pendientes
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Asesor: ve pendientes donde está involucrado (asesor, responsable o creador)
create policy "asesor_read_own_pendientes"
  on public.pendientes
  for select to authenticated
  using (
    asesor_id      = public.current_persona_id()
    or responsable_id = public.current_persona_id()
    or created_by     = public.current_persona_id()
  );

-- Asesor: puede crear pendientes marcándose como creador
create policy "asesor_insert_own_pendientes"
  on public.pendientes
  for insert to authenticated
  with check (created_by = public.current_persona_id());

-- Asesor: puede actualizar (cambiar estado) los pendientes que le asignaron
create policy "asesor_update_own_pendientes"
  on public.pendientes
  for update to authenticated
  using      (asesor_id = public.current_persona_id())
  with check (asesor_id = public.current_persona_id());

-- Grants (necesarios en Supabase 2025 para tablas creadas vía SQL)
grant all privileges on public.pendientes to service_role;
grant all privileges on public.pendientes to authenticated;

-- ================================================================
-- Habilitar Realtime — publicación supabase_realtime
-- ================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pendientes'
  ) then
    alter publication supabase_realtime add table public.pendientes;
  end if;
end $$;
