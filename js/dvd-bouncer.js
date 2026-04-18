  (function() {
    if (window.innerWidth < 768) return; // Solo desktop

    var el = document.getElementById('dvdBouncer');
    var mediaEl = document.getElementById('dvdBouncerMedia');
    var nameEl = document.getElementById('dvdBouncerName');
    if (!el || !mediaEl || !nameEl) return;

    var W = 150, H = 195; // ancho y alto aprox del bouncer
    var x = Math.random() * (window.innerWidth - W);
    var y = Math.random() * (window.innerHeight - H);
    var speed = 0.45; // px por frame (~27px/s a 60fps) — bajado de 1.2 para que sea calmo y elegante
    var dx = (Math.random() > 0.5 ? 1 : -1) * speed;
    var dy = (Math.random() > 0.5 ? 1 : -1) * speed;
    var currentIdx = 0;
    var running = false;

    function getSlugs() {
      return (typeof TOP_VENTAS_SLUGS !== 'undefined' && TOP_VENTAS_SLUGS.length > 0)
        ? TOP_VENTAS_SLUGS
        : (typeof DEFAULT_TOP_SLUGS !== 'undefined' ? DEFAULT_TOP_SLUGS : []);
    }

    function getPerfume(slug) {
      if (typeof PERFUMES === 'undefined') return null;
      return PERFUMES.find(function(p) { return p.slug === slug; }) || null;
    }

    function renderPerfume(idx) {
      var slugs = getSlugs();
      if (slugs.length === 0) return;
      var slug = slugs[idx % slugs.length];
      var p = getPerfume(slug);
      if (!p) return;

      if (p.foto) {
        mediaEl.innerHTML = '<img class="dvd-bouncer-img" src="' + p.foto.replace(/ /g, '%20') + '" alt="' + p.name + '">';
      } else {
        mediaEl.innerHTML = '<div class="dvd-bouncer-letter">' + p.name.charAt(0) + '</div>';
      }
      nameEl.textContent = p.name;
    }

    function nextPerfume() {
      currentIdx++;
      var slugs = getSlugs();
      if (slugs.length > 0) currentIdx = currentIdx % slugs.length;
      renderPerfume(currentIdx);
    }

    function tick() {
      if (!running) return;

      var vw = window.innerWidth;
      var vh = window.innerHeight;

      x += dx;
      y += dy;

      var bounced = false;

      // Rebote horizontal
      if (x <= 0) { x = 0; dx = Math.abs(dx); bounced = true; }
      else if (x + W >= vw) { x = vw - W; dx = -Math.abs(dx); bounced = true; }

      // Rebote vertical
      if (y <= 0) { y = 0; dy = Math.abs(dy); bounced = true; }
      else if (y + H >= vh) { y = vh - H; dy = -Math.abs(dy); bounced = true; }

      if (bounced) nextPerfume();

      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';

      requestAnimationFrame(tick);
    }

    function start() {
      if (running) return;
      var slugs = getSlugs();
      if (slugs.length === 0) return;
      renderPerfume(currentIdx);
      running = true;
      requestAnimationFrame(tick);
    }

    // Easter egg cíclico: aparece cada 5 min, se queda visible 30 seg, se oculta
    var APPEAR_INTERVAL_MS = 5 * 60 * 1000; // 5 min entre apariciones
    var VISIBLE_DURATION_MS = 30 * 1000;    // 30 seg visible por ciclo

    function startCycle() {
      if (window.innerWidth < 768) return; // solo desktop
      var slugs = getSlugs();
      if (slugs.length === 0 || typeof PERFUMES === 'undefined' || PERFUMES.length === 0) return;

      // Resetear posición y dirección para que cada aparición sea fresca
      x = Math.random() * (window.innerWidth - W);
      y = Math.random() * (window.innerHeight - H);
      dx = (Math.random() > 0.5 ? 1 : -1) * speed;
      dy = (Math.random() > 0.5 ? 1 : -1) * speed;

      el.style.display = '';
      start();

      // Ocultar después del tiempo visible
      setTimeout(function() {
        running = false;
        el.style.display = 'none';
      }, VISIBLE_DURATION_MS);
    }

    // Primera aparición: a los 5 min (espera a que PERFUMES esté listo)
    setTimeout(function() {
      var attempts = 0;
      var tryStart = setInterval(function() {
        attempts++;
        if (getSlugs().length > 0 && typeof PERFUMES !== 'undefined' && PERFUMES.length > 0) {
          clearInterval(tryStart);
          startCycle();
          // Apariciones siguientes cada 5 min
          setInterval(startCycle, APPEAR_INTERVAL_MS);
        } else if (attempts >= 10) {
          clearInterval(tryStart);
        }
      }, 500);
    }, APPEAR_INTERVAL_MS);

    // Pausar si la pestaña no está visible (ahorrar CPU).
    // Al volver, solo re-activar el loop si el bouncer está actualmente visible
    // (sino queda esperando la próxima aparición cíclica).
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        running = false;
      } else if (getSlugs().length > 0 && el.style.display !== 'none') {
        running = true;
        requestAnimationFrame(tick);
      }
    });

    // Responder al resize
    window.addEventListener('resize', function() {
      if (window.innerWidth < 768) {
        running = false;
        el.style.display = 'none';
      } else if (!running && el.style.display !== 'none' && getSlugs().length > 0) {
        // Re-colocar dentro de los bounds si quedó visible
        x = Math.min(x, window.innerWidth - W);
        y = Math.min(y, window.innerHeight - H);
        running = true;
        requestAnimationFrame(tick);
      }
    });
  })();