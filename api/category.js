/**
 * Vercel Serverless Function — Landing pages SEO indexables
 *
 * Cubre 4 tipos de páginas con la misma infraestructura:
 *   - CATEGORY  → /perfumes-hombre, /perfumes-mujer, /perfumes-unisex
 *   - ATTRIBUTE → /perfumes-arabes, /perfumes-duraderos, /perfumes-en-cuotas
 *   - BRAND     → /lattafa, /afnan, /armaf, /maison-alhambra, /rasasi
 *   - EDITORIAL → /ofertas, /decants, /nuevos, /seleccion-st, /top-ventas
 *
 * Para BOTS (Googlebot, scrapers): renderiza HTML completo con H1,
 * descripción, lista de perfumes, schemas CollectionPage + ItemList +
 * BreadcrumbList. La página queda indexada con su propia URL.
 *
 * Para USUARIOS reales: redirige al catálogo con el filtro aplicado.
 *
 * Cache: 1h CDN + stale-while-revalidate 24h.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.stperfumeria.com';

let PERFUMES = [];

function loadPerfumes() {
  if (PERFUMES.length > 0) return;
  try {
    const filePath = path.join(process.cwd(), 'perfumes.js');
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/const\s+PERFUMES\s*=\s*(\[[\s\S]*\]);?\s*$/m);
    if (match) PERFUMES = eval(match[1]);
  } catch (e) {
    console.error('Error loading perfumes:', e);
  }
}

function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return /bot|crawler|spider|whatsapp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot|bingbot|duckduckbot|yandexbot|applebot|baiduspider|googleother|adsbot|mediapartners|google-inspectiontool/.test(ua);
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────
// CATÁLOGO DE PÁGINAS — cada slug mapea a su configuración SEO
// ─────────────────────────────────────────────────────────────────────
const PAGES = {
  // CATEGORÍAS
  'perfumes-hombre': {
    type: 'category',
    h1: 'Perfumes Hombre',
    title: 'Comprar Perfumes Hombre Originales en Argentina | ST Perfumería Comodoro',
    description: 'Catálogo de perfumes hombre importados originales en Comodoro Rivadavia. Fragancias masculinas duraderas, 3 cuotas sin interés y envíos a todo el país.',
    intro: 'Encontrá las mejores fragancias masculinas árabes e importadas. Perfumes hombre con gran proyección, larga duración y precios accesibles. Comprá en Comodoro Rivadavia con 3 cuotas sin interés y envíos a todo Argentina.',
    redirect: '/#filtro-hombre',
    filter: (p) => (p.cat === 'Hombre') && !p.esSet
  },
  'perfumes-mujer': {
    type: 'category',
    h1: 'Perfumes Mujer',
    title: 'Comprar Perfumes Mujer Originales en Argentina | ST Perfumería Comodoro',
    description: 'Catálogo de perfumes mujer importados con envío a todo el país. Fragancias femeninas árabes con gran estela y 3 cuotas sin interés. Comodoro Rivadavia.',
    intro: 'Perfumes mujer importados originales con larga duración y proyección. Comprá fragancias femeninas árabes y de marcas premium en Comodoro Rivadavia con 3 cuotas sin interés y envíos a toda Argentina.',
    redirect: '/#filtro-mujer',
    filter: (p) => (p.cat === 'Mujer') && !p.esSet
  },
  'perfumes-unisex': {
    type: 'category',
    h1: 'Perfumes Unisex',
    title: 'Comprar Perfumes Unisex Originales en Argentina | ST Perfumería',
    description: 'Fragancias unisex importadas originales. Perfumes neutros para todos con 3 cuotas sin interés y envíos a todo el país desde Comodoro Rivadavia.',
    intro: 'Perfumes unisex originales para quien no se encasilla. Fragancias neutras y versátiles con duración intensa, ideales para uso diario. Comprá con 3 cuotas sin interés en ST Perfumería.',
    redirect: '/#filtro-unisex',
    filter: (p) => (p.cat === 'Unisex') && !p.esSet
  },

  // ATRIBUTOS
  'perfumes-arabes': {
    type: 'attribute',
    h1: 'Perfumes Árabes',
    title: 'Comprar Perfumes Árabes Originales en Argentina | Lattafa, Afnan, Armaf',
    description: 'Perfumes árabes originales en Argentina. Lattafa, Afnan, Armaf, Maison Alhambra y Rasasi. Fragancias intensas con 3 cuotas sin interés y envíos a todo el país.',
    intro: 'Los perfumes árabes son conocidos por su intensidad, proyección y duración. En ST trabajamos las marcas premium del rubro: Lattafa, Afnan, Armaf, Maison Alhambra, Rasasi. Lujo accesible con 3 cuotas sin interés.',
    redirect: '/#catalogo',
    filter: () => true // todos son árabes en ST
  },
  'perfumes-duraderos': {
    type: 'attribute',
    h1: 'Perfumes Duraderos',
    title: 'Comprar Perfumes Duraderos de Larga Duración en Argentina | ST',
    description: 'Perfumes que duran 8 a 12 horas con gran estela. Fragancias intensas para todo el día con envío a todo el país y 3 cuotas sin interés.',
    intro: 'Los perfumes árabes que vendemos en ST duran entre 8 y 12 horas en piel con buena proyección. Si buscás un perfume que dure todo el día y deje estela, esta es tu sección. Comprá con 3 cuotas sin interés.',
    redirect: '/#catalogo',
    filter: (p) => !p.esSet
  },
  'perfumes-en-cuotas': {
    type: 'attribute',
    h1: 'Perfumes en Cuotas sin Interés',
    title: 'Comprar Perfumes en 3 Cuotas Sin Interés en Argentina | ST Perfumería',
    description: 'Perfumes árabes originales con 3 cuotas sin interés. Aceptamos todas las tarjetas + 10% off pagando en efectivo o transferencia. Envíos a todo el país.',
    intro: 'En ST comprás cualquier perfume de nuestro catálogo en 3 cuotas sin interés con tarjeta. Y si pagás en efectivo o transferencia, te aplicamos 10% de descuento adicional. Envío a todo Argentina.',
    redirect: '/#catalogo',
    filter: (p) => !p.esSet
  },

  // EDITORIAL
  'ofertas': {
    type: 'editorial',
    h1: 'Ofertas y Descuentos',
    title: 'Ofertas en Perfumes Árabes Originales | Descuentos ST Comodoro',
    description: 'Perfumes en oferta y promoción. Descuentos del 10% en efectivo/transferencia, 3 cuotas sin interés y combos. Envíos a todo el país.',
    intro: 'Las ofertas activas en ST: combos de decants a precio especial, 10% de descuento pagando en efectivo o transferencia, 3 cuotas sin interés en todo el catálogo, y promociones temporales en perfumes seleccionados.',
    redirect: '/#catalogo',
    filter: (p) => p.promo && !p.esSet
  },
  'decants': {
    type: 'editorial',
    h1: 'Decants y Mini Talles',
    title: 'Comprar Decants Originales · Pack de Mini Talles | ST Perfumería',
    description: 'Probá fragancias árabes originales en formato decant a mitad de precio. Pack de 3 o 5 perfumes con envío a todo el país.',
    intro: 'Los decants son mini talles de perfumes originales — la forma perfecta de probar antes de comprar el frasco completo. Ofrecemos packs de 3 o 5 fragancias a precio especial, ideales para regalar o coleccionar.',
    redirect: '/?action=decants',
    filter: (p) => p.esSet || /decant|mini/i.test(p.name || '')
  },
  'nuevos': {
    type: 'editorial',
    h1: 'Perfumes Nuevos',
    title: 'Perfumes Nuevos · Últimas Llegadas | ST Perfumería Comodoro',
    description: 'Las últimas fragancias importadas que llegaron a ST. Lanzamientos del mes y novedades árabes con 3 cuotas sin interés.',
    intro: 'Las fragancias que recién llegaron a nuestro catálogo. Lanzamientos del mes, novedades de Lattafa, Afnan y otras marcas premium. Probá lo más nuevo antes que nadie con 3 cuotas sin interés.',
    redirect: '/?action=new',
    filter: (p) => p._isNew && !p.esSet
  },
  'seleccion-st': {
    type: 'editorial',
    h1: 'Selección ST',
    title: 'Selección ST · Los Perfumes Destacados del Equipo | Comodoro Rivadavia',
    description: 'Los perfumes que el equipo de ST recomienda. Selección curada con las fragancias más vendidas, mejores valoradas y favoritas del local.',
    intro: 'Esta es la selección curada por el equipo de ST: los perfumes que más se venden, los que mejor valoran nuestros clientes, y los favoritos personales del staff. Si tenés dudas, empezá por acá.',
    redirect: '/#destacados',
    filter: (p) => !p.esSet
  },

  // MARCAS — el redirect dispara una búsqueda automática con el nombre
  // de la marca al volver al catálogo (ver handler ?q= en app.js).
  'lattafa': {
    type: 'brand',
    h1: 'Perfumes Lattafa',
    title: 'Comprar Lattafa Originales en Argentina | ST Perfumería Comodoro',
    description: 'Perfumes Lattafa originales con envío a todo el país. Khamrah, Yara, Asad, Velvet Oud. Fragancias árabes premium con 3 cuotas sin interés.',
    intro: 'Lattafa es una de las casas árabes más reconocidas del mundo. Conocida por fragancias como Khamrah, Yara, Asad y Velvet Oud, ofrece intensidad, proyección y precio accesible. Catálogo completo en ST.',
    redirect: '/?q=Lattafa#catalogo',
    filter: (p) => /lattafa/i.test(p.marca_real || p.marca || '')
  },
  'afnan': {
    type: 'brand',
    h1: 'Perfumes Afnan',
    title: 'Comprar Afnan Originales en Argentina | 9PM, 9AM, Supremacy | ST',
    description: 'Perfumes Afnan originales: 9PM, 9AM, Supremacy y más. Fragancias árabes intensas con envío a todo Argentina y 3 cuotas sin interés.',
    intro: 'Afnan es referencia en el mundo árabe con líneas como 9PM, 9AM y Supremacy. Perfumes intensos, modernos y muy seductores. En ST tenemos el catálogo completo importado original con envíos a todo el país.',
    redirect: '/?q=Afnan#catalogo',
    filter: (p) => /afnan/i.test(p.marca_real || p.marca || '')
  },
  'armaf': {
    type: 'brand',
    h1: 'Perfumes Armaf',
    title: 'Comprar Armaf Originales en Argentina | Club de Nuit, Tag Her | ST',
    description: 'Perfumes Armaf originales: Club de Nuit Intense, Tag Her, Odyssey. Fragancias árabes premium con 3 cuotas sin interés y envíos a todo el país.',
    intro: 'Armaf es la casa árabe que captura aromas legendarios a precio accesible. Famosa por Club de Nuit Intense, Tag Her y Odyssey. Comprá Armaf original en ST con envío a todo Argentina y 3 cuotas sin interés.',
    redirect: '/?q=Armaf#catalogo',
    filter: (p) => /armaf/i.test(p.marca_real || p.marca || '')
  },
  'maison-alhambra': {
    type: 'brand',
    h1: 'Perfumes Maison Alhambra',
    title: 'Comprar Maison Alhambra Originales en Argentina | ST Perfumería',
    description: 'Perfumes Maison Alhambra originales con envío a todo el país. Fragancias árabes premium inspiradas en clásicos europeos. 3 cuotas sin interés.',
    intro: 'Maison Alhambra es la casa árabe que mejor reinterpreta clásicos europeos a precios accesibles. Fragancias elegantes, sofisticadas y con gran proyección. Catálogo completo en ST con envíos a toda Argentina.',
    redirect: '/?q=Alhambra#catalogo',
    filter: (p) => /alhambra/i.test(p.marca_real || p.marca || '')
  },
  'rasasi': {
    type: 'brand',
    h1: 'Perfumes Rasasi',
    title: 'Comprar Rasasi Originales en Argentina | ST Perfumería Comodoro',
    description: 'Perfumes Rasasi originales con envío a todo el país. Fragancias árabes tradicionales con identidad oriental. 3 cuotas sin interés.',
    intro: 'Rasasi es una casa histórica del mundo árabe con identidad oriental marcada. Fragancias intensas, tradicionales y con personalidad. Comprá Rasasi original en ST con envíos a todo Argentina y 3 cuotas sin interés.',
    redirect: '/?q=Rasasi#catalogo',
    filter: (p) => /rasasi/i.test(p.marca_real || p.marca || '')
  }
};

// ─────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  loadPerfumes();

  const slug = (req.query.slug || '').toLowerCase().replace(/^\/+|\/+$/g, '');
  const config = PAGES[slug];

  if (!config) {
    res.writeHead(302, { Location: BASE_URL });
    res.end();
    return;
  }

  const botRequest = isBot(req.headers['user-agent']);
  const matches = PERFUMES.filter(config.filter).slice(0, 30); // max 30 para no sobrecargar HTML

  const fullUrl = BASE_URL + '/' + slug;

  // Schema.org CollectionPage + ItemList
  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": fullUrl + '#collection',
    "url": fullUrl,
    "name": config.h1 + ' · ST Perfumería',
    "description": config.description,
    "inLanguage": "es-AR",
    "isPartOf": { "@id": BASE_URL + "/#website" },
    "about": { "@id": BASE_URL + "/#business" },
    "mainEntity": {
      "@type": "ItemList",
      "name": config.h1,
      "numberOfItems": matches.length,
      "itemListElement": matches.slice(0, 12).map((p, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "url": BASE_URL + '/perfume/' + p.slug,
        "name": p.name
      }))
    }
  };

  // BreadcrumbList
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE_URL },
      { "@type": "ListItem", "position": 2, "name": "Catálogo", "item": BASE_URL + '/#catalogo' },
      { "@type": "ListItem", "position": 3, "name": config.h1, "item": fullUrl }
    ]
  };

  // OG image dinámica (reusa /api/og con datos de la categoría)
  const ogImage = BASE_URL + '/api/og?'
    + 'name=' + encodeURIComponent(config.h1)
    + '&brand=' + encodeURIComponent('ST Perfumería')
    + '&cat=' + encodeURIComponent(matches.length + ' fragancias')
    + '&img=' + encodeURIComponent(BASE_URL + '/img/logo-st.webp');

  // Lista visible para bots (rica en contenido + internal links a perfumes)
  const productListHTML = matches.slice(0, 20).map(p => {
    const brand = p.marca_real || p.marca || '';
    const cat = p.cat || '';
    return '<li><a href="' + BASE_URL + '/perfume/' + esc(p.slug) + '">'
      + '<strong>' + esc(p.name) + '</strong>'
      + (brand ? ' — ' + esc(brand) : '')
      + (cat ? ' · <span>' + esc(cat) + '</span>' : '')
      + '</a></li>';
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="es-AR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="robots" content="index, follow, max-image-preview:large"/>
  <title>${esc(config.title)}</title>
  <meta name="description" content="${esc(config.description)}"/>
  <link rel="canonical" href="${fullUrl}"/>
  <link rel="alternate" hreflang="es-AR" href="${fullUrl}"/>
  <link rel="alternate" hreflang="es" href="${fullUrl}"/>

  <meta property="og:title" content="${esc(config.title)}"/>
  <meta property="og:description" content="${esc(config.description)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:image" content="${esc(ogImage)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${fullUrl}"/>
  <meta property="og:locale" content="es_AR"/>
  <meta property="og:site_name" content="ST Scent &amp; Textures"/>

  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(config.title)}"/>
  <meta name="twitter:description" content="${esc(config.description)}"/>
  <meta name="twitter:image" content="${esc(ogImage)}"/>

  <link rel="icon" type="image/png" href="${BASE_URL}/img/logo-st.webp"/>
  <script type="application/ld+json">${JSON.stringify(itemListSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>

  ${botRequest ? '<!-- bot detected: serve full HTML for indexing -->' : `<script>
    // Solo usuarios reales: redirigimos al catálogo aplicando el filtro.
    // Los bots se quedan en esta página con HTML rico para indexar.
    window.location.replace('${BASE_URL}${config.redirect}');
  </script>`}

  <style>
    body { background:#0a0a0a; color:#f0ede8; font-family:-apple-system,BlinkMacSystemFont,sans-serif; margin:0; padding:0; line-height:1.6; }
    .lp-wrap { max-width:900px; margin:0 auto; padding:2rem 1.5rem; }
    .lp-eyebrow { color:#E8B800; font-size:.7rem; letter-spacing:.2em; text-transform:uppercase; font-weight:600; }
    h1 { font-size:2.2rem; margin:.5rem 0 1rem; color:#fff; line-height:1.1; }
    .lp-intro { color:#bbb; font-size:1.05rem; margin-bottom:2rem; }
    .lp-cta { display:inline-block; background:#E8B800; color:#000; padding:.8rem 1.4rem; border-radius:8px; text-decoration:none; font-weight:700; letter-spacing:.05em; margin-bottom:2rem; }
    .lp-list { list-style:none; padding:0; }
    .lp-list li { padding:.6rem 0; border-bottom:1px solid rgba(255,255,255,.06); }
    .lp-list a { color:#f0ede8; text-decoration:none; transition:color .2s; }
    .lp-list a:hover { color:#E8B800; }
    .lp-list strong { color:#fff; }
    .lp-list span { color:#888; font-size:.8rem; }
    .lp-footer { margin-top:3rem; padding-top:1.5rem; border-top:1px solid rgba(255,255,255,.08); color:#888; font-size:.85rem; }
    .lp-footer a { color:#E8B800; }
  </style>
</head>
<body>
  <div class="lp-wrap">
    <p class="lp-eyebrow">${esc(config.type === 'brand' ? 'Marca' : 'Categoría')}</p>
    <h1>${esc(config.h1)}</h1>
    <p class="lp-intro">${esc(config.intro)}</p>
    <a href="${BASE_URL}${config.redirect}" class="lp-cta">Ver catálogo completo →</a>

    ${matches.length > 0 ? `
    <h2 style="font-size:1.3rem;margin-bottom:1rem;color:#fff;">Algunos perfumes de esta sección:</h2>
    <ul class="lp-list">${productListHTML}</ul>
    ` : ''}

    <div class="lp-footer">
      <p><strong>ST Scent &amp; Textures</strong> · Perfumería árabe original en Comodoro Rivadavia.</p>
      <p>San Martín 570, Local N8 · <a href="https://wa.me/5492975416017">WhatsApp +54 9 297 541-6017</a></p>
      <p>Volver al <a href="${BASE_URL}">catálogo principal</a> · <a href="${BASE_URL}/#explorar">Otras categorías</a></p>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
};
