-- 0038_cargar_datos.sql
--
-- Presupuesto y ranking → Cargar datos, reorganizado en tres pasos
-- (presupuesto, ventas, transacciones). Reglas de Huber, 2-oct-2026:
--
--   * El presupuesto de la tienda se reparte por HORAS DE VENTA: el jefe de
--     tienda aporta 1/4 de sus horas, el subjefe 1/3 y el cajero 1/2 (hacen
--     labores administrativas); full time y part time, todas. Lo calcula la
--     app siempre, y la jefatura puede dejar a mano el de una persona.
--   * Jefe y subjefes llevan presupuesto y KPIs, pero no compiten en el ranking.
--   * Metas por categoria (formula del Excel de la tienda, con los precios bien
--     puestos): pares = presupuesto / precio del par; accesorios = presupuesto
--     x 8 % / precio de accesorios; ropa = presupuesto x 4 % / precio de ropa.
--     Los % y los factores se configuran por tienda.
--   * Cada carga queda en un historial: que archivo, cuando, quien, y se puede
--     eliminar si se subio el equivocado.
--
-- Idempotente.

-- ================================================================
-- 1) Parametros de reparto por tienda
-- ================================================================
alter table public.tiendas
  add column if not exists pct_accesorios numeric not null default 8    check (pct_accesorios between 0 and 100),
  add column if not exists pct_ropa       numeric not null default 4    check (pct_ropa between 0 and 100),
  add column if not exists factor_jefe    numeric not null default 0.25 check (factor_jefe between 0 and 1),
  add column if not exists factor_subjefe numeric not null default 0.3333 check (factor_subjefe between 0 and 1),
  add column if not exists factor_cajero  numeric not null default 0.5  check (factor_cajero between 0 and 1);

-- La mezcla que sumaba 100 % (0035) queda en desuso: ahora los pares se miden
-- sobre todo el presupuesto, como en el Excel.
alter table public.tiendas drop constraint if exists tiendas_mezcla_chk;

grant update (pct_accesorios, pct_ropa, factor_jefe, factor_subjefe, factor_cajero) on public.tiendas to authenticated;

-- ================================================================
-- 2) Presupuesto por persona: horas de venta y si se fijo a mano
-- ================================================================
alter table public.kpis_mensuales
  add column if not exists horas_venta        numeric,
  add column if not exists presupuesto_manual boolean not null default false;

alter table public.meses_retail
  add column if not exists precio_pares numeric;

-- ================================================================
-- 3) Historial de cargas
-- ================================================================
create table if not exists public.cargas_datos (
  id          uuid primary key default gen_random_uuid(),
  tienda_id   uuid not null default public.current_tienda_id() references public.tiendas(id) on delete cascade,
  anio        integer not null,
  mes         integer not null check (mes between 1 and 12),
  tipo        text not null check (tipo in ('presupuesto', 'ventas_consolidadas', 'transacciones')),
  origen      text not null check (origen in ('planeador', 'manual', 'pdf', 'xstore')),
  archivo     text,
  -- Cifras para mostrar en el historial (total, fechas, personas, corte…).
  resumen     jsonb not null default '{}'::jsonb,
  cargado_por uuid references public.personal(id) on delete set null,
  cargado_at  timestamptz not null default now(),
  -- La ultima carga de cada tipo es la vigente; las anteriores quedan como historial.
  vigente     boolean not null default true,
  eliminado_por uuid references public.personal(id) on delete set null,
  eliminado_at  timestamptz
);
create index if not exists cargas_datos_tienda_mes_idx on public.cargas_datos (tienda_id, anio, mes, tipo, cargado_at desc);

alter table public.cargas_datos enable row level security;
revoke all on public.cargas_datos from anon;
grant select, insert, update, delete on public.cargas_datos to authenticated;
grant all on public.cargas_datos to service_role;

drop policy if exists "tienda_cargas_datos" on public.cargas_datos;
create policy "tienda_cargas_datos" on public.cargas_datos as restrictive for all to authenticated
  using      (tienda_id = (select public.current_tienda_id()))
  with check (tienda_id = (select public.current_tienda_id()));

drop policy if exists "jefatura cargas" on public.cargas_datos;
create policy "jefatura cargas" on public.cargas_datos for all to authenticated
  using      ((select public.current_persona_rol()) = 'jefatura')
  with check ((select public.current_persona_rol()) = 'jefatura');

drop policy if exists "dsm lee cargas" on public.cargas_datos;
create policy "dsm lee cargas" on public.cargas_datos for select to authenticated
  using ((select public.current_persona_rol()) = 'dsm');

-- ================================================================
-- 4) mi_ambito: la tienda trae sus parametros de reparto
-- ================================================================
create or replace function public.mi_ambito()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id', p.id,
    'rol', p.rol,
    'rol_jerarquico', p.rol_jerarquico,
    'es_admin', p.es_admin,
    'correo', p.correo,
    'debe_cambiar_clave', p.debe_cambiar_clave,
    'consentimiento_pendiente',
      exists (select 1 from public.consentimiento_versiones)
      and not exists (
        select 1 from public.consentimientos c
         where c.persona_id = p.id
           and c.version = (select max(version) from public.consentimiento_versiones)),
    'distrito', (select jsonb_build_object('id', d.id, 'numero', d.numero, 'nombre', d.nombre)
                   from public.distritos d
                  where d.id = coalesce(p.distrito_id, (select distrito_id from public.tiendas where id = p.tienda_id))),
    'tienda', (select jsonb_build_object('id', t.id, 'numero', t.numero, 'nombre', t.nombre,
                                         'ciudad', t.ciudad, 'formato', t.formato,
                                         'vende_ropa', t.vende_ropa,
                                         'mezcla_calzado', t.mezcla_calzado,
                                         'mezcla_accesorios', t.mezcla_accesorios,
                                         'mezcla_ropa', t.mezcla_ropa,
                                         'pct_accesorios', t.pct_accesorios,
                                         'pct_ropa', t.pct_ropa,
                                         'factor_jefe', t.factor_jefe,
                                         'factor_subjefe', t.factor_subjefe,
                                         'factor_cajero', t.factor_cajero)
                 from public.tiendas t where t.id = public.current_tienda_id()),
    'tienda_propia', (select jsonb_build_object('id', t.id, 'numero', t.numero, 'nombre', t.nombre)
                        from public.tiendas t where t.id = p.tienda_id),
    'movimiento', (select jsonb_build_object(
                            'id', m.id, 'tipo', m.tipo, 'estado', m.estado, 'hasta', m.hasta,
                            'vigente', m.estado = 'activo' and (m.hasta is null or m.hasta >= public.hoy_bogota()),
                            'destino', jsonb_build_object('numero', td.numero, 'nombre', td.nombre))
                     from public.movimientos_personal m
                     join public.tiendas td on td.id = m.tienda_destino_id
                    where m.persona_id = p.id and m.estado in ('solicitado', 'activo')
                      and (m.estado = 'solicitado' or m.hasta is null or m.hasta >= public.hoy_bogota())
                    limit 1),
    'tiendas', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', t.id, 'numero', t.numero, 'nombre', t.nombre, 'ciudad', t.ciudad,
                           'formato', t.formato, 'distrito', d.numero) order by t.numero)
                           from public.tiendas t
                           join public.distritos d on d.id = t.distrito_id
                          where t.activa and t.id in (select public.tiendas_accesibles())), '[]'::jsonb)
  )
    from public.personal p
   where p.auth_user_id = auth.uid() and p.activo
   limit 1;
$$;
