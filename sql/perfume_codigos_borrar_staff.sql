-- ============================================================================
-- [ESCANER] · las dos cuentas del panel pueden QUITAR un código de barras  ·  12-oct-2026 (noche)
-- ============================================================================
-- Decisión de Alejo: la empleada también tiene que poder quitar un código (si un frasco quedó con el perfume equivocado, o si el código
-- estaba mal). Antes borraba sólo `is_jefe()` (`perfume_codigos_delete_jefe`). SOLO cambia la política de DELETE: el permiso de tabla
-- (select, insert, delete a `authenticated`) ya estaba; no hay UPDATE; `anon` sigue sin nada. Un perfume puede tener varios códigos
-- (el código es la clave, no el perfume): para sumar uno se escanea el frasco.
-- ============================================================================

drop policy if exists perfume_codigos_delete_jefe on public.perfume_codigos;
drop policy if exists perfume_codigos_delete_staff on public.perfume_codigos;
create policy perfume_codigos_delete_staff on public.perfume_codigos
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));

-- ============================================================================
-- DESHACER (vuelve a «sólo el jefe»):
--
--   drop policy if exists perfume_codigos_delete_staff on public.perfume_codigos;
--   create policy perfume_codigos_delete_jefe on public.perfume_codigos for delete to authenticated using (public.is_jefe());
--
-- ============================================================================
