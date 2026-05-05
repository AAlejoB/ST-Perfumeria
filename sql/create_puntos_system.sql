-- ════════════════════════════════════════════════════════════════════
-- SISTEMA DE PUNTOS — ST Perfumería
--
-- 3 piezas:
--   1. Tabla `puntos_config`: 1 sola fila con conversiones globales
--      (cuántos puntos da cada tipo de venta). Editable desde admin.
--   2. Tabla `puntos_log`: historial de movimientos de puntos por cliente.
--   3. Columna `puntos_otorgados` en `ventas`: para trackear cuánto
--      sumó cada venta (clave para devolver puntos al eliminar venta).
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1) puntos_config (configuración global) ─────────────────────────
CREATE TABLE IF NOT EXISTS puntos_config (
  id                       BIGSERIAL PRIMARY KEY,
  puntos_por_perfume       NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  puntos_por_decant        NUMERIC(6,2) NOT NULL DEFAULT 0.10,  -- 10 decants = 1 punto
  puntos_por_set_combo     NUMERIC(6,2) NOT NULL DEFAULT 2.00,
  threshold_proximo_premio INT NOT NULL DEFAULT 5,              -- avisar al cliente cuando esté a 1 de este múltiplo
  mensaje_promo            TEXT,                                 -- mensaje editable que aparece debajo del banner cuando el cliente está cerca del threshold
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE puntos_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "puntos_config_select_anon" ON puntos_config;
CREATE POLICY "puntos_config_select_anon" ON puntos_config FOR SELECT USING (true);
DROP POLICY IF EXISTS "puntos_config_write_auth" ON puntos_config;
CREATE POLICY "puntos_config_write_auth" ON puntos_config
  FOR ALL USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');

-- Seed inicial: 1 fila con valores por defecto
INSERT INTO puntos_config (puntos_por_perfume, puntos_por_decant, puntos_por_set_combo, threshold_proximo_premio, mensaje_promo)
SELECT 1.00, 0.10, 2.00, 5, '¡Sumá 1 punto más y consultanos por un premio especial! 🎁'
WHERE NOT EXISTS (SELECT 1 FROM puntos_config);


-- ─── 2) puntos_log (historial por cliente) ───────────────────────────
CREATE TABLE IF NOT EXISTS puntos_log (
  id          BIGSERIAL PRIMARY KEY,
  cliente_id  BIGINT,                              -- referencia a clientes.id (puede ser NULL si fue manual con teléfono)
  cliente_telefono TEXT,                            -- fallback identificador
  cliente_nombre   TEXT,                            -- snapshot
  delta       NUMERIC(8,2) NOT NULL,                -- positivo (suma) o negativo (resta)
  motivo      TEXT,                                  -- 'venta_auto', 'venta_eliminada', 'manual_jefe', 'canje'
  venta_id    BIGINT,                                -- si aplica, ref a ventas.id
  actor       TEXT,                                  -- jefe/empleado/sistema
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puntos_log_cliente ON puntos_log(cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puntos_log_telefono ON puntos_log(cliente_telefono);
CREATE INDEX IF NOT EXISTS idx_puntos_log_venta ON puntos_log(venta_id);

ALTER TABLE puntos_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "puntos_log_select_anon" ON puntos_log;
CREATE POLICY "puntos_log_select_anon" ON puntos_log FOR SELECT USING (true);
DROP POLICY IF EXISTS "puntos_log_write_auth" ON puntos_log;
CREATE POLICY "puntos_log_write_auth" ON puntos_log
  FOR ALL USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');


-- ─── 3) Columna `puntos_otorgados` en ventas ─────────────────────────
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS puntos_otorgados NUMERIC(8,2) DEFAULT 0;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cliente_id_puntos BIGINT;
COMMENT ON COLUMN ventas.puntos_otorgados IS 'Puntos sumados al cliente por esta venta. Si la venta se elimina, se restan estos puntos.';
COMMENT ON COLUMN ventas.cliente_id_puntos IS 'ID del cliente que recibió los puntos (puede no coincidir con cliente_nombre si el matching fue por teléfono).';


-- ─── 4) Asegurar que la columna `puntos` existe en clientes ──────────
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS puntos NUMERIC(8,2) NOT NULL DEFAULT 0;
