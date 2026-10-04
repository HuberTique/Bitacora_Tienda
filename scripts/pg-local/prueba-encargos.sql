-- Prueba de encargos temporales (migración 0039): quién los asigna, qué acceso
-- dan, qué no permiten y la huella. Todo se deshace al final.
begin;
create schema prueba;

create function prueba.soy(p_usuario text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_usuario is null then ''
         else json_build_object('sub', '00000000-0000-0000-0000-' || lpad(p_usuario, 12, '0'), 'role', 'authenticated')::text end,
    true);
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
insert into public.tiendas (id, numero, nombre, distrito_id) values
  ('20000000-0000-0000-0000-000000000101', 101, 'TIENDA 101', (select id from public.distritos where numero = 68));
create table prueba.ids as
select (select id from public.tiendas where numero = 690) as t690,
       '20000000-0000-0000-0000-000000000101'::uuid as t101,
       (select id from public.distritos where numero = 90) as d90,
       (select id from public.distritos where numero = 68) as d68;
grant select on prueba.ids to authenticated, anon;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 7) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id, distrito_id, es_admin)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       nombre, 'CM' || n, rol, rj::public.rol_jerarquico_t, tienda, distrito, adm
  from prueba.ids ids, lateral (values
    (1, 'Admin 690',   'jefatura', 'subjefe',     t690, null::uuid, true),
    (2, 'Jefe 690',    'jefatura', 'jefe_tienda', t690, null,       false),
    (3, 'Cajera 690',  'asesor',   'cajero',      t690, null,       false),
    (4, 'Asesor 690',  'asesor',   'full_time',   t690, null,       false),
    (5, 'DSM 68',      'dsm',      'full_time',   null, d68,        false),
    (6, 'DSM 90',      'dsm',      'full_time',   null, d90,        false),
    (7, 'Asesor 101',  'asesor',   'full_time',   t101, null,       false)
  ) as v(n, nombre, rol, rj, tienda, distrito, adm);

set local role authenticated;

-- ================= Quién asigna =================
select prueba.soy('3');
select prueba.espero('la cajera sin encargo es asesor', public.current_persona_rol(), 'asesor');
select prueba.espero('sin encargo: mi_encargo vacío', public.mi_encargo()::text, null);

select prueba.soy('2');
select prueba.debe_fallar('el jefe de tienda asigna un encargo',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000003', 'subjefe', current_date + 10)$$);
select prueba.soy('5');
select prueba.debe_fallar('la DSM de otro distrito asigna un encargo',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000003', 'subjefe', current_date + 10)$$);
select prueba.soy('3');
select prueba.debe_fallar('la cajera se asigna un encargo',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000003', 'jefe_tienda', current_date + 10)$$);
select prueba.debe_fallar('escribir directo en la tabla',
  $$insert into public.encargos (tienda_id, persona_id, cargo, desde, hasta)
    select t690, '10000000-0000-0000-0000-000000000003', 'jefe_tienda', current_date, current_date + 5 from prueba.ids$$);

select prueba.soy('1');
select prueba.debe_fallar('encargo sin fecha fin',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000003', 'subjefe', null)$$);
select prueba.debe_fallar('encargo de más de 180 días',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000003', 'subjefe', current_date + 200)$$);
select prueba.debe_fallar('encargo al jefe de tienda',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000002', 'jefe_tienda', current_date + 10)$$);
select prueba.debe_fallar('encargo de subjefe a un subjefe',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000001', 'subjefe', current_date + 10)$$);

-- La DSM del distrito 90 sí puede (la 690 es del 90).
select prueba.soy('6');
select public.asignar_encargo('10000000-0000-0000-0000-000000000003', 'subjefe', current_date + 10, 'Jefe incapacitado');
select prueba.debe_fallar('un segundo encargo abierto a la misma persona',
  $$select public.asignar_encargo('10000000-0000-0000-0000-000000000003', 'jefe_tienda', current_date + 5)$$);

-- ================= Qué acceso da =================
select prueba.soy('3');
select prueba.espero('con encargo es jefatura', public.current_persona_rol(), 'jefatura');
select prueba.espero('mi_encargo dice el cargo', public.mi_encargo() ->> 'cargo', 'subjefe');
select prueba.espero('ve a toda la planta de su tienda', (select count(*) from public.personal)::text, '4');
select prueba.espero('sigue siendo cajera (cargo real)', (select rol_jerarquico::text from public.personal where id = '10000000-0000-0000-0000-000000000003'), 'cajero');

-- Lo que hace deja huella.
insert into public.pendientes (titulo, area, turno, responsable_id, created_by)
values ('Pendiente de la encargada', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003');
select prueba.espero('huella con el encargo',
  (select encargo_cargo from public.huellas_reemplazo where tabla = 'pendientes' and persona_nombre = 'Cajera 690'), 'subjefe');

-- ================= Qué no permite =================
update public.personal set rol_jerarquico = 'part_time' where id = '10000000-0000-0000-0000-000000000004';
select prueba.espero('sí cambia cargos entre asesores', (select rol_jerarquico::text from public.personal where id = '10000000-0000-0000-0000-000000000004'), 'part_time');
select prueba.debe_fallar('ascender a un asesor a subjefe',
  $$update public.personal set rol_jerarquico = 'subjefe', rol = 'jefatura' where id = '10000000-0000-0000-0000-000000000004'$$);
select prueba.debe_fallar('cambiarse su propio cargo',
  $$update public.personal set rol_jerarquico = 'subjefe', rol = 'jefatura' where id = '10000000-0000-0000-0000-000000000003'$$);
select prueba.debe_fallar('bajar de cargo al jefe',
  $$update public.personal set rol_jerarquico = 'cajero', rol = 'asesor' where id = '10000000-0000-0000-0000-000000000002'$$);
select prueba.debe_fallar('dar de baja al jefe',
  $$select public.dar_baja_persona('10000000-0000-0000-0000-000000000002', 'otro', 'x')$$);
select prueba.debe_fallar('cerrar su propio encargo',
  $$select public.cerrar_encargo((select id from public.encargos limit 1))$$);

-- El jefe de planta sigue con su acceso.
select prueba.soy('2');
select prueba.espero('el jefe sigue siendo jefatura', public.current_persona_rol(), 'jefatura');
select prueba.espero('el jefe ve el encargo', (select count(*) from public.encargos)::text, '1');

-- Otra tienda no ve el encargo.
select prueba.soy('7');
select prueba.espero('asesor de otra tienda no ve encargos', (select count(*) from public.encargos)::text, '0');

-- ================= Extender y cerrar =================
select prueba.soy('6');
select public.entrar_tienda((select t690 from prueba.ids));
select prueba.espero('la DSM, parada en la 690, ve el encargo', (select count(*) from public.encargos)::text, '1');
select public.extender_encargo((select id from public.encargos limit 1), current_date + 20);
select prueba.espero('extendido', (select (hasta - current_date)::text from public.encargos limit 1), '20');
select prueba.soy('1');
select public.cerrar_encargo((select id from public.encargos limit 1));
select prueba.soy('3');
select prueba.espero('cerrado: vuelve a ser asesor', public.current_persona_rol(), 'asesor');
select prueba.espero('cerrado: mi_encargo vacío', public.mi_encargo()::text, null);
select prueba.espero('como asesora ya no ve a toda la planta', ((select count(*) from public.personal) < 4)::text, 'true');
select prueba.soy('1');
select prueba.debe_fallar('extender un encargo cerrado',
  $$select public.extender_encargo((select id from public.encargos limit 1), current_date + 5)$$);

-- Vencido (fecha fin ayer) no da acceso, aunque nadie lo cierre.
reset role;
insert into public.encargos (tienda_id, persona_id, cargo, desde, hasta)
select t690, '10000000-0000-0000-0000-000000000004', 'subjefe', current_date - 10, current_date - 1 from prueba.ids;
set local role authenticated;
select prueba.soy('4');
select prueba.espero('encargo vencido: sigue asesor', public.current_persona_rol(), 'asesor');

reset role;
\echo
\echo 'TODAS LAS PRUEBAS DE ENCARGOS PASARON'
rollback;
