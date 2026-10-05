-- 147 [A-QUE-HUELE-AUTO] · acordes (hasta 3, de una lista fija de 12) · 4-oct-2026. Correr ANTES del merge de la rama a-que-huele. md5 de la lista: 4d9c4a57106999bb06c72c17fd417eb5
-- Prueba en seco corrida el 4-oct (transacción que termina en raise exception): ver D:/workspace/_correo_agentes/ST_Perfumeria/SQL_para_Alejo_147-ACORDES_2026-10-04.md

-- BLOQUE 1 · las dos columnas «acordes» (text[], nula por defecto) con su CHECK: hasta 3 acordes y sólo de la lista de 12.
-- Se puede correr dos veces (add column if not exists / drop constraint if exists). No toca ninguna fila.
alter table public.perfumes_nuevos   add column if not exists acordes text[];
alter table public.perfume_overrides add column if not exists acordes text[];

alter table public.perfumes_nuevos   drop constraint if exists perfumes_nuevos_acordes_check;
alter table public.perfumes_nuevos   add  constraint perfumes_nuevos_acordes_check
  check (acordes is null or (cardinality(acordes) <= 3 and acordes <@ array['dulce','vainilla','especiado','amaderado','oud','ambar','floral','frutal','citrico','fresco','cuero','almizcle']::text[]));

alter table public.perfume_overrides drop constraint if exists perfume_overrides_acordes_check;
alter table public.perfume_overrides add  constraint perfume_overrides_acordes_check
  check (acordes is null or (cardinality(acordes) <= 3 and acordes <@ array['dulce','vainilla','especiado','amaderado','oud','ambar','floral','frutal','citrico','fresco','cuero','almizcle']::text[]));

notify pgrst, 'reload schema';

-- BLOQUE 2 · los acordes de los perfumes_nuevos (61 filas). Sólo toca los que tengan acordes en null: nunca pisa uno que se corrigió en Editar.
-- Se puede correr dos veces (la segunda no toca nada). Los perfumes de perfumes.js no necesitan SQL: sus acordes van en perfumes.js.
update public.perfumes_nuevos n
   set acordes = v.acordes
  from (values
  ('9-pm-night-out', array['dulce','frutal','amaderado']::text[]),
  ('angham-second-song', array['dulce','vainilla','almizcle']::text[]),
  ('ansaam-silver', array['dulce','vainilla','ambar']::text[]),
  ('armour-code', array['ambar','cuero','especiado']::text[]),
  ('asad-zanzibar-limited-edition', array['ambar','especiado','amaderado']::text[]),
  ('bare-vanilla', array['dulce','vainilla']::text[]),
  ('beach-party', array['frutal','fresco','almizcle']::text[]),
  ('berry-blast', array['dulce','frutal']::text[]),
  ('born-in-roma-edt', array['fresco']::text[]),
  ('born-in-roma-intense', array['dulce']::text[]),
  ('casamorando-royale', array['dulce','citrico']::text[]),
  ('club-de-nuit-bling', array['vainilla','fresco','dulce']::text[]),
  ('coconut-passion', array['dulce','vainilla']::text[]),
  ('coctail-intense', array['dulce']::text[]),
  ('cookies-and-cream', array['dulce']::text[]),
  ('cotton-candy', array['dulce']::text[]),
  ('erba-pura', array['dulce','frutal','citrico']::text[]),
  ('good-girl', array['dulce','floral']::text[]),
  ('harmony-code-intense', array['dulce']::text[]),
  ('hawas-malibu', array['dulce','ambar','almizcle']::text[]),
  ('hawas-tropical', array['dulce','almizcle','fresco']::text[]),
  ('hawas-verde', array['ambar','citrico','amaderado']::text[]),
  ('kenzo-flower', array['vainilla','floral']::text[]),
  ('khadlaj-island', array['dulce','ambar','amaderado']::text[]),
  ('khadlaj-vainilla', array['dulce','ambar','almizcle']::text[]),
  ('khair-confection', array['dulce']::text[]),
  ('khamrah-waha', array['vainilla','almizcle','citrico']::text[]),
  ('lady-million', array['dulce','floral','frutal']::text[]),
  ('le-beau-edt', array['dulce','amaderado']::text[]),
  ('le-beau-le-parfum', array['dulce']::text[]),
  ('le-male-elixir', array['dulce','vainilla']::text[]),
  ('love-spell', array['floral','frutal']::text[]),
  ('mango-jugoso', array['dulce','frutal']::text[]),
  ('musamam-black-intense', array['dulce','floral','especiado']::text[]),
  ('nuit-de-passion', array['dulce','frutal']::text[]),
  ('odyssey-mandarin-sky-elixir', array['dulce','vainilla','especiado']::text[]),
  ('opulent-dubai', array['ambar','frutal','dulce']::text[]),
  ('pinnace', array['citrico','almizcle','ambar']::text[]),
  ('pure-seduction', array['dulce','floral','frutal']::text[]),
  ('qissa-blue', array['fresco']::text[]),
  ('renheit', array['cuero','almizcle','especiado']::text[]),
  ('rose-de-nuit', array['dulce']::text[]),
  ('scandant-by-night', array['dulce']::text[]),
  ('so-candid', array['floral','dulce']::text[]),
  ('star-men', array['dulce','vainilla','amaderado']::text[]),
  ('stronger-with-you-intensely', array['dulce','vainilla','especiado']::text[]),
  ('taskeen-marina', array['dulce','frutal']::text[]),
  ('the-most-wanted-edp', array['dulce','especiado','ambar']::text[]),
  ('tubees-bubble-gum', array['dulce']::text[]),
  ('tubees-candy-pop', array['dulce']::text[]),
  ('tubees-cherry-luxe', array['dulce','frutal']::text[]),
  ('tubees-chocolate-fudge', array['dulce']::text[]),
  ('tubees-pink-sugar', array['dulce']::text[]),
  ('tubees-strawberry-cheesecake', array['dulce','frutal']::text[]),
  ('tubees-sweet-caramel', array['dulce']::text[]),
  ('tubees-unicorn-vanilla', array['dulce','vainilla']::text[]),
  ('vanilla-sugar', array['dulce']::text[]),
  ('velvet-petals', array['dulce','floral']::text[]),
  ('velvet-rouge', array['dulce','floral']::text[]),
  ('very-good-girl', array['dulce','floral']::text[]),
  ('yum-yum', array['dulce','vainilla','ambar']::text[])
  ) as v(slug, acordes)
 where n.slug = v.slug
   and n.acordes is null;

-- DESHACER (no se pierde nada de lo de hoy):
-- alter table public.perfumes_nuevos   drop column if exists acordes;
-- alter table public.perfume_overrides drop column if exists acordes;
-- notify pgrst, 'reload schema';
