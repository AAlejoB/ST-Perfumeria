-- ============================================================================
-- [REEMPLAZO-DE-HOJA] sesión 3 · lo que queda debiendo («seña» = se lo llevó y pagó una parte)  ·  13-oct-2026
-- ============================================================================
-- Requiere sql/caja_movimientos.sql y sql/caja_cierre.sql. Decisión de Alejo (13-oct): en ST una «seña» NO es un frasco que no se
-- llevó: es un frasco que se llevó y del que se pagó sólo una parte; el resto queda debiendo (a gente de confianza). Entonces el
-- frasco baja del stock como cualquier venta (el «Cierre del día» no cambia) y la plata que falta se anota aparte:
--   · `debe`        lo que todavía falta cobrar de ese renglón (0 = nada)
--   · `debe_quien`  el nombre de quien debe (texto libre, puede ir vacío)
--   · `saldado_en` / `saldado_por`  cuando `debe` llega a 0
--   · `salda_a`     en un renglón de COBRO: el renglón de la deuda que cobra
-- caja_cobrar(...) registra el cobro (un renglón nuevo, «Resto de …», que suma en la caja del día en que se cobra) y baja `debe`;
-- caja_tachar(...) (se redefine acá) al tachar un cobro REABRE la deuda (+lo cobrado).
-- Los totales de la hoja (Efec. / MP / Posnet) cuentan sólo plata cobrada: lo que se debe no suma hasta que se cobra.
-- ============================================================================

alter table public.caja_movimientos
  add column if not exists debe        numeric(12, 2) not null default 0,
  add column if not exists debe_quien  text,
  add column if not exists saldado_en  timestamptz,
  add column if not exists saldado_por text,
  add column if not exists salda_a     uuid references public.caja_movimientos (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'caja_debe_rango') then
    alter table public.caja_movimientos add constraint caja_debe_rango check (debe >= 0 and debe <= 99999999);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'caja_debe_quien_largo') then
    alter table public.caja_movimientos add constraint caja_debe_quien_largo
      check (debe_quien is null or char_length(btrim(debe_quien)) between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'caja_saldado_par') then
    alter table public.caja_movimientos add constraint caja_saldado_par check ((saldado_en is null) = (saldado_por is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'caja_debe_solo_venta') then
    alter table public.caja_movimientos add constraint caja_debe_solo_venta check (debe = 0 or tipo = 'venta');
  end if;
end $$;

create index if not exists caja_pendientes_idx on public.caja_movimientos (creado_en)
  where debe > 0 and saldado_en is null and anulado_en is null;

-- El panel inserta sólo estas columnas: `salda_a`, `saldado_*` y `anulado_*` los escriben únicamente las funciones.
revoke insert on public.caja_movimientos from authenticated;
grant insert (id, dia, tipo, detalle, efectivo, mp, posnet, items, creado_por, debe, debe_quien) on public.caja_movimientos to authenticated;

create or replace function public.caja_cobrar(p_deuda uuid, p_id uuid, p_efectivo numeric, p_mp numeric, p_posnet numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := auth.jwt() ->> 'email';
  v_rol    text;
  v_d      public.caja_movimientos%rowtype;
  v_ef     numeric := coalesce(p_efectivo, 0);
  v_mp     numeric := coalesce(p_mp, 0);
  v_po     numeric := coalesce(p_posnet, 0);
  v_total  numeric;
  v_quedan numeric;
begin
  if v_email is null or not (v_email = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_rol := case when v_email = 'jefe@stperfumeria.local' then 'jefe' else 'empleado' end;
  v_total := v_ef + v_mp + v_po;
  if v_ef < 0 or v_mp < 0 or v_po < 0 or v_total <= 0 or v_total > 99999999 then
    raise exception 'Monto inválido' using errcode = '22023';
  end if;

  -- un reintento (la respuesta se perdió): el cobro con ese id ya está, no se cobra dos veces
  if exists (select 1 from public.caja_movimientos where id = p_id and salda_a = p_deuda) then
    select debe into v_quedan from public.caja_movimientos where id = p_deuda;
    return jsonb_build_object('ok', true, 'repetido', true, 'quedan', coalesce(v_quedan, 0));
  end if;

  select * into v_d from public.caja_movimientos where id = p_deuda for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_d.anulado_en is not null then return jsonb_build_object('ok', false, 'motivo', 'tachado'); end if;
  if v_d.debe <= 0 or v_d.saldado_en is not null then return jsonb_build_object('ok', false, 'motivo', 'ya_saldado'); end if;
  if v_total > v_d.debe then return jsonb_build_object('ok', false, 'motivo', 'mas_de_lo_que_debe', 'debe', v_d.debe); end if;

  insert into public.caja_movimientos (id, tipo, detalle, efectivo, mp, posnet, items, creado_por, salda_a)
  values (p_id, 'venta', left('Resto de ' || v_d.detalle || coalesce(' (' || v_d.debe_quien || ')', ''), 300), v_ef, v_mp, v_po, '[]'::jsonb, v_email, p_deuda);

  v_quedan := v_d.debe - v_total;
  update public.caja_movimientos
     set debe = v_quedan,
         saldado_en  = case when v_quedan = 0 then now() end,
         saldado_por = case when v_quedan = 0 then v_email end
   where id = p_deuda;

  insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
  values (v_email, v_rol, 'hoja_cobro', null, jsonb_build_object('deuda', p_deuda, 'detalle', v_d.detalle, 'quien', v_d.debe_quien,
          'efectivo', v_ef, 'mp', v_mp, 'posnet', v_po, 'quedan', v_quedan));

  return jsonb_build_object('ok', true, 'quedan', v_quedan);
end;
$$;

-- caja_tachar: igual que en sql/caja_cierre.sql (devuelve el stock de lo que bajó el cierre) y, además, si el renglón tachado era un
-- COBRO (salda_a), reabre la deuda: vuelve a sumar lo cobrado a `debe` y le saca el «saldado».
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
  v_reabre  boolean := false;
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

  if v_fila.salda_a is not null then   -- era un cobro: la deuda se reabre
    update public.caja_movimientos
       set debe = debe + (v_fila.efectivo + v_fila.mp + v_fila.posnet), saldado_en = null, saldado_por = null
     where id = v_fila.salda_a and anulado_en is null;
    v_reabre := found;
  end if;

  insert into public.admin_actions (actor_email, actor_role, action, target_slug, changes)
  values (v_email, v_rol, 'hoja_tachar', null, jsonb_build_object('id', v_fila.id, 'dia', v_fila.dia, 'detalle', v_fila.detalle,
          'efectivo', v_fila.efectivo, 'mp', v_fila.mp, 'posnet', v_fila.posnet, 'devueltos', v_dev, 'sin_devolver', v_sin,
          'reabre_deuda', v_reabre));

  return jsonb_build_object('ok', true, 'devueltos', v_dev, 'sin_devolver', v_sin, 'reabre_deuda', v_reabre);
end;
$$;

revoke all on function public.caja_cobrar(uuid, uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.caja_cobrar(uuid, uuid, numeric, numeric, numeric) to authenticated;

-- ============================================================================
-- DESHACER (la tabla y sus datos quedan; sólo vuelve a la versión anterior de las funciones):
--
--   drop function if exists public.caja_cobrar(uuid, uuid, numeric, numeric, numeric);
--   -- y volver a correr sql/caja_cierre.sql (redefine caja_tachar sin el reabrir)
--   -- las columnas debe / debe_quien / saldado_* / salda_a pueden quedarse (todas con default)
--   grant insert on public.caja_movimientos to authenticated;
--
-- ============================================================================
