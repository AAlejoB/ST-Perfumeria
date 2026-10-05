-- ============================================================
-- [LOGIN-INTENTOS-CLEANUP] · limpieza diaria de cliente_login_intentos
-- Escrito el 5-oct-2026 · SIN APLICAR (lo aplica Alejo o el PREPARADOR, no Claude Code solo)
--
-- Problema: cada intento fallido de login de CUALQUIER número (exista o no) deja una
-- fila en cliente_login_intentos (telefono, intentos, ultimo_intento, bloqueado_hasta)
-- y sólo se borra cuando ese número entra bien. La tabla sólo crece.
--
-- Qué borra: las filas cuyo ultimo_intento tiene más de 1 día Y que no están bloqueadas
-- en este momento (bloqueado_hasta null o ya vencido; el bloqueo dura 15 min, así que en
-- la práctica no hay nada bloqueado a un día de distancia: el chequeo es el cinturón).
--
-- ⚠️ Efecto a tener presente: el contador `intentos` NO se resetea por tiempo en
-- cliente_entrar / cliente_login (sólo se resetea con un ingreso correcto). Un número con
-- 4 fallos de hace una semana hoy entra bloqueado al 5.º fallo; con esta limpieza vuelve a
-- empezar de 0 pasado el día. Es lo que se quiere (los fallos de hace días no cuentan),
-- pero es un cambio de comportamiento de los 4 → 5.
--
-- Cuándo: todos los días a las 06:30 UTC = 03:30 en Argentina (fuera de horario).
-- No toca el job existente `resumen-diario-telegram` (apagado a propósito).
--
-- Rollback:  select cron.unschedule('login-intentos-cleanup');
-- Verificar: select jobid, jobname, schedule, active from cron.job;
--            select * from cron.job_run_details where jobid = (select jobid from cron.job
--              where jobname = 'login-intentos-cleanup') order by start_time desc limit 5;
-- ============================================================

-- idempotente: si ya existe, se reemplaza
do $$
begin
  if exists (select 1 from cron.job where jobname = 'login-intentos-cleanup') then
    perform cron.unschedule('login-intentos-cleanup');
  end if;
end $$;

select cron.schedule(
  'login-intentos-cleanup',
  '30 6 * * *',
  $job$
    delete from public.cliente_login_intentos
    where ultimo_intento < now() - interval '1 day'
      and (bloqueado_hasta is null or bloqueado_hasta < now());
  $job$
);
