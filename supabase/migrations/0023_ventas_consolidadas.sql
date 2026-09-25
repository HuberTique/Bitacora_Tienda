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
