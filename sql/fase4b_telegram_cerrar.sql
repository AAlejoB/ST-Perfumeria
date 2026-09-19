-- ─────────────────────────────────────────────────────────────────────────
-- fase4b · SECCIONES 6-7 (revoke a PUBLIC y anon sobre send_telegram, grant
-- explícito a authenticated/service_role, search_path fijo, y lo mismo para
-- admin_actions_cleanup, que BORRA FILAS y también estaba abierta a anon).
-- ⚠️ Se corre DESPUÉS de que el JS nuevo esté deployado (SW bumpeado) y con
-- OK de Alejo. Antes: el notifyTG del JS viejo empieza a fallar en silencio.
-- Partido de sql/fase4_telegram.sql (referencia completa) el 19-sep-2026.
-- ─────────────────────────────────────────────────────────────────────────

begin;

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
-- ── fin de fase4b ──────────────────────────────────────────────────────




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
