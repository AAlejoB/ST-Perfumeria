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
//
// [DECANTS-UX-2] Sesión may-2026 agregó:
//   - Tab switcher Catálogo / Mis decants (#4)
//   - Combo sugerido sticky "Combinás bien con: X" (#6) con algoritmo
//     de scoring basado en marca_real + perfil + notas + cat.
// ============================================================

(function () {
  'use strict';

  // Marca que extras está cargado (lo consulta loadExtras() para no recargarlo)
  window.__extrasLoaded = true;

  // [DECANTS-UX-2 #4] Tab activa del armador. 'catalogo' = ver todo;
  // 'mis' = ver solo los que el cliente agregó.
  var decantActiveTab = 'catalogo';

  // ─────────────────────────────────────────────────────────────
  // [DECANTS-UX-2 #4] Cambiar de tab (Catálogo / Mis decants).
  // Si el pack está vacío, "Mis decants" queda disabled — el handler
  // del onclick no debería dispararse, pero por seguridad lo validamos.
  // ─────────────────────────────────────────────────────────────
  function switchDecantTab(tab) {
    if (tab !== 'catalogo' && tab !== 'mis') return;
    if (tab === 'mis' && decantsPack.length === 0) return;  // safety net
    if (decantActiveTab === tab) return;
    decantActiveTab = tab;
    renderDecantGrid();
    // Scroll arriba para que el cliente vea el cambio inmediato.
    var gridEl = document.getElementById('decantGrid');
    if (gridEl) gridEl.scrollTop = 0;
  }

  // ─────────────────────────────────────────────────────────────
  // [DECANTS-UX-2 #6] Algoritmo "Combinás bien con: X".
  // Toma el ÚLTIMO decant del pack como anchor (el más reciente
  // representa mejor el "estado de ánimo" del cliente) y scorea
  // candidatos del catálogo.
  //
  //   Scoring:
  //     +3 si misma marca_real (estilo de la casa)
  //     +2 si mismo perfil (Intenso, Versátil, etc.)
  //     +1 por cada nota olfativa común (máx +5)
  //     +1 si misma categoría (Unisex/Hombre/Mujer)
  //
  // Umbral mínimo: score ≥ 2 para evitar matches débiles.
  // Devuelve { perfume, reason } o null si no hay match.
  // ─────────────────────────────────────────────────────────────
  function findCombinaBienCon() {
    // Necesitamos al menos 1 decant en el pack (que no sea custom).
    if (!Array.isArray(decantsPack) || decantsPack.length === 0) return null;

    // Buscar el último slug VÁLIDO no-custom del pack como anchor.
    var anchor = null;
    for (var i = decantsPack.length - 1; i >= 0; i--) {
      var s = decantsPack[i];
      if (!s || typeof s !== 'string') continue;
      if (s.indexOf('custom-') === 0) continue;
      anchor = PERFUMES.find(function(p) { return p.slug === s; });
      if (anchor) break;
    }
    if (!anchor) return null;

    // Conjunto de slugs ya en el pack (para excluir candidatos repetidos).
    var inPack = {};
    decantsPack.forEach(function(s) { if (s) inPack[s] = true; });

    // Helper: parsear notas (strings comma-separated) a array normalizado.
    function parseNotas(p) {
      var raw = [p.notas_salida, p.notas_corazon, p.notas_base].filter(Boolean).join(',');
      return raw.split(',').map(function(n) { return n.trim().toLowerCase(); }).filter(Boolean);
    }
    var anchorNotas = parseNotas(anchor);

    var best = null;
    var bestScore = 0;
    var bestCommon = [];

    PERFUMES.forEach(function(p) {
      if (!p || !p.slug) return;
      if (p.slug === anchor.slug) return;
      if (inPack[p.slug]) return;
      if (p.esSet || p._oculto || p._pausado) return;

      var score = 0;
      if (p.marca_real && anchor.marca_real && p.marca_real === anchor.marca_real) score += 3;
      if (p.perfil && anchor.perfil && p.perfil === anchor.perfil) score += 2;
      if (p.cat && anchor.cat && p.cat === anchor.cat) score += 1;

      var pNotas = parseNotas(p);
      var common = [];
      pNotas.forEach(function(n) {
        if (anchorNotas.indexOf(n) !== -1 && common.indexOf(n) === -1) common.push(n);
      });
      score += Math.min(common.length, 5);

      if (score > bestScore) {
        bestScore = score;
        best = p;
        bestCommon = common;
      }
    });

    if (!best || bestScore < 2) return null;

    // Generar razón humana corta para mostrar al cliente.
    var reason;
    if (best.marca_real && best.marca_real === anchor.marca_real) {
      reason = 'Misma casa · ' + best.marca_real;
    } else if (bestCommon.length >= 2) {
      reason = 'Notas: ' + bestCommon.slice(0, 2).join(', ');
    } else if (bestCommon.length === 1) {
      reason = 'Nota en común: ' + bestCommon[0];
    } else if (best.perfil && best.perfil === anchor.perfil) {
      reason = 'Perfil ' + best.perfil.toLowerCase();
    } else {
      reason = 'Te puede gustar';
    }

    return { perfume: best, reason: reason };
  }

  // ─────────────────────────────────────────────────────────────
  // [DECANTS-UX-2] Actualizar header del armador: badges de los
  // tabs (counts) + combo sticky (mostrar/ocultar/contenido).
  // Llamada al final de renderDecantGrid() para mantener sync.
  // ─────────────────────────────────────────────────────────────
  function updateDecantHeader() {
    var packCount = decantsPack.length;
    // Total de items "del catálogo regular" — el número del badge debería
    // reflejar lo que el cliente ve si toca "Catálogo". Customs especiales
    // los contamos también porque aparecen en esa tab.
    var totalCatalog = PERFUMES.filter(function(p) { return !p.esSet && !p._oculto && !p._pausado; }).length
                     + (Array.isArray(DECANTS_CUSTOM_LIST) ? DECANTS_CUSTOM_LIST.length : 0);

    // ─── Tabs ─────────────────────────────────────────────────
    var catBadge = document.getElementById('decantTabCatBadge');
    var misBadge = document.getElementById('decantTabMisBadge');
    if (catBadge) catBadge.textContent = totalCatalog;
    if (misBadge) misBadge.textContent = packCount;

    var tabs = document.querySelectorAll('.decant-tab');
    tabs.forEach(function(t) {
      var name = t.getAttribute('data-tab');
      var active = (name === decantActiveTab);
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      // Disable "Mis decants" si pack vacío para evitar tab vacía.
      if (name === 'mis') t.disabled = (packCount === 0);
    });

    // ─── Combo sticky ─────────────────────────────────────────
    // Solo mostrar si:
    //  - Hay al menos 1 decant en el pack (anchor para el algoritmo)
    //  - El cliente está en tab "Catálogo" (en "Mis decants" no tiene
    //    sentido sugerir agregar más)
    //  - Hay margen para sumar (< max_decants)
    var sticky = document.getElementById('decantComboSticky');
    if (!sticky) return;
    var maxReached = (typeof DECANTS_CONFIG !== 'undefined' && DECANTS_CONFIG && packCount >= DECANTS_CONFIG.max_decants);
    var shouldShow = (packCount >= 1) && (decantActiveTab === 'catalogo') && !maxReached;
    if (!shouldShow) {
      sticky.hidden = true;
      sticky.removeAttribute('data-combo-slug');
      return;
    }
    var combo = findCombinaBienCon();
    if (!combo) {
      sticky.hidden = true;
      sticky.removeAttribute('data-combo-slug');
      return;
    }
    var nameEl = document.getElementById('decantComboName');
    if (nameEl) {
      var marca = combo.perfume.marca_real || combo.perfume.marca || '';
      nameEl.innerHTML = escapeHTML(combo.perfume.name)
        + (marca ? ' <span class="decant-combo-reason">· ' + escapeHTML(combo.reason) + '</span>' : '');
    }
    sticky.setAttribute('data-combo-slug', combo.perfume.slug);
    sticky.hidden = false;
  }

  // ─────────────────────────────────────────────────────────────
  // [DECANTS-UX-2 #6] Handler del botón "+ Sumar" del combo sticky.
  // Lee el slug guardado en data-combo-slug y llama addDecant().
  // ─────────────────────────────────────────────────────────────
  function addDecantCombo() {
    var sticky = document.getElementById('decantComboSticky');
    if (!sticky) return;
    var slug = sticky.getAttribute('data-combo-slug');
    if (!slug) return;
    addDecant(slug);
    // addDecant() ya re-renderea el grid → updateDecantHeader() recalcula
    // el siguiente sugerido o oculta el sticky si no hay más matches.
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER del grid de cards del armador de decants.
  // [DECANTS-UX-2 #4] Ahora filtra según decantActiveTab:
  //   - 'catalogo': vista completa (Agregados / Especiales / A→Z)
  //   - 'mis':      solo los que están en el pack (qty > 0)
  // ─────────────────────────────────────────────────────────────
  function renderDecantGrid() {
    var gridEl = document.getElementById('decantGrid');
    if (!gridEl) return;
    // [DECANTS-UX-2 #4] Auto-switch a Catálogo si estamos en "Mis decants"
    // y el pack quedó vacío (ej. el cliente eliminó su último decant).
    // Evita el flash de "Mis decants vacío" — pasamos directo al catálogo.
    if (decantActiveTab === 'mis' && decantsPack.length === 0) {
      decantActiveTab = 'catalogo';
    }
    var qInput = document.getElementById('decantSearch');
    var q = qInput ? qInput.value.trim().toLowerCase() : '';
    var qNorm = stripAccents(q);

    // [DECANT-DEDUP] Nombres normalizados de los decants de diseñador activos.
    // El perfume ya cargado en `decants_custom` con su precio real NO debe volver
    // a aparecer en el catálogo A→Z con la escalera genérica: eran dos cards del
    // mismo perfume y el cliente se llevaba la barata.
    var customNames = (typeof decantCustomNombres === 'function') ? decantCustomNombres() : {};
    var normName = (typeof decantNombreNorm === 'function') ? decantNombreNorm : function(s){ return s; };

    var list = PERFUMES.filter(function(p) {
      if (p.esSet || p._oculto || p._pausado) return false;
      // [DECANT-PRECIO-MANUAL] Marcado "No ofrecer en decants" desde el admin.
      if (typeof decantExcluido === 'function' && decantExcluido(p)) return false;
      if (customNames[normName(p.name)]) return false;   // ya existe como decant de diseñador
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

    // Particionar por estado: seleccionados (qty > 0) vs disponibles.
    var seleccionadosRegulares = list.filter(function(p) { return (counts[p.slug]||0) > 0; });
    var disponiblesRegulares   = list.filter(function(p) { return (counts[p.slug]||0) === 0; });
    var seleccionadosCustom    = customFiltered.filter(function(c) { return (counts['custom-' + c.id]||0) > 0; });
    var disponiblesCustom      = customFiltered.filter(function(c) { return (counts['custom-' + c.id]||0) === 0; });

    var seleccionadosCount = seleccionadosRegulares.length + seleccionadosCustom.length;
    var disponiblesCount   = disponiblesRegulares.length + disponiblesCustom.length;

    // [DECANTS-UX-2 fix scroll] El empty hero (#decantEmptyHero) vive ADENTRO
    // del grid (movido en HTML para que scrollee junto con las cards).
    // Antes de re-escribir innerHTML lo "rescatamos" para no perder su
    // estado interno (los quickpicks que app.js renderizó vía Supabase).
    var heroEl = document.getElementById('decantEmptyHero');
    function rebuildGrid(html) {
      gridEl.innerHTML = html;
      if (heroEl) gridEl.insertBefore(heroEl, gridEl.firstChild);
    }

    // [DECANTS-UX-2 #4] Early return para tab "Mis decants" vacía.
    if (decantActiveTab === 'mis' && seleccionadosCount === 0) {
      rebuildGrid(
        '<div class="decant-mis-empty">'
          + '<div class="decant-mis-empty-ico">📭</div>'
          + 'Todavía no agregaste ningún decant.<br>'
          + 'Cambiá a <strong>Catálogo</strong> y armá tu pack ✨'
          + '<br><button type="button" class="decant-mis-empty-cta" onclick="switchDecantTab(\'catalogo\')">→ Ir al Catálogo</button>'
        + '</div>'
      );
      updateDecantHeader();
      return;
    }

    // Empty state común (sin resultados de búsqueda en Catálogo).
    if (list.length === 0 && customFiltered.length === 0) {
      rebuildGrid('<p class="decant-grid-empty">Sin resultados para "' + escapeHTML(q) + '"</p>');
      updateDecantHeader();
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

      // [DECANT-TOPE] Perfume cuyo frasco supera el tope: a este precio el decant
      // saldría bajo costo. No se puede sumar al pack — se cotiza por WhatsApp.
      var aConsultar = (typeof decantAConsultar === 'function') && decantAConsultar(p);
      if (aConsultar) {
        return '<div class="decant-card decant-card-consultar">'
          + '<div class="decant-card-img">' + img + '</div>'
          + '<div class="decant-card-info">'
            + '<p class="decant-card-name">' + p.name + '</p>'
            + '<p class="decant-card-brand">' + (p.marca_real || p.marca || '') + '</p>'
            + '<p class="decant-card-price decant-card-price-pending">💬 Precio a consultar</p>'
          + '</div>'
          + '<div class="decant-card-ctrl">'
            + '<button class="decant-ctrl-btn decant-ctrl-consultar" onclick="consultarDecantWA(\'' + p.slug + '\')" title="Consultar por WhatsApp" aria-label="Consultar precio por WhatsApp">Consultar</button>'
          + '</div>'
        + '</div>';
      }

      // [DECANT-PRECIO-MANUAL] Si el empleado le cargó precio de decant, lo
      // mostramos en la card (como los de diseñador) en vez de la escalera.
      var manual = (typeof decantPrecioManual === 'function') ? decantPrecioManual(p) : 0;
      var precioTag = manual > 0
        ? '<p class="decant-card-price">$' + Math.round(manual).toLocaleString('es-AR') + ' c/u</p>'
        : '';

      return '<div class="decant-card' + (qty > 0 ? ' has-qty' : '') + '">'
        + '<div class="decant-card-img">' + img + '</div>'
        + '<div class="decant-card-info">'
          + '<p class="decant-card-name">' + p.name + '</p>'
          + '<p class="decant-card-brand">' + (p.marca_real || p.marca || '') + '</p>'
          + precioTag
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
      // [DC-PRECIO-GUARD] Defensa contra "decant de diseñador sin precio
      // cargado mostrándose con la escalera regular ($9500)". Si el admin
      // todavía no cargó precio_unit, NO permitimos agregar al pack: la
      // card se muestra con badge "Precio pendiente" + botón "+" deshabilitado.
      // Apenas el admin carga el precio, el cliente puede sumarlo.
      var hasPrecio = (c.precio_unit != null && isFinite(parseFloat(c.precio_unit)) && parseFloat(c.precio_unit) > 0);
      var priceTag = '';
      if (hasPrecio) {
        priceTag = '<p class="decant-card-price">$' + Math.round(parseFloat(c.precio_unit)).toLocaleString('es-AR') + ' c/u</p>';
      } else {
        priceTag = '<p class="decant-card-price decant-card-price-pending">⏳ Precio pendiente</p>';
      }
      // Imagen: si tiene foto_url usa la imagen, sino el placeholder ⭐
      var hasFoto = !!(c.foto_url && (c.foto_url + '').trim());
      var imgHTML = hasFoto
        ? '<img src="' + escapeHTML(c.foto_url) + '" alt="' + escapeHTML(c.nombre) + '" loading="lazy" decoding="async">'
        : '<div class="decant-card-img-ph" style="background:rgba(232,184,0,.12);color:var(--amarillo);">★</div>';
      // Botón "+" deshabilitado si todavía no hay precio cargado
      var plusDisabled = hasPrecio ? '' : ' disabled title="El admin todavía está cargando el precio de este perfume"';
      var pendingClass = hasPrecio ? '' : ' is-precio-pendiente';
      return '<div class="decant-card decant-card-custom' + pendingClass + (qty > 0 ? ' has-qty' : '') + '">'
        + '<div class="decant-card-img">' + imgHTML + '</div>'
        + '<div class="decant-card-info">'
          + '<p class="decant-card-name">' + escapeHTML(c.nombre) + '</p>'
          + '<p class="decant-card-brand">' + escapeHTML(c.marca || 'De diseñador') + '</p>'
          + priceTag
        + '</div>'
        + '<div class="decant-card-ctrl">'
          + '<button class="decant-ctrl-btn decant-ctrl-minus" onclick="removeDecant(\'' + slug + '\')"' + (qty === 0 ? ' disabled' : '') + ' aria-label="Quitar">−</button>'
          + '<span class="decant-ctrl-qty">' + qty + '</span>'
          + '<button class="decant-ctrl-btn decant-ctrl-plus" onclick="addDecant(\'' + slug + '\')"' + plusDisabled + ' aria-label="Agregar">+</button>'
        + '</div>'
      + '</div>';
    }

    var html = '';

    if (decantActiveTab === 'mis') {
      // [DECANTS-UX-2 #4] Vista "Mis decants": SOLO los seleccionados.
      // No mostramos sección title (es obvio que son los del pack).
      html += seleccionadosRegulares.map(cardHTML).join('');
      html += seleccionadosCustom.map(customCardHTML).join('');
    } else {
      // Vista "Catálogo" (comportamiento original).
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
        html += '<p class="decant-grid-section-title">💎 Decants de diseñador (' + disponiblesCustom.length + ')</p>';
        html += disponiblesCustom.map(customCardHTML).join('');
      }
      // Sección 3 — RESTO del catálogo (regulares A → Z)
      if (disponiblesRegulares.length > 0) {
        if (seleccionadosCount > 0 || disponiblesCustom.length > 0) {
          html += '<p class="decant-grid-section-title">Catálogo · A → Z (' + disponiblesRegulares.length + ')</p>';
        }
        html += disponiblesRegulares.map(cardHTML).join('');
      }
    }

    rebuildGrid(html);

    // [DECANTS-UX-2] Refrescar tab badges + combo sticky en cada render.
    // Esto se ejecuta también cuando addDecant/removeDecant llaman a
    // renderDecantGrid() — así el header queda sync con el pack.
    updateDecantHeader();
  }

  // ─────────────────────────────────────────────────────────────
  // Abrir el modal del armador.
  // ─────────────────────────────────────────────────────────────
  function openDecantBuilder() {
    // [DECANTS-UX-2] Resetear tab activa al abrir — siempre arrancamos
    // en "Catálogo" para mostrar todo el inventario.
    decantActiveTab = 'catalogo';
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
      resumen = '💰 ' + ladderCount + ' x $' + unit.toLocaleString('es-AR') + ' + de diseñador = *$' + Math.round(total).toLocaleString('es-AR') + '*';
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
  // [DECANTS-UX-2] Nuevas funciones expuestas para los onclick del HTML.
  window.switchDecantTab = switchDecantTab;
  window.addDecantCombo = addDecantCombo;

})();
