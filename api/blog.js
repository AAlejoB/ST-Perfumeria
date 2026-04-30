/**
 * Vercel Serverless Function — Blog/Editorial de ST
 *   GET /blog            → listado de posts
 *   GET /blog/:slug      → post individual
 *
 * Posts en /content/blog/*.json + /content/blog/index.json (lista).
 *
 * Schemas:
 *   - BlogPosting + Article por post
 *   - Blog + ItemList en index
 *   - BreadcrumbList en ambos
 *
 * Cache: 1h CDN + stale-while-revalidate 24h.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.stperfumeria.com';
const BLOG_DIR = 'content/blog';

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

function loadIndex() {
  try {
    const filePath = path.join(process.cwd(), BLOG_DIR, 'index.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { return { posts: [] }; }
}

function loadPost(slug) {
  try {
    const filePath = path.join(process.cwd(), BLOG_DIR, slug + '.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { return null; }
}

function renderContent(blocks) {
  return (blocks || []).map(block => {
    if (block.type === 'p') return '<p>' + esc(block.text) + '</p>';
    if (block.type === 'h2') return '<h2>' + esc(block.text) + '</h2>';
    if (block.type === 'h3') return '<h3>' + esc(block.text) + '</h3>';
    if (block.type === 'ul') {
      return '<ul>' + (block.items || []).map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
    }
    if (block.type === 'quote') return '<blockquote>' + esc(block.text) + '</blockquote>';
    return '';
  }).join('\n');
}

function blogStyles() {
  return `<style>
    body { background:#0a0a0a; color:#f0ede8; font-family:-apple-system,BlinkMacSystemFont,sans-serif; margin:0; line-height:1.7; }
    .blog-wrap { max-width:760px; margin:0 auto; padding:2.5rem 1.5rem; }
    .blog-eyebrow { color:#E8B800; font-size:.7rem; letter-spacing:.2em; text-transform:uppercase; font-weight:600; }
    .blog-meta { color:#888; font-size:.78rem; margin-top:.5rem; margin-bottom:2rem; }
    h1 { font-size:2.2rem; line-height:1.2; color:#fff; margin:.5rem 0 1rem; }
    h2 { font-size:1.4rem; color:#fff; margin:2rem 0 .8rem; line-height:1.3; }
    h3 { font-size:1.1rem; color:#E8B800; margin:1.5rem 0 .5rem; }
    p { color:#d4d4d4; margin-bottom:1rem; font-size:1.02rem; }
    ul { color:#d4d4d4; padding-left:1.4rem; margin-bottom:1.2rem; }
    li { margin-bottom:.5rem; }
    blockquote { border-left:3px solid #E8B800; padding:.5rem 1.2rem; margin:1.5rem 0; color:#bbb; font-style:italic; background:rgba(232,184,0,.04); }
    .blog-cta { display:inline-block; background:#E8B800; color:#000; padding:.75rem 1.4rem; border-radius:8px; text-decoration:none; font-weight:700; margin-top:1.5rem; }
    .blog-list { list-style:none; padding:0; margin-top:2rem; }
    .blog-list-item { padding:1.2rem 0; border-bottom:1px solid rgba(255,255,255,.08); }
    .blog-list-item a { color:#fff; text-decoration:none; font-size:1.15rem; font-weight:600; display:block; margin-bottom:.3rem; }
    .blog-list-item a:hover { color:#E8B800; }
    .blog-list-meta { font-size:.75rem; color:#888; }
    .blog-list-desc { color:#bbb; font-size:.9rem; margin-top:.4rem; }
    .blog-footer { margin-top:3rem; padding-top:1.5rem; border-top:1px solid rgba(255,255,255,.08); font-size:.85rem; color:#888; }
    .blog-footer a { color:#E8B800; }
  </style>`;
}

// ─────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const slug = (req.query.slug || '').toLowerCase().replace(/^\/+|\/+$/g, '');
  const botRequest = isBot(req.headers['user-agent']);

  // ── HOME DEL BLOG ──────────────────────────────────────────────
  if (!slug || slug === 'index') {
    const index = loadIndex();
    const url = BASE_URL + '/blog';

    const title = 'Blog ST Perfumería · Guías de perfumes árabes en Argentina';
    const description = 'Guías y reseñas para elegir perfumes árabes en Argentina. Comparativas, notas olfativas, recomendaciones del equipo de ST en Comodoro Rivadavia.';

    const blogSchema = {
      "@context": "https://schema.org",
      "@type": "Blog",
      "@id": url,
      "url": url,
      "name": "Blog ST Perfumería",
      "description": description,
      "inLanguage": "es-AR",
      "publisher": { "@id": BASE_URL + "/#organization" },
      "blogPost": index.posts.map(p => ({
        "@type": "BlogPosting",
        "headline": p.title,
        "url": BASE_URL + "/blog/" + p.slug,
        "datePublished": p.date,
        "description": p.description
      }))
    };

    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE_URL },
        { "@type": "ListItem", "position": 2, "name": "Blog", "item": url }
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
  <link rel="canonical" href="${url}"/>
  <link rel="alternate" hreflang="es-AR" href="${url}"/>

  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${url}"/>
  <meta property="og:locale" content="es_AR"/>
  <meta property="og:site_name" content="ST Scent &amp; Textures"/>

  <link rel="icon" type="image/png" href="${BASE_URL}/img/logo-st.webp"/>
  <script type="application/ld+json">${JSON.stringify(blogSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  ${blogStyles()}
</head>
<body>
  <div class="blog-wrap">
    <p class="blog-eyebrow">Blog ST</p>
    <h1>Guías y reseñas de perfumes árabes</h1>
    <p style="color:#bbb;">Contenido honesto del equipo de ST en Comodoro Rivadavia. Sin tecnicismos vacíos, sin presión por vender.</p>

    <ul class="blog-list">
      ${index.posts.map(p => `
        <li class="blog-list-item">
          <a href="${BASE_URL}/blog/${esc(p.slug)}">${esc(p.title)}</a>
          <p class="blog-list-meta">${esc(p.category || 'Guía')} · ${esc(p.date)} · ${esc(p.readTime || '5 min')}</p>
          <p class="blog-list-desc">${esc(p.description)}</p>
        </li>
      `).join('')}
    </ul>

    <div class="blog-footer">
      <p>Volver al <a href="${BASE_URL}">catálogo</a> · <a href="${BASE_URL}/perfumes-arabes">Perfumes árabes</a> · <a href="https://wa.me/5492975416017">WhatsApp</a></p>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(html);
    return;
  }

  // ── POST INDIVIDUAL ────────────────────────────────────────────
  const post = loadPost(slug);
  if (!post) {
    res.writeHead(302, { Location: BASE_URL + '/blog' });
    res.end();
    return;
  }

  const url = BASE_URL + '/blog/' + post.slug;
  const ogImage = BASE_URL + '/api/og?'
    + 'name=' + encodeURIComponent(post.h1 || post.title)
    + '&brand=' + encodeURIComponent('Blog ST')
    + '&cat=' + encodeURIComponent(post.category || 'Guía');

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": url,
    "url": url,
    "headline": post.title,
    "description": post.description,
    "datePublished": post.date,
    "dateModified": post.date,
    "inLanguage": "es-AR",
    "image": post.image || (BASE_URL + '/img/og-preview.webp'),
    "author": {
      "@type": "Organization",
      "name": post.author || "ST Perfumería",
      "url": BASE_URL
    },
    "publisher": { "@id": BASE_URL + "/#organization" },
    "mainEntityOfPage": { "@type": "WebPage", "@id": url },
    "keywords": (post.keywords || []).join(", ")
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE_URL },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": BASE_URL + '/blog' },
      { "@type": "ListItem", "position": 3, "name": post.title, "item": url }
    ]
  };

  const html = `<!DOCTYPE html>
<html lang="es-AR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="robots" content="index, follow, max-image-preview:large"/>
  <title>${esc(post.title)}</title>
  <meta name="description" content="${esc(post.description)}"/>
  <meta name="keywords" content="${esc((post.keywords || []).join(', '))}"/>
  <meta name="author" content="${esc(post.author || 'ST Perfumería')}"/>
  <link rel="canonical" href="${url}"/>
  <link rel="alternate" hreflang="es-AR" href="${url}"/>

  <meta property="og:title" content="${esc(post.title)}"/>
  <meta property="og:description" content="${esc(post.description)}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:image" content="${esc(ogImage)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${url}"/>
  <meta property="og:locale" content="es_AR"/>
  <meta property="og:site_name" content="ST Scent &amp; Textures"/>
  <meta property="article:published_time" content="${esc(post.date)}"/>
  <meta property="article:author" content="${esc(post.author || 'ST Perfumería')}"/>
  <meta property="article:section" content="${esc(post.category || 'Guía')}"/>

  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(post.title)}"/>
  <meta name="twitter:description" content="${esc(post.description)}"/>
  <meta name="twitter:image" content="${esc(ogImage)}"/>

  <link rel="icon" type="image/png" href="${BASE_URL}/img/logo-st.webp"/>
  <script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  ${blogStyles()}
</head>
<body>
  <div class="blog-wrap">
    <p class="blog-eyebrow">${esc(post.category || 'Guía')}</p>
    <h1>${esc(post.h1 || post.title)}</h1>
    <p class="blog-meta">${esc(post.date)} · por ${esc(post.author || 'ST Perfumería')}</p>

    ${renderContent(post.content)}

    <a href="${BASE_URL}" class="blog-cta">Ver catálogo de perfumes →</a>

    <div class="blog-footer">
      <p><strong>ST Scent &amp; Textures</strong> · San Martín 570, Local N8, Comodoro Rivadavia</p>
      <p>Más artículos en el <a href="${BASE_URL}/blog">blog</a> · <a href="${BASE_URL}/perfumes-arabes">Perfumes árabes</a> · <a href="https://wa.me/5492975416017">WhatsApp</a></p>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
};
