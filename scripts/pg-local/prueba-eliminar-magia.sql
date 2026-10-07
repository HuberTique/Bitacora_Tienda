-- Prueba de eliminar evaluaciones de Magia (migración 0042). Se deshace al final.
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

create table prueba.ids as select (select id from public.tiendas where numero = 690) as t690;
grant select on prueba.ids to authenticated;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 5) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id, es_admin)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       nombre, 'CM' || n, rol, rj::public.rol_jerarquico_t, t690, adm
  from prueba.ids, lateral (values
    (1, 'Jefe',      'jefatura', 'jefe_tienda', false),
    (2, 'Subjefe A', 'jefatura', 'subjefe',     false),
    (3, 'Subjefe B', 'jefatura', 'subjefe',     false),
    (4, 'Asesor',    'asesor',   'full_time',   false),
    (5, 'Admin',     'jefatura', 'subjefe',     true)
  ) as v(n, nombre, rol, rj, adm);

-- E1: la hizo el subjefe A, sin confirmar. E2: la hizo A y ya está confirmada. E3: la hizo B.
insert into public.magia_evaluaciones (id, persona_id, evaluador_id, anio, mes, numero, fecha, c_sonrisa, c_preguntas, c_experiencia, c_tecnologias, c_cierre, impresion_final, tienda_id, confirmada_at)
select v.id::uuid, '10000000-0000-0000-0000-000000000004', v.ev::uuid, 2026, v.mes, 1, current_date, 3, 3, 3, 3, 3, 3, t690, v.conf
  from prueba.ids, lateral (values
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 10, null::timestamptz),
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 9, now()),
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 8, null)
  ) as v(id, ev, mes, conf);

set local role authenticated;

select prueba.soy('2');
select prueba.debe_fallar('borrar directo, sin la función',
  $$delete from public.magia_evaluaciones where id = '40000000-0000-0000-0000-000000000001'$$);
select prueba.debe_fallar('eliminar una ya confirmada',
  $$select public.eliminar_magia('40000000-0000-0000-0000-000000000002')$$);
select prueba.debe_fallar('eliminar la que hizo otro subjefe',
  $$select public.eliminar_magia('40000000-0000-0000-0000-000000000003')$$);
select prueba.soy('4');
select prueba.debe_fallar('el asesor elimina su evaluación',
  $$select public.eliminar_magia('40000000-0000-0000-0000-000000000001')$$);

select prueba.soy('2');
select public.eliminar_magia('40000000-0000-0000-0000-000000000001');
select prueba.espero('quien la hizo la elimina', (select count(*) from public.magia_evaluaciones where id = '40000000-0000-0000-0000-000000000001')::text, '0');
select prueba.espero('sin huella', (select count(*) from public.huellas_reemplazo where tabla = 'magia_evaluaciones')::text, '0');

select prueba.soy('1');
select public.eliminar_magia('40000000-0000-0000-0000-000000000003');
select prueba.espero('el jefe elimina la de otro', (select count(*) from public.magia_evaluaciones where id = '40000000-0000-0000-0000-000000000003')::text, '0');
select prueba.espero('la confirmada sigue', (select count(*) from public.magia_evaluaciones where id = '40000000-0000-0000-0000-000000000002')::text, '1');

reset role;
\echo
\echo 'TODAS LAS PRUEBAS DE ELIMINAR MAGIA PASARON'
rollback;
