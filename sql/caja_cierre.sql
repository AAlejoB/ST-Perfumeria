-- ============================================================================
-- [REEMPLAZO-DE-HOJA] sesión 2 · el «Cierre del día» (baja el stock del local UNA vez)  ·  12-oct-2026
-- ============================================================================
-- Requiere sql/caja_movimientos.sql (la tabla). Crea 2 funciones públicas y 2 auxiliares; NO cambia datos al crearlas.
--
--   caja_cerrar_dia(p_dia date, p_aplicar boolean default false) → jsonb
--       p_aplicar = false: sólo MIRA y devuelve el plan (no escribe nada): es la lista previa que ve la chica.
--       p_aplicar = true : baja el stock del local y marca cada frasco del renglón con su resultado (`cierre`), todo en UNA
--       transacción. Es idempotente: un frasco con `cierre` no se vuelve a descontar (correrlo dos veces no baja dos veces).
--   caja_tachar(p_id uuid) → jsonb
--       Tacha un renglón; si ya había bajado stock en un cierre, lo DEVUELVE (relativo: +n, nunca el valor viejo), y marca
--       `cierre.devuelto`. Es la única vía para tachar (se le saca el UPDATE de columnas a `authenticated`).
--
-- Reglas del cierre (las decidió Alejo):
--   · baja sólo frascos con `llevar` (la seña no baja) y sin `ya_bajado` (los que ya bajó «Vendí») y sin `cierre`;
--   · lo tachado no baja; los decants y los sets no tienen slug en `items`: no pasan por acá;
--   · baja «hasta donde alcanza»: nunca deja el local en negativo; si no hay dato o está en 0, se salta y queda marcado;
--   · un perfume pausado baja y sigue pausado; el estado se deriva como `deriveStockInfo` (admin.html): ≤0 'out' (0) · 1 'low' · resto 'ok';
--     SINCRO: si cambia esa regla en el panel, cambia `_caja_estado_stock` acá;
--   · cada perfume que baja o vuelve deja su renglón `stock_update` en el Log (con `origen`), y el cierre deja un `hoja_cierre`.
--   · se bloquean (FOR UPDATE) los renglones y las filas de stock mientras corre: dos tablets cerrando a la vez no se pisan.
-- Quién puede: las dos cuentas del panel (se mira el email del token; no depende del rol que mande el cliente).
-- ============================================================================

create or replace function public._caja_estado_stock(q int, st text)
returns text language sql immutable as $$
  select case when st = 'pausado' then 'pausado'
              when q is null then coalesce(st, 'ok')
              when q = 0 then 'out'
              when q = 1 then 'low'
              else 'ok' end;
$$;

create or replace function public._caja_item_pendiente(it jsonb)
returns boolean language sql immutable as $$
  select (it ->> 'slug') is not null
     and coalesce((it ->> 'qty')::int, 0) > 0
     and coalesce((it ->> 'llevar')::boolean, true) is true
     and coalesce((it ->> 'ya_bajado')::boolean, false) is false
     and not (it ? 'cierre');
$$;

create or replace function public.caja_cerrar_dia(p_dia date, p_aplicar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text := auth.jwt() ->> 'email';
  v_rol      text;
  v_hoy      date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_pend     jsonb := '{}'::jsonb;   -- slug -> {pedido, nombre}
  v_disp     jsonb := '{}'::jsonb;   -- slug -> unidades que se pueden repartir entre los renglones
  v_estado   jsonb := '{}'::jsonb;   -- slug -> estado del perfume (bajado / parcial / sin_stock / sin_dato)
  v_plan     jsonb := '[]'::jsonb;
  v_fila     record;
  v_items    jsonb;
  v_item     jsonb;
  v_i        int;
  v_slug     text;
  v_nombre   text;
  v_qty      int;
  v_take     int;
  v_prev     int;
  v_prev_st  text;
  v_new      int;
  v_new_st   text;
  v_bajar    int;
  v_est      text;
  v_motivo   text;
  v_hallado  boolean;
  v_cambio   boolean;
  v_filas    int := 0;
  v_senas    int := 0;
  v_yabajado int := 0;
begin
  if v_email is null or not (v_email = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_dia is null or p_dia > v_hoy then
    raise exception 'Día inválido: no se puede cerrar un día que todavía no pasó' using errcode = '22023';
  end if;
  v_rol := case when v_email = 'jefe@stperfumeria.local' then 'jefe' else 'empleado' end;

  -- 1) lo pendiente de los renglones no tachados, sumado por perfume
  for v_fila in
    select id, items from public.caja_movimientos
    where dia = p_dia and anulado_en is null and tipo = 'venta'
    order by creado_en, id
    for update
  loop
    for v_i in 0 .. jsonb_array_length(v_fila.items) - 1 loop
      v_item := v_fila.items -> v_i;
      if public._caja_item_pendiente(v_item) then
        v_slug := v_item ->> 'slug';
        v_pend := jsonb_set(v_pend, array[v_slug], jsonb_build_object(
          'pedido', coalesce((v_pend -> v_slug ->> 'pedido')::int, 0) + (v_item ->> 'qty')::int,
          'nombre', coalesce(v_item ->> 'nombre', v_slug)));
      elsif (v_item ->> 'slug') is not null and not (v_item ? 'cierre') then
        if coalesce((v_item ->> 'llevar')::boolean, true) is false then v_senas := v_senas + 1;
        elsif coalesce((v_item ->> 'ya_bajado')::boolean, false) then v_yabajado := v_yabajado + 1; end if;
      end if;
    end loop;
  end loop;

  -- 2) por perfume: cuánto se puede bajar (con la fila de stock bloqueada) y, si corresponde, bajarlo
  for v_slug in select jsonb_object_keys(v_pend) order by 1 loop
    v_qty := (v_pend -> v_slug ->> 'pedido')::int;
    v_nombre := v_pend -> v_slug ->> 'nombre';
    v_prev := null; v_prev_st := null;
    select stock_qty, coalesce(stock_status, 'ok') into v_prev, v_prev_st
      from public.perfume_overrides where slug = v_slug for update;
    v_hallado := found;
    v_bajar := 0; v_motivo := null;
    if not v_hallado then
      v_est := 'sin_dato'; v_motivo := 'el perfume no tiene fila de stock';
    elsif v_prev is null then
      v_est := 'sin_dato'; v_motivo := 'no hay cantidad cargada en el local';
    elsif v_prev <= 0 then
      v_est := 'sin_stock'; v_motivo := 'el panel dice que no hay en el local';
    else
      v_bajar := least(v_prev, v_qty);
      v_est := case when v_bajar = v_qty then 'bajado' else 'parcial' end;
      if v_bajar < v_qty then v_motivo := 'el panel tenía menos de lo que se vendió'; end if;
    end if;
    v_new := case when v_bajar > 0 then v_prev - v_bajar else v_prev end;
    v_new_st := case when v_bajar > 0 then public._caja_estado_stock(v_new, v_prev_st) else v_prev_st end;

    if p_aplicar and v_bajar > 0 then
      update public.perfume_overrides
         set stock_qty = v_new, stock_status = v_new_st, updated_at = now()
       where slug = v_slug;
      insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
      values (v_email, v_rol, 'stock_update', v_slug, jsonb_build_object(
        'stock_status', jsonb_build_object('old', v_prev_st, 'new', v_new_st),
        'stock_qty',    jsonb_build_object('old', v_prev,    'new', v_new),
        'origen', 'hoja_cierre', 'dia', p_dia));
    end if;
    v_disp   := jsonb_set(v_disp,   array[v_slug], to_jsonb(v_bajar));
    v_estado := jsonb_set(v_estado, array[v_slug], to_jsonb(v_est));
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'slug', v_slug, 'nombre', v_nombre, 'pedido', v_qty, 'bajar', v_bajar, 'estado', v_est, 'motivo', v_motivo,
      'prev', v_prev, 'new', v_new, 'status_prev', v_prev_st, 'status_new', v_new_st));
  end loop;

  -- 3) marcar cada frasco con su resultado (así un segundo cierre no lo vuelve a bajar)
  if p_aplicar and jsonb_array_length(v_plan) > 0 then
    for v_fila in
      select id, items from public.caja_movimientos
      where dia = p_dia and anulado_en is null and tipo = 'venta'
      order by creado_en, id
      for update
    loop
      v_items := v_fila.items; v_cambio := false;
      for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
        v_item := v_items -> v_i;
        if public._caja_item_pendiente(v_item) then
          v_slug := v_item ->> 'slug'; v_qty := (v_item ->> 'qty')::int;
          v_take := least(v_qty, coalesce((v_disp ->> v_slug)::int, 0));
          v_disp := jsonb_set(v_disp, array[v_slug], to_jsonb(coalesce((v_disp ->> v_slug)::int, 0) - v_take));
          v_item := v_item || jsonb_build_object(
            'descontado', v_take > 0,
            'cierre', jsonb_build_object('en', now(), 'por', v_email, 'bajo', v_take, 'de', v_qty,
              'estado', case when v_take = v_qty then 'bajado' when v_take > 0 then 'parcial' else coalesce(v_estado ->> v_slug, 'sin_dato') end));
          v_items := jsonb_set(v_items, array[v_i::text], v_item);
          v_cambio := true;
        end if;
      end loop;
      if v_cambio then
        update public.caja_movimientos set items = v_items where id = v_fila.id;
        v_filas := v_filas + 1;
      end if;
    end loop;

    insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
    values (v_email, v_rol, 'hoja_cierre', null, jsonb_build_object('dia', p_dia, 'renglones', v_filas, 'perfumes', v_plan));
  end if;

  return jsonb_build_object('dia', p_dia, 'aplicado', p_aplicar, 'plan', v_plan,
                            'renglones', v_filas, 'senas', v_senas, 'ya_bajados', v_yabajado);
end;
$$;

create or replace function public.caja_tachar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := auth.jwt() ->> 'email';
  v_rol     text;
  v_fila    public.caja_movimientos%rowtype;
  v_items   jsonb;
  v_item    jsonb;
  v_i       int;
  v_bajo    int;
  v_slug    text;
  v_prev    int;
  v_prev_st text;
  v_new     int;
  v_new_st  text;
  v_hallado boolean;
  v_dev     jsonb := '[]'::jsonb;
  v_sin     jsonb := '[]'::jsonb;
begin
  if v_email is null or not (v_email = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_rol := case when v_email = 'jefe@stperfumeria.local' then 'jefe' else 'empleado' end;

  select * into v_fila from public.caja_movimientos where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_fila.anulado_en is not null then return jsonb_build_object('ok', false, 'motivo', 'ya_tachado'); end if;

  v_items := v_fila.items;
  for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
    v_item := v_items -> v_i;
    v_bajo := coalesce((v_item #>> '{cierre,bajo}')::int, 0);
    if v_bajo > 0 and coalesce((v_item #>> '{cierre,devuelto}')::boolean, false) is false then
      v_slug := v_item ->> 'slug';
      select stock_qty, coalesce(stock_status, 'ok') into v_prev, v_prev_st
        from public.perfume_overrides where slug = v_slug for update;
      v_hallado := found;
      if v_hallado and v_prev is not null then
        v_new := v_prev + v_bajo;
        v_new_st := public._caja_estado_stock(v_new, v_prev_st);
        update public.perfume_overrides set stock_qty = v_new, stock_status = v_new_st, updated_at = now() where slug = v_slug;
        insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
        values (v_email, v_rol, 'stock_update', v_slug, jsonb_build_object(
          'stock_status', jsonb_build_object('old', v_prev_st, 'new', v_new_st),
          'stock_qty',    jsonb_build_object('old', v_prev,    'new', v_new),
          'origen', 'hoja_tachar', 'dia', v_fila.dia));
        v_items := jsonb_set(v_items, array[v_i::text, 'cierre', 'devuelto'], 'true'::jsonb);
        v_dev := v_dev || jsonb_build_array(jsonb_build_object('slug', v_slug, 'nombre', v_item ->> 'nombre', 'bajo', v_bajo,
                                                               'prev', v_prev, 'new', v_new, 'status_prev', v_prev_st, 'status_new', v_new_st));
      else
        v_sin := v_sin || jsonb_build_array(jsonb_build_object('slug', v_slug, 'nombre', v_item ->> 'nombre', 'bajo', v_bajo));
      end if;
    end if;
  end loop;

  update public.caja_movimientos set items = v_items, anulado_en = now(), anulado_por = v_email where id = p_id;
  insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
  values (v_email, v_rol, 'hoja_tachar', null, jsonb_build_object('id', v_fila.id, 'dia', v_fila.dia, 'detalle', v_fila.detalle,
          'efectivo', v_fila.efectivo, 'mp', v_fila.mp, 'posnet', v_fila.posnet, 'devueltos', v_dev, 'sin_devolver', v_sin));

  return jsonb_build_object('ok', true, 'devueltos', v_dev, 'sin_devolver', v_sin);
end;
$$;

-- Un renglón que ya bajó stock no se borra (primero se tacha: así el stock vuelve). Defensa en la base, además del panel.
create or replace function public._caja_bloquear_borrado()
returns trigger language plpgsql as $$
begin
  if old.anulado_en is null and exists (
       select 1 from jsonb_array_elements(old.items) i
        where coalesce((i #>> '{cierre,bajo}')::int, 0) > 0
          and coalesce((i #>> '{cierre,devuelto}')::boolean, false) is false) then
    raise exception 'Ese renglón ya bajó stock en un cierre: tachalo primero para devolverlo.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists caja_bloquear_borrado on public.caja_movimientos;
create trigger caja_bloquear_borrado before delete on public.caja_movimientos
  for each row execute function public._caja_bloquear_borrado();

-- Permisos: sólo `authenticated` ejecuta las dos públicas (cada una vuelve a mirar el email). Y tachar pasa a ser SÓLO por la función.
revoke all on function public.caja_cerrar_dia(date, boolean) from public, anon;
revoke all on function public.caja_tachar(uuid) from public, anon;
revoke all on function public._caja_estado_stock(int, text) from public, anon;
revoke all on function public._caja_item_pendiente(jsonb) from public, anon;
grant execute on function public.caja_cerrar_dia(date, boolean) to authenticated;
grant execute on function public.caja_tachar(uuid) to authenticated;
revoke update (anulado_en, anulado_por) on public.caja_movimientos from authenticated;

-- ============================================================================
-- DESHACER (no toca la tabla ni sus datos):
--
--   drop trigger if exists caja_bloquear_borrado on public.caja_movimientos;
--   drop function if exists public._caja_bloquear_borrado();
--   drop function if exists public.caja_tachar(uuid);
--   drop function if exists public.caja_cerrar_dia(date, boolean);
--   drop function if exists public._caja_item_pendiente(jsonb);
--   drop function if exists public._caja_estado_stock(int, text);
--   grant update (anulado_en, anulado_por) on public.caja_movimientos to authenticated;
--
-- ============================================================================
