#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// CONTRASTE DEL SITIO — ST Perfumería · [BADGE-TEXTO] 21-sep-2026 · [TEMA-CLARO] 22-sep-2026
//
// Mide las DOS superficies (panel admin.html · catálogo css/styles.css) en los DOS
// temas (oscuro · claro) y sale con 1 si algún texto queda por debajo de 4,5:1
// (WCAG AA, texto normal). Es la red que mantiene vivas tres reglas del DISEÑADOR:
//
//   · Regla 19 (rol FONDO): el texto de una badge es oscuro cuando su fondo
//     contrasta más con negro que con blanco, y claro en el caso contrario.
//   · Decisión 22 (rol TINTA): cuando el color ES el texto no hay nada más que
//     mover; el rojo se parte en --rojo-fondo (#b8342a) y --rojo-tinta (#e74c3c).
//   · La paleta de tema claro: los tokens cambian con el tema — panel: :root
//     oscuro / body.light claro; catálogo: :root oscuro / body:not(.dark-mode)
//     claro. Un token declarado bajo uno NO llega al otro.
//
//   node scripts/contraste.js      (npm run contraste)   → tablas · exit 1 si falla algo
//
// Lee el CSS por regex, en cascada: para cada propiedad toma la ÚLTIMA declaración
// que matchea (hay selectores repetidos: .stat-card está en L978 y en L1344) y
// resuelve var(--x) recursivo contra los tokens del tema y después los de :root.
// Un gradiente se mide en todos sus extremos y vale el peor. Lo que falla con
// decisión tomada de resolverlo en otro lado se imprime ⚠️ y no cuenta como falla.
// ══════════════════════════════════════════════════════════════════
'use strict';
var fs = require('fs');
var path = require('path');

var RAIZ = path.join(__dirname, '..');
var MINIMO = 4.5;
var NOMBRES = { gray: '#808080', grey: '#808080', white: '#ffffff', black: '#000000', red: '#ff0000', silver: '#c0c0c0' };
var CONOCIDAS = [   // falla hoy, pero la clase entera se va con [JERARQUIA-CARD]: se informa, no frena
  { superficie: 'catálogo', nombre: '.card-brand-st', tema: 'claro', keyword: '[JERARQUIA-CARD]' }
];

// ── color ──
function normalizarHex(v) {
  if (!v) return null; v = String(v).trim().toLowerCase();
  if (NOMBRES[v]) return NOMBRES[v];
  var m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/); if (!m) return null;
  var h = m[1]; if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  return '#' + h;
}
function luminancia(hex) {
  var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) { var la = luminancia(a), lb = luminancia(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function f2(n) { return n.toFixed(2).replace('.', ','); }

// ── CSS: bloques, declaraciones, tokens, var() ──
function estilos(archivo) {
  var t = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
  if (/\.html?$/.test(archivo)) { var m = t.match(/<style>([\s\S]*?)<\/style>/); if (!m) throw new Error(archivo + ': sin <style>'); return m[1]; }
  return t;
}
// Todos los bloques cuyo selector (lo que está antes de "{") matchea. En orden de aparición.
function bloques(css, selectorRegex) {
  var out = [], re = /([^{}]+)\{([^{}]*)\}/g, m;
  while ((m = re.exec(css))) { var sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim(); if (selectorRegex.test(sel)) out.push({ selector: sel, cuerpo: m[2] }); }
  return out;
}
function declaracion(cuerpo, prop) {
  var re = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)', 'g'), m, ultimo = null;
  while ((m = re.exec(cuerpo))) ultimo = m[1].trim();
  if (!ultimo) return null;
  return { valor: ultimo.replace(/!important/, '').trim(), important: /!important/.test(ultimo) };
}
// Cascada: gana la última declaración; un !important le gana a cualquiera sin !important.
function ultimaDecl(css, selectorRegex, prop) {
  var mejor = null;
  bloques(css, selectorRegex).forEach(function (b) {
    var d = declaracion(b.cuerpo, prop); if (!d) return;
    if (!mejor || d.important || !mejor.important) mejor = d;
  });
  return mejor;
}
function tokens(css, selectorRegex) {
  var map = {};
  bloques(css, selectorRegex).forEach(function (b) { var re = /(--[\w-]+)\s*:\s*([^;]+);/g, m; while ((m = re.exec(b.cuerpo))) map[m[1]] = m[2].trim(); });
  return map;
}
// Resuelve un valor CSS a lista de hex: var() recursivo (tema → raíz, con fallback), nombres, gradientes.
function resolver(valor, capas, prof) {
  prof = prof || 0; if (!valor || prof > 8) return [];
  var v = String(valor).trim();
  var m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (m) {
    for (var i = 0; i < capas.length; i++) if (capas[i] && capas[i][m[1]]) return resolver(capas[i][m[1]], capas, prof + 1);
    return m[2] ? resolver(m[2], capas, prof + 1) : [];
  }
  if (/gradient\(/.test(v)) {
    var out = [], re = /var\(\s*--[\w-]+[^)]*\)|#[0-9a-fA-F]{3,6}\b/g, x;
    while ((x = re.exec(v))) out = out.concat(resolver(x[0], capas, prof + 1));
    return out;
  }
  var h = normalizarHex(v); return h ? [h] : [];
}

// ── medición ──
var filas = [], fallas = 0, conocidas = 0;
function esConocida(superficie, nombre, tema) { return CONOCIDAS.filter(function (c) { return c.superficie === superficie && c.nombre === nombre && c.tema === tema; })[0]; }
function fila(superficie, tema, rol, nombre, textoHex, fondos, extra, falloRegla) {
  var conocida = esConocida(superficie, nombre, tema);
  if (!textoHex || !fondos.length) {
    filas.push({ superficie: superficie, tema: tema, rol: rol, nombre: nombre, error: !textoHex ? 'no pude resolver el texto' : 'no pude resolver el fondo' });
    fallas++; return;
  }
  var r = Math.min.apply(null, fondos.map(function (f) { return contraste(textoHex, f); }));
  var ok = r >= MINIMO && !falloRegla;
  if (!ok) { if (conocida) conocidas++; else fallas++; }
  filas.push({ superficie: superficie, tema: tema, rol: rol, nombre: nombre, texto: textoHex, fondos: fondos.join('→'), ratio: r, ok: ok, conocida: conocida && conocida.keyword, extra: extra || '' });
}

// ═══ PANEL (admin.html) ═══
(function () {
  var css = estilos('admin.html');
  var capas = { oscuro: [tokens(css, /^:root$/)], claro: [tokens(css, /^body\.light$/), tokens(css, /^:root$/)] };
  ['oscuro', 'claro'].forEach(function (tema) {
    // Rol FONDO: las 6 badges de stock. En claro pisa el override body.light .badge-X (hoy sólo paused).
    ['ok', 'mid', 'low', 'out', 'last', 'paused'].forEach(function (b) {
      var base = new RegExp('^\\.badge-' + b + '$'), over = new RegExp('^body\\.light \\.badge-' + b + '$');
      var bg = ultimaDecl(css, base, 'background'), fg = ultimaDecl(css, base, 'color');
      if (tema === 'claro') { bg = ultimaDecl(css, over, 'background') || bg; fg = ultimaDecl(css, over, 'color') || fg; }
      var fondos = resolver(bg && bg.valor, capas[tema]), texto = resolver(fg && fg.valor, capas[tema])[0];
      var extra = '', falloRegla = false;
      if (fondos.length && texto) {   // regla 19
        var manda = contraste(fondos[0], '#000000') > contraste(fondos[0], '#ffffff') ? 'oscuro' : 'claro';
        var es = luminancia(texto) < 0.5 ? 'oscuro' : 'claro';
        falloRegla = es !== manda;
        extra = falloRegla ? 'regla 19 ❌ (el fondo pide texto ' + manda + ')' : 'regla 19 ✅';
      }
      fila('panel', tema, 'fondo', '.badge-' + b, texto, fondos, extra, falloRegla);
    });
    // Rol TINTA: .stat-value sobre .stat-card. En claro gana el bloque body.light cuya lista incluya .stat-card
    // (hoy el #fff con !important del grupo); si no hay, la .stat-card que manda, resuelta con los tokens del tema.
    var fondoCard = ultimaDecl(css, /^\.stat-card$/, 'background');
    if (tema === 'claro') { var o = ultimaDecl(css, /(^|, )body\.light \.stat-card(,|$)/, 'background'); if (o) fondoCard = o; }
    var fondos = resolver(fondoCard && fondoCard.valor, capas[tema]);
    [['.stat-value (default)', '\\.stat-value'],
     ['.stat-out .stat-value', '\\.stat-card\\.stat-out \\.stat-value'],
     ['.stat-perfumes .stat-value', '\\.stat-card\\.stat-perfumes \\.stat-value'],
     ['.stat-value-inv .stat-value', '\\.stat-card\\.stat-value-inv \\.stat-value']].forEach(function (t) {
      var fg = ultimaDecl(css, new RegExp('^' + t[1] + '$'), 'color');
      if (tema === 'claro') fg = ultimaDecl(css, new RegExp('^body\\.light ' + t[1] + '$'), 'color') || fg;
      fila('panel', tema, 'tinta', t[0], resolver(fg && fg.valor, capas[tema])[0], fondos);
    });
  });
})();

// ═══ CATÁLOGO (css/styles.css) ═══
(function () {
  var css = estilos('css/styles.css');
  var capas = { oscuro: [tokens(css, /^:root$/)], claro: [tokens(css, /^body:not\(\.dark-mode\)$/), tokens(css, /^:root$/)] };
  ['oscuro', 'claro'].forEach(function (tema) {
    // Los componentes del catálogo son claros por defecto, con override oscuro (al revés que los tokens).
    var bg = ultimaDecl(css, /^\.product-card$/, 'background');
    if (tema === 'oscuro') bg = ultimaDecl(css, /^body\.dark-mode \.product-card$/, 'background') || bg;
    var fondos = resolver(bg && bg.valor, capas[tema]);
    [['.price-promo', '\\.price-promo'], ['.price-cash', '\\.price-cash'], ['.card-brand', '\\.card-brand'], ['.card-brand-st', '\\.card-brand-st']].forEach(function (t) {
      var fg = ultimaDecl(css, new RegExp('^' + t[1] + '$'), 'color');
      if (tema === 'oscuro') fg = ultimaDecl(css, new RegExp('^body\\.dark-mode ' + t[1] + '$'), 'color') || fg;
      fila('catálogo', tema, 'tinta', t[0], resolver(fg && fg.valor, capas[tema])[0], fondos);
    });
    fila('catálogo', tema, 'token', '--gris', resolver('var(--gris)', capas[tema])[0], fondos, '52 usos');
  });
})();

// ═══ Salida ═══
function tabla(titulo, lista) {
  if (!lista.length) return;
  console.log('\n' + titulo);
  var cab = ['rol', 'qué', 'texto', 'fondo', 'ratio', '>= 4,5', 'nota'];
  var cuerpo = lista.map(function (r) {
    if (r.error) return [r.rol, r.nombre, '—', '—', '—', '❌', r.error];
    return [r.rol, r.nombre, r.texto, r.fondos, f2(r.ratio) + ':1', r.ok ? '✅' : (r.conocida ? '⚠️' : '❌'), (r.conocida ? '⚠️ conocida ' + r.conocida + ' ' : '') + r.extra];
  });
  var anchos = cab.map(function (h, i) { return Math.max(h.length, Math.max.apply(null, cuerpo.map(function (f) { return String(f[i]).length; }))); });
  var linea = function (f) { return f.map(function (c, i) { return String(c).padEnd(anchos[i]); }).join('  '); };
  console.log(linea(cab)); console.log(anchos.map(function (a) { return '─'.repeat(a); }).join('  '));
  cuerpo.forEach(function (f) { console.log(linea(f)); });
}
console.log('Contraste del sitio · mínimo ' + f2(MINIMO) + ':1 (WCAG AA texto normal) · panel = admin.html · catálogo = css/styles.css');
[['panel', 'oscuro', '(tokens de :root)'], ['panel', 'claro', '(tokens de body.light)'],
 ['catálogo', 'oscuro', '(tokens de :root + overrides body.dark-mode)'], ['catálogo', 'claro', '(tokens de body:not(.dark-mode))']].forEach(function (s) {
  tabla('■ ' + s[0].toUpperCase() + ' · tema ' + s[1] + ' ' + s[2], filas.filter(function (r) { return r.superficie === s[0] && r.tema === s[1]; }));
});
console.log('\n' + (fallas === 0 ? '✅ 0 falla(s)' : '❌ ' + fallas + ' falla(s)') + (conocidas ? ' + ' + conocidas + ' ⚠️ conocida(s)' : '') + ' · ' + filas.length + ' mediciones.');
process.exit(fallas === 0 ? 0 : 1);
