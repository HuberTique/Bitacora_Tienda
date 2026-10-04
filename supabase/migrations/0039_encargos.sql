-- 0039_encargos.sql
--
-- Encargos temporales. Reglas de Huber, 4-oct-2026 (caso Centro Mayor: el jefe
-- de tienda esta incapacitado, el subjefe queda de jefe encargado y cajeros de
-- subjefes encargados):
--
--   * Un encargo lo asignan SOLO la DSM (en su distrito) o el administrador.
--   * La persona CONSERVA su cargo real: horarios, reparto por horas de venta y
--     ranking siguen con su rol jerarquico. Lo unico que cambia es el ACCESO:
--     mientras el encargo este vigente, la base la trata como jefatura.
--   * Fecha fin obligatoria: vence sola. Se puede extender o cerrar antes.
--   * Entra con su CM y su misma clave (no se le pide correo).
--   * Lo que haga durante el encargo deja huella, como el personal de reemplazo.
--   * Un encargado no da ni quita cargos de jefatura, no se cambia su propio
--     cargo y no restablece claves de jefatura (esto ultimo, en la funcion).
--
-- Idempotente.

-- ================================================================
-- 1) Tabla
-- ================================================================
create table if not exists public.encargos (
  id           uuid primary key default gen_random_uuid(),
  tienda_id    uuid not null references public.tiendas(id) on delete cascade,
  persona_id   uuid not null references public.personal(id) on delete cascade,
  cargo        text not null check (cargo in ('jefe_tienda', 'subjefe')),
  desde        date not null,
  hasta        date not null,
  motivo       text not null default '',
  asignado_por uuid references public.personal(id) on delete set null,
  asignado_at  timestamptz not null default now(),
  cerrado_por  uuid references public.personal(id) on delete set null,
  cerrado_at   timestamptz,
  constraint encargos_fechas_chk check (hasta >= desde)
);
create index if not exists encargos_persona_idx on public.encargos (persona_id, hasta desc);
create index if not exists encargos_tienda_idx on public.encargos (tienda_id, hasta desc);

alter table public.encargos enable row level security;
revoke all on public.encargos from anon, authenticated;
grant select on public.encargos to authenticated;
grant all on public.encargos to service_role;

-- Se leen los de la tienda que se esta viendo; se escriben solo con las funciones.
drop policy if exists "leer encargos de la tienda" on public.encargos;
create policy "leer encargos de la tienda" on public.encargos for select to authenticated
  using (tienda_id = (select public.current_tienda_id()));

-- ================================================================
-- 2) Encargo vigente y rol efectivo
-- ================================================================
-- Encargo vigente de quien tiene la sesion. Solo cuenta en la tienda del
-- encargo: si la persona esta de reemplazo en otra tienda, alli es asesor.
create or replace function public.encargo_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select e.id
    from public.encargos e
    join public.personal p on p.id = e.persona_id
   where p.auth_user_id = auth.uid() and p.activo
     and e.tienda_id = p.tienda_id
     and e.tienda_id = public.current_tienda_id()
     and e.cerrado_at is null
     and public.hoy_bogota() between e.desde and e.hasta
   order by e.hasta desc
   limit 1;
$$;

-- El rol que usan todas las politicas: un asesor con encargo vigente es jefatura.
create or replace function public.current_persona_rol()
returns text language sql stable security definer set search_path = public as $$
  select case
           when p.rol = 'asesor' and public.encargo_actual() is not null then 'jefatura'
           else p.rol
         end
    from public.personal p
   where p.auth_user_id = auth.uid() and p.activo
   limit 1;
$$;

-- Para la app: el encargo vigente de quien tiene la sesion.
create or replace function public.mi_encargo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'cargo', e.cargo, 'desde', e.desde, 'hasta', e.hasta)
    from public.encargos e
   where e.id = public.encargo_actual();
$$;

-- ================================================================
-- 3) Asignar, extender y cerrar (solo DSM del distrito o administrador)
-- ================================================================
create or replace function public.puede_gestionar_encargos(p_tienda uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.es_admin
        or (p.rol = 'dsm' and exists (select 1 from public.tiendas t
                                       where t.id = p_tienda and t.distrito_id = p.distrito_id))
      from public.personal p
     where p.auth_user_id = auth.uid() and p.activo
     limit 1), false);
$$;

create or replace function public.asignar_encargo(p_persona uuid, p_cargo text, p_hasta date, p_motivo text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_yo  uuid := public.current_persona_id();
  v_p   public.personal;
  v_id  uuid;
begin
  select * into v_p from public.personal where id = p_persona;
  if v_p.id is null or not v_p.activo then
    raise exception 'Esa persona no existe o no está activa.';
  end if;
  if not public.puede_gestionar_encargos(v_p.tienda_id) then
    raise exception 'Solo la DSM del distrito o el administrador asignan encargos.';
  end if;
  if p_cargo not in ('jefe_tienda', 'subjefe') then
    raise exception 'El encargo es de jefe de tienda o de subjefe.';
  end if;
  if v_p.rol_jerarquico = 'jefe_tienda'
     or (v_p.rol_jerarquico = 'subjefe' and p_cargo = 'subjefe') then
    raise exception 'El encargo debe ser de un cargo superior al que la persona ya tiene.';
  end if;
  if p_hasta is null or p_hasta < public.hoy_bogota() then
    raise exception 'La fecha fin es obligatoria y no puede ser anterior a hoy.';
  end if;
  if p_hasta > public.hoy_bogota() + 180 then
    raise exception 'Un encargo dura máximo 180 días; al vencer se puede extender.';
  end if;
  if exists (select 1 from public.encargos
              where persona_id = p_persona and cerrado_at is null and hasta >= public.hoy_bogota()) then
    raise exception 'Esta persona ya tiene un encargo abierto: extiéndelo o ciérralo.';
  end if;

  insert into public.encargos (tienda_id, persona_id, cargo, desde, hasta, motivo, asignado_por)
  values (v_p.tienda_id, p_persona, p_cargo, public.hoy_bogota(), p_hasta, left(trim(coalesce(p_motivo, '')), 200), v_yo)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.extender_encargo(p_id uuid, p_hasta date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e public.encargos;
begin
  select * into v_e from public.encargos where id = p_id for update;
  if v_e.id is null or v_e.cerrado_at is not null then
    raise exception 'Ese encargo ya está cerrado.';
  end if;
  if not public.puede_gestionar_encargos(v_e.tienda_id) then
    raise exception 'Solo la DSM del distrito o el administrador cambian encargos.';
  end if;
  if p_hasta is null or p_hasta < public.hoy_bogota() or p_hasta < v_e.desde then
    raise exception 'La nueva fecha fin no puede ser anterior a hoy.';
  end if;
  if p_hasta > public.hoy_bogota() + 180 then
    raise exception 'Un encargo dura máximo 180 días desde hoy.';
  end if;
  update public.encargos set hasta = p_hasta where id = p_id;
end $$;

create or replace function public.cerrar_encargo(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e public.encargos;
begin
  select * into v_e from public.encargos where id = p_id for update;
  if v_e.id is null or v_e.cerrado_at is not null then
    raise exception 'Ese encargo ya está cerrado.';
  end if;
  if not public.puede_gestionar_encargos(v_e.tienda_id) then
    raise exception 'Solo la DSM del distrito o el administrador cierran encargos.';
  end if;
  update public.encargos
     set cerrado_at = now(), cerrado_por = public.current_persona_id(),
         -- Si aun no habia empezado o termina hoy, queda con fin = hoy - 1 (sin acceso desde ya).
         hasta = least(hasta, greatest(desde, public.hoy_bogota() - 1))
   where id = p_id;
end $$;

-- ================================================================
-- 4) Movimientos y bajas: el permiso de jefatura es el rol efectivo
-- ================================================================
create or replace function public.resolver_movimiento(p_id uuid, p_aceptar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m   public.movimientos_personal;
  v_yo  public.personal;
begin
  select * into v_yo from public.personal where auth_user_id = auth.uid() and activo limit 1;
  select * into v_m from public.movimientos_personal where id = p_id for update;
  if v_m.id is null or v_m.estado <> 'solicitado' then
    raise exception 'Esa solicitud ya no está pendiente.';
  end if;
  -- Solo jefatura DE PLANTA de la tienda que recibe (o el administrador): quien
  -- esta de reemplazo no puede aceptar a otros.
  if v_yo.id is null or public.current_persona_rol() <> 'jefatura'
     or not (v_yo.tienda_id = v_m.tienda_destino_id
             or (v_yo.es_admin and public.current_tienda_id() = v_m.tienda_destino_id)) then
    raise exception 'Solo la jefatura de la tienda que recibe puede responder esta solicitud.';
  end if;
  if v_m.persona_id = v_yo.id then
    raise exception 'No puedes aceptar tu propia solicitud.';
  end if;

  if p_aceptar then
    if v_m.tipo = 'reemplazo' and v_m.hasta < public.hoy_bogota() then
      raise exception 'La fecha de fin del reemplazo ya pasó. Pídele que lo solicite de nuevo.';
    end if;
    update public.movimientos_personal
       set estado = 'activo', desde = public.hoy_bogota(), resuelto_por = v_yo.id, resuelto_at = now()
     where id = p_id;
    if v_m.tipo = 'traslado' then
      perform public.avisar_jefatura(
        v_m.tienda_origen_id, 'movimiento_traslado',
        (select nombre from public.personal where id = v_m.persona_id) || ' fue aceptado por traslado en la tienda '
          || (select numero from public.tiendas where id = v_m.tienda_destino_id)
          || '. Dale la baja por traslado en Personal para que pase a esa planta.',
        p_id);
    end if;
  else
    update public.movimientos_personal
       set estado = 'rechazado', resuelto_por = v_yo.id, resuelto_at = now()
     where id = p_id;
  end if;
end $$;

create or replace function public.terminar_movimiento(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m  public.movimientos_personal;
  v_yo public.personal;
begin
  select * into v_yo from public.personal where auth_user_id = auth.uid() and activo limit 1;
  select * into v_m from public.movimientos_personal where id = p_id for update;
  if v_m.id is null or v_m.estado not in ('solicitado', 'activo') then
    raise exception 'Ese movimiento ya está cerrado.';
  end if;
  if v_yo.id is null or not (
       v_m.persona_id = v_yo.id
       or (public.current_persona_rol() = 'jefatura' and (v_yo.tienda_id = v_m.tienda_destino_id
            or (v_yo.es_admin and public.current_tienda_id() = v_m.tienda_destino_id)))
     ) then
    raise exception 'No puedes terminar este movimiento.';
  end if;
  update public.movimientos_personal
     set estado = case when v_m.estado = 'solicitado' or v_m.tipo = 'traslado' then 'cancelado' else 'terminado' end,
         cerrado_por = v_yo.id, cerrado_at = now()
   where id = p_id;
end $$;

create or replace function public.dar_baja_persona(p_persona uuid, p_concepto text, p_detalle text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_yo public.personal;
  v_p  public.personal;
  v_m  public.movimientos_personal;
begin
  select * into v_yo from public.personal where auth_user_id = auth.uid() and activo limit 1;
  select * into v_p from public.personal where id = p_persona for update;
  -- La baja la da la jefatura de la tienda de ORIGEN (la planta de la persona).
  if v_yo.id is null or public.current_persona_rol() <> 'jefatura' or v_p.id is null
     or v_p.tienda_id is distinct from public.current_tienda_id() then
    raise exception 'Solo la jefatura de la tienda de esa persona puede darle de baja.';
  end if;
  if v_p.id = v_yo.id then
    raise exception 'No puedes darte de baja a ti mismo.';
  end if;
  -- Quien esta encargado no da de baja a la jefatura de planta.
  if v_yo.rol = 'asesor' and v_p.rol = 'jefatura' then
    raise exception 'Mientras estés encargado no puedes dar de baja a la jefatura; pídeselo a la DSM.';
  end if;
  if p_concepto not in ('traslado', 'cancelacion_contrato', 'renuncia', 'otro') then
    raise exception 'Concepto de baja no válido.';
  end if;

  if p_concepto = 'traslado' then
    select * into v_m from public.movimientos_personal
     where persona_id = p_persona and tipo = 'traslado' and estado = 'activo' for update;
    if v_m.id is null then
      raise exception 'Esta persona no tiene un traslado aceptado por otra tienda. Primero debe pedirlo y la tienda que la recibe aceptarlo.';
    end if;

    update public.personal set tienda_id = v_m.tienda_destino_id where id = p_persona;
    update public.movimientos_personal
       set estado = 'completado', cerrado_por = v_yo.id, cerrado_at = now()
     where id = v_m.id;

    update public.pendientes set tienda_id = v_m.tienda_destino_id
     where asesor_id = p_persona and estado <> 'cerrado' and tienda_id = v_m.tienda_origen_id;
    update public.requerimientos set tienda_id = v_m.tienda_destino_id
     where persona_id = p_persona and estado = 'pendiente' and tienda_id = v_m.tienda_origen_id;
    update public.disponibilidad_pt set tienda_id = v_m.tienda_destino_id where persona_id = p_persona;
    update public.personal_codigos_alternos set tienda_id = v_m.tienda_destino_id where persona_id = p_persona;
    -- Un encargo es de una tienda: con el traslado se cierra.
    update public.encargos set cerrado_at = now(), cerrado_por = v_yo.id
     where persona_id = p_persona and cerrado_at is null;

    perform public.avisar_jefatura(
      v_m.tienda_destino_id, 'movimiento_completado',
      v_p.nombre || ' ya es de la planta de esta tienda: la tienda de origen confirmó el traslado.', v_m.id);
  else
    update public.movimientos_personal
       set estado = 'cancelado', cerrado_por = v_yo.id, cerrado_at = now()
     where persona_id = p_persona and estado in ('solicitado', 'activo');
    update public.encargos set cerrado_at = now(), cerrado_por = v_yo.id
     where persona_id = p_persona and cerrado_at is null;
    update public.personal
       set activo = false,
           fecha_baja = public.hoy_bogota(),
           motivo_baja = case p_concepto when 'cancelacion_contrato' then 'Cancelación de contrato'
                                        when 'renuncia' then 'Renuncia' else 'Otros' end
                         || case when coalesce(trim(p_detalle), '') <> '' then ': ' || left(trim(p_detalle), 200) else '' end
     where id = p_persona;
  end if;
end $$;

-- ================================================================
-- 5) Un encargado no da cargos de jefatura ni cambia el suyo
-- ================================================================
create or replace function public.tg_personal_protege_ambito()
returns trigger language plpgsql as $$
declare
  v_yo record;
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- funciones del sistema y el rol de servicio
  end if;
  if tg_op = 'INSERT' then
    if new.es_admin or new.rol = 'dsm' or new.tienda_foco_id is not null then
      raise exception 'Ese tipo de cuenta solo la crea el administrador.';
    end if;
  elsif (new.tienda_id, new.distrito_id, new.es_admin, new.tienda_foco_id)
        is distinct from (old.tienda_id, old.distrito_id, old.es_admin, old.tienda_foco_id)
     or (new.rol = 'dsm') is distinct from (old.rol = 'dsm') then
    raise exception 'La tienda, el distrito y el tipo de cuenta no se cambian desde aquí.';
  elsif old.debe_cambiar_clave and not new.debe_cambiar_clave then
    raise exception 'El cambio de clave se confirma al cambiarla, no editando la persona.';
  end if;

  select id, es_admin, rol, rol_jerarquico into v_yo
    from public.personal where auth_user_id = auth.uid() and activo limit 1;

  -- Encargado (asesor con acceso de jefatura por un encargo): no crea jefaturas,
  -- no cambia cargos de jefatura y no se cambia el suyo.
  if v_yo.rol = 'asesor' and not coalesce(v_yo.es_admin, false) then
    if tg_op = 'INSERT' and new.rol <> 'asesor' then
      raise exception 'Mientras estés encargado no puedes registrar jefaturas; pídeselo a la DSM.';
    end if;
    if tg_op = 'UPDATE'
       and ((new.rol, new.rol_jerarquico) is distinct from (old.rol, old.rol_jerarquico))
       and (new.id = v_yo.id or new.rol <> 'asesor' or old.rol <> 'asesor') then
      raise exception 'Mientras estés encargado no puedes cambiar cargos de jefatura ni el tuyo.';
    end if;
  end if;

  -- (Pasar a alguien a asesor le quita el correo solo; eso no necesita permiso.)
  if new.correo is distinct from (case when tg_op = 'UPDATE' then old.correo end) and new.rol <> 'asesor' then
    if not coalesce(v_yo.es_admin, false)
       and not (v_yo.rol_jerarquico = 'jefe_tienda' and new.rol_jerarquico = 'subjefe' and new.id is distinct from v_yo.id) then
      raise exception 'El correo de ingreso lo registra el administrador, o el jefe de tienda para sus subjefes.';
    end if;
  end if;
  return new;
end $$;

-- ================================================================
-- 6) Huella de lo que hace un encargado
-- ================================================================
alter table public.huellas_reemplazo
  add column if not exists encargo_id    uuid references public.encargos(id) on delete set null,
  add column if not exists encargo_cargo text;

create or replace function public.registrar_huella(p_tabla text, p_registro text, p_accion text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mov uuid := public.movimiento_actual();
  v_enc uuid;
begin
  if v_mov is not null then
    insert into public.huellas_reemplazo
      (tienda_id, movimiento_id, persona_id, persona_nombre, persona_codigo, tienda_origen, tabla, registro_id, accion)
    select m.tienda_destino_id, m.id, p.id, p.nombre, p.codigo,
           (select numero from public.tiendas where id = m.tienda_origen_id),
           p_tabla, p_registro, p_accion
      from public.movimientos_personal m
      join public.personal p on p.id = m.persona_id
     where m.id = v_mov;
    return;
  end if;
  v_enc := public.encargo_actual();
  if v_enc is not null then
    insert into public.huellas_reemplazo
      (tienda_id, encargo_id, encargo_cargo, persona_id, persona_nombre, persona_codigo, tabla, registro_id, accion)
    select e.tienda_id, e.id, e.cargo, p.id, p.nombre, p.codigo, p_tabla, p_registro, p_accion
      from public.encargos e
      join public.personal p on p.id = e.persona_id
     where e.id = v_enc;
  end if;
end $$;

create or replace function public.tg_huella_fila()
returns trigger language plpgsql as $$
declare
  v_fila jsonb;
begin
  if current_user = 'authenticated'
     and (public.movimiento_actual() is not null or public.encargo_actual() is not null) then
    v_fila := to_jsonb(case when tg_op = 'DELETE' then old else new end);
    perform public.registrar_huella(
      tg_table_name,
      coalesce(v_fila ->> 'id', v_fila ->> 'persona_id'),
      case tg_op when 'INSERT' then 'creo' when 'UPDATE' then 'cambio' else 'borro' end);
  end if;
  return null;
end $$;

create or replace function public.tg_huella_carga()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated'
     and (public.movimiento_actual() is not null or public.encargo_actual() is not null) then
    perform public.registrar_huella(
      tg_table_name, null,
      case tg_op when 'INSERT' then 'creo' when 'UPDATE' then 'cambio' else 'borro' end);
  end if;
  return null;
end $$;

-- Las tablas que llegaron despues de 0033 tambien dejan huella.
do $$
begin
  if to_regclass('public.cargas_datos') is not null then
    drop trigger if exists huella_reemplazo on public.cargas_datos;
    create trigger huella_reemplazo after insert or update or delete on public.cargas_datos
      for each row execute function public.tg_huella_fila();
  end if;
end $$;

-- ================================================================
-- 7) Permisos de las funciones
-- ================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'encargo_actual()', 'mi_encargo()',
    'puede_gestionar_encargos(uuid)', 'asignar_encargo(uuid, text, date, text)',
    'extender_encargo(uuid, date)', 'cerrar_encargo(uuid)',
    'resolver_movimiento(uuid, boolean)', 'terminar_movimiento(uuid)',
    'dar_baja_persona(uuid, text, text)', 'registrar_huella(text, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
