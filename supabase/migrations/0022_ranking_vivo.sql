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
