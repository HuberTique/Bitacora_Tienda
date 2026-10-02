-- 0035_presupuesto_manual.sql
--
-- Presupuesto manual provisional (cuando termina el mes retail y aun no llega
-- el planeador nuevo) y datos de la tienda que necesita.
--
-- Reglas (definidas por Huber, 2-oct-2026):
--   * La jefatura escribe el presupuesto de la tienda; se reparte entre los
--     asesores segun sus horas del mes (venta por hora x horas de cada uno).
--   * Las metas en unidades salen de una mezcla FIJA por tienda (% de calzado,
--     accesorios y ropa) y de los precios promedio que escribe la jefatura.
--   * Algunas tiendas no venden ropa: se define en los datos de la tienda.
--   * El presupuesto manual queda marcado como PROVISIONAL y se puede borrar
--     para cargar el real.
--
-- Idempotente.

-- ================================================================
-- 1) Datos de la tienda: ropa y mezcla por categoria
-- ================================================================
alter table public.tiendas
  add column if not exists vende_ropa        boolean not null default true,
  add column if not exists mezcla_calzado    numeric check (mezcla_calzado    between 0 and 100),
  add column if not exists mezcla_accesorios numeric check (mezcla_accesorios between 0 and 100),
  add column if not exists mezcla_ropa       numeric check (mezcla_ropa       between 0 and 100);

-- Si la mezcla esta completa debe sumar 100 %, y sin ropa la ropa no cuenta.
alter table public.tiendas drop constraint if exists tiendas_mezcla_chk;
alter table public.tiendas add constraint tiendas_mezcla_chk check (
  mezcla_calzado is null or mezcla_accesorios is null
  or abs(mezcla_calzado + mezcla_accesorios + case when vende_ropa then coalesce(mezcla_ropa, 0) else 0 end - 100) < 0.01
);

-- La jefatura de la tienda los configura, como el nombre y el formato.
grant update (vende_ropa, mezcla_calzado, mezcla_accesorios, mezcla_ropa) on public.tiendas to authenticated;

-- ================================================================
-- 2) Mes retail: presupuesto provisional y precios promedio usados
-- ================================================================
alter table public.meses_retail
  add column if not exists provisional        boolean not null default false,
  add column if not exists precio_calzado     numeric,
  add column if not exists precio_accesorios  numeric,
  add column if not exists precio_ropa        numeric;

-- ================================================================
-- 3) mi_ambito: la tienda trae si vende ropa y su mezcla
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
                                         'mezcla_ropa', t.mezcla_ropa)
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
