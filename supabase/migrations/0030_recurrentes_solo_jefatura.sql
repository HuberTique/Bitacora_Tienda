-- 0030_recurrentes_solo_jefatura.sql
--
-- Correccion de 0029. Alli se dejo que cualquier persona del equipo viera y
-- cerrara los pendientes que vienen de una tarea recurrente; fue una mala
-- lectura de la regla. Lo correcto, confirmado por la tienda:
--
--   Las tareas recurrentes son SOLO de jefatura (jefe de tienda y subjefes).
--   Ningun asesor las ve en el tablero ni puede marcarlas como realizadas,
--   ni siquiera si figura como "asesor relacionado" de esa tarea.
--
-- Lo demas de 0029 no cambia: la tarea sigue vencida hasta que jefatura la
-- realiza, no se acumulan copias y no se pierde un dia.
--
-- Jefatura conserva acceso total por su propia politica ("jefatura_all_pendientes").
-- Idempotente.

drop policy if exists "asesor_read_own_pendientes"   on public.pendientes;
drop policy if exists "asesor_insert_own_pendientes" on public.pendientes;
drop policy if exists "asesor_update_own_pendientes" on public.pendientes;

-- Asesor: ve los pendientes normales donde esta involucrado. Nunca los que
-- vienen de una tarea recurrente.
create policy "asesor_read_own_pendientes"
  on public.pendientes
  for select to authenticated
  using (
    recurrente_id is null
    and (
      asesor_id         = public.current_persona_id()
      or responsable_id = public.current_persona_id()
      or created_by     = public.current_persona_id()
    )
  );

-- Asesor: puede crear pendientes normales marcandose como creador; no puede
-- crear uno haciendolo pasar por recurrente.
create policy "asesor_insert_own_pendientes"
  on public.pendientes
  for insert to authenticated
  with check (created_by = public.current_persona_id() and recurrente_id is null);

-- Asesor: puede cambiar el estado de los pendientes normales que le asignaron.
create policy "asesor_update_own_pendientes"
  on public.pendientes
  for update to authenticated
  using      (asesor_id = public.current_persona_id() and recurrente_id is null)
  with check (asesor_id = public.current_persona_id() and recurrente_id is null);
