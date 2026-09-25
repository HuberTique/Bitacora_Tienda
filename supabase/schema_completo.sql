-- ==============================================================
-- Esquema completo de Bitacora Digital (migraciones 0001 a 0024 en orden).
-- Para una base de datos NUEVA: pegar todo en Supabase > SQL Editor y ejecutar.
-- Generado con: cat supabase/migrations/*.sql
-- ==============================================================

-- ---------- 0001_personal.sql ----------
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

-- ---------- 0002_personal_grants.sql ----------
-- 0002_personal_grants.sql
-- Fix: GRANTs explícitos para public.personal
--
-- Contexto: en el rediseño de Supabase (nuevas API keys publishable/secret),
-- las tablas creadas vía SQL no reciben grants automáticos. El service_role
-- key falla con "permission denied for table personal" al intentar insertar,
-- porque Postgres niega el acceso antes de evaluar RLS.
--
-- RLS sigue vigente (definido en 0001) — estos GRANTs solo dan el permiso base
-- para tocar la tabla; RLS filtra qué filas puede ver/modificar cada rol.

grant all privileges on public.personal to service_role;
grant all privileges on public.personal to authenticated;

-- anon NO recibe acceso directo a la tabla — solo puede llamar
-- la función public.roster_publico() (ya grantada en 0001).

-- ---------- 0003_pendientes.sql ----------
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

-- ---------- 0004_cedula_optional.sql ----------
-- 0004_cedula_optional.sql
-- Fase 1 — bulk import
--
-- La cédula deja de ser obligatoria. En la práctica muchas personas se
-- registran antes de que jefatura tenga sus datos completos de RRHH.
-- La restricción UNIQUE sigue vigente (Postgres trata múltiples NULL como
-- distintos, así que múltiples filas sin cédula conviven sin chocar; las
-- que sí tienen cédula siguen protegidas contra duplicados).

alter table public.personal alter column cedula drop not null;

-- ---------- 0005_feedbacks.sql ----------
-- 0005_feedbacks.sql
-- Fase 1 — módulo Feedbacks (Sprint 1: registro manual + escalamiento)
-- Idempotente.

-- ================================================================
-- Matriz de faltas (viene sembrada con DEFAULT_FALTAS_CONFIG del artifact)
-- Cada tipo tiene su ladder = pasos escalonados de acción disciplinaria.
-- ================================================================
create table if not exists public.faltas_config (
  tipo_id           text primary key,
  nombre            text not null,
  requiere_minutos  boolean not null default false,
  ladder            text[] not null,
  posicion          integer not null default 0
);

alter table public.faltas_config enable row level security;
grant all privileges on public.faltas_config to service_role, authenticated;

drop policy if exists "authenticated_read_faltas" on public.faltas_config;
create policy "authenticated_read_faltas"
  on public.faltas_config for select to authenticated using (true);

drop policy if exists "jefatura_write_faltas" on public.faltas_config;
create policy "jefatura_write_faltas"
  on public.faltas_config for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Seed inicial (idempotente vía on conflict do nothing — no sobrescribe
-- ajustes que jefatura haya hecho en producción)
insert into public.faltas_config (tipo_id, nombre, requiere_minutos, ladder, posicion) values
  ('llegada_menor10', 'Llegada tarde menor a 10 min',                      true,
   array['Feedback Verbal','Feedback Escrito','Feedback Escrito (DSM)','Descargos por escrito'], 1),
  ('llegada_10_45',   'Llegada tarde mayor a 10 y menor a 45 min',         true,
   array['Feedback Escrito (DSM)','Descargos por escrito'], 2),
  ('llegada_mayor45', 'Llegada tarde mayor a 45 min',                      true,
   array['Descargos por escrito'], 3),
  ('ausencia_total',  'Ausencia total',                                    false,
   array['Descargos por escrito'], 4),
  ('ausencia_parcial','Ausencia parcial (abandono de turno)',              false,
   array['Descargos por escrito'], 5),
  ('traspasos',       'Traspasos',                                         false,
   array['Feedback Verbal (1ra vez, P. de trabajo)','Feedback Escrito (reiterado)','Descargos (sujeto a revisión)'], 6),
  ('irrespeto_violencia','Actos de irrespeto y/o violencia',               false,
   array['Descargos'], 7)
on conflict (tipo_id) do nothing;

-- ================================================================
-- Retardos / faltas registradas (una fila por incidencia)
-- ================================================================
create table if not exists public.retardos (
  id              uuid primary key default gen_random_uuid(),
  persona_id      uuid not null references public.personal(id)      on delete restrict,
  tipo_id         text not null references public.faltas_config(tipo_id) on delete restrict,
  fecha           date not null,
  minutos         integer,
  observacion     text not null default '',
  ocurrencia      integer not null,
  accion          text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente','realizada')),
  registrado_por  uuid not null references public.personal(id)      on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists retardos_persona_idx on public.retardos (persona_id);
create index if not exists retardos_fecha_idx   on public.retardos (fecha desc);
create index if not exists retardos_tipo_idx    on public.retardos (tipo_id);
create index if not exists retardos_estado_idx  on public.retardos (estado);

drop trigger if exists set_updated_at on public.retardos;
create trigger set_updated_at
  before update on public.retardos
  for each row execute function public.tg_set_updated_at();

alter table public.retardos enable row level security;
grant all privileges on public.retardos to service_role, authenticated;

drop policy if exists "jefatura_all_retardos"   on public.retardos;
drop policy if exists "asesor_read_own_retardos" on public.retardos;

create policy "jefatura_all_retardos"
  on public.retardos for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "asesor_read_own_retardos"
  on public.retardos for select to authenticated
  using (persona_id = public.current_persona_id());

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='retardos'
  ) then
    alter publication supabase_realtime add table public.retardos;
  end if;
end $$;

-- ================================================================
-- RPC: escalamiento — cuenta previos vigentes y devuelve (ocurrencia, accion)
--
-- vigenciaMeses hardcoded a 4 (matches DEFAULT_FALTAS_CONFIG del artifact).
-- Cuando queramos hacer esto configurable, agregamos una tabla de settings
-- y leemos el valor aquí — la firma pública no cambia.
--
-- SECURITY DEFINER porque necesita ver TODOS los retardos de la persona
-- (bypassa RLS del asesor). Se llama antes de insertar una nueva falta.
-- ================================================================
create or replace function public.compute_ocurrencia(
  p_persona_id uuid,
  p_tipo_id    text,
  p_fecha      date
) returns table (ocurrencia integer, accion text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vigencia_meses int := 4;
  v_ladder text[];
  v_count  int;
  v_n      int;
  v_accion text;
begin
  select ladder into v_ladder from public.faltas_config where tipo_id = p_tipo_id;
  if v_ladder is null then
    raise exception 'Tipo de falta no existe: %', p_tipo_id;
  end if;

  select count(*) into v_count
  from public.retardos r
  where r.persona_id = p_persona_id
    and r.tipo_id    = p_tipo_id
    and r.fecha     <= p_fecha
    and r.fecha     >= (p_fecha - make_interval(months => v_vigencia_meses));

  v_n      := v_count + 1;
  v_accion := v_ladder[least(v_n, array_length(v_ladder, 1))];

  return query select v_n, v_accion;
end
$$;

grant execute on function public.compute_ocurrencia(uuid, text, date) to authenticated;

-- ---------- 0006_horarios.sql ----------
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

-- ---------- 0007_rol_jerarquico.sql ----------
-- 0007_rol_jerarquico.sql
-- Fase 2 — Horarios
-- Añade columna estructurada `rol_jerarquico` a personal para reemplazar la
-- inferencia frágil desde texto libre (`cargo`). El campo `cargo` se conserva
-- porque sigue portando info libre (TEMPORAL, EMBARQUE OFICIAL, APOYO DSM,
-- especialidad, etc.), pero YA NO se usa para clasificar en generador ni
-- exportador de horarios — eso lo determina `rol_jerarquico`.
--
-- Nivel de seguridad derivado (no persistido, calculado en app):
--   jefe_tienda = 5, subjefe = 4, cajero = 4, full_time = 3, part_time = 2.

-- ================================================================
-- Enum + columna
-- ================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rol_jerarquico_t') then
    create type public.rol_jerarquico_t as enum (
      'jefe_tienda',
      'subjefe',
      'cajero',
      'full_time',
      'part_time'
    );
  end if;
end
$$;

alter table public.personal
  add column if not exists rol_jerarquico public.rol_jerarquico_t;

-- ================================================================
-- Backfill desde `cargo` (heurística que jefatura puede corregir a mano
-- después desde /personal → Editar).
-- ================================================================
update public.personal
set rol_jerarquico = case
  when upper(cargo) like '%SUB%JEFE%' then 'subjefe'::rol_jerarquico_t
  when upper(cargo) like '%JEFE%'      then 'jefe_tienda'::rol_jerarquico_t
  when upper(cargo) like '%CAJERO%'    then 'cajero'::rol_jerarquico_t
  when upper(cargo) like '%PART%TIME%' then 'part_time'::rol_jerarquico_t
  when upper(cargo) like '%PART-TIME%' then 'part_time'::rol_jerarquico_t
  else 'full_time'::rol_jerarquico_t
end
where rol_jerarquico is null;

alter table public.personal
  alter column rol_jerarquico set default 'full_time'::rol_jerarquico_t,
  alter column rol_jerarquico set not null;

create index if not exists personal_rol_jerarquico_idx
  on public.personal (rol_jerarquico);

-- ================================================================
-- RPC roster_publico incluye el nuevo campo para que el login lo tenga
-- (si se necesita más adelante para lógica cliente).
-- ================================================================
drop function if exists public.roster_publico();

create or replace function public.roster_publico()
returns table (
  id uuid,
  nombre text,
  cargo text,
  rol text,
  rol_jerarquico text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, nombre, cargo, rol, rol_jerarquico::text
  from public.personal
  where activo = true
  order by nombre;
$$;

grant execute on function public.roster_publico() to anon, authenticated;

-- ---------- 0008_presupuestos.sql ----------
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

-- ---------- 0009_presupuestos_grants.sql ----------
-- 0009_presupuestos_grants.sql
-- Fix de 0008: faltó grant a authenticated. RLS controla qué filas se
-- pueden leer/escribir, pero el usuario primero necesita permiso base
-- sobre la tabla (Postgres GRANT). Sin esto, cualquier consulta desde
-- el cliente falla con "permission denied for table".

grant select, insert, update, delete on public.presupuestos_uploads   to authenticated;
grant select, insert, update, delete on public.presupuestos_semanales to authenticated;
grant select, insert, update, delete on public.presupuestos_diarios   to authenticated;

-- ---------- 0010_ventas_asesor.sql ----------
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

-- ---------- 0011_codigos_alternos_distribucion.sql ----------
-- 0011_codigos_alternos_distribucion.sql
-- Fase 2 sprint 4a — Extensión de personal_codigos_alternos
--
-- Añade:
--   - distribucion_pct: cuando un mismo código se comparte entre varios
--     asesores (ej. código de DSM/Jefe usado por 3 asesores nuevos),
--     jefatura reparte la venta del código en porcentajes que definen a
--     criterio. Un solo asesor con el código completo = 1.0 (100%).
--   - estado + aprobado_por + aprobado_at: workflow de aprobación por
--     jefatura. Por default estado='aprobado' cuando lo crea jefatura
--     directo; si en el futuro un asesor puede solicitarlo, entra como
--     'pendiente' hasta que jefatura confirme.
--
-- Idempotente.

alter table public.personal_codigos_alternos
  add column if not exists distribucion_pct numeric not null default 1.0
    check (distribucion_pct > 0 and distribucion_pct <= 1),
  add column if not exists estado text not null default 'aprobado'
    check (estado in ('pendiente','aprobado','rechazado')),
  add column if not exists aprobado_por uuid references public.personal(id) on delete set null,
  add column if not exists aprobado_at timestamptz;

-- Cuando se crea directo por jefatura, aprobado_at = created_at
update public.personal_codigos_alternos
set aprobado_at = created_at
where estado = 'aprobado' and aprobado_at is null;

-- Ya no debería ser unique por (codigo, persona_id) porque varias filas
-- pueden compartir el mismo código con distintos porcentajes — pero SÍ
-- debe evitar duplicados exactos (misma persona + mismo código).
-- El unique index de 0010 ya cubre eso, lo dejamos.

-- Nuevo índice: acelera la lectura al procesar ventas del PDF (buscar
-- todas las asignaciones activas de un código).
create index if not exists personal_codigos_alternos_codigo_idx
  on public.personal_codigos_alternos (codigo)
  where estado = 'aprobado';

-- ================================================================
-- Función helper: valida que la suma de distribuciones aprobadas de
-- un mismo código no supere 100%. Se usa como trigger before-insert/update.
-- ================================================================
create or replace function public.check_distribucion_pct()
returns trigger
language plpgsql
as $$
declare
  total numeric;
begin
  if new.estado = 'aprobado' then
    select coalesce(sum(distribucion_pct), 0)
    into total
    from public.personal_codigos_alternos
    where codigo = new.codigo
      and estado = 'aprobado'
      and id <> new.id;
    if total + new.distribucion_pct > 1.0001 then
      raise exception 'La suma de distribuciones aprobadas del código % excedería 100%% (actual %, intentando sumar %). Ajusta los porcentajes de las otras filas primero.',
        new.codigo, round(total * 100, 1), round(new.distribucion_pct * 100, 1);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists check_distribucion_pct_trg on public.personal_codigos_alternos;
create trigger check_distribucion_pct_trg
  before insert or update on public.personal_codigos_alternos
  for each row execute function public.check_distribucion_pct();

-- ---------- 0012_requerimientos_notificaciones.sql ----------
-- 0012_requerimientos_notificaciones.sql
-- Fase 3 — Requerimientos (calendario con aprobación) + Notificaciones.
-- Idempotente.
--
-- `dias_bloqueados` (bloqueo de días por jefatura) ya existe desde
-- 0006_horarios.sql — se reutiliza tal cual, sin cambios.

-- ================================================================
-- Tabla requerimientos
-- ================================================================
create table if not exists public.requerimientos (
  id               uuid primary key default gen_random_uuid(),
  fecha            date not null,
  persona_id       uuid not null references public.personal(id) on delete cascade,
  tipo             text not null check (tipo in ('dia_libre','salida_temprano','permiso','otro')),
  detalle          text not null default '',
  estado           text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  evidencia_path   text,           -- ruta en Storage bucket 'requerimientos-evidencias'
  evidencia_nombre text,
  registrado_por   uuid not null references public.personal(id) on delete set null,
  revisado_por     uuid references public.personal(id) on delete set null,
  fecha_revision   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists requerimientos_fecha_idx on public.requerimientos (fecha);
create index if not exists requerimientos_persona_idx on public.requerimientos (persona_id);
create index if not exists requerimientos_estado_idx on public.requerimientos (estado);

drop trigger if exists set_updated_at on public.requerimientos;
create trigger set_updated_at
  before update on public.requerimientos
  for each row execute function public.tg_set_updated_at();

grant all privileges on public.requerimientos to service_role;
grant all privileges on public.requerimientos to authenticated;

alter table public.requerimientos enable row level security;

drop policy if exists "jefatura all requerimientos"        on public.requerimientos;
drop policy if exists "asesor select own requerimientos"    on public.requerimientos;
drop policy if exists "asesor insert own requerimientos"    on public.requerimientos;
drop policy if exists "asesor update own pendiente"         on public.requerimientos;
drop policy if exists "asesor delete own pendiente"         on public.requerimientos;

-- Jefatura: acceso total (ver todo el equipo, aprobar/rechazar/eliminar).
create policy "jefatura all requerimientos" on public.requerimientos
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Asesor: solo ve sus propios requerimientos.
create policy "asesor select own requerimientos" on public.requerimientos
  for select to authenticated
  using (persona_id = public.current_persona_id());

-- Asesor: puede crear requerimientos propios (la huella registrado_por
-- también debe ser él mismo — evita suplantación).
create policy "asesor insert own requerimientos" on public.requerimientos
  for insert to authenticated
  with check (
    persona_id = public.current_persona_id()
    and registrado_por = public.current_persona_id()
    and estado = 'pendiente'
  );

-- Asesor: puede editar SOLO mientras siga pendiente (una vez revisado, ya
-- no se puede tocar — jefatura queda como única autoridad de ahí en más).
create policy "asesor update own pendiente" on public.requerimientos
  for update to authenticated
  using      (persona_id = public.current_persona_id() and estado = 'pendiente')
  with check (persona_id = public.current_persona_id() and estado = 'pendiente');

-- Asesor: puede eliminar su propio requerimiento mientras siga pendiente.
create policy "asesor delete own pendiente" on public.requerimientos
  for delete to authenticated
  using (persona_id = public.current_persona_id() and estado = 'pendiente');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'requerimientos'
  ) then
    alter publication supabase_realtime add table public.requerimientos;
  end if;
end $$;

-- ================================================================
-- Tabla notificaciones
-- ================================================================
create table if not exists public.notificaciones (
  id                       uuid primary key default gen_random_uuid(),
  tipo                     text not null,
  -- Un destinatario es UNA persona específica, O el conjunto "toda la
  -- jefatura" (broadcast) — nunca ambos a la vez.
  destinatario_persona_id  uuid references public.personal(id) on delete cascade,
  destinatario_jefatura    boolean not null default false,
  mensaje                  text not null,
  ref_fecha                date,
  ref_tabla                text,
  ref_id                   uuid,
  leida                    boolean not null default false,
  created_at               timestamptz not null default now(),
  constraint notificaciones_destinatario_chk check (
    (destinatario_persona_id is not null and destinatario_jefatura = false)
    or (destinatario_persona_id is null and destinatario_jefatura = true)
  )
);

create index if not exists notificaciones_persona_idx on public.notificaciones (destinatario_persona_id);
create index if not exists notificaciones_jefatura_idx on public.notificaciones (destinatario_jefatura);
create index if not exists notificaciones_created_idx on public.notificaciones (created_at desc);

grant all privileges on public.notificaciones to service_role;
grant all privileges on public.notificaciones to authenticated;

alter table public.notificaciones enable row level security;

drop policy if exists "select notificaciones propias" on public.notificaciones;
drop policy if exists "insert notificaciones"          on public.notificaciones;
drop policy if exists "update leida propia"            on public.notificaciones;

-- Cada quien ve las suyas (dirigidas a su persona_id) + las de jefatura si
-- su propio rol es jefatura (broadcast).
create policy "select notificaciones propias" on public.notificaciones
  for select to authenticated
  using (
    destinatario_persona_id = public.current_persona_id()
    or (destinatario_jefatura = true and public.current_persona_rol() = 'jefatura')
  );

-- Cualquier autenticado puede crear una notificación (el mensaje lo arma
-- la app, no el usuario libremente) — mismo nivel de confianza que el
-- resto de la app en este punto del proyecto.
create policy "insert notificaciones" on public.notificaciones
  for insert to authenticated
  with check (true);

-- Solo se puede marcar como leída una notificación propia — no se edita
-- ningún otro campo desde el cliente.
create policy "update leida propia" on public.notificaciones
  for update to authenticated
  using (
    destinatario_persona_id = public.current_persona_id()
    or (destinatario_jefatura = true and public.current_persona_rol() = 'jefatura')
  )
  with check (
    destinatario_persona_id = public.current_persona_id()
    or (destinatario_jefatura = true and public.current_persona_rol() = 'jefatura')
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

-- ================================================================
-- Storage bucket para evidencias de requerimientos (certificados,
-- constancias). Privado — solo el dueño del archivo y jefatura pueden leer.
-- ================================================================
insert into storage.buckets (id, name, public)
values ('requerimientos-evidencias', 'requerimientos-evidencias', false)
on conflict (id) do nothing;

drop policy if exists "leer evidencias propias o jefatura" on storage.objects;
drop policy if exists "subir evidencia propia"             on storage.objects;
drop policy if exists "borrar evidencia propia o jefatura" on storage.objects;

-- Convención de path: "<persona_id>/<requerimiento_id>-<nombre_archivo>"
-- así el primer segmento del path identifica al dueño sin otra tabla.
create policy "leer evidencias propias o jefatura" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'requerimientos-evidencias'
    and (
      (storage.foldername(name))[1] = public.current_persona_id()::text
      or public.current_persona_rol() = 'jefatura'
    )
  );

create policy "subir evidencia propia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'requerimientos-evidencias'
    and (storage.foldername(name))[1] = public.current_persona_id()::text
  );

create policy "borrar evidencia propia o jefatura" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'requerimientos-evidencias'
    and (
      (storage.foldername(name))[1] = public.current_persona_id()::text
      or public.current_persona_rol() = 'jefatura'
    )
  );

-- ---------- 0013_motivo_rechazo.sql ----------
-- 0013_motivo_rechazo.sql
-- Fase 3 — Requerimientos: motivo obligatorio al rechazar.
--
-- Jefatura pidió que un requerimiento rechazado siempre traiga explicación
-- (para que el asesor sepa por qué, no solo que "no"), y que se distinga
-- visualmente en la campana de notificaciones.
--
-- Idempotente.

alter table public.requerimientos
  add column if not exists motivo_rechazo text;

-- ---------- 0014_pendientes_fecha_ejecucion.sql ----------
-- 0014_pendientes_fecha_ejecucion.sql
-- Bitácora: fecha límite de ejecución de un pendiente (opcional), para
-- mostrar cuándo toca ejecutarlo y avisar si ya está vencido.
--
-- Idempotente.

alter table public.pendientes
  add column if not exists fecha_ejecucion date;

-- ---------- 0015_horarios_config.sql ----------
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

-- ---------- 0016_tienda_config.sql ----------
-- 0016_tienda_config.sql
-- Nombre y ciudad de la tienda, editables desde la app (una sola fila).
-- Se lee sin sesión (pantalla de login) y en las Edge Functions de IA.
-- Idempotente.

create table if not exists public.tienda_config (
  id          boolean primary key default true check (id),
  nombre      text not null default 'Outlet de las Américas',
  ciudad      text not null default 'Bogotá, Colombia',
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.tienda_config;
create trigger set_updated_at
  before update on public.tienda_config
  for each row execute function public.tg_set_updated_at();

insert into public.tienda_config (id) values (true) on conflict (id) do nothing;

alter table public.tienda_config enable row level security;
grant select on public.tienda_config to anon;
grant all privileges on public.tienda_config to service_role, authenticated;

drop policy if exists "read_tienda_config"          on public.tienda_config;
drop policy if exists "jefatura_write_tienda_config" on public.tienda_config;

create policy "read_tienda_config"
  on public.tienda_config for select to anon, authenticated using (true);

create policy "jefatura_write_tienda_config"
  on public.tienda_config for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- ---------- 0017_disponibilidad_franjas.sql ----------
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

-- ---------- 0018_ranking_ventas.sql ----------
-- 0018_ranking_ventas.sql
-- Módulo "Ranking de ventas": fotos del personal, KPIs mensuales, evaluación
-- Magia con una sonrisa, checklist del maximizador y configuración del ranking.
-- Idempotente.

-- ================================================================
-- 1) Foto del personal (Storage privado + ruta en personal)
-- ================================================================
alter table public.personal add column if not exists foto_path text;

insert into storage.buckets (id, name, public)
values ('fotos-personal', 'fotos-personal', false)
on conflict (id) do nothing;

drop policy if exists "leer fotos personal"      on storage.objects;
drop policy if exists "subir fotos personal"     on storage.objects;
drop policy if exists "actualizar fotos personal" on storage.objects;
drop policy if exists "borrar fotos personal"    on storage.objects;

-- Todo el equipo ve las fotos (van en el podio); solo jefatura las sube.
create policy "leer fotos personal" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos-personal');

create policy "subir fotos personal" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-personal' and public.current_persona_rol() = 'jefatura');

create policy "actualizar fotos personal" on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos-personal' and public.current_persona_rol() = 'jefatura');

create policy "borrar fotos personal" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-personal' and public.current_persona_rol() = 'jefatura');

-- ================================================================
-- 2) KPIs mensuales por persona (hoja "Kpis mensual" del planeador)
-- ================================================================
create table if not exists public.kpis_mensuales (
  id                uuid primary key default gen_random_uuid(),
  persona_id        uuid not null references public.personal(id) on delete cascade,
  anio              integer not null,
  mes               integer not null check (mes between 1 and 12),
  presupuesto       numeric,
  acumulado_bruto   numeric,
  acumulado_neto    numeric,
  cumplimiento      numeric,   -- 0..1+ (acumulado neto / presupuesto)
  pares_meta        numeric,
  pares_venta       numeric,
  acc_meta          numeric,
  acc_venta         numeric,
  ropa_meta         numeric,
  ropa_venta        numeric,
  unidades          numeric,
  trx               numeric,
  upt               numeric,
  horas             numeric,
  subido_por        uuid references public.personal(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (persona_id, anio, mes)
);

create index if not exists kpis_mensuales_periodo_idx on public.kpis_mensuales (anio, mes);

drop trigger if exists set_updated_at on public.kpis_mensuales;
create trigger set_updated_at
  before update on public.kpis_mensuales
  for each row execute function public.tg_set_updated_at();

alter table public.kpis_mensuales enable row level security;
grant all privileges on public.kpis_mensuales to service_role, authenticated;

drop policy if exists "leer kpis mensuales"        on public.kpis_mensuales;
drop policy if exists "jefatura escribe kpis mens" on public.kpis_mensuales;

-- El ranking es visible para todo el equipo.
create policy "leer kpis mensuales" on public.kpis_mensuales
  for select to authenticated using (true);

create policy "jefatura escribe kpis mens" on public.kpis_mensuales
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- ================================================================
-- 3) Magia con una sonrisa (evaluación del vendedor, 2 por mes)
--    Escala 1..4 en cada criterio (M-A-G-I-A) + impresión final.
-- ================================================================
create table if not exists public.magia_evaluaciones (
  id               uuid primary key default gen_random_uuid(),
  persona_id       uuid not null references public.personal(id) on delete cascade,
  evaluador_id     uuid references public.personal(id) on delete set null,
  anio             integer not null,
  mes              integer not null check (mes between 1 and 12),
  numero           integer not null check (numero in (1, 2)),
  fecha            date not null default current_date,
  c_sonrisa        integer not null check (c_sonrisa between 1 and 4),
  c_preguntas      integer not null check (c_preguntas between 1 and 4),
  c_experiencia    integer not null check (c_experiencia between 1 and 4),
  c_tecnologias    integer not null check (c_tecnologias between 1 and 4),
  c_cierre         integer not null check (c_cierre between 1 and 4),
  impresion_final  integer not null check (impresion_final between 1 and 4),
  fortalezas       text not null default '',
  oportunidades    text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (persona_id, anio, mes, numero)
);

drop trigger if exists set_updated_at on public.magia_evaluaciones;
create trigger set_updated_at
  before update on public.magia_evaluaciones
  for each row execute function public.tg_set_updated_at();

alter table public.magia_evaluaciones enable row level security;
grant all privileges on public.magia_evaluaciones to service_role, authenticated;

drop policy if exists "jefatura all magia"       on public.magia_evaluaciones;
drop policy if exists "asesor lee su magia"      on public.magia_evaluaciones;

create policy "jefatura all magia" on public.magia_evaluaciones
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "asesor lee su magia" on public.magia_evaluaciones
  for select to authenticated
  using (persona_id = public.current_persona_id());

-- ================================================================
-- 4) Maximizador: checklist configurable + registro diario
-- ================================================================
create table if not exists public.maximizador_items (
  id         uuid primary key default gen_random_uuid(),
  texto      text not null,
  activo     boolean not null default true,
  posicion   integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.maximizador_items enable row level security;
grant all privileges on public.maximizador_items to service_role, authenticated;

drop policy if exists "leer items maximizador"        on public.maximizador_items;
drop policy if exists "jefatura escribe items maxim"  on public.maximizador_items;

create policy "leer items maximizador" on public.maximizador_items
  for select to authenticated using (true);

create policy "jefatura escribe items maxim" on public.maximizador_items
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Ítems iniciales (solo si la tabla está vacía; jefatura los edita en la app).
insert into public.maximizador_items (texto, posicion)
select t.texto, t.pos
from (values
  ('Realizó la OPM (reunión de apertura) al inicio del turno', 1),
  ('Revisó en la OPM el presupuesto pendiente del día', 2),
  ('Socializó la información y los comunicados al equipo', 3),
  ('Hizo seguimiento a la venta por hora frente a la meta', 4),
  ('Impulsó la venta de accesorios y ropa (A&A) durante el turno', 5),
  ('Entregó datos y resultados al equipo durante el día', 6),
  ('Diligenció la planificación diaria y su firma por franja', 7)
) as t(texto, pos)
where not exists (select 1 from public.maximizador_items);

create table if not exists public.maximizador_registros (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null,
  persona_id    uuid not null references public.personal(id) on delete cascade,
  evaluador_id  uuid references public.personal(id) on delete set null,
  items         jsonb not null default '{}'::jsonb,   -- { "<item_id>": true|false }
  puntaje       numeric not null default 0,           -- 0..1 (ítems cumplidos / evaluados)
  observaciones text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (fecha, persona_id)
);

create index if not exists maximizador_registros_fecha_idx on public.maximizador_registros (fecha);

drop trigger if exists set_updated_at on public.maximizador_registros;
create trigger set_updated_at
  before update on public.maximizador_registros
  for each row execute function public.tg_set_updated_at();

alter table public.maximizador_registros enable row level security;
grant all privileges on public.maximizador_registros to service_role, authenticated;

drop policy if exists "jefatura all maximizador"   on public.maximizador_registros;
drop policy if exists "asesor lee su maximizador"  on public.maximizador_registros;

create policy "jefatura all maximizador" on public.maximizador_registros
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "asesor lee su maximizador" on public.maximizador_registros
  for select to authenticated
  using (persona_id = public.current_persona_id());

-- ================================================================
-- 5) Configuración del ranking (una sola fila)
--    Pesos de cada componente del puntaje final y meta de UPT.
-- ================================================================
create table if not exists public.ranking_config (
  id                boolean primary key default true check (id),
  peso_ventas       numeric not null default 40 check (peso_ventas >= 0),
  peso_upt          numeric not null default 10 check (peso_upt >= 0),
  peso_magia        numeric not null default 25 check (peso_magia >= 0),
  peso_puntualidad  numeric not null default 15 check (peso_puntualidad >= 0),
  peso_maximizador  numeric not null default 10 check (peso_maximizador >= 0),
  upt_meta          numeric not null default 1.5 check (upt_meta > 0),
  updated_at        timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.ranking_config;
create trigger set_updated_at
  before update on public.ranking_config
  for each row execute function public.tg_set_updated_at();

insert into public.ranking_config (id) values (true) on conflict (id) do nothing;

alter table public.ranking_config enable row level security;
grant all privileges on public.ranking_config to service_role, authenticated;

drop policy if exists "leer ranking config"        on public.ranking_config;
drop policy if exists "jefatura escribe ranking config" on public.ranking_config;

create policy "leer ranking config" on public.ranking_config
  for select to authenticated using (true);

create policy "jefatura escribe ranking config" on public.ranking_config
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- ================================================================
-- 6) Funciones de resumen para el ranking (SECURITY DEFINER)
--    El ranking es visible para todo el equipo, pero el detalle de
--    evaluaciones y faltas es privado. Estas funciones devuelven SOLO
--    agregados por persona.
-- ================================================================

-- Magia: promedio del mes sobre 24 puntos (5 criterios + impresión final, 1..4).
create or replace function public.ranking_magia(p_anio integer, p_mes integer)
returns table (persona_id uuid, promedio numeric, evaluaciones integer)
language sql stable security definer set search_path = public
as $$
  select m.persona_id,
         avg(m.c_sonrisa + m.c_preguntas + m.c_experiencia + m.c_tecnologias
             + m.c_cierre + m.impresion_final)::numeric as promedio,
         count(*)::integer as evaluaciones
  from public.magia_evaluaciones m
  where m.anio = p_anio and m.mes = p_mes
  group by m.persona_id;
$$;

-- Maximizador: puntaje promedio (0..1) y días en que ejerció la función.
create or replace function public.ranking_maximizador(p_anio integer, p_mes integer)
returns table (persona_id uuid, puntaje numeric, dias integer)
language sql stable security definer set search_path = public
as $$
  select r.persona_id, avg(r.puntaje)::numeric, count(*)::integer
  from public.maximizador_registros r
  where extract(year from r.fecha) = p_anio and extract(month from r.fecha) = p_mes
  group by r.persona_id;
$$;

-- Puntualidad y llamados de atención: puntos de penalización por falta del mes
-- (llegadas tarde, ausencias, etc.). Solo devuelve el total, no el detalle.
create or replace function public.ranking_faltas(p_anio integer, p_mes integer)
returns table (persona_id uuid, faltas integer, penalizacion numeric)
language sql stable security definer set search_path = public
as $$
  select r.persona_id,
         count(*)::integer,
         sum(case r.tipo_id
               when 'llegada_menor10'      then 10
               when 'llegada_10_45'        then 20
               when 'llegada_mayor45'      then 35
               when 'ausencia_parcial'     then 35
               when 'ausencia_total'       then 50
               when 'traspasos'            then 15
               when 'irrespeto_violencia'  then 100
               else 20
             end)::numeric
  from public.retardos r
  where extract(year from r.fecha) = p_anio and extract(month from r.fecha) = p_mes
  group by r.persona_id;
$$;

grant execute on function public.ranking_magia(integer, integer)       to authenticated;
grant execute on function public.ranking_maximizador(integer, integer) to authenticated;
grant execute on function public.ranking_faltas(integer, integer)      to authenticated;

-- ================================================================
-- 7) roster_publico() ahora incluye la foto (para el podio)
-- ================================================================
drop function if exists public.roster_publico();

create or replace function public.roster_publico()
returns table (
  id uuid,
  nombre text,
  cargo text,
  rol text,
  rol_jerarquico text,
  foto_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, nombre, cargo, rol, rol_jerarquico::text, foto_path
  from public.personal
  where activo = true
  order by nombre;
$$;

grant execute on function public.roster_publico() to anon, authenticated;

-- ---------- 0019_ranking_extras.sql ----------
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

-- ---------- 0020_mes_retail.sql ----------
-- 0020_mes_retail.sql
-- Mes RETAIL: el calendario de la compañía no coincide con el mes calendario.
-- Ej.: el "mes de septiembre" del planeador va del 30-ago al 3-oct (5 semanas
-- de domingo a sábado). Esta tabla guarda el rango de cada mes retail (se lee
-- de la hoja "Target" del planeador) y sus semanas, para que ventas, KPIs y
-- ranking se calculen sobre el periodo correcto.
-- Idempotente.

create table if not exists public.meses_retail (
  anio        integer not null,
  mes         integer not null check (mes between 1 and 12),  -- mes retail (1..12)
  nombre      text not null,
  inicio      date not null,
  fin         date not null,
  presupuesto numeric,
  tienda      text,
  semanas     jsonb not null default '[]'::jsonb,  -- [{numero, inicio, fin, target, anio_anterior, real}]
  updated_at  timestamptz not null default now(),
  primary key (anio, mes),
  check (fin >= inicio)
);

drop trigger if exists set_updated_at on public.meses_retail;
create trigger set_updated_at
  before update on public.meses_retail
  for each row execute function public.tg_set_updated_at();

alter table public.meses_retail enable row level security;
grant all privileges on public.meses_retail to service_role, authenticated;

drop policy if exists "leer meses retail"        on public.meses_retail;
drop policy if exists "jefatura escribe meses retail" on public.meses_retail;

create policy "leer meses retail" on public.meses_retail
  for select to authenticated using (true);

create policy "jefatura escribe meses retail" on public.meses_retail
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Presupuesto diario de la tienda: además de la meta y la venta, el planeador
-- trae la venta del año anterior y la venta con IVA de cada día.
alter table public.presupuestos_diarios
  add column if not exists anio_anterior numeric,
  add column if not exists venta_con_iva numeric;

-- Resúmenes del ranking por RANGO DE FECHAS (mes retail) en lugar de mes calendario.
create or replace function public.ranking_maximizador(p_desde date, p_hasta date)
returns table (persona_id uuid, puntaje numeric, dias integer)
language sql stable security definer set search_path = public
as $$
  select r.persona_id, avg(r.puntaje)::numeric, count(*)::integer
  from public.maximizador_registros r
  where r.fecha between p_desde and p_hasta
  group by r.persona_id;
$$;

create or replace function public.ranking_faltas(p_desde date, p_hasta date)
returns table (persona_id uuid, faltas integer, penalizacion numeric)
language sql stable security definer set search_path = public
as $$
  select r.persona_id,
         count(*)::integer,
         sum(case r.tipo_id
               when 'llegada_menor10'      then 10
               when 'llegada_10_45'        then 20
               when 'llegada_mayor45'      then 35
               when 'ausencia_parcial'     then 35
               when 'ausencia_total'       then 50
               when 'traspasos'            then 15
               when 'irrespeto_violencia'  then 100
               else 20
             end)::numeric
  from public.retardos r
  where r.fecha between p_desde and p_hasta
  group by r.persona_id;
$$;

grant execute on function public.ranking_maximizador(date, date) to authenticated;
grant execute on function public.ranking_faltas(date, date)      to authenticated;

-- ---------- 0021_carga_planeador.sql ----------
-- 0021_carga_planeador.sql
-- Trazabilidad de la carga del planeador: qué archivo se subió, quién, cuándo y
-- hasta qué fecha llegan los datos ("fecha de corte"). Con eso se puede juzgar
-- el cumplimiento a la fecha y no contra el mes completo.
-- Idempotente.

alter table public.meses_retail
  add column if not exists archivo        text,
  add column if not exists cargado_por    uuid references public.personal(id) on delete set null,
  add column if not exists cargado_en     timestamptz,
  add column if not exists fecha_corte    date,
  add column if not exists meta_a_corte   numeric,   -- suma de la meta diaria hasta la fecha de corte
  add column if not exists venta_a_corte  numeric;   -- venta real acumulada hasta la fecha de corte

alter table public.presupuestos_uploads
  add column if not exists fecha_corte date;

-- ---------- 0022_ranking_vivo.sql ----------
-- 0022_ranking_vivo.sql
-- El ranking se alimenta de los cierres del día que se van cargando (PDF/fotos)
-- y no de las cifras acumuladas de un Excel. Estas funciones devuelven SOLO
-- agregados (el detalle por día sigue siendo privado de cada asesor).
-- Idempotente.

-- Venta acumulada por persona en un rango de fechas (mes retail).
create or replace function public.ranking_ventas(p_desde date, p_hasta date)
returns table (persona_id uuid, venta numeric, articulos numeric, dias integer, ultimo_dia date)
language sql stable security definer set search_path = public
as $$
  select v.persona_id,
         coalesce(sum(v.venta), 0)::numeric,
         coalesce(sum(v.articulos), 0)::numeric,
         (count(*) filter (where coalesce(v.venta, 0) > 0))::integer,
         max(v.fecha)
  from public.ventas_asesor_dia v
  where v.fecha between p_desde and p_hasta
  group by v.persona_id;
$$;

-- Avance del mes: hasta qué día hay cierres cargados y cuánto debía llevarse
-- de la meta a esa fecha (suma de la meta diaria hasta el último cierre).
create or replace function public.ranking_avance(p_desde date, p_hasta date)
returns table (
  ultimo_cierre  date,
  dias_cerrados  integer,
  meta_total     numeric,
  meta_a_cierre  numeric,
  venta_total    numeric
)
language sql stable security definer set search_path = public
as $$
  with cierres as (
    select v.fecha, sum(v.venta) as venta
    from public.ventas_asesor_dia v
    where v.fecha between p_desde and p_hasta
    group by v.fecha
  ),
  ult as (select max(fecha) as f from cierres)
  select
    (select f from ult),
    (select count(*) from cierres)::integer,
    coalesce((select sum(d.meta) from public.presupuestos_diarios d
              where d.fecha between p_desde and p_hasta), 0)::numeric,
    coalesce((select sum(d.meta) from public.presupuestos_diarios d
              where d.fecha between p_desde and (select f from ult)), 0)::numeric,
    coalesce((select sum(venta) from cierres), 0)::numeric;
$$;

grant execute on function public.ranking_ventas(date, date)  to authenticated;
grant execute on function public.ranking_avance(date, date)  to authenticated;

-- ---------- 0023_ventas_consolidadas.sql ----------
-- 0023_ventas_consolidadas.sql
-- Carga de "Visión general de ventas" (ventas consolidadas del mes retail hasta una
-- fecha de corte): venta neta por asesor y por tipo (pares, ropa, accesorios).
-- Idempotente.

alter table public.kpis_mensuales
  add column if not exists corte_ventas date;      -- fecha hasta la que llegan las ventas cargadas

alter table public.meses_retail
  add column if not exists ventas_archivo     text,
  add column if not exists ventas_cargado_por uuid references public.personal(id) on delete set null,
  add column if not exists ventas_cargado_en  timestamptz,
  add column if not exists ventas_corte       date,
  add column if not exists ventas_total       numeric;   -- venta neta TOTAL de la tienda según el reporte (incluye a todos)

-- ranking_avance ahora admite una fecha de corte (la de las ventas consolidadas): el avance
-- del mes es la meta acumulada hasta la fecha más reciente entre ese corte y el último
-- cierre del día cargado.
drop function if exists public.ranking_avance(date, date);

create or replace function public.ranking_avance(p_desde date, p_hasta date, p_corte date default null)
returns table (
  ultimo_cierre  date,
  dias_cerrados  integer,
  meta_total     numeric,
  meta_a_cierre  numeric,
  venta_total    numeric
)
language sql stable security definer set search_path = public
as $$
  with cierres as (
    select v.fecha, sum(v.venta) as venta
    from public.ventas_asesor_dia v
    where v.fecha between p_desde and p_hasta
    group by v.fecha
  ),
  ult as (select greatest(p_corte, (select max(fecha) from cierres)) as f)
  select
    (select f from ult),
    (select count(*) from cierres)::integer,
    coalesce((select sum(d.meta) from public.presupuestos_diarios d
              where d.fecha between p_desde and p_hasta), 0)::numeric,
    coalesce((select sum(d.meta) from public.presupuestos_diarios d
              where d.fecha between p_desde and (select f from ult)), 0)::numeric,
    coalesce((select sum(venta) from cierres), 0)::numeric;
$$;

grant execute on function public.ranking_avance(date, date, date) to authenticated;

-- ---------- 0024_cerrar_rpc_anonimas.sql ----------
-- 0024_cerrar_rpc_anonimas.sql
-- Las funciones del ranking son SECURITY DEFINER y Postgres las deja ejecutables por PUBLIC
-- (incluye "anon") aunque se haga grant solo a "authenticated". Una prueba con la llave pública
-- (sin sesión) devolvía la venta de cada asesor. Se revoca el acceso anónimo y se deja solo a
-- quienes inician sesión. roster_publico() se conserva abierta: el login la usa para listar personas.
-- Idempotente.

revoke execute on function public.ranking_magia(integer, integer)       from public, anon;
revoke execute on function public.ranking_maximizador(integer, integer) from public, anon;
revoke execute on function public.ranking_faltas(integer, integer)      from public, anon;
revoke execute on function public.ranking_semanal(integer, integer)     from public, anon;
revoke execute on function public.ranking_maximizador(date, date)       from public, anon;
revoke execute on function public.ranking_faltas(date, date)            from public, anon;
revoke execute on function public.ranking_ventas(date, date)            from public, anon;
revoke execute on function public.ranking_avance(date, date, date)      from public, anon;
revoke execute on function public.confirmar_magia(uuid, text)           from public, anon;

grant execute on function public.ranking_magia(integer, integer)       to authenticated;
grant execute on function public.ranking_maximizador(integer, integer) to authenticated;
grant execute on function public.ranking_faltas(integer, integer)      to authenticated;
grant execute on function public.ranking_semanal(integer, integer)     to authenticated;
grant execute on function public.ranking_maximizador(date, date)       to authenticated;
grant execute on function public.ranking_faltas(date, date)            to authenticated;
grant execute on function public.ranking_ventas(date, date)            to authenticated;
grant execute on function public.ranking_avance(date, date, date)      to authenticated;
grant execute on function public.confirmar_magia(uuid, text)           to authenticated;
