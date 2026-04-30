/**
 * Vercel Serverless Function — Preview de perfume para compartir
 * GET /perfume/:slug  →  rewrite a /api/share?slug=:slug
 *
 * Qué hace:
 *   - Lee el catálogo base desde perfumes.js
 *   - Merge con perfume_overrides de Supabase (foto, precio editados en admin)
 *   - Renderiza OG + Twitter Card + Schema.org Product (rich snippets Google)
 *   - Redirige al index con el perfume resaltado
 *
 * Cache: 1h en el CDN de Vercel + stale-while-revalidate para no pegarle a
 * Supabase en cada scrape de WhatsApp.
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const BASE_URL = 'https://www.stperfumeria.com';

let PERFUMES = [];

// Parse perfumes.js (usa `const PERFUMES = [...]`)
function loadPerfumes() {
  if (PERFUMES.length > 0) return;
  try {
    const filePath = path.join(process.cwd(), 'perfumes.js');
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/const\s+PERFUMES\s*=\s*(\[[\s\S]*\]);?\s*$/m);
    if (match) {
      PERFUMES = eval(match[1]);
    }
  } catch (e) {
    console.error('Error loading perfumes:', e);
  }
}

// Lee overrides del perfume específico (foto/precio editados desde admin)
async function getOverride(slug) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const url = SUPABASE_URL + '/rest/v1/perfume_overrides?slug=eq.' + encodeURIComponent(slug) + '&select=*';
    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      }
    });
    if (!r.ok) return null;
    const arr = await r.json();
    return (arr && arr.length) ? arr[0] : null;
  } catch (e) {
    console.error('Error fetching override:', e);
    return null;
  }
}

// Detector de bots/crawlers: si pasa por aca lo dejamos en la pagina estatica
// (sin JS redirect) para que Google la indexe en /perfume/:slug y los scrapers
// de WhatsApp/Facebook/Twitter le saquen los meta OG. Para usuarios reales,
// seguimos redirigiendo al catalogo con el perfume resaltado.
function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return /bot|crawler|spider|whatsapp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot|bingbot|duckduckbot|yandexbot|applebot|baiduspider|googleother|adsbot|mediapartners|google-inspectiontool/.test(ua);
}

module.exports = async (req, res) => {
  loadPerfumes();

  const slug = req.query.slug || '';
  const perfumeBase = PERFUMES.find(p => p.slug === slug);

  if (!perfumeBase) {
    res.writeHead(302, { Location: BASE_URL });
    res.end();
    return;
  }

  const botRequest = isBot(req.headers['user-agent']);

  // Merge con overrides (foto/precio editados en admin)
  const override = await getOverride(slug);
  const perfume = Object.assign({}, perfumeBase, override || {});

  const title = perfume.name + ' — ST Perfumería';
  const brand = perfume.marca_real || perfume.marca || '';
  const cat = perfume.cat || '';
  const perfil = perfume.perfil || '';
  const price = perfume.promo || perfume.price || '';
  const priceNum = parseFloat(String(price).replace(/,/g, ''));
  const priceFormatted = !isNaN(priceNum) ? '$' + Math.round(priceNum).toLocaleString('es-AR').replace(/,/g, '.') : '';

  const description = perfume.name + ' por ' + brand
    + (cat ? ' | ' + cat : '')
    + (perfil ? ' | ' + perfil : '')
    + (priceFormatted ? ' | ' + priceFormatted : '')
    + ' — Perfumería árabe original en Comodoro Rivadavia.';

  // Foto raw del perfume (para schema.org Product, donde queremos la imagen real)
  const rawImage = perfume.foto
    ? (perfume.foto.startsWith('http') ? perfume.foto : BASE_URL + (perfume.foto.startsWith('/') ? '' : '/') + perfume.foto)
    : BASE_URL + '/img/og-preview.webp';

  // OG image dinámica — generada por /api/og con el contexto del perfume.
  // Resultado: imagen 1200x630 con foto + nombre + marca + precio + branding.
  // Esto es lo que verán en WhatsApp/Twitter/Facebook al compartir el link.
  const ogImage = BASE_URL + '/api/og?'
    + 'name='  + encodeURIComponent(perfume.name)
    + '&brand=' + encodeURIComponent(brand || '')
    + '&price=' + encodeURIComponent(price || '')
    + '&cat='   + encodeURIComponent(cat || '')
    + '&img='   + encodeURIComponent(rawImage);

  // image se usa en schema.org/Product (queremos la foto pura del producto)
  const image = rawImage;

  const imageAlt = perfume.name + (brand ? ' de ' + brand : '') + ' — ST Scent & Textures';

  // Schema.org Product enriquecido para rich snippets en Google
  // (precio, marca, disponibilidad, condición, vendedor + áreas servidas).
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": perfume.name,
    "description": description,
    "image": image,
    "url": BASE_URL + '/perfume/' + slug,
    "sku": slug,
    "mpn": slug,
    "brand": brand ? { "@type": "Brand", "name": brand } : undefined,
    "category": cat || 'Perfume',
    "offers": !isNaN(priceNum) ? {
      "@type": "Offer",
      "url": BASE_URL + '/perfume/' + slug,
      "priceCurrency": "ARS",
      "price": Math.round(priceNum),
      "priceValidUntil": new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10),
      "availability": "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      "areaServed": [
        { "@type": "Country", "name": "Argentina" },
        { "@type": "City", "name": "Comodoro Rivadavia" }
      ],
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "AR" }
      },
      "seller": {
        "@type": "Organization",
        "name": "ST Scent & Textures",
        "url": BASE_URL
      }
    } : undefined
  };
  // Limpiar undefined
  Object.keys(productSchema).forEach(k => productSchema[k] === undefined && delete productSchema[k]);
  if (productSchema.offers) {
    Object.keys(productSchema.offers).forEach(k => productSchema.offers[k] === undefined && delete productSchema.offers[k]);
  }

  // BreadcrumbList: Inicio › Catálogo › [Categoría] › [Perfume]
  // Mejora la navegación visible en resultados de Google.
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio",   "item": BASE_URL },
      { "@type": "ListItem", "position": 2, "name": "Catálogo", "item": BASE_URL + '/#catalogo' },
      ...(cat ? [{ "@type": "ListItem", "position": 3, "name": "Perfumes " + cat, "item": BASE_URL + '/#catalogo' }] : []),
      { "@type": "ListItem", "position": cat ? 4 : 3, "name": perfume.name, "item": BASE_URL + '/perfume/' + slug }
    ]
  };

  const html = `<!DOCTYPE html>
<html lang="es-AR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}"/>
  <link rel="canonical" href="${BASE_URL}/perfume/${esc(slug)}"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:type" content="product"/>
  <meta property="og:image" content="${esc(ogImage)}"/>
  <meta property="og:image:secure_url" content="${esc(ogImage)}"/>
  <meta property="og:image:type" content="image/png"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:image:alt" content="${esc(imageAlt)}"/>
  <meta property="og:url" content="${BASE_URL}/perfume/${esc(slug)}"/>
  <meta property="og:locale" content="es_AR"/>
  <meta property="og:site_name" content="ST Scent &amp; Textures"/>
  ${priceFormatted ? `<meta property="product:price:amount" content="${Math.round(priceNum)}"/>
  <meta property="product:price:currency" content="ARS"/>` : ''}
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(ogImage)}"/>
  <meta name="twitter:image:alt" content="${esc(imageAlt)}"/>
  <link rel="icon" type="image/png" href="${BASE_URL}/img/logo-st.webp"/>
  <script type="application/ld+json">${JSON.stringify(productSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  ${botRequest ? '<!-- bot detected: no JS redirect, full page indexable -->' : `<script>
    // Redirect al home con el perfume resaltado.
    // SOLO para usuarios reales: si es bot/crawler (Googlebot, WhatsApp, Facebook,
    // Twitter, etc.) se queda con la pagina estatica + meta tags + Schema.org.
    // Asi Google indexa /perfume/:slug en vez de marcarla "Pagina con redireccion"
    // y los scrapers de redes sacan la preview OG correctamente.
    window.location.replace('${BASE_URL}/?perfume=${esc(slug)}');
  </script>`}
</head>
<body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="text-align:center;padding:2rem;">
    <p style="color:#e8b800;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;">ST Perfumería</p>
    <h1 style="font-size:1.5rem;margin:.5rem 0;">${esc(perfume.name)}</h1>
    <p style="color:#888;">${esc(brand)}${priceFormatted ? ' — ' + priceFormatted : ''}</p>
    <p style="color:#888;margin-top:1rem;">Redirigiendo...</p>
    <p style="margin-top:1.5rem;"><a href="${BASE_URL}/?perfume=${esc(slug)}" style="color:#e8b800;">Ir al catálogo</a></p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
};

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
