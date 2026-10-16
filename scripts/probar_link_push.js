// [PUSH-LINK-PROPIO] 16-oct-2026 · prueba del link de las notificaciones push (B7 del QA).
// Corta el texto de las TRES copias de la función (admin.html, api/send-notification.js y sw.js), las prueba tal cual
// con los mismos casos y avisa si alguna dice otra cosa (son SINCRO). Uso: node scripts/probar_link_push.js
var fs = require('fs');
var path = require('path');
var raiz = path.join(__dirname, '..');

function cortar(archivo, nombre) {
  var txt = fs.readFileSync(path.join(raiz, archivo), 'utf8').replace(/\r\n/g, '\n');
  var i = txt.indexOf('function ' + nombre + '(u) {');
  if (i === -1) throw new Error('No encontré ' + nombre + ' en ' + archivo);
  var j = txt.indexOf('\n}', i);
  var k = txt.indexOf('\n    }', i);   // admin.html la tiene con 4 espacios
  var fin = (archivo === 'admin.html') ? k + 6 : j + 2;
  return new Function(txt.slice(i, fin).replace(/^\s+/, '') + '\nreturn ' + nombre + ';')();
}

var copias = {
  'admin.html': cortar('admin.html', 'pushLinkPropio'),
  'api/send-notification.js': cortar('api/send-notification.js', 'linkPropio'),
  'sw.js': cortar('sw.js', 'linkPropio')
};

var casos = [
  ['', '/'], ['   ', '/'], [null, '/'],
  ['/', '/'], ['/#decants', '/#decants'], ['/perfume/club-de-nuit?x=1', '/perfume/club-de-nuit?x=1'],
  ['https://www.stperfumeria.com/#decants', '/#decants'], ['https://stperfumeria.com', '/'],
  ['https://STPERFUMERIA.com/perfume/a', '/perfume/a'], ['https://st-perfumeria.vercel.app/?perfume=x', '/?perfume=x'],
  ['https://stperfumeria.com?x=1', '/?x=1'],
  ['javascript:alert(1)', null], ['JavaScript:alert(1)', null], ['data:text/html,hola', null],
  ['//evil.com', null], ['/\\evil.com', null], ['http://www.stperfumeria.com/', null],
  ['https://evil.com/stperfumeria.com', null], ['https://stperfumeria.com.evil.com/', null],
  ['https://stperfumeria.com@evil.com/', null], ['https://stperfumeria.com//evil.com', null],
  ['/a b', null], ['/' + 'x'.repeat(400), null], ['decants', null]
];

var mal = 0;
casos.forEach(function(c) {
  Object.keys(copias).forEach(function(a) {
    var r = copias[a](c[0]);
    if (r !== c[1]) { mal++; console.log('MAL  ' + a + '  ' + JSON.stringify(c[0]) + ' → ' + JSON.stringify(r) + ' (esperaba ' + JSON.stringify(c[1]) + ')'); }
  });
});
console.log((casos.length - 0) + ' casos × 3 copias: ' + (mal ? mal + ' mal' : 'todos bien'));
process.exit(mal ? 1 : 0);
