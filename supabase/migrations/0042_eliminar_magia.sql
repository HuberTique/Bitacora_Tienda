-- 0042_eliminar_magia.sql
--
-- Eliminar una evaluación de Magia con una sonrisa registrada por error.
-- Reglas de Huber, 6-oct-2026:
--   * La elimina quien la hizo (evaluador) o el jefe de tienda (y el administrador).
--   * Solo mientras el asesor NO la haya confirmado ("Por confirmar"): una vez
--     confirmada es un registro aceptado por ambos y, si tiene un error, se edita.
--   * Sin rastro: se borra por completo (no queda nota ni huella).
--
-- Idempotente.

-- Borrar evaluaciones: solo con la función (que aplica las reglas).
drop policy if exists "magia_borra_solo_con_funcion" on public.magia_evaluaciones;
create policy "magia_borra_solo_con_funcion" on public.magia_evaluaciones as restrictive for delete to authenticated
  using (false);

create or replace function public.eliminar_magia(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_yo public.personal;
  v_e  public.magia_evaluaciones;
begin
  select * into v_yo from public.personal where auth_user_id = auth.uid() and activo limit 1;
  select * into v_e from public.magia_evaluaciones where id = p_id for update;
  if v_yo.id is null or v_e.id is null or v_e.tienda_id is distinct from public.current_tienda_id() then
    raise exception 'Esa evaluación no existe en esta tienda.';
  end if;
  if public.current_persona_rol() <> 'jefatura' then
    raise exception 'Solo la jefatura elimina evaluaciones.';
  end if;
  if not (v_yo.es_admin or v_e.evaluador_id = v_yo.id or v_yo.rol_jerarquico = 'jefe_tienda') then
    raise exception 'Solo quien hizo la evaluación o el jefe de tienda pueden eliminarla.';
  end if;
  if v_e.confirmada_at is not null then
    raise exception 'El asesor ya confirmó esta evaluación: ya no se elimina; si tiene un error, edítala.';
  end if;
  delete from public.magia_evaluaciones where id = p_id;
end $$;

revoke execute on function public.eliminar_magia(uuid) from public, anon;
grant execute on function public.eliminar_magia(uuid) to authenticated, service_role;
