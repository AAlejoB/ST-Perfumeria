-- ============================================================
-- Trigger: auto-bumpear `updated_at` en cada UPDATE de `perfume_overrides`.
--
-- Por qué: el watchdog de Realtime (admin.html) usa polling diferencial
-- en modo DEGRADED con filtro `gt('updated_at', lastSyncAt)`. Sin este
-- trigger, `updated_at` queda fijo en el `DEFAULT NOW()` original de
-- cuando se insertó la fila, y el polling nunca devuelve cambios.
--
-- Cómo correrlo: pegar en Supabase Dashboard → SQL Editor → Run.
-- Es idempotente (DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION).
--
-- Verificación post-aplicación:
--   UPDATE perfume_overrides SET stock_qty = stock_qty
--     WHERE slug = (SELECT slug FROM perfume_overrides LIMIT 1);
--   SELECT slug, updated_at FROM perfume_overrides
--     ORDER BY updated_at DESC LIMIT 3;
-- El `updated_at` de esa fila debería ser de hace segundos.
--
-- Ver: docs/HISTORIA.md → "Watchdog de Realtime (mayo 2026)"
-- ============================================================

CREATE OR REPLACE FUNCTION trg_perfume_overrides_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS perfume_overrides_updated_at ON perfume_overrides;

CREATE TRIGGER perfume_overrides_updated_at
  BEFORE UPDATE ON perfume_overrides
  FOR EACH ROW
  EXECUTE FUNCTION trg_perfume_overrides_set_updated_at();
