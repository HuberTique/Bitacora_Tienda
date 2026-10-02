-- Prueba de aislamiento entre tiendas (migración 0031). Crea dos tiendas en
-- distritos distintos con su gente y comprueba, uno por uno, quién ve y quién
-- puede escribir qué. Si algo no da lo esperado, se detiene con error.
-- Todo va en una transacción que se deshace al final.
begin;
create schema prueba;

create function prueba.soy(p_usuario text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_usuario is null then ''
         else json_build_object('sub', '00000000-0000-0000-0000-' || lpad(p_usuario, 12, '0'), 'role', 'authenticated')::text end,
    true);
$$;
create function prueba.espero(p_que text, p_obtenido bigint, p_esperado bigint) returns void language plpgsql as $$
begin
  if p_obtenido is distinct from p_esperado then
    raise exception 'FALLA: % -> obtuvo %, se esperaba %', p_que, p_obtenido, p_esperado;
  end if;
  raise notice 'ok  % = %', p_que, p_obtenido;
end $$;
-- Ejecuta algo que DEBE ser rechazado por la base.
create function prueba.debe_fallar(p_que text, p_sql text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'ok  rechazado: % (%)', p_que, left(sqlerrm, 70);
    return;
  end;
  if n = 0 then
    raise notice 'ok  sin efecto: %', p_que;
  else
    raise exception 'FALLA: se permitió %', p_que;
  end if;
end $$;
grant usage on schema prueba to authenticated, anon;

-- ---------- datos de prueba (como sistema) ----------
insert into public.tiendas (id, numero, nombre, distrito_id) values
  ('20000000-0000-0000-0000-000000000101', 101, 'TIENDA PRUEBA 101', (select id from public.distritos where numero = 68));
insert into public.tiendas (id, numero, nombre, distrito_id)
select '20000000-0000-0000-0000-000000000690', 690, 'TIENDA 690', (select id from public.distritos where numero = 90)
 where not exists (select 1 from public.tiendas where numero = 690);

create table prueba.ids as
select (select id from public.tiendas where numero = 690) as t690,
       '20000000-0000-0000-0000-000000000101'::uuid as t101,
       (select id from public.distritos where numero = 90) as d90,
       (select id from public.distritos where numero = 68) as d68;
grant select on prueba.ids to authenticated, anon;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 7) n;

insert into public.personal (id, auth_user_id, nombre, rol, rol_jerarquico, tienda_id, distrito_id, es_admin)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       nombre, rol, rj::public.rol_jerarquico_t, tienda, distrito, adm
  from prueba.ids ids, lateral (values
    (1, 'Jefe 690',     'jefatura', 'jefe_tienda', t690, null::uuid, false),
    (2, 'Asesor 690',   'asesor',   'full_time',   t690, null,       false),
    (3, 'Jefe 101',     'jefatura', 'jefe_tienda', t101, null,       false),
    (4, 'Asesor 101',   'asesor',   'full_time',   t101, null,       false),
    (5, 'DSM 68',       'dsm',      'full_time',   null, d68,        false),
    (6, 'DSM 90',       'dsm',      'full_time',   null, d90,        false),
    (7, 'Admin en 690', 'jefatura', 'jefe_tienda', t690, null,       true)
  ) as v(n, nombre, rol, rj, tienda, distrito, adm);

insert into storage.objects (bucket_id, name) values
  ('fotos-personal', '10000000-0000-0000-0000-000000000002/foto-1.jpg'),
  ('fotos-personal', '10000000-0000-0000-0000-000000000004/foto-1.jpg'),
  ('requerimientos-evidencias', '10000000-0000-0000-0000-000000000002/incapacidad.pdf');

set local role authenticated;

-- ---------- jefatura de cada tienda crea lo suyo (sin enviar tienda_id) ----------
select prueba.soy('1');
insert into public.pendientes (titulo, area, turno, responsable_id, created_by)
values ('Pendiente de la 690', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
insert into public.presupuestos_diarios (fecha, meta) values ('2026-10-01', 100);
select prueba.espero('jefe 690 ve su personal (3 de la 690)', (select count(*) from public.personal where nombre like '% 690'), 3);
select prueba.espero('jefe 690 NO ve personal de la 101', (select count(*) from public.personal where nombre like '% 101'), 0);

select prueba.soy('3');
insert into public.pendientes (titulo, area, turno, responsable_id, created_by)
values ('Pendiente de la 101', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003');
-- misma fecha que la 690: antes chocaba, ahora cada tienda tiene la suya
insert into public.presupuestos_diarios (fecha, meta) values ('2026-10-01', 200);
select prueba.espero('jefe 101 ve solo su pendiente', (select count(*) from public.pendientes where titulo like 'Pendiente de la %'), 1);
select prueba.espero('el pendiente quedó en la 101', (select count(*) from public.pendientes p, prueba.ids ids where p.titulo = 'Pendiente de la 101' and p.tienda_id = ids.t101), 1);
select prueba.espero('jefe 101 ve solo su presupuesto', (select sum(meta)::bigint from public.presupuestos_diarios where fecha = '2026-10-01'), 200);
select prueba.espero('ranking_avance de la 101 solo suma la 101', (select meta_total::bigint from public.ranking_avance('2026-10-01', '2026-10-31')), 200);
select prueba.espero('roster de la 101 = 2 personas', (select count(*) from public.roster_publico()), 2);

update public.personal set cargo = 'Asesor de ventas' where id = '10000000-0000-0000-0000-000000000004';
select prueba.espero('jefe 101 edita a su propio asesor', (select count(*) from public.personal where cargo = 'Asesor de ventas'), 1);
select prueba.debe_fallar('jefe 101 edita a alguien de la 690',
  $$update public.personal set cargo = 'x' where id = '10000000-0000-0000-0000-000000000002'$$);

select prueba.debe_fallar('jefe 101 edita un pendiente de la 690',
  $$update public.pendientes set titulo = 'hackeado' where titulo = 'Pendiente de la 690'$$);
select prueba.debe_fallar('jefe 101 crea un pendiente dentro de la 690',
  $$insert into public.pendientes (tienda_id, titulo, area, turno, responsable_id, created_by)
    select t690, 'intruso', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003' from prueba.ids ids$$);
select prueba.debe_fallar('jefe 101 se pasa a la 690',
  $$update public.personal set tienda_id = (select t690 from prueba.ids ids) where id = '10000000-0000-0000-0000-000000000003'$$);
select prueba.debe_fallar('jefe 101 se vuelve administrador',
  $$update public.personal set es_admin = true where id = '10000000-0000-0000-0000-000000000003'$$);
select prueba.debe_fallar('jefe 101 crea una cuenta de DSM',
  $$insert into public.personal (nombre, rol, distrito_id) select 'DSM falsa', 'dsm', d68 from prueba.ids ids$$);
select prueba.debe_fallar('jefe 101 entra a otra tienda',
  $$select public.entrar_tienda((select t690 from prueba.ids ids))$$);
select prueba.debe_fallar('jefe 101 pone la etiqueta DSM',
  $$insert into public.pendientes (titulo, area, turno, responsable_id, created_by, origen)
    values ('falsa DSM', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'dsm')$$);
select prueba.debe_fallar('jefe 101 cambia el catálogo de faltas',
  $$update public.faltas_config set nombre = nombre || '!'$$);
select prueba.debe_fallar('jefe 101 cambia el distrito de su tienda',
  $$update public.tiendas set distrito_id = (select d90 from prueba.ids ids) where numero = 101$$);
select prueba.espero('jefe 101 ve solo las fotos de su tienda', (select count(*) from storage.objects where bucket_id = 'fotos-personal'), 1);
select prueba.espero('jefe 101 NO ve evidencias de la 690', (select count(*) from storage.objects where bucket_id = 'requerimientos-evidencias'), 0);
select prueba.debe_fallar('jefe 101 sube una foto a una persona de la 690',
  $$insert into storage.objects (bucket_id, name) values ('fotos-personal', '10000000-0000-0000-0000-000000000002/foto-2.jpg')$$);
select prueba.espero('jefe 101 ve solo su tienda', (select count(*) from public.tiendas), 1);

-- ---------- asesor ----------
select prueba.soy('4');
select prueba.espero('asesor 101 no ve pendientes ajenos', (select count(*) from public.pendientes), 0);
select prueba.espero('asesor 101 se ve solo a sí mismo en personal', (select count(*) from public.personal), 1);

-- ---------- DSM del distrito 68 ----------
select prueba.soy('5');
select prueba.espero('DSM 68 sin entrar a una tienda no ve pendientes', (select count(*) from public.pendientes), 0);
select prueba.espero('DSM 68 ve solo las tiendas de su distrito', (select count(*) from public.tiendas), 1);
select prueba.debe_fallar('DSM 68 entra a la 690 (otro distrito)', $$select public.entrar_tienda((select t690 from prueba.ids ids))$$);
select public.entrar_tienda((select t101 from prueba.ids ids));
select prueba.espero('DSM 68 dentro de la 101 ve su pendiente', (select count(*) from public.pendientes where titulo = 'Pendiente de la 101'), 1);
select prueba.espero('DSM 68 dentro de la 101 ve su personal', (select count(*) from public.personal where nombre like '% 101'), 2);
select prueba.debe_fallar('DSM 68 edita un pendiente de la tienda',
  $$update public.pendientes set titulo = 'cambiado' where titulo = 'Pendiente de la 101'$$);
update public.faltas_config set posicion = posicion;
select prueba.espero('DSM 68 puede editar la matriz de faltas', (select count(*) from public.faltas_config where true), (select count(*) from public.faltas_config));
select prueba.debe_fallar('DSM 68 cambia un presupuesto', $$update public.presupuestos_diarios set meta = 1$$);
insert into public.pendientes (titulo, area, turno, responsable_id, created_by, origen)
values ('Tarea de la DSM', 'ventas', 'Mañana', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', 'dsm');
select prueba.espero('la tarea DSM quedó en la 101', (select count(*) from public.pendientes p, prueba.ids ids where origen = 'dsm' and p.tienda_id = ids.t101), 1);

select prueba.soy('3');
select prueba.espero('jefe 101 ve la tarea de la DSM', (select count(*) from public.pendientes where origen = 'dsm'), 1);
select prueba.debe_fallar('jefe 101 le quita la etiqueta DSM', $$update public.pendientes set origen = 'tienda' where origen = 'dsm'$$);
update public.pendientes set estado = 'cerrado' where origen = 'dsm';
select prueba.espero('jefe 101 sí puede cerrar la tarea de la DSM', (select count(*) from public.pendientes where origen = 'dsm' and estado = 'cerrado'), 1);

select prueba.soy('1');
select prueba.espero('jefe 690 no ve la tarea de la DSM 68', (select count(*) from public.pendientes where origen = 'dsm'), 0);

-- ---------- administrador ----------
select prueba.soy('7');
select prueba.espero('admin ve todas las tiendas', (select count(*) from public.tiendas where numero in (690, 101)), 2);
select prueba.espero('admin en su tienda ve lo de la 690', (select count(*) from public.pendientes where titulo like 'Pendiente de la %'), 1);
select public.entrar_tienda((select t101 from prueba.ids ids));
select prueba.espero('admin dentro de la 101 ve lo de la 101', (select count(*) from public.pendientes where titulo = 'Pendiente de la 101'), 1);
select prueba.espero('admin dentro de la 101 ya no ve lo de la 690', (select count(*) from public.pendientes where titulo = 'Pendiente de la 690'), 0);
update public.pendientes set descripcion = 'revisado por admin' where titulo = 'Pendiente de la 101';
select prueba.espero('admin puede corregir dentro de la tienda', (select count(*) from public.pendientes where descripcion = 'revisado por admin'), 1);
select public.entrar_tienda(null);

-- ---------- persona dada de baja ----------
reset role;
update public.personal set activo = false where id = '10000000-0000-0000-0000-000000000004';
set local role authenticated;
select prueba.soy('4');
select prueba.espero('asesor dado de baja no ve pendientes', (select count(*) from public.pendientes), 0);
select prueba.espero('asesor dado de baja no ve el equipo', (select count(*) from public.roster_publico()), 0);

-- ---------- sin sesión ----------
reset role;
set local role anon;
select prueba.soy(null);
select prueba.debe_fallar('anónimo lee tiendas', $$select 1 from public.tiendas limit 1$$);
select prueba.debe_fallar('anónimo pide su ámbito', $$select public.mi_ambito()$$);

reset role;
\echo
\echo 'TODAS LAS PRUEBAS DE AISLAMIENTO PASARON'
rollback;
