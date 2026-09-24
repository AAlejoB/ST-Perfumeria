    // ============================================================
    // SUPABASE INIT
    // ============================================================
    var SUPABASE_URL = 'https://znmjhproimtprptheumy.supabase.co';
    var SUPABASE_KEY = 'sb_publishable_Bb4Jo74f4Wh7vhzAKz8ODg_4Upk6cvb';
    var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    var currentUser = null;

    // ============================================================
    // PERF · deferTask — para diferir loaders no críticos hasta
    // que el browser esté idle (después del primer paint mobile).
    // En 4G real bajamos el tiempo a interactivo ~1-2s porque
    // dejamos de hacer 6+ queries Supabase en paralelo al inicio.
    // ============================================================
    function deferTask(fn, opts) {
      opts = opts || {};
      var run = function() { try { fn(); } catch(e) { /* swallow */ } };
      // Estrategia: esperamos a 'load' (todo el HTML ya parseado +
      // recursos críticos descargados) y después al primer idle.
      var schedule = function() {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(run, { timeout: opts.timeout || 2500 });
        } else {
          setTimeout(run, opts.delay || 50);
        }
      };
      if (document.readyState === 'complete') {
        schedule();
      } else {
        window.addEventListener('load', schedule, { once: true });
      }
    }
    function onDeferred(fn) {
      // Helper para registrar loaders no críticos:
      // - Espera a DOMContentLoaded
      // - Después espera idle/load
      document.addEventListener('DOMContentLoaded', function() { deferTask(fn); });
    }

    // ============================================================
    // ANALYTICS — tracking de clicks por perfume
    // ============================================================
    function trackClick(slug) {
      sb.from('perfume_clicks').insert({ slug: slug }).then(function(){});
    }

    // ============================================================
    // ANALYTICS EVENTS — view_product / decant_add / wa_click / search_empty
    // ============================================================
    var ANALYTICS_QUEUE = [];
    var ANALYTICS_SESSION_ID = (function(){
      try {
        var k = 'st_analytics_sid';
        var sid = localStorage.getItem(k);
        if (!sid) {
          // UUID v4 light
          sid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
          localStorage.setItem(k, sid);
        }
        return sid;
      } catch (_) {
        return 'anon-' + Math.random().toString(36).slice(2, 10);
      }
    })();
    var ANALYTICS_DEVICE = (function(){
      try {
        if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return 'mobile';
        return 'desktop';
      } catch(_) { return 'unknown'; }
    })();
    var ANALYTICS_REFERRER = (function(){
      try {
        var r = document.referrer || '';
        if (!r) return 'direct';
        var h = new URL(r).hostname;
        if (!h) return 'direct';
        if (h.indexOf('google') !== -1) return 'google';
        if (h.indexOf('instagram') !== -1) return 'instagram';
        if (h.indexOf('facebook') !== -1) return 'facebook';
        if (h.indexOf('whatsapp') !== -1 || h.indexOf('wa.me') !== -1) return 'whatsapp';
        if (h.indexOf(location.hostname) !== -1) return 'internal';
        return h;
      } catch(_) { return 'direct'; }
    })();
    function trackEvent(type, data) {
      try {
        var evt = {
          session_id: ANALYTICS_SESSION_ID,
          event_type: type,
          slug: data && data.slug ? data.slug : null,
          query: data && data.query ? data.query : null,
          meta: {
            device: ANALYTICS_DEVICE,
            referrer: ANALYTICS_REFERRER,
            hour: new Date().getHours()
          }
        };
        if (data && data.meta) {
          for (var k in data.meta) { if (data.meta.hasOwnProperty(k)) evt.meta[k] = data.meta[k]; }
        }
        ANALYTICS_QUEUE.push(evt);
        if (ANALYTICS_QUEUE.length >= 20) flushAnalytics();
      } catch(_){}
    }
    function flushAnalytics() {
      if (ANALYTICS_QUEUE.length === 0) return;
      var batch = ANALYTICS_QUEUE.splice(0, ANALYTICS_QUEUE.length);
      sb.from('analytics_events').insert(batch).then(function(res){
        if (res && res.error) {
          // Si falla, los descartamos (ya fueron sacados del queue)
          console.warn('[analytics] flush error', res.error.message);
        }
      });
    }
    // Flush cada 10s
    setInterval(flushAnalytics, 10000);
    // Flush antes de cerrar pestaña (sendBeacon para no perder eventos)
    window.addEventListener('beforeunload', function(){
      try {
        if (ANALYTICS_QUEUE.length === 0) return;
        var batch = ANALYTICS_QUEUE.splice(0, ANALYTICS_QUEUE.length);
        var body = JSON.stringify(batch);
        var url = SUPABASE_URL + '/rest/v1/analytics_events';
        if (navigator.sendBeacon) {
          var blob = new Blob([body], { type: 'application/json' });
          // sendBeacon no permite headers custom; Supabase necesita apikey en header → fallback a fetch keepalive
          fetch(url, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: body,
            keepalive: true
          }).catch(function(){});
        }
      } catch(_){}
    });
    // Flush también cuando la página se oculta (iOS Safari a veces no dispara beforeunload)
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'hidden') flushAnalytics();
    });

    // ============================================================
    // AUTH — registro con nombre + WhatsApp
    // ============================================================
    function openAuth() {
      if (currentUser) return;
      switchAuthMode('login');
      document.getElementById('authOverlay').classList.add('open');
      document.getElementById('authError').textContent = '';
      // Si está bloqueado por intentos previos, mostrar el countdown al instante
      if (renderAuthLockout()) startAuthLockoutTimer();
    }
    function closeAuth() {
      document.getElementById('authOverlay').classList.remove('open');
    }

    function cleanPhone(raw) {
      // Quitar todo menos números
      var digits = raw.replace(/[^0-9]/g, '');
      // Si empieza con 0, quitarlo (ej: 02975 -> 2975)
      if (digits.charAt(0) === '0') digits = digits.substring(1);
      // Si tiene 549 seguido de 15, quitar el 15 (formato viejo)
      digits = digits.replace(/^549(\d{2,4})15(\d+)$/, '549$1$2');
      // Si son 10 dígitos puros (número local), agregar 549
      if (digits.length === 10 && digits.substring(0, 2) !== '54') {
        digits = '549' + digits;
      }
      // Si empieza con 54 pero sin 9 (12 dígitos), insertar el 9
      else if (digits.length === 12 && digits.substring(0, 2) === '54' && digits.charAt(2) !== '9') {
        digits = '549' + digits.substring(2);
      }
      // Si NO empieza con 54, agregarlo
      else if (digits.substring(0, 2) !== '54') {
        digits = '549' + digits;
      }
      return digits;
    }

    function formatPhoneDisplay(raw) {
      var d = cleanPhone(raw);
      // Formato: +54 9 XXXX XX-XXXX
      if (d.length < 5) return '';
      var after549 = d.substring(3); // quitar "549" si tiene, o ajustar
      if (d.substring(0, 3) === '549') after549 = d.substring(3);
      else if (d.substring(0, 2) === '54') after549 = d.substring(2);
      else after549 = d;
      if (after549.length < 6) return '+' + d;
      // Intentar formato bonito
      var area = after549.substring(0, after549.length - 6);
      var rest = after549.substring(after549.length - 6);
      return '+54 9 ' + area + ' ' + rest.substring(0, 2) + '-' + rest.substring(2);
    }

    function previewPhone(inputId, previewId) {
      var raw = document.getElementById(inputId).value.trim();
      var el = document.getElementById(previewId);
      if (!raw || raw.replace(/[^0-9]/g, '').length < 6) {
        el.textContent = '';
        return;
      }
      var clean = cleanPhone(raw);
      var display = formatPhoneDisplay(raw);
      var digitCount = clean.length;
      // Argentina: 549 + 10 dígitos = 13 total
      if (digitCount === 13) {
        el.innerHTML = '📱 ' + display + ' <span style="color:#27ae60">✓</span>';
      } else if (digitCount > 13) {
        el.innerHTML = '⚠️ ' + display + ' <span style="color:#e74c3c">(demasiados dígitos)</span>';
      } else {
        el.innerHTML = '📱 ' + display + ' <span style="color:#999">(' + (13 - digitCount) + ' dígitos faltan)</span>';
      }
    }

    function checkPhoneMatch(id1, id2, matchId) {
      var p1 = cleanPhone(document.getElementById(id1).value.trim() || '');
      var p2 = cleanPhone(document.getElementById(id2).value.trim() || '');
      var el = document.getElementById(matchId);
      if (!document.getElementById(id2).value.trim()) { el.textContent = ''; return; }
      if (p1 === p2) {
        el.innerHTML = '<span style="color:#27ae60">✓ Los números coinciden</span>';
      } else {
        el.innerHTML = '<span style="color:#e74c3c">✗ Los números no coinciden</span>';
      }
    }

    var authMode = 'register'; // 'register' o 'login'

    function switchAuthMode(mode) {
      authMode = mode;
      var nameEl = document.getElementById('authName');
      var passEl = document.getElementById('authPass');
      var phone2El = document.getElementById('authPhone2');
      var phone2Match = document.getElementById('authPhoneMatch');
      var phonePreview = document.getElementById('authPhonePreview');
      var titleEl = document.getElementById('authTitle');
      var subEl = document.getElementById('authSubtitle');
      var btnEl = document.getElementById('authBtn');
      var forgotEl = document.getElementById('authForgot'); // [FORGOT-PASS-A]
      // [FORGOT-PASS-A] reset de elementos que requestPasswordReset oculta tras el éxito
      var phoneElReset = document.getElementById('authPhone');
      if (phoneElReset) phoneElReset.style.display = '';
      if (btnEl) { btnEl.style.display = ''; btnEl.disabled = false; }
      document.getElementById('authError').textContent = '';
      if (phonePreview) phonePreview.textContent = '';
      if (phone2Match) phone2Match.textContent = '';
      if (mode === 'login') {
        nameEl.style.display = 'none';
        if (phone2El) phone2El.style.display = 'none';
        passEl.style.display = '';
        passEl.placeholder = 'Tu contraseña';
        titleEl.textContent = 'Iniciá sesión';
        subEl.innerHTML = '&iquest;No ten&eacute;s cuenta? <a href="#" onclick="event.preventDefault();switchAuthMode(\'register\')" style="color:var(--amarillo)">Cre&aacute; una</a>';
        btnEl.textContent = 'Entrar';
        if (forgotEl) {
          forgotEl.innerHTML = '<a href="#" onclick="event.preventDefault();switchAuthMode(\'recover\')" style="color:#bbb;font-size:.78rem;text-decoration:underline;">¿Olvidaste tu contraseña?</a>';
          forgotEl.style.display = 'block';
        }
      } else if (mode === 'recover') {
        // [FORGOT-PASS-A] Pantalla dedicada de recuperación · solo teléfono, instrucciones claras
        nameEl.style.display = 'none';
        if (phone2El) phone2El.style.display = 'none';
        passEl.style.display = 'none';
        titleEl.textContent = 'Recuperá tu cuenta';
        subEl.innerHTML = 'No te preocupes 🌸 Escribí abajo tu número de WhatsApp (el mismo con el que te registraste) y nuestro equipo te va a contactar para ayudarte a entrar de nuevo.';
        btnEl.textContent = 'Pedir ayuda';
        if (forgotEl) forgotEl.innerHTML = '<a href="#" onclick="event.preventDefault();switchAuthMode(\'login\')" style="color:#bbb;font-size:.78rem;text-decoration:underline;">← Volver a iniciar sesión</a>';
        if (forgotEl) forgotEl.style.display = 'block';
      } else {
        nameEl.style.display = '';
        if (phone2El) phone2El.style.display = '';
        passEl.style.display = '';
        passEl.placeholder = 'Creá una contraseña (mín. 4 caracteres)';
        titleEl.textContent = 'Unite a ST';
        subEl.innerHTML = 'Guardá tus favoritos, votá el perfume del mes y recibí ofertas<br><br>¿Ya tenés cuenta? <a href="#" onclick="event.preventDefault();switchAuthMode(\'login\')" style="color:var(--amarillo)">Iniciá sesión</a>';
        btnEl.textContent = 'Unirme';
        if (forgotEl) forgotEl.style.display = 'none';
      }
    }

    // [FORGOT-PASS-A] El cliente toca "¿Olvidaste tu contraseña?" → crea un
    // pedido en password_reset_requests + avisa al admin por Telegram. El admin
    // verifica identidad por WhatsApp y resetea desde Admin → Pedidos pass.
    // NO revelamos si el número existe o no (privacidad): mensaje genérico siempre.
    async function requestPasswordReset() {
      var errEl = document.getElementById('authError');
      var btn = document.getElementById('authBtn');
      var rawPhone = (document.getElementById('authPhone') || {}).value || '';
      rawPhone = rawPhone.trim();
      errEl.style.color = '#e74c3c';
      if (!rawPhone || rawPhone.replace(/[^0-9]/g, '').length < 8) {
        errEl.textContent = 'Escribí tu número de WhatsApp para que podamos ayudarte';
        return;
      }
      var phone = cleanPhone(rawPhone);
      btn.disabled = true;
      btn.textContent = 'Enviando…';
      try {
        // [BCRYPT-MIGRATION] Una sola RPC: busca al cliente e inserta el pedido.
        // Antes anon leía la tabla clientes para esto; ya no puede.
        var rpcReset = await sb.rpc('cliente_reset_solicitar', { p_telefono: phone });
        if (rpcReset.error) throw rpcReset.error;
        // [TELEGRAM-ANON-ABIERTO] El aviso lo manda ahora cliente_reset_solicitar
        // del lado del servidor, con el mismo texto. El front ya no puede hacer
        // hablar al bot: anon perdio el EXECUTE sobre send_telegram.
        // Éxito: ocultar el formulario y mostrar confirmación grande y clara
        var phoneEl = document.getElementById('authPhone');
        var preview = document.getElementById('authPhonePreview');
        var forgotEl = document.getElementById('authForgot');
        if (phoneEl) phoneEl.style.display = 'none';
        if (preview) preview.textContent = '';
        btn.style.display = 'none';
        if (forgotEl) forgotEl.innerHTML = '<a href="#" onclick="event.preventDefault();switchAuthMode(\'login\')" style="color:var(--amarillo);font-size:.85rem;">Volver al inicio</a>';
        errEl.style.color = '#2ecc71';
        errEl.innerHTML = '✓ Pedido enviado. Si tu número está registrado, te escribimos por WhatsApp para que elijas una contraseña nueva. Si el local está cerrado puede ser recién mañana — no hace falta pedirlo de nuevo. 🌸';
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Pedir ayuda';
        errEl.style.color = '#e74c3c';
        errEl.textContent = 'No se pudo enviar el pedido. Probá de nuevo en un momento o escribinos por WhatsApp.';
      }
    }

    // ============================================================
    // LOCKOUT del login (cliente del catálogo)
    // 5 fallos -> 1 min, 10 -> 5 min, 15 -> 30 min
    // ============================================================
    var AUTH_LOCKOUT_KEY = 'st_auth_lockout';
    var authLockoutTimer = null;

    function getAuthLockout() {
      try { return JSON.parse(localStorage.getItem(AUTH_LOCKOUT_KEY) || '{"fails":0,"until":0}'); }
      catch(e) { return { fails: 0, until: 0 }; }
    }
    function setAuthLockout(s) { localStorage.setItem(AUTH_LOCKOUT_KEY, JSON.stringify(s)); }
    function clearAuthLockout() { localStorage.removeItem(AUTH_LOCKOUT_KEY); }
    function authTierForFails(f) {
      if (f >= 15) return 30 * 60 * 1000;
      if (f >= 10) return 5 * 60 * 1000;
      if (f >= 5)  return 1 * 60 * 1000;
      return 0;
    }
    function authFormatRemaining(ms) {
      var s = Math.ceil(ms / 1000);
      if (s >= 60) {
        var m = Math.floor(s / 60);
        var rs = s % 60;
        return m + 'm ' + (rs < 10 ? '0' : '') + rs + 's';
      }
      return s + 's';
    }
    function renderAuthLockout() {
      var st = getAuthLockout();
      var now = Date.now();
      var btn = document.getElementById('authBtn');
      var err = document.getElementById('authError');
      if (!btn || !err) return false;
      var inputs = ['authName','authPhone','authPhone2','authPass']
        .map(function(id){ return document.getElementById(id); })
        .filter(Boolean);
      if (st.until > now) {
        btn.disabled = true;
        inputs.forEach(function(i){ i.disabled = true; });
        err.textContent = 'Demasiados intentos. Esperá ' + authFormatRemaining(st.until - now);
        err.style.color = '#e74c3c';
        return true;
      }
      btn.disabled = false;
      inputs.forEach(function(i){ i.disabled = false; });
      if (authLockoutTimer) { clearInterval(authLockoutTimer); authLockoutTimer = null; }
      return false;
    }
    function startAuthLockoutTimer() {
      if (authLockoutTimer) clearInterval(authLockoutTimer);
      authLockoutTimer = setInterval(function() {
        var stillLocked = renderAuthLockout();
        if (!stillLocked && authLockoutTimer) {
          clearInterval(authLockoutTimer);
          authLockoutTimer = null;
          var err = document.getElementById('authError');
          if (err) err.textContent = '';
        }
      }, 1000);
    }

    // Suma 1 fallo al lockout. Si toca tier de cooldown, lo activa y muestra el countdown.
    function registerAuthFail(errEl) {
      var st = getAuthLockout();
      st.fails = (st.fails || 0) + 1;
      var cd = authTierForFails(st.fails);
      if (cd > 0) {
        st.until = Date.now() + cd;
        setAuthLockout(st);
        renderAuthLockout();
        startAuthLockoutTimer();
        // [TELEGRAM-ANON-ABIERTO] El aviso de bloqueo lo manda cliente_login.
        // Este contador vive en localStorage y se borra vaciandolo, asi que
        // como senal de seguridad no servia; el del servidor cuenta por
        // telefono. El bloqueo visual de aca sigue igual.
      } else {
        setAuthLockout(st);
      }
    }

    async function handleAuth() {
      // Si está bloqueado, abortar
      if (renderAuthLockout()) {
        startAuthLockoutTimer();
        return;
      }

      var name = document.getElementById('authName').value.trim();
      var rawPhone = document.getElementById('authPhone').value.trim();
      var pass = document.getElementById('authPass').value;
      var errEl = document.getElementById('authError');
      var btn = document.getElementById('authBtn');
      errEl.textContent = '';
      errEl.style.color = '#e74c3c';

      // [FORGOT-PASS-A] modo recuperación: pide SOLO el teléfono (sin contraseña)
      if (authMode === 'recover') { return requestPasswordReset(); }

      if (!rawPhone || rawPhone.replace(/[^0-9]/g, '').length < 8) { errEl.textContent = 'Poné un número de WhatsApp válido'; return; }
      var phone = cleanPhone(rawPhone);

      // Validar 13 dígitos (549 + 10)
      if (phone.length !== 13) { errEl.textContent = 'El número debe tener 10 dígitos (sin 0 ni 15). Ej: 2975416017'; return; }

      if (!pass || pass.length < 4) { errEl.textContent = 'La contraseña debe tener al menos 4 caracteres'; return; }

      // En registro: verificar que coincidan los números
      if (authMode === 'register') {
        var rawPhone2 = document.getElementById('authPhone2').value.trim();
        if (!rawPhone2) { errEl.textContent = 'Repetí tu número para confirmar'; return; }
        var phone2 = cleanPhone(rawPhone2);
        if (phone !== phone2) { errEl.textContent = 'Los números no coinciden. Revisá bien.'; return; }
      }

      btn.disabled = true;

      try {
        if (authMode === 'login') {
          // [BCRYPT-MIGRATION] El navegador ya no ve la contraseña: compara el
          // servidor. La RPC además migra el hash sola en el primer login y
          // aplica el bloqueo por intentos del lado del servidor.
          // estado: 'ok' | 'activado' | 'invalido' | 'bloqueado'
          var rpcLogin = await sb.rpc('cliente_login', { p_telefono: phone, p_pass: pass });
          if (rpcLogin.error) { errEl.textContent = 'Error de conexión'; btn.disabled = false; return; }
          var r = (rpcLogin.data && rpcLogin.data[0]) ? rpcLogin.data[0] : null;
          var estadoLogin = r ? r.estado : 'invalido';

          if (estadoLogin === 'bloqueado') {
            var minEsp = Math.max(1, Math.ceil((r.espera_seg || 900) / 60));
            errEl.textContent = 'Demasiados intentos. Esperá ' + minEsp + ' minuto' + (minEsp === 1 ? '' : 's') + ' y volvé a probar.';
            btn.disabled = false; return;
          }

          if (estadoLogin !== 'ok' && estadoLogin !== 'activado') {
            // Mensaje unificado a propósito: distinguir "no existe el número" de
            // "contraseña incorrecta" le confirma a cualquiera qué teléfonos
            // están registrados.
            registerAuthFail(errEl);
            if (errEl.textContent.indexOf('Esper') === -1) {
              var stTmp = getAuthLockout();
              var leftTmp = 5 - (stTmp.fails % 5);
              errEl.textContent = 'Teléfono o contraseña incorrectos (' + leftTmp + ' intento' + (leftTmp === 1 ? '' : 's') + ' antes del bloqueo). Si no tenés cuenta, registrate.';
            }
            btn.disabled = false; return;
          }

          clearAuthLockout(); // login exitoso resetea

          if (estadoLogin === 'activado') {
            // Cuenta creada desde admin o reseteada: la clave que acaba de
            // escribir quedó fijada, ya hasheada, del lado del servidor.
            errEl.style.color = '#2ecc71';
            errEl.textContent = '\u2713 \u00a1Listo! Tu contrase\u00f1a nueva qued\u00f3 guardada: es la que acab\u00e1s de escribir. Anotala para la pr\u00f3xima.';
            setTimeout(function() {
              onLogin({ id: r.id, nombre: r.nombre, telefono: r.telefono });
              closeAuth();
            }, 1200);
            return;
          }

          onLogin({ id: r.id, nombre: r.nombre, telefono: r.telefono });
          closeAuth();
        } else {
          // Register
          if (!name || name.length < 2) { errEl.textContent = 'Poné tu nombre completo'; btn.disabled = false; return; }
          // [BCRYPT-MIGRATION] Chequeo de duplicado + alta en una sola RPC.
          // La contraseña se guarda hasheada desde el primer segundo.
          var rpcReg = await sb.rpc('cliente_registrar', { p_nombre: name, p_telefono: phone, p_pass: pass });
          if (rpcReg.error) { errEl.textContent = 'Error de conexión'; btn.disabled = false; return; }
          var rr = (rpcReg.data && rpcReg.data[0]) ? rpcReg.data[0] : null;
          if (rr && rr.estado === 'duplicado') {
            errEl.innerHTML = 'Este número ya está registrado. <a href="#" onclick="event.preventDefault();switchAuthMode(\'login\')" style="color:var(--amarillo)">Iniciá sesión</a>';
            btn.disabled = false; return;
          }
          if (!rr || rr.estado !== 'ok') {
            errEl.textContent = 'Revisá los datos e intentá de nuevo';
            btn.disabled = false; return;
          }
          closeAuth();
          onLogin({ id: rr.id, nombre: rr.nombre, telefono: rr.telefono });
        }
      } catch(e) { errEl.textContent = 'Error de conexión'; }
      btn.disabled = false;
    }

    // Editar perfil
    function openEditProfile() {
      if (!currentUser) return;
      document.getElementById('editName').value = currentUser.nombre || '';
      document.getElementById('editPhone').value = currentUser.telefono || '';
      document.getElementById('editConfirmPass').value = '';
      document.getElementById('editProfileError').textContent = '';
      document.getElementById('editProfileOverlay').classList.add('open');
    }
    function closeEditProfile() {
      document.getElementById('editProfileOverlay').classList.remove('open');
    }

    async function saveEditProfile() {
      var newName = document.getElementById('editName').value.trim();
      var newRawPhone = document.getElementById('editPhone').value.trim();
      var confirmPass = document.getElementById('editConfirmPass').value;
      var errEl = document.getElementById('editProfileError');
      var btn = document.getElementById('editProfileBtn');
      errEl.textContent = '';
      errEl.style.color = '#e74c3c';

      if (!newName || newName.length < 2) { errEl.textContent = 'Poné tu nombre completo'; return; }
      if (!newRawPhone || newRawPhone.replace(/[^0-9]/g, '').length < 8) { errEl.textContent = 'Poné un número válido'; return; }
      var newPhone = cleanPhone(newRawPhone);
      if (newPhone.length !== 13) { errEl.textContent = 'El número debe tener 10 dígitos (sin 0 ni 15). Ej: 2975416017'; return; }
      if (!confirmPass || confirmPass.length < 4) { errEl.textContent = 'Ingresá tu contraseña para confirmar'; return; }

      btn.disabled = true;

      try {
        // [BCRYPT-MIGRATION] Verificar y guardar en una sola RPC, del lado del
        // servidor. Antes el update corría como anon SIN pedir contraseña: con
        // la anon key y un id se le podía cambiar nombre y teléfono a cualquiera.
        var rpcEd = await sb.rpc('cliente_editar', {
          p_id: currentUser.id, p_pass: confirmPass, p_nombre: newName, p_telefono: newPhone
        });
        if (rpcEd.error) { errEl.textContent = 'Error de conexión'; btn.disabled = false; return; }
        var estadoEd = (rpcEd.data && rpcEd.data[0]) ? rpcEd.data[0].estado : 'invalido';
        if (estadoEd === 'pass_incorrecta') {
          errEl.textContent = 'Contraseña incorrecta';
          btn.disabled = false; return;
        }
        if (estadoEd === 'duplicado') {
          errEl.textContent = 'Ese número ya está en uso por otra cuenta';
          btn.disabled = false; return;
        }
        if (estadoEd !== 'ok') {
          errEl.textContent = 'Revisá los datos e intentá de nuevo';
          btn.disabled = false; return;
        }

        // Actualizar sesión local
        currentUser.nombre = newName;
        currentUser.telefono = newPhone;
        localStorage.setItem('st_cliente', JSON.stringify(currentUser));
        updateAuthUI();

        // [TELEGRAM-ANON-ABIERTO] El aviso con el antes/despues lo arma
        // cliente_editar, que tiene los valores viejos en v_cli.

        closeEditProfile();
        errEl.style.color = '#27ae60';
        // Mostrar confirmación breve
        alert('✅ Perfil actualizado correctamente');
      } catch(e) { errEl.textContent = 'Error de conexión'; }
      btn.disabled = false;
    }

    function onLogin(user) {
      currentUser = user;
      localStorage.setItem('st_cliente', JSON.stringify(user));
      updateAuthUI();
      var bi = document.getElementById('boardInput');
      if (bi) bi.placeholder = 'Ej: El 9 AM me dura todo el día, increíble...';
      loadFavsFromSupabase();
      syncWaitlistFromDB();
      unlockVoting();
      setTimeout(initMiSeleccion, 500);
    }

    function onLogout() {
      currentUser = null;
      localStorage.removeItem('st_cliente');
      // [ESPERA-SEGURA] La lista de espera es de ESTE cliente: no queda en el dispositivo al salir.
      localStorage.removeItem('st_waitlist');
      waitlistSlugs = [];
      favs = JSON.parse(localStorage.getItem('st_favs') || '[]');
      updateAuthUI();
      var bi = document.getElementById('boardInput');
      if (bi) bi.placeholder = 'Iniciá sesión para dejar tu opinión...';
      lockVoting();
      initMiSeleccion();
      renderCatalog();
    }

    function logout() {
      onLogout();
    }

    function updateAuthUI() {
      var regBtn = document.querySelector('.nav-register-btn');
      var drawerAuth = document.getElementById('drawerAuth');
      var drawerLogout = document.getElementById('drawerLogout');
      var navLogoutBtn = document.getElementById('navLogoutBtn');
      if (!regBtn) return;
      // Exponer el estado de auth a CSS para poder pintar distinto a los
      // guests (p.ej. candado en el boton "Avisame cuando vuelva") sin
      // tener que re-renderizar cards cuando alguien logea/desloga.
      document.body.classList.toggle('is-guest', !currentUser);
      if (currentUser) {
        var _firstName = String(currentUser.nombre || '').trim().split(/\s+/)[0] || 'Vos';
        regBtn.innerHTML = '<span class="auth-user-bar"><svg class="auth-user-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><strong>' + _firstName + '</strong></span>';
        regBtn.setAttribute('onclick', 'event.preventDefault();openEditProfile()');
        regBtn.setAttribute('title', 'Editar perfil');
        if (drawerAuth) { drawerAuth.textContent = '\u270f\ufe0f Editar perfil'; drawerAuth.setAttribute('onclick', 'event.preventDefault();toggleDrawer();openEditProfile()'); }
        if (drawerLogout) drawerLogout.style.display = '';
        // Mostrar el boton "Cerrar sesion" en la nav-bar (antes solo estaba
        // en el drawer hamburguesa, no muy visible). Asi queda a un click.
        if (navLogoutBtn) navLogoutBtn.style.display = '';
      } else {
        regBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>Iniciar sesi\u00f3n';
        regBtn.setAttribute('onclick', 'event.preventDefault();openAuth()');
        regBtn.setAttribute('title', 'Iniciar sesi\u00f3n');
        if (drawerAuth) { drawerAuth.textContent = 'Iniciar sesi\u00f3n'; drawerAuth.setAttribute('onclick', 'event.preventDefault();toggleDrawer();openAuth()'); }
        if (drawerLogout) drawerLogout.style.display = 'none';
        if (navLogoutBtn) navLogoutBtn.style.display = 'none';
      }
      // Re-render del banner contextual de puntos (puede haber cambiado el cliente)
      if (typeof renderPuntosBanner === 'function') setTimeout(renderPuntosBanner, 200);
    }

    // Check session on load (localStorage)
    (function() {
      var saved = localStorage.getItem('st_cliente');
      if (saved) {
        try { onLogin(JSON.parse(saved)); } catch(e) {}
      }
    })();

    // ============================================================
    // BOARD — opiniones (Supabase)
    // ============================================================
    var boardMsgs = [];

    async function initBoard() {
      var res = await sb.from('opiniones').select('texto, created_at').order('created_at', { ascending: false }).limit(10);
      if (res.data) {
        boardMsgs = res.data.map(function(o) { return { text: o.texto }; });
      }
      renderBoardMsgs();
    }

    async function sendBoardMsg() {
      if (!currentUser) { openAuth(); return; }
      var input = document.getElementById('boardInput');
      var text = input.value.trim();
      if (!text) return;
      var btn = document.getElementById('boardSend');
      btn.disabled = true;
      var res = await sb.from('opiniones').insert({ texto: text });
      if (!res.error) {
        boardMsgs.unshift({ text: text });
        input.value = '';
        renderBoardMsgs();
      }
      btn.disabled = false;
    }

    function renderBoardMsgs() {
      var container = document.getElementById('boardMessages');
      if (!container) return;
      container.innerHTML = boardMsgs.slice(0, 5).map(function(m) {
        return '<div class="board-msg">' + m.text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
      }).join('');
    }

    document.addEventListener('DOMContentLoaded', initBoard);

    // ============================================================
    // QUIZ — Encontrá tu perfume
    // ============================================================
    var quizAnswers = {};

    function quizAnswer(step, value) {
      quizAnswers[step] = value;

      // Marcar botón seleccionado
      var stepEl = document.querySelector('.quiz-step[data-step="'+step+'"]');
      stepEl.querySelectorAll('.quiz-opt').forEach(function(b){ b.classList.remove('selected'); });
      event.target.classList.add('selected');

      // Avanzar después de un breve delay
      setTimeout(function() {
        // Actualizar dots
        var dots = document.querySelectorAll('.quiz-dot');
        if (step < 4) {
          dots[step].classList.add('filled');
          stepEl.classList.remove('active');
          document.querySelector('.quiz-step[data-step="'+(step+1)+'"]').classList.add('active');
        } else {
          // Última pregunta — mostrar resultados
          stepEl.classList.remove('active');
          showQuizResults();
        }
      }, 300);
    }

    function showQuizResults() {
      var gender = quizAnswers[1];
      var occasion = quizAnswers[2];
      var aroma = quizAnswers[3];
      var intensity = quizAnswers[4];

      // Notas asociadas a cada tipo de aroma
      var aromaNotas = {
        dulce: ['vainilla','caramelo','chocolate','cacao','miel','praline','frutilla','cereza','frambuesa','canela','haba tonka'],
        fresco: ['bergamota','limón','pomelo','mandarina','menta','lavanda','notas acuáticas','notas verdes','ananá','pepino'],
        amaderado: ['cedro','sándalo','oud','vetiver','pachulí','ciprés','pino','madera','maderas secas','amberwood'],
        especiado: ['cardamomo','canela','pimienta negra','pimienta rosa','jengibre','azafrán','clavo','nuez moscada','incienso']
      };

      // Perfiles según ocasión
      var occasionProfiles = {
        diario: ['Versátil','Fresco'],
        noche: ['Intenso','Dulce'],
        oficina: ['Versátil','Fresco'],
        cita: ['Intenso','Dulce','Versátil']
      };

      var targetNotas = aromaNotas[aroma] || [];
      var targetProfiles = occasionProfiles[occasion] || ['Versátil'];

      // Puntuar cada perfume
      var scored = PERFUMES.filter(function(p) {
        if (p.esSet || p._oculto || p._pausado) return false;
        if (gender !== 'any') {
          var catMatch = p.cat === gender || p.cat === 'Unisex' || p.cat.indexOf(gender) !== -1;
          if (!catMatch) return false;
        }
        return true;
      }).map(function(p) {
        var score = 0;
        var allNotas = [p.notas_salida||'', p.notas_corazon||'', p.notas_base||''].join(',').toLowerCase();

        // Puntos por notas coincidentes
        targetNotas.forEach(function(n) {
          if (allNotas.indexOf(n) !== -1) score += 3;
        });

        // Puntos por perfil
        if (targetProfiles.indexOf(p.perfil) !== -1) score += 2;

        // Bonus por intensidad
        if (intensity === 'potente' && p.perfil === 'Intenso') score += 2;
        if (intensity === 'suave' && (p.perfil === 'Fresco' || p.perfil === 'Versátil')) score += 1;
        if (intensity === 'moderado' && p.perfil === 'Versátil') score += 1;

        // Bonus si tiene foto (mejor experiencia visual)
        if (p.foto) score += 1;

        return { perfume: p, score: score };
      });

      // Ordenar por puntaje y tomar top 3
      scored.sort(function(a,b) { return b.score - a.score; });
      var top3 = scored.slice(0,3);

      var resultsEl = document.getElementById('quizResults');
      var html = '<p class="quiz-question" style="margin-bottom:.5rem">&#128142; Tus 3 recomendaciones:</p>';

      top3.forEach(function(item) {
        var p = item.perfume;
        var imgHtml = p.foto
          ? '<img class="quiz-result-img" src="'+p.foto+'" alt="'+p.name+'" loading="lazy" decoding="async">'
          : '<div class="quiz-result-img" style="display:flex;align-items:center;justify-content:center;color:#666;font-size:.6rem">Sin foto</div>';
        var notasPreview = (p.notas_salida || p.notas_corazon || p.notas_base || '').split(',').slice(0,3).join(', ');

        html += '<div class="quiz-result-card">'
          + imgHtml
          + '<div class="quiz-result-info">'
          + '<p class="quiz-result-name">'+p.name+'</p>'
          + '<p class="quiz-result-marca">'+p.marca+'</p>'
          + (notasPreview ? '<p class="quiz-result-notas">'+notasPreview+'</p>' : '')
          + '<button class="quiz-result-cta" onclick="openBottomSheet(\'' + p.slug + '\')">Ver el perfume &#8594;</button>'
          + '</div></div>';
      });

      html += '<button class="quiz-restart" onclick="restartQuiz()">Volver a empezar</button>';
      resultsEl.innerHTML = html;
      resultsEl.classList.add('active');
      document.getElementById('quizProgress').style.display = 'none';
    }

    // scrollToPerfume del quiz — eliminada, se usa la versión unificada más abajo

    function restartQuiz() {
      quizAnswers = {};
      document.getElementById('quizResults').classList.remove('active');
      document.getElementById('quizResults').innerHTML = '';
      document.getElementById('quizProgress').style.display = 'flex';
      document.querySelectorAll('.quiz-dot').forEach(function(d,i){ d.classList.toggle('filled', i===0); });
      document.querySelectorAll('.quiz-step').forEach(function(s){ s.classList.remove('active'); });
      document.querySelector('.quiz-step[data-step="1"]').classList.add('active');
      document.querySelectorAll('.quiz-opt').forEach(function(b){ b.classList.remove('selected'); });
    }

    // ============================================================
    // ENCUESTA CULTURA — localStorage (se mantiene local)
    // ============================================================
    var pollVotes = JSON.parse(localStorage.getItem('st_poll') || '{"Cercano":0,"Divertido":0,"Especializado":0,"Diferente":0,"Enfocado":0}');
    var pollVoted = localStorage.getItem('st_poll_voted') || '';

    function votePoll(btn, word) {
      if (pollVoted) return;
      pollVoted = word;
      pollVotes[word] = (pollVotes[word] || 0) + 1;
      localStorage.setItem('st_poll', JSON.stringify(pollVotes));
      localStorage.setItem('st_poll_voted', word);
      showPollResults(word);
    }

    function showPollResults(voted) {
      var total = 0;
      for (var k in pollVotes) total += pollVotes[k];
      if (total === 0) total = 1;
      var btns = document.querySelectorAll('.poll-opt');
      btns.forEach(function(b) {
        var word = b.getAttribute('onclick').match(/'([^']+)'\)/)[1];
        var pct = Math.round((pollVotes[word] || 0) / total * 100);
        b.classList.add('showed');
        if (word === voted) b.classList.add('voted');
        b.innerHTML = '<span class="poll-bar" style="width:' + pct + '%"></span>'
          + '<span class="poll-label">' + word + '</span>'
          + '<span class="poll-pct">' + pct + '%</span>';
      });
      document.getElementById('pollResult').textContent = total + ' voto' + (total !== 1 ? 's' : '') + ' \u00b7 \u00a1Gracias por participar!';
    }

    document.addEventListener('DOMContentLoaded', function() {
      if (pollVoted) showPollResults(pollVoted);
    });

    // ============================================================
    // HOME TOP BANNER — texto B/N de pagos editable desde admin
    // Tabla Supabase: home_top_banner (id, texto, activo, modo_marquee).
    // Si la tabla está vacía o falla, se muestra texto fallback.
    // ============================================================
    var HOME_TOP_BANNER_FALLBACK = '3 CUOTAS SIN INTERÉS · ACEPTAMOS TODOS LOS MEDIOS DE PAGO';

    // Carrusel del banner B/N: si hay varios mensajes activos en
    // home_top_banner, rotamos cada 4.5 seg con fade. Si hay solo 1,
    // se muestra estático (con marquee si desborda como antes).
    var HOME_BANNER_CYCLE = {
      messages: [],   // [{texto, marquee}, ...]
      idx: 0,
      timer: null
    };

    function applyBannerMarqueeIfNeeded(wrap, textEl, marquee) {
      // En mobile (<768px) SIEMPRE marquee — da más vida al banner B/N
      // y evita el bug del auto-detect que a veces no disparaba porque
      // el clientWidth medía mal con flex+nowrap.
      var isMobile = window.matchMedia('(max-width: 767px)').matches;
      if (marquee || isMobile) {
        wrap.classList.add('is-marquee');
        return;
      }
      wrap.classList.remove('is-marquee');
      requestAnimationFrame(function() {
        try {
          var trackW = wrap.querySelector('.home-top-banner-track').clientWidth;
          var textW = textEl.scrollWidth;
          if (textW > trackW - 16) wrap.classList.add('is-marquee');
        } catch(e){}
      });
    }

    function showBannerMessage(idx) {
      var wrap = document.getElementById('topPaymentBanner');
      var textEl = document.getElementById('homeTopBannerText');
      if (!wrap || !textEl) return;
      var msgs = HOME_BANNER_CYCLE.messages;
      if (!msgs.length) { wrap.style.display = 'none'; return; }
      var n = msgs.length;
      var i = ((idx % n) + n) % n;
      HOME_BANNER_CYCLE.idx = i;
      var m = msgs[i];
      // Fade out → cambiar texto → fade in
      textEl.style.transition = 'opacity .35s ease';
      textEl.style.opacity = '0';
      setTimeout(function() {
        textEl.textContent = m.texto;
        applyBannerMarqueeIfNeeded(wrap, textEl, !!m.marquee);
        textEl.style.opacity = '1';
      }, 350);
    }

    function startBannerCycle() {
      stopBannerCycle();
      var msgs = HOME_BANNER_CYCLE.messages;
      if (msgs.length < 2) return; // 1 solo mensaje: no rotar
      HOME_BANNER_CYCLE.timer = setInterval(function() {
        if (document.hidden) return; // no rotar si la pestaña no está visible
        showBannerMessage(HOME_BANNER_CYCLE.idx + 1);
      }, 4500);
    }

    function stopBannerCycle() {
      if (HOME_BANNER_CYCLE.timer) {
        clearInterval(HOME_BANNER_CYCLE.timer);
        HOME_BANNER_CYCLE.timer = null;
      }
    }

    function setHomeBannerMessages(messages) {
      var wrap = document.getElementById('topPaymentBanner');
      var textEl = document.getElementById('homeTopBannerText');
      if (!wrap || !textEl) return;
      // Filtrar mensajes vacíos
      var clean = (messages || []).filter(function(m) {
        return m && String(m.texto || '').trim();
      }).map(function(m) {
        return { texto: String(m.texto).trim(), marquee: !!m.marquee };
      });
      HOME_BANNER_CYCLE.messages = clean;
      HOME_BANNER_CYCLE.idx = 0;
      stopBannerCycle();
      if (clean.length === 0) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'block';
      textEl.textContent = clean[0].texto;
      textEl.style.opacity = '1';
      applyBannerMarqueeIfNeeded(wrap, textEl, clean[0].marquee);
      startBannerCycle();
    }

    async function loadHomeTopBanner() {
      // Render inmediato del fallback (zero-flash) — solo 1 mensaje
      setHomeBannerMessages([{ texto: HOME_TOP_BANNER_FALLBACK, marquee: false }]);
      try {
        if (typeof sb === 'undefined' || !sb) return;
        var res = await sb.from('home_top_banner')
          .select('texto, activo, modo_marquee, id')
          .eq('activo', true)
          .order('id', { ascending: true });
        if (res && !res.error && res.data && res.data.length) {
          var msgs = res.data.map(function(r) {
            return { texto: r.texto, marquee: !!r.modo_marquee };
          });
          setHomeBannerMessages(msgs);
        }
        // Si la tabla está vacía o falla, queda el fallback visible.
      } catch(e) { /* tabla no existe: queda fallback */ }
    }
    // Banner top: ejecutamos loadHomeTopBanner inmediatamente para que el
    // fallback se pinte sin demora (es zero-flash); la query Supabase
    // adentro es async así que no bloquea.
    document.addEventListener('DOMContentLoaded', loadHomeTopBanner);
    // Pausar rotación cuando la pestaña no está visible
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) stopBannerCycle();
      else if (HOME_BANNER_CYCLE.messages.length > 1) startBannerCycle();
    });

    // ============================================================
    // HOME SLIDER — slides cuadrados con scroll-snap + autoplay
    // Tabla Supabase: home_slides (id, orden, media_url, media_tipo,
    // titulo, link_a, activo).
    // Si la tabla está vacía, mostramos 3 placeholders.
    // ============================================================
    var HOME_SLIDER = {
      slides: [],
      currentIdx: 0,
      autoplayTimer: null,
      paused: false
    };

    function buildSlideHTML(slide, isPlaceholder, idx) {
      if (isPlaceholder) {
        return '<div class="home-slide is-placeholder" data-idx="' + idx + '">'
          + '<p class="home-slide-title">Próximamente — Slide N°' + (idx + 1) + '</p>'
          + '</div>';
      }
      var clickable = !!(slide.link_a && slide.link_a.trim());
      var attrs = 'data-idx="' + idx + '"';
      if (clickable) attrs += ' onclick="homeSlideGo(\'' + escapeHTML(slide.link_a).replace(/'/g, "\\'") + '\')" role="button" tabindex="0"';
      var media = '';
      // Slide #0 es above-the-fold: fetchpriority alto, sin lazy.
      // Resto: lazy + decoding async para no robar ancho de banda.
      var isFirst = idx === 0;
      var imgPrio = isFirst ? ' fetchpriority="high"' : ' loading="lazy"';
      var videoPrio = isFirst ? ' preload="auto"' : ' preload="none"';
      if (slide.media_tipo === 'video') {
        media = '<video class="home-slide-media" src="' + escapeHTML(slide.media_url) + '" autoplay muted loop playsinline' + videoPrio + ' width="900" height="506"></video>';
      } else {
        media = '<img class="home-slide-img" src="' + escapeHTML(slide.media_url) + '" alt="' + escapeHTML(slide.titulo || 'Slide ' + (idx + 1)) + '"' + imgPrio + ' decoding="async" width="900" height="506"/>';
      }
      var overlay = '';
      if (slide.titulo && slide.titulo.trim()) {
        overlay = '<div class="home-slide-overlay"><p class="home-slide-title">' + escapeHTML(slide.titulo) + '</p></div>';
      }
      return '<div class="home-slide" ' + attrs + '>' + media + overlay + '</div>';
    }

    function homeSlideGo(link) {
      if (!link) return;
      if (link.charAt(0) === '#') {
        // #top o #inicio → scroll al top de la página
        if (link === '#top' || link === '#inicio') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (link.toLowerCase() === '#quizsection') { openJuegos(); return; }   // [JUEGOS-VENTANA] decisión 65
        var el = document.querySelector(link);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.location.href = link;
      }
    }
    window.homeSlideGo = homeSlideGo;

    function renderHomeSlider(slides) {
      var track = document.getElementById('homeSliderTrack');
      var dotsWrap = document.getElementById('homeSliderDots');
      if (!track || !dotsWrap) return;
      var isPlaceholder = !slides || slides.length === 0;
      // 8 placeholders cuando la tabla está vacía (antes eran 3).
      // Suficientes para que el slider se vea "lleno" mientras el admin
      // empieza a subir slides reales desde el panel.
      var list = isPlaceholder ? [{}, {}, {}, {}, {}, {}, {}, {}] : slides;
      track.innerHTML = list.map(function(s, i) { return buildSlideHTML(s, isPlaceholder, i); }).join('');
      dotsWrap.innerHTML = list.map(function(_, i) {
        return '<button class="home-slider-dot' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '" role="tab" aria-label="Slide ' + (i + 1) + '"></button>';
      }).join('');
      HOME_SLIDER.slides = list;
      HOME_SLIDER.currentIdx = 0;
      attachHomeSliderListeners();
      startHomeSliderAutoplay();
    }

    function attachHomeSliderListeners() {
      var track = document.getElementById('homeSliderTrack');
      var dotsWrap = document.getElementById('homeSliderDots');
      if (!track || !dotsWrap) return;
      // Click en dots
      dotsWrap.querySelectorAll('.home-slider-dot').forEach(function(dot) {
        dot.addEventListener('click', function() {
          var idx = parseInt(dot.getAttribute('data-idx'), 10);
          goToHomeSlide(idx);
          pauseHomeSliderTemporarily();
        });
      });
      // Detectar slide actual cuando el usuario scrollea manual
      var scrollTimer = null;
      track.addEventListener('scroll', function() {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(updateActiveDotFromScroll, 80);
      }, { passive: true });
      // Pausar autoplay en hover (desktop) y touch (mobile)
      track.addEventListener('mouseenter', function() { HOME_SLIDER.paused = true; });
      track.addEventListener('mouseleave', function() { HOME_SLIDER.paused = false; });
      track.addEventListener('touchstart', function() { pauseHomeSliderTemporarily(); }, { passive: true });
    }

    function updateActiveDotFromScroll() {
      var track = document.getElementById('homeSliderTrack');
      if (!track) return;
      var slideW = track.clientWidth;
      var idx = Math.round(track.scrollLeft / slideW);
      setActiveDot(idx);
    }

    function setActiveDot(idx) {
      HOME_SLIDER.currentIdx = idx;
      var dots = document.querySelectorAll('#homeSliderDots .home-slider-dot');
      dots.forEach(function(d, i) {
        d.classList.toggle('is-active', i === idx);
      });
    }

    function goToHomeSlide(idx) {
      var track = document.getElementById('homeSliderTrack');
      if (!track || !HOME_SLIDER.slides.length) return;
      var n = HOME_SLIDER.slides.length;
      var i = ((idx % n) + n) % n; // wrap
      track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
      setActiveDot(i);
    }

    function startHomeSliderAutoplay() {
      stopHomeSliderAutoplay();
      if (!HOME_SLIDER.slides || HOME_SLIDER.slides.length < 2) return;
      HOME_SLIDER.autoplayTimer = setInterval(function() {
        if (HOME_SLIDER.paused) return;
        if (document.hidden) return; // no avanzar si la pestaña no está visible
        goToHomeSlide(HOME_SLIDER.currentIdx + 1);
      }, 5000);
    }

    function stopHomeSliderAutoplay() {
      if (HOME_SLIDER.autoplayTimer) {
        clearInterval(HOME_SLIDER.autoplayTimer);
        HOME_SLIDER.autoplayTimer = null;
      }
    }

    function pauseHomeSliderTemporarily() {
      HOME_SLIDER.paused = true;
      setTimeout(function() { HOME_SLIDER.paused = false; }, 8000);
    }

    async function loadHomeSlides() {
      // Render inmediato de placeholders mientras la query corre
      renderHomeSlider([]);
      try {
        if (typeof sb === 'undefined' || !sb) return;
        var res = await sb.from('home_slides')
          .select('id, orden, media_url, media_tipo, titulo, link_a, activo')
          .eq('activo', true)
          .order('orden', { ascending: true });
        if (res && !res.error && res.data && res.data.length) {
          renderHomeSlider(res.data);
        }
      } catch(e) {
        // Tabla no existe: queda placeholder. Sin error visible.
      }
    }
    // Slider de la home descontinuado — el HTML del slider ya no existe
    // en index.html, así que no llamamos a loadHomeSlides() y evitamos
    // una query innecesaria a Supabase. La función queda definida por si
    // se quiere reactivar más adelante. (No-op: onDeferred(loadHomeSlides) eliminado)

    // ============================================================
    // TRUST BADGES — 4 beneficios destacados (editables desde admin)
    // Tabla Supabase: trust_badges (id, orden, icono, titulo, bajada,
    // link_a, activo). Si la consulta falla o la tabla está vacía,
    // mostramos los defaults harcodeados acá abajo.
    // ============================================================
    var TRUST_BADGES_DEFAULTS = [
      { icono: '$',  titulo: '10% OFF',       bajada: 'Pagando en efectivo o transferencia', link_a: '' },
      { icono: '★',  titulo: 'SUMÁ PUNTOS',   bajada: 'Promos para clientes registrados',    link_a: '' },
      { icono: '⌂',  titulo: 'RETIRO GRATIS', bajada: 'En tienda Comodoro Rivadavia',         link_a: '#contacto' },
      { icono: '◆',  titulo: '3 CUOTAS',      bajada: 'Sin interés con tarjeta',              link_a: '' }
    ];

    function escapeHTML(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
      });
    }

    // [CINTA-TINTA] decisión 95 · la letra de la cinta la decide su fondo, no el tema: #fff o #000, la que dé más
    // contraste con el color que eligió el jefe (anda con cualquier color nuevo). El color entra al HTML sólo si es un
    // hex (#rgb / #rrggbb) o un rgb() válido; si no, el dorado de siempre. scripts/contraste.js lee este bloque.
    var CINTA_COLOR_DEFAULT = '#E8B800';
    function rgbDeColor(v) {
      var s = String(v == null ? '' : v).trim(), m;
      if ((m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) {
        var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
        return [0, 2, 4].map(function(i) { return parseInt(h.substr(i, 2), 16); });
      }
      if ((m = s.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i))) {
        var c = [+m[1], +m[2], +m[3]];
        return (c[0] <= 255 && c[1] <= 255 && c[2] <= 255) ? c : null;
      }
      return null;
    }
    function colorCinta(v) { return rgbDeColor(v) ? String(v).trim() : CINTA_COLOR_DEFAULT; }
    function letraSobre(color) {
      var l = (rgbDeColor(color) || rgbDeColor(CINTA_COLOR_DEFAULT)).map(function(x) {
        x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      var lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
      // blanco da 1,05 / (L + 0,05); negro, (L + 0,05) / 0,05: gana el más alto
      return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? '#fff' : '#000';
    }

    function renderTrustBadges(items) {
      var grid = document.getElementById('trustBadgesGrid');
      if (!grid) return;
      var list = (items && items.length) ? items : TRUST_BADGES_DEFAULTS;
      grid.innerHTML = list.map(function(b) {
        var hasLink = b.link_a && b.link_a.trim() !== '';
        var cls = 'trust-badge-card' + (hasLink ? ' is-link' : '');
        var clickAttr = hasLink ? ' onclick="trustBadgeGo(' + JSON.stringify(b.link_a).replace(/"/g,'&quot;') + ')" role="button" tabindex="0"' : '';
        return ''
          + '<div class="' + cls + '"' + clickAttr + '>'
          +   '<span class="trust-badge-icon" aria-hidden="true">' + escapeHTML(b.icono || '◆') + '</span>'
          +   '<span class="trust-badge-title">' + escapeHTML(b.titulo || '') + '</span>'
          +   (b.bajada ? '<p class="trust-badge-desc">' + escapeHTML(b.bajada) + '</p>' : '')
          + '</div>';
      }).join('');
    }

    function trustBadgeGo(link) {
      if (!link) return;
      if (link.charAt(0) === '#') {
        if (link.toLowerCase() === '#quizsection') { openJuegos(); return; }   // [JUEGOS-VENTANA] decisión 65
        var el = document.querySelector(link);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.location.href = link;
      }
    }
    window.trustBadgeGo = trustBadgeGo;

    async function loadTrustBadges() {
      // Render inmediato del fallback para que no haya "flash" vacío
      renderTrustBadges(TRUST_BADGES_DEFAULTS);
      try {
        if (typeof sb === 'undefined' || !sb) return;
        var res = await sb.from('trust_badges')
          .select('icono, titulo, bajada, link_a, orden, activo')
          .eq('activo', true)
          .order('orden', { ascending: true });
        if (res && !res.error && res.data && res.data.length) {
          renderTrustBadges(res.data);
        }
      } catch (e) {
        // Si la tabla todavía no existe, queda el fallback. No molestamos al usuario.
      }
    }
    onDeferred(loadTrustBadges);

    // ============================================================
    // FAVORITOS — Supabase (logueado) + localStorage (fallback)
    // ============================================================
    var favs = JSON.parse(localStorage.getItem('st_favs') || '[]');

    async function loadFavsFromSupabase() {
      if (!currentUser) return;
      try {
        var res = await sb.from('favoritos').select('slug').eq('user_id', currentUser.id);
        if (res.data && res.data.length > 0) {
          favs = res.data.map(function(f) { return f.slug; });
          localStorage.setItem('st_favs', JSON.stringify(favs));
          renderCatalog();
        }
      } catch(e) {}
    }

    // saveFavs: guarda la lista de favoritos en localStorage
    // localStorage = almacenamiento del navegador que persiste
    // aunque cierres la pestaña. Se guarda como texto (JSON).
    function saveFavs() {
      localStorage.setItem('st_favs', JSON.stringify(favs));
      updateFavBadge();
    }

    // updateFavBadge: actualiza el numerito rojo en el ícono de corazón del nav
    function updateFavBadge() {
      var badge = document.getElementById('favBadge');
      if (!badge) return;
      badge.textContent = favs.length;
      // "toggle" agrega o quita la clase según si hay favs o no
      badge.classList.toggle('visible', favs.length > 0);
    }

    // toggleFav: agrega o quita un perfume de favoritos
    // Se ejecuta al tocar el corazón ♡/♥ en cada card
    async function toggleFav(btn, event) {
      event.stopPropagation();   // evita que el click "suba" al card
      event.preventDefault();    // evita comportamiento por defecto
      var card = btn.closest('.product-card');  // busca la card padre
      var slug = card.dataset.slug;             // obtiene el identificador
      var idx = favs.indexOf(slug);             // ¿ya está en favoritos?
      if (idx !== -1) {
        // YA ERA FAVORITO → lo saca
        favs.splice(idx, 1);           // eliminar del array
        btn.classList.remove('liked');  // quitar estilo rojo
        btn.innerHTML = '\u2661';      // corazón vacío ♡
        if (currentUser) {
          sb.from('favoritos').delete().eq('user_id', currentUser.id).eq('slug', slug).then(function(){});
        }
      } else {
        favs.push(slug);
        btn.classList.add('liked');
        btn.innerHTML = '\u2665';
        // \u2764\ufe0f Efecto "pop" al agregar a favoritos
        spawnHeartParticles(btn);
        btn.classList.remove('heart-pop');
        void btn.offsetWidth;  // force reflow para re-trigger animation
        btn.classList.add('heart-pop');
        if (currentUser) {
          sb.from('favoritos').insert({ user_id: currentUser.id, slug: slug }).then(function(){});
        }
      }
      saveFavs();
      if (currentFilter === 'favs') applyFilters();
    }

    // \u2764\ufe0f Spawn de part\u00edculas peque\u00f1as alrededor del coraz\u00f3n al agregar fav
    function spawnHeartParticles(btn) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var rect = btn.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      // Spawn 6 part\u00edculas dispersas
      for (var i = 0; i < 6; i++) {
        (function(angle) {
          var dot = document.createElement('span');
          dot.className = 'heart-particle';
          dot.style.left = cx + 'px';
          dot.style.top  = cy + 'px';
          var dist = 22 + Math.random() * 10;
          var tx = Math.cos(angle) * dist;
          var ty = Math.sin(angle) * dist - 8; // tirar levemente hacia arriba
          dot.style.setProperty('--tx', tx + 'px');
          dot.style.setProperty('--ty', ty + 'px');
          document.body.appendChild(dot);
          setTimeout(function() { dot.remove(); }, 700);
        })((Math.PI * 2 * i) / 6 + Math.random() * 0.4);
      }
    }

    function showFavorites(event) {
      event.preventDefault();
      currentFilter = 'favs';
      document.querySelectorAll('.filter-zone--left .filter-btn').forEach(function(b) {
        b.classList.remove('active');
      });
      var favBtn = document.getElementById('btnFavFilter');
      if (favBtn) favBtn.classList.add('active');
      applyFilters();
      scrollToCatalog();
    }

    function scrollToCatalog() {
      var target = document.querySelector('.filters-bar') || document.getElementById('catalogGrid');
      var nav = document.querySelector('nav');
      var filterBar = document.querySelector('.filter-bar');
      var navH = nav ? nav.offsetHeight : 58;
      var filterH = filterBar ? filterBar.offsetHeight : 50;
      var y = target.getBoundingClientRect().top + window.pageYOffset - navH - filterH - 8;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }

    // ============================================================
    // VOTACIÓN — carga dinámica desde Supabase + auto-cierre mensual
    // ============================================================
    var currentMes = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    var candidatosMasc = [];
    var candidatosFem = [];

    async function loadVotacionFromDB() {
      try {
        // Cargar ganador del mes anterior
        var prevDate = new Date();
        prevDate.setMonth(prevDate.getMonth() - 1);
        var prevMes = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
        var prevRes = await sb.from('votos').select('categoria, slug').eq('mes', prevMes);
        if (prevRes.data && prevRes.data.length > 0) {
          var counts = { masculino: {}, femenino: {} };
          prevRes.data.forEach(function(v) {
            if (!counts[v.categoria]) counts[v.categoria] = {};
            counts[v.categoria][v.slug] = (counts[v.categoria][v.slug] || 0) + 1;
          });
          var ganadores = [];
          var ganadoresSlugs = [];
          ['masculino', 'femenino'].forEach(function(cat) {
            var top = null, topN = 0;
            Object.keys(counts[cat] || {}).forEach(function(s) {
              if (counts[cat][s] > topN) { topN = counts[cat][s]; top = s; }
            });
            if (top) {
              ganadores.push((cat === 'masculino' ? '\ud83d\udc51 ' : '\ud83d\udc51 ') + top);
              ganadoresSlugs.push(top);
            }
          });
          // \ud83d\udc51 Marcar los slugs ganadores en PERFUMES para badge en cards
          ganadoresSlugs.forEach(function(slug) {
            var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
            if (p) p._perfumeDelMes = true;
          });
          if (ganadores.length > 0) {
            var bannerEl = document.getElementById('votoGanadorBanner');
            var textEl = document.getElementById('votoGanadorText');
            if (bannerEl) bannerEl.style.display = 'block';
            if (textEl) textEl.textContent = ganadores.join('  |  ');
            // Re-render del cat\u00e1logo para que aparezcan los badges
            if (typeof renderCatalog === 'function') {
              try { renderCatalog(); } catch(e) {}
            }
          }
        }

        // Cargar candidatos del mes actual
        var { data } = await sb.from('votacion_config').select('*').eq('mes', currentMes).maybeSingle();
        if (data) {
          candidatosMasc = data.candidatos_masc || [];
          candidatosFem = data.candidatos_fem || [];
          renderVotoButtons();
        } else {
          document.getElementById('votoMasc').innerHTML = '<div class="voto-empty-card"><span class="voto-empty-ico" aria-hidden="true">\u23f3</span><p class="voto-empty-title">Eligiendo los candidatos del mes</p><p class="voto-empty-sub">Volv\u00e9 pronto para votar tu favorito</p></div>';
          document.getElementById('votoFem').innerHTML = '<div class="voto-empty-card"><span class="voto-empty-ico" aria-hidden="true">\u23f3</span><p class="voto-empty-title">Eligiendo los candidatos del mes</p><p class="voto-empty-sub">Volv\u00e9 pronto para votar tu favorito</p></div>';
        }
      } catch(e) {
        document.getElementById('votoMasc').innerHTML = '<div class="voto-empty-card"><span class="voto-empty-ico" aria-hidden="true">\u23f3</span><p class="voto-empty-title">Eligiendo los candidatos del mes</p><p class="voto-empty-sub">Volv\u00e9 pronto para votar tu favorito</p></div>';
        document.getElementById('votoFem').innerHTML = '<div class="voto-empty-card"><span class="voto-empty-ico" aria-hidden="true">\u23f3</span><p class="voto-empty-title">Eligiendo los candidatos del mes</p><p class="voto-empty-sub">Volv\u00e9 pronto para votar tu favorito</p></div>';
      }
    }

    function renderVotoButtons() {
      var gridMasc = document.getElementById('votoMasc');
      var gridFem = document.getElementById('votoFem');
      gridMasc.innerHTML = candidatosMasc.map(function(name) {
        return '<button class="voto-opt" data-name="' + name.replace(/"/g, '') + '" onclick="submitVoto(this,\'masculino\',\'' + name.replace(/'/g, "\\'") + '\')" disabled>' + name + '</button>';
      }).join('');
      gridFem.innerHTML = candidatosFem.map(function(name) {
        return '<button class="voto-opt" data-name="' + name.replace(/"/g, '') + '" onclick="submitVoto(this,\'femenino\',\'' + name.replace(/'/g, "\\'") + '\')" disabled>' + name + '</button>';
      }).join('');
    }

    async function submitVoto(btn, categoria, slug) {
      if (!currentUser) { openAuth(); return; }
      var grid = btn.closest('.voto-grid');
      // Si ya votó en esta categoría, no hacer nada
      if (grid.querySelector('.voted-opt')) return;
      btn.classList.add('voted-opt');
      btn.disabled = true;
      // Guardar en Supabase
      await sb.from('votos').upsert({
        user_id: currentUser.id,
        categoria: categoria,
        slug: slug,
        mes: currentMes
      }, { onConflict: 'user_id,categoria,mes' });
      // Mostrar resultados de esta categoría
      loadVotoResults(categoria, grid);
    }

    async function loadVotoResults(categoria, grid) {
      var res = await sb.from('votos').select('slug').eq('categoria', categoria).eq('mes', currentMes);
      if (!res.data || res.data.length === 0) return;
      var counts = {};
      var total = res.data.length;
      res.data.forEach(function(v) { counts[v.slug] = (counts[v.slug] || 0) + 1; });
      var btns = grid.querySelectorAll('.voto-opt');
      btns.forEach(function(b) {
        var name = b.getAttribute('data-name') || b.textContent.trim();
        var pct = Math.round((counts[name] || 0) / total * 100);
        b.innerHTML = '<span class="poll-bar" style="width:' + pct + '%"></span>'
          + '<span class="poll-label">' + name + '</span>'
          + '<span class="poll-pct">' + pct + '%</span>';
        b.disabled = true;
        b.classList.add('showed');
      });
      // Agregar total
      var existing = grid.parentNode.querySelector('.voto-result');
      if (!existing) {
        var p = document.createElement('p');
        p.className = 'voto-result';
        p.textContent = total + ' voto' + (total !== 1 ? 's' : '');
        grid.parentNode.appendChild(p);
      }
    }

    async function unlockVoting() {
      var lock = document.querySelector('.voto-lock');
      if (lock) lock.style.display = 'none';
      var btns = document.querySelectorAll('.voto-opt');
      btns.forEach(function(b) { b.disabled = false; });
      // Ocultar CTA de registro
      var cta = document.getElementById('ctaRegister');
      if (cta) cta.style.display = 'none';
      // Cargar votos previos del usuario
      if (currentUser) {
        var res = await sb.from('votos').select('categoria, slug').eq('user_id', currentUser.id).eq('mes', currentMes);
        if (res.data) {
          res.data.forEach(function(v) {
            var gridId = v.categoria === 'masculino' ? 'votoMasc' : 'votoFem';
            var grid = document.getElementById(gridId);
            var btns = grid.querySelectorAll('.voto-opt');
            btns.forEach(function(b) {
              var bName = b.getAttribute('data-name') || b.textContent.trim();
              if (bName === v.slug) b.classList.add('voted-opt');
            });
            loadVotoResults(v.categoria, grid);
          });
        }
      }
    }

    function lockVoting() {
      var lock = document.querySelector('.voto-lock');
      if (lock) lock.style.display = '';
      var btns = document.querySelectorAll('.voto-opt');
      btns.forEach(function(b) { b.disabled = true; b.classList.remove('voted-opt', 'showed'); });
      // Mostrar CTA de registro
      var cta = document.getElementById('ctaRegister');
      if (cta) cta.style.display = '';
    }

    // ============================================================
    // UTILIDADES — Funciones helper que se usan en muchos lados
    // ============================================================

    // formatPrice: convierte el precio de la base de datos a formato argentino
    // La DB guarda "67,500.00" (formato US) → esto lo convierte a "$67.500"
    function formatPrice(str) {
      if (str === null || str === undefined || str === '') return '';
      const s = String(str);                                    // acepta número o string
      const num = Math.round(parseFloat(s.replace(/,/g, '')));  // quitar comas US, parsear número
      if (isNaN(num)) return '';
      return '$' + num.toLocaleString('es-AR').replace(/,/g, '.'); // formato AR con punto de miles
    }

    // [HOTSALE] Pricing helpers — fuente única de verdad.
    // Modelo: p.price = precio TARJETA (base para cuotas). p.promo = precio EFECTIVO/TRANSFER override.
    // Cuando hay promo, ese ES el cash final (no aplicar otro 0.9). Default: cash = price * 0.9.
    var HOT_SALE_LABEL = '🔥 HOT SALE EFECTIVO';
    function getListaPrice(p) {
      var n = parseFloat(String(p && p.price || '').replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? 0 : n;
    }
    function getCashPrice(p) {
      var promo = parseFloat(String(p && p.promo || '').replace(/[^0-9.\-]/g, ''));
      if (!isNaN(promo) && promo > 0) return Math.round(promo);
      return Math.round(getListaPrice(p) * 0.9);
    }
    function getCuotaPrice(p) {
      return Math.round(getListaPrice(p) / 3);
    }
    function hasHotSale(p) {
      var promo = parseFloat(String(p && p.promo || '').replace(/[^0-9.\-]/g, ''));
      return !isNaN(promo) && promo > 0;
    }
    function getDiscountPct(p) {
      var lista = getListaPrice(p);
      if (lista <= 0) return 0;
      return Math.round((1 - getCashPrice(p) / lista) * 100);
    }

    // primaryCat: de una cadena "Unisex, Hombre" saca solo la primera categoría
    // Útil porque algunos perfumes tienen múltiples categorías
    function primaryCat(catStr) {
      return catStr.split(',')[0].trim();
    }

    // catClass: devuelve la clase CSS del tag según la categoría
    // Esto determina si el tag se muestra azul (hombre), rosa (mujer) o dorado (unisex)
    function catClass(cat) {
      const c = primaryCat(cat).toLowerCase();
      if (c === 'hombre') return 'tag-hombre';
      if (c === 'mujer')  return 'tag-mujer';
      return 'tag-unisex';
    }

    function catLabel(cat) {
      return primaryCat(cat);
    }

    function matchesCat(cardCat, filterCat) {
      // "Unisex, Hombre" matchea tanto "Unisex" como "Hombre"
      if (filterCat === 'all') return true;
      return cardCat.split(',').map(c => c.trim()).includes(filterCat);
    }

    // ============================================================
    // GENERAR CARDS
    // ============================================================

    var PRODUCT_TYPES = [
      { keyword: 'desodorante', label: 'Desodorante' },
      { keyword: 'body spray', label: 'Body Spray' },
      { keyword: 'body splash', label: 'Body Splash' },
      { keyword: 'crema', label: 'Crema' },
      { keyword: 'aceite', label: 'Aceite' },
      { keyword: 'locion', label: 'Loción' },
      { keyword: 'jabon', label: 'Jabón' },
    ];

    function detectProductType(p) {
      if (!p) return null;
      // Backward compat: si me pasan un string (name), lo trato como antes
      if (typeof p === 'string') return detectTypeByName(p);
      // Fuente canónica: el campo tipo seteado desde el admin
      if (p.tipo) return p.tipo;
      // Fallback legacy: detectar por keyword en el nombre
      return detectTypeByName(p.name || '');
    }

    function detectTypeByName(name) {
      var n = stripAccents(name.toLowerCase());
      for (var i = 0; i < PRODUCT_TYPES.length; i++) {
        if (n.indexOf(PRODUCT_TYPES[i].keyword) !== -1) return PRODUCT_TYPES[i].label;
      }
      return null;
    }

    // ============================================================
    // FOTOS DE GAMA — fotos grupales que muestran varios perfumes
    // de la misma línea. Se aplican automáticamente cuando el perfume
    // NO tiene fotos_extra manuales:
    //   • Si no tiene foto propia: la 1ra foto de gama pasa a ser la principal
    //   • Si tiene foto: se agregan al final de la galería como extras
    // El admin puede sobreescribir cargando fotos_extra a mano.
    // ============================================================
    var GAMA_FOTOS = {
      'CDN':          ['img/4-CDN-JUNTOS_INTENSEMAN_ICONIC_URBANMAN_SILLAGE.webp', 'img/3-CDN-JUNTOS_UNTOLD_MALEKA_WOMANEXTRAIT.webp'],
      'CLUB DE NUIT': ['img/4-CDN-JUNTOS_INTENSEMAN_ICONIC_URBANMAN_SILLAGE.webp', 'img/3-CDN-JUNTOS_UNTOLD_MALEKA_WOMANEXTRAIT.webp'],
      'ISHQ':         ['img/2 ISHQ JUNTOS.webp'],
      'EMAAN':        ['img/2-JUNTOS_EMAAN_HAYA.webp'],
      'HAYA':         ['img/2-JUNTOS_EMAAN_HAYA.webp']
    };

    function getGamaFotos(p) {
      if (!p || !p.name) return [];
      var n = p.name.toUpperCase();
      // Ordenar claves por largo descendente para que "CLUB DE NUIT" matchee antes que "CDN"
      var keys = Object.keys(GAMA_FOTOS).sort(function(a, b) { return b.length - a.length; });
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (n === k || n.indexOf(k + ' ') === 0 || n.indexOf(k + '-') === 0) {
          return GAMA_FOTOS[k].slice();
        }
      }
      return [];
    }

    // Alias de gama bidireccional: cualquier perfume cuyo nombre empiece con una clave
    // se hace buscable también por todos los sinónimos del valor.
    // Ej: buscando "cdn" aparecen todos los "CDN ..." y el "Club de Nuit".
    // Buscando "club nuit" aparecen los "CLUB DE NUIT ..." y los "CDN ...".
    var GAMA_ALIAS = {
      'CDN':          'cdn club de nuit club nuit clubdenuit',
      'CLUB DE NUIT': 'cdn club de nuit club nuit clubdenuit'
    };

    function getGamaAlias(p) {
      if (!p || !p.name) return '';
      var n = p.name.toUpperCase();
      var keys = Object.keys(GAMA_ALIAS).sort(function(a, b) { return b.length - a.length; });
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (n === k || n.indexOf(k + ' ') === 0 || n.indexOf(k + '-') === 0) {
          return GAMA_ALIAS[k];
        }
      }
      return '';
    }

    // Construye el pool unificado de fotos para la galería:
    // foto principal + fotos_extra manuales + fotos de gama (máx 4 total).
    // Si el perfume tiene fotos_extra propias, NO se suman las de gama (el admin mandó).
    function buildFotosPool(p) {
      var pool = [];
      if (p.foto) pool.push(p.foto.replace(/ /g, '%20'));
      var extras = p.fotos_extra ? p.fotos_extra.split(',').map(function(u) { return u.trim(); }).filter(Boolean) : [];
      extras.slice(0, 3).forEach(function(u) { pool.push(u.replace(/ /g, '%20')); });
      if (extras.length === 0) {
        var gama = getGamaFotos(p);
        gama.slice(0, 4 - pool.length).forEach(function(u) { pool.push(u.replace(/ /g, '%20')); });
      }
      // Dedupe
      var seen = {};
      return pool.filter(function(u) { if (seen[u]) return false; seen[u] = true; return true; });
    }

    // updateGalleryDots: detecta qué slide está visible al scrollear y
    // actualiza el contador "1/4" en el nav bar. Mantiene el nombre viejo
    // por compatibilidad con el onscroll handler inline de cards cacheadas.
    function updateGalleryDots(gallery) {
      var slides = gallery.querySelectorAll('.card-gallery-slide');
      if (slides.length === 0) return;
      var scrollLeft = gallery.scrollLeft;
      var slideWidth = slides[0].offsetWidth;
      var activeIdx = Math.round(scrollLeft / slideWidth);
      // Actualizar contador en TODOS los navs de esta card (puede haber 2:
      // el de sobre la imagen y el de al lado del nombre).
      var card = gallery.closest('.product-card') || gallery.parentElement;
      if (card) {
        var counters = card.querySelectorAll('.card-gallery-nav-current');
        counters.forEach(function(c) { c.textContent = (activeIdx + 1); });
        // Dots viejos (backward compat)
        var dots = card.querySelectorAll('.card-gallery-dot');
        dots.forEach(function(d, i) { d.classList.toggle('active', i === activeIdx); });
      }
    }

    // Click en flechas del nav bar: avanza o retrocede una foto.
    // Subimos hasta .product-card para encontrar la galeria, asi funciona
    // desde CUALQUIER nav (el de sobre la imagen o el de al lado del nombre).
    function scrollGalleryArrow(btn, direction, ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      var card = btn.closest('.product-card');
      var gallery = card ? card.querySelector('.card-gallery') : null;
      if (!gallery) {
        // Fallback legado
        var container = btn.closest('.card-image');
        if (container) gallery = container.querySelector('.card-gallery');
      }
      if (!gallery) return;
      var slides = gallery.querySelectorAll('.card-gallery-slide');
      if (slides.length === 0) return;
      var slideWidth = slides[0].offsetWidth;
      var currentIdx = Math.round(gallery.scrollLeft / slideWidth);
      var newIdx = Math.max(0, Math.min(slides.length - 1, currentIdx + direction));
      gallery.scrollTo({ left: newIdx * slideWidth, behavior: 'smooth' });
    }

    // ✨ Social proof — "X personas mirando ahora"
    // Genera un número 0-5 determinista por slug + ventana de 5 min.
    // Mismo slug + misma ventana de tiempo = mismo número (estable).
    // Cada 5 min cambia. No usa Supabase ni Realtime — cero costo.
    function computeLiveViewers(slug) {
      if (!slug) return 0;
      // hash determinista del slug (DJB2-ish)
      var h = 5381;
      for (var i = 0; i < slug.length; i++) {
        h = ((h << 5) + h) + slug.charCodeAt(i);
        h = h & 0xFFFFFFFF;
      }
      // ventana de 5 minutos (cambia el número cada 5')
      var timeWindow = Math.floor(Date.now() / (5 * 60 * 1000));
      var seed = Math.abs(h ^ timeWindow);
      // mapear a 0-6 con bias hacia 1-3 (más realista que 5+ siempre)
      var n = seed % 7;
      return n; // 0-6 (cuando es 0 no se muestra el badge)
    }

    // Re-render del badge cada 5 minutos para que el número se actualice
    // "en vivo" sin recargar la página. Usa setInterval ligero.
    setInterval(function() {
      document.querySelectorAll('.card-live-viewers').forEach(function(el) {
        var slug = el.getAttribute('data-slug');
        if (!slug) return;
        var n = computeLiveViewers(slug);
        var countEl = el.querySelector('.card-live-count');
        if (n === 0) {
          el.style.display = 'none';
        } else {
          el.style.display = '';
          if (countEl) countEl.textContent = n;
        }
      });
    }, 5 * 60 * 1000); // cada 5 minutos

    // ══════════════════════════════════════════════════════════════
    // [PROMO-DECANTS] N3 · las etiquetas de la card (decisiones 111 y 112).
    //  · Máximo dos. Orden: la cinta del jefe → la promo → «Último» → «Nuevo»; entran las dos primeras que tenga la card.
    //  · «Sin stock» y «Próximamente» tapan todas, también la cinta.
    //  · Si la cinta dice lo mismo que una automática (sin acentos ni mayúsculas: NUEVO ↔ «Nuevo», ÚLTIMAS UNIDADES
    //    ↔ «Último»), la automática no sale y no ocupa lugar.
    //  · Van apiladas arriba, del lado de la foto (.card-etiquetas); la cinta sigue siendo la franja de arriba.
    // La de la promo: «🧪 3 decants por $18.000 · hasta el lun 29» y, en las últimas 24 h, «… · termina mañana» o «… ·
    // termina hoy» ([PROMO-ANCHO-360], decisión 117: sin reloj, que a 360 pisaba el corazón). El reloj de la promo
    // (iniciarRelojPromo) la repinta cada minuto: el texto cambia a las 24 h y a la medianoche; cuando termina, desaparece.
    // ══════════════════════════════════════════════════════════════
    var CINTA_IGUAL_ULTIMO = ['ultimo', 'ultimas unidades'];
    var DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    function normCinta(s) { return stripAccents(String(s == null ? '' : s)).toLowerCase().replace(/\s+/g, ' ').trim(); }
    // El día en hora argentina (UTC−3 fijo, sin horario de verano): «lun 29».
    function diaCortoART(ms) { var d = new Date(ms - 3 * 3600e3); return DIAS_CORTOS[d.getUTCDay()] + ' ' + d.getUTCDate(); }
    // El número de día en hora argentina (la misma cuenta que diaCortoART: UTC−3 fijo).
    function diaART(ms) { return Math.floor((ms - 3 * 3600e3) / 86400e3); }
    function textoEtiquetaPromo(promo) {
      var base = '🧪 ' + promo.n + ' decants por ' + precioAR(promo.precio_pack);
      var falta = promo.hasta - Date.now();
      if (falta > 24 * 3600e3) return base + ' · hasta el ' + diaCortoART(promo.hasta - 1);   // −1 ms: un «hasta» a las 00:00 es el día anterior
      return base + (diaART(promo.hasta - 1) === diaART(Date.now()) ? ' · termina hoy' : ' · termina mañana');
    }
    function etiquetasCard(p, stockStatus) {
      if (stockStatus === 'out' || stockStatus === 'pausado') return '';
      var cinta = p.etiqueta ? normCinta(p.etiqueta) : '';
      var items = [];
      var promo = promoVigente();
      if (promo && promoDecantEntra(p, promo)) items.push('<span class="badge-promo">' + escapeHTML(textoEtiquetaPromo(promo)) + '</span>');
      if (stockStatus === 'low' && CINTA_IGUAL_ULTIMO.indexOf(cinta) === -1) items.push('<span class="badge-ultimo">Último</span>');
      if (p._isNew && cinta !== 'nuevo') items.push('<span class="badge-nuevo">Nuevo</span>');
      return items.slice(0, cinta ? 1 : 2).join('');
    }
    // Repinta las etiquetas de las cards ya dibujadas (cuando llega la promo, y cada minuto con el reloj).
    function refrescarEtiquetasCards() {
      var porSlug = {};
      PERFUMES.forEach(function(p) { porSlug[p.slug] = p; });
      document.querySelectorAll('.product-card[data-slug] > .card-etiquetas').forEach(function(el) {
        var p = porSlug[el.parentElement.getAttribute('data-slug')];
        if (!p) return;
        var html = etiquetasCard(p, p._stockStatus || 'ok');
        if (el.innerHTML !== html) el.innerHTML = html;
      });
    }

    function buildCard(p) {
      delete p._precioOriginal; // limpiar entre renders
      var letter = p.name.charAt(0).toUpperCase();
      var priceFormatted = p.promo ? formatPrice(p.promo) : formatPrice(p.price);
      var originalFormatted = p.promo ? formatPrice(p.price) : '';
      const pCat = catLabel(p.cat);

      const fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';

      // Galería unificada: foto principal + fotos_extra manuales + fotos de gama (auto).
      // Si el perfume no tiene foto propia pero sí foto de gama, la gama pasa a ser la principal.
      var imageHTML;
      var fotosPool = buildFotosPool(p);

      // Nav del carrusel. Construimos el fragmento una sola vez y lo
      // insertamos en DOS lugares (image + info). En mobile se muestra el de
      // adentro de la imagen; en desktop el de la card-info (al lado del
      // nombre), porque el card-reveal al hover tapa todo lo que esta encima
      // de la imagen. Las flechas caminan hacia arriba al .product-card para
      // encontrar la galeria, asi no importa donde viva el nav.
      var navInnerHTML = ''
        + '<button type="button" class="card-gallery-nav-arrow" onclick="scrollGalleryArrow(this, -1, event)" aria-label="Foto anterior">&#8249;</button>'
        + '<span class="card-gallery-nav-counter"><span class="card-gallery-nav-current">1</span>/PLACEHOLDER</span>'
        + '<button type="button" class="card-gallery-nav-arrow" onclick="scrollGalleryArrow(this, 1, event)" aria-label="Foto siguiente">&#8250;</button>';

      // Guardamos aparte para reusar
      var galleryNavOnImage = '';
      var galleryNavOnInfo  = '';

      if (fotosPool.length >= 2) {
        var slides = fotosPool.map(function(url) {
          // Backdrop blur LAZY: pongo la URL en data-bg, IntersectionObserver
          // la activa como background-image solo cuando la card entra (o está
          // a 300px de entrar) al viewport. Sin esto, el browser pedía las
          // 162 imágenes de backdrop al inicio (bypasseando loading="lazy"
          // del <img>, que NO aplica a CSS background-image).
          var bgUrl = url.replace(/'/g, "%27").replace(/"/g, '&quot;');
          return '<div class="card-gallery-slide" data-bg="' + bgUrl + '"><img src="' + url + '" alt="' + p.name + '" loading="lazy" decoding="async" width="400" height="400"></div>';
        }).join('');
        var navInnerFilled = navInnerHTML.replace('PLACEHOLDER', fotosPool.length);
        galleryNavOnImage = '<div class="card-gallery-nav card-gallery-nav--image">' + navInnerFilled + '</div>';
        galleryNavOnInfo  = '<div class="card-gallery-nav card-gallery-nav--info">'  + navInnerFilled + '</div>';
        imageHTML = '<div class="card-gallery" onscroll="updateGalleryDots(this)">' + slides + '</div>' + galleryNavOnImage;
      } else if (fotosPool.length === 1) {
        // Wrap en .card-gallery-slide con backdrop blur LAZY (data-bg, igual
        // que el caso multi-foto — el IntersectionObserver lo activa).
        var _bgUrl = fotosPool[0].replace(/'/g, "%27").replace(/"/g, '&quot;');
        imageHTML = '<div class="card-gallery-slide card-gallery-slide--single" data-bg="' + _bgUrl + '"><img src="' + fotosPool[0] + '" alt="' + p.name + '" loading="lazy" decoding="async" width="400" height="400"></div>';
      } else {
        // [3B] Placeholder elegante: tipografía display + nombre del perfume + label sutil.
        // Reemplaza el SVG-botella con cinta diagonal amarilla "Foto próximamente" que
        // parecía un badge de error. Ahora se ve como "carga en curso" en vez de bug.
        imageHTML = '<div class="photo-coming"><span class="photo-coming-letter">' + letter + '</span><span class="photo-coming-name">' + p.name + '</span><span class="photo-coming-label">Foto próximamente</span></div>';
      }

      // [HOTSALE] Las cuotas siempre se calculan sobre precio TARJETA (p.price).
      // El cash sale del helper: si hay promo, ese ES el cash; sino, price * 0.9.
      var listaFormatted = '$' + getListaPrice(p).toLocaleString('es-AR').replace(/,/g, '.');
      var cashPrice = getCashPrice(p);
      var cashFormatted = '$' + cashPrice.toLocaleString('es-AR').replace(/,/g, '.');
      var discountPct = getDiscountPct(p);
      // [1] Mostrar el VALOR de cada cuota (no solo "3 cuotas sin interés" suelto).
      // Antes el label era microscópico (.55rem) y no se entendía cuánto pagás c/u.
      var cuotaFormatted = '$' + getCuotaPrice(p).toLocaleString('es-AR').replace(/,/g, '.');
      var pricingHTML;
      if (hasHotSale(p)) {
        pricingHTML = '<span class="price-promo">' + listaFormatted + '</span>'
          + '<span class="price-cuotas-line"><span class="price-cuotas-chip">3 cuotas</span><strong>' + cuotaFormatted + '</strong> sin interés</span>'
          + '<span class="price-cash price-cash--hotsale">' + HOT_SALE_LABEL + ': ' + cashFormatted + ' (' + discountPct + '% off)</span>';
      } else {
        pricingHTML = '<span class="price-promo">' + listaFormatted + '</span>'
          + '<span class="price-cuotas-line"><span class="price-cuotas-chip">3 cuotas</span><strong>' + cuotaFormatted + '</strong> sin interés</span>'
          + '<span class="price-cash">' + cashFormatted + ' efectivo/transf.</span>';   // [EFECTIVO-UN-RENGLON] decisión 85: sin «descuento» entra en un renglón a 360
      }

      var searchText = stripAccents([p.name, p.marca, p.marca_real || '', p.notas_salida || '', p.notas_corazon || '', p.notas_base || '', p.alias || '', p.tipo || '', getGamaAlias(p)].join(' ').toLowerCase());

      var isFav = favs.indexOf(p.slug) !== -1;

      // Stock badge
      var stockStatus = p._stockStatus || 'ok';
      var isPaused = stockStatus === 'pausado';
      var stockBadge = '';
      // Si hay nota del equipo para este estado, agregamos class 'has-note' y un onclick
      // que abre el modal con el texto + CTA de WhatsApp.
      // IMPORTANTE: "Último" NO tiene nota a propósito — evita que múltiples clientes
      // pidan el único frasco disponible y el empleado tenga que elegir.
      var noteForState = '';
      if (stockStatus === 'out') noteForState = p.nota_sin_stock || '';
      else if (isPaused)         noteForState = p.nota_proximamente || '';
      var badgeExtraAttrs = noteForState
        ? ' has-note" onclick="event.stopPropagation();showStockNote(\'' + p.slug + '\',\'' + stockStatus + '\')"'
        : '"';
      // [PROMO-DECANTS] N3 · «Último» y «Nuevo» van en la pila de etiquetas (etiquetasCard).
      if (stockStatus === 'out') stockBadge = '<span class="badge-sin-stock' + badgeExtraAttrs + '>Sin stock</span>';
      if (isPaused)             stockBadge = '<span class="badge-proximamente' + badgeExtraAttrs + '>Próximamente</span>';


      // Tipo de producto (campo explícito del admin, fallback a keyword en nombre)
      var prodType = detectProductType(p);
      var tipoBadge = prodType ? '<span class="badge-tipo">' + prodType + '</span>' : '';

      // Cinta de etiqueta personalizada (se configura desde el admin)
      var ribbonHTML = '';
      if (p.etiqueta && stockStatus !== 'out' && !isPaused) {   // [PROMO-DECANTS] N3 · «Sin stock» y «Próximamente» tapan también la cinta
        // [CINTA-TINTA] el texto escapado, el color validado y la letra según el color (antes, blanca siempre y sin escapar)
        var ribbonColor = colorCinta(p.etiqueta_color);
        ribbonHTML = '<div class="card-ribbon" style="background:' + ribbonColor + ';color:' + letraSobre(ribbonColor) + ';">' + escapeHTML(p.etiqueta) + '</div>';
      }

      // [HOTSALE] Descuento temporal (descuento_pct + descuento_hasta) sacado del front.
      // Los campos siguen en DB y admin; si se reactiva la feature en el futuro, restaurar acá.
      var discountHTML = '';
      var discountTimerHTML = '';

      // ML del producto
      var mlText = (p.ml || 100) + ' ml';

      // Visitas
      var viewCount = perfumeViews[p.slug] || 0;
      var viewsHTML = viewCount > 5 ? '<div class="card-views"><svg viewBox="0 0 16 16"><path d="M8 3C4.36 3 1.26 5.28 0 8.5c1.26 3.22 4.36 5.5 8 5.5s6.74-2.28 8-5.5C14.74 5.28 11.64 3 8 3zm0 9.17c-1.84 0-3.33-1.49-3.33-3.33S6.16 5.5 8 5.5s3.33 1.49 3.33 3.33S9.84 12.17 8 12.17zM8 7a1.83 1.83 0 1 0 0 3.67A1.83 1.83 0 0 0 8 7z"/></svg>' + viewCount + '</div>' : '';

      // 👑 PERFUME DEL MES — badge dorado para el ganador de votación
      var perfumeDelMesHTML = '';
      if (p._perfumeDelMes) {
        perfumeDelMesHTML = '<span class="card-pdm-badge" title="Ganador del mes anterior — votación de clientes">👑 Perfume del mes</span>';
      }

      // 🔥 URGENCY — "Solo queda N" cuando stock real es 1-3
      // Stock real del perfume (viene de perfume_overrides). Mostramos
      // badge de urgencia solo si stock está entre 1 y 3 — crea FOMO
      // basado en data verdadera, no en marketing falso.
      var urgencyHTML = '';
      var stockQty = typeof p._stockQty === 'number' ? p._stockQty : null;
      if (stockQty !== null && stockQty >= 1 && stockQty <= 3 && !isPaused) {
        var urgencyText = stockQty === 1 ? '🔥 Solo queda 1' : '🔥 Solo quedan ' + stockQty;
        urgencyHTML = '<span class="card-urgency" title="Stock real del local — ¡apurate!">' + urgencyText + '</span>';
      }

      // ✨ SOCIAL PROOF — "X personas mirando ahora"
      // Algoritmo determinista basado en slug + ventana de 5 min:
      // genera un número 1-5 estable que cambia cada 5 min. Da sensación
      // de tracking en vivo sin Realtime real (caro). Solo aparece en
      // perfumes con tracking acumulado (viewCount > 3) para evitar
      // mostrar el badge en todos.
      var liveViewersHTML = '';
      if (viewCount > 3) {
        var liveN = computeLiveViewers(p.slug);
        if (liveN > 0) {
          liveViewersHTML = '<div class="card-live-viewers" data-slug="' + p.slug + '"><span class="card-live-dot"></span><span class="card-live-count">' + liveN + '</span> mirando ahora</div>';
        }
      }

      var isOutOfStock = stockStatus === 'out';

      // Boton "Avisame cuando vuelva" para sin stock y pausados.
      // Renderizamos los iconos en spans separados (bell / lock / check)
      // para que CSS pueda mostrarlos/ocultarlos segun auth (body.is-guest)
      // sin re-renderizar la card cuando el usuario logea/desloga.
      var waitlistHTML = '';
      if (isOutOfStock || isPaused) {
        var alreadyWaiting = waitlistSlugs.indexOf(p.slug) !== -1;
        if (alreadyWaiting) {
          waitlistHTML = '<button class="waitlist-btn subscribed" onclick="openWaitlist(\'' + p.slug + '\', event)">'
            + '<span class="waitlist-ico waitlist-ico--check">&#10003;</span> '
            + '<span class="waitlist-label">Te avisamos cuando vuelva</span>'
          + '</button>';
        } else {
          waitlistHTML = '<button class="waitlist-btn" onclick="openWaitlist(\'' + p.slug + '\', event)">'
            + '<span class="waitlist-ico waitlist-ico--bell">&#128276;</span>'
            + '<span class="waitlist-ico waitlist-ico--lock">&#128274;</span>'
            + '<span class="waitlist-label">Avisame cuando vuelva</span>'
            + '<span class="waitlist-label waitlist-label--guest">Ingresá para avisarte</span>'
          + '</button>';
        }
      }

      // Precio efectivo para ordenar (usa promo si hay, sino price; ambos en número limpio)
      var sortPriceNum = p.promo
        ? parseFloat(String(p.promo).replace(/[^0-9.\-]/g, '')) || 0
        : parseFloat(String(p.price || '').replace(/[^0-9.\-]/g, '')) || 0;

      return '<div class="product-card card-lateral' + (isPaused ? ' pausado' : '') + (isOutOfStock ? ' sin-stock' : '') + '" data-cat="' + p.cat + '" data-slug="' + p.slug + '" data-perfil="' + (p.perfil || '') + '" data-price="' + sortPriceNum + '" data-search="' + searchText.replace(/"/g, '') + '">'
        + ribbonHTML + stockBadge + '<div class="card-etiquetas">' + etiquetasCard(p, stockStatus) + '</div>' + discountHTML + discountTimerHTML
        + '<button class="fav-heart' + (isFav ? ' liked' : '') + '" onclick="toggleFav(this, event)" aria-label="Favorito">' + (isFav ? '&#9829;' : '&#9825;') + '</button>'
        + '<button class="compare-btn" onclick="toggleCompare(\'' + p.slug + '\', this, event)" aria-label="Comparar con otros perfumes"><span class="compare-icon">&#9878;</span><span class="compare-label">COMPARAR</span></button>'
        + '<div class="card-image">' + imageHTML + '</div>'
        + '<div class="card-info">'
          + galleryNavOnInfo
          + '<p class="card-name">' + p.name + '</p>'
          + '<p class="card-brand">' + (p.marca_real || p.marca) + '</p>'
          + '<div class="card-tags">'
            + '<span class="card-tag tag-cat">' + pCat + '</span>'
            + '<span class="card-tag tag-ml">' + mlText + '</span>'
            + '<span class="card-tag tag-acorde">' + (p.perfil || '') + '</span>'
            + tipoBadge
          + '</div>'
          + ((p.notas_salida || p.notas_corazon || p.notas_base)
            ? '<div class="card-notes-preview">'
              + '<p class="note-prev"><span class="note-label">SALIDA</span> ' + (p.notas_salida || '—') + '</p>'
              + '<p class="note-prev"><span class="note-label">CORAZ\u00d3N</span> ' + (p.notas_corazon || '—') + '</p>'
              + '<p class="note-prev"><span class="note-label">BASE</span> ' + (p.notas_base || '—') + '</p>'
            + '</div>'
            : '')
          + '<div class="card-pricing">' + pricingHTML + '</div>'
          + perfumeDelMesHTML
          + urgencyHTML
          + viewsHTML
          + liveViewersHTML
          + '<a href="https://wa.me/5492975416017?text=' + encodeURIComponent(buildWaMessage([p], '')) + '" target="_blank" class="card-cta-mobile">Consultar &#8594;</a>'
          + waitlistHTML
        + '</div>'
        + '<div class="card-reveal">'
          + '<p class="reveal-name">' + p.name + '</p>'
          + '<p class="reveal-brand">' + (p.marca_real || p.marca) + '</p>'
          + '<div class="reveal-pricing">' + pricingHTML + '</div>'
          + '<div class="reveal-divider"></div>'
          + '<div class="reveal-tags">'
            + '<span class="card-tag tag-cat">' + pCat + '</span>'
            + '<span class="card-tag tag-ml">' + mlText + '</span>'
            + '<span class="card-tag tag-acorde">' + (p.perfil || '') + '</span>'
            + tipoBadge
          + '</div>'
          + '<div class="scent-notes">'
            + (p.esSet
              ? '<p class="scent-note set-highlight"><strong>' + p.setInfo + '</strong></p>'
                + '<p class="scent-note">Incluye: ' + p.name + '</p>'
                + '<p class="scent-note">Precio: ' + pricingHTML + '</p>'
              : (p.notas_salida || p.notas_corazon || p.notas_base)
                ? '<p class="scent-note"><span class="note-label">SALIDA</span> ' + (p.notas_salida || '—') + '</p>'
                  + '<p class="scent-note"><span class="note-label">CORAZ\u00d3N</span> ' + (p.notas_corazon || '—') + '</p>'
                  + '<p class="scent-note"><span class="note-label">BASE</span> ' + (p.notas_base || '—') + '</p>'
                : '<p class="scent-note">' + p.perfil + ' &middot; ' + pCat + '</p>'
                  + '<p class="scent-note">Precio: ' + pricingHTML + '</p>'
            )
          + '</div>'
          + '<button onclick="goToWA(\'' + p.slug + '\', event)" class="reveal-cta">' + (p.esSet ? 'Consultar set &#8594;' : 'Consultar &#8594;') + '</button>'
          + ((!p.esSet && (p.notas_salida || p.notas_corazon || p.notas_base || (p.similares_nota && p.similares_nota.trim()) || (Array.isArray(p.similares_manuales) && p.similares_manuales.length > 0))) ? '<button class="reveal-similares" onclick="showSimilares(\'' + p.slug + '\', event)">&#9830; Ver similares</button>' : '')
          + '<div class="reveal-actions">'
            + '<button class="cart-add-btn" onclick="addToCart(\'' + p.slug + '\', this, event)">&#128722; Agregar</button>'
            + '<button class="reveal-share" onclick="sharePerfume(\'' + p.slug + '\', this, event)">&#128279;</button>'
          + '</div>'
        + '</div>'
      + '</div>';
    }

    var CARDS_INITIAL = 20;
    var CARDS_INCREMENT = 15;
    var cardsShown = CARDS_INITIAL;

    var DEFAULT_TOP_SLUGS = ['khamrah','asad','9-am','9-pm','yara-tous'];
    var TOP_VENTAS_SLUGS = DEFAULT_TOP_SLUGS;

    // Cargar destacados desde Supabase (visible para TODOS los visitantes)
    // Deferido: se renderiza con DEFAULT_TOP_SLUGS y luego se actualiza
    // si Supabase devuelve override. No es above-the-fold mobile.
    async function loadDestacadosFromDB() {
      try {
        var { data } = await sb.from('destacados').select('slug, posicion').order('posicion', { ascending: true });
        if (data && data.length > 0) {
          TOP_VENTAS_SLUGS = data.map(function(d) { return d.slug; });
          renderSeleccionST();
        }
      } catch(e) {}
    }
    deferTask(loadDestacadosFromDB);

    // [SELECCION-BADGE] Texto del badge amarillo de las cards de Selección ST.
    // Variable global con default "TOP VENTAS" — si Supabase tarda o falla,
    // el render inicial igual muestra algo válido. Cuando carga la config
    // desde la tabla seleccion_st_config, re-renderea automáticamente.
    var SELECCION_BADGE_TEXT = 'TOP VENTAS';
    async function loadSeleccionStConfig() {
      try {
        var { data } = await sb.from('seleccion_st_config')
          .select('badge_text').eq('id', 1).maybeSingle();
        if (data && data.badge_text && (data.badge_text + '').trim()) {
          SELECCION_BADGE_TEXT = (data.badge_text + '').trim().substring(0, 20);
          renderSeleccionST();
        }
      } catch(e) { /* silent · queda el default */ }
    }
    deferTask(loadSeleccionStConfig);

    // ============================================================
    // ANUNCIO PÚBLICO — banner entre DECANTS y SELECCIÓN ST
    //
    // Alimenta el banner con los últimos pushes enviados desde admin
    // (tabla announcements). Piensen en "para los que NO se
    // suscribieron a notificaciones, que igual vean los avisos".
    //
    // Reglas:
    //  - Muestra hasta los 3 más recientes de los últimos 7 días.
    //  - Cerrar un anuncio lo silencia por 24hs para ese visitante
    //    (guardado en localStorage con { id, hastaTs }). Al día
    //    siguiente vuelve a aparecer si todavía está en el rango.
    //  - Fallo silencioso: si la tabla no existe, simplemente no
    //    se muestra nada. No rompe el catálogo.
    // ============================================================
    async function loadAnnouncement() {
      var wrap = document.getElementById('publicAnnouncement');
      if (!wrap) return;

      try {
        var cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        var { data, error } = await sb.from('announcements')
          .select('id, title, body, url, created_at')
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(3);
        if (error || !data || data.length === 0) return;

        // Limpiar dismissals vencidos y filtrar los silenciados aún activos
        var nowTs = Date.now();
        var raw = [];
        try { raw = JSON.parse(localStorage.getItem('st_ann_dismissed') || '[]'); } catch(_) {}
        // Retrocompatibilidad: si hay entradas con formato viejo (string),
        // las tratamos como dismissals permanentes (=Infinity). Nuevas son
        // objetos { id, until }.
        var activas = raw.filter(function(d) {
          if (typeof d === 'string') return true;
          return d && d.until && d.until > nowTs;
        });
        var dismissedIds = activas.map(function(d) {
          return typeof d === 'string' ? d : d.id;
        });

        var visibles = data.filter(function(a) { return dismissedIds.indexOf(a.id) === -1; });
        if (visibles.length === 0) return;

        // Escape básico para no inyectar HTML
        function esc(s) {
          return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        // Guardamos (con dismissals limpiados) para no acumular vencidos
        try { localStorage.setItem('st_ann_dismissed', JSON.stringify(activas)); } catch(_) {}

        // Armar tarjetas apiladas (hasta 3)
        var html = visibles.map(function(ann) {
          var bodyHtml = esc(ann.body || '');
          if (ann.url) bodyHtml += ' <a href="' + esc(ann.url) + '">Ver más →</a>';
          return '<div class="pub-ann-inner" data-ann-id="' + esc(ann.id) + '">'
            + '<span class="pub-ann-ico" aria-hidden="true">📣</span>'
            + '<div class="pub-ann-body">'
            +   '<p class="pub-ann-title">' + esc(ann.title || 'Aviso ST Perfumería') + '</p>'
            +   '<p class="pub-ann-text">' + bodyHtml + '</p>'
            + '</div>'
            + '<button type="button" class="pub-ann-close" aria-label="Cerrar aviso">×</button>'
            + '</div>';
        }).join('');

        wrap.innerHTML = html;
        wrap.style.display = 'block';

        // Wire up cierres (silenciar 24hs por ID)
        wrap.querySelectorAll('.pub-ann-close').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var card = btn.closest('.pub-ann-inner');
            if (!card) return;
            var id = card.getAttribute('data-ann-id');
            card.style.display = 'none';

            try {
              var curr = [];
              try { curr = JSON.parse(localStorage.getItem('st_ann_dismissed') || '[]'); } catch(_) {}
              // Remover cualquier registro previo de este ID
              curr = curr.filter(function(d) {
                var dId = typeof d === 'string' ? d : (d && d.id);
                return dId !== id;
              });
              curr.push({ id: id, until: Date.now() + 24 * 60 * 60 * 1000 });
              // Tope defensivo: 20 entradas
              if (curr.length > 20) curr = curr.slice(-20);
              localStorage.setItem('st_ann_dismissed', JSON.stringify(curr));
            } catch(_) {}

            // Si ya no queda ninguna tarjeta visible, ocultamos el wrap
            var queda = wrap.querySelector('.pub-ann-inner:not([style*="display: none"])');
            if (!queda) wrap.style.display = 'none';
          });
        });
      } catch(e) {
        console.warn('[announcement] no se pudo cargar:', e);
      }
    }
    deferTask(loadAnnouncement);

    // Cargar combos desde Supabase
    async function loadCombosFromDB() {
      try {
        var { data, error } = await sb.from('combos').select('*');
        if (error) return;
        if (data && data.length > 0) {
          data.forEach(function(c) {
            c.esSet = true;
            var idx = PERFUMES.findIndex(function(p) { return p.slug === c.slug; });
            if (idx !== -1) { PERFUMES[idx] = c; } else { PERFUMES.push(c); }
          });
          renderSets();
        }
      } catch(e) {}
    }
    deferTask(loadCombosFromDB);

    function renderSeleccionST() {
      var grid = document.getElementById('seleccionGrid');
      if (!grid) return;
      var html = '';
      // [SELECCION-ST-1A] Las primeras 3 cards reciben badge de podio (#1/#2/#3
      // con oro/plata/bronce). Convierte la sección en un PODIO real, no un grid
      // genérico. Hace que el cliente sepa cuál es el más vendido a primera vista.
      // [SELECCION-ST-1B] Si el override tiene nota_jefe definido, mostramos un
      // quote del jefe ("a mí me gusta porque..."). Hoy no hay datos cargados —
      // la columna se activa con SQL ALTER + UI admin en sesión futura. Mientras
      // tanto el render es no-op si p.nota_jefe es vacío.
      TOP_VENTAS_SLUGS.forEach(function(slug, idx) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        // [PAUSADO-OCULTO] no mostrar destacados pausados ni eliminados. Antes
        // sólo se chequeaba que existiera, así que un perfume dado de baja podía
        // seguir apareciendo en el podio.
        if (!p || p._oculto || p._pausado) return;
        var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
        var imgHTML = p.foto
          ? '<img src="' + fotoSrc + '" alt="' + p.name + '" loading="lazy" decoding="async" width="300" height="300">'
          : '<div style="color:var(--amarillo);font-size:2rem;opacity:.3;">' + p.name.charAt(0) + '</div>';
        var rankNum = idx + 1;
        var rankClass = rankNum <= 3 ? ' has-rank rank-' + rankNum : '';
        var rankBadge = rankNum <= 3
          ? '<span class="rank-badge rank-' + rankNum + '" aria-label="Puesto ' + rankNum + ' del ranking">#' + rankNum + '</span>'
          : '';
        var quoteHTML = (p.nota_jefe && (p.nota_jefe + '').trim())
          ? '<p class="collectible-quote">&laquo;' + escapeHTML((p.nota_jefe + '').trim()) + '&raquo;</p>'
          : '';
        html += '<div class="collectible-card' + rankClass + '" onclick="scrollToPerfume(\'' + slug + '\')">'
          + rankBadge
          + '<div class="collectible-card-inner">'
            + '<div class="collectible-img-wrap">' + imgHTML + '</div>'
            + '<div class="collectible-info">'
              + '<p class="collectible-name">' + p.name + '</p>'
              + quoteHTML
              + '<span class="collectible-badge">' + escapeHTML(SELECCION_BADGE_TEXT) + '</span>'
            + '</div>'
          + '</div>'
        + '</div>';
      });
      grid.innerHTML = html;
    }

    // Pre-renderizar con defaults inmediatamente
    renderSeleccionST();

    function scrollToPerfume(slug) {
      // [JUEGOS-VENTANA] Con la ventana de juegos abierta la página de atrás no se mueve: el perfume se ve en
      // su detalle, encima de la ventana (pasa desde «Similares» de un detalle abierto desde un resultado).
      if (juegosAbierto) { openBottomSheet(slug); return; }
      trackEvent('view_product', { slug: slug, meta: { source: 'scrollTo' } });
      // Limpiar TODOS los filtros para que la card sea visible
      currentFilter = 'all';
      filterNewActive = false;
      currentSearch = '';
      currentNoteFilter = '';
      currentOccasion = '';
      priceFilterActive = false;
      document.getElementById('searchInput').value = '';
      document.getElementById('searchClear').classList.remove('visible');
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      var allBtn = document.querySelector('.filter-btn');
      if (allBtn) allBtn.classList.add('active');
      document.querySelectorAll('.note-chip').forEach(function(c) { c.classList.remove('active'); });
      var occasionToggle = document.getElementById('occasionToggle');
      if (occasionToggle) occasionToggle.classList.remove('active');
      var labelDia = document.getElementById('labelDia');
      var labelNoche = document.getElementById('labelNoche');
      if (labelDia) labelDia.classList.remove('active');
      if (labelNoche) labelNoche.classList.remove('active');
      updatePriceExpandBtn();

      // [VER-MAS] decisión 73 · Mostrar las cards HASTA la buscada (su posición con los filtros ya
      // limpios), no las 146: sin scroll infinito, eso volvía a alargar la grilla y dejaba el pie lejos.
      // «Ver más» sigue desde ahí. Nunca achica lo que ya estaba a la vista.
      var enOrden = Array.prototype.filter.call(document.querySelectorAll('.product-card'), function(c) { return matchesCat(c.dataset.cat, 'all'); });
      var pos = -1;
      for (var i = 0; i < enOrden.length; i++) { if (enOrden[i].dataset.slug === slug) { pos = i; break; } }
      if (pos + 1 > cardsShown) cardsShown = pos + 1;
      applyCardVisibility();

      var card = document.querySelector('.product-card[data-slug="' + slug + '"]');
      if (card) {
        setTimeout(function() {
          // [SALTO-CARD-CENTRO] decisión 83: en el celu la card (614-660 px) más su scroll-margin de 243 no entra
          // centrada y quedaba tapada 5-6 px; con 'start' arranca 6 px debajo de la barra. En escritorio, 'center'.
          var bloque = window.matchMedia('(max-width: 767px)').matches ? 'start' : 'center';
          card.scrollIntoView({ behavior: 'smooth', block: bloque });
          // Mientras baja, las cards que se van mostrando cambian de alto y el destino que el navegador fijó al arrancar
          // queda corrido (12-13 px medidos a 390, en los dos sentidos según el alto de la card). Cuando el scroll se
          // queda quieto, se vuelve a apuntar sin animación, salvo que la persona haya tocado, scrolleado o usado el teclado.
          var tocado = false, marcar = function() { tocado = true; }, gestos = ['wheel', 'touchstart', 'keydown', 'mousedown'];
          gestos.forEach(function(t) { window.addEventListener(t, marcar, { passive: true, capture: true }); });
          var ultimo = -1, quieto = 0, pasos = 0;
          var reapuntar = setInterval(function() {
            var y = Math.round(window.pageYOffset);
            quieto = y === ultimo ? quieto + 1 : 0; ultimo = y; pasos++;
            if (quieto < 2 && pasos <= 40) return;
            clearInterval(reapuntar);
            gestos.forEach(function(t) { window.removeEventListener(t, marcar, { capture: true }); });
            if (!tocado) card.scrollIntoView({ behavior: 'instant', block: bloque });
          }, 100);
          card.style.boxShadow = '0 0 0 3px var(--amarillo), 0 8px 30px rgba(232,184,0,.3)';
          card.style.transition = 'box-shadow .3s';
          setTimeout(function() { card.style.boxShadow = ''; }, 3000);
        }, 100);
      }
    }

    // ============================================================
    // PACKS & SETS
    // ============================================================
    function renderSets() {
      var grid = document.getElementById('setsGrid');
      if (!grid) return;
      var section = document.getElementById('setsSection');
      var sets = PERFUMES.filter(function(p) { return p.esSet; });

      // Filtrar combos ROTOS: si cualquier item apunta a un perfume eliminado
      // (_oculto=true), no mostramos el combo. Se ve marcado en el admin como
      // "ROTO" para que el dueño lo edite. Evita mostrar combos con un item
      // faltante o con precio desactualizado.
      sets = sets.filter(function(s) {
        var items = s.items || [];
        return items.every(function(item) {
          if (!item.slug) return true; // item custom sin slug — lo dejamos pasar
          var ref = PERFUMES.find(function(pf) { return pf.slug === item.slug; });
          // Si el slug existe pero está oculto → combo roto.
          // Si el slug no existe en PERFUMES → asumimos item custom válido (no romper).
          return !ref || !ref._oculto;
        });
      });

      if (sets.length === 0) {
        if (section) section.style.display = 'none';
        return;
      }
      // Mostrar la sección si hay combos (puede haber sido ocultada en un render previo
      // cuando los combos todavía no habían llegado de Supabase)
      if (section) section.style.display = '';
      var html = '';
      sets.forEach(function(s) {
        var items = s.items || [];
        var itemCount = items.length;
        var hasOwnPhoto = !!(s.foto && s.foto.trim());
        // Si el combo tiene foto propia, usamos clase hero; si no, grid de items
        var itemsClass = hasOwnPhoto ? 'items-hero' : ('items-' + (itemCount > 4 ? 4 : itemCount));

        // Build image slots
        var imgsHTML = '';
        if (hasOwnPhoto) {
          // Una sola foto grande del combo completo
          var fotoCombo = s.foto.replace(/ /g, '%20');
          imgsHTML = '<div class="set-img-slot set-img-hero"><img src="' + fotoCombo + '" alt="' + s.name + '" loading="lazy" decoding="async"></div>';
        } else {
          // Fallback: grid con la foto de cada perfume-item
          items.forEach(function(item) {
            var ref = item.slug ? PERFUMES.find(function(pf) { return pf.slug === item.slug; }) : null;
            var foto = ref && ref.foto ? ref.foto.replace(/ /g, '%20') : '';
            var nombre = item.nombre || (ref ? ref.name : '?');
            if (foto) {
              imgsHTML += '<div class="set-img-slot"><img src="' + foto + '" alt="' + nombre + '" loading="lazy" decoding="async"></div>';
            } else {
              imgsHTML += '<div class="set-img-slot"><span class="set-img-letter">' + nombre.charAt(0) + '</span></div>';
            }
          });
        }

        // Build items list
        var listHTML = '';
        items.forEach(function(item) {
          var ref = item.slug ? PERFUMES.find(function(pf) { return pf.slug === item.slug; }) : null;
          var nombre = item.nombre || (ref ? ref.name : '?');
          var mlText = item.ml ? ' (' + item.ml + 'ml)' : '';
          listHTML += '<li>' + nombre + mlText + '</li>';
        });

        // Pricing
        var promoHTML = s.promo ? formatPrice(s.promo) : formatPrice(s.price);
        var origHTML = s.promo ? formatPrice(s.price) : '';
        var ahorroHTML = '';
        if (s.promo && s.price) {
          var ahorro = parseFloat(String(s.price).replace(/[^0-9.\-]/g, '')) - parseFloat(String(s.promo).replace(/[^0-9.\-]/g, ''));
          if (ahorro > 0) {
            ahorroHTML = '<span style="font-size:.6rem;font-weight:700;color:#2ecc71;background:rgba(46,204,113,.1);padding:.15rem .4rem;border-radius:3px;">Ahorrás ' + formatPrice(ahorro) + '</span>';
          }
        }

        // Badge text
        var badgeText = 'SET x' + itemCount;
        if (s.setTipo === 'regalo') badgeText = '\uD83C\uDF81 IDEAL PARA REGALAR';
        if (s.setTipo === 'mini-collection') badgeText = 'MINI x' + itemCount;

        var setPaused = s._stockStatus === 'pausado';
        html += '<div class="set-card" style="' + (setPaused ? 'opacity:.45;pointer-events:none;position:relative;' : '') + '">'
          + (setPaused ? '<span class="badge-proximamente">Próximamente</span>' : '')
          + '<div class="set-images ' + itemsClass + '">' + imgsHTML + '</div>'
          + '<div class="set-info">'
            + '<span class="set-badge">' + badgeText + '</span>'
            + '<p class="set-name">' + s.name + '</p>'
            + '<ul class="set-items-list">' + listHTML + '</ul>'
            + '<div class="set-pricing">'
              + '<span class="set-price-promo">' + promoHTML + '</span>'
              + (origHTML ? '<span class="set-price-original">' + origHTML + '</span>' : '')
            + '</div>'
            + ahorroHTML
            + (setPaused ? '' : '<a href="https://wa.me/5492975416017?text=' + encodeURIComponent(buildWaMessage([s], '')) + '" target="_blank" class="set-cta">Consultar &#8594;</a>')
          + '</div>'
        + '</div>';
      });
      grid.innerHTML = html;
    }

    function scrollSets(dir) {
      var grid = document.getElementById('setsGrid');
      if (!grid) return;
      var cardWidth = grid.querySelector('.set-card') ? grid.querySelector('.set-card').offsetWidth + 16 : 400;
      grid.scrollBy({ left: dir * cardWidth, behavior: 'smooth' });
    }

    // ============================================================
    // VER SIMILARES — Busca perfumes parecidos por notas
    //
    // ¿Cómo funciona?
    // 1. Toma un perfume y extrae TODAS sus notas (salida, corazón, base)
    // 2. Compara esas notas con las de CADA OTRO perfume del catálogo
    // 3. Cuenta cuántas notas tienen en común
    // 4. Calcula un porcentaje: (notas en común / total notas del original) × 100
    // 5. Solo muestra los que tengan MÁS DEL 60% de coincidencia
    // 6. Devuelve los 5 mejores resultados, ordenados de mayor a menor
    // ============================================================

    // getNotas: extrae todas las notas de un perfume y las junta en un array
    // Ejemplo: si un perfume tiene notas_salida="bergamota, limón" y
    //          notas_corazon="rosa, jazmín", devuelve:
    //          ["bergamota", "limón", "rosa", "jazmín"]
    function getNotas(p) {
      var all = [];
      // Recorre los 3 tipos de notas: salida, corazón y base
      [p.notas_salida, p.notas_corazon, p.notas_base].forEach(function(n) {
        if (!n) return;  // si no tiene esa nota, saltear
        // Separa por comas y limpia cada una
        n.split(',').forEach(function(s) {
          var nota = s.trim().toLowerCase();  // "  Bergamota " → "bergamota"
          if (nota) all.push(nota);
        });
      });
      return all;
    }

    // ────────────────────────────────────────────────────────────────
    // [SIMILARES-C+D+A] Helpers para el modal "Ver similares" iter 2026.
    // Reglas de UI:
    //   - 🏆 Mejor match: solo el #1 absoluto de la lista
    //   - 💎 Misma casa: marca_real coincide con el anchor
    //   - 🎯 Mismo perfil: perfil coincide Y pct ≥ 75 ("condición fuerte")
    //   - 🔥 El más elegido: está en TOP_VENTAS_SLUGS[0..2]
    //   - Max 2 badges por item · prioridad: best > elegido > casa > perfil
    // ────────────────────────────────────────────────────────────────

    // getCommonNotesList: notas que comparten 2 perfumes, capitalizadas, sin dupes.
    function getCommonNotesList(p1, p2) {
      var n1 = getNotas(p1);
      var n2 = getNotas(p2);
      var seen = {};
      var common = [];
      n1.forEach(function(n) {
        if (n2.indexOf(n) !== -1 && !seen[n]) {
          seen[n] = true;
          common.push(n.charAt(0).toUpperCase() + n.slice(1));
        }
      });
      return common;
    }

    // getMatchPct: % de notas del anchor que están en el similar. Mismo cálculo
    // que findSimilares usa internamente, pero aislado para reuso.
    function getMatchPct(anchorPerfume, similarPerfume) {
      var n1 = getNotas(anchorPerfume);
      if (n1.length === 0) return 0;
      var n2 = getNotas(similarPerfume);
      var shared = 0;
      n1.forEach(function(n) { if (n2.indexOf(n) !== -1) shared++; });
      return Math.round((shared / n1.length) * 100);
    }

    // getSimilarityBadges: devuelve hasta 2 badges para mostrar en el item.
    // Solo agrega badges cuando la condición es FUERTE (regla del jefe):
    // sino el cliente ve un mar de badges y pierde el "wow".
    function getSimilarityBadges(anchorPerfume, similarPerfume, pct, isBest, topElegidosSlugs) {
      var badges = [];
      // 🏆 Mejor match — solo el #1 absoluto
      if (isBest) {
        badges.push({ ico: '🏆', label: 'Mejor match', cls: 'b-best' });
      }
      // 🔥 El más elegido — top 3 ventas del mes (TOP_VENTAS_SLUGS)
      if (topElegidosSlugs && topElegidosSlugs.indexOf(similarPerfume.slug) !== -1) {
        badges.push({ ico: '🔥', label: 'El más elegido', cls: 'b-elegido' });
      }
      // 💎 Misma casa — marca_real coincide
      if (similarPerfume.marca_real && anchorPerfume.marca_real &&
          similarPerfume.marca_real === anchorPerfume.marca_real) {
        badges.push({ ico: '💎', label: 'Misma casa', cls: 'b-casa' });
      }
      // 🎯 Mismo perfil — SOLO si además pct >= 75 (condición fuerte)
      if (similarPerfume.perfil && anchorPerfume.perfil &&
          similarPerfume.perfil === anchorPerfume.perfil && pct >= 75) {
        badges.push({ ico: '🎯', label: 'Mismo perfil', cls: 'b-perfil' });
      }
      // Max 2 badges — el orden de inserción ya es la prioridad correcta.
      return badges.slice(0, 2);
    }

    // compareSimilar: handler del botón "⚖ Comparar" en cada similar.
    // Agrega ANCHOR + SIMILAR a compareList (rotando si está lleno) y cierra
    // el modal de Similares. Después el cliente toca el botón grande de la
    // compare-bar flotante y abre el modal Compare V2 (con Diferencias + Elegir este).
    function compareSimilar(anchorSlug, similarSlug, event) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      function addToCompare(slug) {
        if (compareList.indexOf(slug) !== -1) return;
        if (compareList.length >= COMPARE_MAX) compareList.shift();
        compareList.push(slug);
      }
      addToCompare(anchorSlug);
      addToCompare(similarSlug);
      // Activar visualmente los compare-btn de las cards correspondientes
      [anchorSlug, similarSlug].forEach(function(s) {
        var btn = document.querySelector('[data-slug="' + s + '"] .compare-btn');
        if (btn) btn.classList.add('active');
      });
      if (typeof updateCompareBar === 'function') updateCompareBar();
      closeSimilares();
    }
    window.compareSimilar = compareSimilar;

    // findSimilares: busca los perfumes más parecidos a uno dado
    // Recibe el "slug" (identificador único) del perfume
    function findSimilares(slug) {
      // Buscar el perfume original en el array PERFUMES
      var perfume = PERFUMES.find(function(p) { return p.slug === slug; });
      if (!perfume) return [];

      // Sacar sus notas
      var notasOrigen = getNotas(perfume);
      if (notasOrigen.length === 0) return [];  // si no tiene notas, no puede comparar

      var scores = [];  // acá se guardan los candidatos

      // Recorrer TODOS los perfumes del catálogo
      PERFUMES.forEach(function(p) {
        // Saltear el mismo perfume, los sets, los ocultos y los pausados
        if (p.slug === slug || p.esSet || p._oculto || p._pausado) return;

        var notasP = getNotas(p);
        if (notasP.length === 0) return;  // sin notas = no se puede comparar

        // Contar cuántas notas del original aparecen en este perfume
        var shared = 0;
        notasOrigen.forEach(function(n) {
          if (notasP.indexOf(n) !== -1) shared++;  // ¡coincide!
        });

        // Solo incluir si hay al menos 1 nota en común Y al menos 45% de match
        if (shared > 0) {
          var pct = Math.round((shared / notasOrigen.length) * 100);
          if (pct >= 45) {
            scores.push({ perfume: p, shared: shared, total: notasOrigen.length });
          }
        }
      });

      // Ordenar: el que más notas comparte primero
      scores.sort(function(a, b) { return b.shared - a.shared; });
      // Devolver máximo 5 resultados
      return scores.slice(0, 5);
    }

    // ────────────────────────────────────────────────────────────────
    // [SIMILARES-C+D+A] buildSimilarItemHTML — versión iter 2026.
    // Render rico de cada similar con: ring de % match + botón comparar
    // + razón humana (chips de notas comunes) + badges premium.
    // opts:
    //   - anchorPerfume   (perfume al que se le piden similares)
    //   - pct             (% de match, 0 si no aplica — caso "manual sin match calculado")
    //   - isBest          (boolean: es el #1 absoluto del modal)
    //   - subtitle        (texto opcional "Recomendado por el equipo" para los manuales)
    //   - topElegidosSlugs (array de top 3 ventas para badge 🔥)
    //   - showRing        (boolean: mostrar ring + razón humana, default true si hay anchor)
    // ────────────────────────────────────────────────────────────────
    function buildSimilarItemHTML(p, opts) {
      opts = opts || {};
      var anchor = opts.anchorPerfume;
      var pct = (opts.pct != null ? opts.pct : (anchor ? getMatchPct(anchor, p) : 0));
      var isBest = !!opts.isBest;
      var subtitle = opts.subtitle || '';
      var topElegidosSlugs = opts.topElegidosSlugs || [];
      var showRing = (opts.showRing !== false) && pct > 0;

      var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
      var letter = p.name.charAt(0);
      var imgHTML = p.foto
        ? '<img src="' + fotoSrc + '" alt="' + p.name + '" loading="lazy" decoding="async">'
        : '<div style="color:var(--amarillo);font-size:1rem;opacity:.4;">' + letter + '</div>';

      // Ring SVG (circunferencia r=20 → 2*π*20 = 125.66)
      var ringHTML = '';
      if (showRing) {
        var CIRC = 125.66;
        var offset = CIRC * (1 - pct / 100);
        var scoreClass = pct >= 85 ? 'score-high' : (pct < 70 ? 'score-low' : 'score-mid');
        ringHTML =
          '<div class="sim-ring-wrap">'
            + '<svg class="sim-ring-svg" width="48" height="48" viewBox="0 0 50 50" aria-hidden="true">'
              + '<circle class="sim-ring-bg-arc" cx="25" cy="25" r="20"></circle>'
              + '<circle class="sim-ring-fg-arc ' + scoreClass + '" cx="25" cy="25" r="20"'
              + ' stroke-dasharray="' + CIRC + '"'
              + ' stroke-dashoffset="' + offset.toFixed(1) + '"></circle>'
            + '</svg>'
            + '<span class="sim-ring-text ' + scoreClass + '">' + pct + '%</span>'
          + '</div>';
      }

      // Razón humana — chips de notas comunes (max 6, +N más si excede)
      var razonHTML = '';
      if (anchor && pct > 0) {
        var common = getCommonNotesList(anchor, p);
        if (common.length > 0) {
          var visible = common.slice(0, 6);
          var moreCount = common.length - visible.length;
          var chips = visible.map(function(n) {
            return '<span class="sim-razon-chip">' + n + '</span>';
          }).join('');
          if (moreCount > 0) {
            chips += '<span class="sim-razon-chip sim-razon-chip-more">+' + moreCount + ' más</span>';
          }
          razonHTML =
            '<div class="sim-razon-humana">'
              + '<span class="sim-razon-label">Coincidencia</span>'
              + '<span class="sim-razon-text">' + chips + '</span>'
            + '</div>';
        }
      }

      // Botón "⚖ Comparar" — solo si tenemos un anchor (sino no tiene sentido)
      var compareBtnHTML = '';
      if (anchor) {
        compareBtnHTML =
          '<button type="button" class="sim-btn-comparar" onclick="compareSimilar(\'' + anchor.slug + '\', \'' + p.slug + '\', event)" aria-label="Comparar con ' + p.name + '">'
            + '<span class="sim-btn-comparar-ico" aria-hidden="true">⚖</span>'
            + '<span class="sim-btn-comparar-text">Comparar</span>'
          + '</button>';
      }

      // Badges premium (max 2 con la regla "condición fuerte")
      var badgesHTML = '';
      if (anchor) {
        var badges = getSimilarityBadges(anchor, p, pct, isBest, topElegidosSlugs);
        if (badges.length > 0) {
          badgesHTML =
            '<div class="sim-badges">'
              + badges.map(function(b) {
                  return '<span class="sim-badge ' + b.cls + '">'
                    + '<span class="sim-badge-ico" aria-hidden="true">' + b.ico + '</span>'
                    + b.label
                  + '</span>';
                }).join('')
            + '</div>';
        }
      }

      // Subtitle "Recomendado por el equipo" o info pasada
      var subtitleHTML = subtitle ? '<p class="similar-rec">' + subtitle + '</p>' : '';
      var bestClass = isBest ? ' is-best' : '';
      // Onclick para navegar al perfume (en zona img + info, NO en ring/botón/badges)
      var navOnclick = 'closeSimilares();scrollToPerfume(\'' + p.slug + '\')';

      return '<div class="similar-item sim-rich' + bestClass + '" data-slug="' + p.slug + '">'
        + '<div class="similar-img" onclick="' + navOnclick + '">' + imgHTML + '</div>'
        + '<div class="similar-info" onclick="' + navOnclick + '">'
          + '<p class="similar-name">' + p.name + '</p>'
          + '<p class="similar-brand">' + (p.marca_real || p.marca) + '</p>'
          + subtitleHTML
        + '</div>'
        + ringHTML
        + compareBtnHTML
        + razonHTML
        + badgesHTML
      + '</div>';
    }

    function showSimilares(slug, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var perfume = PERFUMES.find(function(p) { return p.slug === slug; });
      if (!perfume) return;

      var title = document.getElementById('similaresTitle');
      title.textContent = 'Similares a ' + perfume.name;

      // 1) Nota libre del equipo (SIEMPRE que haya texto).
      var notaEquipo = (perfume.similares_nota || '').trim();

      // 2) Recomendados manuales del equipo — filtramos slugs eliminados
      //    (auto-cleanup: si el admin borra un perfume recomendado, desaparece del modal).
      var recomendadosManuales = Array.isArray(perfume.similares_manuales)
        ? perfume.similares_manuales
            .map(function(s) { return PERFUMES.find(function(pf) { return pf.slug === s; }); })
            .filter(function(p) { return p && !p._oculto && !p._pausado && !p.esSet; })
        : [];

      // 3) Algoritmo por notas (solo si hay >60% match).
      var algoritmicos = findSimilares(slug);
      // Si ya los tenemos en la lista manual, no los duplicamos en la sección algorítmica.
      var manualSlugs = {};
      recomendadosManuales.forEach(function(p) { manualSlugs[p.slug] = true; });
      algoritmicos = algoritmicos.filter(function(s) { return !manualSlugs[s.perfume.slug]; });

      var hasManual = recomendadosManuales.length > 0;
      var hasAuto = algoritmicos.length > 0;
      var hasNota = notaEquipo.length > 0;

      var content = document.getElementById('similaresContent');

      // Caso: nada que mostrar → mensaje fallback "es único".
      if (!hasNota && !hasManual && !hasAuto) {
        content.innerHTML = '<div style="text-align:center;padding:1.5rem .5rem;">'
          + '<p style="font-size:1.8rem;margin-bottom:.6rem;">🔮</p>'
          + '<p style="color:#fff;font-size:.85rem;font-weight:600;margin-bottom:.4rem;">¡Este perfume es único!</p>'
          + '<p style="color:var(--gris);font-size:.72rem;line-height:1.5;">Ningún otro perfume de nuestro catálogo comparte más del 60% de sus notas con <strong style="color:var(--amarillo);">' + perfume.name + '</strong>.</p>'
          + '<p style="color:var(--gris);font-size:.65rem;margin-top:.8rem;opacity:.7;">Estamos sumando nuevas fragancias constantemente 👀</p>'
          + '</div>';
        document.getElementById('similaresOverlay').classList.add('active');
        document.body.style.overflow = 'hidden';
        return;
      }

      var html = '';

      // Sección 1: nota del equipo (amarilla, arriba del todo).
      if (hasNota) {
        // Escape HTML simple para evitar inyección del texto libre del admin.
        var esc = notaEquipo
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        html += '<div class="similares-nota-equipo" style="background:rgba(232,184,0,.08);border-left:3px solid var(--amarillo);padding:.7rem .85rem;border-radius:4px;margin-bottom:.9rem;">'
          + '<p style="font-size:.58rem;font-weight:700;color:var(--amarillo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.35rem;">💬 Nota del equipo ST</p>'
          + '<p style="color:#e8e8e8;font-size:.72rem;line-height:1.5;margin:0;">' + esc + '</p>'
          + '</div>';
      }

      // Sección 2: recomendados manuales (si hay).
      // [SIMILARES-C+D+A] Top 3 ventas para badge "🔥 El más elegido".
      // Si TOP_VENTAS_SLUGS está cargado desde Supabase usamos los primeros 3,
      // sino default seguro vacío (sin badge "más elegido").
      var topElegidos = (typeof TOP_VENTAS_SLUGS !== 'undefined' && Array.isArray(TOP_VENTAS_SLUGS))
        ? TOP_VENTAS_SLUGS.slice(0, 3) : [];

      // [SIMILARES-C+D+A] El "mejor match" (badge 🏆) es:
      //   - El primer manual si hay (el equipo lo destacó manualmente)
      //   - Sino, el primer algorítmico (mayor pct)
      var bestSlug = hasManual ? recomendadosManuales[0].slug
                   : hasAuto ? algoritmicos[0].perfume.slug : null;

      if (hasManual) {
        html += '<p class="similares-section-title" style="font-size:.6rem;font-weight:700;color:var(--amarillo);letter-spacing:.1em;text-transform:uppercase;margin:.3rem 0 .5rem 0;">⭐ Recomendados por ST</p>';
        recomendadosManuales.forEach(function(p) {
          html += buildSimilarItemHTML(p, {
            anchorPerfume: perfume,
            isBest: (p.slug === bestSlug),
            subtitle: 'Recomendado por el equipo',
            topElegidosSlugs: topElegidos,
          });
        });
      }

      // Sección 3: algoritmo por notas (si hay, y si NO se solapa con los manuales).
      if (hasAuto) {
        html += '<p class="similares-section-title" style="font-size:.6rem;font-weight:700;color:var(--gris);letter-spacing:.1em;text-transform:uppercase;margin:' + (hasManual || hasNota ? '1rem' : '.3rem') + ' 0 .5rem 0;">🔬 Similitud por notas</p>';
        algoritmicos.forEach(function(s) {
          var pct = Math.round((s.shared / s.total) * 100);
          html += buildSimilarItemHTML(s.perfume, {
            anchorPerfume: perfume,
            pct: pct,
            isBest: (s.perfume.slug === bestSlug),
            topElegidosSlugs: topElegidos,
          });
        });
      }

      content.innerHTML = html;

      document.getElementById('similaresOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeSimilares(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('similaresOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    // ============================================================
    // MODAL NOTA DE STOCK — (Último / Sin stock / Próximamente)
    // Se abre al tocar una badge que tenga nota cargada por el admin
    // ============================================================
    // Guardamos el slug + estado activos para el botón CTA de WhatsApp.
    var STOCK_NOTE_CURRENT = { slug: null, estado: null, name: null };

    function showStockNote(slug, estado) {
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      var nota = '';
      var label = '';
      var badgeClass = '';
      var ctaLabel = '';
      // "low" (Último) NO tiene modal a propósito: ver comentario en el render de la badge.
      if (estado === 'out')          { nota = p.nota_sin_stock || '';    label = 'Sin stock';    badgeClass = 'badge-estado-sin-stock';    ctaLabel = 'Avisame cuando vuelva'; }
      else if (estado === 'pausado') { nota = p.nota_proximamente || ''; label = 'Próximamente'; badgeClass = 'badge-estado-proximamente'; ctaLabel = 'Reservar por WhatsApp'; }
      if (!nota) return; // no abrir si no hay texto

      STOCK_NOTE_CURRENT = { slug: slug, estado: estado, name: p.name };
      var badgeEl = document.getElementById('stockNoteBadge');
      badgeEl.textContent = label;
      badgeEl.className = 'stocknote-badge ' + badgeClass;
      document.getElementById('stockNotePerfume').textContent = p.name;
      document.getElementById('stockNoteText').textContent = nota;
      document.getElementById('stockNoteCtaLabel').textContent = ctaLabel;
      document.getElementById('stockNoteOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeStockNote(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('stockNoteOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    function stockNoteWhatsApp() {
      var c = STOCK_NOTE_CURRENT;
      if (!c.slug) return;
      var msg;
      if (c.estado === 'out')           msg = 'Hola! Avísenme cuando vuelva a haber stock del ' + c.name + ', por favor.';
      else if (c.estado === 'pausado')  msg = 'Hola! Quiero reservar el ' + c.name + ' con seña para cuando llegue. ¿Cómo hacemos?';
      else                               msg = 'Hola! Consulto por el ' + c.name + '.';
      window.open('https://wa.me/5492975416017?text=' + encodeURIComponent(msg), '_blank');
    }

    // ============================================================
    // BANNER DECANTS — abre WhatsApp con saludo personalizado
    // ============================================================
    function openDecantsBannerWA() {
      var nombre = (currentUser && currentUser.nombre) ? String(currentUser.nombre).trim().split(' ')[0] : '';
      var saludo = nombre ? ('Hola, soy ' + nombre + '!') : 'Hola!';
      var msg = saludo + ' Quisiera saber más información acerca de los decants de diseñador 🤩';
      window.open('https://wa.me/5492975416017?text=' + encodeURIComponent(msg), '_blank');
    }
    window.openDecantsBannerWA = openDecantsBannerWA;

    // ============================================================
    // COMPARTIR PERFUME
    // ============================================================
    function sharePerfume(slug, btn, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      var url = 'https://www.stperfumeria.com/perfume/' + slug;
      // FIX duplicado: NO incluir la URL en el text — Android la duplica
      // porque ya la pasamos como `url`. Quedan dos veces en el preview.
      var text = p.name + ' — ST Perfumería' + (p.notas_salida ? '\nNotas: ' + p.notas_salida : '');

      if (navigator.share) {
        navigator.share({ title: p.name + ' — ST Perfumería', text: text, url: url }).catch(function(){});
      } else {
        navigator.clipboard.writeText(url).then(function() {
          btn.innerHTML = '&#10003; Link copiado';
          btn.classList.add('copied');
          setTimeout(function() { btn.innerHTML = '&#128279; Compartir'; btn.classList.remove('copied'); }, 2000);
        });
      }
    }

    // ============================================================
    // FILTRO POR NOTA POPULAR
    // ============================================================
    var currentNoteFilter = '';
    var currentOccasion = ''; // '' = todos, 'dia' = Fresco+Versátil, 'noche' = Intenso+Dulce
    var POPULAR_NOTES = ['Vainilla','Ámbar','Pachulí','Sándalo','Oud','Cedro','Jazmín','Rosa','Almizcle','Canela','Bergamota','Haba Tonka'];

    function renderNoteFilters() {
      var wrap = document.getElementById('noteFilterWrap');
      if (!wrap) return;
      var html = '';
      POPULAR_NOTES.forEach(function(note) {
        html += '<button class="note-chip" onclick="toggleNoteFilter(\'' + note + '\', this)">' + note + '</button>';
      });
      wrap.innerHTML = html;
    }

    function toggleNoteFilter(note, btn) {
      if (currentNoteFilter === note) {
        currentNoteFilter = '';
        btn.classList.remove('active');
      } else {
        currentNoteFilter = note;
        document.querySelectorAll('.note-chip').forEach(function(c) { c.classList.remove('active'); });
        btn.classList.add('active');
      }
      applyFilters();
      if (typeof updateFiltersInURL === 'function') updateFiltersInURL();
    }

    // Actualiza el hint explicativo del toggle OCASIÓN para que el usuario
    // sepa qué está filtrando (muchos clickean y sienten que no pasa nada).
    function updateOccasionHint() {
      var hint = document.getElementById('occasionHint');
      if (!hint) return;
      if (currentOccasion === 'dia') {
        hint.textContent = '☀️ Frescos, cítricos y versátiles';
        hint.classList.add('visible');
      } else if (currentOccasion === 'noche') {
        hint.textContent = '🌙 Intensos, dulces y orientales';
        hint.classList.add('visible');
      } else {
        hint.classList.remove('visible');
        // El texto se mantiene para que el fade-out sea prolijo
      }
    }

    // Toggle Noche/Día (3 estados: off → día → noche → off)
    function toggleOccasion() {
      var toggle = document.getElementById('occasionToggle');
      var labelDia = document.getElementById('labelDia');
      var labelNoche = document.getElementById('labelNoche');

      if (currentOccasion === '') {
        // Off → Noche
        currentOccasion = 'noche';
        toggle.classList.add('active');
        labelDia.classList.remove('active');
        labelNoche.classList.add('active');
      } else if (currentOccasion === 'noche') {
        // Noche → off
        currentOccasion = '';
        toggle.classList.remove('active');
        labelDia.classList.remove('active');
        labelNoche.classList.remove('active');
      }
      updateOccasionHint();
      applyFilters();
    }

    // Labels clickeables directos
    function setOccasion(mode) {
      var toggle = document.getElementById('occasionToggle');
      var labelDia = document.getElementById('labelDia');
      var labelNoche = document.getElementById('labelNoche');

      if (currentOccasion === mode) {
        currentOccasion = '';
        toggle.classList.remove('active');
        labelDia.classList.remove('active');
        labelNoche.classList.remove('active');
      } else {
        currentOccasion = mode;
        toggle.classList.toggle('active', mode === 'noche');
        labelDia.classList.toggle('active', mode === 'dia');
        labelNoche.classList.toggle('active', mode === 'noche');
      }
      updateOccasionHint();
      applyFilters();
      if (typeof updateFiltersInURL === 'function') updateFiltersInURL();
    }

    // ============================================================
    // FILTRO POR RANGO DE PRECIO
    // ============================================================
    var priceFilterMin = 0;
    var priceFilterMax = 200000;
    var priceFilterActive = false;

    function initPriceSlider() {
      // Calcular min/max reales del catálogo
      var prices = PERFUMES.filter(function(p) { return !p.esSet && !p._oculto && !p._pausado; }).map(function(p) {
        return p.promo ? parseFloat(String(p.promo).replace(/,/g, '')) : parseFloat(String(p.price).replace(/,/g, ''));
      }).filter(function(n) { return !isNaN(n) && n > 0; });

      if (prices.length === 0) return;
      var minP = Math.floor(Math.min.apply(null, prices) / 5000) * 5000;
      var maxP = Math.ceil(Math.max.apply(null, prices) / 5000) * 5000;

      var minInput = document.getElementById('priceRangeMin');
      var maxInput = document.getElementById('priceRangeMax');
      minInput.min = minP; minInput.max = maxP; minInput.value = minP;
      maxInput.min = minP; maxInput.max = maxP; maxInput.value = maxP;

      priceFilterMin = minP;
      priceFilterMax = maxP;
      updatePriceLabels();
      updatePriceSliderFill();
    }

    function togglePricePanel() {
      var wrap = document.getElementById('priceFilterWrap');
      var btn = document.getElementById('priceExpandBtn');
      var isOpen = wrap.classList.contains('open');
      wrap.classList.toggle('open');
      btn.classList.toggle('open');
      btn.innerHTML = isOpen ? '&#128176; Precio \u25be' : '&#128176; Precio \u25b4';
      if (!isOpen) initPriceSlider();
    }

    function onPriceSlider() {
      var minInput = document.getElementById('priceRangeMin');
      var maxInput = document.getElementById('priceRangeMax');
      var minVal = parseInt(minInput.value);
      var maxVal = parseInt(maxInput.value);

      // No permitir que se crucen
      if (minVal > maxVal - 5000) {
        if (this === minInput || event.target === minInput) {
          minInput.value = maxVal - 5000;
          minVal = maxVal - 5000;
        } else {
          maxInput.value = minVal + 5000;
          maxVal = minVal + 5000;
        }
      }

      priceFilterMin = minVal;
      priceFilterMax = maxVal;
      priceFilterActive = true;

      updatePriceLabels();
      updatePriceSliderFill();
      updatePriceExpandBtn();
      applyFilters();
    }

    function updatePriceLabels() {
      document.getElementById('priceMinLabel').textContent = '$' + priceFilterMin.toLocaleString('es-AR').replace(/,/g, '.');
      document.getElementById('priceMaxLabel').textContent = '$' + priceFilterMax.toLocaleString('es-AR').replace(/,/g, '.');
    }

    function updatePriceSliderFill() {
      var minInput = document.getElementById('priceRangeMin');
      var maxInput = document.getElementById('priceRangeMax');
      var min = parseInt(minInput.min);
      var max = parseInt(minInput.max);
      var range = max - min;
      if (range <= 0) return;
      var left = ((priceFilterMin - min) / range) * 100;
      var right = ((priceFilterMax - min) / range) * 100;
      var fill = document.getElementById('priceSliderFill');
      fill.style.left = left + '%';
      fill.style.width = (right - left) + '%';
    }

    function updatePriceExpandBtn() {
      var btn = document.getElementById('priceExpandBtn');
      if (priceFilterActive) {
        btn.classList.add('has-filter');
      } else {
        btn.classList.remove('has-filter');
      }
    }

    function clearPriceFilter() {
      priceFilterActive = false;
      initPriceSlider();
      updatePriceExpandBtn();
      applyFilters();
    }

    // Toggle panel de notas
    function toggleNotesPanel() {
      var wrap = document.getElementById('noteFilterWrap');
      var btn = document.getElementById('notesExpandBtn');
      var isOpen = wrap.classList.contains('open');
      wrap.classList.toggle('open');
      btn.classList.toggle('open');
      btn.innerHTML = isOpen ? '🎵 Notas ▾' : '🎵 Notas ▴';
    }

    // ============================================================
    // VIEWS — cargar contadores desde Supabase
    // ============================================================
    var perfumeViews = {};

    async function loadPerfumeViews() {
      try {
        var { data, error } = await sb.rpc('perfume_clicks_resumen');
        if (error) {
          console.warn('[views] Error leyendo perfume_clicks_resumen:', error.message);
          return;
        }
        if (data) {
          data.forEach(function(r) { perfumeViews[r.slug] = r.clicks; });
          if (data.length === 0) {
            console.warn('[views] perfume_clicks_resumen no devolvió datos. El ordenar por visitados usará tiebreaker alfabético.');
          }
        }
      } catch(e) {
        console.warn('[views] Excepción leyendo perfume_clicks_resumen:', e);
      }
    }

    // ============================================================
    // MARCAR PERFUMES NUEVOS (últimos 10 del array)
    // ============================================================
    function markNewPerfumes() {
      var nonSet = PERFUMES.filter(function(p) { return !p.esSet && !p._oculto && !p._pausado; });
      var last10 = nonSet.slice(-10);
      last10.forEach(function(p) { p._isNew = true; });
    }

    // ============================================================
    // DEEP LINK — Enlaces directos a un perfume
    //
    // Si alguien comparte un link como:
    //   stperfumeria.com/?p=khamrah
    // el sitio se abre y scrollea automáticamente hasta ese perfume.
    //
    // URLSearchParams lee los parámetros de la URL (lo que va después de ?)
    // El setTimeout de 500ms es para darle tiempo al catálogo a renderizar
    // ============================================================
    function checkDeepLink() {
      var params = new URLSearchParams(window.location.search);
      var slug = params.get('p') || params.get('perfume');
      if (slug) {
        setTimeout(function() { scrollToPerfume(slug); }, 500);
      }
    }

    // renderCatalog: función PRINCIPAL que dibuja todas las cards en pantalla
    // Se ejecuta una sola vez al cargar los datos de Supabase.
    // Después, la visibilidad de cada card se controla con applyCardVisibility()
    function renderCatalog() {
      const grid = document.getElementById('catalogGrid');
      // 1. Filtrar: solo perfumes individuales (no sets/combos)
      // 2. Mapear: convertir cada perfume a HTML con buildCard()
      // 3. Join: unir todo el HTML en un solo string
      // Excluir: sets/combos (tienen su sección propia) y perfumes ocultos por el admin
      // Defensivo: si un perfume tira error en buildCard (p.ej. name undefined),
      // lo saltamos en vez de romper el render entero. Antes una sola card mala
      // dejaba toda la grilla vacía.
      var cardsHTML = '';
      var failedCount = 0;
      PERFUMES.forEach(function(p) {
        // [PAUSADO-OCULTO] los pausados no salen en el catálogo público
        if (p.esSet || p._oculto || p._pausado) return;
        try {
          cardsHTML += buildCard(p);
        } catch(e) {
          failedCount++;
          console.warn('[renderCatalog] saltado:', p && p.slug, e && e.message);
        }
      });
      grid.innerHTML = cardsHTML;
      // [LCP-PRELOAD] Boost al loading de la PRIMERA imagen visible
      // del catálogo — es el LCP candidato más probable en mobile.
      // Cambia loading="lazy" → "eager" + fetchpriority="high" en la 1ra card.
      try {
        var firstImg = grid.querySelector('.product-card img');
        if (firstImg) {
          firstImg.removeAttribute('loading');
          firstImg.setAttribute('fetchpriority', 'high');
        }
      } catch(e) {}
      if (failedCount > 0) console.warn('[renderCatalog] cards saltadas por error:', failedCount);

      cardsShown = CARDS_INITIAL;    // mostrar solo las primeras N cards
      // Cada paso aislado: si falla uno, los demás siguen funcionando.
      try { applyCardVisibility(); } catch(e) { console.warn('[renderCatalog] applyCardVisibility:', e); }
      try { updateFavBadge(); }      catch(e) { console.warn('[renderCatalog] updateFavBadge:', e); }
      try { renderSeleccionST(); }   catch(e) { console.warn('[renderCatalog] renderSeleccionST:', e); }
      try { renderSets(); }          catch(e) { console.warn('[renderCatalog] renderSets:', e); }
      try { renderNoteFilters(); }   catch(e) { console.warn('[renderCatalog] renderNoteFilters:', e); }
      try { initGalleryAutoplay(); } catch(e) { console.warn('[renderCatalog] initGalleryAutoplay:', e); }
      try { initCardBgLazy(); }      catch(e) { console.warn('[renderCatalog] initCardBgLazy:', e); }
      try { initCardFadeIn(); }      catch(e) { console.warn('[renderCatalog] initCardFadeIn:', e); }
      try { renderRecentViews(); }   catch(e) { console.warn('[renderCatalog] renderRecentViews:', e); }
      // Default sort: precio descendente (más caro primero) — siempre.
      try { sortCards('price-desc'); } catch(e) { console.warn('[renderCatalog] sortCards:', e); }
    }

    // ============================================================
    // AUTOPLAY DE FOTOS EN CARDS — solo desktop
    //
    // Por cada .product-card con 2+ fotos, rotamos la galeria sola cada
    // GALLERY_AUTOPLAY_MS. Reglas:
    //   - Solo desktop (>= 768px). Mobile queda con el slider manual.
    //   - Solo mientras la card esta visible en el viewport
    //     (IntersectionObserver) — si esta abajo del fold no gastamos CPU.
    //   - Pausa al hover, retoma al mouseleave. Asi el usuario puede parar
    //     a mirar una foto y el autoplay no le pisa el click manual.
    //   - Pausa si la pestania esta oculta (visibilitychange).
    //   - Respeta prefers-reduced-motion — si el usuario tiene animaciones
    //     reducidas en el SO, no autoplay.
    //
    // Se re-ejecuta despues de cada re-render (renderCatalog). Para cards
    // nuevas llamar a initGalleryAutoplay() de nuevo; los timers viejos se
    // descartan porque los guardamos en el DOM element (no en globales).
    // ============================================================
    var GALLERY_AUTOPLAY_MS = 3500;
    var _galleryObserver = null;

    // ============================================================
    // LAZY BACKDROP BLUR — initCardBgLazy
    //
    // Cada .card-gallery-slide tiene la foto como data-bg (NO inline
    // como style="background-image:..." porque eso bypassea cualquier
    // lazy y el browser pedía las 162 fotos de golpe al cargar).
    //
    // IntersectionObserver activa el background cuando la card está a
    // 300px de entrar al viewport. Una vez aplicado, se desconecta el
    // observer para esa card (single-shot).
    //
    // Resultado en mobile: las primeras 1-2 cards visibles cargan su
    // backdrop al inicio; el resto se carga a medida que scrolleás.
    // ============================================================
    // ============================================================
    // FADE-IN ON SCROLL — initCardFadeIn
    //
    // Cada .product-card arranca con opacity:0 + translateY(20px) (CSS).
    // Cuando entra al viewport, IO le agrega .is-visible → fade-in
    // suave (550ms) con stagger en las primeras 6 (efecto cascade).
    //
    // Acompaña al backdrop blur lazy: ambos observers corren juntos
    // pero independientes.
    // ============================================================
    var _cardFadeObserver = null;
    function initCardFadeIn() {
      if (_cardFadeObserver) { try { _cardFadeObserver.disconnect(); } catch(_){} }
      // Si el user pidió reduced-motion, mostrar todas directo
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.querySelectorAll('.product-card:not(.is-visible)').forEach(function(c) {
          c.classList.add('is-visible');
        });
        return;
      }
      // Sin IO: mostrar todas directo (fallback)
      if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.product-card:not(.is-visible)').forEach(function(c) {
          c.classList.add('is-visible');
        });
        return;
      }
      _cardFadeObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          _cardFadeObserver.unobserve(entry.target); // single-shot
        });
      }, { rootMargin: '0px 0px -80px 0px', threshold: 0.05 });
      document.querySelectorAll('.product-card:not(.is-visible)').forEach(function(c) {
        _cardFadeObserver.observe(c);
      });
    }

    var _cardBgObserver = null;
    function initCardBgLazy() {
      // Cleanup observer anterior (si renderCatalog se re-invocó)
      if (_cardBgObserver) { try { _cardBgObserver.disconnect(); } catch(_){} }

      var slides = document.querySelectorAll('.card-gallery-slide[data-bg]:not([data-bg-applied])');
      if (!slides.length) return;

      // Fallback: si no hay IntersectionObserver, aplicar todos directo
      if (!('IntersectionObserver' in window)) {
        slides.forEach(function(slide) {
          var url = slide.getAttribute('data-bg');
          if (url) {
            slide.style.backgroundImage = "url('" + url.replace(/&quot;/g, '"') + "')";
            slide.setAttribute('data-bg-applied', '1');
          }
        });
        return;
      }

      _cardBgObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var url = el.getAttribute('data-bg');
          if (url && !el.hasAttribute('data-bg-applied')) {
            el.style.backgroundImage = "url('" + url.replace(/&quot;/g, '"') + "')";
            el.setAttribute('data-bg-applied', '1');
          }
          _cardBgObserver.unobserve(el);
        });
      }, { rootMargin: '300px 0px' });

      slides.forEach(function(slide) { _cardBgObserver.observe(slide); });
    }

    function initGalleryAutoplay() {
      if (window.innerWidth < 768) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      // Rearmar observer desde cero (las cards viejas ya se eliminaron del DOM,
      // asi que sus entries se descartan solas al no estar observadas mas).
      if (_galleryObserver) _galleryObserver.disconnect();
      _galleryObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          var card = entry.target;
          if (entry.isIntersecting) {
            _galleryStart(card);
          } else {
            _galleryStop(card);
          }
        });
      }, { threshold: 0.35 });

      var cards = document.querySelectorAll('.product-card');
      cards.forEach(function(card) {
        var gallery = card.querySelector('.card-gallery');
        if (!gallery) return;
        var slides = gallery.querySelectorAll('.card-gallery-slide');
        if (slides.length < 2) return;

        // Idempotente: si la card ya estaba enganchada, no duplicar listeners
        if (card._galleryAutoplayWired) {
          _galleryObserver.observe(card);
          return;
        }
        card._galleryAutoplayWired = true;
        card._galleryTimer = null;
        card._galleryHovered = false;

        card.addEventListener('mouseenter', function() {
          card._galleryHovered = true;
          _galleryStop(card);
        });
        card.addEventListener('mouseleave', function() {
          card._galleryHovered = false;
          // Solo reanudar si la card todavia esta en viewport
          if (card._galleryInView) _galleryStart(card);
        });

        _galleryObserver.observe(card);
      });
    }

    function _galleryStart(card) {
      card._galleryInView = true;
      if (card._galleryHovered) return;      // hover manda, no pisarlo
      if (card._galleryTimer) return;         // ya andando
      var gallery = card.querySelector('.card-gallery');
      if (!gallery) return;
      var slides = gallery.querySelectorAll('.card-gallery-slide');
      if (slides.length < 2) return;

      card._galleryTimer = setInterval(function() {
        if (document.hidden) return; // pausa mientras la pestania esta oculta
        var slideWidth = slides[0].offsetWidth;
        if (!slideWidth) return;
        var currentIdx = Math.round(gallery.scrollLeft / slideWidth);
        var nextIdx = (currentIdx + 1) % slides.length;
        gallery.scrollTo({ left: nextIdx * slideWidth, behavior: 'smooth' });
      }, GALLERY_AUTOPLAY_MS);
    }

    function _galleryStop(card) {
      card._galleryInView = false;
      if (card._galleryTimer) {
        clearInterval(card._galleryTimer);
        card._galleryTimer = null;
      }
    }

    // Pausar / reanudar globalmente segun visibilidad del tab. No necesito
    // clearInterval porque el tick checkea document.hidden internamente;
    // esto es solo un re-kick al volver por si el scroll no se movio.
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden && _galleryObserver) {
        // Nada que hacer: los intervals ya estan andando, solo dejan de
        // scrollear mientras document.hidden sea true.
      }
    });

    // Event delegation — Patrón de rendimiento importante
    // En vez de poner un listener en CADA card (podrían ser 200+),
    // ponemos UNO SOLO en el grid contenedor. Cuando ocurre un evento,
    // "sube" (bubbling) hasta el grid y ahí lo capturamos.
    // Esto es mucho más eficiente y no se rompe al re-renderizar.
    (function() {
      var tracked = {};  // registro de qué cards ya se trackearon
      var grid = document.getElementById('catalogGrid');
      function handleTrack(e) {
        var card = e.target.closest('.product-card'); // buscar la card padre
        if (!card) return;
        var slug = card.dataset.slug;
        // Solo trackear la primera vez que el usuario interactúa
        if (!tracked[slug]) { tracked[slug] = true; trackClick(slug); }
      }
      grid.addEventListener('mouseenter', handleTrack, true);       // desktop: mouse
      grid.addEventListener('touchstart', handleTrack, { passive: true, capture: true }); // mobile: touch

      // Click en card → abrir bottom sheet (mobile)
      grid.addEventListener('click', function(e) {
        // No abrir si el click fue en un botón, link, o input dentro de la card
        if (e.target.closest('button, a, input, .fav-heart, .compare-btn, .cart-add-btn, .reveal-share, .waitlist-btn')) return;
        var card = e.target.closest('.product-card');
        if (!card) return;
        var slug = card.dataset.slug;
        if (slug && typeof openBottomSheet === 'function') {
          openBottomSheet(slug);
        }
      });
    })();

    // applyCardVisibility: el "cerebro" del filtrado
    //
    // Esta función decide qué cards se VEN y cuáles se OCULTAN.
    // Se ejecuta cada vez que el usuario:
    //   - Busca algo en el buscador
    //   - Filtra por categoría (Hombre/Mujer/Unisex)
    //   - Filtra por nota olfativa
    //   - Filtra por ocasión
    //   - Toca "Ver favoritos"
    //
    // Para que una card se muestre, tiene que pasar TODOS los filtros:
    //   ✅ categoría correcta (catMatch)
    //   ✅ coincide con búsqueda (searchMatch)
    //   ✅ tiene la nota seleccionada (noteMatch)
    //   ✅ es para la ocasión elegida (occasionMatch)
    //
    // Además controla el "Ver más": solo muestra las primeras N cards
    function applyCardVisibility() {
      var cards = document.querySelectorAll('.product-card');
      var matchIndex = 0;   // contador de cards que matchean
      var totalMatch = 0;   // total de cards que pasan todos los filtros
      var _cardsToReAnimate = []; // [BATCH-REFLOW] cards a re-animar (batch al final)
      cards.forEach(function(card) {
        // FILTRO 1: Categoría (todos / hombre / mujer / unisex / favs)
        var catMatch;
        if (currentFilter === 'favs') {
          catMatch = favs.indexOf(card.dataset.slug) !== -1;
        } else {
          catMatch = matchesCat(card.dataset.cat, currentFilter);
        }
        // FILTRO 1b: Nuevos (combinable con categoría)
        var newMatch = true;
        if (filterNewActive) {
          var pf = PERFUMES.find(function(x) { return x.slug === card.dataset.slug; });
          newMatch = pf && pf._isNew;
        }
        // FILTRO 2: Búsqueda por texto (nombre, marca, notas).
        // Tokenizamos por espacios: cada palabra debe aparecer en el haystack
        // (AND de substrings). Así "citrus fresh" matchea perfumes que tengan
        // ambas palabras aunque no estén seguidas.
        var searchMatch = true;
        if (currentSearch) {
          var _hay = card.dataset.search;
          var _toks = currentSearch.split(/\s+/);
          for (var _t = 0; _t < _toks.length; _t++) {
            if (_toks[_t] && _hay.indexOf(_toks[_t]) === -1) { searchMatch = false; break; }
          }
          // FALLBACK: si por tokens no matcheó, comparar SIN espacios.
          // Útil cuando user escribe "9PMNIGHT" o "9pm night" y el catálogo
          // tiene "9 PM NIGHT". Antes la búsqueda no encontraba nada en
          // estos casos por la diferencia de espaciado.
          if (!searchMatch) {
            var _hayNoSpace = _hay.replace(/\s+/g, '');
            var _qNoSpace = currentSearch.replace(/\s+/g, '');
            if (_qNoSpace && _hayNoSpace.indexOf(_qNoSpace) !== -1) searchMatch = true;
          }
        }
        // FILTRO 3: Nota olfativa específica
        var noteMatch = true;
        if (currentNoteFilter) {
          var noteNorm = stripAccents(currentNoteFilter.toLowerCase());
          noteMatch = card.dataset.search.indexOf(noteNorm) !== -1;
        }
        // FILTRO 4: Ocasión (casual, formal, nocturno, etc.)
        var occasionMatch = true;
        if (currentOccasion) {
          var perfil = (card.dataset.perfil || '').toLowerCase();
          if (currentOccasion === 'dia') {
            occasionMatch = perfil === 'fresco' || perfil === 'versátil';
          } else if (currentOccasion === 'noche') {
            occasionMatch = perfil === 'intenso' || perfil === 'dulce';
          }
        }
        // FILTRO 5: Rango de precio
        var priceMatch = true;
        if (priceFilterActive) {
          var priceEl = card.querySelector('.price-promo');
          if (priceEl) {
            var cardPrice = parseInt(priceEl.textContent.replace(/\D/g, '')) || 0;
            priceMatch = cardPrice >= priceFilterMin && cardPrice <= priceFilterMax;
          }
        }
        if (catMatch && newMatch && searchMatch && noteMatch && occasionMatch && priceMatch) {
          totalMatch++;
          if (matchIndex < cardsShown) {
            // [BATCH-REFLOW] Si estaba oculta y pasa a visible, marcar para re-animar.
            // El antiguo patrón hacía `void card.offsetWidth` adentro de este forEach
            // por CADA card que entraba — 162 reflows forzados = 151ms TBT (reporte
            // Lighthouse). Ahora batchamos: todas las lecturas/escrituras de display
            // primero, después UN solo reflow en el contenedor, después la clase.
            var wasHidden = card.style.display === 'none';
            card.style.display = 'flex';
            card.style.contentVisibility = 'visible';
            if (wasHidden) {
              card.classList.remove('filter-entering');
              _cardsToReAnimate.push(card);
            }
          } else {
            card.style.display = 'none';
            card.style.contentVisibility = 'auto';
          }
          matchIndex++;
        } else {
          card.style.display = 'none';
          card.style.contentVisibility = 'auto';
        }
      });
      // [BATCH-REFLOW] UN solo reflow forzado en el contenedor (afecta a todos
      // los hijos automáticamente) + re-aplicar clase de animación en batch.
      if (_cardsToReAnimate.length > 0) {
        var _grid = document.getElementById('catalogGrid');
        if (_grid) { void _grid.offsetWidth; }
        _cardsToReAnimate.forEach(function(c) { c.classList.add('filter-entering'); });
      }
      var label = currentFilter === 'favs' ? totalMatch + ' favoritos' : totalMatch + ' fragancias';
      document.getElementById('filterCount').textContent = label;
      // Re-observar cards recién visibles (load more / cambio de filtro)
      // para que tengan fade-in también, no aparezcan abruptas.
      try { initCardFadeIn(); } catch(_) {}
      // Empty state para favoritos
      var favsEmpty = document.getElementById('favsEmpty');
      var gridEl = document.getElementById('catalogGrid');
      var loadWrap = document.getElementById('loadMoreWrap');
      if (currentFilter === 'favs' && totalMatch === 0) {
        if (favsEmpty) favsEmpty.style.display = 'block';
        if (gridEl) gridEl.style.display = 'none';
        if (loadWrap) loadWrap.style.display = 'none';
      } else {
        if (favsEmpty) favsEmpty.style.display = 'none';
        if (gridEl) gridEl.style.display = '';
        if (loadWrap) loadWrap.style.display = '';
      }
      // Layout especial cuando hay 1-2 cards visibles (sino se ve roto en desktop:
      // la card sola queda en la columna izq con mucho espacio vacío al lado).
      if (gridEl) {
        gridEl.classList.toggle('catalog-grid--single', totalMatch === 1);
        gridEl.classList.toggle('catalog-grid--two', totalMatch === 2);
      }
      updateLoadMoreBtn(matchIndex, totalMatch);
      applyMirrorClasses();
      updateActiveFilters();
    }

    function applyMirrorClasses() {
      var cards = document.querySelectorAll('.product-card');
      var visibleIdx = 0;
      cards.forEach(function(card) {
        card.classList.remove('mirror');
        if (card.style.display !== 'none') {
          if (visibleIdx % 2 === 0) card.classList.add('mirror');
          visibleIdx++;
        }
      });
    }

    function updateLoadMoreBtn(shown, total) {
      var wrap = document.getElementById('loadMoreWrap');
      var countEl = document.getElementById('loadMoreCount');
      var visible = Math.min(cardsShown, total);
      if (visible >= total) {
        wrap.classList.add('hidden');
      } else {
        wrap.classList.remove('hidden');
        countEl.textContent = 'Mostrando ' + visible + ' de ' + total;
      }
    }

    function loadMore() {
      cardsShown += CARDS_INCREMENT;
      applyCardVisibility();
    }

    // [VER-MAS] 23-sep-2026 · decisión 67 (la eligió Alejo): sin scroll infinito. Cargaba 15 cards cada
    // vez que uno se acercaba al final, así que todo lo que está debajo del catálogo (categorías, juegos,
    // nosotros, FAQ, mapa y el pie) se alejaba cada vez, y un salto desde el menú o desde «Jugar» terminaba
    // en medio del catálogo. El botón «Ver más fragancias» (#loadMoreBtn) es el único modo.

    // [VER-MAS] Un link con ancla (/#faq, el de una notificación o un banner) salta al cargar, pero lo que se
    // pinta después arriba del destino (la grilla, la Selección ST, los banners) lo corría 30 a 160 px.
    // Mientras la página se asienta (8 s desde el load), cada vez que cambia de alto se vuelve a apuntar al
    // ancla, salvo que la persona ya haya tocado, scrolleado o usado el teclado.
    (function() {
      var ancla = location.hash;
      if (!ancla || ancla.length < 2) return;
      var tocado = false;
      ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function(t) {
        window.addEventListener(t, function() { tocado = true; }, { passive: true, capture: true });
      });
      function reanclar() {
        if (tocado || location.hash !== ancla) return;
        var el = null;
        try { el = document.querySelector(ancla); } catch (e) { return; }
        if (!el) return;
        // Su lugar en la página, no donde está pegado: #catalogo es la barra de filtros, que es sticky, y si ya
        // estaba pegada el navegador la daba por «a la vista» y no la acomodaba.
        var cs = getComputedStyle(el), antes = el.style.position;
        if (cs.position === 'sticky') el.style.position = 'static';
        var top = el.getBoundingClientRect().top + window.pageYOffset - (parseFloat(cs.scrollMarginTop) || 0);
        el.style.position = antes;
        window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      }
      window.addEventListener('load', function() {
        reanclar();
        if (!('ResizeObserver' in window)) { setTimeout(reanclar, 1500); return; }
        var ro = new ResizeObserver(function() { reanclar(); });
        ro.observe(document.body);
        setTimeout(function() { ro.disconnect(); }, 8000);
      });
    })();

    // ============================================================
    // FILTROS ACTIVOS — chips removibles
    // ============================================================

    function updateActiveFilters() {
      var bar = document.getElementById('activeFiltersBar');
      var chips = document.getElementById('activeFiltersChips');
      if (!bar || !chips) return;

      var items = [];

      // Categoría (si no es "all")
      if (currentFilter && currentFilter !== 'all') {
        var catLabel = currentFilter === 'favs' ? 'Favoritos' : currentFilter;
        items.push({ label: 'Categoría', value: catLabel, remove: 'cat' });
      }

      // Nuevos (filtro independiente)
      if (filterNewActive) {
        items.push({ label: 'Filtro', value: 'Nuevos', remove: 'new' });
      }

      // Búsqueda
      if (currentSearch) {
        items.push({ label: 'Búsqueda', value: '"' + currentSearch + '"', remove: 'search' });
      }

      // Nota olfativa
      if (currentNoteFilter) {
        items.push({ label: 'Nota', value: currentNoteFilter, remove: 'note' });
      }

      // Ocasión
      if (currentOccasion) {
        items.push({ label: 'Ocasión', value: currentOccasion === 'dia' ? 'Día' : 'Noche', remove: 'occasion' });
      }

      // Precio
      if (priceFilterActive) {
        var minK = Math.round(priceFilterMin / 1000);
        var maxK = Math.round(priceFilterMax / 1000);
        items.push({ label: 'Precio', value: '$' + minK + 'k — $' + maxK + 'k', remove: 'price' });
      }

      if (items.length === 0) {
        bar.style.display = 'none';
        return;
      }

      bar.style.display = 'flex';
      chips.innerHTML = '';
      items.forEach(function(item) {
        var chip = document.createElement('span');
        chip.className = 'active-filter-chip';
        chip.innerHTML = '<span class="chip-label">' + item.label + '</span> '
          + item.value
          + ' <button class="chip-remove" data-filter="' + item.remove + '">&times;</button>';
        chip.querySelector('.chip-remove').addEventListener('click', function() {
          removeFilter(item.remove);
        });
        chips.appendChild(chip);
      });
    }

    function removeFilter(type) {
      if (type === 'cat') {
        currentFilter = 'all';
        document.querySelectorAll('.filter-zone--left .filter-btn').forEach(function(b) {
          if (b.textContent.indexOf('Nuevos') === -1) b.classList.remove('active');
        });
        var allBtn = document.querySelector('.filter-btn');
        if (allBtn) allBtn.classList.add('active');
        closeDeck();
        updateDeckLabel();
      } else if (type === 'new') {
        filterNewActive = false;
        document.querySelectorAll('.filter-zone--left .filter-btn').forEach(function(b) {
          if (b.textContent.indexOf('Nuevos') !== -1) b.classList.remove('active');
        });
      } else if (type === 'search') {
        currentSearch = '';
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').classList.remove('visible');
      } else if (type === 'note') {
        currentNoteFilter = '';
        document.querySelectorAll('.note-chip').forEach(function(c) { c.classList.remove('active'); });
      } else if (type === 'occasion') {
        currentOccasion = '';
        var toggle = document.getElementById('occasionToggle');
        if (toggle) toggle.classList.remove('active');
        var labelDia = document.getElementById('labelDia');
        var labelNoche = document.getElementById('labelNoche');
        if (labelDia) labelDia.classList.remove('active');
        if (labelNoche) labelNoche.classList.remove('active');
      } else if (type === 'price') {
        clearPriceFilter();
        return; // clearPriceFilter already calls applyFilters
      }
      applyFilters();
    }

    function clearAllFilters() {
      currentFilter = 'all';
      filterNewActive = false;
      currentSearch = '';
      currentNoteFilter = '';
      currentOccasion = '';
      priceFilterActive = false;

      document.getElementById('searchInput').value = '';
      document.getElementById('searchClear').classList.remove('visible');
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      var allBtn = document.querySelector('.filter-btn');
      if (allBtn) allBtn.classList.add('active');
      document.querySelectorAll('.note-chip').forEach(function(c) { c.classList.remove('active'); });
      var toggle = document.getElementById('occasionToggle');
      if (toggle) toggle.classList.remove('active');
      var labelDia = document.getElementById('labelDia');
      var labelNoche = document.getElementById('labelNoche');
      if (labelDia) labelDia.classList.remove('active');
      if (labelNoche) labelNoche.classList.remove('active');
      updatePriceExpandBtn();
      closeDeck();
      updateDeckLabel();
      applyFilters();
    }

    // ============================================================
    // CATEGORÍAS DINÁMICAS
    // ============================================================

    function renderCategories() {
      const counts = { Unisex: 0, Hombre: 0, Mujer: 0 };
      PERFUMES.forEach(p => {
        // [PAUSADO-OCULTO] contar sólo lo que realmente se muestra, sino la
        // categoría promete "+50 fragancias" y adentro hay muchas menos.
        if (p.esSet || p._oculto || p._pausado || !p.cat) return;
        p.cat.split(',').map(c => c.trim()).forEach(c => {
          if (counts[c] !== undefined) counts[c]++;
        });
      });

      function roundDown(n) {
        if (n >= 100) return '+' + (Math.floor(n / 10) * 10);
        if (n >= 10) return '+' + (Math.floor(n / 10) * 10);
        return '+' + n;
      }

      const catGrid = document.getElementById('catGrid');
      catGrid.innerHTML = ['Unisex', 'Hombre', 'Mujer'].map(cat =>
        '<a href="#catalogo" class="cat-card" onclick="filterByCat(\'' + cat + '\')">'
        + '<span class="cat-number">' + roundDown(counts[cat]) + '</span>'
        + '<p class="cat-name">' + cat + '</p>'
        + '<p class="cat-count">' + roundDown(counts[cat]) + ' fragancias</p>'
        + '</a>'
      ).join('');
    }

    function filterByCat(cat) {
      // Activa el filtro correspondiente en la barra
      const btns = document.querySelectorAll('.filter-btn');
      btns.forEach(b => {
        b.classList.remove('active');
        if (b.textContent.trim().startsWith(cat)) b.classList.add('active');
      });
      applyFilter(cat);
      // Scroll directo a donde empiezan las cards (como favoritos)
      setTimeout(function() { scrollToCatalog(); }, 100);
      // Sincronizar URL para que las cards de la sección "Categorías"
      // también queden reflejadas en el link compartible.
      if (typeof updateFiltersInURL === 'function') updateFiltersInURL();
    }

    // ────────────────────────────────────────────────────────────────
    // SEO: sincronizar el estado de los filtros con la URL del navegador
    //
    // Permite al usuario:
    //   - Ver en la URL exactamente qué está filtrando
    //   - Compartir el link y que se abra con los mismos filtros aplicados
    //   - Volver atrás y avanzar con el back button del navegador
    //
    // Estructura de la URL:
    //   /?cat=Hombre&nota=vainilla&ocasion=noche#catalogo
    //   /?perfume=khanjar  (cuando hay un bottom sheet abierto en mobile)
    //
    // También conserva los hash legacy #filtro-hombre / mujer / unisex /
    // todos para no romper internal links viejos.
    // ────────────────────────────────────────────────────────────────
    function updateFiltersInURL() {
      try {
        var params = new URLSearchParams();
        if (currentFilter && currentFilter !== 'all') params.set('cat', currentFilter);
        if (currentNoteFilter)  params.set('nota', currentNoteFilter);
        if (currentOccasion)    params.set('ocasion', currentOccasion);
        var qs = params.toString();
        var hash = window.location.hash || '#catalogo';
        var newUrl = (qs ? '?' + qs : '') + hash;
        if (window.location.search + window.location.hash !== newUrl) {
          window.history.replaceState(null, '', newUrl || '/');
        }
      } catch (e) { /* silent */ }
    }

    function applyFiltersFromURL() {
      try {
        var params = new URLSearchParams(window.location.search);
        var hash = (window.location.hash || '').toLowerCase();

        // Categoría: hash legacy o ?cat=
        var hashCatMap = { '#filtro-hombre':'Hombre', '#filtro-mujer':'Mujer', '#filtro-unisex':'Unisex', '#filtro-todos':'all' };
        var cat = hashCatMap[hash] || params.get('cat');
        // Nota
        var nota = params.get('nota');
        // Ocasión
        var ocasion = params.get('ocasion');
        // Perfume puntual (abre bottom sheet en mobile)
        var perfumeSlug = params.get('perfume');

        setTimeout(function() {
          if (cat) filterByCat(cat);
          if (nota) {
            var chip = Array.prototype.find.call(
              document.querySelectorAll('.note-chip'),
              function(c) { return c.textContent.trim().toLowerCase() === nota.toLowerCase(); }
            );
            if (chip && currentNoteFilter !== nota) toggleNoteFilter(nota, chip);
          }
          if (ocasion === 'dia' || ocasion === 'noche') {
            if (currentOccasion !== ocasion && typeof setOccasion === 'function') setOccasion(ocasion);
          }
          if (perfumeSlug && typeof openBottomSheet === 'function') {
            // No re-abrir si ya está abierto con el mismo slug (evita loop
            // cuando el propio openBottomSheet hizo pushState).
            if (currentBsSlug !== perfumeSlug) {
              setTimeout(function() { openBottomSheet(perfumeSlug); }, 200);
            }
          }
        }, 250);
      } catch (e) { /* silent */ }
    }
    window.addEventListener('load', applyFiltersFromURL);
    window.addEventListener('hashchange', applyFiltersFromURL);
    window.addEventListener('popstate', applyFiltersFromURL);

    // ============================================================
    // FILTROS Y ORDENAR
    // ============================================================

    let currentFilter = 'all';
    let filterNewActive = false;

    function updateCount(cat) {
      const cards = document.querySelectorAll('.product-card');
      let visible = 0;
      cards.forEach(card => {
        if (matchesCat(card.dataset.cat, cat)) visible++;
      });
      document.getElementById('filterCount').textContent = visible + ' fragancias';
    }

    function applyFilter(cat) {
      currentFilter = cat;
      applyFilters();
    }

    function filterBy(cat, btn) {
      // Desactivar solo los botones de categoría, no el de Nuevos
      document.querySelectorAll('.filter-zone--left .filter-btn').forEach(function(b) {
        if (b.textContent.indexOf('Nuevos') === -1) b.classList.remove('active');
      });
      btn.classList.add('active');
      currentSearch = '';
      document.getElementById('searchInput').value = '';
      document.getElementById('searchClear').classList.remove('visible');
      applyFilter(cat);
      closeDeck();
      updateDeckLabel();
      scrollToCatalog();
      // Sincronizar URL con todos los filtros activos (cat + nota + ocasion)
      if (typeof updateFiltersInURL === 'function') updateFiltersInURL();
    }

    // ============================================================
    // MAZO DE CARTAS — abrir/cerrar en mobile (tap)
    //
    // En mobile no hay hover, así que usamos tap:
    // - Tap en el mazo cerrado → se abre (deck-open)
    // - Tap en un filtro → aplica filtro + cierra
    // - Tap fuera del mazo → cierra
    // En desktop el hover del CSS se encarga solo.
    // ============================================================
    function closeDeck() {
      document.querySelector('.filter-zone--left').classList.remove('deck-open');
    }

    // Actualizar el texto del label con el filtro activo
    function updateDeckLabel() {
      var activeBtn = document.querySelector('.filter-zone--left .filter-btn.active');
      var labelText = document.getElementById('deckLabel');
      if (activeBtn && labelText) {
        var txt = activeBtn.textContent.trim();
        labelText.querySelector('.deck-label-text').textContent = txt;
      }
    }

    (function() {
      var deck = document.querySelector('.filter-zone--left');
      var isMobile = function() { return window.innerWidth < 768; };

      // En mobile: interceptar clicks en los botones del mazo.
      // Usamos "capture: true" para atrapar el click ANTES que el onclick del botón.
      deck.addEventListener('click', function(e) {
        if (!isMobile()) return;

        if (!deck.classList.contains('deck-open')) {
          // Mazo cerrado → abrir y NO ejecutar el filtro
          e.stopPropagation();
          // Evitar que el onclick="filterBy(...)" del botón se ejecute
          var btn = e.target.closest('.filter-btn');
          if (btn) {
            e.preventDefault();
            // Remover momentáneamente el onclick para que no se dispare
            // (el stopPropagation en capture debería bastar)
          }
          deck.classList.add('deck-open');
          return;
        }
        // Si está abierto, dejar que el onclick del botón haga lo suyo
        // (filterBy/filterByNew/filterByFavs llaman a closeDeck)
      }, true); // ← capture phase: se ejecuta ANTES que el onclick

      // Tap fuera del mazo → cerrar
      document.addEventListener('click', function(e) {
        if (!e.target.closest('.filter-zone--left')) {
          closeDeck();
        }
      });
    })();

    // ============================================================
    // BUSCAR
    // ============================================================
    function stripAccents(str) {
      return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    var currentSearch = '';
    var _searchTimer = null;
    function debouncedSearch(val) {
      if (_searchTimer) clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function() { applySearch(val); }, 120);
    }

    // applySearch: filtra las cards Y muestra sugerencias de autocompletado
    function applySearch(query) {
      currentSearch = stripAccents(query.trim().toLowerCase());
      var clearBtn = document.getElementById('searchClear');
      clearBtn.classList.toggle('visible', currentSearch.length > 0);
      applyFilters();
      showSearchSuggestions(query.trim());
    }

    function clearSearch() {
      currentSearch = '';
      document.getElementById('searchInput').value = '';
      document.getElementById('searchClear').classList.remove('visible');
      hideSearchSuggestions();
      applyFilters();
    }

    // ============================================================
    // AUTOCOMPLETADO — Sugerencias al escribir en el buscador
    //
    // Busca perfumes que coincidan con lo que escribiste (nombre,
    // marca o notas). Muestra hasta 5 resultados con foto, nombre,
    // marca y precio. Al hacer clic scrollea hasta la card.
    // ============================================================
    var sugActiveIndex = -1; // para navegar con flechas

    function showSearchSuggestions(query) {
      var box = document.getElementById('searchSuggestions');
      var norm = stripAccents(query.toLowerCase());

      // Ocultar si menos de 2 caracteres
      if (norm.length < 2) { hideSearchSuggestions(); return; }

      // Buscar matches (nombre y marca tienen prioridad).
      // Tokenizamos la query: cada token debe aparecer en algún campo.
      // El score se calcula con el token "principal" (el más largo) para
      // mantener priorización tipo "empieza con" > "contiene".
      var tokens = norm.split(/\s+/).filter(Boolean);
      var mainToken = tokens.reduce(function(a, b){ return b.length > a.length ? b : a; }, '');

      // Versión sin espacios para fallback (matcheo "9PMNIGHT" → "9 PM NIGHT")
      var queryNoSpace = norm.replace(/\s+/g, '');

      var matches = [];
      PERFUMES.forEach(function(p) {
        if (p.esSet || p._oculto) return;
        var nameNorm = stripAccents(p.name.toLowerCase());
        var marcaNorm = stripAccents((p.marca_real || p.marca || '').toLowerCase());
        var notasNorm = stripAccents(((p.notas_salida || '') + ' ' + (p.notas_corazon || '') + ' ' + (p.notas_base || '')).toLowerCase());
        var hay = nameNorm + ' ' + marcaNorm + ' ' + notasNorm;

        // AND: cada token debe estar en algún lado
        var tokensMatch = true;
        for (var i = 0; i < tokens.length; i++) {
          if (hay.indexOf(tokens[i]) === -1) { tokensMatch = false; break; }
        }
        if (!tokensMatch) {
          // Fallback sin espacios: si el user escribió "9PMNIGHT" o "9pm night"
          // y el catálogo tiene "9 PM NIGHT", normalizamos ambos y comparamos.
          var hayNoSpace = hay.replace(/\s+/g, '');
          if (!queryNoSpace || hayNoSpace.indexOf(queryNoSpace) === -1) return;
        }

        var score = 0;
        if (nameNorm.indexOf(mainToken) === 0) score = 3;         // empieza con
        else if (nameNorm.indexOf(mainToken) !== -1) score = 2;    // contiene en nombre
        else if (marcaNorm.indexOf(mainToken) !== -1) score = 1;   // contiene en marca
        else if (notasNorm.indexOf(mainToken) !== -1) score = 0.5; // contiene en notas
        // Bonus: si TODOS los tokens aparecen en el nombre, sube medio punto
        var allInName = tokens.every(function(t){ return nameNorm.indexOf(t) !== -1; });
        if (allInName) score += 0.5;

        matches.push({ perfume: p, score: score, nameNorm: nameNorm });
      });

      // Ordenar: mejor match primero
      matches.sort(function(a, b) { return b.score - a.score || a.nameNorm.localeCompare(b.nameNorm); });
      matches = matches.slice(0, 5);

      if (matches.length === 0) {
        box.innerHTML = '<div class="search-sug-empty">No se encontraron resultados</div>';
        box.classList.add('active');
        sugActiveIndex = -1;
        // Trackear solo si query tiene 3+ chars y el usuario dejó de tipear 2s
        if (query.trim().length >= 3) {
          if (window._searchEmptyTimer) clearTimeout(window._searchEmptyTimer);
          window._searchEmptyTimer = setTimeout(function(){
            trackEvent('search_empty', { query: query.trim().toLowerCase().slice(0, 80) });
          }, 2000);
        }
        return;
      }
      // Si hubo match, cancelar el timer pendiente (el usuario encontró algo)
      if (window._searchEmptyTimer) { clearTimeout(window._searchEmptyTimer); window._searchEmptyTimer = null; }

      var html = '';
      matches.forEach(function(m, i) {
        var p = m.perfume;
        var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
        var imgHTML = fotoSrc
          ? '<img class="search-sug-img" src="' + fotoSrc + '" alt="' + p.name + '" loading="lazy" decoding="async">'
          : '<div class="search-sug-img-placeholder">' + p.name.charAt(0) + '</div>';

        // Resaltar la parte que coincide en el nombre
        var displayName = highlightMatch(p.name, query);
        var price = p.promo ? formatPrice(p.promo) : formatPrice(p.price);

        html += '<div class="search-sug-item" data-slug="' + p.slug + '" onclick="selectSuggestion(\'' + p.slug + '\')">'
          + imgHTML
          + '<div class="search-sug-info">'
            + '<p class="search-sug-name">' + displayName + '</p>'
            + '<p class="search-sug-brand">' + (p.marca_real || p.marca) + '</p>'
          + '</div>'
          + '<span class="search-sug-price">' + price + '</span>'
        + '</div>';
      });

      box.innerHTML = html;
      box.classList.add('active');
      sugActiveIndex = -1;
    }

    // highlightMatch: resalta la parte del texto que coincide con la búsqueda
    function highlightMatch(text, query) {
      if (!query) return text;
      var idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return text;
      return text.substring(0, idx) + '<mark>' + text.substring(idx, idx + query.length) + '</mark>' + text.substring(idx + query.length);
    }

    function hideSearchSuggestions() {
      var box = document.getElementById('searchSuggestions');
      box.classList.remove('active');
      sugActiveIndex = -1;
    }

    // selectSuggestion: al hacer clic en una sugerencia
    function selectSuggestion(slug) {
      hideSearchSuggestions();

      // 1) Cerrar teclado mobile
      document.getElementById('searchInput').blur();

      // 2) Buscar el perfume
      var perfume = PERFUMES.find(function(p) { return p.slug === slug; });
      if (perfume) {
        document.getElementById('searchInput').value = perfume.name;
        currentSearch = stripAccents(perfume.name.toLowerCase());
        document.getElementById('searchClear').classList.add('visible');
      }

      applyFilters();

      // 3) Esperar a que el teclado se cierre del todo (resize del viewport)
      //    Scrollear al catalogGrid (NO al filter-bar que es sticky)
      setTimeout(function() {
        // Scrolleamos a la CARD elegida, no al grid. El -130 fijo de antes
        // estaba calibrado para las cards horizontales viejas y con
        // [CARD-VERTICAL] dejaba la card tapada por la barra sticky.
        //
        // Cuánto hay que frenar antes lo define UN solo lugar: el
        // scroll-margin-top de la card y de la grilla (76px en desktop, 240px en mobile,
        // donde el nav Y el filter-bar quedan pegados arriba). Lo leemos del
        // CSS en vez de hardcodear un número que envejece cada vez que
        // cambia el alto de la barra. [VER-MAS] Hasta el 23-sep era el scroll-padding-top
        // del <html>, que también frenaba 240 px cualquier salto a una sección.
        var card = document.querySelector('.product-card[data-slug="' + slug + '"]');
        var destino = card || document.getElementById('catalogGrid');
        var pad = parseFloat(window.getComputedStyle(destino).scrollMarginTop) || 0;
        // behavior:'instant' EXPLÍCITO. La forma corta scrollTo(x, y) hereda
        // el scroll-behavior:smooth del <html>, así que el "scroll instantáneo"
        // que prometía el comentario original nunca lo fue: animaba ~1s desde
        // arriba de todo. Acá no queremos animación, queremos aparecer.
        window.scrollTo({
          top: destino.getBoundingClientRect().top + window.pageYOffset - pad,
          behavior: 'instant'
        });

        // 4) Highlight la card
        setTimeout(function() {
          if (card) {
            card.style.boxShadow = '0 0 20px rgba(232,184,0,.5)';
            setTimeout(function() { card.style.boxShadow = ''; }, 2000);
          }
        }, 200);
      }, 500);
    }

    // Navegación con flechas y Enter en las sugerencias
    document.getElementById('searchInput').addEventListener('keydown', function(e) {
      var box = document.getElementById('searchSuggestions');
      var items = box.classList.contains('active') ? box.querySelectorAll('.search-sug-item') : [];

      // Enter sin sugerencia elegida = "ya está, mostrame los resultados".
      // Cerramos el dropdown y bajamos el teclado. Sin esto, en celular el
      // teclado se quedaba abierto tapando media pantalla de catálogo y no
      // había forma de cerrarlo salvo tocar en un hueco de la página.
      if (e.key === 'Enter' && sugActiveIndex < 0) {
        e.preventDefault();
        hideSearchSuggestions();
        this.blur();
        return;
      }
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        sugActiveIndex = Math.min(sugActiveIndex + 1, items.length - 1);
        items.forEach(function(it, i) { it.classList.toggle('active', i === sugActiveIndex); });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sugActiveIndex = Math.max(sugActiveIndex - 1, 0);
        items.forEach(function(it, i) { it.classList.toggle('active', i === sugActiveIndex); });
      } else if (e.key === 'Enter' && sugActiveIndex >= 0) {
        e.preventDefault();
        var slug = items[sugActiveIndex].dataset.slug;
        selectSuggestion(slug);
      } else if (e.key === 'Escape') {
        hideSearchSuggestions();
      }
    });

    // Cerrar sugerencias al hacer clic fuera
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.search-wrapper')) {
        hideSearchSuggestions();
      }
    });

    function filterByNew(btn) {
      // Toggle: si ya estaba activo, desactivar
      filterNewActive = !filterNewActive;
      if (filterNewActive) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
      // No toca currentFilter — "Nuevos" se suma a la categoría activa
      applyFilters();
      closeDeck();
      updateDeckLabel();
      scrollToCatalog();
    }

    function filterByFavs(btn) {
      document.querySelectorAll('.filter-zone--left .filter-btn').forEach(function(b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      currentFilter = 'favs';
      filterNewActive = false;
      applyFilters();
      closeDeck();
      updateDeckLabel();
      scrollToCatalog();
    }

    function applyFilters() {
      cardsShown = CARDS_INITIAL;
      applyCardVisibility();
    }


    function toggleSortMenu(btn) {
      const menu = document.getElementById('sortMenu');
      menu.classList.toggle('open');
      btn.classList.toggle('active');
    }
    document.addEventListener('click', function(e) {
      const wrap = document.querySelector('.sort-wrapper');
      if (wrap && !wrap.contains(e.target)) {
        document.getElementById('sortMenu').classList.remove('open');
        wrap.querySelector('.filter-btn').classList.remove('active');
      }
    });

    function sortCards(mode) {
      const grid = document.getElementById('catalogGrid');
      const cards = Array.from(grid.querySelectorAll('.product-card'));
      cards.sort((a, b) => {
        if (mode === 'alpha-asc' || mode === 'alpha-desc') {
          const na = a.querySelector('.card-name').textContent.trim().toLowerCase();
          const nb = b.querySelector('.card-name').textContent.trim().toLowerCase();
          return mode === 'alpha-asc' ? na.localeCompare(nb) : nb.localeCompare(na);
        }
        if (mode === 'views-desc' || mode === 'views-asc') {
          const va = perfumeViews[a.dataset.slug] || 0;
          const vb = perfumeViews[b.dataset.slug] || 0;
          // Si hay empate de vistas (muy común: todos en 0 si la tabla está vacía),
          // usamos el nombre como tiebreaker para que el orden cambie visiblemente.
          if (va === vb) {
            const na = a.querySelector('.card-name').textContent.trim().toLowerCase();
            const nb = b.querySelector('.card-name').textContent.trim().toLowerCase();
            return na.localeCompare(nb);
          }
          return mode === 'views-desc' ? vb - va : va - vb;
        }
        // Leer del data-price (bulletproof) — fallback al DOM por si alguna card vieja no lo tiene
        var pa = parseFloat(a.dataset.price);
        var pb = parseFloat(b.dataset.price);
        if (isNaN(pa)) pa = parseInt((a.querySelector('.price-promo') || {}).textContent?.replace(/\D/g, '') || '0') || 0;
        if (isNaN(pb)) pb = parseInt((b.querySelector('.price-promo') || {}).textContent?.replace(/\D/g, '') || '0') || 0;
        return mode === 'price-asc' ? pa - pb : pb - pa;
      });
      cards.forEach(c => grid.appendChild(c));
      cardsShown = CARDS_INITIAL;
      applyCardVisibility();
      document.getElementById('sortMenu').classList.remove('open');
      document.querySelector('.sort-wrapper .filter-btn').classList.remove('active');
      // Marcar opción activa
      document.querySelectorAll('.sort-menu button').forEach(b => b.classList.remove('active-sort'));
      document.querySelector('.sort-menu button[onclick*="' + mode + '"]').classList.add('active-sort');
    }

    // ============================================================
    // NAV DRAWER
    // ============================================================

    function toggleDrawer() {
      document.getElementById('navDrawer').classList.toggle('open');
      document.getElementById('drawerOverlay').classList.toggle('open');
    }

    // ============================================================
    // [BARRA-CELU] La barra de abajo del celu (decisiones 61, 62, 68 y 86-93 del DISEÑADOR, réplica v4).
    // Carrito y Decants llaman directo a openCartPanel / openDecantBuilder desde el HTML.
    // ============================================================
    // Catálogo: va al catálogo; si ya estás adentro, vuelve arriba de todo (lo que hacía .scroll-top, regla 3 de la v3).
    // «Adentro» = la parte de arriba del catálogo ya llegó a donde frena el salto (105) y todavía queda catálogo a la vista.
    function barraCatalogo() {
      var cat = document.getElementById('catalogo');
      if (!cat) return;
      var zona = (document.querySelector('.catalogo-scope') || cat).getBoundingClientRect();
      if (zona.top <= 110 && zona.bottom > window.innerHeight / 2) window.scrollTo({ top: 0, behavior: 'smooth' });
      else cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Buscar: el foco va en el mismo toque (en iPhone, si va después del scroll suave, no sale el teclado) y sin que el
    // navegador salte; después se acomoda la barra de filtros arriba.
    function barraBuscar() {
      var input = document.getElementById('searchInput');
      if (!input) return;
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      var cat = document.getElementById('catalogo');
      if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Cuenta: sin sesión, el login de siempre; con sesión, la hoja «Hola, <nombre>».
    function barraCuenta() {
      if (!currentUser) { openAuth(); return; }
      var ov = document.getElementById('cuentaHojaOverlay');
      if (!ov) return;
      var nombre = String(currentUser.nombre || '').trim().split(/\s+/)[0];
      document.getElementById('cuentaHojaTitulo').textContent = nombre ? 'Hola, ' + nombre : 'Hola';   // dato del cliente: textContent
      document.getElementById('cuentaHojaFavs').textContent = favs.length;
      ov.classList.add('open');
      try { history.pushState({ cuentaHoja: true }, ''); } catch (e) {}
    }
    // Cerrar la hoja; si se abrió con su entrada de historial, «atrás» la cierra y lo que sigue corre después, cuando la
    // página ya volvió (así un scroll de «Mis favoritos» no lo pisa la restauración del historial).
    var cuentaHojaDespues = null;
    function cerrarCuentaHoja(despues) {
      var ov = document.getElementById('cuentaHojaOverlay');
      var sigue = typeof despues === 'function' ? despues : null;
      if (!ov || !ov.classList.contains('open')) { if (sigue) sigue(); return; }
      if (history.state && history.state.cuentaHoja) { cuentaHojaDespues = sigue; history.back(); return; }
      ov.classList.remove('open');
      if (sigue) sigue();
    }
    window.addEventListener('popstate', function() {
      var ov = document.getElementById('cuentaHojaOverlay');
      if (!ov || !ov.classList.contains('open')) return;
      ov.classList.remove('open');
      var sigue = cuentaHojaDespues; cuentaHojaDespues = null;
      if (sigue) setTimeout(sigue, 60);
    });
    function cuentaFavoritos() {
      cerrarCuentaHoja(function() { showFavorites({ preventDefault: function() {} }); });
    }

    // ============================================================
    // LISTA DE ESPERA — Sin stock / Pausados
    // ============================================================
    // [ESPERA-SEGURA] Sin cliente no hay ✓: la caché puede ser de alguien que salió antes de v1.1.114 (el
    // onLogout viejo no la borraba). Con cliente sirve sólo para el primer pintado; después manda la base.
    // currentUser ya está resuelto acá: la sesión se restaura más arriba, antes de que corra esta línea.
    var waitlistSlugs = [];
    if (currentUser) {
      try { waitlistSlugs = JSON.parse(localStorage.getItem('st_waitlist') || '[]'); } catch (e) { waitlistSlugs = []; }
    } else {
      try { localStorage.removeItem('st_waitlist'); } catch (e) {}
    }
    // Lo que markWaitlistSlug marca mientras la RPC está en vuelo (la respuesta no lo trae). SIN inicializador
    // a propósito: la primera sincronización arranca desde onLogin, antes de que se ejecute esta línea, y un
    // "= null" acá pisaría el array que ella ya abrió.
    var waitlistMarcadosDurante;

    // [ESPERA-SEGURA] El "✓ Te avisamos" sale de la base (decisión 46): los perfumes que este teléfono
    // tiene PENDIENTES. st_waitlist queda como caché para el primer pintado. Si la RPC falla o no existe,
    // se sigue con la caché; si la base cambió algo, se repinta (mismo patrón que loadFavsFromSupabase).
    async function syncWaitlistFromDB() {
      if (!currentUser || !currentUser.telefono) return;
      var tel = currentUser.telefono;
      waitlistMarcadosDurante = [];
      try {
        var res = await sb.rpc('lista_espera_pendientes', { p_telefono: tel });
        if (res.error || !Array.isArray(res.data)) return;
        if (!currentUser || currentUser.telefono !== tel) return;   // salió o cambió de cuenta mientras tanto
        var nuevos = res.data.filter(function(s) { return typeof s === 'string'; });
        // Lo que el cliente anotó mientras la RPC estaba en vuelo no viene en la respuesta: se conserva.
        (waitlistMarcadosDurante || []).forEach(function(s) { if (nuevos.indexOf(s) === -1) nuevos.push(s); });
        var antes = JSON.stringify((waitlistSlugs || []).slice().sort());
        waitlistSlugs = nuevos;
        localStorage.setItem('st_waitlist', JSON.stringify(waitlistSlugs));
        // Si el catálogo todavía no se pintó, la primera pintada (la de después de los overrides) ya usa esta
        // lista: repintar antes mostraría por un instante el seed sin overrides, pausados incluidos.
        if (JSON.stringify(nuevos.slice().sort()) !== antes && document.querySelector('#catalogGrid .product-card')) renderCatalog();
      } catch(e) {
      } finally {
        waitlistMarcadosDurante = null;
      }
    }

    function openWaitlist(slug, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      // Solo usuarios registrados pueden anotarse en la lista de espera.
      // Si no hay sesion, abrimos el modal de login (mismo patron que
      // sendBoardMsg, favoritos logueados, votos del mes, etc.). Al
      // loguearse el usuario vuelve a tocar el boton y el flujo sigue.
      if (!currentUser) {
        if (typeof openAuth === 'function') openAuth();
        return;
      }
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      document.getElementById('waitlistSlug').value = slug;
      document.getElementById('waitlistPerfumeName').textContent = p.name;
      document.getElementById('waitlistMsg').textContent = '';
      document.getElementById('waitlistMsg').className = 'waitlist-msg';   // [ESPERA-CLARO] el color va por clase
      document.getElementById('waitlistPhonePreview').textContent = '';
      document.getElementById('waitlistSubmitBtn').disabled = false;

      // [ESPERA-SEGURA] El teléfono de la lista es el de la cuenta, y se muestra como texto, no como campo
      // (DISEÑADOR: "una caja que no deja escribir parece rota"). El input queda en el DOM, oculto.
      var phoneInput = document.getElementById('waitlistPhone');
      var tel = String(currentUser.telefono || '');
      if (tel.substring(0, 3) === '549') tel = tel.substring(3);
      else if (tel.substring(0, 2) === '54') tel = tel.substring(2);
      phoneInput.value = tel;
      var wrap = document.querySelector('#waitlistOverlay .waitlist-input-wrap');
      if (wrap) wrap.style.display = 'none';
      document.getElementById('waitlistPhonePreview').innerHTML = 'Te avisamos al <strong>' + escapeHTML(formatPhoneDisplay(tel)) + '</strong> \u00b7 el de tu cuenta';

      document.getElementById('waitlistOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeWaitlist(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('waitlistOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    function previewWaitlistPhone() {
      var raw = document.getElementById('waitlistPhone').value.trim();
      var el = document.getElementById('waitlistPhonePreview');
      if (!raw || raw.replace(/[^0-9]/g, '').length < 6) { el.textContent = ''; return; }
      var clean = cleanPhone(raw);
      var display = formatPhoneDisplay(raw);
      if (clean.length === 13) {
        el.innerHTML = '<span style="color:#27ae60">\u2713 ' + display + '</span>';
      } else if (clean.length > 13) {
        el.innerHTML = '<span style="color:#e74c3c">' + display + ' (demasiados d\u00edgitos)</span>';
      } else {
        el.innerHTML = '<span style="color:var(--gris)">' + display + ' (' + (13 - clean.length) + ' d\u00edgitos faltan)</span>';
      }
    }

    async function submitWaitlist() {
      var slug = document.getElementById('waitlistSlug').value;
      // [ESPERA-SEGURA] El teléfono es el de la cuenta, no el del input (ahora oculto). Las validaciones de
      // abajo quedan como defensa.
      var rawPhone = String((currentUser && currentUser.telefono) || '').trim();
      var msgEl = document.getElementById('waitlistMsg');
      var btn = document.getElementById('waitlistSubmitBtn');
      msgEl.textContent = '';
      // Flag: si ya mostramos el mensaje de éxito, cualquier error posterior
      // (markWaitlistSlug, DOM update, race con otro fetch) NO debe pisar el "¡Listo!".
      var successShown = false;

      if (!rawPhone || rawPhone.replace(/[^0-9]/g, '').length < 8) {
        msgEl.className = 'waitlist-msg waitlist-msg--error';
        msgEl.textContent = 'Pon\u00e9 un n\u00famero de WhatsApp v\u00e1lido';
        return;
      }
      // Ya viene canónico (549 + 10 dígitos: los 99 clientes). cleanPhone sobre eso le borra un "15" legítimo
      // del medio a 2 de ellos y no podrían anotarse; sólo se limpia si no tiene esa forma.
      var phone = /^549\d{10}$/.test(rawPhone) ? rawPhone : cleanPhone(rawPhone);
      if (phone.length !== 13) {
        msgEl.className = 'waitlist-msg waitlist-msg--error';
        msgEl.textContent = 'El n\u00famero debe tener 10 d\u00edgitos (sin 0 ni 15)';
        return;
      }

      btn.disabled = true;

      try {
        var perfume = PERFUMES.find(function(p) { return p.slug === slug; });
        var nombre = currentUser ? currentUser.nombre : '';

        // [ESPERA-SEGURA] El catálogo ya no lee lista_espera (anon no puede): inserta directo, y el índice
        // único parcial (slug, telefono) WHERE notified_at IS NULL responde 23505 si ya estaba pendiente.
        var res = await sb.from('lista_espera').insert({
          slug: slug,
          telefono: phone,
          nombre: nombre,
          perfume_name: perfume ? perfume.name : slug
        });

        if (res.error && res.error.code === '23505') {
          msgEl.className = 'waitlist-msg waitlist-msg--ya';
          msgEl.textContent = '\u00a1Ya est\u00e1s en la lista! Te avisamos cuando vuelva.';
          markWaitlistSlug(slug);
          setTimeout(function() { closeWaitlist(); }, 1800);
          btn.disabled = false;
          return;
        }
        if (res.error) {
          msgEl.className = 'waitlist-msg waitlist-msg--error';
          msgEl.textContent = 'Error: ' + res.error.message;
          btn.disabled = false;
          return;
        }

        // Mostrar éxito INMEDIATAMENTE — antes de nada que pueda fallar.
        // Así si markWaitlistSlug explota, el usuario no ve "Error de conexión"
        // después del "¡Listo!".
        successShown = true;
        msgEl.className = 'waitlist-msg waitlist-msg--ok';
        msgEl.textContent = '\u00a1Listo! Te avisamos por WhatsApp cuando vuelva.';
        setTimeout(function() { closeWaitlist(); }, 2000);

        // Side-effects en try/catch individuales para no romper el flujo
        try { markWaitlistSlug(slug); } catch(e) { console.error('[waitlist] markWaitlistSlug falló:', e); }
        // [TELEGRAM-ANON-ABIERTO] El aviso lo manda el trigger
        // trg_lista_espera_aviso, que lee la fila recien insertada.
      } catch(e) {
        console.error('[waitlist] Excepción:', e);
        // Si el success ya se mostró, NO pisamos con un error — el guardado funcionó,
        // el error probablemente vino de algún side-effect irrelevante.
        if (!successShown) {
          msgEl.className = 'waitlist-msg waitlist-msg--error';
          msgEl.textContent = 'Error: ' + (e.message || 'conexión fallida');
        }
      }
      btn.disabled = false;
    }

    function markWaitlistSlug(slug) {
      if (waitlistMarcadosDurante) waitlistMarcadosDurante.push(slug);   // hay una sincronización en vuelo
      if (waitlistSlugs.indexOf(slug) === -1) {
        waitlistSlugs.push(slug);
        localStorage.setItem('st_waitlist', JSON.stringify(waitlistSlugs));
      }
      // Actualizar botón en la card
      var card = document.querySelector('[data-slug="' + slug + '"]');
      if (card) {
        var btn = card.querySelector('.waitlist-btn');
        if (btn) {
          btn.classList.add('subscribed');
          btn.innerHTML = '\u2713 Te avisamos cuando vuelva';
        }
      }
    }

    // ============================================================
    // INIT
    // ============================================================

    // Cargar perfumes nuevos desde Supabase y combinar con perfumes.js
    // Helper: race entre una query Supabase y un timeout — para que el
    // catálogo NUNCA se cuelgue eternamente esperando una query que no
    // responde (Supabase pausado, RLS rota, red lenta, etc.).
    function withTimeout(promise, ms, label) {
      var timeoutP = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('timeout ' + ms + 'ms: ' + label)); }, ms);
      });
      return Promise.race([promise, timeoutP]);
    }

    // Helper: cache local de queries Supabase con TTL.
    // Patrón "Stale-While-Revalidate" para data de DB:
    //  - Antes de la query, devuelve cached si existe y no expiró (instant).
    //  - Lanza la query en background: si OK actualiza cache, si falla
    //    no pasa nada (sigue con el cached).
    //  - Si NO HAY cached → espera la query con timeout.
    // Resultado: aunque Supabase esté caído, el cliente ve la última data
    // conocida en lugar de pantalla vacía.
    var DB_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos
    function readCache(key) {
      try {
        var raw = localStorage.getItem('st_cache_' + key);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !obj.ts || !obj.data) return null;
        if (Date.now() - obj.ts > DB_CACHE_TTL_MS) return null; // expirado
        return obj.data;
      } catch(e) { return null; }
    }
    function writeCache(key, data) {
      try {
        localStorage.setItem('st_cache_' + key, JSON.stringify({ ts: Date.now(), data: data }));
      } catch(e) {}
    }

    async function loadPerfumesNuevos() {
      // Pre-aplicar cache si existe (instant fallback)
      var cached = readCache('perfumes_nuevos');
      if (cached && Array.isArray(cached)) {
        cached.forEach(function(p) {
          if (PERFUMES.find(function(pf) { return pf.slug === p.slug; })) return;
          PERFUMES.push(p);
        });
        console.log('[loadPerfumesNuevos] aplicado desde cache:', cached.length, 'items');
      }
      try {
        var { data, error } = await withTimeout(
          sb.from('perfumes_nuevos').select('*'),
          3000,
          'perfumes_nuevos'
        );
        if (error) { console.warn('[loadPerfumesNuevos] supabase error:', error.message); return; }
        // Cachear los rows transformados (igual estructura que se pushea)
        var newPerfumesToCache = [];
        if (data && data.length > 0) {
          data.forEach(function(p) {
            // No duplicar si ya existe
            if (PERFUMES.find(function(pf) { return pf.slug === p.slug; })) return;
            // Convertir price integer a formato string "85,000.00"
            function intToPrice(n) {
              if (!n) return '';
              return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            var pNorm = {
              slug: p.slug, name: p.name, marca: p.marca, marca_real: p.marca_real || '',
              cat: p.cat, perfil: p.perfil, tipo: p.tipo || '', alias: p.alias || '',
              price: intToPrice(p.price),
              promo: p.promo ? intToPrice(p.promo) : '',
              foto: p.foto || '', ml: p.ml || 100,
              notas_salida: p.notas_salida || '', notas_corazon: p.notas_corazon || '',
              notas_base: p.notas_base || '', _isNew: true,
              // [DECANT-PRECIO-MANUAL] Precio de decant que cargó el empleado
              // al dar de alta el perfume, y la casilla de exclusión.
              _precioDecant: (p.precio_decant != null ? p.precio_decant : null),
              _decantExcluido: !!p.decant_excluido
            };
            PERFUMES.push(pNorm);
            newPerfumesToCache.push(pNorm);
          });
          writeCache('perfumes_nuevos', newPerfumesToCache);
        }
      } catch(e) {
        console.warn('[loadPerfumesNuevos] timeout o error:', e.message, '— usando cache si hay');
      }
    }

    // Helper compartido — aplica UN override (de Supabase o de cache) a su perfume.
    // Tiene que estar SINCRO con el forEach de loadOverrides.
    function applyOverrideToPerfume(o) {
      var p = PERFUMES.find(function(pf) { return pf.slug === o.slug; });
      if (!p) return;
      if (o.oculto === true) { p._oculto = true; return; }
      if (o.name) p.name = o.name;
      if (o.marca) p.marca = o.marca;
      if (o.marca_real) p.marca_real = o.marca_real;
      if (o.cat) p.cat = o.cat;
      if (o.perfil) p.perfil = o.perfil;
      if (o.price) p.price = o.price;
      if (o.promo !== null && o.promo !== undefined) p.promo = o.promo;
      if (o.foto) p.foto = o.foto;
      if (o.notas_salida) p.notas_salida = o.notas_salida;
      if (o.notas_corazon) p.notas_corazon = o.notas_corazon;
      if (o.notas_base) p.notas_base = o.notas_base;
      if (o.stock_status) p._stockStatus = o.stock_status;
      // [PAUSADO-OCULTO] Un perfume pausado NO se muestra en el catálogo público.
      // Bandera propia y NO reuso _oculto a propósito: _oculto significa "perfume
      // eliminado" y además marca como ROTO a cualquier combo que lo contenga
      // (ver filtro de sets). Pausar no debería hacer desaparecer un pack.
      p._pausado = (o.stock_status === 'pausado');
      if (o.stock_qty !== null && o.stock_qty !== undefined) p._stockQty = o.stock_qty;
      if (o.fotos_extra) p.fotos_extra = o.fotos_extra;
      if (o.etiqueta !== undefined) p.etiqueta = o.etiqueta || '';
      if (o.etiqueta_color) p.etiqueta_color = o.etiqueta_color;
      if (o.descuento_pct) p.descuento_pct = o.descuento_pct;
      if (o.descuento_hasta) p.descuento_hasta = o.descuento_hasta;
      if (o.tipo !== undefined && o.tipo !== null) p.tipo = o.tipo;
      if (o.alias !== undefined && o.alias !== null) p.alias = o.alias;
      // [OVERRIDE-ML] el ml que carga el jefe en Editar (el panel ya lo aplicaba): la card, el detalle y el tope de
      // decants (decantPrecioFrasco100) lo usan. Faltaba acá, y el sitio mostraba el ml de perfumes.js.
      if (o.ml) p.ml = o.ml;
      if (o.similares_manuales !== undefined && o.similares_manuales !== null) p.similares_manuales = o.similares_manuales;
      if (o.similares_nota !== undefined && o.similares_nota !== null) p.similares_nota = o.similares_nota;
      if (o.nota_ultimo !== undefined && o.nota_ultimo !== null) p.nota_ultimo = o.nota_ultimo;
      if (o.nota_sin_stock !== undefined && o.nota_sin_stock !== null) p.nota_sin_stock = o.nota_sin_stock;
      if (o.nota_proximamente !== undefined && o.nota_proximamente !== null) p.nota_proximamente = o.nota_proximamente;
      // [SELECCION-ST-1B] Quote del jefe — solo aparece en Selección ST (los 6
      // perfumes destacados del podio). Activación pendiente de SQL ALTER TABLE
      // perfume_overrides ADD COLUMN nota_jefe TEXT + UI admin para editarlo.
      if (o.nota_jefe !== undefined && o.nota_jefe !== null) p.nota_jefe = o.nota_jefe;
      // [DECANT-PRECIO-MANUAL] Precio de decant y exclusión, cargados desde el
      // admin (Editar perfume). Si la columna no existe todavía, quedan undefined
      // y el armador se comporta como antes.
      if (o.precio_decant !== undefined && o.precio_decant !== null) p._precioDecant = o.precio_decant;
      if (o.decant_excluido !== undefined && o.decant_excluido !== null) p._decantExcluido = !!o.decant_excluido;
    }

    // Cargar overrides desde Supabase y aplicar sobre perfumes.js
    async function loadOverrides() {
      // Pre-aplicar cache si existe (instant fallback)
      var cached = readCache('perfume_overrides');
      // [DECANT-PRECIO-MANUAL] applyOverrideToPerfume sólo pisa cuando el valor
      // nuevo no es null (misma convención que el resto de los campos), así que
      // un precio BORRADO en el admin llegaba como null, no pisaba nada, y el
      // precio viejo del cache quedaba vivo hasta que el cache expiraba (30 min).
      //
      // Para poder deshacer lo que pone el cache guardamos el valor PREVIO, no
      // sólo el slug: loadPerfumesNuevos() corre ANTES que esta función, así que
      // acá `p._precioDecant` puede traer ya el precio cargado en perfumes_nuevos.
      // Borrar a ciegas se lo llevaba puesto y dejaba el perfume "a consultar"
      // durante una carga. Snapshot antes de aplicar el cache, restore después.
      var previoPrecioDecant = [];
      if (cached && Array.isArray(cached)) {
        cached.forEach(function(o) {
          if (o && o.precio_decant !== undefined && o.precio_decant !== null) {
            var pPrev = PERFUMES.find(function(x) { return x.slug === o.slug; });
            if (pPrev) {
              previoPrecioDecant.push({
                slug:  o.slug,
                tenia: Object.prototype.hasOwnProperty.call(pPrev, '_precioDecant'),
                valor: pPrev._precioDecant
              });
            }
          }
          applyOverrideToPerfume(o);
        });
        console.log('[loadOverrides] aplicado desde cache:', cached.length, 'overrides');
      }
      try {
        var { data, error } = await withTimeout(
          sb.from('perfume_overrides').select('*'),
          3000,
          'perfume_overrides'
        );
        if (error) { console.warn('[loadOverrides] supabase error:', error.message); return; }
        if (data && data.length > 0) {
          writeCache('perfume_overrides', data);
          // [DECANT-PRECIO-MANUAL] Deshacer lo que puso el cache dejando el valor
          // que había ANTES (normalmente el de perfumes_nuevos), no borrando.
          // Si antes no había nada, ahí sí se borra la clave. Recién después
          // aplicamos lo fresco, que es lo que manda.
          previoPrecioDecant.forEach(function(snap) {
            var p = PERFUMES.find(function(x) { return x.slug === snap.slug; });
            if (!p) return;
            if (snap.tenia) p._precioDecant = snap.valor;
            else delete p._precioDecant;
          });
          data.forEach(applyOverrideToPerfume);
        }
      } catch(e) {
        console.warn('[loadOverrides] timeout o error:', e.message, '— usando cache si hay');
      }
    }

    // Path crítico: nuevos perfumes + overrides → render del catálogo.
    // loadPerfumeViews (stats) NO bloquea el render — se difiere.
    console.log('[catalog] STEP 1: PERFUMES base =', PERFUMES.length, 'items');
    loadPerfumesNuevos().then(function() {
      console.log('[catalog] STEP 2: loadPerfumesNuevos OK, PERFUMES =', PERFUMES.length);
      return loadOverrides();
    }).then(function() {
      console.log('[catalog] STEP 3: loadOverrides OK');
      markNewPerfumes();
      console.log('[catalog] STEP 4: markNewPerfumes OK, llamando renderCatalog...');
      renderCatalog();
      console.log('[catalog] STEP 5: renderCatalog OK, grid tiene', document.querySelectorAll('#catalogGrid .product-card').length, 'cards');
      sortCards('price-desc');
      checkDeepLink();
      // Stats de views: diferido, solo afecta el contador "+N personas vieron…"
      deferTask(function() {
        loadPerfumeViews().then(function() {
          // Re-render selectivo si hay views nuevos (no rompe nada si no hay)
          if (typeof renderCatalog === 'function') renderCatalog();
        });
      });
    }).catch(function(err) {
      // FALLBACK CRÍTICO: si algo en la cadena loadNuevos→loadOverrides→render
      // tira excepción no atrapada, igual renderizamos el catálogo con los
      // datos de perfumes.js (seed) para que el cliente no quede sin nada.
      console.error('[catalog] FALLO en cadena de carga:', err);
      try {
        renderCatalog();
        sortCards('price-desc');
        console.warn('[catalog] FALLBACK: renderizado con seed solo');
      } catch(e) {
        console.error('[catalog] FALLBACK también falló:', e);
      }
    });
    renderCategories();
    // Diferida: la votación no es above-the-fold. El horario (las dos píldoras) sale de la IIFE de HORARIOS, más abajo.
    deferTask(loadVotacionFromDB);

    // [HORARIO-DOS-FUENTES] La píldora flotante del horario (#waStatus) ya no se calcula acá: tenía el horario
    // escrito a mano (lunes a sábado de 10 a 20) y no miraba feriados ni el ajuste del panel, así que podía decir
    // otra cosa que la del hero. Las dos salen de la misma cuenta, en la IIFE de HORARIOS (más abajo).

    // ============================================================
    // SCROLL TO TOP — mostrar/ocultar
    // ============================================================
    window.addEventListener('scroll', function() {
      var btn = document.getElementById('scrollTop');
      if (btn) btn.classList.toggle('visible', window.scrollY > 600);
    });

    // ============================================================
    // CARD ENTRANCE ANIMATION
    // ============================================================
    (function() {
      // IntersectionObserver: anima cards cuando entran al viewport
      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (entry.isIntersecting) {
              var card = entry.target;
              card.classList.add('card-animate');
              requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                  card.classList.add('card-visible');
                });
              });
              observer.unobserve(card);
            }
          });
        }, { threshold: 0.1 });

        function observeCards() {
          document.querySelectorAll('.product-card').forEach(function(card) {
            if (!card.classList.contains('card-visible')) {
              observer.observe(card);
            }
          });
        }

        // Observar cards iniciales
        setTimeout(observeCards, 100);

        // Re-observar cuando se hace load more
        var origLoadMore = loadMore;
        loadMore = function() {
          origLoadMore();
          observeCards();
        };
      } else {
        // Fallback para navegadores sin IntersectionObserver
        document.querySelectorAll('.product-card').forEach(function(card) {
          card.classList.add('card-visible');
        });
      }
    })();

    // ============================================================
    // SKELETON — mostrar shimmer hasta que la imagen cargue
    // ============================================================
    (function() {
      document.querySelectorAll('.card-image img').forEach(function(img) {
        if (img.complete && img.naturalWidth > 0) return;
        var skeleton = document.createElement('div');
        skeleton.className = 'skeleton-bg';
        img.style.opacity = '0';
        img.style.position = 'absolute';
        img.parentNode.style.position = 'relative';
        img.parentNode.insertBefore(skeleton, img);
        img.addEventListener('load', function() {
          skeleton.remove();
          img.style.opacity = '1';
          img.style.position = '';
          img.parentNode.style.position = '';
        });
        img.addEventListener('error', function() {
          skeleton.remove();
          img.style.opacity = '1';
          img.style.position = '';
          img.parentNode.style.position = '';
        });
      });
    })();

    // ============================================================
    // SERVICE WORKER (PWA) — registro + actualización auto con MITIGACIÓN
    // ============================================================
    // [PWA-AUTO-RELOAD] Cuando se deploya una versión nueva, el SW se actualiza
    // en background → tomamos control de la tab abierta → recargamos sola para
    // que el cliente vea la versión nueva SIN tener que tocar F5.
    //
    // MITIGACIÓN ANTI-INTERRUPCIÓN: el reload SOLO ocurre si el cliente NO está
    // interactuando con la página en ese momento. Si está:
    //   - Con un modal abierto (compare, armador, carrito, login, etc.)
    //   - Tipiando en un input/textarea
    //   - Scrolleando (últimos 3 segundos)
    //   - En la primer visita (no había SW previo → nada que actualizar)
    // … entonces el reload se POSTERGA y reintenta cada 5 segundos hasta que
    // el cliente esté "tranquilo". Garantía: el cliente NUNCA pierde lo que
    // estaba haciendo. La recarga pasa cuando él está leyendo / quieto.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(function(reg) {
        reg.addEventListener('updatefound', function() {
          var newSW = reg.installing;
          if (newSW) {
            newSW.addEventListener('statechange', function() {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                newSW.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      }).catch(function(){});

      // Tracker de scroll reciente — pasivo, sin impacto perf
      var _lastScrollAt = 0;
      window.addEventListener('scroll', function() { _lastScrollAt = Date.now(); }, { passive: true });

      // Selector unificado de modales/overlays que se consideran "el cliente está en algo"
      var BUSY_MODAL_SELECTORS = [
        '.modal-overlay.active',
        '.compare-overlay.active',
        '.decant-builder-overlay.active',
        '.cart-panel-overlay.active',
        '.bottom-sheet-overlay.active',
        '.auth-overlay.open',          // [RELOAD-CON-LOGIN] el login se abre con .open (decía .active y nunca coincidía)
        '.juegos-overlay.active',      // [RELOAD-CON-LOGIN] la ventana de juegos
        '.waitlist-overlay.active',    // [RELOAD-CON-LOGIN] la ventana «Avisame»
        '.quiz-results[style*="block"]',
        '.compare-modal',
        '.cuenta-hoja-overlay.open',   // [BARRA-CELU] la hoja «Hola, <nombre>»
      ].join(', ');

      function isUserBusy() {
        // 1) Modal/overlay activo en pantalla
        if (document.querySelector(BUSY_MODAL_SELECTORS)) return true;
        // 2) Cliente tipiando en algún input/textarea
        var ae = document.activeElement;
        if (ae) {
          var tag = ae.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) return true;
        }
        // 3) Scroll reciente (< 3s)
        if (_lastScrollAt && (Date.now() - _lastScrollAt < 3000)) return true;
        return false;
      }

      var _reloaded = false;
      var _initialController = navigator.serviceWorker.controller; // null en first visit
      function safeReload() {
        if (_reloaded) return;
        if (isUserBusy()) {
          // Postergamos: chequeamos de nuevo en 5s. Loop hasta que esté quieto.
          setTimeout(safeReload, 5000);
          return;
        }
        _reloaded = true;
        // Pequeño delay para evitar reload tan brusco si recién dejó de hacer algo
        setTimeout(function() { window.location.reload(); }, 200);
      }

      navigator.serviceWorker.addEventListener('controllerchange', function() {
        // FIRST VISIT: no había controller antes → este es el primer install,
        // NO recargar (el cliente acaba de entrar, la página ya es la última).
        if (!_initialController) return;
        // UPDATE: había un SW viejo, ahora hay uno nuevo → reload con mitigación.
        safeReload();
      });
    }

    // ============================================================
    // PWA — Install prompt custom
    // ============================================================
    (function() {
      var deferredPrompt = null;
      var INSTALL_DISMISS_KEY = 'st_pwa_install_dismissed';
      var INSTALL_DISMISS_DAYS = 30;

      function isInstalled() {
        // standalone (iOS) o display-mode (Chrome)
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
      }

      function wasDismissedRecently() {
        try {
          var ts = parseInt(localStorage.getItem(INSTALL_DISMISS_KEY) || '0', 10);
          if (!ts) return false;
          var daysAgo = (Date.now() - ts) / (1000 * 60 * 60 * 24);
          return daysAgo < INSTALL_DISMISS_DAYS;
        } catch(_) { return false; }
      }

      function createInstallBanner() {
        if (document.getElementById('pwaInstallBanner')) return;
        var banner = document.createElement('div');
        banner.id = 'pwaInstallBanner';
        banner.innerHTML =
          '<div class="pwa-banner-inner">' +
            '<div class="pwa-banner-icon">' +
              '<svg viewBox="0 0 64 64" width="40" height="40">' +
                '<rect width="64" height="64" rx="12" fill="#121214"/>' +
                '<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="serif" font-weight="700" font-size="32" fill="#E8B800">ST</text>' +
              '</svg>' +
            '</div>' +
            '<div class="pwa-banner-text">' +
              '<strong>Instalar ST Perfumería</strong>' +
              '<span>Acceso rápido desde tu pantalla de inicio</span>' +
            '</div>' +
            '<button class="pwa-banner-btn" id="pwaInstallBtn">Instalar</button>' +
            '<button class="pwa-banner-close" id="pwaInstallClose" aria-label="Cerrar">×</button>' +
          '</div>';
        document.body.appendChild(banner);

        document.getElementById('pwaInstallBtn').addEventListener('click', function() {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(function(choice) {
            if (choice.outcome === 'accepted') {
              try { trackEvent('view_product', { meta: { pwa: 'installed' } }); } catch(_){}
            } else {
              try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch(_){}
            }
            deferredPrompt = null;
            hideBanner();
          });
        });
        document.getElementById('pwaInstallClose').addEventListener('click', function() {
          try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch(_){}
          hideBanner();
        });
        setTimeout(function() { banner.classList.add('visible'); }, 50);
      }

      function hideBanner() {
        var banner = document.getElementById('pwaInstallBanner');
        if (banner) {
          banner.classList.remove('visible');
          setTimeout(function() { banner.remove(); }, 300);
        }
      }

      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
        if (isInstalled() || wasDismissedRecently()) return;
        // Mostrar banner después de 25s para no asustar al usuario
        setTimeout(function() {
          if (deferredPrompt && !isInstalled()) createInstallBanner();
        }, 25000);
      });

      window.addEventListener('appinstalled', function() {
        hideBanner();
        try { localStorage.removeItem(INSTALL_DISMISS_KEY); } catch(_){}
      });
    })();

    // ============================================================
    // SEO — Handler ?q= para búsqueda automática al cargar
    // Usado por landing pages de marcas (/lattafa, /afnan, etc.) que
    // redirigen a /?q=Lattafa#catalogo para auto-filtrar la búsqueda
    // y scrollear al catálogo. Mejora el flow desde Google a producto.
    // ============================================================
    (function() {
      var params = new URLSearchParams(window.location.search);
      var q = params.get('q');
      if (!q) return;
      setTimeout(function() {
        var input = document.getElementById('searchInput');
        if (input && typeof applySearch === 'function') {
          input.value = q;
          applySearch(q);
          if (typeof scrollToCatalog === 'function') {
            setTimeout(function() { scrollToCatalog(); }, 200);
          }
        }
      }, 600);
    })();

    // ============================================================
    // PWA — Handler de shortcuts del manifest (?action=decants|favs|new)
    // También usado por landing pages SEO (api/category) que redirigen
    // con ?action= para disparar comportamiento específico al volver al home.
    // ============================================================
    (function() {
      var params = new URLSearchParams(window.location.search);
      var action = params.get('action');
      if (!action) return;
      setTimeout(function() {
        if (action === 'decants') {
          var btn = document.getElementById('decantBuilderBtn') || document.querySelector('[onclick*="openDecantBuilder"]');
          if (typeof openDecantBuilder === 'function') openDecantBuilder();
          else if (btn) btn.click();
        } else if (action === 'favs') {
          if (typeof showFavorites === 'function') showFavorites();
        } else if (action === 'new') {
          // Activar filtro "Nuevos" + scrollear al catálogo
          var newBtn = document.querySelector('.filter-btn[onclick*="filterByNew"]');
          if (newBtn && typeof filterByNew === 'function') {
            filterByNew(newBtn);
            if (typeof scrollToCatalog === 'function') {
              setTimeout(function() { scrollToCatalog(); }, 100);
            }
          }
        }
      }, 600);
    })();

    // ============================================================
    // HORARIO DEL LOCAL — automático con feriados + cierres admin
    // ============================================================
    (function() {
      var HORARIOS = {
        1: { open: 10, close: 20 },  // Lunes
        2: { open: 10, close: 20 },  // Martes
        3: { open: 10, close: 20 },  // Miércoles
        4: { open: 10, close: 20 },  // Jueves
        5: { open: 10, close: 20 },  // Viernes
        6: { open: 10, close: 14 },  // Sábado
        0: null                        // Domingo cerrado
      };

      // [HORARIO-DOS-FUENTES] decisión del PREPARADOR (24-sep): una sola cuenta para las dos píldoras — la del hero
      // (#storeStatus) y la flotante de WhatsApp (#waStatus) —, con HORARIOS (y el ajuste del panel), los feriados y
      // los cierres especiales. Cada una escribe su texto como siempre; lo que se unifica es de dónde salen el día y
      // la hora. El próximo día que abre saltea los feriados y los cierres especiales.
      var DIAS_SEMANA = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
      function isoDe(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
      function feriadoDe(d, feriados) {
        for (var i = 0; feriados && i < feriados.length; i++) if (feriados[i].mes === d.getMonth() + 1 && feriados[i].dia === d.getDate()) return feriados[i];
        return null;
      }
      function cierreDe(d, cierres) {
        var iso = isoDe(d);
        for (var i = 0; cierres && i < cierres.length; i++) if (cierres[i].fecha === iso) return cierres[i];
        return null;
      }
      function calcularEstadoHorario(feriados, cierres) {
        var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
        var cierre = cierreDe(now, cierres);
        if (cierre) return { tipo: 'especial', motivo: cierre.motivo };
        var feriado = feriadoDe(now, feriados);
        if (feriado) {   // [ESTADO-LOCAL] la flotante dice cuándo abrimos: la misma cuenta que «Cerrado»
          var pf = proximaApertura(now, feriados, cierres);
          return { tipo: 'feriado', motivo: feriado.motivo || 'Feriado', abreEn: pf.abreEn, abreDia: pf.abreDia, abreHora: pf.abreHora };
        }
        var horario = HORARIOS[now.getDay()];
        var minutos = now.getHours() * 60 + now.getMinutes();
        if (horario && minutos >= horario.open * 60 && minutos < horario.close * 60) {
          return { tipo: 'abierto', cierra: horario.close, faltanMin: horario.close * 60 - minutos };
        }
        if (horario && minutos < horario.open * 60) return { tipo: 'cerrado', abreEn: 0, abreDia: now.getDay(), abreHora: horario.open };
        var p = proximaApertura(now, feriados, cierres);
        return { tipo: 'cerrado', abreEn: p.abreEn, abreDia: p.abreDia, abreHora: p.abreHora };
      }
      // El próximo día que abre, desde mañana: saltea los feriados y los cierres especiales.
      function proximaApertura(now, feriados, cierres) {
        for (var i = 1; i <= 7; i++) {
          var d = new Date(now); d.setDate(d.getDate() + i);
          var h = HORARIOS[d.getDay()];
          if (h && !feriadoDe(d, feriados) && !cierreDe(d, cierres)) return { abreEn: i, abreDia: d.getDay(), abreHora: h.open };
        }
        return { abreEn: null };
      }

      // La del hero: «cierra a las 20hs», «abrimos hoy a las 10hs», «abrimos lunes 10hs». [ESTADO-MINUSCULA] decisión 103:
      // después del «·», minúscula, acá y en la flotante (en el hero no se nota: .store-status va en mayúsculas).
      function updateStatus(estado) {
        var el = document.getElementById('storeStatus');
        var textEl = document.getElementById('storeStatusText');
        if (!el || !textEl) return;
        if (estado.tipo === 'especial' || estado.tipo === 'feriado') {
          el.className = 'store-status holiday';
          textEl.textContent = estado.tipo === 'feriado' ? 'Hoy feriado · ' + estado.motivo : estado.motivo;
        } else if (estado.tipo === 'abierto') {
          el.className = 'store-status open';
          textEl.textContent = 'Abierto · cierra a las ' + estado.cierra + 'hs' + (estado.faltanMin <= 60 ? ' · ¡última hora!' : '');
        } else {
          el.className = 'store-status closed';
          textEl.textContent = estado.abreEn === 0 ? 'Cerrado · abrimos hoy a las ' + estado.abreHora + 'hs'
            : estado.abreEn ? 'Cerrado · abrimos ' + DIAS_SEMANA[estado.abreDia] + ' ' + estado.abreHora + 'hs'
            : 'Cerrado';
        }
        el.style.display = 'inline-flex';
      }

      // La flotante: «cierra en 2h 30min», «abrimos hoy 10hs», «abrimos mañana 10hs» (minúscula después del «·»). El feriado,
      // corto y con el patrón de «Cerrado»: «Feriado · abrimos mañana 10hs» ([ESTADO-LOCAL], decisión 96; el nombre del
      // feriado queda sólo en el hero). Un cierre especial muestra su motivo, como antes.
      function pintarWaStatus(estado) {
        var el = document.getElementById('waStatus');
        if (!el) return;
        var clase = 'wa-status--closed', texto;
        if (estado.tipo === 'feriado') {
          clase = 'wa-status--special';
          texto = 'Feriado' + (estado.abreEn === 1 && estado.abreDia !== 1 ? ' · abrimos mañana ' + estado.abreHora + 'hs'
            : estado.abreEn ? ' · abrimos ' + DIAS_SEMANA[estado.abreDia] + ' ' + estado.abreHora + 'hs'
            : '');
        } else if (estado.tipo === 'especial') {
          clase = 'wa-status--special';
          texto = estado.motivo;
        } else if (estado.tipo === 'abierto') {
          var hs = Math.floor(estado.faltanMin / 60), mins = estado.faltanMin % 60;
          clase = 'wa-status--open';
          texto = 'Abierto · cierra en ' + (hs > 0 ? hs + 'h ' + (mins > 0 ? mins + 'min' : '') : mins + 'min').trim();
        } else {
          texto = estado.abreEn === 0 ? 'Cerrado · abrimos hoy ' + estado.abreHora + 'hs'
            : estado.abreEn === 1 && estado.abreDia !== 1 ? 'Cerrado · abrimos mañana ' + estado.abreHora + 'hs'   // como antes: «lunes» si abre el lunes
            : estado.abreEn ? 'Cerrado · abrimos ' + DIAS_SEMANA[estado.abreDia] + ' ' + estado.abreHora + 'hs'
            : 'Cerrado';
        }
        el.className = 'wa-status ' + clase;
        el.innerHTML = '<span class="wa-status-dot"></span>';
        el.appendChild(document.createTextNode(texto));
      }

      // Cargar feriados + cierres + ajuste horario en paralelo
      var year = new Date().getFullYear();
      Promise.all([
        // API argentinadatos.com devuelve [{fecha:"YYYY-MM-DD", tipo, nombre}] → lo transformamos a {mes, dia, motivo}
        fetch('https://api.argentinadatos.com/v1/feriados/' + year)
          .then(function(r) { return r.ok ? r.json() : []; })
          .then(function(arr) {
            if (!Array.isArray(arr)) return [];
            return arr.map(function(f) {
              var parts = (f.fecha || '').split('-');
              return { mes: parseInt(parts[1], 10), dia: parseInt(parts[2], 10), motivo: f.nombre || f.motivo || 'Feriado' };
            }).filter(function(f) { return f.mes && f.dia; });
          })
          .catch(function() { return []; }),
        sb.from('cierres_especiales').select('fecha,motivo').then(function(r) { return r.data || []; }).catch(function() { return []; }),
        sb.from('ajuste_horario').select('*').order('created_at', { ascending: false }).limit(1).then(function(r) {
          if (r.error) {
            console.warn('[horario] no se pudo leer ajuste_horario (¿RLS bloqueando anon?):', r.error.message);
            return [];
          }
          if (!r.data || r.data.length === 0) {
            console.info('[horario] ajuste_horario vacío — usando HORARIOS por defecto');
          }
          return r.data || [];
        }).catch(function(e) { console.warn('[horario] excepción:', e); return []; })
      ]).then(function(results) {
        // Aplicar horario modificado si hay uno vigente hoy
        var hoyISO = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
        var hoyStr = hoyISO.getFullYear() + '-' + String(hoyISO.getMonth()+1).padStart(2,'0') + '-' + String(hoyISO.getDate()).padStart(2,'0');
        var ajuste = results[2][0];
        // Margen de 1 día en "desde" para tolerar ajustes guardados con TZ
        // shifted (admin viejo guardaba UTC, que de noche ya era "mañana").
        var manianaAR = new Date(hoyISO); manianaAR.setDate(manianaAR.getDate() + 1);
        var manianaStr = manianaAR.getFullYear() + '-' + String(manianaAR.getMonth()+1).padStart(2,'0') + '-' + String(manianaAR.getDate()).padStart(2,'0');
        // Si desde/hasta son null/falsy → tratamos como "siempre vigente"
        var enRango = !!ajuste
          && (!ajuste.desde || ajuste.desde <= manianaStr)
          && (!ajuste.hasta || ajuste.hasta >= hoyStr);
        if (enRango) {
          // Sobreescribir horarios L-V con los del ajuste
          for (var d = 1; d <= 5; d++) {
            HORARIOS[d] = { open: ajuste.hora_abre, close: ajuste.hora_cierra };
          }
          // Sábado usa hora_cierra_sab si existe, sino hora_cierra
          var cierreSab = ajuste.hora_cierra_sab || ajuste.hora_cierra;
          if (HORARIOS[6]) {
            HORARIOS[6] = { open: ajuste.hora_abre, close: cierreSab };
          }
          // Actualizar footer dinámicamente
          var elLV = document.getElementById('footerHorarioLV');
          var elSab = document.getElementById('footerHorarioSab');
          var elNota = document.getElementById('footerHorarioNota');
          if (elLV) elLV.textContent = 'Lun a Vie: ' + ajuste.hora_abre + ':00 - ' + ajuste.hora_cierra + ':00';
          if (elSab) elSab.textContent = 'S\u00e1bados: ' + ajuste.hora_abre + ':00 - ' + cierreSab + ':00';
          if (elNota && ajuste.mostrar_nota && ajuste.motivo) {
            elNota.textContent = '\ud83d\udcc5 ' + ajuste.motivo;
            elNota.style.display = 'block';
          }
          // Mismo update para "D\u00f3nde encontrarnos" (map-section)
          var mapLV = document.getElementById('mapHorarioLV');
          var mapSab = document.getElementById('mapHorarioSab');
          var mapNota = document.getElementById('mapHorarioNota');
          if (mapLV) mapLV.innerHTML = '<strong>Lunes a Viernes</strong> ' + ajuste.hora_abre + ':00 a ' + ajuste.hora_cierra + ':00 hs';
          if (mapSab) mapSab.innerHTML = '<strong>S\u00e1bados</strong> ' + ajuste.hora_abre + ':00 a ' + cierreSab + ':00 hs';
          if (mapNota && ajuste.mostrar_nota && ajuste.motivo) {
            mapNota.textContent = '\ud83d\udcc5 ' + ajuste.motivo;
            mapNota.style.display = 'block';
          }
        }
        var estado = calcularEstadoHorario(results[0], results[1]);
        updateStatus(estado);
        pintarWaStatus(estado);
      });
    })();

    // ============================================================
    // ============================================================
    // CARRITO / PEDIDO
    // ============================================================
    var cart = JSON.parse(sessionStorage.getItem('st_cart') || '[]');
    var CART_LIMIT = 15;

    function updateCartUI() {
      var btn = document.getElementById('cartFloat');
      var countEl = document.getElementById('cartFloatCount');
      if (countEl) countEl.textContent = cart.length;
      if (btn) btn.classList.toggle('visible', cart.length > 0);
      // Sincronizar también el badge del nav (nuevo botón carrito en navbar)
      var navBadge = document.getElementById('navCartBadge');
      var navBtn = document.getElementById('navCartBtn');
      if (navBadge) navBadge.textContent = cart.length;
      if (navBtn) navBtn.classList.toggle('has-items', cart.length > 0);
      // [BARRA-CELU] el número del carrito en la barra del celu (el mismo contador que .cart-float)
      var barraNum = document.getElementById('barraNumCarrito');
      if (barraNum) { barraNum.textContent = cart.length; barraNum.hidden = cart.length === 0; }
      sessionStorage.setItem('st_cart', JSON.stringify(cart));
    }

    function resetCartButtons() {
      document.querySelectorAll('.cart-add-btn').forEach(function(btn) {
        var card = btn.closest('.product-card');
        if (!card) return;
        var slug = card.dataset.slug;
        if (cart.indexOf(slug) === -1) {
          btn.textContent = '🛒 Agregar al pedido';
          btn.classList.remove('added');
        }
      });
    }

    function showCartLimitMsg(msg) {
      var el = document.getElementById('cartLimitMsg');
      if (!el) return;
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(function() { el.style.display = 'none'; }, 4000);
    }

    var cartToastTimer = null;
    function showCartToast(slug) {
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      var toast = document.getElementById('cartToast');
      var imgWrap = document.getElementById('cartToastImgWrap');
      var nameEl = document.getElementById('cartToastName');
      var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
      imgWrap.innerHTML = fotoSrc
        ? '<img class="cart-toast-img" src="' + fotoSrc + '" alt="' + p.name + '">'
        : '<div class="cart-toast-img-placeholder">' + p.name.charAt(0) + '</div>';
      nameEl.textContent = p.name;
      if (cartToastTimer) clearTimeout(cartToastTimer);
      toast.classList.remove('leaving');
      toast.classList.add('active');
      cartToastTimer = setTimeout(function() {
        toast.classList.add('leaving');
        setTimeout(function() {
          toast.classList.remove('active', 'leaving');
        }, 300);
      }, 1500);
    }

    // 🔊 Sonido sutil al agregar al carrito (Web Audio API, sin assets)
    // Toca un "pop" warm de ~200ms generado on-the-fly. Sin archivos
    // mp3. Respeta preferencia user (localStorage 'st_sound_muted') y
    // prefers-reduced-motion.
    var _audioCtx = null;
    function playCartSound() {
      try {
        if (localStorage.getItem('st_sound_muted') === '1') return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (!_audioCtx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          _audioCtx = new AC();
        }
        var ctx = _audioCtx;
        var now = ctx.currentTime;
        // Dos osciladores: E5 + B5 (quinta) — armónico cálido tipo Apple
        function tone(freq, startOffset, duration, gainPeak) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now + startOffset);
          gain.gain.linearRampToValueAtTime(gainPeak, now + startOffset + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + startOffset);
          osc.stop(now + startOffset + duration + 0.02);
        }
        tone(659.25, 0,    0.18, 0.08);   // E5
        tone(987.77, 0.04, 0.16, 0.05);   // B5
      } catch(e) { /* fail silent */ }
    }

    function addToCart(slug, btn, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (cart.indexOf(slug) !== -1) {
        // Ya está, quitar
        cart = cart.filter(function(s) { return s !== slug; });
        if (btn) { btn.textContent = '\ud83d\uded2 Agregar al pedido'; btn.classList.remove('added'); }
      } else {
        if (cart.length >= CART_LIMIT) {
          showCartLimitMsg('M\u00e1ximo ' + CART_LIMIT + ' fragancias por pedido \ud83d\ude0a');
          return;
        }
        cart.push(slug);
        if (btn) { btn.textContent = '\u2713 Agregado'; btn.classList.add('added'); }
        flyToCart(slug, btn);
        showCartToast(slug);
        playCartSound();      // \ud83d\udd0a feedback sonoro premium
      }
      updateCartUI();
    }

    // ============================================================
    // FLY TO CART — animación visual al agregar
    // ============================================================
    function flyToCart(slug, triggerBtn) {
      var card = document.querySelector('[data-slug="' + slug + '"]');
      if (!card) return;

      // Buscar la imagen de la card (o el placeholder)
      var imgEl = card.querySelector('.card-image img') || card.querySelector('.card-image .photo-coming');
      if (!imgEl) return;

      var cartBtn = document.getElementById('cartFloat');

      // Posiciones
      var imgRect = imgEl.getBoundingClientRect();
      var cartRect = cartBtn ? cartBtn.getBoundingClientRect() : { left: window.innerWidth - 80, top: window.innerHeight - 120, width: 40, height: 40 };

      // Crear clon volador
      var flyer = document.createElement('div');
      flyer.className = 'fly-to-cart';

      if (imgEl.tagName === 'IMG') {
        var clonedImg = document.createElement('img');
        clonedImg.src = imgEl.src;
        clonedImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
        flyer.appendChild(clonedImg);
      } else {
        flyer.style.background = '#1a1a1a';
        flyer.style.display = 'flex';
        flyer.style.alignItems = 'center';
        flyer.style.justifyContent = 'center';
        var letter = document.createElement('span');
        letter.textContent = (PERFUMES.find(function(p){ return p.slug === slug; }) || {}).name.charAt(0) || '?';
        letter.style.cssText = 'color:var(--amarillo);font-size:1.5rem;font-weight:700;';
        flyer.appendChild(letter);
      }

      // Posicionar en el lugar de la imagen
      var startW = Math.min(imgRect.width, 120);
      var startH = Math.min(imgRect.height, 150);
      flyer.style.left = imgRect.left + (imgRect.width - startW) / 2 + 'px';
      flyer.style.top = imgRect.top + (imgRect.height - startH) / 2 + 'px';
      flyer.style.width = startW + 'px';
      flyer.style.height = startH + 'px';
      flyer.style.opacity = '1';

      document.body.appendChild(flyer);

      // Calcular destino
      var endX = cartRect.left + cartRect.width / 2 - startW / 2;
      var endY = cartRect.top + cartRect.height / 2 - startH / 2;
      var dx = endX - parseFloat(flyer.style.left);
      var dy = endY - parseFloat(flyer.style.top);

      // Spawn partículas desde la imagen
      spawnParticles(imgRect.left + imgRect.width / 2, imgRect.top + imgRect.height / 2);

      // Forzar reflow
      flyer.offsetHeight;

      // Animar
      flyer.classList.add('flying');
      flyer.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(.15)';
      flyer.style.opacity = '.4';
      flyer.style.borderRadius = '50%';

      // Al terminar: pop del carrito + limpiar
      setTimeout(function() {
        flyer.remove();
        if (cartBtn) {
          cartBtn.classList.remove('cart-pop');
          void cartBtn.offsetHeight;
          cartBtn.classList.add('cart-pop');
          setTimeout(function() { cartBtn.classList.remove('cart-pop'); }, 600);
        }
      }, 680);
    }

    function spawnParticles(x, y) {
      var colors = ['#E8B800', '#f5d442', '#fff', '#ffd700', '#ffaa00'];
      for (var i = 0; i < 8; i++) {
        var particle = document.createElement('div');
        particle.className = 'cart-particle';
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        document.body.appendChild(particle);

        var angle = (Math.PI * 2 / 8) * i + (Math.random() - .5) * .5;
        var dist = 40 + Math.random() * 50;
        var tx = Math.cos(angle) * dist;
        var ty = Math.sin(angle) * dist - 20;

        particle.style.transition = 'transform .5s cubic-bezier(.25,.46,.45,.94), opacity .5s ease';
        particle.offsetHeight;
        particle.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(0)';
        particle.style.opacity = '0';

        (function(el) {
          setTimeout(function() { el.remove(); }, 550);
        })(particle);
      }
    }

    function addFavsToCart() {
      var added = 0;
      var skipped = 0;
      favs.forEach(function(slug) {
        if (cart.indexOf(slug) !== -1) return; // ya en carrito
        if (cart.length >= CART_LIMIT) { skipped++; return; }
        cart.push(slug);
        added++;
      });
      updateCartUI();
      // Actualizar botones de las cards visibles
      document.querySelectorAll('.cart-add-btn').forEach(function(btn) {
        var card = btn.closest('.product-card');
        if (!card) return;
        var slug = card.dataset.slug;
        if (cart.indexOf(slug) !== -1) {
          btn.textContent = '✓ Agregado';
          btn.classList.add('added');
        }
      });
      if (added > 0) openCartPanel(); // refrescar panel
      if (skipped > 0) {
        showCartLimitMsg('Se agregaron ' + added + ', pero ' + skipped + ' no entraron (máx. ' + CART_LIMIT + ')');
      } else if (added === 0) {
        showCartLimitMsg('Tus favoritos ya están en el pedido ✓');
      } else {
        showCartLimitMsg(added + ' favorito' + (added > 1 ? 's' : '') + ' agregado' + (added > 1 ? 's' : '') + ' al pedido ❤️');
      }
    }

    function openCartPanel() {
      var container = document.getElementById('cartItems');
      var totalEl = document.getElementById('cartTotal');
      var cashEl = document.getElementById('cartCash');

      if (cart.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--gris);padding:1rem;font-size:.75rem;">Tu pedido está vacío</p>';
        totalEl.textContent = '$0';
        cashEl.textContent = '';
      } else {
        var html = '';
        var listaTotal = 0;
        var cashTotal = 0;
        var anyHotSale = false;
        cart.forEach(function(slug) {
          var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
          if (!p) return;
          var listaPrice = getListaPrice(p);
          listaTotal += listaPrice;
          cashTotal += getCashPrice(p);
          if (hasHotSale(p)) anyHotSale = true;
          var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
          var imgHTML = fotoSrc
            ? '<img class="cart-item-img" src="' + fotoSrc + '" alt="' + p.name + '">'
            : '<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1rem;color:var(--amarillo);opacity:.3;">' + p.name.charAt(0) + '</div>';
          html += '<div class="cart-item">'
            + imgHTML
            + '<div class="cart-item-info"><p class="cart-item-name">' + p.name + '</p><p class="cart-item-brand">' + (p.marca_real || p.marca) + '</p></div>'
            + '<span class="cart-item-price">$' + Math.round(listaPrice).toLocaleString('es-AR').replace(/,/g, '.') + '</span>'
            + '<button class="cart-item-remove" onclick="removeFromCart(\'' + slug + '\')">&times;</button>'
          + '</div>';
        });
        container.innerHTML = html;
        var cuota = Math.round(listaTotal / 3);
        totalEl.textContent = '$' + cuota.toLocaleString('es-AR').replace(/,/g, '.');
        var pctOff = listaTotal > 0 ? Math.round((1 - cashTotal / listaTotal) * 100) : 0;
        var cashLabel = anyHotSale ? HOT_SALE_LABEL : 'Efectivo/transf';
        cashEl.textContent = cashLabel + ': $' + cashTotal.toLocaleString('es-AR').replace(/,/g, '.') + ' (total $' + Math.round(listaTotal).toLocaleString('es-AR').replace(/,/g, '.') + ' con ' + pctOff + '% off)';
      }
      document.getElementById('cartPanelOverlay').classList.add('active');
    }

    function closeCartPanel() {
      document.getElementById('cartPanelOverlay').classList.remove('active');
    }

    function removeFromCart(slug) {
      cart = cart.filter(function(s) { return s !== slug; });
      updateCartUI();
      resetCartButtons();
      openCartPanel(); // refresh
    }

    function clearCart() {
      cart = [];
      updateCartUI();
      resetCartButtons();
      closeCartPanel();
    }

    // [GATO][HOTSALE] Mensaje WA unificado: usado por carrito, "Consultar" individual y set.
    // Cuotas SIEMPRE sobre precio TARJETA (p.price). Cash desde getCashPrice (promo si hay, sino 10%).
    // % off calculado dinámicamente para reflejar el descuento real (10% default, 15% en Hot Sale, etc).
    function buildWaMessage(items, note) {
      if (!items || !items.length) return '';
      var lines = [];
      lines.push('Hola! 👋 Me interesan estos perfumes:');
      lines.push('');

      var listaTotal = 0;
      var cashTotal = 0;
      var anyHotSale = false;
      var num = 0;
      items.forEach(function(p) {
        if (!p) return;
        var listaPrice = getListaPrice(p);
        listaTotal += listaPrice;
        cashTotal += getCashPrice(p);
        if (hasHotSale(p)) anyHotSale = true;
        num++;
        var marca = p.marca_real || p.marca || '';
        lines.push(num + '. *' + p.name + '*' + (marca ? ' — ' + marca : ''));
        if (listaPrice > 0) {
          lines.push('   💰 $' + Math.round(listaPrice).toLocaleString('es-AR').replace(/,/g, '.'));
        }
      });

      if (listaTotal > 0) {
        lines.push('');
        lines.push('📦 *' + num + (num === 1 ? ' perfume' : ' perfumes') + '*');
        var cuota = Math.round(listaTotal / 3);
        lines.push('💳 3 cuotas sin interés de *$' + cuota.toLocaleString('es-AR').replace(/,/g, '.') + '* (total $' + Math.round(listaTotal).toLocaleString('es-AR').replace(/,/g, '.') + ')');
        var pctOff = Math.round((1 - cashTotal / listaTotal) * 100);
        var cashEmoji = anyHotSale ? '🔥' : '💵';
        var cashLabel = anyHotSale ? 'Efectivo/transf HOT SALE' : 'Efectivo/transf';
        lines.push(cashEmoji + ' ' + cashLabel + ': *$' + cashTotal.toLocaleString('es-AR').replace(/,/g, '.') + '* (' + pctOff + '% off)');
      }

      if (note) {
        lines.push('');
        lines.push('📝 _' + note + '_');
      }

      lines.push('');
      lines.push('¿Tienen disponibilidad? 🙏');

      return lines.join('\n');
    }

    function sendCartToWA() {
      if (cart.length === 0) return;
      var note = document.getElementById('cartNote').value.trim();
      var items = cart.map(function(slug) {
        return PERFUMES.find(function(pf) { return pf.slug === slug; });
      }).filter(Boolean);

      var msg = buildWaMessage(items, note);
      closeCartPanel();

      // IMPORTANTE: abrir WhatsApp PRIMERO, sincrónicamente.
      // Si lo hacemos dentro del callback del splash (3s después), Chrome/Firefox
      // bloquean window.open por anti-popup (ya no se considera user-initiated).
      window.open('https://wa.me/5492975416017?text=' + encodeURIComponent(msg), '_blank');

      // Después mostrar el splash como feedback visual y limpiar el carrito al terminar
      var firstP = PERFUMES.find(function(pf) { return pf.slug === cart[0]; });
      showSplash(firstP, function() {
        cart = [];
        document.getElementById('cartNote').value = '';
        updateCartUI();
        resetCartButtons();
      });
    }

    // ============================================================
    // SPLASH SCREEN
    // ============================================================
    function showSplash(p, callback) {
      if (!p) { if (callback) callback(); return; }
      // En mobile saltamos la animación: el carrito se limpia al toque y queda más ágil.
      // El splash queda solo en desktop como detalle visual.
      if (window.innerWidth < 768) { if (callback) callback(); return; }
      var overlay = document.getElementById('splashOverlay');
      var imgWrap = document.getElementById('splashImgWrap');
      var brandEl = document.getElementById('splashBrand');
      var nameEl = document.getElementById('splashName');

      var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
      imgWrap.innerHTML = fotoSrc
        ? '<img class="splash-img" src="' + fotoSrc + '" alt="' + p.name + '">'
        : '<div class="splash-img-placeholder">' + p.name.charAt(0) + '</div>';
      brandEl.textContent = p.marca_real || p.marca;
      nameEl.textContent = p.name;

      overlay.classList.add('active');

      setTimeout(function() {
        overlay.classList.remove('active');
        if (callback) callback();
      }, 3000);
    }

    function goToWA(slug, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      trackEvent('wa_click', { slug: slug, meta: { isSet: !!p.esSet } });
      var msg = buildWaMessage([p], '');
      // Abrir WhatsApp sincrónicamente para que no lo bloquee el anti-popup
      window.open('https://wa.me/5492975416017?text=' + encodeURIComponent(msg), '_blank');
      showSplash(p);
    }

    // Init cart UI
    updateCartUI();

    // ============================================================
    // BOTTOM SHEET — solo mobile
    // ============================================================
    var currentBsSlug = null;

    // 🕐 Tracking de "Visto recientemente" (localStorage, max 8)
    function pushRecentView(slug) {
      try {
        var raw = localStorage.getItem('st_recent_views');
        var arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) arr = [];
        arr = arr.filter(function(s) { return s !== slug; }); // dedup
        arr.unshift(slug);                                    // más reciente al inicio
        if (arr.length > 8) arr = arr.slice(0, 8);
        localStorage.setItem('st_recent_views', JSON.stringify(arr));
        renderRecentViews();
      } catch(e) {}
    }
    function renderRecentViews() {
      var section = document.getElementById('recentViewsSection');
      var track = document.getElementById('recentViewsTrack');
      if (!section || !track) return;
      var raw = localStorage.getItem('st_recent_views');
      var arr = [];
      try { arr = raw ? JSON.parse(raw) : []; } catch(_) {}
      if (!Array.isArray(arr) || arr.length < 2) {
        section.style.display = 'none';
        return;
      }
      var html = arr.map(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (!p) return '';
        var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
        var img = fotoSrc
          ? '<img src="' + fotoSrc + '" alt="' + escapeHTML(p.name) + '" loading="lazy" decoding="async">'
          : '<div class="recent-view-letter">' + escapeHTML(p.name.charAt(0)) + '</div>';
        var price = '$' + parseInt(String(p.promo || p.price).replace(/,/g, ''), 10).toLocaleString('es-AR');
        return '<button class="recent-view-card" onclick="scrollToPerfume(\'' + slug + '\')">'
          + '<div class="recent-view-img">' + img + '</div>'
          + '<p class="recent-view-name">' + escapeHTML(p.name) + '</p>'
          + '<p class="recent-view-price">' + price + '</p>'
          + '</button>';
      }).join('');
      track.innerHTML = html;
      section.style.display = '';
    }

    function openBottomSheet(slug) {
      // Antes este guard frenaba el modal en desktop. Ahora desktop
      // muestra el modal como SIDE PANEL deslizable desde la derecha
      // (ver CSS @media (hover:hover) and (pointer:fine)). Por eso ya
      // no necesitamos el early-return.
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      currentBsSlug = slug;
      pushRecentView(slug);   // 🕐 trackear "visto recientemente"

      // SEO/UX: actualizar URL del navegador con ?perfume=slug.
      // Beneficios:
      //   - El usuario ve en la URL exactamente qué perfume está mirando
      //   - Compartiendo la URL desde el navegador, otro user llega al mismo perfume
      //   - Refresh mantiene el contexto (carga catálogo + abre el bottom sheet)
      //   - Back button cierra el modal (manejado en popstate)
      // Solo se sincroniza una vez por slug (no spamea history).
      try {
        var currentParams = new URLSearchParams(window.location.search);
        if (currentParams.get('perfume') !== slug) {
          currentParams.set('perfume', slug);
          var newUrl = '?' + currentParams.toString() + (window.location.hash || '');
          window.history.pushState({ bottomSheet: slug }, '', newUrl);
        }
      } catch (e) { /* silent */ }

      // Imagen
      var imgWrap = document.getElementById('bsImgWrap');
      // Fallback: si no tiene foto propia, usar la 1ra foto de gama si aplica
      var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
      if (!fotoSrc) {
        var gamaPool = getGamaFotos(p);
        if (gamaPool.length > 0) fotoSrc = gamaPool[0].replace(/ /g, '%20');
      }
      imgWrap.innerHTML = fotoSrc
        ? '<img class="bs-img" src="' + fotoSrc + '" alt="' + p.name + '">'
        : '<div class="bs-img-placeholder">' + p.name.charAt(0) + '</div>';

      // Info
      document.getElementById('bsName').textContent = p.name;
      document.getElementById('bsBrand').textContent = p.marca_real || p.marca;

      // Tags
      var pCat = p.cat.indexOf(',') !== -1 ? p.cat.split(',')[0].trim() : p.cat;
      var prodType = detectProductType(p);
      var tipoBadge = prodType ? '<span class="badge-tipo">' + prodType + '</span>' : '';
      document.getElementById('bsTags').innerHTML =
        '<span class="card-tag tag-cat">' + pCat + '</span>'
        + '<span class="card-tag tag-ml">' + (p.ml || 100) + ' ml</span>'
        + '<span class="card-tag tag-acorde">' + (p.perfil || '') + '</span>'
        + tipoBadge;

      // [HOTSALE][1] Precio en modal detalle: misma lógica que card + valor de cuota visible.
      var bsListaFormatted = '$' + getListaPrice(p).toLocaleString('es-AR').replace(/,/g, '.');
      var bsCashNum = getCashPrice(p);
      var bsCashFormatted = '$' + bsCashNum.toLocaleString('es-AR').replace(/,/g, '.');
      var bsCuotaFormatted = '$' + getCuotaPrice(p).toLocaleString('es-AR').replace(/,/g, '.');
      var bsPctOff = getDiscountPct(p);
      var priceHTML = '';
      if (hasHotSale(p)) {
        priceHTML = '<span class="price-promo">' + bsListaFormatted + '</span>'
          + '<span class="price-cuotas-line"><span class="price-cuotas-chip">3 cuotas</span><strong>' + bsCuotaFormatted + '</strong> sin interés</span>'
          + '<span class="price-cash price-cash--hotsale">' + HOT_SALE_LABEL + ': ' + bsCashFormatted + ' (' + bsPctOff + '% off)</span>';
      } else {
        priceHTML = '<span class="price-promo">' + bsListaFormatted + '</span>'
          + '<span class="price-cuotas-line"><span class="price-cuotas-chip">3 cuotas</span><strong>' + bsCuotaFormatted + '</strong> sin interés</span>'
          + '<span class="price-cash">' + bsCashFormatted + ' efectivo/transf.</span>';   // [EFECTIVO-UN-RENGLON] decisión 85: sin «descuento» entra en un renglón a 360
      }
      document.getElementById('bsPrice').innerHTML = priceHTML;

      // Notas
      var notesHTML = '';
      if (p.notas_salida || p.notas_corazon || p.notas_base) {
        notesHTML = '<p class="bs-note"><span class="note-label">SALIDA</span> ' + (p.notas_salida || '\u2014') + '</p>'
          + '<p class="bs-note"><span class="note-label">CORAZ\u00d3N</span> ' + (p.notas_corazon || '\u2014') + '</p>'
          + '<p class="bs-note"><span class="note-label">BASE</span> ' + (p.notas_base || '\u2014') + '</p>';
      }
      document.getElementById('bsNotes').innerHTML = notesHTML;

      // Botón consultar
      document.getElementById('bsBtnConsultar').onclick = function(e) {
        e.preventDefault();
        closeBottomSheet();
        goToWA(slug, e);
      };

      // Botón similares
      var btnSim = document.getElementById('bsBtnSimilares');
      if (p.notas_salida || p.notas_corazon || p.notas_base) {
        btnSim.style.display = '';
        btnSim.onclick = function(e) { closeBottomSheet(); showSimilares(slug, e); };
      } else {
        btnSim.style.display = 'none';
      }

      // Botón carrito
      var btnCart = document.getElementById('bsBtnCart');
      var inCart = cart.indexOf(slug) !== -1;
      btnCart.textContent = inCart ? '\u2713 Agregado' : '\uD83D\uDED2 Agregar';
      btnCart.classList.toggle('added', inCart);
      btnCart.onclick = function(e) {
        addToCart(slug, null, e);
        var nowInCart = cart.indexOf(slug) !== -1;
        btnCart.textContent = nowInCart ? '\u2713 Agregado' : '\uD83D\uDED2 Agregar';
        btnCart.classList.toggle('added', nowInCart);
      };

      // Botón compartir
      document.getElementById('bsBtnShare').onclick = function(e) {
        sharePerfume(slug, this, e);
      };

      // Botón favorito
      var btnFav = document.getElementById('bsBtnFav');
      var isFav = favs.indexOf(slug) !== -1;
      btnFav.innerHTML = isFav ? '&#9829; Favorito' : '&#9825; Favoritos';
      btnFav.style.color = isFav ? '#e74c3c' : '';
      btnFav.onclick = function(e) {
        var card = document.querySelector('[data-slug="' + slug + '"]');
        var favBtnCard = card ? card.querySelector('.fav-heart') : null;
        if (favBtnCard) toggleFav(favBtnCard, e);
        var nowFav = favs.indexOf(slug) !== -1;
        btnFav.innerHTML = nowFav ? '&#9829; Favorito' : '&#9825; Favoritos';
        btnFav.style.color = nowFav ? '#e74c3c' : '';
      };

      // Botón comparar — texto contextual según cantidad ya en lista
      var btnCompare = document.getElementById('bsBtnCompare');
      function compareBtnLabel(isIn) {
        if (!isIn) return '&#9878; Comparar';
        var n = compareList.length;
        if (n <= 1) return '&#9878; Elegí 1 perfume más';
        return '&#9878; Comparando (' + n + ')';
      }
      var inCompare = compareList.indexOf(slug) !== -1;
      btnCompare.innerHTML = compareBtnLabel(inCompare);
      btnCompare.style.color = inCompare ? 'var(--amarillo)' : '';
      btnCompare.onclick = function(e) {
        var cardEl = document.querySelector('[data-slug="' + slug + '"]');
        var cmpBtn = cardEl ? cardEl.querySelector('.compare-btn') : null;
        toggleCompare(slug, cmpBtn, e);
        var nowIn = compareList.indexOf(slug) !== -1;
        btnCompare.innerHTML = compareBtnLabel(nowIn);
        btnCompare.style.color = nowIn ? 'var(--amarillo)' : '';
      };

      document.getElementById('bsOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeBottomSheet() {
      var sheet = document.getElementById('bottomSheet');
      var overlay = document.getElementById('bsOverlay');
      sheet.style.transition = 'transform .25s ease';
      sheet.style.transform = 'translateY(100%)';
      overlay.style.transition = 'opacity .25s ease';
      overlay.style.opacity = '0';
      setTimeout(function() {
        overlay.classList.remove('active');
        overlay.style.opacity = '';
        sheet.style.transform = '';
        sheet.style.transition = '';
        document.body.style.overflow = juegosAbierto ? 'hidden' : '';   // [JUEGOS-VENTANA] la ventana sigue abajo
        currentBsSlug = null;
      }, 260);

      // Limpiar el parámetro ?perfume= de la URL al cerrar el modal.
      // Si el último estado fue del bottom sheet, hacemos history.back
      // para que el back button del navegador "consuma" esa entrada.
      // Sino, simplemente reemplazamos la URL sin tocar el historial.
      try {
        if (window.history.state && window.history.state.bottomSheet) {
          window.history.back();
        } else {
          var params = new URLSearchParams(window.location.search);
          if (params.get('perfume')) {
            params.delete('perfume');
            var qs = params.toString();
            var newUrl = (qs ? '?' + qs : '') + (window.location.hash || '');
            window.history.replaceState(null, '', newUrl || '/');
          }
        }
      } catch (e) { /* silent */ }
    }

    // popstate (back button del navegador): si había un bottom sheet
    // abierto y el usuario hizo back, lo cerramos suavemente.
    window.addEventListener('popstate', function(e) {
      var bs = document.getElementById('bsOverlay');
      if (bs && bs.classList.contains('active')) {
        var params = new URLSearchParams(window.location.search);
        if (!params.get('perfume')) {
          // Cierre directo (sin volver a llamar history.back, evita loop)
          var sheet = document.getElementById('bottomSheet');
          sheet.style.transition = 'transform .25s ease';
          sheet.style.transform = 'translateY(100%)';
          bs.style.transition = 'opacity .25s ease';
          bs.style.opacity = '0';
          setTimeout(function() {
            bs.classList.remove('active');
            bs.style.opacity = '';
            sheet.style.transform = '';
            sheet.style.transition = '';
            document.body.style.overflow = juegosAbierto ? 'hidden' : '';   // [JUEGOS-VENTANA]
            currentBsSlug = null;
          }, 260);
        }
      }
    });

    // Swipe-down para cerrar bottom sheet
    (function() {
      var startY = 0, currentY = 0, isDragging = false;
      var sheet = document.getElementById('bottomSheet');

      sheet.addEventListener('touchstart', function(e) {
        // Solo si está en el top del scroll
        if (sheet.scrollTop > 5) return;
        startY = e.touches[0].clientY;
        isDragging = true;
        sheet.style.transition = 'none';
      }, { passive: true });

      sheet.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        var diff = currentY - startY;
        if (diff > 0) {
          sheet.style.transform = 'translateY(' + diff + 'px)';
        }
      }, { passive: true });

      sheet.addEventListener('touchend', function() {
        if (!isDragging) return;
        isDragging = false;
        var diff = currentY - startY;
        if (diff > 80) {
          closeBottomSheet();
        } else {
          sheet.style.transition = 'transform .2s ease';
          sheet.style.transform = '';
        }
      }, { passive: true });
    })();

    // ============================================================
    // [JUEGOS-VENTANA] 23-sep-2026 · decisiones 60, 65 y 72 del DISEÑADOR
    //
    // «Jugar» abría la sección #quizSection, debajo del catálogo: con el scroll infinito no se llegaba nunca
    // ([JUGAR-NO-LLEGA]). Ahora el quiz y el Desafío viven en una ventana que sube desde abajo, como el
    // detalle de un perfume, y no hay que ir a ningún lado.
    //  · Historial: abrirla empuja una entrada ({ juegos: true }), así el «atrás» de Android la cierra y no
    //    saca del sitio. Un «Ver» de un resultado abre el detalle ENCIMA (decisión 72): su entrada va después
    //    de la de la ventana, y al cerrarlo se ve la ventana con los mismos resultados.
    //  · Con la ventana abierta la página no scrollea (overflow del body, igual que el detalle).
    //  · #quizSection sigue siendo un destino válido (decisión 65): al cargar, en hashchange y al tocar
    //    CUALQUIER link con ese ancla (aunque el hash ya sea #quizSection: ahí no hay hashchange).
    // ============================================================
    var juegosAbierto = false;
    function juegosEsAncla(hash) { return String(hash || '').toLowerCase() === '#quizsection'; }
    function juegosUrlLimpia() {
      return location.pathname + location.search + (juegosEsAncla(location.hash) ? '' : location.hash);
    }
    function juegosTab(cual) {
      var body = document.getElementById('juegosBody');
      if (!body) return;
      body.setAttribute('data-juego', cual);
      document.querySelectorAll('.juegos-tab').forEach(function(b) {
        var on = b.getAttribute('data-juego') === cual;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      body.scrollTop = 0;
    }
    function juegosMostrar() {
      var ov = document.getElementById('juegosOverlay');
      if (!ov) return;
      juegosAbierto = true;
      document.body.classList.add('juegos-open');
      document.body.style.overflow = 'hidden';
      ov.classList.add('active');
      ov.setAttribute('aria-hidden', 'false');
    }
    function juegosOcultar() {
      var ov = document.getElementById('juegosOverlay'), sheet = document.getElementById('juegosSheet');
      if (!ov || !juegosAbierto) return;
      juegosAbierto = false;
      if (window.matchMedia('(max-width: 767px)').matches) {
        sheet.style.transition = 'transform .25s ease';
        sheet.style.transform = 'translateY(100%)';
      }
      ov.style.transition = 'opacity .25s ease';
      ov.style.opacity = '0';
      setTimeout(function() {
        ov.classList.remove('active');
        ov.setAttribute('aria-hidden', 'true');
        ov.style.opacity = ''; ov.style.transition = '';
        sheet.style.transform = ''; sheet.style.transition = '';
        document.body.classList.remove('juegos-open');
        // si mientras tanto quedó un detalle abierto, él decide el scroll
        var bs = document.getElementById('bsOverlay');
        document.body.style.overflow = (bs && bs.classList.contains('active')) ? 'hidden' : '';
      }, 260);
    }
    function openJuegos(tab) {
      juegosTab(tab || 'quiz');
      if (juegosAbierto) return;
      try {
        // el ancla no queda en la URL: al cerrar, el próximo toque a un link #quizSection vuelve a abrir
        if (juegosEsAncla(location.hash)) history.replaceState(history.state, '', juegosUrlLimpia());
        history.pushState({ juegos: true }, '', juegosUrlLimpia());
      } catch (e) { /* silent */ }
      juegosMostrar();
    }
    function closeJuegos() {
      if (!juegosAbierto) return;
      // si la entrada de la ventana es la actual, «atrás» la consume y el popstate la cierra
      if (history.state && history.state.juegos) { history.back(); return; }
      juegosOcultar();
      try { if (juegosEsAncla(location.hash)) history.replaceState(history.state, '', juegosUrlLimpia()); } catch (e) {}
    }
    window.addEventListener('popstate', function(e) {
      var st = e.state || {};
      if (st.juegos) { if (!juegosAbierto) juegosMostrar(); return; }   // volver del detalle, o «adelante»
      if (juegosAbierto && !st.bottomSheet) juegosOcultar();
    });
    window.addEventListener('hashchange', function() { if (juegosEsAncla(location.hash)) openJuegos(); });
    // Cualquier link a #quizSection de esta página (menú, avisos, textos): se delega el clic porque si el hash
    // ya es #quizSection el navegador no dispara hashchange.
    document.addEventListener('click', function(e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var i = href.toLowerCase().indexOf('#quizsection');
      if (i === -1) return;
      if (i > 0) {
        try { var u = new URL(href.slice(0, i), location.href); if (u.origin !== location.origin || u.pathname !== location.pathname) return; } catch (err) { return; }
      }
      e.preventDefault();
      openJuegos();
    });
    if (juegosEsAncla(location.hash)) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { openJuegos(); });
      else openJuegos();
    }
    // Deslizar para cerrar, como el detalle (sólo en el celu: en escritorio la ventana va centrada)
    (function() {
      var startY = 0, currentY = 0, isDragging = false;
      var sheet = document.getElementById('juegosSheet'), body = document.getElementById('juegosBody');
      if (!sheet) return;
      sheet.addEventListener('touchstart', function(e) {
        if (!window.matchMedia('(max-width: 767px)').matches) return;
        if (body.scrollTop > 5 && !e.target.closest('.bs-handle-zone')) return;
        startY = currentY = e.touches[0].clientY;
        isDragging = true;
        sheet.style.transition = 'none';
      }, { passive: true });
      sheet.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        var diff = currentY - startY;
        if (diff > 0) sheet.style.transform = 'translateY(' + diff + 'px)';
      }, { passive: true });
      sheet.addEventListener('touchend', function() {
        if (!isDragging) return;
        isDragging = false;
        if (currentY - startY > 80) { closeJuegos(); }
        else { sheet.style.transition = 'transform .2s ease'; sheet.style.transform = ''; }
      }, { passive: true });
    })();

    // Mobile: cards tienen <a> directo a WhatsApp (como sets)

    // ============================================================
    // COMPARADOR DE PERFUMES (hasta 3)
    // ============================================================
    var compareList = [];
    var COMPARE_MAX = 3;

    function toggleCompare(slug, btn, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var idx = compareList.indexOf(slug);
      if (idx !== -1) {
        compareList.splice(idx, 1);
        if (btn) btn.classList.remove('active');
      } else {
        if (compareList.length >= COMPARE_MAX) {
          // Quitar el primero
          var oldSlug = compareList.shift();
          var oldBtn = document.querySelector('[data-slug="' + oldSlug + '"] .compare-btn');
          if (oldBtn) oldBtn.classList.remove('active');
        }
        compareList.push(slug);
        if (btn) btn.classList.add('active');
      }
      updateCompareBar();
    }

    function updateCompareBar() {
      var bar = document.getElementById('compareBar');
      var itemsEl = document.getElementById('compareBarItems');
      var goBtn = document.getElementById('compareBarGo');
      var hint = document.getElementById('compareBarHint');

      if (compareList.length === 0) {
        bar.classList.remove('visible');
        return;
      }
      bar.classList.add('visible');

      // Ayuda contextual: cuando solo hay 1 elegido, el botón indica qué falta
      if (compareList.length === 1) {
        goBtn.disabled = true;
        goBtn.textContent = 'Elegí 1 más →';
        if (hint) hint.style.display = '';
      } else {
        goBtn.disabled = false;
        goBtn.textContent = 'COMPARAR';
        if (hint) hint.style.display = 'none';
      }

      var html = '';
      compareList.forEach(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (!p) return;
        var shortName = p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name;
        html += '<div class="compare-bar-item">'
          + shortName
          + '<button class="compare-bar-remove" onclick="removeCompare(\'' + slug + '\')">&times;</button>'
        + '</div>';
      });
      // Slots vacíos
      for (var i = compareList.length; i < COMPARE_MAX; i++) {
        html += '<div class="compare-bar-add">+</div>';
      }
      itemsEl.innerHTML = html;
    }

    function removeCompare(slug) {
      var idx = compareList.indexOf(slug);
      if (idx !== -1) compareList.splice(idx, 1);
      var btn = document.querySelector('[data-slug="' + slug + '"] .compare-btn');
      if (btn) btn.classList.remove('active');
      updateCompareBar();
    }

    function openCompareModal() {
      if (compareList.length < 2) return;
      var grid = document.getElementById('compareGrid');
      var html = '';

      compareList.forEach(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (!p) return;
        var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
        var imgHTML = fotoSrc
          ? '<img class="compare-col-img" src="' + fotoSrc + '" alt="' + p.name + '">'
          : '<div class="compare-col-placeholder">' + p.name.charAt(0) + '</div>';

        var priceNum = p.promo ? parseFloat(String(p.promo).replace(/,/g, '')) : parseFloat(String(p.price).replace(/,/g, ''));
        var pCat = p.cat.indexOf(',') !== -1 ? p.cat.split(',')[0].trim() : p.cat;

        // Estructura nueva:
        //  - Header: foto + nombre + marca + precio destacado (sin label).
        //  - Rows: cada par label/value envuelto en .compare-row para
        //    que CSS Grid los alinee perfectamente sin desfases.
        html += '<div class="compare-col">'
          + '<div class="compare-col-head">'
            + imgHTML
            + '<div class="compare-col-info">'
              + '<p class="compare-col-name">' + p.name + '</p>'
              + '<p class="compare-col-brand">' + (p.marca_real || p.marca) + '</p>'
              + '<p class="compare-col-price">$' + Math.round(priceNum).toLocaleString('es-AR').replace(/,/g, '.') + '</p>'
            + '</div>'
          + '</div>'
          + '<div class="compare-rows">'
            // [COMPARE-2B] El bot\u00f3n Elegir este se agrega DESPU\u00c9S del cierre del compare-rows (m\u00e1s abajo).
            + '<div class="compare-row"><p class="compare-row-label">Categor\u00eda</p><p class="compare-row-value">' + pCat + '</p></div>'
            + '<div class="compare-row"><p class="compare-row-label">Perfil</p><p class="compare-row-value">' + (p.perfil || '\u2014') + '</p></div>'
            + '<div class="compare-row"><p class="compare-row-label">Salida</p><p class="compare-row-value">' + (p.notas_salida || '\u2014') + '</p></div>'
            + '<div class="compare-row"><p class="compare-row-label">Coraz\u00f3n</p><p class="compare-row-value">' + (p.notas_corazon || '\u2014') + '</p></div>'
            + '<div class="compare-row"><p class="compare-row-label">Base</p><p class="compare-row-value">' + (p.notas_base || '\u2014') + '</p></div>'
          + '</div>'
          // [COMPARE-2B] Boton "Elegir este" \u2014 cierra el ciclo comparacion -> decision.
          + '<button type="button" class="compare-col-cta" onclick="elegirCompare(\'' + p.slug + '\', this, event)" aria-label="Elegir este perfume">'
            + '<span class="compare-col-cta-ico" aria-hidden="true">\ud83d\udc95</span>'
            + '<span class="compare-col-cta-text">Elegir este</span>'
          + '</button>'
        + '</div>';
      });
      grid.innerHTML = html;

      // Notas en común
      findCommonNotes();
      // [COMPARE-2A] Diferencias destacadas (notas únicas por perfume)
      renderUniqueNotes();

      document.getElementById('compareOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function findCommonNotes() {
      var commonEl = document.getElementById('compareCommon');
      var notesEl = document.getElementById('compareCommonNotes');

      // Juntar todas las notas de cada perfume
      var allNoteSets = compareList.map(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (!p) return [];
        var raw = [p.notas_salida || '', p.notas_corazon || '', p.notas_base || ''].join(', ');
        return raw.split(',').map(function(n) { return n.trim().toLowerCase(); }).filter(function(n) { return n && n !== '\u2014'; });
      });

      if (allNoteSets.length < 2) { commonEl.style.display = 'none'; return; }

      // Encontrar intersección
      var common = allNoteSets[0].filter(function(note) {
        return allNoteSets.every(function(set) {
          return set.some(function(n) { return n === note; });
        });
      });

      // Eliminar duplicados y capitalizar
      var unique = [];
      common.forEach(function(n) {
        var cap = n.charAt(0).toUpperCase() + n.slice(1);
        if (unique.indexOf(cap) === -1) unique.push(cap);
      });

      if (unique.length === 0) {
        commonEl.style.display = 'block';
        notesEl.innerHTML = '<span style="font-size:.7rem;color:var(--gris);">No comparten notas en com\u00fan</span>';
      } else {
        commonEl.style.display = 'block';
        notesEl.innerHTML = unique.map(function(n) {
          return '<span class="compare-common-chip">' + n + '</span>';
        }).join('');
      }
    }

    function closeCompareModal() {
      document.getElementById('compareOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    // ────────────────────────────────────────────────────────────────
    // [COMPARE-2A] renderUniqueNotes — Diferencias destacadas.
    // Por cada perfume del compareList, calcula las notas que SOLO ese
    // perfume tiene (no las comparten los demás del compare).
    // El cliente compara para VER diferencias, no solo similitudes.
    // ────────────────────────────────────────────────────────────────
    function renderUniqueNotes() {
      var uniqueEl = document.getElementById('compareUnique');
      var contentEl = document.getElementById('compareUniqueContent');
      if (!uniqueEl || !contentEl) return;
      if (compareList.length < 2) { uniqueEl.style.display = 'none'; return; }

      // Helper: notas de un perfume como Set (lowercase, sin duplicados)
      function notesSet(p) {
        var raw = [p.notas_salida || '', p.notas_corazon || '', p.notas_base || ''].join(',');
        var set = {};
        raw.split(',').forEach(function(n) {
          var t = n.trim().toLowerCase();
          if (t && t !== '—') set[t] = true;
        });
        return set;
      }

      // Construir mapa: slug -> Set de notas
      var perfumeNotes = compareList.map(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        return p ? { slug: slug, name: p.name, set: notesSet(p) } : null;
      }).filter(Boolean);

      // Para cada perfume, calcular notas únicas (las que no están en los OTROS)
      var rows = perfumeNotes.map(function(item, idx) {
        var others = perfumeNotes.filter(function(_, i) { return i !== idx; });
        var unique = Object.keys(item.set).filter(function(note) {
          return !others.some(function(o) { return o.set[note]; });
        });
        return { name: item.name, unique: unique };
      });

      // Si NINGÚN perfume tiene notas únicas (improbable, pero posible si son
      // exactamente iguales en notas), no mostrar la sección — sería vacío.
      var anyUnique = rows.some(function(r) { return r.unique.length > 0; });
      if (!anyUnique) { uniqueEl.style.display = 'none'; return; }

      // Render: por perfume, una fila con su name + chips de notas únicas
      contentEl.innerHTML = rows.map(function(r) {
        var chips = r.unique.length === 0
          ? '<span class="compare-unique-empty">— sin notas exclusivas</span>'
          : r.unique.map(function(n) {
              var cap = n.charAt(0).toUpperCase() + n.slice(1);
              return '<span class="compare-unique-chip">' + cap + '</span>';
            }).join('');
        return '<div class="compare-unique-row">'
          + '<p class="compare-unique-name">' + escapeHTML(r.name) + '</p>'
          + '<div class="compare-unique-chips">' + chips + '</div>'
        + '</div>';
      }).join('');
      uniqueEl.style.display = 'block';
    }

    // ────────────────────────────────────────────────────────────────
    // [COMPARE-2B] elegirCompare — Cierra el ciclo de comparación.
    // El cliente comparó 2-3 perfumes y eligió 1: lo agregamos al carrito
    // (no abrimos WA directo — el carrito tiene buildWaMessage unificado
    // que el cliente puede agregar a más si quiere) y cerramos el modal.
    // ────────────────────────────────────────────────────────────────
    function elegirCompare(slug, btn, event) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      if (typeof addToCart === 'function') {
        addToCart(slug, btn, event);
      }
      closeCompareModal();
    }
    window.elegirCompare = elegirCompare;

    // ============================================================
    // DARK MODE
    // ============================================================
    // ============================================================
    // DESAFÍO ST
    // ============================================================
    function getCurrentUser() { return currentUser; }
    var miselSlugs = [];
    var desafioRecommended = null;

    function initMiSeleccion() {
      try {
        var user = getCurrentUser();
        var lock = document.getElementById('miselLock');
        var content = document.getElementById('miselContent');
        if (!user) {
          if (lock) lock.style.display = 'block';
          if (content) content.style.display = 'none';
          return;
        }
        if (lock) lock.style.display = 'none';
        if (content) { content.style.display = ''; content.style.display = 'flex'; }
        loadMiselGlobalStats();
      } catch(e) {
        console.error('initMiSeleccion error:', e);
      }
    }

    function renderMiselSlots() {
      var container = document.getElementById('miselSlots');
      var html = '';
      for (var i = 0; i < 3; i++) {
        if (miselSlugs[i]) {
          var p = PERFUMES.find(function(pf) { return pf.slug === miselSlugs[i]; });
          if (p) {
            var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
            var imgHTML = fotoSrc
              ? '<img src="' + fotoSrc + '" alt="' + p.name + '">'
              : '<span class="misel-slot-num" style="color:var(--amarillo);">' + p.name.charAt(0) + '</span>';
            html += '<div class="misel-slot filled" title="' + p.name + '">'
              + imgHTML
              + '<button class="misel-slot-remove" onclick="removeMiselSlot(' + i + ')">&times;</button>'
              + '</div>';
          } else {
            html += '<div class="misel-slot" onclick="focusMiselSearch()"><span class="misel-slot-num">' + (i+1) + '</span></div>';
          }
        } else {
          html += '<div class="misel-slot" onclick="focusMiselSearch()"><span class="misel-slot-num">' + (i+1) + '</span></div>';
        }
      }
      container.innerHTML = html;

      // Al completar 3, lanzar el desafío
      if (miselSlugs.length === 3) {
        triggerDesafio();
      }
    }

    function focusMiselSearch() {
      document.getElementById('miselSearch').focus();
    }

    function filterMiselDropdown(q) {
      var dropdown = document.getElementById('miselDropdown');
      q = q.trim().toLowerCase();
      if (q.length < 1) { dropdown.classList.remove('open'); return; }

      var results = PERFUMES.filter(function(p) {
        if (p.esSet || p._oculto) return false;
        if (miselSlugs.indexOf(p.slug) !== -1) return false;
        return p.name.toLowerCase().indexOf(q) !== -1 || (p.marca_real || p.marca || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);

      if (results.length === 0) {
        dropdown.innerHTML = '<div class="misel-dropdown-item" style="color:var(--gris);cursor:default;">Sin resultados</div>';
      } else {
        dropdown.innerHTML = results.map(function(p) {
          var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
          var imgHTML = fotoSrc
            ? '<img src="' + fotoSrc + '" alt="' + p.name + '">'
            : '<div class="misel-dd-letter">' + p.name.charAt(0) + '</div>';
          return '<div class="misel-dropdown-item" onclick="addMiselPerfume(\'' + p.slug + '\')">'
            + imgHTML + '<span>' + p.name + '</span></div>';
        }).join('');
      }
      dropdown.classList.add('open');
    }

    function addMiselPerfume(slug) {
      if (miselSlugs.length >= 3) return;
      if (miselSlugs.indexOf(slug) !== -1) return;
      miselSlugs.push(slug);
      document.getElementById('miselSearch').value = '';
      document.getElementById('miselDropdown').classList.remove('open');
      renderMiselSlots();
    }

    function removeMiselSlot(idx) {
      miselSlugs.splice(idx, 1);
      desafioRecommended = null;
      document.getElementById('desafioReveal').style.display = 'none';
      document.getElementById('desafioActions').style.display = 'none';
      var inner = document.getElementById('desafioCardInner');
      if (inner) inner.classList.remove('flipped');
      renderMiselSlots();
    }

    function triggerDesafio() {
      // Analizar notas de los 3 perfumes elegidos
      var selectedNotes = [];
      miselSlugs.forEach(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (!p) return;
        [p.notas_salida, p.notas_corazon, p.notas_base].forEach(function(n) {
          if (n) n.split(',').forEach(function(note) {
            var trimmed = note.trim().toLowerCase();
            if (trimmed && trimmed !== '\u2014' && selectedNotes.indexOf(trimmed) === -1) selectedNotes.push(trimmed);
          });
        });
      });

      // Puntuar perfumes por notas en común
      var scored = PERFUMES.filter(function(p) {
        return !p.esSet && miselSlugs.indexOf(p.slug) === -1 && !p._oculto;
      }).map(function(p) {
        var score = 0;
        var allNotes = ((p.notas_salida || '') + ',' + (p.notas_corazon || '') + ',' + (p.notas_base || '')).toLowerCase();
        selectedNotes.forEach(function(n) { if (allNotes.indexOf(n) !== -1) score++; });
        return { perfume: p, score: score };
      }).filter(function(s) { return s.score > 0; });

      scored.sort(function(a, b) { return b.score - a.score; });

      if (scored.length === 0) {
        document.getElementById('miselMsg').style.color = 'var(--gris)';
        document.getElementById('miselMsg').textContent = 'No encontramos una recomendaci\u00f3n, prob\u00e1 con otros perfumes';
        return;
      }

      // Elegir entre los top 3 para variedad
      var topN = scored.slice(0, Math.min(3, scored.length));
      var pick = topN[Math.floor(Math.random() * topN.length)];
      desafioRecommended = pick.perfume;

      // Preparar la carta trasera
      var p = desafioRecommended;
      var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
      var imgHTML = fotoSrc
        ? '<img src="' + fotoSrc + '" alt="' + p.name + '">'
        : '<div style="width:100%;height:60%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:2rem;color:rgba(232,184,0,.2);">' + p.name.charAt(0) + '</div>';
      var brand = p.marca_real || p.marca || '';

      document.getElementById('desafioCardBack').innerHTML =
        '<div class="desafio-card-back-badge">' + pick.score + ' notas en com\u00fan</div>'
        + imgHTML
        + '<div class="desafio-card-back-info">'
          + '<p class="desafio-card-back-name">' + p.name + '</p>'
          + '<p class="desafio-card-back-brand">' + brand + '</p>'
        + '</div>';

      // Configurar botones
      document.getElementById('btnVerLocal').onclick = function() {
        // [JUEGOS-VENTANA] decisión 72 · el detalle se abre ENCIMA de la ventana: al cerrarlo, la carta sigue ahí.
        openBottomSheet(p.slug);
      };
      var tel = '5492974564545';
      var msg = encodeURIComponent('Hola ST! Me interesa un decant de 5ml de *' + p.name + '* (' + brand + '). \u00bfTienen disponible?');
      document.getElementById('btnDecant').href = 'https://wa.me/' + tel + '?text=' + msg;

      // Ocultar picker, mostrar carta
      document.querySelector('.misel-picker').style.display = 'none';
      document.getElementById('desafioReveal').style.display = 'block';
      document.getElementById('desafioCardInner').classList.remove('flipped');
      document.getElementById('desafioActions').style.display = 'none';
      document.getElementById('miselMsg').textContent = '';

      // Guardar en Supabase
      saveMiSeleccion();
    }

    function flipDesafioCard() {
      var inner = document.getElementById('desafioCardInner');
      if (inner.classList.contains('flipped')) return;
      inner.classList.add('flipped');
      setTimeout(function() {
        document.getElementById('desafioActions').style.display = 'flex';
      }, 600);
    }

    function shareDesafio() {
      if (!desafioRecommended) return;
      var p = desafioRecommended;
      var elegidos = miselSlugs.map(function(s) {
        var pf = PERFUMES.find(function(x) { return x.slug === s; });
        return pf ? pf.name : s;
      }).join(', ');
      var texto = '🎴 *Desafío ST — Scent & Textures*\n\n'
        + 'Elegí mis 3 perfumes favoritos: ' + elegidos + '\n\n'
        + '🔮 Me recomendaron: *' + p.name + '* de ' + (p.marca_real || p.marca || '') + '\n\n'
        + '¿Vos cuáles elegirías? Probá acá 👇\nhttps://www.stperfumeria.com';
      var url = 'https://wa.me/?text=' + encodeURIComponent(texto);
      window.open(url, '_blank');
    }

    function resetDesafio() {
      miselSlugs = [];
      desafioRecommended = null;
      document.querySelector('.misel-picker').style.display = '';
      document.getElementById('desafioReveal').style.display = 'none';
      document.getElementById('desafioActions').style.display = 'none';
      document.getElementById('desafioCardInner').classList.remove('flipped');
      renderMiselSlots();
    }

    async function saveMiSeleccion() {
      var user = getCurrentUser();
      if (!user || miselSlugs.length === 0) return;
      try {
        await sb.from('mi_seleccion').upsert({
          user_id: user.id,
          slugs: miselSlugs,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      } catch(e) {}
    }

    async function loadMiselGlobalStats() {
      try {
        var { data } = await sb.from('mi_seleccion').select('slugs');
        if (!data || data.length === 0) return;
        var statEl = document.getElementById('miselGlobalStat');
        var allSlugs = {};
        data.forEach(function(row) {
          (row.slugs || []).forEach(function(s) {
            allSlugs[s] = (allSlugs[s] || 0) + 1;
          });
        });
        var topSlug = null; var topCount = 0;
        Object.keys(allSlugs).forEach(function(s) {
          if (allSlugs[s] > topCount) { topCount = allSlugs[s]; topSlug = s; }
        });
        var topP = topSlug ? PERFUMES.find(function(p) { return p.slug === topSlug; }) : null;
        var topName = topP ? topP.name : topSlug;
        statEl.textContent = data.length + ' desaf\u00edos completados \u00b7 Favorito: ' + topName;
      } catch(e) {}
    }

    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('miselDropdown');
      if (dd && !e.target.closest('.misel-search-wrap')) dd.classList.remove('open');
    });

    // Init on page load (after auth check)
    setTimeout(initMiSeleccion, 1500);

    function toggleFaq(btn) {
      var item = btn.parentElement;
      var wasOpen = item.classList.contains('open');
      // Cerrar todos
      document.querySelectorAll('.faq-item.open').forEach(function(el) {
        el.classList.remove('open');
      });
      // Si no estaba abierto, abrir este
      if (!wasOpen) item.classList.add('open');
    }

    function toggleDarkMode() {
      var body = document.body;
      body.classList.toggle('dark-mode');
      var isDark = body.classList.contains('dark-mode');
      // [LIGHT-TOGGLE-V2] emoji + label sincronizados.
      // Dark activo → ofrecemos "LIGHT" (cambia AL light si tocás)
      // Light activo → ofrecemos "DARK" (cambia AL dark si tocás)
      var emoji = isDark ? '🌙' : '☀️';
      var label = isDark ? 'LIGHT' : 'DARK';
      var icon = document.querySelector('.dark-toggle-icon');
      var floatIcon = document.getElementById('darkFloatIcon');
      if (icon) icon.textContent = emoji;
      if (floatIcon) floatIcon.textContent = emoji;
      var navIcon = document.getElementById('navThemeIcon');
      if (navIcon) navIcon.textContent = emoji;
      var navLabel = document.getElementById('navThemeLabel');
      if (navLabel) navLabel.textContent = label;
      localStorage.setItem('st_dark_mode', isDark ? '1' : '0');
    }

    // Restaurar preferencia guardada (dark mode por defecto).
    // El HTML body arranca con class="is-guest dark-mode" (evita flash de
    // cream→dark al cargar). Si el user eligió light (saved==='0'), removemos
    // dark-mode y ajustamos íconos/label del toggle.
    (function() {
      var saved = localStorage.getItem('st_dark_mode');
      if (saved !== '0') {
        // Dark mode (default · ya está en HTML body)
        var icon = document.querySelector('.dark-toggle-icon');
        var floatIcon = document.getElementById('darkFloatIcon');
        if (icon) icon.textContent = '🌙';
        if (floatIcon) floatIcon.textContent = '🌙';
        // navThemeIcon/navThemeLabel ya están en HTML default (🌙 LIGHT)
      } else {
        // Light mode · QUITAR dark-mode del body (que vino por default)
        document.body.classList.remove('dark-mode');
        var navIcon = document.getElementById('navThemeIcon');
        if (navIcon) navIcon.textContent = '☀️';
        var navLabel = document.getElementById('navThemeLabel');
        if (navLabel) navLabel.textContent = 'DARK';
        var drawerIcon = document.querySelector('.dark-toggle-icon');
        if (drawerIcon) drawerIcon.textContent = '☀️';
        var floatIcon = document.getElementById('darkFloatIcon');
        if (floatIcon) floatIcon.textContent = '☀️';
      }
    })();

    // ============================================================
    // BANNER DE BIENVENIDA
    // ============================================================
    (function() {
      if (localStorage.getItem('st_welcomed')) return;
      var overlay = document.getElementById('welcomeOverlay');
      if (overlay) overlay.style.display = 'flex';
    })();

    function closeWelcome() {
      var overlay = document.getElementById('welcomeOverlay');
      if (overlay) {
        overlay.style.animation = 'none';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity .3s ease';
        setTimeout(function() { overlay.style.display = 'none'; }, 300);
      }
      localStorage.setItem('st_welcomed', '1');
      // Scroll suave al catálogo
      var cat = document.getElementById('catalogo');
      if (cat) setTimeout(function() { cat.scrollIntoView({ behavior: 'smooth' }); }, 350);
    }

    // ============================================================
    // PUSH NOTIFICATIONS
    // ============================================================
    var VAPID_PUBLIC_KEY = 'BE8ARD1FYFJs4w3gTB1IDoWNoypFd0duqUuOq0o6sNy7coKTqMcOS-kX3DuFrjdtn2pec30-QhouO0ADZ9nW8K8';

    function urlBase64ToUint8Array(base64String) {
      var padding = '='.repeat((4 - base64String.length % 4) % 4);
      var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      var rawData = window.atob(base64);
      var outputArray = new Uint8Array(rawData.length);
      for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
      return outputArray;
    }

    // Mostrar banner de push después de 15 segundos si no se pidió antes
    (function() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

      // Registrar Service Worker siempre
      navigator.serviceWorker.register('/sw.js').catch(function(err) {
        console.log('SW register error:', err);
      });

      // Si ya dijo que no o ya está suscrito, no mostrar banner
      var pushDismissed = localStorage.getItem('st_push_dismissed');
      var pushSubscribed = localStorage.getItem('st_push_subscribed');
      if (pushDismissed || pushSubscribed) return;

      // Mostrar banner después de 15s de navegación
      setTimeout(function() {
        // Verificar que no haya permiso ya concedido
        if (Notification.permission === 'granted') {
          // Ya tiene permiso, intentar suscribir silenciosamente
          subscribeToPush();
          return;
        }
        if (Notification.permission === 'denied') return; // Bloqueó las notificaciones

        var banner = document.getElementById('pushBanner');
        if (banner) banner.style.display = 'block';
      }, 15000);
    })();

    function acceptPush() {
      var banner = document.getElementById('pushBanner');
      if (banner) banner.style.display = 'none';
      subscribeToPush();
    }

    function dismissPush() {
      var banner = document.getElementById('pushBanner');
      if (banner) banner.style.display = 'none';
      localStorage.setItem('st_push_dismissed', Date.now());
    }

    async function subscribeToPush() {
      try {
        var permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        var reg = await navigator.serviceWorker.ready;
        var subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        var subJSON = JSON.stringify(subscription);

        // Guardar via API (tiene rate-limit anti-spam)
        var res = await fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            subscription: subJSON
          })
        });

        if (res.ok) {
          localStorage.setItem('st_push_subscribed', '1');

          // AC: Si no está registrado, ofrecer registro directo
          if (!currentUser) {
            setTimeout(function() {
              var registerBanner = document.getElementById('pushRegisterBanner');
              if (registerBanner) registerBanner.style.display = 'block';
            }, 1500);
          }
        }
      } catch (err) {
        console.log('Push subscription error:', err);
      }
    }

    // ============================================================
    // PACK DE DECANTS — builder interactivo
    // Tomá hasta N decants (default 5ml) con precio escalonado:
    //   1-2 decants · 3-4 · 5+, cada tramo con su precio unitario (ver [DECANTS-DEFAULTS] abajo).
    // Config editable desde admin (tabla decants_config en Supabase).
    // Al confirmar, manda la lista por WhatsApp al mismo número del carrito.
    // Tope alto (100) porque a veces compran para revender, el stock real
    // se valida manualmente por WhatsApp.
    // ============================================================

    var DECANTS_CONFIG = {
      activo: true,
      ml: 5,
      // [DECANTS-DEFAULTS] Los precios reales viven en decants_config (Supabase) y pisan estos al cargar.
      // Estos son el respaldo si la base no responde: tienen que ser los mismos que la base (9.500 / 9.000 /
      // 8.500 desde el 10-ago-2026). Hasta el 23-sep decían 8.500 / 7.500.
      precio_1: 9500,
      precio_3: 9000,
      precio_5: 8500,
      max_decants: 100,
      // [DECANT-TOPE] Tope de precio de frasco (normalizado a 100 ml) para que un
      // perfume entre al armador con la escalera. Si el frasco vale más que esto,
      // el decant saldría bajo costo → la card se muestra "Precio a consultar".
      // 0 / null = regla desactivada (comportamiento viejo). Editable desde admin.
      precio_frasco_max: 170000,
      aviso_conservacion: 'Guardá tu decant en lugar fresco y seco. Duración óptima: 6-12 meses.'
    };

    function loadDecantsPack() {
      try {
        var s = localStorage.getItem('decantsPack');
        return s ? JSON.parse(s) : [];
      } catch(e) { return []; }
    }
    function saveDecantsPack() {
      try { localStorage.setItem('decantsPack', JSON.stringify(decantsPack)); } catch(e) {}
    }
    var decantsPack = loadDecantsPack();

    async function loadDecantsConfig() {
      try {
        var { data } = await sb.from('decants_config').select('*').eq('id', 1).single();
        if (data) {
          Object.keys(data).forEach(function(k) {
            if (data[k] !== null && data[k] !== undefined) DECANTS_CONFIG[k] = data[k];
          });
        }
      } catch(e) {}
      // Si admin lo desactivó, esconder entry points
      if (!DECANTS_CONFIG.activo) {
        var banner = document.querySelector('.decant-banner');
        if (banner) banner.style.display = 'none';
        var floatBtn = document.getElementById('decantFloat');
        if (floatBtn) floatBtn.style.display = 'none';
      }
      // [DECANT-TOPE] Limpiar del pack guardado lo que ahora quedó bloqueado.
      sanitizeDecantsPack();
      updateDecantUI();
    }

    function getDecantUnitPrice(qty) {
      if (qty >= 5) return DECANTS_CONFIG.precio_5;
      if (qty >= 3) return DECANTS_CONFIG.precio_3;
      return DECANTS_CONFIG.precio_1;
    }

    // ════════════════════════════════════════════════════════════
    // [DECANT-TOPE] Perfumes caros que NO pueden ir a precio de escalera.
    //
    // Problema que resuelve: el armador listaba TODO el catálogo con precio
    // fijo ($9.500) sin mirar cuánto sale el frasco. Un Erba Pura de $430.000
    // deja un decant de 5ml a costo $21.500 → se vendía perdiendo $12.000.
    //
    // Normalizamos a "precio equivalente de frasco de 100ml" para que un 50ml
    // caro no zafe del filtro sólo por ser un frasco chico.
    // ════════════════════════════════════════════════════════════
    function decantPrecioFrasco100(p) {
      var precio = parseFloat(String(p && p.price != null ? p.price : '').replace(/[^0-9.]/g, ''));
      if (!isFinite(precio) || precio <= 0) return 0;   // sin precio → no bloqueamos
      var ml = parseFloat(String(p && p.ml != null ? p.ml : '').replace(/[^0-9.]/g, ''));
      if (!isFinite(ml) || ml <= 0) ml = 100;
      return precio / ml * 100;
    }

    // ════════════════════════════════════════════════════════════
    // [DECANT-PRECIO-MANUAL] Precio de decant cargado a mano por el empleado
    // o el jefe desde el admin (campo "Precio del decant" en Nuevo perfume y
    // en Editar perfume). Vive en perfumes_nuevos.precio_decant y en
    // perfume_overrides.precio_decant.
    //
    // Es la fuente de verdad: si está cargado, ese precio manda y el perfume
    // se vende normalmente aunque el frasco sea carísimo. Nadie tiene que
    // consultar nada ni esperar a que alguien conteste un WhatsApp.
    // ════════════════════════════════════════════════════════════
    function decantPrecioManual(p) {
      var v = parseFloat(p && p._precioDecant != null ? p._precioDecant : NaN);
      return (isFinite(v) && v > 0) ? v : 0;
    }

    // El perfume no se ofrece en decants: la casilla "No ofrecer en decants" del panel, o [DECANT-SOLO-PERFUMES] (decisión
    // de Alejo, 24-sep) no es perfume —body splash, body spray, desodorante, crema…—, con la misma regla que pone la
    // etiqueta de tipo en la card (detectProductType: el «Tipo de producto» del panel y, si está vacío, el nombre). Lo
    // toman la lista del armador (extras.js), addDecant y sanitizeDecantsPack (saca estos de los packs guardados).
    function decantExcluido(p) {
      return !!(p && (p._decantExcluido || detectProductType(p)));
    }

    // ══════════════════════════════════════════════════════════════
    // [PROMO-DECANTS] N1 · la promo de decants («3 decants por $18.000»): una sola regla y una sola cuenta.
    // La promo vive en promos_decants (una fila, id = 1) y los perfumes sumados o sacados a mano en
    // promos_decants_perfumes. Para anon, la base sólo devuelve la promo prendida y vigente; igual se
    // mira acá cada vez (desde ≤ ahora < hasta), porque la página puede quedar abierta cuando termina.
    // Si la lectura falla, no hay promo: mejor la escalera que una promo vencida.
    // ══════════════════════════════════════════════════════════════
    var PROMO_DECANTS = null;          // { n, precio_pack, max_packs, desde, hasta } (ms) o null
    var PROMO_DECANTS_MODOS = {};      // slug → 'incluir' | 'excluir'

    async function loadPromoDecants() {
      var promo = null, modos = {};
      try {
        var r = await withTimeout(sb.from('promos_decants').select('*').eq('id', 1), 3000, 'promos_decants');
        var fila = (r && !r.error && Array.isArray(r.data) && r.data.length) ? r.data[0] : null;
        if (fila && fila.activa) {
          var n = parseInt(fila.n, 10), pp = parseInt(fila.precio_pack, 10), mp = parseInt(fila.max_packs, 10);
          var desde = Date.parse(fila.desde), hasta = Date.parse(fila.hasta);
          if (n >= 2 && n <= 10 && pp > 0 && isFinite(desde) && isFinite(hasta) && hasta > desde) {
            var r2 = await withTimeout(sb.from('promos_decants_perfumes').select('slug,modo'), 3000, 'promos_decants_perfumes');
            if (r2 && !r2.error && Array.isArray(r2.data)) {
              r2.data.forEach(function(x) { if (x && x.slug && (x.modo === 'incluir' || x.modo === 'excluir')) modos[x.slug] = x.modo; });
              promo = { n: n, precio_pack: pp, max_packs: mp > 0 ? mp : null, desde: desde, hasta: hasta };
            }
          }
        }
      } catch (e) { promo = null; modos = {}; }
      PROMO_DECANTS = promo;
      PROMO_DECANTS_MODOS = modos;
      promoRefrescar();
      iniciarRelojPromo();
    }

    // La promo si está vigente AHORA (en el reloj del cliente), o null.
    function promoVigente() {
      var P = PROMO_DECANTS;
      if (!P) return null;
      var ahora = Date.now();
      return (ahora >= P.desde && ahora < P.hasta) ? P : null;
    }

    // Lo que muestra la lista del armador (extras.js la usa también): sin sets, ocultos, pausados, excluidos (que
    // incluye lo que no es perfume) ni duplicados de un decant de diseñador.
    function decantEnListaArmador(p, customs) {
      if (!p || p.esSet || p._oculto || p._pausado) return false;
      if (decantExcluido(p)) return false;
      customs = customs || decantCustomNombres();
      return !customs[decantNombreNorm(p.name)];
    }

    // true → el perfume lleva «3×»: está en la lista, tiene precio de escalera (sin precio manual y sin «a consultar»)
    // y, salvo que lo hayan sumado o sacado a mano, su frasco (equivalente 100 ml) cuesta hasta (precio_pack / n) × 20.
    function promoDecantEntra(p, promo, customs) {
      promo = promo || promoVigente();
      if (!promo || !p) return false;
      if (!decantEnListaArmador(p, customs)) return false;
      if (decantPrecioManual(p) > 0 || decantAConsultar(p)) return false;
      var modo = PROMO_DECANTS_MODOS[p.slug];
      if (modo === 'excluir') return false;
      if (modo === 'incluir') return true;
      return decantPrecioFrasco100(p) <= (promo.precio_pack / promo.n) * 20;
    }

    function precioAR(v) { return '$' + Math.round(v).toLocaleString('es-AR'); }

    // La cuenta del pack: la usan la pantalla del armador (updateDecantUI), el pie y el WhatsApp (sendDecantPackToWA),
    // así dan siempre el mismo total.
    //  · Precio fijo (diseñador con precio_unit y precio manual): su precio; no cuentan para la escalera ni para n.
    //  · Escalera: el precio por unidad sale de la cantidad de escalera, con 3× y sin 3×.
    //  · 3× (promo vigente y al menos n en el pack): todas las unidades 3× (o max_packs × n si hay tope) a
    //    min(escalera, precio_pack / n); las que pasan el tope van con la escalera.
    function precioPackDecants(pack) {
      var promo = promoVigente();
      var customs = decantCustomNombres();
      var items = (pack || []).filter(function(s) { return s != null && typeof s === 'string' && s.trim().length > 0; });
      var fijos = 0, fijoTotal = 0, escalera = 0, con3x = 0, lineas = [], cuenta = {}, orden = [];
      items.forEach(function(s) {
        if (!cuenta[s]) { cuenta[s] = 0; orden.push(s); }
        cuenta[s]++;
        if (s.indexOf('custom-') === 0) {
          var cid = parseInt(s.replace('custom-', ''), 10);
          var c = DECANTS_CUSTOM_LIST.find(function(x) { return x.id === cid; });
          if (c && c.precio_unit != null && isFinite(parseFloat(c.precio_unit))) { fijos++; fijoTotal += parseFloat(c.precio_unit); return; }
          escalera++;
          return;
        }
        var pf = PERFUMES.find(function(x) { return x.slug === s; });
        var manual = decantPrecioManual(pf);
        if (manual > 0) { fijos++; fijoTotal += manual; return; }
        escalera++;
        if (promo && promoDecantEntra(pf, promo, customs)) con3x++;
      });
      var unidad = getDecantUnitPrice(escalera);
      var unidadPromo = 0, promoUnidades = 0;
      if (promo && con3x >= promo.n) {
        unidadPromo = Math.min(unidad, promo.precio_pack / promo.n);
        if (unidadPromo < unidad) promoUnidades = promo.max_packs ? Math.min(con3x, promo.max_packs * promo.n) : con3x;
      }
      var total = fijoTotal + promoUnidades * unidadPromo + (escalera - promoUnidades) * unidad;
      // Las líneas del WhatsApp (el nombre, la cantidad y, si tiene, su precio fijo).
      orden.forEach(function(slug) {
        var name, nota = '';
        if (slug.indexOf('custom-') === 0) {
          var cid = parseInt(slug.replace('custom-', ''), 10);
          var c = DECANTS_CUSTOM_LIST.find(function(x) { return x.id === cid; });
          name = c ? (c.nombre + (c.marca ? ' (' + c.marca + ')' : '') + ' ⭐') : slug;
          if (c && c.precio_unit != null && isFinite(parseFloat(c.precio_unit))) nota = ' — ' + precioAR(parseFloat(c.precio_unit)) + ' c/u';
        } else {
          var p = PERFUMES.find(function(x) { return x.slug === slug; });
          name = p ? p.name : slug;
          var m = decantPrecioManual(p);
          if (m > 0) nota = ' — ' + precioAR(m) + ' c/u';   // [DECANT-WA-TOTAL] su precio, como los de diseñador
        }
        lineas.push('• ' + name + (cuenta[slug] > 1 ? ' (x' + cuenta[slug] + ')' : '') + nota);
      });
      var resumen;
      if (promoUnidades > 0) {
        var partes = [promoUnidades + ' × ' + precioAR(unidadPromo) + ' (promo ' + promo.n + '×)'];
        if (escalera - promoUnidades > 0) partes.push((escalera - promoUnidades) + ' × ' + precioAR(unidad));
        if (fijos > 0) partes.push('de diseñador');
        resumen = '💰 ' + partes.join(' + ') + ' = *' + precioAR(total) + '*';
      } else if (fijos > 0 && escalera > 0) {
        resumen = '💰 ' + escalera + ' x ' + precioAR(unidad) + ' + de diseñador = *' + precioAR(total) + '*';
      } else if (fijos > 0) {
        resumen = '💰 Total: *' + precioAR(total) + '*';
      } else {
        resumen = '💰 ' + escalera + ' x ' + precioAR(unidad) + ' = *' + precioAR(total) + '*';
      }
      var faltan = (promo && con3x >= 1 && con3x < promo.n) ? promo.n - con3x : 0;
      return {
        qty: items.length, total: total, lineas: lineas, resumen: resumen,
        fijos: fijos, fijoTotal: fijoTotal, escalera: escalera, unidad: unidad,
        con3x: con3x, promoUnidades: promoUnidades, unidadPromo: unidadPromo,
        faltan: faltan, topeAlcanzado: !!(promo && promo.max_packs && con3x >= promo.max_packs * promo.n), promo: promo
      };
    }

    // Después de cargar la promo, o cuando empieza o termina: el armador y las etiquetas de las cards.
    var promoEstabaVigente = false;
    function promoRefrescar() {
      promoEstabaVigente = !!promoVigente();
      if (typeof refrescarEtiquetasCards === 'function') refrescarEtiquetasCards();
      updateDecantUI();
      if (document.querySelector('#decantBuilderOverlay.active') && typeof window.renderDecantGrid === 'function' && window.__extrasLoaded) window.renderDecantGrid();
    }
    // El reloj: cada minuto (en el cambio de minuto) repinta las etiquetas; si la promo empezó o terminó, el armador.
    var promoRelojTimer = null;
    function iniciarRelojPromo() {
      if (promoRelojTimer) { clearTimeout(promoRelojTimer); promoRelojTimer = null; }
      if (!PROMO_DECANTS) return;
      var tick = function() {
        promoRelojTimer = null;
        if (!!promoVigente() !== promoEstabaVigente) promoRefrescar();
        else if (typeof refrescarEtiquetasCards === 'function') refrescarEtiquetasCards();
        if (PROMO_DECANTS && Date.now() < PROMO_DECANTS.hasta + 60000) promoRelojTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
      };
      promoRelojTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    }

    // true → la card se muestra como "Precio a consultar" (no se puede agregar).
    // Sólo pasa si el frasco supera el tope Y nadie cargó precio de decant.
    function decantAConsultar(p) {
      if (decantPrecioManual(p) > 0) return false;      // tiene precio cargado → se vende
      var tope = parseFloat(DECANTS_CONFIG.precio_frasco_max);
      if (!isFinite(tope) || tope <= 0) return false;   // regla desactivada
      var eq = decantPrecioFrasco100(p);
      return eq > 0 && eq > tope;
    }

    // [DECANT-DEDUP] Un perfume cargado en `decants_custom` (con su precio real)
    // también existe en el catálogo regular → se dibujaban DOS cards del mismo
    // perfume y el cliente elegía la barata. Acá armamos el set de nombres
    // normalizados de los customs para poder esconder el duplicado del catálogo.
    function decantNombreNorm(s) {
      return (s == null ? '' : String(s)).toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/g, '');
    }

    function decantCustomNombres() {
      var set = {};
      if (Array.isArray(DECANTS_CUSTOM_LIST)) {
        DECANTS_CUSTOM_LIST.forEach(function(c) {
          if (c && c.activo !== false && c.nombre) set[decantNombreNorm(c.nombre)] = true;
        });
      }
      return set;
    }

    // Un pack viejo guardado en localStorage puede tener slugs que ahora quedaron
    // bloqueados (o duplicados). Los sacamos para que no se cobren mal.
    function sanitizeDecantsPack() {
      if (!Array.isArray(decantsPack) || decantsPack.length === 0) return;
      if (typeof PERFUMES === 'undefined' || !Array.isArray(PERFUMES)) return;
      var antes = decantsPack.length;
      var customs = decantCustomNombres();
      decantsPack = decantsPack.filter(function(s) {
        if (typeof s !== 'string' || s.indexOf('custom-') === 0) return true;
        var pf = PERFUMES.find(function(x) { return x.slug === s; });
        if (!pf) return true;
        if (decantExcluido(pf)) return false;
        if (decantAConsultar(pf)) return false;
        if (customs[decantNombreNorm(pf.name)]) return false;
        return true;
      });
      if (decantsPack.length !== antes) {
        saveDecantsPack();
        if (typeof updateDecantUI === 'function') updateDecantUI();
      }
    }

    // Consulta por WhatsApp de un perfume que quedó fuera de la escalera.
    function consultarDecantWA(slug) {
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      var nombre = (currentUser && currentUser.nombre) ? String(currentUser.nombre).trim().split(' ')[0] : '';
      var saludo = nombre ? ('Hola, soy ' + nombre + '!') : 'Hola!';
      var msg = saludo + ' Quería consultar el precio del decant de '
              + (p ? p.name : 'un perfume') + ' 🙂';
      window.open('https://wa.me/5492975416017?text=' + encodeURIComponent(msg), '_blank');
    }
    window.consultarDecantWA = consultarDecantWA;

    function addDecant(slug) {
      // [DECANT-TOPE] Red de seguridad: aunque la card venga con el "+" deshabilitado,
      // bloqueamos acá también (DOM viejo, consola, pack restaurado, etc.).
      if (typeof slug === 'string' && slug.indexOf('custom-') !== 0) {
        var pBloq = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (pBloq && decantExcluido(pBloq)) return;   // no se ofrece en decants
        if (pBloq && decantAConsultar(pBloq)) {
          var msgTope = document.getElementById('decantLadder');
          if (msgTope) {
            msgTope.textContent = '💬 ' + pBloq.name + ' se cotiza aparte — consultanos el precio.';
            msgTope.style.color = '#e8b800';
            setTimeout(function() { msgTope.style.color = ''; updateDecantUI(); }, 2600);
          }
          return;
        }
      }
      if (decantsPack.length >= DECANTS_CONFIG.max_decants) {
        var msgEl = document.getElementById('decantLadder');
        if (msgEl) {
          msgEl.textContent = '⚠️ Ya llegaste al máximo de ' + DECANTS_CONFIG.max_decants + ' decants.';
          msgEl.style.color = '#e74c3c';
          setTimeout(function() { msgEl.style.color = ''; updateDecantUI(); }, 1800);
        }
        return;
      }
      decantsPack.push(slug);
      trackEvent('decant_add', { slug: slug, meta: { packSize: decantsPack.length } });
      saveDecantsPack();
      updateDecantUI();
      renderDecantGrid();
      // [#5 ANIMATION] Feedback visual al + — flash verde + check en la card recién agregada.
      // Se aplica DESPUÉS del re-render para que la clase quede en la card actual del DOM.
      try {
        var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!prefersReduced) {
          // Buscar la card cuyo botón + apunta a este slug
          requestAnimationFrame(function() {
            var btns = document.querySelectorAll('.decant-card .decant-ctrl-plus');
            for (var i = 0; i < btns.length; i++) {
              var oc = btns[i].getAttribute('onclick') || '';
              if (oc.indexOf("addDecant('" + slug + "')") !== -1) {
                var card = btns[i].closest('.decant-card');
                if (card) {
                  card.classList.add('just-added');
                  setTimeout(function() { card.classList.remove('just-added'); }, 600);
                }
                break;
              }
            }
          });
        }
      } catch(e) { /* silent */ }
    }

    function removeDecant(slug) {
      var idx = decantsPack.indexOf(slug);
      if (idx === -1) return;
      decantsPack.splice(idx, 1);
      saveDecantsPack();
      updateDecantUI();
      renderDecantGrid();
    }

    // Quitar el ÚLTIMO decant agregado (botón − del contador global).
    // Más práctico que tener que buscar el perfume en la grilla y restarle.
    function removeLastDecant() {
      if (decantsPack.length === 0) return;
      var lastSlug = decantsPack.pop();
      saveDecantsPack();
      updateDecantUI();
      renderDecantGrid();
      // Feedback visual sutil en el contador
      var qtyEl = document.getElementById('decantQty');
      if (qtyEl) {
        qtyEl.style.transition = 'color .25s';
        qtyEl.style.color = '#e74c3c';
        setTimeout(function() { qtyEl.style.color = ''; }, 600);
      }
    }
    window.removeLastDecant = removeLastDecant;

    function clearDecantsPack() {
      if (decantsPack.length === 0) return;
      if (!confirm('¿Vaciar el pack de decants?')) return;
      decantsPack = [];
      saveDecantsPack();
      updateDecantUI();
      renderDecantGrid();
    }

    function updateDecantUI() {
      var qty = decantsPack.length;
      function setTxt(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

      // Separar slugs en 2 grupos:
      //  - "fixed": precio propio definido (no entran a la escalera). Son los
      //    customs con precio_unit Y los perfumes del catálogo con
      //    precio_decant cargado a mano desde el admin.
      //  - "ladder": el resto
      // [PROMO-DECANTS] La cuenta sale de precioPackDecants, la misma que usa el WhatsApp. Precio fijo = los de
      // diseñador con precio_unit y los del catálogo con precio de decant cargado a mano ([DECANT-PRECIO-MANUAL]).
      var cuenta = precioPackDecants(decantsPack);
      var fixedCount = cuenta.fijos;
      var ladderCount = cuenta.escalera;
      var unit = cuenta.unidad;                            // tier según los que SÍ usan escalera (con 3× y sin 3×)
      var total = cuenta.total;

      setTxt('decantQty', qty);
      setTxt('decantMax', DECANTS_CONFIG.max_decants);
      setTxt('decantMlLabel', DECANTS_CONFIG.ml);
      setTxt('decantMaxLabel', DECANTS_CONFIG.max_decants);
      setTxt('decantTotal', '$' + Math.round(total).toLocaleString('es-AR'));
      // "c/u" del header: si hay items con precio fijo y otros con escalera,
      // mostramos el de escalera con nota. Sino el normal.
      if (cuenta.promoUnidades > 0 && cuenta.promoUnidades === qty) {
        setTxt('decantUnit', precioAR(cuenta.unidadPromo) + ' c/u (promo ' + cuenta.promo.n + '×)');
      } else if (cuenta.promoUnidades > 0 || (fixedCount > 0 && ladderCount > 0)) {
        setTxt('decantUnit', '$' + unit.toLocaleString('es-AR') + ' c/u (mixto)');
      } else if (fixedCount > 0 && ladderCount === 0) {
        setTxt('decantUnit', 'Precio fijo');
      } else {
        setTxt('decantUnit', '$' + unit.toLocaleString('es-AR') + ' c/u');
      }
      // Variables que la escalera de abajo necesita
      qty = qty;  // re-asignación no-op para claridad
      total = total;
      // Botón − del contador: solo activo si hay al menos 1 decant
      var minusBtn = document.getElementById('decantCounterMinus');
      if (minusBtn) minusBtn.disabled = qty === 0;

      // Escalera de precio — SOLO si NO hay items con precio fijo en el pack.
      // Si hay aunque sea 1 custom con precio fijo, la escalera se vuelve
      // engañosa (los "ahorrás $X" no aplican a los especiales). Mejor no
      // mostrar nada para evitar que el cliente le pida a las chicas algo
      // que ya no aplica.
      var ladder = '';
      var p1 = DECANTS_CONFIG.precio_1, p3 = DECANTS_CONFIG.precio_3, p5 = DECANTS_CONFIG.precio_5;
      if (fixedCount > 0) {
        ladder = '';   // ocultamos la escalera cuando hay especiales con precio fijo
      } else if (qty === 0) {
        ladder = '💡 1-2: $' + p1.toLocaleString('es-AR') + ' · 3-4: $' + p3.toLocaleString('es-AR') + ' · 5+: $' + p5.toLocaleString('es-AR') + ' c/u';
      } else if (qty < 3) {
        var falta1 = 3 - qty;
        var ahorro1 = qty * (p1 - p3) + (p3 * falta1);
        ladder = '💡 Sumá ' + falta1 + ' más y cada uno pasa a $' + p3.toLocaleString('es-AR') + ' (ahorrás $' + (qty * (p1 - p3)).toLocaleString('es-AR') + ')';
      } else if (qty < 5) {
        var falta2 = 5 - qty;
        var ahorro2 = qty * (p3 - p5);
        ladder = '🔥 Sumá ' + falta2 + ' más y cada uno pasa a $' + p5.toLocaleString('es-AR') + ' (ahorrás $' + ahorro2.toLocaleString('es-AR') + ')';
      } else {
        ladder = '✨ Precio óptimo: $' + p5.toLocaleString('es-AR') + ' c/u';
      }
      setTxt('decantLadder', ladder);
      // [PROMO-DECANTS] N2 · Con la promo vigente y de 1 a n−1 con 3× en el pack: «Sumá 1 más con 3×» (también con precio
      // fijo en el pack, donde la escalera no se muestra); con la promo aplicada, qué se cobra a precio de promo. Y el
      // tope, si hay. Tienen su propia línea: #decantLadder no se ve en pantallas de hasta 900 px de alto.
      // [PROMO-ANCHO-360] N-bis (119) · el aviso dice cuánto sale cada uno, y sale sólo si la promo le baja el precio:
      // precio_pack / n contra la escalera con los que tendría el pack al sumar los que faltan (si no, la promo no le
      // cambia nada). El tope, sólo al llegar al tope.
      var avisoPromo = document.getElementById('decantPromoAviso');
      if (avisoPromo) {
        var txtPromo = '';
        if (cuenta.faltan > 0) {
          var cadaUno = cuenta.promo.precio_pack / cuenta.promo.n;
          if (cadaUno < getDecantUnitPrice(cuenta.escalera + cuenta.faltan)) txtPromo = 'Sumá ' + cuenta.faltan + ' más con ' + cuenta.promo.n + '× y cada uno te sale ' + precioAR(cadaUno);
        } else if (cuenta.promoUnidades > 0) {
          txtPromo = '🧪 Promo ' + cuenta.promo.n + '×: ' + cuenta.promoUnidades + ' × ' + precioAR(cuenta.unidadPromo);
        }
        avisoPromo.textContent = txtPromo;
        avisoPromo.hidden = !txtPromo;
      }
      var topePromo = document.getElementById('decantPromoTope');
      if (topePromo) {
        var txtTope = cuenta.topeAlcanzado ? 'Máximo de la promo: los que sumes van a precio normal' : '';
        topePromo.textContent = txtTope;
        topePromo.hidden = !txtTope;
      }
      var ladderEl = document.getElementById('decantLadder');
      if (ladderEl) ladderEl.style.color = '';

      // Ahorro ya logrado (vs precio unitario del tier 1).
      // Se muestra desde qty >= 3 (antes no hay ahorro, porque precio_1 es el tier base).
      // En qty >= 5 lo destacamos con clase .is-max y badge de % OFF.
      var savingsEl = document.getElementById('decantSavings');
      if (savingsEl) {
        // Igual que la escalera: si hay items con precio fijo, ocultamos
        // los "te ahorrás $X vs comprarlos sueltos" — el cálculo no aplica
        // a los especiales y confunde al cliente.
        if (fixedCount === 0 && qty >= 3) {
          var precioSinPack = qty * p1;
          var ahorroReal = precioSinPack - total;
          var pctOff = precioSinPack > 0 ? Math.round((ahorroReal / precioSinPack) * 100) : 0;
          if (qty >= 5) {
            savingsEl.innerHTML = '🔥 Te ahorrás $' + ahorroReal.toLocaleString('es-AR')
              + ' vs comprarlos sueltos'
              + '<span class="savings-off">' + pctOff + '% OFF</span>';
            savingsEl.classList.add('is-max');
          } else {
            savingsEl.textContent = '🎁 Te ahorrás $' + ahorroReal.toLocaleString('es-AR') + ' vs comprarlos sueltos';
            savingsEl.classList.remove('is-max');
          }
          savingsEl.hidden = false;
        } else {
          savingsEl.hidden = true;
          savingsEl.classList.remove('is-max');
        }
      }

      // [#1 PROGRESS BAR] Barra visual hacia el siguiente tier de precio.
      // Solo aplica si la escalera está activa (no hay items con precio fijo).
      var progressEl = document.getElementById('decantProgress');
      if (progressEl) {
        if (fixedCount === 0 && qty >= 1 && qty < 5) {
          // Cuál es el siguiente tier y cuánto falta
          var tierTo, falta, ahorroAlSiguiente, fillPct, currentLabel, msg;
          if (qty < 3) {
            // Estamos en tier 1-2, falta llegar a 3 para tier 3-4
            tierTo = p3; falta = 3 - qty;
            // Ahorro real al pasar al siguiente tier: lo que pagás ahora vs lo que pagarías con qty+falta a precio p3
            var costoActual = qty * p1;
            var costoSiguiente = (qty + falta) * p3;
            ahorroAlSiguiente = (qty + falta) * p1 - costoSiguiente;
            fillPct = ((qty - 1) / 2) * 50;  // 1→0%, 2→25%, 3→50%
            currentLabel = '$' + p1.toLocaleString('es-AR');
          } else {
            // Estamos en tier 3-4, falta llegar a 5 para tier 5+
            tierTo = p5; falta = 5 - qty;
            ahorroAlSiguiente = (qty + falta) * p3 - (qty + falta) * p5;
            fillPct = 50 + ((qty - 3) / 2) * 50;  // 3→50%, 4→75%, 5→100%
            currentLabel = '$' + p3.toLocaleString('es-AR');
          }
          var fillEl = document.getElementById('decantProgressFill');
          if (fillEl) fillEl.style.width = Math.min(100, Math.max(5, fillPct)) + '%';
          msg = '🎯 Te falta <strong>' + falta + ' decant' + (falta > 1 ? 's' : '') + '</strong> para bajar a $' + tierTo.toLocaleString('es-AR') + ' c/u';
          if (ahorroAlSiguiente > 0) {
            msg += '<span class="savings-tag">Ahorrás $' + Math.round(ahorroAlSiguiente).toLocaleString('es-AR') + '</span>';
          }
          var msgEl = document.getElementById('decantProgressMsg');
          if (msgEl) {
            msgEl.classList.remove('locked-max');
            msgEl.innerHTML = msg;
          }
          var tiersEl = document.getElementById('decantProgressTiers');
          if (tiersEl) {
            tiersEl.innerHTML =
              '<span class="' + (qty >= 1 ? 'unlocked' : '') + (qty < 3 ? ' current' : '') + '">$' + p1.toLocaleString('es-AR') + ' (1-2)' + (qty < 3 ? ' ●' : ' ✓') + '</span>' +
              '<span class="' + (qty >= 3 ? 'unlocked' : '') + (qty >= 3 && qty < 5 ? ' current' : '') + '">$' + p3.toLocaleString('es-AR') + ' (3-4)' + (qty >= 5 ? ' ✓' : (qty >= 3 ? ' ●' : '')) + '</span>' +
              '<span class="' + (qty >= 5 ? 'current' : '') + '">$' + p5.toLocaleString('es-AR') + ' (5+)' + (qty >= 5 ? ' ●' : '') + '</span>';
          }
          progressEl.hidden = false;
        } else if (fixedCount === 0 && qty >= 5) {
          // Máximo tier alcanzado — felicitación
          var fillEl2 = document.getElementById('decantProgressFill');
          if (fillEl2) fillEl2.style.width = '100%';
          var msgEl2 = document.getElementById('decantProgressMsg');
          if (msgEl2) {
            msgEl2.classList.add('locked-max');
            msgEl2.innerHTML = '✨ <strong>Precio óptimo desbloqueado</strong> · $' + p5.toLocaleString('es-AR') + ' c/u';
          }
          var tiersEl2 = document.getElementById('decantProgressTiers');
          if (tiersEl2) {
            tiersEl2.innerHTML =
              '<span class="unlocked">$' + p1.toLocaleString('es-AR') + ' (1-2) ✓</span>' +
              '<span class="unlocked">$' + p3.toLocaleString('es-AR') + ' (3-4) ✓</span>' +
              '<span class="current">$' + p5.toLocaleString('es-AR') + ' (5+) ●</span>';
          }
          progressEl.hidden = false;
        } else {
          // Pack vacío o hay precios fijos — ocultar la barra
          progressEl.hidden = true;
        }
      }

      // [#2 EMPTY STATE] Mostrar hero con quick-pick si el pack está vacío
      var heroEl = document.getElementById('decantEmptyHero');
      if (heroEl) {
        if (qty === 0) {
          // Top 6 perfumes por views/clicks (data real) — fallback: primeros 6 elegibles
          // [DECANT-SOLO-PERFUMES] el mismo filtro que la lista del armador (extras.js): ni pausados, ni excluidos
          // (que incluye lo que no es perfume), ni duplicados de un decant de diseñador. Y ni «a consultar»: acá el
          // único botón es «+ AGREGAR». Sin stock sigue afuera, como antes.
          var qpCustoms = decantCustomNombres();
          var topElegibles = PERFUMES.filter(function(p) {
            return p && p.slug && (p._stockStatus !== 'out') && decantEnListaArmador(p, qpCustoms) && !decantAConsultar(p);
          });
          topElegibles.sort(function(a, b) {
            var va = perfumeViews[a.slug] || 0;
            var vb = perfumeViews[b.slug] || 0;
            return vb - va;  // más views primero
          });
          var top6 = topElegibles.slice(0, 6);
          var qpGrid = document.getElementById('decantQuickpickGrid');
          if (qpGrid && top6.length) {
            qpGrid.innerHTML = top6.map(function(p) {
              var foto = p.foto ? p.foto.replace(/ /g, '%20') : '';
              var imgHTML = foto
                ? '<img src="' + foto + '" alt="' + escapeHTML(p.name) + '" loading="lazy">'
                : escapeHTML(p.name.charAt(0) || '•');
              return '<div class="decant-quickpick-card" onclick="addDecant(\'' + p.slug + '\')">'
                + '<div class="decant-quickpick-img">' + imgHTML + '</div>'
                + '<p class="decant-quickpick-name">' + escapeHTML(p.name) + '</p>'
                + '<button type="button" class="decant-quickpick-add" onclick="event.stopPropagation();addDecant(\'' + p.slug + '\')">+ AGREGAR</button>'
                + '</div>';
            }).join('');
          }
          heroEl.hidden = false;
        } else {
          heroEl.hidden = true;
        }
      }

      // Aviso de conservación
      setTxt('decantAviso', DECANTS_CONFIG.aviso_conservacion || '');

      // Botón WA habilitado si qty >= 1
      var btn = document.getElementById('decantBuilderWA');
      if (btn) btn.disabled = qty < 1;

      // [#3 BOTTOM-SHEET] Footer "elevado" + resumen cuando hay items
      var footerEl = document.getElementById('decantBuilderFooter');
      if (footerEl) footerEl.classList.toggle('has-items', qty > 0);
      setTxt('decantBsQty', qty);
      setTxt('decantBsQtyPalabra', qty === 1 ? 'decant' : 'decants');   // [PROMO-DECANTS] N2 · «1 decant», no «1 decants»
      setTxt('decantBsTotal', '$' + Math.round(total).toLocaleString('es-AR'));

      // Contador del botón flotante
      var floatCount = document.getElementById('decantFloatCount');
      if (floatCount) floatCount.textContent = qty;
      // [BARRA-CELU] el número del pack en la barra del celu (el mismo contador que .decant-float)
      var barraDec = document.getElementById('barraNumDecants');
      if (barraDec) { barraDec.textContent = qty; barraDec.hidden = !(qty > 0 && DECANTS_CONFIG.activo); }
      var floatBtn = document.getElementById('decantFloat');
      if (floatBtn && DECANTS_CONFIG.activo) {
        if (qty > 0) floatBtn.classList.add('visible');
        else floatBtn.classList.remove('visible');
      }
    }

    // ============================================================
    // SISTEMA DE PUNTOS — banner contextual en la home
    // Si el cliente está logueado y tiene puntos, se muestra debajo
    // del cartel "EXPLORÁ NUESTRO CATÁLOGO". Si no, queda oculto.
    // ============================================================
    async function renderPuntosBanner() {
      var el = document.getElementById('puntosContextBanner');
      if (!el) return;
      // Sin cliente logueado: ocultar
      if (typeof currentUser === 'undefined' || !currentUser || !currentUser.telefono) {
        el.style.display = 'none';
        return;
      }
      try {
        if (typeof sb === 'undefined' || !sb) return;
        // Traer saldo de puntos + config en paralelo
        var [cliRes, cfgRes] = await Promise.all([
          sb.rpc('cliente_puntos', { p_telefono: currentUser.telefono }),
          sb.from('puntos_config').select('*').limit(1)
        ]);
        // [BCRYPT-MIGRATION] la RPC devuelve un array, no un objeto
        var cliRow = (cliRes && cliRes.data && cliRes.data[0]) ? cliRes.data[0] : null;
        var puntos = (cliRow && Number(cliRow.puntos)) || 0;
        var nombreCli = (cliRow && cliRow.nombre) || (currentUser.nombre || 'Cliente');
        var cfg = (cfgRes && cfgRes.data && cfgRes.data[0]) || { threshold_proximo_premio: 5, mensaje_promo: 'SUMÁ 1 MÁS Y CONSULTÁ POR TU PREMIO 📲' };
        // Lógica de mensaje:
        //  - puntos === 0: invitamos a sumar
        //  - puntos múltiplo del threshold: aviso "Estás listo, consultanos"
        //  - puntos = (threshold - 1) mod threshold: estás a 1 del próximo premio
        //  - else: solo mostrar saldo
        var threshold = Number(cfg.threshold_proximo_premio) || 5;
        var resto = threshold > 0 ? (puntos % threshold) : 0;
        var msg;
        if (puntos === 0) {
          msg = '¡Hola ' + escapeHTML(nombreCli) + '! Sumá <strong>puntos por cada compra</strong> y consultanos por premios.';
        } else if (resto === 0 && puntos >= threshold) {
          msg = '⭐ Tenés <strong>' + (Math.round(puntos*10)/10) + ' puntos</strong> · ¡Pedinos un premio en tu próxima compra!';
        } else if (resto >= threshold - 1) {
          msg = '⭐ Tenés <strong>' + (Math.round(puntos*10)/10) + ' puntos</strong> · ' + escapeHTML(cfg.mensaje_promo || '¡Estás cerca de un premio!');
        } else {
          msg = 'Hola ' + escapeHTML(nombreCli) + '! Saldo de puntos: <strong>' + (Math.round(puntos*10)/10) + '</strong>';
        }
        el.innerHTML = msg;
        el.style.display = 'block';
      } catch(e) {
        // Si las tablas no existen todavía o falla, ocultamos
        el.style.display = 'none';
      }
    }
    onDeferred(renderPuntosBanner);
    // Hook: cuando cambia el currentUser (login/logout), re-renderizar
    window.addEventListener('storage', function(e) {
      if (e.key === 'st_cliente') setTimeout(renderPuntosBanner, 200);
    });

    // Cache de perfumes custom de decants (cargados desde Supabase).
    // Aparecen al final del grid del armador como opciones extra.
    var DECANTS_CUSTOM_LIST = [];
    async function loadDecantsCustomForArmador() {
      try {
        if (typeof sb === 'undefined' || !sb) return;
        // SELECT * tolera si precio_unit no fue agregada via ALTER TABLE
        var res = await sb.from('decants_custom')
          .select('*')
          .eq('activo', true)
          .order('orden', { ascending: true });
        if (res && !res.error && res.data) {
          DECANTS_CUSTOM_LIST = res.data;
          // [DECANT-DEDUP] Recién ahora sabemos qué perfumes son "de diseñador",
          // así que volvemos a limpiar el pack por si tenía el duplicado barato.
          sanitizeDecantsPack();
          // Si el cliente fue más rápido que esta carga y ya tiene el armador
          // abierto, la grilla se dibujó SIN dedup (se veían las dos cards).
          // La re-dibujamos ahora que sí sabemos cuáles esconder.
          try {
            var ov = document.getElementById('decantBuilderOverlay');
            if (ov && ov.classList.contains('active') &&
                window.__extrasLoaded && typeof renderDecantGrid === 'function') {
              renderDecantGrid();
            }
          } catch (e) { /* silent */ }
        }
      } catch(e) { /* tabla no existe: queda lista vacía */ }
    }
    onDeferred(loadDecantsCustomForArmador);

    // ════════════════════════════════════════════════════════════
    // [JS-CHUNK] STUBS — las funciones del armador de decants viven
    // en `js/extras.js` que se carga LAZY (post-TTI vía idleCallback
    // o al primer click si el usuario es rápido). Estos stubs son lo
    // mínimo para que los `onclick="openDecantBuilder()"` del HTML no
    // tiren ReferenceError mientras extras todavía no cargó.
    // ════════════════════════════════════════════════════════════
    var _extrasLoadPromise = null;
    function loadExtras() {
      if (window.__extrasLoaded) return Promise.resolve();
      if (_extrasLoadPromise) return _extrasLoadPromise;
      _extrasLoadPromise = new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = 'js/extras.js';
        s.defer = true;
        s.onload = function() { resolve(); };
        s.onerror = function() {
          _extrasLoadPromise = null; // permitir reintento
          reject(new Error('extras.js load failed'));
        };
        document.head.appendChild(s);
      });
      return _extrasLoadPromise;
    }
    window.loadExtras = loadExtras;

    // Stubs: si el cliente toca antes de que extras cargue, lo carga
    // y dispara la función real. Si extras ya está, llama directo.
    function openDecantBuilder() {
      loadExtras().then(function() {
        if (window.openDecantBuilder !== openDecantBuilder) {
          window.openDecantBuilder();
        }
      }).catch(function(e) {
        console.error('[extras] no se pudo cargar el armador:', e);
      });
    }
    // [DECANTS-CAJON] Abre y cierra el cajón del armador en celular.
    // Vive en app.js y no en extras.js a propósito: solo toca clases, no
    // depende del armador cargado, y el onclick es inline en el HTML — así
    // que tiene que existir en window desde el arranque.
    function toggleDecantSheet() {
      var b = document.querySelector('.decant-builder');
      if (!b) return;
      var abierto = b.classList.toggle('sheet-open');
      var h = document.getElementById('decantSheetHandle');
      var l = document.getElementById('decantSheetHandleLabel');
      if (h) h.setAttribute('aria-expanded', abierto ? 'true' : 'false');
      if (l) l.textContent = abierto ? 'Ocultar detalle' : 'Ver detalle del pack';
    }
    window.toggleDecantSheet = toggleDecantSheet;

    function closeDecantBuilder() {
      if (window.__extrasLoaded && window.closeDecantBuilder !== closeDecantBuilder) {
        window.closeDecantBuilder();
      }
    }
    function sendDecantPackToWA() {
      loadExtras().then(function() {
        if (window.sendDecantPackToWA !== sendDecantPackToWA) {
          window.sendDecantPackToWA();
        }
      }).catch(function(e) {
        console.error('[extras] no se pudo cargar para enviar pack:', e);
      });
    }
    function renderDecantGrid() {
      // No-op si extras no cargó (el grid solo se renderiza dentro del modal,
      // que requiere openDecantBuilder primero — extras ya estará cargado).
      if (window.__extrasLoaded && window.renderDecantGrid !== renderDecantGrid) {
        window.renderDecantGrid();
      }
    }
    // [DECANTS-UX-2] Stubs para tab switcher + combo "Combinás bien con".
    // Si el cliente abre el modal vía /armar-pack-decants y toca un tab
    // antes de que extras termine de cargar, estos stubs disparan loadExtras
    // y reintentan con la función real (que ya estará en window).
    function switchDecantTab(tab) {
      loadExtras().then(function() {
        if (window.switchDecantTab !== switchDecantTab) {
          window.switchDecantTab(tab);
        }
      }).catch(function(e) {
        console.error('[extras] no se pudo cargar para switchDecantTab:', e);
      });
    }
    function addDecantCombo() {
      loadExtras().then(function() {
        if (window.addDecantCombo !== addDecantCombo) {
          window.addDecantCombo();
        }
      }).catch(function(e) {
        console.error('[extras] no se pudo cargar para addDecantCombo:', e);
      });
    }

    // Cargar config al inicio (no bloquea, con defaults)
    loadDecantsConfig();
    loadPromoDecants();   // [PROMO-DECANTS] N1

    // [JS-CHUNK] Preload de extras.js en idle time post-TTI.
    // Si el cliente abre decants/quiz/etc DESPUÉS de este preload, la función
    // real ya está disponible — UX instantánea. Si abre ANTES, el stub carga
    // extras on-demand y dispara la función (delay ~200ms primera vez).
    if (typeof window !== 'undefined') {
      var preloadExtras = function() {
        if (typeof loadExtras === 'function') loadExtras().catch(function(){});
      };
      if (window.requestIdleCallback) {
        window.requestIdleCallback(preloadExtras, { timeout: 5000 });
      } else if (window.addEventListener) {
        window.addEventListener('load', function() { setTimeout(preloadExtras, 2000); });
      }
    }
    // ============================================================
    // 🎯 CUSTOM CURSOR — dot dorado que sigue el mouse (desktop only)
    // Lerp suave (~12fps perceived) sin sentirse pesado. Solo se activa
    // si hover + pointer fine (desktop con mouse). En mobile/touch
    // queda display:none por CSS y este JS no hace nada.
    // ============================================================
    (function initCustomCursor() {
      // Skip si no es desktop con mouse fino
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      // Skip si el user pidió reduced motion
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      var cursor = document.getElementById('customCursor');
      if (!cursor) return;

      var targetX = -100, targetY = -100;     // posición real del mouse
      var currentX = -100, currentY = -100;   // posición animada del cursor
      var isActive = false;

      document.addEventListener('mousemove', function(e) {
        targetX = e.clientX;
        targetY = e.clientY;
        if (!isActive) {
          isActive = true;
          cursor.classList.add('is-active');
        }
      });

      document.addEventListener('mouseleave', function() {
        isActive = false;
        cursor.classList.remove('is-active');
      });

      document.addEventListener('mousedown', function() {
        cursor.classList.add('is-clicking');
      });
      document.addEventListener('mouseup', function() {
        cursor.classList.remove('is-clicking');
      });

      // Hover sobre elementos interactivos → cursor crece
      var hoverSelector = 'a, button, .product-card, .filter-btn, .nav-icon-btn, .cat-card, .set-card, .seleccion-card, .collectible-card, [role="button"], input, select, label.cursor-pointer';
      document.addEventListener('mouseover', function(e) {
        if (e.target.closest && e.target.closest(hoverSelector)) {
          cursor.classList.add('is-hover');
        }
      });
      document.addEventListener('mouseout', function(e) {
        if (e.target.closest && e.target.closest(hoverSelector)) {
          // Verificar que el relatedTarget NO sea también un interactivo
          var related = e.relatedTarget;
          if (!related || !related.closest || !related.closest(hoverSelector)) {
            cursor.classList.remove('is-hover');
          }
        }
      });

      // Loop de animación con lerp (interpolación suave). Setea left/top
      // en vez de transform — el CSS reserva transform para los scales
      // (is-active, is-hover, is-clicking) sin que el JS lo sobreescriba.
      function animateCursor() {
        currentX += (targetX - currentX) * 0.25;
        currentY += (targetY - currentY) * 0.25;
        cursor.style.left = currentX + 'px';
        cursor.style.top  = currentY + 'px';
        requestAnimationFrame(animateCursor);
      }
      requestAnimationFrame(animateCursor);
    })();
