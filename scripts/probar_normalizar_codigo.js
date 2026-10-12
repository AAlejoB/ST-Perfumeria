// [ESCANER] 163 · prueba de normalizarCodigo (admin.html). Corta el texto entre /* NORMALIZAR-CODIGO:INICIO */ y /* NORMALIZAR-CODIGO:FIN */
// del panel y lo prueba tal cual está, así la prueba no puede quedar desactualizada. Uso: node scripts/probar_normalizar_codigo.js
var fs = require('fs'), path = require('path'), vm = require('vm');
var html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
var a = html.indexOf('/* NORMALIZAR-CODIGO:INICIO'), b = html.indexOf('/* NORMALIZAR-CODIGO:FIN */');
if (a < 0 || b < 0) { console.error('No encuentro las marcas NORMALIZAR-CODIGO en admin.html'); process.exit(2); }
var ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(a, b), ctx);

var fallas = 0, total = 0;
function ok(txt, esperado, caso) {
  total++;
  var r = ctx.normalizarCodigo(txt);
  var bien = r.ok === true && r.codigo === esperado;
  if (!bien) { fallas++; console.log('FALLA  ' + caso + ' · ' + JSON.stringify(txt) + ' → ' + JSON.stringify(r) + ' (esperaba ' + esperado + ')'); }
  else console.log('ok     ' + caso + ' · ' + JSON.stringify(txt) + ' → ' + r.codigo);
}
function mal(txt, motivo, caso) {
  total++;
  var r = ctx.normalizarCodigo(txt);
  var bien = r.ok === false && r.motivo === motivo && typeof r.msg === 'string' && r.msg.length > 0;
  if (!bien) { fallas++; console.log('FALLA  ' + caso + ' · ' + JSON.stringify(txt) + ' → ' + JSON.stringify(r) + ' (esperaba ' + motivo + ')'); }
  else console.log('ok     ' + caso + ' · ' + JSON.stringify(txt) + ' → ' + motivo + ': ' + r.msg);
}

// EAN-13
ok('4006381333931', '4006381333931', 'EAN-13 válido');
ok('6291108730010', '6291108730010', 'EAN-13 del ejemplo del dibujo (6291108730010)');
mal('4006381333932', 'control', 'EAN-13 con el dígito de control mal');
// UPC-A (12) → EAN-13 con un 0 adelante
ok('036000291452', '0036000291452', 'UPC-A válido → EAN-13');
mal('036000291453', 'control', 'UPC-A con el dígito de control mal');
// GTIN-14
ok('04006381333931', '4006381333931', 'GTIN-14 que empieza con 0 → EAN-13');
mal('14006381333931', 'sobran', 'GTIN-14 que NO empieza con 0 (no se adivina)');
// EAN-8
ok('12345670', '12345670', 'EAN-8 válido');
mal('12345678', 'control', 'EAN-8 con el dígito de control mal (y que tampoco cierra como UPC-E)');
// UPC-E: 04252614 se expande a 042100005264 (el UPC-A de arriba, lo dice la especificación)
ok('04252614', '04252614', 'UPC-E válido (se guarda tal cual, 8 dígitos)');
mal('04252615', 'control', 'UPC-E con el dígito de control mal');
// Letras, espacios y signos
ok('  4006 3813-33931 ', '4006381333931', 'espacios y guion entre los números');
ok('EAN: 4006381333931\r\n', '4006381333931', 'letras y salto de línea alrededor (lo que a veces manda una pistola)');
mal('abc', 'faltan', 'sólo letras');
mal('', 'faltan', 'vacío');
// Largos que no son
mal('123456789', 'faltan', '9 dígitos');
mal('12345678901', 'faltan', '11 dígitos');
mal('400638133393100', 'sobran', '15 dígitos');
// Lo que lee una cámara como texto con otros caracteres
ok('​6291108730010', '6291108730010', 'un carácter invisible adelante');

console.log('\n' + (total - fallas) + ' de ' + total + ' casos bien' + (fallas ? ' · ' + fallas + ' FALLAN' : ''));
process.exit(fallas ? 1 : 0);
