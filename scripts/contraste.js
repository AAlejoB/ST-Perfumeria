#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// CONTRASTE DEL SITIO — ST Perfumería
// [BADGE-TEXTO] 21-sep-2026 · [TEMA-CLARO] 22-sep-2026 · motor de cascada 22-sep-2026
//
// Mide las DOS superficies (panel admin.html · catálogo css/styles.css) en los DOS
// temas y sale con 1 si algún texto que SE VE queda por debajo de 4,5:1 (WCAG AA).
// Mantiene vivas las reglas del DISEÑADOR: regla 19 (el fondo elige el texto),
// decisión 22 (rojo partido por rol) y la paleta de tema claro.
//
//   node scripts/contraste.js      (npm run contraste)
//
// ── Por qué tiene un motor de cascada ──
// La primera versión leía "la declaración base" y por eso dijo que el catálogo en
// claro estaba roto (1,51 / 2,78 / 3,95) cuando en pantalla se ve 17,36 / 7,87 /
// 15,01 desde mayo: lo pisa el bloque de `193e3dd` (56 reglas !important bajo
// body:not(.dark-mode), L8040-8200), escritas porque una usuaria real no podía
// leer el catálogo en claro. Un script que dice 0 midiendo CSS que no se ve es
// peor que no tenerlo. Ahora, para cada elemento y tema, se calcula el ganador de
// verdad: se consideran TODAS las reglas cuyo selector — solo o dentro de una
// lista — apunte a ese elemento, gana el !important y después la especificidad y
// el orden, y se informa qué regla impone el valor (archivo:línea).
//
// Un token declarado que queda pisado por un !important se reporta ⚠️ y NO suma a
// fallas: el número que se ve pasa. El destino de ese bloque es [LIGHT-MAYO-56].
// ══════════════════════════════════════════════════════════════════
'use strict';
var fs = require('fs');
var path = require('path');

var RAIZ = path.join(__dirname, '..');
var MINIMO = 4.5;
var NOMBRES = { gray: '#808080', grey: '#808080', white: '#ffffff', black: '#000000', red: '#ff0000', silver: '#c0c0c0' };
var CONOCIDAS = [   // falla hoy y se resuelve en otro lado: se informa, no frena
  // [JUEGOS-VENTANA] lo que se mudó a la ventana tal cual: la manija es la del detalle
  { superficie: 'catálogo', nombre: 'deslizá para cerrar .juegos-sheet .bs-handle-arrow', tema: 'oscuro', keyword: '[JUEGOS-VENTANA-PULIDO]' },
  // [JERARQUIA-CARD] el Hot Sale del detalle en claro es #c2410c (un solo color, como pidió el DISEÑADOR) pero el detalle
  // es crema (#f5efde), no blanco: 4,16 al principio de la franja al 6 %, 4,51 sin franja. Lo decide el DISEÑADOR.
  { superficie: 'catálogo', nombre: 'Hot Sale (detalle) .bottom-sheet .price-cash--hotsale', tema: 'claro', keyword: '[HOTSALE-DETALLE-CLARO]' }
  // [AMARILLO-TINTA-CLARO] el título del quiz en claro salió de acá: con #6b5500 da 6,25 sobre #f5efde
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

// ── CSS ──
// Los comentarios se neutralizan ANTES de parsear: hay comentarios con una llave adentro (3 en el repo)
// y partían los bloques — el selector siguiente quedaba pegado a media frase y no matcheaba nada. Se
// reemplazan por espacios conservando los saltos de línea, así los números de línea siguen siendo reales.
function sinComentarios(css) { return css.replace(/\/\*[\s\S]*?\*\//g, function (c) { return c.replace(/[^\n]/g, ' '); }); }
function hoja(archivo) {
  var t = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
  if (!/\.html?$/.test(archivo)) return { css: sinComentarios(t), offset: 0, archivo: archivo };
  var i = t.indexOf('<style>'); if (i < 0) throw new Error(archivo + ': sin <style>');
  var ini = i + '<style>'.length;
  return { css: sinComentarios(t.slice(ini, t.indexOf('</style>', ini))), offset: (t.slice(0, ini).match(/\n/g) || []).length, archivo: archivo };
}
// Reglas con su lista de selectores y la línea REAL de cada uno.
function reglas(h) {
  var out = [], re = /([^{}]+)\{([^{}]*)\}/g, m, n = 0;
  while ((m = re.exec(h.css))) {
    var bruto = m[1];
    if (/@/.test(bruto)) continue;   // @media / @supports: el selector real viene en el bloque de adentro
    var base = (h.css.slice(0, m.index).match(/\n/g) || []).length;
    var sels = [], desde = 0;
    bruto.split(',').forEach(function (trozo) {
      var limpio = trozo.replace(/\s+/g, ' ').trim();
      var linea = h.offset + base + (bruto.slice(0, desde).match(/\n/g) || []).length + 1;
      desde += trozo.length + 1;
      if (limpio) sels.push({ sel: limpio, linea: linea });
    });
    if (sels.length) out.push({ sels: sels, cuerpo: m[2], orden: n++, archivo: h.archivo });
  }
  return out;
}
function declaracion(cuerpo, prop) {
  var re = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)', 'g'), m, ultimo = null;
  while ((m = re.exec(cuerpo))) ultimo = m[1].trim();
  if (!ultimo) return null;
  return { valor: ultimo.replace(/!important/, '').trim(), important: /!important/.test(ultimo) };
}
// (#id, .clase/:pseudo/[attr], elemento) — :not() cuenta como su argumento, igual que el navegador.
function especificidad(sel) {
  var s = sel.replace(/:not\(([^)]*)\)/g, ' $1 ');
  var ids = (s.match(/#[\w-]+/g) || []).length;
  var clases = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?/g) || []).length;
  var elems = (s.replace(/[.#][\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?/g, ' ').match(/[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + clases * 100 + elems;
}
// Un .price-cash dentro de un .bottom-sheet recibe TAMBIÉN las reglas de .price-cash a secas: para un
// target contextual se consideran sus equivalentes más genéricos (el último compound), como el navegador.
function equivalentes(target) { var ultimo = target.split(/\s+|>/).filter(Boolean).pop(); return ultimo && ultimo !== target ? [target, ultimo] : [target]; }
// El ganador para `target` en este tema: el selector puede estar SOLO o dentro de una lista.
// Gana !important; después especificidad; después el orden. Devuelve también la base (sin prefijo de tema).
function ganador(rs, target, prefijos, prop) {
  var targets = equivalentes(target);
  var cands = [];
  rs.forEach(function (r) {
    r.sels.forEach(function (s) {
      var esBase = targets.indexOf(s.sel) >= 0;
      var esTema = prefijos.some(function (p) { return targets.some(function (t) { return s.sel === p + ' ' + t; }); });
      if (!esBase && !esTema) return;
      var d = declaracion(r.cuerpo, prop); if (!d) return;
      cands.push({ valor: d.valor, important: d.important, base: esBase, exacto: s.sel === target, selector: s.sel, linea: s.linea, archivo: r.archivo, orden: r.orden, esp: especificidad(s.sel) });
    });
  });
  if (!cands.length) return null;
  cands.sort(function (a, b) { return (a.important - b.important) || (a.esp - b.esp) || (a.orden - b.orden); });
  var gana = cands[cands.length - 1];
  var bases = cands.filter(function (c) { return c.exacto; });
  gana.declaracionBase = bases.length ? bases[bases.length - 1] : null;
  return gana;
}
function tokens(rs, selector) {
  var map = {};
  rs.forEach(function (r) { r.sels.forEach(function (s) { if (s.sel !== selector) return; var re = /(--[\w-]+)\s*:\s*([^;]+);/g, m; while ((m = re.exec(r.cuerpo))) map[m[1]] = m[2].trim(); }); });
  return map;
}
function resolver(valor, capas, prof) {
  prof = prof || 0; if (!valor || prof > 8) return [];
  var v = String(valor).trim();
  var m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (m) { for (var i = 0; i < capas.length; i++) if (capas[i] && capas[i][m[1]]) return resolver(capas[i][m[1]], capas, prof + 1); return m[2] ? resolver(m[2], capas, prof + 1) : []; }
  if (/gradient\(/.test(v)) { var out = [], re = /var\(\s*--[\w-]+[^)]*\)|#[0-9a-fA-F]{3,6}\b/g, x; while ((x = re.exec(v))) out = out.concat(resolver(x[0], capas, prof + 1)); return out; }
  var h = normalizarHex(v); return h ? [h] : [];
}

// ── medición ──
var filas = [], fallas = 0, conocidas = 0, pisados = 0;
function medir(o) {
  var conocida = CONOCIDAS.filter(function (c) { return c.superficie === o.superficie && c.nombre === o.nombre && c.tema === o.tema; })[0];
  if (!o.texto || !o.fondos.length) { filas.push({ superficie: o.superficie, tema: o.tema, rol: o.rol, nombre: o.nombre, error: !o.texto ? 'no pude resolver el texto' : 'no pude resolver el fondo' }); fallas++; return; }
  var r = Math.min.apply(null, o.fondos.map(function (f) { return contraste(o.texto, f); }));
  var ok = r >= MINIMO && !o.falloRegla;
  var notas = [];
  if (o.pisado) { pisados++; notas.push('⚠️ token pisado por !important (' + o.impone + ') · ver [LIGHT-MAYO-56]'); }
  if (o.extra) notas.push(o.extra);
  if (!ok) { if (conocida) { conocidas++; notas.push('⚠️ conocida ' + conocida.keyword); } else fallas++; }
  filas.push({ superficie: o.superficie, tema: o.tema, rol: o.rol, nombre: o.nombre, texto: o.texto, fondos: o.fondos.join('→'), ratio: r, ok: ok, alerta: !!conocida || o.pisado, impone: o.impone, nota: notas.join(' · ') });
}
// Un valor efectivo + de dónde sale + si tapó un token.
function efectivo(rs, target, prefijos, prop, capas) {
  var g = ganador(rs, target, prefijos, prop);
  if (!g) return { hex: [], impone: '(sin declaración)', pisado: false };
  var base = g.declaracionBase;
  return {
    hex: resolver(g.valor, capas),
    impone: path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : ''),
    // "Pisado" es un token cuyo valor NO se ve. Si el !important impone exactamente lo mismo que el token,
    // token y pantalla coinciden y no hay nada que reportar: se marca sólo cuando el hex efectivo difiere.
    pisado: !!(base && base !== g && g.important && /var\(/.test(base.valor) && resolver(base.valor, capas).join() !== resolver(g.valor, capas).join())
  };
}

// ═══ PANEL ═══
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz] }, claro: { pref: ['body.light'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    ['ok', 'mid', 'low', 'out', 'last', 'paused'].forEach(function (b) {
      var bg = efectivo(rs, '.badge-' + b, c.pref, 'background', c.capas), fg = efectivo(rs, '.badge-' + b, c.pref, 'color', c.capas);
      var extra = '', fallo = false;
      if (bg.hex.length && fg.hex[0]) {
        var manda = contraste(bg.hex[0], '#000000') > contraste(bg.hex[0], '#ffffff') ? 'oscuro' : 'claro';
        var es = luminancia(fg.hex[0]) < 0.5 ? 'oscuro' : 'claro';
        fallo = es !== manda; extra = fallo ? 'regla 19 ❌ (el fondo pide texto ' + manda + ')' : 'regla 19 ✅';
      }
      medir({ superficie: 'panel', tema: tema, rol: 'fondo', nombre: '.badge-' + b, texto: fg.hex[0], fondos: bg.hex, extra: extra, falloRegla: fallo, impone: fg.impone, pisado: fg.pisado || bg.pisado });
    });
    var card = efectivo(rs, '.stat-card', c.pref, 'background', c.capas);
    [['.stat-value (default)', '.stat-value'], ['.stat-out .stat-value', '.stat-card.stat-out .stat-value'],
     ['.stat-perfumes .stat-value', '.stat-card.stat-perfumes .stat-value'], ['.stat-value-inv .stat-value', '.stat-card.stat-value-inv .stat-value']].forEach(function (t) {
      var fg = efectivo(rs, t[1], c.pref, 'color', c.capas);
      medir({ superficie: 'panel', tema: tema, rol: 'tinta', nombre: t[0], texto: fg.hex[0], fondos: card.hex, impone: fg.impone, pisado: fg.pisado });
    });
    // [LOG-EMPLEADA] Las filas del Log viven sobre --superficie (listas: blancas en claro).
    // El texto principal no declara color: hereda del body, que en claro pone #1a1a1a.
    var sup = efectivo(rs, '.log-item', c.pref, 'background', c.capas);
    var heredado = tema === 'claro' ? (efectivo(rs, 'body.light', [], 'color', c.capas).hex[0] || '#1a1a1a') : '#ffffff';
    [['.log-item (texto)', null, heredado], ['.log-hora / .log-accion', '.log-hora', null],
     ['.log-old (salió)', '.log-old', null], ['.log-new (entró · hereda)', null, heredado],
     ['.log-deposito (acción)', '.log-item.log-deposito .log-accion', null], ['.log-dia', '.log-dia', null]].forEach(function (t) {
      var hex = t[2] ? [t[2]] : efectivo(rs, t[1], c.pref, 'color', c.capas).hex;
      medir({ superficie: 'panel', tema: tema, rol: 'log', nombre: t[0], texto: hex[0], fondos: sup.hex, impone: t[2] ? 'heredado del body' : efectivo(rs, t[1], c.pref, 'color', c.capas).impone });
    });
  });
})();

// ═══ CATÁLOGO ═══
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var card = efectivo(rs, '.product-card', c.pref, 'background', c.capas);
    ['.price-promo', '.price-cash', '.card-brand'].forEach(function (t) {   // [JERARQUIA-CARD] .card-brand-st ya no existe
      var fg = efectivo(rs, t, c.pref, 'color', c.capas);
      medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: t, texto: fg.hex[0], fondos: card.hex, impone: fg.impone, pisado: fg.pisado });
    });
    medir({ superficie: 'catálogo', tema: tema, rol: 'token', nombre: '--gris', texto: resolver('var(--gris)', c.capas)[0], fondos: card.hex, extra: '154 elementos con texto visible', impone: 'token' });
    // El bottom-sheet tiene su propio fondo y sus propias reglas: se mide aparte.
    var bs = efectivo(rs, '.bottom-sheet', c.pref, 'background', c.capas);
    var bsCash = efectivo(rs, '.bottom-sheet .price-cash', c.pref, 'color', c.capas);
    if (bs.hex.length && bsCash.hex.length) medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: '.bottom-sheet .price-cash', texto: bsCash.hex[0], fondos: bs.hex, impone: bsCash.impone, pisado: bsCash.pisado });
  });
})();

// ═══ CARD DEL CATÁLOGO ═══ [JERARQUIA-CARD] 24-sep-2026
// Los botones y el Hot Sale de la card, sobre la card. Varios fondos son rgba() o un gradiente: se componen sobre
// la card y, si es un gradiente, se mide contra cada parada (el peor caso). Un elemento con varias clases recibe
// las reglas de cada una (el Hot Sale es .price-cash Y .price-cash--hotsale): el ganador sale de todas, como en el
// navegador — así se veía que en claro `body:not(.dark-mode) .price-cash` le ganaba al Hot Sale y lo pintaba verde.
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  var orden = function (x, y) { return (x.important - y.important) || (x.esp - y.esp) || (x.orden - y.orden); };
  function crudo(v, capas, prof) {
    prof = prof || 0; var t = String(v || '').trim(); var m = t.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (!m || prof > 8) return t;
    for (var i = 0; i < capas.length; i++) if (capas[i] && capas[i][m[1]]) return crudo(capas[i][m[1]], capas, prof + 1);
    return m[2] ? crudo(m[2], capas, prof + 1) : '';
  }
  function sobre(c, fondoHex) {
    var fo = [1, 3, 5].map(function (i) { return parseInt(fondoHex.substr(i, 2), 16); });
    return '#' + [c.r, c.g, c.b].map(function (v, i) { return Math.round(v * c.a + fo[i] * (1 - c.a)).toString(16).padStart(2, '0'); }).join('');
  }
  // Cada color del valor (uno, o las paradas de un gradiente), compuesto sobre lo de abajo.
  function colores(valor, c, abajo) {
    var v = crudo(valor, c.capas); if (!v || v === 'transparent' || v === 'none') return [abajo];
    var re = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,\/]+([\d.]+))?\s*\)|var\(\s*--[\w-]+[^)]*\)|#[0-9a-fA-F]{3,6}\b/g, m, out = [];
    while ((m = re.exec(v))) {
      if (m[1] !== undefined) out.push(sobre({ r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }, abajo));
      else if (m[0][0] === 'v') out = out.concat(colores(m[0], c, abajo));
      else { var h = normalizarHex(m[0]); if (h) out.push(h); }
    }
    return out.length ? out : [abajo];
  }
  function gana(selectores, c, props) {
    var g = [];
    selectores.forEach(function (t) { props.forEach(function (p) { var x = ganador(rs, t, c.pref, p); if (x) g.push(x); }); });
    return g.sort(orden).pop() || null;
  }
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var card = colores(gana(['.product-card'], c, ['background', 'background-color']).valor, c, '#ffffff')[0];
    // [nombre, selectores que aplican al texto, selectores que aplican al fondo]
    [['🔔 / 🔒 botón de espera', ['.waitlist-btn'], ['.waitlist-btn']],
     ['✓ anotada', ['.waitlist-btn', '.waitlist-btn.subscribed'], ['.waitlist-btn', '.waitlist-btn.subscribed']],
     ['Hot Sale', ['.price-cash', '.price-cash--hotsale', '.price-cash.price-cash--hotsale'], ['.price-cash--hotsale', '.price-cash.price-cash--hotsale']],
     ['«Consultar»', ['.card-cta-mobile'], ['.card-cta-mobile']],
     ['Hot Sale (detalle)', ['.bottom-sheet .price-cash', '.price-cash--hotsale', '.price-cash.price-cash--hotsale'], ['.price-cash--hotsale', '.price-cash.price-cash--hotsale'], '.bottom-sheet']].forEach(function (x) {
      var abajo = x[3] ? colores(gana([x[3]], c, ['background', 'background-color']).valor, c, '#ffffff')[0] : card;
      var gf = gana(x[2], c, ['background', 'background-color']);
      var bg = gf ? colores(gf.valor, c, abajo) : [abajo];
      var gt = gana(x[1], c, ['color']);
      medir({ superficie: 'catálogo', tema: tema, rol: 'card', nombre: x[0] + ' ' + (x[3] ? x[3] + ' .price-cash--hotsale' : x[1][x[1].length - 1]), texto: gt && colores(gt.valor, c, bg[0])[0], fondos: bg,
        impone: gt ? path.basename(gt.archivo) + ':' + gt.linea + (gt.important ? ' !important' : '') : '' });
    });
  });
})();

// ═══ PÍLDORA «CERRADO», CONTADOR DE CATEGORÍAS Y «VER CATÁLOGO» ═══ [CLARO-CATALOGO-2] 24-sep-2026
// La píldora flota (position: fixed) sobre cualquier sección: se mide contra la página y contra la card. «Ver
// catálogo» hereda la letra del banner en claro (`.price-banner-wrap--big .price-banner *` → inherit): se resuelve
// ese inherit con el color del banner. Mismos ayudantes que la sección de la card.
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  var orden = function (x, y) { return (x.important - y.important) || (x.esp - y.esp) || (x.orden - y.orden); };
  function crudo(v, capas, prof) {
    prof = prof || 0; var t = String(v || '').trim(); var m = t.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (!m || prof > 8) return t;
    for (var i = 0; i < capas.length; i++) if (capas[i] && capas[i][m[1]]) return crudo(capas[i][m[1]], capas, prof + 1);
    return m[2] ? crudo(m[2], capas, prof + 1) : '';
  }
  function sobre(c, fondoHex) {
    var fo = [1, 3, 5].map(function (i) { return parseInt(fondoHex.substr(i, 2), 16); });
    return '#' + [c.r, c.g, c.b].map(function (v, i) { return Math.round(v * c.a + fo[i] * (1 - c.a)).toString(16).padStart(2, '0'); }).join('');
  }
  function colores(valor, c, abajo) {
    var v = crudo(valor, c.capas); if (!v || v === 'transparent' || v === 'none') return [abajo];
    var re = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,\/]+([\d.]+))?\s*\)|var\(\s*--[\w-]+[^)]*\)|#[0-9a-fA-F]{3,6}\b/g, m, out = [];
    while ((m = re.exec(v))) {
      if (m[1] !== undefined) out.push(sobre({ r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }, abajo));
      else if (m[0][0] === 'v') out = out.concat(colores(m[0], c, abajo));
      else { var h = normalizarHex(m[0]); if (h) out.push(h); }
    }
    return out.length ? out : [abajo];
  }
  function gana(selectores, c, props) {
    var g = [];
    selectores.forEach(function (t) { props.forEach(function (p) { var x = ganador(rs, t, c.pref, p); if (x) g.push(x); }); });
    return g.sort(orden).pop() || null;
  }
  function fondoDe(selectores, c, abajo) { var g = gana(selectores, c, ['background', 'background-color']); return g ? colores(g.valor, c, abajo) : [abajo]; }
  function donde(g) { return g ? path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') : ''; }
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var pagina = fondoDe(['body'], c, '#ffffff')[0];
    var card = fondoDe(['.product-card'], c, pagina)[0];
    // «Cerrado» flotante: su fondo compuesto sobre la página y sobre la card; se toma el peor.
    var gCerr = gana(['.wa-status--closed'], c, ['color']);
    var fCerr = [pagina, card].map(function (b) { return fondoDe(['.wa-status--closed'], c, b)[0]; });
    medir({ superficie: 'catálogo', tema: tema, rol: 'píldora', nombre: '«Cerrado» flotante .wa-status--closed', texto: gCerr && colores(gCerr.valor, c, fCerr[0])[0], fondos: fCerr, impone: donde(gCerr) });
    // El contador de cada categoría, sobre su card.
    var cat = fondoDe(['.cat-card', '.section-cats .cat-card', '.cat-grid .cat-card'], c, pagina)[0];
    var gCnt = gana(['.cat-count', '.cat-card .cat-count'], c, ['color']);
    medir({ superficie: 'catálogo', tema: tema, rol: 'píldora', nombre: 'contador de categoría .cat-count', texto: gCnt && colores(gCnt.valor, c, cat)[0], fondos: [cat], impone: donde(gCnt) });
    // «Ver catálogo»: la píldora sobre el banner «Explorá», el banner sobre la página.
    var banner = fondoDe(['.price-banner', '.price-banner--big', '.price-banner-wrap--big .price-banner'], c, pagina)[0];
    var fCta = fondoDe(['.price-banner-cta', '.price-banner--big .price-banner-cta'], c, banner);
    var gCta = gana(['.price-banner-cta', '.price-banner--big .price-banner-cta', '.price-banner-wrap--big .price-banner *'], c, ['color']);
    if (gCta && gCta.valor === 'inherit') gCta = gana(['.price-banner', '.price-banner--big', '.price-banner-wrap--big .price-banner'], c, ['color']);
    medir({ superficie: 'catálogo', tema: tema, rol: 'píldora', nombre: '«Ver catálogo» .price-banner--big .price-banner-cta', texto: gCta && colores(gCta.valor, c, fCta[0])[0], fondos: fCta, impone: donde(gCta) });
  });
})();

// ═══ VENTANA «AVISAME» ═══ [ESPERA-CLARO] 23-sep-2026
// Todos sus textos son <p> (menos el ×): en claro compiten con `body:not(.dark-mode) p` (0,1,2), que le gana a una
// clase sola (0,1,0). Así quedaban #2a2a2d sobre la caja #111 = 1,32 hasta v1.1.115, y este script no lo veía porque
// sólo miraba las reglas de la clase. Acá el ganador se elige entre la regla de la clase y la de la etiqueta.
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  var orden = function (x, y) { return (x.important - y.important) || (x.esp - y.esp) || (x.orden - y.orden); };
  function conEtiqueta(target, etiqueta, c) {
    var g = [ganador(rs, target, c.pref, 'color'), etiqueta ? ganador(rs, etiqueta, c.pref, 'color') : null].filter(Boolean).sort(orden).pop();
    if (!g) return null;
    return { hex: resolver(g.valor, c.capas), impone: path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') };
  }
  var cuerpo = efectivo(rs, 'body', [], 'color', cfg.oscuro.capas);   // lo que hereda un <p> sin regla propia
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var caja = efectivo(rs, '.waitlist-box', c.pref, 'background', c.capas);
    [['título', '.waitlist-title', 'p'], ['perfume', '.waitlist-perfume-name', 'p'], ['descripción', '.waitlist-desc', 'p'],
     ['× cerrar', '.waitlist-close', null], ['× cerrar (hover)', '.waitlist-close:hover', null],
     ['línea del teléfono', '.waitlist-phone-preview', 'p'],
     ['mensaje ¡Listo!', '.waitlist-msg--ok', 'p'], ['mensaje ¡Ya estás!', '.waitlist-msg--ya', 'p'], ['mensaje de error', '.waitlist-msg--error', 'p']].forEach(function (t) {
      var fg = conEtiqueta(t[1], t[2], c) || { hex: cuerpo.hex, impone: 'heredado del body' };
      medir({ superficie: 'catálogo', tema: tema, rol: 'avisame', nombre: t[0] + ' ' + t[1], texto: fg.hex[0], fondos: caja.hex, impone: fg.impone });
    });
  });
})();

// ═══ VENTANA DE JUEGOS ═══ [JUEGOS-VENTANA] 23-sep-2026
// Lo que se ve en el celu con la ventana abierta: ahí el quiz y el Desafío no tienen card propia, el fondo es el de
// la ventana (la misma regla que el detalle). Varios colores y fondos son rgba(): se componen sobre lo que tienen
// abajo (la ventana, o la barra de las pestañas), igual que en pantalla. Los textos <p> / <h3> compiten con la regla
// genérica de la etiqueta, como en la ventana «Avisame».
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  var orden = function (x, y) { return (x.important - y.important) || (x.esp - y.esp) || (x.orden - y.orden); };
  function crudo(v, capas, prof) {
    prof = prof || 0; var s = String(v || '').trim(); var m = s.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (!m || prof > 8) return s;
    for (var i = 0; i < capas.length; i++) if (capas[i] && capas[i][m[1]]) return crudo(capas[i][m[1]], capas, prof + 1);
    return m[2] ? crudo(m[2], capas, prof + 1) : '';
  }
  function rgbaDe(v) { var m = String(v || '').match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,\/]+([\d.]+))?\s*\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; }
  function sobre(c, fondoHex) {
    var f = [1, 3, 5].map(function (i) { return parseInt(fondoHex.substr(i, 2), 16); });
    return '#' + [c.r, c.g, c.b].map(function (v, i) { return Math.round(v * c.a + f[i] * (1 - c.a)).toString(16).padStart(2, '0'); }).join('');
  }
  function aHex(valor, c, abajo) {
    var v = crudo(valor, c.capas); if (!v || v === 'transparent' || v === 'none') return abajo;
    var r = rgbaDe(v); if (r) return sobre(r, abajo);
    var h = normalizarHex(v); if (h) return h;
    var hs = resolver(valor, c.capas); return hs.length ? hs[0] : abajo;   // un gradiente: su primer color
  }
  function fondo(target, c, abajo) {
    var g = [ganador(rs, target, c.pref, 'background'), ganador(rs, target, c.pref, 'background-color')].filter(Boolean).sort(orden).pop();
    return g ? aHex(g.valor, c, abajo) : abajo;
  }
  function tinta(target, etiqueta, c, abajo) {
    var g = [ganador(rs, target, c.pref, 'color'), etiqueta ? ganador(rs, etiqueta, c.pref, 'color') : null].filter(Boolean).sort(orden).pop();
    if (!g) return null;
    return { hex: aHex(g.valor, c, abajo), impone: path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') };
  }
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var hoja_ = fondo('.juegos-sheet', c, '#ffffff');
    var barra = fondo('.juegos-tabs', c, hoja_);
    // [nombre, selector del texto, etiqueta que compite, fondo propio (selector) o null, sobre qué está]
    [['pestaña', '.juegos-tab', null, '.juegos-tab', barra],
     ['pestaña activa', '.juegos-tab.active', null, '.juegos-tab.active', barra],
     ['× cerrar', '.juegos-x', null, null, hoja_],
     ['deslizá para cerrar', '.juegos-sheet .bs-handle-arrow', null, null, hoja_],
     ['título del quiz', '.quiz-title', 'p', null, hoja_],
     ['subtítulo', '.quiz-subtitle', 'p', null, hoja_],
     ['pregunta', '.quiz-question', 'p', null, hoja_],
     ['opción', '.quiz-opt', null, '.quiz-opt', hoja_],
     ['título del Desafío', '.misel-section .nosotros-block-title', 'h3', null, hoja_],
     ['🔒 Iniciá sesión', '.misel-lock', null, '.misel-lock', hoja_]].forEach(function (x) {
      var bg = x[3] ? fondo(x[3], c, x[4]) : x[4];
      var fg = tinta(x[1], x[2], c, bg);
      medir({ superficie: 'catálogo', tema: tema, rol: 'juegos', nombre: x[0] + ' ' + x[1], texto: fg && fg.hex, fondos: [bg], impone: fg ? fg.impone : '' });
    });
  });
})();

// ═══ Salida ═══
function tabla(titulo, lista) {
  if (!lista.length) return;
  console.log('\n' + titulo);
  var cab = ['rol', 'qué', 'texto', 'fondo', 'ratio', '>= 4,5', 'lo impone', 'nota'];
  var cuerpo = lista.map(function (r) {
    if (r.error) return [r.rol, r.nombre, '—', '—', '—', '❌', '—', r.error];
    return [r.rol, r.nombre, r.texto, r.fondos, f2(r.ratio) + ':1', r.ok ? (r.alerta ? '✅⚠️' : '✅') : (r.alerta ? '⚠️' : '❌'), r.impone || '', r.nota || ''];
  });
  var anchos = cab.map(function (h, i) { return Math.max(h.length, Math.max.apply(null, cuerpo.map(function (f) { return String(f[i]).length; }))); });
  var linea = function (f) { return f.map(function (c, i) { return String(c).padEnd(anchos[i]); }).join('  ').replace(/\s+$/, ''); };
  console.log(linea(cab)); console.log(anchos.map(function (a) { return '─'.repeat(a); }).join('  '));
  cuerpo.forEach(function (f) { console.log(linea(f)); });
}
console.log('Contraste del sitio · mínimo ' + f2(MINIMO) + ':1 (WCAG AA texto normal) · valor EFECTIVO en cascada (!important > especificidad > orden)');
[['panel', 'oscuro', '(:root)'], ['panel', 'claro', '(body.light)'],
 ['catálogo', 'oscuro', '(:root + body.dark-mode)'], ['catálogo', 'claro', '(body:not(.dark-mode))']].forEach(function (s) {
  tabla('■ ' + s[0].toUpperCase() + ' · tema ' + s[1] + ' ' + s[2], filas.filter(function (r) { return r.superficie === s[0] && r.tema === s[1]; }));
});
console.log('\n' + (fallas === 0 ? '✅ 0 falla(s)' : '❌ ' + fallas + ' falla(s)') +
            (pisados ? ' + ' + pisados + ' ⚠️ token(s) pisado(s)' : '') +
            (conocidas ? ' + ' + conocidas + ' ⚠️ conocida(s)' : '') + ' · ' + filas.length + ' mediciones.');
process.exit(fallas === 0 ? 0 : 1);
