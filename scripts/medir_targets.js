#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// MEDIDOR DE ÁREAS TÁCTILES DEL PANEL — ST Perfumería · [TAP-44] 21-sep-2026
//
// Cuenta los controles del panel admin y cuántos miden menos de 44 px de alto
// (la métrica "controles cortos"). Es la versión que corre Claude Code, y por
// eso vive acá: el instrumento del PREPARADOR no puede cargar Inter (egress
// bloqueado) y todos los altos que dependen del texto le salían ~2 px más
// bajos (42,4 en vez de 44,38). Un script que corre sin error no es un script
// que mide lo que dice medir — este se NIEGA a reportar números si la fuente
// del panel no cargó (sale con código 1 y lo dice).
//
//   node scripts/medir_targets.js                 → 600×900 (Galaxy Tab A9 vertical)
//   node scripts/medir_targets.js --ancho 800     → otro ancho
//   node scripts/medir_targets.js --sin-fuente    → bloquea fonts.googleapis para probar que se niega
//   node scripts/medir_targets.js --json          → salida cruda
//   node scripts/medir_targets.js --navegador "C:\...\msedge.exe"
//
// Sin dependencias: servidor estático propio (no-store, sin Service Worker,
// window.supabase reemplazado por un stub ANTES del script de la página, así
// que 0 requests a Supabase), Edge/Chrome headless por CDP con el WebSocket de
// Node ≥ 22. Llama a renderPrecios() y renderDeposito() — sin eso la línea de
// base daba 119 en vez de 557 — y fuerza visibles todas las pestañas y, uno a
// uno, los modales, para que los controles escondidos también cuenten.
//
// Detector de fuente: compara el ancho de una cadena en "Inter, sans-serif"
// contra "sans-serif" y en "Inter, serif" contra "serif". Si Inter no está,
// cae al genérico y los anchos coinciden. document.fonts.check() NO sirve:
// devuelve true resolviendo contra el fallback.
// ══════════════════════════════════════════════════════════════════
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const args = process.argv.slice(2);
function opt(nombre, def) { const i = args.indexOf('--' + nombre); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; }
const ANCHO = +opt('ancho', 600), ALTO = +opt('alto', 900);
const SIN_FUENTE = args.includes('--sin-fuente');
const JSON_OUT = args.includes('--json');
const MIN = 44;

// ── Stub de supabase-js: Proxy encadenable y thenable, todo resuelve a { data: [], error: null } ──
const STUB_SUPABASE = `<script>(function(){var R={data:[],error:null,count:0,status:200};function mk(){return new Proxy(function(){},{get:function(_,p){if(p==='then')return function(a,b){return Promise.resolve(R).then(a,b)};if(p==='catch')return function(b){return Promise.resolve(R).catch(b)};if(p==='finally')return function(f){return Promise.resolve(R).finally(f)};if(p===Symbol.toPrimitive)return function(){return ''};if(p==='toJSON')return function(){return null};return mk()},apply:function(){return mk()}})}window.supabase={createClient:function(){return mk()}};window.__sbStub='pre';})();</script>`;
const CDN_SUPABASE = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2[^"]*"><\/script>/;

// ── Lo que corre DENTRO de la página ──
const MEDIR_EN_PAGINA = String(function () {
  window.__medir = async function (MIN) {
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 100 && !(document.getElementById('adminPanel') || {}).classList?.contains('active'); i++) await espera(100);
    await document.fonts.ready;
    await espera(300);

    // 1. ¿Cargó Inter? Ancho de una cadena con y sin la fuente.
    function ancho(familia) { const s = document.createElement('span'); s.textContent = 'Perfumería ST 0123456789 · abcdefghijklmnopqrstuvwxyz ÁÉÍÓÚ wiWI'; s.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:32px;white-space:nowrap;font-family:' + familia; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return +w.toFixed(2); }
    const anchos = { inter_sans: ancho('Inter, sans-serif'), sans: ancho('sans-serif'), inter_serif: ancho('Inter, serif'), serif: ancho('serif') };
    const interCargada = anchos.inter_sans !== anchos.sans && anchos.inter_serif !== anchos.serif;
    const fuente = { interCargada, anchos, fontsCheckDiceTrue: document.fonts.check('16px Inter'), cargadas: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight) };
    if (!interCargada) return { fuente };

    // 2. Pantallas: sin esto la línea de base daba 119 en vez de 557.
    if (typeof renderPrecios === 'function') renderPrecios();
    if (typeof renderDeposito === 'function') renderDeposito();
    const filas = { tbodyPrecios: document.querySelectorAll('#tbodyPrecios tr').length, tbodyDeposito: document.querySelectorAll('#tbodyDeposito tr').length };

    // 3. Todas las pestañas visibles a la vez (para que lo escondido también mida).
    const st = document.createElement('style'); st.textContent = '#adminPanel .tab-content{display:block!important}'; document.head.appendChild(st);
    await espera(100);

    const SEL = 'button, input:not([type=hidden]), select, textarea, a[href], [onclick], [role=button], label:has(> input[type=checkbox]), .badge-stock';
    const h = el => +el.getBoundingClientRect().height.toFixed(2);
    const firma = el => (el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? ':' + el.type : '') + ((typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/).filter(c => c !== 'active' && c !== 'visible').slice(0, 2).join('.') : ''));
    function inventario(raiz, excluirModales) {
      const vistos = new Set(); const lista = [];
      raiz.querySelectorAll(SEL).forEach(el => {
        if (vistos.has(el)) return; vistos.add(el);
        if (excluirModales && el.closest('.modal-overlay')) return;
        const r = el.getBoundingClientRect(); if (r.height <= 0 || r.width <= 0) return;
        lista.push({ firma: firma(el), id: el.id || '', h: h(el) });
      });
      return lista;
    }
    const enTabs = inventario(document.getElementById('adminPanel'), true);
    const badge = document.querySelector('#tbodyPrecios .td-stock .badge-stock');
    const referencias = { badge: badge ? h(badge) : null, trPrecios: h(document.querySelector('#tbodyPrecios tr')), trDeposito: h(document.querySelector('#tbodyDeposito tr')), badgesEnDOM: document.querySelectorAll('.badge-stock').length };

    // 4. Modales, uno a uno (sus controles no existen mientras el modal está cerrado).
    const enModales = [];
    for (const ov of document.querySelectorAll('.modal-overlay')) {
      const estaba = ov.classList.contains('active'); ov.classList.add('active'); await espera(30);
      inventario(ov, false).forEach(x => enModales.push(Object.assign(x, { modal: ov.id || '(sin id)' })));
      if (!estaba) ov.classList.remove('active');
    }
    st.remove();

    const todos = enTabs.concat(enModales);
    const cortos = todos.filter(x => x.h < MIN);
    function agrupar(lista) { const g = {}; lista.forEach(x => { const k = x.firma; g[k] = g[k] || { n: 0, min: Infinity, max: -Infinity }; g[k].n++; g[k].min = Math.min(g[k].min, x.h); g[k].max = Math.max(g[k].max, x.h); }); return Object.entries(g).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ firma: k, n: v.n, min: v.min, max: v.max })); }
    return {
      fuente, viewport: [innerWidth, innerHeight], filas,
      referencias,
      totales: { controles: todos.length, enTabs: enTabs.length, enModales: enModales.length, cortos: cortos.length, cortosEnTabs: cortos.filter(x => !x.modal).length, cortosEnModales: cortos.filter(x => x.modal).length },
      cortosPorFirma: agrupar(cortos),
      definicion: { selector: SEL, minimo: MIN, criterio: 'alto del getBoundingClientRect < mínimo; sólo elementos con alto y ancho > 0; pestañas forzadas visibles; modales activados uno a uno; sin duplicados' }
    };
  };
});

// ── Servidor estático ──
function servir() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      res.setHeader('Cache-Control', 'no-store');
      if (url === '/sw.js') { res.writeHead(404); return res.end(); }
      if (url === '/admin.html') {
        let html = fs.readFileSync(path.join(RAIZ, 'admin.html'), 'utf8');
        if (!CDN_SUPABASE.test(html)) { res.writeHead(500); return res.end('no encontre el <script> del CDN de supabase en admin.html'); }
        html = html.replace(CDN_SUPABASE, STUB_SUPABASE);
        html = html.replace('</body>', '<script>(' + MEDIR_EN_PAGINA + ')();</script><script>enterAdminPanel(\'jefe\');</script></body>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.writeHead(200); return res.end(html);
      }
      const file = path.normalize(path.join(RAIZ, url));
      if (!file.startsWith(path.normalize(RAIZ))) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        const ext = path.extname(file);
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream');
        res.writeHead(200); res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port }));
  });
}

// ── Navegador headless ──
function buscarNavegador() {
  const pedido = opt('navegador'); if (pedido) return pedido;
  const candidatos = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  return candidatos.find(c => c && fs.existsSync(c));
}
function lanzar(bin, perfil) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + perfil, '--remote-debugging-port=0', '--window-size=' + ANCHO + ',' + ALTO, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve({ proc, ws: m[1] }); });
    proc.on('exit', code => reject(new Error('el navegador salio con ' + code + ': ' + err.slice(-300))));
    setTimeout(() => reject(new Error('el navegador no publico el endpoint de DevTools en 15 s')), 15000);
  });
}

// ── CDP mínimo sobre el WebSocket global de Node ──
function cdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); let id = 0; const pend = new Map(); const oyentes = [];
    ws.onopen = () => resolve({
      enviar(method, params, sessionId) { return new Promise((ok, ko) => { const n = ++id; pend.set(n, { ok, ko }); ws.send(JSON.stringify({ id: n, method, params: params || {}, sessionId })); }); },
      esperar(method, sessionId) { return new Promise(ok => oyentes.push({ method, sessionId, ok })); },
      cerrar() { ws.close(); }
    });
    ws.onerror = e => reject(new Error('WebSocket: ' + (e.message || 'error')));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.ko(new Error(m.error.message)) : p.ok(m.result); }
      else if (m.method) { for (let i = oyentes.length - 1; i >= 0; i--) if (oyentes[i].method === m.method && (!oyentes[i].sessionId || oyentes[i].sessionId === m.sessionId)) { oyentes.splice(i, 1)[0].ok(m.params); } }
    };
  });
}

(async () => {
  const bin = buscarNavegador();
  if (!bin) { console.error('❌ No encontré Edge ni Chrome. Pasá la ruta con --navegador.'); process.exit(2); }
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'st-medir-'));
  let srv, nav, c;
  const limpiar = () => { try { c && c.cerrar(); } catch (e) {} try { nav && nav.proc.kill(); } catch (e) {} try { srv && srv.close(); } catch (e) {} setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) {} }, 500); };
  const reloj = setTimeout(() => { console.error('❌ Timeout general (90 s).'); limpiar(); process.exit(2); }, 90000);
  try {
    const servidor = await servir(); srv = servidor.srv; const base = servidor.url;
    nav = await lanzar(bin, perfil);
    c = await cdp(nav.ws);
    const { targetId } = await c.enviar('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await c.enviar('Target.attachToTarget', { targetId, flatten: true });
    await c.enviar('Page.enable', {}, sessionId);
    await c.enviar('Runtime.enable', {}, sessionId);
    await c.enviar('Emulation.setDeviceMetricsOverride', { width: ANCHO, height: ALTO, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (SIN_FUENTE) { await c.enviar('Network.enable', {}, sessionId); await c.enviar('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] }, sessionId); }
    const cargada = c.esperar('Page.loadEventFired', sessionId);
    await c.enviar('Page.navigate', { url: base + '/admin.html' }, sessionId);
    await cargada;
    const ev = await c.enviar('Runtime.evaluate', { expression: 'window.__medir(' + MIN + ')', awaitPromise: true, returnByValue: true }, sessionId);
    if (ev.exceptionDetails) throw new Error('en la página: ' + (ev.exceptionDetails.exception?.description || ev.exceptionDetails.text));
    const R = ev.result.value;
    clearTimeout(reloj); limpiar();

    if (JSON_OUT) { console.log(JSON.stringify(R, null, 2)); process.exit(R.fuente.interCargada ? 0 : 1); }

    console.log('Áreas táctiles del panel · ' + ANCHO + '×' + ALTO + ' · ' + path.basename(bin) + (SIN_FUENTE ? ' · fuentes BLOQUEADAS a propósito' : ''));
    if (!R.fuente.interCargada) {
      console.log('\n❌ Inter NO cargó — me niego a reportar alturas: darían ~2 px menos que en la tablet.');
      console.log('   ancho "Inter, sans-serif" = ' + R.fuente.anchos.inter_sans + ' vs "sans-serif" = ' + R.fuente.anchos.sans + ' · "Inter, serif" = ' + R.fuente.anchos.inter_serif + ' vs "serif" = ' + R.fuente.anchos.serif);
      console.log('   (document.fonts.check("16px Inter") dijo ' + R.fuente.fontsCheckDiceTrue + ': por eso no se usa)');
      console.log('   Fuentes cargadas: ' + (R.fuente.cargadas.join(', ') || 'ninguna') + '. ¿Hay red a fonts.googleapis.com / fonts.gstatic.com?');
      process.exit(1);
    }
    console.log('✅ Inter cargada (' + R.fuente.cargadas.join(', ') + ') · ancho Inter ' + R.fuente.anchos.inter_sans + ' vs sans-serif ' + R.fuente.anchos.sans);
    console.log('Filas: tbodyPrecios ' + R.filas.tbodyPrecios + ' · tbodyDeposito ' + R.filas.tbodyDeposito + ' · badges en DOM ' + R.referencias.badgesEnDOM);
    console.log('Referencias: badge ' + R.referencias.badge + ' px · fila Precios ' + R.referencias.trPrecios + ' · fila Depósito ' + R.referencias.trDeposito);
    console.log('\nControles: ' + R.totales.controles + ' (' + R.totales.enTabs + ' en pestañas + ' + R.totales.enModales + ' en modales)');
    console.log('< ' + MIN + ' px: ' + R.totales.cortos + ' (' + R.totales.cortosEnTabs + ' en pestañas, ' + R.totales.cortosEnModales + ' en modales)');
    if (R.cortosPorFirma.length) {
      console.log('\n' + 'firma'.padEnd(48) + 'n'.padStart(5) + '   alto min–max');
      console.log('─'.repeat(48) + '  ' + '─'.repeat(20));
      R.cortosPorFirma.forEach(g => console.log(g.firma.slice(0, 48).padEnd(48) + String(g.n).padStart(5) + '   ' + g.min + (g.min !== g.max ? '–' + g.max : '')));
    }
    console.log('\nCriterio: ' + R.definicion.criterio + '.');
    process.exit(0);
  } catch (e) {
    clearTimeout(reloj); limpiar();
    console.error('❌ ' + e.message); process.exit(2);
  }
})();
