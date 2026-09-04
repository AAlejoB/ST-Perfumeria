# FRONTEND — ST Perfumería

> Todo lo relacionado a la interfaz del usuario: HTML, CSS, JS del cliente,
> UX, performance del primer paint, light/dark mode, layout, accesibilidad.
>
> Si tu pregunta es "cómo se ve X" o "por qué pasa este bug visual", está acá.
> Para realtime / Supabase / Service Worker → `BACKEND.md`.
> Para tablas / migraciones / RLS → `DATABASE.md`.

---

## 🧱 Archivos del front

| Archivo | Función | Tamaño aprox |
|---|---|---|
| `index.html` | Página pública del catálogo | ~1500 líneas |
| `admin.html` | Panel admin (jefe + empleados) | ~8000 líneas |
| `offline.html` | Fallback cuando no hay red | corto |
| `js/app.js` | Todo el JS del front público | ~6000 líneas |
| `js/perfumes.js` | Array seed de los ~150 perfumes | ~5000 líneas |
| `css/styles.css` | TODO el CSS (incluye light mode) | ~6700 líneas |

⚠️ Son **monolitos grandes**. Para editar: Grep + Read primero, NO rewrites masivos. Cada edición es quirúrgica.

---

## 🎨 Sistema de colores y temas

### Default: dark mode

`<body class="dark-mode">` es el estado por defecto. Toggle vía botón en nav.

### Light mode

Activado removiendo la clase `dark-mode`. Reglas en CSS:

```css
body:not(.dark-mode) {
  --negro:        #e3d6b3;   /* fondo principal — beige cálido (no blanco tiza) */
  --negro-card:   #ede2c2;   /* cards */
  --negro-hover:  #d8caa3;
  --blanco:       #1a1a1d;   /* texto principal */
  --gris:         #5e564a;
  --gris-claro:   #2a2622;
  --borde:        rgba(120,90,0,.28);
  --borde-sutil:  rgba(0,0,0,.06);
  background: #e3d6b3;
  color: #1a1a1d;
}
```

**Acento dorado-marrón consistente:** `#8a6d00` para eyebrows / labels / dorado oscuro en light.

### Excepciones que SE MANTIENEN OSCURAS en light (decisión del jefe)

- Trust badges (los 4 cuadros: 10% off / sumá puntos / retiro / cuotas)
- Banner amarillo "EXPLORÁ NUESTRO CATÁLOGO"
- Banner contextual "Tenés X puntos"
- Cards de "Categorías"

Si agregás una sección nueva, hacé un override `body:not(.dark-mode) .tu-clase {...}`. Si usás las CSS variables (`var(--negro)`, etc.) en lugar de hex hardcoded, se adapta solo.

### Tip de oro

**NUNCA hex hardcoded** en componentes. Usá las variables. Si necesitás un color nuevo, agregá una variable a `:root` y a `body:not(.dark-mode)`.

---

## 📐 Layout y responsive

### Catálogo

- **Mobile** (default): 1 columna.
- **Desktop ≥1024px**: 2 columnas (`grid-template-columns: repeat(2, 1fr)`).
- **NO usar 3 o 4 columnas** — quedaba feo, las cards muy angostas y la foto con bandas vacías arriba/abajo.

Si hay solo **1 card visible** (filtros que dejan 1 resultado): clase `.catalog-grid--single` que centra con `max-width: 560px`. Aplicada por JS post-filtro.

### Filter bar

- **Mobile**: `position: sticky; top: 58px` (debajo del nav).
- **Desktop**: `position: static`. **NO sticky** — quedaba flotando sobre Tu Sector como un "navbar fantasma" al scrollear.

### Filter deck (mobile)

Patrón "mazo de cards" en mobile:
- Los 6 botones (`Todos / Unisex / Hombre / Mujer / 🔥 Nuevos / ❤`) apilados con `position: absolute`.
- **Cerrado**: solo se ve el `.active` (otros con `opacity: 0`).
- **Abierto**: clase `.deck-open` los despliega verticalmente con bg sólido para que no haya bleed-through.
- Tap fuera cierra.

### Cards del catálogo

Layout horizontal: **info izquierda + imagen derecha** (o invertido con `.mirror`).

**Backdrop blur** en cada `.card-gallery-slide`:
```css
.card-gallery-slide {
  background-image: url(...);   /* misma foto del producto */
  background-size: cover;
}
.card-gallery-slide::before {
  background: inherit;
  filter: blur(28px) saturate(1.3) brightness(.75);
}
```

Esto llena el espacio cuando la botella es alta y angosta (object-fit:contain dejaba bandas grises). Inspirado en Apple Music.

---

## 🚀 Performance (lecciones aprendidas)

### Path crítico vs deferido

```js
// helper en app.js
function deferTask(fn, opts) { /* requestIdleCallback post-load */ }
function onDeferred(fn) { /* DOMContentLoaded + deferTask */ }
```

**Críticos** (corren eager):
- `loadHomeTopBanner` (above-the-fold, fallback inline)
- `loadPerfumesNuevos + loadOverrides` (catálogo principal)

**Diferidos** (post-paint):
- `loadHomeSlides` (descontinuado pero queda la función)
- `loadTrustBadges` (tiene fallback constants)
- `loadDestacadosFromDB`
- `loadAnnouncement`
- `loadCombosFromDB`
- `renderPuntosBanner`
- `loadDecantsCustomForArmador`
- `loadVotacionFromDB`
- `checkStoreStatus`
- `loadPerfumeViews` (stats no críticas)

**Por qué:** sin esto, en 4G mobile real disparábamos 8+ queries Supabase en paralelo al DOMContentLoaded → TTI de 4-6s. Con defer baja ~1.5-3s.

### Imágenes

- Slide #0 (above-the-fold): `fetchpriority="high"` + sin `loading`
- Resto: `loading="lazy"` + `decoding="async"`
- TODAS con `width` y `height` explícitos para evitar CLS (Cumulative Layout Shift)

### Slider eliminado

El slider de la home fue **descontinuado** (`<section class="home-slider-section">` removido). Razones:
- Estaba above-the-fold con `loading="lazy"` (mal)
- Agregaba 1 query Supabase
- El jefe prefirió el banner amarillo grande "EXPLORÁ +150 PERFUMES" como CTA principal

La función `loadHomeSlides` queda en `app.js` por si se reactiva (no se invoca).

---

## 🎭 Modales

Convención del proyecto:

```html
<div class="modal-overlay" id="modalX">
  <div class="modal-box">
    <button class="modal-close" onclick="closeModal('modalX')">&times;</button>
    <p class="modal-title">...</p>
    <input class="modal-input" .../>
    <button class="modal-btn" onclick="saveX()">✓ OK</button>
  </div>
</div>
```

**Abrir:** `el.classList.add('active')` (¡NO `'open'`! — error común).
**Cerrar:** `closeModal('modalX')` o click en overlay.

Modales que ya existen: `modalPrice`, `modalStock`, `modalAuth`, `modalEditPerfume`, `modalPuntos`, `modalClientPuntosLog`, `modalSimilares`, `modalCompare`, etc.

---

## 🛒 Decant builder

Modal full-screen con grid de cards (cada card = 1 perfume).

**Layout:**
- Sección "★ Agregados a tu pack" arriba (perfumes con qty > 0)
- Sección "Resto del catálogo" abajo
- Cada sección con **sort A→Z alfabético estable**

**Lógica:**
- Click en `+` agrega → el perfume salta al grupo de "Agregados"
- Click en `-` saca → vuelve a su posición alfabética en "Resto"
- Botón "−" GLOBAL junto al total (LIFO: quita el último agregado)
- Total dinámico según escalera de precio (1-2 / 3-4 / 5+ unidades)

**Función clave:** `renderDecantGrid()` en `app.js`.

### ⚠️ El presupuesto de alto · `[DECANTS-ESPACIO]` (12-ago-2026)

El modal es una **columna flex con 4 bloques que NO se encogen** y uno que sí:

```
.decant-builder  (max-height 92vh → 96vh en pantallas bajas)
├── header               flex-shrink: 0   ← crece al agregar items
├── buscador             flex-shrink: 0
├── grid (el listado)    flex: 1 · overflow-y: auto   ← el único que cede
├── combo sticky         flex-shrink: 0   ← aparece al agregar items
└── footer               flex-shrink: 0   ← engorda de 89 a 159 px con items
```

**Regla:** cada vez que agregues algo al header, al footer o al sticky, **le estás sacando espacio al listado**. En un celular de 640 px de alto, el marco fijo llegó a comerse el **67%** del modal y dejó **una sola card visible** — un cliente real no pudo terminar su compra.

**Cómo verificarlo (no a ojo):** abrir el armador en el sitio, agregar 1 decant y medir `header + buscador + footer` contra el alto del modal. Si el listado queda por debajo de ~280 px, hay que recortar el marco.

### 🔁 Volvió a pasar · `[DECANTS-ESPACIO-2]` (2-sep-2026)

El fix de agosto dejó el listado en 299 px. Después se sumaron **dos bloques fijos más**: la barra de progreso (62 px) y la sugerencia "combinás bien con" (49 px). Medido de nuevo a **375×667 con 1 decant**: marco 433 px = **68%**, listado **181 px, DOS cards**. Volvimos al punto de partida.

Se achicaron los dos (no se sacó ninguna feature) + cabecera, contador y pie. Resultado medido:

| Pantalla | Listado antes | Listado ahora | Cards |
|---|---|---|---|
| 375×667 | 181 px | **262 px** | 2 → **3** |
| 375×812 | 318 px | **400 px** | 3 → **4** |
| 1280×800 | — | 396 px | **4** · todo visible |

⚠️ **Dónde va el CSS importa.** El primer intento fue meter los recortes dentro del `@media (max-height:900px)` de arriba y **no aplicó nada**. Una media query NO suma especificidad: con la misma specificity gana la regla que aparece **después** en el archivo, y `.decant-progress-tiers`, `.decant-builder-title` y el `@media (max-width:480px)` del combo están todos más abajo. El bloque de agosto funcionaba porque usaba `display:none` sobre elementos cuyo CSS base no declara `display` — no competía con nadie. **Los recortes nuevos van al final de la sección de decants.**

📌 El umbral de 280 px es un proxy: lo que importa es **cuántas cards ve el cliente**. 262 px no llega a 280 pero ya muestra 3, que era el objetivo.

### 🗄️ El cajón · `[DECANTS-CAJON]` (2-sep-2026) — opción C

`[DECANTS-ESPACIO]` (ago) y `[DECANTS-ESPACIO-2]` (sep) fueron **el mismo parche dos veces**: recortar el marco para devolverle aire al listado. Iba a pasar una tercera. La causa no era el tamaño de cada bloque, era que **cada feature nueva se apilaba arriba del listado**.

Ahora la lista es la pantalla y todo lo demás (contador, ahorro, progreso, escalera y la sugerencia) vive en un **cajón** al pie que se abre de un toque. El armador pasa a **pantalla completa** en celular (`100dvh`, sin bordes redondeados ni el tope de 92vh).

| | Listado | Cards |
|---|---|---|
| Antes de todo (ago) | 181 px | 2 |
| Con `[DECANTS-ESPACIO-2]` | 262 px | 3 |
| **Con el cajón, cerrado** | **390 px** | **4** |
| Con el cajón, abierto | 302 px | 3 |
| Desktop 1280×800 | 434 px | 4 |

**Lo importante: el marco ya no puede volver a crecer.** Lo que se agregue va adentro del cajón, no encima del listado.

**Markup:** el contador, el ahorro, el progreso y la escalera se movieron del `.decant-builder-header` al `.decant-builder-footer`, dentro de `#decantSheetBody`. En desktop el cuerpo está siempre abierto y la manija (`.decant-sheet-handle`) no existe — el único cambio visible allá es que esos bloques quedaron abajo, al lado del total y del botón de WhatsApp.

⚠️ **El colapso usa `display`, no `max-height`.** Se intentó con `max-height` y **no funcionó**: con `.sheet-open` puesta y el selector matcheando, el computed seguía dando `0px` — incluso poniéndole al elemento un `max-height` inline con `!important`, que debería ganarle a todo. No se encontró la causa. `display` anda y es verificable; el precio es que el cajón abre de una, sin deslizarse. Si se quiere la animación, primero hay que entender eso.

📌 El total salía **duplicado** al abrir el cajón (una vez en el contador, otra en el resumen del pie, que quedaron pegados). El resumen ahora se oculta cuando el cajón está abierto — y en desktop siempre, porque allá el cajón nunca se cierra.

**Mito a no repetir:** `min-height: 0` en el grid **NO es el fix**. Un flex item con `overflow` distinto de `visible` ya tiene mínimo automático 0 por especificación. Se probó con un A/B y dio idéntico. El fix es **achicar el marco fijo**, no redistribuir.

**Breakpoints por alto:** usar `max-height: 900px`, no 800. La **PWA instalada no tiene barra de direcciones** y gana ~90 px: un iPhone que en el navegador da ~750 de alto, instalado da 844. Con el corte en 800, los clientes que instalaron la app se quedan sin el arreglo.

---

## 🔍 Search bar

En mobile el search del nav está **oculto** (`.nav-search { display: none }` en media query). Solo el del filter-bar.

En desktop ambos visibles. Hay dos elementos con `id="searchInput"`: uno en nav (`navSearchInput`) y otro en filter-bar (`searchInput`).

---

## 🏷️ Sort del catálogo

`renderCatalog()` SIEMPRE termina con `sortCards('price-desc')`. **No remover.**

```js
function renderCatalog() {
  // ... rendering ...
  try { sortCards('price-desc'); } catch(e) {}
}
```

Antes solo se ordenaba al cargar inicial; si renderCatalog se re-invocaba (login, sync favs, override), el orden volvía al de inserción de PERFUMES y quedaba inconsistente.

---

## 📋 NO ROMPER (lecciones específicas de front)

1. **Filter-bar NO sticky en desktop** (causaba navbar fantasma sobre Tu Sector).
2. **Slider eliminado** — no reactivar sin pedido explícito.
3. **`renderCatalog()` siempre termina con `sortCards('price-desc')`**.
4. **Categorías y trust badges quedan oscuros también en light** (decisión del jefe).
5. **Modal: usar `.classList.add('active')`** (no `'open'`).
6. **CSS variables siempre** — nunca hex hardcoded en components.
7. **Catálogo a 2 columnas en desktop** (no 3 ni 4).

---

## 🐛 Bugs históricos del front

### Light mode incompleto (la tía del jefe)
Síntoma: muchos textos invisibles en light + mobile.
Causa: ~50 textos con `#999`/`#888`/`#777`/`rgba(255,255,255,...)` hardcoded.
Fix: parche masivo `body:not(.dark-mode)` con override por elemento.
Lección: **CSS variables desde día 1**.

### Card de favoritos sola en desktop
Síntoma: con 1 favorito, la card queda chiquita pegada a la izquierda con espacio vacío.
Causa: `:only-child` no matcheaba porque las cards filtradas están `display:none` pero siguen siendo children.
Fix: JS aplica `.catalog-grid--single` cuando hay 1 card visible.

### Botón AGREGAR invisible en light
Causa: `color:#fff; background:rgba(255,255,255,.1); border:rgba(255,255,255,.2)` literal blanco sobre crema.
Fix: override completo en light con bg blanco + carbón + borde dorado.

### Filter-bar duplicado
Síntoma: dropdown del search aparecía flotando en el medio.
Causa: script de reorder dejó DOS `<div class="filter-bar" id="catalogo">`.
Fix: eliminar duplicado.
Lección: después de reordenar grande, grep por IDs duplicados.

### Decants sin orden alfabético
Síntoma: lista del armador heredaba sort price-desc del catálogo.
Fix: sort A→Z + sección "Agregados" arriba.

### Backdrop oscuro en cards
Síntoma: botellas altas/angostas dejaban bandas grises.
Fix: usar la misma foto como `background-image` con `filter: blur(28px)`.

---

## 🎨 Tipografía / acentos

- Eyebrows (uppercase pequeño): `letter-spacing: .12em`, dorado.
- Section titles: serif display.
- Body text: sans.
- Acento dorado pleno: `#E8B800` (var `--amarillo`).
- Acento dorado-marrón (light mode labels): `#8a6d00`.
- Verde de descuento efectivo: `#1b5e20` (light) / `#4caf50` (dark).

---

## 🔗 Convenciones de naming

- Variables JS: castellano (`currentUser`, `decantsPack`).
- Funciones: castellano (`renderCatalog`, `loadStockFromDB`).
- Clases CSS: inglés (`.product-card`, `.size-picker`).
- IDs: camelCase mixto (`searchInput`, `tbodyPrecios`).

---

**Última actualización:** mayo 2026. Actualizar cuando cambien decisiones de UI/UX/CSS.
