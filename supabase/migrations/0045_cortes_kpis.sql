-- 0045_cortes_kpis.sql
--
-- Resultados por día, semana y mes (Huber, 8-oct-2026). La consolidada ("Visión general de
-- ventas") y el informe de Xstore ("Productividad de empleado") son ACUMULADOS del mes hasta
-- una fecha de corte. Para saber qué se vendió en una semana se guarda cada carga como un CORTE
-- (foto por persona en esa fecha): la semana = el corte del sábado − el corte del sábado anterior.
-- La venta en pesos no necesita cortes: sale de los cierres del día.
--
-- Idempotente.

create table if not exists public.cortes_kpis (
  id          uuid primary key default gen_random_uuid(),
  tienda_id   uuid not null default public.current_tienda_id() references public.tiendas(id) on delete cascade,
  anio        integer not null,
  mes         integer not null check (mes between 1 and 12),
  fuente      text not null check (fuente in ('consolidada', 'xstore')),
  corte       date not null,
  persona_id  uuid not null references public.personal(id) on delete cascade,
  pares       numeric,
  acc         numeric,
  ropa        numeric,
  unidades    numeric,
  trx         numeric,
  upt         numeric,
  cargado_por uuid references public.personal(id) on delete set null,
  cargado_at  timestamptz not null default now(),
  unique (tienda_id, fuente, corte, persona_id)
);
create index if not exists cortes_kpis_mes_idx on public.cortes_kpis (tienda_id, anio, mes, fuente, corte);

alter table public.cortes_kpis enable row level security;
revoke all on public.cortes_kpis from anon;
grant select, insert, update, delete on public.cortes_kpis to authenticated;
grant all on public.cortes_kpis to service_role;

drop policy if exists "tienda_cortes_kpis" on public.cortes_kpis;
create policy "tienda_cortes_kpis" on public.cortes_kpis as restrictive for all to authenticated
  using (tienda_id = (select public.current_tienda_id()))
  with check (tienda_id = (select public.current_tienda_id()));
-- Como el ranking: lo ve todo el equipo; lo carga la jefatura.
drop policy if exists "leer_cortes_kpis" on public.cortes_kpis;
create policy "leer_cortes_kpis" on public.cortes_kpis for select to authenticated using (true);
drop policy if exists "jefatura_cortes_kpis" on public.cortes_kpis;
create policy "jefatura_cortes_kpis" on public.cortes_kpis for all to authenticated
  using ((select public.current_persona_rol()) = 'jefatura')
  with check ((select public.current_persona_rol()) = 'jefatura');

-- Lo que ya está cargado entra como su primer corte.
--   Consolidada: kpis_mensuales con corte_ventas.
insert into public.cortes_kpis (tienda_id, anio, mes, fuente, corte, persona_id, pares, acc, ropa, unidades, cargado_por)
select k.tienda_id, k.anio, k.mes, 'consolidada', k.corte_ventas, k.persona_id, k.pares_venta, k.acc_venta, k.ropa_venta, k.unidades, k.subido_por
  from public.kpis_mensuales k
 where k.corte_ventas is not null
on conflict (tienda_id, fuente, corte, persona_id) do nothing;
--   Xstore: la TRX del mes con la fecha hasta la que llega el informe vigente.
insert into public.cortes_kpis (tienda_id, anio, mes, fuente, corte, persona_id, trx, upt, cargado_por)
select k.tienda_id, k.anio, k.mes, 'xstore', (c.resumen ->> 'hasta')::date, k.persona_id, k.trx, k.upt, c.cargado_por
  from public.kpis_mensuales k
  join public.cargas_datos c
    on c.tienda_id = k.tienda_id and c.anio = k.anio and c.mes = k.mes
   and c.tipo = 'transacciones' and c.vigente and c.origen = 'xstore' and c.resumen ->> 'hasta' is not null
 where k.trx is not null
on conflict (tienda_id, fuente, corte, persona_id) do nothing;
