-- 0044_puntaje_reconocimientos.sql
--
-- Nuevo puntaje del ranking (Huber, 8-oct-2026, al validar los Excel "KpisSeptiembre"
-- y "MEJOR VENDEDOR"):
--
--   * Se mantienen los pesos (ventas 40, UPT 10, Magia 25, puntualidad 15). El MAXIMIZADOR
--     sale del puntaje (su flujo no es parejo para todos) y su 10 % se reparte en los 8
--     reconocimientos del Excel de KPIs: 1,25 % para el ganador de cada uno.
--   * Ventas: una parte por cumplimiento en PESOS y otra por UNIDADES; las unidades se
--     reparten pares 40 / accesorios 60, o pares 40 / accesorios 30 / ropa 30 si la tienda
--     vende ropa. Editables por tienda (null = el valor por defecto según venda ropa).
--   * Las faltas restan según su tipo (leve / media / grave) y se multiplican si se repiten
--     en 4 meses: 2.ª vez ×1,5; 3.ª en adelante ×2. Los RECLAMOS restan de Magia; los demás
--     (llegadas tarde, ausencias, traspasos, irrespeto, ERRORES OPERACIONALES) de puntualidad.
--     Los dos tipos nuevos se registran en Feedbacks.
--   * Puntualidad, Trabajo en equipo e Iniciativa los califica la jefatura del día 1 al 5
--     del mes siguiente; queda el historial de quién calificó.
--
-- Idempotente.

-- ================================================================
-- 1) Configuración del ranking por tienda
-- ================================================================
alter table public.ranking_config
  add column if not exists peso_reconocimientos numeric not null default 10 check (peso_reconocimientos >= 0),
  add column if not exists reparto_pesos        numeric not null default 50 check (reparto_pesos between 0 and 100),
  add column if not exists reparto_pares        numeric check (reparto_pares >= 0),
  add column if not exists reparto_acc          numeric check (reparto_acc >= 0),
  add column if not exists reparto_ropa         numeric check (reparto_ropa >= 0),
  add column if not exists puntos_faltas        jsonb not null default '{}'::jsonb;

alter table public.ranking_config alter column peso_maximizador set default 0;
update public.ranking_config set peso_maximizador = 0 where peso_maximizador <> 0;

-- ================================================================
-- 2) Tipos de falta: puntos que restan y de qué parte del puntaje
-- ================================================================
alter table public.faltas_config
  add column if not exists puntos   numeric,
  add column if not exists resta_de text not null default 'puntualidad';
alter table public.faltas_config drop constraint if exists faltas_config_resta_de_chk;
alter table public.faltas_config add constraint faltas_config_resta_de_chk check (resta_de in ('puntualidad', 'magia'));

-- Los mismos puntos que ya usaba el ranking (leve 10 · media 15-20 · grave 35-100).
update public.faltas_config f set puntos = v.p
  from (values
    ('llegada_menor10', 10), ('llegada_10_45', 20), ('llegada_mayor45', 35),
    ('ausencia_parcial', 35), ('ausencia_total', 50), ('traspasos', 15), ('irrespeto_violencia', 100)
  ) as v(t, p)
 where f.tipo_id = v.t and f.puntos is null;

insert into public.faltas_config (tipo_id, nombre, requiere_minutos, ladder, posicion, puntos, resta_de) values
  ('reclamo', 'Reclamo de un cliente', false,
   array['Feedback Verbal', 'Feedback Escrito', 'Descargos por escrito'], 8, 20, 'magia'),
  ('error_operacional', 'Error operacional', false,
   array['Feedback Verbal', 'Feedback Escrito', 'Feedback Escrito (DSM)', 'Descargos por escrito'], 9, 10, 'puntualidad')
on conflict (tipo_id) do nothing;

-- ================================================================
-- 3) ranking_faltas: descuento por tipo × recurrencia, separado por destino
-- ================================================================
drop function if exists public.ranking_faltas(date, date);
drop function if exists public.ranking_faltas(integer, integer);

create or replace function public.ranking_faltas(p_desde date, p_hasta date)
returns table (persona_id uuid, faltas integer, penalizacion numeric, penal_magia numeric, reclamos integer)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select rc.puntos_faltas from public.ranking_config rc
                      where rc.tienda_id = public.current_tienda_id()), '{}'::jsonb) as pf
  ),
  r as (
    select r.persona_id, fc.resta_de,
           coalesce((cfg.pf ->> r.tipo_id)::numeric, fc.puntos, 20)
             * case when r.ocurrencia >= 3 then 2 when r.ocurrencia = 2 then 1.5 else 1 end as pts
      from public.retardos r
      join public.faltas_config fc on fc.tipo_id = r.tipo_id
      cross join cfg
     where r.fecha between p_desde and p_hasta
       and r.tienda_id = public.current_tienda_id()
  )
  select r.persona_id,
         count(*) filter (where r.resta_de = 'puntualidad')::integer,
         coalesce(sum(r.pts) filter (where r.resta_de = 'puntualidad'), 0)::numeric,
         coalesce(sum(r.pts) filter (where r.resta_de = 'magia'), 0)::numeric,
         count(*) filter (where r.resta_de = 'magia')::integer
    from r
   group by r.persona_id;
$$;

-- Versión por mes calendario (respaldo de la app cuando no hay mes retail).
create or replace function public.ranking_faltas(p_anio integer, p_mes integer)
returns table (persona_id uuid, faltas integer, penalizacion numeric, penal_magia numeric, reclamos integer)
language sql stable security definer set search_path = public as $$
  select * from public.ranking_faltas(make_date(p_anio, p_mes, 1), (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date);
$$;

revoke execute on function public.ranking_faltas(date, date) from public, anon;
revoke execute on function public.ranking_faltas(integer, integer) from public, anon;
grant execute on function public.ranking_faltas(date, date) to authenticated, service_role;
grant execute on function public.ranking_faltas(integer, integer) to authenticated, service_role;

-- ================================================================
-- 4) Calificaciones manuales del mejor vendedor + historial
-- ================================================================
create table if not exists public.calificaciones_vendedor (
  id             uuid primary key default gen_random_uuid(),
  tienda_id      uuid not null default public.current_tienda_id() references public.tiendas(id) on delete cascade,
  anio           integer not null,
  mes            integer not null check (mes between 1 and 12),
  item           text not null check (item in ('puntualidad', 'trabajo_equipo', 'iniciativa')),
  persona_id     uuid not null references public.personal(id) on delete cascade,
  nota           text not null default '',
  calificado_por uuid references public.personal(id) on delete set null,
  calificado_at  timestamptz not null default now(),
  unique (tienda_id, anio, mes, item)
);

create table if not exists public.calificaciones_vendedor_historial (
  id             uuid primary key default gen_random_uuid(),
  tienda_id      uuid not null references public.tiendas(id) on delete cascade,
  anio           integer not null,
  mes            integer not null,
  item           text not null,
  accion         text not null check (accion in ('califico', 'cambio', 'quito')),
  persona_id     uuid references public.personal(id) on delete set null,
  nota           text,
  por            uuid references public.personal(id) on delete set null,
  at             timestamptz not null default now()
);

create or replace function public.tg_calificacion_historial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.calificaciones_vendedor_historial (tienda_id, anio, mes, item, accion, persona_id, nota, por)
    values (old.tienda_id, old.anio, old.mes, old.item, 'quito', old.persona_id, old.nota, public.current_persona_id());
    return old;
  end if;
  insert into public.calificaciones_vendedor_historial (tienda_id, anio, mes, item, accion, persona_id, nota, por)
  values (new.tienda_id, new.anio, new.mes, new.item, case when tg_op = 'INSERT' then 'califico' else 'cambio' end,
          new.persona_id, new.nota, coalesce(new.calificado_por, public.current_persona_id()));
  return new;
end $$;
revoke execute on function public.tg_calificacion_historial() from public, anon;

drop trigger if exists calificacion_historial on public.calificaciones_vendedor;
create trigger calificacion_historial after insert or update or delete on public.calificaciones_vendedor
  for each row execute function public.tg_calificacion_historial();

alter table public.calificaciones_vendedor enable row level security;
alter table public.calificaciones_vendedor_historial enable row level security;
revoke all on public.calificaciones_vendedor, public.calificaciones_vendedor_historial from anon;
grant select, insert, update, delete on public.calificaciones_vendedor to authenticated;
grant select on public.calificaciones_vendedor_historial to authenticated;
grant all on public.calificaciones_vendedor, public.calificaciones_vendedor_historial to service_role;

drop policy if exists "tienda_calificaciones" on public.calificaciones_vendedor;
create policy "tienda_calificaciones" on public.calificaciones_vendedor as restrictive for all to authenticated
  using (tienda_id = (select public.current_tienda_id()))
  with check (tienda_id = (select public.current_tienda_id()));
drop policy if exists "leer_calificaciones" on public.calificaciones_vendedor;
create policy "leer_calificaciones" on public.calificaciones_vendedor for select to authenticated using (true);
drop policy if exists "jefatura_califica" on public.calificaciones_vendedor;
create policy "jefatura_califica" on public.calificaciones_vendedor for all to authenticated
  using ((select public.current_persona_rol()) = 'jefatura')
  with check ((select public.current_persona_rol()) = 'jefatura');

drop policy if exists "tienda_calificaciones_hist" on public.calificaciones_vendedor_historial;
create policy "tienda_calificaciones_hist" on public.calificaciones_vendedor_historial as restrictive for select to authenticated
  using (tienda_id = (select public.current_tienda_id()));
drop policy if exists "jefatura_lee_historial" on public.calificaciones_vendedor_historial;
create policy "jefatura_lee_historial" on public.calificaciones_vendedor_historial for select to authenticated
  using ((select public.current_persona_rol()) = 'jefatura');

create index if not exists calificaciones_vendedor_mes_idx on public.calificaciones_vendedor (tienda_id, anio, mes);
