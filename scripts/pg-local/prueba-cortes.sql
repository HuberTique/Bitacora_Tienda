-- Prueba de los cortes de consolidada y Xstore (migración 0045). Se deshace al final.
begin;
begin;
create schema prueba;
create function prueba.soy(p_usuario text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-' || lpad(p_usuario, 12, '0'), 'role', 'authenticated')::text, true);
$$;
create function prueba.espero(p_que text, p_obtenido text, p_esperado text) returns void language plpgsql as $$
begin
  if p_obtenido is distinct from p_esperado then
    raise exception 'FALLA: % -> obtuvo %, se esperaba %', p_que, p_obtenido, p_esperado;
  end if;
  raise notice 'ok  % = %', p_que, p_obtenido;
end $$;
create function prueba.debe_fallar(p_que text, p_sql text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'ok  rechazado: % (%)', p_que, left(sqlerrm, 90);
    return;
  end;
  if n = 0 then raise notice 'ok  sin efecto: %', p_que;
  else raise exception 'FALLA: se permitió %', p_que; end if;
end $$;

grant usage on schema prueba to authenticated, anon;

insert into public.tiendas (id, numero, nombre, distrito_id) values
  ('20000000-0000-0000-0000-000000000101', 101, 'TIENDA 101', (select id from public.distritos where numero = 68));
create table prueba.ids as select (select id from public.tiendas where numero = 690) as t690, '20000000-0000-0000-0000-000000000101'::uuid as t101;
grant select on prueba.ids to authenticated;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 3) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, nombre, 'CM' || n, rol, rj::public.rol_jerarquico_t, tienda
  from prueba.ids, lateral (values
    (1, 'Jefe 690',   'jefatura', 'jefe_tienda', t690),
    (2, 'Asesor 690', 'asesor',   'full_time',   t690),
    (3, 'Jefe 101',   'jefatura', 'jefe_tienda', t101)
  ) as v(n, nombre, rol, rj, tienda);

-- Lo ya cargado (consolidada con corte y Xstore vigente) entra como primer corte.
insert into public.kpis_mensuales (persona_id, anio, mes, pares_venta, acc_venta, unidades, corte_ventas, trx, upt, tienda_id)
select '10000000-0000-0000-0000-000000000002', 2026, 10, 30, 6, 36, '2026-10-10', 25, 1.4, t690 from prueba.ids;
insert into public.cargas_datos (anio, mes, tipo, origen, archivo, resumen, vigente, tienda_id)
select 2026, 10, 'transacciones', 'xstore', 'x.jpg', '{"hasta": "2026-10-06"}', true, t690 from prueba.ids;
\i supabase/migrations/0045_cortes_kpis.sql
select prueba.espero('respaldo de consolidada y Xstore',
  (select string_agg(fuente || ' ' || corte || ' ' || coalesce(pares::text, '-') || ' ' || coalesce(trx::text, '-'), ', ' order by fuente) from public.cortes_kpis),
  'consolidada 2026-10-10 30 -, xstore 2026-10-06 - 25');

set local role authenticated;
select prueba.soy('1');
insert into public.cortes_kpis (anio, mes, fuente, corte, persona_id, pares) values (2026, 10, 'consolidada', '2026-10-17', '10000000-0000-0000-0000-000000000002', 70);
select prueba.debe_fallar('el mismo corte dos veces',
  $$insert into public.cortes_kpis (anio, mes, fuente, corte, persona_id) values (2026, 10, 'consolidada', '2026-10-17', '10000000-0000-0000-0000-000000000002')$$);
select prueba.debe_fallar('una fuente que no existe',
  $$insert into public.cortes_kpis (anio, mes, fuente, corte, persona_id) values (2026, 10, 'excel', '2026-10-18', '10000000-0000-0000-0000-000000000002')$$);
select prueba.soy('2');
select prueba.espero('el asesor ve los cortes', (select count(*)::text from public.cortes_kpis), '3');
select prueba.debe_fallar('el asesor carga un corte',
  $$insert into public.cortes_kpis (anio, mes, fuente, corte, persona_id) values (2026, 10, 'xstore', '2026-10-18', '10000000-0000-0000-0000-000000000002')$$);
select prueba.debe_fallar('el asesor borra cortes', $$delete from public.cortes_kpis$$);
select prueba.soy('3');
select prueba.espero('otra tienda no ve cortes', (select count(*)::text from public.cortes_kpis), '0');
reset role;
rollback;
