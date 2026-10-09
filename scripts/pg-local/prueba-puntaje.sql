-- Prueba del nuevo puntaje (migración 0044): descuentos por falta × recurrencia,
-- reclamos que restan de Magia y calificaciones manuales con historial. Se deshace al final.
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
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 4) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, nombre, 'CM' || n, rol, rj::public.rol_jerarquico_t, tienda
  from prueba.ids, lateral (values
    (1, 'Jefe 690',   'jefatura', 'jefe_tienda', t690),
    (2, 'Asesor 690', 'asesor',   'full_time',   t690),
    (3, 'Jefe 101',   'jefatura', 'jefe_tienda', t101),
    (4, 'Asesor 101', 'asesor',   'full_time',   t101)
  ) as v(n, nombre, rol, rj, tienda);

-- Faltas de octubre: tres llegadas leves seguidas (×1, ×1,5, ×2), un error operacional y un reclamo.
insert into public.retardos (persona_id, tipo_id, fecha, minutos, ocurrencia, accion, registrado_por, tienda_id)
select '10000000-0000-0000-0000-000000000002', t, f::date, m, o, 'Feedback', '10000000-0000-0000-0000-000000000001', t690
  from prueba.ids, (values
    ('llegada_menor10', '2026-10-05', 5, 1),
    ('llegada_menor10', '2026-10-06', 7, 2),
    ('llegada_menor10', '2026-10-07', 3, 3),
    ('error_operacional', '2026-10-07', null, 1),
    ('reclamo', '2026-10-08', null, 1)
  ) as v(t, f, m, o);
-- Una falta de otra tienda no cuenta.
insert into public.retardos (persona_id, tipo_id, fecha, minutos, ocurrencia, accion, registrado_por, tienda_id)
select '10000000-0000-0000-0000-000000000004', 'ausencia_total', '2026-10-06', null, 1, 'Descargos', '10000000-0000-0000-0000-000000000003', t101 from prueba.ids;

set local role authenticated;
select prueba.soy('1');
select prueba.espero('tipos nuevos en Feedbacks',
  (select string_agg(tipo_id || ':' || resta_de || ':' || puntos, ',' order by posicion) from public.faltas_config where tipo_id in ('reclamo', 'error_operacional')),
  'reclamo:magia:20,error_operacional:puntualidad:10');
select prueba.espero('puntualidad: 10 + 15 + 20 + 10',
  (select penalizacion::text from public.ranking_faltas('2026-10-04'::date, '2026-10-31'::date) where persona_id = '10000000-0000-0000-0000-000000000002'), '55.0');
select prueba.espero('faltas de puntualidad', (select faltas::text from public.ranking_faltas('2026-10-04'::date, '2026-10-31'::date)), '4');
select prueba.espero('el reclamo resta de Magia',
  (select penal_magia::text || ' / ' || reclamos from public.ranking_faltas('2026-10-04'::date, '2026-10-31'::date)), '20 / 1');
select prueba.espero('solo cuenta su tienda', (select count(*)::text from public.ranking_faltas('2026-10-04'::date, '2026-10-31'::date)), '1');
select prueba.espero('versión por mes', (select penalizacion::text from public.ranking_faltas(2026, 10)), '55.0');

-- La tienda cambia lo que vale un reclamo.
reset role;
insert into public.ranking_config (id, tienda_id, puntos_faltas) select true, t690, '{"reclamo": 30}' from prueba.ids
  on conflict (tienda_id) do update set puntos_faltas = excluded.puntos_faltas;
set local role authenticated;
select prueba.soy('1');
select prueba.espero('valor propio de la tienda', (select penal_magia::text from public.ranking_faltas('2026-10-04'::date, '2026-10-31'::date)), '30');
select prueba.espero('el maximizador ya no pesa', (select peso_maximizador::text from public.ranking_config), '0');

-- Calificaciones manuales: la jefatura califica; queda el historial de quién y cuándo.
insert into public.calificaciones_vendedor (anio, mes, item, persona_id, nota, calificado_por)
values (2026, 10, 'trabajo_equipo', '10000000-0000-0000-0000-000000000002', 'Apoyó el inventario', '10000000-0000-0000-0000-000000000001');
update public.calificaciones_vendedor set nota = 'Apoyó inventario y vitrinas';
select prueba.debe_fallar('dos ganadores del mismo ítem',
  $$insert into public.calificaciones_vendedor (anio, mes, item, persona_id) values (2026, 10, 'trabajo_equipo', '10000000-0000-0000-0000-000000000001')$$);
select prueba.debe_fallar('un ítem que no existe',
  $$insert into public.calificaciones_vendedor (anio, mes, item, persona_id) values (2026, 10, 'simpatia', '10000000-0000-0000-0000-000000000002')$$);
select prueba.espero('historial: calificó y cambió',
  (select string_agg(accion || ':' || coalesce(por::text, '-'), ',' order by at, accion) from public.calificaciones_vendedor_historial),
  'califico:10000000-0000-0000-0000-000000000001,cambio:10000000-0000-0000-0000-000000000001');

select prueba.soy('2');
select prueba.espero('el asesor ve al ganador', (select count(*)::text from public.calificaciones_vendedor), '1');
select prueba.espero('el asesor no ve el historial', (select count(*)::text from public.calificaciones_vendedor_historial), '0');
select prueba.debe_fallar('el asesor se califica',
  $$insert into public.calificaciones_vendedor (anio, mes, item, persona_id) values (2026, 10, 'iniciativa', '10000000-0000-0000-0000-000000000002')$$);
select prueba.debe_fallar('el asesor borra la calificación', $$delete from public.calificaciones_vendedor$$);

select prueba.soy('3');
select prueba.espero('otra tienda no ve calificaciones', (select count(*)::text from public.calificaciones_vendedor), '0');
select prueba.espero('otra tienda no ve el historial', (select count(*)::text from public.calificaciones_vendedor_historial), '0');

reset role;
rollback;
