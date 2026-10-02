-- 0033_movimientos_personal.sql
--
-- Reemplazos temporales, traslados y bajas entre tiendas.
--
-- Reglas (definidas por Huber, 2-oct-2026):
--   * Una persona pertenece a UNA sola tienda.
--   * El movimiento lo pide la misma persona con su usuario: elige la tienda a
--     la que llega y dice si es REEMPLAZO temporal o TRASLADO.
--   * No tiene ningun permiso alli hasta que una jefatura de la tienda que la
--     recibe lo acepta (evita la suplantacion).
--   * Mientras el movimiento esta vigente la persona ve SOLO la tienda que la
--     recibe, con los mismos permisos que tiene en la suya (un subjefe actua
--     como jefatura). Todo lo que crea o cambia alli deja huella.
--   * El reemplazo tiene fecha de fin; vence solo y se puede terminar antes.
--   * En un traslado la persona pasa a planta de la tienda nueva cuando la
--     tienda de ORIGEN le da la baja con el concepto "traslado". Mientras
--     tanto entra a la nueva como reemplazo.
--   * Baja por cancelacion de contrato: pierde todo el acceso. Si fue un error
--     se reintegra, pero debe cambiar la clave al volver a entrar.
--   * Al trasladarse, la informacion de la persona como evaluada (feedbacks,
--     requerimientos y evidencias, evaluaciones, pendientes) la ve la tienda
--     nueva. Lo que hizo como jefatura en la tienda anterior se queda alli.
--
-- Idempotente.

create or replace function public.hoy_bogota()
returns date language sql stable as $$
  select (now() at time zone 'America/Bogota')::date;
$$;

-- ================================================================
-- 1) Movimientos
-- ================================================================
create table if not exists public.movimientos_personal (
  id                uuid primary key default gen_random_uuid(),
  persona_id        uuid not null references public.personal(id) on delete cascade,
  tienda_origen_id  uuid not null references public.tiendas(id) on delete restrict,
  tienda_destino_id uuid not null references public.tiendas(id) on delete restrict,
  tipo              text not null check (tipo in ('reemplazo', 'traslado')),
  -- solicitado -> activo -> terminado (reemplazo) | completado (traslado)
  --            -> rechazado | cancelado
  estado            text not null default 'solicitado'
                    check (estado in ('solicitado', 'activo', 'rechazado', 'terminado', 'completado', 'cancelado')),
  desde             date,
  hasta             date,
  motivo            text not null default '',
  solicitado_at     timestamptz not null default now(),
  resuelto_por      uuid references public.personal(id) on delete set null,
  resuelto_at       timestamptz,
  cerrado_por       uuid references public.personal(id) on delete set null,
  cerrado_at        timestamptz,
  constraint movimientos_tiendas_distintas_chk check (tienda_origen_id <> tienda_destino_id),
  constraint movimientos_reemplazo_con_fin_chk check (tipo <> 'reemplazo' or hasta is not null)
);
-- Una persona solo puede tener un movimiento abierto a la vez.
create unique index if not exists movimientos_un_abierto_uniq
  on public.movimientos_personal (persona_id) where estado in ('solicitado', 'activo');
create index if not exists movimientos_destino_idx on public.movimientos_personal (tienda_destino_id, estado);
create index if not exists movimientos_origen_idx  on public.movimientos_personal (tienda_origen_id, estado);

alter table public.personal
  add column if not exists debe_cambiar_clave boolean not null default false;

-- Tienda que recibe a la persona, si tiene un movimiento vigente hoy.
create or replace function public.tienda_por_movimiento(p_persona uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.tienda_destino_id
    from public.movimientos_personal m
   where m.persona_id = p_persona
     and m.estado = 'activo'
     and (m.hasta is null or m.hasta >= public.hoy_bogota())
   limit 1;
$$;
revoke execute on function public.tienda_por_movimiento(uuid) from public, anon, authenticated;

-- En que tienda esta parada la sesion (reemplaza la de 0031).
create or replace function public.current_tienda_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
           when p.es_admin then coalesce(p.tienda_foco_id, public.tienda_por_movimiento(p.id), p.tienda_id)
           when p.rol = 'dsm' then
             (select t.id from public.tiendas t
               where t.id = p.tienda_foco_id and t.distrito_id = p.distrito_id)
           else coalesce(public.tienda_por_movimiento(p.id), p.tienda_id)
         end
    from public.personal p
   where p.auth_user_id = auth.uid() and p.activo
   limit 1;
$$;

-- ¿La sesion esta trabajando en una tienda que no es la suya, por un movimiento?
create or replace function public.movimiento_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select m.id
    from public.movimientos_personal m
    join public.personal p on p.id = m.persona_id
   where p.auth_user_id = auth.uid() and p.activo
     and m.estado = 'activo'
     and (m.hasta is null or m.hasta >= public.hoy_bogota())
     and m.tienda_destino_id = public.current_tienda_id()
   limit 1;
$$;
revoke execute on function public.movimiento_actual() from public, anon;
grant execute on function public.movimiento_actual() to authenticated, service_role;

alter table public.movimientos_personal enable row level security;
revoke all on public.movimientos_personal from anon, authenticated;
grant select on public.movimientos_personal to authenticated;
grant all on public.movimientos_personal to service_role;

-- Se leen: los propios, y los de la tienda actual (como origen o destino) por
-- jefatura o DSM. Solo se escriben con las funciones de abajo.
drop policy if exists "leer movimientos" on public.movimientos_personal;
create policy "leer movimientos" on public.movimientos_personal for select to authenticated
  using (
    persona_id = (select public.current_persona_id())
    or (
      (select public.current_persona_rol()) in ('jefatura', 'dsm')
      and (select public.current_tienda_id()) in (tienda_origen_id, tienda_destino_id)
    )
  );

-- ================================================================
-- 2) Lo que la app necesita saber (reemplaza mi_ambito y roster_publico)
-- ================================================================
create or replace function public.mi_ambito()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id', p.id,
    'rol', p.rol,
    'es_admin', p.es_admin,
    'debe_cambiar_clave', p.debe_cambiar_clave,
    'distrito', (select jsonb_build_object('id', d.id, 'numero', d.numero, 'nombre', d.nombre)
                   from public.distritos d
                  where d.id = coalesce(p.distrito_id, (select distrito_id from public.tiendas where id = p.tienda_id))),
    'tienda', (select jsonb_build_object('id', t.id, 'numero', t.numero, 'nombre', t.nombre,
                                         'ciudad', t.ciudad, 'formato', t.formato)
                 from public.tiendas t where t.id = public.current_tienda_id()),
    'tienda_propia', (select jsonb_build_object('id', t.id, 'numero', t.numero, 'nombre', t.nombre)
                        from public.tiendas t where t.id = p.tienda_id),
    -- Movimiento abierto de la persona (solicitado o vigente), si lo hay.
    'movimiento', (select jsonb_build_object(
                            'id', m.id, 'tipo', m.tipo, 'estado', m.estado, 'hasta', m.hasta,
                            'vigente', m.estado = 'activo' and (m.hasta is null or m.hasta >= public.hoy_bogota()),
                            'destino', jsonb_build_object('numero', td.numero, 'nombre', td.nombre))
                     from public.movimientos_personal m
                     join public.tiendas td on td.id = m.tienda_destino_id
                    where m.persona_id = p.id and m.estado in ('solicitado', 'activo')
                      and (m.estado = 'solicitado' or m.hasta is null or m.hasta >= public.hoy_bogota())
                    limit 1),
    'tiendas', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', t.id, 'numero', t.numero, 'nombre', t.nombre, 'ciudad', t.ciudad,
                           'formato', t.formato, 'distrito', d.numero) order by t.numero)
                           from public.tiendas t
                           join public.distritos d on d.id = t.distrito_id
                          where t.activa and t.id in (select public.tiendas_accesibles())), '[]'::jsonb)
  )
    from public.personal p
   where p.auth_user_id = auth.uid() and p.activo
   limit 1;
$$;

-- El equipo de la tienda actual, mas quien esta alli de reemplazo (marcado).
drop function if exists public.roster_publico();
create function public.roster_publico()
returns table (id uuid, nombre text, cargo text, rol text, rol_jerarquico text, foto_path text, reemplazo boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.rol, p.rol_jerarquico::text, p.foto_path,
         (auth.uid() is not null and p.tienda_id is distinct from public.current_tienda_id()) as reemplazo
    from public.personal p
   where p.activo
     and p.tienda_id is not null
     and (
       auth.uid() is null
       or p.tienda_id = public.current_tienda_id()
       or public.tienda_por_movimiento(p.id) = public.current_tienda_id()
     )
   order by p.nombre;
$$;
grant execute on function public.roster_publico() to anon, authenticated, service_role;

-- Tiendas a las que se puede pedir un movimiento (todas las activas menos la propia).
create or replace function public.tiendas_para_movimiento()
returns table (id uuid, numero integer, nombre text, ciudad text)
language sql stable security definer set search_path = public as $$
  select t.id, t.numero, t.nombre, t.ciudad
    from public.tiendas t
   where t.activa
     and public.current_persona_rol() in ('jefatura', 'asesor')
     and t.id is distinct from (select tienda_id from public.personal where id = public.current_persona_id())
   order by t.numero;
$$;

-- ================================================================
-- 3) Pedir, aceptar o rechazar, y terminar
-- ================================================================
create or replace function public.avisar_jefatura(p_tienda uuid, p_tipo text, p_mensaje text, p_ref uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notificaciones
    (tienda_id, tipo, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
  values (p_tienda, p_tipo, true, p_mensaje, public.hoy_bogota(), 'movimientos_personal', p_ref);
$$;
revoke execute on function public.avisar_jefatura(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.solicitar_movimiento(
  p_tienda uuid, p_tipo text, p_hasta date default null, p_motivo text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p   public.personal;
  v_hoy date := public.hoy_bogota();
  v_id  uuid;
begin
  select * into v_p from public.personal where auth_user_id = auth.uid() and activo limit 1;
  if v_p.id is null or v_p.rol not in ('jefatura', 'asesor') then
    raise exception 'Solo el equipo de una tienda puede pedir un reemplazo o traslado.';
  end if;
  if p_tipo not in ('reemplazo', 'traslado') then
    raise exception 'Indica si es un reemplazo o un traslado.';
  end if;
  if p_tienda = v_p.tienda_id or not exists (select 1 from public.tiendas where id = p_tienda and activa) then
    raise exception 'Elige una tienda distinta a la tuya.';
  end if;
  if p_tipo = 'reemplazo' then
    if p_hasta is null or p_hasta < v_hoy then
      raise exception 'Indica hasta qué día dura el reemplazo.';
    end if;
    if p_hasta > v_hoy + 90 then
      raise exception 'Un reemplazo dura máximo 90 días. Si es definitivo, pide un traslado.';
    end if;
  end if;

  -- Los reemplazos vencidos se cierran para poder pedir uno nuevo.
  update public.movimientos_personal
     set estado = 'terminado', cerrado_at = now()
   where persona_id = v_p.id and estado = 'activo' and hasta is not null and hasta < v_hoy;

  if exists (select 1 from public.movimientos_personal where persona_id = v_p.id and estado in ('solicitado', 'activo')) then
    raise exception 'Ya tienes un reemplazo o traslado abierto. Termínalo antes de pedir otro.';
  end if;

  insert into public.movimientos_personal (persona_id, tienda_origen_id, tienda_destino_id, tipo, hasta, motivo)
  values (v_p.id, v_p.tienda_id, p_tienda, p_tipo,
          case when p_tipo = 'reemplazo' then p_hasta end, left(coalesce(p_motivo, ''), 300))
  returning id into v_id;

  perform public.avisar_jefatura(
    p_tienda, 'movimiento_solicitud',
    v_p.nombre || ' (tienda ' || (select numero from public.tiendas where id = v_p.tienda_id) || ') pide entrar por '
      || case when p_tipo = 'reemplazo' then 'reemplazo hasta el ' || to_char(p_hasta, 'DD/MM') else 'traslado' end
      || '. Acéptalo o recházalo en Personal.',
    v_id);
  return v_id;
end $$;

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
  if v_yo.id is null or v_yo.rol <> 'jefatura'
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

-- Termina un reemplazo (o cancela un traslado que no se completo). Lo pueden
-- hacer la misma persona o la jefatura de la tienda que la recibe.
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
       or (v_yo.rol = 'jefatura' and (v_yo.tienda_id = v_m.tienda_destino_id
            or (v_yo.es_admin and public.current_tienda_id() = v_m.tienda_destino_id)))
     ) then
    raise exception 'No puedes terminar este movimiento.';
  end if;
  update public.movimientos_personal
     set estado = case when v_m.estado = 'solicitado' or v_m.tipo = 'traslado' then 'cancelado' else 'terminado' end,
         cerrado_por = v_yo.id, cerrado_at = now()
   where id = p_id;
end $$;

-- ================================================================
-- 4) Bajas: por traslado, por cancelacion de contrato u otro motivo
-- ================================================================
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
  if v_yo.id is null or v_yo.rol <> 'jefatura' or v_p.id is null
     or v_p.tienda_id is distinct from public.current_tienda_id() then
    raise exception 'Solo la jefatura de la tienda de esa persona puede darle de baja.';
  end if;
  if v_p.id = v_yo.id then
    raise exception 'No puedes darte de baja a ti mismo.';
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

    -- Lo que sigue abierto sobre la persona se va con ella, para que la
    -- jefatura nueva lo pueda gestionar. Lo ya cerrado se queda en la tienda
    -- de origen y la nueva lo ve como historial (ver politicas de abajo).
    update public.pendientes set tienda_id = v_m.tienda_destino_id
     where asesor_id = p_persona and estado <> 'cerrado' and tienda_id = v_m.tienda_origen_id;
    update public.requerimientos set tienda_id = v_m.tienda_destino_id
     where persona_id = p_persona and estado = 'pendiente' and tienda_id = v_m.tienda_origen_id;
    update public.disponibilidad_pt set tienda_id = v_m.tienda_destino_id where persona_id = p_persona;
    update public.personal_codigos_alternos set tienda_id = v_m.tienda_destino_id where persona_id = p_persona;

    perform public.avisar_jefatura(
      v_m.tienda_destino_id, 'movimiento_completado',
      v_p.nombre || ' ya es de la planta de esta tienda: la tienda de origen confirmó el traslado.', v_m.id);
  else
    update public.movimientos_personal
       set estado = 'cancelado', cerrado_por = v_yo.id, cerrado_at = now()
     where persona_id = p_persona and estado in ('solicitado', 'activo');
    update public.personal
       set activo = false,
           fecha_baja = public.hoy_bogota(),
           motivo_baja = case p_concepto when 'cancelacion_contrato' then 'Cancelación de contrato'
                                        when 'renuncia' then 'Renuncia' else 'Otros' end
                         || case when coalesce(trim(p_detalle), '') <> '' then ': ' || left(trim(p_detalle), 200) else '' end
     where id = p_persona;
  end if;
end $$;

-- Quien vuelve despues de una baja debe cambiar la clave, sin importar por
-- donde se le reactive.
create or replace function public.tg_personal_reintegro()
returns trigger language plpgsql as $$
begin
  if old.activo = false and new.activo = true then
    new.debe_cambiar_clave := true;
  end if;
  return new;
end $$;
drop trigger if exists personal_reintegro on public.personal;
create trigger personal_reintegro
  before update on public.personal
  for each row execute function public.tg_personal_reintegro();

-- La app la llama despues de que la persona cambia su clave.
create or replace function public.confirmar_cambio_clave()
returns void language sql security definer set search_path = public as $$
  update public.personal set debe_cambiar_clave = false
   where auth_user_id = auth.uid() and activo;
$$;

-- Movimientos que tocan a la tienda actual, con los nombres ya resueltos (la
-- jefatura no puede leer la ficha de alguien de otra tienda). Abiertos primero
-- y los ultimos cerrados como historial.
create or replace function public.movimientos_de_tienda()
returns table (
  id uuid, persona_id uuid, persona_nombre text, persona_cargo text, persona_codigo text,
  tipo text, estado text, vigente boolean, entra boolean,
  desde date, hasta date, motivo text, solicitado_at timestamptz,
  origen_numero integer, origen_nombre text, destino_numero integer, destino_nombre text
) language sql stable security definer set search_path = public as $$
  select m.id, m.persona_id, p.nombre, p.cargo, p.codigo,
         m.tipo, m.estado,
         m.estado = 'activo' and (m.hasta is null or m.hasta >= public.hoy_bogota()),
         m.tienda_destino_id = public.current_tienda_id(),
         m.desde, m.hasta, m.motivo, m.solicitado_at,
         o.numero, o.nombre, d.numero, d.nombre
    from public.movimientos_personal m
    join public.personal p on p.id = m.persona_id
    join public.tiendas o on o.id = m.tienda_origen_id
    join public.tiendas d on d.id = m.tienda_destino_id
   where public.current_persona_rol() in ('jefatura', 'dsm')
     and public.current_tienda_id() in (m.tienda_origen_id, m.tienda_destino_id)
   order by (m.estado in ('solicitado', 'activo')) desc, m.solicitado_at desc
   limit 60;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'movimientos_de_tienda()', 'tiendas_para_movimiento()', 'solicitar_movimiento(uuid, text, date, text)',
    'resolver_movimiento(uuid, boolean)', 'terminar_movimiento(uuid)',
    'dar_baja_persona(uuid, text, text)', 'confirmar_cambio_clave()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- Nadie se quita a si mismo la obligacion de cambiar la clave editando su fila.
create or replace function public.tg_personal_protege_ambito()
returns trigger language plpgsql as $$
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
  return new;
end $$;

-- ================================================================
-- 5) Huella de lo que hace quien esta de reemplazo
-- ================================================================
create table if not exists public.huellas_reemplazo (
  id               bigint generated always as identity primary key,
  tienda_id        uuid not null references public.tiendas(id) on delete cascade,
  movimiento_id    uuid references public.movimientos_personal(id) on delete set null,
  persona_id       uuid references public.personal(id) on delete set null,
  -- Se guardan copiados: la huella debe leerse aunque la persona ya no este.
  persona_nombre   text not null,
  persona_codigo   text,
  tienda_origen    integer,
  tabla            text not null,
  registro_id      text,          -- null cuando fue una carga de muchas filas
  accion           text not null check (accion in ('creo', 'cambio', 'borro')),
  creado_at        timestamptz not null default now()
);
create index if not exists huellas_tienda_idx on public.huellas_reemplazo (tienda_id, tabla, registro_id);

alter table public.huellas_reemplazo enable row level security;
revoke all on public.huellas_reemplazo from anon, authenticated;
grant select on public.huellas_reemplazo to authenticated;
grant all on public.huellas_reemplazo to service_role;

drop policy if exists "leer huellas de la tienda" on public.huellas_reemplazo;
create policy "leer huellas de la tienda" on public.huellas_reemplazo for select to authenticated
  using (tienda_id = (select public.current_tienda_id()));

create or replace function public.registrar_huella(p_tabla text, p_registro text, p_accion text)
returns void language sql security definer set search_path = public as $$
  insert into public.huellas_reemplazo
    (tienda_id, movimiento_id, persona_id, persona_nombre, persona_codigo, tienda_origen, tabla, registro_id, accion)
  select m.tienda_destino_id, m.id, p.id, p.nombre, p.codigo,
         (select numero from public.tiendas where id = m.tienda_origen_id),
         p_tabla, p_registro, p_accion
    from public.movimientos_personal m
    join public.personal p on p.id = m.persona_id
   where m.id = public.movimiento_actual();
$$;
revoke execute on function public.registrar_huella(text, text, text) from public, anon;
grant execute on function public.registrar_huella(text, text, text) to authenticated;

-- Solo cuenta lo que la persona hace directamente desde la app: dentro de una
-- funcion del sistema current_user ya no es "authenticated" y no deja huella.
create or replace function public.tg_huella_fila()
returns trigger language plpgsql as $$
declare
  v_fila jsonb;
begin
  if current_user = 'authenticated' and public.movimiento_actual() is not null then
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
  if current_user = 'authenticated' and public.movimiento_actual() is not null then
    perform public.registrar_huella(
      tg_table_name, null,
      case tg_op when 'INSERT' then 'creo' when 'UPDATE' then 'cambio' else 'borro' end);
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  -- Registro por registro.
  foreach t in array array[
    'pendientes', 'retardos', 'requerimientos', 'magia_evaluaciones', 'maximizador_registros',
    'maximizador_items', 'tareas_recurrentes', 'festivos', 'dias_bloqueados', 'puntos_extra',
    'personal_codigos_alternos', 'disponibilidad_pt', 'horarios_config', 'ranking_config',
    'meses_retail', 'presupuestos_uploads', 'ranking_historial', 'personal'
  ] loop
    execute format('drop trigger if exists huella_reemplazo on public.%I', t);
    execute format(
      'create trigger huella_reemplazo after insert or update or delete on public.%I
         for each row execute function public.tg_huella_fila()', t);
  end loop;
  -- Cargas de muchas filas: una sola huella por operacion.
  foreach t in array array[
    'horarios', 'ventas_asesor_dia', 'presupuestos_diarios', 'presupuestos_semanales', 'kpis_mensuales'
  ] loop
    execute format('drop trigger if exists huella_reemplazo on public.%I', t);
    execute format(
      'create trigger huella_reemplazo after insert or update or delete on public.%I
         for each statement execute function public.tg_huella_carga()', t);
  end loop;
end $$;

-- ================================================================
-- 6) El historial de la persona viaja con ella (solo lectura)
-- ================================================================
-- La tienda actual ve, ademas de lo suyo, lo registrado en otras tiendas sobre
-- las personas que HOY son de su planta. Escribir sigue siendo solo en lo propio.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('retardos', 'persona_id'), ('requerimientos', 'persona_id'),
      ('magia_evaluaciones', 'persona_id'), ('maximizador_registros', 'persona_id'),
      ('pendientes', 'asesor_id')
    ) as v(tabla, col)
  loop
    execute format('drop policy if exists %I on public.%I', 'tienda_' || r.tabla, r.tabla);
    execute format('drop policy if exists %I on public.%I', 'tienda_lee_' || r.tabla, r.tabla);
    execute format('drop policy if exists %I on public.%I', 'tienda_crea_' || r.tabla, r.tabla);
    execute format('drop policy if exists %I on public.%I', 'tienda_cambia_' || r.tabla, r.tabla);
    execute format('drop policy if exists %I on public.%I', 'tienda_borra_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated
         using (tienda_id = (select public.current_tienda_id())
                or public.persona_en_tienda_actual(%I::text))',
      'tienda_lee_' || r.tabla, r.tabla, r.col);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated
         with check (tienda_id = (select public.current_tienda_id()))',
      'tienda_crea_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated
         using      (tienda_id = (select public.current_tienda_id()))
         with check (tienda_id = (select public.current_tienda_id()))',
      'tienda_cambia_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated
         using (tienda_id = (select public.current_tienda_id()))',
      'tienda_borra_' || r.tabla, r.tabla);
  end loop;
end $$;
