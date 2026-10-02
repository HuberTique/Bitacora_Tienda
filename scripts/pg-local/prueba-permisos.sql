-- Prueba de humo de la base local: confirma que las políticas RLS se comportan
-- como en Supabase (un asesor no ve ni marca tareas recurrentes, un anónimo no
-- lee nada). Todo va en una transacción que se deshace al final.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'jefe@prueba.local'),
  ('00000000-0000-0000-0000-00000000000b', 'asesor@prueba.local');

insert into public.personal (id, auth_user_id, nombre, rol, rol_jerarquico) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Jefe Prueba',   'jefatura', 'jefe_tienda'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Asesor Prueba', 'asesor',   'full_time');

\echo '--- como jefatura: crea una tarea recurrente diaria y la genera'
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into public.tareas_recurrentes (titulo, area, turno, frecuencia, fecha_inicio, responsable_id, created_by)
values ('PRUEBA LOCAL', 'operaciones', 'Mañana', 'diaria', current_date, '10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a');
select public.generar_pendientes_recurrentes();
select count(*) as pendientes_que_ve_jefatura from public.pendientes where recurrente_id is not null;

\echo '--- como asesor: no debe ver ninguna (esperado 0)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select count(*) as pendientes_que_ve_asesor from public.pendientes where recurrente_id is not null;
select count(*) as tareas_que_ve_asesor from public.tareas_recurrentes;

\echo '--- como anónimo: no debe leer personal (esperado 0)'
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select count(*) as personal_que_ve_anonimo from public.personal;

reset role;
rollback;
