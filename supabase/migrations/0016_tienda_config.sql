-- 0016_tienda_config.sql
-- Nombre y ciudad de la tienda, editables desde la app (una sola fila).
-- Se lee sin sesión (pantalla de login) y en las Edge Functions de IA.
-- Idempotente.

create table if not exists public.tienda_config (
  id          boolean primary key default true check (id),
  nombre      text not null default 'Outlet de las Américas',
  ciudad      text not null default 'Bogotá, Colombia',
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.tienda_config;
create trigger set_updated_at
  before update on public.tienda_config
  for each row execute function public.tg_set_updated_at();

insert into public.tienda_config (id) values (true) on conflict (id) do nothing;

alter table public.tienda_config enable row level security;
grant select on public.tienda_config to anon;
grant all privileges on public.tienda_config to service_role, authenticated;

drop policy if exists "read_tienda_config"          on public.tienda_config;
drop policy if exists "jefatura_write_tienda_config" on public.tienda_config;

create policy "read_tienda_config"
  on public.tienda_config for select to anon, authenticated using (true);

create policy "jefatura_write_tienda_config"
  on public.tienda_config for all to authenticated
  using      (public.current_persona_rol() = 'jefatura')
  with check (public.current_persona_rol() = 'jefatura');
