-- 0034_ingreso_nuevo.sql
--
-- Ingreso nuevo, sin la lista de nombres que cualquiera podia ver.
--
-- Reglas (definidas por Huber, 2-oct-2026):
--   * Jefatura y DSM entran con su CORREO y clave. Asesores con CM y PIN.
--   * El correo lo registra quien crea la cuenta: el administrador para jefes
--     y DSM, el jefe de tienda para sus subjefes. Nadie elige su propio correo.
--   * Clave olvidada: la restablece otra jefatura de la tienda o el
--     administrador (para asesores, su jefatura) con una clave temporal que
--     debe cambiarse al entrar. Ya no se recupera con la cedula.
--   * Consentimiento de tratamiento de datos: obligatorio para usar la app.
--     Queda registrado quien acepto, cuando y que version del texto.
--
-- El ingreso lo hace la funcion `ingresar` (Edge Function), que busca a la
-- persona por correo o CM y bloquea tras varios intentos fallidos.
--
-- Transicion: una jefatura que todavia no tiene correo registrado puede entrar
-- con su CM hasta que se le registre.
--
-- Idempotente.

-- ================================================================
-- 1) Correo de ingreso y CM unico
-- ================================================================
alter table public.personal
  add column if not exists correo text;

alter table public.personal drop constraint if exists personal_correo_formato_chk;
alter table public.personal add constraint personal_correo_formato_chk
  check (correo is null or (correo = lower(correo) and correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- Los asesores entran con CM: no llevan correo.
alter table public.personal drop constraint if exists personal_correo_solo_mando_chk;
alter table public.personal add constraint personal_correo_solo_mando_chk
  check (correo is null or rol in ('jefatura', 'dsm'));

create unique index if not exists personal_correo_uniq on public.personal (correo) where correo is not null;
-- El CM identifica a una sola persona en toda la compania (es su usuario).
create unique index if not exists personal_codigo_uniq on public.personal (codigo) where codigo is not null and codigo <> '';

create or replace function public.tg_personal_normaliza()
returns trigger language plpgsql as $$
begin
  new.correo := nullif(lower(trim(new.correo)), '');
  new.codigo := nullif(trim(new.codigo), '');
  if new.rol = 'asesor' then
    new.correo := null;
  end if;
  return new;
end $$;
-- El nombre empieza por "a_" para que corra antes que los demas triggers.
drop trigger if exists a_personal_normaliza on public.personal;
create trigger a_personal_normaliza
  before insert or update on public.personal
  for each row execute function public.tg_personal_normaliza();

-- Quien puede poner o cambiar un correo de ingreso (se suma a lo de 0033).
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

  -- (Pasar a alguien a asesor le quita el correo solo; eso no necesita permiso.)
  if new.correo is distinct from (case when tg_op = 'UPDATE' then old.correo end) and new.rol <> 'asesor' then
    select id, es_admin, rol_jerarquico into v_yo
      from public.personal where auth_user_id = auth.uid() and activo limit 1;
    if not coalesce(v_yo.es_admin, false)
       and not (v_yo.rol_jerarquico = 'jefe_tienda' and new.rol_jerarquico = 'subjefe' and new.id is distinct from v_yo.id) then
      raise exception 'El correo de ingreso lo registra el administrador, o el jefe de tienda para sus subjefes.';
    end if;
  end if;
  return new;
end $$;

-- ================================================================
-- 2) Intentos de ingreso (para bloquear tras varios fallos)
-- ================================================================
create table if not exists public.intentos_ingreso (
  id      bigint generated always as identity primary key,
  usuario text not null,          -- correo o CM tal como se escribio, en minusculas
  creado_at timestamptz not null default now()
);
create index if not exists intentos_ingreso_idx on public.intentos_ingreso (usuario, creado_at);
-- Solo la usa la funcion de ingreso con la llave de servicio.
alter table public.intentos_ingreso enable row level security;
revoke all on public.intentos_ingreso from anon, authenticated;

-- ================================================================
-- 3) La lista de nombres deja de verse sin sesion
-- ================================================================
create or replace function public.roster_publico()
returns table (id uuid, nombre text, cargo text, rol text, rol_jerarquico text, foto_path text, reemplazo boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.cargo, p.rol, p.rol_jerarquico::text, p.foto_path,
         p.tienda_id is distinct from public.current_tienda_id() as reemplazo
    from public.personal p
   where auth.uid() is not null
     and p.activo
     and p.tienda_id is not null
     and (
       p.tienda_id = public.current_tienda_id()
       or public.tienda_por_movimiento(p.id) = public.current_tienda_id()
     )
   order by p.nombre;
$$;
revoke execute on function public.roster_publico() from public, anon;
grant execute on function public.roster_publico() to authenticated, service_role;

-- ================================================================
-- 4) Consentimiento de tratamiento de datos
-- ================================================================
-- Cada texto publicado es una version. Mientras no haya ninguna publicada, la
-- app no pide nada. Al publicar una nueva, todos deben volver a aceptar.
create table if not exists public.consentimiento_versiones (
  version       integer generated always as identity primary key,
  texto         text not null check (length(trim(texto)) >= 50),
  publicado_por uuid references public.personal(id) on delete set null,
  publicado_at  timestamptz not null default now()
);

create table if not exists public.consentimientos (
  persona_id  uuid not null references public.personal(id) on delete cascade,
  version     integer not null references public.consentimiento_versiones(version) on delete restrict,
  aceptado_at timestamptz not null default now(),
  primary key (persona_id, version)
);

alter table public.consentimiento_versiones enable row level security;
alter table public.consentimientos enable row level security;
revoke all on public.consentimiento_versiones, public.consentimientos from anon, authenticated;
grant select on public.consentimiento_versiones, public.consentimientos to authenticated;
grant all on public.consentimiento_versiones, public.consentimientos to service_role;

drop policy if exists "leer versiones de consentimiento" on public.consentimiento_versiones;
create policy "leer versiones de consentimiento" on public.consentimiento_versiones for select to authenticated using (true);

-- Cada quien ve el suyo; jefatura ve los de su planta; el administrador, todos.
drop policy if exists "leer consentimientos" on public.consentimientos;
create policy "leer consentimientos" on public.consentimientos for select to authenticated
  using (
    persona_id = (select public.current_persona_id())
    or (select public.es_admin())
    or ((select public.current_persona_rol()) = 'jefatura' and public.persona_en_tienda_actual(persona_id::text))
  );

create or replace function public.consentimiento_vigente()
returns table (version integer, texto text, publicado_at timestamptz)
language sql stable security definer set search_path = public as $$
  select v.version, v.texto, v.publicado_at
    from public.consentimiento_versiones v
   order by v.version desc
   limit 1;
$$;

create or replace function public.aceptar_consentimiento(p_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_persona uuid := public.current_persona_id();
begin
  if v_persona is null then
    raise exception 'No hay una sesión activa.';
  end if;
  if p_version is distinct from (select max(version) from public.consentimiento_versiones) then
    raise exception 'El texto del consentimiento cambió. Recarga la página y léelo de nuevo.';
  end if;
  insert into public.consentimientos (persona_id, version) values (v_persona, p_version)
  on conflict do nothing;
end $$;

create or replace function public.publicar_consentimiento(p_texto text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_version integer;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede publicar el consentimiento.';
  end if;
  insert into public.consentimiento_versiones (texto, publicado_por)
  values (trim(p_texto), public.current_persona_id())
  returning version into v_version;
  return v_version;
end $$;

-- Cuantos de la tienda actual han aceptado la version vigente.
create or replace function public.consentimiento_avance()
returns table (aceptaron integer, total integer)
language sql stable security definer set search_path = public as $$
  select count(c.persona_id)::integer, count(*)::integer
    from public.personal p
    left join public.consentimientos c
      on c.persona_id = p.id and c.version = (select max(version) from public.consentimiento_versiones)
   where p.activo and p.tienda_id = public.current_tienda_id()
     and public.current_persona_rol() = 'jefatura';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'consentimiento_vigente()', 'aceptar_consentimiento(integer)',
    'publicar_consentimiento(text)', 'consentimiento_avance()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ================================================================
-- 5) mi_ambito: suma el correo y si falta aceptar el consentimiento
-- ================================================================
create or replace function public.mi_ambito()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id', p.id,
    'rol', p.rol,
    'rol_jerarquico', p.rol_jerarquico,
    'es_admin', p.es_admin,
    'correo', p.correo,
    'debe_cambiar_clave', p.debe_cambiar_clave,
    'consentimiento_pendiente',
      exists (select 1 from public.consentimiento_versiones)
      and not exists (
        select 1 from public.consentimientos c
         where c.persona_id = p.id
           and c.version = (select max(version) from public.consentimiento_versiones)),
    'distrito', (select jsonb_build_object('id', d.id, 'numero', d.numero, 'nombre', d.nombre)
                   from public.distritos d
                  where d.id = coalesce(p.distrito_id, (select distrito_id from public.tiendas where id = p.tienda_id))),
    'tienda', (select jsonb_build_object('id', t.id, 'numero', t.numero, 'nombre', t.nombre,
                                         'ciudad', t.ciudad, 'formato', t.formato)
                 from public.tiendas t where t.id = public.current_tienda_id()),
    'tienda_propia', (select jsonb_build_object('id', t.id, 'numero', t.numero, 'nombre', t.nombre)
                        from public.tiendas t where t.id = p.tienda_id),
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
