-- 0032_horarios_reglas_festivos.sql
--
-- Horarios: reglas que llegan por correo de la DSM y que el generador ahora
-- entiende. Las propone el lector de IA y jefatura las confirma.
--
-- 1) horarios_config: dos reglas opcionales (apagadas por defecto).
--    - ft_cortos_lun_jue: preferir los dias cortos de lunes a jueves (el turno
--      largo de viernes a domingo). Preferencia, no obligacion.
--    - jefe_cierre_quincena: el jefe de tienda trabaja a cierre los fines de
--      semana de quincena.
-- 2) festivos: dias festivos en que la tienda abre. No dan descanso a nadie;
--    sirven para no pegar un descanso a un festivo (lunes festivo tras el fin
--    de semana libre) y para verlos en la cuadricula.
--
-- Por tienda, como el resto (ver 0031). Idempotente.

alter table public.horarios_config
  add column if not exists ft_cortos_lun_jue    boolean not null default false,
  add column if not exists jefe_cierre_quincena boolean not null default false,
  -- Reglas del correo que el generador no aplica solo: quedan a la vista.
  add column if not exists notas                text    not null default '';

create table if not exists public.festivos (
  id         uuid primary key default gen_random_uuid(),
  tienda_id  uuid not null default public.current_tienda_id() references public.tiendas(id) on delete restrict,
  fecha      date not null,
  nombre     text not null default '',
  creado_por uuid references public.personal(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint festivos_tienda_fecha_key unique (tienda_id, fecha)
);
create index if not exists festivos_tienda_idx on public.festivos (tienda_id);

alter table public.festivos enable row level security;
revoke all on public.festivos from anon;
grant all on public.festivos to authenticated, service_role;

drop policy if exists "tienda_festivos" on public.festivos;
create policy "tienda_festivos" on public.festivos as restrictive for all to authenticated
  using      (tienda_id = (select public.current_tienda_id()))
  with check (tienda_id = (select public.current_tienda_id()));

drop policy if exists "leer festivos" on public.festivos;
create policy "leer festivos" on public.festivos for select to authenticated using (true);

drop policy if exists "jefatura escribe festivos" on public.festivos;
create policy "jefatura escribe festivos" on public.festivos for all to authenticated
  using      ((select public.current_persona_rol()) = 'jefatura')
  with check ((select public.current_persona_rol()) = 'jefatura');
