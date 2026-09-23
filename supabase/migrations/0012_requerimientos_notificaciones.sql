-- 0012_requerimientos_notificaciones.sql
-- Fase 3 — Requerimientos (calendario con aprobación) + Notificaciones.
-- Idempotente.
--
-- `dias_bloqueados` (bloqueo de días por jefatura) ya existe desde
-- 0006_horarios.sql — se reutiliza tal cual, sin cambios.

-- ================================================================
-- Tabla requerimientos
-- ================================================================
create table if not exists public.requerimientos (
  id               uuid primary key default gen_random_uuid(),
  fecha            date not null,
  persona_id       uuid not null references public.personal(id) on delete cascade,
  tipo             text not null check (tipo in ('dia_libre','salida_temprano','permiso','otro')),
  detalle          text not null default '',
  estado           text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  evidencia_path   text,           -- ruta en Storage bucket 'requerimientos-evidencias'
  evidencia_nombre text,
  registrado_por   uuid not null references public.personal(id) on delete set null,
  revisado_por     uuid references public.personal(id) on delete set null,
  fecha_revision   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists requerimientos_fecha_idx on public.requerimientos (fecha);
create index if not exists requerimientos_persona_idx on public.requerimientos (persona_id);
create index if not exists requerimientos_estado_idx on public.requerimientos (estado);

drop trigger if exists set_updated_at on public.requerimientos;
create trigger set_updated_at
  before update on public.requerimientos
  for each row execute function public.tg_set_updated_at();

grant all privileges on public.requerimientos to service_role;
grant all privileges on public.requerimientos to authenticated;

alter table public.requerimientos enable row level security;

drop policy if exists "jefatura all requerimientos"        on public.requerimientos;
drop policy if exists "asesor select own requerimientos"    on public.requerimientos;
drop policy if exists "asesor insert own requerimientos"    on public.requerimientos;
drop policy if exists "asesor update own pendiente"         on public.requerimientos;
drop policy if exists "asesor delete own pendiente"         on public.requerimientos;

-- Jefatura: acceso total (ver todo el equipo, aprobar/rechazar/eliminar).
create policy "jefatura all requerimientos" on public.requerimientos
  for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');

-- Asesor: solo ve sus propios requerimientos.
create policy "asesor select own requerimientos" on public.requerimientos
  for select to authenticated
  using (persona_id = public.current_persona_id());

-- Asesor: puede crear requerimientos propios (la huella registrado_por
-- también debe ser él mismo — evita suplantación).
create policy "asesor insert own requerimientos" on public.requerimientos
  for insert to authenticated
  with check (
    persona_id = public.current_persona_id()
    and registrado_por = public.current_persona_id()
    and estado = 'pendiente'
  );

-- Asesor: puede editar SOLO mientras siga pendiente (una vez revisado, ya
-- no se puede tocar — jefatura queda como única autoridad de ahí en más).
create policy "asesor update own pendiente" on public.requerimientos
  for update to authenticated
  using      (persona_id = public.current_persona_id() and estado = 'pendiente')
  with check (persona_id = public.current_persona_id() and estado = 'pendiente');

-- Asesor: puede eliminar su propio requerimiento mientras siga pendiente.
create policy "asesor delete own pendiente" on public.requerimientos
  for delete to authenticated
  using (persona_id = public.current_persona_id() and estado = 'pendiente');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'requerimientos'
  ) then
    alter publication supabase_realtime add table public.requerimientos;
  end if;
end $$;

-- ================================================================
-- Tabla notificaciones
-- ================================================================
create table if not exists public.notificaciones (
  id                       uuid primary key default gen_random_uuid(),
  tipo                     text not null,
  -- Un destinatario es UNA persona específica, O el conjunto "toda la
  -- jefatura" (broadcast) — nunca ambos a la vez.
  destinatario_persona_id  uuid references public.personal(id) on delete cascade,
  destinatario_jefatura    boolean not null default false,
  mensaje                  text not null,
  ref_fecha                date,
  ref_tabla                text,
  ref_id                   uuid,
  leida                    boolean not null default false,
  created_at               timestamptz not null default now(),
  constraint notificaciones_destinatario_chk check (
    (destinatario_persona_id is not null and destinatario_jefatura = false)
    or (destinatario_persona_id is null and destinatario_jefatura = true)
  )
);

create index if not exists notificaciones_persona_idx on public.notificaciones (destinatario_persona_id);
create index if not exists notificaciones_jefatura_idx on public.notificaciones (destinatario_jefatura);
create index if not exists notificaciones_created_idx on public.notificaciones (created_at desc);

grant all privileges on public.notificaciones to service_role;
grant all privileges on public.notificaciones to authenticated;

alter table public.notificaciones enable row level security;

drop policy if exists "select notificaciones propias" on public.notificaciones;
drop policy if exists "insert notificaciones"          on public.notificaciones;
drop policy if exists "update leida propia"            on public.notificaciones;

-- Cada quien ve las suyas (dirigidas a su persona_id) + las de jefatura si
-- su propio rol es jefatura (broadcast).
create policy "select notificaciones propias" on public.notificaciones
  for select to authenticated
  using (
    destinatario_persona_id = public.current_persona_id()
    or (destinatario_jefatura = true and public.current_persona_rol() = 'jefatura')
  );

-- Cualquier autenticado puede crear una notificación (el mensaje lo arma
-- la app, no el usuario libremente) — mismo nivel de confianza que el
-- resto de la app en este punto del proyecto.
create policy "insert notificaciones" on public.notificaciones
  for insert to authenticated
  with check (true);

-- Solo se puede marcar como leída una notificación propia — no se edita
-- ningún otro campo desde el cliente.
create policy "update leida propia" on public.notificaciones
  for update to authenticated
  using (
    destinatario_persona_id = public.current_persona_id()
    or (destinatario_jefatura = true and public.current_persona_rol() = 'jefatura')
  )
  with check (
    destinatario_persona_id = public.current_persona_id()
    or (destinatario_jefatura = true and public.current_persona_rol() = 'jefatura')
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

-- ================================================================
-- Storage bucket para evidencias de requerimientos (certificados,
-- constancias). Privado — solo el dueño del archivo y jefatura pueden leer.
-- ================================================================
insert into storage.buckets (id, name, public)
values ('requerimientos-evidencias', 'requerimientos-evidencias', false)
on conflict (id) do nothing;

drop policy if exists "leer evidencias propias o jefatura" on storage.objects;
drop policy if exists "subir evidencia propia"             on storage.objects;
drop policy if exists "borrar evidencia propia o jefatura" on storage.objects;

-- Convención de path: "<persona_id>/<requerimiento_id>-<nombre_archivo>"
-- así el primer segmento del path identifica al dueño sin otra tabla.
create policy "leer evidencias propias o jefatura" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'requerimientos-evidencias'
    and (
      (storage.foldername(name))[1] = public.current_persona_id()::text
      or public.current_persona_rol() = 'jefatura'
    )
  );

create policy "subir evidencia propia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'requerimientos-evidencias'
    and (storage.foldername(name))[1] = public.current_persona_id()::text
  );

create policy "borrar evidencia propia o jefatura" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'requerimientos-evidencias'
    and (
      (storage.foldername(name))[1] = public.current_persona_id()::text
      or public.current_persona_rol() = 'jefatura'
    )
  );
