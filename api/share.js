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
  ${botRequest ? '<!-- bot detected: no JS redirect, full page indexable -->' : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: linear-gradient(180deg, #0a0a0a 0%, #131316 100%); color: #f0ede8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; min-height: 100vh; line-height: 1.55; padding: 2rem 1.2rem; }
    .pp-wrap { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 1.6rem; }
    .pp-eyebrow { color: #E8B800; font-size: .65rem; letter-spacing: .25em; text-transform: uppercase; font-weight: 600; }
    .pp-img-wrap { width: 100%; max-width: 320px; aspect-ratio: 1/1; background: #1a1a1d; border-radius: 16px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(232,184,0,.18); }
    .pp-img-wrap img { width: 100%; height: 100%; object-fit: contain; }
    .pp-img-ph { font-family: "Playfair Display", serif; font-size: 5rem; font-weight: 300; color: #E8B800; opacity: .4; }
    .pp-name { font-family: "Playfair Display", Georgia, serif; font-size: clamp(1.5rem, 5vw, 2.4rem); color: #fff; text-align: center; line-height: 1.15; }
    .pp-brand { color: #888; font-size: .9rem; letter-spacing: .12em; text-transform: uppercase; text-align: center; }
    .pp-tags { display: flex; flex-wrap: wrap; gap: .4rem; justify-content: center; }
    .pp-tag { font-size: .68rem; padding: .3rem .7rem; border: 1px solid rgba(232,184,0,.3); border-radius: 999px; color: #E8B800; letter-spacing: .05em; }
    .pp-price { font-size: 1.7rem; color: #E8B800; font-weight: 700; text-align: center; }
    .pp-price-sub { color: #888; font-size: .8rem; text-align: center; }
    .pp-notes { background: rgba(232,184,0,.05); border: 1px solid rgba(232,184,0,.1); border-radius: 10px; padding: 1rem 1.2rem; width: 100%; }
    .pp-note-row { display: flex; gap: .6rem; align-items: baseline; padding: .35rem 0; border-bottom: 1px solid rgba(255,255,255,.05); }
    .pp-note-row:last-child { border-bottom: none; }
    .pp-note-label { color: #E8B800; font-size: .65rem; letter-spacing: .15em; text-transform: uppercase; font-weight: 600; min-width: 80px; }
    .pp-note-text { color: #ccc; font-size: .85rem; flex: 1; }
    .pp-cta-row { display: flex; flex-direction: column; gap: .65rem; width: 100%; max-width: 380px; }
    .pp-cta { display: flex; align-items: center; justify-content: center; gap: .5rem; padding: .95rem 1.2rem; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: .95rem; letter-spacing: .03em; transition: transform .15s ease, box-shadow .15s ease; }
    .pp-cta-primary { background: #E8B800; color: #000; box-shadow: 0 4px 14px rgba(232,184,0,.25); }
    .pp-cta-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(232,184,0,.4); }
    .pp-cta-wa { background: #25D366; color: #000; }
    .pp-cta-wa:hover { transform: translateY(-1px); }
    .pp-cta-ghost { background: transparent; color: #E8B800; border: 1px solid rgba(232,184,0,.4); }
    .pp-cta-ghost:hover { background: rgba(232,184,0,.08); }
    .pp-footer { color: #666; font-size: .75rem; text-align: center; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,.06); width: 100%; }
    .pp-footer a { color: #888; }
  </style>
</head>
<body>
  <div class="pp-wrap">
    <p class="pp-eyebrow">ST · Perfumería · Comodoro Rivadavia</p>
    <div class="pp-img-wrap">
      ${perfume.foto
        ? `<img src="${esc(image)}" alt="${esc(imageAlt)}" loading="eager"/>`
        : `<span class="pp-img-ph">${esc(perfume.name.charAt(0) || 'S')}</span>`}
    </div>
    <h1 class="pp-name">${esc(perfume.name)}</h1>
    ${brand ? `<p class="pp-brand">${esc(brand)}</p>` : ''}
    <div class="pp-tags">
      ${cat ? `<span class="pp-tag">${esc(cat)}</span>` : ''}
      ${perfil ? `<span class="pp-tag">${esc(perfil)}</span>` : ''}
      <span class="pp-tag">Original</span>
    </div>
    ${priceFormatted ? `
    <div>
      <p class="pp-price">${priceFormatted}</p>
      <p class="pp-price-sub">3 cuotas sin interés · 10% off efectivo/transferencia</p>
    </div>
    ` : ''}
    ${(perfume.notas_salida || perfume.notas_corazon || perfume.notas_base) ? `
    <div class="pp-notes">
      ${perfume.notas_salida ? `<div class="pp-note-row"><span class="pp-note-label">Salida</span><span class="pp-note-text">${esc(perfume.notas_salida)}</span></div>` : ''}
      ${perfume.notas_corazon ? `<div class="pp-note-row"><span class="pp-note-label">Corazón</span><span class="pp-note-text">${esc(perfume.notas_corazon)}</span></div>` : ''}
      ${perfume.notas_base ? `<div class="pp-note-row"><span class="pp-note-label">Base</span><span class="pp-note-text">${esc(perfume.notas_base)}</span></div>` : ''}
    </div>
    ` : ''}
    <div class="pp-cta-row">
      <a href="${BASE_URL}/?perfume=${esc(slug)}" class="pp-cta pp-cta-primary">
        Ver en el catálogo →
      </a>
      <a href="https://wa.me/5492975416017?text=${encodeURIComponent('Hola! Me interesa el ' + perfume.name + '. ¿Tienen disponibilidad?')}" target="_blank" rel="noopener" class="pp-cta pp-cta-wa">
        💬 Consultar por WhatsApp
      </a>
      <a href="${BASE_URL}" class="pp-cta pp-cta-ghost">
        Ver catálogo completo
      </a>
    </div>
    <p class="pp-footer">
      San Martín 570, Local N8 · Comodoro Rivadavia, Chubut<br/>
      Lun-Vie 10-20 hs · Sáb 10-14 hs
    </p>
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
