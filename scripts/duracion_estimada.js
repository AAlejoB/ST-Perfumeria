// [DURACION-ESTIMADA] · 18-oct-2026 · pedido de Alejo: una «duración estimada» como ayuda (nunca horas, nunca una promesa).
// Corre la regla sobre el catálogo y escribe docs/DURACION_ESTIMADA.md para revisarla antes de mostrar nada en la tienda.
// Uso: node scripts/duracion_estimada.js <catalogo.json>
//   catalogo.json = { ov: [...perfume_overrides], nu: [...perfumes_nuevos] } (sólo lectura de la base: slug, name, perfil, notas_base,
//   stock_status, oculto; y de nuevos slug, name, marca_real, perfil, notas_base). No va en el repo: es un volcado de la base.
//
// La regla (js/app.js, DURACION:INICIO/FIN) es la misma que usa la ficha del catálogo. De dónde sale:
//   · Las notas de fondo son las moléculas más pesadas y se evaporan más lento (la pirámide de Jean Carles y la escala de evaporación
//     de Poucher). Pesan más las resinas y bálsamos (benjuí, ládano, mirra, incienso), el oud y el cuero; después los ambarados
//     (ámbar gris, ambroxan), las maderas densas (sándalo, vetiver, pachulí) y la haba tonka; menos el almizcle, la vainilla y el cedro.
//     Los pesos 3 / 2 / 1 son un criterio para revisar, no un dato medido.
//   · La concentración de aceites (Extrait / Parfum > EDP > EDT > Cologne) es lo que más cambia la duración, pero no hay una norma:
//     cada marca pone la suya. Se lee del nombre sólo cuando el nombre lo dice.
//   · El perfil: Intenso suma, Fresco / Cítrico resta.
var fs = require('fs'), path = require('path'), vm = require('vm');

// La regla vive en js/app.js entre DURACION:INICIO y DURACION:FIN (la usa la ficha): se corta y se corre tal cual, así no hay dos copias.
var appJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
var ia = appJs.indexOf('// DURACION:INICIO'), ib = appJs.indexOf('// DURACION:FIN');
if (ia < 0 || ib < 0) { console.error('No encuentro las marcas DURACION en js/app.js'); process.exit(2); }
var regla = {};
vm.createContext(regla);
vm.runInContext(appJs.slice(ia, ib) + '\nthis.f = { concentracionDeNombre: concentracionDeNombre, pesoFondo: pesoFondo, duracionEstimada: duracionEstimada };', regla);
var concentracionDeNombre = regla.f.concentracionDeNombre, pesoFondo = regla.f.pesoFondo, duracionEstimada = regla.f.duracionEstimada;

// ---------- el catálogo: perfumes.js + perfume_overrides + perfumes_nuevos (lo mismo que arma el catálogo al cargar) ----------
var datos = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'perfumes.js'), 'utf8').replace(/\b(const|let)\s+PERFUMES\b/, 'var PERFUMES'), ctx);
var porSlug = {};
(ctx.PERFUMES || []).forEach(function(p) { if (!p.esSet) porSlug[p.slug] = { slug: p.slug, name: p.name, marca: p.marca_real || '', perfil: p.perfil, notas_base: p.notas_base }; });
(datos.nu || []).forEach(function(p) { if (!porSlug[p.slug]) porSlug[p.slug] = { slug: p.slug, name: p.name, marca: p.marca || '', perfil: p.perfil, notas_base: p.nb }; });
(datos.ov || []).forEach(function(o) {
  var p = porSlug[o.slug];
  if (!p) return;
  if (o.name) p.name = o.name;
  if (o.perfil) p.perfil = o.perfil;
  if (o.nb && o.nb.trim()) p.notas_base = o.nb;
  p.oculto = o.oc === true;
  p.pausado = o.st === 'pausado';
});
var lista = Object.keys(porSlug).map(function(k) { return porSlug[k]; }).filter(function(p) { return !p.oculto; });
lista.forEach(function(p) { p.conc = concentracionDeNombre(p.name); p.d = duracionEstimada(p); p.fondo = pesoFondo(p.notas_base); });

var grupos = { mas: [], normal: [], liviano: [], '': [] };
lista.forEach(function(p) { grupos[p.d.grupo].push(p); });
Object.keys(grupos).forEach(function(g) { grupos[g].sort(function(a, b) { return (b.d.puntos || 0) - (a.d.puntos || 0) || a.name.localeCompare(b.name); }); });
var enVenta = function(arr) { return arr.filter(function(p) { return !p.pausado; }).length; };

function fila(p) {
  return '| ' + p.name + (p.pausado ? ' _(pausado)_' : '') + ' | ' + (p.marca || '—') + ' | ' + (p.perfil || '—') + ' | ' + (p.conc || '—') + ' | '
    + String(p.notas_base || '—').replace(/\|/g, '/') + ' | ' + p.fondo + ' | **' + p.d.puntos + '** |';
}
var cab = '| Perfume | Marca | Perfil | Concentración (del nombre) | Notas de fondo | Fondo | Puntos |\n|---|---|---|---|---|---|---|';
var hoy = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
var md = [
  '# Duración estimada · para revisar',
  '',
  '> Generado por `node scripts/duracion_estimada.js` el ' + hoy + ' con el catálogo real (perfumes.js + Editar + los cargados desde el panel; sin los ocultos).',
  '> Es una **ayuda de memoria**, no una medición: nadie midió cuánto dura cada perfume en la piel. En la tienda se diría sólo «suele durar más», nunca horas.',
  '',
  '## Cómo se calcula',
  '',
  '**Puntos = fondo + perfil + concentración.**',
  '',
  '- **Fondo** (hasta 9): cada nota de fondo suma según cuánto tarda en evaporarse.',
  '  - 3: benjuí, ládano, mirra, oud, cuero (resinas, bálsamos y animales: los más pesados).',
  '  - 2: incienso, ámbar, ámbar gris / ambroxan, sándalo, vetiver, pachulí, haba tonka, tabaco, musgo de roble.',
  '  - 1: almizcle, vainilla, cedro, cachemira, praliné, caramelo, café, «notas amaderadas».',
  '- **Perfil**: Intenso +2 · Fresco o Cítrico −2 · el resto 0.',
  '- **Concentración** (sólo si el nombre la dice): Extrait / Parfum / Elixir +2 · EDP 0 · EDT −2 · Cologne −3. Sin dato, 0.',
  '- **Grupos**: 9 o más = **suele durar más** · 4 a 8 = normal · 3 o menos = más liviano · sin notas de fondo = no se dice nada.',
  '- **En la tienda** sólo se dice «Suele durar más» (una palabra más en «A qué huele» de la ficha, con su explicación al tocarla). Lo normal y lo liviano no se dicen.',
  '',
  'Los pesos 3 / 2 / 1 son un criterio para discutir, no un número de un libro. Si un perfume que conocés queda mal ubicado, se cambia un peso.',
  '',
  '## La tabla general de concentraciones',
  '',
  'No es una norma legal: cada marca pone la suya, y un EDT fuerte puede durar más que un EDP flojo. Los rangos que más se repiten:',
  '',
  '| Concentración | Aceites | Suele durar |',
  '|---|---|---|',
  '| Extrait / Parfum | 20 a 40 % | lo que más dura |',
  '| Eau de Parfum (EDP) | 15 a 20 % | bastante |',
  '| Eau de Toilette (EDT) | 5 a 15 % | menos |',
  '| Eau de Cologne (EDC) | 2 a 5 % | poco |',
  '',
  '## Resumen',
  '',
  '| Grupo | Perfumes | En venta (sin pausados) |',
  '|---|---|---|',
  '| Suele durar más | ' + grupos.mas.length + ' | ' + enVenta(grupos.mas) + ' |',
  '| Normal | ' + grupos.normal.length + ' | ' + enVenta(grupos.normal) + ' |',
  '| Más liviano | ' + grupos.liviano.length + ' | ' + enVenta(grupos.liviano) + ' |',
  '| Sin notas de fondo (no se dice nada) | ' + grupos[''].length + ' | ' + enVenta(grupos['']) + ' |',
  '| **Total** | ' + lista.length + ' | ' + enVenta(lista) + ' |',
  '',
  'Con la concentración en el nombre: ' + lista.filter(function(p) { return p.conc; }).length + ' de ' + lista.length + ' (' +
    ['Extrait', 'Parfum', 'Elixir', 'EDP', 'EDT', 'Cologne'].map(function(c) { var k = lista.filter(function(p) { return p.conc === c; }).length; return k ? c + ' ' + k : ''; }).filter(Boolean).join(' · ') + ').',
  '',
  '## Suele durar más (' + grupos.mas.length + ')',
  '',
  cab
].concat(grupos.mas.map(fila)).concat([
  '',
  '## Normal (' + grupos.normal.length + ')',
  '',
  cab
]).concat(grupos.normal.map(fila)).concat([
  '',
  '## Más liviano (' + grupos.liviano.length + ')',
  '',
  '**No se muestra en la tienda.** Muchos caen acá porque tienen pocas notas de fondo cargadas, no porque duren menos (Yara Tous, Hayaati). Sirve para ver a quién le faltan notas.',
  '',
  cab
]).concat(grupos.liviano.map(fila)).concat([
  '',
  '## Sin notas de fondo (' + grupos[''].length + ')',
  '',
  'No se les calcula nada. Cargándoles las notas en Editar, entran solos.',
  '',
  grupos[''].map(function(p) { return p.name + (p.pausado ? ' _(pausado)_' : ''); }).join(' · '),
  ''
]);
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'DURACION_ESTIMADA.md'), md.join('\n'));
console.log('mas', grupos.mas.length, '· normal', grupos.normal.length, '· liviano', grupos.liviano.length, '· sin notas', grupos[''].length, '· total', lista.length);
var hist = {};
lista.forEach(function(p) { if (p.d.puntos !== null) hist[p.d.puntos] = (hist[p.d.puntos] || 0) + 1; });
console.log('puntos', JSON.stringify(hist));
