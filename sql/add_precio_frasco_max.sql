-- ════════════════════════════════════════════════════════════════════
-- [DECANT-TOPE] Columna `precio_frasco_max` en `decants_config`
--
-- Tope de precio de frasco (normalizado a 100 ml) para que un perfume del
-- catálogo entre al armador con la escalera de precios.
--
-- Por qué: el armador listaba TODO el catálogo a precio fijo ($9.500) sin
-- mirar cuánto sale el frasco. Un Erba Pura de $430.000 deja el decant de
-- 5 ml en $21.500 de costo → se vendía perdiendo $12.000 por unidad.
--
-- Si el frasco supera este valor, la card se muestra como
-- "💬 Precio a consultar" con botón de WhatsApp, y no se puede sumar al pack.
--
-- 0 o NULL = regla desactivada (comportamiento anterior).
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE decants_config
  ADD COLUMN IF NOT EXISTS precio_frasco_max INTEGER DEFAULT 170000;

-- Valor inicial para la fila de config existente.
-- $170.000 = el frasco más caro cuyo decant de 5 ml todavía cubre costo
-- al tier más barato de la escalera ($8.500).
UPDATE decants_config
   SET precio_frasco_max = 170000
 WHERE id = 1
   AND precio_frasco_max IS NULL;
