-- ════════════════════════════════════════════════════════════════════════
-- S14 · [TELEGRAM-ANON-ABIERTO] — los avisos del sitio público pasan al
--       servidor y `anon` deja de poder hacer hablar al bot.
--
-- EL PROBLEMA
--   has_function_privilege('anon','public.send_telegram(text)','execute') → true
--   La función es SECURITY DEFINER, acepta TEXTO LIBRE y la anon key es
--   pública (está en app.js, por diseño). Cualquiera podía hacer
--   POST /rest/v1/rpc/send_telegram {"msg":"…"} y el bot lo entregaba en el
--   chat del jefe. Rotar el token NO cerraba esto: la puerta era el permiso,
--   no la credencial.
--
--   El riesgo concreto no era que robaran algo: era que le mintieran a Alejo
--   por el único canal donde confía. Un "🔓 Contraseña reseteada" falso es
--   indistinguible de uno real.
--
-- LA SALIDA
--   Los 5 avisos que hoy manda el navegador los manda el servidor, desde
--   adentro de las RPC que ya saben que el evento pasó. El texto lo arma
--   Postgres, no el cliente. Después se le revoca el EXECUTE a `anon`.
--
-- DECISIÓN (a): se revoca SÓLO a `anon`. `authenticated` lo conserva.
--   `authenticated` son el jefe y las empleadas — cuentas reales que pasaron
--   por Supabase Auth. Romper los 31 avisos del panel para cerrar un vector
--   que exige estar logueado es mal negocio. La opción (b) — una RPC
--   `admin_notificar()` con `is_admin_authenticated()` — se puede hacer
--   después SIN rehacer nada de este archivo.
--
-- NO SE TOCA EL CUERPO DE send_telegram. El token vive ahí y no se reescribe:
-- sólo se le agrega el search_path con `alter function`.
--
-- NO HACEN FALTA `drop function`: ninguna de las tres funciones cambia su
-- firma ni su tipo de retorno, así que `create or replace` alcanza. (En S2
-- hicieron falta porque `id` pasaba de bigint a uuid.)
--
-- Idempotente: se puede correr dos veces sin romper nada.
-- ════════════════════════════════════════════════════════════════════════

begin;


-- ════════════════════════════════════════════════════════════════════════
-- 1 · HELPER — avisar sin poder romper nunca la operación
-- ════════════════════════════════════════════════════════════════════════
-- ⚠️ Esto es lo más importante del archivo. `send_telegram` usa pg_net para
-- pegarle a la API de Telegram. Si esa llamada tira una excepción DENTRO de
-- cliente_login, la transacción entera se va para atrás — incluida la
-- migración de la contraseña a bcrypt. O sea: un aviso caído dejaría a un
-- cliente sin poder entrar.
--
-- Un aviso es best-effort por definición. El bloque `exception when others`
-- lo garantiza: si Telegram falla, se traga el error y la operación sigue.
-- Es exactamente lo que hace hoy el front con su try/catch.
--
-- Mismo patrón de permisos que _cliente_hash: no lo ejecuta nadie de afuera.
create or replace function public._aviso_tg(p_msg text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  perform public.send_telegram(p_msg);
exception when others then
  -- a propósito en silencio: un aviso no puede tumbar un login
  null;
end;
$$;

revoke all     on function public._aviso_tg(text) from public;
revoke execute on function public._aviso_tg(text) from anon, authenticated, service_role;
-- Los default privileges de Supabase le dan EXECUTE a esos tres roles sobre
-- toda función nueva de public, y `revoke ... from public` NO los alcanza
-- porque el grant es directo al rol. Por eso el revoke explícito.


-- ════════════════════════════════════════════════════════════════════════
-- 2 · LOGIN — dos avisos: "primer ingreso" y "bloqueado"
-- ════════════════════════════════════════════════════════════════════════
-- Reemplaza dos notifyTG del front:
--   app.js L483 · 🔓 Primer ingreso   → la rama `activado`
--   app.js L404 · 🚨 Login BLOQUEADO  → ver la nota de abajo
--
-- ⚠️ El aviso de bloqueo CAMBIA DE SIGNIFICADO, a propósito.
--   El del front contaba fallos en localStorage (`st_auth_lockout`): por
--   navegador, y se borra vaciando el storage. Como señal de seguridad no
--   valía nada — el que te ataca no tiene tu navegador.
--   Éste cuenta del lado del servidor, por teléfono, y no se puede evadir.
--
-- ⚠️ Y se manda SÓLO cuando el bloqueo se cruza, no en cada intento
--   posterior. `cliente_login` devuelve 'bloqueado' también por el early
--   return de arriba mientras el bloqueo sigue vivo; si avisáramos ahí,
--   cualquiera podría generar Telegrams infinitos con sólo seguir probando.
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

  select li.bloqueado_hasta into v_bloq
    from public.cliente_login_intentos li where li.telefono = p_telefono;
  if v_bloq is not null and v_bloq > now() then
    -- Ya estaba bloqueado: NO se avisa de nuevo (ver la nota de arriba).
    return query select 'bloqueado'::text, null::uuid, null::text, null::text,
                        ceil(extract(epoch from (v_bloq - now())))::integer;
    return;
  end if;

  select * into v_cli from public.clientes where clientes.telefono = p_telefono;

  if found then
    if v_cli.bloqueado is true then
      perform extensions.crypt(p_pass, extensions.gen_salt('bf', 10));
      v_ok := false;
    elsif v_cli.password is null or v_cli.password = '' then
      update public.clientes set password = public._cliente_hash(p_pass) where clientes.id = v_cli.id;
      v_ok := true; v_activo := true;
    elsif v_cli.password like '$2%' then
      v_ok := (extensions.crypt(p_pass, v_cli.password) = v_cli.password);
    else
      v_ok := (v_cli.password = p_pass);
      if v_ok then
        update public.clientes set password = public._cliente_hash(p_pass) where clientes.id = v_cli.id;
      end if;
    end if;
  else
    perform extensions.crypt(p_pass, extensions.gen_salt('bf', 10));
  end if;

  if v_ok then
    delete from public.cliente_login_intentos where cliente_login_intentos.telefono = p_telefono;

    -- [S14] antes lo mandaba app.js L483
    if v_activo then
      perform public._aviso_tg('🔓 Primer ingreso' || chr(10) ||
                               '👤 ' || v_cli.nombre || ' (' || v_cli.telefono || ')');
    end if;

    return query select case when v_activo then 'activado' else 'ok' end,
                        v_cli.id, v_cli.nombre, v_cli.telefono, 0;
  else
    insert into public.cliente_login_intentos as li (telefono, intentos, ultimo_intento)
    values (p_telefono, 1, now())
    on conflict on constraint cliente_login_intentos_pkey do update
      set intentos        = li.intentos + 1,
          ultimo_intento  = now(),
          bloqueado_hasta = case when li.intentos + 1 >= c_max then now() + c_espera end
    returning li.intentos into v_n;

    if v_n >= c_max then
      -- [S14] reemplaza app.js L404. Sólo en el cruce del umbral.
      -- El teléfono va enmascarado: este aviso puede dispararlo cualquiera
      -- probando números, así que no conviene que sirva para confirmar
      -- cuáles existen.
      perform public._aviso_tg('🚨 Login de cliente BLOQUEADO 15 min' || chr(10) ||
                               '📞 …' || right(p_telefono, 4) || chr(10) ||
                               '🔢 ' || v_n || ' intentos fallidos');
      return query select 'bloqueado'::text, null::uuid, null::text, null::text,
                          ceil(extract(epoch from c_espera))::integer;
    else
      return query select 'invalido'::text, null::uuid, null::text, null::text, 0;
    end if;
  end if;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 3 · EDITAR PERFIL — aviso con el antes y el después
-- ════════════════════════════════════════════════════════════════════════
-- Reemplaza app.js L593. El front armaba la lista de cambios y sólo avisaba
-- si había alguno; acá se hace igual, con v_cli (valores viejos) contra los
-- parámetros (nuevos).
create or replace function public.cliente_editar(
  p_id uuid, p_pass text, p_nombre text, p_telefono text)
returns table (estado text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_cli     public.clientes%rowtype;
  v_ok      boolean := false;
  v_nombre  text;
  v_cambios text := '';
begin
  if p_id is null or p_pass is null
     or p_nombre is null or length(trim(p_nombre)) < 2
     or p_telefono is null or length(p_telefono) < 8 then
    return query select 'invalido'::text; return;
  end if;

  v_nombre := trim(p_nombre);

  select * into v_cli from public.clientes where clientes.id = p_id;
  if not found then
    return query select 'pass_incorrecta'::text; return;
  end if;

  if v_cli.password is null or v_cli.password = '' then
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
     set nombre = v_nombre, telefono = p_telefono
   where clientes.id = p_id;

  -- [S14] antes lo mandaba app.js L593
  if v_cli.nombre <> v_nombre then
    v_cambios := v_cambios || chr(10) || 'Nombre: ' || v_cli.nombre || ' → ' || v_nombre;
  end if;
  if v_cli.telefono <> p_telefono then
    v_cambios := v_cambios || chr(10) || 'Tel: ' || v_cli.telefono || ' → ' || p_telefono;
  end if;
  if v_cambios <> '' then
    perform public._aviso_tg('✏️ Perfil editado' || chr(10) ||
                             '👤 ' || v_nombre || v_cambios || chr(10) ||
                             '📲 https://wa.me/' || p_telefono);
  end if;

  return query select 'ok'::text;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 4 · PEDIDO DE RESET — el aviso que abre la pestaña "Pedidos pass"
-- ════════════════════════════════════════════════════════════════════════
-- Reemplaza app.js L312. Se manda SÓLO si el teléfono existe, igual que hoy
-- (el front chequeaba `if (cliNombre)`), y por la misma razón: la fila del
-- pedido se inserta siempre — exista o no — para que el cliente vea siempre
-- la misma confirmación y nadie pueda averiguar qué números están
-- registrados probando.
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
    -- [S14] antes lo mandaba app.js L312
    perform public._aviso_tg('🔐 Pedido de RESET de contraseña' || chr(10) ||
                             '👤 ' || v_nombre || chr(10) ||
                             '📞 ' || p_telefono || chr(10) ||
                             '📲 https://wa.me/' || p_telefono || chr(10) || chr(10) ||
                             '➡️ Resolvé en Admin → 🔑 Pedidos pass');
    return query select v_nombre;
  end if;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 5 · LISTA DE ESPERA — trigger, no RPC
-- ════════════════════════════════════════════════════════════════════════
-- Reemplaza app.js L4350.
--
-- POR QUÉ TRIGGER Y NO UNA RPC `lista_espera_anotar`:
--   La fila que el front inserta YA trae todo lo que el mensaje necesita
--   (slug, telefono, nombre, perfume_name). O sea que el aviso se puede
--   armar desde la fila, sin cambiar el insert. Una RPC obligaría a tocar
--   también el camino de escritura de una tabla que `[S13-ESCRITURAS-ANON]`
--   va a rediseñar igual más adelante: sería hacer dos veces el mismo
--   trabajo, con dos criterios distintos.
--   Además el trigger cubre a cualquier futuro insertador, no sólo al front.
--
-- ⚠️ Contrapartida: dispara en TODO insert. Si algún día se hace una carga
--   masiva en esta tabla, sale un Telegram por fila. Hoy sólo inserta el
--   front, de a uno. Anotado, no resuelto.
create or replace function public.lista_espera_aviso()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._aviso_tg('🔔 Lista de espera' || chr(10) ||
                           '🧴 ' || coalesce(new.perfume_name, new.slug) || chr(10) ||
                           '📱 ' || new.telefono ||
                           case when coalesce(new.nombre, '') <> ''
                                then chr(10) || '👤 ' || new.nombre
                                else '' end);
  return null;  -- AFTER trigger: el valor de retorno se ignora
end;
$$;

revoke all     on function public.lista_espera_aviso() from public;
revoke execute on function public.lista_espera_aviso() from anon, authenticated, service_role;

drop trigger if exists trg_lista_espera_aviso on public.lista_espera;
create trigger trg_lista_espera_aviso
  after insert on public.lista_espera
  for each row execute function public.lista_espera_aviso();


-- ════════════════════════════════════════════════════════════════════════
-- 6 · CERRAR LA PUERTA
-- ════════════════════════════════════════════════════════════════════════
-- ⚠️ ESTO VA DESPUÉS DE QUE EL JS NUEVO ESTÉ DESPLEGADO. Ver el orden de
--    despliegue en el prompt que acompaña a este archivo. Si se corre antes,
--    el notifyTG del JS viejo empieza a recibir un error de permisos — lo
--    traga su try/catch, así que nadie lo ve, pero se pierden los avisos
--    duplicados que son justamente la red de seguridad de la ventana.
--
-- `authenticated` CONSERVA el permiso: son el jefe y las empleadas, y el
-- panel manda 31 avisos por ahí (admin.html L3535).
--
-- ⚠️ HACEN FALTA LOS DOS REVOKE, no alcanza con el de anon. Verificado contra
-- producción — el proacl real de send_telegram es:
--
--     =X/postgres | postgres=X/postgres | anon=X/postgres |
--     authenticated=X/postgres | service_role=X/postgres
--      ↑
--      ese `=X/postgres` del principio es PUBLIC
--
-- Postgres le da EXECUTE a PUBLIC a toda función nueva, y `revoke … from anon`
-- NO lo toca: anon seguiría pudiendo llamarla heredando de PUBLIC. Con sólo el
-- revoke de anon, este archivo no cerraba nada — lo agarró el test, no la
-- lectura. (Las cliente_* no tienen ese grant porque fase1.sql sí hacía
-- `revoke all … from public`.)
--
-- Y después del revoke a PUBLIC hay que RE-OTORGAR explícitamente a quien
-- debe conservarlo, para no depender de los default privileges.
revoke all     on function public.send_telegram(text) from public;
revoke execute on function public.send_telegram(text) from anon;
grant  execute on function public.send_telegram(text) to authenticated, service_role;

-- Endurecimiento de las SECURITY DEFINER que estaban sin search_path fijado.
-- Sin el pin, quien pueda manipular el search_path de su sesión puede hacer
-- que una referencia sin calificar dentro de la función resuelva a otra cosa.
-- No se toca el CUERPO de send_telegram: el token vive ahí.
alter function public.send_telegram(text)      set search_path = public, extensions;
alter function public.admin_actions_cleanup()  set search_path = public, extensions;


-- ════════════════════════════════════════════════════════════════════════
-- 7 · 🔴 DE YAPA — admin_actions_cleanup tenía el MISMO agujero
-- ════════════════════════════════════════════════════════════════════════
-- SI QUERÉS DEJAR ESTO PARA OTRO PATCH, BORRÁ ESTA SECCIÓN ENTERA: el resto
-- del archivo funciona igual. Va acá porque es el mismo bug, de dos líneas, y
-- porque el paso 6 ya está tocando esta función para el search_path.
--
-- Encontrado al verificar el proacl de send_telegram. Su ACL real hoy:
--     =X/postgres | postgres=X/postgres | anon=X/postgres | …
-- o sea PUBLIC otra vez. Y la función BORRA FILAS (`delete` en el cuerpo,
-- SECURITY DEFINER) de `admin_actions`, que hoy tiene 2.625 registros de
-- quién hizo qué en el panel.
--
-- Con la anon key, cualquiera podía purgar el registro de auditoría. Es más
-- grave que el relay de Telegram: no es mandar un mensaje falso, es borrar la
-- evidencia.
--
-- Único llamador real: el panel, en admin.html L9472, como `authenticated`.
-- Por eso authenticated conserva el permiso y no se rompe nada.
revoke all     on function public.admin_actions_cleanup() from public;
revoke execute on function public.admin_actions_cleanup() from anon;
grant  execute on function public.admin_actions_cleanup() to authenticated, service_role;

commit;
-- ── fin de FASE 4 ───────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — descomentar y correr entero si hay que volver atrás.
-- Deja los avisos como estaban: los manda el front otra vez.
-- (Requiere volver también el JS, porque el JS nuevo ya no los manda.)
-- ════════════════════════════════════════════════════════════════════════
/*
begin;
grant execute on function public.send_telegram(text) to anon;
drop trigger if exists trg_lista_espera_aviso on public.lista_espera;
drop function if exists public.lista_espera_aviso();
-- Las tres cliente_* quedan con los avisos adentro: son inofensivos si el
-- front también avisa (salen duplicados). Para sacarlos del todo, volver a
-- correr sql/fase1.sql, que las recrea sin los perform _aviso_tg.
commit;
*/
