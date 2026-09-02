-- 0005_feedbacks.sql
-- Fase 1 — módulo Feedbacks (Sprint 1: registro manual + escalamiento)
-- Idempotente.

-- ================================================================
-- Matriz de faltas (viene sembrada con DEFAULT_FALTAS_CONFIG del artifact)
-- Cada tipo tiene su ladder = pasos escalonados de acción disciplinaria.
-- ================================================================
create table if not exists public.faltas_config (
  tipo_id           text primary key,
  nombre            text not null,
  requiere_minutos  boolean not null default false,
  ladder            text[] not null,
  posicion          integer not null default 0
);

alter table public.faltas_config enable row level security;
grant all privileges on public.faltas_config to service_role, authenticated;

drop policy if exists "authenticated_read_faltas" on public.faltas_config;
create policy "authenticated_read_faltas"
  on public.faltas_config for select to authenticated using (true);

drop policy if exists "jefatura_write_faltas" on public.faltas_config;
create policy "jefatura_write_faltas"
  on public.faltas_config for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Seed inicial (idempotente vía on conflict do nothing — no sobrescribe
-- ajustes que jefatura haya hecho en producción)
insert into public.faltas_config (tipo_id, nombre, requiere_minutos, ladder, posicion) values
  ('llegada_menor10', 'Llegada tarde menor a 10 min',                      true,
   array['Feedback Verbal','Feedback Escrito','Feedback Escrito (DSM)','Descargos por escrito'], 1),
  ('llegada_10_45',   'Llegada tarde mayor a 10 y menor a 45 min',         true,
   array['Feedback Escrito (DSM)','Descargos por escrito'], 2),
  ('llegada_mayor45', 'Llegada tarde mayor a 45 min',                      true,
   array['Descargos por escrito'], 3),
  ('ausencia_total',  'Ausencia total',                                    false,
   array['Descargos por escrito'], 4),
  ('ausencia_parcial','Ausencia parcial (abandono de turno)',              false,
   array['Descargos por escrito'], 5),
  ('traspasos',       'Traspasos',                                         false,
   array['Feedback Verbal (1ra vez, P. de trabajo)','Feedback Escrito (reiterado)','Descargos (sujeto a revisión)'], 6),
  ('irrespeto_violencia','Actos de irrespeto y/o violencia',               false,
   array['Descargos'], 7)
on conflict (tipo_id) do nothing;

-- ================================================================
-- Retardos / faltas registradas (una fila por incidencia)
-- ================================================================
create table if not exists public.retardos (
  id              uuid primary key default gen_random_uuid(),
  persona_id      uuid not null references public.personal(id)      on delete restrict,
  tipo_id         text not null references public.faltas_config(tipo_id) on delete restrict,
  fecha           date not null,
  minutos         integer,
  observacion     text not null default '',
  ocurrencia      integer not null,
  accion          text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente','realizada')),
  registrado_por  uuid not null references public.personal(id)      on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists retardos_persona_idx on public.retardos (persona_id);
create index if not exists retardos_fecha_idx   on public.retardos (fecha desc);
create index if not exists retardos_tipo_idx    on public.retardos (tipo_id);
create index if not exists retardos_estado_idx  on public.retardos (estado);

drop trigger if exists set_updated_at on public.retardos;
create trigger set_updated_at
  before update on public.retardos
  for each row execute function public.tg_set_updated_at();

alter table public.retardos enable row level security;
grant all privileges on public.retardos to service_role, authenticated;

drop policy if exists "jefatura_all_retardos"   on public.retardos;
drop policy if exists "asesor_read_own_retardos" on public.retardos;

create policy "jefatura_all_retardos"
  on public.retardos for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

create policy "asesor_read_own_retardos"
  on public.retardos for select to authenticated
  using (persona_id = public.current_persona_id());

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='retardos'
  ) then
    alter publication supabase_realtime add table public.retardos;
  end if;
end $$;

-- ================================================================
-- RPC: escalamiento — cuenta previos vigentes y devuelve (ocurrencia, accion)
--
-- vigenciaMeses hardcoded a 4 (matches DEFAULT_FALTAS_CONFIG del artifact).
-- Cuando queramos hacer esto configurable, agregamos una tabla de settings
-- y leemos el valor aquí — la firma pública no cambia.
--
-- SECURITY DEFINER porque necesita ver TODOS los retardos de la persona
-- (bypassa RLS del asesor). Se llama antes de insertar una nueva falta.
-- ================================================================
create or replace function public.compute_ocurrencia(
  p_persona_id uuid,
  p_tipo_id    text,
  p_fecha      date
) returns table (ocurrencia integer, accion text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vigencia_meses int := 4;
  v_ladder text[];
  v_count  int;
  v_n      int;
  v_accion text;
begin
  select ladder into v_ladder from public.faltas_config where tipo_id = p_tipo_id;
  if v_ladder is null then
    raise exception 'Tipo de falta no existe: %', p_tipo_id;
  end if;

  select count(*) into v_count
  from public.retardos r
  where r.persona_id = p_persona_id
    and r.tipo_id    = p_tipo_id
    and r.fecha     <= p_fecha
    and r.fecha     >= (p_fecha - make_interval(months => v_vigencia_meses));

  v_n      := v_count + 1;
  v_accion := v_ladder[least(v_n, array_length(v_ladder, 1))];

  return query select v_n, v_accion;
end
$$;

grant execute on function public.compute_ocurrencia(uuid, text, date) to authenticated;
