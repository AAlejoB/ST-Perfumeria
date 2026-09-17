-- ════════════════════════════════════════════════════════════════════════
-- S2 · [BCRYPT-MIGRATION] — contraseñas de clientes fuera del alcance de anon
--
-- Medido en producción el 16-sep-2026 antes de escribir esto:
--   · 96 clientes · 4 con password NULL · 0 hasheadas · largo mínimo 4
--   · 19 contraseñas de menos de 6 caracteres
--   · pgcrypto YA instalada, en el schema `extensions`
--   · clientes tiene 4 policies, TODAS para el rol `public` (no `anon`):
--       "Leer clientes" SELECT · "Registrar cliente" INSERT
--       "Allow anon update" UPDATE · "Allow anon delete" DELETE  ← ojo
--
-- CINCO HALLAZGOS QUE CAMBIAN EL PLAN ORIGINAL:
--
--  1. Existe una policy de DELETE abierta. Cualquiera con la anon key podía
--     borrar clientes. No estaba en el relevamiento porque el front no borra.
--
--  2. Las policies son para `public`, que en Postgres INCLUYE a
--     `authenticated`. O sea que el panel de admin funciona gracias a ellas y
--     no tiene policies propias. Cerrarlas sin crear antes las de
--     `authenticated` deja el panel sin lista de clientes, sin carga de
--     puntos, sin reset y sin el botón "Eliminar definitivamente"
--     (admin.html L5045, deleteClient). Por eso la FASE 3 crea las cuatro
--     policies de authenticated ANTES de borrar las viejas.
--
--  3. clientes.password tiene DEFAULT '' (string vacio), no NULL. El alta
--     manual del panel no manda password, asi que esos clientes quedan con ''.
--     El JS viejo los activaba igual porque '' es falsy en JavaScript; una
--     funcion SQL que solo mire IS NULL los deja sin poder entrar nunca.
--     Hoy hay 0 en ese estado, pero el proximo alta manual lo produce.
--
--  4. clientes.bloqueado existe y el panel tiene un boton "Bloquear" que lo
--     setea... y nunca bloqueo nada: el login jamas leyo esa columna. Se
--     arregla aca. Hoy hay 0 bloqueados, asi que no deja a nadie afuera.
--     clientes.puntos ademas es INTEGER, no numeric(8,2) como decia el doc.
--
--  5. clientes.id es UUID (default gen_random_uuid()), no bigint.
--     password_reset_requests.cliente_id tambien. docs/DATABASE.md decia
--     bigint y estaba mal — igual que con puntos. Confirmado el 16-sep contra
--     information_schema.columns, no contra el doc.
--     Consecuencia: la FASE 1 que ya corrio dejo TRES funciones rotas en la
--     base (cliente_login en el retorno exitoso, cliente_registrar y
--     cliente_reset_solicitar en el `into v_id`). No hubo caida porque el JS
--     nuevo todavia no esta desplegado: origin/main sigue leyendo la tabla
--     directo. Esta version las reemplaza con los drops que hacen falta.
--
-- COSTO DE BCRYPT — medido en esta instancia, no asumido:
--     gen_salt('bf')  → $2a$06$ ·   5 ms   ← el default de pgcrypto es cost 6
--     gen_salt('bf',8)          →  18 ms
--     gen_salt('bf',10)         →  73 ms   ← el que usamos
--     gen_salt('bf',12)         → 291 ms
--   Con cost 6 y contraseñas de 4 dígitos, un ataque de fuerza bruta las saca
--   en ~50 segundos. Con cost 10, en ~12 minutos — por eso el rate-limit de
--   abajo NO es opcional.
--
-- ORDEN DE APLICACIÓN: FASE 1 ahora, FASE 3 recién después de desplegar el JS.
-- Entre medio conviven el JS viejo (lee la tabla) y el nuevo (llama RPC), así
-- que no hay ventana en la que un cliente quede afuera.
--
-- Todo es idempotente: se puede correr dos veces sin romper nada.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- FASE 3 — Cerrar la puerta.
--
-- ⚠️ NO correr esto hasta que el JS nuevo esté desplegado y el SW bumpeado.
--    Un cliente con el JS viejo cacheado deja de poder entrar en el momento
--    en que esto se aplica.
--
-- El orden importa: primero se crean las policies de `authenticated` y recién
-- después se borran las de `public`. Al revés, el panel de admin queda sin
-- acceso a clientes durante el intervalo.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 3.a — Panel de admin (rol authenticated). Replica exactamente lo que hace
--       hoy: listar, alta manual, sumar puntos, resetear, y el botón
--       "Eliminar definitivamente" de admin.html L5045.
drop policy if exists "clientes_select_auth" on public.clientes;
drop policy if exists "clientes_insert_auth" on public.clientes;
drop policy if exists "clientes_update_auth" on public.clientes;
drop policy if exists "clientes_delete_auth" on public.clientes;

create policy "clientes_select_auth" on public.clientes
  for select to authenticated using (true);
create policy "clientes_insert_auth" on public.clientes
  for insert to authenticated with check (true);
create policy "clientes_update_auth" on public.clientes
  for update to authenticated using (true) with check (true);
create policy "clientes_delete_auth" on public.clientes
  for delete to authenticated using (true);

-- 3.b — Recién ahora: sacar el acceso directo de anon.
drop policy if exists "Leer clientes"     on public.clientes;
drop policy if exists "Registrar cliente" on public.clientes;
drop policy if exists "Allow anon update" on public.clientes;
drop policy if exists "Allow anon delete" on public.clientes;

commit;
-- ── fin de FASE 3 ───────────────────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════
-- ⚠️ TERMINA FASE 3.  Desde aca, anon ya no puede leer la tabla clientes.
--    Si algun cliente quedo con el JS viejo cacheado, deja de poder entrar
--    hasta que el service worker le entregue el nuevo. Por eso el bump del
--    SW no es opcional.
-- ════════════════════════════════════════════════════════════════════════



-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — descomentar y correr entero si hay que volver atrás.
-- Deja la base exactamente como estaba antes de este archivo.
-- (Las contraseñas ya hasheadas NO se pueden revertir a texto plano, pero el
--  login viejo de app.js compara con `!==`, así que un cliente ya migrado no
--  podría entrar con el JS viejo. Si se hace rollback DESPUÉS de que algunos
--  clientes migraron, hay que volver también el JS — ver el plan de fases.)
-- ════════════════════════════════════════════════════════════════════════
/*
create policy "Leer clientes"     on public.clientes for select using (true);
create policy "Registrar cliente" on public.clientes for insert with check (true);
create policy "Allow anon update" on public.clientes for update using (true) with check (true);
create policy "Allow anon delete" on public.clientes for delete using (true);

drop policy if exists "clientes_select_auth" on public.clientes;
drop policy if exists "clientes_insert_auth" on public.clientes;
drop policy if exists "clientes_update_auth" on public.clientes;
drop policy if exists "clientes_delete_auth" on public.clientes;

drop function if exists public.cliente_login(text, text);
drop function if exists public.cliente_registrar(text, text, text);
drop function if exists public.cliente_editar(uuid, text, text, text);
drop function if exists public.cliente_editar(bigint, text, text, text);  -- por si quedo la vieja
drop function if exists public.cliente_puntos(text);
drop function if exists public.cliente_reset_solicitar(text);
drop function if exists public._cliente_hash(text);
drop table if exists public.cliente_login_intentos;
*/
