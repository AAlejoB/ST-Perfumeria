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
-- FASE 1 — Infraestructura y funciones.  NO toca ninguna policy.
--          Aplicar esto solo es seguro: el sitio sigue funcionando igual.
-- ════════════════════════════════════════════════════════════════════════

-- Todo FASE 1 en UNA transaccion: adentro hay tres `drop function` de
-- funciones que ya existen en produccion. Sin el begin/commit habria una
-- ventana (corta, pero real) en la que un cliente que intenta entrar recibe
-- "function does not exist". Si algo falla, no queda nada a medio aplicar.
begin;

create extension if not exists pgcrypto with schema extensions;


-- ── Rate limit server-side ──────────────────────────────────────────────
-- El lockout que ya existe vive en localStorage (app.js L335-394): no existe
-- para quien pega directo contra la REST. Esta tabla la tocan SOLO las
-- funciones SECURITY DEFINER de abajo; no lleva policies, así que con RLS
-- activa nadie la alcanza desde la API.
create table if not exists public.cliente_login_intentos (
  telefono        text primary key,
  intentos        integer     not null default 0,
  ultimo_intento  timestamptz not null default now(),
  bloqueado_hasta timestamptz
);
alter table public.cliente_login_intentos enable row level security;


-- ── Helper de hash ──────────────────────────────────────────────────────
-- Un solo lugar donde vive el costo. No se le da EXECUTE a nadie: sólo lo
-- llaman las funciones de abajo, que corren como el owner.
create or replace function public._cliente_hash(p_pass text)
returns text
language sql
volatile
security definer
set search_path = public, extensions
as $$
  select extensions.crypt(p_pass, extensions.gen_salt('bf', 10));
$$;
revoke all     on function public._cliente_hash(text) from public;
revoke execute on function public._cliente_hash(text) from anon, authenticated, service_role;
-- Supabase tiene ALTER DEFAULT PRIVILEGES que le da EXECUTE a esos tres roles
-- sobre toda funcion nueva de public. `revoke ... from public` NO los alcanza
-- porque el grant es directo al rol, no heredado de PUBLIC. Verificado en
-- produccion: antes de esta linea, proacl decia anon=X/postgres.


-- ── LOGIN ───────────────────────────────────────────────────────────────
-- Reemplaza app.js L448 (select con password) + L462 (activación).
--
-- Migración perezosa: si la contraseña guardada no empieza con $2 se compara
-- en plano y, si coincide, se reemplaza por el hash en el mismo login. El
-- cliente no se entera y no tiene que cambiar nada.
--
-- estado: 'ok' | 'activado' | 'invalido' | 'bloqueado'
--   'activado' es el caso de cuenta sin contraseña (creada desde admin o
--   reseteada): la primera clave que escribe el cliente queda fija. El front
--   lo necesita distinguir para mostrar "Cuenta activada" y avisar por Telegram.
-- ⚠️ DROP obligatorio: la version con `id bigint` en el retorno ya existe en
-- produccion (FASE 1 se corrio el 16-sep). `create or replace` no puede
-- cambiar el tipo de retorno: tira 42P13 "cannot change return type of
-- existing function". Va dentro del begin/commit de arriba, asi que el login
-- no queda caido ni un milisegundo.
drop function if exists public.cliente_login(text, text);

create or replace function public.cliente_login(p_telefono text, p_pass text)
returns table (estado text, id uuid, nombre text, telefono text, espera_seg integer)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_cli    public.clientes%rowtype;
  v_bloq   timestamptz;
  v_n      integer;
  v_ok     boolean := false;
  v_activo boolean := false;
  c_max    constant integer  := 5;
  c_espera constant interval := interval '15 minutes';
begin
  if p_telefono is null or p_pass is null or length(p_pass) < 4 then
    return query select 'invalido'::text, null::uuid, null::text, null::text, 0;
    return;
  end if;

  -- ¿está bloqueado por intentos fallidos?
  select li.bloqueado_hasta into v_bloq
    from public.cliente_login_intentos li where li.telefono = p_telefono;
  if v_bloq is not null and v_bloq > now() then
    return query select 'bloqueado'::text, null::uuid, null::text, null::text,
                        ceil(extract(epoch from (v_bloq - now())))::integer;
    return;
  end if;

  select * into v_cli from public.clientes where clientes.telefono = p_telefono;

  if found then
    if v_cli.bloqueado is true then
      -- [BLOQUEO] El panel tiene un boton "Bloquear" (admin.html L5013) que
      -- hasta ahora no bloqueaba nada: ni el login viejo ni el nuevo leian
      -- esta columna. Gastamos un hash igual para que el tiempo no delate el
      -- caso y dejamos v_ok en false: cae por la rama de fallo de abajo, asi
      -- que suma al contador de intentos y devuelve el mismo 'invalido' que
      -- una clave equivocada. Nadie puede distinguir bloqueado de inexistente.
      perform extensions.crypt(p_pass, extensions.gen_salt('bf', 10));
      v_ok := false;
    elsif v_cli.password is null or v_cli.password = '' then
      -- Sin clave fijada. Hay DOS formas de llegar aca y las dos cuentan:
      --   NULL  -> reset desde el panel (admin.html L3587)
      --   ''    -> alta manual desde el panel, que no manda password y toma
      --           el DEFAULT '' de la columna
      -- El JS viejo las trataba igual porque '' es falsy en JavaScript; en SQL
      -- hay que nombrarlas a las dos o el alta manual queda sin activarse.
      update public.clientes set password = public._cliente_hash(p_pass) where clientes.id = v_cli.id;
      v_ok := true; v_activo := true;
    elsif v_cli.password like '$2%' then
      v_ok := (extensions.crypt(p_pass, v_cli.password) = v_cli.password);
    else
      -- todavía en texto plano → comparar y migrar
      v_ok := (v_cli.password = p_pass);
      if v_ok then
        update public.clientes set password = public._cliente_hash(p_pass) where clientes.id = v_cli.id;
      end if;
    end if;
  else
    -- Teléfono inexistente: gastamos un hash igual. Sin esto la respuesta
    -- vuelve en 1 ms en vez de 73 y el tiempo delata qué números existen,
    -- que es justo lo que el mensaje unificado quiere esconder.
    perform extensions.crypt(p_pass, extensions.gen_salt('bf', 10));
  end if;

  if v_ok then
    delete from public.cliente_login_intentos where cliente_login_intentos.telefono = p_telefono;
    return query select case when v_activo then 'activado' else 'ok' end,
                        v_cli.id, v_cli.nombre, v_cli.telefono, 0;
  else
    -- ⚠️ `on conflict on constraint ...` y NO `on conflict (telefono)`. El
    -- inference clause no admite calificar con la tabla, y `telefono` es
    -- tambien un OUT param de esta funcion: Postgres tira "column reference
    -- telefono is ambiguous" EN TIEMPO DE EJECUCION, no al crear la funcion.
    -- Como esta es la rama del login FALLIDO, un test de "entro bien" no lo
    -- encuentra nunca: cada intento con clave equivocada devolvia un error
    -- del servidor en vez de 'invalido', y el rate-limit no contaba nada.
    -- Nombre del constraint verificado contra produccion (pg_constraint).
    insert into public.cliente_login_intentos as li (telefono, intentos, ultimo_intento)
    values (p_telefono, 1, now())
    on conflict on constraint cliente_login_intentos_pkey do update
      set intentos        = li.intentos + 1,
          ultimo_intento  = now(),
          bloqueado_hasta = case when li.intentos + 1 >= c_max then now() + c_espera end
    returning li.intentos into v_n;

    if v_n >= c_max then
      return query select 'bloqueado'::text, null::uuid, null::text, null::text,
                          ceil(extract(epoch from c_espera))::integer;
    else
      return query select 'invalido'::text, null::uuid, null::text, null::text, 0;
    end if;
  end if;
end;
$$;


-- ── REGISTRO ────────────────────────────────────────────────────────────
-- Reemplaza app.js L493 (chequeo de duplicado) + L499 (insert). Los junta en
-- una sola llamada. Guarda hasheado desde el primer segundo.
-- estado: 'ok' | 'duplicado' | 'invalido'
-- ⚠️ Mismo motivo que cliente_login: cambia el tipo de retorno (id bigint -> uuid).
drop function if exists public.cliente_registrar(text, text, text);

create or replace function public.cliente_registrar(p_nombre text, p_telefono text, p_pass text)
returns table (estado text, id uuid, nombre text, telefono text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if p_nombre is null or length(trim(p_nombre)) < 2
     or p_telefono is null or length(p_telefono) < 8
     or p_pass is null or length(p_pass) < 4 then
    return query select 'invalido'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if exists (select 1 from public.clientes where clientes.telefono = p_telefono) then
    return query select 'duplicado'::text, null::uuid, null::text, null::text;
    return;
  end if;

  insert into public.clientes (nombre, telefono, password)
  values (trim(p_nombre), p_telefono, public._cliente_hash(p_pass))
  returning clientes.id into v_id;

  return query select 'ok'::text, v_id, trim(p_nombre), p_telefono;
exception
  when unique_violation then
    return query select 'duplicado'::text, null::uuid, null::text, null::text;
end;
$$;


-- ── EDITAR PERFIL ───────────────────────────────────────────────────────
-- Reemplaza app.js L554 (leer password para verificar) + L564 (update).
-- Ojo: hoy el update de L564 corre como anon y NO pide contraseña, así que
-- cualquiera con la anon key podía cambiarle nombre y teléfono a cualquiera
-- sabiendo el id. Acá la verificación es obligatoria.
-- estado: 'ok' | 'pass_incorrecta' | 'duplicado' | 'invalido'
-- ⚠️ Aca cambia un PARAMETRO, no el retorno: sin este drop Postgres no falla,
-- crea una SEGUNDA funcion y quedan las dos. La llamada desde el JS manda el
-- id como string JSON y no resuelve contra ninguna de forma confiable.
drop function if exists public.cliente_editar(bigint, text, text, text);

create or replace function public.cliente_editar(
  p_id uuid, p_pass text, p_nombre text, p_telefono text)
returns table (estado text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_cli public.clientes%rowtype;
  v_ok  boolean := false;
begin
  if p_id is null or p_pass is null
     or p_nombre is null or length(trim(p_nombre)) < 2
     or p_telefono is null or length(p_telefono) < 8 then
    return query select 'invalido'::text; return;
  end if;

  select * into v_cli from public.clientes where clientes.id = p_id;
  if not found then
    return query select 'pass_incorrecta'::text; return;
  end if;

  if v_cli.password is null or v_cli.password = '' then
    -- Cuenta sin clave fijada (reset o alta manual): no hay nada contra que
    -- verificar. Tiene que entrar primero por el login, que se la fija.
    v_ok := false;
  elsif v_cli.password like '$2%' then
    v_ok := (extensions.crypt(p_pass, v_cli.password) = v_cli.password);
  else
    v_ok := (v_cli.password = p_pass);
    if v_ok then
      update public.clientes set password = public._cliente_hash(p_pass) where clientes.id = p_id;
    end if;
  end if;

  if not v_ok then
    return query select 'pass_incorrecta'::text; return;
  end if;

  if p_telefono <> v_cli.telefono
     and exists (select 1 from public.clientes where clientes.telefono = p_telefono) then
    return query select 'duplicado'::text; return;
  end if;

  update public.clientes
     set nombre = trim(p_nombre), telefono = p_telefono
   where clientes.id = p_id;

  return query select 'ok'::text;
end;
$$;


-- ── PUNTOS ──────────────────────────────────────────────────────────────
-- Reemplaza app.js L7013. Queda con la MISMA exposición que hoy: con un
-- teléfono se obtiene nombre y puntos, sin prueba de identidad.
-- No es una regresión, pero tampoco una mejora: hoy no hay sesión del lado
-- del servidor (el "login" es localStorage y a propósito no guarda la
-- contraseña), así que lo único con lo que se podría autenticar es pedirla de
-- nuevo en cada llamada. Eso se resuelve de verdad en el escalón 3
-- (Supabase Auth). Queda anotado como deuda, no como olvido.
create or replace function public.cliente_puntos(p_telefono text)
returns table (puntos integer, nombre text)   -- clientes.puntos es INTEGER, no numeric
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.puntos, c.nombre
    from public.clientes c
   where c.telefono = p_telefono
   limit 1;
$$;


-- ── PEDIDO DE RESET ─────────────────────────────────────────────────────
-- Reemplaza app.js L306 (buscar cliente) + el insert en
-- password_reset_requests. Los junta para que anon no necesite leer clientes.
-- Devuelve el nombre sólo para que el front arme el mensaje de Telegram, que
-- es lo que ya hace hoy.
create or replace function public.cliente_reset_solicitar(p_telefono text)
returns table (nombre text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_id     uuid;
  v_nombre text;
begin
  if p_telefono is null or length(p_telefono) < 8 then
    return;
  end if;

  select c.id, c.nombre into v_id, v_nombre
    from public.clientes c where c.telefono = p_telefono limit 1;

  insert into public.password_reset_requests (telefono, cliente_id)
  values (p_telefono, v_id);

  if v_id is not null then
    return query select v_nombre;
  end if;
end;
$$;


-- ── Permisos de las funciones ───────────────────────────────────────────
-- Se revoca de public y se concede explícitamente. anon las necesita porque
-- el sitio público no tiene sesión; authenticated también, porque el jefe
-- puede estar logueado en el panel y navegar el catálogo en la misma pestaña.
revoke all on function public.cliente_login(text, text)                      from public;
revoke all on function public.cliente_registrar(text, text, text)            from public;
revoke all on function public.cliente_editar(uuid, text, text, text)       from public;
revoke all on function public.cliente_puntos(text)                           from public;
revoke all on function public.cliente_reset_solicitar(text)                  from public;

grant execute on function public.cliente_login(text, text)                   to anon, authenticated;
grant execute on function public.cliente_registrar(text, text, text)         to anon, authenticated;
grant execute on function public.cliente_editar(uuid, text, text, text)    to anon, authenticated;
grant execute on function public.cliente_puntos(text)                        to anon, authenticated;
grant execute on function public.cliente_reset_solicitar(text)               to anon, authenticated;

commit;
-- ── fin de FASE 1 ───────────────────────────────────────────────────────


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
