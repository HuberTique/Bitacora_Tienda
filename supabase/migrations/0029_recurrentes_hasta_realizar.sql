-- 0029_recurrentes_hasta_realizar.sql
--
-- Regla de la tienda para las tareas recurrentes: si no se marca como
-- realizada, la tarea sigue apareciendo al dia siguiente como vencida (y
-- recurrente) hasta que ALGUIEN de la tienda la finalice.
--
-- Cambios sobre 0028:
-- 1) No se pierde un dia: si el dia que tocaba nadie abrio la app, la tarea se
--    crea igual la proxima vez, con su fecha original (queda vencida).
-- 2) No se acumulan copias: mientras la ultima siga sin realizar no se crea
--    otra; es la misma la que sigue vencida. Al realizarla, vuelve a generarse
--    en su siguiente fecha.
-- 3) Mientras siga vencida, avisa una vez al dia al responsable.
-- 4) Cualquier persona del equipo ve los pendientes que vienen de una tarea
--    recurrente y puede marcarlos como realizados (antes un asesor solo veia
--    aquellos donde estaba involucrado).
--
-- Idempotente.

create or replace function public.generar_pendientes_recurrentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora   timestamp := now() at time zone 'America/Bogota';
  v_hoy     date      := v_ahora::date;
  v_creados integer   := 0;
  t         record;
  d         date;
  v_desde   date;
  v_toca    boolean;
  v_id      uuid;
begin
  -- Solo personas del equipo con sesion.
  if public.current_persona_id() is null then
    return 0;
  end if;

  for t in
    select * from public.tareas_recurrentes
     where activa and fecha_inicio <= v_hoy
  loop
    -- Si la ultima vez sigue sin realizar, esa misma es la que sigue vencida:
    -- no se crea otra encima.
    if exists (
      select 1 from public.pendientes p
       where p.recurrente_id = t.id and p.estado <> 'cerrado'
    ) then
      continue;
    end if;

    -- Se busca la fecha mas reciente (hoy o antes) en que tocaba. Se mira
    -- hasta 35 dias atras para cubrir una tarea mensual.
    v_desde := greatest(t.fecha_inicio, v_hoy - 35);
    d := least(v_hoy, coalesce(t.fecha_fin, v_hoy));
    while d >= v_desde loop
      v_toca :=
           t.frecuencia = 'diaria'
        or (t.frecuencia = 'semanal' and extract(dow from d)::smallint = any (t.dias_semana))
        or (t.frecuencia = 'mensual' and extract(day from d)::smallint = least(
              t.dia_mes,
              extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::smallint
            ));
      if v_toca then
        -- Si esa fecha ya se genero (y se realizo), no hay nada que crear.
        if not exists (
          select 1 from public.pendientes p
           where p.recurrente_id = t.id and p.fecha_ejecucion = d
        ) then
          v_id := null;
          insert into public.pendientes
            (titulo, area, turno, responsable_id, asesor_id, descripcion, estado, created_by, fecha_ejecucion, recurrente_id)
          values
            (t.titulo, t.area, t.turno, t.responsable_id, t.asesor_id, t.descripcion, 'abierto', t.created_by, d, t.id)
          on conflict (recurrente_id, fecha_ejecucion) where recurrente_id is not null do nothing
          returning id into v_id;

          if v_id is not null then
            v_creados := v_creados + 1;
            insert into public.notificaciones
              (tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
            values (
              'tarea_recurrente', t.responsable_id, false,
              case
                when d = v_hoy then
                  'Tarea de hoy: ' || t.titulo || coalesce(' (' || ltrim(to_char(t.hora, 'HH12:MI AM'), '0') || ')', '')
                else
                  'Tarea vencida (era del ' || to_char(d, 'DD/MM') || '): ' || t.titulo
              end,
              v_hoy, 'pendientes', v_id
            );
          end if;
        end if;
        exit; -- solo interesa la fecha mas reciente
      end if;
      d := d - 1;
    end loop;
  end loop;

  -- Recordatorio del mismo dia: la tarea tenia hora, ya paso y sigue sin realizar.
  -- (El alias es "tr" y no "t": "t" es la variable del ciclo de arriba.)
  insert into public.notificaciones
    (tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
  select 'tarea_recurrente_recordatorio', p.responsable_id, false,
         'Sigue pendiente: ' || p.titulo || ' (era a las ' || ltrim(to_char(tr.hora, 'HH12:MI AM'), '0') || ')',
         v_hoy, 'pendientes', p.id
    from public.pendientes p
    join public.tareas_recurrentes tr on tr.id = p.recurrente_id
   where p.fecha_ejecucion = v_hoy
     and p.estado <> 'cerrado'
     and tr.hora is not null
     and v_ahora::time >= tr.hora
     and p.created_at < now() - interval '30 minutes'
     and not exists (
           select 1 from public.notificaciones x
            where x.tipo = 'tarea_recurrente_recordatorio' and x.ref_id = p.id
         );

  -- Aviso diario mientras siga vencida: una vez por dia, hasta que se realice.
  -- (El dia en que se crea ya vencida sale el aviso de arriba, no este.)
  insert into public.notificaciones
    (tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
  select 'tarea_recurrente_vencida', p.responsable_id, false,
         'Sigue sin realizar: ' || p.titulo || ' (vencida desde el ' || to_char(p.fecha_ejecucion, 'DD/MM') || ')',
         v_hoy, 'pendientes', p.id
    from public.pendientes p
   where p.recurrente_id is not null
     and p.estado <> 'cerrado'
     and p.fecha_ejecucion < v_hoy
     and (p.created_at at time zone 'America/Bogota')::date < v_hoy
     and not exists (
           select 1 from public.notificaciones x
            where x.tipo = 'tarea_recurrente_vencida' and x.ref_id = p.id and x.ref_fecha = v_hoy
         );

  return v_creados;
end
$$;

revoke execute on function public.generar_pendientes_recurrentes() from public, anon;
grant  execute on function public.generar_pendientes_recurrentes() to authenticated;

-- ================================================================
-- Cualquiera del equipo ve y puede finalizar un pendiente recurrente
-- ================================================================
drop policy if exists "asesor_read_own_pendientes"   on public.pendientes;
drop policy if exists "asesor_update_own_pendientes" on public.pendientes;

-- Asesor: ve los pendientes donde esta involucrado y todos los que vienen de
-- una tarea recurrente (son tareas de la tienda, no de una persona).
create policy "asesor_read_own_pendientes"
  on public.pendientes
  for select to authenticated
  using (
    asesor_id         = public.current_persona_id()
    or responsable_id = public.current_persona_id()
    or created_by     = public.current_persona_id()
    or recurrente_id is not null
  );

-- Asesor: puede cambiar el estado de los que le asignaron y de los recurrentes.
create policy "asesor_update_own_pendientes"
  on public.pendientes
  for update to authenticated
  using      (asesor_id = public.current_persona_id() or recurrente_id is not null)
  with check (asesor_id = public.current_persona_id() or recurrente_id is not null);
