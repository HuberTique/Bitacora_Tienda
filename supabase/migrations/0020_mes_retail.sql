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
