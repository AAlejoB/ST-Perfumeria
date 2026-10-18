// [STOCK-OCULTO] Prende o apaga el interruptor del catálogo (y elige el modo) y sube la versión del SW, en un solo paso.
// Uso:
//   node scripts/stock_oculto.js prender             prende con el modo que ya tiene el archivo (hoy 'igual', la B)
//   node scripts/stock_oculto.js prender consulta    prende y deja el sin stock en «Consultá disponibilidad» (si la web cobra)
//   node scripts/stock_oculto.js prender igual       prende con la B (el sin stock se ve y se pide igual)
//   node scripts/stock_oculto.js modo consulta|igual cambia sólo el modo (con el interruptor como esté)
//   node scripts/stock_oculto.js apagar
// Cambia sólo `var STOCK_OCULTO = …;` y `var STOCK_OCULTO_MODO = '…';` en js/app.js y `var CACHE_VERSION = 'v1.1.N';` en
// sw.js (N + 1). Si algo no está como se espera (ya estaba así, una línea no está o está dos veces), no toca nada y sale
// con error: así un `&& git commit && git push` encadenado se frena solo. Respeta los finales de línea del archivo (CRLF).
var fs = require('fs');
var path = require('path');

var USO = 'Uso: node scripts/stock_oculto.js prender [igual|consulta] | apagar | modo igual|consulta';
var accion = process.argv[2];
var modoPedido = process.argv[3];
if (['prender', 'apagar', 'modo'].indexOf(accion) === -1) { console.error(USO); process.exit(1); }
if (modoPedido !== undefined && modoPedido !== 'igual' && modoPedido !== 'consulta') { console.error(USO); process.exit(1); }
if (accion === 'modo' && !modoPedido) { console.error(USO); process.exit(1); }
if (accion === 'apagar' && modoPedido) { console.error('«apagar» no lleva modo. ' + USO); process.exit(1); }

var raiz = path.join(__dirname, '..');
var appPath = path.join(raiz, 'js', 'app.js');
var swPath = path.join(raiz, 'sw.js');

function unaVez(texto, re, archivo, que) {
  var hay = texto.match(re) || [];
  if (hay.length !== 1) {
    console.error(archivo + ': esperaba UNA línea «' + que + '» y hay ' + hay.length + '. No toqué nada.');
    process.exit(1);
  }
  return hay[0];
}

var app = fs.readFileSync(appPath, 'utf8');
var reFlag = /var STOCK_OCULTO = (true|false);/g;
var reModo = /var STOCK_OCULTO_MODO = '(igual|consulta)';/g;
var prendido = unaVez(app, reFlag, 'js/app.js', 'var STOCK_OCULTO = …;').indexOf('true') !== -1;
var modoAhora = /'(igual|consulta)'/.exec(unaVez(app, reModo, 'js/app.js', "var STOCK_OCULTO_MODO = '…';"))[1];

var quieroPrendido = accion === 'modo' ? prendido : accion === 'prender';
var quieroModo = modoPedido || modoAhora;
if (quieroPrendido === prendido && quieroModo === modoAhora) {
  console.error('Ya estaba ' + (prendido ? 'PRENDIDO' : 'APAGADO') + ' y en modo «' + modoAhora + '». No toqué nada.');
  process.exit(1);
}

var sw = fs.readFileSync(swPath, 'utf8');
var reVer = /var CACHE_VERSION = 'v(\d+)\.(\d+)\.(\d+)';/g;
var m = /v(\d+)\.(\d+)\.(\d+)/.exec(unaVez(sw, reVer, 'sw.js', "var CACHE_VERSION = '…';"));
var vieja = 'v' + m[1] + '.' + m[2] + '.' + m[3];
var nueva = 'v' + m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);

app = app.replace(reFlag, 'var STOCK_OCULTO = ' + quieroPrendido + ';').replace(reModo, "var STOCK_OCULTO_MODO = '" + quieroModo + "';");
fs.writeFileSync(appPath, app);
fs.writeFileSync(swPath, sw.replace(reVer, "var CACHE_VERSION = '" + nueva + "';"));
console.log('Listo: interruptor ' + (quieroPrendido ? 'PRENDIDO' : 'APAGADO') + ' · modo «' + quieroModo + '»'
  + (quieroModo === 'igual' ? ' (el sin stock se ve y se pide igual)' : ' (el sin stock dice «Consultá disponibilidad»)')
  + ' · SW ' + vieja + ' -> ' + nueva);
