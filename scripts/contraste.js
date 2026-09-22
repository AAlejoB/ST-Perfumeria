#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// CONTRASTE DE LAS BADGES DE STOCK — ST Perfumería · [BADGE-TEXTO] 21-sep-2026
//
// Mantiene viva la regla 19 (decisión del DISEÑADOR): el texto de una badge
// es NEGRO cuando su fondo contrasta más con negro que con blanco, y BLANCO
// cuando contrasta más con blanco. No es una lista de excepciones: cuando
// cambie un fondo, este script dice qué texto le corresponde y si llega a
// 4,5:1 (WCAG AA, texto normal). Sin dependencias.
//
//   node scripts/contraste.js       → tabla · sale con 1 si alguna badge falla
//
// Lee las 6 clases .badge-* del <style> de admin.html por regex (sólo las
// declaraciones base, no los overrides de body.light).
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

// ── Tabla ──
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
console.log('Contraste de las badges de stock · ' + path.relative(process.cwd(), ARCHIVO) + ' · regla 19 + mínimo ' + f2(MINIMO) + ':1');
console.log(fila(cab));
console.log(anchos.map(function (a) { return '─'.repeat(a); }).join('  '));
cuerpoTabla.forEach(function (f) { console.log(fila(f)); });
console.log(fallas === 0 ? '\n✅ Las ' + filas.length + ' badges cumplen la regla 19 y el mínimo.' : '\n❌ ' + fallas + ' badge(s) fallan.');
process.exit(fallas === 0 ? 0 : 1);
