-- 0026_formato_tienda_magia.sql
--
-- La marca tiene dos formatos de tienda, Concept y Outlet, y la evaluacion
-- "Magia con una sonrisa" cambia segun el formato: la 2.a y 3.a letra (A y G)
-- evaluan cosas distintas y el nivel 4 de la escala se llama distinto.
--
-- 1) tienda_config.formato: lo elige jefatura en Personal > Datos de la tienda.
--    Queda aqui (y no dentro de Magia) porque mas adelante otras dinamicas
--    tambien van a variar por formato.
-- 2) magia_evaluaciones.formato: cada evaluacion guarda con que formato se
--    hizo, para que el historico y el PDF de una evaluacion vieja no cambien
--    de textos si la tienda cambia de formato despues.
--
-- Solo agrega columnas con valor por defecto 'concept': la tienda actual y las
-- evaluaciones ya registradas son Concept. No toca datos ni permisos.
-- Idempotente.

alter table public.tienda_config
  add column if not exists formato text not null default 'concept';

alter table public.magia_evaluaciones
  add column if not exists formato text not null default 'concept';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tienda_config_formato_chk') then
    alter table public.tienda_config
      add constraint tienda_config_formato_chk check (formato in ('concept', 'outlet'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'magia_evaluaciones_formato_chk') then
    alter table public.magia_evaluaciones
      add constraint magia_evaluaciones_formato_chk check (formato in ('concept', 'outlet'));
  end if;
end $$;
