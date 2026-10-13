-- [CELU-FCP] 13-oct-2026 · las fotos ajenas y las pesadas pasan a img/ del propio sitio (webp, 600 px como máximo).
-- Medido en producción: la foto de la 1.ª card (ERBA PURA) salía de fimgs.net y era el LCP (5,6 a 6 s simulado en el celu);
-- al abrir se bajaban 25 fotos (2 MB) de 9 servidores. Las 19 fotos nuevas pesan 329 KB en total (antes 2,9 MB).
-- Se aplica DESPUÉS de que el commit con img/ esté en producción y cada archivo responda 200 (curl -I).
-- Cada UPDATE pide el link viejo exacto: si alguien cambió la foto desde Editar mientras tanto, esa fila no se toca.
-- No borra nada de Supabase Storage. La vuelta atrás está al final.
-- Quedan afuera, con el link muerto (404 en juleriaque): la-bomba, scandal y valentino-donna. Necesitan una foto nueva.

begin;

update public.perfume_overrides set foto = v.nueva
from (values
  ('erba-pura',                   'https://fimgs.net/mdimg/perfume/o.55157.jpg', 'img/ERBA PURA.webp'),
  ('le-beau-le-parfum',           'https://juleriaque.vtexassets.com/arquivos/ids/214946/1001501_02.jpg?v=638779025354700000', 'img/LE BEAU LE PARFUM.webp'),
  ('lady-million',                'https://cdn.farmacialeloir.com.ar/img/articulos/paco_rabanne_lady_million_eau_da_parfum_imagen1.jpg', 'img/LADY MILLION.webp'),
  ('stronger-with-you-intensely', 'https://rougeb2car.vtexassets.com/arquivos/ids/164117/Stronger-With-You-Intensely-EDP-100ml-2.jpg?v=638769580457200000', 'img/STRONGER WITH YOU INTENSELY.webp'),
  ('scandant-by-night',           'https://cdnx.jumpseller.com/sairam/image/75528500/thumb/1500/1500?1775441624', 'img/SCANDANT BY NIGHT.webp'),
  ('vanilla-sugar',               'https://marabika.lt/13570-large_default/elysia-vanilla-sugar-fragrance-world-100ml.jpg', 'img/VANILLA SUGAR.webp'),
  ('le-beau-edt',                 'https://acdn-us.mitiendanube.com/stores/001/165/255/products/jean-paul-gaultier-le-beau-edt-x75ml-c62ee6a62437bc90aa17177703466168-480-0.webp', 'img/LE BEAU EDT.webp'),
  ('rose-de-nuit',                'https://fimgs.net/mdimg/perfume-thumbs/375x500.114162.jpg', 'img/ROSE DE NUIT.webp'),
  ('nuit-de-passion',             'https://fimgs.net/mdimg/perfume-thumbs/375x500.104111.jpg', 'img/NUIT DE PASSION.webp'),
  ('the-most-wanted-edp',         'https://http2.mlstatic.com/D_NQ_NP_967779-MLU72639789149_112023-O.webp', 'img/THE MOST WANTED EDP.webp'),
  ('voux-zeste',                  'https://i5.walmartimages.com/asr/6ddf25a2-6b28-4838-832b-ecb5b99da998.adb4537fbaf03f67f8baf0a41c6abae7.jpeg?odnHeight=612&odnWidth=612&odnBg=FFFFFF', 'img/VOUX ZESTE.webp'),
  ('very-good-girl',              'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTeQSh1QcY2dqJtb5QW9jFBIkTPkXrYnrGnfnFFhVS0Lkr7R4cqbCDWa7hI&s=10', 'img/VERY GOOD GIRL.webp'),
  ('good-girl',                   'https://acdn-us.mitiendanube.com/stores/001/071/596/products/carolina_herrera_goodgirl_edp_30_ml1-b107abca003434180515730879015270-640-0.webp', 'img/GOOD GIRL.webp'),
  ('casamorando-royale',          'https://http2.mlstatic.com/D_NQ_NP_976915-MLA108250681321_032026-O.webp', 'img/CASAMORANDO ROYALE.webp'),
  ('casamorando-royalo',          'https://http2.mlstatic.com/D_NQ_NP_976915-MLA108250681321_032026-O.webp', 'img/CASAMORANDO ROYALE.webp'),
  ('kenzo-flower',                'https://fimgs.net/mdimg/perfume-thumbs/375x500.72.jpg', 'img/KENZO FLOWER.webp'),
  ('le-male-elixir',              'https://znmjhproimtprptheumy.supabase.co/storage/v1/object/public/perfume-fotos/LE%20MALE%20ELIXIR.webp?v=1790252424879', 'img/LE MALE ELIXIR.webp'),
  ('9-pm-night-out',              'https://znmjhproimtprptheumy.supabase.co/storage/v1/object/public/perfume-fotos/9%20PM%20NIGHT%20OUT.webp?v=1777415042774', 'img/9 PM NIGHT OUT.webp')
) as v(slug, vieja, nueva)
where perfume_overrides.slug = v.slug and perfume_overrides.foto = v.vieja;
-- esperado: 18 filas

update public.perfumes_nuevos set foto = 'img/9 PM NIGHT OUT.webp'
where slug = '9-pm-night-out'
  and foto = 'https://znmjhproimtprptheumy.supabase.co/storage/v1/object/public/perfume-fotos/9%20PM%20NIGHT%20OUT.webp?v=1777415042774';
-- esperado: 1 fila

update public.decants_custom set foto_url = v.nueva
from (values
  (15, 'https://znmjhproimtprptheumy.supabase.co/storage/v1/object/public/perfume-fotos/decant-custom-15-1786466098145.webp?v=1786466099110', 'img/DECANT BORN IN ROMA INTENSE.webp'),
  (13, 'https://znmjhproimtprptheumy.supabase.co/storage/v1/object/public/perfume-fotos/decant-custom-13-1778513193099.webp?v=1778513193811', 'img/DECANT LE BEAU EDT.webp')
) as v(id, vieja, nueva)
where decants_custom.id = v.id and decants_custom.foto_url = v.vieja;
-- esperado: 2 filas

commit;

-- ── Vuelta atrás (sólo si hace falta) ──────────────────────────────────────────────
-- Es el mismo bloque con «vieja» y «nueva» al revés: cada fila vuelve a su link de antes si todavía tiene el nuevo.
-- update public.perfume_overrides set foto = v.vieja from (values …mismas filas…) as v(slug, vieja, nueva)
--   where perfume_overrides.slug = v.slug and perfume_overrides.foto = v.nueva;
-- update public.perfumes_nuevos set foto = '<link viejo de 9 PM NIGHT OUT>' where slug = '9-pm-night-out' and foto = 'img/9 PM NIGHT OUT.webp';
-- update public.decants_custom set foto_url = v.vieja from (values …) as v(id, vieja, nueva)
--   where decants_custom.id = v.id and decants_custom.foto_url = v.nueva;
