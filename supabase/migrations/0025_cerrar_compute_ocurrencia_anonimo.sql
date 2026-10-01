-- 0025_cerrar_compute_ocurrencia_anonimo.sql
--
-- Mismo bug que 0024_cerrar_rpc_anonimas.sql ya corrigió para las RPC de
-- ranking, pero esa migración no incluyó compute_ocurrencia(): las
-- funciones SECURITY DEFINER son ejecutables por PUBLIC (incluye "anon")
-- por defecto en Postgres, aunque el GRANT explícito en 0005_feedbacks.sql
-- siempre fue solo a "authenticated". Se verificó con la llave pública
-- (sin sesión) contra producción: compute_ocurrencia respondía sin login.
--
-- Devuelve antecedentes disciplinarios reales (cuántas "ocurrencias"
-- vigentes tiene una persona para un tipo de falta y qué sanción aplica) —
-- combinado con que roster_publico() expone el persona_id de todo el
-- equipo (necesario para el login por nombre, eso sí sigue siendo
-- intencional), cualquiera sin cuenta podía enumerar el historial
-- disciplinario de cualquier colaborador real de la tienda.
--
-- Cero cambio para jefatura/asesores autenticados: el grant a
-- "authenticated" se conserva igual. Idempotente.

revoke execute on function public.compute_ocurrencia(uuid, text, date) from public, anon;
grant  execute on function public.compute_ocurrencia(uuid, text, date) to authenticated;
