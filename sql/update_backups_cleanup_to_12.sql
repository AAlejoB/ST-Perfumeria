-- ════════════════════════════════════════════════════════════════════
-- Actualiza la función `admin_backups_cleanup` para mantener solo los
-- 12 backups más recientes (antes era ~30 según versión anterior).
--
-- Política: 12 backups × cada 2 horas = 24 horas de cobertura granular.
-- Suficiente para "control obsesivo" en local chico sin hinchar storage.
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_backups_cleanup()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
    FROM admin_backups
  ),
  to_delete AS (
    SELECT id FROM ranked WHERE rn > 12
  ),
  del AS (
    DELETE FROM admin_backups
    WHERE id IN (SELECT id FROM to_delete)
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM del;

  RETURN deleted_count;
END;
$$;

-- (Opcional) ejecutar inmediatamente para limpiar lo que ya excede
-- los 12 más recientes.
-- SELECT admin_backups_cleanup();
