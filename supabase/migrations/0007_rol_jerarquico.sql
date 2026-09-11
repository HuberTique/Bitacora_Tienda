-- 0007_rol_jerarquico.sql
-- Fase 2 — Horarios
-- Añade columna estructurada `rol_jerarquico` a personal para reemplazar la
-- inferencia frágil desde texto libre (`cargo`). El campo `cargo` se conserva
-- porque sigue portando info libre (TEMPORAL, EMBARQUE OFICIAL, APOYO DSM,
-- especialidad, etc.), pero YA NO se usa para clasificar en generador ni
-- exportador de horarios — eso lo determina `rol_jerarquico`.
--
-- Nivel de seguridad derivado (no persistido, calculado en app):
--   jefe_tienda = 5, subjefe = 4, cajero = 4, full_time = 3, part_time = 2.

-- ================================================================
-- Enum + columna
-- ================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rol_jerarquico_t') then
    create type public.rol_jerarquico_t as enum (
      'jefe_tienda',
      'subjefe',
      'cajero',
      'full_time',
      'part_time'
    );
  end if;
end
$$;

alter table public.personal
  add column if not exists rol_jerarquico public.rol_jerarquico_t;

-- ================================================================
-- Backfill desde `cargo` (heurística que jefatura puede corregir a mano
-- después desde /personal → Editar).
-- ================================================================
update public.personal
set rol_jerarquico = case
  when upper(cargo) like '%SUB%JEFE%' then 'subjefe'::rol_jerarquico_t
  when upper(cargo) like '%JEFE%'      then 'jefe_tienda'::rol_jerarquico_t
  when upper(cargo) like '%CAJERO%'    then 'cajero'::rol_jerarquico_t
  when upper(cargo) like '%PART%TIME%' then 'part_time'::rol_jerarquico_t
  when upper(cargo) like '%PART-TIME%' then 'part_time'::rol_jerarquico_t
  else 'full_time'::rol_jerarquico_t
end
where rol_jerarquico is null;

alter table public.personal
  alter column rol_jerarquico set default 'full_time'::rol_jerarquico_t,
  alter column rol_jerarquico set not null;

create index if not exists personal_rol_jerarquico_idx
  on public.personal (rol_jerarquico);

-- ================================================================
-- RPC roster_publico incluye el nuevo campo para que el login lo tenga
-- (si se necesita más adelante para lógica cliente).
-- ================================================================
drop function if exists public.roster_publico();

create or replace function public.roster_publico()
returns table (
  id uuid,
  nombre text,
  cargo text,
  rol text,
  rol_jerarquico text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, nombre, cargo, rol, rol_jerarquico::text
  from public.personal
  where activo = true
  order by nombre;
$$;

grant execute on function public.roster_publico() to anon, authenticated;
