-- ════════════════════════════════════════════════════════════════════
-- [DECANT-PRECIO-MANUAL] Precio de decant por perfume, cargado a mano
--
-- Para qué: que el empleado o el jefe puedan dar de alta un perfume de
-- diseñador/nicho y ponerle SU precio de decant en el mismo formulario,
-- sin depender de nadie más.
--
--   precio_decant    → precio del decant de ese perfume. NULL = usa el
--                      precio general (la escalera de decants_config).
--   decant_excluido  → TRUE = el perfume no aparece en el armador de decants.
--
-- Va en las DOS tablas porque un perfume puede venir de cualquiera de las dos:
--   · perfumes_nuevos    → perfumes dados de alta desde el admin
--   · perfume_overrides  → los 242 del catálogo base (perfumes.js)
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE perfumes_nuevos
  ADD COLUMN IF NOT EXISTS precio_decant   INTEGER,
  ADD COLUMN IF NOT EXISTS decant_excluido BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE perfume_overrides
  ADD COLUMN IF NOT EXISTS precio_decant   INTEGER,
  ADD COLUMN IF NOT EXISTS decant_excluido BOOLEAN NOT NULL DEFAULT FALSE;
