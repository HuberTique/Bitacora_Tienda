-- 0027_jefatura_solo_mando.sql
--
-- Regla de acceso definida por la tienda: el rol "jefatura" (aprobar, ver a
-- todo el equipo, cargar datos, gestionar personal) es SOLO para jefe de
-- tienda y subjefes. Habia dos cajeros con rol de acceso "jefatura".
--
-- 1) Pasa a "asesor" a quien tenga jefatura sin ser jefe de tienda ni subjefe.
--    No cambia su cargo, su rol jerarquico ni su clave: siguen entrando con
--    la misma clave, ahora desde la opcion "Asesor".
-- 2) Deja la regla en la base para que no se pueda volver a asignar por error,
--    venga de la app, de una funcion o de un script.
-- Idempotente.

update public.personal
   set rol = 'asesor'
 where rol = 'jefatura'
   and rol_jerarquico not in ('jefe_tienda', 'subjefe');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'personal_jefatura_solo_mando_chk') then
    alter table public.personal
      add constraint personal_jefatura_solo_mando_chk
      check (rol <> 'jefatura' or rol_jerarquico in ('jefe_tienda', 'subjefe'));
  end if;
end $$;
