-- Prueba del ingreso nuevo (migración 0034): quién puede registrar un correo,
-- lista de nombres cerrada sin sesión y consentimiento de datos.
-- (La función `ingresar` y el bloqueo por intentos se prueban contra Supabase.)
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

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@prueba.local' from generate_series(1, 5) n;
insert into public.personal (id, auth_user_id, nombre, codigo, rol, rol_jerarquico, tienda_id, es_admin)
select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, nombre, '90000' || n, rol, rj::public.rol_jerarquico_t,
       (select id from public.tiendas where numero = 690), adm
  from (values
    (1, 'Jefe',      'jefatura', 'jefe_tienda', false),
    (2, 'Subjefe A', 'jefatura', 'subjefe',     false),
    (3, 'Subjefe B', 'jefatura', 'subjefe',     false),
    (4, 'Asesor',    'asesor',   'full_time',   false),
    (5, 'Admin',     'jefatura', 'subjefe',     true)
  ) as v(n, nombre, rol, rj, adm);

set local role authenticated;

-- ---------- quién registra el correo ----------
select prueba.soy('1');
update public.personal set correo = '  Sub.A@Empresa.COM ' where id = '10000000-0000-0000-0000-000000000002';
select prueba.espero('el jefe registra el correo de su subjefe (y queda en minúsculas)',
  (select count(*) from public.personal where correo = 'sub.a@empresa.com'), 1);
select prueba.debe_fallar('el jefe se pone su propio correo',
  $$update public.personal set correo = 'jefe@empresa.com' where id = '10000000-0000-0000-0000-000000000001'$$);
select prueba.debe_fallar('correo repetido',
  $$update public.personal set correo = 'sub.a@empresa.com' where id = '10000000-0000-0000-0000-000000000003'$$);
select prueba.debe_fallar('correo mal escrito',
  $$update public.personal set correo = 'sin-arroba' where id = '10000000-0000-0000-0000-000000000003'$$);
select prueba.debe_fallar('CM repetido',
  $$update public.personal set codigo = '900002' where id = '10000000-0000-0000-0000-000000000004'$$);
update public.personal set correo = 'asesor@empresa.com', cargo = 'x' where id = '10000000-0000-0000-0000-000000000004';
select prueba.espero('a un asesor no se le guarda correo', (select count(*) from public.personal where id = '10000000-0000-0000-0000-000000000004' and correo is null and cargo = 'x'), 1);

select prueba.soy('2');
select prueba.debe_fallar('un subjefe cambia su propio correo',
  $$update public.personal set correo = 'otro@empresa.com' where id = '10000000-0000-0000-0000-000000000002'$$);
select prueba.debe_fallar('un subjefe le pone correo a otro subjefe',
  $$update public.personal set correo = 'sub.b@empresa.com' where id = '10000000-0000-0000-0000-000000000003'$$);
update public.personal set cargo = 'Subjefe de tienda' where id = '10000000-0000-0000-0000-000000000003';
select prueba.espero('un subjefe sí edita otros datos', (select count(*) from public.personal where cargo = 'Subjefe de tienda'), 1);

select prueba.soy('5');
update public.personal set correo = 'jefe@empresa.com' where id = '10000000-0000-0000-0000-000000000001';
update public.personal set correo = 'admin@empresa.com' where id = '10000000-0000-0000-0000-000000000005';
select prueba.espero('el administrador registra el correo del jefe y el suyo', (select count(*) from public.personal where correo in ('jefe@empresa.com', 'admin@empresa.com')), 2);

select prueba.soy('1');
update public.personal set rol = 'asesor', rol_jerarquico = 'cajero' where id = '10000000-0000-0000-0000-000000000002';
select prueba.espero('al pasar un subjefe a asesor se le quita el correo', (select count(*) from public.personal where id = '10000000-0000-0000-0000-000000000002' and correo is null), 1);

-- ---------- consentimiento ----------
select prueba.espero('sin texto publicado nadie tiene consentimiento pendiente',
  ((select public.mi_ambito()) ->> 'consentimiento_pendiente')::boolean::int, 0);
select prueba.debe_fallar('una jefatura que no es administrador publica el consentimiento',
  $$select public.publicar_consentimiento(repeat('texto de prueba ', 10))$$);
select prueba.soy('5');
select public.publicar_consentimiento(repeat('texto de prueba ', 10));
select prueba.soy('4');
select prueba.espero('publicado: el asesor lo tiene pendiente', ((select public.mi_ambito()) ->> 'consentimiento_pendiente')::boolean::int, 1);
select prueba.debe_fallar('aceptar una versión que no es la vigente', $$select public.aceptar_consentimiento(999)$$);
select public.aceptar_consentimiento((select version from public.consentimiento_vigente()));
select prueba.espero('aceptado: ya no está pendiente', ((select public.mi_ambito()) ->> 'consentimiento_pendiente')::boolean::int, 0);
select prueba.espero('el asesor ve solo su aceptación', (select count(*) from public.consentimientos), 1);
select prueba.debe_fallar('borrar su aceptación', $$delete from public.consentimientos$$);
select prueba.soy('1');
select prueba.espero('la jefatura ve el avance de su tienda (1 de 5)', (select aceptaron * 10 + total from public.consentimiento_avance()), 15);
select prueba.soy('5');
select public.publicar_consentimiento(repeat('texto nuevo de prueba ', 10));
select prueba.soy('4');
select prueba.espero('texto nuevo: todos deben aceptar otra vez', ((select public.mi_ambito()) ->> 'consentimiento_pendiente')::boolean::int, 1);

-- ---------- sin sesión ----------
reset role;
set local role anon;
select prueba.soy(null);
select prueba.debe_fallar('ver la lista de personas sin iniciar sesión', $$select count(*) from public.roster_publico()$$);
select prueba.debe_fallar('leer los intentos de ingreso', $$select 1 from public.intentos_ingreso limit 1$$);
select prueba.debe_fallar('leer el texto del consentimiento sin sesión', $$select 1 from public.consentimiento_vigente()$$);
reset role;
set local role authenticated;
select prueba.soy('4');
select prueba.espero('con sesión el equipo sí se ve', (select count(*) from public.roster_publico()), 5);
select prueba.debe_fallar('un asesor lee los intentos de ingreso', $$select 1 from public.intentos_ingreso limit 1$$);

reset role;
\echo
\echo 'TODAS LAS PRUEBAS DE INGRESO PASARON'
rollback;
