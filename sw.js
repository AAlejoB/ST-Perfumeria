/**
 * Service Worker — ST Perfumería
 *
 * Responsabilidades:
 *   1. Push notifications (ya existente)
 *   2. Precache de assets críticos en install
 *   3. Cache strategies:
 *      - HTML navegación → network-first con fallback a cache y offline.html
 *      - CSS/JS/SVG → stale-while-revalidate (rápido pero se actualiza en background)
 *      - Imágenes (webp/png/jpg) → cache-first con TTL largo
 *      - Supabase / API externa → network-first, no cachear
 *
 * Versionado: cambiar CACHE_VERSION para forzar purga de caches viejos.
 */

// Branch: fix/perf-batch-reflow-catalog · 2 cambios quirúrgicos combinados.
//
// [BATCH-REFLOW] applyCardVisibility en app.js. Antes: 162 reflows forzados
// (void card.offsetWidth dentro de forEach sobre cards) = 151ms TBT. Ahora:
// batch reads/writes + 1 solo reflow en el contenedor. Esperado -140ms TBT.
//
// [HERO-SUB-MOVE] El <p class="hero-sub"> (texto largo "Perfumes árabes
// importados de larga duración..." con keywords SEO) se movió del hero a
// la sección #nosotros como párrafo intro. Razón: en mobile wrappeaba a
// 5-8 líneas y el shift por swap de fuentes contribuía al CLS 0.845 del
// hero. Hero queda solo con tagline + title (3 líneas máx). Keywords
// SEO mantenidos (siguen en la página, solo en otra sección).
//
// Esperado combinado: TBT -140ms + CLS hero -0.2-0.4 = score +8-15 puntos.
//
// [LIGHT-COHERENT-CREAM + LIGHT-TOGGLE-V2] Mayo 16 2026 · jefe eligió Opción B
// del mockup (mockups.html commit fcc66cf) · TODO el light mode usa la paleta
// cream con acentos dorado-marrón #8a6d00 · sin islas oscuras chocando.
//
// Cambios CSS:
//   - .trust-badge: bg cream #ede2c2 + title dorado-marrón + sub gris medium.
//   - .cat-card: bg cream + count dorado-marrón.
//   - .price-banner-wrap--big: gradient cream sutil con border dorado.
//   - .puntos-context-banner: gradient cream con border dorado.
//   - .quiz-cta-banner: gradient cream (PIERDE su violeta-magenta · jefe OK).
//   - .seleccion-st-card: cream con border dorado · quote gris medium.
//   - Containers .seleccion-st-grid, .section-header, #contacto,
//     .price-banner-wrap, .quiz-cta-wrap: transparent (heredan body).
//
// Cambios botón light toggle (V2 del mockup):
//   - HTML index.html: .nav-theme-btn → .nav-theme-pill con texto "LIGHT"/"DARK".
//   - CSS: pill amarilla degradada con shadow + hover lift. En light mode
//     invierte a pill dark con texto dorado.
//   - JS toggleDarkMode: actualiza emoji + label simultáneo. Init sets
//     navThemeLabel a "LIGHT" si dark / "DARK" si light.
var CACHE_VERSION = 'v1.1.76';
var CACHE_STATIC  = 'st-static-'  + CACHE_VERSION;
var CACHE_PAGES   = 'st-pages-'   + CACHE_VERSION;
var CACHE_IMAGES  = 'st-images-'  + CACHE_VERSION;

// Assets críticos precacheados en install
var PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/perfumes.js',
  '/manifest.json',
  '/img/icon-st.svg'
];

// ============================================================
// INSTALL — precache
// ============================================================
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache) {
      // addAll falla si alguno falla; usamos add individual para no romper todo
      return Promise.all(PRECACHE_URLS.map(function(url) {
        return cache.add(url).catch(function(e) {
          console.warn('[SW] precache fallo para', url, e);
        });
      }));
    }).then(function() {
      return self.skipWaiting(); // activar inmediatamente
    })
  );
});

// ============================================================
// ACTIVATE — limpiar caches viejos
// ============================================================
self.addEventListener('activate', function(event) {
  var validCaches = [CACHE_STATIC, CACHE_PAGES, CACHE_IMAGES];
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key.indexOf('st-') === 0 && validCaches.indexOf(key) === -1) {
          console.log('[SW] borrando cache viejo:', key);
          return caches.delete(key);
        }
      }));
    }).then(function() {
      return self.clients.claim(); // tomar control de clientes ya abiertos
    })
  );
});

// ============================================================
// FETCH — estrategias por tipo de recurso
// ============================================================
self.addEventListener('fetch', function(event) {
  var req = event.request;

  // Solo GET
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Solo http/https — la Cache API rechaza chrome-extension://, data:, etc.
  // Sin este guard, las extensiones de Chrome tiran errores ruidosos en consola.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Ignorar Supabase API, analytics, WhatsApp, etc. (network-only)
  if (url.hostname.indexOf('supabase.co') !== -1 ||
      url.hostname.indexOf('wa.me') !== -1 ||
      url.hostname.indexOf('api.telegram.org') !== -1) {
    return; // dejamos que el navegador maneje normalmente
  }

  // Navegación (HTML): network-first con fallback a cache y offline.html
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    event.respondWith(
      fetch(req).then(function(resp) {
        // Cachear copia de la respuesta
        var copy = resp.clone();
        caches.open(CACHE_PAGES).then(function(cache) { cache.put(req, copy); });
        return resp;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || caches.match('/offline.html');
        });
      })
    );
    return;
  }

  // Imágenes: cache-first
  if (req.destination === 'image' || /\.(webp|png|jpg|jpeg|gif|svg)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(resp) {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            var copy = resp.clone();
            caches.open(CACHE_IMAGES).then(function(cache) { cache.put(req, copy); });
          }
          return resp;
        }).catch(function() { return cached; });
      })
    );
    return;
  }

  // CSS/JS/fuentes: NETWORK-FIRST con fallback a cache.
  // Antes era stale-while-revalidate (te daba el cacheado y bajaba el nuevo
  // en background). El problema: si el cacheado tenía bug, el user veía
  // 1 reload entero con bug antes de actualizar. Y si su browser no
  // refresheaba el SW por cache de 24h, quedaba bloqueado.
  // Ahora: pedimos a red primero, si hay respuesta la usamos y cacheamos;
  // si red falla, caemos al cache. Cuesta unos ms más en cargas con buena
  // conexión pero garantiza versión fresca SIEMPRE.
  if (req.destination === 'style' || req.destination === 'script' || req.destination === 'font' ||
      /\.(css|js|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req).then(function(resp) {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          var copy = resp.clone();
          caches.open(CACHE_STATIC).then(function(cache) { cache.put(req, copy); });
        }
        return resp;
      }).catch(function() {
        return caches.match(req);
      })
    );
    return;
  }

  // Default: network con fallback a cache
  event.respondWith(
    fetch(req).catch(function() { return caches.match(req); })
  );
});

// ============================================================
// PUSH NOTIFICATIONS — (ya existía, mantenido)
// ============================================================
self.addEventListener('push', function(event) {
  var data = { title: 'ST Perfumería', body: '', icon: '/img/logo-st.webp', url: '/' };

  try {
    if (event.data) {
      var payload = event.data.json();
      data.title = payload.title || data.title;
      data.body = payload.body || data.body;
      data.icon = payload.icon || data.icon;
      data.url = payload.url || data.url;
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  var options = {
    body: data.body,
    icon: data.icon,
    badge: '/img/logo-st.webp',
    vibrate: [200, 100, 200],
    data: { url: data.url },
    actions: [
      { action: 'open', title: 'Ver ahora' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        // Match contra ambos: dominio nuevo (stperfumeria.com), legado
        // (st-perfumeria.vercel.app) y deploys de preview. As\u00ed la
        // notificaci\u00f3n enfoca la pesta\u00f1a abierta sin importar de qu\u00e9
        // origen vino el SW que se est\u00e1 ejecutando.
        var u = clientList[i].url || '';
        if ((u.indexOf('stperfumeria') !== -1 || u.indexOf('st-perfumeria') !== -1) && 'focus' in clientList[i]) {
          clientList[i].navigate(url);
          return clientList[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ============================================================
// MESSAGE — para permitir al cliente pedir activación manual
// ============================================================
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
