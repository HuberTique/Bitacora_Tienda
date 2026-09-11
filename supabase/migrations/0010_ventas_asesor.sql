-- 0010_ventas_asesor.sql
-- Fase 2 sprint 4a — Ventas por asesor por día + códigos alternos.
--
-- El programa oficial de la tienda genera un PDF diario "Ventas rápidas por
-- empleado" con la venta neta y recuento de artículos por asesor. La app lo
-- lee vía IA y guarda una fila por asesor por día en `ventas_asesor_dia`.
--
-- Para el 100% del roster ese día se debe registrar CÓMO explicó la venta:
-- vendió $X, hizo solo operación, incapacidad, código temporal, etc. — vía
-- el enum `motivo_no_venta`.
--
-- `personal_codigos_alternos`: en la tienda hay casos donde el asesor usa
-- por semanas el código de un DSM / jefe / subjefe mientras le llega el
-- suyo. Esta tabla registra esos alias para que futuras subidas del PDF los
-- detecten automáticamente.
--
-- Idempotente.

-- ================================================================
-- Enum: motivos por los cuales un asesor no aparece con venta
-- ================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'motivo_no_venta_t') then
    create type public.motivo_no_venta_t as enum (
      -- Vendió: usar el registro normal, este enum no aplica
      -- Trabajó pero no vendió
      'solo_operacion',
      -- Ausencias justificadas
      'incapacidad',
      'calamidad',
      'libre_solicitado',
      -- Ausencia no justificada
      'no_fue',
      -- Programado (según horario)
      'descanso',
      -- Código incorrecto en el registro (venta existe pero mal atribuida)
      'codigo_temporal_dsm',
      'codigo_mal_digitado',
      'venta_otra_tienda',
      -- Otro (con texto libre en `motivo_detalle`)
      'otro'
    );
  end if;
end
$$;

-- ================================================================
-- Tabla ventas_asesor_dia (una fila por persona por fecha)
-- ================================================================
create table if not exists public.ventas_asesor_dia (
  id                uuid primary key default gen_random_uuid(),
  persona_id        uuid not null references public.personal(id) on delete cascade,
  fecha             date not null,
  venta             numeric,                              -- venta neta del día
  articulos         int,                                  -- recuento de artículos
  motivo_no_venta   public.motivo_no_venta_t,             -- null si vendió
  motivo_detalle    text,                                 -- texto libre para 'otro'
  fuente            text default 'pdf',                   -- 'pdf' | 'manual'
  registrado_por    uuid references public.personal(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists ventas_asesor_dia_uq
  on public.ventas_asesor_dia (persona_id, fecha);
create index if not exists ventas_asesor_dia_fecha_idx
  on public.ventas_asesor_dia (fecha desc);

drop trigger if exists set_updated_at on public.ventas_asesor_dia;
create trigger set_updated_at
  before update on public.ventas_asesor_dia
  for each row execute function public.tg_set_updated_at();

-- ================================================================
-- Tabla personal_codigos_alternos
-- ================================================================
create table if not exists public.personal_codigos_alternos (
  id             uuid primary key default gen_random_uuid(),
  persona_id     uuid not null references public.personal(id) on delete cascade,
  codigo         text not null,           -- código que aparece en el PDF
  motivo         text,                    -- ej. "código de DSM mientras llega el propio"
  activo_desde   date,
  activo_hasta   date,
  created_at     timestamptz not null default now()
);

create unique index if not exists personal_codigos_alternos_uq
  on public.personal_codigos_alternos (codigo, persona_id);
create index if not exists personal_codigos_alternos_persona_idx
  on public.personal_codigos_alternos (persona_id);

-- ================================================================
-- Grants
-- ================================================================
grant all on public.ventas_asesor_dia          to service_role;
grant all on public.personal_codigos_alternos  to service_role;
grant select, insert, update, delete on public.ventas_asesor_dia         to authenticated;
grant select, insert, update, delete on public.personal_codigos_alternos to authenticated;

-- ================================================================
-- RLS
-- ================================================================
alter table public.ventas_asesor_dia         enable row level security;
alter table public.personal_codigos_alternos enable row level security;

drop policy if exists "jefatura all ventas"       on public.ventas_asesor_dia;
drop policy if exists "asesor select ventas own"  on public.ventas_asesor_dia;
drop policy if exists "jefatura all codigos"      on public.personal_codigos_alternos;
drop policy if exists "asesor select codigos own" on public.personal_codigos_alternos;

-- Jefatura: acceso total
create policy "jefatura all ventas" on public.ventas_asesor_dia
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "jefatura all codigos" on public.personal_codigos_alternos
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Asesor: solo sus propias ventas y códigos alternos
create policy "asesor select ventas own" on public.ventas_asesor_dia
  for select to authenticated
  using (persona_id = (
    select id from public.personal where auth_user_id = auth.uid() limit 1
  ));

create policy "asesor select codigos own" on public.personal_codigos_alternos
  for select to authenticated
  using (persona_id = (
    select id from public.personal where auth_user_id = auth.uid() limit 1
  ));
