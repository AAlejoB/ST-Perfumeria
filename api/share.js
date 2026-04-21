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

module.exports = async (req, res) => {
  loadPerfumes();

  const slug = req.query.slug || '';
  const perfumeBase = PERFUMES.find(p => p.slug === slug);

  if (!perfumeBase) {
    res.writeHead(302, { Location: BASE_URL });
    res.end();
    return;
  }

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

  const image = perfume.foto
    ? (perfume.foto.startsWith('http') ? perfume.foto : BASE_URL + (perfume.foto.startsWith('/') ? '' : '/') + perfume.foto)
    : BASE_URL + '/img/og-preview.webp';

  const imageAlt = perfume.name + (brand ? ' de ' + brand : '') + ' — ST Scent & Textures';

  // Schema.org Product para rich snippets en Google (precio, marca, disponibilidad)
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": perfume.name,
    "description": description,
    "image": image,
    "url": BASE_URL + '/perfume/' + slug,
    "sku": slug,
    "brand": brand ? { "@type": "Brand", "name": brand } : undefined,
    "category": cat || undefined,
    "offers": !isNaN(priceNum) ? {
      "@type": "Offer",
      "url": BASE_URL + '/perfume/' + slug,
      "priceCurrency": "ARS",
      "price": Math.round(priceNum),
      "availability": "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      "seller": {
        "@type": "Organization",
        "name": "ST Scent & Textures"
      }
    } : undefined
  };
  // Limpiar undefined
  Object.keys(productSchema).forEach(k => productSchema[k] === undefined && delete productSchema[k]);
  if (productSchema.offers) {
    Object.keys(productSchema.offers).forEach(k => productSchema.offers[k] === undefined && delete productSchema.offers[k]);
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}"/>
  <link rel="canonical" href="${BASE_URL}/perfume/${esc(slug)}"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:type" content="product"/>
  <meta property="og:image" content="${esc(image)}"/>
  <meta property="og:image:width" content="800"/>
  <meta property="og:image:height" content="800"/>
  <meta property="og:image:alt" content="${esc(imageAlt)}"/>
  <meta property="og:url" content="${BASE_URL}/perfume/${esc(slug)}"/>
  <meta property="og:locale" content="es_AR"/>
  <meta property="og:site_name" content="ST Scent &amp; Textures"/>
  ${priceFormatted ? `<meta property="product:price:amount" content="${Math.round(priceNum)}"/>
  <meta property="product:price:currency" content="ARS"/>` : ''}
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(image)}"/>
  <meta name="twitter:image:alt" content="${esc(imageAlt)}"/>
  <link rel="icon" type="image/png" href="${BASE_URL}/img/logo-st.webp"/>
  <script type="application/ld+json">${JSON.stringify(productSchema)}</script>
  <script>
    // Redirect al home con el perfume resaltado (solo navegadores, los bots
    // de WhatsApp/Facebook/Google no ejecutan JS y se quedan con los meta tags)
    window.location.replace('${BASE_URL}/?perfume=${esc(slug)}');
  </script>
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
