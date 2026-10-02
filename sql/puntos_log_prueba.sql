-- ═══════════════════════════════════════════════════════════════════════
-- [PUNTOS-LOG] plan de prueba · correr DESPUÉS de aplicar sql/puntos_log.sql
-- Todo en UN SOLO pedido y deshecho al final: el bloque DO termina con un `raise exception` que devuelve el
-- informe y revierte TODO (el cliente de prueba, los cambios de la regla y la función temporal): no queda nada
-- en la base. Se pega entero en el SQL Editor (o en execute_sql). El informe sale en el texto del error
-- «RESULTADOS (se deshace todo)».
--
-- pg_temp.t(rol, email, sql): ejecuta `sql` con el rol de la base (anon / authenticated / service_role) y el email
-- del JWT que se indique, y devuelve «OK <resultado>» o «ERROR <mensaje> (detail <detalle>)». Corre siempre como
-- dueño y cambia de rol sólo para el `execute`, así que nunca queda un rol puesto.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function pg_temp.t(p_rol text, p_email text, p_sql text) returns text
language plpgsql as $f$
declare v text; d text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', p_rol, 'email', p_email)::text, true);
  execute 'set local role ' || quote_ident(p_rol);
  execute p_sql into v;
  execute 'reset role';
  return 'OK ' || coalesce(v, 'null');
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return 'ERROR ' || sqlerrm || coalesce(' (detail ' || d || ')', '');
end
$f$;

do $prueba$
declare
  v_c   uuid;
  v_n   bigint;
  v_res text := '';
  e     constant text := 'empleado@stperfumeria.local';
  j     constant text := 'jefe@stperfumeria.local';
begin
  insert into public.clientes (nombre, telefono) values ('PRUEBA ROLLBACK', '5490000000001') returning id into v_c;
  v_res := v_res || E'\n# cliente de prueba con puntos = ' || (select puntos from public.clientes where id = v_c);

  -- ── 1 · ajustar_puntos como EMPLEADO ──
  v_res := v_res || E'\n[empleado] +5                 -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, 5, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] -5                 -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, -5, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] 0                  -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, 0, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] 0,5 (llega 0.5)    -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, %L, %L)', v_c, '0.5', 'prueba'));
  v_res := v_res || E'\n[empleado] -1 con saldo 0     -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, -1, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] +12                -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, 12, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] -13 (tiene 12)      -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, -13, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] -12 (queda en 0)    -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, -12, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] +12 otra vez        -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, 12, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] +2147483647 (tiene 12) -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, 2147483647, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[empleado] cliente inexistente -> ' || pg_temp.t('authenticated', e, format('select public.ajustar_puntos(%L::uuid, 1, %L)', '00000000-0000-0000-0000-000000000000', 'prueba'));

  -- ── 2 · JEFE, una cuenta que NO es del panel, y anon ──
  v_res := v_res || E'\n[jefe]     +1                 -> ' || pg_temp.t('authenticated', j, format('select public.ajustar_puntos(%L::uuid, 1, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[otra cuenta] +1               -> ' || pg_temp.t('authenticated', 'alguien@gmail.com', format('select public.ajustar_puntos(%L::uuid, 1, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[anon]     ajustar_puntos     -> ' || pg_temp.t('anon', null, format('select public.ajustar_puntos(%L::uuid, 1, %L)', v_c, 'prueba'));
  v_res := v_res || E'\n[anon]     sumar_por_compra   -> ' || pg_temp.t('anon', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 5000)', 'pago-anon', v_c));
  v_res := v_res || E'\n[anon]     revertir           -> ' || pg_temp.t('anon', null, format('select public.revertir_puntos_por_compra(%L)', 'pago-anon'));
  v_res := v_res || E'\n[anon]     leer puntos_log    -> ' || pg_temp.t('anon', null, 'select count(*)::text from public.puntos_log');
  v_res := v_res || E'\n[anon]     leer puntos_config -> ' || pg_temp.t('anon', null, 'select count(*)::text from public.puntos_config');

  -- ── 3 · AUTHENTICATED (empleado y jefe): las de la pasarela, escribir directo, la regla ──
  v_res := v_res || E'\n[empleado] sumar_por_compra   -> ' || pg_temp.t('authenticated', e, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 5000)', 'pago-emp', v_c));
  v_res := v_res || E'\n[empleado] revertir           -> ' || pg_temp.t('authenticated', e, format('select public.revertir_puntos_por_compra(%L)', 'pago-emp'));
  v_res := v_res || E'\n[jefe]     sumar_por_compra   -> ' || pg_temp.t('authenticated', j, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 5000)', 'pago-jefe', v_c));
  v_res := v_res || E'\n[empleado] leer puntos_log    -> ' || pg_temp.t('authenticated', e, 'select count(*)::text from public.puntos_log');
  v_res := v_res || E'\n[empleado] insert directo     -> ' || pg_temp.t('authenticated', e, format('insert into public.puntos_log (cliente_id, delta, saldo_antes, saldo_despues, origen) values (%L::uuid, 1, 0, 1, %L) returning id::text', v_c, 'manual'));
  v_res := v_res || E'\n[empleado] update directo     -> ' || pg_temp.t('authenticated', e, 'with u as (update public.puntos_log set delta = delta returning 1) select count(*)::text from u');
  v_res := v_res || E'\n[empleado] delete directo     -> ' || pg_temp.t('authenticated', e, 'with d as (delete from public.puntos_log returning 1) select count(*)::text from d');
  v_res := v_res || E'\n[empleado] puntos_config update (0 = lo frena la RLS) -> ' || pg_temp.t('authenticated', e, 'with u as (update public.puntos_config set mensaje_promo = mensaje_promo returning 1) select count(*)::text from u');
  v_res := v_res || E'\n[jefe]     puntos_config update (1 fila)  -> ' || pg_temp.t('authenticated', j, 'with u as (update public.puntos_config set mensaje_promo = mensaje_promo returning 1) select count(*)::text from u');
  v_res := v_res || E'\n[jefe]     puntos_config delete          -> ' || pg_temp.t('authenticated', j, 'with d as (delete from public.puntos_config returning 1) select count(*)::text from d');

  -- ── 4 · la pasarela (service_role): sin regla, con regla, repetido, devolución ──
  v_res := v_res || E'\n[service] pesos_por_punto nulo        -> ' || pg_temp.t('service_role', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 5000)', 'pago-1', v_c));
  update public.puntos_config set pesos_por_punto = 1000 where id = 1;   -- como dueño; se deshace
  v_res := v_res || E'\n[service] pesos = 1000, monto 2500  -> ' || pg_temp.t('service_role', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 2500)', 'pago-1', v_c));
  v_res := v_res || E'\n[service] MISMO pago_id otra vez    -> ' || pg_temp.t('service_role', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 2500)', 'pago-1', v_c));
  v_res := v_res || E'\n[service] monto 500 (< 1 punto)     -> ' || pg_temp.t('service_role', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 500)', 'pago-2', v_c));
  v_res := v_res || E'\n[service] monto 0                   -> ' || pg_temp.t('service_role', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 0)', 'pago-3', v_c));
  v_res := v_res || E'\n[service] cliente inexistente      -> ' || pg_temp.t('service_role', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 5000)', 'pago-4', '00000000-0000-0000-0000-000000000000'));
  v_res := v_res || E'\n[service] revertir pago-1          -> ' || pg_temp.t('service_role', null, format('select public.revertir_puntos_por_compra(%L)', 'pago-1'));
  v_res := v_res || E'\n[service] revertir pago-1 otra vez -> ' || pg_temp.t('service_role', null, format('select public.revertir_puntos_por_compra(%L)', 'pago-1'));
  v_res := v_res || E'\n[service] revertir uno que no existe -> ' || pg_temp.t('service_role', null, format('select public.revertir_puntos_por_compra(%L)', 'pago-no-existe'));

  -- ── 5 · si el cliente ya gastó los puntos, la devolución NO resta ──
  v_res := v_res || E'\n[service] compra pago-5 (3000 = 3 pts) -> ' || pg_temp.t('service_role', null, format('select public.sumar_puntos_por_compra(%L, %L::uuid, 3000)', 'pago-5', v_c));
  update public.clientes set puntos = 0 where id = v_c;   -- como dueño: «los gastó»; se deshace
  v_res := v_res || E'\n[service] revertir pago-5 con saldo 0  -> ' || pg_temp.t('service_role', null, format('select public.revertir_puntos_por_compra(%L)', 'pago-5'));

  -- ── 6 · lo que quedó ──
  select count(*) into v_n from public.puntos_log where cliente_id = v_c;
  v_res := v_res || E'\n# renglones de puntos_log del cliente de prueba: ' || v_n;
  select count(*) into v_n from public.puntos_log where cliente_id = v_c and saldo_despues <> saldo_antes + delta;
  v_res := v_res || E'\n# renglones con la cuenta mal (tiene que ser 0): ' || v_n;
  v_res := v_res || E'\n# historial (origen delta antes→después actor pago_id): ' || coalesce((select string_agg(origen || ' ' || delta || ' ' || saldo_antes || '→' || saldo_despues || ' ' || coalesce(actor, '-') || ' ' || coalesce(pago_id, '-'), ' | ' order by id) from public.puntos_log where cliente_id = v_c), '(vacío)');
  v_res := v_res || E'\n# clientes.puntos_log (JSONB, máx. 5): ' || (select jsonb_array_length(puntos_log) from public.clientes where id = v_c);
  v_res := v_res || E'\n# resumen_dia() sigue andando, puntos de hoy: ' || (select jsonb_array_length(public.resumen_dia() -> 'puntos'));

  raise exception E'RESULTADOS (se deshace todo):%', v_res;
end
$prueba$;
