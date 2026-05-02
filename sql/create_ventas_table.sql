-- ════════════════════════════════════════════════════════════════════
-- TABLA `ventas` — registro digital de ventas del local
-- Reemplaza el papel y lápiz de Sofia / Angelina / Lautaro
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas (
  id              BIGSERIAL PRIMARY KEY,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slug_perfume    TEXT NOT NULL,
  perfume_nombre  TEXT NOT NULL,
  marca           TEXT,
  cliente_nombre  TEXT NOT NULL,
  cantidad        INTEGER NOT NULL DEFAULT 1,
  monto_mp        NUMERIC DEFAULT 0,
  monto_efectivo  NUMERIC DEFAULT 0,
  monto_total     NUMERIC NOT NULL,
  notas           TEXT,
  vendedor        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Si la tabla ya existía sin la columna `cantidad`, la agregamos:
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cantidad INTEGER NOT NULL DEFAULT 1;

-- Índices para queries rápidas por fecha y por perfume
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ventas_slug  ON ventas(slug_perfume);
CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON ventas(vendedor);

-- ════════════════════════════════════════════════════════════════════
-- Row Level Security
-- Cualquiera autenticado puede insertar/leer; nadie puede modificar
-- (las ventas son inmutables); solo se permite DELETE para que el jefe
-- pueda corregir un error puntual desde el admin.
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ventas_select" ON ventas;
CREATE POLICY "ventas_select" ON ventas FOR SELECT USING (true);

DROP POLICY IF EXISTS "ventas_insert" ON ventas;
CREATE POLICY "ventas_insert" ON ventas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "ventas_delete" ON ventas;
CREATE POLICY "ventas_delete" ON ventas FOR DELETE USING (true);

-- (no hay política de UPDATE → ventas son inmutables por diseño)
