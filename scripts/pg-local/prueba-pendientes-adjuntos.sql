-- Prueba de editar pendientes y sus adjuntos (migraciones 0046 y 0047). Se deshace al final.
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
-- Cuenta archivos sin las políticas (para saber si de verdad se borraron).
create function prueba.archivos(p_nombre text) returns text language sql security definer as $$
  select count(*)::text from storage.objects where name like p_nombre;
$$;
grant usage on schema prueba to authenticated, anon;

insert into public.tiendas (id, numero, nombre, distrito_id) values
  ('20000000-0000-0000-0000-000000000101', 101, 'TIENDA 101', (select id from public.distritos where numero = 68));
create table prueba.ids as select (select id from public.tiendas where numero = 690) as t690, '20000000-0000-0000-0000-000000000101'::uuid as t101;
grant select on prueba.ids to authenticated;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 4) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, nombre, 'CM' || n, rol, rj::public.rol_jerarquico_t, tienda
  from prueba.ids, lateral (values
    (1, 'Jefe 690',    'jefatura', 'jefe_tienda', t690),
    (2, 'Asesor 690',  'asesor',   'full_time',   t690),
    (3, 'Jefe 101',    'jefatura', 'jefe_tienda', t101),
    (4, 'Asesora 690', 'asesor',   'part_time',   t690)
  ) as v(n, nombre, rol, rj, tienda);
-- P1: lo creó la jefatura y se lo asignó al asesor 2. P2: lo creó el asesor 2. P3: tarea de la DSM.
-- P4: cerrado hace 100 días con un archivo. P5: cerrado hace 10 días con un archivo.
insert into public.pendientes (id, titulo, area, turno, responsable_id, asesor_id, created_by, tienda_id, origen, estado, closed_at)
select ('30000000-0000-0000-0000-00000000000' || n)::uuid, 'Pendiente ' || n, 'operaciones', 'Mañana',
       '10000000-0000-0000-0000-000000000001', a::uuid, c::uuid, t690, o, e, ca
  from prueba.ids, (values
    (1, '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'tienda', 'abierto', null::timestamptz),
    (2, null, '10000000-0000-0000-0000-000000000002', 'tienda', 'abierto', null),
    (3, null, '10000000-0000-0000-0000-000000000001', 'dsm', 'abierto', null),
    (4, null, '10000000-0000-0000-0000-000000000001', 'tienda', 'cerrado', now() - interval '100 days'),
    (5, null, '10000000-0000-0000-0000-000000000001', 'tienda', 'cerrado', now() - interval '10 days')
  ) as v(n, a, c, o, e, ca);
insert into public.pendiente_adjuntos (pendiente_id, tipo, nombre, path, tienda_id)
select ('30000000-0000-0000-0000-00000000000' || n)::uuid, 'archivo', 'soporte.pdf', t690 || '/30000000-0000-0000-0000-00000000000' || n || '/soporte.pdf', t690
  from prueba.ids, generate_series(4, 5) n;
-- Archivos ya subidos: el de P4 (se purga) y uno del asesor en P2 (lo quitará con ✕).
insert into storage.objects (bucket_id, name)
select 'pendientes-adjuntos', t690 || '/30000000-0000-0000-0000-00000000000' || n || '/' || f from prueba.ids, (values (4, 'soporte.pdf'), (2, 'foto.jpg')) v(n, f);

set local role authenticated;

-- La jefatura edita: queda quién, cuándo y qué campos.
select prueba.soy('1');
update public.pendientes set titulo = 'Recibir embarque', descripcion = 'LOAD 321676' where id = '30000000-0000-0000-0000-000000000001';
select prueba.espero('registro de la edición',
  (select array_to_string(campos, ',') || ' por ' || (por = '10000000-0000-0000-0000-000000000001') from public.pendientes_ediciones), 'titulo,descripcion por true');
select prueba.espero('editado_por en el pendiente',
  (select (editado_por = '10000000-0000-0000-0000-000000000001')::text from public.pendientes where id = '30000000-0000-0000-0000-000000000001'), 'true');
select prueba.debe_fallar('la jefatura edita una tarea de la DSM',
  $$update public.pendientes set titulo = 'otro' where id = '30000000-0000-0000-0000-000000000003'$$);
update public.pendientes set estado = 'progreso' where id = '30000000-0000-0000-0000-000000000003';
select prueba.espero('pero sí le cambia el estado', (select estado from public.pendientes where id = '30000000-0000-0000-0000-000000000003'), 'progreso');

-- Enlaces: la jefatura los agrega; una dirección que no es web se rechaza.
insert into public.pendiente_adjuntos (pendiente_id, tipo, nombre, url) values
  ('30000000-0000-0000-0000-000000000001', 'enlace', 'Formulario de recepción', 'https://forms.office.com/r/abc');
select prueba.debe_fallar('enlace que no es web',
  $$insert into public.pendiente_adjuntos (pendiente_id, tipo, nombre, url) values ('30000000-0000-0000-0000-000000000001', 'enlace', 'x', 'javascript:alert(1)')$$);
select prueba.debe_fallar('agregar enlaces a una tarea de la DSM',
  $$insert into public.pendiente_adjuntos (pendiente_id, tipo, nombre, url) values ('30000000-0000-0000-0000-000000000003', 'enlace', 'x', 'https://a.co')$$);
-- Archivos en el almacenamiento: solo en la carpeta de su tienda.
insert into storage.objects (bucket_id, name) select 'pendientes-adjuntos', t690 || '/30000000-0000-0000-0000-000000000001/acta.pdf' from prueba.ids;
select prueba.debe_fallar('subir a la carpeta de otra tienda',
  $$insert into storage.objects (bucket_id, name) values ('pendientes-adjuntos', '20000000-0000-0000-0000-000000000101/30000000-0000-0000-0000-000000000001/x.pdf')$$);

-- Asesor: edita lo que creó; en lo que le asignaron solo cambia el estado.
select prueba.soy('2');
update public.pendientes set descripcion = 'Con fotos' where id = '30000000-0000-0000-0000-000000000002';
select prueba.espero('el asesor edita el suyo', (select descripcion from public.pendientes where id = '30000000-0000-0000-0000-000000000002'), 'Con fotos');
insert into public.pendiente_adjuntos (pendiente_id, tipo, nombre, url) values
  ('30000000-0000-0000-0000-000000000002', 'enlace', 'Carpeta', 'https://drive.google.com/x');
select prueba.debe_fallar('el asesor edita uno que le asignaron',
  $$update public.pendientes set titulo = 'otro' where id = '30000000-0000-0000-0000-000000000001'$$);
update public.pendientes set estado = 'progreso' where id = '30000000-0000-0000-0000-000000000001';
select prueba.espero('pero le cambia el estado', (select estado from public.pendientes where id = '30000000-0000-0000-0000-000000000001'), 'progreso');
select prueba.espero('ve el enlace del pendiente que le asignaron',
  (select count(*)::text from public.pendiente_adjuntos where pendiente_id = '30000000-0000-0000-0000-000000000001'), '1');
-- Quitar su archivo: primero se borra la fila y después el archivo (0047: igual se puede borrar).
delete from storage.objects where name like '%/30000000-0000-0000-0000-000000000002/foto.jpg';
select prueba.espero('el asesor borra el archivo de su pendiente sin fila',
  prueba.archivos('%/foto.jpg'), '0');
select prueba.debe_fallar('agrega enlaces a uno que no creó',
  $$insert into public.pendiente_adjuntos (pendiente_id, tipo, nombre, url) values ('30000000-0000-0000-0000-000000000001', 'enlace', 'x', 'https://a.co')$$);

select prueba.soy('4');
select prueba.espero('otra asesora no ve archivos ajenos', (select count(*)::text from storage.objects where bucket_id = 'pendientes-adjuntos'), '0');
select prueba.debe_fallar('otra asesora borra un archivo ajeno',
  $$delete from storage.objects where name like '%/30000000-0000-0000-0000-000000000004/soporte.pdf'$$);
select prueba.espero('otra asesora no ve adjuntos de pendientes ajenos', (select count(*)::text from public.pendiente_adjuntos), '0');
select prueba.soy('3');
select prueba.espero('otra tienda no ve adjuntos', (select count(*)::text from public.pendiente_adjuntos), '0');
select prueba.espero('otra tienda no ve archivos', (select count(*)::text from storage.objects where bucket_id = 'pendientes-adjuntos'), '0');

-- Limpieza: solo los archivos de pendientes cerrados hace más de 90 días; los enlaces se quedan.
select prueba.soy('2');
select prueba.espero('un asesor no purga', (select count(*)::text from public.purgar_adjuntos_vencidos()), '0');
select prueba.soy('1');
select prueba.espero('purga el de hace 100 días',
  (select string_agg(split_part(path, '/', 2) || '/' || split_part(path, '/', 3), ',') from public.purgar_adjuntos_vencidos()), '30000000-0000-0000-0000-000000000004/soporte.pdf');
select prueba.espero('el de hace 10 días sigue', (select count(*)::text from public.pendiente_adjuntos where tipo = 'archivo'), '1');
delete from storage.objects where name like '%/30000000-0000-0000-0000-000000000004/soporte.pdf';
select prueba.espero('y la app sí puede borrar el archivo purgado', prueba.archivos('%/soporte.pdf'), '0');
reset role;
rollback;
