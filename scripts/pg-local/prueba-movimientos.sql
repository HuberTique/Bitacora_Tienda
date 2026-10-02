-- Prueba de reemplazos, traslados y bajas entre tiendas (migración 0033).
-- Dos tiendas, y se recorre cada regla comprobando quién puede qué.
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
create function prueba.debe_fallar(p_que text, p_sql text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'ok  rechazado: % (%)', p_que, left(sqlerrm, 80);
    return;
  end;
  if n = 0 then raise notice 'ok  sin efecto: %', p_que;
  else raise exception 'FALLA: se permitió %', p_que; end if;
end $$;
grant usage on schema prueba to authenticated, anon;

-- ---------- datos ----------
insert into public.tiendas (id, numero, nombre, distrito_id) values
  ('20000000-0000-0000-0000-000000000101', 101, 'TIENDA 101', (select id from public.distritos where numero = 68));
create table prueba.ids as
select (select id from public.tiendas where numero = 690) as t690, '20000000-0000-0000-0000-000000000101'::uuid as t101;
grant select on prueba.ids to authenticated, anon;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 5) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, nombre, 'CM' || n, rol, rj::public.rol_jerarquico_t, tienda
  from prueba.ids ids, lateral (values
    (1, 'Jefe 690',    'jefatura', 'jefe_tienda', t690),
    (2, 'Subjefe 690', 'jefatura', 'subjefe',     t690),
    (3, 'Asesor 690',  'asesor',   'full_time',   t690),
    (4, 'Jefe 101',    'jefatura', 'jefe_tienda', t101),
    (5, 'Asesor 101',  'asesor',   'full_time',   t101)
  ) as v(n, nombre, rol, rj, tienda);

-- Historial del asesor de la 690 en su tienda: un feedback cerrado, un
-- pendiente abierto y un requerimiento pendiente.
insert into public.retardos (persona_id, tipo_id, fecha, ocurrencia, accion, registrado_por, tienda_id)
select '10000000-0000-0000-0000-000000000003', (select tipo_id from public.faltas_config limit 1), current_date - 10, 1, 'Feedback verbal',
       '10000000-0000-0000-0000-000000000001', t690 from prueba.ids;
insert into public.pendientes (titulo, area, turno, responsable_id, asesor_id, created_by, tienda_id)
select 'Seguimiento al asesor', 'rrhh', 'Mañana', '10000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', t690 from prueba.ids;
insert into public.pendientes (titulo, area, turno, responsable_id, created_by, tienda_id)
select 'Pendiente interno de la 690', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000001', t690 from prueba.ids;

set local role authenticated;

-- ================= REEMPLAZO: subjefe de la 690 cubre en la 101 =================
select prueba.soy('2');
select prueba.espero('el subjefe puede elegir entre las otras tiendas', (select count(*) from public.tiendas_para_movimiento()), 1);
select prueba.debe_fallar('pedir reemplazo sin fecha de fin',
  $$select public.solicitar_movimiento((select t101 from prueba.ids), 'reemplazo')$$);
select prueba.debe_fallar('pedir reemplazo en su propia tienda',
  $$select public.solicitar_movimiento((select t690 from prueba.ids), 'reemplazo', current_date + 5)$$);
select public.solicitar_movimiento((select t101 from prueba.ids), 'reemplazo', current_date + 7, 'Cubrir vacaciones');
select prueba.espero('pedido: sigue viendo SU tienda', (select count(*) from public.pendientes where titulo = 'Pendiente interno de la 690'), 1);
select prueba.espero('pedido: aún no ve nada de la 101', (select count(*) from public.personal where nombre like '% 101'), 0);
select prueba.debe_fallar('pedir un segundo movimiento con uno abierto',
  $$select public.solicitar_movimiento((select t101 from prueba.ids), 'traslado')$$);
select prueba.debe_fallar('aceptarse a sí mismo',
  $$select public.resolver_movimiento((select id from public.movimientos_personal), true)$$);
select prueba.debe_fallar('activarse editando la tabla',
  $$update public.movimientos_personal set estado = 'activo'$$);

select prueba.soy('1');
select prueba.debe_fallar('la jefatura de ORIGEN acepta la solicitud',
  $$select public.resolver_movimiento((select id from public.movimientos_personal), true)$$);
select prueba.soy('5');
select prueba.debe_fallar('un asesor de la tienda que recibe acepta',
  $$select public.resolver_movimiento((select id from public.movimientos_personal limit 1), true)$$);

select prueba.soy('4');
select prueba.espero('jefe 101 recibe el aviso', (select count(*) from public.notificaciones where tipo = 'movimiento_solicitud'), 1);
select prueba.espero('jefe 101 ve la solicitud', (select count(*) from public.movimientos_personal where estado = 'solicitado'), 1);
select public.resolver_movimiento((select id from public.movimientos_personal), true);
select prueba.espero('el equipo de la 101 ahora incluye al de reemplazo, marcado',
  (select count(*) from public.roster_publico() where reemplazo and nombre = 'Subjefe 690'), 1);

select prueba.soy('2');
select prueba.espero('de reemplazo: ya NO ve su tienda de origen', (select count(*) from public.pendientes where titulo = 'Pendiente interno de la 690'), 0);
select prueba.espero('de reemplazo: ve la planta de la 101', (select count(*) from public.personal where nombre like '% 101'), 2);
select prueba.espero('mi_ambito dice que está en la 101', ((select public.mi_ambito()) -> 'tienda' ->> 'numero')::bigint, 101);
insert into public.pendientes (titulo, area, turno, responsable_id, created_by)
values ('Creado por el reemplazo', 'operaciones', 'Mañana', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002');
update public.personal set cargo = 'Asesor senior' where id = '10000000-0000-0000-0000-000000000005';
select prueba.espero('actúa como jefatura en la 101 (editó a un asesor)', (select count(*) from public.personal where cargo = 'Asesor senior'), 1);
select prueba.debe_fallar('estando de reemplazo acepta a otros (no es de planta)',
  $$select public.resolver_movimiento(gen_random_uuid(), true)$$);

select prueba.soy('4');
select prueba.espero('el pendiente quedó en la 101', (select count(*) from public.pendientes p, prueba.ids ids where titulo = 'Creado por el reemplazo' and p.tienda_id = ids.t101), 1);
select prueba.espero('huella: creó un pendiente', (select count(*) from public.huellas_reemplazo h join public.pendientes p on p.id::text = h.registro_id where h.tabla = 'pendientes' and h.accion = 'creo' and h.persona_nombre = 'Subjefe 690' and h.tienda_origen = 690), 1);
select prueba.espero('huella: cambió a una persona', (select count(*) from public.huellas_reemplazo where tabla = 'personal' and accion = 'cambio'), 1);
update public.pendientes set descripcion = 'tocado por el jefe de planta' where titulo = 'Creado por el reemplazo';
select prueba.espero('lo que hace el jefe de planta NO deja huella', (select count(*) from public.huellas_reemplazo where tabla = 'pendientes'), 1);
select prueba.debe_fallar('borrar huellas', $$delete from public.huellas_reemplazo$$);

select prueba.soy('1');
select prueba.espero('la 690 no ve las huellas de la 101', (select count(*) from public.huellas_reemplazo), 0);
select prueba.espero('la 690 sí ve que su subjefe está de reemplazo', (select count(*) from public.movimientos_personal where estado = 'activo'), 1);

-- vence solo
reset role;
update public.movimientos_personal set hasta = current_date - 1 where tipo = 'reemplazo';
set local role authenticated;
select prueba.soy('2');
select prueba.espero('vencido: vuelve a ver su tienda', (select count(*) from public.pendientes where titulo = 'Pendiente interno de la 690'), 1);
select prueba.espero('vencido: ya no ve la 101', (select count(*) from public.personal where nombre like '% 101'), 0);

-- terminar antes de tiempo
select public.solicitar_movimiento((select t101 from prueba.ids), 'reemplazo', current_date + 3);
select prueba.soy('4');
select public.resolver_movimiento((select id from public.movimientos_personal where estado = 'solicitado'), true);
select prueba.soy('2');
select public.terminar_movimiento((select id from public.movimientos_personal where estado = 'activo'));
select prueba.espero('terminado por la persona: vuelve a su tienda', (select count(*) from public.pendientes where titulo = 'Pendiente interno de la 690'), 1);

-- rechazo
select prueba.soy('3');
select public.solicitar_movimiento((select t101 from prueba.ids), 'reemplazo', current_date + 3);
select prueba.soy('4');
select public.resolver_movimiento((select id from public.movimientos_personal where estado = 'solicitado'), false);
select prueba.soy('3');
select prueba.espero('rechazado: no entra a la 101', (select count(*) from public.personal where nombre like '% 101'), 0);

-- ================= TRASLADO: asesor de la 690 pasa a la 101 =================
select prueba.soy('1');
select prueba.debe_fallar('baja por traslado sin que otra tienda lo haya aceptado',
  $$select public.dar_baja_persona('10000000-0000-0000-0000-000000000003', 'traslado')$$);
select prueba.soy('3');
select public.solicitar_movimiento((select t101 from prueba.ids), 'traslado', null, 'Me trasladan');
select prueba.soy('4');
select prueba.debe_fallar('la tienda que recibe da la baja (le toca a la de origen)',
  $$select public.dar_baja_persona('10000000-0000-0000-0000-000000000003', 'traslado')$$);
select public.resolver_movimiento((select id from public.movimientos_personal where estado = 'solicitado'), true);
select prueba.espero('aceptado pero sin baja: la 101 aún no ve su historial', (select count(*) from public.retardos), 0);

select prueba.soy('3');
select prueba.espero('mientras tanto entra a la 101 como reemplazo', ((select public.mi_ambito()) -> 'tienda' ->> 'numero')::bigint, 101);

select prueba.soy('1');
select prueba.espero('la 690 recibe el aviso de dar la baja', (select count(*) from public.notificaciones where tipo = 'movimiento_traslado'), 1);
select public.dar_baja_persona('10000000-0000-0000-0000-000000000003', 'traslado');
select prueba.espero('la 690 ya no lo tiene en su planta', (select count(*) from public.personal where nombre = 'Asesor 690'), 0);
select prueba.espero('la 690 conserva el feedback que registró', (select count(*) from public.retardos), 1);
select prueba.espero('el pendiente abierto sobre él se fue con él', (select count(*) from public.pendientes where titulo = 'Seguimiento al asesor'), 0);
select prueba.espero('lo interno de la 690 se queda', (select count(*) from public.pendientes where titulo = 'Pendiente interno de la 690'), 1);

select prueba.soy('4');
select prueba.espero('la 101 lo tiene en su planta', (select count(*) from public.personal where nombre = 'Asesor 690'), 1);
select prueba.espero('la 101 ve su historial de feedbacks', (select count(*) from public.retardos where persona_id = '10000000-0000-0000-0000-000000000003'), 1);
select prueba.espero('la 101 gestiona el pendiente abierto', (select count(*) from public.pendientes where titulo = 'Seguimiento al asesor'), 1);
select prueba.debe_fallar('la 101 modifica el feedback que registró la 690',
  $$update public.retardos set fecha = current_date where persona_id = '10000000-0000-0000-0000-000000000003'$$);
select prueba.espero('el traslado quedó completado', (select count(*) from public.movimientos_personal where estado = 'completado'), 1);

select prueba.soy('3');
select prueba.espero('el asesor trasladado ya es de la 101', ((select public.mi_ambito()) -> 'tienda_propia' ->> 'numero')::bigint, 101);

-- ================= BAJA por cancelación de contrato y reintegro =================
select prueba.soy('5');
select prueba.debe_fallar('un asesor da de baja a otro',
  $$select public.dar_baja_persona('10000000-0000-0000-0000-000000000003', 'cancelacion_contrato')$$);
select prueba.soy('1');
select prueba.debe_fallar('la 690 da de baja a alguien de la 101',
  $$select public.dar_baja_persona('10000000-0000-0000-0000-000000000005', 'cancelacion_contrato')$$);
select prueba.soy('4');
select public.dar_baja_persona('10000000-0000-0000-0000-000000000005', 'cancelacion_contrato', 'Fin de contrato');
select prueba.soy('5');
select prueba.espero('dado de baja: no ve nada', (select count(*) from public.pendientes) + (select count(*) from public.roster_publico()), 0);
select prueba.debe_fallar('dado de baja pide un reemplazo',
  $$select public.solicitar_movimiento((select t690 from prueba.ids), 'reemplazo', current_date + 2)$$);

select prueba.soy('4');
update public.personal set activo = true, motivo_baja = null, fecha_baja = null where id = '10000000-0000-0000-0000-000000000005';
select prueba.espero('reintegrado: queda obligado a cambiar la clave', (select count(*) from public.personal where id = '10000000-0000-0000-0000-000000000005' and debe_cambiar_clave), 1);
select prueba.soy('5');
select prueba.debe_fallar('quitarse la obligación editando su fila',
  $$update public.personal set debe_cambiar_clave = false where id = '10000000-0000-0000-0000-000000000005'$$);
select public.confirmar_cambio_clave();
select prueba.espero('tras cambiar la clave queda al día', (select count(*) from public.personal where id = '10000000-0000-0000-0000-000000000005' and not debe_cambiar_clave), 1);

reset role;
\echo
\echo 'TODAS LAS PRUEBAS DE MOVIMIENTOS PASARON'
rollback;
