-- 0036_permiso_intentos_ingreso.sql
--
-- La funcion `ingresar` usa la llave de servicio para contar y registrar los
-- intentos fallidos, pero en este proyecto las tablas nuevas NO le dan permisos
-- automaticos al rol service_role (0034 solo quito los de anon/authenticated).
-- Sin esto el bloqueo tras 5 intentos no funcionaba: la funcion no podia leer
-- la tabla y dejaba pasar.
--
-- Leccion: toda tabla nueva que use una Edge Function con la llave de servicio
-- necesita su `grant ... to service_role` explicito.
--
-- Idempotente.

grant select, insert, delete on public.intentos_ingreso to service_role;
