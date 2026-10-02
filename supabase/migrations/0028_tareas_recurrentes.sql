-- 0028_tareas_recurrentes.sql
--
-- Bitacora: tareas que se repiten (ej. "verificar caja menor todos los lunes").
-- Jefatura las define una vez, como una reunion recurrente de calendario, y
-- cada dia que toca aparece sola como pendiente en el tablero y avisa al
-- responsable por la campana.
--
-- 1) tareas_recurrentes: la definicion (que, quien, cada cuanto, a que hora).
-- 2) pendientes.recurrente_id: de que tarea recurrente salio un pendiente. Un
--    indice unico impide que el mismo dia se genere dos veces.
-- 3) generar_pendientes_recurrentes(): crea los pendientes de HOY que falten y
--    sus avisos. La llama la app al abrirse y cada cierto tiempo; es
--    idempotente, asi que no importa cuantas veces ni quien la llame.
--
-- Idempotente.

-- ================================================================
-- 1) Definicion de la tarea recurrente
-- ================================================================
create table if not exists public.tareas_recurrentes (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  area           text not null check (area in ('rrhh','visual','operaciones','ventas','mantenimiento','otros')),
  turno          text not null check (turno in ('Mañana','Tarde','Cierre')),
  descripcion    text not null default '',
  responsable_id uuid not null references public.personal(id) on delete restrict,
  asesor_id      uuid references public.personal(id) on delete set null,
  -- Cada cuanto se repite.
  frecuencia     text not null check (frecuencia in ('diaria','semanal','mensual')),
  dias_semana    smallint[] not null default '{}',   -- semanal: 0=domingo .. 6=sabado
  dia_mes        smallint check (dia_mes between 1 and 31), -- mensual; si el mes es mas corto, el ultimo dia
  hora           time,                                -- opcional: a que hora toca (para el recordatorio)
  fecha_inicio   date not null default current_date,
  fecha_fin      date,
  activa         boolean not null default true,
  created_by     uuid not null references public.personal(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint tareas_recurrentes_semanal_chk
    check (frecuencia <> 'semanal' or (cardinality(dias_semana) > 0 and dias_semana <@ array[0,1,2,3,4,5,6]::smallint[])),
  constraint tareas_recurrentes_mensual_chk
    check (frecuencia <> 'mensual' or dia_mes is not null),
  constraint tareas_recurrentes_fechas_chk
    check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

drop trigger if exists set_updated_at on public.tareas_recurrentes;
create trigger set_updated_at
  before update on public.tareas_recurrentes
  for each row execute function public.tg_set_updated_at();

alter table public.tareas_recurrentes enable row level security;
grant all privileges on public.tareas_recurrentes to service_role, authenticated;

-- Solo jefatura las ve y las administra. Los asesores ven el pendiente del dia
-- en el tablero si estan relacionados, como cualquier otro pendiente.
drop policy if exists "jefatura_all_tareas_recurrentes" on public.tareas_recurrentes;
create policy "jefatura_all_tareas_recurrentes"
  on public.tareas_recurrentes for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- ================================================================
-- 2) Enlace del pendiente con su tarea recurrente
-- ================================================================
alter table public.pendientes
  add column if not exists recurrente_id uuid references public.tareas_recurrentes(id) on delete set null;

-- Una tarea recurrente genera, como mucho, un pendiente por dia.
create unique index if not exists pendientes_recurrente_dia_uniq
  on public.pendientes (recurrente_id, fecha_ejecucion)
  where recurrente_id is not null;

-- ================================================================
-- 3) Generacion de los pendientes del dia y sus avisos
-- ================================================================
-- SECURITY DEFINER porque debe poder crear el pendiente y el aviso de otra
-- persona (el responsable) sin importar quien abra la app primero ese dia.
-- No recibe parametros ni devuelve datos de nadie: solo cuantos creo.
create or replace function public.generar_pendientes_recurrentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora   timestamp := now() at time zone 'America/Bogota';
  v_hoy     date      := v_ahora::date;
  v_dow     smallint  := extract(dow from v_hoy)::smallint;
  v_dia     smallint  := extract(day from v_hoy)::smallint;
  v_ultimo  smallint  := extract(day from (date_trunc('month', v_hoy) + interval '1 month - 1 day'))::smallint;
  v_creados integer   := 0;
begin
  -- Solo personas del equipo con sesion.
  if public.current_persona_id() is null then
    return 0;
  end if;

  with nuevos as (
    insert into public.pendientes
      (titulo, area, turno, responsable_id, asesor_id, descripcion, estado, created_by, fecha_ejecucion, recurrente_id)
    select t.titulo, t.area, t.turno, t.responsable_id, t.asesor_id, t.descripcion, 'abierto', t.created_by, v_hoy, t.id
      from public.tareas_recurrentes t
     where t.activa
       and t.fecha_inicio <= v_hoy
       and (t.fecha_fin is null or t.fecha_fin >= v_hoy)
       and (
             t.frecuencia = 'diaria'
          or (t.frecuencia = 'semanal' and v_dow = any (t.dias_semana))
          or (t.frecuencia = 'mensual' and least(t.dia_mes, v_ultimo) = v_dia)
       )
    on conflict (recurrente_id, fecha_ejecucion) where recurrente_id is not null do nothing
    returning id, responsable_id, titulo, recurrente_id
  ),
  avisos as (
    insert into public.notificaciones
      (tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
    select 'tarea_recurrente', n.responsable_id, false,
           'Tarea de hoy: ' || n.titulo || coalesce(' (' || ltrim(to_char(t.hora, 'HH12:MI AM'), '0') || ')', ''),
           v_hoy, 'pendientes', n.id
      from nuevos n
      join public.tareas_recurrentes t on t.id = n.recurrente_id
    returning 1
  )
  select count(*) into v_creados from nuevos;

  -- Recordatorio: si la tarea tenia hora, ya paso y el pendiente sigue sin
  -- cerrar, se avisa una sola vez mas.
  insert into public.notificaciones
    (tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
  select 'tarea_recurrente_recordatorio', p.responsable_id, false,
         'Sigue pendiente: ' || p.titulo || ' (era a las ' || ltrim(to_char(t.hora, 'HH12:MI AM'), '0') || ')',
         v_hoy, 'pendientes', p.id
    from public.pendientes p
    join public.tareas_recurrentes t on t.id = p.recurrente_id
   where p.fecha_ejecucion = v_hoy
     and p.estado <> 'cerrado'
     and t.hora is not null
     and v_ahora::time >= t.hora
     -- Si el pendiente se acaba de crear ya salio el aviso "Tarea de hoy":
     -- no se manda el recordatorio en el mismo momento.
     and p.created_at < now() - interval '30 minutes'
     and not exists (
           select 1 from public.notificaciones x
            where x.tipo = 'tarea_recurrente_recordatorio' and x.ref_id = p.id
         );

  return v_creados;
end
$$;

-- Las funciones quedan ejecutables por PUBLIC (incluye "anon") por defecto:
-- se revoca a mano y se deja solo para quien inicio sesion.
revoke execute on function public.generar_pendientes_recurrentes() from public, anon;
grant  execute on function public.generar_pendientes_recurrentes() to authenticated;
