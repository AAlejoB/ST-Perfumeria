// fuente: github.com/AAlejoB/SMELLROCK_HOLMES herramientas/numeros.js ＠ 22ac2a2, no editar acá
/*
 * SMELLROCK HOLMES · numeros.js
 * Cómo mostrar un dato con pocas visitas (foro 01, elegido por Alejo el 16-10-2026):
 *   C arriba ("de cada tantos"), B para decidir ("chance de ganar"), A en "ver detalle" (rango).
 *
 * Sin dependencias. Sirve igual con <script src> (queda en window.HolmesNumeros),
 * con require() en Node, o copiado a TypeScript.
 */
(function (root) {
  'use strict';

  var Z95 = 1.959963984540054;     // 95 %
  var Z80 = 0.8416212335729143;    // 80 % de chances de ver el efecto si existe
  var UMBRAL_DECIDIR = 0.95;       // B: se decide recién con 95 % (fijarlo ANTES de mirar)

  function validar(exitos, total) {
    if (!Number.isInteger(exitos) || !Number.isInteger(total) || exitos < 0 || total < 0 || exitos > total) {
      throw new RangeError('exitos y total tienen que ser enteros con 0 <= exitos <= total');
    }
  }

  // ── A. El número con su rango (intervalo de Wilson) ──────────────────────
  function rango(exitos, total, z) {
    validar(exitos, total);
    z = z || Z95;
    if (total === 0) return { tasa: null, desde: 0, hasta: 1, total: 0 };
    var p = exitos / total;
    var z2 = z * z;
    var d = 1 + z2 / total;
    var centro = (p + z2 / (2 * total)) / d;
    var margen = (z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total))) / d;
    return {
      tasa: p,
      desde: exitos === 0 ? 0 : Math.max(0, centro - margen),
      hasta: exitos === total ? 1 : Math.min(1, centro + margen),
      total: total
    };
  }

  // "Todavía son pocas": el rango es más ancho que la tasa misma.
  function sonPocas(exitos, total) {
    if (total === 0) return true;
    var r = rango(exitos, total);
    return (r.hasta - r.desde) > Math.max(r.tasa, 0.01);
  }

  // ── C. De cada tantos (frecuencias naturales, Gigerenzer) ────────────────
  function deCadaTantos(exitos, total) {
    validar(exitos, total);
    if (total === 0) return { uno: null, deCada: null, texto: 'Todavía no hay datos' };
    if (exitos === 0) return { uno: 0, deCada: total, texto: 'Nadie todavía (de ' + total + ')' };
    var p = exitos / total;
    // «1 de cada k» sólo hasta 1 de cada 4: más arriba redondea grueso (40 % daba «1 de cada 3», que es 33 %).
    if (p <= 0.25) {
      var k = Math.round(1 / p);
      return { uno: 1, deCada: k, texto: '1 de cada ' + k };
    }
    var x = Math.round(p * 10);
    // 96 de 100 no es «10 de cada 10»: eso queda para cuando fueron todos.
    if (x === 10 && exitos < total) return { uno: 9, deCada: 10, texto: 'Más de 9 de cada 10' };
    return { uno: x, deCada: 10, texto: x + ' de cada 10' };
  }

  // ── B. La chance de ganar (bayesiano, Beta(1,1) de partida) ──────────────
  // P(tasa de B > tasa de A), cuenta exacta (Evan Miller, 2015), sin simular.
  function lgamma(x) {
    var g = 7;
    var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    var a = c[0];
    var t = x + g + 0.5;
    for (var i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }

  function chanceDeGanar(a, b) {
    validar(a.exitos, a.total);
    validar(b.exitos, b.total);
    var aA = 1 + a.exitos, bA = 1 + a.total - a.exitos;
    var aB = 1 + b.exitos, bB = 1 + b.total - b.exitos;
    var suma = 0;
    for (var i = 0; i < aB; i++) {
      suma += Math.exp(lbeta(aA + i, bA + bB) - Math.log(bB + i) - lbeta(1 + i, bB) - lbeta(aA, bA));
    }
    return Math.min(1, Math.max(0, suma));
  }

  // ── Cuántas visitas hacen falta (por versión) para distinguir p1 de p2 ──
  function cuantasHacenFalta(p1, p2) {
    if (!(p1 > 0 && p1 < 1 && p2 > 0 && p2 < 1) || p1 === p2) throw new RangeError('p1 y p2 entre 0 y 1, distintas');
    var n = Math.pow(Z95 + Z80, 2) * (p1 * (1 - p1) + p2 * (1 - p2)) / Math.pow(p1 - p2, 2);
    return Math.ceil(n);
  }

  // ── Las frases para la pantalla ──────────────────────────────────────────
  function pct(x, dec) {
    return (x * 100).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' %';
  }

  // Un solo dato (un perfume, una página): C arriba, A en "ver detalle".
  function mostrarUno(exitos, total) {
    var c = deCadaTantos(exitos, total);
    var r = rango(exitos, total);
    return {
      principal: c.texto,
      aviso: sonPocas(exitos, total) ? 'Todavía son pocas personas (' + total + ')' : null,
      detalle: total === 0 ? 'Sin datos' :
        pct(r.tasa, 1) + ' (entre ' + pct(r.desde, 1) + ' y ' + pct(r.hasta, 1) + '), ' + exitos + ' de ' + total
    };
  }

  // Nunca «100 %»: con datos finitos nada es seguro.
  function chanceTexto(c) {
    if (c > 0.99) return 'más de 99 %';
    return Math.round(c * 100) + ' %';
  }

  // Dos datos (A contra B): C de cada uno, B para decidir, A en "ver detalle".
  function compararDos(a, b, nombres) {
    nombres = nombres || ['A', 'B'];
    var chance = chanceDeGanar(a, b);              // P(B > A)
    var lider = chance >= 0.5 ? 1 : 0;
    var chanceLider = lider === 1 ? chance : 1 - chance;
    var decidido = chanceLider >= UMBRAL_DECIDIR;
    var ra = rango(a.exitos, a.total), rb = rango(b.exitos, b.total);
    var pa = a.total ? a.exitos / a.total : 0.01, pb = b.total ? b.exitos / b.total : 0.01;
    var faltan = (pa > 0 && pb > 0 && pa < 1 && pb < 1 && pa !== pb) ? cuantasHacenFalta(pa, pb) : null;
    return {
      principal: [nombres[0] + ': ' + deCadaTantos(a.exitos, a.total).texto,
                  nombres[1] + ': ' + deCadaTantos(b.exitos, b.total).texto],
      chance: chanceLider,
      chanceTexto: chanceTexto(chanceLider),
      decision: chanceTexto(chanceLider) + ' de chances de que ' + nombres[lider] + ' convierta más' +
        (decidido ? '. Alcanza para decidir.' : '. Para decidir esperamos a ' + Math.round(UMBRAL_DECIDIR * 100) + ' %.'),
      decidido: decidido,
      aviso: (sonPocas(a.exitos, a.total) || sonPocas(b.exitos, b.total))
        ? 'Todavía son pocas personas (' + a.total + ' y ' + b.total + ')' : null,
      detalle: [ra, rb].map(function (r, i) {
        return nombres[i] + ': ' + (r.total ? pct(r.tasa, 1) + ' (entre ' + pct(r.desde, 1) + ' y ' + pct(r.hasta, 1) + ')' : 'sin datos');
      }).concat(faltan ? ['Para un A/B firme: ~' + faltan.toLocaleString('es-AR') + ' por versión'] : [])
    };
  }

  var api = {
    rango: rango,
    sonPocas: sonPocas,
    deCadaTantos: deCadaTantos,
    chanceDeGanar: chanceDeGanar,
    cuantasHacenFalta: cuantasHacenFalta,
    mostrarUno: mostrarUno,
    compararDos: compararDos,
    UMBRAL_DECIDIR: UMBRAL_DECIDIR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HolmesNumeros = api;
})(typeof self !== 'undefined' ? self : this);
