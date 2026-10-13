-- ============================================================================
-- [PANEL-SIN-CONEXION] paso 2 · el stock viaja como MOVIMIENTO (+N / −N), no como el número final  ·  13-oct-2026
-- ============================================================================
-- Decisión de Alejo (13-oct): sin internet, «gana lo que anotaron las chicas»: se SUMA a lo que hay en la base, no lo pisa.
-- Hasta acá el panel escribía el número final (upsert de stock_qty / stock_deposito con lo que tenía en la memoria de la tablet):
-- dos tablets, o una tablet que sube tarde, se pisaban. Esta función aplica el movimiento sobre lo que hay AHORA en la base,
-- en una transacción, con la fila bloqueada (FOR UPDATE).
--
--   stock_mover(p_id uuid, p_slug text, p_lugar text, p_delta int, p_pasan boolean, p_estricto boolean, p_origen text,
--               p_anotado_en timestamptz, p_pausado boolean) → jsonb
--     p_id       lo genera la tablet: el mismo id dos veces no se aplica dos veces (devuelve lo de la primera, con ya_estaba).
--     p_lugar    'local' (stock_qty) o 'deposito' (stock_deposito).
--     p_delta    −999 a 999; 0 sólo si cambia «pausado».
--     p_pasan    en el depósito: lo que baja sube al local (DEP-SUMAR, como el modal de Depósito y «Salieron»).
--     p_estricto true  (con red): si no alcanza o pasa de 999, NO toca nada y devuelve ok = false (el panel lo dice como siempre).
--                false (lo que sube de la tablet): «hasta donde alcanza»: nunca deja menos de 0 ni más de 999, y lo marca (parcial).
--     p_pausado  null = el pausado sigue como estaba · true = pausar · false = despausar (sólo local; lo usa el modal de stock).
--   El estado se deriva igual que deriveStockInfo (admin.html) y _caja_estado_stock (sql/caja_cierre.sql): SINCRO.
--   Deja su renglón en el Log (admin_actions: stock_update / deposito_update con old y new, `origen`, y `sin_conexion` si vino de la
--   tablet): el panel NO lo escribe aparte.
--
-- stock_movimientos: un renglón por movimiento aplicado (o por uno de la tablet que no se pudo aplicar). Sin lectura ni escritura
-- directa para nadie (RLS prendida y sin políticas; sólo la función): excepción a la regla #5, como cliente_sesiones. Es un
-- registro, como los logs: NO va en las listas de backups (regla #23).
-- Quién puede: las dos cuentas del panel (se mira el email del token, no el rol que mande el cliente).
-- APLICADA el 13-oct-2026 (~18:15, migración stock_mover, por Claude Code con el OK de Alejo). Probada como la empleada en una
-- transacción deshecha (9-pm-elixir, 2 local / 1 depósito): +2 → 4 · el mismo id → ya_estaba · −999 con red → no_alcanza sin tocar ·
-- −999 de la tablet → 0 (parcial) · depósito −1 pasando → local 1 · pausar y +3 → sigue pausado · un slug sin fila → sin_dato sin
-- inventar la fila · anon → 42501 · authenticated no lee stock_movimientos · al final la base quedó igual (2 / 1, 0 movimientos).
-- ============================================================================

create table if not exists public.stock_movimientos (
  id           uuid primary key,
  slug         text not null,
  lugar        text not null check (lugar in ('local', 'deposito')),
  delta        int  not null check (delta between -999 and 999),
  pasan        boolean not null default false,
  origen       text not null default 'panel',
  sin_conexion boolean not null default false,
  anotado_en   timestamptz,
  resultado    jsonb not null,
  creado_por   text not null,
  creado_en    timestamptz not null default now()
);
create index if not exists stock_movimientos_slug_idx on public.stock_movimientos (slug, creado_en);
alter table public.stock_movimientos enable row level security;
revoke all on table public.stock_movimientos from public, anon, authenticated;

create or replace function public.stock_mover(
  p_id uuid, p_slug text, p_lugar text, p_delta int,
  p_pasan boolean default false, p_estricto boolean default true, p_origen text default 'panel',
  p_anotado_en timestamptz default null, p_pausado boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := auth.jwt() ->> 'email';
  v_rol     text;
  v_res     jsonb;
  v_hay     boolean;
  v_qty     int;  v_st text;  v_dep int;
  v_new     int;  v_new_st text;  v_new_dep int;
  v_movido  int := 0;
  v_parcial boolean := false;
  v_sinc    boolean := not coalesce(p_estricto, true);
  v_origen  text := coalesce(nullif(btrim(p_origen), ''), 'panel');
begin
  if v_email is null or not (v_email = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_id is null or coalesce(btrim(p_slug), '') = '' or p_lugar not in ('local', 'deposito')
     or p_delta is null or p_delta not between -999 and 999 or (p_delta = 0 and p_pausado is null) then
    raise exception 'Movimiento inválido' using errcode = '22023';
  end if;
  v_rol := case when v_email = 'jefe@stperfumeria.local' then 'jefe' else 'empleado' end;

  -- el mismo movimiento dos veces (un reintento que ya había llegado): se devuelve lo de la primera
  select resultado into v_res from public.stock_movimientos where id = p_id;
  if found then return v_res || jsonb_build_object('ya_estaba', true); end if;

  -- sumar a un perfume sin fila de stock crea la fila (como el upsert de antes); restar a uno sin fila no inventa nada
  if p_delta > 0 or p_pausado is not null then
    insert into public.perfume_overrides (slug) values (p_slug) on conflict (slug) do nothing;
  end if;
  select stock_qty, coalesce(stock_status, 'ok'), coalesce(stock_deposito, 0) into v_qty, v_st, v_dep
    from public.perfume_overrides where slug = p_slug for update;
  v_hay := found;

  if p_lugar = 'local' then
    if not v_hay or (v_qty is null and p_delta < 0) then
      v_res := jsonb_build_object('ok', false, 'motivo', 'sin_dato', 'local', jsonb_build_object('prev', v_qty));
    else
      v_new := coalesce(v_qty, 0) + p_delta;
      if v_new < 0 or v_new > 999 then
        if not v_sinc then
          return jsonb_build_object('ok', false, 'motivo', case when v_new < 0 then 'no_alcanza' else 'tope' end,
                                    'local', jsonb_build_object('prev', v_qty, 'status_prev', v_st));
        end if;
        v_new := greatest(0, least(999, v_new)); v_parcial := true;
      end if;
      v_new_st := case when p_pausado is true then 'pausado'
                       when p_pausado is false then public._caja_estado_stock(v_new, null)
                       else public._caja_estado_stock(v_new, v_st) end;
      update public.perfume_overrides set stock_qty = v_new, stock_status = v_new_st where slug = p_slug;
      insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
      values (v_email, v_rol, 'stock_update', p_slug, jsonb_build_object(
        'stock_status', jsonb_build_object('old', v_st, 'new', v_new_st),
        'stock_qty',    jsonb_build_object('old', v_qty, 'new', v_new),
        'origen', v_origen) || case when v_sinc then jsonb_build_object('sin_conexion', true, 'anotado_en', p_anotado_en) else '{}'::jsonb end);
      v_res := jsonb_build_object('ok', true, 'parcial', v_parcial, 'aplicado', v_new - coalesce(v_qty, 0),
        'local', jsonb_build_object('prev', v_qty, 'new', v_new, 'status_prev', v_st, 'status_new', v_new_st));
    end if;
  else
    if not v_hay then
      v_res := jsonb_build_object('ok', false, 'motivo', 'sin_dato', 'deposito', jsonb_build_object('prev', 0));
    else
      v_new_dep := v_dep + p_delta;
      if v_new_dep < 0 or v_new_dep > 999 then
        if not v_sinc then
          return jsonb_build_object('ok', false, 'motivo', case when v_new_dep < 0 then 'no_alcanza' else 'tope' end,
                                    'deposito', jsonb_build_object('prev', v_dep));
        end if;
        v_new_dep := greatest(0, least(999, v_new_dep)); v_parcial := true;
      end if;
      v_movido := case when coalesce(p_pasan, false) then greatest(v_dep - v_new_dep, 0) else 0 end;   -- lo que baja sube al local
      if v_movido > 0 then
        v_new := coalesce(v_qty, 0) + v_movido;
        if v_new > 999 then
          if not v_sinc then
            return jsonb_build_object('ok', false, 'motivo', 'tope_local', 'deposito', jsonb_build_object('prev', v_dep),
                                      'local', jsonb_build_object('prev', v_qty, 'status_prev', v_st));
          end if;
          v_new := 999; v_parcial := true;
        end if;
        v_new_st := public._caja_estado_stock(v_new, v_st);
        update public.perfume_overrides set stock_deposito = v_new_dep, stock_qty = v_new, stock_status = v_new_st where slug = p_slug;
      else
        update public.perfume_overrides set stock_deposito = v_new_dep where slug = p_slug;
      end if;
      insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
      values (v_email, v_rol, 'deposito_update', p_slug, jsonb_build_object(
        'stock_deposito', jsonb_build_object('old', v_dep, 'new', v_new_dep), 'origen', v_origen)
        || case when v_sinc then jsonb_build_object('sin_conexion', true, 'anotado_en', p_anotado_en) else '{}'::jsonb end);
      if v_movido > 0 then
        insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
        values (v_email, v_rol, 'stock_update', p_slug, jsonb_build_object(
          'stock_status', jsonb_build_object('old', v_st, 'new', v_new_st),
          'stock_qty',    jsonb_build_object('old', v_qty, 'new', v_new),
          'origen', v_origen) || case when v_sinc then jsonb_build_object('sin_conexion', true, 'anotado_en', p_anotado_en) else '{}'::jsonb end);
      end if;
      v_res := jsonb_build_object('ok', true, 'parcial', v_parcial, 'aplicado', v_new_dep - v_dep,
        'deposito', jsonb_build_object('prev', v_dep, 'new', v_new_dep),
        'local', case when v_movido > 0 then jsonb_build_object('prev', v_qty, 'new', v_new, 'status_prev', v_st, 'status_new', v_new_st) else null end);
    end if;
  end if;

  -- con red, lo que no se aplicó no se anota (se puede reintentar); lo de la tablet se anota siempre (no se vuelve a intentar)
  if (v_res ->> 'ok')::boolean or v_sinc then
    insert into public.stock_movimientos (id, slug, lugar, delta, pasan, origen, sin_conexion, anotado_en, resultado, creado_por)
    values (p_id, p_slug, p_lugar, p_delta, coalesce(p_pasan, false), v_origen, v_sinc, p_anotado_en, v_res, v_email);
  end if;
  return v_res;
end;
$$;

revoke all on function public.stock_mover(uuid, text, text, int, boolean, boolean, text, timestamptz, boolean) from public, anon;
grant execute on function public.stock_mover(uuid, text, text, int, boolean, boolean, text, timestamptz, boolean) to authenticated;

-- Para volver atrás (el panel viejo no la usa):
--   drop function if exists public.stock_mover(uuid, text, text, int, boolean, boolean, text, timestamptz, boolean);
--   drop table if exists public.stock_movimientos;
