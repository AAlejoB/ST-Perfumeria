// Servidor de la COPIA para el QA: sirve el repo tal cual, pero cambia la librería de Supabase por la base de mentira
// (fake-supabase.js). No sale a internet hacia Supabase: la página nunca llega a hablar con la tienda real.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2]), PORT = Number(process.argv[3] || 8777), FAKE = path.join(__dirname, 'fake-supabase.js');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__qa/fake-supabase.js') { res.writeHead(200, { 'Content-Type': TIPOS['.js'], 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(FAKE)); }
  if (url === '/api/send-notification') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"qa":true}'); }
  if (url === '/sw.js') { res.writeHead(404); return res.end(); }   // sin service worker: que nada quede cacheado entre pruebas
  let f = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('no'); }
    // El catálogo (index.html) también, desde el 16-oct ([PISTAS-CATALOGO]): además se cortan los fetch / sendBeacon directos a Supabase
    // (las analíticas que salen al cerrar la página), así una prueba no suma visitas a la tienda real.
    const CORTA = '<script>(function(){var f=window.fetch;window.fetch=function(u){if(String(u&&u.url||u).indexOf("supabase.co")!==-1)return Promise.resolve(new Response("[]",{status:200,headers:{"Content-Type":"application/json"}}));return f.apply(this,arguments)};if(navigator.sendBeacon){var b=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u){if(String(u).indexOf("supabase.co")!==-1)return true;return b.apply(null,arguments)}}})()</script>';
    if (path.basename(f) === 'admin.html' || (path.basename(f) === 'index.html' && path.dirname(f) === ROOT)) {
      const html = buf.toString('utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^>]*><\/script>/, (path.basename(f) === 'index.html' ? CORTA : '') + '<script src="/__qa/fake-supabase.js"></script>');
      res.writeHead(200, { 'Content-Type': TIPOS['.html'], 'Cache-Control': 'no-store' }); return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log('QA copia en http://localhost:' + PORT + '/admin.html'));
