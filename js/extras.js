// ============================================================
// [JS-CHUNK] js/extras.js — Funciones de "extras" cargadas lazy.
// ============================================================
// Este archivo se carga via loadExtras() (en app.js) — NO está en el
// HTML como <script> directo. Se descarga después de TTI (idle time)
// o on-demand cuando el cliente toca "Armá tu pack de decants".
//
// Comparte el global scope con app.js: usa PERFUMES, decantsPack,
// DECANTS_CUSTOM_LIST, DECANTS_CONFIG, sb, stripAccents, escapeHTML,
// getGamaFotos, updateDecantUI, addDecant, removeDecant, etc.
//
// IMPORTANTE: las funciones de este archivo SOBREESCRIBEN los stubs
// que app.js dejó como window.openDecantBuilder, etc.
// ============================================================

(function () {
  'use strict';

  // Marca que extras está cargado (lo consulta loadExtras() para no recargarlo)
  window.__extrasLoaded = true;

  // ─────────────────────────────────────────────────────────────
  // RENDER del grid de cards del armador de decants.
  // Particiona en 3 secciones: agregados al pack / especiales /
  // resto del catálogo A→Z. Maneja perfumes regulares + customs.
  // ─────────────────────────────────────────────────────────────
  function renderDecantGrid() {
    var gridEl = document.getElementById('decantGrid');
    if (!gridEl) return;
    var qInput = document.getElementById('decantSearch');
    var q = qInput ? qInput.value.trim().toLowerCase() : '';
    var qNorm = stripAccents(q);

    var list = PERFUMES.filter(function(p) {
      if (p.esSet || p._oculto) return false;
      if (!qNorm) return true;
      var hay = stripAccents([p.name, p.marca, p.marca_real||'', p.alias||'', (typeof getGamaAlias==='function'?getGamaAlias(p):'')].join(' ').toLowerCase());
      return hay.indexOf(qNorm) !== -1;
    });

    // Sort A → Z por nombre (defensivo: si name falta, va al final)
    list.sort(function(a, b) {
      var an = (a && a.name ? String(a.name) : '￿').toLowerCase();
      var bn = (b && b.name ? String(b.name) : '￿').toLowerCase();
      return an.localeCompare(bn);
    });

    // Filtrar custom por búsqueda también + sort A→Z
    var customFiltered = DECANTS_CUSTOM_LIST.filter(function(c) {
      if (!qNorm) return true;
      var hay = stripAccents(((c.nombre||'') + ' ' + (c.marca||'')).toLowerCase());
      return hay.indexOf(qNorm) !== -1;
    });
    customFiltered.sort(function(a, b) {
      var an = (a && a.nombre ? String(a.nombre) : '￿').toLowerCase();
      var bn = (b && b.nombre ? String(b.nombre) : '￿').toLowerCase();
      return an.localeCompare(bn);
    });

    // Contar qty por slug (para mostrar en cada card)
    var counts = {};
    decantsPack.forEach(function(s) { counts[s] = (counts[s]||0) + 1; });

    if (list.length === 0 && customFiltered.length === 0) {
      gridEl.innerHTML = '<p class="decant-grid-empty">Sin resultados para "' + q + '"</p>';
      return;
    }

    // Helper para HTML de un perfume regular
    function cardHTML(p) {
      var qty = counts[p.slug] || 0;
      var fotoSrc = p.foto ? p.foto.replace(/ /g, '%20') : '';
      if (!fotoSrc && typeof getGamaFotos === 'function') {
        var gama = getGamaFotos(p);
        if (gama.length > 0) fotoSrc = gama[0].replace(/ /g, '%20');
      }
      var img = fotoSrc
        ? '<img src="' + fotoSrc + '" alt="' + p.name + '" loading="lazy">'
        : '<div class="decant-card-img-ph">' + (p.name.charAt(0) || '•') + '</div>';
      return '<div class="decant-card' + (qty > 0 ? ' has-qty' : '') + '">'
        + '<div class="decant-card-img">' + img + '</div>'
        + '<div class="decant-card-info">'
          + '<p class="decant-card-name">' + p.name + '</p>'
          + '<p class="decant-card-brand">' + (p.marca_real || p.marca || '') + '</p>'
        + '</div>'
        + '<div class="decant-card-ctrl">'
          + '<button class="decant-ctrl-btn decant-ctrl-minus" onclick="removeDecant(\'' + p.slug + '\')"' + (qty === 0 ? ' disabled' : '') + ' aria-label="Quitar">−</button>'
          + '<span class="decant-ctrl-qty">' + qty + '</span>'
          + '<button class="decant-ctrl-btn decant-ctrl-plus" onclick="addDecant(\'' + p.slug + '\')" aria-label="Agregar">+</button>'
        + '</div>'
      + '</div>';
    }

    // Helper para HTML de un decant custom
    function customCardHTML(c) {
      var slug = 'custom-' + c.id;
      var qty = counts[slug] || 0;
      // Si tiene precio fijo, mostrarlo inline para que el cliente lo vea
      var priceTag = '';
      if (c.precio_unit != null && isFinite(parseFloat(c.precio_unit))) {
        priceTag = '<p class="decant-card-price">$' + Math.round(parseFloat(c.precio_unit)).toLocaleString('es-AR') + ' c/u</p>';
      }
      // Imagen: si tiene foto_url usa la imagen, sino el placeholder ⭐
      var hasFoto = !!(c.foto_url && (c.foto_url + '').trim());
      var imgHTML = hasFoto
        ? '<img src="' + escapeHTML(c.foto_url) + '" alt="' + escapeHTML(c.nombre) + '" loading="lazy" decoding="async">'
        : '<div class="decant-card-img-ph" style="background:rgba(232,184,0,.12);color:var(--amarillo);">★</div>';
      return '<div class="decant-card decant-card-custom' + (qty > 0 ? ' has-qty' : '') + '">'
        + '<div class="decant-card-img">' + imgHTML + '</div>'
        + '<div class="decant-card-info">'
          + '<p class="decant-card-name">' + escapeHTML(c.nombre) + '</p>'
          + '<p class="decant-card-brand">' + escapeHTML(c.marca || 'Especial') + '</p>'
          + priceTag
        + '</div>'
        + '<div class="decant-card-ctrl">'
          + '<button class="decant-ctrl-btn decant-ctrl-minus" onclick="removeDecant(\'' + slug + '\')"' + (qty === 0 ? ' disabled' : '') + ' aria-label="Quitar">−</button>'
          + '<span class="decant-ctrl-qty">' + qty + '</span>'
          + '<button class="decant-ctrl-btn decant-ctrl-plus" onclick="addDecant(\'' + slug + '\')" aria-label="Agregar">+</button>'
        + '</div>'
      + '</div>';
    }

    // Particionar: AGREGADOS arriba (qty > 0), resto abajo. Mantengo
    // sort alfabético dentro de cada grupo. Esto resuelve "los agregados
    // quedan al fondo" — ahora siempre los ves arriba para sumar/restar.
    var seleccionadosRegulares = list.filter(function(p) { return (counts[p.slug]||0) > 0; });
    var disponiblesRegulares   = list.filter(function(p) { return (counts[p.slug]||0) === 0; });
    var seleccionadosCustom    = customFiltered.filter(function(c) { return (counts['custom-' + c.id]||0) > 0; });
    var disponiblesCustom      = customFiltered.filter(function(c) { return (counts['custom-' + c.id]||0) === 0; });

    var seleccionadosCount = seleccionadosRegulares.length + seleccionadosCustom.length;
    var disponiblesCount   = disponiblesRegulares.length + disponiblesCustom.length;

    var html = '';
    // Sección 1 — AGREGADOS al pack (qty > 0)
    if (seleccionadosCount > 0) {
      html += '<p class="decant-grid-section-title">★ Agregados a tu pack (' + seleccionadosCount + ')</p>';
      html += seleccionadosRegulares.map(cardHTML).join('');
      html += seleccionadosCustom.map(customCardHTML).join('');
    }
    // Sección 2 — ESPECIALES (custom decants disponibles, "rompen" el
    // orden alfabético para que se vean primero — son los más rentables
    // y el jefe los quiere bien visibles)
    if (disponiblesCustom.length > 0) {
      html += '<p class="decant-grid-section-title">⭐ Especiales (' + disponiblesCustom.length + ')</p>';
      html += disponiblesCustom.map(customCardHTML).join('');
    }
    // Sección 3 — RESTO del catálogo (regulares A → Z)
    if (disponiblesRegulares.length > 0) {
      if (seleccionadosCount > 0 || disponiblesCustom.length > 0) {
        html += '<p class="decant-grid-section-title">Catálogo · A → Z (' + disponiblesRegulares.length + ')</p>';
      }
      html += disponiblesRegulares.map(cardHTML).join('');
    }

    gridEl.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────
  // Abrir el modal del armador.
  // ─────────────────────────────────────────────────────────────
  function openDecantBuilder() {
    updateDecantUI();
    renderDecantGrid();
    var overlay = document.getElementById('decantBuilderOverlay');
    if (overlay) {
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    // SEO/UX: actualizar URL para reflejar que se está armando un pack.
    try {
      var actual = window.location.pathname + window.location.search;
      if (actual.indexOf('/armar-pack-decants') === -1 && actual.indexOf('action=decants') === -1) {
        window.history.pushState({ decantBuilder: true }, '', '/armar-pack-decants');
      }
    } catch (e) { /* silent */ }
  }

  // ─────────────────────────────────────────────────────────────
  // Cerrar el modal del armador.
  // ─────────────────────────────────────────────────────────────
  function closeDecantBuilder() {
    var overlay = document.getElementById('decantBuilderOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
    // Limpiar la URL al cerrar
    try {
      if (window.history.state && window.history.state.decantBuilder) {
        window.history.back();
      } else if (window.location.pathname.indexOf('/armar-pack-decants') !== -1) {
        window.history.replaceState(null, '', '/');
      }
    } catch (e) { /* silent */ }
  }

  // popstate handler: cerrar el decant builder si el usuario hace back
  window.addEventListener('popstate', function(e) {
    var ov = document.getElementById('decantBuilderOverlay');
    if (ov && ov.classList.contains('active')) {
      if (window.location.pathname.indexOf('/armar-pack-decants') === -1
          && window.location.search.indexOf('action=decants') === -1) {
        ov.classList.remove('active');
        document.body.style.overflow = '';
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // [PACK-CHIVATO] Mensaje WhatsApp del pack — con defensa anti
  // slugs inválidos y emojis "los justos y necesarios".
  // ─────────────────────────────────────────────────────────────
  function sendDecantPackToWA() {
    // Defensa: filtrar slugs inválidos (null, undefined, empty strings)
    // que podrían colarse desde localStorage corrupto.
    var validPack = decantsPack.filter(function(s) {
      return s != null && typeof s === 'string' && s.trim().length > 0;
    });
    var qty = validPack.length;
    if (qty < 1) return;
    var counts = {};
    validPack.forEach(function(s) { counts[s] = (counts[s]||0) + 1; });

    // Separar customs con precio fijo de los regulares
    var fixedTotal = 0;
    var ladderCount = 0;
    validPack.forEach(function(s) {
      if (s.indexOf('custom-') === 0) {
        var cid = parseInt(s.replace('custom-', ''), 10);
        var c = DECANTS_CUSTOM_LIST.find(function(x) { return x.id === cid; });
        if (c && c.precio_unit != null && isFinite(parseFloat(c.precio_unit))) {
          fixedTotal += parseFloat(c.precio_unit);
          return;
        }
      }
      ladderCount++;
    });
    var unit = getDecantUnitPrice(ladderCount);
    var total = (ladderCount * unit) + fixedTotal;

    var lines = Object.keys(counts).map(function(slug) {
      var name, priceNote = '';
      if (slug.indexOf('custom-') === 0) {
        var cid = parseInt(slug.replace('custom-', ''), 10);
        var c = DECANTS_CUSTOM_LIST.find(function(x) { return x.id === cid; });
        name = c ? (c.nombre + (c.marca ? ' (' + c.marca + ')' : '') + ' ⭐') : slug;
        if (c && c.precio_unit != null && isFinite(parseFloat(c.precio_unit))) {
          priceNote = ' — $' + Math.round(parseFloat(c.precio_unit)).toLocaleString('es-AR') + ' c/u';
        }
      } else {
        var p = PERFUMES.find(function(x) { return x.slug === slug; });
        name = p ? p.name : slug;
      }
      var n = counts[slug];
      return '• ' + name + (n > 1 ? ' (x' + n + ')' : '') + priceNote;
    });

    var resumen;
    if (fixedTotal > 0 && ladderCount > 0) {
      resumen = '💰 ' + ladderCount + ' x $' + unit.toLocaleString('es-AR') + ' + especiales = *$' + Math.round(total).toLocaleString('es-AR') + '*';
    } else if (fixedTotal > 0 && ladderCount === 0) {
      resumen = '💰 Total: *$' + Math.round(total).toLocaleString('es-AR') + '*';
    } else {
      resumen = '💰 ' + qty + ' x $' + unit.toLocaleString('es-AR') + ' = *$' + Math.round(total).toLocaleString('es-AR') + '*';
    }
    var msg = 'Hola! 👋 Quiero armar un pack de ' + qty + ' decants de ' + DECANTS_CONFIG.ml + 'ml 🧪\n\n'
      + lines.join('\n') + '\n\n'
      + resumen + '\n\n'
      + '¿Confirmás stock? 🙏';
    var url = 'https://wa.me/5492975416017?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
  }

  // Exponer al global scope (sobreescribe los stubs de app.js).
  window.renderDecantGrid = renderDecantGrid;
  window.openDecantBuilder = openDecantBuilder;
  window.closeDecantBuilder = closeDecantBuilder;
  window.sendDecantPackToWA = sendDecantPackToWA;

  // Si hay alguna llamada pendiente al stub (ej el usuario tapeó "Armá tu pack"
  // antes de que extras terminara de cargar), el stub disparó loadExtras y
  // queda esperando. La función real ya está disponible — no hace falta
  // re-tappear el botón, pero el stub no tiene mecanismo de "callback".
  // Por simplicidad, si openDecantBuilder fue llamado MIENTRAS cargaba extras,
  // el stub ya delegó vía load.then(real()).
})();
