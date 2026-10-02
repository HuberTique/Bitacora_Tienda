-- 0031_distritos_tiendas.sql
--
-- La app deja de ser de una sola tienda. Estructura: distrito -> tienda ->
-- persona, y cada dato queda marcado con su tienda y aislado por permisos.
--
-- Reglas (definidas por Huber, 2-oct-2026):
--   * Una persona pertenece a UNA sola tienda.
--   * Jefatura y asesores solo ven y tocan lo de su tienda.
--   * La DSM no pertenece a ninguna tienda: tiene un distrito. "Entra" a una
--     tienda de su distrito y ve todo lo interno, pero solo escribe tareas
--     (pendientes) marcadas con la etiqueta DSM.
--   * El administrador (dueno del proyecto) puede entrar a cualquier tienda
--     para validar lo que reporten como falla.
--
-- Como funciona el aislamiento:
--   * current_tienda_id() dice en que tienda esta parada la sesion: la propia
--     para el equipo de tienda; la "tienda en foco" para DSM y administrador
--     (se cambia con entrar_tienda()).
--   * Cada tabla tiene una politica RESTRICTIVA "tienda_id = current_tienda_id()".
--     Las politicas que ya existian (jefatura todo, asesor lo suyo) siguen
--     igual y se combinan con esa: nadie cruza de tienda.
--   * tienda_id se llena solo al insertar (default), asi la app no tiene que
--     enviarlo.
--
-- Todo lo existente queda en la tienda 690 (distrito 90).
-- Idempotente.

-- ================================================================
-- 1) Distritos y tiendas
-- ================================================================
create table if not exists public.distritos (
  id         uuid primary key default gen_random_uuid(),
  numero     integer not null unique,
  nombre     text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.tiendas (
  id          uuid primary key default gen_random_uuid(),
  numero      integer not null unique,
  nombre      text not null,
  ciudad      text not null default '',
  formato     text not null default 'concept' check (formato in ('concept', 'outlet')),
  distrito_id uuid not null references public.distritos(id) on delete restrict,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tiendas_distrito_idx on public.tiendas (distrito_id);

drop trigger if exists set_updated_at on public.tiendas;
create trigger set_updated_at
  before update on public.tiendas
  for each row execute function public.tg_set_updated_at();

insert into public.distritos (numero, nombre) values (90, 'Distrito 90'), (68, 'Distrito 68')
on conflict (numero) do nothing;

-- La tienda que ya existia: sus datos salen de tienda_config (si aun existe).
do $$
declare
  v_nombre  text := 'MALL PLAZA NQS';
  v_ciudad  text := 'Bogotá, Colombia';
  v_formato text := 'concept';
begin
  if exists (select 1 from public.tiendas where numero = 690) then
    return;
  end if;
  if to_regclass('public.tienda_config') is not null then
    execute 'select nombre, ciudad, formato from public.tienda_config limit 1'
      into v_nombre, v_ciudad, v_formato;
  end if;
  insert into public.tiendas (numero, nombre, ciudad, formato, distrito_id)
  values (690, coalesce(v_nombre, 'MALL PLAZA NQS'), coalesce(v_ciudad, ''), coalesce(v_formato, 'concept'),
          (select id from public.distritos where numero = 90));
end $$;

-- ================================================================
-- 2) Personal: tienda, distrito, administrador y tienda en foco
-- ================================================================
alter table public.personal
  add column if not exists tienda_id      uuid references public.tiendas(id) on delete restrict,
  add column if not exists distrito_id    uuid references public.distritos(id) on delete restrict,
  add column if not exists es_admin       boolean not null default false,
  add column if not exists tienda_foco_id uuid references public.tiendas(id) on delete set null;

alter table public.personal disable trigger user;
update public.personal
   set tienda_id = (select id from public.tiendas where numero = 690)
 where tienda_id is null and rol in ('jefatura', 'asesor');
alter table public.personal enable trigger user;

create index if not exists personal_tienda_idx on public.personal (tienda_id);

alter table public.personal drop constraint if exists personal_rol_check;
alter table public.personal add constraint personal_rol_check
  check (rol in ('jefatura', 'asesor', 'dsm'));

-- Equipo de tienda: siempre con tienda. DSM: sin tienda y con distrito.
alter table public.personal drop constraint if exists personal_ambito_chk;
alter table public.personal add constraint personal_ambito_chk check (
     (rol in ('jefatura', 'asesor') and tienda_id is not null and distrito_id is null)
  or (rol = 'dsm' and tienda_id is null and distrito_id is not null)
);

-- ================================================================
-- 3) Funciones de identidad
-- ================================================================
-- Una persona dada de baja pierde todos los permisos: para la base deja de
-- tener rol, persona y tienda.
create or replace function public.current_persona_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.personal where auth_user_id = auth.uid() and activo limit 1;
$$;

create or replace function public.current_persona_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.personal where auth_user_id = auth.uid() and activo limit 1;
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select es_admin from public.personal where auth_user_id = auth.uid() and activo limit 1),
    false);
$$;

-- En que tienda esta parada la sesion.
create or replace function public.current_tienda_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
           when p.es_admin then coalesce(p.tienda_foco_id, p.tienda_id)
           when p.rol = 'dsm' then
             (select t.id from public.tiendas t
               where t.id = p.tienda_foco_id and t.distrito_id = p.distrito_id)
           else p.tienda_id
         end
    from public.personal p
   where p.auth_user_id = auth.uid() and p.activo
   limit 1;
$$;

-- Tiendas a las que la sesion puede entrar.
create or replace function public.tiendas_accesibles()
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.id
    from public.tiendas t
    join public.personal p on p.auth_user_id = auth.uid() and p.activo
   where p.es_admin
      or t.id = p.tienda_id
      or (p.rol = 'dsm' and t.distrito_id = p.distrito_id);
$$;

-- DSM y administrador eligen la tienda que quieren ver. null = salir.
create or replace function public.entrar_tienda(p_tienda uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_persona public.personal;
begin
  select * into v_persona from public.personal where auth_user_id = auth.uid() and activo limit 1;
  if v_persona.id is null or not (v_persona.es_admin or v_persona.rol = 'dsm') then
    raise exception 'Solo la DSM o el administrador pueden cambiar de tienda.';
  end if;
  if p_tienda is not null and p_tienda not in (select public.tiendas_accesibles()) then
    raise exception 'Esa tienda no pertenece a tu distrito.';
  end if;
  update public.personal set tienda_foco_id = p_tienda where id = v_persona.id;
  return p_tienda;
end $$;

-- Lo que la app necesita saber al abrir: quien soy, donde estoy y a donde puedo ir.
create or replace function public.mi_ambito()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id', p.id,
    'rol', p.rol,
    'es_admin', p.es_admin,
    'distrito', (select jsonb_build_object('id', d.id, 'numero', d.numero, 'nombre', d.nombre)
                   from public.distritos d
                  where d.id = coalesce(p.distrito_id, (select distrito_id from public.tiendas where id = p.tienda_id))),
    'tienda', (select jsonb_build_object('id', t.id, 'numero', t.numero, 'nombre', t.nombre,
                                         'ciudad', t.ciudad, 'formato', t.formato)
                 from public.tiendas t where t.id = public.current_tienda_id()),
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

do $$
declare f text;
begin
  foreach f in array array[
    'es_admin()', 'current_tienda_id()', 'tiendas_accesibles()', 'entrar_tienda(uuid)', 'mi_ambito()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ================================================================
-- 4) Permisos de distritos y tiendas
-- ================================================================
alter table public.distritos enable row level security;
alter table public.tiendas   enable row level security;
revoke all on public.distritos, public.tiendas from anon;
revoke all on public.distritos, public.tiendas from authenticated;
grant select on public.distritos, public.tiendas to authenticated;
-- Jefatura puede corregir nombre, ciudad y formato de su tienda; numero,
-- distrito y estado solo los cambia el administrador.
grant update (nombre, ciudad, formato) on public.tiendas to authenticated;
grant all on public.distritos, public.tiendas to service_role;

drop policy if exists "leer distritos" on public.distritos;
create policy "leer distritos" on public.distritos for select to authenticated using (true);

drop policy if exists "leer tiendas accesibles" on public.tiendas;
create policy "leer tiendas accesibles" on public.tiendas for select to authenticated
  using (id in (select public.tiendas_accesibles()));

drop policy if exists "jefatura corrige su tienda" on public.tiendas;
create policy "jefatura corrige su tienda" on public.tiendas for update to authenticated
  using      (id = (select public.current_tienda_id()) and (select public.current_persona_rol()) = 'jefatura')
  with check (id = (select public.current_tienda_id()) and (select public.current_persona_rol()) = 'jefatura');

-- ================================================================
-- 5) Personal: aislamiento y proteccion de los campos de alcance
-- ================================================================
-- Ojo: en las politicas de personal las funciones se llaman directo, sin
-- envolverlas en "(select ...)". Otra politica de esta tabla ya se consulta a
-- si misma, y con un subselect aqui PostgreSQL lo toma como recursion infinita.
drop policy if exists "tienda_personal" on public.personal;
create policy "tienda_personal" on public.personal as restrictive for all to authenticated
  using      (tienda_id = public.current_tienda_id() or auth_user_id = auth.uid())
  with check (tienda_id = public.current_tienda_id() or auth_user_id = auth.uid());

drop policy if exists "dsm_lee_personal" on public.personal;
create policy "dsm_lee_personal" on public.personal for select to authenticated
  using (public.current_persona_rol() = 'dsm');

-- Nadie se cambia a si mismo (ni a otro) de tienda, de distrito o a
-- administrador desde la app. Eso solo pasa por funciones del sistema.
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
  end if;
  return new;
end $$;

drop trigger if exists personal_protege_ambito on public.personal;
create trigger personal_protege_ambito
  before insert or update on public.personal
  for each row execute function public.tg_personal_protege_ambito();

-- ================================================================
-- 6) tienda_id en todas las tablas de datos + politica restrictiva
-- ================================================================
do $$
declare
  t text;
  v_690 uuid := (select id from public.tiendas where numero = 690);
begin
  foreach t in array array[
    'pendientes', 'retardos', 'disponibilidad_pt', 'dias_bloqueados', 'horarios',
    'presupuestos_uploads', 'presupuestos_semanales', 'presupuestos_diarios',
    'ventas_asesor_dia', 'personal_codigos_alternos', 'requerimientos', 'notificaciones',
    'horarios_config', 'kpis_mensuales', 'magia_evaluaciones', 'maximizador_items',
    'maximizador_registros', 'ranking_config', 'ranking_historial', 'puntos_extra',
    'meses_retail', 'tareas_recurrentes'
  ] loop
    execute format('alter table public.%I add column if not exists tienda_id uuid references public.tiendas(id) on delete restrict', t);
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I set tienda_id = $1 where tienda_id is null', t) using v_690;
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column tienda_id set default public.current_tienda_id()', t);
    execute format('alter table public.%I alter column tienda_id set not null', t);
    execute format('create index if not exists %I on public.%I (tienda_id)', t || '_tienda_idx', t);

    execute format('drop policy if exists %I on public.%I', 'tienda_' || t, t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using      (tienda_id = (select public.current_tienda_id()))
         with check (tienda_id = (select public.current_tienda_id()))',
      'tienda_' || t, t);

    -- La DSM ve todo lo interno de la tienda a la que entro (solo lectura).
    execute format('drop policy if exists %I on public.%I', 'dsm_lee_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using ((select public.current_persona_rol()) = ''dsm'')',
      'dsm_lee_' || t, t);
  end loop;
end $$;

-- ================================================================
-- 7) Claves que eran "una por app" y ahora son "una por tienda"
-- ================================================================
alter table public.dias_bloqueados drop constraint if exists dias_bloqueados_fecha_key;
alter table public.dias_bloqueados drop constraint if exists dias_bloqueados_tienda_fecha_key;
alter table public.dias_bloqueados add constraint dias_bloqueados_tienda_fecha_key unique (tienda_id, fecha);

alter table public.presupuestos_diarios drop constraint if exists presupuestos_diarios_fecha_key;
alter table public.presupuestos_diarios drop constraint if exists presupuestos_diarios_tienda_fecha_key;
alter table public.presupuestos_diarios add constraint presupuestos_diarios_tienda_fecha_key unique (tienda_id, fecha);

alter table public.horarios_config drop constraint if exists horarios_config_pkey;
alter table public.horarios_config add constraint horarios_config_pkey primary key (tienda_id);

alter table public.ranking_config drop constraint if exists ranking_config_pkey;
alter table public.ranking_config add constraint ranking_config_pkey primary key (tienda_id);

alter table public.meses_retail drop constraint if exists meses_retail_pkey;
alter table public.meses_retail add constraint meses_retail_pkey primary key (tienda_id, anio, mes);

-- tienda_config (una sola fila) se reemplaza por la tabla tiendas.
drop table if exists public.tienda_config;

-- La matriz de faltas es politica de la compania: igual para todas las
-- tiendas. La leen todos; la cambian las DSM y el administrador.
drop policy if exists "jefatura_write_faltas" on public.faltas_config;
drop policy if exists "admin_write_faltas" on public.faltas_config;
drop policy if exists "dsm_admin_write_faltas" on public.faltas_config;
create policy "dsm_admin_write_faltas" on public.faltas_config for all to authenticated
  using      ((select public.es_admin()) or (select public.current_persona_rol()) = 'dsm')
  with check ((select public.es_admin()) or (select public.current_persona_rol()) = 'dsm');

-- ================================================================
-- 8) Tareas de la DSM en el tablero de pendientes
-- ================================================================
alter table public.pendientes
  add column if not exists origen text not null default 'tienda';
alter table public.pendientes drop constraint if exists pendientes_origen_chk;
alter table public.pendientes add constraint pendientes_origen_chk check (origen in ('tienda', 'dsm'));

drop policy if exists "dsm_escribe_pendientes" on public.pendientes;
create policy "dsm_escribe_pendientes" on public.pendientes for all to authenticated
  using      ((select public.current_persona_rol()) = 'dsm' and origen = 'dsm' and created_by = (select public.current_persona_id()))
  with check ((select public.current_persona_rol()) = 'dsm' and origen = 'dsm' and created_by = (select public.current_persona_id()));

-- La etiqueta DSM solo la pone la DSM, y la tienda no la puede quitar.
create or replace function public.tg_pendientes_origen()
returns trigger language plpgsql as $$
declare
  v_rol text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  v_rol := public.current_persona_rol();
  if tg_op = 'INSERT' then
    if (new.origen = 'dsm') is distinct from (v_rol = 'dsm') then
      raise exception 'La etiqueta DSM es solo para tareas creadas por la DSM.';
    end if;
  elsif new.origen is distinct from old.origen then
    raise exception 'El origen de una tarea no se cambia.';
  end if;
  return new;
end $$;

drop trigger if exists pendientes_origen on public.pendientes;
create trigger pendientes_origen
  before insert or update on public.pendientes
  for each row execute function public.tg_pendientes_origen();

-- La DSM tambien avisa por la campana cuando crea una tarea.
drop policy if exists "insert notificaciones" on public.notificaciones;
create policy "insert notificaciones" on public.notificaciones for insert to authenticated
  with check (true);

-- ================================================================
-- 9) Funciones que leian "toda la app": ahora solo la tienda actual
-- ================================================================
create or replace function public.roster_publico()
returns table (id uuid, nombre text, cargo text, rol text, rol_jerarquico text, foto_path text)
language sql stable security definer set search_path = public as $$
  -- Con sesion: el equipo de la tienda actual. Sin sesion (pantalla de ingreso
  -- actual): se mantiene mientras llega el ingreso nuevo, que lo cierra.
  select p.id, p.nombre, p.cargo, p.rol, p.rol_jerarquico::text, p.foto_path
    from public.personal p
   where p.activo
     and p.tienda_id is not null
     and (auth.uid() is null or p.tienda_id = public.current_tienda_id())
   order by p.nombre;
$$;

create or replace function public.check_distribucion_pct()
returns trigger language plpgsql as $$
declare
  total numeric;
begin
  if new.estado = 'aprobado' then
    select coalesce(sum(distribucion_pct), 0)
    into total
    from public.personal_codigos_alternos
    where codigo = new.codigo
      and tienda_id = new.tienda_id
      and estado = 'aprobado'
      and id <> new.id;
    if total + new.distribucion_pct > 1.0001 then
      raise exception 'La suma de distribuciones aprobadas del código % excedería 100%% (actual %, intentando sumar %). Ajusta los porcentajes de las otras filas primero.',
        new.codigo, round(total * 100, 1), round(new.distribucion_pct * 100, 1);
    end if;
  end if;
  return new;
end $$;

-- La escala de faltas sigue a la persona (cuenta su historial completo), pero
-- solo se puede consultar por alguien de la tienda actual.
create or replace function public.compute_ocurrencia(p_persona_id uuid, p_tipo_id text, p_fecha date)
returns table (ocurrencia integer, accion text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_vigencia_meses int := 4;
  v_ladder text[];
  v_count  int;
  v_n      int;
  v_accion text;
begin
  if not exists (
    select 1 from public.personal
     where id = p_persona_id and tienda_id = public.current_tienda_id()
  ) then
    raise exception 'Esa persona no pertenece a esta tienda.';
  end if;

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
end $$;

create or replace function public.ranking_avance(p_desde date, p_hasta date, p_corte date default null)
returns table (ultimo_cierre date, dias_cerrados integer, meta_total numeric, meta_a_cierre numeric, venta_total numeric)
language sql stable security definer set search_path = public as $$
  with cierres as (
    select v.fecha, sum(v.venta) as venta
    from public.ventas_asesor_dia v
    where v.fecha between p_desde and p_hasta
      and v.tienda_id = public.current_tienda_id()
    group by v.fecha
  ),
  ult as (select greatest(p_corte, (select max(fecha) from cierres)) as f)
  select
    (select f from ult),
    (select count(*) from cierres)::integer,
    coalesce((select sum(d.meta) from public.presupuestos_diarios d
              where d.fecha between p_desde and p_hasta
                and d.tienda_id = public.current_tienda_id()), 0)::numeric,
    coalesce((select sum(d.meta) from public.presupuestos_diarios d
              where d.fecha between p_desde and (select f from ult)
                and d.tienda_id = public.current_tienda_id()), 0)::numeric,
    coalesce((select sum(venta) from cierres), 0)::numeric;
$$;

create or replace function public.ranking_faltas(p_desde date, p_hasta date)
returns table (persona_id uuid, faltas integer, penalizacion numeric)
language sql stable security definer set search_path = public as $$
  select r.persona_id,
         count(*)::integer,
         sum(case r.tipo_id
               when 'llegada_menor10'      then 10
               when 'llegada_10_45'        then 20
               when 'llegada_mayor45'      then 35
               when 'ausencia_parcial'     then 35
               when 'ausencia_total'       then 50
               when 'traspasos'            then 15
               when 'irrespeto_violencia'  then 100
               else 20
             end)::numeric
  from public.retardos r
  where r.fecha between p_desde and p_hasta
    and r.tienda_id = public.current_tienda_id()
  group by r.persona_id;
$$;

create or replace function public.ranking_faltas(p_anio integer, p_mes integer)
returns table (persona_id uuid, faltas integer, penalizacion numeric)
language sql stable security definer set search_path = public as $$
  select r.persona_id,
         count(*)::integer,
         sum(case r.tipo_id
               when 'llegada_menor10'      then 10
               when 'llegada_10_45'        then 20
               when 'llegada_mayor45'      then 35
               when 'ausencia_parcial'     then 35
               when 'ausencia_total'       then 50
               when 'traspasos'            then 15
               when 'irrespeto_violencia'  then 100
               else 20
             end)::numeric
  from public.retardos r
  where extract(year from r.fecha) = p_anio and extract(month from r.fecha) = p_mes
    and r.tienda_id = public.current_tienda_id()
  group by r.persona_id;
$$;

create or replace function public.ranking_magia(p_anio integer, p_mes integer)
returns table (persona_id uuid, promedio numeric, evaluaciones integer)
language sql stable security definer set search_path = public as $$
  select m.persona_id,
         avg(m.c_sonrisa + m.c_preguntas + m.c_experiencia + m.c_tecnologias
             + m.c_cierre + m.impresion_final)::numeric as promedio,
         count(*)::integer as evaluaciones
  from public.magia_evaluaciones m
  where m.anio = p_anio and m.mes = p_mes
    and m.tienda_id = public.current_tienda_id()
  group by m.persona_id;
$$;

create or replace function public.ranking_maximizador(p_desde date, p_hasta date)
returns table (persona_id uuid, puntaje numeric, dias integer)
language sql stable security definer set search_path = public as $$
  select r.persona_id, avg(r.puntaje)::numeric, count(*)::integer
  from public.maximizador_registros r
  where r.fecha between p_desde and p_hasta
    and r.tienda_id = public.current_tienda_id()
  group by r.persona_id;
$$;

create or replace function public.ranking_maximizador(p_anio integer, p_mes integer)
returns table (persona_id uuid, puntaje numeric, dias integer)
language sql stable security definer set search_path = public as $$
  select r.persona_id, avg(r.puntaje)::numeric, count(*)::integer
  from public.maximizador_registros r
  where extract(year from r.fecha) = p_anio and extract(month from r.fecha) = p_mes
    and r.tienda_id = public.current_tienda_id()
  group by r.persona_id;
$$;

create or replace function public.ranking_semanal(p_anio integer, p_mes integer)
returns table (persona_id uuid, semana_label text, meta numeric, venta numeric, cumplimiento numeric)
language sql stable security definer set search_path = public as $$
  select s.persona_id, s.semana_label, s.meta, s.venta, s.cumplimiento
  from public.presupuestos_semanales s
  where s.anio = p_anio and s.mes = p_mes
    and s.tienda_id = public.current_tienda_id();
$$;

create or replace function public.ranking_ventas(p_desde date, p_hasta date)
returns table (persona_id uuid, venta numeric, articulos numeric, dias integer, ultimo_dia date)
language sql stable security definer set search_path = public as $$
  select v.persona_id,
         coalesce(sum(v.venta), 0)::numeric,
         coalesce(sum(v.articulos), 0)::numeric,
         (count(*) filter (where coalesce(v.venta, 0) > 0))::integer,
         max(v.fecha)
  from public.ventas_asesor_dia v
  where v.fecha between p_desde and p_hasta
    and v.tienda_id = public.current_tienda_id()
  group by v.persona_id;
$$;

-- Tareas recurrentes: cada sesion genera solo las de su tienda.
create or replace function public.generar_pendientes_recurrentes()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ahora   timestamp := now() at time zone 'America/Bogota';
  v_hoy     date      := v_ahora::date;
  v_tienda  uuid      := public.current_tienda_id();
  v_creados integer   := 0;
  t         record;
  d         date;
  v_desde   date;
  v_toca    boolean;
  v_id      uuid;
begin
  -- Solo personas del equipo con sesion y paradas en una tienda.
  if public.current_persona_id() is null or v_tienda is null then
    return 0;
  end if;

  for t in
    select * from public.tareas_recurrentes
     where activa and fecha_inicio <= v_hoy and tienda_id = v_tienda
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
            (tienda_id, titulo, area, turno, responsable_id, asesor_id, descripcion, estado, created_by, fecha_ejecucion, recurrente_id)
          values
            (v_tienda, t.titulo, t.area, t.turno, t.responsable_id, t.asesor_id, t.descripcion, 'abierto', t.created_by, d, t.id)
          on conflict (recurrente_id, fecha_ejecucion) where recurrente_id is not null do nothing
          returning id into v_id;

          if v_id is not null then
            v_creados := v_creados + 1;
            insert into public.notificaciones
              (tienda_id, tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
            values (
              v_tienda, 'tarea_recurrente', t.responsable_id, false,
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
    (tienda_id, tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
  select v_tienda, 'tarea_recurrente_recordatorio', p.responsable_id, false,
         'Sigue pendiente: ' || p.titulo || ' (era a las ' || ltrim(to_char(tr.hora, 'HH12:MI AM'), '0') || ')',
         v_hoy, 'pendientes', p.id
    from public.pendientes p
    join public.tareas_recurrentes tr on tr.id = p.recurrente_id
   where p.tienda_id = v_tienda
     and p.fecha_ejecucion = v_hoy
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
    (tienda_id, tipo, destinatario_persona_id, destinatario_jefatura, mensaje, ref_fecha, ref_tabla, ref_id)
  select v_tienda, 'tarea_recurrente_vencida', p.responsable_id, false,
         'Sigue sin realizar: ' || p.titulo || ' (vencida desde el ' || to_char(p.fecha_ejecucion, 'DD/MM') || ')',
         v_hoy, 'pendientes', p.id
    from public.pendientes p
   where p.tienda_id = v_tienda
     and p.recurrente_id is not null
     and p.estado <> 'cerrado'
     and p.fecha_ejecucion < v_hoy
     and (p.created_at at time zone 'America/Bogota')::date < v_hoy
     and not exists (
           select 1 from public.notificaciones x
            where x.tipo = 'tarea_recurrente_vencida' and x.ref_id = p.id and x.ref_fecha = v_hoy
         );

  return v_creados;
end $$;

-- ================================================================
-- 10) Archivos (fotos y evidencias): solo los de personas de la tienda actual
-- ================================================================
-- En los dos buckets la primera carpeta es el id de la persona.
create or replace function public.persona_en_tienda_actual(p_persona text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.personal
     where id::text = p_persona and tienda_id = public.current_tienda_id()
  );
$$;
revoke execute on function public.persona_en_tienda_actual(text) from public, anon;
grant execute on function public.persona_en_tienda_actual(text) to authenticated, service_role;

drop policy if exists "archivos de la tienda actual" on storage.objects;
create policy "archivos de la tienda actual" on storage.objects as restrictive for all to authenticated
  using (
    bucket_id not in ('fotos-personal', 'requerimientos-evidencias')
    or public.persona_en_tienda_actual((storage.foldername(name))[1])
  )
  with check (
    bucket_id not in ('fotos-personal', 'requerimientos-evidencias')
    or public.persona_en_tienda_actual((storage.foldername(name))[1])
  );
