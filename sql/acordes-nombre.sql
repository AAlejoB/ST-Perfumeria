-- acordes-nombre [A-QUE-HUELE-AUTO] · 5-oct-2026 · la fuente «nombre» para los perfumes_nuevos que quedaron en 0 (15 filas). Sin aplicar hasta el OK del PREPARADOR; fuera de 10-21 ART. Antes de correrlo tiene que existir la columna acordes (sql/acordes.sql, aplicado el 4-oct).
-- md5 de la lista: bd6a538bb20af829ccb6f4cdb6550079 · perfumes_nuevos con acordes después: 76, md5 6509d8b53b6b9023f83d47a88312d31a
-- Prueba en seco corrida el 5-oct (transacción que termina en raise exception, 8 casos): ver D:/workspace/_correo_agentes/ST_Perfumeria/SQL_para_Alejo_ACORDES-NOMBRE_2026-10-05.md

-- ACORDES-NOMBRE · los acordes de 15 perfumes_nuevos que quedaron en 0, sacados del nombre (vainilla, caramelo, cacao, café, leche, manzana, azúcar…).
-- Sólo toca los que tengan acordes en null: nunca pisa uno que se corrigió en Editar, ni un '{}' (sin acordes a propósito).
-- Se puede correr dos veces (la segunda no toca nada). Devuelve las filas que tocó: tienen que ser 15.
update public.perfumes_nuevos n
   set acordes = v.acordes
  from (values
  ('banana-bliss', array['frutal']::text[]),
  ('caramel-macchiato', array['dulce']::text[]),
  ('cherry-cola', array['frutal']::text[]),
  ('cocoa-morado', array['dulce']::text[]),
  ('coconut-lagoon', array['dulce']::text[]),
  ('creamy-biscuit', array['dulce']::text[]),
  ('creme-of-clouds', array['dulce']::text[]),
  ('eclaire-affair', array['dulce']::text[]),
  ('elysia-apple-rouge', array['frutal']::text[]),
  ('elysia-pista-sundae', array['dulce']::text[]),
  ('elysia-sugar-patchouli', array['dulce','amaderado']::text[]),
  ('elysia-vanilla', array['vainilla']::text[]),
  ('qahwa', array['dulce']::text[]),
  ('taskeen-caramel', array['dulce']::text[]),
  ('taskeen-lactea', array['dulce']::text[])
  ) as v(slug, acordes)
 where n.slug = v.slug
   and n.acordes is null
returning n.slug, n.acordes;

-- CHEQUEO · después del bloque: con_acordes tiene que dar 76 y md5 = 6509d8b53b6b9023f83d47a88312d31a
select count(*) as con_acordes,
       md5(string_agg(slug || '|' || array_to_string(acordes, ','), E'\n' order by slug collate "C") || E'\n') as md5
  from public.perfumes_nuevos
 where acordes is not null and cardinality(acordes) > 0;

-- DESHACER · vuelve a null SÓLO donde acordes sigue igual a lo que puso el bloque (no toca lo corregido en Editar ni lo cargado antes).
-- update public.perfumes_nuevos n
--    set acordes = null
--   from (values
--   ('banana-bliss', array['frutal']::text[]),
--   ('caramel-macchiato', array['dulce']::text[]),
--   ('cherry-cola', array['frutal']::text[]),
--   ('cocoa-morado', array['dulce']::text[]),
--   ('coconut-lagoon', array['dulce']::text[]),
--   ('creamy-biscuit', array['dulce']::text[]),
--   ('creme-of-clouds', array['dulce']::text[]),
--   ('eclaire-affair', array['dulce']::text[]),
--   ('elysia-apple-rouge', array['frutal']::text[]),
--   ('elysia-pista-sundae', array['dulce']::text[]),
--   ('elysia-sugar-patchouli', array['dulce','amaderado']::text[]),
--   ('elysia-vanilla', array['vainilla']::text[]),
--   ('qahwa', array['dulce']::text[]),
--   ('taskeen-caramel', array['dulce']::text[]),
--   ('taskeen-lactea', array['dulce']::text[])
--   ) as v(slug, acordes)
--  where n.slug = v.slug
--    and n.acordes = v.acordes;

