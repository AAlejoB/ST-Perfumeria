-- ============================================================================
-- [VENTA-COMO-DATO] carta B del DISEÑADOR · 16-oct-2026
-- ============================================================================
-- Qué hace: cada venta de la hoja de caja (`caja_movimientos`, tipo 'venta') deja UNA fila por ítem en
-- `public.ventas`, y existen los costos para calcular ganancia más adelante. Sólo captura: no hay gráficos.
-- Es aditivo y reversible (columnas nuevas en NULL / con default, nada se borra ni se renombra).
--
-- Cambios respecto del md original (todos por hechos medidos el 16-oct):
--   1. «Vino por» se guarda en cada ítem como `vino_por` (no `origen`): los decants ya usan `origen` para
--      decir 'arabe' | 'disenador'.
--   2. `ventas.slug_perfume` pierde el NOT NULL: los decants y «otra cosa» no tienen slug. `cliente_nombre`
--      (NOT NULL) se llena con 'Mostrador'. La tabla tenía 0 filas.
--   3. `ventas.caja_id` borra en cascada: el jefe puede borrar un renglón de la hoja y, sin esto, el FK
--      (sin cascada) frenaba el borrado.
--   4. El costo NO va en `perfume_overrides` ni `decants_config`: las dos tienen lectura pública (select true
--      para `public`) y el catálogo las lee con `select *`, así que un costo ahí lo vería cualquiera. Va en
--      tablas aparte, sólo del jefe: `perfumes_costo` (excepción por perfume) y `costos_config` (envase).
--   5. La marca de costo es `marca_real` (el fabricante: Lattafa, Armaf…), no `marca` (que vale siempre
--      'ST Perfumería'). Se compara sin distinguir mayúsculas (hay 'LATTAFA' y 'Lattafa').
--   6. El trigger caja -> ventas NO puede frenar una venta: si algo falla, avisa con un WARNING y la hoja
--      guarda igual.
-- RLS: `ventas` ya tenía sólo `ventas_select_staff` (sin lectura pública) y no se toca. Las tablas de costo
-- son sólo del jefe (`is_jefe()`); la empleada no lee ni escribe nada de costo (NO ROMPER #5, excepción).
-- ============================================================================

-- 1. ventas: completar la fila
alter table public.ventas alter column slug_perfume drop not null;
alter table public.ventas
  add column if not exists caja_id      uuid references public.caja_movimientos(id) on delete cascade,
  add column if not exists medio_pago   text check (medio_pago in ('efectivo','mp','posnet','mixto')),
  add column if not exists origen       text not null default 'local' check (origen in ('local','whatsapp','web')),
  add column if not exists tipo         text check (tipo in ('frasco','decant','set')),
  add column if not exists ml           integer check (ml is null or (ml > 0 and ml <= 200)),
  add column if not exists precio_unit  numeric,
  add column if not exists anulada_en   timestamptz;
create index if not exists ventas_fecha_idx on public.ventas (fecha);
create index if not exists ventas_slug_idx  on public.ventas (slug_perfume);
create index if not exists ventas_caja_idx  on public.ventas (caja_id);

-- 2. costos (sólo jefe)
create table if not exists public.marcas_costo (
  marca       text primary key,
  costo       integer not null check (costo >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create unique index if not exists marcas_costo_lower_uniq on public.marcas_costo (lower(btrim(marca)));

create table if not exists public.perfumes_costo (   -- excepción por perfume: gana sobre el costo de la marca
  slug        text primary key,
  costo       integer not null check (costo >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.costos_config (    -- una sola fila: el costo del envase de un decant
  id           integer primary key default 1 check (id = 1),
  costo_envase integer not null default 0 check (costo_envase >= 0),
  updated_at   timestamptz not null default now(),
  updated_by   text
);
insert into public.costos_config (id) values (1) on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['marcas_costo', 'perfumes_costo', 'costos_config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_jefe', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_jefe()) with check (public.is_jefe())', t || '_jefe', t);
  end loop;
end $$;

comment on table public.marcas_costo    is '[VENTA-COMO-DATO] costo de compra por marca_real. Sólo is_jefe(): sin lectura pública ni de la empleada.';
comment on table public.perfumes_costo  is '[VENTA-COMO-DATO] costo de compra de un perfume (excepción a su marca). Sólo is_jefe().';
comment on table public.costos_config   is '[VENTA-COMO-DATO] costo del envase de un decant (1 fila). Sólo is_jefe().';

-- 3. trigger: caja_movimientos (tipo = 'venta') -> filas en ventas
-- items: frasco {slug, nombre, qty, llevar, ya_bajado, descontado, precio, marca?, vino_por?}
--        decant {tipo:'decant', origen:'arabe'|'disenador', nombre, qty, precio_unit, ml?, vino_por?}
--        libre  {tipo:'libre', nombre, qty, monto, vino_por?}
create or replace function public._caja_a_ventas() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_it     jsonb;
  v_n      int;
  v_medio  text;
  v_tipo   text;
  v_slug   text;
  v_qty    int;
  v_pu     numeric;
  v_marca  text;
  v_ml     int;
  v_vino   text;
  v_cuenta int := jsonb_array_length(new.items);
begin
  if new.tipo is distinct from 'venta' or jsonb_typeof(new.items) <> 'array' or v_cuenta = 0 then return new; end if;
  begin
    v_n := (new.efectivo > 0)::int + (new.mp > 0)::int + (new.posnet > 0)::int;
    v_medio := case when v_n > 1 then 'mixto' when new.efectivo > 0 then 'efectivo' when new.mp > 0 then 'mp'
                    when new.posnet > 0 then 'posnet' else null end;
    for v_it in select value from jsonb_array_elements(new.items) loop
      v_slug := nullif(v_it ->> 'slug', '');
      v_tipo := case when v_slug is not null then 'frasco' when v_it ->> 'tipo' = 'decant' then 'decant' else null end;
      v_qty  := greatest(1, coalesce((v_it ->> 'qty')::int, 1));
      v_pu   := case v_it ->> 'tipo'
                  when 'decant' then (v_it ->> 'precio_unit')::numeric
                  when 'libre'  then (v_it ->> 'monto')::numeric
                  else (v_it ->> 'precio')::numeric end;
      if v_pu is null and v_cuenta = 1 then v_pu := (new.efectivo + new.mp + new.posnet + new.debe) / v_qty; end if;
      v_pu   := coalesce(v_pu, 0);
      v_marca := nullif(btrim(coalesce(v_it ->> 'marca', '')), '');
      if v_marca is null and v_slug is not null then
        select coalesce(
                 (select nullif(btrim(o.marca_real), '') from public.perfume_overrides o where o.slug = v_slug),
                 (select nullif(btrim(n.marca_real), '') from public.perfumes_nuevos   n where n.slug = v_slug)
               ) into v_marca;
      end if;
      v_ml   := case when v_tipo = 'decant' and (v_it ->> 'ml') ~ '^[0-9]{1,3}$' and (v_it ->> 'ml')::int between 1 and 200
                     then (v_it ->> 'ml')::int else null end;
      v_vino := case when (v_it ->> 'vino_por') in ('local', 'whatsapp', 'web') then v_it ->> 'vino_por' else 'local' end;
      insert into public.ventas (fecha, slug_perfume, perfume_nombre, marca, cliente_nombre, cantidad, monto_total,
                                 vendedor, caja_id, medio_pago, origen, tipo, ml, precio_unit)
      values (new.creado_en, v_slug, coalesce(nullif(btrim(v_it ->> 'nombre'), ''), 'Sin nombre'), v_marca, 'Mostrador',
              v_qty, v_pu * v_qty, new.creado_por, new.id, v_medio, v_vino, v_tipo, v_ml, v_pu);
    end loop;
  exception when others then
    raise warning '[VENTA-COMO-DATO] no se pudo copiar el renglón % a ventas: %', new.id, sqlerrm;   -- la venta de la hoja NO se frena
  end;
  return new;
end $$;

drop trigger if exists caja_a_ventas on public.caja_movimientos;
create trigger caja_a_ventas after insert on public.caja_movimientos
  for each row execute function public._caja_a_ventas();

-- 4. tachar / des-tachar el renglón de la hoja -> ventas.anulada_en
create or replace function public._caja_anula_ventas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.anulado_en is distinct from old.anulado_en then
    update public.ventas set anulada_en = new.anulado_en where caja_id = new.id;
  end if;
  return new;
exception when others then
  raise warning '[VENTA-COMO-DATO] no se pudo marcar anulada la venta %: %', new.id, sqlerrm;
  return new;
end $$;

drop trigger if exists caja_anula_ventas on public.caja_movimientos;
create trigger caja_anula_ventas after update of anulado_en on public.caja_movimientos
  for each row execute function public._caja_anula_ventas();

-- ============================================================================
-- DESHACER (sólo si hace falta volver atrás):
--   drop trigger if exists caja_a_ventas on public.caja_movimientos;
--   drop trigger if exists caja_anula_ventas on public.caja_movimientos;
--   drop function if exists public._caja_a_ventas(), public._caja_anula_ventas();
--   drop table if exists public.marcas_costo, public.perfumes_costo, public.costos_config;
--   alter table public.ventas drop column if exists caja_id, drop column if exists medio_pago, drop column if exists origen,
--     drop column if exists tipo, drop column if exists ml, drop column if exists precio_unit, drop column if exists anulada_en;
-- ============================================================================

-- ============================================================================
-- 5. «N consultas hoy» (pista en «Anotar venta»): cuántos clics a WhatsApp tuvieron estos perfumes HOY (hora
-- de Argentina). `analytics_events` sólo la lee el jefe y quien vende es la empleada, así que va por esta función:
-- devuelve sólo un número, para las dos cuentas del panel.
-- ============================================================================
create or replace function public.wa_consultas_hoy(p_slugs text[]) returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if (auth.jwt() ->> 'email') is null or not ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])) then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  return coalesce((select count(*)::int from public.analytics_events
                   where event_type = 'wa_click'
                     and slug = any (p_slugs)
                     and (created_at at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date), 0);
end $$;
revoke all on function public.wa_consultas_hoy(text[]) from public, anon;
grant execute on function public.wa_consultas_hoy(text[]) to authenticated;
