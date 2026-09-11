-- 0011_codigos_alternos_distribucion.sql
-- Fase 2 sprint 4a — Extensión de personal_codigos_alternos
--
-- Añade:
--   - distribucion_pct: cuando un mismo código se comparte entre varios
--     asesores (ej. código de DSM/Jefe usado por 3 asesores nuevos),
--     jefatura reparte la venta del código en porcentajes que definen a
--     criterio. Un solo asesor con el código completo = 1.0 (100%).
--   - estado + aprobado_por + aprobado_at: workflow de aprobación por
--     jefatura. Por default estado='aprobado' cuando lo crea jefatura
--     directo; si en el futuro un asesor puede solicitarlo, entra como
--     'pendiente' hasta que jefatura confirme.
--
-- Idempotente.

alter table public.personal_codigos_alternos
  add column if not exists distribucion_pct numeric not null default 1.0
    check (distribucion_pct > 0 and distribucion_pct <= 1),
  add column if not exists estado text not null default 'aprobado'
    check (estado in ('pendiente','aprobado','rechazado')),
  add column if not exists aprobado_por uuid references public.personal(id) on delete set null,
  add column if not exists aprobado_at timestamptz;

-- Cuando se crea directo por jefatura, aprobado_at = created_at
update public.personal_codigos_alternos
set aprobado_at = created_at
where estado = 'aprobado' and aprobado_at is null;

-- Ya no debería ser unique por (codigo, persona_id) porque varias filas
-- pueden compartir el mismo código con distintos porcentajes — pero SÍ
-- debe evitar duplicados exactos (misma persona + mismo código).
-- El unique index de 0010 ya cubre eso, lo dejamos.

-- Nuevo índice: acelera la lectura al procesar ventas del PDF (buscar
-- todas las asignaciones activas de un código).
create index if not exists personal_codigos_alternos_codigo_idx
  on public.personal_codigos_alternos (codigo)
  where estado = 'aprobado';

-- ================================================================
-- Función helper: valida que la suma de distribuciones aprobadas de
-- un mismo código no supere 100%. Se usa como trigger before-insert/update.
-- ================================================================
create or replace function public.check_distribucion_pct()
returns trigger
language plpgsql
as $$
declare
  total numeric;
begin
  if new.estado = 'aprobado' then
    select coalesce(sum(distribucion_pct), 0)
    into total
    from public.personal_codigos_alternos
    where codigo = new.codigo
      and estado = 'aprobado'
      and id <> new.id;
    if total + new.distribucion_pct > 1.0001 then
      raise exception 'La suma de distribuciones aprobadas del código % excedería 100%% (actual %, intentando sumar %). Ajusta los porcentajes de las otras filas primero.',
        new.codigo, round(total * 100, 1), round(new.distribucion_pct * 100, 1);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists check_distribucion_pct_trg on public.personal_codigos_alternos;
create trigger check_distribucion_pct_trg
  before insert or update on public.personal_codigos_alternos
  for each row execute function public.check_distribucion_pct();
