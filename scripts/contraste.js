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
  // [JUEGOS-VENTANA-PULIDO] «deslizá para cerrar» salió de acá: en oscuro --gris da 5,33 sobre la ventana
  // [HOTSALE-CLARO] el Hot Sale del detalle en claro salió de acá: con #9a3412 da 5,82 al principio de la franja
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
  var ok = r >= (o.minimo || MINIMO) && !o.falloRegla;
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
     ['.stat-perfumes .stat-value', '.stat-card.stat-perfumes .stat-value'], ['.stat-value-inv .stat-value', '.stat-card.stat-value-inv .stat-value'],
     // [VALOR-INV-DEPOSITO] 26-sep · el desglose local / depósito debajo del total
     ['.stat-desglose-nombre (Local / Depósito)', '.stat-desglose-nombre'], ['.stat-desglose-monto (el monto)', '.stat-desglose-monto']].forEach(function (t) {
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

// ═══ CAJAS DEL PANEL ═══ [PANEL-CLARO-CAJAS] 24-sep-2026
// Las cajas que tenían fondo inline #1a1a1a / #1a1a1c pasaron a clase (en claro, la superficie del tema): sus títulos
// dorados sobre la caja y la cabecera, y el efectivo de Precios & Stock sobre la tabla.
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz] }, claro: { pref: ['body.light'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var fondos = ['.caja-dorada', '.cabecera-caja', '.cabecera-caja-c'].reduce(function (a, t) { return a.concat(efectivo(rs, t, c.pref, 'background', c.capas).hex); }, []);
    var tinta = efectivo(rs, '.tinta-dorada', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: 'título dorado .tinta-dorada', texto: tinta.hex[0], fondos: fondos, impone: tinta.impone });
    var tabla = efectivo(rs, '.admin-table', c.pref, 'background', c.capas).hex;
    if (!tabla.length) tabla = efectivo(rs, 'body', [], 'background', c.capas).hex;
    var ef = efectivo(rs, '.td-price.td-efectivo', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: 'efectivo de Precios .td-efectivo', texto: ef.hex[0], fondos: tabla, impone: ef.impone });
    // [PEDIDOS-PASS-CLARO] cada pedido: la letra heredada, «(número no registrado)» y «Pedido: …» (--gris) sobre la caja.
    var pedido = efectivo(rs, '.caja-pedido', c.pref, 'background', c.capas).hex;
    var heredadoP = tema === 'claro' ? (efectivo(rs, 'body.light', [], 'color', c.capas).hex[0] || '#1a1a1a') : '#ffffff';
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: 'pedido de «Pedidos pass» (texto · hereda)', texto: heredadoP, fondos: pedido, impone: 'heredado del body' });
    var noReg = efectivo(rs, '.no-registrado', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: '(número no registrado) .no-registrado', texto: noReg.hex[0], fondos: pedido, impone: noReg.impone });
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: '«Pedido: …» (--gris)', texto: resolver('var(--gris)', c.capas)[0], fondos: pedido, impone: 'token' });
    // «Verificá su identidad…» va sobre la caja de arriba de la pestaña: #111 inline, que en claro el parche por
    // atributo pasa a #fff (este script no lee atributos: el fondo va escrito).
    var aviso = efectivo(rs, '.aviso-verificar', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: '«Verificá su identidad…» .aviso-verificar', texto: aviso.hex[0], fondos: [tema === 'claro' ? '#ffffff' : '#111111'], impone: aviso.impone });
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
    // La flotante, en sus tres estados: su fondo compuesto sobre la página, la card y el banner violeta del juego (sus
    // paradas); se toma el peor. [ESTADO-LOCAL] desde K las tres son opacas: el número es el mismo sobre cualquier cosa.
    var violeta = fondoDe(['.quiz-cta-banner'], c, pagina);
    [['«Cerrado» flotante', '.wa-status--closed'], ['«Abierto» flotante', '.wa-status--open'], ['«Feriado» flotante', '.wa-status--special']].forEach(function (x) {
      var g = gana([x[1]], c, ['color']);
      var f = [pagina, card].concat(violeta).map(function (b) { return fondoDe([x[1]], c, b)[0]; });
      medir({ superficie: 'catálogo', tema: tema, rol: 'píldora', nombre: x[0] + ' ' + x[1], texto: g && colores(g.valor, c, f[0])[0], fondos: f, impone: donde(g) });
    });
    // [PILDORA-ANILLO] el anillo (el color de la primera sombra de .wa-status) contra lo que la píldora tiene abajo, en
    // oscuro: la página, la card y las paradas del banner violeta. No es texto: mínimo 3. En claro no se cuenta (sobre
    // blanco o crema separa el fondo de la píldora, que ya da 5,89 o más).
    if (tema === 'oscuro') {
      var gAni = gana(['.wa-status'], c, ['box-shadow']);
      var ani = gAni && (String(gAni.valor).match(/#[0-9a-fA-F]{3,6}\b/) || [])[0];
      medir({ superficie: 'catálogo', tema: tema, rol: 'píldora', nombre: 'anillo de la flotante .wa-status (no es texto)', texto: ani ? normalizarHex(ani) : null, fondos: [pagina, card].concat(violeta), minimo: 3, extra: 'mínimo 3', impone: donde(gAni) });
    }
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
    // [CERRADO-HERO] «Cerrado» del hero: su fondo (en claro, el #fff !important de mayo) sobre el hero.
    var hero = fondoDe(['.hero'], c, pagina)[0];
    var fHero = fondoDe(['.store-status', '.store-status.closed'], c, hero);
    var gHero = gana(['.store-status.closed'], c, ['color']);
    medir({ superficie: 'catálogo', tema: tema, rol: 'píldora', nombre: '«Cerrado» del hero .store-status.closed', texto: gHero && colores(gHero.valor, c, fHero[0])[0], fondos: fHero, impone: donde(gHero) });
    // [ESTADO-LOCAL] «Abierto» y «Feriado» del hero: en claro sobre el mismo #fff; en oscuro sobre su propio rgba.
    [['«Abierto» del hero', '.store-status.open'], ['«Feriado» del hero', '.store-status.holiday']].forEach(function (x) {
      var f = fondoDe(['.store-status', x[1]], c, hero), g = gana([x[1]], c, ['color']);
      medir({ superficie: 'catálogo', tema: tema, rol: 'píldora', nombre: x[0] + ' ' + x[1], texto: g && colores(g.valor, c, f[0])[0], fondos: f, impone: donde(g) });
    });
    // [AMARILLO-CATALOGO-CLARO] los textos dorados que en claro seguían en #E8B800: contra la página (en claro #e3d6b3,
    // el fondo más oscuro donde aparecen) y contra la card. El DOM los mide uno por uno sobre su fondo real.
    ['.hero-title em', '.section-title em', '.nosotros-intro em', '.set-items-list li::before', '.set-price-promo', '.seo-hub-card .seo-hub-cta',
     '.nosotros-link', '.nosotros-list li::before', '.cart-item-price', '.cart-total-amount', '.occasion-title'].forEach(function (sel) {
      var g = gana([sel], c, ['color']);
      medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: sel, texto: g && colores(g.valor, c, pagina)[0], fondos: [pagina, card], impone: donde(g) });
    });
  });
})();

// ═══ BARRA DE ABAJO DEL CELU ═══ [BARRA-CELU] 24-sep-2026
// La barra es #0b0b0d en los dos temas: las etiquetas (apagada y activa), los números del carrito y del pack, y la hoja
// «Hola, <nombre>» (#111). Las reglas viven en un @media (max-width: 767px): este script las lee igual.
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var barra = efectivo(rs, '.barra-celu', c.pref, 'background', c.capas).hex;
    [['etiqueta apagada', '.barra-btn', barra], ['etiqueta activa («Catálogo»)', '.barra-btn.activo', barra]].forEach(function (x) {
      var fg = efectivo(rs, x[1], c.pref, 'color', c.capas);
      medir({ superficie: 'catálogo', tema: tema, rol: 'barra', nombre: x[0] + ' ' + x[1], texto: fg.hex[0], fondos: x[2], impone: fg.impone });
    });
    var num = efectivo(rs, '.barra-num', c.pref, 'color', c.capas), numFondo = efectivo(rs, '.barra-num', c.pref, 'background', c.capas);
    medir({ superficie: 'catálogo', tema: tema, rol: 'barra', nombre: 'número del carrito y del pack .barra-num', texto: num.hex[0], fondos: numFondo.hex, impone: num.impone });
    var hoja = efectivo(rs, '.cuenta-hoja', c.pref, 'background', c.capas).hex;
    [['título «Hola, …»', '.cuenta-hoja-titulo'], ['fila', '.cuenta-hoja-fila'], ['«Cerrar sesión»', '.cuenta-hoja-salir']].forEach(function (x) {
      var fg = efectivo(rs, x[1], c.pref, 'color', c.capas);
      medir({ superficie: 'catálogo', tema: tema, rol: 'barra', nombre: x[0] + ' ' + x[1], texto: fg.hex[0], fondos: hoja, impone: fg.impone });
    });
  });
})();

// ═══ LA LETRA LA DECIDE EL FONDO ═══ [BOTONES-CONTRASTE] [CINTA-TINTA] 24-sep-2026 (parte K, decisiones 94 y 95)
// Los botones del panel con fondo de color propio (WhatsApp, gris y los 7 de etiqueta) y la cinta de la card: la letra
// es la misma en los dos temas y la elige el fondo (regla 19: si el fondo pide letra oscura y va clara, falla aunque el
// número pase). La cinta la pinta js/app.js: se lee su bloque (colorCinta + letraSobre) y se prueba con los colores que
// ofrece el panel (los setEtiqueta de admin.html) y con dos que no tienen que entrar al HTML (caen al dorado).
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz] }, claro: { pref: ['body.light'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    ['.btn-whatsapp', '.btn-gris', '.btn-etq-nuevo', '.btn-etq-mes', '.btn-etq-vendido', '.btn-etq-ultimas', '.btn-etq-exclusivo',
     '.btn-etq-limitada', '.btn-etq-recomendado', '.btn-etq-quitar'].forEach(function (t) {
      var bg = efectivo(rs, t, c.pref, 'background', c.capas), fg = efectivo(rs, t, c.pref, 'color', c.capas);
      var extra = '', fallo = false;
      if (bg.hex[0] && fg.hex[0]) {
        var manda = contraste(bg.hex[0], '#000000') > contraste(bg.hex[0], '#ffffff') ? 'oscuro' : 'claro';
        // [QUITAR-ETIQUETA-CONTRASTE] clara u oscura RESPECTO DE SU FONDO (con un corte fijo en 0,5, el #ff8a80 de «✕
        // QUITAR» —luminancia 0,41— contaba como oscuro sobre #333).
        var es = luminancia(fg.hex[0]) < luminancia(bg.hex[0]) ? 'oscuro' : 'claro';
        fallo = es !== manda; extra = fallo ? 'regla 19 ❌ (el fondo pide letra ' + manda + ')' : 'regla 19 ✅';
      }
      medir({ superficie: 'panel', tema: tema, rol: 'botón', nombre: t, texto: fg.hex[0], fondos: bg.hex, extra: extra, falloRegla: fallo, impone: fg.impone });
    });
  });
})();
(function () {
  var src = fs.readFileSync(path.join(RAIZ, 'js/app.js'), 'utf8');
  var ini = src.indexOf('var CINTA_COLOR_DEFAULT'), fn = src.indexOf('function letraSobre', ini);
  var cinta = null;
  if (ini >= 0 && fn > ini) {
    var fin = src.indexOf('{', fn), prof = 0;
    for (; fin < src.length; fin++) { if (src[fin] === '{') prof++; else if (src[fin] === '}' && --prof === 0) break; }
    cinta = new Function(src.slice(ini, fin + 1) + '\nreturn { colorCinta: colorCinta, letraSobre: letraSobre };')();
  }
  var panel = fs.readFileSync(path.join(RAIZ, 'admin.html'), 'utf8');
  var lista = [], re = /setEtiqueta\('([^']+)','(#[0-9a-fA-F]{3,6})'\)/g, m;
  while ((m = re.exec(panel))) lista.push({ nombre: m[1], color: m[2], valido: true });
  lista.push({ nombre: '(color inválido)', color: 'red', valido: false }, { nombre: '(intento de romper el atributo)', color: '#fff" onmouseover="x', valido: false });
  ['oscuro', 'claro'].forEach(function (tema) {
    if (!cinta) { medir({ superficie: 'catálogo', tema: tema, rol: 'cinta', nombre: 'cinta (no encontré colorCinta / letraSobre en js/app.js)', texto: null, fondos: [] }); return; }
    lista.forEach(function (x) {
      var fondo = cinta.colorCinta(x.color), letra = cinta.letraSobre(fondo);
      var entra = fondo === x.color;
      var fallo = entra !== x.valido || (!x.valido && fondo !== '#E8B800');
      var extra = x.valido ? (entra ? 'entra tal cual' : '❌ un color válido no entró') : (entra ? '❌ entró al HTML' : 'no entra: cae al dorado ' + fondo);
      medir({ superficie: 'catálogo', tema: tema, rol: 'cinta', nombre: 'cinta «' + x.nombre + '» ' + x.color, texto: normalizarHex(letra), fondos: [normalizarHex(fondo)], extra: extra, falloRegla: fallo, impone: 'app.js letraSobre' });
    });
  });
})();

// ═══ PROMO DE DECANTS ═══ [PROMO-DECANTS] 24-sep-2026 (parte N)
// Catálogo: el chip «3×» del armador y la etiqueta de la card (#000 sobre #E8B800, los dos temas), la línea de la promo en
// el pie del armador (el pie es oscuro en los dos temas) y «Precio a consultar» sobre la card del armador (sin la opacidad
// que tenía). Panel: los cuatro estados de la promo (decisión 113), su segundo renglón y los avisos de costo, sobre la caja.
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  var orden = function (x, y) { return (x.important - y.important) || (x.esp - y.esp) || (x.orden - y.orden); };
  function gana(sels, c, props) { var g = []; sels.forEach(function (t) { props.forEach(function (p) { var x = ganador(rs, t, c.pref, p); if (x) g.push(x); }); }); return g.sort(orden).pop() || null; }
  function hexDe(g, c) { if (!g) return null; var h = resolver(g.valor, c.capas); return h[0] || null; }
  function donde(g) { return g ? path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') : ''; }
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    [['chip «3×» del armador', ['.decant-builder .decant-card-name .decant-chip-promo', '.decant-chip-promo']],
     ['etiqueta de la card .badge-promo', ['.badge-promo']]].forEach(function (x) {
      var fg = gana(x[1], c, ['color']), bg = gana(x[1], c, ['background', 'background-color']);
      medir({ superficie: 'catálogo', tema: tema, rol: 'promo', nombre: x[0], texto: hexDe(fg, c), fondos: [hexDe(bg, c)].filter(Boolean), impone: donde(fg) });
    });
    var pie = gana(['.decant-builder-footer', '.decant-builder-footer.has-items'], c, ['background', 'background-color']);
    var linea = gana(['.decant-builder .decant-builder-footer .decant-builder-promo', '.decant-builder-promo'], c, ['color']);
    medir({ superficie: 'catálogo', tema: tema, rol: 'promo', nombre: '«Sumá 2 más con 3× y cada uno te sale $6.000» (pie del armador)', texto: hexDe(linea, c), fondos: [hexDe(pie, c)].filter(Boolean), impone: donde(linea) });
    var lineaTope = gana(['.decant-builder .decant-builder-footer .decant-builder-promo--tope', '.decant-builder .decant-builder-footer .decant-builder-promo'], c, ['color']);
    medir({ superficie: 'catálogo', tema: tema, rol: 'promo', nombre: '«Máximo de la promo: …» (pie del armador)', texto: hexDe(lineaTope, c), fondos: [hexDe(pie, c)].filter(Boolean), impone: donde(lineaTope) });
    var card = gana(['.decant-card', '.decant-builder-grid > *'], c, ['background', 'background-color']);
    var pend = gana(['.decant-card-price-pending'], c, ['color']);
    medir({ superficie: 'catálogo', tema: tema, rol: 'promo', nombre: '«Precio a consultar» .decant-card-price-pending', texto: hexDe(pend, c), fondos: [hexDe(card, c)].filter(Boolean), impone: donde(pend) });
  });
})();
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz] }, claro: { pref: ['body.light'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var caja = efectivo(rs, '.promo-caja', c.pref, 'background', c.capas).hex;
    [['estado «Apagada»', '.promo-estado--apagada'], ['estado «Programada»', '.promo-estado--programada'], ['estado «Prendida»', '.promo-estado--prendida'],
     ['estado «Terminó…»', '.promo-estado--terminada'], ['«Para repetirla…»', '.promo-estado-2'], ['aviso de costo', '.promo-aviso-costo'], ['fila «pierde $X»', '.promo-fila-nota--pierde']].forEach(function (x) {
      var fg = efectivo(rs, x[1], c.pref, 'color', c.capas);
      medir({ superficie: 'panel', tema: tema, rol: 'promo', nombre: x[0] + ' ' + x[1], texto: fg.hex[0], fondos: caja, impone: fg.impone });
    });
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
    // [JUEGOS-VENTANA-PULIDO] los puntos del quiz no son texto, pero son lo único que dice cuánto falta: el anillo de los
    // que faltan (el color de su borde) y el relleno del hecho, contra la ventana, con el mismo piso.
    var colorDe = function (v) { var m = String(v || '').match(/var\([^)]*\)|#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/); return m ? aHex(m[0], c, hoja_) : null; };
    var donde = function (g) { return g ? path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') : ''; };
    var anillo = ganador(rs, '.quiz-dot', c.pref, 'border'), hecho = ganador(rs, '.quiz-dot.filled', c.pref, 'background');
    medir({ superficie: 'catálogo', tema: tema, rol: 'juegos', nombre: 'punto que falta .quiz-dot (anillo)', texto: anillo && colorDe(anillo.valor), fondos: [hoja_], impone: donde(anillo) });
    medir({ superficie: 'catálogo', tema: tema, rol: 'juegos', nombre: 'punto hecho .quiz-dot.filled', texto: hecho && colorDe(hecho.valor), fondos: [hoja_], impone: donde(hecho) });
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
