-- 0002_personal_grants.sql
-- Fix: GRANTs explícitos para public.personal
--
-- Contexto: en el rediseño de Supabase (nuevas API keys publishable/secret),
-- las tablas creadas vía SQL no reciben grants automáticos. El service_role
-- key falla con "permission denied for table personal" al intentar insertar,
-- porque Postgres niega el acceso antes de evaluar RLS.
--
-- RLS sigue vigente (definido en 0001) — estos GRANTs solo dan el permiso base
-- para tocar la tabla; RLS filtra qué filas puede ver/modificar cada rol.

grant all privileges on public.personal to service_role;
grant all privileges on public.personal to authenticated;

-- anon NO recibe acceso directo a la tabla — solo puede llamar
-- la función public.roster_publico() (ya grantada en 0001).
