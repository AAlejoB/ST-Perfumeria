-- ============================================================
-- [QUIEN-VENDIO] + [CAMBIO] · 18-oct-2026 (Alejo, después del Día de la Madre)
--
-- 1. «Quién vendió»: la hoja anota el nombre de la vendedora (Sofía, Angelina, Pinky, Barria y las que se sumen con el «+»).
--    · caja_movimientos.vendedor (texto, opcional: una venta sin nombre se guarda igual y queda «sin nombre» para completar).
--    · vendedores: la lista de nombres que ven las dos tablets. Las dos cuentas del panel leen, agregan y esconden (activo);
--      nadie borra (las ventas viejas quedan con su nombre). Sin lectura pública (como caja_movimientos).
--    · caja_vendedor(p_id, p_vendedor): completa o corrige el nombre de un renglón (la política de UPDATE de la hoja sólo
--      deja tachar) y lo copia a ventas.vendedor.
-- 2. Cambio de un perfume (la política de ST: abierto = no hay devolución, salvo roto / fallado / vacío):
--    el frasco que VUELVE va en items con tipo 'vuelve' y SIN slug (queda de probador: no vuelve al stock, y el Cierre del
--    día sólo baja ítems con slug, _caja_item_pendiente). El disparador a ventas lo saltea y marca 'cambio' en notas.
-- 3. _caja_a_ventas: ventas.vendedor = el nombre elegido; si no hay, el mail de la cuenta (como hasta hoy).
--
-- Aplicada el 18-oct-2026 por Claude Code con el MCP de Supabase (opción A de Alejo).
-- ============================================================

alter table public.caja_movimientos add column if not exists vendedor text;
alter table public.caja_movimientos drop constraint if exists caja_movimientos_vendedor_check;
alter table public.caja_movimientos add constraint caja_movimientos_vendedor_check
  check (vendedor is null or char_length(btrim(vendedor)) between 1 and 40);
grant insert (vendedor) on public.caja_movimientos to authenticated;

create table if not exists public.vendedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 40),
  activo     boolean not null default true,
  creado_por text not null default (auth.jwt() ->> 'email'),
  creado_en  timestamptz not null default now()
);
create unique index if not exists vendedores_nombre_uniq on public.vendedores (lower(btrim(nombre)));
alter table public.vendedores enable row level security;
revoke all on public.vendedores from anon, authenticated;
grant select on public.vendedores to authenticated;
grant insert (nombre) on public.vendedores to authenticated;
grant update (activo) on public.vendedores to authenticated;

drop policy if exists vendedores_select_staff on public.vendedores;
create policy vendedores_select_staff on public.vendedores for select to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));
drop policy if exists vendedores_insert_staff on public.vendedores;
create policy vendedores_insert_staff on public.vendedores for insert to authenticated
  with check ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));
drop policy if exists vendedores_update_staff on public.vendedores;
create policy vendedores_update_staff on public.vendedores for update to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']))
  with check ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));

insert into public.vendedores (nombre, creado_por)
select v, 'alejo' from unnest(array['Sofía', 'Angelina', 'Pinky', 'Barria']) as v
on conflict do nothing;

create or replace function public.caja_vendedor(p_id uuid, p_vendedor text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_vendedor, '')), '');
  v_n int;
begin
  if coalesce((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']), false) is false then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  if v_nombre is not null and char_length(v_nombre) > 40 then
    raise exception 'El nombre es muy largo' using errcode = '22001';
  end if;
  update public.caja_movimientos set vendedor = v_nombre where id = p_id and tipo = 'venta';
  get diagnostics v_n = row_count;
  if v_n = 0 then return 'no'; end if;
  update public.ventas v set vendedor = coalesce(v_nombre, c.creado_por)
    from public.caja_movimientos c where c.id = p_id and v.caja_id = p_id;
  return 'ok';
end $$;
revoke all on function public.caja_vendedor(uuid, text) from public, anon;
grant execute on function public.caja_vendedor(uuid, text) to authenticated;

create or replace function public._caja_a_ventas()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_cambio boolean := exists (select 1 from jsonb_array_elements(new.items) i where i ->> 'tipo' = 'vuelve');   -- [CAMBIO]
begin
  if new.tipo is distinct from 'venta' or jsonb_typeof(new.items) <> 'array' or v_cuenta = 0 then return new; end if;
  begin
    if v_cambio then v_cuenta := v_cuenta - (select count(*) from jsonb_array_elements(new.items) i where i ->> 'tipo' = 'vuelve'); end if;
    v_n := (new.efectivo > 0)::int + (new.mp > 0)::int + (new.posnet > 0)::int;
    v_medio := case when v_n > 1 then 'mixto' when new.efectivo > 0 then 'efectivo' when new.mp > 0 then 'mp'
                    when new.posnet > 0 then 'posnet' else null end;
    for v_it in select value from jsonb_array_elements(new.items) loop
      if v_it ->> 'tipo' = 'vuelve' then continue; end if;   -- [CAMBIO] el frasco que vuelve no es una venta
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
                                 vendedor, caja_id, medio_pago, origen, tipo, ml, precio_unit, notas)
      values (new.creado_en, v_slug, coalesce(nullif(btrim(v_it ->> 'nombre'), ''), 'Sin nombre'), v_marca, 'Mostrador',
              v_qty, v_pu * v_qty, coalesce(nullif(btrim(new.vendedor), ''), new.creado_por), new.id, v_medio, v_vino, v_tipo, v_ml, v_pu,
              case when v_cambio then 'cambio' else null end);
    end loop;
  exception when others then
    raise warning '[VENTA-COMO-DATO] no se pudo copiar el renglón % a ventas: %', new.id, sqlerrm;
  end;
  return new;
end $function$;
