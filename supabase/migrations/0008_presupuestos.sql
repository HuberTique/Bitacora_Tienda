-- 0008_presupuestos.sql
-- Fase 2 sprint 1 — módulo Presupuestos
-- Idempotente.
--
-- Dos tablas:
--   1) presupuestos_semanales: fila por asesor por semana. Poblada al subir
--      el Excel oficial "KPIS SEM." (jefatura). Meta semanal, venta acumulada,
--      horas laboradas reportadas y venta/hora ya vienen del reporte.
--   2) presupuestos_diarios: fila por día del negocio. Presupuesto asignado al
--      día, venta cerrada, %accesorios, %ropa, responsable del piso.
--
-- Una tercera tabla `presupuestos_uploads` guarda el historial de subidas
-- del Excel para poder deshacer si se sube uno equivocado.

-- ================================================================
-- Tabla presupuestos_uploads (historial de cargas del Excel)
-- ================================================================
create table if not exists public.presupuestos_uploads (
  id            uuid primary key default gen_random_uuid(),
  anio          int not null,
  mes           int not null check (mes between 1 and 12),
  semana_label  text,                     -- ej. "Sem 36 (Sept 1-7)"
  nombre_archivo text,
  subido_por    uuid references public.personal(id) on delete set null,
  presupuesto_total numeric,
  horas_total   numeric,
  venta_por_hora numeric,
  created_at    timestamptz not null default now()
);

create index if not exists presupuestos_uploads_periodo_idx
  on public.presupuestos_uploads (anio desc, mes desc, created_at desc);

-- ================================================================
-- Tabla presupuestos_semanales (por asesor por semana)
-- ================================================================
create table if not exists public.presupuestos_semanales (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid references public.presupuestos_uploads(id) on delete cascade,
  persona_id    uuid not null references public.personal(id) on delete cascade,
  anio          int not null,
  mes           int not null check (mes between 1 and 12),
  semana_label  text not null,            -- "Sem 36 (Sept 1-7)"
  meta          numeric,                  -- presupuesto asignado
  venta         numeric,                  -- venta acumulada
  cumplimiento  numeric,                  -- venta / meta (0..1+)
  horas_reportadas numeric,               -- horas del Excel
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists presupuestos_sem_persona_idx
  on public.presupuestos_semanales (persona_id, anio desc, mes desc);
create index if not exists presupuestos_sem_periodo_idx
  on public.presupuestos_semanales (anio desc, mes desc);

drop trigger if exists set_updated_at on public.presupuestos_semanales;
create trigger set_updated_at
  before update on public.presupuestos_semanales
  for each row execute function public.tg_set_updated_at();

-- ================================================================
-- Tabla presupuestos_diarios (por fecha del negocio)
-- ================================================================
create table if not exists public.presupuestos_diarios (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null unique,
  meta          numeric,                  -- presupuesto asignado al día
  venta         numeric,                  -- venta cerrada
  accesorios_pct numeric,                 -- % venta accesorios
  ropa_pct      numeric,                  -- % venta ropa
  responsable_id uuid references public.personal(id) on delete set null,
  registrado_por uuid references public.personal(id) on delete set null,
  notas         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists presupuestos_dia_fecha_idx
  on public.presupuestos_diarios (fecha desc);

drop trigger if exists set_updated_at on public.presupuestos_diarios;
create trigger set_updated_at
  before update on public.presupuestos_diarios
  for each row execute function public.tg_set_updated_at();

-- ================================================================
-- Grants para service_role (Edge Functions)
-- ================================================================
grant all on public.presupuestos_uploads     to service_role;
grant all on public.presupuestos_semanales   to service_role;
grant all on public.presupuestos_diarios     to service_role;

-- ================================================================
-- Row Level Security
-- ================================================================
alter table public.presupuestos_uploads     enable row level security;
alter table public.presupuestos_semanales   enable row level security;
alter table public.presupuestos_diarios     enable row level security;

-- Limpieza idempotente
drop policy if exists "jefatura all uploads"   on public.presupuestos_uploads;
drop policy if exists "jefatura all sem"       on public.presupuestos_semanales;
drop policy if exists "asesor select sem own"  on public.presupuestos_semanales;
drop policy if exists "jefatura all dia"       on public.presupuestos_diarios;
drop policy if exists "asesor select dia"      on public.presupuestos_diarios;

-- Jefatura: acceso total a las 3 tablas
create policy "jefatura all uploads" on public.presupuestos_uploads
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "jefatura all sem" on public.presupuestos_semanales
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "jefatura all dia" on public.presupuestos_diarios
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Asesor: solo puede ver SUS filas semanales
create policy "asesor select sem own" on public.presupuestos_semanales
  for select to authenticated
  using (persona_id = (
    select id from public.personal where auth_user_id = auth.uid() limit 1
  ));

-- Asesor: puede ver TODOS los presupuestos diarios (info operativa compartida)
create policy "asesor select dia" on public.presupuestos_diarios
  for select to authenticated
  using (true);
