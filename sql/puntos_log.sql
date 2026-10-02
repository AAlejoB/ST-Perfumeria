-- ═══════════════════════════════════════════════════════════════════════
-- [PUNTOS-LOG] opción A · historial de puntos de verdad + una sola función que cambia el saldo
-- 2-oct-2026 · rama `puntos-log` · SIN APLICAR (se aplica con el OK de Alejo, fuera de 10–21 ART)
--
-- SÓLO AGREGA cosas: dos tablas nuevas (`puntos_log`, `puntos_config`), una función auxiliar y tres
-- funciones. No toca `clientes` ni cambia ninguna función existente (`resumen_dia` y `daily_summary`
-- siguen leyendo `clientes.puntos_log`, el JSONB de los últimos 5: ver (6)).
--
--   (1) tabla  public.puntos_log      el historial: un renglón por movimiento, con origen y pago_id (el historial no se borra con el cliente: on delete set null)
--   (2) tabla  public.puntos_config   la regla de puntos: UNA fila (id = 1) + pesos_por_punto (nulo = las compras no suman)
--   (3) func   public.ajustar_puntos(cliente, delta, motivo)             el panel (jefe y empleado)
--   (4) func   public.sumar_puntos_por_compra(pago_id, cliente, monto)   la pasarela (sólo service_role)
--   (5) func   public.revertir_puntos_por_compra(pago_id)                la pasarela (sólo service_role)
--   (6) func   public.puntos_json_antepone(jsonb, jsonb)                 interna: mantiene `clientes.puntos_log`
--
-- Quién puede qué (medido el 2-oct):
--   · hoy `clientes` deja update/insert/delete a cualquier `authenticated` (política `clientes_update_auth`, `true`);
--     esta migración NO lo cierra (ver la carta al PREPARADOR, «lo que queda abierto»).
--   · el jefe se distingue por el email `jefe@stperfumeria.local` (`is_jefe()`), el staff por esa dirección y
--     `empleado@stperfumeria.local` (como `perfume_overrides_write_staff`).
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ─── (1) puntos_log ───────────────────────────────────────────────────
create table if not exists public.puntos_log (
  id            bigint generated always as identity primary key,
  cliente_id    uuid        references public.clientes(id) on delete set null,   -- clientes.id es uuid; si se borra el cliente, el movimiento QUEDA (con cliente_id nulo)
  delta         integer     not null check (delta <> 0),
  saldo_antes   integer     not null check (saldo_antes >= 0),
  saldo_despues integer     not null check (saldo_despues >= 0),
  origen        text        not null check (origen in ('manual', 'compra', 'devolucion')),
  motivo        text,
  actor         text,                                      -- 'jefe' | 'empleado' | 'pasarela'
  pago_id       text,                                      -- nulo en lo manual
  created_at    timestamptz not null default now(),
  constraint puntos_log_cuenta  check (saldo_despues = saldo_antes + delta),
  constraint puntos_log_pago_id check (origen = 'manual' or (pago_id is not null and btrim(pago_id) <> ''))
);

create index if not exists puntos_log_cliente_idx on public.puntos_log (cliente_id, created_at desc);
create index if not exists puntos_log_fecha_idx   on public.puntos_log (created_at desc);

-- la misma compra no suma dos veces y su devolución no resta dos veces
create unique index if not exists puntos_log_pago_origen_uniq
  on public.puntos_log (pago_id, origen) where pago_id is not null;

alter table public.puntos_log enable row level security;
revoke all on public.puntos_log from public, anon, authenticated;
grant select on public.puntos_log to authenticated;
drop policy if exists puntos_log_select_staff on public.puntos_log;
create policy puntos_log_select_staff on public.puntos_log
  for select to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));
-- sin políticas de insert/update/delete: nadie escribe directo; sólo las funciones de abajo (security definer)

-- ─── (2) puntos_config ────────────────────────────────────────────────
-- Los campos son EXACTAMENTE los que leen hoy el panel (admin.html, loadPuntosConfig) y el catálogo (js/app.js ~L7830,
-- `select('*')`): puntos_por_perfume, puntos_por_decant, puntos_por_set_combo, threshold_proximo_premio, mensaje_promo,
-- updated_at (y el id). Más pesos_por_punto, nuevo.
create table if not exists public.puntos_config (
  id                       integer       primary key default 1 check (id = 1),               -- una sola fila
  puntos_por_perfume       numeric(6,2)  not null default 1.00,
  puntos_por_decant        numeric(6,2)  not null default 0.10,
  puntos_por_set_combo     numeric(6,2)  not null default 2.00,
  threshold_proximo_premio integer       not null default 5 check (threshold_proximo_premio > 0),
  mensaje_promo            text,
  pesos_por_punto          integer       check (pesos_por_punto is null or pesos_por_punto > 0),   -- nulo = las compras no suman
  updated_at               timestamptz   not null default now()
);

insert into public.puntos_config (id, mensaje_promo)
values (1, 'SUMÁ 1 MÁS Y CONSULTÁ POR TU PREMIO 📲')
on conflict (id) do nothing;

alter table public.puntos_config enable row level security;
revoke all on public.puntos_config from public, anon, authenticated;
grant select on public.puntos_config to anon, authenticated;       -- el catálogo (anon) la lee con select('*')
grant insert, update on public.puntos_config to authenticated;
drop policy if exists puntos_config_select_all on public.puntos_config;
create policy puntos_config_select_all on public.puntos_config for select to anon, authenticated using (true);
drop policy if exists puntos_config_insert_jefe on public.puntos_config;
create policy puntos_config_insert_jefe on public.puntos_config for insert to authenticated with check (public.is_jefe());
drop policy if exists puntos_config_update_jefe on public.puntos_config;
create policy puntos_config_update_jefe on public.puntos_config for update to authenticated using (public.is_jefe()) with check (public.is_jefe());
-- sin política de delete: la fila no se borra

-- ─── (6) auxiliar: mantiene clientes.puntos_log (JSONB, los últimos 5) para no romper resumen_dia() / daily_summary() ───
create or replace function public.puntos_json_antepone(p_log jsonb, p_entrada jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(s.e order by s.n), '[]'::jsonb)
  from (
    select t.e, t.n
    from jsonb_array_elements(jsonb_build_array(p_entrada) || coalesce(p_log, '[]'::jsonb)) with ordinality as t(e, n)
    order by t.n
    limit 5
  ) s;
$$;
revoke all on function public.puntos_json_antepone(jsonb, jsonb) from public, anon, authenticated;

-- ─── (3) ajustar_puntos: el panel ─────────────────────────────────────
-- Devuelve el saldo nuevo. Errores (message; el saldo del cliente, cuando sirve, va en `detail`):
--   no_autorizado · cantidad_invalida · cliente_no_encontrado · puntos_insuficientes (detail = saldo) · puntos_excede_maximo (detail = saldo)
create or replace function public.ajustar_puntos(p_cliente uuid, p_delta integer, p_motivo text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := auth.jwt() ->> 'email';
  v_actor   text;
  v_antes   integer;
  v_despues bigint;
begin
  if v_email is null or v_email not in ('jefe@stperfumeria.local', 'empleado@stperfumeria.local') then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  v_actor := case when v_email = 'jefe@stperfumeria.local' then 'jefe' else 'empleado' end;

  if p_cliente is null or p_delta is null or p_delta = 0 then
    raise exception 'cantidad_invalida' using errcode = '22023', detail = 'El ajuste tiene que ser un número entero distinto de 0.';
  end if;

  select c.puntos into v_antes from public.clientes c where c.id = p_cliente for update;   -- bloquea la fila
  if not found then
    raise exception 'cliente_no_encontrado' using errcode = 'P0002';
  end if;
  v_antes   := coalesce(v_antes, 0);
  v_despues := v_antes::bigint + p_delta;

  if v_despues < 0 then
    raise exception 'puntos_insuficientes' using errcode = '22023', detail = v_antes::text;
  end if;
  if v_despues > 2147483647 then
    raise exception 'puntos_excede_maximo' using errcode = '22003', detail = v_antes::text;
  end if;

  update public.clientes c
     set puntos     = v_despues::integer,
         compro     = coalesce(c.compro, false) or p_delta > 0,   -- como el «+1» de siempre: sumar marca «compró»
         puntos_log = public.puntos_json_antepone(c.puntos_log, jsonb_build_object(
                        'ts', to_jsonb(now()), 'delta', p_delta, 'before', v_antes, 'after', v_despues::integer,
                        'actor', v_actor, 'motivo', coalesce(p_motivo, '')))
   where c.id = p_cliente;

  insert into public.puntos_log (cliente_id, delta, saldo_antes, saldo_despues, origen, motivo, actor)
  values (p_cliente, p_delta, v_antes, v_despues::integer, 'manual', nullif(btrim(p_motivo), ''), v_actor);

  return v_despues::integer;
end;
$$;
revoke all on function public.ajustar_puntos(uuid, integer, text) from public, anon;
grant execute on function public.ajustar_puntos(uuid, integer, text) to authenticated;   -- la función misma exige jefe o empleado

-- ─── (4) sumar_puntos_por_compra: la pasarela ─────────────────────────
-- Devuelve jsonb: {aplicado: bool, motivo?, puntos?, saldo?, log_id?}. Sin pesos_por_punto no hace nada y lo dice.
create or replace function public.sumar_puntos_por_compra(p_pago_id text, p_cliente uuid, p_monto numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago    text := btrim(p_pago_id);
  v_pesos   integer;
  v_pts     bigint;
  v_antes   integer;
  v_despues bigint;
  v_log     bigint;
begin
  if v_pago is null or v_pago = '' or p_cliente is null or p_monto is null or p_monto <= 0 then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;

  select pc.pesos_por_punto into v_pesos from public.puntos_config pc order by pc.id limit 1;
  if v_pesos is null then
    return jsonb_build_object('aplicado', false, 'motivo', 'pesos_por_punto_sin_configurar');
  end if;

  v_pts := floor(p_monto / v_pesos)::bigint;   -- redondea para abajo
  if v_pts <= 0 then
    return jsonb_build_object('aplicado', false, 'motivo', 'monto_menor_a_un_punto');
  end if;
  if v_pts > 2147483647 then
    raise exception 'puntos_excede_maximo' using errcode = '22003';
  end if;

  select c.puntos into v_antes from public.clientes c where c.id = p_cliente for update;
  if not found then
    raise exception 'cliente_no_encontrado' using errcode = 'P0002';
  end if;
  v_antes   := coalesce(v_antes, 0);
  v_despues := v_antes::bigint + v_pts;
  if v_despues > 2147483647 then
    raise exception 'puntos_excede_maximo' using errcode = '22003', detail = v_antes::text;
  end if;

  insert into public.puntos_log (cliente_id, delta, saldo_antes, saldo_despues, origen, motivo, actor, pago_id)
  values (p_cliente, v_pts::integer, v_antes, v_despues::integer, 'compra', 'compra', 'pasarela', v_pago)
  on conflict (pago_id, origen) where pago_id is not null do nothing
  returning id into v_log;

  if v_log is null then   -- ese pago ya sumó
    return jsonb_build_object('aplicado', false, 'motivo', 'ya_sumado');
  end if;

  update public.clientes c
     set puntos     = v_despues::integer,
         compro     = true,
         puntos_log = public.puntos_json_antepone(c.puntos_log, jsonb_build_object(
                        'ts', to_jsonb(now()), 'delta', v_pts::integer, 'before', v_antes, 'after', v_despues::integer,
                        'actor', 'pasarela', 'motivo', 'compra'))
   where c.id = p_cliente;

  return jsonb_build_object('aplicado', true, 'puntos', v_pts::integer, 'saldo', v_despues::integer, 'log_id', v_log);
end;
$$;
revoke all on function public.sumar_puntos_por_compra(text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.sumar_puntos_por_compra(text, uuid, numeric) to service_role;

-- ─── (5) revertir_puntos_por_compra: la pasarela ──────────────────────
-- Resta exactamente lo que esa compra sumó. Si no hay compra con ese pago_id, no hace nada y lo dice. Si el cliente ya
-- no tiene esos puntos (los gastó), NO resta: levanta puntos_insuficientes (detail = saldo) y no cambia nada: la decisión
-- de qué hacer en ese caso es de Alejo. No mira pesos_por_punto: usa lo que quedó anotado.
create or replace function public.revertir_puntos_por_compra(p_pago_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago    text := btrim(p_pago_id);
  v_compra  public.puntos_log%rowtype;
  v_antes   integer;
  v_despues integer;
  v_log     bigint;
begin
  if v_pago is null or v_pago = '' then
    raise exception 'datos_invalidos' using errcode = '22023';
  end if;

  select * into v_compra from public.puntos_log pl where pl.pago_id = v_pago and pl.origen = 'compra';
  if not found then
    return jsonb_build_object('aplicado', false, 'motivo', 'compra_no_encontrada');
  end if;

  select c.puntos into v_antes from public.clientes c where c.id = v_compra.cliente_id for update;
  if not found then
    return jsonb_build_object('aplicado', false, 'motivo', 'cliente_no_encontrado');
  end if;
  v_antes   := coalesce(v_antes, 0);
  v_despues := v_antes - v_compra.delta;
  if v_despues < 0 then
    raise exception 'puntos_insuficientes' using errcode = '22023', detail = v_antes::text;
  end if;

  insert into public.puntos_log (cliente_id, delta, saldo_antes, saldo_despues, origen, motivo, actor, pago_id)
  values (v_compra.cliente_id, -v_compra.delta, v_antes, v_despues, 'devolucion', 'devolución', 'pasarela', v_pago)
  on conflict (pago_id, origen) where pago_id is not null do nothing
  returning id into v_log;

  if v_log is null then   -- esa devolución ya se hizo
    return jsonb_build_object('aplicado', false, 'motivo', 'ya_revertido');
  end if;

  update public.clientes c
     set puntos     = v_despues,
         puntos_log = public.puntos_json_antepone(c.puntos_log, jsonb_build_object(
                        'ts', to_jsonb(now()), 'delta', -v_compra.delta, 'before', v_antes, 'after', v_despues,
                        'actor', 'pasarela', 'motivo', 'devolución'))
   where c.id = v_compra.cliente_id;

  return jsonb_build_object('aplicado', true, 'puntos', -v_compra.delta, 'saldo', v_despues, 'log_id', v_log);
end;
$$;
revoke all on function public.revertir_puntos_por_compra(text) from public, anon, authenticated;
grant execute on function public.revertir_puntos_por_compra(text) to service_role;

commit;
