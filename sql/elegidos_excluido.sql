-- ════════════════════════════════════════════════════════════════════
-- [ELEGIDOS-EXCLUIR] Un perfume que no sale en «Elegidos del día» (16-oct-2026, pedido 2 de Alejo, opción B)
--
-- Para qué: sacar un perfume de la rotación diaria de la Selección ST ([SELECCION-DIARIA], js/app.js)
-- sin pausarlo ni sacarle el stock: sigue en el catálogo y se puede pedir, sólo no entra al sorteo de los 3.
--
--   elegidos_excluido → TRUE = no entra al pozo de «Elegidos del día». Default FALSE: nada cambia para los que ya están.
--
-- Va SÓLO en perfume_overrides: el panel (Editar y la lista «Fuera de los Elegidos del día» de Destacados) escribe
-- siempre ahí, también para los de perfumes_nuevos (Editar hace upsert en perfume_overrides para todos), y el
-- catálogo lee los overrides con select * y los aplica sobre todos los perfumes.
--
-- Sin esta columna el panel sigue andando: Editar guarda el resto y avisa (como con precio_decant), y la lista de
-- Destacados dice que falta correr este SQL.
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase. No toca RLS ni permisos (anon lee la tabla entera con select_public;
-- las dos cuentas del panel escriben la tabla entera).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.perfume_overrides
  ADD COLUMN IF NOT EXISTS elegidos_excluido BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.perfume_overrides.elegidos_excluido IS '[ELEGIDOS-EXCLUIR] TRUE = no entra al sorteo diario de «Elegidos del día» (Selección ST). Lo tilda el panel desde Editar o desde Destacados.';
