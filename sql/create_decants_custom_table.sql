-- ════════════════════════════════════════════════════════════════════
-- TABLA `decants_custom` — Perfumes personalizados para el armador de decants
--
-- Sirve para que el admin agregue perfumes especiales que NO están en el
-- catálogo regular (ej: perfumes de diseñador que vienen sueltos y no se
-- cargan al stock). Aparecen en el armador del cliente como opciones extra.
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS decants_custom (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  marca       TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decants_custom_activo ON decants_custom(activo, orden);

ALTER TABLE decants_custom ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decants_custom_select_anon" ON decants_custom;
CREATE POLICY "decants_custom_select_anon" ON decants_custom
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "decants_custom_write_auth" ON decants_custom;
CREATE POLICY "decants_custom_write_auth" ON decants_custom
  FOR ALL USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');
