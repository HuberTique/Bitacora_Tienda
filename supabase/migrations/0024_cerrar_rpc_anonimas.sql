-- 0024_cerrar_rpc_anonimas.sql
-- Las funciones del ranking son SECURITY DEFINER y Postgres las deja ejecutables por PUBLIC
-- (incluye "anon") aunque se haga grant solo a "authenticated". Una prueba con la llave pública
-- (sin sesión) devolvía la venta de cada asesor. Se revoca el acceso anónimo y se deja solo a
-- quienes inician sesión. roster_publico() se conserva abierta: el login la usa para listar personas.
-- Idempotente.

revoke execute on function public.ranking_magia(integer, integer)       from public, anon;
revoke execute on function public.ranking_maximizador(integer, integer) from public, anon;
revoke execute on function public.ranking_faltas(integer, integer)      from public, anon;
revoke execute on function public.ranking_semanal(integer, integer)     from public, anon;
revoke execute on function public.ranking_maximizador(date, date)       from public, anon;
revoke execute on function public.ranking_faltas(date, date)            from public, anon;
revoke execute on function public.ranking_ventas(date, date)            from public, anon;
revoke execute on function public.ranking_avance(date, date, date)      from public, anon;
revoke execute on function public.confirmar_magia(uuid, text)           from public, anon;

grant execute on function public.ranking_magia(integer, integer)       to authenticated;
grant execute on function public.ranking_maximizador(integer, integer) to authenticated;
grant execute on function public.ranking_faltas(integer, integer)      to authenticated;
grant execute on function public.ranking_semanal(integer, integer)     to authenticated;
grant execute on function public.ranking_maximizador(date, date)       to authenticated;
grant execute on function public.ranking_faltas(date, date)            to authenticated;
grant execute on function public.ranking_ventas(date, date)            to authenticated;
grant execute on function public.ranking_avance(date, date, date)      to authenticated;
grant execute on function public.confirmar_magia(uuid, text)           to authenticated;
