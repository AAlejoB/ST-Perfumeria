    // ============================================================
    // SUPABASE INIT
    // ============================================================
    var SUPABASE_URL = 'https://rtgjzzkjrwbkdhkslxix.supabase.co';
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0Z2p6emtqcndia2Roa3NseGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzU3NzEsImV4cCI6MjA4OTYxMTc3MX0.SoVxC3eF51wi27pavlqIAjE-omqcnPylxJIQjY8vimo';
    var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    var currentUser = null;

    // ============================================================
    // ANALYTICS — tracking de clicks por perfume
    // ============================================================
    function trackClick(slug) {
      sb.from('perfume_clicks').insert({ slug: slug }).then(function(){});
    }

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
      document.getElementById('authError').textContent = '';
      if (phonePreview) phonePreview.textContent = '';
      if (phone2Match) phone2Match.textContent = '';
      if (mode === 'login') {
        nameEl.style.display = 'none';
        if (phone2El) phone2El.style.display = 'none';
        passEl.placeholder = 'Tu contraseña';
        titleEl.textContent = 'Iniciá sesión';
        subEl.innerHTML = '&iquest;No ten&eacute;s cuenta? <a href="#" onclick="event.preventDefault();switchAuthMode(\'register\')" style="color:var(--amarillo)">Cre&aacute; una</a>';
        btnEl.textContent = 'Entrar';
      } else {
        nameEl.style.display = '';
        if (phone2El) phone2El.style.display = '';
        passEl.placeholder = 'Creá una contraseña (mín. 4 caracteres)';
        titleEl.textContent = 'Unite a ST';
        subEl.innerHTML = 'Guardá tus favoritos, votá el perfume del mes y recibí ofertas<br><br>¿Ya tenés cuenta? <a href="#" onclick="event.preventDefault();switchAuthMode(\'login\')" style="color:var(--amarillo)">Iniciá sesión</a>';
        btnEl.textContent = 'Unirme';
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
        try { notifyTG('\ud83d\udea8 Login del cat\u00e1logo BLOQUEADO por ' + authFormatRemaining(cd) + '\n\ud83d\udd22 ' + st.fails + ' intentos fallidos'); } catch(e) {}
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
          // Login: verificar teléfono + contraseña
          var existing = await sb.from('clientes').select('id, nombre, telefono, password').eq('telefono', phone).limit(1);
          if (!existing.data || existing.data.length === 0) {
            // Numero inexistente cuenta como intento fallido
            registerAuthFail(errEl);
            if (errEl.textContent.indexOf('Esper') === -1) {
              errEl.textContent = 'No hay cuenta con ese número. ¿Querés registrarte?';
            }
            btn.disabled = false; return;
          }
          var cliente = existing.data[0];
          if (cliente.password !== pass) {
            registerAuthFail(errEl);
            if (errEl.textContent.indexOf('Esper') === -1) {
              var stTmp = getAuthLockout();
              var leftTmp = 5 - (stTmp.fails % 5);
              errEl.textContent = 'Contraseña incorrecta (' + leftTmp + ' intento' + (leftTmp === 1 ? '' : 's') + ' antes del bloqueo)';
            }
            btn.disabled = false; return;
          }
          clearAuthLockout(); // login exitoso resetea
          onLogin({ id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono });
          closeAuth();
        } else {
          // Register
          if (!name || name.length < 2) { errEl.textContent = 'Poné tu nombre completo'; btn.disabled = false; return; }
          var existing2 = await sb.from('clientes').select('id').eq('telefono', phone).limit(1);
          if (existing2.data && existing2.data.length > 0) {
            errEl.textContent = 'Este número ya está registrado. ¿Querés iniciar sesión?';
            errEl.innerHTML = 'Este número ya está registrado. <a href="#" onclick="event.preventDefault();switchAuthMode(\'login\')" style="color:var(--amarillo)">Iniciá sesión</a>';
            btn.disabled = false; return;
          }
          var res = await sb.from('clientes').insert({ nombre: name, telefono: phone, password: pass }).select().single();
          if (res.error) {
            errEl.textContent = res.error.message;
            btn.disabled = false; return;
          }
          closeAuth();
          onLogin({ id: res.data.id, nombre: res.data.nombre, telefono: res.data.telefono });
        }
      } catch(e) { errEl.textContent = 'Error de conexión'; }
      btn.disabled = false;
    }

    // Notificar Telegram desde frontend
    function notifyTG(msg) {
      sb.rpc('send_telegram', { msg: msg }).catch(function(){});
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
        // Verificar contraseña actual
        var check = await sb.from('clientes').select('password, telefono, nombre').eq('id', currentUser.id).single();
        if (!check.data || check.data.password !== confirmPass) {
          errEl.textContent = 'Contraseña incorrecta';
          btn.disabled = false; return;
        }

        var oldName = check.data.nombre;
        var oldPhone = check.data.telefono;

        // Guardar cambios
        var { error } = await sb.from('clientes').update({ nombre: newName, telefono: newPhone }).eq('id', currentUser.id);
        if (error) { errEl.textContent = error.message; btn.disabled = false; return; }

        // Actualizar sesión local
        currentUser.nombre = newName;
        currentUser.telefono = newPhone;
        localStorage.setItem('st_cliente', JSON.stringify(currentUser));
        updateAuthUI();

        // Notificar Telegram
        var changes = [];
        if (oldName !== newName) changes.push('Nombre: ' + oldName + ' → ' + newName);
        if (oldPhone !== newPhone) changes.push('Tel: ' + oldPhone + ' → ' + newPhone);
        if (changes.length > 0) {
          notifyTG('✏️ Perfil editado\n👤 ' + newName + '\n' + changes.join('\n') + '\n📲 https://wa.me/' + newPhone);
        }

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
      unlockVoting();
      setTimeout(initMiSeleccion, 500);
    }

    function onLogout() {
      currentUser = null;
      localStorage.removeItem('st_cliente');
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
      if (!regBtn) return;
      if (currentUser) {
        regBtn.innerHTML = '<span class="auth-user-bar"><strong>' + currentUser.nombre + '</strong></span>';
        regBtn.setAttribute('onclick', 'event.preventDefault();openEditProfile()');
        regBtn.setAttribute('title', 'Editar perfil');
        if (drawerAuth) { drawerAuth.textContent = '✏️ Editar perfil'; drawerAuth.setAttribute('onclick', 'event.preventDefault();toggleDrawer();openEditProfile()'); }
        if (drawerLogout) drawerLogout.style.display = '';
      } else {
        regBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>Iniciar sesi\u00f3n';
        regBtn.setAttribute('onclick', 'event.preventDefault();openAuth()');
        regBtn.setAttribute('title', 'Iniciar sesi\u00f3n');
        if (drawerAuth) { drawerAuth.textContent = 'Iniciar sesi\u00f3n'; drawerAuth.setAttribute('onclick', 'event.preventDefault();toggleDrawer();openAuth()'); }
        if (drawerLogout) drawerLogout.style.display = 'none';
      }
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
        if (p.esSet) return false;
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
          + '<button class="quiz-result-cta" onclick="scrollToPerfume(\'' + p.slug + '\')">Ver en catálogo &#8594;</button>'
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
        if (currentUser) {
          sb.from('favoritos').insert({ user_id: currentUser.id, slug: slug }).then(function(){});
        }
      }
      saveFavs();
      if (currentFilter === 'favs') applyFilters();
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
          ['masculino', 'femenino'].forEach(function(cat) {
            var top = null, topN = 0;
            Object.keys(counts[cat] || {}).forEach(function(s) {
              if (counts[cat][s] > topN) { topN = counts[cat][s]; top = s; }
            });
            if (top) ganadores.push((cat === 'masculino' ? '\ud83d\udc51 ' : '\ud83d\udc51 ') + top);
          });
          if (ganadores.length > 0) {
            document.getElementById('votoGanadorBanner').style.display = 'block';
            document.getElementById('votoGanadorText').textContent = ganadores.join('  |  ');
          }
        }

        // Cargar candidatos del mes actual
        var { data } = await sb.from('votacion_config').select('*').eq('mes', currentMes).single();
        if (data) {
          candidatosMasc = data.candidatos_masc || [];
          candidatosFem = data.candidatos_fem || [];
          renderVotoButtons();
        } else {
          document.getElementById('votoMasc').innerHTML = '<p style="font-size:.65rem;color:var(--gris);text-align:center;">Pr\u00f3ximamente</p>';
          document.getElementById('votoFem').innerHTML = '<p style="font-size:.65rem;color:var(--gris);text-align:center;">Pr\u00f3ximamente</p>';
        }
      } catch(e) {
        document.getElementById('votoMasc').innerHTML = '<p style="font-size:.65rem;color:var(--gris);text-align:center;">Pr\u00f3ximamente</p>';
        document.getElementById('votoFem').innerHTML = '<p style="font-size:.65rem;color:var(--gris);text-align:center;">Pr\u00f3ximamente</p>';
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
      if (!str) return '';
      const num = Math.round(parseFloat(str.replace(/,/g, '')));  // quitar comas US, parsear número
      return '$' + num.toLocaleString('es-AR').replace(/,/g, '.'); // formato AR con punto de miles
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

    function detectProductType(name) {
      var n = stripAccents(name.toLowerCase());
      for (var i = 0; i < PRODUCT_TYPES.length; i++) {
        if (n.indexOf(PRODUCT_TYPES[i].keyword) !== -1) return PRODUCT_TYPES[i].label;
      }
      return null;
    }

    // updateGalleryDots: actualiza los puntitos del carrusel de fotos
    // al scrollear. Detecta qué slide está visible y marca su dot.
    function updateGalleryDots(gallery) {
      var slides = gallery.querySelectorAll('.card-gallery-slide');
      if (slides.length === 0) return;
      var scrollLeft = gallery.scrollLeft;
      var slideWidth = slides[0].offsetWidth;
      var activeIdx = Math.round(scrollLeft / slideWidth);
      var dots = gallery.parentElement.querySelectorAll('.card-gallery-dot');
      dots.forEach(function(d, i) { d.classList.toggle('active', i === activeIdx); });
    }

    // Click en flechas: avanza o retrocede una foto.
    // direction: +1 (siguiente) / -1 (anterior)
    function scrollGalleryArrow(btn, direction, ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      var gallery = btn.parentElement.querySelector('.card-gallery');
      if (!gallery) return;
      var slides = gallery.querySelectorAll('.card-gallery-slide');
      if (slides.length === 0) return;
      var slideWidth = slides[0].offsetWidth;
      var currentIdx = Math.round(gallery.scrollLeft / slideWidth);
      var newIdx = Math.max(0, Math.min(slides.length - 1, currentIdx + direction));
      gallery.scrollTo({ left: newIdx * slideWidth, behavior: 'smooth' });
    }

    // Click en un puntito: saltar directo a esa foto.
    function scrollGalleryTo(dot, idx, ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      var gallery = dot.parentElement.parentElement.querySelector('.card-gallery');
      if (!gallery) return;
      var slides = gallery.querySelectorAll('.card-gallery-slide');
      if (slides.length === 0) return;
      var slideWidth = slides[0].offsetWidth;
      gallery.scrollTo({ left: idx * slideWidth, behavior: 'smooth' });
    }

    function buildCard(p) {
      delete p._precioOriginal; // limpiar entre renders
      var letter = p.name.charAt(0).toUpperCase();
      var priceFormatted = p.promo ? formatPrice(p.promo) : formatPrice(p.price);
      var originalFormatted = p.promo ? formatPrice(p.price) : '';
      const pCat = catLabel(p.cat);

      const fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';

      // Galería: si tiene fotos_extra, armar carrusel; si no, foto simple
      var imageHTML;
      var extraFotos = p.fotos_extra ? p.fotos_extra.split(',').map(function(u) { return u.trim(); }).filter(Boolean) : [];

      if (p.foto && extraFotos.length > 0) {
        // Carrusel con foto principal + extras (máx 4 total)
        var allFotos = [fotoSrc].concat(extraFotos.slice(0, 3));
        var slides = allFotos.map(function(url) {
          return '<div class="card-gallery-slide"><img src="' + url.replace(/ /g, '%20') + '" alt="' + p.name + '" loading="lazy" decoding="async"></div>';
        }).join('');
        var dots = allFotos.map(function(_, i) {
          return '<span class="card-gallery-dot' + (i === 0 ? ' active' : '') + '" onclick="scrollGalleryTo(this, ' + i + ', event)"></span>';
        }).join('');
        // Flechas para desktop (en mobile se ocultan por CSS — usan swipe)
        var arrowsHTML = ''
          + '<button type="button" class="card-gallery-arrow card-gallery-arrow-prev" onclick="scrollGalleryArrow(this, -1, event)" aria-label="Foto anterior">&#8249;</button>'
          + '<button type="button" class="card-gallery-arrow card-gallery-arrow-next" onclick="scrollGalleryArrow(this, 1, event)" aria-label="Foto siguiente">&#8250;</button>';
        imageHTML = '<div class="card-gallery" onscroll="updateGalleryDots(this)">' + slides + '</div>'
          + arrowsHTML
          + '<div class="card-gallery-dots">' + dots + '</div>';
      } else if (p.foto) {
        imageHTML = '<img src="' + fotoSrc + '" alt="' + p.name + '" loading="lazy" decoding="async">';
      } else {
        imageHTML = '<div class="photo-coming"><div class="bottle-placeholder"><div class="bottle-cap"></div><div class="bottle-neck"></div><div class="bottle-body"></div><span class="bottle-letter">' + letter + '</span></div><div class="photo-coming-ribbon">Foto próximamente</div></div>';
      }

      var effectivePrice = p.promo ? parseFloat(String(p.promo).replace(/,/g, '')) : parseFloat(String(p.price).replace(/,/g, ''));
      var cashPrice = Math.round(effectivePrice * 0.9);
      var cashFormatted = '$' + cashPrice.toLocaleString('es-AR').replace(/,/g, '.');

      var pricingHTML;
      if (p._precioOriginal) {
        // Tiene descuento temporal activo → precio tachado + nuevo precio en rojo
        pricingHTML = '<span class="card-price-original-discount">' + p._precioOriginal + '</span>'
          + '<span class="price-promo card-price-discount">' + priceFormatted + '</span>'
          + '<span class="price-label">3 cuotas sin interés</span>'
          + '<span class="price-cash">' + cashFormatted + ' descuento efectivo/transf.</span>';
      } else if (p.promo) {
        pricingHTML = '<span class="price-promo">' + priceFormatted + '</span><span class="price-label">3 cuotas sin interés</span><span class="price-original">' + originalFormatted + '</span>'
          + '<span class="price-cash">' + cashFormatted + ' descuento efectivo/transf.</span>';
      } else {
        pricingHTML = '<span class="price-promo">' + priceFormatted + '</span><span class="price-label">3 cuotas sin interés</span>'
          + '<span class="price-cash">' + cashFormatted + ' descuento efectivo/transf.</span>';
      }

      var searchText = stripAccents([p.name, p.marca, p.marca_real || '', p.notas_salida || '', p.notas_corazon || '', p.notas_base || ''].join(' ').toLowerCase());

      var isFav = favs.indexOf(p.slug) !== -1;

      // Stock badge
      var stockStatus = p._stockStatus || 'ok';
      var isPaused = stockStatus === 'pausado';
      var stockBadge = '';
      if (stockStatus === 'low') stockBadge = '<span class="badge-ultimo">Último</span>';
      if (stockStatus === 'out') stockBadge = '<span class="badge-sin-stock">Sin stock</span>';
      if (isPaused) stockBadge = '<span class="badge-proximamente">Próximamente</span>';

      // Nuevo badge (últimos 10 del array = recién agregados)
      var nuevoBadge = '';
      if (p._isNew) nuevoBadge = '<span class="badge-nuevo">Nuevo</span>';

      // Tipo de producto (detección por nombre)
      var prodType = detectProductType(p.name);
      var tipoBadge = prodType ? '<span class="badge-tipo">' + prodType + '</span>' : '';

      // Cinta de etiqueta personalizada (se configura desde el admin)
      var ribbonHTML = '';
      if (p.etiqueta) {
        var ribbonColor = p.etiqueta_color || '#E8B800';
        ribbonHTML = '<div class="card-ribbon" style="background:' + ribbonColor + ';">' + p.etiqueta + '</div>';
      }

      // Descuento temporal: verificar si está activo
      var discountHTML = '';
      var discountTimerHTML = '';
      if (p.descuento_pct && p.descuento_pct > 0 && p.descuento_hasta) {
        var ahora = new Date();
        var vence = new Date(p.descuento_hasta);
        if (vence > ahora) {
          // Descuento activo → calcular nuevo precio
          var diff = vence - ahora;
          var dias = Math.floor(diff / 86400000);
          var horas = Math.floor((diff % 86400000) / 3600000);
          var timerText = dias > 0 ? dias + 'd ' + horas + 'h' : horas + 'h';

          discountHTML = '<div class="card-discount-badge"><span class="discount-pct">' + p.descuento_pct + '%</span> OFF</div>';
          discountTimerHTML = '<div class="card-discount-timer">⏰ ' + timerText + '</div>';

          // Recalcular precio con descuento
          var basePrice = p.promo ? parseFloat(String(p.promo).replace(/,/g, '')) : parseFloat(String(p.price).replace(/,/g, ''));
          var discountedPrice = Math.round(basePrice * (1 - p.descuento_pct / 100));
          // Guardar el precio original para tachar
          p._precioOriginal = priceFormatted;
          priceFormatted = '$' + discountedPrice.toLocaleString('es-AR').replace(/,/g, '.');
          // Recalcular cash con el precio descontado
          var discCash = Math.round(discountedPrice * 0.9);
          cashFormatted = '$' + discCash.toLocaleString('es-AR').replace(/,/g, '.');
        }
      }

      // ML del producto
      var mlText = (p.ml || 100) + ' ml';

      // Visitas
      var viewCount = perfumeViews[p.slug] || 0;
      var viewsHTML = viewCount > 5 ? '<div class="card-views"><svg viewBox="0 0 16 16"><path d="M8 3C4.36 3 1.26 5.28 0 8.5c1.26 3.22 4.36 5.5 8 5.5s6.74-2.28 8-5.5C14.74 5.28 11.64 3 8 3zm0 9.17c-1.84 0-3.33-1.49-3.33-3.33S6.16 5.5 8 5.5s3.33 1.49 3.33 3.33S9.84 12.17 8 12.17zM8 7a1.83 1.83 0 1 0 0 3.67A1.83 1.83 0 0 0 8 7z"/></svg>' + viewCount + '</div>' : '';

      var isOutOfStock = stockStatus === 'out';

      // Botón "Avisame cuando vuelva" para sin stock y pausados
      var waitlistHTML = '';
      if (isOutOfStock || isPaused) {
        var alreadyWaiting = waitlistSlugs.indexOf(p.slug) !== -1;
        waitlistHTML = '<button class="waitlist-btn' + (alreadyWaiting ? ' subscribed' : '') + '" onclick="openWaitlist(\'' + p.slug + '\', event)">'
          + (alreadyWaiting ? '&#10003; Te avisamos cuando vuelva' : '&#128276; Avisame cuando vuelva')
          + '</button>';
      }

      // Precio efectivo para ordenar (usa promo si hay, sino price; ambos en número limpio)
      var sortPriceNum = p.promo
        ? parseFloat(String(p.promo).replace(/[^0-9.\-]/g, '')) || 0
        : parseFloat(String(p.price || '').replace(/[^0-9.\-]/g, '')) || 0;

      return '<div class="product-card card-lateral' + (isPaused ? ' pausado' : '') + (isOutOfStock ? ' sin-stock' : '') + '" data-cat="' + p.cat + '" data-slug="' + p.slug + '" data-perfil="' + (p.perfil || '') + '" data-price="' + sortPriceNum + '" data-search="' + searchText.replace(/"/g, '') + '">'
        + ribbonHTML + stockBadge + nuevoBadge + discountHTML + discountTimerHTML
        + '<button class="fav-heart' + (isFav ? ' liked' : '') + '" onclick="toggleFav(this, event)" aria-label="Favorito">' + (isFav ? '&#9829;' : '&#9825;') + '</button>'
        + '<button class="compare-btn" onclick="toggleCompare(\'' + p.slug + '\', this, event)" aria-label="Comparar">&#9878;</button>'
        + '<div class="card-image">' + imageHTML + '</div>'
        + '<div class="card-info">'
          + '<p class="card-name">' + p.name + '</p>'
          + '<p class="card-brand-st">ST PERFUMER\u00cdA</p>'
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
          + viewsHTML
          + '<a href="https://wa.me/5492975416017?text=' + encodeURIComponent('Hola! Me interesa el ' + p.name + '. ¿Tienen disponibilidad?') + '" target="_blank" class="card-cta-mobile">Consultar &#8594;</a>'
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
          + ((!p.esSet && (p.notas_salida || p.notas_corazon || p.notas_base)) ? '<button class="reveal-similares" onclick="showSimilares(\'' + p.slug + '\', event)">&#9830; Ver similares</button>' : '')
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
    (async function loadDestacadosFromDB() {
      try {
        var { data } = await sb.from('destacados').select('slug, posicion').order('posicion', { ascending: true });
        if (data && data.length > 0) {
          TOP_VENTAS_SLUGS = data.map(function(d) { return d.slug; });
          renderSeleccionST();
        }
      } catch(e) {}
    })();

    // Cargar combos desde Supabase
    (async function loadCombosFromDB() {
      try {
        var { data } = await sb.from('combos').select('*');
        if (data && data.length > 0) {
          data.forEach(function(c) {
            c.esSet = true;
            var idx = PERFUMES.findIndex(function(p) { return p.slug === c.slug; });
            if (idx !== -1) { PERFUMES[idx] = c; } else { PERFUMES.push(c); }
          });
          renderSets();
        }
      } catch(e) {}
    })();

    function renderSeleccionST() {
      var grid = document.getElementById('seleccionGrid');
      if (!grid) return;
      var html = '';
      TOP_VENTAS_SLUGS.forEach(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (!p) return;
        var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
        // Lazy + decoding async para que los destacados no frenen el first paint
        var imgHTML = p.foto
          ? '<img src="' + fotoSrc + '" alt="' + p.name + '" loading="lazy" decoding="async">'
          : '<div style="color:var(--amarillo);font-size:2rem;opacity:.3;">' + p.name.charAt(0) + '</div>';
        html += '<div class="collectible-card" onclick="scrollToPerfume(\'' + slug + '\')">'
          + '<div class="collectible-card-inner">'
            + '<div class="collectible-img-wrap">' + imgHTML + '</div>'
            + '<div class="collectible-info">'
              + '<p class="collectible-name">' + p.name + '</p>'
              + '<span class="collectible-badge">Top ventas</span>'
            + '</div>'
          + '</div>'
        + '</div>';
      });
      grid.innerHTML = html;
    }

    // Pre-renderizar con defaults inmediatamente
    renderSeleccionST();

    function scrollToPerfume(slug) {
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

      // Mostrar todas las cards
      cardsShown = PERFUMES.length;
      applyCardVisibility();

      var card = document.querySelector('.product-card[data-slug="' + slug + '"]');
      if (card) {
        setTimeout(function() {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      var sets = PERFUMES.filter(function(p) { return p.esSet; });
      if (sets.length === 0) {
        document.getElementById('setsSection').style.display = 'none';
        return;
      }
      var html = '';
      sets.forEach(function(s) {
        var items = s.items || [];
        var itemCount = items.length;
        var itemsClass = 'items-' + (itemCount > 4 ? 4 : itemCount);

        // Build image slots
        var imgsHTML = '';
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
            + (setPaused ? '' : '<a href="https://wa.me/5492975416017?text=' + encodeURIComponent('Hola! Me interesa el ' + s.name + '. ¿Tienen disponibilidad?') + '" target="_blank" class="set-cta">Consultar &#8594;</a>')
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
        // Saltear el mismo perfume y los sets (no son perfumes individuales)
        if (p.slug === slug || p.esSet) return;

        var notasP = getNotas(p);
        if (notasP.length === 0) return;  // sin notas = no se puede comparar

        // Contar cuántas notas del original aparecen en este perfume
        var shared = 0;
        notasOrigen.forEach(function(n) {
          if (notasP.indexOf(n) !== -1) shared++;  // ¡coincide!
        });

        // Solo incluir si hay al menos 1 nota en común Y más del 60% de match
        if (shared > 0) {
          var pct = Math.round((shared / notasOrigen.length) * 100);
          if (pct > 60) {
            scores.push({ perfume: p, shared: shared, total: notasOrigen.length });
          }
        }
      });

      // Ordenar: el que más notas comparte primero
      scores.sort(function(a, b) { return b.shared - a.shared; });
      // Devolver máximo 5 resultados
      return scores.slice(0, 5);
    }

    function showSimilares(slug, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var perfume = PERFUMES.find(function(p) { return p.slug === slug; });
      if (!perfume) return;

      var similares = findSimilares(slug);
      var title = document.getElementById('similaresTitle');
      title.textContent = 'Similares a ' + perfume.name;

      var content = document.getElementById('similaresContent');
      if (similares.length === 0) {
        content.innerHTML = '<div style="text-align:center;padding:1.5rem .5rem;">'
          + '<p style="font-size:1.8rem;margin-bottom:.6rem;">🔮</p>'
          + '<p style="color:#fff;font-size:.85rem;font-weight:600;margin-bottom:.4rem;">¡Este perfume es único!</p>'
          + '<p style="color:var(--gris);font-size:.72rem;line-height:1.5;">Ningún otro perfume de nuestro catálogo comparte más del 60% de sus notas con <strong style="color:var(--amarillo);">' + perfume.name + '</strong>.</p>'
          + '<p style="color:var(--gris);font-size:.65rem;margin-top:.8rem;opacity:.7;">Estamos sumando nuevas fragancias constantemente 👀</p>'
          + '</div>';
      } else {
        var html = '';
        similares.forEach(function(s) {
          var p = s.perfume;
          var pct = Math.round((s.shared / s.total) * 100);
          var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
          var letter = p.name.charAt(0);
          var imgHTML = p.foto
            ? '<img src="' + fotoSrc + '" alt="' + p.name + '" loading="lazy" decoding="async">'
            : '<div style="color:var(--amarillo);font-size:1rem;opacity:.4;">' + letter + '</div>';
          var price = p.promo ? formatPrice(p.promo) : formatPrice(p.price);

          html += '<div class="similar-item" onclick="closeSimilares();scrollToPerfume(\'' + p.slug + '\')">'
            + '<div class="similar-img">' + imgHTML + '</div>'
            + '<div class="similar-info">'
              + '<p class="similar-name">' + p.name + '</p>'
              + '<p class="similar-brand">' + (p.marca_real || p.marca) + '</p>'
              + '<p class="similar-match">' + s.shared + ' notas en com\u00fan \u00b7 ' + pct + '% match</p>'
            + '</div>'
            + '<span class="similar-price">' + price + '</span>'
          + '</div>';
        });
        content.innerHTML = html;
      }

      document.getElementById('similaresOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeSimilares(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('similaresOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    // ============================================================
    // COMPARTIR PERFUME
    // ============================================================
    function sharePerfume(slug, btn, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      var url = 'https://www.stperfumeria.com/perfume/' + slug;
      var text = p.name + ' — ST Perfumería\n' + (p.notas_salida ? 'Notas: ' + p.notas_salida : '') + '\n' + url;

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
    }

    // ============================================================
    // FILTRO POR RANGO DE PRECIO
    // ============================================================
    var priceFilterMin = 0;
    var priceFilterMax = 200000;
    var priceFilterActive = false;

    function initPriceSlider() {
      // Calcular min/max reales del catálogo
      var prices = PERFUMES.filter(function(p) { return !p.esSet; }).map(function(p) {
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
        var { data } = await sb.from('perfume_clicks').select('slug');
        if (data) {
          data.forEach(function(c) { perfumeViews[c.slug] = (perfumeViews[c.slug] || 0) + 1; });
        }
      } catch(e) {}
    }

    // ============================================================
    // MARCAR PERFUMES NUEVOS (últimos 10 del array)
    // ============================================================
    function markNewPerfumes() {
      var nonSet = PERFUMES.filter(function(p) { return !p.esSet; });
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
      grid.innerHTML = PERFUMES.filter(function(p) { return !p.esSet && !p._oculto; }).map(buildCard).join('');
      cardsShown = CARDS_INITIAL;    // mostrar solo las primeras N cards
      applyCardVisibility();          // aplicar filtros y mostrar/ocultar
      updateFavBadge();               // actualizar contador de favoritos
      renderSeleccionST();            // renderizar sección "Selección ST"
      renderSets();                   // renderizar sets/combos
      renderNoteFilters();            // renderizar filtros por notas

    }

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
        // FILTRO 2: Búsqueda por texto (nombre, marca, notas)
        var searchMatch = !currentSearch || card.dataset.search.indexOf(currentSearch) !== -1;
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
            card.style.display = 'flex';
            card.style.contentVisibility = 'visible';
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
      var label = currentFilter === 'favs' ? totalMatch + ' favoritos' : totalMatch + ' fragancias';
      document.getElementById('filterCount').textContent = label;
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
    }

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

      // Buscar matches (nombre y marca tienen prioridad)
      var matches = [];
      PERFUMES.forEach(function(p) {
        if (p.esSet) return;
        var nameNorm = stripAccents(p.name.toLowerCase());
        var marcaNorm = stripAccents((p.marca_real || p.marca || '').toLowerCase());
        var notasNorm = stripAccents(((p.notas_salida || '') + ' ' + (p.notas_corazon || '') + ' ' + (p.notas_base || '')).toLowerCase());

        var score = 0;
        if (nameNorm.indexOf(norm) === 0) score = 3;         // empieza con
        else if (nameNorm.indexOf(norm) !== -1) score = 2;    // contiene en nombre
        else if (marcaNorm.indexOf(norm) !== -1) score = 1;   // contiene en marca
        else if (notasNorm.indexOf(norm) !== -1) score = 0.5; // contiene en notas
        else return;

        matches.push({ perfume: p, score: score, nameNorm: nameNorm });
      });

      // Ordenar: mejor match primero
      matches.sort(function(a, b) { return b.score - a.score || a.nameNorm.localeCompare(b.nameNorm); });
      matches = matches.slice(0, 5);

      if (matches.length === 0) {
        box.innerHTML = '<div class="search-sug-empty">No se encontraron resultados</div>';
        box.classList.add('active');
        sugActiveIndex = -1;
        return;
      }

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
        var grid = document.getElementById('catalogGrid');
        var gridTop = grid.getBoundingClientRect().top + window.pageYOffset - 130;
        window.scrollTo(0, gridTop); // scroll instantáneo

        // 4) Highlight la card
        setTimeout(function() {
          var card = document.querySelector('.product-card[data-slug="' + slug + '"]');
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
      if (!box.classList.contains('active')) return;
      var items = box.querySelectorAll('.search-sug-item');
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
    // LISTA DE ESPERA — Sin stock / Pausados
    // ============================================================
    var waitlistSlugs = JSON.parse(localStorage.getItem('st_waitlist') || '[]');

    function openWaitlist(slug, e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      document.getElementById('waitlistSlug').value = slug;
      document.getElementById('waitlistPerfumeName').textContent = p.name;
      document.getElementById('waitlistMsg').textContent = '';
      document.getElementById('waitlistMsg').style.color = '';
      document.getElementById('waitlistPhonePreview').textContent = '';
      document.getElementById('waitlistSubmitBtn').disabled = false;

      // Pre-llenar teléfono si está logueado (mostrar solo los 10 dígitos locales)
      var phoneInput = document.getElementById('waitlistPhone');
      if (currentUser && currentUser.telefono) {
        var tel = currentUser.telefono;
        // Si tiene 549 al inicio, quitar para mostrar solo la parte local
        if (tel.substring(0, 3) === '549') tel = tel.substring(3);
        else if (tel.substring(0, 2) === '54') tel = tel.substring(2);
        phoneInput.value = tel;
        previewWaitlistPhone();
      } else {
        phoneInput.value = '';
      }

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
      var rawPhone = document.getElementById('waitlistPhone').value.trim();
      var msgEl = document.getElementById('waitlistMsg');
      var btn = document.getElementById('waitlistSubmitBtn');
      msgEl.textContent = '';

      if (!rawPhone || rawPhone.replace(/[^0-9]/g, '').length < 8) {
        msgEl.style.color = '#e74c3c';
        msgEl.textContent = 'Pon\u00e9 un n\u00famero de WhatsApp v\u00e1lido';
        return;
      }
      var phone = cleanPhone(rawPhone);
      if (phone.length !== 13) {
        msgEl.style.color = '#e74c3c';
        msgEl.textContent = 'El n\u00famero debe tener 10 d\u00edgitos (sin 0 ni 15)';
        return;
      }

      btn.disabled = true;

      try {
        // Verificar si ya está en lista para este perfume
        var existing = await sb.from('lista_espera').select('id').eq('slug', slug).eq('telefono', phone).limit(1);
        if (existing.data && existing.data.length > 0) {
          msgEl.style.color = 'var(--amarillo)';
          msgEl.textContent = '\u00a1Ya est\u00e1s en la lista! Te avisamos cuando vuelva.';
          markWaitlistSlug(slug);
          setTimeout(function() { closeWaitlist(); }, 1800);
          btn.disabled = false;
          return;
        }

        var perfume = PERFUMES.find(function(p) { return p.slug === slug; });
        var nombre = currentUser ? currentUser.nombre : '';

        var res = await sb.from('lista_espera').insert({
          slug: slug,
          telefono: phone,
          nombre: nombre,
          perfume_name: perfume ? perfume.name : slug
        });

        if (res.error) {
          msgEl.style.color = '#e74c3c';
          msgEl.textContent = 'Error: ' + res.error.message;
          btn.disabled = false;
          return;
        }

        // Marcar como suscripto
        markWaitlistSlug(slug);

        // Notificar Telegram
        notifyTG('\ud83d\udd14 Lista de espera\n\ud83e\uddf4 ' + (perfume ? perfume.name : slug) + '\n\ud83d\udcf1 ' + phone + (nombre ? '\n\ud83d\udc64 ' + nombre : ''));

        msgEl.style.color = '#27ae60';
        msgEl.textContent = '\u00a1Listo! Te avisamos por WhatsApp cuando vuelva.';
        setTimeout(function() { closeWaitlist(); }, 2000);
      } catch(e) {
        msgEl.style.color = '#e74c3c';
        msgEl.textContent = 'Error de conexi\u00f3n. Intent\u00e1 de nuevo.';
      }
      btn.disabled = false;
    }

    function markWaitlistSlug(slug) {
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
    async function loadPerfumesNuevos() {
      try {
        var { data } = await sb.from('perfumes_nuevos').select('*');
        if (data && data.length > 0) {
          data.forEach(function(p) {
            // No duplicar si ya existe
            if (PERFUMES.find(function(pf) { return pf.slug === p.slug; })) return;
            // Convertir price integer a formato string "85,000.00"
            function intToPrice(n) {
              if (!n) return '';
              return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            PERFUMES.push({
              slug: p.slug, name: p.name, marca: p.marca, marca_real: p.marca_real || '',
              cat: p.cat, perfil: p.perfil,
              price: intToPrice(p.price),
              promo: p.promo ? intToPrice(p.promo) : '',
              foto: p.foto || '', ml: p.ml || 100,
              notas_salida: p.notas_salida || '', notas_corazon: p.notas_corazon || '',
              notas_base: p.notas_base || '', _isNew: true
            });
          });
        }
      } catch(e) {}
    }

    // Cargar overrides desde Supabase y aplicar sobre perfumes.js
    async function loadOverrides() {
      try {
        var { data } = await sb.from('perfume_overrides').select('*');
        if (data && data.length > 0) {
          data.forEach(function(o) {
            var p = PERFUMES.find(function(pf) { return pf.slug === o.slug; });
            if (!p) return;
            // Si está marcado como oculto por el admin, lo ocultamos del catálogo
            if (o.oculto === true) { p._oculto = true; return; }
            // Solo sobreescribir campos que tengan valor
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
            // Fotos extra para galería
            if (o.fotos_extra) p.fotos_extra = o.fotos_extra;
            // Etiqueta de cinta personalizada (se puede poner y quitar)
            if (o.etiqueta !== undefined) p.etiqueta = o.etiqueta || '';
            if (o.etiqueta_color) p.etiqueta_color = o.etiqueta_color;
            // Descuento temporal
            if (o.descuento_pct) p.descuento_pct = o.descuento_pct;
            if (o.descuento_hasta) p.descuento_hasta = o.descuento_hasta;
          });
        }
      } catch(e) {}
    }

    loadPerfumesNuevos().then(function() {
      return loadOverrides();
    }).then(function() {
      markNewPerfumes();
      return loadPerfumeViews();
    }).then(function() {
      renderCatalog();
      sortCards('price-desc');
      checkDeepLink();
    });
    renderCategories();
    loadVotacionFromDB();
    checkStoreStatus();

    // ============================================================
    // HORARIO DEL LOCAL
    // ============================================================
    async function checkStoreStatus() {
      var el = document.getElementById('waStatus');
      if (!el) return;

      // Hora Argentina (UTC-3)
      var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
      var day = now.getDay(); // 0=dom
      var hour = now.getHours();
      var min = now.getMinutes();
      var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

      // Verificar cierre especial
      try {
        var { data: cierres } = await sb.from('cierres_especiales').select('motivo').eq('fecha', todayStr);
        if (cierres && cierres.length > 0) {
          el.className = 'wa-status wa-status--special';
          el.innerHTML = '<span class="wa-status-dot"></span>' + cierres[0].motivo;
          return;
        }
      } catch(e) {}

      // Domingo cerrado
      if (day === 0) {
        el.className = 'wa-status wa-status--closed';
        el.innerHTML = '<span class="wa-status-dot"></span>Cerrado · Abrimos lunes 10hs';
        return;
      }

      // Lunes a sábado: 10:00 a 20:00
      var currentMin = hour * 60 + min;
      var openMin = 10 * 60;   // 10:00
      var closeMin = 20 * 60;  // 20:00

      if (currentMin >= openMin && currentMin < closeMin) {
        var remainHrs = Math.floor((closeMin - currentMin) / 60);
        var remainMin = (closeMin - currentMin) % 60;
        var remainText = remainHrs > 0 ? remainHrs + 'h ' + (remainMin > 0 ? remainMin + 'min' : '') : remainMin + 'min';
        el.className = 'wa-status wa-status--open';
        el.innerHTML = '<span class="wa-status-dot"></span>Abierto · Cierra en ' + remainText.trim();
      } else if (currentMin < openMin) {
        el.className = 'wa-status wa-status--closed';
        el.innerHTML = '<span class="wa-status-dot"></span>Cerrado · Abrimos hoy 10hs';
      } else {
        // Ya cerró
        if (day === 6) {
          el.className = 'wa-status wa-status--closed';
          el.innerHTML = '<span class="wa-status-dot"></span>Cerrado · Abrimos lunes 10hs';
        } else {
          el.className = 'wa-status wa-status--closed';
          el.innerHTML = '<span class="wa-status-dot"></span>Cerrado · Abrimos mañana 10hs';
        }
      }
    }

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
    // SERVICE WORKER (PWA)
    // ============================================================
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function(){});
    }

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

      function updateStatus(feriados, cierres) {
        var el = document.getElementById('storeStatus');
        var textEl = document.getElementById('storeStatusText');
        if (!el || !textEl) return;

        var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
        var dia = now.getDay();
        var hora = now.getHours();
        var mes = now.getMonth() + 1;
        var diaNum = now.getDate();
        var hoyISO = now.getFullYear() + '-' + String(mes).padStart(2,'0') + '-' + String(diaNum).padStart(2,'0');

        // 1) Verificar cierre especial del admin
        if (cierres && cierres.length) {
          for (var i = 0; i < cierres.length; i++) {
            if (cierres[i].fecha === hoyISO) {
              el.className = 'store-status holiday';
              textEl.textContent = cierres[i].motivo;
              el.style.display = 'inline-flex';
              return;
            }
          }
        }

        // 2) Verificar feriado nacional
        if (feriados && feriados.length) {
          for (var i = 0; i < feriados.length; i++) {
            if (feriados[i].mes === mes && feriados[i].dia === diaNum) {
              el.className = 'store-status holiday';
              textEl.textContent = 'Hoy feriado · ' + (feriados[i].motivo || 'Feriado');
              el.style.display = 'inline-flex';
              return;
            }
          }
        }

        // 3) Horario normal
        var horario = HORARIOS[dia];
        if (!horario) {
          el.className = 'store-status closed';
          textEl.textContent = 'Cerrado · Abrimos lunes 10hs';
          el.style.display = 'inline-flex';
          return;
        }

        if (hora >= horario.open && hora < horario.close) {
          var restante = horario.close - hora;
          el.className = 'store-status open';
          textEl.textContent = 'Abierto · Cierra a las ' + horario.close + 'hs' + (restante <= 1 ? ' · ¡Última hora!' : '');
        } else if (hora < horario.open) {
          el.className = 'store-status closed';
          textEl.textContent = 'Cerrado · Abrimos hoy a las ' + horario.open + 'hs';
        } else {
          var manana = (dia + 1) % 7;
          var diasSemana = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
          if (HORARIOS[manana]) {
            el.className = 'store-status closed';
            textEl.textContent = 'Cerrado · Abrimos ' + diasSemana[manana] + ' ' + HORARIOS[manana].open + 'hs';
          } else {
            el.className = 'store-status closed';
            textEl.textContent = 'Cerrado · Abrimos lunes 10hs';
          }
        }
        el.style.display = 'inline-flex';
      }

      // Cargar feriados + cierres + ajuste horario en paralelo
      var year = new Date().getFullYear();
      Promise.all([
        fetch('https://nolaborables.com.ar/api/v2/feriados/' + year).then(function(r) { return r.json(); }).catch(function() { return []; }),
        sb.from('cierres_especiales').select('fecha,motivo').then(function(r) { return r.data || []; }).catch(function() { return []; }),
        sb.from('ajuste_horario').select('*').order('created_at', { ascending: false }).limit(1).then(function(r) { return r.data || []; }).catch(function() { return []; })
      ]).then(function(results) {
        // Aplicar horario modificado si hay uno vigente hoy
        var hoyISO = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
        var hoyStr = hoyISO.getFullYear() + '-' + String(hoyISO.getMonth()+1).padStart(2,'0') + '-' + String(hoyISO.getDate()).padStart(2,'0');
        var ajuste = results[2][0];
        if (ajuste && ajuste.desde <= hoyStr && ajuste.hasta >= hoyStr) {
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
        }
        updateStatus(results[0], results[1]);
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
      countEl.textContent = cart.length;
      btn.classList.toggle('visible', cart.length > 0);
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
        var total = 0;
        cart.forEach(function(slug) {
          var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
          if (!p) return;
          var priceNum = p.promo ? parseFloat(String(p.promo).replace(/,/g, '')) : parseFloat(String(p.price).replace(/,/g, ''));
          total += priceNum;
          var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
          var imgHTML = fotoSrc
            ? '<img class="cart-item-img" src="' + fotoSrc + '" alt="' + p.name + '">'
            : '<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1rem;color:var(--amarillo);opacity:.3;">' + p.name.charAt(0) + '</div>';
          html += '<div class="cart-item">'
            + imgHTML
            + '<div class="cart-item-info"><p class="cart-item-name">' + p.name + '</p><p class="cart-item-brand">' + (p.marca_real || p.marca) + '</p></div>'
            + '<span class="cart-item-price">$' + Math.round(priceNum).toLocaleString('es-AR').replace(/,/g, '.') + '</span>'
            + '<button class="cart-item-remove" onclick="removeFromCart(\'' + slug + '\')">&times;</button>'
          + '</div>';
        });
        container.innerHTML = html;
        var cuota = Math.round(total / 3);
        totalEl.textContent = '$' + cuota.toLocaleString('es-AR').replace(/,/g, '.');
        var cashTotal = Math.round(total * 0.9);
        cashEl.textContent = 'Efectivo/transf: $' + cashTotal.toLocaleString('es-AR').replace(/,/g, '.') + ' (total $' + Math.round(total).toLocaleString('es-AR').replace(/,/g, '.') + ' con 10% off)';
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

    // sendCartToWA: arma un mensaje profesional y lo manda por WhatsApp
    // Incluye: lista de perfumes, marca, precio, total en cuotas,
    // total en efectivo, cantidad de items, y nota del cliente si hay.
    function sendCartToWA() {
      if (cart.length === 0) return;
      var note = document.getElementById('cartNote').value.trim();

      var lines = [];
      lines.push('Hola! 👋 Me interesan estos perfumes:');
      lines.push('');

      var total = 0;
      var num = 0;
      cart.forEach(function(slug) {
        var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
        if (!p) return;
        var priceNum = p.promo ? parseFloat(String(p.promo).replace(/,/g, '')) : parseFloat(String(p.price).replace(/,/g, ''));
        total += priceNum;
        num++;
        var marca = p.marca_real || p.marca;
        lines.push(num + '. *' + p.name + '* — ' + marca);
        lines.push('   💰 $' + Math.round(priceNum).toLocaleString('es-AR').replace(/,/g, '.'));
      });

      lines.push('');
      lines.push('📦 *' + num + (num === 1 ? ' perfume' : ' perfumes') + '*');
      var cuota = Math.round(total / 3);
      lines.push('💳 3 cuotas sin interés de *$' + cuota.toLocaleString('es-AR').replace(/,/g, '.') + '* (total $' + Math.round(total).toLocaleString('es-AR').replace(/,/g, '.') + ')');
      var cashTotal = Math.round(total * 0.9);
      lines.push('💵 Efectivo/transf: *$' + cashTotal.toLocaleString('es-AR').replace(/,/g, '.') + '* (10% off)');

      if (note) {
        lines.push('');
        lines.push('📝 _' + note + '_');
      }

      lines.push('');
      lines.push('¿Tienen disponibilidad? 🙏');

      var msg = lines.join('\n');
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
      var msg = 'Hola! Me interesa el ' + p.name + (p.esSet ? ' (Set)' : '') + '. ¿Tienen disponibilidad?';
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

    function openBottomSheet(slug) {
      if (window.innerWidth >= 768) return; // solo mobile
      var p = PERFUMES.find(function(pf) { return pf.slug === slug; });
      if (!p) return;
      currentBsSlug = slug;

      // Imagen
      var imgWrap = document.getElementById('bsImgWrap');
      var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
      imgWrap.innerHTML = fotoSrc
        ? '<img class="bs-img" src="' + fotoSrc + '" alt="' + p.name + '">'
        : '<div class="bs-img-placeholder">' + p.name.charAt(0) + '</div>';

      // Info
      document.getElementById('bsName').textContent = p.name;
      document.getElementById('bsBrand').textContent = p.marca_real || p.marca;

      // Tags
      var pCat = p.cat.indexOf(',') !== -1 ? p.cat.split(',')[0].trim() : p.cat;
      var prodType = detectProductType(p.name);
      var tipoBadge = prodType ? '<span class="badge-tipo">' + prodType + '</span>' : '';
      document.getElementById('bsTags').innerHTML =
        '<span class="card-tag tag-cat">' + pCat + '</span>'
        + '<span class="card-tag tag-ml">' + (p.ml || 100) + ' ml</span>'
        + '<span class="card-tag tag-acorde">' + (p.perfil || '') + '</span>'
        + tipoBadge;

      // Precio
      var priceNum = p.promo ? parseFloat(String(p.promo).replace(/,/g, '')) : parseFloat(String(p.price).replace(/,/g, ''));
      var cashNum = Math.round(priceNum * 0.9);
      var priceHTML = '';
      if (p.promo) {
        priceHTML = '<span class="price-promo">$' + formatPrice(p.promo) + '</span> <span class="price-label">3 cuotas sin interés</span> <span class="price-original">$' + formatPrice(p.price) + '</span>'
          + '<br><span class="price-cash">$' + cashNum.toLocaleString('es-AR').replace(/,/g, '.') + ' descuento efectivo/transf.</span>';
      } else {
        priceHTML = '<span class="price-promo">$' + formatPrice(p.price) + '</span> <span class="price-label">3 cuotas sin interés</span>'
          + '<br><span class="price-cash">$' + cashNum.toLocaleString('es-AR').replace(/,/g, '.') + ' descuento efectivo/transf.</span>';
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

      // Botón comparar
      var btnCompare = document.getElementById('bsBtnCompare');
      var inCompare = compareList.indexOf(slug) !== -1;
      btnCompare.innerHTML = inCompare ? '&#9878; Comparando' : '&#9878; Comparar';
      btnCompare.style.color = inCompare ? 'var(--amarillo)' : '';
      btnCompare.onclick = function(e) {
        var cardEl = document.querySelector('[data-slug="' + slug + '"]');
        var cmpBtn = cardEl ? cardEl.querySelector('.compare-btn') : null;
        toggleCompare(slug, cmpBtn, e);
        var nowIn = compareList.indexOf(slug) !== -1;
        btnCompare.innerHTML = nowIn ? '&#9878; Comparando' : '&#9878; Comparar';
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
        document.body.style.overflow = '';
        currentBsSlug = null;
      }, 260);
    }

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

        html += '<div class="compare-col">'
          + imgHTML
          + '<p class="compare-col-name">' + p.name + '</p>'
          + '<p class="compare-col-brand">' + (p.marca_real || p.marca) + '</p>'
          + '<p class="compare-row-label">Categor\u00eda</p>'
          + '<p class="compare-row-value">' + pCat + '</p>'
          + '<p class="compare-row-label">Perfil</p>'
          + '<p class="compare-row-value">' + (p.perfil || '\u2014') + '</p>'
          + '<p class="compare-row-label">Precio</p>'
          + '<p class="compare-row-price">$' + Math.round(priceNum).toLocaleString('es-AR').replace(/,/g, '.') + '</p>'
          + '<p class="compare-row-label">Salida</p>'
          + '<p class="compare-row-value">' + (p.notas_salida || '\u2014') + '</p>'
          + '<p class="compare-row-label">Coraz\u00f3n</p>'
          + '<p class="compare-row-value">' + (p.notas_corazon || '\u2014') + '</p>'
          + '<p class="compare-row-label">Base</p>'
          + '<p class="compare-row-value">' + (p.notas_base || '\u2014') + '</p>'
        + '</div>';
      });
      grid.innerHTML = html;

      // Notas en común
      findCommonNotes();

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
        if (p.esSet) return false;
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
        return !p.esSet && miselSlugs.indexOf(p.slug) === -1 && !p.oculto;
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
        scrollToPerfume(p.slug);
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
      var emoji = isDark ? '☀️' : '🌙';
      var icon = document.querySelector('.dark-toggle-icon');
      var floatIcon = document.getElementById('darkFloatIcon');
      if (icon) icon.textContent = emoji;
      if (floatIcon) floatIcon.textContent = emoji;
      localStorage.setItem('st_dark_mode', isDark ? '1' : '0');
    }

    // Restaurar preferencia guardada (dark mode por defecto)
    (function() {
      var saved = localStorage.getItem('st_dark_mode');
      // Si nunca eligió (null) o eligió oscuro ('1') → dark mode
      if (saved !== '0') {
        document.body.classList.add('dark-mode');
        var emoji = '☀️';
        var icon = document.querySelector('.dark-toggle-icon');
        var floatIcon = document.getElementById('darkFloatIcon');
        if (icon) icon.textContent = emoji;
        if (floatIcon) floatIcon.textContent = emoji;
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