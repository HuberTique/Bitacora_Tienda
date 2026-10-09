-- 0046_pendientes_editar_adjuntos.sql
--
-- Pendientes: editar después de creados y adjuntar enlaces y archivos (Huber, 9-oct-2026).
--
--   * EDITAR: la jefatura edita cualquier pendiente de la tienda, menos las tareas que mandó la
--     DSM (esas solo la DSM o el administrador). Un asesor edita solo los que él creó. Cambiar el
--     estado sigue como antes. Queda registro de quién editó, qué campos y cuándo.
--   * ADJUNTOS: enlaces con nombre (un toque y abre la página donde se monta la información) y
--     archivos (hasta 10 MB, privados: los ve quien ve el pendiente). Los archivos de un
--     pendiente cerrado se borran a los 90 días; los enlaces se quedan.
--
-- Idempotente.

-- ================================================================
-- 1) Quién puede editar un pendiente
-- ================================================================
create or replace function public.puede_editar_pendiente(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pendientes p
     where p.id = p_id
       and p.tienda_id = public.current_tienda_id()
       and case
             when p.origen = 'dsm' then public.es_admin() or public.current_persona_rol() = 'dsm'
             else public.current_persona_rol() in ('jefatura', 'dsm') or public.es_admin()
                  or (p.created_by = public.current_persona_id() and p.recurrente_id is null)
           end
  );
$$;
revoke execute on function public.puede_editar_pendiente(uuid) from public, anon;
grant execute on function public.puede_editar_pendiente(uuid) to authenticated, service_role;

-- El asesor puede modificar los pendientes que él creó (además de los que tiene asignados).
drop policy if exists "asesor_edita_los_suyos" on public.pendientes;
create policy "asesor_edita_los_suyos" on public.pendientes for update to authenticated
  using (created_by = public.current_persona_id() and recurrente_id is null)
  with check (created_by = public.current_persona_id() and recurrente_id is null);

-- ================================================================
-- 2) Registro de ediciones
-- ================================================================
alter table public.pendientes
  add column if not exists editado_por uuid references public.personal(id) on delete set null,
  add column if not exists editado_at  timestamptz;

create table if not exists public.pendientes_ediciones (
  id           uuid primary key default gen_random_uuid(),
  tienda_id    uuid not null references public.tiendas(id) on delete cascade,
  pendiente_id uuid not null references public.pendientes(id) on delete cascade,
  por          uuid references public.personal(id) on delete set null,
  at           timestamptz not null default now(),
  campos       text[] not null
);
create index if not exists pendientes_ediciones_idx on public.pendientes_ediciones (pendiente_id, at desc);
alter table public.pendientes_ediciones enable row level security;
revoke all on public.pendientes_ediciones from anon;
grant select on public.pendientes_ediciones to authenticated;
grant all on public.pendientes_ediciones to service_role;
drop policy if exists "tienda_pendientes_ediciones" on public.pendientes_ediciones;
create policy "tienda_pendientes_ediciones" on public.pendientes_ediciones as restrictive for select to authenticated
  using (tienda_id = (select public.current_tienda_id()));
-- Lo ve quien ve el pendiente (las políticas de pendientes aplican dentro del exists).
drop policy if exists "leer_pendientes_ediciones" on public.pendientes_ediciones;
create policy "leer_pendientes_ediciones" on public.pendientes_ediciones for select to authenticated
  using (exists (select 1 from public.pendientes p where p.id = pendiente_id));

-- Al cambiar el contenido (no el estado): valida quién edita y deja el registro.
create or replace function public.tg_pendiente_edicion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_campos text[] := array[]::text[];
  v_yo uuid := public.current_persona_id();
  v_rol text := public.current_persona_rol();
begin
  if new.titulo is distinct from old.titulo then v_campos := array_append(v_campos, 'titulo'); end if;
  if new.descripcion is distinct from old.descripcion then v_campos := array_append(v_campos, 'descripcion'); end if;
  if new.area is distinct from old.area then v_campos := array_append(v_campos, 'area'); end if;
  if new.turno is distinct from old.turno then v_campos := array_append(v_campos, 'turno'); end if;
  if new.fecha_ejecucion is distinct from old.fecha_ejecucion then v_campos := array_append(v_campos, 'fecha_ejecucion'); end if;
  if new.responsable_id is distinct from old.responsable_id then v_campos := array_append(v_campos, 'responsable_id'); end if;
  if new.asesor_id is distinct from old.asesor_id then v_campos := array_append(v_campos, 'asesor_id'); end if;
  if cardinality(v_campos) = 0 or v_yo is null then
    return new; -- solo cambió el estado, o lo hace el sistema
  end if;
  if old.origen = 'dsm' then
    if not (public.es_admin() or v_rol = 'dsm') then
      raise exception 'Las tareas que manda la DSM solo las edita la DSM o el administrador.';
    end if;
  elsif not (v_rol in ('jefatura', 'dsm') or public.es_admin() or (old.created_by = v_yo and old.recurrente_id is null)) then
    raise exception 'Solo puedes editar los pendientes que tú creaste.';
  end if;
  new.editado_por := v_yo;
  new.editado_at := now();
  insert into public.pendientes_ediciones (tienda_id, pendiente_id, por, campos)
  values (old.tienda_id, old.id, v_yo, v_campos);
  return new;
end $$;
revoke execute on function public.tg_pendiente_edicion() from public, anon;
drop trigger if exists pendiente_edicion on public.pendientes;
create trigger pendiente_edicion before update on public.pendientes
  for each row execute function public.tg_pendiente_edicion();

-- ================================================================
-- 3) Enlaces y archivos
-- ================================================================
create table if not exists public.pendiente_adjuntos (
  id           uuid primary key default gen_random_uuid(),
  tienda_id    uuid not null default public.current_tienda_id() references public.tiendas(id) on delete cascade,
  pendiente_id uuid not null references public.pendientes(id) on delete cascade,
  tipo         text not null check (tipo in ('enlace', 'archivo')),
  nombre       text not null check (length(trim(nombre)) > 0),
  url          text,
  path         text,
  mime         text,
  tamano       bigint,
  creado_por   uuid references public.personal(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint pendiente_adjuntos_tipo_chk check (
    (tipo = 'enlace' and url ~* '^https?://' and path is null)
    or (tipo = 'archivo' and path is not null and url is null)
  )
);
create index if not exists pendiente_adjuntos_idx on public.pendiente_adjuntos (pendiente_id);

alter table public.pendiente_adjuntos enable row level security;
revoke all on public.pendiente_adjuntos from anon;
grant select, insert, update, delete on public.pendiente_adjuntos to authenticated;
grant all on public.pendiente_adjuntos to service_role;
drop policy if exists "tienda_pendiente_adjuntos" on public.pendiente_adjuntos;
create policy "tienda_pendiente_adjuntos" on public.pendiente_adjuntos as restrictive for all to authenticated
  using (tienda_id = (select public.current_tienda_id()))
  with check (tienda_id = (select public.current_tienda_id()));
drop policy if exists "leer_pendiente_adjuntos" on public.pendiente_adjuntos;
create policy "leer_pendiente_adjuntos" on public.pendiente_adjuntos for select to authenticated
  using (exists (select 1 from public.pendientes p where p.id = pendiente_id));
drop policy if exists "editar_pendiente_adjuntos" on public.pendiente_adjuntos;
create policy "editar_pendiente_adjuntos" on public.pendiente_adjuntos for all to authenticated
  using (public.puede_editar_pendiente(pendiente_id))
  with check (public.puede_editar_pendiente(pendiente_id));

-- Archivos de pendientes cerrados hace más de 90 días: la app los borra del almacenamiento al
-- abrir la Bitácora (jefatura). Esta función quita sus filas y devuelve las rutas a borrar.
create or replace function public.purgar_adjuntos_vencidos()
returns table (path text) language plpgsql security definer set search_path = public as $$
begin
  if public.current_persona_rol() <> 'jefatura' then return; end if;
  return query
    delete from public.pendiente_adjuntos a
     using public.pendientes p
     where a.pendiente_id = p.id
       and a.tipo = 'archivo'
       and a.tienda_id = public.current_tienda_id()
       and p.estado = 'cerrado'
       and p.closed_at < now() - interval '90 days'
    returning a.path;
end $$;
revoke execute on function public.purgar_adjuntos_vencidos() from public, anon;
grant execute on function public.purgar_adjuntos_vencidos() to authenticated, service_role;

-- Almacenamiento privado. Ruta: "<tienda_id>/<pendiente_id>/<archivo>".
insert into storage.buckets (id, name, public)
values ('pendientes-adjuntos', 'pendientes-adjuntos', false)
on conflict (id) do nothing;
do $$
begin
  -- Tope de 10 MB y tipos permitidos (solo donde el almacenamiento tiene esas columnas).
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/csv']
      where id = 'pendientes-adjuntos'$q$;
  end if;
end $$;

drop policy if exists "leer adjuntos de pendientes" on storage.objects;
create policy "leer adjuntos de pendientes" on storage.objects for select to authenticated
  using (
    bucket_id = 'pendientes-adjuntos'
    and exists (select 1 from public.pendiente_adjuntos a where a.path = storage.objects.name)
  );
drop policy if exists "subir adjuntos de pendientes" on storage.objects;
create policy "subir adjuntos de pendientes" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pendientes-adjuntos'
    and (storage.foldername(name))[1] = public.current_tienda_id()::text
    and public.puede_editar_pendiente(((storage.foldername(name))[2])::uuid)
  );
drop policy if exists "borrar adjuntos de pendientes" on storage.objects;
create policy "borrar adjuntos de pendientes" on storage.objects for delete to authenticated
  using (
    bucket_id = 'pendientes-adjuntos'
    and (storage.foldername(name))[1] = public.current_tienda_id()::text
    and (public.current_persona_rol() = 'jefatura' or public.puede_editar_pendiente(((storage.foldername(name))[2])::uuid))
  );
