#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// CONTRASTE DEL PANEL — ST Perfumería · [BADGE-TEXTO] 21-sep-2026 · dos roles desde el 22-sep
//
// Mantiene viva la regla 19 (decisión del DISEÑADOR): el texto de una badge
// es NEGRO cuando su fondo contrasta más con negro que con blanco, y BLANCO
// cuando contrasta más con blanco. No es una lista de excepciones: cuando
// cambie un fondo, este script dice qué texto le corresponde y si llega a
// 4,5:1 (WCAG AA, texto normal). Sin dependencias.
//
//   node scripts/contraste.js       → tabla · sale con 1 si alguna badge falla
//
// Dos roles (decisión 22 del DISEÑADOR): FONDO — el color va debajo del texto
// (las 6 badges .badge-*: se elige el texto con la regla 19) — y TINTA — el color
// ES el texto (las 4 tintas de .stat-value sobre el fondo de .stat-card). La
// tinta es el valor más ajustado del sistema (el rojo #e74c3c sobre el gradiente
// #131316→#101013 da 4,85–4,97) y el único que no se rescata cambiando el texto:
// si CI midiera sólo fondos, ese valor quedaría sin red.
//
// Lee el <style> de admin.html por regex: declaraciones base en dark. Light mode
// no tiene todavía una regla decidida para las tintas → no se verifica acá (se
// mide con scripts/medir_targets.js --sonda).
// ══════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ARCHIVO = path.join(__dirname, '..', 'admin.html');
const CLASES = ['ok', 'mid', 'low', 'out', 'last', 'paused'];
const MINIMO = 4.5;

function normalizarHex(h) {
  if (!h) return null;
  h = h.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : null;
}
// Luminancia relativa (WCAG 2.x, sRGB linealizado)
function luminancia(hex) {
  var c = [1, 3, 5].map(function (i) {
    var v = parseInt(hex.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) {
  var la = luminancia(a), lb = luminancia(b);
  var claro = Math.max(la, lb), oscuro = Math.min(la, lb);
  return (claro + 0.05) / (oscuro + 0.05);
}
function f2(n) { return n.toFixed(2).replace('.', ','); }

var html = fs.readFileSync(ARCHIVO, 'utf8');
var filas = [], fallas = 0;

CLASES.forEach(function (clase) {
  // Sólo la declaración base: la línea empieza con ".badge-<clase> {" (body.light .badge-paused no matchea)
  var re = new RegExp('^[ \\t]*\\.badge-' + clase + '\\s*\\{([^}]*)\\}', 'm');
  var m = html.match(re);
  if (!m) { filas.push({ clase: clase, error: 'no encontré la declaración .badge-' + clase }); fallas++; return; }
  var cuerpo = m[1];
  var fondo = normalizarHex((cuerpo.match(/(?:^|[^-\w])background\s*:\s*(#[0-9a-fA-F]{3,6})/) || [])[1]);
  var texto = normalizarHex((cuerpo.match(/(?:^|[^-\w])color\s*:\s*(#[0-9a-fA-F]{3,6})/) || [])[1]);
  if (!fondo || !texto) { filas.push({ clase: clase, error: 'no pude leer background/color en hex: ' + cuerpo.trim() }); fallas++; return; }

  var vsNegro = contraste(fondo, '#000000');
  var vsBlanco = contraste(fondo, '#ffffff');
  var manda = vsNegro > vsBlanco ? '#000000' : '#ffffff';      // regla 19
  var ratio = contraste(fondo, texto);
  var okRegla = texto === manda;
  var okMinimo = ratio >= MINIMO;
  if (!okRegla || !okMinimo) fallas++;
  filas.push({ clase: clase, fondo: fondo, texto: texto, L: luminancia(fondo), vsNegro: vsNegro, vsBlanco: vsBlanco, manda: manda, ratio: ratio, okRegla: okRegla, okMinimo: okMinimo });
});

// ── Rol TINTA: .stat-value sobre .stat-card ──
function bloque(selectorRegex) { var m = html.match(selectorRegex); return m ? m[1] : null; }
function ultimoColor(selectorRegex) { var re = new RegExp(selectorRegex.source, 'gm'), m, ultimo = null; while ((m = re.exec(html))) { var c = (m[1].match(/(?:^|[^-\w])color\s*:\s*([^;]+);/) || [])[1]; if (c) ultimo = c.trim(); } return ultimo; }
var raiz = bloque(/^[ \t]*:root\s*\{([^}]*)\}/m) || '';
function resolverVar(v) { var m = v && v.match(/var\((--[\w-]+)\)/); if (!m) return normalizarHex(v); var d = raiz.match(new RegExp(m[1] + '\\s*:\\s*(#[0-9a-fA-F]{3,6})')); return d ? normalizarHex(d[1]) : null; }
// .stat-card está declarado dos veces (L978 con #111 y L1344 con el gradiente): en cascada manda la ÚLTIMA con background.
function ultimoFondo(selectorRegex) { var re = new RegExp(selectorRegex.source, 'gm'), m, ultimo = null; while ((m = re.exec(html))) { var b = (m[1].match(/(?:^|[^-\w])background\s*:\s*([^;]+);/) || [])[1]; if (b) ultimo = b.trim(); } return ultimo || ''; }
var fondoCard = ultimoFondo(/^[ \t]*\.stat-card\s*\{([^}]*)\}/);
var paradas = (fondoCard.match(/#[0-9a-fA-F]{3,6}/g) || []).map(normalizarHex).filter(Boolean);   // los extremos del gradiente
var TINTAS = [
  { nombre: 'stat-value (default)', re: /^[ \t]*\.stat-value\s*\{([^}]*)\}/ },
  { nombre: 'stat-out', re: /^[ \t]*\.stat-card\.stat-out \.stat-value\s*\{([^}]*)\}/ },
  { nombre: 'stat-perfumes', re: /^[ \t]*\.stat-card\.stat-perfumes \.stat-value\s*\{([^}]*)\}/ },
  { nombre: 'stat-value-inv', re: /^[ \t]*\.stat-card\.stat-value-inv \.stat-value\s*\{([^}]*)\}/ }
];
var filasTinta = [];
TINTAS.forEach(function (t) {
  var tinta = resolverVar(ultimoColor(t.re));
  if (!tinta || !paradas.length) { filasTinta.push({ nombre: t.nombre, error: !tinta ? 'no pude leer la tinta' : 'no pude leer el fondo de .stat-card' }); fallas++; return; }
  var ratios = paradas.map(function (f) { return contraste(tinta, f); });
  var minimo = Math.min.apply(null, ratios);
  if (minimo < MINIMO) fallas++;
  filasTinta.push({ nombre: t.nombre, tinta: tinta, fondos: paradas.join('→'), ratios: ratios, minimo: minimo, ok: minimo >= MINIMO });
});

// ── Tablas ──
var cab = ['clase', 'fondo', 'texto', 'L fondo', 'vs #000', 'vs #fff', 'manda (r.19)', 'ratio', 'regla 19', '>= 4,5'];
var cuerpoTabla = filas.map(function (r) {
  if (r.error) return [r.clase, '—', '—', '—', '—', '—', '—', '—', '❌', '❌ ' + r.error];
  return [
    r.clase, r.fondo, r.texto, r.L.toFixed(4).replace('.', ','), f2(r.vsNegro), f2(r.vsBlanco),
    r.manda, f2(r.ratio) + ':1',
    r.okRegla ? '✅' : '❌ (debería ser ' + r.manda + ')',
    r.okMinimo ? '✅' : '❌'
  ];
});
var anchos = cab.map(function (h, i) { return Math.max(h.length, Math.max.apply(null, cuerpoTabla.map(function (f) { return String(f[i]).length; }))); });
function fila(f) { return f.map(function (c, i) { return String(c).padEnd(anchos[i]); }).join('  '); }
console.log('Contraste del panel · ' + path.relative(process.cwd(), ARCHIVO) + ' · mínimo ' + f2(MINIMO) + ':1 (WCAG AA texto normal)');
console.log('\nROL FONDO — las badges de stock (regla 19: el texto lo elige el fondo)');
console.log(fila(cab));
console.log(anchos.map(function (a) { return '─'.repeat(a); }).join('  '));
cuerpoTabla.forEach(function (f) { console.log(fila(f)); });

console.log('\nROL TINTA — .stat-value sobre el gradiente de .stat-card (dark; el color ES el texto: no hay nada más que mover)');
var cabT = ['tinta', 'color', 'fondo (extremos)', 'ratio min', 'ratios', '>= 4,5', 'margen'];
var cuerpoT = filasTinta.map(function (r) {
  if (r.error) return [r.nombre, '—', '—', '—', '—', '❌', r.error];
  return [r.nombre, r.tinta, r.fondos, f2(r.minimo) + ':1', r.ratios.map(f2).join(' / '), r.ok ? '✅' : '❌', (r.minimo >= MINIMO ? '+' : '') + f2(r.minimo - MINIMO)];
});
var anchosT = cabT.map(function (h, i) { return Math.max(h.length, Math.max.apply(null, cuerpoT.map(function (f) { return String(f[i]).length; }))); });
function filaT(f) { return f.map(function (c, i) { return String(c).padEnd(anchosT[i]); }).join('  '); }
console.log(filaT(cabT));
console.log(anchosT.map(function (a) { return '─'.repeat(a); }).join('  '));
cuerpoT.forEach(function (f) { console.log(filaT(f)); });
console.log('(light mode: las tintas no tienen regla decidida todavía; medido en el DOM el 22-sep: fondo #ffffff, las 4 tintas < 4,5 — fuera de este script hasta que el DISEÑADOR decida)');

console.log(fallas === 0 ? '\n✅ ' + filas.length + ' fondos y ' + filasTinta.length + ' tintas cumplen.' : '\n❌ ' + fallas + ' falla(s).');
process.exit(fallas === 0 ? 0 : 1);
