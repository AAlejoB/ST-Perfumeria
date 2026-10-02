-- ═══════════════════════════════════════════════════════════════════════
-- [PUNTOS-LOG] segunda migración · CERRAR LA ESCRITURA DIRECTA de clientes.puntos y clientes.puntos_log
-- 2-oct-2026 · rama `puntos-log` · SIN APLICAR
--
-- ⚠ SE APLICA RECIÉN DESPUÉS del merge del front de `puntos-log` y de su humo. El front de HOY (`main`, v1.1.172) escribe
--   `clientes.puntos` directo (el «+1», «Ajustar puntos», Editar cliente y el alta con «ya compró»): aplicarla antes
--   rompe el +1 en producción. El front de `puntos-log` ya no manda `puntos` ni `puntos_log` en ningún insert ni update:
--   todo pasa por `ajustar_puntos` (security definer, que no necesita el permiso de `authenticated`).
--
-- Hoy: `clientes` deja select/insert/update/delete a cualquier `authenticated` (políticas `clientes_*_auth`, `true`) y los
-- permisos de tabla (insert, update) son de tabla entera. Esto saca el insert y el update de TABLA a `authenticated` y los
-- devuelve COLUMNA POR COLUMNA, menos `puntos` y `puntos_log`. No toca `delete`, `select`, `anon` (no tiene políticas) ni
-- `service_role`. Las funciones `security definer` (cliente_*, ajustar_puntos, sumar/revertir_puntos_por_compra) siguen
-- escribiendo `puntos` porque corren con los permisos del dueño.
--
-- Columnas que el panel escribe hoy (medido en admin.html el 2-oct):
--   INSERT: nombre, telefono, nota, compro                       (alta de cliente y registrar + 1; los puntos entran por ajustar_puntos)
--   UPDATE: nombre, telefono, nota, compro   (Editar cliente) · bloqueado (Bloquear) · password (reset de contraseña: `password: null`)
-- Columnas de `clientes`: id, nombre, telefono, created_at, password, bloqueado, puntos, compro, nota, puntos_log.
--
-- ⚠ DE AHORA EN MÁS: una columna NUEVA en `clientes` no la puede escribir el panel hasta darle el permiso de columna:
--     grant insert (columna) on public.clientes to authenticated;   grant update (columna) on public.clientes to authenticated;
-- (está en CLAUDE.md § NO ROMPER).
--
-- También agrega el CHECK `clientes_puntos_no_negativo` (puntos >= 0). Volver atrás (si algo no anda): ver el final del archivo.
-- ═══════════════════════════════════════════════════════════════════════

begin;

revoke insert, update on public.clientes from authenticated;

grant insert (nombre, telefono, nota, compro) on public.clientes to authenticated;
grant update (nombre, telefono, nota, compro, bloqueado, password) on public.clientes to authenticated;

-- «puntos nunca negativo» lo garantiza la BASE (no sólo ajustar_puntos): medido el 2-oct, 0 clientes con puntos negativos y 0 con puntos nulos (102 clientes).
do $chk$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.clientes'::regclass and conname = 'clientes_puntos_no_negativo') then
    alter table public.clientes add constraint clientes_puntos_no_negativo check (puntos >= 0);
  end if;
end
$chk$;

commit;

-- ─── Comprobación (sólo lectura; correr después de aplicar) ───
-- select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'clientes' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
--  order by privilege_type, column_name;
--   → INSERT: compro, nombre, nota, telefono · UPDATE: bloqueado, compro, nombre, nota, password, telefono (y ni `puntos` ni `puntos_log`)

-- ─── Volver atrás ───
-- begin;
-- grant insert, update on public.clientes to authenticated;
-- alter table public.clientes drop constraint if exists clientes_puntos_no_negativo;
-- commit;
