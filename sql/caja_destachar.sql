-- ============================================================================
-- [DESHACER-TACHAR] · 16-oct-2026 · «Deshacer» al tachar un renglón de la hoja de caja
-- ============================================================================
-- Qué hace: crea `caja_destachar(p_id)`, la vuelta atrás de `caja_tachar(p_id)` (sql/caja_cierre.sql + sql/caja_deudas.sql). Deja el renglón como estaba:
--   · le saca el tachado (`anulado_en` / `anulado_por` vuelven a null);
--   · si el tachado había DEVUELTO stock de un cierre (items[].cierre.devuelto), lo vuelve a bajar (relativo: −n, nunca por debajo de 0; si el panel tiene
--     menos de lo que había bajado, baja lo que haya) y deja `devuelto` en false;
--   · si era un COBRO (salda_a), vuelve a restar lo cobrado de la deuda (y la deja saldada si llega a 0);
--   · deja su renglón en el Log (`hoja_destachar`) y un `stock_update` por cada perfume que vuelve a bajar.
-- Reglas de seguridad (porque mueve plata y stock):
--   · sólo las dos cuentas del panel (mira el email, como las demás);
--   · sólo quien tachó (`anulado_por`) y sólo dentro de los 10 minutos del tachado (es un «deshacer», no un destachar de cualquier día);
--   · si era un cobro y la deuda cambió desde entonces (ya la anularon, o debe menos de lo cobrado), NO lo hace y lo dice.
-- Qué NO toca: ninguna tabla, columna ni permiso; sólo agrega una función. Si no se corre, el panel dice «falta correr sql/caja_destachar.sql» y el tachado sigue como siempre.
-- Cómo se corre: pegarlo en el SQL Editor de Supabase. Se puede correr más de una vez.
-- Cómo se vuelve atrás: drop function if exists public.caja_destachar(uuid);
-- ============================================================================

create or replace function public.caja_destachar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := auth.jwt() ->> 'email';
  v_rol     text;
  v_fila    public.caja_movimientos%rowtype;
  v_deuda   public.caja_movimientos%rowtype;
  v_items   jsonb;
  v_item    jsonb;
  v_i       int;
  v_bajo    int;
  v_slug    text;
  v_prev    int;
  v_prev_st text;
  v_new     int;
  v_new_st  text;
  v_quita   int;
  v_cobro   numeric;
  v_quedan  numeric;
  v_baj     jsonb := '[]'::jsonb;
  v_sin     jsonb := '[]'::jsonb;
  v_cierra  boolean := false;
begin
  if v_email is null or not (v_email = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_rol := case when v_email = 'jefe@stperfumeria.local' then 'jefe' else 'empleado' end;

  select * into v_fila from public.caja_movimientos where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_fila.anulado_en is null then return jsonb_build_object('ok', false, 'motivo', 'no_tachado'); end if;
  if v_fila.anulado_por is distinct from v_email then return jsonb_build_object('ok', false, 'motivo', 'otra_persona'); end if;
  if v_fila.anulado_en < now() - interval '10 minutes' then return jsonb_build_object('ok', false, 'motivo', 'vencido'); end if;

  -- un cobro tachado había reabierto una deuda: para deshacerlo, la deuda tiene que seguir abierta y deber al menos lo cobrado
  if v_fila.salda_a is not null then
    v_cobro := v_fila.efectivo + v_fila.mp + v_fila.posnet;
    select * into v_deuda from public.caja_movimientos where id = v_fila.salda_a for update;
    if not found or v_deuda.anulado_en is not null or v_deuda.debe < v_cobro then
      return jsonb_build_object('ok', false, 'motivo', 'deuda_cambio');
    end if;
  end if;

  -- el stock que el tachado había devuelto vuelve a bajar
  v_items := v_fila.items;
  for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
    v_item := v_items -> v_i;
    v_bajo := coalesce((v_item #>> '{cierre,bajo}')::int, 0);
    if v_bajo > 0 and coalesce((v_item #>> '{cierre,devuelto}')::boolean, false) is true then
      v_slug := v_item ->> 'slug';
      select stock_qty, coalesce(stock_status, 'ok') into v_prev, v_prev_st
        from public.perfume_overrides where slug = v_slug for update;
      if found and v_prev is not null then
        v_quita := least(v_bajo, greatest(v_prev, 0));
        v_new := v_prev - v_quita;
        v_new_st := public._caja_estado_stock(v_new, v_prev_st);
        update public.perfume_overrides set stock_qty = v_new, stock_status = v_new_st, updated_at = now() where slug = v_slug;
        insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
        values (v_email, v_rol, 'stock_update', v_slug, jsonb_build_object(
          'stock_status', jsonb_build_object('old', v_prev_st, 'new', v_new_st),
          'stock_qty',    jsonb_build_object('old', v_prev,    'new', v_new),
          'origen', 'hoja_destachar', 'dia', v_fila.dia));
        v_baj := v_baj || jsonb_build_array(jsonb_build_object('slug', v_slug, 'nombre', v_item ->> 'nombre', 'baja', v_quita,
                                                               'prev', v_prev, 'new', v_new, 'status_prev', v_prev_st, 'status_new', v_new_st));
      else
        v_sin := v_sin || jsonb_build_array(jsonb_build_object('slug', v_slug, 'nombre', v_item ->> 'nombre', 'baja', v_bajo));
      end if;
      v_items := jsonb_set(v_items, array[v_i::text, 'cierre', 'devuelto'], 'false'::jsonb);
    end if;
  end loop;

  update public.caja_movimientos set items = v_items, anulado_en = null, anulado_por = null where id = p_id;

  -- el cobro vuelve a restar de la deuda
  if v_fila.salda_a is not null then
    v_quedan := v_deuda.debe - v_cobro;
    update public.caja_movimientos
       set debe = v_quedan,
           saldado_en  = case when v_quedan = 0 then now() else null end,
           saldado_por = case when v_quedan = 0 then v_email else null end
     where id = v_fila.salda_a;
    v_cierra := (v_quedan = 0);
  end if;

  insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
  values (v_email, v_rol, 'hoja_destachar', null, jsonb_build_object('id', v_fila.id, 'dia', v_fila.dia, 'detalle', v_fila.detalle,
          'efectivo', v_fila.efectivo, 'mp', v_fila.mp, 'posnet', v_fila.posnet, 'rebajados', v_baj, 'sin_rebajar', v_sin, 'cierra_deuda', v_cierra));

  return jsonb_build_object('ok', true, 'rebajados', v_baj, 'sin_rebajar', v_sin, 'cierra_deuda', v_cierra);
end;
$$;

revoke all on function public.caja_destachar(uuid) from public, anon;
grant execute on function public.caja_destachar(uuid) to authenticated;
