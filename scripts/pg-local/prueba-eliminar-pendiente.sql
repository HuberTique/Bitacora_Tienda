-- Prueba de eliminar pendientes mal registrados (migración 0040). Se deshace al final.
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

-- ---------- datos (como sistema) ----------
create table prueba.ids as
select (select id from public.tiendas where numero = 690) as t690,
       (select id from public.distritos where numero = 90) as d90;
grant select on prueba.ids to authenticated;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 5) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id, distrito_id, es_admin)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       nombre, 'CM' || n, rol, rj::public.rol_jerarquico_t, tienda, distrito, adm
  from prueba.ids ids, lateral (values
    (1, 'Jefe 690',     'jefatura', 'jefe_tienda', t690, null::uuid, false),
    (2, 'Subjefe A',    'jefatura', 'subjefe',     t690, null,       false),
    (3, 'Subjefe B',    'jefatura', 'subjefe',     t690, null,       false),
    (4, 'Asesor 690',   'asesor',   'full_time',   t690, null,       false),
    (5, 'Admin',        'jefatura', 'subjefe',     t690, null,       true)
  ) as v(n, nombre, rol, rj, tienda, distrito, adm);

-- Pendientes: P1 lo registra el subjefe A (recién), P2 viejo (30 h), P3 en progreso, P4 de la DSM.
insert into public.pendientes (id, titulo, area, turno, responsable_id, created_by, tienda_id, created_at, estado, origen) values
  ('30000000-0000-0000-0000-000000000001', 'Mal leído por la IA', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', (select t690 from prueba.ids), now(), 'abierto', 'tienda'),
  ('30000000-0000-0000-0000-000000000002', 'Viejo',               'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', (select t690 from prueba.ids), now() - interval '30 hours', 'abierto', 'tienda'),
  ('30000000-0000-0000-0000-000000000003', 'En progreso',         'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', (select t690 from prueba.ids), now(), 'progreso', 'tienda');
alter table public.pendientes disable trigger user;
insert into public.pendientes (id, titulo, area, turno, responsable_id, created_by, tienda_id, created_at, estado, origen) values
  ('30000000-0000-0000-0000-000000000004', 'Tarea DSM',           'ventas', 'Mañana', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', (select t690 from prueba.ids), now(), 'abierto', 'dsm');
alter table public.pendientes enable trigger user;

set local role authenticated;

select prueba.soy('2');
select prueba.debe_fallar('borrar directo, sin la función',
  $$delete from public.pendientes where id = '30000000-0000-0000-0000-000000000001'$$);
select prueba.soy('4');
select prueba.debe_fallar('el asesor elimina',
  $$select public.eliminar_pendiente('30000000-0000-0000-0000-000000000001')$$);

select prueba.soy('3');
select prueba.debe_fallar('otro subjefe elimina lo que no registró',
  $$select public.eliminar_pendiente('30000000-0000-0000-0000-000000000001')$$);

select prueba.soy('2');
select prueba.debe_fallar('eliminar uno de hace 30 horas',
  $$select public.eliminar_pendiente('30000000-0000-0000-0000-000000000002')$$);
select prueba.debe_fallar('eliminar uno en progreso',
  $$select public.eliminar_pendiente('30000000-0000-0000-0000-000000000003')$$);
select prueba.soy('1');
select prueba.debe_fallar('el jefe elimina una tarea de la DSM',
  $$select public.eliminar_pendiente('30000000-0000-0000-0000-000000000004')$$);

-- Quien lo registró sí puede.
select prueba.soy('2');
select public.eliminar_pendiente('30000000-0000-0000-0000-000000000001');
select prueba.espero('ya no está en el tablero ni en el historial',
  (select count(*) from public.pendientes where id = '30000000-0000-0000-0000-000000000001')::text, '0');
select prueba.espero('la jefatura no ve la nota interna', (select count(*) from public.pendientes_eliminados)::text, '0');

-- El jefe puede eliminar lo que registró otro (si está abierto y es reciente).
reset role;
insert into public.pendientes (id, titulo, area, turno, responsable_id, created_by, tienda_id)
values ('30000000-0000-0000-0000-000000000005', 'Otro error', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', (select t690 from prueba.ids));
set local role authenticated;
select prueba.soy('1');
select public.eliminar_pendiente('30000000-0000-0000-0000-000000000005');

-- El admin ve la nota y puede eliminar la tarea de la DSM.
select prueba.soy('5');
select prueba.espero('el admin ve las notas internas', (select count(*) from public.pendientes_eliminados)::text, '2');
select public.eliminar_pendiente('30000000-0000-0000-0000-000000000004');
select prueba.espero('tarea DSM eliminada por el admin', (select count(*) from public.pendientes where origen = 'dsm')::text, '0');

reset role;
\echo
\echo 'TODAS LAS PRUEBAS DE ELIMINAR PENDIENTE PASARON'
rollback;
