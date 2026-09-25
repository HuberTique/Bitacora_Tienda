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
