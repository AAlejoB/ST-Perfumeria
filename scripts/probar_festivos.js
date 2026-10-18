// [DIAS-FESTIVOS] · prueba de festivoDe (js/app.js). Corta el texto entre // FESTIVOS:INICIO y // FESTIVOS:FIN del catálogo y lo prueba
// tal cual está, así la prueba no puede quedar desactualizada. Uso: node scripts/probar_festivos.js
var fs = require('fs'), path = require('path'), vm = require('vm');
var js = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
var a = js.indexOf('// FESTIVOS:INICIO'), b = js.indexOf('// FESTIVOS:FIN');
if (a < 0 || b < 0) { console.error('No encuentro las marcas FESTIVOS en js/app.js'); process.exit(2); }
var ctx = {};
vm.createContext(ctx);
vm.runInContext(js.slice(a, b) + '\nthis.festivoDe = festivoDe; this.regaloCerca = regaloCerca;', ctx);

var fallas = 0, total = 0;
function es(iso, esperado) {
  total++;
  var p = iso.split('-'), f = ctx.festivoDe(new Date(+p[0], +p[1] - 1, +p[2], 12));
  var r = f ? f.texto : null;
  if (r !== esperado) { fallas++; console.log('FALLA  ' + iso + ' → ' + r + ' (esperaba ' + esperado + ')'); }
  else console.log('ok     ' + iso + ' → ' + r);
}
// Día de la Madre: 3.er domingo de octubre
es('2026-10-18', 'Feliz Día de la Madre');
es('2026-10-11', null);
es('2026-10-25', null);
es('2026-10-17', null);
es('2027-10-17', 'Feliz Día de la Madre');
es('2028-10-15', 'Feliz Día de la Madre');   // el 1-oct-2028 es domingo: el 3.º es el 15
es('2028-10-22', null);
es('2025-10-19', 'Feliz Día de la Madre');
// Día del Padre: 3.er domingo de junio
es('2026-06-21', 'Feliz Día del Padre');
es('2027-06-20', 'Feliz Día del Padre');
es('2026-06-14', null);
// Día de las Infancias: 3.er domingo de agosto
es('2026-08-16', 'Feliz Día de las Infancias');
es('2027-08-15', 'Feliz Día de las Infancias');
es('2026-08-23', null);
// Días fijos
es('2026-02-14', 'Feliz San Valentín');
es('2026-03-08', 'Día Internacional de la Mujer');
es('2026-07-20', 'Feliz Día del Amigo');
es('2026-12-24', 'Feliz Navidad');
es('2026-12-25', 'Feliz Navidad');
es('2026-12-31', 'Feliz Año Nuevo');
es('2027-01-01', 'Feliz Año Nuevo');
es('2026-07-21', null);
es('2026-12-26', null);
es('2026-10-31', 'Feliz Halloween');   // pedido de Alejo, 18-oct
es('2026-10-30', null);
// [NUBES-CATALOGO] (24) la cuenta regresiva: el próximo día de regalo de 1 a 7 días después (el mismo día no cuenta)
function cuenta(iso, esperado) {
  total++;
  var p = iso.split('-'), c = ctx.regaloCerca(new Date(+p[0], +p[1] - 1, +p[2], 12));
  var r = c ? c.f.regalo + ' en ' + c.dias : null;
  if (r !== esperado) { fallas++; console.log('FALLA  cuenta ' + iso + ' → ' + r + ' (esperaba ' + esperado + ')'); }
  else console.log('ok     cuenta ' + iso + ' → ' + r);
}
cuenta('2026-10-18', null);                         // el día mismo: sale el saludo, no la cuenta
cuenta('2026-10-11', 'el Día de la Madre en 7');
cuenta('2026-10-17', 'el Día de la Madre en 1');
cuenta('2026-10-10', null);                         // 8 días antes: todavía no
cuenta('2026-12-17', 'Navidad en 7');
cuenta('2026-12-23', 'Navidad en 1');
cuenta('2026-12-24', null);                         // el 25 no lleva regalo (es el mismo saludo)
cuenta('2026-12-28', null);                         // Año Nuevo no es de regalo
cuenta('2027-06-14', 'el Día del Padre en 6');      // 3.er domingo de junio de 2027 = 20
cuenta('2027-02-10', 'San Valentín en 4');
cuenta('2026-07-15', 'el Día del Amigo en 5');
cuenta('2026-08-10', null);                         // Infancias no lleva cuenta
cuenta('2026-03-05', null);                         // el Día de la Mujer, tampoco
cuenta('2026-10-24', 'Halloween en 7');
cuenta('2026-10-30', 'Halloween en 1');
cuenta('2026-10-31', null);                         // el día mismo: el saludo
console.log('\n' + (total - fallas) + ' de ' + total + ' bien' + (fallas ? ' · ' + fallas + ' FALLAS' : ''));
process.exit(fallas ? 1 : 0);
