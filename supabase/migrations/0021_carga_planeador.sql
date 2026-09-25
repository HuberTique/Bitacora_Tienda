-- 0021_carga_planeador.sql
-- Trazabilidad de la carga del planeador: qué archivo se subió, quién, cuándo y
-- hasta qué fecha llegan los datos ("fecha de corte"). Con eso se puede juzgar
-- el cumplimiento a la fecha y no contra el mes completo.
-- Idempotente.

alter table public.meses_retail
  add column if not exists archivo        text,
  add column if not exists cargado_por    uuid references public.personal(id) on delete set null,
  add column if not exists cargado_en     timestamptz,
  add column if not exists fecha_corte    date,
  add column if not exists meta_a_corte   numeric,   -- suma de la meta diaria hasta la fecha de corte
  add column if not exists venta_a_corte  numeric;   -- venta real acumulada hasta la fecha de corte

alter table public.presupuestos_uploads
  add column if not exists fecha_corte date;
