/* QA · base de mentira para el panel de ST Perfumería (todo en memoria; NO toca la tienda real).
 * Reemplaza a la librería de Supabase. Se carga en lugar del <script> del CDN (lo hace qa-server.js).
 * Hay una API para el QA: window.__QA = { db, calls, offline, latency, reset(), email() }.
 * Las reglas de la base (RLS, funciones) se copian de los .sql del repo y de lo que hay en producción, a mano y simplificadas:
 * sirve para encontrar problemas de PANTALLA; las reglas de verdad se prueban aparte, contra la base real, en transacciones que se deshacen. */
(function () {
  'use strict';
  var ART = 'America/Argentina/Buenos_Aires';
  var JEFE = 'jefe@stperfumeria.local', EMP = 'empleado@stperfumeria.local', LAB = 'lab@stperfumeria.local';
  var CLAVES = {}; CLAVES[JEFE] = 'qa-jefe'; CLAVES[EMP] = 'qa-empleada'; CLAVES[LAB] = 'qa-lab';
  var QA = window.__QA = { db: null, calls: [], offline: false, latency: 0, userEmail: null, errores: [] };

  // ── utilidades ──
  var seedN = 12345;
  function rnd() { seedN = (seedN * 1664525 + 1013904223) % 4294967296; return seedN / 4294967296; }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function uuid() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function hoyART(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: ART }).format(d || new Date()); }
  function diaART(isoStr) { return hoyART(new Date(isoStr)); }
  function clone(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
  function email() { try { var s = JSON.parse(localStorage.getItem('st-admin-auth') || 'null'); return s && s.user ? s.user.email : null; } catch (e) { return null; } }
  QA.email = email;
  function esStaff(e) { return e === JEFE || e === EMP; }
  function err(code, message, details) { return { code: code, message: message, details: details || null, hint: null }; }

  // ── la semilla: datos de ejemplo (nada real: clientes y teléfonos inventados) ──
  function seed() {
    seedN = 12345;
    var T = {}, ahora = Date.now(), hoy = hoyART();
    var P = (typeof PERFUMES !== 'undefined' && PERFUMES) ? PERFUMES : [];
    T.perfume_overrides = P.map(function (p, i) {
      var q = (i % 11 === 0) ? 0 : ri(1, 9), st = q === 0 ? 'out' : (q === 1 ? 'low' : 'ok');
      return { slug: p.slug, name: p.name, marca: p.marca, marca_real: p.marca_real, cat: p.cat, price: String(p.price).replace(/[^0-9.]/g, '').replace(/\.00$/, '').replace(/\./g, ''), promo: p.promo || '',
        stock_qty: q, stock_status: st, stock_deposito: (i % 4 === 0) ? ri(0, 12) : 0, oculto: i % 37 === 0, etiqueta: null, updated_at: iso(ahora - ri(1, 60) * 86400000), foto: p.foto || null,
        notas_salida: p.notas_salida || '', notas_corazon: p.notas_corazon || '', notas_base: p.notas_base || '', alias: null, tipo: p.tipo || null, elegidos_excluido: false, decant_excluido: false, precio_decant: null };
    });
    T.perfumes_nuevos = [1, 2, 3, 4].map(function (n) {
      return { id: n, slug: 'nuevo-qa-' + n, name: 'NUEVO QA ' + n, marca: 'ST Perfumería', marca_real: n % 2 ? 'Lattafa' : 'Armaf', cat: 'Unisex', perfil: 'Fresco', price: String(60000 + n * 5000), promo: '', foto: null, notas_salida: 'Cítricos', notas_corazon: 'Flores', notas_base: 'Madera', ml: '100', created_at: iso(ahora - n * 86400000), tipo: null, alias: null, precio_decant: null, decant_excluido: false, acordes: null };
    });
    T.combos = [{ id: 1, slug: 'set-qa-1', name: 'SET QA UNO', cat: 'Unisex', marca: 'ST Perfumería', perfil: null, price: '120000', promo: '', foto: null, esSet: true, setTipo: 'set', items: ['your-touch-intense', 'your-touch-amber'], created_at: iso(ahora - 5 * 86400000) },
                { id: 2, slug: 'set-qa-2', name: 'SET QA DOS', cat: 'Unisex', marca: 'ST Perfumería', perfil: null, price: '98000', promo: '90000', foto: null, esSet: true, setTipo: 'set', items: [], created_at: iso(ahora - 9 * 86400000) }];
    T.decants_config = [{ id: 1, activo: true, ml: 5, precio_1: 9500, precio_3: 8500, precio_5: 7500, max_decants: 100, aviso_conservacion: 'Guardá tu decant en lugar fresco.', updated_at: iso(ahora), precio_frasco_max: 170000, marcas_disenador: ['CREED'] }];
    T.decants_custom = [{ id: 1, nombre: 'Aventus', marca: 'Creed', precio_unit: 21000, activo: true, orden: 1, foto_url: null, created_at: iso(ahora) }, { id: 2, nombre: 'Sauvage', marca: 'Dior', precio_unit: 14000, activo: true, orden: 2, foto_url: null, created_at: iso(ahora) }, { id: 3, nombre: 'Bleu', marca: 'Chanel', precio_unit: 16000, activo: false, orden: 3, foto_url: null, created_at: iso(ahora) }];
    T.promos_decants = [{ id: 1, activa: false, n: 3, precio_pack: 24000, max_packs: 5, desde: null, hasta: null, updated_at: iso(ahora) }];
    T.promos_decants_perfumes = [];   // (slug, modo, updated_at)
    T.destacados = ['your-touch-intense', 'your-touch-amber'].map(function (s, i) { return { id: i + 1, slug: s, posicion: i + 1 }; });
    T.seleccion_st_config = [{ id: 1, badge_text: 'TOP VENTAS' }];
    T.home_top_banner = [{ id: 1, texto: 'Envíos a todo el país', activo: true, modo_marquee: false, updated_at: iso(ahora) }];
    T.home_slides = [];
    T.trust_badges = [{ id: 1, orden: 1, icono: 'truck', titulo: 'Envíos', bajada: 'A todo el país', link_a: null, activo: true, updated_at: iso(ahora) }, { id: 2, orden: 2, icono: 'lock', titulo: 'Pago seguro', bajada: 'Transferencia, MP o efectivo', link_a: null, activo: true, updated_at: iso(ahora) }];
    T.ajuste_horario = [];
    T.cierres_especiales = [];
    T.votacion_config = [{ mes: hoy.slice(0, 7), candidatos_masc: [], candidatos_fem: [], created_at: iso(ahora) }];
    T.votos = [];
    T.opiniones = [{ id: uuid(), texto: 'Me encantó el Your Touch', created_at: iso(ahora - 86400000) }, { id: uuid(), texto: 'Tardó el envío', created_at: iso(ahora - 3 * 86400000) }];
    T.puntos_config = [{ id: 1, puntos_por_perfume: 1, puntos_por_decant: 1, puntos_por_set_combo: 2, threshold_proximo_premio: 10, mensaje_promo: null, pesos_por_punto: null, updated_at: iso(ahora) }];
    var nombres = ['Lucía Prueba', 'Marcos QA', 'Sofi Demo', 'Tomás Ejemplo', 'Vale Test', 'Nico Simulado', 'Pau Falsa', 'Fede Inventado'];
    T.clientes = nombres.map(function (n, i) { return { id: uuid(), nombre: n, telefono: '549297' + String(4000000 + i * 1111).padStart(7, '0'), puntos: i * 2, compro: i % 2 === 0, bloqueado: i === 7, nota: i === 2 ? 'Pidió factura' : null, created_at: iso(ahora - (i + 1) * 3 * 86400000), puntos_log: [] }; });
    T.puntos_log = [];
    T.perfume_codigos = [{ codigo: '6291108730010', slug: 'your-touch-intense', creado_por: JEFE, creado_en: iso(ahora - 86400000) }, { codigo: '6291108730027', slug: 'your-touch-amber', creado_por: EMP, creado_en: iso(ahora - 86400000) }];
    T.lista_espera = [
      { id: 1, slug: 'your-touch-amber', perfume_name: 'YOUR TOUCH AMBER', telefono: '5492974111111', nombre: 'Lucía Prueba', created_at: iso(ahora - 86400000), notified_at: null, origen: 'web', libre: false },
      { id: 2, slug: 'your-touch-amber', perfume_name: 'YOUR TOUCH AMBER', telefono: '5492974222222', nombre: null, created_at: iso(ahora - 2 * 86400000), notified_at: null, origen: 'local', libre: false },
      { id: 3, slug: 'libre:cargador de auto', perfume_name: 'Cargador de auto', telefono: '5492974333333', nombre: 'Marcos QA', created_at: iso(ahora - 3600000), notified_at: null, origen: 'local', libre: true }];
    T.caja_movimientos = [
      { id: uuid(), creado_en: iso(ahora - 3 * 3600000), dia: hoy, tipo: 'venta', detalle: 'YOUR TOUCH INTENSE', efectivo: 67500, mp: 0, posnet: 0, items: [{ slug: 'your-touch-intense', nombre: 'YOUR TOUCH INTENSE', qty: 1, llevar: true, ya_bajado: false, descontado: false, precio: 75000, vino_por: 'local', marca: 'Maison Alhambra' }], creado_por: EMP, anulado_en: null, anulado_por: null, debe: 0, debe_quien: null, saldado_en: null, saldado_por: null, salda_a: null, sin_conexion: false },
      { id: uuid(), creado_en: iso(ahora - 2 * 3600000), dia: hoy, tipo: 'nota', detalle: 'apagar luz vidriera', efectivo: 0, mp: 0, posnet: 0, items: [], creado_por: EMP, anulado_en: null, anulado_por: null, debe: 0, debe_quien: null, saldado_en: null, saldado_por: null, salda_a: null, sin_conexion: false }];
    T.ventas = [];
    T.stock_movimientos = [];
    // el log: stock y precios de hoy, para que el Resumen y el Log tengan qué mostrar
    T.admin_actions = [];
    function act(h, who, action, slug, ch) { T.admin_actions.push({ id: uuid(), created_at: iso(ahora - h * 3600000), actor_email: who, actor_role: who === JEFE ? 'jefe' : 'empleado', action: action, target_slug: slug, changes: ch }); }
    act(5, EMP, 'stock_update', 'your-touch-intense', { stock_status: { old: 'ok', new: 'ok' }, stock_qty: { old: 6, new: 5 } });
    act(4, EMP, 'deposito_update', 'your-touch-amber', { stock_deposito: { old: 4, new: 2 } });
    act(3, JEFE, 'perfume_edit', 'your-touch-intense', { Precio: { old: '72000', new: '75000' } });
    act(2, JEFE, 'login_success', null, null);
    T.edit_log = [{ id: 1, created_at: iso(ahora - 3 * 3600000), slug: 'your-touch-intense', nombre: 'YOUR TOUCH INTENSE', campo: 'Precio', valor_anterior: '72000', valor_nuevo: '75000', editado_por: 'jefe' }];
    T.admin_backups = [{ id: uuid(), created_at: iso(ahora - 86400000), trigger: 'auto', actor_email: null, size_bytes: 480000, row_counts: { perfume_overrides: 150, clientes: 8 }, data: {} }];
    T.password_reset_requests = [{ id: uuid(), cliente_id: null, telefono: '5492974000000', status: 'pending', created_at: iso(ahora - 7200000), expires_at: iso(ahora + 86400000), resolved_by: null, resolved_at: null, temp_password: null, notes: null }];
    T.push_subscriptions = [];
    T.announcements = [];
    T.perfume_clicks = []; T.analytics_events = [];
    var tipos = ['view_product', 'view_product', 'view_product', 'decant_add', 'wa_click'], refs = ['instagram', 'direct', 'google', 'instagram', 'internal'], disp = ['mobile', 'mobile', 'mobile', 'desktop'];
    for (var k = 0; k < 400; k++) {
      var tp = tipos[ri(0, tipos.length - 1)], p = P.length ? P[ri(0, Math.min(P.length - 1, 25))] : { slug: 'x' };
      T.analytics_events.push({ id: uuid(), created_at: iso(ahora - ri(0, 29) * 86400000 - ri(0, 80000000)), session_id: 's' + ri(1, 120), event_type: tp, slug: p.slug, query: null, meta: { hour: ri(8, 23), device: disp[ri(0, 3)], referrer: refs[ri(0, 4)] } });
      if (k % 9 === 0) T.analytics_events.push({ id: uuid(), created_at: iso(ahora - ri(0, 29) * 86400000), session_id: 's1', event_type: 'search_empty', slug: null, query: ['valentino', 'messi', 'azzaro', 'tiramisu'][ri(0, 3)], meta: { hour: 12, device: 'mobile', referrer: 'direct' } });
      if (k % 3 === 0) T.perfume_clicks.push({ id: uuid(), slug: p.slug, created_at: iso(ahora - ri(0, 29) * 86400000) });
    }
    // [HOLMES] llegadas y fichas de mentira de los últimos 12 días (visita = sesión + día)
    for (var v = 0; v < 320; v++) {
      var sid = 'h' + ri(1, 200), base = ahora - ri(0, 11) * 86400000 - ri(0, 40000000), mete = function (tp, sl) { T.analytics_events.push({ id: uuid(), created_at: iso(base + ri(0, 600000)), session_id: sid, event_type: tp, slug: sl, query: null, meta: tp === 'llegada' ? { hour: 12, device: 'mobile', referrer: 'instagram', holmes: 2 } : (tp === 'wa_intento' ? { hour: 12, origen: ['tarjeta_celu', 'tarjeta_celu', 'ficha', 'carrito', 'flotante'][ri(0, 4)] } : { hour: 12 }) }); };
      mete('llegada', null);
      if (rnd() < 0.55) { var nf = ri(1, 3); for (var f = 0; f < nf; f++) { var pp = P.length ? P[Math.min(P.length - 1, Math.floor(Math.pow(rnd(), 2) * 18))] : { slug: 'x' }; mete('ficha_abierta', pp.slug); if (rnd() < (f === 0 ? 0.09 : 0.04)) mete('wa_intento', pp.slug); } }
    }
    T.marcas_costo = []; T.perfumes_costo = []; T.costos_config = [{ id: 1, costo_envase: 0 }];
    T.usuarios_dev = [{ email: LAB, nombre: 'Laboratorio' }];
    return T;
  }
  QA.reset = function () { QA.db = seed(); QA.calls.length = 0; };

  // ── reglas de acceso (RLS) simplificadas, las de producción para las tablas que importan ──
  var JEFE_SOLO = { decants_config: ['insert', 'update', 'delete'], marcas_costo: ['select', 'insert', 'update', 'delete'], perfumes_costo: ['select', 'insert', 'update', 'delete'], costos_config: ['select', 'insert', 'update', 'delete'], admin_backups: ['insert'], caja_movimientos: ['delete'] };
  var SOLO_STAFF = { caja_movimientos: 1, ventas: 1, perfume_codigos: 1, stock_movimientos: 0 };
  function acceso(tabla, op, row) {   // devuelve 'ok' | 'vacio' (la base calla y no toca nada) | error
    var e = email(), staff = esStaff(e);
    if (JEFE_SOLO[tabla] && JEFE_SOLO[tabla].indexOf(op) !== -1 && e !== JEFE) return op === 'insert' ? { error: err('42501', 'new row violates row-level security policy for table "' + tabla + '"') } : 'vacio';
    if (SOLO_STAFF[tabla] && !staff) return op === 'select' || op === 'update' || op === 'delete' ? 'vacio' : { error: err('42501', 'new row violates row-level security policy for table "' + tabla + '"') };
    if (tabla === 'analytics_events' && op === 'select' && e !== JEFE) return 'vacio';
    if (tabla === 'usuarios_dev') return { error: err('42501', 'permission denied for table usuarios_dev') };
    if (tabla === 'stock_movimientos') return { error: err('42501', 'permission denied for table stock_movimientos') };
    if (!e && ['clientes', 'admin_actions', 'admin_backups', 'password_reset_requests'].indexOf(tabla) !== -1) return op === 'insert' ? { error: err('42501', 'RLS') } : 'vacio';
    return 'ok';
  }
  function filtrarFilasVisibles(tabla, rows) {
    var e = email();
    if (tabla === 'admin_actions' && e !== JEFE) return rows.filter(function (r) { return e === EMP && (r.action === 'stock_update' || r.action === 'deposito_update'); });
    return rows;
  }

  // ── valores por defecto y restricciones de las tablas que se escriben ──
  var ID_NUM = {};
  function aplicarDefaults(tabla, r) {
    var e = email();
    r = clone(r);
    var T = QA.db[tabla];
    var conIdNum = ['edit_log', 'home_slides', 'home_top_banner', 'trust_badges', 'promos_decants_perfumes', 'ajuste_horario', 'cierres_especiales', 'opiniones', 'combos', 'decants_custom', 'destacados', 'lista_espera', 'password_reset_requests', 'admin_backups', 'perfumes_nuevos', 'announcements', 'votos', 'push_subscriptions'];
    if (conIdNum.indexOf(tabla) !== -1 && r.id == null) { ID_NUM[tabla] = Math.max(ID_NUM[tabla] || 0, T.reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0)) + 1; r.id = ID_NUM[tabla]; }
    if (['admin_actions', 'analytics_events', 'perfume_clicks', 'puntos_log'].indexOf(tabla) !== -1 && r.id == null) r.id = uuid();
    if (r.created_at === undefined && ['admin_actions', 'analytics_events', 'perfume_clicks', 'edit_log', 'opiniones', 'lista_espera', 'clientes', 'puntos_log', 'admin_backups', 'password_reset_requests', 'perfumes_nuevos', 'combos', 'announcements', 'home_top_banner'].indexOf(tabla) !== -1) r.created_at = iso(Date.now());
    if (tabla === 'caja_movimientos') {
      if (r.creado_en === undefined) r.creado_en = iso(Date.now());
      if (r.dia === undefined) r.dia = hoyART();
      if (r.tipo === undefined) r.tipo = 'venta';
      ['efectivo', 'mp', 'posnet', 'debe'].forEach(function (k) { if (r[k] === undefined) r[k] = 0; });
      if (r.items === undefined) r.items = [];
      if (r.creado_por === undefined) r.creado_por = e;
      ['anulado_en', 'anulado_por', 'debe_quien', 'saldado_en', 'saldado_por', 'salda_a'].forEach(function (k) { if (r[k] === undefined) r[k] = null; });
      if (r.sin_conexion === undefined) r.sin_conexion = false;
    }
    if (tabla === 'clientes') { if (r.id == null) r.id = uuid(); if (r.puntos === undefined) r.puntos = 0; if (r.puntos_log === undefined) r.puntos_log = []; if (r.bloqueado === undefined) r.bloqueado = false; if (r.compro === undefined) r.compro = false; }
    if (['opiniones', 'announcements', 'admin_backups', 'password_reset_requests', 'push_subscriptions', 'votos'].indexOf(tabla) !== -1 && r.id == null) r.id = uuid();
    if (tabla === 'perfume_codigos') { if (r.creado_por === undefined) r.creado_por = e; if (r.creado_en === undefined) r.creado_en = iso(Date.now()); }
    if (tabla === 'admin_actions') { if (r.actor_email === undefined) r.actor_email = e; }
    return r;
  }
  function validar(tabla, r, op, previo) {
    var e = email(), T = QA.db[tabla];
    if (tabla === 'caja_movimientos' && op === 'insert') {
      if (r.creado_por !== e) return err('42501', 'new row violates row-level security policy for table "caja_movimientos"');
      if (r.dia > hoyART()) return err('42501', 'new row violates row-level security policy for table "caja_movimientos"');
      if (T.some(function (x) { return x.id === r.id; })) return err('23505', 'duplicate key value violates unique constraint "caja_movimientos_pkey"');
      var tot = (Number(r.efectivo) || 0) + (Number(r.mp) || 0) + (Number(r.posnet) || 0);
      if (!String(r.detalle || '').trim() || String(r.detalle).length > 300) return err('23514', 'new row for relation "caja_movimientos" violates check constraint');
      if (r.tipo === 'venta' && tot < 0) return err('23514', 'violates check constraint');
      if (!Array.isArray(r.items) || r.items.length > 20) return err('23514', 'new row for relation "caja_movimientos" violates check constraint "caja_movimientos_items_check"');
    }
    var INT = { perfume_overrides: ['stock_qty', 'stock_deposito', 'precio_decant'], perfumes_nuevos: ['price', 'precio_decant'], decants_config: ['ml', 'precio_1', 'precio_3', 'precio_5', 'max_decants', 'precio_frasco_max'], clientes: ['puntos'], puntos_config: ['threshold_proximo_premio', 'pesos_por_punto'], promos_decants: ['precio_pack'] };
    var SMALL = { promos_decants: ['n', 'max_packs'] };
    var bad = null;
    (INT[tabla] || []).forEach(function (c) { if (r[c] != null && r[c] !== '') { var v = Number(r[c]); if (!isFinite(v) || v !== Math.floor(v) || v > 2147483647 || v < -2147483648) bad = bad || err(isFinite(v) && v === Math.floor(v) ? '22003' : '22P02', isFinite(v) && v === Math.floor(v) ? 'value "' + r[c] + '" is out of range for type integer' : 'invalid input syntax for type integer: "' + r[c] + '"'); } });
    (SMALL[tabla] || []).forEach(function (c) { if (r[c] != null) { var v = Number(r[c]); if (!isFinite(v) || v !== Math.floor(v) || v > 32767 || v < -32768) bad = bad || err('22003', 'value "' + r[c] + '" is out of range for type smallint'); } });
    if (bad) return bad;
    if (tabla === 'perfumes_nuevos' && 'name' in r && (r.name == null || r.name === '')) return err('23502', 'null value in column "name" of relation "perfumes_nuevos" violates not-null constraint');
    if (tabla === 'clientes' && (op === 'insert' || 'nombre' in r)) { if (op === 'insert' || 'nombre' in r) { var nm = r.nombre; if (nm == null || String(nm).length < 1 || String(nm).length > 60 || /[\u0000-\u001f\u007f]/.test(String(nm))) return err('23514', 'new row for relation "clientes" violates check constraint "clientes_nombre_limpio"'); } }
    if (tabla === 'clientes' && ('telefono' in r) && !/^549[0-9]{10}$/.test(String(r.telefono))) return err('23514', 'new row for relation "clientes" violates check constraint "clientes_telefono_canonico"');
    if (tabla === 'clientes' && ('puntos' in r) && Number(r.puntos) < 0) return err('23514', 'new row for relation "clientes" violates check constraint "clientes_puntos_no_negativo"');
    if (tabla === 'opiniones' && op === 'insert' && String(r.texto || '').length > 280) return err('23514', 'new row for relation "opiniones" violates check constraint "opiniones_texto_check"');
    if (tabla === 'promos_decants') { var pd = Object.assign({}, previo || {}, r); if (pd.n != null && (pd.n < 2 || pd.n > 10)) return err('23514', 'violates check constraint "promos_decants_n_check"'); if (pd.precio_pack != null && pd.precio_pack <= 0) return err('23514', 'violates check constraint "promos_decants_precio_pack_check"'); if (pd.max_packs != null && pd.max_packs <= 0) return err('23514', 'violates check constraint "promos_decants_max_packs_check"'); if (pd.activa && !pd.hasta) return err('23514', 'violates check constraint "promos_decants_prendida_con_fin"'); if (pd.hasta && pd.desde && !(pd.hasta > pd.desde)) return err('23514', 'violates check constraint "promos_decants_fechas"'); }
    if (tabla === 'puntos_config') { var pc = Object.assign({}, previo || {}, r); if (pc.threshold_proximo_premio != null && pc.threshold_proximo_premio <= 0) return err('23514', 'violates check constraint "puntos_config_threshold_proximo_premio_check"'); if (pc.pesos_por_punto != null && pc.pesos_por_punto <= 0) return err('23514', 'violates check constraint "puntos_config_pesos_por_punto_check"'); }
    if ((tabla === 'perfume_overrides' || tabla === 'perfumes_nuevos') && Array.isArray(r.acordes) && (r.acordes.length > 3 || r.acordes.some(function (a) { return ['dulce', 'vainilla', 'especiado', 'amaderado', 'oud', 'ambar', 'floral', 'frutal', 'citrico', 'fresco', 'cuero', 'almizcle'].indexOf(a) === -1; }))) return err('23514', 'violates check constraint "' + tabla + '_acordes_check"');
    if (tabla === 'lista_espera' && op === 'insert') { var lib = String(r.slug || '').indexOf('libre:') === 0; if (lib !== !!r.libre || (r.libre && (r.origen !== 'local' || String(r.perfume_name || '').length < 3 || String(r.perfume_name || '').length > 60))) return err('23514', 'new row for relation "lista_espera" violates check constraint "lista_espera_libre_check"'); if (['web', 'local'].indexOf(r.origen || 'web') === -1) return err('23514', 'violates check constraint "lista_espera_origen_check"'); }
    var UNICOS = { perfumes_nuevos: 'slug', combos: 'slug', destacados: 'slug', cierres_especiales: 'fecha' };
    if (UNICOS[tabla] && op === 'insert' && T.some(function (x) { return x[UNICOS[tabla]] === r[UNICOS[tabla]]; })) return err('23505', 'duplicate key value violates unique constraint "' + tabla + '_' + UNICOS[tabla] + '_key"');
    if (tabla === 'perfume_codigos' && op === 'insert') {
      if (!/^[0-9]{8}$|^[0-9]{13}$/.test(String(r.codigo))) return err('23514', 'new row for relation "perfume_codigos" violates check constraint');
      if (T.some(function (x) { return x.codigo === r.codigo; })) return err('23505', 'duplicate key value violates unique constraint "perfume_codigos_pkey"');
    }
    if (tabla === 'lista_espera' && op === 'insert') {
      if (T.some(function (x) { return x.slug === r.slug && x.telefono === r.telefono && !x.notified_at; })) return err('23505', 'duplicate key value violates unique constraint "lista_espera_pendiente_uniq"');
    }
    if (tabla === 'clientes' && op === 'insert') {
      if (T.some(function (x) { return x.telefono === r.telefono; })) return err('23505', 'duplicate key value violates unique constraint "clientes_telefono_key"');
      if (r.puntos !== undefined && Number(r.puntos) !== 0) return err('42501', 'permission denied for table clientes');
    }
    if (tabla === 'clientes' && op === 'update' && (('puntos' in r) || ('puntos_log' in r))) return err('42501', 'permission denied for table clientes');
    if (tabla === 'perfume_overrides' && op === 'insert' && T.some(function (x) { return x.slug === r.slug; })) return err('23505', 'duplicate key value violates unique constraint "perfume_overrides_pkey"');
    return null;
  }

  // ── el constructor de consultas (imita a PostgREST) ──
  function Q(tabla) { this.t = tabla; this.op = 'select'; this.fs = []; this.ord = []; this.lim = null; this.rng = null; this.one = null; this.pl = null; this.opt = {}; this.ret = false; this.head = false; this.cnt = null; this.cols = '*'; }
  var P_ = Q.prototype;
  function f(fn) { return function () { var a = arguments; this.fs.push(function (r) { return fn(r, a); }); return this; }; }
  function cmp(a, b) { if (a == null || b == null) return null; if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b); return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0); }
  P_.eq = f(function (r, a) { return r[a[0]] == a[1] || (a[1] === null && r[a[0]] == null); });
  P_.neq = f(function (r, a) { return r[a[0]] != a[1]; });
  P_.gt = f(function (r, a) { var c = cmp(r[a[0]], a[1]); return c !== null && c > 0; });
  P_.gte = f(function (r, a) { var c = cmp(r[a[0]], a[1]); return c !== null && c >= 0; });
  P_.lt = f(function (r, a) { var c = cmp(r[a[0]], a[1]); return c !== null && c < 0; });
  P_.lte = f(function (r, a) { var c = cmp(r[a[0]], a[1]); return c !== null && c <= 0; });
  P_.is = f(function (r, a) { return a[1] === null ? r[a[0]] == null : r[a[0]] === a[1]; });
  P_.in = f(function (r, a) { return a[1].some(function (v) { return v == r[a[0]]; }); });
  P_.ilike = f(function (r, a) { var re = new RegExp('^' + String(a[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); return re.test(String(r[a[0]] == null ? '' : r[a[0]])); });
  P_.like = P_.ilike;
  P_.match = function (o) { var self = this; Object.keys(o).forEach(function (k) { self.fs.push(function (r) { return r[k] == o[k]; }); }); return this; };
  P_.or = function (txt) {   // sólo lo que usa el panel: «col.is.null,col.gt.valor»
    var partes = String(txt).split(',').map(function (s) { var m = s.match(/^([a-z_]+)\.(is|gt|gte|lt|lte|eq|neq)\.(.*)$/); return m ? { c: m[1], o: m[2], v: m[3] } : null; }).filter(Boolean);
    this.fs.push(function (r) { return partes.some(function (p) { var x = r[p.c]; if (p.o === 'is') return p.v === 'null' ? x == null : String(x) === p.v; var c = cmp(x, p.v); if (c === null) return false; return p.o === 'gt' ? c > 0 : (p.o === 'gte' ? c >= 0 : (p.o === 'lt' ? c < 0 : (p.o === 'lte' ? c <= 0 : (p.o === 'eq' ? c === 0 : c !== 0)))); }); });
    return this;
  };
  P_.order = function (c, o) { this.ord.push({ c: c, asc: !(o && o.ascending === false) }); return this; };
  P_.limit = function (n) { this.lim = n; return this; };
  P_.range = function (a, b) { this.rng = [a, b]; return this; };
  P_.single = function () { this.one = 'single'; return this; };
  P_.maybeSingle = function () { this.one = 'maybe'; return this; };
  P_.select = function (cols, o) { if (this.op === 'select') { this.cols = cols || '*'; if (o) { this.head = !!o.head; this.cnt = o.count || null; } } else { this.ret = true; this.cols = cols || '*'; } return this; };
  P_.insert = function (x) { this.op = 'insert'; this.pl = x; return this; };
  P_.upsert = function (x, o) { this.op = 'upsert'; this.pl = x; this.opt = o || {}; return this; };
  P_.update = function (x) { this.op = 'update'; this.pl = x; return this; };
  P_.delete = function () { this.op = 'delete'; return this; };
  P_.then = function (ok, ko) { return this._run().then(ok, ko); };
  P_.catch = function (ko) { return this._run().catch(ko); };
  P_._run = function () {
    var self = this;
    return new Promise(function (res, rej) {
      var go = function () {
        QA.calls.push({ t: self.t, op: self.op, email: email() });
        if (QA.offline) return rej(new TypeError('Failed to fetch'));
        var out; try { out = self._exec(); } catch (e) { QA.errores.push(String(e && e.stack || e)); out = { data: null, error: err('XX000', 'QA fake: ' + e.message) }; }
        res(out);
      };
      if (QA.latency > 0) setTimeout(go, QA.latency); else setTimeout(go, 0);
    });
  };
  P_._exec = function () {
    var t = this.t; if (!QA.db[t]) QA.db[t] = [];
    var T = QA.db[t], ac = acceso(t, this.op === 'upsert' ? 'insert' : this.op), self = this;
    if (ac && ac.error) return { data: null, error: ac.error };
    var visible = filtrarFilasVisibles(t, T);
    var match = function (r) { return self.fs.every(function (fn) { return fn(r); }); };
    var devolver = function (rows) {
      var cols = self.cols && self.cols !== '*' ? String(self.cols).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : null;
      var data = rows.map(function (r) { if (!cols) return clone(r); var o = {}; cols.forEach(function (c) { if (c in r) o[c] = clone(r[c]); }); return o; });
      if (self.one) { if (data.length === 1) return { data: data[0], error: null }; if (data.length === 0 && self.one === 'maybe') return { data: null, error: null }; return { data: null, error: err('PGRST116', 'JSON object requested, multiple (or no) rows returned', 'The result contains ' + data.length + ' rows') }; }
      return { data: data, error: null };
    };
    if (this.op === 'select') {
      if (ac === 'vacio') return self.head ? { data: null, count: 0, error: null } : (self.one ? devolver([]) : { data: [], error: null });
      var rows = visible.filter(match).slice();
      this.ord.slice().reverse().forEach(function (o) { rows.sort(function (a, b) { var c = cmp(a[o.c], b[o.c]); if (c === null) return a[o.c] == null ? (b[o.c] == null ? 0 : 1) : -1; return o.asc ? c : -c; }); });
      var total = rows.length;
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
      else rows = rows.slice(0, this.lim != null ? this.lim : 1000);
      if (this.head) return { data: null, count: total, error: null };
      var r0 = devolver(rows); if (this.cnt) r0.count = total; return r0;
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      var lista = Array.isArray(this.pl) ? this.pl : [this.pl], nuevos = [];
      for (var i = 0; i < lista.length; i++) {
        var r = aplicarDefaults(t, lista[i]);
        if (this.op === 'upsert') {
          var clave = (this.opt.onConflict || (t === 'perfume_codigos' ? 'codigo' : (['marcas_costo'].indexOf(t) !== -1 ? 'marca' : (['perfumes_costo', 'perfume_overrides'].indexOf(t) !== -1 ? 'slug' : 'id')))).split(',');
          var ex = T.filter(function (x) { return clave.every(function (c) { return x[c] == r[c]; }); })[0];
          if (ex) { if (acceso(t, 'update') === 'vacio') return { data: [], error: null }; var vu = validar(t, r, 'update', ex); if (vu) return { data: null, error: vu }; Object.keys(r).forEach(function (k) { ex[k] = clone(r[k]); }); nuevos.push(ex); continue; }
        }
        var ve = validar(t, r, 'insert'); if (ve) return { data: null, error: ve };
        nuevos.push(r);
      }
      nuevos.forEach(function (r) { if (T.indexOf(r) === -1) T.push(r); });
      QA.triggers(t, 'insert', nuevos);
      return this.ret ? devolver(nuevos) : { data: null, error: null };
    }
    if (this.op === 'update') {
      if (ac === 'vacio') return this.ret ? devolver([]) : { data: null, error: null };
      var tocar = visible.filter(match), pl = this.pl;
      var ve2 = validar(t, pl, 'update', tocar[0]); if (ve2) return { data: null, error: ve2 };
      if (t === 'caja_movimientos') {   // sólo el tachado, como los permisos por columna
        var raro = Object.keys(pl).filter(function (k) { return k !== 'anulado_en' && k !== 'anulado_por'; });
        if (raro.length) return { data: null, error: err('42501', 'permission denied for table caja_movimientos') };
      }
      tocar.forEach(function (r) { Object.keys(pl).forEach(function (k) { r[k] = clone(pl[k]); }); if ('updated_at' in r && !('updated_at' in pl)) r.updated_at = iso(Date.now()); });
      QA.triggers(t, 'update', tocar);
      return this.ret ? devolver(tocar) : { data: null, error: null };
    }
    if (this.op === 'delete') {
      if (ac === 'vacio') return this.ret ? devolver([]) : { data: null, error: null };
      var borrar = visible.filter(match);
      if (t === 'caja_movimientos') {   // el trigger que frena borrar un renglón que ya bajó stock
        var malo = borrar.filter(function (r) { return !r.anulado_en && (r.items || []).some(function (it) { return it.cierre && it.cierre.bajo > 0 && !it.cierre.devuelto; }); });
        if (malo.length) return { data: null, error: err('P0001', 'Primero tachá el renglón: ya bajó stock') };
      }
      borrar.forEach(function (r) { T.splice(T.indexOf(r), 1); });
      return this.ret ? devolver(borrar) : { data: null, error: null };
    }
  };
  QA.triggers = function (t, op, rows) {   // los triggers que importan acá
    if (t === 'perfume_overrides' && op === 'update') rows.forEach(function (r) { if (r.stock_qty === 0 && r.stock_status !== 'pausado') r.stock_status = 'out'; });
  };

  // ── funciones de la base (rpc), copiadas de los .sql con su misma lógica ──
  function logAccion(accion, slug, ch) { var e = email(); QA.db.admin_actions.push({ id: uuid(), created_at: iso(Date.now()), actor_email: e, actor_role: e === JEFE ? 'jefe' : 'empleado', action: accion, target_slug: slug, changes: ch }); }
  function estadoStock(q, st) { return st === 'pausado' ? 'pausado' : (q <= 0 ? 'out' : (q === 1 ? 'low' : 'ok')); }
  function noAut() { var e = email(); return !esStaff(e) ? { data: null, error: err('42501', 'No autorizado') } : null; }
  var RPC = {
    send_telegram: function () { return { data: null, error: null }; },
    wa_consultas_hoy: function (a) { var n = noAut(); if (n) return n; return { data: QA.db.analytics_events.filter(function (x) { return x.event_type === 'wa_click' && (a.p_slugs || []).indexOf(x.slug) !== -1 && diaART(x.created_at) === hoyART(); }).length, error: null }; },
    holmes_metricas: function (a) {   // [HOLMES] [WA-INTENTO] la misma cuenta que sql/holmes_wa_intento.sql
      if (email() !== LAB) return { data: null, error: err('42501', 'sin permiso') };
      var dias = Math.max(1, Math.min(a.p_dias || 30, 365)), desde = Date.now() - dias * 86400000;
      var ev = QA.db.analytics_events.filter(function (x) { return new Date(x.created_at).getTime() >= desde && x.session_id && ['llegada', 'ficha_abierta', 'wa_intento'].indexOf(x.event_type) !== -1; });
      var vis = {}, pp = {};
      ev.forEach(function (x) {
        var k = x.session_id + '|' + diaART(x.created_at), o = vis[k] || (vis[k] = {});
        if (x.event_type !== 'llegada' || (x.meta && String(x.meta.holmes) === '2')) o[x.event_type] = true;
        if (x.slug && x.event_type !== 'llegada') { var kk = x.slug + '|' + k, q = pp[kk] || (pp[kk] = { slug: x.slug, k: k }); q[x.event_type] = true; }
        if (x.event_type === 'wa_intento') { (o.og || (o.og = {}))[(x.meta && x.meta.origen) || 'otro'] = true; }
      });
      var V = Object.keys(vis).map(function (k) { return vis[k]; });
      var ogs = {}; V.forEach(function (o) { if (o.llegada && o.og) Object.keys(o.og).forEach(function (g) { ogs[g] = (ogs[g] || 0) + 1; }); });
      var por = {}; Object.keys(pp).forEach(function (k) { var q = pp[k]; if (!vis[q.k].llegada) return; var r = por[q.slug] || (por[q.slug] = { slug: q.slug, miraron: 0, escribieron: 0, wa_sin_ficha: 0 }); if (q.ficha_abierta) r.miraron++; if (q.ficha_abierta && q.wa_intento) r.escribieron++; if (q.wa_intento && !q.ficha_abierta) r.wa_sin_ficha++; });
      var lista = Object.keys(por).map(function (k) { return por[k]; }).filter(function (r) { return r.miraron > 0; }).sort(function (x, y) { return y.miraron - x.miraron || y.escribieron - x.escribieron || (x.slug < y.slug ? -1 : 1); }).slice(0, 40);
      var lleg = QA.db.analytics_events.filter(function (x) { return x.event_type === 'llegada' && x.meta && String(x.meta.holmes) === '2'; }).map(function (x) { return diaART(x.created_at); }).sort();
      return { data: { dias: dias, hoy: hoyART(), desde: lleg[0] || null,
        total: { llegaron: V.filter(function (o) { return o.llegada; }).length, con_ficha: V.filter(function (o) { return o.llegada && o.ficha_abierta; }).length,
                 escribieron: V.filter(function (o) { return o.llegada && o.wa_intento; }).length, wa_sin_llegada: V.filter(function (o) { return o.wa_intento && !o.llegada; }).length },
        por_perfume: lista, origenes: Object.keys(ogs).map(function (g) { return { origen: g, visitas: ogs[g] }; }).sort(function (x, y) { return y.visitas - x.visitas; }) }, error: null };
    },
    lab_metricas: function (a) { if (email() !== LAB) return { data: null, error: err('42501', 'sin permiso') }; return { data: QA.labFixture(a.p_dias), error: null }; },
    perfume_clicks_resumen: function () { var m = {}; QA.db.perfume_clicks.forEach(function (c) { m[c.slug] = (m[c.slug] || 0) + 1; }); return { data: Object.keys(m).map(function (s) { return { slug: s, clicks: m[s] }; }), error: null }; },
    analytics_events_cleanup: function () { return { data: 0, error: null }; },
    admin_actions_cleanup: function () { return { data: 0, error: null }; },
    admin_backups_cleanup: function () { return { data: 0, error: null }; },
    ajustar_puntos: function (a) {
      var n = noAut(); if (n) return n;
      var c = QA.db.clientes.filter(function (x) { return x.id === a.p_cliente; })[0];
      if (!a.p_cliente || !a.p_delta) return { data: null, error: err('22023', 'cantidad_invalida', 'El ajuste tiene que ser un número entero distinto de 0.') };
      if (!c) return { data: null, error: err('P0002', 'cliente_no_encontrado') };
      var antes = c.puntos || 0, desp = antes + a.p_delta;
      if (desp < 0) return { data: null, error: err('22023', 'puntos_insuficientes', String(antes)) };
      if (desp > 2147483647) return { data: null, error: err('22003', 'puntos_excede_maximo', String(antes)) };
      c.puntos = desp; c.compro = c.compro || a.p_delta > 0;
      QA.db.puntos_log.push({ id: uuid(), cliente_id: c.id, delta: a.p_delta, saldo_antes: antes, saldo_despues: desp, origen: 'manual', motivo: a.p_motivo || null, actor: email() === JEFE ? 'jefe' : 'empleado', created_at: iso(Date.now()) });
      return { data: desp, error: null };
    },
    resumen_dia: function (a) {
      var dia = (a && a.p_dia) || hoyART(), hoy = hoyART();
      var porDia = function (r) { return diaART(r.created_at) === dia; };
      var neto = function (accion, campo) {
        var por = {}; QA.db.admin_actions.filter(function (x) { return x.action === accion && porDia(x) && x.changes && x.changes[campo] && x.changes[campo].old != null && x.changes[campo].new != null; }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).forEach(function (x) { var s = por[x.target_slug] = por[x.target_slug] || { ini: x.changes[campo].old }; s.fin = x.changes[campo].new; });
        return Object.keys(por).map(function (s) { var p = (QA.db.perfume_overrides.filter(function (o) { return o.slug === s; })[0] || {}); return { slug: s, name: p.name || s, delta: por[s].fin - por[s].ini }; }).filter(function (x) { return x.delta !== 0; });
      };
      var precios = []; QA.db.admin_actions.filter(function (x) { return x.action === 'perfume_edit' && porDia(x); }).forEach(function (x) { ['Precio', 'Promo'].forEach(function (k) { var c = x.changes && x.changes[k]; if (c && typeof c === 'object') { var p = QA.db.perfume_overrides.filter(function (o) { return o.slug === x.target_slug; })[0] || {}; precios.push({ slug: x.target_slug, name: p.name || x.target_slug, tipo: k.toLowerCase(), old: Number(String(c.old || '').replace(/\D/g, '')) || null, new: Number(String(c.new || '').replace(/\D/g, '')) || null, precio_lista: null, ts: x.created_at }); } }); });
      var cli = QA.db.clientes.filter(porDia).map(function (c) { return { nombre: c.nombre, telefono: c.telefono, ts: c.created_at }; });
      var pts = {}; QA.db.puntos_log.filter(porDia).forEach(function (l) { var c = QA.db.clientes.filter(function (x) { return x.id === l.cliente_id; })[0]; if (c) { var s = pts[c.id] = pts[c.id] || { nombre: c.nombre, telefono: c.telefono, total: 0 }; s.total += l.delta; } });
      var puntos = Object.keys(pts).map(function (k) { return pts[k]; }).filter(function (x) { return x.total !== 0; });
      var stock = neto('stock_update', 'stock_qty'), dep = neto('deposito_update', 'stock_deposito');
      var partes = ['📊 Resumen del día · ' + dia];
      if (stock.length) partes.push('📦 STOCK · ' + stock.length + '\n' + stock.map(function (x) { return (x.delta > 0 ? '🔺 ' : '🔻 ') + x.name.toUpperCase() + ' (' + (x.delta > 0 ? '+' : '') + x.delta + ')'; }).join('\n'));
      if (dep.length) partes.push('🏬 DEPÓSITO · ' + dep.length);
      if (precios.length) partes.push('💰 PRECIOS · ' + precios.length);
      if (cli.length) partes.push('👤 CLIENTES NUEVOS · ' + cli.length);
      if (puntos.length) partes.push('⭐ PUNTOS · ' + puntos.length);
      if (partes.length === 1) partes.push(dia === hoy ? 'Sin movimientos hoy. 😴' : 'Sin movimientos ese día. 😴');
      return { data: { dia: dia, es_hoy: dia === hoy, ahora: new Date().toTimeString().slice(0, 5), fecha_texto: dia, stock: stock, deposito: dep, precios: precios, clientes: cli, puntos: puntos, texto: partes.join('\n\n') }, error: null };
    },
    stock_mover: function (a) {
      var n = noAut(); if (n) return n;
      if (!a.p_id || !a.p_slug || ['local', 'deposito'].indexOf(a.p_lugar) === -1 || a.p_delta == null || Math.abs(a.p_delta) > 999 || (a.p_delta === 0 && a.p_pausado == null)) return { data: null, error: err('22023', 'Movimiento inválido') };
      var ya = QA.db.stock_movimientos.filter(function (x) { return x.id === a.p_id; })[0]; if (ya) { var r0 = clone(ya.resultado); r0.ya_estaba = true; return { data: r0, error: null }; }
      var ov = QA.db.perfume_overrides.filter(function (o) { return o.slug === a.p_slug; })[0], sinc = a.p_estricto === false, res, parcial = false;
      if (!ov && (a.p_delta > 0 || a.p_pausado != null)) { ov = { slug: a.p_slug, stock_qty: null, stock_status: 'ok', stock_deposito: 0 }; QA.db.perfume_overrides.push(ov); }
      var qty = ov ? ov.stock_qty : null, st = ov ? (ov.stock_status || 'ok') : 'ok', dep = ov ? (ov.stock_deposito || 0) : 0, ne, ns, nd, movido = 0, origen = a.p_origen || 'panel';
      var extra = sinc ? { sin_conexion: true, anotado_en: a.p_anotado_en } : {};
      if (a.p_lugar === 'local') {
        if (!ov || (qty == null && a.p_delta < 0)) res = { ok: false, motivo: 'sin_dato', local: { prev: qty } };
        else {
          ne = (qty || 0) + a.p_delta;
          if (ne < 0 || ne > 999) { if (!sinc) return { data: { ok: false, motivo: ne < 0 ? 'no_alcanza' : 'tope', local: { prev: qty, status_prev: st } }, error: null }; ne = Math.max(0, Math.min(999, ne)); parcial = true; }
          ns = a.p_pausado === true ? 'pausado' : (a.p_pausado === false ? estadoStock(ne, null) : estadoStock(ne, st));
          ov.stock_qty = ne; ov.stock_status = ns;
          logAccion('stock_update', a.p_slug, Object.assign({ stock_status: { old: st, new: ns }, stock_qty: { old: qty, new: ne }, origen: origen }, extra));
          res = { ok: true, parcial: parcial, aplicado: ne - (qty || 0), local: { prev: qty, new: ne, status_prev: st, status_new: ns } };
        }
      } else {
        if (!ov) res = { ok: false, motivo: 'sin_dato', deposito: { prev: 0 } };
        else {
          nd = dep + a.p_delta;
          if (nd < 0 || nd > 999) { if (!sinc) return { data: { ok: false, motivo: nd < 0 ? 'no_alcanza' : 'tope', deposito: { prev: dep } }, error: null }; nd = Math.max(0, Math.min(999, nd)); parcial = true; }
          movido = a.p_pasan ? Math.max(dep - nd, 0) : 0;
          if (movido > 0) { ne = (qty || 0) + movido; if (ne > 999) { if (!sinc) return { data: { ok: false, motivo: 'tope_local', deposito: { prev: dep }, local: { prev: qty, status_prev: st } }, error: null }; ne = 999; parcial = true; } ns = estadoStock(ne, st); ov.stock_deposito = nd; ov.stock_qty = ne; ov.stock_status = ns; }
          else ov.stock_deposito = nd;
          logAccion('deposito_update', a.p_slug, Object.assign({ stock_deposito: { old: dep, new: nd }, origen: origen }, extra));
          if (movido > 0) logAccion('stock_update', a.p_slug, Object.assign({ stock_status: { old: st, new: ns }, stock_qty: { old: qty, new: ne }, origen: origen }, extra));
          res = { ok: true, parcial: parcial, aplicado: nd - dep, deposito: { prev: dep, new: nd }, local: movido > 0 ? { prev: qty, new: ne, status_prev: st, status_new: ns } : null };
        }
      }
      if (res.ok || sinc) QA.db.stock_movimientos.push({ id: a.p_id, slug: a.p_slug, lugar: a.p_lugar, delta: a.p_delta, resultado: clone(res), creado_por: email() });
      return { data: res, error: null };
    },
    caja_cerrar_dia: function (a) {
      var n = noAut(); if (n) return n;
      var dia = a.p_dia, aplicar = !!a.p_aplicar;
      if (!dia || dia > hoyART()) return { data: null, error: err('22023', 'Día inválido: no se puede cerrar un día que todavía no pasó') };
      var pend = {}, senas = 0, yab = 0, filas = QA.db.caja_movimientos.filter(function (x) { return x.dia === dia && !x.anulado_en && x.tipo === 'venta'; }).sort(function (x, y) { return x.creado_en < y.creado_en ? -1 : 1; });
      var pendiente = function (it) { return it.slug && (Number(it.qty) || 0) > 0 && it.llevar !== false && !it.ya_bajado && !it.cierre; };
      filas.forEach(function (fl) { fl.items.forEach(function (it) { if (pendiente(it)) { var p = pend[it.slug] = pend[it.slug] || { pedido: 0, nombre: it.nombre || it.slug }; p.pedido += Number(it.qty); } else if (it.slug && !it.cierre) { if (it.llevar === false) senas++; else if (it.ya_bajado) yab++; } }); });
      var plan = [], disp = {}, estado = {};
      Object.keys(pend).sort().forEach(function (slug) {
        var ov = QA.db.perfume_overrides.filter(function (o) { return o.slug === slug; })[0], qty = pend[slug].pedido, prev = ov ? ov.stock_qty : null, pst = ov ? (ov.stock_status || 'ok') : null, bajar = 0, est, motivo = null;
        if (!ov) { est = 'sin_dato'; motivo = 'el perfume no tiene fila de stock'; } else if (prev == null) { est = 'sin_dato'; motivo = 'no hay cantidad cargada en el local'; } else if (prev <= 0) { est = 'sin_stock'; motivo = 'el panel dice que no hay en el local'; }
        else { bajar = Math.min(prev, qty); est = bajar === qty ? 'bajado' : 'parcial'; if (bajar < qty) motivo = 'el panel tenía menos de lo que se vendió'; }
        var nuevo = bajar > 0 ? prev - bajar : prev, nst = bajar > 0 ? estadoStock(nuevo, pst) : pst;
        if (aplicar && bajar > 0) { ov.stock_qty = nuevo; ov.stock_status = nst; logAccion('stock_update', slug, { stock_status: { old: pst, new: nst }, stock_qty: { old: prev, new: nuevo }, origen: 'hoja_cierre', dia: dia }); }
        disp[slug] = bajar; estado[slug] = est;
        plan.push({ slug: slug, nombre: pend[slug].nombre, pedido: qty, bajar: bajar, estado: est, motivo: motivo, prev: prev, new: nuevo, status_prev: pst, status_new: nst });
      });
      var cuenta = 0;
      if (aplicar && plan.length) {
        filas.forEach(function (fl) { var cambio = false; fl.items.forEach(function (it) { if (pendiente(it)) { var take = Math.min(Number(it.qty), disp[it.slug] || 0); disp[it.slug] = (disp[it.slug] || 0) - take; it.descontado = take > 0; it.cierre = { en: iso(Date.now()), por: email(), bajo: take, de: Number(it.qty), estado: take === Number(it.qty) ? 'bajado' : (take > 0 ? 'parcial' : (estado[it.slug] || 'sin_dato')) }; cambio = true; } }); if (cambio) cuenta++; });
        logAccion('hoja_cierre', null, { dia: dia, renglones: cuenta, perfumes: plan });
      }
      return { data: { dia: dia, aplicado: aplicar, plan: plan, renglones: cuenta, senas: senas, ya_bajados: yab }, error: null };
    },
    caja_tachar: function (a) {
      var n = noAut(); if (n) return n;
      var fl = QA.db.caja_movimientos.filter(function (x) { return x.id === a.p_id; })[0];
      if (!fl) return { data: { ok: false, motivo: 'no_existe' }, error: null };
      if (fl.anulado_en) return { data: { ok: false, motivo: 'ya_tachado' }, error: null };
      var dev = [], sin = [];
      fl.items.forEach(function (it) {
        var bajo = it.cierre && it.cierre.bajo || 0;
        if (bajo > 0 && !it.cierre.devuelto) {
          var ov = QA.db.perfume_overrides.filter(function (o) { return o.slug === it.slug; })[0];
          if (ov && ov.stock_qty != null) { var prev = ov.stock_qty, pst = ov.stock_status || 'ok', nw = prev + bajo, nst = estadoStock(nw, pst); ov.stock_qty = nw; ov.stock_status = nst; logAccion('stock_update', it.slug, { stock_status: { old: pst, new: nst }, stock_qty: { old: prev, new: nw }, origen: 'hoja_tachar', dia: fl.dia }); it.cierre.devuelto = true; dev.push({ slug: it.slug, nombre: it.nombre, bajo: bajo, prev: prev, new: nw, status_prev: pst, status_new: nst }); }
          else sin.push({ slug: it.slug, nombre: it.nombre, bajo: bajo });
        }
      });
      if (fl.salda_a) { var d = QA.db.caja_movimientos.filter(function (x) { return x.id === fl.salda_a; })[0]; if (d) { d.debe = Number(d.debe) + Number(fl.efectivo) + Number(fl.mp) + Number(fl.posnet); d.saldado_en = null; d.saldado_por = null; } }
      fl.anulado_en = iso(Date.now()); fl.anulado_por = email();
      QA.ventasAnula(fl.id, fl.anulado_en);
      logAccion('hoja_tachar', null, { id: fl.id, dia: fl.dia, detalle: fl.detalle, devueltos: dev, sin_devolver: sin });
      return { data: { ok: true, devueltos: dev, sin_devolver: sin }, error: null };
    },
    caja_destachar: function (a) {
      var n = noAut(); if (n) return n;
      var fl = QA.db.caja_movimientos.filter(function (x) { return x.id === a.p_id; })[0];
      if (!fl) return { data: { ok: false, motivo: 'no_existe' }, error: null };
      if (!fl.anulado_en) return { data: { ok: false, motivo: 'no_tachado' }, error: null };
      if (fl.anulado_por !== email()) return { data: { ok: false, motivo: 'otra_persona' }, error: null };
      if (Date.parse(fl.anulado_en) < Date.now() - 600000) return { data: { ok: false, motivo: 'vencido' }, error: null };
      var d = null, cobro = Number(fl.efectivo) + Number(fl.mp) + Number(fl.posnet);
      if (fl.salda_a) { d = QA.db.caja_movimientos.filter(function (x) { return x.id === fl.salda_a; })[0]; if (!d || d.anulado_en || Number(d.debe) < cobro) return { data: { ok: false, motivo: 'deuda_cambio' }, error: null }; }
      var baj = [], sin = [];
      fl.items.forEach(function (it) {
        if (it.cierre && it.cierre.bajo > 0 && it.cierre.devuelto) {
          var ov = QA.db.perfume_overrides.filter(function (o) { return o.slug === it.slug; })[0];
          if (ov && ov.stock_qty != null) { var prev = ov.stock_qty, pst = ov.stock_status || 'ok', q = Math.min(it.cierre.bajo, Math.max(prev, 0)), nw = prev - q, nst = estadoStock(nw, pst); ov.stock_qty = nw; ov.stock_status = nst; logAccion('stock_update', it.slug, { stock_status: { old: pst, new: nst }, stock_qty: { old: prev, new: nw }, origen: 'hoja_destachar', dia: fl.dia }); baj.push({ slug: it.slug, nombre: it.nombre, baja: q }); }
          else sin.push({ slug: it.slug, nombre: it.nombre, baja: it.cierre.bajo });
          it.cierre.devuelto = false;
        }
      });
      fl.anulado_en = null; fl.anulado_por = null; QA.ventasAnula(fl.id, null);
      var cierra = false; if (d) { d.debe = Number(d.debe) - cobro; cierra = d.debe === 0; d.saldado_en = cierra ? iso(Date.now()) : null; d.saldado_por = cierra ? email() : null; }
      logAccion('hoja_destachar', null, { id: fl.id, dia: fl.dia, rebajados: baj, sin_rebajar: sin, cierra_deuda: cierra });
      return { data: { ok: true, rebajados: baj, sin_rebajar: sin, cierra_deuda: cierra }, error: null };
    },
    caja_cobrar: function (a) {
      var n = noAut(); if (n) return n;
      var ef = Number(a.p_efectivo) || 0, mp = Number(a.p_mp) || 0, po = Number(a.p_posnet) || 0, tot = ef + mp + po;
      if (ef < 0 || mp < 0 || po < 0 || tot <= 0 || tot > 99999999) return { data: null, error: err('22023', 'Monto inválido') };
      var rep = QA.db.caja_movimientos.filter(function (x) { return x.id === a.p_id && x.salda_a === a.p_deuda; })[0];
      var d = QA.db.caja_movimientos.filter(function (x) { return x.id === a.p_deuda; })[0];
      if (rep) return { data: { ok: true, repetido: true, quedan: d ? d.debe : 0 }, error: null };
      if (!d) return { data: { ok: false, motivo: 'no_existe' }, error: null };
      if (d.anulado_en) return { data: { ok: false, motivo: 'tachado' }, error: null };
      if (Number(d.debe) <= 0 || d.saldado_en) return { data: { ok: false, motivo: 'ya_saldado' }, error: null };
      if (tot > Number(d.debe)) return { data: { ok: false, motivo: 'mas_de_lo_que_debe', debe: d.debe }, error: null };
      QA.db.caja_movimientos.push(aplicarDefaults('caja_movimientos', { id: a.p_id, tipo: 'venta', detalle: ('Resto de ' + d.detalle + (d.debe_quien ? ' (' + d.debe_quien + ')' : '')).slice(0, 300), efectivo: ef, mp: mp, posnet: po, items: [], creado_por: email(), salda_a: a.p_deuda }));
      var q = Number(d.debe) - tot; d.debe = q; d.saldado_en = q === 0 ? iso(Date.now()) : null; d.saldado_por = q === 0 ? email() : null;
      logAccion('hoja_cobro', null, { deuda: a.p_deuda, detalle: d.detalle, efectivo: ef, mp: mp, posnet: po, quedan: q });
      return { data: { ok: true, quedan: q }, error: null };
    }
  };
  // la copia de la venta a la tabla `ventas` (el trigger caja_a_ventas) y la marca de anulada
  QA.triggersCaja = function (rows) {
    rows.forEach(function (fl) {
      if (fl.tipo !== 'venta' || !fl.items.length) return;
      var n = (fl.efectivo > 0) + (fl.mp > 0) + (fl.posnet > 0), medio = n > 1 ? 'mixto' : (fl.efectivo > 0 ? 'efectivo' : (fl.mp > 0 ? 'mp' : (fl.posnet > 0 ? 'posnet' : null)));
      fl.items.forEach(function (it) {
        var pu = it.tipo === 'decant' ? it.precio_unit : (it.tipo === 'libre' ? it.monto : it.precio); if (pu == null && fl.items.length === 1) pu = (fl.efectivo + fl.mp + fl.posnet + fl.debe) / (it.qty || 1);
        QA.db.ventas.push({ id: QA.db.ventas.length + 1, fecha: fl.creado_en, slug_perfume: it.slug || null, perfume_nombre: it.nombre || 'Sin nombre', marca: it.marca || null, cliente_nombre: 'Mostrador', cantidad: Math.max(1, it.qty || 1), monto_total: (pu || 0) * Math.max(1, it.qty || 1), vendedor: fl.creado_por, caja_id: fl.id, medio_pago: medio, origen: ['local', 'whatsapp', 'web'].indexOf(it.vino_por) !== -1 ? it.vino_por : 'local', tipo: it.slug ? 'frasco' : (it.tipo === 'decant' ? 'decant' : null), ml: it.tipo === 'decant' ? it.ml || null : null, precio_unit: pu || 0, anulada_en: null });
      });
    });
  };
  QA.ventasAnula = function (id, val) { QA.db.ventas.forEach(function (v) { if (v.caja_id === id) v.anulada_en = val; }); };
  var trigViejo = QA.triggers;
  QA.triggers = function (t, op, rows) { trigViejo(t, op, rows); if (t === 'caja_movimientos' && op === 'insert') QA.triggersCaja(rows); };
  QA.labFixture = function (dias) { return { dias: dias || 30, hoy: hoyART(), ventas: { filas: QA.db.ventas.length, unidades: QA.db.ventas.reduce(function (s, v) { return s + v.cantidad; }, 0), monto: QA.db.ventas.reduce(function (s, v) { return s + v.monto_total; }, 0), desde: hoyART(), dias_con_ventas: QA.db.ventas.length ? 1 : 0 }, ventas_ventana: { unidades: 0, monto: 0 }, por_semana: [], por_origen: [], por_medio: [], por_tipo: [], top_perfumes: [], ganancia: { frascos_uds: 0, con_costo_uds: 0, monto_con_costo: 0, costo_total: 0 }, eventos: { vistas: 10, wa: 2, decants: 5, busquedas_vacias: 1, primer_dia: hoyART() }, por_dia: [], embudo: [], referrer: [], dispositivo: [], wa_por_hora: [], busquedas: [] }; };

  // ── autenticación, realtime y storage ──
  var fotos = {};
  function sesion(e) { return { user: { email: e, id: 'u-' + e }, access_token: 'qa-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }; }
  function Client() {
    var self = this;
    self.auth = {
      signInWithPassword: function (c) { return new Promise(function (res, rej) { setTimeout(function () { if (QA.offline) return rej(new TypeError('Failed to fetch')); if (CLAVES[c.email] && CLAVES[c.email] === c.password) { localStorage.setItem('st-admin-auth', JSON.stringify(sesion(c.email))); res({ data: { user: { email: c.email }, session: sesion(c.email) }, error: null }); } else res({ data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400 } }); }, QA.latency || 5); }); },
      getSession: function () { return new Promise(function (res, rej) { if (QA.offline) return rej(new TypeError('Failed to fetch')); var s = null; try { s = JSON.parse(localStorage.getItem('st-admin-auth') || 'null'); } catch (e) {} res({ data: { session: s }, error: null }); }); },
      refreshSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
      signOut: function () { localStorage.removeItem('st-admin-auth'); return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    };
    self.from = function (t) { return new Q(t); };
    self.rpc = function (nombre, args) {
      return new Promise(function (res, rej) {
        setTimeout(function () {
          QA.calls.push({ rpc: nombre, email: email() });
          if (QA.offline) return rej(new TypeError('Failed to fetch'));
          if (!RPC[nombre]) return res({ data: null, error: err('PGRST202', 'Could not find the function public.' + nombre) });
          try { res(RPC[nombre](args || {})); } catch (e) { QA.errores.push(String(e && e.stack || e)); res({ data: null, error: err('XX000', 'QA fake rpc ' + nombre + ': ' + e.message) }); }
        }, QA.latency || 0);
      });
    };
    self.channel = function () { var ch = { on: function () { return ch; }, subscribe: function (cb) { setTimeout(function () { try { cb && cb('SUBSCRIBED'); } catch (e) {} }, 10); return ch; }, unsubscribe: function () { return Promise.resolve('ok'); } }; return ch; };
    self.removeChannel = function () { return Promise.resolve('ok'); };
    self.storage = { from: function () { return {
      upload: function (name, file) { try { fotos[name] = URL.createObjectURL(file); } catch (e) {} return Promise.resolve({ data: { path: name }, error: null }); },
      getPublicUrl: function (name) { return { data: { publicUrl: fotos[name] || ('https://qa.local/storage/' + name) } }; },
      remove: function () { return Promise.resolve({ data: [], error: null }); } }; } };
  }
  QA.reset();
  window.supabase = { createClient: function () { if (!QA.sembrado && typeof PERFUMES !== 'undefined') { QA.sembrado = true; QA.reset(); } return new Client(); } };
})();
