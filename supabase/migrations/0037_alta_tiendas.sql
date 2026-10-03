-- 0037_alta_tiendas.sql
--
-- Alta de tiendas desde la app.
--
-- Reglas (definidas por Huber, 2-oct-2026):
--   * Solo el ADMINISTRADOR crea tiendas (y distritos).
--   * Al crear la tienda, el administrador registra a su responsable (jefe de
--     tienda). Eso lo hace la funcion crear-persona, que ahora acepta la tienda
--     destino cuando quien llama es administrador.
--   * El jefe de tienda carga su planta y el mismo la aprueba (no pasa por la DSM).
--
-- Una tienda nueva arranca con la configuracion por defecto de la compania:
-- parametros de horarios, pesos del ranking e items del maximizador.
--
-- Idempotente.

-- ================================================================
-- 1) Configuracion inicial de una tienda
-- ================================================================
create or replace function public.sembrar_tienda(p_tienda uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.horarios_config (id, tienda_id) values (true, p_tienda) on conflict do nothing;
  insert into public.ranking_config (id, tienda_id) values (true, p_tienda) on conflict do nothing;
  if not exists (select 1 from public.maximizador_items where tienda_id = p_tienda) then
    insert into public.maximizador_items (tienda_id, texto, posicion)
    select p_tienda, t.texto, t.pos
      from (values
        ('Realizó la OPM (reunión de apertura) al inicio del turno', 1),
        ('Revisó en la OPM el presupuesto pendiente del día', 2),
        ('Socializó la información y los comunicados al equipo', 3),
        ('Hizo seguimiento a la venta por hora frente a la meta', 4),
        ('Impulsó la venta de accesorios y ropa (A&A) durante el turno', 5),
        ('Entregó datos y resultados al equipo durante el día', 6),
        ('Diligenció la planificación diaria y su firma por franja', 7)
      ) as t(texto, pos);
  end if;
end $$;
revoke execute on function public.sembrar_tienda(uuid) from public, anon, authenticated;

-- ================================================================
-- 2) Crear o editar tiendas y distritos (solo administrador)
-- ================================================================
create or replace function public.admin_guardar_distrito(p_numero integer, p_nombre text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador crea distritos.';
  end if;
  if p_numero is null or p_numero <= 0 then
    raise exception 'Escribe el número del distrito.';
  end if;
  insert into public.distritos (numero, nombre)
  values (p_numero, coalesce(nullif(trim(p_nombre), ''), 'Distrito ' || p_numero))
  on conflict (numero) do update set nombre = excluded.nombre
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_guardar_tienda(
  p_id uuid,
  p_numero integer,
  p_nombre text,
  p_ciudad text,
  p_formato text,
  p_distrito uuid,
  p_vende_ropa boolean default true,
  p_activa boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador crea o edita tiendas.';
  end if;
  if p_numero is null or p_numero <= 0 then
    raise exception 'Escribe el número de la tienda.';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escribe el nombre de la tienda.';
  end if;
  if p_formato not in ('concept', 'outlet') then
    raise exception 'El formato debe ser Concept u Outlet.';
  end if;
  if not exists (select 1 from public.distritos where id = p_distrito) then
    raise exception 'Elige el distrito de la tienda.';
  end if;
  if exists (select 1 from public.tiendas where numero = p_numero and id is distinct from p_id) then
    raise exception 'Ya existe una tienda con el número %.', p_numero;
  end if;

  if v_id is null then
    insert into public.tiendas (numero, nombre, ciudad, formato, distrito_id, vende_ropa, activa)
    values (p_numero, trim(p_nombre), coalesce(trim(p_ciudad), ''), p_formato, p_distrito, coalesce(p_vende_ropa, true), coalesce(p_activa, true))
    returning id into v_id;
    perform public.sembrar_tienda(v_id);
  else
    update public.tiendas
       set numero = p_numero, nombre = trim(p_nombre), ciudad = coalesce(trim(p_ciudad), ''),
           formato = p_formato, distrito_id = p_distrito,
           vende_ropa = coalesce(p_vende_ropa, true), activa = coalesce(p_activa, true)
     where id = v_id;
    if not found then
      raise exception 'Esa tienda no existe.';
    end if;
  end if;
  return v_id;
end $$;

-- Todas las tiendas con su gente, para el panel del administrador (la
-- jefatura de una tienda no puede leer la planta de otra; esto si).
create or replace function public.admin_resumen_tiendas()
returns table (
  id uuid, numero integer, nombre text, ciudad text, formato text, vende_ropa boolean, activa boolean,
  distrito_id uuid, distrito_numero integer,
  personas integer, jefaturas integer, jefes text
) language sql stable security definer set search_path = public as $$
  select t.id, t.numero, t.nombre, t.ciudad, t.formato, t.vende_ropa, t.activa,
         d.id, d.numero,
         (select count(*) from public.personal p where p.tienda_id = t.id and p.activo)::integer,
         (select count(*) from public.personal p where p.tienda_id = t.id and p.activo and p.rol = 'jefatura')::integer,
         (select string_agg(p.nombre || coalesce(' <' || p.correo || '>', ''), ', ' order by p.nombre)
            from public.personal p
           where p.tienda_id = t.id and p.activo and p.rol_jerarquico = 'jefe_tienda')
    from public.tiendas t
    join public.distritos d on d.id = t.distrito_id
   where public.es_admin()
   order by d.numero, t.numero;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_guardar_distrito(integer, text)',
    'admin_guardar_tienda(uuid, integer, text, text, text, uuid, boolean, boolean)',
    'admin_resumen_tiendas()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ================================================================
-- 3) La tienda 690 ya tiene su configuracion: se completa lo que falte
-- ================================================================
do $$
declare t record;
begin
  for t in select id from public.tiendas loop
    perform public.sembrar_tienda(t.id);
  end loop;
end $$;
