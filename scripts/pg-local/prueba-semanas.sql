-- Prueba de novedades y semanas cerradas (migración 0043). Se deshace al final.
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
insert into public.horarios (persona_id, anio, mes, dia, horas, tipo, origen, tienda_id)
select '10000000-0000-0000-0000-000000000002', 2026, 10, 6, 8, 'trabajo', 'geovictoria', t690 from prueba.ids;

set local role authenticated;

-- La jefatura registra una novedad; un valor que no existe se rechaza.
select prueba.soy('1');
update public.horarios set novedad = 'incapacidad', horas_reales = 0 where persona_id = '10000000-0000-0000-0000-000000000002';
select prueba.espero('novedad guardada', (select novedad from public.horarios where persona_id = '10000000-0000-0000-0000-000000000002'), 'incapacidad');
select prueba.debe_fallar('novedad inventada',
  $$update public.horarios set novedad = 'paseo' where persona_id = '10000000-0000-0000-0000-000000000002'$$);

-- Cerrar una semana: la jefatura escribe; el asesor solo lee; otra tienda no ve nada.
insert into public.semanas_presupuesto (anio, mes, inicio, fin, meta_tienda, cerrada_por)
values (2026, 10, '2026-10-04', '2026-10-10', 7000000, '10000000-0000-0000-0000-000000000001');
insert into public.presupuesto_semana_persona (semana_id, persona_id, meta_proyectada, meta)
select id, '10000000-0000-0000-0000-000000000002', 2333333, 0 from public.semanas_presupuesto;
select prueba.debe_fallar('cerrar dos veces la misma semana',
  $$insert into public.semanas_presupuesto (anio, mes, inicio, fin) values (2026, 10, '2026-10-04', '2026-10-10')$$);

select prueba.soy('2');
select prueba.espero('el asesor ve su semana', (select count(*) from public.presupuesto_semana_persona)::text, '1');
select prueba.debe_fallar('el asesor reabre la semana', $$delete from public.semanas_presupuesto$$);
select prueba.debe_fallar('el asesor registra una novedad',
  $$update public.horarios set novedad = null where persona_id = '10000000-0000-0000-0000-000000000002'$$);

select prueba.soy('3');
select prueba.espero('otra tienda no ve semanas', (select count(*) from public.semanas_presupuesto)::text, '0');

-- Reabrir borra lo guardado de cada persona.
select prueba.soy('1');
delete from public.semanas_presupuesto;
select prueba.espero('reabrir borra lo guardado', (select count(*) from public.presupuesto_semana_persona)::text, '0');

reset role;
\echo
\echo 'TODAS LAS PRUEBAS DE SEMANAS PASARON'
rollback;
