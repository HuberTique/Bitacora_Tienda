-- 0041_horarios_geovictoria.sql
--
-- Horarios de GeoVictoria. Reglas de Huber, 4-oct-2026:
--
--   * Los horarios se hacen en GeoVictoria; la jefatura sube el PDF (semanal,
--     el viernes para la semana siguiente, o mensual) y la app toma las horas.
--     Lo subido reemplaza los días del período para las personas del archivo.
--   * Al subirlo se RECALCULA el reparto del mes: los días ya pasados quedan
--     congelados; lo que falta del presupuesto se reparte con las horas reales
--     (días con horario) y las del planeador en proporción (días sin horario).
--     La jefatura ve el antes/después y confirma.
--   * Para congelar lo pasado, la venta por hora de cada persona se guarda con
--     la fecha desde la que rige (tarifas_venta_hora): meta del día = venta por
--     hora vigente ese día × horas de venta del día.
--
-- Idempotente.

-- ================================================================
-- 1) Horarios: de dónde vienen y el detalle del turno
-- ================================================================
alter table public.horarios
  add column if not exists origen       text not null default 'generador',
  add column if not exists entrada      time,
  add column if not exists salida       time,
  add column if not exists descanso_min smallint;

alter table public.horarios drop constraint if exists horarios_origen_chk;
alter table public.horarios add constraint horarios_origen_chk check (origen in ('generador', 'geovictoria'));

-- GeoVictoria da horas netas con medias horas y cuartos: dos decimales.
alter table public.horarios alter column horas type numeric(4,2);

-- ================================================================
-- 2) Horas base del planeador (para proyectar los días sin horario)
-- ================================================================
alter table public.kpis_mensuales
  add column if not exists horas_plan numeric;

-- ================================================================
-- 3) Venta por hora de cada persona, con la fecha desde la que rige
-- ================================================================
create table if not exists public.tarifas_venta_hora (
  id          uuid primary key default gen_random_uuid(),
  tienda_id   uuid not null default public.current_tienda_id() references public.tiendas(id) on delete cascade,
  persona_id  uuid not null references public.personal(id) on delete cascade,
  anio        integer not null,
  mes         integer not null check (mes between 1 and 12),
  desde       date not null,
  venta_hora  numeric not null check (venta_hora >= 0),
  creado_por  uuid references public.personal(id) on delete set null,
  creado_at   timestamptz not null default now(),
  unique (persona_id, anio, mes, desde)
);
create index if not exists tarifas_venta_hora_mes_idx on public.tarifas_venta_hora (tienda_id, anio, mes);

alter table public.tarifas_venta_hora enable row level security;
revoke all on public.tarifas_venta_hora from anon;
grant select, insert, update, delete on public.tarifas_venta_hora to authenticated;
grant all on public.tarifas_venta_hora to service_role;

drop policy if exists "tienda_tarifas_venta_hora" on public.tarifas_venta_hora;
create policy "tienda_tarifas_venta_hora" on public.tarifas_venta_hora as restrictive for all to authenticated
  using      (tienda_id = (select public.current_tienda_id()))
  with check (tienda_id = (select public.current_tienda_id()));

-- Como el presupuesto: lo ve todo el equipo; lo escribe la jefatura.
drop policy if exists "leer tarifas" on public.tarifas_venta_hora;
create policy "leer tarifas" on public.tarifas_venta_hora for select to authenticated using (true);
drop policy if exists "jefatura escribe tarifas" on public.tarifas_venta_hora;
create policy "jefatura escribe tarifas" on public.tarifas_venta_hora for all to authenticated
  using      ((select public.current_persona_rol()) = 'jefatura')
  with check ((select public.current_persona_rol()) = 'jefatura');

drop trigger if exists huella_reemplazo on public.tarifas_venta_hora;
create trigger huella_reemplazo after insert or update or delete on public.tarifas_venta_hora
  for each statement execute function public.tg_huella_carga();

-- ================================================================
-- 4) Historial de cargas: también los horarios de GeoVictoria
-- ================================================================
alter table public.cargas_datos drop constraint if exists cargas_datos_tipo_check;
alter table public.cargas_datos add constraint cargas_datos_tipo_check
  check (tipo in ('presupuesto', 'ventas_consolidadas', 'transacciones', 'horarios'));
alter table public.cargas_datos drop constraint if exists cargas_datos_origen_check;
alter table public.cargas_datos add constraint cargas_datos_origen_check
  check (origen in ('planeador', 'manual', 'pdf', 'xstore', 'geovictoria'));
