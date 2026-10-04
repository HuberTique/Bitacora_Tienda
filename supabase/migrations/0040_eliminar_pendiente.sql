-- 0040_eliminar_pendiente.sql
--
-- Eliminar un pendiente mal registrado (p. ej. la IA leyó mal un correo), sin
-- que quede en el historial. Reglas de Huber, 4-oct-2026:
--
--   * Lo elimina quien lo registró o el jefe de tienda (y el administrador).
--   * Solo si sigue ABIERTO (sin pasar a progreso ni cerrarse) y dentro de las
--     24 horas siguientes a crearlo: es para corregir errores, no para borrar trabajo.
--   * Las tareas de la DSM no se eliminan desde la tienda: solo la DSM del
--     distrito o el administrador.
--   * Las tareas recurrentes no se eliminan aquí (se gestionan en Tareas recurrentes).
--   * No aparece en el tablero ni en el historial, pero queda una nota interna
--     (qué, quién y cuándo) que solo ve el administrador (y la DSM de su distrito).
--
-- Idempotente.

create table if not exists public.pendientes_eliminados (
  id             uuid primary key default gen_random_uuid(),
  tienda_id      uuid not null references public.tiendas(id) on delete cascade,
  pendiente_id   uuid not null,
  titulo         text not null,
  descripcion    text,
  area           text,
  origen         text,
  registrado_por uuid references public.personal(id) on delete set null,
  registrado_at  timestamptz,
  eliminado_por  uuid references public.personal(id) on delete set null,
  eliminado_at   timestamptz not null default now()
);
create index if not exists pendientes_eliminados_tienda_idx on public.pendientes_eliminados (tienda_id, eliminado_at desc);

alter table public.pendientes_eliminados enable row level security;
revoke all on public.pendientes_eliminados from anon, authenticated;
grant select on public.pendientes_eliminados to authenticated;
grant all on public.pendientes_eliminados to service_role;

drop policy if exists "admin y dsm leen eliminados" on public.pendientes_eliminados;
create policy "admin y dsm leen eliminados" on public.pendientes_eliminados for select to authenticated
  using (
    public.es_admin()
    or ((select public.current_persona_rol()) = 'dsm'
        and exists (select 1 from public.tiendas t
                     where t.id = tienda_id and t.distrito_id = (select distrito_id from public.personal
                                                                  where id = public.current_persona_id())))
  );

-- Borrar pendientes: solo con la función de abajo (que aplica las reglas).
drop policy if exists "pendientes_borra_solo_con_funcion" on public.pendientes;
create policy "pendientes_borra_solo_con_funcion" on public.pendientes as restrictive for delete to authenticated
  using (false);

create or replace function public.eliminar_pendiente(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_yo public.personal;
  v_p  public.pendientes;
begin
  select * into v_yo from public.personal where auth_user_id = auth.uid() and activo limit 1;
  select * into v_p from public.pendientes where id = p_id for update;
  if v_yo.id is null or v_p.id is null or v_p.tienda_id is distinct from public.current_tienda_id() then
    raise exception 'Ese pendiente no existe en esta tienda.';
  end if;

  if v_p.origen = 'dsm' then
    if not public.puede_gestionar_encargos(v_p.tienda_id) then
      raise exception 'Las tareas de la DSM solo las elimina la DSM o el administrador; desde la tienda se cierran.';
    end if;
  else
    if public.current_persona_rol() <> 'jefatura' then
      raise exception 'Solo la jefatura elimina pendientes.';
    end if;
    if not (v_yo.es_admin or v_p.created_by = v_yo.id or v_yo.rol_jerarquico = 'jefe_tienda') then
      raise exception 'Solo quien lo registró o el jefe de tienda pueden eliminarlo.';
    end if;
  end if;

  if v_p.recurrente_id is not null then
    raise exception 'Las tareas recurrentes se marcan como realizadas o se ajustan en Tareas recurrentes.';
  end if;
  if v_p.estado <> 'abierto' then
    raise exception 'Solo se elimina un pendiente que sigue abierto; si ya avanzó, ciérralo.';
  end if;
  if v_p.created_at < now() - interval '24 hours' then
    raise exception 'Solo se puede eliminar dentro de las 24 horas siguientes a registrarlo; después, ciérralo.';
  end if;

  insert into public.pendientes_eliminados
    (tienda_id, pendiente_id, titulo, descripcion, area, origen, registrado_por, registrado_at, eliminado_por)
  values (v_p.tienda_id, v_p.id, v_p.titulo, v_p.descripcion, v_p.area, v_p.origen, v_p.created_by, v_p.created_at, v_yo.id);

  delete from public.pendientes where id = p_id;
end $$;

revoke execute on function public.eliminar_pendiente(uuid) from public, anon;
grant execute on function public.eliminar_pendiente(uuid) to authenticated, service_role;
