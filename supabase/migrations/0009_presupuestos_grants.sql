-- 0009_presupuestos_grants.sql
-- Fix de 0008: faltó grant a authenticated. RLS controla qué filas se
-- pueden leer/escribir, pero el usuario primero necesita permiso base
-- sobre la tabla (Postgres GRANT). Sin esto, cualquier consulta desde
-- el cliente falla con "permission denied for table".

grant select, insert, update, delete on public.presupuestos_uploads   to authenticated;
grant select, insert, update, delete on public.presupuestos_semanales to authenticated;
grant select, insert, update, delete on public.presupuestos_diarios   to authenticated;
