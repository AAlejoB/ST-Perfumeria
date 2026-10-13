-- ============================================================================
-- [PANEL-SIN-CONEXION] · la hora real de un renglón que se anotó sin internet  ·  13-oct-2026 (decisión A de Alejo)
-- ============================================================================
-- Requiere sql/caja_movimientos.sql y sql/caja_deudas.sql. NO cambia datos.
-- APLICADA el 13-oct-2026 a las 18:10 (migración caja_creado_en, por Claude Code con el OK de Alejo). Probada como la empleada en una
-- transacción deshecha: sin hora OK · hace 3 h OK · hace 8 días 42501 · 1 h adelante 42501 · 0 filas de prueba quedaron.
--
-- Sin internet, la hoja guarda el renglón en la tablet y lo sube cuando vuelve (admin.html, colaSubir). Hasta acá `creado_en`
-- lo ponía siempre la base (default now()): un renglón anotado a las 15 y subido a las 18 decía «18:00» en la hoja.
-- Con esto el panel puede mandar `creado_en` (SÓLO lo hace al subir desde la tablet; un guardado normal sigue usando el default),
-- con un tope: no más de 7 días atrás ni más de 5 minutos adelante (por si el reloj de la tablet anda corrido).
-- Si la base lo rechaza (antes de correr esto, o fuera del tope), el panel reintenta sin `creado_en` y queda la hora de subida.
--
-- La política de alta es la MISMA de sql/caja_movimientos.sql (verificada contra la base el 13-oct), más las dos líneas del tope.
-- ============================================================================

begin;

grant insert (creado_en) on public.caja_movimientos to authenticated;

drop policy if exists caja_insert_staff on public.caja_movimientos;
create policy caja_insert_staff on public.caja_movimientos
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])
    and creado_por = (auth.jwt() ->> 'email')
    and anulado_en is null
    and dia <= ((now() at time zone 'America/Argentina/Buenos_Aires')::date)
    and creado_en >= now() - interval '7 days'
    and creado_en <= now() + interval '5 minutes'
  );

commit;

-- Para volver atrás (deja todo como antes):
--   begin;
--   revoke insert (creado_en) on public.caja_movimientos from authenticated;
--   drop policy if exists caja_insert_staff on public.caja_movimientos;
--   create policy caja_insert_staff on public.caja_movimientos for insert to authenticated with check (
--     (auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])
--     and creado_por = (auth.jwt() ->> 'email') and anulado_en is null
--     and dia <= ((now() at time zone 'America/Argentina/Buenos_Aires')::date));
--   commit;
