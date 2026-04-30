/**
 * Vercel Serverless Function — Comparativas head-to-head entre 2 perfumes
 * GET /vs/khamrah-vs-asad → rewrite a /api/compare?slugs=khamrah-vs-asad
 *
 * Genera una página rica con:
 *   - H1 "Comparativa: A vs B"
 *   - Tabla comparativa (precio, marca, categoría, notas)
 *   - Schema.org Product x2 + ComparisonReview
 *   - OG dinámica con ambos productos
 *   - Internal links a cada perfume individual
 *
 * Estilo Apple /compare. Alta intención de compra.
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
  } catch (e) { console.error('Error loading perfumes:', e); }
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

function fmtPrice(p) {
  const raw = p.promo || p.price || '';
  const num = parseFloat(String(raw).replace(/,/g, '').replace(/\./g, ''));
  if (isNaN(num)) return '';
  return '$' + Math.round(num).toLocaleString('es-AR').replace(/,/g, '.');
}

module.exports = async (req, res) => {
  loadPerfumes();

  // Parsear "khamrah-vs-asad" → ["khamrah", "asad"]
  const slugs = (req.query.slugs || '').toLowerCase();
  const parts = slugs.split('-vs-');
  if (parts.length !== 2) {
    res.writeHead(302, { Location: BASE_URL });
    res.end();
    return;
  }

  const a = PERFUMES.find(p => p.slug === parts[0].trim());
  const b = PERFUMES.find(p => p.slug === parts[1].trim());

  if (!a || !b) {
    res.writeHead(302, { Location: BASE_URL });
    res.end();
    return;
  }

  const botRequest = isBot(req.headers['user-agent']);
  const fullUrl = BASE_URL + '/vs/' + parts[0] + '-vs-' + parts[1];

  const title = a.name + ' vs ' + b.name + ' — Comparativa | ST Perfumería';
  const description = 'Comparativa entre ' + a.name + ' (' + (a.marca_real || a.marca) + ') y ' + b.name + ' (' + (b.marca_real || b.marca) + '). Precio, notas, duración. Comprá el que más te convenza con 3 cuotas sin interés.';

  const aBrand = a.marca_real || a.marca || '';
  const bBrand = b.marca_real || b.marca || '';
  const aPrice = fmtPrice(a);
  const bPrice = fmtPrice(b);

  // OG image: usamos la imagen de A como base (podríamos hacer combo en el futuro)
  const aImg = a.foto ? (a.foto.startsWith('http') ? a.foto : BASE_URL + (a.foto.startsWith('/') ? '' : '/') + a.foto) : (BASE_URL + '/img/og-preview.webp');
  const ogImage = BASE_URL + '/api/og?'
    + 'name=' + encodeURIComponent(a.name + ' vs ' + b.name)
    + '&brand=' + encodeURIComponent(aBrand + ' · ' + bBrand)
    + '&cat=' + encodeURIComponent('Comparativa')
    + '&img=' + encodeURIComponent(aImg);

  // Schemas
  const productAUrl = BASE_URL + '/perfume/' + a.slug;
  const productBUrl = BASE_URL + '/perfume/' + b.slug;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE_URL },
      { "@type": "ListItem", "position": 2, "name": "Comparativas", "item": BASE_URL + '/#explorar' },
      { "@type": "ListItem", "position": 3, "name": a.name + ' vs ' + b.name, "item": fullUrl }
    ]
  };

  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Comparativa " + a.name + ' vs ' + b.name,
    "numberOfItems": 2,
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": a.name, "url": productAUrl },
      { "@type": "ListItem", "position": 2, "name": b.name, "url": productBUrl }
    ]
  };

  const html = `<!DOCTYPE html>
<html lang="es-AR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="robots" content="index, follow, max-image-preview:large"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}"/>
  <link rel="canonical" href="${fullUrl}"/>
  <link rel="alternate" hreflang="es-AR" href="${fullUrl}"/>

  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:image" content="${esc(ogImage)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${fullUrl}"/>
  <meta property="og:locale" content="es_AR"/>
  <meta property="og:site_name" content="ST Scent &amp; Textures"/>

  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(ogImage)}"/>

  <link rel="icon" type="image/png" href="${BASE_URL}/img/logo-st.webp"/>
  <script type="application/ld+json">${JSON.stringify(itemListSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>

  ${botRequest ? '' : `<script>
    setTimeout(function() {
      window.location.replace('${BASE_URL}/?perfume=${esc(parts[0])}');
    }, 4000);
  </script>`}

  <style>
    body { background:#0a0a0a; color:#f0ede8; font-family:-apple-system,BlinkMacSystemFont,sans-serif; margin:0; line-height:1.6; }
    .wrap { max-width:900px; margin:0 auto; padding:2rem 1.5rem; }
    .eyebrow { color:#E8B800; font-size:.7rem; letter-spacing:.2em; text-transform:uppercase; font-weight:600; }
    h1 { font-size:2rem; margin:.5rem 0 1.5rem; color:#fff; line-height:1.15; }
    .vs-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:2rem; }
    .vs-card { background:#111; border:1px solid rgba(232,184,0,.18); border-radius:12px; padding:1.5rem 1.2rem; }
    .vs-name { font-size:1.4rem; font-weight:700; color:#fff; margin-bottom:.3rem; }
    .vs-brand { font-size:.85rem; color:#888; margin-bottom:.8rem; }
    .vs-price { font-size:1.6rem; font-weight:700; color:#E8B800; margin:.5rem 0; }
    .vs-meta { font-size:.8rem; color:#bbb; }
    .vs-meta strong { color:#f0ede8; }
    .vs-cta { display:block; text-align:center; background:#E8B800; color:#000; padding:.7rem; border-radius:6px; text-decoration:none; font-weight:700; margin-top:1rem; }
    .vs-table { width:100%; border-collapse:collapse; background:#111; border-radius:12px; overflow:hidden; margin-bottom:2rem; }
    .vs-table th, .vs-table td { padding:.85rem 1rem; text-align:left; border-bottom:1px solid rgba(255,255,255,.06); font-size:.9rem; }
    .vs-table th { background:rgba(232,184,0,.08); color:#E8B800; font-weight:600; font-size:.7rem; letter-spacing:.1em; text-transform:uppercase; }
    .vs-table tr:last-child td { border-bottom:none; }
    .footer { margin-top:2rem; padding-top:1.5rem; border-top:1px solid rgba(255,255,255,.08); color:#888; font-size:.85rem; }
    .footer a { color:#E8B800; }
    @media (max-width:540px) { .vs-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="eyebrow">Comparativa</p>
    <h1>${esc(a.name)} <span style="color:#E8B800;">vs</span> ${esc(b.name)}</h1>

    <div class="vs-grid">
      <div class="vs-card">
        <p class="vs-name">${esc(a.name)}</p>
        <p class="vs-brand">${esc(aBrand)}</p>
        ${aPrice ? `<p class="vs-price">${aPrice}</p>` : ''}
        <p class="vs-meta"><strong>Categoría:</strong> ${esc(a.cat || '—')}</p>
        ${a.perfil ? `<p class="vs-meta"><strong>Perfil:</strong> ${esc(a.perfil)}</p>` : ''}
        <a href="${productAUrl}" class="vs-cta">Ver ${esc(a.name)} →</a>
      </div>
      <div class="vs-card">
        <p class="vs-name">${esc(b.name)}</p>
        <p class="vs-brand">${esc(bBrand)}</p>
        ${bPrice ? `<p class="vs-price">${bPrice}</p>` : ''}
        <p class="vs-meta"><strong>Categoría:</strong> ${esc(b.cat || '—')}</p>
        ${b.perfil ? `<p class="vs-meta"><strong>Perfil:</strong> ${esc(b.perfil)}</p>` : ''}
        <a href="${productBUrl}" class="vs-cta">Ver ${esc(b.name)} →</a>
      </div>
    </div>

    <h2 style="font-size:1.2rem;margin-bottom:1rem;color:#fff;">Tabla comparativa</h2>
    <table class="vs-table">
      <thead>
        <tr><th>Atributo</th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>Marca</strong></td><td>${esc(aBrand)}</td><td>${esc(bBrand)}</td></tr>
        <tr><td><strong>Categoría</strong></td><td>${esc(a.cat || '—')}</td><td>${esc(b.cat || '—')}</td></tr>
        <tr><td><strong>Perfil olfativo</strong></td><td>${esc(a.perfil || '—')}</td><td>${esc(b.perfil || '—')}</td></tr>
        <tr><td><strong>Notas de salida</strong></td><td>${esc(a.notas_salida || '—')}</td><td>${esc(b.notas_salida || '—')}</td></tr>
        <tr><td><strong>Notas de corazón</strong></td><td>${esc(a.notas_corazon || '—')}</td><td>${esc(b.notas_corazon || '—')}</td></tr>
        <tr><td><strong>Notas de base</strong></td><td>${esc(a.notas_base || '—')}</td><td>${esc(b.notas_base || '—')}</td></tr>
        <tr><td><strong>Precio</strong></td><td>${aPrice || '—'}</td><td>${bPrice || '—'}</td></tr>
      </tbody>
    </table>

    <div class="footer">
      <p>Ambos perfumes con <strong>3 cuotas sin interés</strong> y <strong>10% off</strong> en efectivo o transferencia. Envío a todo Argentina.</p>
      <p><a href="${BASE_URL}">Ver catálogo completo</a> · <a href="${BASE_URL}/perfumes-arabes">Perfumes árabes</a> · <a href="https://wa.me/5492975416017">WhatsApp</a></p>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
};
