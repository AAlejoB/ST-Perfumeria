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

// [BATCH-REFLOW] Quick win quirúrgico al patrón antipattern en applyCardVisibility.
// Lighthouse mobile reportaba 151ms de "redistribución forzada" en app.js:3337 —
// la línea era `void card.offsetWidth` dentro de un forEach sobre las 162 cards
// del catálogo, ejecutado en cada cambio de filtro. 162 reflows forzados = 151ms TBT.
//
// Fix: batch reads/writes · marca cards en un array dentro del loop, después
// hace UN solo `void grid.offsetWidth` en el contenedor (reflow afecta hijos
// automáticamente) y aplica la clase de animación a todas en otra iteración
// simple sin reflow.
//
// Esperado: TBT mobile baja de 260ms a ~120ms (-140ms · -54%). Score +5-10 puntos.
// No toca CSS, HTML, layout ni dimensiones — solo cambia el ORDEN de operaciones
// DOM en una función JS. Riesgo extremadamente bajo.
var CACHE_VERSION = 'v1.1.50';
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
