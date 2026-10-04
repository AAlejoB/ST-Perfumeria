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
  // [CLIENTES-OSCURO-ROJO] salió de acá el 29-sep: en oscuro, #ff8a80 da 7,13 (Eliminar) y 7,39 (✗ NO COMPRÓ)
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
     ['.stat-desglose-nombre (Local / Depósito)', '.stat-desglose-nombre'], ['.stat-desglose-monto (el monto)', '.stat-desglose-monto'],
     ['.stat-desglose-pausados (el monto)', '.stat-desglose-pausados .stat-desglose-monto']].forEach(function (t) {
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
    // [PRECIOS-EN-UN-LUGAR] 123 · la línea gris de debajo del nombre (marca y excepciones), el DECANT de contorno (123f) y el «—» / «a consultar».
    [['línea gris .td-sub (marca / excepción)', '.td-sub'], ['DECANT .badge-decant (contorno, sin relleno)', '.td-stock .badge-stock.badge-decant'], ['«—» y «a consultar» .td-sin / .td-consultar', '.admin-table td.td-price.td-sin'], ['título de grupo «Frascos · N» .fila-grupo', tema === 'claro' ? '.admin-table tbody .fila-grupo td' : '.fila-grupo td'], ['123j · precio del decant en la fila del frasco .td-decant-precio', '.td-decant-precio']].forEach(function (t) {
      var x = efectivo(rs, t[1], c.pref, 'color', c.capas);
      medir({ superficie: 'panel', tema: tema, rol: 'precios', nombre: t[0], texto: x.hex[0], fondos: tabla, impone: x.impone });
    });
    // [PEDIDOS-PASS-CLARO] cada pedido: la letra heredada, «(número no registrado)» y «Pedido: …» (--gris) sobre la caja.
    var pedido = efectivo(rs, '.caja-pedido', c.pref, 'background', c.capas).hex;
    var heredadoP = tema === 'claro' ? (efectivo(rs, 'body.light', [], 'color', c.capas).hex[0] || '#1a1a1a') : '#ffffff';
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: 'pedido de «Reset contraseñas» (texto · hereda)', texto: heredadoP, fondos: pedido, impone: 'heredado del body' });
    var noReg = efectivo(rs, '.no-registrado', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: '(número no registrado) .no-registrado', texto: noReg.hex[0], fondos: pedido, impone: noReg.impone });
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: '«Pedido: …» (--gris)', texto: resolver('var(--gris)', c.capas)[0], fondos: pedido, impone: 'token' });
    // «Verificá su identidad…» va sobre la caja de arriba de la pestaña: #111 inline, que en claro el parche por
    // atributo pasa a #fff (este script no lee atributos: el fondo va escrito).
    var aviso = efectivo(rs, '.aviso-verificar', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'cajas', nombre: '«Verificá su identidad…» .aviso-verificar', texto: aviso.hex[0], fondos: [tema === 'claro' ? '#ffffff' : '#111111'], impone: aviso.impone });
  });
})();

// ═══ LA ESPERA ═══ [ESPERA-MAS] 27-sep-2026
// La pestaña Espera pasó a las dos cuentas (las chicas usan el claro) y sus colores inline, a clases. Cada texto se
// mide contra lo que tiene abajo: la página, la tarjeta o el grupo (--superficie), la ventana del formulario, el campo
// del teléfono o el chip. Los fondos rgba() de los botones se componen sobre el grupo, como en pantalla. Lo que no
// declara color (o dice inherit) hereda: del body, o de la ventana en claro (body.light .modal-box pone #1a1a1a).
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz] }, claro: { pref: ['body.light'], capas: [luz, raiz] } };
  var orden = function (x, y) { return (x.important - y.important) || (x.esp - y.esp) || (x.orden - y.orden); };
  function crudo(v, capas, prof) {
    prof = prof || 0; var t = String(v || '').trim(); var m = t.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (!m || prof > 8) return t;
    for (var i = 0; i < capas.length; i++) if (capas[i] && capas[i][m[1]]) return crudo(capas[i][m[1]], capas, prof + 1);
    return m[2] ? crudo(m[2], capas, prof + 1) : '';
  }
  function rgbaDe(v) { var m = String(v || '').match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,\/]+([\d.]+))?\s*\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; }
  function sobre(c, fondoHex) {
    var fo = [1, 3, 5].map(function (i) { return parseInt(fondoHex.substr(i, 2), 16); });
    return '#' + [c.r, c.g, c.b].map(function (v, i) { return Math.round(v * c.a + fo[i] * (1 - c.a)).toString(16).padStart(2, '0'); }).join('');
  }
  function aHex(valor, c, abajo) {
    var v = crudo(valor, c.capas); if (!v || v === 'transparent' || v === 'none') return abajo;
    var r = rgbaDe(v); if (r) return sobre(r, abajo);
    var h = normalizarHex(v); if (h) return h;
    var hs = resolver(valor, c.capas); return hs.length ? hs[0] : abajo;
  }
  function fondo(target, c, abajo) {
    var g = [ganador(rs, target, c.pref, 'background'), ganador(rs, target, c.pref, 'background-color')].filter(Boolean).sort(orden).pop();
    return g ? aHex(g.valor, c, abajo) : abajo;
  }
  function tinta(target, c, abajo, hereda) {
    var g = target ? ganador(rs, target, c.pref, 'color') : null;
    if (!g || /^(inherit|currentcolor)$/i.test(crudo(g.valor, c.capas))) return { hex: hereda, impone: g ? 'inherit · ' + path.basename(g.archivo) + ':' + g.linea : 'heredado' };
    return { hex: aHex(g.valor, c, abajo), impone: path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') };
  }
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var pagina = fondo('body', c, '#000000');
    var cuerpo = tema === 'claro' ? (efectivo(rs, 'body.light', [], 'color', c.capas).hex[0] || '#1a1a1a') : '#ffffff';
    var tarjeta = fondo('.espera-stat', c, pagina), grupo = fondo('.espera-grupo', c, pagina);
    var ventana = fondo('.modal-box', c, pagina);
    var enVentana = tinta('.modal-box', c, ventana, cuerpo).hex;
    var campoTel = fondo('.espera-tel', c, ventana), chip = fondo('.espera-chip', c, ventana), resultado = fondo('.espera-resultado', c, ventana);
    // [nombre, selector del texto (null = hereda), fondo propio (selector) o null, sobre qué, de quién hereda]
    [['«+ Anotar del mostrador» .espera-anotar', '.espera-anotar', null, pagina, cuerpo],
     ['ayuda de la pestaña .espera-ayuda', '.espera-ayuda', null, pagina, cuerpo],
     ['ESPERANDO .espera-stat--pend', '.espera-stat--pend .espera-stat-titulo', null, tarjeta, cuerpo],
     ['PERFUMES .espera-stat-titulo', '.espera-stat-titulo', null, tarjeta, cuerpo],
     ['número de la tarjeta (hereda)', null, null, tarjeta, cuerpo],
     ['«personas en lista» .espera-stat-sub', '.espera-stat-sub', null, tarjeta, cuerpo],
     ['perfume / cliente / «🏪 Local» (hereda)', null, null, grupo, cuerpo],
     ['EN STOCK .espera-estado--ok', '.espera-estado--ok', null, grupo, cuerpo],
     ['SIN STOCK .espera-estado--out', '.espera-estado--out', null, grupo, cuerpo],
     ['«2 esperando» .espera-cuenta', '.espera-cuenta', null, grupo, cuerpo],
     ['teléfono · fecha .espera-sub', '.espera-sub', null, grupo, cuerpo],
     ['Avisar .btn-price', '.btn-price', '.btn-price', grupo, cuerpo],
     ['Re-avisar .btn-reavisar', '.btn-reavisar', '.btn-reavisar', grupo, cuerpo],
     ['Quitar .btn-quitar-espera', '.btn-quitar-espera', '.btn-quitar-espera', grupo, cuerpo],
     ['texto de la ventana (hereda)', null, null, ventana, enVentana],
     ['descripción .espera-form-desc', '.espera-form-desc', null, ventana, enVentana],
     ['«+54 9» .espera-tel-prefijo', '.espera-tel-prefijo', null, campoTel, enVentana],
     ['número tipeado (hereda)', '.espera-tel input', null, campoTel, enVentana],
     ['«✓ +54 9 …» .espera-ok', '.espera-ok', null, ventana, enVentana],
     ['«(faltan dígitos)» .espera-falta', '.espera-falta', null, ventana, enVentana],
     ['resultado del buscador (hereda)', '.espera-resultado', '.espera-resultado', ventana, enVentana],
     ['marca del resultado .espera-resultado small', '.espera-resultado small', null, resultado, enVentana],
     ['perfume elegido, en el chip (hereda)', null, null, chip, enVentana],
     ['[ESPERA-LIBRE] 142 · «+» de «Anotar «…»» .espera-opcion-mas', '.espera-opcion-mas', null, chip, enVentana],
     ['[ESPERA-LIBRE] 142 · «fuera del catálogo» de la opción .espera-opcion-sub', '.espera-opcion-sub', null, chip, enVentana],
     ['[ESPERA-LIBRE] 142a · «fuera del catálogo» del chip .espera-chip-estado.espera-libre', '.espera-chip-estado.espera-libre', null, chip, enVentana],
     ['[ESPERA-LIBRE] 142b · «FUERA DEL CATÁLOGO» .espera-estado--libre', '.espera-estado--libre', null, grupo, cuerpo]].forEach(function (x) {
      var bg = x[2] ? fondo(x[2], c, x[3]) : x[3];
      var fg = tinta(x[1], c, bg, x[4]);
      medir({ superficie: 'panel', tema: tema, rol: 'espera', nombre: x[0], texto: fg.hex, fondos: [bg], impone: fg.impone });
    });
    // «Ya está anotado…» y «No se pudo anotar» van en el chip y, resumidos, debajo del botón: contra los dos fondos.
    [['«Ya está anotado…» .espera-ya', '.espera-ya'], ['«No se pudo…» .espera-error', '.espera-error']].forEach(function (x) {
      var fg = tinta(x[1], c, chip, enVentana);
      medir({ superficie: 'panel', tema: tema, rol: 'espera', nombre: x[0], texto: fg.hex, fondos: [chip, ventana], impone: fg.impone });
    });
    // [PANEL-INICIO] 133 + 135 + 128n (30-sep-2026): la pantalla de inicio, el botón «Inicio» del encabezado, la badge «Empleado»
    // (su color va inline en applyRolePermissions: var(--gris-claro) sobre rgba(255,255,255,.06), escrito acá) y lo de 128n.
    var boton = fondo('.inicio-btn', c, pagina), superficie = aHex('var(--superficie)', c, pagina), toque = aHex('var(--inicio-toque)', c, pagina);
    [['«Inicio» en Inicio .panel-inicio.active', '.panel-inicio.active', '.panel-inicio.active', pagina, cuerpo],
     ['«Inicio» en otra pestaña .panel-inicio', '.panel-inicio', null, pagina, cuerpo],
     ['nombre del botón .inicio-nombre (hereda)', '.inicio-nombre', null, boton, cuerpo],
     ['«— esperando» / «Nadie esperando» .inicio-sub', '.inicio-sub', null, boton, cuerpo],
     ['«10 esperando» .inicio-sub.pide', '.inicio-sub.pide', null, boton, cuerpo],
     ['nombre del botón tocado (hereda)', '.inicio-nombre', null, toque, cuerpo],
     ['«— esperando» en el botón tocado .inicio-btn:active .inicio-sub', '.inicio-btn:active .inicio-sub:not(.pide)', null, toque, cuerpo],
     ['«10 esperando» en el botón tocado .inicio-sub.pide', '.inicio-sub.pide', null, toque, cuerpo],
     ['«☰ Ver todas las pestañas» .inicio-todas', '.inicio-todas', null, pagina, cuerpo],
     ['128n · línea «No se pudo cargar el stock» .aviso-lectura-tabla', '.aviso-lectura-tabla', null, pagina, cuerpo],
     ['128n · Estado «—» .stock-sin-lectura', '.td-stock .stock-sin-lectura', null, superficie, cuerpo]].forEach(function (x) {
      var bg = x[2] ? fondo(x[2], c, x[3]) : x[3];
      var fg = tinta(x[1], c, bg, x[4]);
      medir({ superficie: 'panel', tema: tema, rol: 'inicio', nombre: x[0], texto: fg.hex, fondos: [bg], impone: fg.impone });
    });
    var gc = aHex('var(--gris-claro)', c, pagina), gb = aHex('var(--gris)', c, pagina), fb = sobre({ r: 255, g: 255, b: 255, a: .06 }, pagina);
    medir({ superficie: 'panel', tema: tema, rol: 'inicio', nombre: '135 · badge «Empleado» (letra --gris-claro, inline)', texto: gc, fondos: [fb], impone: 'admin.html · applyRolePermissions' });
    medir({ superficie: 'panel', tema: tema, rol: 'inicio', nombre: '135 · badge «Empleado» (borde --gris, inline)', texto: gb, fondos: [pagina], impone: 'admin.html · applyRolePermissions' });
    // [TINTA-MENSAJES] 136 (30-sep-2026): las tres tintas de los mensajes, sobre los fondos reales donde se pintan (los del DISEÑADOR:
    // claro #fff #f5f3ee #fdf9eb #fffaf0 · oscuro #0a0a0a #111111 #1a1a1c #1a1a1d #221e10) y las clases que las usan.
    var fondosMsg = tema === 'claro' ? ['#ffffff', '#f5f3ee', '#fdf9eb', '#fffaf0'] : ['#0a0a0a', '#111111', '#1a1a1c', '#1a1a1d', '#221e10'];
    [['--tinta-ok', 'se hizo lo que pediste'], ['--tinta-aviso', 'no pasó nada y no hay nada roto'], ['--tinta-error', 'no se pudo / el dato está mal']].forEach(function (t) {
      medir({ superficie: 'panel', tema: tema, rol: 'tintas', nombre: '136 · ' + t[0] + ' (' + t[1] + ')', texto: aHex('var(' + t[0] + ')', c, pagina), fondos: fondosMsg, impone: 'admin.html · :root / body.light' });
    });
    [['.modal-success (mensajes de los modales)', '.modal-success', pagina], ['.barra-error (motivo de «No se guardó»)', '.barra-error', pagina],
     ['.espera-ok', '.espera-ok', pagina], ['.espera-ya', '.espera-ya', pagina], ['.espera-error', '.espera-error', pagina],
     ['.ajuste-error', '.ajuste-error', pagina], ['.promo-estado--apagada', '.promo-estado--apagada', pagina], ['.promo-estado--programada', '.promo-estado--programada', pagina], ['.promo-estado--prendida', '.promo-estado--prendida', pagina], ['.promo-estado--terminada', '.promo-estado--terminada', pagina], ['.promo-estado-2 (renglón de «Terminó»)', '.promo-estado-2', pagina],
     ['.promo-aviso-costo', '.promo-aviso-costo', pagina], ['.promo-fila-nota--pierde', '.promo-fila-nota--pierde', pagina]].forEach(function (x) {
      var fg = tinta(x[1], c, x[2], cuerpo);
      medir({ superficie: 'panel', tema: tema, rol: 'tintas', nombre: '136 · ' + x[0], texto: fg.hex, fondos: [x[2]], impone: fg.impone });
    });
    // [BTN-STOCK-AZUL] 138b: la etiqueta MINI de los combos, y las otras dos para tenerlas a la vista
    [['138b · MINI .combo-badge-mini', '.combo-badge-mini'], ['PACK .combo-badge-pack', '.combo-badge-pack'], ['138c · REGALO .combo-badge-regalo', '.combo-badge-regalo'], ['138c · ROTO .combo-badge-roto', '.combo-badge-roto'], ['138d · PAUSADO .combo-badge-pausado', '.combo-badge-pausado'], ['138d · Pausar .client-btn-pausar', '.client-btn-pausar'], ['138d · Activar .client-btn-activar', '.client-btn-activar']].forEach(function (x) {
      var bg = fondo(x[1], c, pagina), fg = tinta(x[1], c, bg, '#ffffff');
      medir({ superficie: 'panel', tema: tema, rol: 'tintas', nombre: x[0], texto: fg.hex, fondos: [bg], impone: fg.impone });
    });
    // [COMBO-ROTO-BORDE] 138e: el tachado de la tarjeta rota (letra de --tinta-error sobre la tarjeta) y su borde de 2 px contra la página; [PUNTOS-MODO-CLARO] 141d: «+ Sumar» / «− Restar»
    // de «Ajustar puntos», sin elegir (sobre --superficie) y elegidos (el rol al 10 % sobre --superficie); [ETIQUETA-QUE-MIENTE] 142k: «SIN DATO» y «-1 u.» van en .badge-out
    var tarjetaRota = tema === 'claro' ? '#ffffff' : '#111111';
    var rolOk = tema === 'claro' ? { r: 30, g: 91, b: 58 } : { r: 46, g: 204, b: 113 }, rolMal = tema === 'claro' ? { r: 184, g: 52, b: 42 } : { r: 255, g: 138, b: 128 };
    var okSobre = sobre({ r: rolOk.r, g: rolOk.g, b: rolOk.b, a: .10 }, superficie), malSobre = sobre({ r: rolMal.r, g: rolMal.g, b: rolMal.b, a: .10 }, superficie);
    [['138e · tachado de la tarjeta rota .combo-item-roto', aHex('var(--tinta-error)', c, pagina), [tarjetaRota], 'admin.html · .combo-items-list li.combo-item-roto'],
     ['138e · borde de 2 px de la tarjeta rota (--tinta-error) contra la página', aHex('var(--tinta-error)', c, pagina), [pagina], 'admin.html · .combo-card--rota'],
     ['141d · «+ Sumar» sin elegir .btn-modo-sumar', aHex('var(--tinta-ok)', c, pagina), [superficie], 'admin.html · .btn-modo-sumar'],
     ['141d · «− Restar» sin elegir .btn-modo-restar', aHex('var(--tinta-error)', c, pagina), [superficie], 'admin.html · .btn-modo-restar'],
     ['141d · «+ Sumar» elegido .btn-modo-sumar.activo', aHex('var(--tinta-ok)', c, pagina), [okSobre], 'admin.html · .btn-modo-sumar.activo'],
     ['141d · «− Restar» elegido .btn-modo-restar.activo', aHex('var(--tinta-error)', c, pagina), [malSobre], 'admin.html · .btn-modo-restar.activo']].forEach(function (x) {
      medir({ superficie: 'panel', tema: tema, rol: 'tintas', nombre: x[0], texto: x[1], fondos: x[2], impone: x[3] });
    });
    (function () { var bg = fondo('.badge-out', c, pagina), fg = tinta('.badge-out', c, bg, '#ffffff'); medir({ superficie: 'panel', tema: tema, rol: 'tintas', nombre: '142k · «SIN DATO» y «-1 u.» .badge-out', texto: fg.hex, fondos: [bg], impone: fg.impone }); })();
    // [PUNTOS-DELTA-TINTA] 141j: el + (--tinta-ok) y el − (--tinta-error) de los dos historiales de puntos, sobre la tarjeta (blanco en claro, #111 en oscuro)
    [['141j · + del historial de puntos .puntos-delta--mas', '--tinta-ok'], ['141j · − del historial de puntos .puntos-delta--menos', '--tinta-error']].forEach(function (x) {
      medir({ superficie: 'panel', tema: tema, rol: 'tintas', nombre: x[0], texto: aHex('var(' + x[1] + ')', c, pagina), fondos: [tarjetaRota], impone: 'admin.html · ' + x[0].split(' ').pop() });
    });
    // [FOCO-CLARO] el borde del campo con foco (no es texto: pide 3:1) contra los fondos que lo rodean: el blanco del campo y de los modales, los cremas del panel y el crema del campo (#faf8f3)
    medir({ superficie: 'panel', tema: tema, rol: 'foco', nombre: 'FOCO-CLARO · borde del campo con foco (' + (tema === 'claro' ? '--amarillo-tinta' : '--amarillo, sin cambios') + ')', texto: aHex(tema === 'claro' ? 'var(--amarillo-tinta)' : 'var(--amarillo)', c, pagina), fondos: tema === 'claro' ? ['#ffffff', '#faf8f3', '#f5f3ee', '#fdf9eb', '#fffaf0'] : ['#0a0a0a', '#111111', '#1a1a1c', '#1a1a1d', '#221e10'], impone: 'admin.html · body.light input:focus (!important) y body.light .espera-tel:focus-within (141h-b)' });
    // [BTN-STOCK-AZUL] 138: letra blanca sobre el azul (reposo y con mouse)
    [['138 · .btn-stock (reposo)', '.btn-stock'], ['138 · .btn-stock:hover (con mouse)', '.btn-stock:hover']].forEach(function (x) {
      var bg = fondo(x[1], c, pagina), fg = tinta(x[1], c, bg, '#ffffff');
      medir({ superficie: 'panel', tema: tema, rol: 'tintas', nombre: x[0], texto: fg.hex, fondos: [bg], impone: fg.impone });
    });
  });
})();

// ═══ LA BARRA DE «GUARDAR» ═══ [GUARDAR-ABAJO] 27-sep-2026
// Los botones que se mudaron a la barra fija conservan su fondo; el secundario de Decants (.action-btn sin modificador)
// va sobre su propio fondo (--superficie) con la letra heredada. «Cancelar» lleva #fff sobre #333 inline (este script no
// lee atributos: va escrito).
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz] }, claro: { pref: ['body.light'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var barra = efectivo(rs, '.barra-guardar', c.pref, 'background', c.capas).hex;
    var cuerpo = tema === 'claro' ? (efectivo(rs, 'body.light', [], 'color', c.capas).hex[0] || '#1a1a1a') : '#ffffff';
    var rec = efectivo(rs, '.action-btn:not([class*="btn-"])', c.pref, 'background', c.capas).hex;
    medir({ superficie: 'panel', tema: tema, rol: 'guardar', nombre: '«↺ Recargar» .action-btn (hereda)', texto: cuerpo, fondos: rec.length ? rec : barra, impone: 'heredado del body' });
    var pbg = efectivo(rs, '.modal-btn-price', c.pref, 'background', c.capas), pfg = efectivo(rs, '.modal-btn-price', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'guardar', nombre: '«Guardar …» .modal-btn-price', texto: pfg.hex[0], fondos: pbg.hex, impone: pfg.impone });
    medir({ superficie: 'panel', tema: tema, rol: 'guardar', nombre: '«Cancelar» (#fff sobre #333, inline)', texto: '#ffffff', fondos: ['#333333'], impone: 'inline' });
    // 128 · «Guardando…»: el botón deshabilitado, con la opacidad que gane entre .modal-btn:disabled (0,2,0) y
    // .barra-guardar > button:disabled (0,2,1). El botón entero se mezcla con la barra: letra y fondo, los dos.
    var op = [ganador(rs, '.modal-btn:disabled', c.pref, 'opacity'), ganador(rs, '.barra-guardar > button:disabled', c.pref, 'opacity')]
      .filter(Boolean).sort(function (a, b) { return (a.important - b.important) || (a.esp - b.esp) || (a.orden - b.orden); }).pop();
    var alfa = op ? parseFloat(op.valor) : 1;
    if (pfg.hex[0] && pbg.hex.length && barra.length) {
      medir({ superficie: 'panel', tema: tema, rol: 'guardar', nombre: '«Guardando…» deshabilitado (opacidad ' + String(alfa).replace('.', ',') + ')',
        texto: mezcla(pfg.hex[0], barra[0], alfa), fondos: pbg.hex.map(function (f) { return mezcla(f, barra[0], alfa); }),
        impone: op ? path.basename(op.archivo) + ':' + op.linea : '(sin opacidad)' });
    }
    // 128b · el motivo de «No se guardó», adentro de la barra.
    var err = efectivo(rs, '.barra-error', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'guardar', nombre: '«✕ …» el motivo .barra-error', texto: err.hex[0], fondos: barra, impone: err.impone, pisado: err.pisado });
  });
})();
// Un color con opacidad `a` sobre `fondo`: lo que se ve.
function mezcla(hex, fondo, a) {
  var c = function (h, i) { return parseInt(h.substr(i, 2), 16); };
  return '#' + [1, 3, 5].map(function (i) { return ('0' + Math.round(a * c(hex, i) + (1 - a) * c(fondo, i)).toString(16)).slice(-2); }).join('');
}

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
    // [BUSQUEDA-SIN-RESULTADOS] 143c: el título (--blanco, el texto principal), la ayuda (--gris) y el botón (--amarillo-tinta: la letra y el contorno de 1 px; el contorno pide 3:1) sobre el fondo de la página (--negro)
    var paginaPub = resolver('var(--negro)', c.capas)[0];
    [['143c · «No encontramos…» .sin-resultados-titulo (--blanco)', '--blanco'], ['143c · la ayuda .sin-resultados-ayuda (--gris)', '--gris'], ['143c · «BORRAR LA BÚSQUEDA» .sin-resultados-btn (--amarillo-tinta): letra y contorno', '--amarillo-tinta']].forEach(function (x) {
      medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: x[0], texto: resolver('var(' + x[1] + ')', c.capas)[0], fondos: [paginaPub], impone: 'css/styles.css · .sin-resultados-*' });
    });
    // [CHIP-ETIQUETA-CLARO] 143h: «BÚSQUEDA», «NOTA»… del chip activo (.chip-label) sobre el chip: el chip es un amarillo translúcido (12 % en oscuro, 15 % con !important en claro) sobre la barra de filtros (6 % en oscuro, 10 % en claro: peor caso) sobre el fondo de la página.
    var barraChip = mezcla('#e8b800', paginaPub, tema === 'oscuro' ? 0.06 : 0.10), fondoChip = mezcla('#e8b800', barraChip, tema === 'oscuro' ? 0.12 : 0.15);
    var etChip = efectivo(rs, '.active-filter-chip .chip-label', c.pref, 'color', c.capas);
    medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: '143h · etiqueta del chip activo .chip-label («Búsqueda», «Nota»…)', texto: etChip.hex[0], fondos: [fondoChip], impone: etChip.impone, pisado: etChip.pisado });
    // [CHIP-X-CLARO] 143i: la ✕ del chip activo (.chip-remove) sobre el chip; no es texto sino un control gráfico: pide 3:1 (WCAG 1.4.11).
    var xChip = efectivo(rs, '.active-filter-chip .chip-remove', c.pref, 'color', c.capas);
    medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: '143i · ✕ del chip activo .chip-remove (control, 3:1)', texto: xChip.hex[0], fondos: [fondoChip], minimo: 3, impone: xChip.impone, pisado: xChip.pisado });
    // [CHIP-X-HOVER] 143j: el rojo del hover de la ✕ (--tinta-error) sobre el chip con el mouse encima (oscuro: el chip pasa a 20 % de amarillo; claro: el 15 % de !important no cambia); control gráfico: 3:1.
    var fondoChipHover = tema === 'oscuro' ? mezcla('#e8b800', barraChip, 0.20) : fondoChip;
    var xHover = efectivo(rs, '.active-filter-chip .chip-remove:hover', c.pref, 'color', c.capas);
    medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: '143j · ✕ del chip activo con el mouse encima .chip-remove:hover (control, 3:1)', texto: xHover.hex[0], fondos: [fondoChipHover], minimo: 3, impone: xHover.impone, pisado: xHover.pisado });
    // [BUSCADOR-X-HOVER-CLARO] 145: la ✕ del campo del buscador (.search-clear) con el mouse encima sobre el campo (claro: #fff !important; oscuro: 12 % de blanco sobre la página); control gráfico: 3:1.
    var fondoCampoX = tema === 'oscuro' ? mezcla('#ffffff', paginaPub, 0.12) : '#ffffff';
    var xBusca = efectivo(rs, '.search-clear:hover', c.pref, 'color', c.capas);
    medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: '145 · ✕ del campo del buscador con el mouse encima .search-clear:hover (control, 3:1)', texto: xBusca.hex[0], fondos: [fondoCampoX], minimo: 3, impone: xBusca.impone, pisado: xBusca.pisado });
    // [PILDORA-PUNTO] 144: el punto de la píldora de WhatsApp (el fondo de cada estado, los de la decisión 96: iguales en los dos temas) contra su anillo blanco de 2 px; control gráfico: 3:1.
    [['abierto', '.wa-status--open'], ['cerrado', '.wa-status--closed'], ['feriado / cierre especial', '.wa-status--special']].forEach(function (x) {
      var bgp = efectivo(rs, x[1], c.pref, 'background', c.capas);
      medir({ superficie: 'catálogo', tema: tema, rol: 'tinta', nombre: '144 · punto «' + x[0] + '» ' + x[1] + ' contra su anillo blanco (control, 3:1)', texto: bgp.hex[0], fondos: ['#ffffff'], minimo: 3, impone: bgp.impone, pisado: bgp.pisado });
    });
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
// ═══ «INICIÁ SESIÓN» / «UNITE A ST» ═══ [LOGIN-CLARO-CONTRASTE] decisión 131 · 28-sep-2026
// El botón (.auth-btn: «ENTRAR», «Unirme», «Guardar cambios») sobre su amarillo, y los links (.auth-link, .auth-link-sec),
// el título y el subtítulo sobre la caja de la ventana (.auth-modal). Hasta la 131 los links iban con style inline.
// [LOGIN-CLARO-TELEFONO] 28-sep-2026: también lo que va debajo del número (.tel-ok, .tel-mal, .tel-falta) y el mensaje
// (.auth-error, .auth-error.auth-ok), que hasta ahí iban con color inline. Ojo: acá se mide la regla de cada clase; que la
// de los <p> de la ventana (.auth-modal p) no los pise se mira en el navegador.
(function () {
  var rs = reglas(hoja('css/styles.css'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body:not(.dark-mode)');
  var cfg = { oscuro: { pref: ['body.dark-mode'], capas: [raiz] }, claro: { pref: ['body:not(.dark-mode)'], capas: [luz, raiz] } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var caja = efectivo(rs, '.auth-modal', c.pref, 'background', c.capas).hex;
    var btnFondo = efectivo(rs, '.auth-btn', c.pref, 'background', c.capas).hex, btn = efectivo(rs, '.auth-btn', c.pref, 'color', c.capas);
    medir({ superficie: 'catálogo', tema: tema, rol: 'login', nombre: '«ENTRAR» / «Unirme» .auth-btn', texto: btn.hex[0], fondos: btnFondo, impone: btn.impone });
    [['«Creá una» / «Iniciá sesión» .auth-link', '.auth-link'], ['«¿Olvidaste tu contraseña?» .auth-link-sec', '.auth-link-sec'],
     ['título .auth-title', '.auth-title'], ['subtítulo .auth-subtitle', '.auth-subtitle'],
     ['✓ del número .tel-ok', '.tel-ok'], ['«✗ no coinciden» / «demasiados dígitos» .tel-mal', '.tel-mal'],
     ['«(N dígitos faltan)» .tel-falta', '.tel-falta'], ['el error .auth-error', '.auth-error'],
     ['el ✓ del mensaje .auth-error.auth-ok', '.auth-error.auth-ok']].forEach(function (x) {
      var fg = efectivo(rs, x[1], c.pref, 'color', c.capas);
      medir({ superficie: 'catálogo', tema: tema, rol: 'login', nombre: x[0], texto: fg.hex[0], fondos: caja, impone: fg.impone });
    });
  });
})();

// ═══ LA TARJETA DE CLIENTES ═══ [CLIENTES-CLARO-CONTRASTE] decisión 132 · 28-sep-2026
// Los botones y las dos etiquetas de la tarjeta de «Clientes» (hasta la 132, con color inline). Los fondos rgba() se
// componen sobre la tarjeta (en claro, blanca), como en pantalla. En claro cambia la letra; Editar, el fondo en los dos.
// [CLIENTES-HOVER] 29-sep: también el :hover de Editar, Bloquear y Eliminar (dentro de @media (hover: hover): sólo con
// mouse): la letra de siempre sobre el fondo del hover.
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz] }, claro: { pref: ['body.light'], capas: [luz, raiz] } };
  var orden = function (x, y) { return (x.important - y.important) || (x.esp - y.esp) || (x.orden - y.orden); };
  function crudo(v, capas, prof) {
    prof = prof || 0; var t = String(v || '').trim(); var m = t.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (!m || prof > 8) return t;
    for (var i = 0; i < capas.length; i++) if (capas[i] && capas[i][m[1]]) return crudo(capas[i][m[1]], capas, prof + 1);
    return m[2] ? crudo(m[2], capas, prof + 1) : '';
  }
  function rgbaDe(v) { var m = String(v || '').match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,\/]+([\d.]+))?\s*\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; }
  function sobre(c, fondoHex) {
    var fo = [1, 3, 5].map(function (i) { return parseInt(fondoHex.substr(i, 2), 16); });
    return '#' + [c.r, c.g, c.b].map(function (v, i) { return Math.round(v * c.a + fo[i] * (1 - c.a)).toString(16).padStart(2, '0'); }).join('');
  }
  function aHex(valor, c, abajo) {
    var v = crudo(valor, c.capas); if (!v || v === 'transparent' || v === 'none') return abajo;
    var r = rgbaDe(v); if (r) return sobre(r, abajo);
    var h = normalizarHex(v); if (h) return h;
    var hs = resolver(valor, c.capas); return hs.length ? hs[0] : abajo;
  }
  function fondo(target, c, abajo) {
    var g = [ganador(rs, target, c.pref, 'background'), ganador(rs, target, c.pref, 'background-color')].filter(Boolean).sort(orden).pop();
    return g ? aHex(g.valor, c, abajo) : abajo;
  }
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var tarjeta = fondo('.client-card', c, fondo('body', c, '#000000'));
    [['💬 WhatsApp .client-btn-wa', '.client-btn-wa'], ['⭐ +1 punto .client-btn-punto', '.client-btn-punto'],
     ['📜 Historial .client-btn-historial', '.client-btn-historial'], ['✏️ Editar .client-btn-edit', '.client-btn-edit'],
     ['🚫 Bloquear .client-btn-block', '.client-btn-block'], ['🚫 Desbloquear .client-btn-blocked', '.client-btn-blocked'],
     ['🗑️ Eliminar .client-btn-delete', '.client-btn-delete'], ['✓ COMPRÓ .client-tag-compro', '.client-tag-compro'],
     ['✗ NO COMPRÓ .client-tag-nocompro', '.client-tag-nocompro'], ['BLOQUEADO .client-blocked-badge', '.client-blocked-badge']].forEach(function (x) {
      var bg = fondo(x[1], c, tarjeta), g = ganador(rs, x[1], c.pref, 'color');
      medir({ superficie: 'panel', tema: tema, rol: 'clientes', nombre: x[0], texto: g ? aHex(g.valor, c, bg) : null, fondos: [bg],
              impone: g ? path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') : '' });
    });
    [['✏️ Editar con el mouse .client-btn-edit:hover', '.client-btn-edit'], ['🚫 Bloquear con el mouse .client-btn-block:hover', '.client-btn-block'],
     ['🗑️ Eliminar con el mouse .client-btn-delete:hover', '.client-btn-delete']].forEach(function (x) {
      var bg = fondo(x[1] + ':hover', c, tarjeta), g = ganador(rs, x[1], c.pref, 'color');
      medir({ superficie: 'panel', tema: tema, rol: 'clientes', nombre: x[0], texto: g ? aHex(g.valor, c, bg) : null, fondos: [bg],
              impone: g ? path.basename(g.archivo) + ':' + g.linea + (g.important ? ' !important' : '') : '' });
    });
  });
})();

// ═══ [HORARIO-ERROR-OSCURO] el error de «Horario modificado» (ronda y, 29-sep-2026) ═══
// El recuadro #ajusteActivo es rgba(232,184,0,.08) inline sobre su caja (#111 en oscuro; blanca en claro, [PANEL-CLARO-CAJAS]):
// da #221e10 y #fdf9eb, medidos en el navegador. La letra es la de .ajuste-error.
(function () {
  var rs = reglas(hoja('admin.html'));
  var raiz = tokens(rs, ':root'), luz = tokens(rs, 'body.light');
  var cfg = { oscuro: { pref: [], capas: [raiz], fondo: '#221e10' }, claro: { pref: ['body.light'], capas: [luz, raiz], fondo: '#fdf9eb' } };
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema], fg = efectivo(rs, '.ajuste-error', c.pref, 'color', c.capas);
    medir({ superficie: 'panel', tema: tema, rol: 'horario', nombre: 'error de «Horario modificado» .ajuste-error', texto: fg.hex[0] || null,
            fondos: [c.fondo], impone: fg.impone, pisado: fg.pisado });
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
     ['mensaje ¡Listo!', '.waitlist-msg--ok', 'p'], ['mensaje ¡Ya estás!', '.waitlist-msg--ya', 'p'], ['mensaje de error', '.waitlist-msg--error', 'p'],
     // [ESPERA-INVITADO] la hoja del invitado: «Ya tengo cuenta», el «+54 9» y lo que escribe (caja del campo ≈ la de la hoja)
     ['[ESPERA-INVITADO] «Ya tengo cuenta · Iniciar sesión»', '.waitlist-login', null], ['[ESPERA-INVITADO] «+54 9»', '.waitlist-prefix', null],
     ['[ESPERA-INVITADO] lo que escribe (teléfono y nombre)', '.waitlist-input', null],
     // 142m2 · la línea de debajo del teléfono, en sus tres estados (son <span> dentro del <p>: la regla de la etiqueta no los toca)
     ['[ESPERA-INVITADO] 142m2 «Faltan N dígitos»', '.waitlist-ayuda--falta', null], ['[ESPERA-INVITADO] 142m2 «✓ +54 9 …»', '.waitlist-ayuda--ok', null],
     ['[ESPERA-INVITADO] 142m2 el error al tocar «Avisame»', '.waitlist-ayuda--error', null]].forEach(function (t) {
      var fg = conEtiqueta(t[1], t[2], c) || { hex: cuerpo.hex, impone: 'heredado del body' };
      medir({ superficie: 'catálogo', tema: tema, rol: 'avisame', nombre: t[0] + ' ' + t[1], texto: fg.hex[0], fondos: caja.hex, impone: fg.impone });
    });
  });
})();

// ═══ CARTEL «TENÉS N COSAS EN ESPERA» ═══ [ESPERA-INVITADO] B · 1-oct-2026
// La caja es la de .cart-toast (oscuro rgba(10,10,10,.96); claro #f5efde con !important). Sus textos compiten con la regla de la etiqueta <p>.
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
  var cuerpo = efectivo(rs, 'body', [], 'color', cfg.oscuro.capas);
  var cajaOscura = ['#0a0a0a'];   // rgba(10,10,10,.96) sobre el catálogo oscuro: el 4 % que se cuela no cambia el número
  ['oscuro', 'claro'].forEach(function (tema) {
    var c = cfg[tema];
    var caja = tema === 'claro' ? ['#f5efde'] : cajaOscura;
    [['título', '.espera-cartel-titulo', 'p'], ['lista', '.espera-cartel-lista', null], ['«Y N cosas que pediste en el local»', '.espera-cartel-lista .espera-cartel-libre', null], ['pie «Te escribimos por WhatsApp…»', '.espera-cartel-sub', 'p'], ['✕', '.espera-cartel-x', null]].forEach(function (t) {
      var fg = conEtiqueta(t[1], t[2], c) || { hex: cuerpo.hex, impone: 'heredado del body' };
      medir({ superficie: 'catálogo', tema: tema, rol: 'cartel de espera', nombre: '[ESPERA-INVITADO] ' + t[0] + ' ' + t[1], texto: fg.hex[0], fondos: caja, impone: fg.impone });
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
