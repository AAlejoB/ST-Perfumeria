-- ════════════════════════════════════════════════════════════════════
-- TABLAS `home_top_banner` y `home_slides`
--
-- Banner B/N + slider del primer pantallazo de la home, editables
-- desde el admin (jefe Y empleados). Cualquier usuario autenticado
-- puede leer/escribir; los visitantes públicos solo pueden leer.
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1) home_top_banner — texto B/N de pagos en el tope (debajo del nav)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS home_top_banner (
  id            BIGSERIAL PRIMARY KEY,
  texto         TEXT NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  modo_marquee  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: lectura pública (anyone), escritura solo authenticated.
ALTER TABLE home_top_banner ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "home_top_banner_select_anon" ON home_top_banner;
CREATE POLICY "home_top_banner_select_anon" ON home_top_banner
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "home_top_banner_write_auth" ON home_top_banner;
CREATE POLICY "home_top_banner_write_auth" ON home_top_banner
  FOR ALL USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');

-- Seed inicial (1 fila por defecto, admin puede editarla)
INSERT INTO home_top_banner (texto, activo, modo_marquee)
SELECT '3 CUOTAS SIN INTERÉS · ACEPTAMOS TODOS LOS MEDIOS DE PAGO', TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM home_top_banner);


-- ─────────────────────────────────────────────────────────────────────
-- 2) home_slides — slider de "atajos" cuadrados editables
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS home_slides (
  id          BIGSERIAL PRIMARY KEY,
  orden       INTEGER NOT NULL DEFAULT 0,
  media_url   TEXT NOT NULL,
  media_tipo  TEXT NOT NULL DEFAULT 'img',  -- 'img' o 'video'
  titulo      TEXT,
  link_a      TEXT,                          -- '#categorias', '#catalogo', '/blog', etc.
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_slides_orden ON home_slides(orden);
CREATE INDEX IF NOT EXISTS idx_home_slides_activo ON home_slides(activo);

ALTER TABLE home_slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "home_slides_select_anon" ON home_slides;
CREATE POLICY "home_slides_select_anon" ON home_slides
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "home_slides_write_auth" ON home_slides;
CREATE POLICY "home_slides_write_auth" ON home_slides
  FOR ALL USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');

-- Constraint suave: media_tipo solo 'img' o 'video'
ALTER TABLE home_slides
  DROP CONSTRAINT IF EXISTS home_slides_media_tipo_check;
ALTER TABLE home_slides
  ADD CONSTRAINT home_slides_media_tipo_check
  CHECK (media_tipo IN ('img','video'));
