# HISTORIA — ST Perfumería

> Decisiones tomadas, bugs significativos y evolución del proyecto.
> Esto es el "por qué" detrás del código. Si volvés en 6 meses, leé esto antes de tocar nada.

---

## 📅 Línea de tiempo (resumida)

| Período | Hito |
|---|---|
| Inicio | Sitio estático con catálogo hardcoded |
| Primer trimestre | Migración a Supabase + admin panel |
| Mid-año | Sistema de puntos, decants armables, push notifications |
| Mayo 11-12 / 2026 | Light mode completo, reorder home, performance pass mobile, Supabase Pro |
| Mayo 13-14 / 2026 | Sesión maratónica · 11 features deployadas (SW v1.1.10→v1.1.21) · [JS-CHUNK] iter 1 · `mockups.html` único · admin sidebar lateral · banner decants SVG · armador UX (progress bar + empty state + bottom-sheet + anim) |

---

## 🏛️ Decisiones de arquitectura

### 1. Auth custom con password en plano (legacy, A MIGRAR)

**Estado:** ⚠️ pendiente arreglar.

**Cómo está:**
- Tabla `clientes` con columnas `telefono` + `password` (texto plano).
- Login: `SELECT * FROM clientes WHERE telefono = X` y comparación de pass en JS.
- Hay sistema de lockout casero (3 fallos = espera).
- Cuentas creadas desde admin pueden ir sin pass — al primer login del cliente, la pass que tipea queda como definitiva.

**Por qué se hizo así:** velocidad inicial. Funciona pero es inseguro.

**Plan de migración (lazy):**
1. Hashear con bcrypt — fix transparente para clientes:
   - Login lee `clientes.password`
   - Si arranca con `$2` → bcrypt, comparar con `bcrypt.compare`
   - Si no → es plano, comparar plano y APROVECHAR para hashear y guardar
   - Próximo login del mismo cliente ya usa hash
2. Eventualmente migrar a Supabase Auth (más invasivo, requiere ventana de mantenimiento)

**Riesgo de tocar:** bajo si se sigue el patrón lazy. Cero impacto para clientes.

### 2. Service Worker con cache versionado manual

`sw.js` tiene `CACHE_VERSION` que se bumpea a mano en cada commit que toca archivos cacheados (HTML/JS/CSS).

**Por qué manual:** simple, transparente, sin tooling.
**Costo:** olvidarse de bumpear → users ven versión vieja. Hay que recordarlo.

### 3. Realtime entre tablets del local (con watchdog desde mayo 2026)

Las dos empleadas trabajan al mismo tiempo desde dos tablets. Cuando una modifica precio o stock, la otra ve el cambio en vivo (fila parpadea amarillo).

**Implementación (post mayo-2026):**
- `setupRealtimeStock()` en `admin.html` es ahora una **máquina de estados** con watchdog (`INIT` / `CONNECTING` / `LIVE` / `DEGRADED` / `RECONNECTING`).
- En `LIVE`: canal `admin-stock-sync-v2` recibe `UPDATE` de `perfume_overrides` por WebSocket.
- Si el WS se cae (pantalla apagada, WiFi microcortes, tab en background) → pasa a `DEGRADED` y arranca polling diferencial cada 10s (`gt('updated_at', rtLastSyncAt)`).
- Reintenta reconectar con backoff exponencial 2s → 60s max.
- Listeners: `visibilitychange` (volver al foco → resync + reconectar), `online`/`offline`, heartbeat propio cada 60s.
- Anti-echo: la tablet no flashea su propio upsert si recibe el eco <2s después.
- Indicador visual `#syncIndicator` en el header (verde/amarillo/naranja) — la empleada ve si su tablet está sincronizada antes de cobrar.

**Implementación (legacy, antes de mayo 2026):**
- `setupRealtimeStock()` se subscribía a `admin-stock-sync` y `INSERT` en `ventas`.
- Sin watchdog → cuando el WS se caía no se reenganchaba, había que F5.
- Ver bug "Watchdog de Realtime" más abajo.

### 4. Modo claro como override de `body:not(.dark-mode)`

Default = dark. Light mode redefine las CSS variables (`--negro`, `--blanco`, etc.) en `body:not(.dark-mode)`.

**Excepciones que se mantienen oscuras** (decisión del jefe):
- Trust badges (4 cuadros)
- Banner amarillo "EXPLORÁ NUESTRO CATÁLOGO"
- Banner contextual "Tenés X puntos"
- Cards de "Categorías"

### 5. Slider de la home → eliminado

**Por qué:** estaba above-the-fold con `loading="lazy"` (mal), agregaba 1 query Supabase, y el jefe prefirió el banner amarillo grande "EXPLORÁ +150 PERFUMES" como CTA principal.

**Estado:** HTML del slider removido de `index.html`, tab "Slider" del admin removido. Función `loadHomeSlides` queda en `app.js` por si se reactiva.

### 6. Catálogo a 2 columnas en desktop (no 3)

**Por qué cambió:** con 3 columnas las cards quedaban demasiado angostas y la imagen aparecía chiquita con bandas vacías arriba/abajo. Con 2 columnas el layout horizontal `info | imagen` funciona bien y el efecto mirror (alternancia izq/der) se distingue.

### 7. Filter bar NO sticky en desktop

**Bug que tenía:** el filter-bar tenía `position: sticky; top: 64px` también en desktop. Cuando scrolleabas pasado el catálogo, el filter-bar quedaba flotando arriba como un segundo nav fantasma sobre Tu Sector.

**Fix:** `position: static` en desktop. Mobile mantiene sticky (sí tiene sentido ahí).

### 8. Sistema de puntos con audit trail

- `puntos_config`: 1 fila con conversiones globales (puntos_por_perfume, etc).
- `puntos_log`: cada movimiento de puntos (delta, motivo, actor, venta_id si aplica).
- `clientes.puntos`: balance acumulado.
- `ventas.puntos_otorgados`: cuánto sumó esa venta — clave para devolver al eliminarla.
- `ventas.cliente_id_puntos`: quién recibió los puntos (puede no coincidir con `cliente_nombre` si el matching fue por teléfono).

Cuando una venta se elimina, se hace lookup de `puntos_otorgados` y `cliente_id_puntos`, se RESTA al cliente, y se loguea en `puntos_log` con `motivo: 'venta_eliminada'`.

### 9. Performance: deferTask para Supabase

8+ queries Supabase corrían en paralelo en `DOMContentLoaded`. En 4G mobile real eso pegaba al TTI (~4-6s).

**Fix:** helper `deferTask(fn)` y `onDeferred(fn)` que esperan a `window.load` + `requestIdleCallback`. Se aplica a:
- home_slides, trust_badges
- destacados, announcement, combos
- puntos_banner, decants_custom
- votación, store_status
- perfume_views

Críticos (siguen eager): `loadHomeTopBanner` (above-the-fold con fallback inline), `loadPerfumesNuevos + loadOverrides` (catálogo principal).

**Resultado esperado:** -1.5 a -3s TTI mobile.

### 10. Backdrop blur en cards (cuando la botella es alta y angosta)

Las botellas no tienen aspect ratio uniforme. Con `object-fit: contain` y max-height 250px, las altas y angostas (Khadlaj, Yum Yum) dejaban bandas grises feas arriba/abajo.

**Fix tipo Apple Music:**
- Cada `.card-gallery-slide` tiene `background-image` con la misma URL
- `::before` con `filter: blur(28px) saturate(1.3) brightness(.75)` llena el espacio
- `::after` con radial gradient para que la botella destaque
- En light: filtro más suave + gradient a blanco

### 11. Sort default del catálogo

`renderCatalog()` SIEMPRE termina con `sortCards('price-desc')`. Antes solo se ordenaba al cargar inicial; si renderCatalog se re-invocaba (login, sync favs, override), el orden volvía al de inserción de PERFUMES y quedaba inconsistente.

---

## 🐛 Bugs significativos resueltos

### Watchdog de Realtime (mayo 2026)

**Síntoma:** la Tablet B mostraba stock viejo cuando la Tablet A vendía un perfume; sólo se actualizaba con F5. Era inconsistente — a veces andaba 10 minutos perfecto y después se "congelaba".

**Causa raíz:** el Realtime de Supabase funcionaba al inicio pero el WebSocket se caía silenciosamente cuando:
- La pantalla de la tablet se apagaba (navegador suspende la pestaña).
- El WiFi del local tenía un microcorte.
- La empleada cambiaba a otra app (WhatsApp, calculadora) → pestaña en background.

El canal quedaba en `CHANNEL_ERROR` / `CLOSED` y **no se reconectaba solo**. No había indicador visual, así que la empleada no sabía que estaba desincronizada.

**Fix:** se reescribió `setupRealtimeStock` como máquina de estados con:
- Detección de desconexión vía callback de `.subscribe(status, err)`.
- Backoff exponencial para reintentos (2s, 4s, 8s, 16s, 30s, 60s max).
- Polling de respaldo cada 10s **solo en modo DEGRADED**, con filtro diferencial `gt('updated_at', rtLastSyncAt)` — barato (~52 MB egress/mes en peor caso, 0.02% del límite Pro).
- Listeners de `visibilitychange`, `online`, `offline` para forzar resync.
- Heartbeat propio cada 60s: si >90s sin mensajes en LIVE → resync forzado silencioso.
- Indicador visual `#syncIndicator` (verde / amarillo / naranja) en el header.
- Anti-echo: la tablet no flashea su propio upsert si el eco vuelve <2s después (evita ruido visual).

También requirió:
- **Trigger SQL** para que `updated_at` se bumpee automáticamente en cada `UPDATE` de `perfume_overrides`. Sin esto el polling diferencial no funcionaba (la columna tenía `DEFAULT now()` que sólo aplica en INSERT). Guardado en `sql/add_updated_at_trigger.sql` y aplicado en prod vía Supabase MCP el 2026-05-13.
- Mover la llamada a `setupRealtimeStock` desde el nivel de módulo (`setTimeout(..., 1500)` que corría antes del login) hacia adentro de `enterAdminPanel` (post-login).

**Decisión consciente:** flash en polling DEGRADED **sí**, flash en resync silencioso post-`SUBSCRIBED` **no**. Razón: en DEGRADED la empleada necesita ver "esto cambió ahora aunque haya 10s de delay". En el resync post-reconnect podrían venir cambios de hace mucho — flashearlos sería confuso.

**Lección:** los WebSockets en clientes con vida larga (tablets de 12h, PWAs) **siempre** necesitan watchdog. El cliente `supabase-js` no se reengancha solo. Patrón replicable para cualquier otra tabla que necesite sync en tiempo real.

### Timezone bug en horario (mayo 2026)
**Síntoma:** el jefe guardaba un horario nuevo en admin a las 23:08 ARG y la web pública seguía mostrando el horario default.

**Causa raíz:** el admin guardaba `desde` como `new Date().toISOString().split('T')[0]` que devuelve fecha en UTC. A las 23:08 ARG ya es día siguiente UTC, entonces `desde` quedaba con fecha de mañana. La web pública comparaba con la fecha LOCAL Argentina (hoy) → la condición `ajuste.desde <= hoyStr` daba false.

**Fix:**
- Admin: usa `new Date().toLocaleString('en-US', {timeZone: 'America/Argentina/Buenos_Aires'})` para calcular hoy.
- Frontend: tolera 1 día de margen en `desde` para que ajustes ya guardados con la fecha shifted no queden ciegos.

**Lección:** SIEMPRE usar timezone Argentina al guardar fechas, nunca UTC.

### RLS bloqueando lectura pública (mayo 2026)
**Síntoma:** `ajuste_horario` no se aplicaba en la web pública aunque admin guardaba bien.

**Causa raíz:** la tabla `ajuste_horario` no tenía policy de SELECT pública. RLS bloqueaba lecturas anónimas → la web nunca veía el ajuste.

**Fix:** policy `select_public USING (true)` en cada tabla que el frontend público lee.

**Lección:** cuando crees una tabla nueva, configurar RLS desde el día 1. NO bypassear con "service_role" en el cliente — eso expone secrets.

### Filter-bar duplicado (mayo 2026)
**Síntoma:** el dropdown del search aparecía flotando en el medio de la página.

**Causa raíz:** mi script de reordenamiento de la home dejó DOS `<div class="filter-bar" id="catalogo">` en el index. IDs duplicados → `getElementById` agarraba el primero pero el HTML duplicado hacía cosas raras con el dropdown.

**Fix:** eliminé las ~50 líneas del filter-bar duplicado que quedó orphan entre Juegos ST y Tu Sector.

**Lección:** después de reordenar grande, grep por IDs duplicados.

### Modal "Ajustar puntos" no abría (mayo 2026)
**Síntoma:** botones +/- en tab Puntos del admin no hacían nada.

**Causa raíz:** original usaba `prompt()` (bloqueado en muchos mobiles) + abría con `.classList.add('open')` cuando el resto del admin usa `'active'`.

**Fix:** modal completo con toggle Sumar/Restar, dropdown de motivos, nota libre, confirmación.

**Lección:** revisar la convención del proyecto antes de crear modales nuevos.

### Light mode incompleto (mayo 2026)
**Síntoma:** la tía del jefe usaba light mode mobile y muchos textos eran invisibles.

**Causa raíz:** ~50 textos con colores hardcoded (`#999`, `#888`, `#777`, `rgba(255,255,255,...)`) que en light mode quedaban washed-out sobre crema. El peor: botón AGREGAR del bottom-sheet con `color:#fff;bg:rgba(255,255,255,.1)` = literal blanco sobre crema.

**Fix:** parche masivo de legibilidad en `body:not(.dark-mode)`. Todos los textos secundarios a `#2a2622`, strong a `#1a1a1d`, eyebrows a `#8a6d00` (dorado-marrón). Botones primarios con gradient dorado pleno.

**Lección:** desde el día 1, usar SIEMPRE las CSS variables (`--blanco`, `--gris`, etc.) en lugar de hex hardcoded. Light mode redefine las variables y todo se adapta.

### Decants sin orden alfabético (mayo 2026)
**Síntoma:** la lista del armador heredaba el orden de PERFUMES (price-desc) y los agregados quedaban donde estaban, había que scrollear para encontrarlos.

**Fix:** sort A→Z + sección "Agregados a tu pack" arriba con los `qty > 0`, sección "Resto del catálogo" abajo. Cuando agregás algo, salta automáticamente a la sección de arriba.

### `</div>` huérfano deja 9 tabs del admin afuera del `<main>` ([BUG-DEC-ADMIN], mayo 2026)

**Síntoma:** Alejo reportó que al entrar a la tab "💧 Decants" del admin desde desktop normal, el contenido del panel ("Configuración Pack de Decants") aparecía con un espacio negro enorme arriba — como si el sidebar tuviera height fija que empujara el main hacia abajo. Las screenshots originales mostraban el panel rendereado MUY debajo del menú lateral.

**Hipótesis inicial (incorrecta):** grid item sin `min-width: 0` + contenido wide → el track `1fr` no podía shrinkear → wrap del main debajo del sidebar. Se armaron 3 opciones de fix en `mockups.html` (A overlay fixed / B drawer hamburguesa siempre / C grid fix conservador). Alejo eligió C.

**Causa raíz (descubierta verificando C en preview):** un `</div>` extra en [admin.html:2127](admin.html:2127), justo después del cierre de `tab-combos`. El parser HTML5 al desbalancearse el stack cerraba el `<main>` implícitamente. **9 tabs** del admin (votación, push, espera, doctor, **decants**, auditlog, analytics, backups, puntos) quedaban como siblings del `.app-shell` en el DOM, no como hijas del `<main>`. Cuando una empleada activaba esas tabs, aparecían DESPUÉS del shell (que tiene altura completa por el sidebar), produciendo el espacio fantasma.

**Cómo lo descubrí:** corriendo `preview_eval` con `[...document.querySelectorAll('.tab-content')].map(t => t.parentElement.id)` apareció que 11 tabs tenían parent `<main class="admin-main">` pero 9 tenían parent `#adminPanel` directamente. La frontera era exactamente tab-combos → tab-votacion. Lectura del HTML en esa zona reveló la línea sobrante.

**Fix:** 1 línea borrada. Después de aplicar el fix, los 20 tab-content quedan todos dentro del main; sidebar y main lado a lado como debe ser. El `min-width: 0` se revirtió (no era necesario, era distracción cosmética).

**Lección:** los bugs visuales "raros" del admin no siempre son CSS — pueden ser HTML mal balanceado que el parser repara con reglas que no son obvias. El proceso de armar mockups en `mockups.html` con 3 opciones igual sirvió: forzó verificación temprana en preview, y ahí salió la causa raíz. **El "fix más barato de implementar fue el más caro de diagnosticar."**

---

## 📐 Decisiones de UX importantes

### Banner contextual de puntos
Debajo del banner amarillo "EXPLORÁ +150 PERFUMES" hay un mensaje contextual que aparece SOLO si el cliente está logueado y tiene puntos. Mensaje editable desde admin (`puntos_config.mensaje_promo`). Lógica:
- 0 puntos: invitamos a sumar
- Múltiplo del threshold: "Pediinos un premio"
- threshold-1: "Sumá 1 más y consultá por tu premio 📲"
- Sino: solo mostrar saldo

### Tu Sector
Sección con dos cards lado a lado:
- "Espacio para ustedes" (textarea para opiniones públicas)
- "Votá el perfume del mes" (cuando hay candidatos cargados, sino card "coming soon" con animación)

### Decants armador
- Modal full-screen con grid de cards (cada card = 1 perfume)
- Grupo "★ Agregados a tu pack" arriba, "Resto del catálogo" abajo (sort A→Z)
- Total dinámico según cantidad (escalera de precio: 1-2 / 3-4 / 5+ unidades)
- Botón "−" global junto al total para quitar el último agregado (LIFO)
- Mensaje a WhatsApp con detalle del pack

### Filter deck (mobile)
Botones de categoría (`Todos / Unisex / Hombre / Mujer / 🔥 Nuevos / ❤`) apilados como mazo de cards en mobile. Solo se ve el `.active` cuando deck está cerrado. Tap abre, tap fuera cierra.

---

## 🔍 Pendientes (con detalle)

### 🔴 Hashear contraseñas con bcrypt (lazy migration)

**Riesgo:** clientes guardan pass en plano. Si DB se filtra → contraseñas en claro.

**Plan:**
1. Agregar `bcryptjs` vía CDN en `index.html` (5KB).
2. En el flujo de login (línea ~378 de `app.js`):
   - Si `cliente.password` arranca con `$2` → es bcrypt, comparar con `bcrypt.compare`
   - Si no → es plano, comparar plano. Si match: hashear y guardar (`UPDATE clientes SET password = hashed`).
3. En el flujo de register (línea ~430 de `app.js`):
   - Hashear antes de insertar.

**Riesgo del cambio:** cero para clientes (transparente). Performance: +200ms en primer login.

**Tiempo:** 30-60 min.

### 🟡 Migrar a Supabase Auth

**Por qué:** "Olvidé mi contraseña" gratis (mail / SMS), JWT con TTL, RLS más limpia.

**Plan en etapas:**
1. Hashear bcrypt (etapa anterior)
2. Agregar columna `clientes.auth_uid` que linkea con `auth.users`
3. Permitir AMBOS logins en paralelo (test con cuentas propias)
4. Migrar usuarios masivamente con admin API
5. Bloquear login viejo
6. Borrar código viejo

**Total:** 1 día partido en sesiones.

**Cuándo:** una semana sin grandes cambios — para no mezclar bugs de auth con UI.

### 🟡 Tab "Orden de compra sugerida"

Tab on-demand (no push automático) en admin con:
- 🚨 Sin stock (qty = 0)
- ⚠️ Stock crítico (1-2 unidades)
- 📈 Se vende rápido (stock 3-10 + ventas/semana >=1, ranked por semanas hasta vacío)
- 📲 Botón "Generar mensaje WhatsApp" → arma texto con todo el pedido sugerido y abre wa.me

**Tiempo:** ~3h.

### 🟢 Permisos de tabs configurables

Tabla `admin_perms (tab_id, rol, visible, editable)`. Tab "🔐 Permisos" donde el jefe checka qué tabs ve cada rol. Realtime sync entre tablets.

**Postergado por pedido del jefe.**

### 🟢 Botón "Olvidé mi contraseña" estilo A

Cliente toca botón → push Telegram al admin → admin manualmente resetea → manda nueva pass por WhatsApp.

Es chimenea pero te enterás de quién no puede entrar. Tiempo: 30-60 min.

**Mejor solución:** llegará gratis con Supabase Auth.

### 🟢 Otros pendientes 

- Sistema de puntos para decants desde el armador
- Wireframe Juegos ST (Quiz + Desafío side by side)
- Estandarizador automático del uploader del slider (compresión + resize webp)
- TikTok como slide del slider con video + link

---

## 📊 Versiones del Service Worker (cronología)

| Versión | Cambio principal |
|---|---|
| v1.0.35 | Inicio del versionado documentado |
| v1.0.36-39 | Fixes de light mode + nav hamburger |
| v1.0.42-43 | Performance pass (deferTask + image dimensions) |
| v1.0.45-50 | Light mode completo + Desafío ST |
| v1.0.51 | Eliminación del slider |
| v1.0.55 | Filter deck mobile fix |
| v1.0.58-60 | Horario timezone bug |
| v1.0.65 | Sort price-desc default |
| v1.0.71-72 | Backdrop blur en cards |
| v1.0.76-78 | Parche masivo de legibilidad light |
| v1.0.79 | Decants alfabético + agregados arriba |
| v1.0.80-82 | Refactor Ventas + edición precio centralizada |
| v1.0.83-85 | Decants custom (precio_unit + foto_url) |
| v1.0.86-87 | Light theme fixes (decant frasquitos, controles +/-) |
| v1.0.88 | Tolerancia SELECT * para columnas opcionales |
| v1.0.89-90 | Upload foto custom decants + especiales primero en armador |
| v1.0.91-93 | Mobile light fixes + bug crítico setupRealtimeStock + cache invalidation |
| v1.0.94-95 | SW network-first JS/CSS + updateViaCache:'none' |
| v1.0.96-98 | Timeout 3s en queries + cache local stale-while-revalidate |
| v1.0.99 | Login admin con timeout 8s + feedback "Verificando…" |
| v1.1.00 | 🎉 Milestone — Skeleton loader + fade-in scroll + counter "Cargando…" |
| v1.1.01 | Social proof "X mirando ahora" + transición filtros |
| v1.1.02 | Badge "🔥 Solo quedan N" + custom cursor dorado desktop |
| v1.1.03 | Pack de 5 UX premium (sonido, heart pop, perfume del mes, infinite scroll, visto recientemente) |
| v1.1.04 | Scroll-to-section margin fix + decant banner look quiz-cta |
| v1.1.05 | Nav sin search + logo y íconos más grandes |
| v1.1.06 | Drawer hamburguesa rediseñado (Inter sans + emojis + más compacto) |
| v1.1.07 | 🛒 [NAV-CART] Carrito en navbar con badge |
| v1.1.08 | [LCP-PRELOAD] + [CLS-RESERVE] fix Lighthouse |
| v1.1.09 | [FCP-CSS] CSS no bloqueante + critical inline |
| v1.1.10 | [IMG-DIMS] aspect-ratio defensivo en imgs |
| v1.1.11 | [PENDULO] cart-float circular gemelo del wa-float |
| v1.1.12 | [GATO] mensaje WA unificado (carrito + Consultar individual + sets) |
| v1.1.13 | [FANTASMA] revert parcial de [IMG-DIMS] — dropdown search no más imagen 463×463 |
| v1.1.14 | [HOTSALE] promo = precio cash directo + cuotas sobre tarjeta + % dinámico |
| v1.1.15 | [WATCHDOG] Realtime con máquina de estados + polling de respaldo + indicador visual |
| v1.1.16 | [ZAPATO] admin con sidebar lateral + agrupaciones colapsables + persistencia localStorage |
| v1.1.17 | [BACKDROP] tuning del backdrop blur de cards: cohesión cromática entre fondos blancos y negros |
| v1.1.18 | [PACK-CHIVATO] defensa anti-slugs inválidos en sendDecantPackToWA + emojis en el mensaje al vendedor |
| v1.1.19 | [CATALOGO-POLISH] 6 fixes visuales del catálogo: placeholder elegante, CTA banner grande, marquee suavizado, light mode legible, cuotas con valor, fav-filter consistente |
| v1.1.20 | [JS-CHUNK] iter 1 — armador de decants en `js/extras.js` lazy-loaded |
| v1.1.21 | [DECANTS-UX] banner SVG + 4 mejoras armador (progress bar, empty state, bottom-sheet, anim al +) |
| v1.1.22 | [BANNER-V2] Decants banner rediseño completo · Opción 2 desktop (CSS+SVG con podiums + humo + flor) + Variante C mobile (5ml protagonista) + 3 trust badges |
| v1.1.23 | [DECANTS-UX-2] tabs Catálogo/Mis decants (#4) + combo sugerido sticky "Combinás bien con: X" (#6) en armador |
| v1.1.24 | [DISEÑADOR] rename Especiales → Decants de diseñador (extras.js: título sección + mensaje WA al vendedor + fallback "De diseñador") |
| v1.1.25 | [DISEÑADOR] admin.html: copy del párrafo explicativo actualizado a "Para decants de diseñador (Jean Paul Gaultier, Creed, Dior, etc.)" |
| v1.1.26 | [DISEÑADOR] admin.html: título de la sección "Perfumes personalizados" → "💎 Decants de diseñador" |
| v1.1.27 | [CARD-STRETCH-FIX] card del catálogo no se estiraba a 900px con 1 favorito filtrado · align-content:start + grid-auto-rows:max-content |
| v1.1.28 | [SORTMENU-Z] dropdown "Ordenar" tapado tras toggle filtro favoritos · sort-wrapper con z-index:100 + isolation:isolate |
| v1.1.29 | [COMPARE-V2] sección "🔥 Diferencias destacadas" (2A) + botón "💕 Elegir este" (2B) en modal Compare |
| v1.1.30 | [SELECCION-PODIO] 1A badges oro/plata/bronce top 3 + 1B quote del jefe stub frontend (lee nota_jefe del override) |
| v1.1.31 | [JUEGOS-3A] move #quizSection antes de Nosotros via JS-move sync + [JUEGOS-3C] CTA banner copy reescrito |
| v1.1.32 | [PWA-AUTO-RELOAD] auto-reload mágico post-SW-update con mitigación (no recarga si modal abierto/input focused/scroll < 3s) |
| v1.1.33 | [SIMILARES-CDA] modal Ver similares "full premium" · ring de % match + razón humana + botón ⚖ Comparar + badges premium (max 2 con regla "condición fuerte") |
| v1.1.34 | [SELECCION-BADGE] texto del badge amarillo de Selección ST editable desde admin (tab Destacados) · tabla Supabase `seleccion_st_config` con default "TOP VENTAS" |
| v1.1.35 | [SW-UPDATE-BANNER] aviso "Hay una versión nueva del panel disponible" en admin · pill amarilla sticky-top · chica decide CUÁNDO actualizar (no auto-reload, contrario al PWA-AUTO-RELOAD del público) |
| v1.1.36 | [DC-RESPONSIVE-FIX] + [DC-PRECIO-GUARD] urgente · grid de "decants de diseñador" responsive en admin (Galaxy Tab A9 cortaba el campo PRECIO) + custom decants sin precio_unit aparecen atenuados con "⏳ Precio pendiente" + "+" disabled (evita venta a $9500 escalera por error) |
| v1.1.37 | [DC-PRECIO-PROMINENT] prioridad visual del campo PRECIO + botón GUARDAR · caja amarilla destacada, border rojo con pulse si vacío, botón gigante full-width en tablet/mobile |
| v1.1.38 | [EMERGENCY-BUMP] forzar update remoto · tablet del admin se colgó con panel derecho vacío al entrar a tab Decants (resultó ser cache híbrido SW viejo + HTML nuevo) · bump SW sin cambios reales para disparar el [PWA-AUTO-RELOAD] de los clientes |
| v1.1.39 | [SW-BANNER-V2] rediseño del SW-UPDATE-BANNER · variante C "Amarillo BIG" (ícono 🔄 grande en círculo negro + título 1rem + subtítulo + botón gigante "ACTUALIZAR" + sombra dorada fuerte · ~75px vs 46px de la pill anterior) + tab "💧 Decants" del admin ahora visible para empleadas (sin `data-role="jefe"`) |
| v1.1.40 | [BUG-DEC-ADMIN] fix HTML estructural · `</div>` extra en admin.html:2127 cerraba `<main>` implícitamente · 9 tabs (votación/push/espera/doctor/decants/auditlog/analytics/backups/puntos) eran siblings del `.app-shell` en vez de hijas del `<main>` · al activarlas aparecían debajo del sidebar con espacio fantasma · 1 línea borrada → 20 tabs todas dentro del main |
| v1.1.41 | [SELECCION-ST-1B] UI admin para `nota_jefe` · textarea en modal Editar Perfume (maxlength 180, rows 2) arriba del bloque "Notas de stock" · cierra el cabo suelto del [SELECCION-PODIO] iter (commit 1.1.30) donde el frontend ya leía `p.nota_jefe` pero no había forma de cargar el quote desde admin sin tocar SQL · saveEditPerfume upsert + audit log incluye campo "Quote del jefe" |
| v1.1.42 | [JUEGOS-3A-FINAL] move físico del `#quizSection` en index.html · ahora vive entre `#seo-hub` y `#nosotros` directamente en el HTML estático · se eliminó el script JS-move sync inline que existía antes de `</body>` · beneficios: SEO (crawlers ven orden correcto si JS-render falla) + mantenibilidad (leer el HTML refleja el orden visual) |
| v1.1.43 | ❌ [LIGHTHOUSE-15JUN] primer intento de subir score · min-height 320/380→380/460/500 hero + display=optional + min-height quiz-cta + 5 contrastes a11y · ROMPIÓ TODO (CLS mobile 0.132→0.957, FCP +1.7s, Performance 61→40) |
| v1.1.44 | ❌ [LIGHTHOUSE-15JUN-REVERT] vuelta display=swap (mantuvo min-heights) · CLS quedó IGUAL 0.957→0.958 · diagnóstico: el culpable NO era display=optional, eran los min-heights |
| v1.1.45 | ✅ [LIGHTHOUSE-15JUN-FULL-REVERT] revert TOTAL de min-heights del hero (vuelta a 320/380) · CLS volvió a baseline · ESTADO RECUPERADO BUENO (1 medición lucky dio 91 mobile · score real estable ~53) |
| v1.1.46 | ❌ [LIGHTHOUSE-DESKTOP-PUSH] fetchpriority="high" en preload Google Fonts + aspect-ratio:1/1 en logos + min-height quiz-cta ≥1024px + 5 contrastes a11y · regresión a ~50 mobile |
| v1.1.47 | ❌ [LOGO-OPTIMIZED] logo 600×457→192×146 + manifest.json fixes + nav-logo width="52"h="42" (era 52×52) + remoción aspect-ratio CSS · regresión continuó a ~50 |
| v1.1.48 | ❌ [CATALOG-IMG-RESIZE] resize masivo 344 fotos /img/ a 400wide (3.69MiB→1.86MiB, -50%) · score consistente ~44 mobile (peor que el inicio · pánico) |
| v1.1.49 | ✅ [ROLLBACK-A-V145-PLUS-IMG] revert completo v1.1.46/47/48 + re-aplicar SOLO el resize de imágenes (cambio menos invasivo · solo binarios, no toca CSS/HTML) · estado estable ~53.6 mobile (mediana de 5 mediciones) |
| v1.1.50 | [BATCH-REFLOW] applyCardVisibility en app.js · antes había `void card.offsetWidth` dentro de un forEach sobre 162 cards (162 reflows forzados = 151ms TBT) · ahora batchea reads/writes y hace UN solo reflow en el contenedor · esperado -140ms TBT |
| v1.1.51 | [HERO-SUB-MOVE] move físico del `<p class="hero-sub">` (texto largo "Perfumes árabes importados...Pasás y la gente gira") desde el hero a la sección `#nosotros` como `.nosotros-intro` · keywords SEO mantenidos · hero queda solo con tagline + title (textos cortos en 1 línea = cero shift por swap de fuentes) |
| v1.1.52 | [HERO-MIN-HEIGHT-DOWN] bajar min-height del hero 320/380 → 220/260 (sin el `<p>` largo el contenido cabe en ~160px · 220 dejaba ~60px de hueco pero menos visible) |
| v1.1.53 | ✅ [HERO-COMPACT] ELIMINAR min-height del hero (contenido natural manda · ~140px) + bajar padding-bottom (2.5rem→1.25rem mobile · 3rem→1.5rem tablet · 4rem→1.75rem desktop) · hero queda compacto sin hueco fantasma · MEDICIÓN EN PREVIEW: **100% Performance Mobile + 100% A11y + 100% Best Practices** 🎯 |
| v1.1.54-56 | [LIGHT-MODE-CREAM-REVERT] + [LIGHT-MODE-CONTAINER-FIX] + [LIGHT-COHERENT-CREAM + LIGHT-TOGGLE-V2] · 3 iteraciones del light mode (primeras 2 falladas por malinterpretación del pedido · 3era Opción B del mockup aprobada) · pill amarilla "LIGHT/DARK" V2 reemplaza el botón circular |
| v1.1.57 | [LIGHT-CONTACTO-TEXT] override del em "Consultános" con style inline · color amarillo → dorado-marrón en light |
| v1.1.58 | [LIGHT-CAT-CARDS-CREAM] fix de cat-cards ilegibles (override viejo con #f0ede8 hardcoded para cards dark · ahora #1a1a1d sobre cream) + titles Selección ST y Sets a dorado-marrón |
| v1.1.59 | [LIGHT-SECTIONS-FORCE] !important en bg transparent de 11 secciones + override h2 a #1a1a1d para evitar titles ilegibles |
| v1.1.60 | ✅ [LIGHT-BUG-RAIZ] · descubierto con `preview_eval` sobre URL Vercel preview: `body.is-guest { background: #121214 }` en critical CSS inline (index.html:424) ganaba en cascade contra `body:not(.dark-mode)` porque el `<style>` inline está DESPUÉS del `<link>` a styles.css · fix: 2 reglas específicas con `.dark-mode` y `:not(.dark-mode)` + body default `class="is-guest dark-mode"` (evita flash) + JS init que QUITA dark-mode si user eligió light |
| v1.1.61 | [LIGHT-DESKTOP-TWEAKS] push banner "¿Querés recibir novedades?" letras blancas + FAQ max-width 800 → none (full-width en desktop · light only) |
| v1.1.62 | [LIGHT-DESKTOP-TWEAKS-2] price-banner-cta amarillo → gris #bbb + FAQ full-width en LIGHT y DARK (sacó scope a light) |
| v1.1.63 | [LIGHT-CTA-POP] botones "VER CATÁLOGO" + "JUGAR" con gradient dorado vibrante + pulse animation + sombra ámbar (light + desktop) · respeta prefers-reduced-motion |
| v1.1.64 | [QUIZ-SECTION-COMPACT] reducir padding/gap/margin del #quizSection en desktop (era espacioso) · -80-100px de alto |

**Actualizar esta tabla cuando hagas commits significativos.**

---

## 🎉 Sesión mayo 11-12 2026 — Plan UX + Lighthouse + Supabase Pro

Sesión maratónica con muchas decisiones grandes. Resumen:

### Decisiones de infra
- **Supabase Pro contratado** (USD 25/mes) — el free tier estaba degradado, latencia errática, queries colgándose. Pro da compute dedicado.
- **Cache local stale-while-revalidate** para queries críticas (perfumes_nuevos, perfume_overrides) — aunque Supabase falle, el cliente ve la última versión cached por 30 min.
- **Timeout 3-8s** en TODAS las queries Supabase (login admin + lecturas público) — sin esto el sitio se colgaba indefinidamente cuando Supabase estaba lento.

### UX premium implementado (sin librerías)
1. **Skeleton loader** con shimmer mientras carga el catálogo
2. **Fade-in con stagger** al scrollear cards (IntersectionObserver, primeras 6 escalonadas)
3. **Backdrop blur lazy** en imágenes de cards (data-bg + IO con rootMargin 300px)
4. **Live viewers** "X personas mirando ahora" — algoritmo determinista por slug + window de 5min, cero realtime
5. **Urgency badge** "🔥 Solo quedan N" cuando stock 1-3 (data real del admin, no marketing falso)
6. **Transición entre filtros** con scale .97 → 1 al cambiar de categoría
7. **Custom cursor dorado** desktop con lerp suave, crece sobre interactivos
8. **Sonido sutil al carrito** Web Audio API (E5+B5, 200ms cálido)
9. **Heart pop con partículas** al toggle favorito (6 partículas rojas dispersas)
10. **Badge "Perfume del mes"** en ganador de votación, gradient dorado animado
11. **Infinite scroll** con IO sobre #loadMoreWrap (rootMargin 400px, throttle 300ms)
12. **Visto recientemente** carousel — localStorage trackea últimos 8 vistos
13. **Sort default price-desc** en cada renderCatalog (no solo en load inicial)
14. **deferTask + onDeferred** para queries no críticas (announcement, votación, etc)

### Bugs significativos resueltos
- **Filter-bar duplicado** post reorder de home → IDs duplicados causaban dropdown flotante raro
- **setupRealtimeStock con sintaxis rota** (regex DOTALL me dejó `catch(e){}` huérfano) → admin login no respondía
- **Timezone en ajuste_horario** → admin guardaba "desde" en UTC, frontend comparaba en ART → ajuste invisible 24h
- **RLS sin SELECT pública** en ajuste_horario → frontend público no podía leer aunque admin sí
- **Login admin sin timeout** → si Supabase lento, signInWithPassword esperaba infinito
- **renderCatalog roto si UN perfume malo** (p.name undefined rompía .map.join entero) → defensivo con forEach + try/catch por card
- **CSS background-image bypasea loading="lazy"** → todas las fotos del backdrop blur se pedían al inicio (162 fetches)

### Refactor estructural
- **Sección Ventas eliminada** del admin (pendiente repensar flujo)
- **Columna ACCIÓN eliminada** de Precios & Stock (edición vía tab Editar)
- **Mensaje "151 perfumes" eliminado** de pestaña Editar
- **Nav buscador eliminado** definitivamente (mobile + desktop)
- **Drawer hamburguesa rediseñado** — Inter sans .92rem + emojis + estilo app moderna

### Decisiones de diseño
- **Decant banner con look del quiz-cta** — gradient violeta-magenta para consistencia visual entre CTAs grandes
- **Logo del nav más grande** (40→52px desktop, 30→42px mobile) — protagonista del nav
- **Íconos del nav más grandes** (34→46px desktop, 34→42px mobile)
- **Custom cursor dorado** solo activado en hover+pointer fine + respeta reduced-motion

### Plan C — Lighthouse fix (commits 1.1.07 a 1.1.10)
Métricas mobile reportadas por el jefe:
- FCP 4.3s (crítico)
- LCP 7.9s (catastrófico)
- TBT 90ms (OK)
- CLS 0.684 (6.8x peor que el límite "malo")
- Speed Index 4.3s

Fixes aplicados:
- **[NAV-CART]**: carrito en navbar con badge sincronizado
- **[LCP-PRELOAD]**: fetchpriority="high" en 1ra img del catálogo + reserve heights del skeleton/grid
- **[FCP-CSS]**: CSS no bloqueante (preload + onload swap) + critical CSS inline (~1KB) para evitar FOUC + dns-prefetch
- **[IMG-DIMS]**: aspect-ratio defensivo en imgs de grids + width/height correctos en logos

**Score esperado post-fix:** FCP ~1.5-2s, LCP ~3-4s, CLS <0.1.

---

## 🎉 Sesión mayo 13-14 2026 — Pulido público + admin sidebar + chunking JS

Sesión maratónica nocturna (~6 horas, desde la tarde hasta madrugada del 14). 10 commits live + 2 mockups + 1 incidente de Supabase. Lista:

### Features deployadas (orden cronológico)

| Keyword | Qué hace | Commit |
|---|---|---|
| `[PENDULO]` | Cart-float pasa de pill amarillo "🛒 Ver pedido" a círculo redondo gemelo del wa-float. Mismo tamaño (56/62), justo arriba con gap 12px. | db1d9f2 |
| `[GATO]` | Función `buildWaMessage(items, note)` unifica el mensaje de WhatsApp del carrito + Consultar individual + sets. Antes los 3 mandaban "Hola! Me interesa el X" suelto; ahora todos generan lista numerada con precio, cuotas y efectivo off. | 84f875b |
| `[FANTASMA]` | Revert parcial de [IMG-DIMS] (v1.1.10). El bloque CSS sobreescribía width/height explícitos de varias imgs — el dropdown del buscador renderizaba la foto a 463×463 px en lugar de 32×42. Quitar el bloque arregla 6 selectores. | f5be238 |
| `[HOTSALE]` | Refactor del modelo de precios. `p.price` = precio TARJETA (base para cuotas). `p.promo` = precio EFECTIVO/TRANSFER override (si existe, ES el cash final sin doble descuento). Helpers `getListaPrice / getCashPrice / getCuotaPrice / hasHotSale / getDiscountPct`. Label "🔥 HOT SALE EFECTIVO" hardcoded en `HOT_SALE_LABEL`. % off dinámico. Aplicado en card del catálogo, cart panel, buildWaMessage, modal bsPrice. | da0b2f3 |
| `[WATCHDOG]` | (Backend, otro chat de Claude.) Máquina de estados para Realtime en admin.html: `INIT/CONNECTING/LIVE/DEGRADED/RECONNECTING`. Si el WS se cae arranca polling diferencial cada 10s y reintenta con backoff. Indicador visual `#syncIndicator`. Ver bug "Watchdog de Realtime (mayo 2026)". | 96f74ca |
| `[ZAPATO]` | Admin con sidebar lateral en lugar de tab-bar horizontal flex-wrap (20 botones en 3-4 filas → sidebar con 5 grupos colapsables). Mantiene todas las clases `.tab-btn` y data-attributes — `switchTab()` intacto. Responsivo: mobile (hamburguesa overlay) / tablet 200px / desktop 240px. Persistencia en localStorage (`st_admin_sidebar_collapsed` + `st_admin_sidebar_groups`). | 96023cb + f4437a7 |
| `[BACKDROP]` | Tuning del backdrop blur de cards. `brightness .75→.6` (dark), `saturate 1.3→1.5`, vignette más fuerte, overlay dorado tenue. Resuelve fotos sobre fondo blanco que "quemaban" en dark mode. | 5be34ac |
| `[PACK-CHIVATO]` | Defensa anti-slugs inválidos en `sendDecantPackToWA`: filtrar nulls/undefined/empty strings que podían colarse desde localStorage corrupto y desincronizar el header del mensaje ("6 decants" pero cuerpo de 4). Bonus: emojis "los justos y necesarios" en el mensaje al vendedor (👋 🧪 💰 🙏). | cf91cd8 |
| `[CATALOGO-POLISH]` | 6 fixes visuales en una tanda (3B placeholder elegante, 4B CTA banner grande, 4A marquee suavizado 22s→45s, 5 light-mode legible con `var(--gris-claro)`, 1 valor de cuota visible con chip dorado, 2 fav-filter consistente + chip filtro pegado). | 712e30c |
| `[JS-CHUNK]` iter 1 | Split del armador de decants (~170 líneas) a `js/extras.js` lazy-loaded vía `requestIdleCallback` post-TTI. Stubs en `app.js` para que `onclick=openDecantBuilder()` del HTML funcione antes/después del load de extras. Reduce el bundle inicial de 6609 → 6439 líneas. | bcd4eec |

### Mockups creados (standalone, no en prod)

- `mockup-zapato.html`: admin con sidebar lateral + tab "Campañas" como mockup de `[SIRENITA]`. Sirvió de referencia para implementar [ZAPATO] en el admin real. *(Borrado el 24-sep-2026, `[INVENTARIO-ARCHIVOS]`; está en el historial de git.)*
- `mockup-catalogo-issues.html`: 6 oportunidades visuales del catálogo público con vista before/after. Sirvió como guía visual para [CATALOGO-POLISH]. *(Borrado el 24-sep-2026, `[INVENTARIO-ARCHIVOS]`; está en el historial de git.)*

### Convención acordada para mockups futuros

**Un solo archivo `mockups.html`** con secciones internas. Los 2 sueltos actuales quedan como histórico hasta que ya no sirvan, después se borran. Ver lección meta #7.

### Incidente Supabase (madrugada 14-may, post-deploy de [JS-CHUNK])

**Síntoma:** Alejo reporta que `stperfumeria.com` muestra solo los 150 perfumes hardcoded del seed, sin Hot Sale, sin overrides, sin destacados (los datos custom del admin no se cargan).

**Diagnóstico real:** Supabase está degradado / lento desde la zona de Alejo. Verifiqué con curl:
- Status 522 (Cloudflare→origin timeout) tras 92.2s en una query
- En otro intento, timeout a los 5s sin respuesta
- Status page de Supabase: "All Systems Operational" (sin actualizar)

**No fue por [JS-CHUNK].** El sw.js v1.1.20 y `extras.js` se sirven OK en producción. Lo que falla son las queries a `*.supabase.co/rest/v1/*` con timeout de 3s (defensa instalada en mayo 2026 para que el sitio no quede colgado). Cuando Supabase tarda más, cae al fallback hardcoded.

**Por qué pasa:**
1. Capa Cloudflare (front de Supabase) puede tener problemas regionales / BGP
2. PostgREST (REST server de Supabase) puede saturarse temporalmente
3. La DB Postgres está OK (los datos no se perdieron — confirmado)

**Cómo se mitiga (ya instalado desde antes):**
- Timeout 3s defensivo en queries
- Cache local stale-while-revalidate (30 min) en queries críticas
- Seed hardcoded de 150 perfumes como último recurso

**Próximos pasos si recurre:**
- Aumentar timeout 3s → 8s en queries (más tolerancia, home tarda más en mostrar datos)
- Activar logging detallado de cada query para identificar cuál exacta falla
- Contactar Supabase support desde el dashboard (Alejo es Pro, tiene soporte directo)

**Lección:** ningún cloud tiene 100% uptime. Supabase Pro SLA 99.9% = hasta 8h de degradación/año aceptable. Las capas de defensa (timeout + cache + seed) están justamente para esto. NO se pierden ventas en estas ventanas — el WhatsApp checkout va directo a wa.me, no depende de Supabase.

---

## 🎉 Sesión mayo 15 2026 — Maratón completo (públicos + admin + QA + incidente)

Sesión cierra de la madrugada anterior (14-may) → tarde-noche del 15-may.
**13 commits live** deployados a `main` en el maratón. SW v1.1.22 → v1.1.39 (17 bumps).
La sesión cubrió desde features premium hasta un incidente urgente con la tablet
del admin colgada, QA exhaustivo automatizado, y rediseño del banner de update.

**Sesión cierre adicional (15-may viernes noche, local cerrado):** 5 commits más cerraron los 3 pendientes flageados. SW v1.1.39 → **v1.1.42** (3 bumps más). Total acumulado: **18 commits live** · 20 bumps de SW. Ver subsección "Sesión cierre 15-may noche" debajo.

### Commits cronológicos

| Commit | Keyword principal | Sección |
|---|---|---|
| `3c9246a` | Pack UX premium (8 keywords) | Features sección A |
| `d1724ae` | `[PWA-AUTO-RELOAD]` | Auto-reload mágico |
| `d4deab5` | `[SIMILARES-CDA]` | Modal Ver similares full premium |
| `be49c34` | docs | Update HISTORIA + CLAUDE |
| `5f6b9f3` | `[SELECCION-BADGE]` | Badge "TOP VENTAS" editable |
| `31f76a7` | `[SW-UPDATE-BANNER]` v1 | Aviso "versión nueva" admin (pill chica) |
| `0338d9c` | docs | Update HISTORIA + CLAUDE |
| `363ce8a` | `[DC-RESPONSIVE-FIX]` + `[DC-PRECIO-GUARD]` | Fix urgente · precio decants diseñador |
| `24db79b` | `[DC-PRECIO-PROMINENT]` | Prioridad visual precio + guardar |
| `03f4947` | docs QA-PRE-JULIO | Checklist 170 items para QA |
| `ccd1cc1` | `[EMERGENCY-BUMP]` | Force update tablet colgada |
| `eaae7cf` | `[SW-BANNER-V2]` + tab Decants empleadas | Rediseño banner + permiso ampliado |
| pendiente | docs | Este update |

### Bugs resueltos

- **[CARD-STRETCH-FIX]** — Card del catálogo se estiraba a 900px de alto cuando filtrabas favoritos y quedaba 1 sola visible. El [CLS-RESERVE] reservaba min-height al grid para evitar layout shift, y la única row visible heredaba esa altura. El botón ❤ fav-toggle activo (bg rojo) aparecía gigante porque la card está stretched. Fix: `align-content: start` + `grid-auto-rows: max-content` en `.catalog-grid` (inline + canónico).
- **[SORTMENU-Z]** — Dropdown "Ordenar" quedaba tapado por las cards del catálogo después de toggle del filtro favoritos. Las cards reciben animation `filter-entering` con transform → crean stacking context propio. El sort-menu tenía z-index:50 dentro de un filter-bar position:static (z-index 90 ignorado). Las cards posteriores en DOM ganaban visualmente. Fix: `.sort-wrapper` con position:relative + z-index:100 + isolation:isolate (stacking context aislado). `.sort-menu` z-index 50→100.

### Features deployadas (orden cronológico)

| Keyword | Qué hace | Commit |
|---|---|---|
| `[DECANTS-UX-2]` | Iter 2 del armador: tabs Catálogo/Mis decants con badge (#4) + combo sugerido sticky "💡 Combinás bien con: X" (#6) arriba del footer. Algoritmo de scoring: marca_real +3, perfil +2, notas comunes +1 c/u (máx +5), cat +1, umbral mínimo score >=2. Empty hero movido ADENTRO del grid scrollable para que en mobile todo scrollee junto. | `3c9246a` |
| `[DISEÑADOR]` | Rename "⭐ Especiales" → "💎 Decants de diseñador" en extras.js (sección título + mensaje WA al vendedor + fallback marca) y en admin.html (título tab "Decants Custom" + copy explicativo claro: "Para decants de diseñador (Jean Paul Gaultier, Creed, Dior, etc.) que NO están cargados al stock regular"). | `3c9246a` |
| `[COMPARE-V2]` | Modal Compare con: **2A** "🔥 Diferencias destacadas" — notas únicas por perfume calculadas contra el set de los otros del compare. Paleta rosa/magenta para distinguir de "comunes" amarillas. **2B** botón "💕 Elegir este" pill dorada al final de cada compare-col que agrega al carrito + cierra modal (cierra el ciclo comparar→decidir→carrito→WA). Mobile responsive verificado: cards apiladas 1col + bloque diferencias 1col por perfume. | `3c9246a` |
| `[SELECCION-PODIO]` | Sección "Selección ST" rejugada: **1A** badge de podio #1/#2/#3 con linear-gradient metálico oro/plata/bronce + border de card matcheando. Cards 4+ siguen sin badge. **1B** quote del jefe en italic Cormorant Garamond debajo del nombre. `applyOverrideToPerfume` lee `nota_jefe` del override (columna SQL ya creada por el jefe). Aparece solo si el quote está cargado. | `3c9246a` |
| `[JUEGOS-3A]` | Move #quizSection desde post-FAQ a antes de #nosotros. JS-move sync inline justo antes de `</body>` = ejecuta tras parseo y ANTES del primer paint → cero FOUC visible. HTML estático quedaba en su lugar (cerrado después por `[JUEGOS-3A-FINAL]` en commit `b162b29` · move físico real al HTML). | `3c9246a` |
| `[JUEGOS-3C]` | CTA banner copy reescrito de pregunta abstracta a imperativo directo: "¿No sabés cuál perfume comprar? · 4 preguntas, 3 recomendaciones, gratis →" + "Jugar" (antes "Probar"). | `3c9246a` |
| `[PWA-AUTO-RELOAD]` | Auto-reload mágico post-SW-update con mitigación. Cuando se deploya versión nueva, SW toma control inmediato (skipWaiting + clients.claim ya estaban en sw.js) y ahora el frontend RECARGA SOLO la página. **Mitigación anti-interrupción**: el reload SOLO ocurre si el cliente NO está interactuando (modal abierto, input/textarea focused, scroll < 3s, first visit sin SW previo). Garantía: el cliente nunca pierde scroll position, datos de formulario, ni armado de pack. La recarga pasa solo cuando él está "leyendo / quieto". Cliente actual con SW viejo necesita F5 una vez para tomar v1.1.32; a partir de ahí TODOS los updates futuros son auto-reload. | `d1724ae` |
| `[SIMILARES-CDA]` | Modal "Ver similares" full premium · combo C+D+A según mockup aprobado: **ring** de % match (oro #ffd700 si pct≥85, dorado si mid, bronce si <70) animado con stroke-dashoffset · **botón "⚖ Comparar"** que mete anchor + similar al compare-bar flotante + cierra el modal de similares · **razón humana** chips de notas compartidas (max 6 + "+N más") · **badges premium con regla "condición fuerte + máx 2 por item"**: 🏆 Mejor match (solo el #1) · 💎 Misma casa (marca_real igual) · 🎯 Mismo perfil (perfil igual + pct≥75 — regla fuerte) · 🔥 El más elegido (en TOP_VENTAS_SLUGS[0..2]). Helpers nuevos: `getCommonNotesList`, `getMatchPct`, `getSimilarityBadges`, `compareSimilar`. | `d4deab5` |
| `[SELECCION-BADGE]` | Texto del badge amarillo de las cards de Selección ST editable desde admin (tab Destacados). Antes hardcoded "HOT SALE", ahora dinámico. Nueva tabla Supabase `seleccion_st_config (id=1, badge_text, updated_at)` single-row con default "TOP VENTAS" + RLS pública. Admin tiene input maxlength=20 con auto-uppercase + botón "💾 Guardar badge" arriba del buscador de perfumes. Frontend: variable global `SELECCION_BADGE_TEXT` con default "TOP VENTAS" + `loadSeleccionStConfig()` vía deferTask. Útil para campañas: HOT SALE / NUEVO / OFERTA / 50% OFF / BLACK FRIDAY. | `5f6b9f3` |
| `[SW-UPDATE-BANNER]` | Aviso "Hay una versión nueva del panel disponible" en admin. A diferencia del [PWA-AUTO-RELOAD] del front público (que recarga sola), en admin la chica decide CUÁNDO actualizar — podrían estar en medio de una venta o editando stock. Pill amarilla sticky-top (gradient + z-index 9999) con ícono 🔄 girando + botón "Actualizar →" + cerrar ×. Lógica: register SW + listener `updatefound` → cuando state=installed Y hay controller previo → muestra banner. Cliente sin SW previo no ve nada (first visit). | `31f76a7` |

### Mockups creados (en `mockups.html` con histórico colapsado)

- **`#mockup-a`** SIMILARES-VISUAL (ring + razón humana)
- **`#mockup-b`** SIMILARES-V2 (algoritmo viejo vs nuevo side-by-side con explicación del scoring)
- **`#mockup-c`** SIMILARES-COMPARE (botón ⚖ Comparar + compare-bar fake)
- **`#mockup-d`** SIMILARES-BADGES (4 badges con gradient distinto)
- **`#mockup-ca`** combo C+A (ring + razón + comparar)
- **`#mockup-cda`** combo C+D+A "full premium" ⭐ (el elegido por el usuario)

Histórico colapsado al final mantiene referencia a iters previos (BANNER-V2, DECANTS-UX-2 etc).

### Pendientes flageados

1. ✅ **CERRADO · `[BUG-DEC-ADMIN]`** — fue resuelto en sesión 15-may noche (commit `4f69dee`). El bug NO era CSS sino HTML estructural: un `</div>` extra en admin.html:2127 cerraba `<main>` implícitamente, dejando 9 tabs huérfanas como siblings del `.app-shell`. Ver entrada en "Bugs significativos resueltos" arriba.
2. ✅ **CERRADO · UI admin para "Quote del jefe"** — implementado en commit `ea42a66` (`[SELECCION-ST-1B]`). Textarea `#editNotaJefe` en modal Editar Perfume (maxlength 180, rows 2) arriba del bloque "Notas de stock". `saveEditPerfume` upsertea en `perfume_overrides.nota_jefe`; audit log incluye "Quote del jefe".
3. ✅ **CERRADO · Move físico HTML del `#quizSection`** — implementado en commit `b162b29` (`[JUEGOS-3A-FINAL]`). 118 líneas movidas del bloque `<section id="quizSection">` desde post-FAQ a entre `#seo-hub` y `#nosotros`. Se eliminaron las 14 líneas del IIFE `moveQuizSection` que vivía antes de `</body>`. Move ejecutado con Node script para preservar HTML entities.
4. **Cargar precios de 2 decants de diseñador faltantes** — LE BEAU LE PARFUM (id 12) y LE BEAU EDT (id 13). Las 2 están con `precio_unit = NULL` en `decants_custom`. Están bloqueadas correctamente por `[DC-PRECIO-GUARD]` (cliente NO puede comprar a $9500 escalera), pero el jefe / chicas deben ir al admin tab Decants → sección Decants de diseñador → cargar precio. ~3 min cada una.

### Incidente nocturno · tablet del admin colgada

**Cuándo**: 15-may noche · post-deploy de `[DC-PRECIO-PROMINENT]` (v1.1.37).

**Síntoma**: Alejo reporta que las chicas ven el panel derecho del admin **completamente vacío** al entrar a la tab Decants. La sidebar carga OK pero el contenido no renderiza.

**Diagnóstico** (con preview tool · 30 min de investigación):
- Verifiqué que el HTML del `#tab-decants` SÍ existe en el DOM (7 children, contenido correcto).
- Reproducí el escenario post-login en preview 800×1280 (Galaxy Tab A9 vertical) y NO encontré bug · todo renderiza correcto (tabDecants 2715×785, 7 secciones visibles).
- **Conclusión: el código está OK. Es cache híbrido** en la tablet de las chicas (SW viejo cacheado + HTML nuevo servido).

**Solución aplicada**:
- `[EMERGENCY-BUMP]` (commit `ccd1cc1`) · bump de SW v1.1.37 → v1.1.38 sin cambios reales · disparó el flujo `[PWA-AUTO-RELOAD]` cacheado en clientes con SW v1.1.32+ · la tablet recargó sola en ~2 min.
- Después se descubrió que el problema real era visual: el panel SÍ renderea pero **MUY ABAJO** del menú lateral (queda como espacio negro arriba). Eso es el bug `[BUG-DEC-ADMIN]` documentado para próxima sesión.

**Lección**: cuando el cliente reporta "panel vacío", verificar PRIMERO con preview tool si el código está OK · si está OK, asumir cache híbrido y forzar update con SW bump · si después de bump sigue mal, es bug visual real.

### QA Pre-Julio · sesión automatizada completa

Después del incidente, Alejo pidió un QA del sitio (público + admin) antes de su viaje a Buenos Aires en julio. Creamos:

1. **`docs/QA-PRE-JULIO.md`** · checklist de **~170 items** organizados en 20 secciones (A-T): admin completo + público completo + perf + PWA + SEO. Items críticos marcados con "CRITICO" · items que requieren tablet real con 🪨.

2. **QA Opción C automatizado** (sin pass admin · solo público) · ~45 min · 14 secciones recorridas con preview tool:
   - ✅ `[CARD-STRETCH-FIX]` confirmado · card 382px (no 900) con 1 favorito
   - ✅ `[SORTMENU-Z]` z-index 100 funciona
   - ✅ `[SIMILARES-CDA]` ring + razón + badges + Comparar funcionan
   - ✅ `[COMPARE-V2]` 3 cards · diferencias · botón "Elegir este"
   - ✅ Armador decants completo (tabs + combo sticky + precio pendiente)
   - ✅ Carrito + buildWaMessage (URL armada correctamente · interceptor bloqueó 1 wa.me)
   - ✅ Selección ST con podio + TOP VENTAS
   - ✅ Juegos ST posición correcta (antes Nosotros y FAQ)
   - ✅ Performance · DOMContentLoaded 147ms · loadComplete 541ms
   - ✅ PWA · SW activated · manifest · theme-color
   - ✅ SEO · title · description · OG · canonical

3. **Bug crítico encontrado**: `[FAQ-LIGHT-LEGIBILIDAD]` · texto de FAQ en light mode es `rgb(224,224,224)` sobre fondo crema · contraste ~1.2:1 (WCAG fail catastrófico). Pendiente fix (Alejo dijo "frenar todo" antes de aplicarlo · queda para próxima sesión).

4. **Bug visual menor encontrado**: combo sticky "Combinás bien con" en armador NO aparece cuando hay SOLO decants de diseñador (customs) en el pack · algoritmo `findCombinaBienCon` salta customs. Mejora futura · no crítico.

5. **Seguridad confirmada**: 0 modificaciones a Supabase · 0 push notifications enviadas · 0 WhatsApp mandados (1 wa.me bloqueado por interceptor) · 0 ruido en realtime de las chicas.

### Decisiones de diseño

- **Regla "condición fuerte" para badges de similares**: badges solo cuando la regla SE CUMPLE FUERTE (Mismo perfil pide pct≥75, no solo perfil igual). Máx 2 badges por item para no saturar. Esta regla la planteó el usuario explícitamente en la elección del mockup C+D+A.
- **Algoritmo Similares mantiene findSimilares() actual** (solo notas, threshold 45%). En la sesión se evaluó [SIMILARES-V2] (algoritmo enriquecido) pero el usuario decidió postergarlo — la mejora visual de C+D+A ya tiene mayor impacto percibido que el cambio de algoritmo "invisible".
- **JS-move vs HTML-move físico** del quizSection: en la sesión maratón se eligió JS-move por ser cero-riesgo (sesión nocturna). En la sesión cierre del 15-may noche se hizo el move físico real con Node script para preservar HTML entities — ver `[JUEGOS-3A-FINAL]` en commit `b162b29`.
- **PWA-AUTO-RELOAD con mitigación**: el usuario pidió explícitamente "que la página se actualice sola sin que el cliente tenga que hacer F5". Se implementó pero con safeguards para no interrumpir interacciones en curso (modal abierto, input focused, scroll reciente).

### Sesión cierre 15-may noche (post-maratón, local cerrado)

Sesión corta para cerrar los 3 pendientes flageados del maratón. **5 commits adicionales** a `main`. SW v1.1.39 → v1.1.42 (3 bumps).

| Commit | Keyword | Cambio |
|---|---|---|
| `4f69dee` | `[BUG-DEC-ADMIN]` | Fix HTML estructural · `</div>` extra en admin.html:2127 cerraba `<main>` implícitamente · 9 tabs huérfanas (votación/push/espera/doctor/decants/auditlog/analytics/backups/puntos) eran siblings del `.app-shell` · 1 línea borrada → 20 tabs todas hijas del main. Descubierto verificando una propuesta de fix CSS con `preview_eval` (la causa real era HTML, no CSS). |
| `bca6c48` | follow-up | Docs en HISTORIA.md + reindent cosmético de 9 tabs (indent 2 → 4) con Node script. |
| `ea42a66` | `[SELECCION-ST-1B]` | UI admin para `nota_jefe` · textarea en modal Editar Perfume con maxlength 180, rows 2. Cierra el cabo suelto de `[SELECCION-PODIO]` (el frontend ya leía `p.nota_jefe` desde v1.1.30 pero faltaba forma de cargarlo sin SQL). |
| `b162b29` | `[JUEGOS-3A-FINAL]` | Move físico HTML del `#quizSection` con Node script (preserva HTML entities `&#225;`, `&aacute;`, etc.). 118 líneas movidas + 14 líneas del IIFE `moveQuizSection` eliminadas. Cierra `[JUEGOS-3A]`. |
| `ac0b3ed` | docs | HISTORIA.md tabla SW v1.1.41-42 + keywords nuevas en sección "Keywords para retomar". |

**Metodología destacada**:
- El bug `[BUG-DEC-ADMIN]` se atacó armando primero **3 mockups en `mockups.html`** (A overlay fixed / B drawer hamburguesa siempre / C grid fix conservador). Alejo eligió C. Mientras se verificaba C con `preview_eval`, se descubrió que el bug NO era el que pensábamos (no era CSS · era HTML). El proceso de mockups + verification en preview pagó.
- Los moves grandes (118 líneas con caracteres especiales del quiz; 447 líneas de reindent) se hicieron con **scripts Node temporales** (`.tmp-*.js`, borrados tras correr) — Edit grande de HTML con entities es propenso a fallar.

**Lección concreta**: los bugs visuales "raros" del admin no siempre son CSS. Verificar siempre la estructura DOM real con `preview_eval` antes de asumir causa.

### Sesión 15-may noche → 16-may madrugada · **Maratón Lighthouse** (8+ hs)

Sesión maratónica de optimización post reporte de PageSpeed Insights del usuario. Empezó con Mobile Performance **53.6%** estable (mediana de 5 mediciones) y CLS catastrófico **0.978**. Terminó con **100% Performance Mobile + 100% Accesibilidad + 100% Best Practices + 100% SEO** medidos en preview Vercel. **~11 commits** + reverts varios. **SW v1.1.42 → v1.1.53** (11 bumps).

#### Cronología cronológica resumida

| Versión | Resultado | Aprendizaje |
|---|---|---|
| v1.1.43 | ❌ -21 Performance | NUNCA subir `min-height` del `.hero` · dispara layout-recalc raro que Lighthouse atribuye como shift gigante (CLS 0.132 → 0.957) |
| v1.1.43 | ❌ FCP +1.7s | NUNCA usar `font-display: optional` · el block period de ~100ms con texto invisible se interpreta como shift gigante del container |
| v1.1.44 | = CLS sin cambiar | Cuando hacés revert parcial, mediálo · si NO cambia la métrica que querés arreglar, el culpable era OTRO de los cambios (no el que revertiste) |
| v1.1.45 | ✅ recuperado | Rollback total a estado conocido bueno > intentar fixes quirúrgicos a ciegas. Más rápido y predecible. |
| v1.1.46-48 | ❌ peor que el inicio | Cada cambio CSS/HTML al hero (logo aspect-ratio, min-height al quiz-cta, etc) introducía regresión · imposible aislar con más de 1 cambio simultáneo |
| v1.1.49 | ✅ estable 53.6 | El rollback + resize masivo de imágenes (cambio SOLO binario, NO toca CSS/HTML) fue lo único que se mantuvo · principio: **cambios solo a archivos binarios son safe** |
| v1.1.50 | [BATCH-REFLOW] | Identificar antipattern read-after-write en loops de DOM y refactorizar a batch (todas las lecturas primero, después escrituras) · -140ms TBT |
| v1.1.51 | [HERO-SUB-MOVE] | El texto largo de 5-8 líneas dentro del hero (que swappeaba con las fuentes) era el principal driver del CLS · moverlo a otra sección lo eliminó SIN perder SEO |
| v1.1.52-53 | ✅ 100% Mobile | Sin el `<p>` largo, el hero necesita poco alto · ELIMINAR min-height + bajar padding · el contenido natural (textos cortos de 1 línea c/u) NO causa shift por swap |

#### Commits clave que SOBREVIVIERON al cierre

| Commit | Keyword | Por qué quedó |
|---|---|---|
| `0e69ecc` (eventualmente rebased) | `[CATALOG-IMG-RESIZE]` | 344 fotos del catálogo 3.69 MiB → 1.86 MiB (-50%) · sólo binarios |
| `8449850` | `[BATCH-REFLOW]` | -140ms TBT en filtros del catálogo · cambio en JS aislado |
| `4666fe5` | `[HERO-SUB-MOVE]` | Texto del hero → sección Nosotros · SEO mantenido |
| `50c2f80` | `[HERO-COMPACT]` | Eliminar min-height del hero + padding-bottom reducido |

#### 🚨 Reglas de oro grabadas a sangre (NUNCA OLVIDAR)

1. **NUNCA subir el `min-height` del `.hero`**. Dispara un layout-recalc raro que Lighthouse atribuye como CLS gigante del `<section class="hero">`. Bajar / quitarlo está OK, pero subir CONFIRMADO que rompe (probado 3 veces).

2. **NUNCA usar `font-display: optional`** en este sitio. El block period de ~100ms con texto invisible se interpreta como shift catastrófico. Mantener `swap`.

3. **NUNCA medir en el dominio main si estás validando un fix en branch**. Vercel genera preview URLs (`xxx.vercel.app`) específicas para cada branch. Medir el preview, no el main, sino estás midiendo la versión sin tu fix. Esto le pasó al usuario y nos costó ~2 hs de confusión.

4. **SIEMPRE tomar mediana de 3-5 mediciones** de Lighthouse. La variabilidad entre runs es ±15-25 puntos (más alto si las métricas son borderline). Un single run no es confiable. Especialmente la primera medición tiende a ser outlier (alta) por cache de PageSpeed.

5. **NO meter más de 1 cambio CSS/HTML/layout simultáneamente** cuando estás debuggeando performance. Si rompe, imposible aislar el culpable. Cambios en código JS (sin tocar layout) pueden combinarse si están bien acotados.

6. **Cambios SOLO a archivos binarios (imágenes) son seguros**. Mientras los paths se mantengan idénticos, no afectan layout / CSS / JS / timing. Resize, recompresión, optimización · todo bien.

7. **Reflows forzados (`void el.offsetWidth`) dentro de loops son antipattern grave**. Si tenés `forEach` sobre N elementos con reads-after-writes de DOM, son N reflows. Batchear: leer todo primero, hacer 1 reflow en el contenedor padre, después escribir todo. Patrón general aplicable a cualquier sitio.

#### Metodología que funcionó al final

- Branch separada para experimentos riesgosos (`fix/perf-batch-reflow-catalog`)
- Preview deployment de Vercel para medir antes del merge
- Crear PR (no para review humano · solo para que Vercel postee el preview URL automáticamente en el bot comment)
- Medir múltiples runs en el preview URL
- Solo mergear si la mediana sube
- Si no sube · descartar branch sin penalty

#### Pendientes para próxima sesión chica

- **Cache-Control en bucket `perfume-fotos` de Supabase Storage** · hoy responde con `max-age=3600` (1h) y `no-cache` · debería ser `public, max-age=604800, immutable` (1 semana). Requiere UI del dashboard. Ahorra -66 KiB en visitas repetidas.
- **A11y 92 → 100** · 5 contrastes que faltan (`.tag-acorde`, `.occasion-label`, `.cat-count`, `.wa-status--closed`, `.badge-sin-stock`). Todos son cambios de color, cero riesgo.
- **Logo @2x retina** · re-generar `img/logo-st@2x.webp` (384×292, 27 KiB) sin tocar manifest ni HTML estructural.
- **Imágenes Supabase Storage con `?width=400` transforms** · Image Transformations ya está habilitado · ahorra -150 KiB extra en fotos servidas desde el bucket.
- **JS-CHUNK iter 2** · mover quiz + juegos ST + custom cursor + compare modal + share/sharePerfume a `extras.js` lazy-load.

---

### Sesión 16-may noche · **Light Mode Rework** (Opción B Cream)

Refactor completo del light mode pedido por Alejo después del Maratón
Lighthouse del mismo día. Estado previo: light existía pero con "excepciones
del jefe" documentadas que dejaban cards/banners oscuros sobre body cream
(trust-badges, cat-cards, banner EXPLORÁ, puntos banner). Alejo revocó la
excepción y pidió coherencia visual completa.

**~12 commits** · branch `feat/light-mode-cream-revert-excepciones` mergeada
en 2 partes: PR #2 (commit `54f02e1`, 5 commits iniciales) + merge --no-ff
(commit `84eb66c`, 7 commits posteriores). SW v1.1.53 → v1.1.64 (11 bumps).

#### Bug raíz · cómo se descubrió

Después de varios overrides fallidos, Alejo reportó con screenshots que las
secciones SEGUÍAN oscuras. Diagnóstico final con `preview_eval` inspeccionando
DOM real en la URL preview Vercel del usuario:

```
body_classes: "is-guest"  (sin .dark-mode · light mode activo)
body_bg:      "rgb(18, 18, 20)"  (#121214 DARK · MAL)
sections bg:  transparent ✓ (heredan body · pero body sigue dark)
```

**Causa:** en `index.html:424` el critical CSS inline tenía:
```css
body.is-guest { background: #121214; }
```

Esa regla pinta dark el body para users no logueados IGNORANDO el modo.
Ganaba en cascade contra `body:not(.dark-mode) { background: #e3d6b3 }` de
styles.css porque:
- Same specificity (0,1,1 ambos)
- El `<style>` inline está DESPUÉS del `<link>` a styles.css (línea 422 vs
  416) · last wins en CSS cascade.

**Fix (commit `29d25f3` · v1.1.60):**
1. Inline cambió a 2 reglas más específicas:
   ```css
   body.is-guest.dark-mode { background: #121214; color: #f0ede8; }
   body.is-guest:not(.dark-mode) { background: #e3d6b3; color: #1a1a1d; }
   ```
2. HTML `<body>` arranca con `class="is-guest dark-mode"` (evita flash
   cream→dark al cargar).
3. JS init quita `dark-mode` del body si user eligió light (saved === '0').

#### Keywords cerrados en la sesión

| Keyword | Qué hace |
|---|---|
| `[LIGHT-COHERENT-CREAM]` | Opción B del mockup · TODO cream con dorado-marrón #8a6d00 |
| `[LIGHT-TOGGLE-V2]` | Botón nav: circle amarillo → pill amarilla con texto "LIGHT/DARK" |
| `[LIGHT-CONTACTO-TEXT]` | Override del em "Consultános" con style inline color amarillo |
| `[LIGHT-CAT-CARDS-CREAM]` | Fix de override viejo `#f0ede8` (texto claro) en cat-cards que ahora son cream |
| `[LIGHT-SECTIONS-FORCE]` | `!important` en bg transparent de 11 secciones + h2 a dark |
| `[LIGHT-BUG-RAIZ]` | El bug del `body.is-guest` inline (causa raíz · 4hs de debug) |
| `[LIGHT-DESKTOP-TWEAKS]` | Push banner "novedades" letras blancas + FAQ max-width: none |
| `[LIGHT-DESKTOP-TWEAKS-2]` | price-banner-cta gris #bbb + FAQ full-width en LIGHT y DARK |
| `[LIGHT-CTA-POP]` | Botones "VER CATÁLOGO" + "JUGAR" gradient dorado vibrante + pulse |
| `[QUIZ-SECTION-COMPACT]` | Padding/gap reducido en #quizSection desktop (era espacioso) |

#### 💬 Mensaje al Alejo / Claude del futuro

**Sobre Performance:** esta sesión tocó MUCHO el sitio (CSS + HTML + JS). El
día anterior llegamos al 100% Performance Mobile en preview, pero NO se
re-midió post Light Mode Rework. Es **muy probable que haya bajado** del
100% por el peso CSS extra + las animaciones (pulse en CTAs). Verificar
en sesión próxima con cabeza fresca · no hoy. Si bajó, considerar:
- Mover los overrides masivos de light a un archivo aparte cargado lazy
- Bajar la complejidad del pulse animation (`will-change: transform`)
- Auditar el critical CSS inline (tiene cosas que ya no aplican)

**Sobre Light Mode futuro · qué NO volver a hacer:**
1. **NO invertir colores "al boleo"** · el jefe lo dijo textual: "no es que se
   invierten todos los colores así al boleo, aparte no entiendo por qué algunos
   cuadrados se pintan como ignorando el fondo". Las cards decorativas pueden
   estar bien siendo "islas" intencionales · o NO · depende del diseño final.
   SIEMPRE proponer mockups primero.
2. **NO asumir que el bg del body es transparent · puede estar pisado por
   critical CSS inline.** Cuando una sección sigue dark a pesar de overrides
   sin éxito · inspeccionar TODOS los `<style>` inline del `<head>`, no solo
   `styles.css`.
3. **El cascade del CSS sí importa con specificity igual.** Inline `<style>`
   después de `<link>` gana. Si querés que styles.css sea la fuente de verdad,
   o lo movés ANTES del inline, o usás `!important`, o aumentás specificity.

**Sobre el flow de mockups:**
- El usuario ELIGIÓ Opción B (coherente cream) en el mockup pero después
  pidió cambios contradictorios (los CTAs "no destacaban" → +pulse · el
  banner "EXPLORÁ" pasó a cream pero se notaba menos). Tener en cuenta que
  un mockup es UN STILL PUNTO en el tiempo · el diseño final puede iterar.
- Cuando hay 3 opciones en mockup, hacer una versión visualmente comparable
  side-by-side · NO solo descripción texto.

**Cosas que se SABEN pero pueden olvidarse:**
- En light mode, los textos amarillos (`#E8B800` `--amarillo`) sobre cream
  se ven DILUIDOS. Usar siempre `#8a6d00` dorado-marrón para acentos.
- El subtítulo "Los más elegidos por nuestros clientes" tenía `var(--gris-claro)`
  inline · en light eso se redefine a `#2a2622` (oscuro · OK sobre cream).
- El banner "EXPLORÁ" tiene un eyecatcher amarillo en dark · en light
  pierde el "grito" porque cream es más sutil. Si el jefe quiere CTA fuerte
  en light, hay que destacarlo aparte (como hicimos con [LIGHT-CTA-POP]).

#### Pendiente flageado en esta sesión

- **`#quizSection` espaciosidad iter 2** (si el ajuste actual de
  [QUIZ-SECTION-COMPACT] no fue suficiente) · queda para sesión próxima.
- **Re-medir Performance Lighthouse después de toda esta tanda de Light Mode.**
  Posible regresión por peso CSS. Si baja, ver bullet "Sobre Performance"
  arriba.

---

### Sesión 18-may-2026 · **CLS Reserve Banners** (mobile fixed · desktop pendiente)

Sesión de validación post Light Mode Rework. Confirmada regresión CLS
catastrófica · diagnosticada raíz · fix quirúrgico mobile mergeado a main.

**Antes (producción · 5 runs PSI mediana):**

| Métrica  | Mobile | Desktop |
|---|---|---|
| Score    | **49** | 71 |
| **CLS**  | **1.044** 🔥 | 0.905 🔥 |
| TBT      | 70ms ✓ | 80ms ✓ |
| FCP / LCP | 3.3 / 4.6 s | 0.5 / 1.1 s |

**Después (producción post-merge `a761035` · 5 runs limpios PSI+LH):**

| Métrica  | Mobile | Desktop |
|---|---|---|
| Score    | **84** (+35) | sin cambio significativo |
| **CLS**  | **0.025** (-97%) ✓ | **~0.9** (no resuelto) |
| LCP      | 2.45s | sin cambio |

#### Causa raíz (3 elementos above-the-fold sin altura reservada)

Cuando `styles.css` carga lazy (preload+onload) y Supabase devuelve datos,
3 elementos crecen y empujan todo abajo en cascada:

1. **`<section class="trust-badges">`** · arrancaba con `height: 0` (vacío)
   y crecía a **240px mobile / 135px desktop** al renderear 4 cards desde
   Supabase. El culpable principal · empujaba el quiz-cta-banner ~280px.
2. **`button.quiz-cta-banner`** · crecía de `<button>` plano sin styles
   (~40-60px) a flex column con padding/gradient (**235px** mobile real /
   110px desktop). Shift score consistente 0.2035 en todos los runs.
3. **`.price-banner--big`** · similar · crecía a **129px** mobile /
   98px desktop.

#### Fix · 1 sola edición al critical CSS inline

Agregar `min-height` reservado en el `<style>` inline de `index.html`
(commit `a761035`, líneas 446-450):

```css
.trust-badges                                  { min-height: 250px; }
.quiz-cta-banner                               { min-height: 240px; }
.price-banner-wrap--big .price-banner--big     { min-height: 135px; }
@media (min-width: 768px) {
  .trust-badges                                { min-height: 145px; }
  .quiz-cta-banner                             { min-height: 115px; }
  .price-banner-wrap--big .price-banner--big   { min-height: 105px; }
}
```

Mismo patrón que `.catalog-grid` desde `[CLS-RESERVE]` del Maratón
Lighthouse (commit `50c2f80`).

#### Iteraciones · v1 falló · v2 funcionó

| Iter | Valores | CLS local | ¿Por qué? |
|---|---|---|---|
| v1 (commit `d4794e9`, después squashed) | quiz 210 / price 95 mobile | 0.227 (igual) | Solo reservaba 2 banners · faltaba trust-badges (el principal) · y los valores estaban subestimados (real 235 vs reserva 210) |
| v2 (commit `c03ba02`, después squashed) | trust 250 / quiz 240 / price 135 | **0.025** ✓ | Identificado culprit real (trust-badges 0→240px) + bumpeé valores al real medido con `preview_inspect` |

#### 🚨 Pendiente desktop · culprit distinto

Desktop CLS post fix v2 sigue ~0.9 (no mejoró). Lighthouse local desktop
mostró top shifts:
- `svg.search-icon` (filter del catálogo · `div#catalogo > div.filter-zone > div.search-wrapper > svg.search-icon`) · score **0.858** · IDENTIFICADO COMO PRINCIPAL CULPRIT DESKTOP
- `section#destacados` (Selección ST) · score 0.24

El catálogo entra above-the-fold en desktop (viewport más alto) y el SVG
del search icon shiftea cuando styles.css aplica. **Próxima sesión**
debe atacar:
1. Verificar que `svg.search-icon` tenga `width`/`height` attrs o reservar
   en CSS · es shift clásico de SVG sin dimensions
2. Reservar `min-height` del `.seleccion-st-grid` similar a este fix

#### ⚠️ PSI dashboard sigue og:url y JSON-LD URLs

Descubierto durante esta sesión: PSI cuando le pegamos un preview URL
(con canonical o `og:url` apuntando a `www.stperfumeria.com`), a veces
sigue ese link y mide producción en lugar del preview. 3 de 5 mobile
runs y 5 de 5 desktop runs mid producción aún después de comentar el
canonical · porque quedaban 32 referencias absolutas a producción en
`og:url`, `og:see_also`, JSON-LD `@id`/`url`.

**Workaround para próxima sesión**: si necesitás medir un preview con
PSI dashboard, comentar TAMBIÉN `og:url` + `og:see_also` (o usar
Lighthouse CLI local apuntando al preview URL — Lighthouse CLI NO sigue
canonical ni og:url).

**Alternativa más sostenible**: mergear el fix a main y medir en `main`
directo · ahí PSI no tiene canonical externo a seguir porque `main` ES
el canonical. Eso fue lo que hicimos en esta sesión.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[CLS-BANNERS-RESERVE]` | Reserva min-height para los 3 elementos above-fold mobile (trust-badges + quiz-cta-banner + price-banner--big) en critical CSS inline · -97% CLS Mobile · score +35 |

#### 💬 Mensaje al Alejo / Claude del futuro

**Sobre `preview_inspect`:** invaluable herramienta para medir alturas
reales antes de reservar min-height. La sesión perdió 1 hora con valores
guesseados (v1) hasta que medí con `preview_inspect` mobile 375 + desktop
1280 (v2) que funcionó al primer intento. Patrón replicable: cuando
necesitás reservar altura para CLS, levantar preview local con server
(Python http.server es más confiable que `npx serve` en Windows) y
medir con `preview_inspect` antes de adivinar valores.

**Sobre PSI dashboard vs Lighthouse CLI local:**
- Lighthouse CLI local: NO sigue canonical/og:url · mide la URL exacta que
  le das · TBT inflado por load de la máquina (mi run dio TBT 5000ms) pero
  CLS confiable (mismos ±0.05 que PSI lab).
- PSI dashboard: SI sigue canonical/og:url heurísticamente · TBT real ·
  pero puede medir otra URL sin avisar.
- **Conclusión**: para CLS validation, Lighthouse CLI local es más confiable.
  Para score absoluto / TBT, PSI dashboard es la verdad.

**Sobre el flow de revert-temp-canonical:** comentar el canonical en un
commit temporal funciona PARCIALMENTE · PSI a veces sigue otros tags
(og:url, JSON-LD). Si necesitás validación 100% del preview, hay que
comentar también og:url + og:see_also. O directamente medir `main`
después del merge (lo que terminamos haciendo).

**Sobre el merge approach:** el squash a 1 commit ÚNICO en main funciona
limpio · el commit del fix incluye TODA la historia del debugging (v1, v2,
mediciones, lecciones) en el body. Mejor que dejar 4 commits intermedios
contaminando history.

---

## 🎓 Lecciones meta

1. **No empezar por la UI.** Diseñar la DB primero. Lo aprendí con la tabla de puntos que se replanificó 3 veces.
2. **CSS modular desde el día 1.** El monolito de 6700 líneas fue invivible cuando agregamos light mode.
3. **Light mode debería haberse pensado al inicio**, no como retrofit. 200+ overrides después estoy aprendiendo.
4. **RLS desde el día 1**. Cada tabla nueva con policies. Aprendí con el bug de `ajuste_horario`.
5. **Convos chicas con Claude.** Una conversación gigante (esta misma) es invivible para retomar contexto.
6. **Linear / Notion fuera del chat.** Pendientes que vayas pensando NO van en el chat — se pierden.
7. **Mockups en UN solo archivo `mockups.html`.** Convención acordada mayo 2026: cuando Claude necesite hacer un mockup standalone, lo agrega como sección/tab interna a `mockups.html`, no como archivo nuevo. Evita que se acumulen `mockup-zapato.html`, `mockup-catalogo-issues.html`, etc. — esos 2 quedan como histórico hasta que ya no sirvan de referencia, después se borran. Si todavía no existe `mockups.html` cuando se necesite hacer el primero "post-convención", crearlo entonces. Cada sección dentro del archivo tiene su propio anchor (#nombre-feature) para linkear.

8. **Lighthouse mobile es notoriamente ruidoso** (±15-25 puntos entre runs). Aprendí por las malas: 1 medición single dio 91 (era outlier), 4 mediciones consistentes dieron 50. **Regla**: SIEMPRE 3-5 mediciones para tomar mediana antes de declarar regresión o mejora. La primera tiende a ser outlier alta (cache de PageSpeed Insights).

9. **NUNCA medir el dominio main si estás validando una branch.** Vercel genera preview URLs específicas. Medir el preview, no el main. Esto le pasó al usuario en esta sesión y costó ~2 hs de confusión (estaba midiendo www.stperfumeria.com pensando que estaba evaluando el fix de la branch).

10. **El `<section class="hero">` de este sitio NO tolera min-height alto.** Subir el min-height dispara un layout-recalc que Lighthouse atribuye como CLS gigante. Probado 3 veces, falló 3 veces. Bajarlo o quitarlo está OK. Si necesitás resolver shift del hero · es por contenido interno que cambia con swap de fuentes · la solución es **achicar el contenido** (textos cortos en 1 línea no shiftean) o **moverlo fuera del hero**.

11. **Reflows forzados (`void el.offsetWidth`) en loops son antipattern grave.** Si los necesitás para re-arrancar animaciones CSS, hacer el reflow UNA VEZ en el contenedor padre (afecta a los hijos automáticamente), después aplicar las clases. Patrón general para cualquier loop de DOM.

12. **Para experimentos riesgosos de performance: branch + preview Vercel + medir antes del merge.** Si el preview no muestra mejora, descartar branch sin penalty. Si muestra mejora, mergear. Crear el PR no es para review humano · es para que Vercel postee el preview URL en el bot comment automáticamente.

---

### Sesión 20-may-2026 · **LOGIN-RETRY-SP** (Plan A · reintento silencioso por latencia Supabase)

Sesión corta de fix focal, **diseñada con otra instancia de Claude (ClaudeChat)** que armó el plan y la modificación de `admin.html`. Yo (Claude Code) ejecuté el deploy con una mejora de telemetría adicional. Archivos de referencia preservados en `RECOMENDACIONES_CLAUDECHAT/` (incluye `Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md` para contingencia futura).

#### Causa raíz · NO es un bug

Empleados en tablets/celulares del local veían el cartelito **"Supabase no respondió. Probá de nuevo en unos segundos."** **casi siempre al ingresar al panel admin** (al poner password). Reintentando, entraban.

Diagnóstico (ClaudeChat): la base de Supabase está en **`us-west-2` (Oregon)**, lejos de Argentina (~250ms latencia base). Con el WiFi del local titubeando, el timeout de **8s** del `_loginWithTimeout` se pasaba intermitentemente. No es bug · es latencia.

#### Plan A · este commit (`267e7e2`)

Fix quirúrgico en `admin.html` líneas 2958-3006 · 1 sola zona del archivo (~40 líneas de diff). Sin tocar DB, sin tocar usuarios, sin tocar catálogo público, totalmente reversible con `git revert`.

**Cambios:**
1. Refactor de la lógica de login a `async function _doAuthOnce()` que prueba jefe → empleado y retorna `'jefe'`/`'empleado'`/`null`. Arroja `Error` SOLO en timeout/red, NO con pass incorrecta.
2. **Loop de hasta 2 intentos.** Si el 1ro lanza por timeout, espera **1.2s** y reintenta una vez en silencio. El empleado ve un breve "Reintentando…" en el `errEl`.
3. **Timeout 8s → 10s** (margen más generoso).
4. Mantiene la regla anti-lockout · **timeout NO cuenta como intento fallido**. Pass incorrecta sigue contando como antes.
5. Pass incorrecta NO dispara reintento (las credenciales no cambian entre intentos consecutivos).

**Mejora agregada `[LOGIN-RETRY-TELEMETRY]` por Claude Code:** flag `hadRetry` + `notifyTelegram` cuando el reintento es exitoso. Telemetría real para decidir si Plan B se justifica:
- Si llegan muchos Telegram "⚠️ Login admin OK pero requirió reintento" por semana → Plan B (migración a São Paulo) se justifica.
- Si llegan 1-2 por mes → Plan A es suficiente.

#### Plan B · contingencia documentada · NO ejecutar sin OK

Playbook completo en `RECOMENDACIONES_CLAUDECHAT/Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md`. Resumen:
- Crear nuevo proyecto Supabase en `sa-east-1` (São Paulo · mucho más cerca de Argentina, ~30-50ms vs 250ms actuales).
- Migrar schema, data, funciones (`send_telegram`...), bucket `perfume-fotos`.
- **Punto delicado:** migrar usuarios con sus **contraseñas encriptadas intactas** (que nadie tenga que resetear).
- Cambiar URL + clave anon en env vars de Vercel.
- Corte estimado <15 min en horario muerto.
- NO dar de baja el proyecto viejo hasta confirmar que el nuevo anda 100%.

#### Qué validar después de unos días en producción

1. Contar cuántos Telegram "Login admin OK pero requirió reintento" llegaron por semana.
2. Si las chicas siguen reportando el cartelito rojo · entonces Plan A no alcanzó · activar Plan B.
3. Si NO hay reportes ni Telegrams de reintentos · Plan A resolvió el problema.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[LOGIN-RETRY-SP]` | Loop de hasta 2 intentos de login admin · reintenta solo en timeout/red, NO en pass incorrecta · UX "Reintentando…" · timeout 10s · NO cuenta timeout como fail · commit `267e7e2` |
| `[LOGIN-RETRY-TELEMETRY]` | notifyTelegram cuando un reintento es exitoso · permite medir frecuencia del problema en producción · mejora agregada al Plan A original |

#### 💬 Nota meta · trabajando con otra instancia de Claude

Esta sesión funcionó como **handoff Claude ↔ Claude vía Alejo + archivos en `RECOMENDACIONES_CLAUDECHAT/`**. ClaudeChat hizo diagnóstico + diseño + escritura del prompt + edición del `admin.html`. Claude Code (yo) hizo: ejecución del deploy + mejora telemetría + documentación.

Pattern replicable cuando hay un problema que necesita **análisis profundo y diseño cuidadoso** (mejor cabeza fresca / contexto separado): ClaudeChat propone, Alejo valida, Claude Code ejecuta. Los archivos `Prompt_para_ClaudeCode_*.md` que prepara ClaudeChat son **especialmente útiles** porque incluyen explícitamente "qué SÍ hacer", "qué NO hacer todavía", y "cómo verificar". Sin ellos, Claude Code podría arriesgarse a hacer más de lo necesario.

#### Quick wins post LOGIN-RETRY-SP · 3 fixes adicionales en la misma sesión

Después del deploy del Plan A, Alejo pidió atacar 3 pendientes en orden mientras esperaba el horario muerto para el Plan B Supabase São Paulo:

**1. `[CACHE-CONTROL-1W]`** · commit `f4edd3d` · SW v1.1.67 → v1.1.68
- Causa: bucket Supabase Storage `perfume-fotos` servía archivos con `Cache-Control max-age=3600 no-cache` (1h) porque ningún `upload()` del admin seteaba `cacheControl` explícito · Lighthouse marcaba -66 KiB en visitas repetidas
- Fix: 3 llamadas a `sb.storage.from('perfume-fotos').upload()` en admin.html (líneas 5420, 6174, 8157) ahora pasan `cacheControl: '604800'` (1 semana)
- **Sinergia con Plan B**: el script de migración a São Paulo va a re-uploadear todos los archivos del bucket viejo al nuevo CON cacheControl 1 semana también · resultado: TODO el bucket nuevo nace con cache largo sin trabajo extra.

**2. `[A11Y-CONTRAST-5]`** · commit `d7df0a2` · SW v1.1.68 → v1.1.69
- Causa: 5 contrastes WCAG insuficientes que mantenían A11y en 92 (HISTORIA.md sección antigua línea 729)
- Fix: 5 selectores en `css/styles.css`:
  - `body.dark-mode .tag-acorde` · `#777` → `#b0b0b0`
  - `body.dark-mode .occasion-label` · `#666` → `#b0b0b0`
  - Nuevo override: `body.dark-mode .cat-count` · `#b0b0b0` (light ya tenía override dorado-marrón)
  - `.wa-status--closed` split en 2: light `#c0392b` / dark override `#ff7466`
  - `.badge-sin-stock` background `#e74c3c` → `#c0392b` (white text sobre #c0392b = 5.74:1 vs 3.96:1 anterior)
- Validación pendiente · Alejo mide PSI a11y · debería subir a 100.

**3. `[CLS-DESKTOP-ITER3]` + `[CLS-DESKTOP-ITER4]`** · commits `93d0caf` + `8a652fd` · SW v1.1.69 → v1.1.71
- Causa: tras el fix mobile del 18-may, desktop seguía con CLS ~0.9 · top culprit Lighthouse: `svg.search-icon` (score 0.858) + `section#destacados` (0.24)
- Iter 3: agregar `width="16" height="16"` al SVG search-icon + reservar `.search-wrapper` position relative + `.search-icon` position absolute + dims en critical CSS inline · ATACÓ exitosamente el SVG (ya no aparece como top shift) · pero la sel ST sigue
- Iter 4: agregar `section.seleccion-st { min-height: 580px mobile / 520px desktop }` al critical CSS · reservar la SECTION completa no solo el grid interior
- **Resultado parcial**: CLS desktop **0.91 → 0.86 (-5%)** · el shift sigue siendo `section#destacados` score 0.81 · pero ahora el rect dice h=520 (mi reserve aplicó) lo que sugiere que el culprit real es OTRO elemento above-fold que se mueve y arrastra todo
- **NO resuelto** · queda iter 5 con análisis profundo (probables culprits: `section.hero` font swap de Playfair Display · `section.section-cats` sin min-height · `home-top-banner` que aparece dinámicamente)
- Lección: `preview_inspect` puede dar **medidas erróneas** cuando los styles no terminaron de aplicar (vi `nav height 349px` que es imposible en producción real · el browser headless midió HTML semi-pintado)

**Keywords cerrados de esta sesión:**
| Keyword | Qué hace |
|---|---|
| `[CACHE-CONTROL-1W]` | Uploads del admin con cacheControl 1 semana · ahorra 66 KiB en visitas repetidas · sinergia con Plan B |
| `[A11Y-CONTRAST-5]` | 5 contrastes WCAG arreglados para llegar a A11y 100 · solo cambios de color, cero impacto layout |
| `[CLS-DESKTOP-ITER3]` | Reserva search-icon SVG + dims + position en critical CSS · atacó exitosamente el shift del search-icon (0.858 → 0) |
| `[CLS-DESKTOP-ITER4]` | Reserva section.seleccion-st 580/520 mobile/desktop · mejoró parcialmente pero shift sigue por culprit no identificado |

---

**Última actualización:** Mayo 20, 2026 — sesión 5 commits productivos: `[LOGIN-RETRY-SP]` Plan A login con reintento silencioso (con ClaudeChat) + `[CACHE-CONTROL-1W]` uploads con cache 1 semana + `[A11Y-CONTRAST-5]` 5 contrastes WCAG arreglados + `[CLS-DESKTOP-ITER3]` search-icon SVG + `[CLS-DESKTOP-ITER4]` section.seleccion-st parcial. SW v1.1.66 → **v1.1.71** (5 bumps). Plan B Supabase São Paulo **agendado para esta noche** post-horario perfumería · ver sección "⭐ SESIÓN PRIORITARIA AGENDADA" abajo en handoff. **CLS Desktop sigue ~0.86 sin resolver** (iter 5 pendiente · análisis profundo del culprit real arriba de #destacados). Mobile CLS 0.025 sigue intacto desde 18-may.
**Próxima revisión cuando:** ⭐ **PRIMERA prioridad: Plan B Supabase migración** (esta noche o cuando esté off de perfumería) · **CLS Desktop iter 5** (identificar culprit arriba de destacados con DevTools Performance trace, NO con preview_inspect) · validar telemetría Plan A (sigue válido independiente del Plan B) · `[SW-BANNER-SMART]` defer banner si chica está activa · logo @2x retina · imágenes Supabase con `?width=400` · JS-CHUNK iter 2 · BCRYPT-MIGRATION · SUPABASE-AUTH.

---

### Sesión 21-may-2026 · **Plan B Supabase São Paulo · COMPLETADO** + 🚨 **descubrimiento `[SECURITY-AUDIT-S1]`**

Sesión nocturna · extensión natural de la sesión del 20-may. Alejo ejecutó el Plan B Supabase (migración productiva us-west-2 Oregon → sa-east-1 São Paulo) entre las 4:30 y 5:30 AM ART, siguiendo el playbook v2 paso por paso. AL FINAL de la sesión, Alejo detectó un issue de seguridad CRÍTICO que dispara una nueva sesión dedicada · `[SECURITY-AUDIT-S1]`.

#### Plan B · ejecución del playbook v2 (`RECOMENDACIONES_CLAUDECHAT/Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md`)

**Pre-requisitos** completados (con dificultades menores):

1. **Instalación PostgreSQL 18 client tools en Windows** · Alejo tuvo que instalar (`postgresql-18.x-windows-x64.exe`) desmarcando "PostgreSQL Server" y dejando "Command Line Tools". El installer NO actualizó PATH automáticamente · workaround temporal: `$env:Path += ";C:\Program Files\PostgreSQL\18\bin"` en cada sesión PowerShell. Permanente: agregar manualmente a System → Environment Variables.

2. **`pg_dump` y `psql` desde Git Bash de Claude Code** · no estaban en el PATH del bash · workaround: `export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"` en cada comando bash. PostgreSQL detectado: 18.4 (Windows client) conectando a server 17.6 (Supabase) · compatible.

3. **Archivo `D:\tmp\plan-b-credentials.txt`** · creado por Alejo con Bloc de notas para anotar las 8 strings críticas (URLs + keys + DB passwords de ambos proyectos). Borrado al final de la sesión por seguridad.

4. **`D:\tmp\.env`** · creado por Alejo después con las service_role keys + URLs · used by Node scripts. Borrado al final.

#### Paso 0 · Dump completo del proyecto VIEJO (10 min · CRÍTICO)

```powershell
pg_dump --host=aws-0-us-west-2.pooler.supabase.com --port=5432 \
  --username=postgres.<ref: ver [S4-OREGON]> --dbname=postgres \
  --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  --file=/d/backups/st-perfumeria-pre-migracion-20may2026.sql
```

**Resultado:**
- Dump: 6.2 MB
- 59 tablas (incluye `auth` y `storage`)
- 93 RLS policies
- 59 bloques COPY (data via COPY · más rápido que INSERT)
- Hashes bcrypt `auth.users` preservados (`$2a$10$...`)

**⚠️ Upload a GitHub Release** quedó pendiente · `gh` CLI no autenticado · el dump local en `D:\backups\` queda como single safety net (riesgo aceptado por 7 días).

#### Paso 1 · Crear proyecto NUEVO en São Paulo (Alejo · 5 min)

Alejo creó manualmente via Supabase Dashboard:
- Project name: `st-perfumeria-bra_saop` (el "BRA" sugiere Brasil/sa-east-1)
- Project ref: `znmjhproimtprptheumy`
- Region: `sa-east-1` (South America São Paulo) ✓
- Compute: **MICRO** (1 GB RAM · incluido en plan Pro $25/mes · NOT cambió a MEDIUM que Supabase preseleccionaba por default)
- Security toggles: Enable Data API ☑ · Auto expose new tables ☑ · Auto RLS ☐ (todos como vienen por default · OK)

**Postgres version del nuevo:** 17.6 (mismo que viejo · cero issues de cross-version)

#### Pasos 2-3 · Migrar SCHEMA + DATA

**Paso 2 · schema:**
```powershell
pg_dump --schema-only --schema=public,auth,storage ... | psql ...
```

- 251 errores en log, todos esperables: 39 en schema `storage` (Supabase ya las creó) + 209 en schema `auth` (permission denied · solo `supabase_auth_admin` puede modificar auth)
- **28 tablas creadas en public** del nuevo (0 diff vs viejo)
- **88 RLS policies creadas** (vs 93 del viejo · faltarían 5 que están en `storage.objects` y se crean por defecto)

**Paso 3 · data:**
```powershell
pg_dump --data-only --schema=public --disable-triggers ... | psql --single-transaction ...
```

- 0 errores
- Row counts MATCH en TODAS las tablas críticas:

| Tabla | Viejo | Nuevo | Match |
|---|---|---|---|
| clientes | 38 | 38 | ✓ |
| perfume_overrides | 167 | 167 | ✓ |
| perfumes_nuevos | 16 | 16 | ✓ |
| combos | 5 | 5 | ✓ |
| destacados | 6 | 6 | ✓ |
| favoritos | 41 | 41 | ✓ |
| opiniones | 3 | 3 | ✓ |
| trust_badges | 4 | 4 | ✓ |
| votacion_config | 1 | 1 | ✓ |
| home_top_banner | 1 | 1 | ✓ |
| ventas | 0 | 0 | ✓ |
| announcements | 0 | 0 | ✓ |

#### Paso 4 · MIGRAR auth.users (LO MÁS DELICADO)

**Problema descubierto:** el dump usa formato COPY de pg_dump, pero el pooler de Supabase **bloquea los backslash commands** (`\.`) que COPY necesita. Y el user `postgres.<ref>` NO es owner de la tabla `auth.users` (es propiedad de `supabase_auth_admin`).

**Solución implementada:** generar INSERTs limpios con `--column-inserts --rows-per-insert=1` y ejecutarlos en el **SQL Editor del Dashboard** (que corre como `postgres` con permisos full):

```powershell
pg_dump --data-only --column-inserts --rows-per-insert=1 \
  --table=auth.users --table=auth.identities \
  --file=/d/tmp/auth-users-inserts.sql
```

Después Alejo copia/paste el contenido en el SQL Editor → click Run.

**Resultado verificado:**
- 3 users migrados (jefe@stperfumeria.local · empleado@stperfumeria.local · alejooobello7@gmail.com)
- 3 identities migradas
- Hashes bcrypt `$2a$10$Tbt0gHoOMP...` PRESERVADOS intactos
- **Las chicas pueden loguearse con su password actual SIN reset** ✓

#### Paso 5 · Edge Functions · SKIPPED

Verificación reveló 0 Edge Functions en el proyecto viejo (su panel de funciones —el ref: ver `[S4-OREGON]` (detalle fuera del repo)— mostraba "DEPLOY YOUR FIRST EDGE FUNCTION").

**El `notifyTelegram()` NO usa Edge Functions** · usa una **función SQL `public.send_telegram(msg)`** con la extensión `pg_net` para hacer HTTP POST a `api.telegram.org`. Esta función SQL se migró en el paso 2 (schema) pero requiere `pg_net` habilitada en el nuevo proyecto · ver paso 6+.

**10 min ahorrados.**

#### Paso 6 · Migrar bucket `perfume-fotos`

**Bucket creation** · el SQL del playbook falló con "policy already exists" porque las policies se crearon en el paso 2 (schema). Solución: ejecutar SQL mínimo en SQL Editor del nuevo:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('perfume-fotos', 'perfume-fotos', true);
```

**Migración de archivos** · script Node `/d/tmp/migrate-storage.js`:
- Lista archivos del bucket viejo via service_role
- Descarga cada uno
- Sube al nuevo con `cacheControl: '604800'` (1 semana · sinergia con commit `f4edd3d` `[CACHE-CONTROL-1W]`)
- Concurrencia: 5 archivos en paralelo

**Resultado:**
- **100/100 archivos migrados**
- 0 fallos
- 7.01 MB transferidos
- 35.3 segundos
- Cache-Control verificado: `public, max-age=604800` ✓ en sample (`9 PM ELIXIR.webp`)

#### Paso 7 · SWITCH a producción (`[PLAN-B-SWITCH]` · commit `f532525`)

**Archivos editados** con `sed -i` (para que la anon key no apareciera literal en chat más que necesario):

1. `admin.html` líneas 2768-2769 · `SUPABASE_URL` + `SUPABASE_KEY` viejos → nuevos (formato `sb_publishable_*`)
2. `js/app.js` líneas 4-5 · idem
3. `index.html` líneas 402, 404 · `preconnect` + `dns-prefetch` al ref nuevo
4. `sw.js` · `CACHE_VERSION = 'v1.1.71'` → `'v1.1.72'`

**Verificación post-push (Vercel deploy 13s):**
- 0 referencias al ref viejo (ver `[S4-OREGON]` (detalle fuera del repo)) en HTML público
- 4 referencias al ref nuevo (`znmjhproimtprptheumy`) distribuidas
- SW v1.1.72 en producción
- Anon key formato `sb_publishable_*` activa en producción

**⚠️ Descubrimiento durante este paso:** Vercel NO tiene env vars definidas (`vercel env ls` devolvió "No Environment Variables found"). Las API serverless functions (`api/share.js`, `api/cron/backup.js`, `api/push-subscribe.js`, `api/send-notification.js`) usan `process.env.SUPABASE_URL` que resulta `undefined`. Significa que esas funciones ya estaban "rotas en silencio" en producción antes de la migración · NO se arregló en esta sesión para no introducir cambios extra. Pendiente para una sesión futura.

#### Paso 8 · Verificación E2E

**Tests automáticos** (con el frontend simulado usando la anon key):
1. ✓ `perfume_overrides` · 5 rows leídas
2. ✓ `trust_badges` · 4 rows
3. ✓ `destacados` · 6 rows
4. ✓ `home_top_banner` · 1 row
5. ✓ `votacion_config` · 1 row
6. ✓ Storage · sample foto HTTP 200 + cache-control `public, max-age=604800`

**Tests manuales** (Alejo en su tablet/PC):
- ✓ Catálogo público carga normal en producción
- ✓ Login admin con password actual (sin reset)
- ✓ Panel admin cargó sus tabs
- ✓ Velocidad notablemente mejor (latencia bajó de ~250ms a ~30-50ms)
- ❌ **Notificaciones Telegram NO llegaron** · pg_net habilitada pero el worker en `net._http_response` queda con `status_code` vacío

#### Paso 9 · Proyecto viejo activo 7 días

**Decisión:** mantener el proyecto viejo (`us-west-2 Oregon`) en estado activo hasta el **28-may-2026** como safety net para rollback rápido (`git revert HEAD && git push` cambia 4 strings + redeploy = 2 min). Después del 28-may, pausar (no eliminar) desde Dashboard.

#### Descubrimiento que dispara `[SECURITY-AUDIT-S1]`

Al final de la sesión, escribiendo el mensaje de verificación para Alejo, dije:
> *"Hacé login con la password del jefe que usás normalmente (`<ADMIN_PASS · ver admin.html · S1>` según el código)."*

Alejo me detectó que esa frase "según el código" sugería que la password estaba en el código (HTML público). Le confirmé que sí: `admin.html` líneas 2766-2767 tiene:
```js
var ADMIN_PASS = '<ADMIN_PASS · ver admin.html · S1>';
var ADMIN_PASS_EMPLEADO = '<ADMIN_PASS_EMPLEADO · ver admin.html · S1>';
```

Cualquier visitor con "Ver código fuente" lee las passwords del jefe y la empleada. Es trivialmente explotable. Alejo preguntó:
> *"habrá que planificar una sesión de seguridad informática con claudechat + claudecode?"*

**Confirmado · sesión `[SECURITY-AUDIT-S1]` agendada como CRÍTICA + URGENTE.**

Inventario completo de issues de seguridad detectados durante esta sesión: documentado en `docs/SECURITY.md` (creado el 21-may post-Plan-B). Plan de ataque con pattern Claude↔Claude documentado en `RECOMENDACIONES_CLAUDECHAT/Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md`.

#### Pendientes inmediatos post-sesión 21-may

| Pendiente | Cuándo | Prioridad |
|---|---|---|
| ⚠️ **Cambiar passwords admin** (jefe + empleada) via Dashboard del nuevo | **YA · hoy mismo (21-may)** | 🔴 CRÍTICO |
| ⚠️ **Revocar bot Telegram + actualizar SQL function** | YA · hoy mismo | 🔴 CRÍTICO |
| **Resetear DB passwords** de ambos proyectos | Dentro de 48 hs | 🟡 ALTA |
| `[SECURITY-AUDIT-S1]` · sesión técnica completa | 1-2 días | 🔴 CRÍTICO |
| `[FIX-TELEGRAM-PG-NET]` · arreglar notifs | Junto con S1 | 🟢 MEDIA |
| `[BCRYPT-MIGRATION]` · clientes con bcrypt | Como parte de S1 | 🔴 CRÍTICO |
| Bajar proyecto viejo Oregon | A partir de 28-may | 🟡 ALTA |
| Upload dump a GitHub Release | Cuando puedas | 🟢 BAJA |
| CLS Desktop iter 5 | Cuando puedas | 🟢 BAJA |

#### Commits de esta sesión

| Commit | Cambios |
|---|---|
| `f4edd3d` (anterior · sesión 20-may) | `[CACHE-CONTROL-1W]` admin uploads con cacheControl 1 semana |
| `d7df0a2` (anterior · 20-may) | `[A11Y-CONTRAST-5]` 5 contrastes WCAG |
| `93d0caf` (anterior · 20-may) | `[CLS-DESKTOP-ITER3]` SVG search-icon dims |
| `8a652fd` (anterior · 20-may) | `[CLS-DESKTOP-ITER4]` section.seleccion-st reserve |
| `f532525` | `[PLAN-B-SWITCH]` migrar URL+key a Supabase São Paulo |
| `5d87321` | docs · cierre Plan B + flag `[SECURITY-AUDIT-S1]` |

#### Keywords cerrados en esta sesión

| Keyword | Qué hace |
|---|---|
| `[PLAN-B-SWITCH]` | Migración completa de Supabase us-west-2 → sa-east-1 · ver detalle paso por paso arriba |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[SECURITY-AUDIT-S1]` | Sesión completa de seguridad · ver `docs/SECURITY.md` + `RECOMENDACIONES_CLAUDECHAT/Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md` |
| `[FIX-TELEGRAM-PG-NET]` | Arreglar notifs Telegram (pg_net worker no procesa requests) |
| `[BCRYPT-MIGRATION]` | Hashear passwords de tabla `clientes` (cae adentro de S1) |

#### 💬 Mensajes meta para el Alejo / Claude del futuro

**Sobre la sesión:** Alejo dijo al final · *"tocamos cosas sensibles y lo que menos quiero es que se me genere un problemón que ya sabes que sufro mucho por ser buena persona"*. Eso es señal de que:
- Está cansado (5 AM ART)
- Está preocupado por las consecuencias
- Necesita confirmación de que TODO está documentado
- Le importa mucho ser cuidadoso con cosas que pueden lastimar a otros (las chicas, sus clientes, etc.)

Por eso esta sección de HISTORIA.md es EXHAUSTIVA · cada paso paso por paso · cada comando exacto · cada decisión con justificación · cada workaround documentado. Si la próxima Claude que arranque tiene dudas, debería poder reconstruir TODO el flow leyendo solamente esta sección + `docs/SECURITY.md` + `RECOMENDACIONES_CLAUDECHAT/Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md`.

**Sobre el pattern Claude↔Claude (validado 2 veces):**
1. `[LOGIN-RETRY-SP]` · funcionó perfecto · 20-may
2. Plan B Supabase · funcionó perfecto (con ajuste de v1 → v2 del playbook) · 20/21-may

Ya es un pattern probado. Para `[SECURITY-AUDIT-S1]` confiar en él. Ver `RECOMENDACIONES_CLAUDECHAT/Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md` como brief inicial.

**Sobre cleanup post-sesión:**
- ✅ `D:\tmp\.env` BORRADO (tenía service_role keys de ambos proyectos)
- ✅ `D:\tmp\plan-b-credentials.txt` BORRADO (tenía DB passwords + anon keys)
- ✅ Dumps temporales borrados (`/d/tmp/schema-only.sql`, `/d/tmp/data-only.sql`, etc.)
- ✅ Backup pre-migración EN `D:\backups\st-perfumeria-pre-migracion-20may2026.sql` (6.2 MB) · CONSERVADO 7 días como safety
- ⚠️ Quedan en `/d/tmp/`: `e2e-tests.js`, `migrate-storage.js`, `verify-storage.js`, `node_modules` (estos pueden quedarse · no tienen creds)

**Sobre el archivo `D:\backups\st-perfumeria-pre-migracion-20may2026.sql`:**
- ⚠️ Contiene `auth.users.encrypted_password` (hashes bcrypt) + `public.clientes.password` (texto plano)
- ⚠️ Conservar SOLO 7 días (hasta 28-may)
- ⚠️ NO commitear al repo NUNCA
- Cuando se borre, usar `sdelete -p 3` si el disco va a otro lugar

---

### Sesión 27-jun-2026 (sábado madrugada) · **Resumen diario de Telegram** + badge violeta + QA post Plan B

Sesión multi-tema. Lo principal: se construyó el **resumen diario de Telegram** (`[TG-RESUMEN-DIARIO]`), idea de Alejo para reemplazar el bombardeo de notificaciones instantáneas por un único mensaje al cierre.

#### `[TG-RESUMEN-DIARIO]` · resumen diario al cierre (commit `1ded56a` + server-side)

**Disparador:** Alejo notó que recibía demasiados Telegrams. Verificado en `admin_actions`: el **20-jun fueron 114 notificaciones en un día** solo por cambios de stock (cada `stock_update` disparaba un Telegram en tiempo real). Días normales: 16-70.

**Hallazgo clave:** Telegram NUNCA estuvo roto post Plan B. El `[FIX-TELEGRAM-PG-NET]` quedó OBSOLETO. Lo que pasaba el 21-may: (a) el worker de pg_net tardó en arrancar tras crear el proyecto nuevo (ya procesa todo, status 200 confirmado), (b) las queries a `net._http_response` vía psql/pooler se colgaban (problema del pooler) pero vía MCP de Supabase responden bien. Verificado mandando un test real (message_id 3079, status 200).

**Implementación (toda server-side, salvo el silenciado):**
- Función SQL `public.daily_summary(p_dia date)` que arma el mensaje unificado en castellano: stock (neto +/− por perfume, MAYÚSCULA), precios, clientes nuevos (link `wa.me`), puntos (de `clientes.puntos_log` jsonb). Secciones condicionales. Testeada contra 26-jun, 20-jun, 18-jun (datos reales).
- `pg_cron` instalado + job `resumen-diario-telegram` `0 2 * * *` (**23:00 ART** · Alejo pidió 23 en vez de 22 para dar margen post-cierre).
- 6 `notifyTelegram` instantáneas silenciadas en admin.html (marcador `[TG-RESUMEN-DIARIO]`): stock, precio, cliente nuevo, 3× puntos. Las de seguridad (login, lockout) y acciones admin esporádicas (combos, perfumes, cierres, push) quedan en tiempo real.
- Detalle técnico completo en `docs/BACKEND.md` § "Notificaciones a Telegram".
- SW v1.1.73 → **v1.1.74**.

#### Otros cambios de la sesión

- `[BADGE-LAST-VIOLETA]` (commit `42b5dce`) · en el panel admin, el badge "1 Último" pasó de rojo a **violeta `#7d3c98`** para distinguirlo de "Sin stock" (que sigue rojo). Solo admin · el catálogo público no se tocó. SW v1.1.72 → v1.1.73. **OJO:** durante este cambio se detectó que el checkout `D:\workspace\ST_Perfumeria` (main repo) está **desincronizado/atrasado** respecto a producción · todos los commits de la sesión van por el **worktree** `peaceful-jemison-808743` con `git push origin <branch>:main`. Conviene un `git pull` en el main repo.
- **QA post Plan B** (solo lectura): todo verificado OK · las chicas operaron normal (jefe logueó 16:42, empleada 20:47 el 26-jun), row counts crecieron normal (clientes 38→40), storage con cacheControl 1 semana, RLS OK. ⚠️ Lección: durante el QA, un test de RLS hizo un INSERT real en `clientes` (rompió la promesa de "solo lectura") · se borró al toque · para verificar policies usar `pg_policies` (lectura), NO un INSERT de prueba.
- `[SLASH-COMMANDS]` (commits `208afd0` + `6c49346`) · documentados 8 slash commands en `docs/SLASH_COMMANDS.md` + implementados los 3 prioritarios en `.claude/commands/` (`handoff`, `quick-fix-ui`, `security-scan`). `.gitignore` ajustado a `.claude/*` + `!.claude/commands/`.
- **CodeGraph MCP instalado** (global) · indexación pendiente de confirmar (`codegraph init -i`).

#### `[FORGOT-PASS-A]` · recuperación de contraseña de clientes (commit `db9d485` · SW v1.1.75)

Implementado COMPLETO en la misma sesión (Alejo eligió hacerlo todo aunque se pasara del horario de apertura). Flujo "Opción A" (verificación humana, sin SMS gateway, costo cero).

**Diseño clave (simplificación que ahorró trabajo):** en vez de generar códigos temporales tipo `ST-XK29` + forzar cambio con modal nuevo, se REUSA el flujo existente del proyecto: al resetear se pone `clientes.password = NULL`, y el código que ya existía (`js/app.js` L391-407 · "cuenta sin password → primer login setea la pass") hace el resto. Menos código, patrón probado, coherente.

**Componentes:**
- **BD** · tabla `public.password_reset_requests` creada vía MCP de Supabase (10 cols, 4 RLS policies, 3 índices). INSERT abierto a `anon` (el cliente no está logueado al pedir reset), SELECT/UPDATE/DELETE solo `authenticated` (admin). Detalle en `docs/DATABASE.md`.
- **Frontend público** (`index.html` + `js/app.js`): link "¿Olvidaste tu contraseña?" en el modal de login (visible solo en modo login, toggle en `switchAuthMode`). `requestPasswordReset()` busca el cliente por teléfono, inserta el pedido + avisa al jefe por Telegram con link `wa.me`. Mensaje genérico al cliente (NO revela si el número existe · privacidad).
- **Admin** (`admin.html`): tab "🔑 Pedidos pass" (sin `data-role` · empleadas también, son las que atienden). `loadResetRequests()` lista pendientes con botones WhatsApp / Resetear / Descartar. `resetClientePass()` pone `password=NULL` tras confirmar verificación de identidad + marca el pedido resolved + abre WhatsApp con mensaje pre-armado. `rejectResetRequest()` descarta spam.
- **Seguridad:** el reset NO es automático · requiere que la chica verifique identidad por WhatsApp antes (preguntar algo que solo el cliente sepa). NO se tocó el flujo de login existente → cero riesgo para clientes actuales. ⚠️ La pass sigue en PLANO (alinea con `clientes.password` · ver `[BCRYPT-MIGRATION]` / `docs/SECURITY.md` S2).
- Sintaxis validada con `node --check` (app.js + JS inline de admin.html) antes de deployar.

**Rework de UX + bug encontrado (mismo día):**
- Alejo probó y vio "No se pudo enviar el pedido". Primero reforcé la UX (commit `4268b78`): el link "¿Olvidaste tu contraseña?" ahora abre una **pantalla dedicada "Recuperá tu cuenta"** (3er modo de `switchAuthMode`) con instrucciones claras y solo el campo de teléfono (antes era confuso). `cleanPhone` ya normaliza el formato solo (no requiere el `549`).
- Pero seguía fallando incluso en incógnito. **`[FORGOT-PASS-FIX]` (commit `38a1aeb`):** el bug REAL estaba en `notifyTG()` (app.js) que hacía `sb.rpc('send_telegram', {msg}).catch(...)`. En supabase-js v2, `sb.rpc()` devuelve un **PostgREST builder** (thenable con `.then()` pero SIN `.catch()`), así que `.catch()` directo tiraba `TypeError: sb.rpc(...).catch is not a function`. Como `[FORGOT-PASS-A]` llama `notifyTG()` dentro del `try` SOLO cuando el teléfono está registrado (cli existe), ese throw caía al catch → error genérico. Por eso fallaba solo con teléfono registrado (mis primeras pruebas usaron un número no registrado → cli=null → no llamaba notifyTG → no fallaba). Fix: `Promise.resolve(sb.rpc(...)).catch()` + try/catch. Arregla TODOS los usos de notifyTG (login bloqueado, primer ingreso, perfil editado, waitlist) que tenían el mismo bug latente.
- **Método de diagnóstico clave:** el preview local (Python http.server) estaba inestable en Windows, así que diagnostiqué con **puppeteer-core + Edge headless contra producción**, reproduciendo el flujo paso a paso hasta aislar la línea exacta. SW v1.1.75 → **v1.1.77**.

**Test pendiente (lo hace Alejo cuando pueda):** crear cuenta de prueba → pedir reset → confirmar Telegram → resetear desde admin → reloguear con clave nueva. El flujo del cliente (pedir reset) ya quedó VERIFICADO end-to-end con browser headless (mensaje de éxito verde).

#### Decisión menor pendiente

- ¿El resumen diario de Telegram manda "Sin movimientos 😴" los días sin actividad, o silencio total? Quedó con el 😴 (ajustable en 1 línea de `daily_summary`).

#### Herramienta nueva validada

El **MCP de Supabase** (`mcp__...__execute_sql`, `list_extensions`, etc.) resultó clave esta sesión: ejecuta SQL directo y confiable (no se cuelga como psql/pooler), y permite crear funciones/extensiones/cron sin que Alejo copie/pegue en el dashboard. **Bonus:** `psql`/`pg_dump` desaparecieron del sistema (carpeta `C:\Program Files\PostgreSQL\18\` quedó vacía entre el 21-may y el 27-jun) · el MCP los reemplaza para casi todo.

---

### Sesión 27-jun-2026 · parte 2 (cerrada el 12-ago-2026) · **Test E2E de `[FORGOT-PASS-A]` + `[FORGOT-PASS-WA]`**

Continuación de la misma sesión del 27-jun (mañana). Alejo pidió "seguir arreglando cosas" y de 4 opciones eligió **cerrar el loop del feature de recuperación de contraseña**, que había quedado con el test pendiente. Se probó de punta a punta contra la BD de producción, apareció un bug real en el camino, se arregló, y se sumó una mejora de UX.

> ⚠️ **Nota de calendario:** el trabajo técnico se hizo el 27-jun. Alejo volvió al chat el **12-ago** (~6,5 semanas después) y ahí se cerró la documentación. En el medio **nadie tocó el repo** (`origin/main` quedó clavado en `196586e`) y el sitio corrió con SW v1.1.78 sin reportes de fallas. Ver "Pendientes que se pudrieron con el tiempo" abajo.

#### Qué se hizo

**1. Test E2E de `[FORGOT-PASS-A]` · VERIFICADO end-to-end en producción**

Método usado: **Alejo toca la UI real, Claude verifica la BD con el MCP de Supabase después de cada paso.** Así se probó el código productivo (RLS, policies, funciones), no un atajo por SQL.

| Etapa | Verificación concreta | Resultado |
|---|---|---|
| Cliente pide reset | fila en `password_reset_requests` `status=pending` + `cliente_id` linkeado (creada 11:16:45) | ✅ |
| Aviso al jefe | `net._http_response` id 1216 · status 200 · `message_id` 3083 · **11:16:46** (0,1 s después) | ✅ |
| Admin resetea | `clientes.password` → NULL · pedido → `resolved` · `resolved_by='jefe'` (11:35:10) | ✅ |
| Telegram del reset | id 1221 · status 200 · msg 3087 · 11:35:10 | ✅ |
| Cliente re-loguea | `password` re-seteada (len 9) · **puntos intactos (5)** | ✅ |
| Telegram "primer ingreso" | id 1222 · status 200 · msg 3088 · 11:38:53 | ✅ |

Dato lindo: el pedido pendiente que había en la BD era **de la propia cuenta de Alejo** (creado en su prueba de la mañana), así que el test fue real y seguro a la vez.

**2. `[FORGOT-PASS-WA]` · el "Avisar por WhatsApp" no abría nada (commit `3e52dbd`)**

Lo detectó Alejo probando: el reseteo funcionaba pero el pop-up de WhatsApp no llevaba a ningún lado.

- **Causa raíz:** `window.open(url, '_blank')` sólo abre si el navegador lo asocia a un **gesto directo del usuario** (*user activation*). En `resetClientePass()` la llamada corría después de **2 `await` de SQL + `setTimeout(300)` + un segundo `confirm`** → para entonces el navegador ya había perdido el rastro del clic original y el **bloqueador de pop-ups lo frenaba en silencio** (más agresivo todavía en tablet, que es donde trabajan las chicas).
- **Fix (opción A de 3 que se le ofrecieron):** se reemplazó el pop-up automático por un **banner verde con un `<a href target="_blank">` tappable** ("💬 Avisar al cliente") + botón "✖ Cerrar". Tocar el link ES el gesto → WhatsApp abre siempre. El banner se limpia al refrescar la lista o al reentrar a la tab.
- El botón verde 💬 WhatsApp de cada fila **nunca estuvo roto** (siempre fue un `<a>` real). El bug era sólo el pop-up automático post-reseteo.
- SW v1.1.77 → **v1.1.78**.

**3. Nombre del cliente en la tab "Pedidos pass" (commit `eefdfe9`)**

Mejora menor flageada por Claude y aprobada por Alejo: la lista mostraba sólo el teléfono, teniendo el `cliente_id` linkeado.

- `loadResetRequests()` ahora trae el nombre con **join embebido de PostgREST** (`.select('*, clientes(nombre)')`, apoyado en la FK `password_reset_requests_cliente_id_fkey`).
- Se verificó (con `pg_policies`, sin escribir) que `clientes` tiene policy `SELECT` que permite el embed bajo el rol `authenticated` → el nombre efectivamente se muestra.
- El nombre **se escapa con `escapeHtml()`** (helper que ya existía en `admin.html` L7212) para no sumar un punto de XSS · ver S10 abajo.

**4. Hallazgos de seguridad + re-scoping de S1 (commit `196586e` · `docs/SECURITY.md`)**

Al verificar S1 antes de tocar nada, se descubrió que **el inventario estaba desactualizado**:

- Las constantes están en **L2778-2779**, no L2766-2767 (el archivo creció ~12 líneas).
- **El login del admin YA NO usa esas passwords** · autentica contra Supabase Auth (`sb.auth.signInWithPassword`) → **S1 no es un login-bypass**, como decía el doc.
- `ADMIN_PASS_EMPLEADO` es **código muerto** (se declara, nunca se referencia) → borrable sin riesgo.
- `ADMIN_PASS` **sigue vivo** como secreto compartido para `/api/send-notification` (L7229) → al estar en JS público, cualquiera puede mandar **push spam a todos los suscriptores**. Borrarlo NO es one-liner: hay que cambiar la auth del endpoint (validar sesión server-side) + rotar el secreto en Vercel.
- **S2 agravado (hallazgo nuevo):** `clientes` tiene policy `SELECT` para `public` con `USING (true)` y la **anon key está en el JS público** → cualquiera puede bajarse **todos los teléfonos + contraseñas en plano** con un `fetch` al REST, sin loguearse ni tener el dump. Apretar la RLS a secas **rompe el login** (el front lee `clientes` como anon para comparar la pass) → queda atado a `[BCRYPT-MIGRATION]`. Mitigación propuesta: mover la verificación a una función `SECURITY DEFINER` que devuelva sólo un booleano.
- **S10 (nuevo · ALTA):** **stored XSS** en la tab "Clientes" del admin · `renderClients` (~L3900) inyecta `c.nombre` sin escapar vía `innerHTML`. Un atacante se registra con un nombre tipo `<img src=x onerror=...>` y el payload corre **en la sesión admin autenticada** de la chica. El código nuevo de "Pedidos pass" ya escapa · el issue es para los lugares preexistentes.

#### Decisiones / bugs encontrados / workarounds

- **`window.open` tras `await` = pop-up bloqueado.** Patrón replicable: si querés abrir una pestaña después de operaciones async, **no** uses `window.open` automático · dejá un link/botón que el usuario toque. Aplica a cualquier lugar del panel que quiera "abrir WhatsApp solo".
- **Los docs de seguridad envejecen y mienten.** S1 decía "explotable en 30 segundos, login bypass" y hoy no lo es; las líneas ni siquiera coincidían. Lección: **verificar contra el código antes de ejecutar un plan de fix** basado en un doc de hace semanas (mismo espíritu que el aprendizaje #56).
- **El sandbox de Claude Code no tiene salida HTTP.** `curl` a producción devolvió `000` (y también a GitHub) → parecía "deploy no salió" cuando en realidad estaba `READY`. **Para verificar deploys usar el MCP de Vercel** (`list_deployments`), no `curl`. El `git push` sí funciona (va por otro canal).
- **Correlacionar acciones con Telegrams vía `net._http_response`.** Los timestamps (`created at time zone 'America/Argentina/Buenos_Aires'`) permiten confirmar que una notificación salió por una acción concreta (ej. reset 11:35:10 → Telegram 11:35:10). Herramienta útil para QA de flujos con notificación.
- **Patrón de test E2E "vos tocás, yo verifico".** Funcionó muy bien: Alejo opera la UI real y Claude confirma cada efecto en la BD. Prueba el código productivo completo (RLS incluida) sin que Claude necesite credenciales del panel.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[FORGOT-PASS-A]` | **Test E2E COMPLETO verificado en producción** (cliente → admin → re-login · puntos intactos · 3 Telegrams confirmados). El feature queda cerrado. |
| `[FORGOT-PASS-WA]` | Fix del aviso al cliente: banner con link tappable en lugar del `window.open` que el bloqueador de pop-ups frenaba (`3e52dbd`). |
| `[FORGOT-PASS-NOMBRE]` | Nombre del cliente visible en la tab "Pedidos pass" vía join embebido + `escapeHtml` (`eefdfe9`). |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[SECURITY-AUDIT-S1]` | **Re-scoped**: (a) borrar `ADMIN_PASS_EMPLEADO` (muerto, trivial) · (b) sacar `ADMIN_PASS` del JS público cambiando la auth de `/api/send-notification` a sesión server-side + rotar secreto en Vercel. Ya NO es login-bypass. |
| `[BCRYPT-MIGRATION]` | Más urgente que antes: S2 quedó demostrado como **remotamente explotable** (anon key + RLS abierta = passwords en plano por REST). Incluye la mitigación con función `SECURITY DEFINER`. |
| `S10` (XSS admin) | Escapar `c.nombre` / `c.nota` en `renderClients` (~L3900) y auditar los demás `innerHTML` del panel. |
| **Bajar Oregon** | 💸 Sigue pendiente · ver abajo. |

#### 🕐 Pendientes que se pudrieron con el tiempo (al 12-ago)

- 💸 **Bajar el proyecto Supabase viejo de Oregon** (ver `[S4-OREGON]` (detalle fuera del repo)) · el rollback window venció el **28-may**. Si sigue activo, son **~2,5 meses de facturación doble** (2 proyectos Pro ≈ **USD 60-75 de más**). Es lo más caro de la lista y lo más barato de resolver (pausar es reversible y no toca código). ⚠️ **Verificar primero que siga activo** — en el cierre del 12-ago el MCP de Supabase estaba desconectado y no se pudo confirmar.
- 🔴 Los issues de seguridad llevan **~3 meses** abiertos desde que se detectaron el 21-may.

#### 💬 Mensajes meta

- Alejo cerró preguntando *"¿me prometés que si me avisan que algo falla lo resolvemos juntos?"*. La respuesta honesta funcionó mejor que una promesa vacía: **no** prometer que nada se rompe, sí acotar el radio de impacto real (se tocó una sola tab · login/catálogo/ventas intactos), recordar que **el rollback de Vercel está a un click** (el deploy previo figura como `isRollbackCandidate`), y confirmar que sí, cuando vuelva se resuelve juntos. Ver aprendizaje #67.
- El hueco de 6,5 semanas confirma que **`HISTORIA.md` ES la memoria real del proyecto**, no el chat. Al volver, la primera pregunta de Alejo fue *"¿dejamos algo en el .md?"*. Ver aprendizaje #68.

---

### Sesión 12-ago-2026 (tarde/noche) · **`[FOTOS-OREGON]` — la mudanza de mayo había quedado a medias**

Sesión que arrancó como *"bajemos el proyecto viejo para dejar de pagar"* (el pendiente #1 desde mayo) y terminó destapando que **la migración a São Paulo nunca se completó del todo**: 97 filas de la base seguían apuntando las fotos al servidor de Oregon. Apagarlo sin mirar habría dejado el catálogo público con 80 imágenes rotas. De paso aparecieron dos hallazgos serios (backup propio y notificaciones caídos hace 3 meses) y se midió **por primera vez con números** la exposición de los datos de clientes.

#### `[FOTOS-OREGON]` · 97 direcciones apuntando al servidor viejo

**Cómo se descubrió.** Antes de pausar Oregon se verificó qué dependía de él. El repo estaba limpio (el `grep` del ref —ver `[S4-OREGON]` (detalle fuera del repo)— sólo aparecía en `.claude/settings.local.json`, que no ejecuta nada) y Vercel no tenía ninguna variable configurada. **Pero el navegador contra producción mostró 80 `<img>` cargando desde el dominio del proyecto viejo (ver `[S4-OREGON]` (detalle fuera del repo)).** Las URLs se guardan enteras en la BD: el Plan B de mayo copió los archivos al bucket nuevo pero **no reescribió las direcciones guardadas**.

**Por qué nadie lo notó en 3 meses:** Oregon seguía prendido y pagado, así que las fotos cargaban perfecto. El problema era invisible **hasta el momento exacto de apagarlo** — el peor tipo de bug latente.

**Alcance real (la BD dijo más que el navegador).** El navegador sólo ve lo que está renderizado en la home. La consulta a la BD encontró **97 filas en 5 tablas**:

| Tabla · columna | Filas | Qué es |
|---|---|---|
| `perfume_overrides.foto` | 72 | Fotos del catálogo |
| `perfumes_nuevos.foto` | 15 | Perfumes cargados desde el panel |
| `decants_custom.foto_url` | 5 | Decants "estrella" |
| `home_slides.media_url` | 3 | Slider viejo (2 jpg + 1 mp4) |
| `combos.foto` | 2 | Packs/sets |

Si se hubiera corregido sólo lo que mostraba el navegador (76), **quedaban 21 rotas** que iban a aparecer recién cuando alguien entrara a combos o decants. **Lección: la BD es la fuente de verdad, el navegador es el testigo.**

**Qué NO se tocó, a propósito:** `edit_log` (75), `admin_actions` (26) y `admin_backups` (4) también contienen la URL vieja, pero son **historial**. Reescribirlos sería falsificar el libro de actas y no arregla nada — el panel los renderiza como texto plano (`truncateLog`, `admin.html` L4847), no como imágenes. Nota: si algún día se restaura un `admin_backups` viejo, hay que volver a correr el reemplazo.

**Método usado (5 redes de contención, decidido con Alejo que pidió explícitamente "lo más seguro"):**
1. **Pre-chequeo de archivos:** se verificó con el navegador que las **88 URLs únicas existieran en São Paulo** antes de reapuntar nada. 87 dieron OK y 1 falló → era el `.mp4` probado con `new Image()` (falso negativo). Reprobado con `<video>`: **88/88 presentes.**
2. **Respaldo:** tabla `respaldo_urls_oregon` con los valores previos (creada **con RLS activada** — el propio dashboard avisó, ver más abajo).
3. **Ensayo:** `SELECT` con `antes → después` revisado por Alejo antes de escribir.
4. **Atómico:** los 5 `UPDATE ... replace(...)` en un solo `begin; ... commit;`.
5. **Verificación doble:** la BD devolvió **0 filas** apuntando a Oregon, y el sitio en vivo pasó de *80 Oregon + 61 SP* a **141 São Paulo, 0 Oregon, 0 imágenes rotas** (la cuenta cierra exacta: 61 + 80 = 141).

**Agujero en la verificación propia (lo encontró la desconfianza de Alejo).** La consulta de descubrimiento filtraba `data_type IN ('text','varchar','json','jsonb')` — **dejaba fuera las columnas tipo `ARRAY`**. Alejo preguntó *"¿es así que solo eran las fotos?"* y al revisar apareció el hueco. Se cerró de dos formas: (a) escaneo desde el navegador de **381 filas en 14 tablas leyendo TODAS las columnas sin filtrar por tipo** → 0 rastros; (b) segunda consulta SQL con `data_type NOT IN (...)` → vacío. `fotos_extra` resultó ser columna de **texto** (se guarda desde un input), así que la consulta original sí la había cubierto.

#### Oregon: no se pudo pausar

- **Pausar está deshabilitado en plan pago.** El botón existe pero gris, con el tooltip *"Projects on a paid plan will always be running"*. **Lo encontró Alejo**, que no se quedó con el "abajo solo aparece Delete" y siguió buscando.
- **Corrección del costo:** se había estimado "USD 60-75 de más". Supabase cobra **por organización**, y ambos proyectos estaban en la misma (`Alejo_Bello`, Pro) → Oregon sumaba sólo su cómputo (~USD 10/mes), no una suscripción entera. **El número real está en la factura.**
- **Salida elegida y estado:** ver `[S4-OREGON]` (detalle fuera del repo; la historia de git conserva la versión anterior de estas líneas). Las fotos tienen su copia local desde el 23-sep (`[BACKUP-FOTOS-LOCAL]`).
- El sitio se verificó **después** de la transferencia: 141 imágenes SP, 0 rotas, 462 tarjetas, 233 filas de stock legibles. **Nada se movió.**

#### 🚨 Hallazgo nuevo · Vercel no tiene NINGUNA variable de entorno

`Settings → Environment Variables` del proyecto `st-perfumeria` está **vacío** (verificado por Alejo en pantalla). Consecuencia: las 3 funciones que necesitan hablar con Supabase **vienen fallando en silencio**:

| Función | Qué hace | Estado |
|---|---|---|
| `api/cron/backup.js` | Backup diario propio (`admin_backups`) | ❌ corta con "SUPABASE_URL o SERVICE_KEY no configurados" |
| `api/push-subscribe.js` | Registrar suscriptores de notificaciones | ❌ |
| `api/send-notification.js` | Enviar el push a todos | ❌ (además usa `ADMIN_PASS`, que tampoco está) |

**Evidencia:** el `cron` **sí** está configurado (`vercel.json`, `/api/cron/backup` a las `0 3 * * *`) y guarda los 12 más recientes, pero `admin_backups` tiene **sólo 4 filas, del 2 al 16 de mayo** — o sea que ya venía fallando **antes** de la migración. Los logs de Vercel no sirvieron para confirmar (retención de **1 hora** en plan Hobby).

⚠️ Cuando se repongan, la service key se copia **directo de Supabase a Vercel** — nunca por chat (ver S6 en `SECURITY.md`).

#### ✅ Los backups que SÍ funcionan (y su límite)

`Database → Backups → Scheduled backups` del proyecto de São Paulo tiene **backups diarios hasta hoy**, cada uno con botón `Restore`. O sea: si mañana se borra el stock por accidente, **se recupera**. Esa era la preocupación real de Alejo ("mis amigos tienen todo el stock ahí").

⚠️ **Pero el propio panel avisa: "Storage objects are not included".** Los backups guardan la BD, **no las fotos**. De ahí sale el pendiente nuevo `[BACKUP-FOTOS-LOCAL]`.

#### 🔴 Exposición de datos de clientes · medida con números (S2)

Primera medición real, hecha con la clave pública desde el navegador, **sin mostrar ningún dato**:

| Medición | Resultado |
|---|---|
| ¿`clientes` legible por `anon`? | **Sí** |
| Fichas descargables | **82** (eran 38-40 en mayo) |
| Contraseñas legibles | **78** |
| Que parecen hash | **0** |
| En texto plano | **78** (largos entre 4 y 22) |
| Columnas expuestas | `nombre`, `telefono`, `password`, `nota`, `puntos`, `bloqueado`, `puntos_log` |

**Plan acordado con Alejo (3 escalones):**
1. **Cerrar la puerta** (~1 h) · RLS cerrada + login por función `SECURITY DEFINER` que devuelve sólo un booleano. ⚠️ **No se puede cerrar la policy a secas: el login actual lee la tabla como `anon` y se rompería.** Va junto o no va.
2. **Hashear** (~1-2 h) · bcrypt con migración perezosa.
3. **Supabase Auth** · sesión dedicada, cuando haya una semana tranquila.

**Plan de respuesta ante filtración (pedido explícito de Alejo):** (1) cortar — rotar anon key + cerrar RLS; (2) **resetear todas las contraseñas poniendo `password = NULL`** → el flujo `[FORGOT-PASS-A]` hace que cada cliente defina una nueva al entrar, sin atender a nadie uno por uno; (3) avisar a los clientes con el mensaje clave *"si usabas esa misma contraseña en otro lado, cambiala"* (el daño real es la reutilización de contraseñas); (4) dejar registro de qué pasó y cuándo.

#### `[OCULTAR-PAUSADOS]` + `[OCULTAR-VALOR-INV]` · commit `c5678ae` · SW v1.1.79

Dos pedidos de Alejo para el panel, en el mismo commit:

- **`[OCULTAR-PAUSADOS]`** · casilla "Mostrar pausados" en la misma fila que "Ordenar por", **para los dos roles**. Arranca sin marcar (lista limpia), la preferencia se guarda por dispositivo (`localStorage: st_admin_ver_pausados`) para no tildarla en cada ingreso, y un `<p id="avisoPausados">` muestra **"N pausados ocultos"** como red de seguridad para que un perfume pausado nunca desaparezca sin explicación. **El filtro se aplica DESPUÉS de calcular las métricas**, así el mini-dashboard da igual esté marcada o no (los pausados nunca contaron, L3594).
- **`[OCULTAR-VALOR-INV]`** · la tarjeta 💰 "Valor de inventario" lleva `data-role="jefe"`, reusando el sistema de roles existente (L1080). La grilla pasa de 4 a 3 columnas para `role-empleado` así no queda un hueco en la tablet. **Es ocultamiento visual (CSS), igual que el resto del sistema de roles** — cumple el objetivo de uso real, no es una barrera técnica.

**Verificación responsive (Alejo pidió explícitamente "corroborar que no rompa al cambiar la dimensión"):** medido en **iframe aislado** (para que el CSS del sitio no contamine) + `resize_window` real, en ambos roles, a **1265 / 753 / 375 px**. Resultado: barra en 1 línea (2 en celular, la casilla baja entera), texto nunca se parte, **sin scroll horizontal en ninguna medida**, grillas 4/2/1 (jefe) y 3/3/1 (empleada). ⚠️ **Dos errores de medición propios, corregidos en el camino:** (a) medir el `top` de elementos con `align-items:center` da tops distintos aunque estén en la misma línea → hay que medir el **centro vertical**; (b) cambiar el ancho de un iframe por CSS **no reevalúa las media queries** → hay que redimensionar la ventana de verdad.

#### `[WAITLIST-AVISO-REAL]` · el aviso "Avisame cuando vuelva" fallaba en silencio · commit `0dc444f` · SW v1.1.80

Alejo reportó que tocar "Avisame cuando vuelva" **"no se termina efectuando"**. Diagnóstico: **el botón funciona bien** (37 pedidos desde el 28-abr, el último de ayer) · **lo que fallaba era el aviso de vuelta**, y por el **mismo patrón que `[FORGOT-PASS-WA]` de esta misma sesión**.

**El bug:** al reponer stock, `autoNotifyWaitlist()` (a) marcaba a **todos** los pendientes con `notified_at = now()` **ANTES de mandar nada**, y (b) intentaba abrir un `window.open` por persona con stagger de 800 ms, después de varios `await`. **El navegador permite una sola ventana por gesto del usuario** → la primera quizá abría, el resto las frenaba el pop-up blocker (peor en tablet). Resultado: gente marcada como "avisada" que nunca recibió el mensaje, y el panel mostrando *"N personas avisadas automáticamente por WhatsApp"*. **Falla silenciosa que además reportaba éxito** — de los 27 marcados como avisados, no se sabe cuántos recibieron algo.

**El mismo bug estaba en un segundo lugar:** `avisarTodos()` de la tab Espera hacía exactamente lo mismo (N pop-ups + UPDATE masiva).

**Fix:** `autoNotifyWaitlist` ya no marca nada; pinta el panel `#waitlistBanner` (arriba de Precios & Stock) con **un botón "Avisar" por persona** — un `<a>` real, o sea gesto directo → WhatsApp abre siempre. `marcarAvisadoWaitlist(id, el)` marca a **una** persona al tocar su botón, sin `preventDefault` (el link abre aunque falle la marca). A `avisarTodos()` se le sacó la UPDATE masiva. Los textos del modal y del Telegram dejaron de decir "avisadas automáticamente". `markEsperaNotified()` (botón individual de la tab Espera) **ya estaba bien hecho** y fue el patrón que se replicó.

**Regla que sale de acá (vale para cualquier proyecto):** *nunca marcar "hecho" antes de confirmar que se hizo*, y *el disparador de una notificación no puede vivir en el navegador de una persona*.

#### `[AVISOS-PRIORIDAD]` · diseñado, NO implementado · ver `docs/PLAN_AVISOS_PRIORIDAD.md`

De la charla sobre qué hacen otros sitios (los avisos de reposición son un patrón conocido de e-commerce: Amazon, Nike SNKRS, Zara, apps de Shopify) salió la idea de darle un **beneficio real** a quien se anota: una **ventana de privilegio** donde los clientes marcados se enteran primero y el producto sigue oculto para el público.

**Dato que aportó Alejo y que define el diseño:** en el local **ya lo hacen informalmente** — al cliente fiel le guardan el producto. O sea que no se inventa una práctica, se sistematiza una existente. Su pedido textual: *"desligando al empleado y a mí de todo esto"* + *"pensemos algo general para usarlo hoy y mañana que le vendamos a otros lugares"*.

**Decisiones tomadas:** prioridad **100% manual** (estrella que pone el jefe · nada automático por compras o puntos, porque el criterio real es humano) · ventana **configurable** en tabla, no hardcodeada · se apoya en el estado `pausado` **que ya existe** (cero cambios en el catálogo público) · liberación automática por `pg_cron` · **ejecución en la próxima sesión**. Plan completo, SQL propuesto (sin testear) y riesgos en `docs/PLAN_AVISOS_PRIORIDAD.md`.

#### `[DEPOSITO]` · pestaña nueva con el stock del depósito · commit `533dce8` · SW v1.1.81

Pedido de Alejo: una pestaña como "Precios & Stock" pero **sólo con el stock guardado en el depósito**, aparte del stock del local, visible para **jefe Y empleadas**.

- **BD:** migración `add_stock_deposito_a_perfume_overrides` → `perfume_overrides.stock_deposito integer not null default 0`.
- **Verificado antes de confiar:** que el upsert parcial `{slug, stock_deposito}` **NO pise** `stock_qty` ni `stock_status`, probándolo sobre una fila real con un valor no destructivo (`intacto: true`).
- **Front:** tab `📦 Depósito` sin `data-role` (la ven los dos roles · `canAccessTab` lo permite porque el botón no está marcado como jefe-only). Tabla `Perfume | Local (sólo lectura) | Depósito (editable)`, buscador, 4 órdenes y casilla "sólo con depósito". Tres métricas, entre ellas **"sin local pero con depósito"** (lo que hay que ir a buscar) y la marca "← traer al local" por fila.
- **El catálogo público no se toca:** sigue leyendo sólo `stock_qty`/`stock_status`.
- **Pendiente decidido a propósito:** no hay botón "mover del depósito al local", porque mover stock dispara los avisos de lista de espera y no convenía mezclar dos cosas en un mismo cambio.

#### `[PAUSADO-OCULTO]` · los pausados desaparecen de la web · commit `62fdf93` · SW v1.1.82

Alejo reportó que los perfumes **pausados seguían saliendo en el catálogo** con el cartel "Próximamente". **Semántica real acordada:** *pausado = ARCHIVADO* — productos fuera de temporada o que no van a traer hasta nuevo aviso. Mostrarlos como "Próximamente" con botón "Reservar por WhatsApp" **prometía algo que no iba a llegar**.

⚠️ **El panel mentía:** el texto del modal de stock decía *"Pausado — oculto en catálogo público"* y era **falso**. Corregido y ampliado.

**Decisión técnica clave:** se creó una bandera propia `p._pausado` en vez de reusar `_oculto`, aunque `_oculto` habría sido **una sola línea**. Motivo: `_oculto` significa *"perfume eliminado"* y además **marca como ROTO a cualquier combo que lo contenga** (`js/app.js` filtro de sets) → pausar un perfume habría hecho **desaparecer packs enteros** del sitio sin aviso. **Ahorrar una línea no vale romper los combos.**

Se filtra en: catálogo, buscador (las cards son el sustrato del search), relacionados, similares manuales, recomendador/quiz, Selección ST, armador de decants (`extras.js`, 3 puntos), rango del slider de precios, "nuevos" y contadores de categorías. **NO** se filtra en el chequeo de combos rotos, a propósito.

**Bug preexistente arreglado de paso:** `renderSeleccionST()` **no filtraba nada** — un perfume **eliminado** podía seguir apareciendo en el podio de la home.

**Impacto medido ANTES de aplicar:** 71 pausados (vs 111 `ok`, 32 `out`, 23 `low`). Se frenó el deploy para confirmarlo con Alejo, porque era casi un tercio del catálogo. **Lección: medir el impacto de un filtro antes de encenderlo, no después.**

**Corrección propia:** el plan `[AVISOS-PRIORIDAD]`, escrito horas antes, asumía que `pausado` ya ocultaba del catálogo. **Era falso al escribirlo.** Recién con este commit la premisa es cierta · anotado en el propio plan.

#### `[DECANTS-ESPACIO]` · el armador no dejaba agregar decants en celular · commit `8f08d2a` · SW v1.1.83

**Reportado por un CLIENTE REAL** (mensaje reenviado por Alejo):

> *"Tenés listado de decants disponibles? porque intenté por página y cuando selecciono 1 me sugiere otro y me tapa todo el listado, iba a agregar más pero no pude"*

Una venta perdida, no un detalle estético.

**⚠️ Mi primera hipótesis fue INCORRECTA y conviene dejarla escrita.** Diagnostiqué que faltaba `min-height: 0` en `.decant-builder-grid` — el clásico "flex item que no se achica". Sonaba impecable y hasta había evidencia circunstancial: un comentario viejo en `index.html` (`[DECANTS-UX-2 fix scroll]`) mostraba que alguien ya había peleado con el mismo síntoma y lo había esquivado moviendo contenido de lugar. **Pero al medirlo con un test A/B en un iframe aislado, los números dieron IDÉNTICOS.** Motivo: por especificación, un flex item con `overflow` distinto de `visible` **ya tiene mínimo automático 0** — `min-height: 0` era redundante. El listado siempre scrolleó bien.

**La causa real** (medido en el sitio vivo, 375x640, con 1 decant en el pack):

| Bloque | Alto |
|---|---|
| Header | 201 px |
| Buscador | 37 px |
| **Footer** | **159 px** (engorda de 89 a 159 apenas hay items: suma resumen + aviso) |
| **Listado** | **189 px → UNA card visible** |

El **marco fijo se comía el 67% del modal** (397 de 589 px). Y encima puede aparecer la sugerencia "Combinás bien con". Por eso el cliente lo vive como *"me tapa todo el listado"*: técnicamente estaba ahí, pero era una franjita.

**Fix (sólo CSS):** achicar el marco en pantallas bajas recortando lo redundante — subtítulo "Decants de N ml · Máx N" (el contador ya lo dice), escalera de precios (la barra de progreso comunica lo mismo), aviso de conservación (es info de *después* de comprar), paddings más ajustados y `max-height` 92vh → 96vh.

**Resultados medidos, con 1 decant en el pack:**

| Pantalla | Listado antes | Listado después | Cards |
|---|---|---|---|
| 375x640 (celu chico) | 189 px | 299 px | **1 → 3** |
| 390x844 (PWA instalada) | 383 px | 495 px | **3 → 5** |
| 1280x800 (laptop) | 323 px | 449 px | **3 → 4** |

**El corte es `max-height: 900px`, no 800**, porque la **PWA instalada no tiene barra de direcciones**: un iPhone que en el navegador da ~750 de alto, instalado da 844. Con el corte en 800, **justo los clientes que instalaron la app —los más fieles— se quedaban sin el arreglo.**

**Aprendizajes:**
1. **Una hipótesis que "suena bien" no es un diagnóstico.** `min-height: 0` es la respuesta correcta a *otro* problema. Medir antes y después es lo que separó el mito del fix.
2. **Cuando encontrás un parche viejo esquivando un síntoma, la causa sigue viva** — pero no asumas que es la que vos pensás.
3. **Los breakpoints por alto tienen que contemplar la PWA instalada**, que gana ~90 px al no tener barra del navegador.

#### Decisiones / bugs / aprendizajes

- **`mockups.html` funcionó como banco de pruebas** y se restauró con `git checkout --` al terminar (estaba commiteado, cero riesgo). El preview trata el worktree como carpeta externa → renderiza captura estática, no sirve para redimensionar; la vía que sí funciona es **iframe + `resize_window`**.
- **El dashboard de Supabase avisó solo** al crear la tabla de respaldo sin RLS ("Clients using anon or authenticated keys may be able to access..."). Se eligió **"Run and enable RLS"**: con RLS y sin policies la tabla queda cerrada a `anon`, y el editor SQL (rol `postgres`) la sigue leyendo. Confirma que el problema documentado en S2 es real.
- **El MCP de Supabase se cayó a mitad de sesión** → todo el SQL lo corrió Alejo por el dashboard con textos preparados. Funcionó bien y es un patrón replicable cuando el MCP no está.
- **El sandbox no tiene salida HTTP** (`curl` da `000` hasta contra GitHub). Para verificar producción: **navegador (Browser pane) o MCP de Vercel**, no `curl`.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[FOTOS-OREGON]` | 97 URLs de fotos reapuntadas de Oregon a São Paulo · verificado 0 rastros en BD y en el sitio vivo |
| `[OCULTAR-PAUSADOS]` | Casilla "Mostrar pausados" en Precios & Stock · ambos roles · preferencia por dispositivo + aviso "N pausados ocultos" |
| `[OCULTAR-VALOR-INV]` | "Valor de inventario" sólo para el jefe · grilla 3 columnas para empleada |
| **S11** (`ef1507d`) | Auth *fail-open* en `/api/send-notification` · ahora falla cerrado |
| `[WAITLIST-AVISO-REAL]` (`0dc444f`) | El aviso de reposición se manda de verdad · se marca al avisar, no antes |
| `[DEPOSITO]` (`533dce8`) | Pestaña nueva con el stock del depósito, aparte del local · ambos roles |
| `[PAUSADO-OCULTO]` (`62fdf93`) | Los pausados (= archivados) desaparecen de toda la web · 71 productos |
| `[DECANTS-ESPACIO]` (`8f08d2a`) | El armador de decants deja ver 3-5 cards en celular en vez de 1 |

#### 🪤 S11 · la trampa que apareció escribiendo este mismo cierre

Documentando el hallazgo de las variables de Vercel, se revisó `api/send-notification.js` y apareció esto en L35:

```js
const ADMIN_PASS = process.env.ADMIN_PASS;   // sin env vars → undefined
...
if (adminPass !== ADMIN_PASS) return res.status(401)...  // undefined !== undefined → false
```

**Una request que OMITIERA el campo `adminPass` pasaba la validación.** **Pero se activaba sola** en cuanto se repusieran las variables olvidando `ADMIN_PASS`: pasarela abierta para mandar push a todos los suscriptores.

**Al probar el fix en producción salió `500` en vez del `401` esperado** — y la explicación fue un hallazgo en sí: `webpush.setVapidDetails(...)` (L16-20) corre **a nivel de módulo**, fuera del handler, con las claves VAPID en `undefined` → **la función no llega ni a cargar**, todo request muere en 500 antes de ejecutar una línea del handler. O sea que S11 **nunca fue alcanzable**: el endpoint está caído desde mayo. ⚠️ Corolario honesto: **el `401` del fix no es observable en producción hasta que existan las env vars** · lo verificado es la lógica (5 casos en Node) + que el código está desplegado · **hay que re-testear al hacer `[VERCEL-ENV-VARS]`**. Se arregló en el acto con `if (!ADMIN_PASS || adminPass !== ADMIN_PASS)` (fallar cerrado), verificado con los 5 casos posibles. **No requirió bump de SW** (las funciones de `api/` son código de servidor · el SW no las cachea · confirmado con `grep "api/" sw.js` vacío).

**Aprendizaje generalizable:** toda comparación contra una variable de entorno que pueda ser `undefined` tiene que **fallar cerrado**. `api/cron/backup.js` ya lo hacía bien (`CRON_SECRET && auth === ...`); fue el único otro caso y estaba OK. Es un patrón para revisar cada vez que se toque un endpoint con auth.

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[VERCEL-ENV-VARS]` 🔴 | Reponer `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASS`, `VAPID_*`, `CRON_SECRET`. Revive backup propio + notificaciones push. La key se copia directo Supabase→Vercel, nunca por chat. ⚠️ **Al terminar, re-testear `/api/send-notification`**: un POST sin `adminPass` tiene que dar 401 (hoy la función ni carga, así que el fix de S11 no es observable) |
| `[BCRYPT-MIGRATION]` / S2 🔴 | Los 3 escalones de arriba. El paso 1 y el 2 se hacen juntos, con el local cerrado |
| `[BACKUP-FOTOS-LOCAL]` 🟡 | Bajar el bucket `perfume-fotos` a `D:\backups\`. Hoy las fotos sólo viven en Supabase (los backups diarios NO las incluyen) |
| `[AVISOS-PRIORIDAD]` 🟢 | **Etapa 1** de la ventana de privilegio. Diseño cerrado y SQL escrito (sin testear) en `docs/PLAN_AVISOS_PRIORIDAD.md`. Prioridad manual · liberación por cron · empezar por la BD |
| `[SECURITY-AUDIT-S1]` 🟠 | Borrar `ADMIN_PASS_EMPLEADO` (código muerto) + sacar `ADMIN_PASS` del JS público cambiando la auth de `/api/send-notification`. Se solapa con `[VERCEL-ENV-VARS]` |
| S10 🟠 | Escapar `c.nombre` en la tab Clientes (`renderClients`, ~L3900) |

#### 💬 Mensajes meta

- **Alejo desconfía con criterio y hay que agradecerlo, no defenderse.** Preguntó *"¿es así que solo eran las fotos?"* y esa duda destapó un hueco real en mi verificación (columnas `ARRAY`). También encontró el tooltip de "pausar deshabilitado" que yo no sabía. Ver aprendizaje **#71**.
- **Pidió explícitamente "el método más seguro"** y valoró que se le explicaran las alternativas descartadas, no sólo la elegida. Ver aprendizaje **#72**.
- Cuando algo se pone técnico pide **traducción a criollo con analogías** (la mudanza de casa, la agenda con la dirección vieja, el libro de actas) y **dibujos antes de implementar** (*"mostrame y/o graficame lo que hayas entendido y yo recién ahí te digo qué hacemos"*). Ver aprendizaje **#73**.
- Aprendizajes técnicos de la sesión: **#74** (medir responsive con iframe + `resize_window`, no con `top` ni ancho por CSS) y **#75** (en una migración, la BD es la fuente de verdad y el navegador el testigo).

---

### Sesión 2→14-sep-2026 · **El panel cómodo para las tablets + decants sin vender bajo costo**

Una sola conversación que duró dos semanas de calendario (2, 4, 5, 7, 12 y 14 de septiembre). Arrancó con "el catálogo quedó medio feo en el celular" y terminó en un patrón nuevo de trabajo: **ClaudeChat diseña y escribe los patches, Claude Code los aplica, los mide y los verifica antes de mergear.** 25 commits · SW **v1.1.83 → v1.1.96**. Todo mergeado a `main`, todo confirmado contra `www.stperfumeria.com`.

#### Qué se hizo

**Sitio público (celular)**
- `[BUSCADOR-MOBILE]` `42a1abf` · el `.search-input` estaba en 12.8px y Safari iOS hacía zoom al enfocarlo sin volver. 16px en mobile, `type="search"` + `enterkeyhint`, Enter baja el teclado. Borrado el código muerto del nav search.
- `[CARD-VERTICAL]` `4149ad9` · la foto del perfume medía ~100px (`.card-image{width:30%}` sin override mobile). Card apilada: foto cuadrada de 294px arriba, info abajo. El swipe de la galería pasa de 100 a 303px de ancho. Desktop intacto (el `.mirror` entero vive en `min-width:768px`). `selectSuggestion()` scrolleaba al grid con `-130` hardcodeado y decía "instantáneo" sin serlo (`scrollTo(x,y)` hereda `scroll-behavior:smooth`): ahora `behavior:'instant'` leyendo `scroll-padding-top` del CSS.
- `[DECANTS-ESPACIO-2]` `e77b5f5` · el fix de agosto (299px) había vuelto a 181px porque después se apilaron la barra de progreso (62px) y el combo (49px). Recorte: 262px, 3 cards.
- `[DECANTS-CAJON]` `f35c572` · opción C de los mockups. El armador pasa a pantalla completa en celular y contador/ahorro/progreso/escalera/combo bajan a un **cajón** (`#decantSheetBody`) cerrado por defecto. Listado **390px, 4 cards** cerrado. Lo importante: el marco **ya no puede volver a crecer**, lo nuevo entra al cajón.

**Decants — el bug de plata**
- `[DECANT-TOPE]` + `[DECANT-DEDUP]` `0402dfa` (patch de ClaudeChat) · el armador listaba TODO el catálogo a precio de escalera sin mirar el frasco: un Erba Pura de $430.000 salía como decant a $9.500 con costo real de $21.500. Tope `precio_frasco_max` (170.000, normalizado a 100ml) en `decants_config`: arriba del tope → "💬 Precio a consultar" + WhatsApp. Y de-duplica contra `decants_custom` (se dibujaban dos cards del mismo perfume y el cliente elegía la barata). + `f99de42` retry sin la columna si falta el SQL (sin eso se rompía TODO el guardado de Decants, no sólo el tope).
- `[DECANT-PRECIO-MANUAL]` `341df8e` · columnas `precio_decant` + `decant_excluido` en `perfumes_nuevos` y `perfume_overrides`. Bloque "💧 Decants" en Editar y Nuevo perfume con aviso en vivo (naranja si va a salir "a consultar", verde con el precio). El armador cobra el precio manual como fijo.
- Cache · `50393d0` + `9755cdb` · un precio **borrado** llegaba como `null`, `applyOverrideToPerfume` no pisa nulls, y el valor viejo sobrevivía 30 min en `st_cache_perfume_overrides`. El primer patch lo arregló pero **borraba a ciegas** y se llevaba el precio de `perfumes_nuevos` (reproducido: nuevos=18000, override=NULL, cache=25000 → quedaba "a consultar"). El segundo guarda `{slug, tenia, valor}` con `hasOwnProperty` y restaura. Tres escenarios medidos.

**Panel admin (Galaxy Tab A9, vertical)**
- `[LOG-LEGIBLE]` `5b6d7d7` · el historial mostraba slugs crudos, columnas con guión bajo y 9 acciones sin etiqueta. Traducido con `AUDIT_FIELD_LABELS` / `AUDIT_VALUE_LABELS` / `auditPerfumeName`. De paso: `logAdminAction('seleccion_badge_update', {…})` se llamaba con 2 argumentos y nunca registraba.
- `[BUSCADOR-X]` `a7c2bc9` → `{CAMPOS-X}` `7d7e45f` · primero la ✕ en 7 buscadores por lista de IDs; Alejo aclaró que la quería en **todos los campos**. Ahora por selector (54/54), `data-sin-x="1"` para excluir. + inputs a 16px + backdrop del sidebar con fade. + "Sólo con depósito" → "Sólo los que tienen unidades" (Alejo preguntó qué hacía: señal de que no se entendía).
- `[DEPOSITO-A-LOCAL]` `0be83ce` (patch de Alejo) · restar el depósito suma al local, atómico, con casilla "No sumar al stock local". Luego `46a030a`: mueve la **diferencia** (5→2 suma 3), no sólo al llegar a 0.
- Fase 1 `a3a7742` + `74a22e4` · sidebar como riel con grupos **por uso real** + tokens de medidas / área táctil mínima + `npm run metricas` (marcador de deuda visual: 452 `!important`, 887 `style=` inline, 522 KB).
- `76c9e39` · Enter guarda en modales (listener delegado, 76 campos), en buscadores baja el teclado; `modalClientDelete` excluido con `data-sin-enter`; `MODAL_CIERRE_MS = 350` (antes 900–1500 ms con Supabase contestando en ~194).

#### Decisiones / bugs encontrados / workarounds

- **Ranking de uso real** (`admin_actions`, 2.308 registros, 5-jul→5-sep): Stock 1.756 + Depósito 282 = **88%** de todo. Las empleadas nunca usaron Editar ni Ocultar (0/0). Config de decants y backup manual: 1 vez cada uno. ⚠️ `admin_actions` sólo registra ESCRITURAS: lo que se mira (Analytics, Estadísticas, el historial) sale en cero aunque se use. Retención 60 días. Las dos empleadas comparten cuenta → no se puede separar por persona. Con esto el "superadmin" se descartó: se reordenó la barra en vez de apagar funciones.
- **El historial para las empleadas: NO.** La policy real de `admin_actions` es `email = 'jefe@…'` — la doc decía "read solo auth" y era falso (corregido en `DATABASE.md`). Alejo decidió dejarlo como está.
- **Android no hace zoom** al enfocar inputs <16px (es de Safari). Corregí un diagnóstico mío: en las Tab A9 los 13.6px eran legibilidad, no zoom.
- **`:has()` no invalidaba** al sacar los skeletons del DOM (min-height clavado en 2900). Y **`max-height` con `!important` inline computaba 0px** en el cajón de decants — sin causa encontrada; se usó `display`. Ambos documentados en `FRONTEND.md`.
- **Especificidad**: un `@media` no suma nada; el recorte de decants no aplicó hasta moverlo al FINAL de la sección. El bloque de agosto funcionaba "de casualidad" (`display:none` sobre elementos sin `display` base).
- **`scrollIntoView` es no-op en el panel de preview** de Claude Code; `window.scrollTo` sí anda. No shippear lo que no se puede verificar.
- **Los previews de Vercel redirigen a SSO**: un `200` desde acá es la pantalla de login, no prueba nada. Producción se verifica contra `www.stperfumeria.com` (`sw.js` + grep de la lógica).
- **El worktree "vuelve solo" a `0be83ce`** entre sesiones (pasó 3 veces). `git status` da limpio y no lo detecta. Defensa: `git checkout -B <rama> origin/main` como paso 2 de todo prompt de patch, y comparar el `index <hash>` del patch contra `git rev-parse origin/main:admin.html`.
- El patch del contador de decants **infla** el número: cuenta perfumes sobre el tope sin descontar los que tienen custom (que se esconden, no salen "a consultar"). 7 mostrados, 6 reales.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[BUSCADOR-MOBILE]` | Input 16px, sin zoom iOS, Enter baja teclado |
| `[CARD-VERTICAL]` | Card apilada en celular, foto 294px |
| `[DECANTS-ESPACIO-2]` / `[DECANTS-CAJON]` | Armador full-screen con cajón · 4 cards |
| `[DECANT-TOPE]` / `[DECANT-DEDUP]` / `[DECANT-PRECIO-MANUAL]` | No vender bajo costo + precio manual por perfume |
| `[LOG-LEGIBLE]` | Historial en castellano |
| `[BUSCADOR-X]` → `{CAMPOS-X}` | ✕ en los 54 campos, por selector |
| `[DEPOSITO-A-LOCAL]` (+ diferencia) | Restar depósito suma al local |
| `{ERROR-PRECIO-PERFUME-EN-SECTOR-DECANT}` | Era el bug de plata → cerrado por DECANT-TOPE |
| `[BUSCADOR-X-TOGGLES]` | Renombrado a `{CAMPOS-X}` |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[DEPOSITO-MISMO-+/-]` 🟡 | El ± del depósito idéntico al de Precios & Stock (hoy dos modales distintos) |
| Verificación visual del riel 🟡 | Fase 1 y Enter se mergearon por urgencia sin medir a 600px |
| Contador del tope infla 🟢 | Restar los que tienen custom |
| Historial: 2 registros por pase depósito→local 🟢 | Unificar en una acción propia |
| Cuentas separadas por empleada 🟢 | Prerrequisito para medir uso por persona |

#### 💬 Mensajes meta

- La dupla **ClaudeChat (diseña a ciegas) + Claude Code (verifica con los ojos abiertos)** funcionó: 8 patches, 2 bugs reales atrapados antes de mergear (uno mío al medir, el arreglo elegante de él). Alejo tenía razón en que yo subestimaba a ClaudeChat.
- Alejo trabaja con **prompts numerados en 3 partes** (aplicar / verificar checklist / commit+push+preview). Cuando llegan sin contexto (patch que no existe, base desfasada), frenar y explicar en criollo.

### Sesión 15-sep-2026 (noche) · **Verificación del riel / tokens / Enter a 600px** + `[TAP-44]`

Cerró el pendiente 🟡 "medir riel/tokens a 600px". La Fase 1 del panel (`a3a7742` riel + `74a22e4` tokens) y el Enter (`76c9e39`) se habían mergeado por urgencia sin medirlos nunca en el ancho real de la **Galaxy Tab A9 en vertical: 600 px CSS** (800 físicos / DPR 1,33 — ⚠️ en notas viejas de mayo figura "800px", eso son los físicos). Alejo pidió **medir, no mirar**: servidor local `no-store`, panel forzado, `window.sb` stubbeado, nada de previews de Vercel. De paso se aplicó el patch de 44px del cowork (ClaudeChat) y se cerró la decisión del breakpoint. Sesión corta: 2 commits de código + este cierre.

#### Qué se hizo

- **Ritual git al arrancar**: `status` limpio → `fetch origin main` → `checkout -B <rama> origin/main` **aunque estuviera limpio** (el worktree se había vuelto solo a `0be83ce` tres veces) → HEAD confirmado en `06451f4`. EOL verificado con `od`: `admin.html`, `app.js`, `styles.css`, `sw.js` son **CRLF en el árbol** (`autocrlf=true`, índice LF).
- **Setup de medición, reproducible, vive en el scratchpad de Claude Code (NO en el repo):**
  - `server.js` (Node sin deps, puerto 8765): sirve la raíz del worktree con `Cache-Control: no-store` en todo; **`/sw.js` → 404** para que no se registre ningún Service Worker entre el navegador y los archivos; `/__harness.js` sirve el stub; `?demo` inyecta el harness y entra solo al panel; `/admin-riel.html` sirve `admin.html` transformado en memoria (ver variante abajo).
  - `harness.js`: reemplaza `window.sb` por un **Proxy encadenable** (`.from().select()…` resuelve `{data:[], error:null}`, `auth.getSession()` sin sesión, `channel().on().subscribe()` no-op) y llama `enterAdminPanel('jefe')`. Expone `window.__m` (rects, layout, desborde por pestaña). Verificado en cada carga: **0 requests a `supabase.co`, 0 SW registrados**.
  - Viewport emulado 600×1005 (Tab A9 vertical) y 800×1280 (control, del otro lado del breakpoint 700). Todo por `getBoundingClientRect` / `getComputedStyle`; Enter con **tecla real** del navegador y espías sobre `saveStock` / `deleteClient`; recorrido de las **22 pestañas del jefe** con `switchTab` midiendo `scrollWidth` y cualquier elemento con `right > innerWidth`.
- **Resultados de la verificación (código de `06451f4`, antes de tocar nada):**

  | Criterio | 600 px (≤700 · rama "mobile") | 800 px (≥701 · rama riel) |
  |---|---|---|
  | `.admin-main` plegada vs desplegada | **x=16 / w=568 en ambos** ✅ | **x=56 / w=729 en ambos** ✅ |
  | Qué es la barra | Overlay `position:fixed` 260px (`translateX(-100%)` ↔ `0`), grid de **1 columna**. **No hay riel.** | Riel `static` 56px ↔ panel `absolute` 240px superpuesto, grid `56px 729px` fijo |
  | Scroll horizontal (22 pestañas) | `scrollWidth` 600 = `innerWidth` en todas ✅ | 785 < 800 en todas ✅ |
  | Elementos desbordados | **1**: header "Acciones" del grid de decants de diseñador (ver abiertos) | 0 |
  | Hamburguesa | 44×44 ✅ | 44×44 ✅ |
  | Tema / Cerrar sesión | 81×**40** / 132×**40** ❌ (token `--ctrl-h`) | ídem ❌ |
  | 13 labels de checkbox (9 estáticos + 4 de Beneficios que renderiza JS; 3 viven en formularios plegados y se destaparon para medir) | **todos 44** (`modalStock` 48) ✅ | todos 44 (`modalStock` 63) ✅ |
  | Enter en `#modalStockQty` | `saveStock` **1×**, `defaultPrevented` ✅ | 1× ✅ |
  | Enter en `modalClientDelete` con el botón **habilitado** (tipeado "ST" — si se deja `disabled`, ese guard tapa al de `data-sin-enter` y la prueba no dice nada) | `deleteClient` **0×**, modal sigue abierto ✅ | 0× ✅ |
  | Enter en `#searchPrecios` (id) y `#editSearch` (sólo clase `.admin-search`) | foco → `BODY` (blur), sin disparar guardado ✅ | ✅ |

  **Conclusión: Fase 1 y Enter funcionan a 600.** Los únicos ❌ eran una decisión del CSS (tema/logout a 40), no bugs → `[TAP-44]`.
- **Hallazgo principal: el riel no llega a la tablet vertical.** Vive en `@media (min-width: 701px)`; a ≤700 aplica la rama overlay de `[ZAPATO]`. La Tab A9 en vertical (600) cae en overlay + hamburguesa; **en horizontal (~1005) sí cae en riel**. Lo que se había mergeado "para las tablets" nunca se ejecutó en la orientación en que las usan.
- **Variante riel a 600, medida SIN tocar el repo**: `/admin-riel.html` transforma `admin.html` en memoria con **11 reemplazos literales** (`(min-width: 701px)`→`600px` ×3, `(max-width: 700px)`→`599px` ×5, `innerWidth > 700)` ×1, `innerWidth > 700 &&` ×1, `innerWidth <= 700)` ×1). Contar reemplazos salvó el error: el primer intento dio 10 porque `closeMobileSidebar` (L3770) usa `> 700 &&` sin paréntesis.

  | | **Overlay (hoy)** | **Riel (variante)** |
  |---|---|---|
  | `.admin-main` plegada = desplegada | x=16 / **w=568** ✅ | x=72 / **w=512** ✅ (no 544: el `.panel` a ≤600 tiene 16px de padding por lado) |
  | Stock ↔ Depósito | 2 toques (☰ → pestaña) | 1 toque |
  | Scroll horizontal (22 pestañas) | 0 | 0 |
  | Tabla Precios (4 col) / Depósito (3 col) | entra | entra: 475 px en 480 de wrapper, filas de 44 |
  | Header "Acciones" de decants | asoma −43 px, recortado por `overflow:hidden` | asoma **−103 px** — pasa de "se corta" a "no se lee" |
  | Iconos del riel | — | 12 × 43,8×40 (→ 44 de alto con `[TAP-44]`) |
  | Panel expandido | 260 px `fixed` | 240 px `absolute` sobre el contenido, backdrop ✅ |
  | Header / barra al scrollear | ninguno es sticky | ídem: en las dos hay que subir para cambiar de pestaña |

  Las dos variantes quedaron abribles en el mismo servidor (`/admin.html?demo` y `/admin-riel.html?demo` a 600 de ancho) por si el jefe o las chicas quieren verlas.
- **`[TAP-44]` · `55df691`** — patch del cowork `tap-44-unificado.patch` (base `index d818294` = `origin/main:admin.html`), `git apply --check` limpio contra árbol (CRLF) e índice (LF). 3 hunks: borra `--ctrl-h`; `#themeToggleBtn, .panel-logout` → `var(--tap-min)`; **`.sidebar .tab-btn { min-height: 40px }` hardcodeado (L485) → `var(--tap-min)`** — ese tercero es hallazgo del cowork y resuelve los iconos del riel a 40 que yo había flageado como ortogonal. Medido antes/después en la misma página: 600 → tema/logout/12 botones 40→44, header 123,4→127,4 (+4, dos filas por el bloque `max-width:600px`); 800 → 40→44 los tres, header **77→77**, `.admin-main` 56/729 idéntico plegada y desplegada.
- **`0f11376`** — bump SW **v1.1.96 → v1.1.97**, leído del `CACHE_VERSION` real con Node (no hardcodeado), commit aparte.
- **Push** `06451f4..0f11376` → `main` (fast-forward verificado con `merge-base --is-ancestor`, sin force).

#### Decisiones / bugs encontrados / workarounds

- **Breakpoint: el overlay a ≤700 queda A PROPÓSITO.** Razones con número: el objetivo real (que el contenido no cambie de ancho al abrir la barra) **ya se cumple** a 600 (16/568 idéntico plegada y desplegada); el riel costaría **56 px fijos de 600** (568→512, −10 %); empeora el header de decants de −43 a −103; el único beneficio concreto es Stock↔Depósito en 1 toque en vez de 2, y el panel **arranca en Stock, que es el 76 % del uso** (1.756 / 2.308 acciones). El cowork recomendó lo mismo por su cuenta con una simulación independiente que dio los mismos números (512 / 482 / −100). Es una decisión de uso: si el jefe o las chicas piden el riel en vertical, se reabre **con estos números**, no desde cero.
- **Si algún día se baja el umbral, son 11 lugares, no 7**: CSS L285, **L288**, L302, L330, L359, L423, L518, L529 + JS L3657, L3701, L3770 (números de `0f11376`). **L288 es la grave**: `.app-shell { grid-template-columns: 1fr }` a ≤700; si queda, a 600 el main pide `grid-column: 2` sobre un grid de una columna, se va a una columna implícita y el layout se rompe entero. Y si se olvida uno solo de los 3 de JS, el CSS muestra el riel pero la hamburguesa alterna `sidebar-open` en vez de `sidebar-expanded` y la barra no abre (falla silenciosa y total). Además a **exactamente 600 aplicarían dos ramas** (`min-width:600` + el bloque celular `max-width:600px` de L1006): habría que decidir si ese bloque baja a 599.
- **El riel nunca se diseñó para la tablet vertical: se heredó.** El breakpoint 700 nació en **`f4437a7` (14-may, `[ZAPATO]`)**; el riel (`a3a7742`, 5-sep) se metió adentro de la rama de escritorio existente y sumó 1 `min-width:701` + 1 `innerWidth` (`closeMobileSidebar`). El cowork lo confirmó en criollo: *"no lo pensé, lo heredé"*. (Atribuyó el origen a `f35c572`, que es posterior; ahí ya estaba.)
- **Con el pane del navegador oculto, las transiciones CSS no avanzan y TODOS los rects dan 0.** Primera medición del overlay abierto dio `translateX(-260)` después de 800 ms: no era el CSS, era que sin frames de render la transición no corre. Defensa que quedó en el método: inyectar `*{transition:none!important}` durante la medición (no afecta posiciones ni tamaños) + un guard que aborta si `#adminPanel` mide 0. Corolario: **cuando todo da 0, sospechar del instrumento antes que del panel.**
- **Bug mío en el harness**: un helper "destapaba" ancestros `display:none` para medir labels plegados y el `undo` capturaba la variable del loop (closure clásico) → restauró sobre `document.body` y lo dejó en `display:none`, y `#editFormWrap` / `#newClientForm` / `#depSumarWrap` quedaron destapados. Detectado porque el panel entero dio 0×0 con `display:block`; revertido a mano contra los `style` originales del HTML y verificado que `.admin-main` volvió a 16/568 antes de seguir. No tocó el repo.
- **`computer key "Return"` no llega a la página; `"Enter"` sí.** El listener de captura no vio ningún keydown con `Return`. Con `Enter`: keydown real en el input, `saveStock` 1×, y un `type "7"` entró al campo (prueba de teclado real, no sintético).
- **`sed` en Git Bash se come el `\r` al leer archivos CRLF** (`sed -n 74p | od -c` mostró sólo `\n` en un archivo 100 % CRLF) → un `sed -i` habría convertido `admin.html` entero a LF. Las ediciones se hicieron **byte a byte con Node (`latin1`)** y se verificó CR = líneas antes y después. `git apply`, en cambio, **aplica bien un patch LF sobre el árbol CRLF** (`--check` pasó tanto contra el árbol como `--cached`) y deja CRLF.
- **`git reset --hard` lo frena el clasificador de auto-mode** (destrucción local irreversible). Con el árbol limpio, `git checkout -B <rama> origin/main` mueve la rama igual, deja los commits descartados en el reflog, y **es el paso 3 del ritual** — no hace falta pelear el permiso.
- **Se descartaron 2 commits propios (`ee747dc` + `9b8993e`, locales, nunca pusheados)** que hacían sólo L74, para aplicar el patch del cowork que era superconjunto (L56 + L74 + L485). Un commit limpio con la autoría del patch > dos commits solapados. Quedan en el reflog del worktree.
- **A 600 el header crece 4 px con los 44** (123,4→127,4): había predicho que no crecía y medí que sí, porque a ≤600 el `.panel-header` va en dos filas y la segunda la mandan tema/logout. A 800 (una fila, la manda la hamburguesa) 77→77. Predicción ≠ medición: se reporta la medición.
- **Las respuestas del cowork se chequean contra el repo antes de opinar**: de 3 hechos, 1 exacto (L485 con `min-height: 40px` hardcodeado — buen hallazgo), 1 con error de detalle (origen del breakpoint) y 1 incompleto que habría roto el layout ("4 lugares en CSS": son 8, faltaba L288). Sus mediciones simuladas coincidieron con las reales.
- **Decants: header "Acciones" del grid de diseñador** (`admin.html` ~L2687-2694): grid inline de 7 columnas fijas (`60px 1.3fr 1fr 110px 70px 80px 110px`) que a 600 llega a `right=627` contra 584 del main (−43 recortado, sin scroll por el `overflow:hidden` del main). No sigue el stack responsive de `.dc-row` de `[DC-RESPONSIVE-FIX]`, así que a ≤1099 sus columnas ni se alinean con las filas. Cosmético, preexistente, flageado — no tocado.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| Verificación riel / tokens / Enter a 600 | Medido en las dos ramas: Fase 1 y Enter funcionan; `.admin-main` idéntico plegada/desplegada; 0 scroll horizontal en 22 pestañas; 13 labels a 44 |
| `[TAP-44]` | Tema, cerrar sesión y los 12 botones de la barra a `--tap-min` (44); `--ctrl-h` borrado · `55df691` + SW v1.1.97 `0f11376` |
| Breakpoint riel vs overlay | **Cerrado: overlay a ≤700 a propósito**, con números de las dos variantes (568 vs 512 · −43 vs −103) |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| ~~`[DEPOSITO-MISMO-+/-]`~~ ✅ | **HECHO el 16-sep** (`e18ac20`) — ver § "Sesión 16-sep-2026" |
| `[DC-HEADER-600]` 🟢 | El mini-header de columnas del grid de decants de diseñador asoma −43 px a 600 y no sigue el stack de `.dc-row`; a ≤1099 sobra o hay que hacerlo responsive |
| Contador del tope infla 🟢 | Restar los que tienen custom |
| Historial: 2 registros por pase depósito→local 🟢 | Unificar en una acción propia |
| Cuentas separadas por empleada 🟢 | Prerrequisito para medir uso por persona |

#### 💬 Mensajes meta

- Alejo arrancó con **"decime qué vas a medir y cómo, antes de tocar nada"** y funcionó: el plan previo (con dos avisos que salían de leer el código, no de medir) le permitió decidir "medí las dos ramas" antes de que yo gastara nada.
- Cuando dice **"me recontra perdí"**, quiere **una sola acción concreta** ("pegame el patch"), no una tabla de opciones. La tabla A/B/C de antes fue lo que lo perdió.
- Delegó la decisión del breakpoint en la dupla y pidió mi opinión sobre el proceso: la respuesta que sirvió fue **separar quién decide qué** (44 px → él en 10 segundos; riel vs overlay → las chicas, mirando las dos) en vez de opinar sobre el layout.

### Sesión 16-sep-2026 · **`[DEPOSITO-MISMO-+/-]` + `[DEPOSITO-LOCAL-CLICK]`** — el depósito con el mismo ± que el stock

Pedido de las chicas vía Alejo, con captura del modal de Stock: *"quiero agregar ESTO así tal cual '+ X −' en el depósito, y que al clickear la columna de Stock Local en la sección DEPÓSITO se cambie justamente el stock local"*. Cierra el pendiente 🟡 `[DEPOSITO-MISMO-+/-]` y suma una pata nueva. Alejo pidió sumar también el buscador que se perdía al guardar. 4 commits · SW **v1.1.97 → v1.1.99**.

#### Qué se hizo

- **Ritual git**: `status` limpio → `fetch` → `checkout -B <rama> origin/main` → HEAD `8f612b5`. Lectura previa de `modalStock` / `modalDeposito` / `renderDeposito` / `saveStock` / `saveDeposito`, plan en tabla (qué hay hoy vs qué se hace), go de Alejo.
- **`[DEPOSITO-MISMO-+/-]` · `e18ac20`** — en `modalDeposito` el input pelado se reemplazó por **la misma fila `− / campo / +` de `modalStock`** (mismas clases `action-btn btn-stock`, mismo estilo inline, `min-width 44`; el input pasa a `max=999`, `font-size 1.4rem`, `margin-bottom 0; flex:1`, y el label a `.modal-label`). Nueva `depQtyStep(delta)` calcada de `stockQtyStep` (clamp 0..999) que llama `toggleDepSumar()` en cada toque → al tocar **−** aparece en vivo la casilla "No sumar al stock local" con el hint *"Vas a mover N unidades del depósito al local"*, igual que si tipearas. Tocar afuera cierra (`closeModal('modalDeposito',event)` en el overlay + `stopPropagation` en la caja, como en Stock). **`saveDeposito` y toda la lógica `[DEP-SUMAR]` quedan intactas**: los ± sólo mueven el número del campo.
- **`[DEPOSITO-LOCAL-CLICK]` · mismo commit** — en `renderDeposito` la badge de **Local** dejó de ser de sólo lectura: `onclick="openStockModal(slug)"` → abre **el mismo modal de Precios & Stock** (±, preview "Se mostrará como", Pausado). Nada duplicado. `saveStock` ahora también llama `renderDeposito()` para que esa tabla muestre el local nuevo al toque (y recalcule el "← traer al local"). Tip de la tabla: *"tocá el número de Depósito o la badge de Local para cambiarlos. Es el mismo control que en Precios & Stock."*
- **Buscador que sobrevive al guardado · mismo commit** — `renderPrecios` y `renderDeposito` terminan con `filterTable(...)`. Antes, guardar (o cambiar el orden / la casilla) re-dibujaba las 146 filas y la chica perdía lo que había buscado. Pasaba en las dos pestañas.
- **`[TAP-44]` para los modales · `4329a59`** — midiendo salió que el **− / +** medían 40,2 px en los dos modales (también en Stock, que ya era así: el `[TAP-44]` del 15-sep fue tema/logout/barra) y el Guardar / OK 39,6-40,6. Regla nueva en el bloque `[TOKENS]`: `.modal-box .btn-stock, .modal-btn { min-height: var(--tap-min) }`. Los 22 `.modal-btn` del panel quedaron ≥ 44; las cajas crecen 3,4-4 px y entran en 600 (`right` 576).
- **Bumps** `bc14edc` (v1.1.98) y `1cb7246` (v1.1.99), leídos del `CACHE_VERSION` real. Dos pushes fast-forward (`8f612b5..bc14edc`, `bc14edc..1cb7246`).
- **Verificación a 600 px** (servidor local `no-store` + `sb` stubbeado + clicks y teclas **reales** · 0 requests a `supabase.co`): las dos filas ± **idénticas en todo lo computado** (rects, padding, fuente, fondo, radio); 5 → − − → "Vas a mover 3 unidades" → + + + → 5 y la casilla se esconde; clamp 0..999; Enter en `#modalDepQty` dispara Guardar; tap afuera cierra; Local → `modalStock` con nombre y "2 u." correctos → + → Enter → **"3 u." en la tabla de Depósito y en la de Precios al toque**; buscador "your touch" 2/146 visibles antes y después del re-render (Precios "asad" 3/146); 0 desbordes en la pestaña ni en el modal con la casilla visible.

#### Decisiones / bugs encontrados / workarounds

- **Ediciones múltiples en `admin.html` con un script Node de reemplazos exactos** (`edit-deposito.js` en el scratchpad): cada "antes" tiene que aparecer **exactamente una vez** o no se escribe nada; round-trip UTF-8 verificado antes de escribir; CRLF intacto (10070 → 10098 CR = líneas); y un parseo de los `<script>` inline con `new Function` como chequeo de sintaxis. 8 ediciones, 0 sorpresas. Es el reemplazo seguro de `sed -i` en este repo.
- **Los modales están centrados verticalmente: cuando aparece la casilla `[DEP-SUMAR]` la caja crece y la fila ± se corre ~30 px hacia arriba.** Mis clicks 2 y 3 en **−** fallaron por coordenadas viejas, no por el código. Regla para tests con `computer left_click`: **re-medir coordenadas después de cada cambio de layout** (o clickear por `ref`).
- **`renderDeposito()` en cada `saveStock`** dibuja 146 filas aunque la pestaña no esté a la vista. Mismo costo que `renderPrecios` (que ya se llamaba siempre); no se notó. Si algún día pesa, condicionar a `#tab-deposito.active`.
- **El − / + medían 40 en Stock desde siempre** y nadie lo había medido: `[TAP-44]` del 15-sep tocó tema/logout/barra porque eso pedía el criterio. Lección: cuando se copia un control "idéntico", medirlo también destapa lo que el original tenía mal.
- **Confusión al cierre**: dije "`[DEPOSITO-MISMO-+/-]` pasa a cerrado" refiriéndome a la **doc** y Alejo entendió que el código no estaba hecho. Decir "en la doc" explícito cuando la feature ya está subida.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[DEPOSITO-MISMO-+/-]` | El ± del depósito idéntico al de Precios & Stock, con la casilla `[DEP-SUMAR]` en vivo · `e18ac20` |
| `[DEPOSITO-LOCAL-CLICK]` | La badge de Local en Depósito abre `modalStock`; `saveStock` refresca la tabla de Depósito · `e18ac20` |
| Buscador que sobrevive al guardado | `filterTable()` al final de `renderPrecios` / `renderDeposito` · `e18ac20` |
| `[TAP-44]` modales | − / + y Guardar / OK de todos los modales a 44 · `4329a59` |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[DC-HEADER-600]` 🟢 | El mini-header de columnas del grid de decants de diseñador asoma −43 px a 600 y no sigue el stack de `.dc-row` |
| Contador del tope infla 🟢 | Restar los que tienen custom |
| Historial: 2 registros por pase depósito→local 🟢 | Unificar en una acción propia |
| Cuentas separadas por empleada 🟢 | Prerrequisito para medir uso por persona |

#### 💬 Mensajes meta

- Alejo pide features **con captura de lo que ya existe** ("ESTO así tal cual") — la referencia es un control del propio panel, no un diseño nuevo. Copiar exacto y medir que sea exacto.
- **Plan en tabla "qué hay hoy / qué hago" → "¿Dale?" → un solo "Dale"** funcionó de nuevo; sumó "incluí lo del buscador también" a un ortogonal que le flageé con costo (1 línea) — flagear con costo ayuda a que decida rápido.

### Sesión 16→17-sep-2026 · **`[BCRYPT-MIGRATION]` S2 RESUELTO** — las contraseñas de los clientes dejan de estar al alcance de cualquiera

El pendiente 🔴 más viejo del proyecto (documentado desde mayo, agravado en junio, medido en agosto). Se hizo con la dupla: **ClaudeChat diseñó y escribió** (SQL + parche de `app.js`) a partir de un brief con hechos verificados, **Claude Code aplicó y midió** en producción, **Alejo corrió las fases SQL** en el SQL Editor y decidió el orden. 1 commit de código (`98b556c`) · SW **v1.1.99 → v1.1.100** · 2 fases SQL en producción · S2 cerrado el 17-sep.

#### Qué se hizo

- **Brief para el cowork** (16-sep) con hechos del código (las 8 llamadas `anon` a `clientes` en `app.js`, líneas y qué necesitaba seguir funcionando; los 17 usos `authenticated` del panel; el flujo `[FORGOT-PASS-A]`), y **addendum con hechos de la base** consultados por MCP: las 4 policies reales eran todas para `public` con `true` — **incluida una de DELETE** que nadie había relevado (cualquiera con la anon key podía borrar clientes) — y **no existía ninguna policy de `authenticated`**: el panel entraba por las de `public`. Ese dato cambió el diseño: la FASE 3 crea las 4 de `authenticated` **antes** de borrar las viejas.
- **Diseño (ClaudeChat)**: 5 RPC `SECURITY DEFINER` (`cliente_login`, `cliente_registrar`, `cliente_editar`, `cliente_puntos`, `cliente_reset_solicitar`) + helper `_cliente_hash` (bcrypt cost 10, **73 ms medidos** en la instancia) + tabla `cliente_login_intentos` (rate-limit server-side: 5 fallos → 15 min; RLS activa sin policies, sólo la tocan las funciones). Migración perezosa: si la clave guardada no empieza con `$2`, compara en plano y la reemplaza por el hash en el mismo login; también al editar perfil. Hash dummy cuando el teléfono no existe (**77,1 ms vs 76,2 ms** de un login real: el tiempo no delata qué números existen). Mensaje unificado *"Teléfono o contraseña incorrectos"*. La columna `bloqueado` **por fin bloquea** (el panel tenía un botón que nunca hizo nada: el login jamás la leyó) y devuelve el mismo `invalido` que una clave mala. `password = ''` (alta manual del panel, default de la columna) se activa igual que `NULL` (reset).
- **Prompt 1/3** (16-sep): rama `feat/s2-bcrypt` sobre `f7da8bf`, `git apply --check` limpio, `app.js` con **0** `from('clientes')`, `node --check` OK. SQL sin correr.
- **Prompt 2/3 · FASE 1 en producción** (16-sep, vía `apply_migration`): funciones creadas, policies viejas intactas. Al probar `cliente_registrar` → **`invalid input syntax for type bigint: "eff38d8b-…"`**: **`clientes.id` es `uuid`**, no `BIGSERIAL` como decía `DATABASE.md` (y `password_reset_requests.cliente_id` también). Freno, rollback natural (la transacción abortó: 0 filas de prueba, 96 clientes intactos), y devolución al cowork con 3 hallazgos más: `where telefono = p_telefono` ambiguo con el OUT param `telefono`, `_cliente_hash` ejecutable por `anon` por los *default privileges* de Supabase, y el drop obligatorio de las firmas viejas.
- **El cowork lo probó contra un Postgres 16 real** y devolvió 4 correcciones más: `drop function` también en `cliente_login` y `cliente_registrar` (cambia el tipo de retorno: `create or replace` no puede, 42P13), `v_id uuid` en `reset_solicitar`, `on conflict on constraint cliente_login_intentos_pkey` (la cláusula de inferencia no admite calificar la columna), y FASE 1 dentro de `begin`/`commit`. Partió el SQL en `sql/fase1.sql` (415 líneas) y `sql/fase3.sql` (138) para que no se pudiera pegar la FASE 3 por error, más `sql/s2_bcrypt_migration.sql` completo (477, blob `21fdfb8`).
- **Worktree reciclado en el medio** (17-sep): el `app.js` parcheado y el SQL sin commitear se perdieron, y el patch v2 traía el SQL como diff contra un blob (`c6b45fe`) que nunca llegó a git. `git apply --check` falló limpio ("No such file"); se pidió el archivo entero. El hunk de `app.js` aplicaba solo (`7106df3`) — el cowork creyó ver un hash distinto por comparar contra el archivo CRLF del disco; normalizado a LF era idéntico.
- **Commit `98b556c` sin push** (17-sep, orden cambiado por Alejo: commit primero para que el SQL del repo fuera el corregido antes de pegarlo) → **Alejo corrió `fase1.sql`** → verificación por MCP de que las firmas en producción eran las corregidas (`id uuid`, `p_id uuid`, `on constraint`, `_cliente_hash` sólo `postgres`) → **push `f7da8bf..98b556c`** → producción sirviendo `v1.1.100` + `app.js` con RPC en **1 minuto**.
- **Verificación en producción** (tabla completa en el reporte del prompt 2): `registrar` → `ok` + `$2a$10$` (60 chars) · login ok · 5 fallos **de a uno** → 5º `bloqueado` con `espera_seg` 900 · clave correcta estando bloqueado → `bloqueado` · inexistente `invalido` en 77 ms · alta manual con `''` → `activado` + hash · `bloqueado = true` + clave correcta → `invalido` · desbloqueo → `ok` · **E2E desde `www.stperfumeria.com`** con el JS deployado: entra, sesión `{id uuid, nombre, telefono}` sin password; clave mala e inexistente → mismo mensaje.
- **D · migración perezosa sobre el caso real, cerrado por Alejo** (17-sep, contra producción, como `anon`): puso a Test QA (`5490000000001`) con `password = 'test1234'` **en texto plano, igual que los 92** → `cliente_login(…, 'test1234')` → `ok` → la password quedó `$2a$10$…` (60 chars) → `crypt('test1234', password) = password` → **true** · `crypt('otraclave', password) = password` → **false** → segundo login, ya contra el hash → `ok`. **Los 92 entran con su clave de siempre.** Dato importante: **B y C nunca pasan por texto plano** (B guarda bcrypt desde el alta, C entra por la rama `activado`), así que D era el **único** caso que cubría el camino de la mayoría de los clientes. Valía probarlo aparte, y no hizo falta una cuenta real.
- **FASE 3 la corrió Alejo** en el SQL Editor y verificó: anon leyendo `clientes` → **0 filas** (antes 98) · anon llamando `cliente_login` → responde · policies → **sólo las 4 de `authenticated`**. Esa asimetría era el objetivo.
- **Fuga en la doc** (hallazgo de Alejo al revisar antes del commit de docs): `SECURITY.md` § S3 tenía el **token real del bot de Telegram y el chat_id** escritos completos "para documentar la fuga" — en un repo público, en 32 commits de historial. Enmascarados en este commit (`<REVOCADO — ver historial>`), token rotado por Alejo (el nuevo vive sólo en `public.send_telegram` y en las env vars de Vercel), y **regla nueva en `SECURITY.md`**: los documentos de auditoría no llevan valores de credenciales, sólo dónde viven. La pasada por `docs/`, `memory/` y `RECOMENDACIONES_CLAUDECHAT/` encontró además las dos contraseñas de S1 pegadas en 10 lugares (ya públicas en `admin.html`, pero la regla es la regla): enmascaradas. Las connection strings del Plan B eran placeholders.
- **`[RESET-TEXTOS]` · `6049a2a` + SW v1.1.101 (`8fef946`)** — patch del cowork, 3 cadenas y cero lógica, salido de leer el flujo de reset después de S2: el cartel de "pedido enviado" ya no dice "en breve" (si el local está cerrado son horas, el cliente volvía a apretar y quedaban 3 pedidos); el cartel de la rama `activado` **dice que la clave que acaba de escribir quedó guardada** (antes decía "Cuenta activada, bienvenido/a" y el cliente no se enteraba de que acababa de fijar una clave → a la semana pedía otro reset); y el WhatsApp que manda el local pasa a 4 pasos numerados con link y número. Sin el nombre del cliente en los carteles que él ve, a propósito. Verificado en producción (0 rastros del texto viejo). De leer ese flujo salieron **`[RESET-EXPIRES]`** 🟡 (`expires_at` no se respeta) y **`[RESET-TEMP-PASSWORD-MUERTA]`** 🟢 (`7ab38cd`).
- **Token de Telegram rotado y verificado por Alejo** (17-sep): BotFather → `public.send_telegram` actualizada → verificación por `md5(prosrc)` sin exponer el valor. Y al verificar apareció **`[TELEGRAM-ANON-ABIERTO]`** 🔴 (S14): `anon` tiene EXECUTE sobre `send_telegram(text)` y acepta texto libre → con la anon key cualquiera manda lo que quiera al chat del jefe. **Rotar no cierra eso.** Salida diseñada: los avisos los mandan las RPC de S2 desde el servidor y `send_telegram` queda interna (`revoke` explícito por rol + `search_path` fijo).
- **Limpieza**: los 9 `.patch` untracked (worktree + raíz del repo principal) borrados — **convención: los patches no viven en el repo una vez aplicados**. `git worktree prune` queda para otra sesión, desde Windows.

#### Decisiones / bugs encontrados / workarounds

- **La doc no es la fuente de verdad de la base: `pg_policies`, `information_schema` y `pg_proc` lo son.** `DATABASE.md` decía `id BIGSERIAL` y `puntos NUMERIC(8,2)`; eran `uuid` e `integer`. Costó un ensayo fallido en producción (sin daño: la transacción abortó). Todo brief para el cowork lleva los tipos consultados, no copiados.
- **`SECURITY DEFINER` + *default privileges* de Supabase**: cada función nueva nace con EXECUTE para `anon, authenticated, service_role`; `revoke all … from public` no toca esos grants. Un helper que no debe llamar nadie necesita `revoke execute … from anon, authenticated, service_role` explícito.
- **plpgsql y los parámetros de salida**: `returns table (…, telefono text, …)` convierte `telefono` en variable; `where telefono = …` es ambiguo (error en runtime, no al crear) y `on conflict (telefono)` también. Calificar con alias o usar `on conflict on constraint`.
- **`create or replace function` no puede cambiar el tipo de retorno** (42P13): cambio de firma = `drop function` previo, y por eso la FASE 1 fue transaccional.
- **Probar N llamadas en UNA sentencia SQL miente**: 5 `cliente_login` en un `generate_series` dieron siempre `invalido` con `intentos = 1` (mismo snapshot: los upserts se pisan) y los CTE no ven los inserts de otros CTE. **Los dos caímos en esto por separado** (Claude Code el 16-sep, Alejo el 17-sep) y los dos creímos por un momento que el rate-limit estaba roto. Cada login real es una request aparte: se prueba **una llamada por sentencia**. Los tiempos se miden con `explain (analyze)`, no con `clock_timestamp()` en CTE.
- **El worktree reciclado se lleva lo no commiteado**, incluidos los blobs que un patch usa de base. Si un archivo nuevo va a ser base de un patch futuro, se commitea antes; y para un archivo nuevo se pide el archivo entero, no un diff.
- **`git hash-object` crudo en un checkout Windows vs el blob LF de `origin/main` da hashes distintos en TODOS los archivos.** Es CRLF (`autocrlf=true`), no código: el cowork creyó que mi `app.js` no era `7106df3` y era idéntico. Antes de concluir que un archivo difiere de su base, normalizar: `tr -d '\r' < archivo | git hash-object --stdin`.
- **`git checkout -B` de una rama que quedó "usada" por un worktree borrado falla** (`already used by worktree at …`); no hacía falta la rama para pushear `HEAD:main`. `git worktree prune` lo hace Alejo desde Windows, después del deploy; `feat/s2-bcrypt` apunta a `f7da8bf` sin commits propios.
- **Riesgo que quedó**: un cliente con el `app.js` viejo cacheado ve "Teléfono o contraseña incorrectos" hasta que el SW le entregue `v1.1.100` (`[PWA-AUTO-RELOAD]` lo resuelve al abrir el sitio; ventana de minutos). Sin reportes.
- **Deuda anotada por el propio cowork**: `cliente_puntos` y `cliente_reset_solicitar` siguen respondiendo con sólo el teléfono (misma exposición que antes: nombre y puntos). Se resuelve en el escalón 3 (Supabase Auth). **S2-bis** (nuevo, S13 en `SECURITY.md`): `favoritos`, `votos` y `opiniones` se escriben como `anon` con el `user_id` del localStorage.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[BCRYPT-MIGRATION]` / **S2** | Login de clientes por RPC + bcrypt con migración perezosa + rate-limit server-side + `anon` sin acceso directo a `clientes` · `98b556c` + FASE 1/3 en producción |
| `[RESET-TEXTOS]` | Los carteles del reset dicen que la clave que escribís es la que queda · `6049a2a` · SW v1.1.101 |
| S3 (parcial) | Token y chat_id fuera de la doc, **token rotado y verificado**; queda Vault y **S14** |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| ~~**D** de S2~~ ✅ | Cerrado por Alejo el 17-sep contra producción (ver arriba). Queda sólo **borrar los 2 clientes de prueba** (`549000000000[12]`) desde "Eliminar definitivamente" del panel — de paso prueba `clientes_delete_auth` |
| `[LOGIN-INTENTOS-CLEANUP]` 🟢 | `pg_cron` que borre de `cliente_login_intentos` las filas de más de un día (crece con cada intento fallido de cualquier número) |
| **S13 / S2-bis** 🟠 | `favoritos` / `votos` / `opiniones` escribibles a nombre de otro cliente |
| **`[TELEGRAM-ANON-ABIERTO]` / S14** 🔴 | `anon` puede invocar `send_telegram` con texto libre → avisos desde las RPC de S2 + `revoke` + `search_path`. Ver `SECURITY.md` § S14 |
| `[RESET-EXPIRES]` 🟡 · `[RESET-TEMP-PASSWORD-MUERTA]` 🟢 | `expires_at` no se respeta en Pedidos pass · columna muerta |
| S3 (Vault) 🟡 | `send_telegram` leyendo de `vault.secrets` en vez de constantes |
| `.claude/commands/security-scan.md` 🟢 | Tiene las dos contraseñas de S1 como ejemplo; no se tocó por la regla de no modificar `.claude\` — decidir |
| `[VERCEL-ENV-VARS]` 🔴 · `[BACKUP-FOTOS-LOCAL]` 🟡 · S1 + S10 🟠 · `[DC-HEADER-600]` 🟢 · contador del tope 🟢 · historial depósito→local 🟢 · cuentas por empleada 🟢 | sin cambios |

#### 🎯 Orden de trabajo (decidido por Alejo el 18-sep)

⚠️ **Corrección de atribución:** el cierre del 17-sep decía "elegidos por Alejo… antes de cualquiera: ordenar el repo". Ese orden venía de una **recomendación de ClaudeChat** que llegó en el mensaje de cierre y quedó registrado como decisión de Alejo. Lo detectó el propio ClaudeChat al leer el estado y preguntó. **Regla: lo que recomienda el cowork no es decisión hasta que Alejo lo diga con sus palabras.**

**El orden real, decidido por Alejo el 18-sep:**

1. **Tanda de seguridad, chica y en una sola sesión** = **S1** (rotar la contraseña de admin que está en `admin.html` y sacarla del repo · lo hace Alejo a mano) + **`[VERCEL-ENV-VARS]`** (Alejo carga las variables en Vercel; se destraba con S1) + **S14 `[TELEGRAM-ANON-ABIERTO]`** (patch de ClaudeChat con el brief ya escrito; Claude Code verifica) + **`[SW-PRECACHE-PERFUMES]`** (1 línea, viaja en el mismo bump).
2. Después, **los tres temas**: `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]` (sin brief todavía; se definen al arrancar cada uno).

**Ordenar el repo NO va antes de nada**: cero impacto en clientes ni en las chicas. Se hace de a poco, en la sesión de cada tema (la tanda 1 del plan — docs, mockups, prompts viejos — puede ir con cualquier commit de docs; mover `perfumes.js` no hace falta).

**`[SW-PRECACHE-PERFUMES]`** 🟢 (verificado el 18-sep al chequear el "sw.js roto" que mencionó ClaudeChat): **no está roto**. El precache lista `'/js/perfumes.js'` (L63) y en producción da **404** porque `perfumes.js` vive en la raíz; como el SW hace `cache.add` uno por uno con `catch` (L74-76), el install no se rompe — sólo desperdicia un 404 y el archivo entra al cache por la vía normal al primer uso. Fix: 1 línea (`'/perfumes.js'`) + bump.

#### 💬 Mensajes meta

- Alejo **manejó el orden del despliegue mejor que el plan**: cambió "push y después FASE 1" por "commit primero, FASE 1 con el SQL del repo, push después" para no pegar un SQL viejo en producción, y corrió las dos fases él mismo. Y frenó el commit de docs al ver el token en `SECURITY.md`. El que decide es él; conviene darle los hechos, no las conclusiones.
- La dupla con brief + addendum de hechos verificados funcionó: 1 ensayo fallido (por la doc, no por el diseño), 8 correcciones cruzadas entre los dos, cero clientes afectados.

### Sesión 18-sep-2026 · **Cierre ordenado: `/handoff` v2, CLAUDE.md reconciliada, orden real de trabajo**

Sesión corta de cierre, sin código. Disparador: al pasarle a ClaudeChat el estado del 17-sep, **él detectó que "ordenar el repo primero" era una recomendación suya registrada como decisión de Alejo**, y preguntó el orden real. De ahí salieron la corrección de atribución, la verificación de un "sw.js roto" que no era tal, la decisión de Alejo sobre el orden, y el arreglo de un agujero del `/handoff` que dejaba `CLAUDE.md` desincronizado en cada cierre. 2 commits + este cierre.

#### Qué se hizo

- **4 textos para ClaudeChat** (estado al 18-sep · brief S14 · "ordenar el repo" como plan · arranque de los tres temas), con hechos del repo: los 5 `notifyTG` del sitio público (reset, lockout, primer ingreso, perfil editado, lista de espera) y **el panel admin también llama `send_telegram`** (`notifyTelegram`, 31 avisos, como `authenticated`) — dato que cambia el fix de S14: el `revoke` no puede incluir `authenticated` sin reemplazo. Bases: `app.js` `7734bbf`, `admin.html` `541d724`, `sw.js` `eaed3da`.
- **Corrección de atribución** (`600cdaa`): HISTORIA y CLAUDE.md decían "elegidos por Alejo… antes de cualquiera: ordenar el repo"; ese orden venía de ClaudeChat, reenviado en el mensaje de cierre. **Orden real decidido por Alejo:** (1) tanda de seguridad chica en una sesión — S1 + `[VERCEL-ENV-VARS]` a mano, S14 por patch, `[SW-PRECACHE-PERFUMES]` en el mismo bump — (2) los tres temas. Ordenar el repo: de a poco, dentro de cada tema.
- **`[SW-PRECACHE-PERFUMES]`** 🟢 verificado: el "sw.js roto" de la opción 1 de ClaudeChat es un path viejo en el precache (`'/js/perfumes.js'` → 404 en producción; `perfumes.js` vive en la raíz). `node --check` OK, se registra en las dos páginas, `cache.add` uno por uno con `catch` → **no se rompe**. 1 línea + bump. De paso, `CLAUDE.md` § estructura ubicaba `perfumes.js` en `js/`: corregido.
- **#87 repuesto en `memory/preferencias_alejo.md`**: se había perdido el 17-sep por un bug de mi script (la función que enmascaraba reemplazaba el array y el `push` cayó en el viejo). + **#88**: lo que recomienda el cowork no es decisión de Alejo hasta que él lo diga.
- **`/handoff` v2** (`c1fa9de`, pedido de Alejo con evidencia: el cierre del 17-sep tocó CLAUDE.md con +1 línea y el pie seguía en "Agosto 12" listando S2 y "rotar token TG" como pendientes). Cuatro cambios: (1) el límite de la sesión es el último commit `docs: cierre sesión` (`git log --grep`), no `--since="36 hours"`; (2) paso 3-bis: reconciliar CLAUDE.md § Pendientes — sólo abiertos, resueltos a HISTORIA, ID = keyword, pie reescrito; (3) CLAUDE.md entra al `git add`; (4) paso 6-bis: reporte en dos bloques "Mío (código)" / "De Alejo", listo para pegar en ClaudeChat. + pasada por credenciales antes del commit, nota CRLF, regla #88. `docs/SLASH_COMMANDS.md` decía "NO están implementados todavía": hay tres.
- **Este cierre, con el `/handoff` v2**: `CLAUDE.md` § Pendientes reconciliada — **8 resueltos movidos** a § "✅ Resueltos" de este archivo (7 tachados + `{ERROR-PRECIO…}`, que seguía 🟡 pero estaba cerrado por `[DECANT-TOPE]`), **25 abiertos** agrupados 🔴/🟠/🟡/🟢 con keyword como ID (nuevos keywords para los que no tenían: `[S13-ESCRITURAS-ANON]`, `[S3-VAULT]`, `[ROTAR-DB-PASS]`, `[SUPABASE-AUTH]`, `[ORDEN-COMPRA-SUGERIDA]`, `[CLIENTES-PRUEBA]`, `[DECANT-TOPE-CONTADOR]`, `[DEPOSITO-HISTORIAL-UNIFICADO]`, `[CUENTAS-POR-EMPLEADA]`, `[SECURITY-SCAN-CMD-VALORES]`, `[PERMISOS-TABS-JEFE]`, `[PUNTOS-DECANTS]`, `[JUEGOS-ST-WIREFRAME]`, `[UPLOADER-WEBP-AUTO]`, `[TIKTOK-SLIDE]`), pie de CLAUDE.md reescrito al 18-sep con los mismos pendientes en el mismo orden, versión del SW en § Service Worker actualizada a v1.1.101.

#### Decisiones / bugs encontrados / workarounds

- **Decidió Alejo:** el orden de trabajo (seguridad chica → tres temas; repo de a poco) · cerrar por hoy (ClaudeChat puede **escribir** el SQL de S14 esta noche; se aplica mañana con Alejo despierto) · borrar los `.patch` una vez aplicados · `git worktree prune` desde Windows en otra sesión.
- **Recomendó el cowork (no decisión):** "ordenar el repo primero" (descartado por Alejo) · "sw.js roto" (verificado: no lo está).
- **Propuse yo:** los briefs y la convención de ID = keyword.
- **Las afirmaciones técnicas del cowork se verifican antes de entrar a la doc.** "sw.js roto" → un 404 tolerado por diseño. Dos veces en dos días (el origen del breakpoint, el conteo "4 en CSS", ahora esto): útil, pero se chequea.
- **Cuando un mensaje de Alejo trae texto de otro, preguntar "¿esto lo decidiste vos o lo estás reenviando?" antes de asentarlo como decisión** (#88). En los cierres, tres etiquetas: decidió Alejo / recomendó el cowork / propuse yo.
- **`--since` en el handoff era una bomba de tiempo**: sesiones que cruzan medianoche y huecos de semanas. El último commit `docs: cierre sesión` es el único límite estable — por eso el mensaje del cierre tiene que empezar exactamente así.
- **Un script de docs que reemplaza un array y después hace `push` sobre la referencia vieja pierde el push en silencio** (#87 perdido). Mitigación en el `/handoff` v2: verificar el último número con `grep` antes de agregar, y en mis scripts mutar siempre `F.L`, nunca una copia.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[HANDOFF-V2]` | `/handoff` sin ventana de tiempo, reconcilia CLAUDE.md § Pendientes, `git add` con CLAUDE.md, reporte en dos bloques · `c1fa9de` |
| Atribución del orden de trabajo | Corregida en HISTORIA y CLAUDE.md · `600cdaa` |

#### Keywords abiertos para próxima sesión

La lista completa, por prioridad y con keyword, vive ahora en **`CLAUDE.md` § Pendientes** (única fuente; este archivo la refleja en "Última actualización"). Los que aparecieron o cambiaron hoy: `[SW-PRECACHE-PERFUMES]` 🟢 (nuevo), `[TELEGRAM-ANON-ABIERTO]` 🔴 (el fix tiene que contemplar los 31 avisos del panel), `[SECURITY-SCAN-CMD-VALORES]` 🟢 (nombre nuevo para un pendiente que estaba sin keyword).

#### 💬 Mensajes meta

- Alejo **audita el proceso, no sólo el código**: leyó el `/handoff`, encontró el agujero con evidencia (commit, línea, qué decía el pie) y pidió cuatro cambios concretos. Es la misma forma en que pidió la regla de credenciales: con el caso en la mano.
- Cuando ClaudeChat le preguntó "¿cuál es el orden real?", Alejo vino a preguntarme a mí antes de contestarle — quiere que los dos lados tengan la misma verdad. Los bloques "Mío / De Alejo" del reporte existen para eso.

### Sesión 19-sep-2026 · **S14 `[TELEGRAM-ANON-ABIERTO]` resuelto** + el token de Telegram que en realidad no andaba

Primera parte de la "tanda de seguridad chica" que decidió Alejo. Patch de ClaudeChat (SQL + JS) aplicado con el orden de despliegue que él diseñó (SQL de avisos → JS → revoke), verificado de punta a punta en producción. Y en la verificación apareció algo que nadie sabía: **el token rotado el 17-sep no funcionaba** — ningún Telegram se había entregado en ~31 horas. 3 commits de código + este cierre · SW **v1.1.101 → v1.1.102**.

#### Qué se hizo

- **Lectura previa del SQL del cowork** (`fase4_telegram.sql`, 425 líneas) y **verificación contra producción de sus 3 afirmaciones nuevas**: `send_telegram` con `=X/postgres` (PUBLIC) y `proconfig` null ✅ · `admin_actions_cleanup` con el mismo ACL, `SECURITY DEFINER`, **contiene `delete` y `anon` podía ejecutarla** (2.625 filas de auditoría borrables con la anon key) ✅ · `lista_espera` con `slug/telefono/nombre/perfume_name` y sin triggers ✅. Hallazgo propio: **el panel admin también llama `send_telegram`** (`notifyTelegram`, 31 avisos, como `authenticated`) → el revoke no podía incluir `authenticated`; Alejo eligió la opción (a).
- **El archivo era una sola transacción** (`begin;` L39 … `commit;` L407) y el plan pedía correr "hasta la sección 5" primero: pegar media transacción sin `commit` puede no persistir en el SQL Editor. Se partió en **`fase4a_telegram_avisos.sql`** (secciones 1-5, sin tocar permisos) y **`fase4b_telegram_cerrar.sql`** (6-7), cada uno con su `begin`/`commit`; verificado que entre los dos tienen **exactamente las 210 sentencias** del original, que queda como referencia. Commiteados antes de que Alejo pegara nada (`b0cde5e`), lección de S2.
- **Despliegue en el orden del cowork:** (1) Alejo corrió fase4a → verificado por MCP (`_aviso_tg` creada sin EXECUTE, las 3 `cliente_*` la llaman, trigger activo, `send_telegram` todavía abierta = ventana con avisos duplicados) → (2) `s14-appjs.patch` (`--check` limpio, base `7734bbf`, 14/31, `node --check` OK, **0 `notifyTG`**, sólo quedan las 5 RPC `cliente_*`) + `[SW-PRECACHE-PERFUMES]` (`'/js/perfumes.js'` → `'/perfumes.js'`) + bump **v1.1.102** en commit aparte → push `917228c..154e51c` → deploy en el aire en 1 minuto → (3) Alejo corrió fase4b.
- **Checklist completo:** `has_function_privilege('anon', …)` → **false** para `send_telegram` y `admin_actions_cleanup`, `authenticated` true, ACL `{postgres, authenticated, service_role}` sin `=X/` · **POST anónimo con la anon key → 401 permission denied** en las dos (control: `cliente_login` → 200) · `proconfig` con `search_path` en las 4 funciones · trigger activo · `admin_actions` sigue en 2.625 · **los 5 avisos disparados desde el servidor** con los clientes de prueba (reset · primer ingreso · bloqueo con `…0008`/`…0009` una sola vez, el 6º intento no re-avisa · perfil editado · lista de espera por trigger), y limpieza de todo lo que dejaron (pedido de reset, fila de lista de espera, nombre, bloqueos).
- **El token de Telegram no andaba.** Al mirar `net._http_response` para confirmar la entrega de los 5 avisos: **404 Not Found** en los cinco. Historial: 18-sep 21:05 → **401** (el token viejo, ya revocado) · 18-sep 23:00 → **404** (el resumen diario) · 19-sep 02:38 → 404 ×5. O sea: **nada se entregó desde la rotación del 17-sep**, resumen diario incluido. Diagnóstico **sin ver el valor** (regex en la propia base): el literal guardado medía 51 chars = 10 dígitos `:` **37** chars `:54` — al copiar el token de BotFather se arrastró la hora del mensaje. El "verificado por md5 de `prosrc`" del 17-sep sólo probaba que el cuerpo había cambiado.
- **Arreglo, paso a paso con Alejo** (pidió "PASO 1: hacé esto, te va a salir esto"): un bloque `DO` que lee `pg_get_functiondef`, **valida el formato del token** (`^[0-9]{8,11}:[A-Za-z0-9_-]{35}$`) y recién ahí reemplaza el literal con `regexp_replace` + `execute` — la string surgery la hace la base, nadie copia la definición de 40 líneas. El guard **rechazó el primer intento** (51 chars otra vez: `…02:45`, la hora del mensaje de nuevo) → Alejo borró los 5 caracteres finales → `Success` → `select public.send_telegram('prueba')` → **200, `message_id` 3597** · los 5 avisos re-disparados → **5 × 200** (04:03:18 → 04:04:04).
- **Rotación otra vez, esa misma noche:** la captura de pantalla que Alejo mandó para mostrar el error del guard **tenía el token a la vista**. Sin repetir el valor: BotFather → Revoke → mismo `DO` → `select public.send_telegram('token nuevo ok')` → **200 a las 04:07:43**, md5 del cuerpo distinto, permisos intactos. El valor de la captura ya no existe.

#### Decisiones / bugs encontrados / workarounds

- **Decidió Alejo:** opción (a) para S14 (`authenticated` conserva) · trigger para `lista_espera` · sección 7 (`admin_actions_cleanup`) adentro · el orden SQL → JS → revoke · rotar de nuevo el token tras la captura · **no** cambiar ni borrar el bot (lo aclaró cuando "rotar/revoke" sonó a eso).
- **Recomendó el cowork:** revoke sólo a `anon`, trigger en vez de RPC, cortar el archivo antes de la sección 6. Todo verificado antes de entrar.
- **Propuse yo:** partir el SQL en fase4a/fase4b con `begin`/`commit` propios; el `DO` con guard de formato para cargar el token sin copiar la definición; verificar la entrega en `pg_net`.
- **`pg_net` guarda las respuestas de Telegram en `net._http_response`**: `status_code`, `created`, `content` (con `message_id`). Es la **única** verificación real de que un aviso salió. Nunca seleccionar la URL: lleva el token. Retiene pocos días.
- **404 ≠ 401 en la API de Telegram**: 401 = token que existió y fue revocado; 404 = token que no existe (mal pegado). El 401 de las 21:05 del 18-sep fue el último aviso con el token viejo; todo lo posterior fue 404.
- **Copiar un token del mensaje de BotFather selecciona también la hora** (`…:54`, `…02:45`): dos veces en dos días. En Telegram: mantener apretado sobre el token → Copiar; y siempre un guard de formato antes de escribirlo en la función.
- **Un md5 del cuerpo no verifica una credencial.** Verificar = usar con éxito (un mensaje entregado, un login que entra). Anotado en `SECURITY.md` § 📏 junto con: **las capturas de pantalla también son "docs"** — tapar el valor antes de mandar una imagen.
- **Pegar media transacción en el SQL Editor** (un `begin;` sin `commit;`) puede no persistir: si un plan pide correr "hasta la sección N", hay que entregar archivos separados con `begin`/`commit` propios.
- **`git status` sucio después de que Alejo pega un archivo**: `fase4a` quedó **vacío** en disco (Ctrl+X en vez de Ctrl+C al copiarlo al SQL Editor). El commit estaba intacto; `git checkout -- archivo` lo restauró. Chequear el blob del disco contra HEAD antes de asumir que lo que se pegó era lo commiteado (esa vez sí lo era: se vació después).
- **Cuando Alejo dice "no entiendo nada", el formato que funciona es un paso por mensaje**: "hacé esto, acá, te va a salir esto (o esto otro si falla)", y esperar. La tabla de opciones y la explicación técnica lo pierden. Y no usar "rotar"/"revoke" sin decir antes "el bot no se toca".
- **Curl con caracteres no-ASCII en el JSON** (`·`) desde Git Bash llega roto → 400 "invalid json" que no es la respuesta de permisos. Probar con ASCII puro antes de concluir.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| **`[TELEGRAM-ANON-ABIERTO]` / S14** | Avisos desde el servidor, `anon` sin EXECUTE sobre `send_telegram` y `admin_actions_cleanup`, `search_path` fijo · `b0cde5e` + `5af3d85` · verificado: 401 desde afuera, 5 × 200 en `pg_net` |
| `[SW-PRECACHE-PERFUMES]` | `'/perfumes.js'` en el precache · `5af3d85` · SW v1.1.102 |
| Token de Telegram | Corregido (estaba mal pegado desde el 17-sep, 404) y rotado de nuevo tras la captura · verificado por entrega |

#### Keywords abiertos para próxima sesión

Sin cambios en la lista de `CLAUDE.md` § Pendientes salvo los dos cerrados. Lo que sigue de la tanda de seguridad es **a mano de Alejo**: `[SECURITY-AUDIT-S1]` (rotar la contraseña de admin y sacarla de `admin.html`) y `[VERCEL-ENV-VARS]`. Después, los tres temas.

#### 💬 Mensajes meta

- Alejo corrió las dos fases SQL, arregló el token y lo rotó de nuevo **él mismo**, de madrugada, siguiendo pasos de a uno. Cuando pidió "más específico" no era queja: era el formato que necesitaba para poder hacerlo. Darle ese formato antes de que lo pida cuando el paso es en el SQL Editor o en Telegram.
- "Jamás te dije de cambiar el bot o borrarlo": una palabra técnica (`revoke`) leída como algo destructivo frena todo. Con Alejo, primero qué **no** va a pasar, después qué hacer.

---

### Sesión 20-sep-2026 · **`[S10-XSS-CLIENTES]` → `[S10-BIS-XSS-ESPERA-OPINIONES]` → `[WA-LINK-549-DUPLICADO]`** (cierre retroactivo de proceso — sin `/handoff` propio en su momento)

Segunda parte de la "tanda de seguridad chica". Esta tanda **ya quedó completamente documentada el mismo día** en `docs/SECURITY.md` § S10 y en § "✅ Resueltos" arriba (ver esa sección para el detalle completo — no se repite acá) y en el pie de `CLAUDE.md` de esa hora, pero nunca tuvo su propio commit `docs: cierre sesión`, así que el rango de commits de este `/handoff` la incluye. Se deja constancia acá para que la próxima sesión no tenga que reconstruirlo desde `git log`.

**Resumen de una línea por keyword** (detalle completo en § "✅ Resueltos"):

| Keyword | Qué hace | Commits | SW |
|---|---|---|---|
| `[S10-XSS-CLIENTES]` | Stored XSS en la tab Clientes (nombre/teléfono/nota sin escapar antes de `innerHTML`) → `escapeHtml()` en cards y tabla | `f457b89` | v1.1.103 |
| `[S10-BIS-XSS-ESPERA-OPINIONES]` | Mismo patrón en Lista de espera y Opiniones · hallazgo más grave que S10: el `onclick="avisarTodos(slug)"` rompía con un `'` en el slug (dato de `anon`, sin login) → fix `escapeHtml(JSON.stringify(slug))` | `033ab70` + `aae744e` | v1.1.104 |
| `[WA-LINK-549-DUPLICADO]` | `renderClientes` armaba el link de WhatsApp con `549` duplicado (el teléfono ya lo trae guardado) → 16 dígitos que no abrían WhatsApp, ahora 13 | `ce52def` | (sin bump propio, viajó con el de arriba) |

### Sesión 20-sep-2026 (más tarde) · **`[CLICKS-RESUMEN]`** — el catálogo público por fin cuenta "más visitados" de verdad

Sesión de performance-con-lado-de-seguridad: `loadPerfumeViews()` (`js/app.js`, catálogo público) y `loadStats()` (`admin.html`, panel) leían la tabla `perfume_clicks` completa (230.901 filas) para contar visitas por perfume. El problema no era sólo el volumen: la RLS de `SELECT` de esa tabla exige `authenticated`, así que un **visitante anónimo leía 0 filas** y el orden "más visitados" caía al alfabético en silencio — el propio `console.warn` decía "la tabla está vacía", que era falso (RLS se la escondía). Ya existía en producción la RPC `perfume_clicks_resumen()` (`SECURITY DEFINER`, agrupa por slug) sin usar en el frontend.

#### Qué se hizo

- **Diagnóstico verificado, no asumido:** antes de tocar código, Alejo corrió en producción `has_function_privilege('anon'/'authenticated'/'public', oid, 'EXECUTE')` sobre `perfume_clicks_resumen()` → `true`/`true`/`false`, confirmó que es `SECURITY DEFINER`, y que `SUM(clicks)` del resumen (264 filas) es **idéntico** a `COUNT(*)` de la tabla cruda (230.901 = 230.901) antes de aprobar el approach.
- **`loadPerfumeViews()`** (`js/app.js` L2996-3014): pasa de `sb.from('perfume_clicks').select('slug')` (contando en JS) a `sb.rpc('perfume_clicks_resumen')` (ya agregado); el loop pasa de incrementar a asignar directo (`perfumeViews[r.slug] = r.clicks`). Los 3 `console.warn` dejan de mencionar "la tabla está vacía" (afirmación que el frontend no puede verificar) y pasan a "la RPC no devolvió datos".
- **`loadStats()`** (`admin.html` L4383-4462): reemplaza **dos** queries (`count:'exact',head:true` sobre toda la tabla + `select('slug').limit(50000)` para el TOP 10) por **una sola** llamada a la RPC; `totalClicks` sale de sumar el resumen en vez de un round-trip aparte — de yapa corrige una inconsistencia latente (antes el count no tenía límite pero el select del TOP 10 sí lo tenía en 50k, podían divergir si la tabla crecía más).
- **Verificación sin instalar nada nuevo** (decisión de Alejo, ver abajo): harness de Node que extrae el código **real** de ambos archivos con `fs.readFileSync` (nunca reescrito de memoria) y lo corre en una `vm` con `sb` stubbeado, 3 escenarios (datos / error / lista vacía) — 21 asserts, todos OK; `node --check` sobre el `<script>` inline completo de `admin.html` (347.884 caracteres); grep confirmando que en `js/app.js` sólo queda **1** referencia cruda a la tabla (el insert de `trackClick`, L44, fuera de alcance) y en `admin.html` **0**.
- **Rama `fix-clicks-resumen`** → 2 commits (`ff078d2` fix + `6b44d80` bump SW v1.1.104→v1.1.105) → merge fast-forward a `main` → deploy verificado contra producción con `curl https://www.stperfumeria.com/sw.js` → `v1.1.105` confirmado en el primer intento.
- **Documentado** en `docs/DATABASE.md` (subsección nueva sobre `perfume_clicks_resumen()`) y `docs/SECURITY.md` (fila en "✅ Lo que SÍ está OK") con los valores reales verificados — commit `7dbfaec`.

#### Decisiones / bugs encontrados / workarounds

- **Decidió Alejo:** no instalar Playwright/Puppeteer/jsdom para la verificación en navegador ("este repo no los tiene y no quiero sumar una dependencia pesada por un test") — en su lugar, un test de Node sobre el código real extraído, y él mismo mira el catálogo en el navegador con `http-server -c-1` (comando se le pasó, no lo corrí yo).
- **Decidió Alejo:** sacar el `count:'exact',head:true` separado y sumar el resumen para `totalClicks`, después de que yo propusiera la alternativa con su justificación — la aprobó recién **después** de verificar personalmente en producción que `SUM(clicks) = COUNT(*)`.
- **Me equivoqué yo, corregido por Alejo (dos veces):** (1) cité `docs/SECURITY.md` L368 (`send_telegram` con `EXECUTE` para `anon`) como plantilla de cómo documentar RPCs — esa línea describe el problema **ya resuelto** por S14, quedó en presente debajo de un header "✅ RESUELTO" (la "trampa" del doc). Alejo lo verificó en producción (`anon` → `false`) antes de dejarme documentar `perfume_clicks_resumen()` con datos propios, no con esa plantilla. (2) Puse "21-sep-2026" en los dos docs nuevos — la fecha real del día es 20-sep-2026 (confirmado con `date`), corregido antes de este cierre.
- **Bugs propios del script de verificación** (no del código de producción, corregidos sobre la marcha): el índice de corte del bloque de `admin.html` cortaba en el `;` interno del `.reduce(...)` en vez de en `}, 0);`, y faltaba un `await` sobre el resultado de una IIFE async al evaluarla en la `vm`.
- **Pendiente aparte, no arreglado ahora (pedido explícito de Alejo):** `docs/SECURITY.md` tiene descripciones del problema *original* en presente debajo de headers "✅ RESUELTO" (el caso de S14/`send_telegram` en L368 es el que salió esta sesión, pero puede haber más) — hay que pasarlas a pasado o marcarlas como históricas para que no se citen como estado actual.

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|
| `[CLICKS-RESUMEN]` | Catálogo público y panel de stats leen `perfume_clicks_resumen()` (RPC agregada, `SECURITY DEFINER`) en vez de la tabla cruda de 230k+ filas; el visitante anónimo por fin ordena por "más visitados" de verdad · `ff078d2` + `6b44d80` + `7dbfaec` · SW v1.1.105 |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` (nuevo) | `docs/SECURITY.md` tiene descripciones del problema original en presente debajo de headers "✅ RESUELTO" (ej. S14 L368) — pasarlas a pasado o marcarlas como históricas para que una sesión futura no las cite como estado vigente |

#### 💬 Mensajes meta

- Alejo verifica con sus propias queries SQL en producción antes de aprobar cualquier afirmación mía sobre grants/RLS/agregados — no acepta "debería funcionar" sin el número real. Lo hizo dos veces en esta sesión (el grant de `perfume_clicks_resumen`, y la igualdad `SUM=COUNT`) antes de dejarme avanzar.
- Cuando hay dudas de qué hace el código en producción, prefiere que lo verifique con el código **real extraído del archivo** (no reescrito de memoria) — lo pidió explícito para el harness de Node de esta sesión. Ver `memory/preferencias_alejo.md`.
- Corrige con precisión quirúrgica y sin vueltas cuando algo está mal citado (la trampa de la L368) — la corrección viene con la verificación ya hecha (el resultado de la query), no como una sospecha a confirmar.

---

### Sesión 21→22-sep-2026 · **`[BADGE-TEXTO]` · `[FONTS-SELFHOST]` · `[TEMA-CLARO]`** — la sesión de los tres roles

Sesión larga (19:40 del 21 → 13:40 del 22, 26 commits, SW v1.1.105 → **v1.1.110**) y la primera con el **esquema de tres roles** que definió Alejo: **DISEÑADOR** (ClaudeChat: dibuja, decide colores y medidas), **PREPARADOR** (ClaudeChat: revisa y escribe los prompts "de 3" con base commit + blob) y **CLAUDE CODE** (esta sesión: aplica, **mide**, devuelve hechos). Tres tandas de accesibilidad y una de infraestructura, todas verificadas en navegador con instrumentos nuevos que quedaron en `scripts/`.

#### Qué se hizo

**Proceso (lo que hizo posible el resto)**

- **Roles del equipo** en `CLAUDE.md` § Comunicación (`25ab2ff`) y la regla **"enrutar, no enterrar"** (`59d5be8`): lo que no es de Claude Code sale en un bloque con destinatario y texto listo para pegar. El **22-sep** se convirtió en **un solo bloque por turno dirigido al PREPARADOR** (`3fb952c`), a pedido suyo y **decidido por Alejo**: *"Alejo es el único humano de la cadena: cada mensaje extra que tiene que clasificar es carga suya"*.
- **Cuatro skills globales** en `C:\Users\Alejo\.claude\skills\` (`1cefb52`, documentadas en `docs/SLASH_COMMANDS.md`): `/idea` (ficha en `docs/IDEAS.md` sin tocar código), `/arranque` (ritual git + tablero de quién espera qué), `/enrutar` (el bloque único) y `/bases` (commit + blob + EOL + SW real). Valen en todos los proyectos de Alejo y no consumen tokens hasta que se usan.
- **`docs/bases-para-prompts.md`** (`632f8a2`): la spec del PREPARADOR de qué tiene que traer `/bases` — cinco campos que siempre faltaban (shallow, ancestría en número, untracked recursivo, ramas/worktrees, `CACHE_VERSION` **de producción** vs el del repo), tres con argumentos y tres baratos. Cada campo tiene una falla real detrás. `/bases` se actualizó con los 11 campos y las 5 alertas.

**`[BADGE-48]` + `[BADGE-TEXTO]` + `[TAP-44]` decisión 7 — el panel se toca y se lee**

- **`[BADGE-48]`** (`a1860fc` + bump `4856c4a`): la badge de stock llena la celda y mide **48 px** (medido: 48 de alto, fila 49, a 600 y 800). Antes 20,6 px con el `onclick` en el `<span>`: el dedo tenía que embocar la pastilla. `.admin-table td.td-stock { padding: 0 }` (0,2,1) le gana al padding de `.admin-table td` y al del `@media 600`.
- **`[BADGE-TEXTO]`** (`77c80ad` + bump `3fce1b1`): texto de `ok`/`mid`/`paused` a negro (2,10 → 9,99 · 2,85 → 7,37 · 2,56 → 8,21) y el rojo de `out` a `#b8342a` con texto blanco (3,82 → 5,89). La **regla 19** del DISEÑADOR quedó escrita como comentario sobre el bloque: *el texto de una badge es negro cuando su fondo contrasta más con negro, y blanco en el caso contrario*. Anclado sólo en `.badge-out`: `#e74c3c` pasa de 106 a 105 ocurrencias en `admin.html`.
- **`[TAP-44]` decisión 7** (`33c3131` + bump `54fc60b`): `.modal-input` y `.admin-search` a `min-height: 44px`. El commit dice explícitamente que es **por la métrica, no por ergonomía** — nadie nota 1,6 px — y **por robustez**: con Inter cargada ya median 44,38; los 42,4 aparecen cuando la fuente no llegó.

**`[FONTS-SELFHOST]` — las tres familias salen de Google**

- `4f98c6e` + `ab2a40c` + bump `0709fd2`: Inter, Playfair Display y Bodoni Moda se sirven desde **`/fonts/`** en `index.html`, `admin.html` y `guia.html`. Son **4 archivos** (no 17): las tres familias son **fuentes variables** — confirmado leyendo el directorio de tablas WOFF2 (`fvar`/`gvar`/`STAT`/`HVAR`), no por el nombre —, y los **17 `@font-face` del subset latin** se replicaron 1:1 del CSS de Google con **pesos fijos** (nada de rangos, nada de Inter 800/900: esos lugares renderizan con la 700, igual que antes). `fonts.css` se generó por script desde ese CSS y se comparó bloque a bloque: 17/17 idénticos.
- `PRECACHE_URLS` suma `fonts.css` + Inter (**55,6 KB**); Playfair y Bodoni (103 KB) quedan al runtime porque, siendo mismo origen, ahora pasan el guard `resp.type === 'basic'` que antes excluía a Google. `vercel.json` estrena `headers` con `Cache-Control: public, max-age=31536000, immutable` para `/fonts/(.*)`.
- Verificado en navegador con el SW registrado y **la red cortada**: `admin.html`, `fonts.css` e Inter responden 200 **desde el Service Worker** y el detector por ancho de cadena confirma **Inter cargada sin red**. Métrica idéntica antes y después (601 controles / 38 cortos; catálogo 0 de 257 a 20,8 px y 2 de 257 a 24 px), y los woff2 en git son **byte-idénticos** a los de `fonts.gstatic.com` (md5 del blob).

**`[TEMA-CLARO]` + `[ESCALA-8-A-6]` — el modo claro del panel y los tokens del catálogo**

- `26b5926`: el panel pasa a **tokens que cambian con el tema** (`--stat-fondo`, `--stat-borde`, `--stat-tinta*` en `:root` y en `body.light`), con el **rojo partido** de la decisión 22 (`--rojo-fondo #b8342a` para `.badge-out`/`.btn-hide`/`.modal-btn-danger`, 3,82 → 5,89; `--rojo-tinta #e74c3c` sigue siendo la tinta de `.stat-out` en oscuro, 4,85). Las 4 tintas de las stat cards en claro pasan de 1,86 / 3,82 / 2,46 / 2,10 **sobre blanco** a 4,73 / 5,67 / 5,67 / 7,73 **sobre el crema `#fffaf0`**.
- **`[ESCALA-8-A-6]`**: la columna Depósito usa la escala compartida de badges (`deriveDepositoInfo()`: 0 → `badge-paused` "Vacío", 1-2 → `badge-low`, 3 → `badge-mid`, 4+ → `badge-ok`). **Cero colores inline**: medido, **292 badges con 0 `background` y 0 `color` inline**. Eso mata de raíz el bug de claro (2,17 / 1,53), porque la regla genérica `body.light [style*="color:#fff"]` deja de matchear.
- `caf4bff`: el catálogo, **en el orden obligatorio ①②③** — ① `--gris` `#777777` → `#888888` (decisión 28), ② borrar los cinco overrides `body.dark-mode` que repetían literales, ③ recién ahí `.card-brand` y `.price-*` a sus tokens. Al revés, `.card-brand` habría caído de 4,91 a 3,89 en oscuro mientras se arreglaba claro. Medido en el DOM: el ① mejora **154 elementos con texto visible** de 3,89 → 4,91.
- `ed72005` + `a182a91`: `--tinta-efectivo` y `--tinta-precio` de claro terminan tomando **los valores de mayo** (decisión 32) y el `.price-cash` del bottom-sheet pasa a usar el token.

**Instrumentos nuevos (`scripts/`)**

- **`contraste.js`** (`81f1bc5` → `09d1d36` → `ed72005` → `a182a91`): empezó verificando la regla 19 en 6 badges y terminó midiendo **las dos superficies × los dos temas** con un motor de cascada que calcula el **valor efectivo** (`!important` → especificidad → orden), dice **qué regla lo impone** (`archivo:línea`) y marca ⚠️ los tokens que quedan inertes. Sale con 1 si algo baja de 4,5. `npm run contraste`.
- **`medir_targets.js`** (`16e0cb7` → `3f7fc1e` → `0683ece`): cuenta los controles < 44 px del panel abriéndolo en Edge headless por CDP, **sin dependencias** (servidor propio `no-store`, `supabase-js` stubbeado antes del script de la página → 0 requests). Llama a `renderPrecios()` y `renderDeposito()` y activa los modales uno a uno. **Se niega a reportar números si Inter no cargó.** Con `--pagina index.html --sonda x.js` mide cualquier cosa del catálogo.
- `.gitignore` deja de ignorar `scripts/*.js` (`698ba14`) y `package.json` estrena `npm run contraste`.

#### Decisiones / bugs encontrados / workarounds

- **Decidió Alejo:** el esquema de tres roles y la regla de **un bloque por turno** (propuesta del PREPARADOR, firmada por él); adoptar las 4 skills globales; dejar el ancho de la badge en desktop como estaba (`[BADGE-48]`, 237-312 px a 1440); mergear `medir_targets.js` a `main` ("peligro 1 de 5"); mover el correo de los agentes a `D:\workspace\_correo_agentes\` en vez de borrarlo.
- **Decidió el DISEÑADOR** (vía PREPARADOR): regla 19 y decisión 20 (el rojo oscuro con blanco, preferencia sobre el negro que pedía la regla); decisión 18 (borde de 1 px entre badges); decisión 7 (los 50 "casi", con motivo **robustez**); decisión 8 (un checkbox dentro de un `<label>` no cuenta); decisión 22 (rojo partido por rol); decisión 28 (`--gris` a `#888`); decisión 30 (self-host de las tres familias en las tres páginas); decisión 32 (los valores de mayo **son** los tokens de claro).
- 🔴 **El instrumento del PREPARADOR no puede cargar Inter** (egress bloqueado a `fonts.googleapis.com` y a jsdelivr): todas sus medidas de alto salían ~2 px bajas, y de ahí venían los "50 casi" a 42,4/43,4. Con Inter cargada **no queda ninguno "casi"**: son 38 de 601, y el más alto de los cortos mide 36. `medir_targets.js` pasó a ser de Claude Code por eso, y **se niega** a dar números sin la fuente. Aviso del PREPARADOR que ahorró horas: **`document.fonts.check('16px Inter')` devuelve `true` aunque Inter no esté** (resuelve contra el fallback); el detector que sirve compara el **ancho** de una cadena contra una fuente conocida.
- 🔴 **Falso negativo del detector, encontrado midiendo `index.html`**: el `body` del público es `font-weight: 300`, el span de prueba heredaba ese peso, e Inter 300 todavía no estaba cargada (cada cara se carga cuando se usa) → ancho de fallback → "Inter NO cargó" con Inter cargada. Corregido con peso y estilo explícitos + `document.fonts.load('400 32px Inter')`. **Quinto caso en tres días** de "corre sin error y devuelve un número".
- 🔴 **`.stat-card` está declarado dos veces** (L978 `#111`, L1344 el gradiente): misma especificidad, gana la última. El PREPARADOR había leído la primera, así que el margen del rojo tinta no era +0,44 sino **+0,35** (4,85 sobre `#131316`, el extremo claro del gradiente).
- 🔴 **El hallazgo grande: el catálogo en claro nunca estuvo roto.** Los 1,51 / 2,78 / 3,95 de la tabla salían de leer la **declaración base**; lo que se ve desde mayo es **17,36 / 7,87 / 15,01**, impuesto por el bloque de `193e3dd` (8-may-2026, *"parche masivo de legibilidad en light mode"*: **56 reglas `!important`** bajo `body:not(.dark-mode)` entre L8040 y L8200). El mensaje de ese commit dice por qué existe: *"la tía del jefe (modo claro mobile) no podía leer muchos textos"* — **un pedido real de una usuaria real**. El PREPARADOR lo anotó como su tercer número caído por el mismo motivo y la regla quedó: todo color del catálogo se computa en el DOM antes de entrar a una tabla. Los tokens de claro quedaron **declarados** y, por decisión 32, **con los mismos valores** que el bloque de mayo: token y pantalla dicen lo mismo. Convertir esas 56 reglas a tokens es **`[LIGHT-MAYO-56]`**.
- 🔴 **`contraste.js` tenía el mismo punto ciego** (leía la base, no la cascada) y por eso dijo "0 fallas" midiendo CSS que no se ve. El motor nuevo lo arregla, y en el camino aparecieron dos cosas: **3 comentarios con una llave adentro** partían el parseo por regex (el selector siguiente quedaba pegado a media frase y `.badge-ok` salía "no pude resolver el texto" → ahora los comentarios se neutralizan conservando los saltos de línea), y **un target contextual tiene que recibir las reglas genéricas** que también le aplican (`.bottom-sheet .price-cash` recibe `body:not(.dark-mode) .price-cash !important`).
- ⚠️ **Una falla preexistente que nadie tenía en la tabla:** `.bottom-sheet .price-cash` `#2e7d32` sobre el fondo del bottom-sheet, que en claro **no es blanco sino `#f5efde`** → **4,46**. Al sacarle el `!important` a esa regla (como pedía el prompt), gana `#1b5e20 !important` de L8155 → **6,85**. Eso contradecía el "cero cambio visual" del prompt; se midió con el sheet realmente abierto, se reportó, y el DISEÑADOR lo adoptó como decisión 32 ("el bottom-sheet se alinea a la card").
- ⚠️ **`admin.html` nunca estuvo en `PRECACHE_URLS`** — revisados los 202 commits de `sw.js` desde `bcfb753` (25-mar): no hay decisión escrita, pero sí tres razones estructurales (el SW es uno solo para público y panel, así que cada visitante del catálogo bajaría 520 KB de panel en cada bump; el panel **ya se cachea en runtime** por la rama de navegación, que no tiene el guard `basic`; y el flujo de actualización del panel es `[SW-UPDATE-BANNER]`). Conclusión: la fuente se podía precachear **sin tocar** la política de `admin.html`.
- ⚠️ **El modo de falla de las fuentes, corregido con headers reales:** no es "cada carga depende de Google". El CSS de `fonts.googleapis.com` vive **24 h** en el HTTP cache (`private, max-age=86400`) y los woff2 un año; la falla es **cuando vence el CSS y la red no responde al revalidarlo** — el primer arranque del día siguiente, que es cuando abren el local. Recargar con red no la reproduce.
- **Dato para dimensionar:** `renderPrecios()` en producción **no** muestra 146 filas sino **257** (seed 146 sin sets + 111 de `perfumes_nuevos`, 0 slugs repetidos) → **771 badges**, o **699 en pantalla** con "Mostrar pausados" apagado (72 pausados). Los 146/438 de las mediciones salen del seed porque el instrumento stubbea Supabase.
- **Nombres largos del catálogo** (los tres números que pidió el DISEÑADOR, a 360 px con Inter): el más largo es `MALIK AL TAYOOR CONCENTRATED` (28 caracteres, 351,7 px en una línea); **hoy, a 20,8 px, 0 de 257** pasan de 2 líneas; **a 24 px × 1,2, 2 de 257** llegan a 3 (`TUBEES STRAWBERRY CHEESECAKE` y `ODYSSEY MANDARIN SKY ELIXIR`). Decisión 29: el 120 % va y no se renombra nada.
- **Método:** `sed` sobre archivos CRLF se come el `\r` — todas las ediciones fueron con Node byte a byte, anclas exactas y guard que aborta si el ancla no es única (frenó tres veces: `color: var(--amarillo)` aparece 4 veces, `deriveStockInfo(p)` 2, y un comentario que mencionaba `#e74c3c` habría dejado el conteo en 107 en vez de 105).

#### Keywords cerrados

| Keyword | Qué hace | Commits |
|---|---|---|
| `[BADGE-48]` | La badge de stock llena la celda y mide 48 px (era 20,6) | `a1860fc` · bump `4856c4a` |
| `[BADGE-TEXTO]` | Texto de ok/mid/paused a negro y rojo de out a `#b8342a`: las 6 badges ≥ 4,5:1 · regla 19 escrita en el CSS | `77c80ad` · `81f1bc5` · bump `3fce1b1` |
| `[TAP-44]` decisión 7 | `.modal-input` y `.admin-search` a `min-height: 44px` — por la métrica y por robustez si la fuente no llega | `33c3131` · bump `54fc60b` |
| `[FONTS-SELFHOST]` | Inter + Playfair + Bodoni desde `/fonts/` en las tres páginas · precache de Inter · `immutable` en Vercel | `4f98c6e` · `ab2a40c` · bump `0709fd2` |
| `[TEMA-CLARO]` | Tokens de tema en panel y catálogo · rojo partido · stat cards crema · `--gris` a `#888` (①②③) | `09d1d36` · `26b5926` · `caf4bff` · `ed72005` · `a182a91` · bump `4917804` |
| `[ESCALA-8-A-6]` | La columna Depósito usa la escala compartida de badges, sin un solo color inline | dentro de `26b5926` |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[LIGHT-MAYO-56]` | Convertir a tokens las 56 reglas `!important` de `193e3dd` (`styles.css` L8040-8200). Hoy mandan ellas en claro y los tokens coinciden con sus valores (decisión 32). Ojo: se escribieron por un pedido real de una usuaria; el DISEÑADOR decide qué pasa con cada una. |
| `[JERARQUIA-CARD]` | `.card-brand-st` en claro da **1,86** sobre la card blanca. No se toca suelto: la clase entera se rediseña con esta keyword. `contraste.js` la lista como ⚠️ conocida y no falla por ella. |
| `[TAP-44]` tanda 2 | Los **38 controles reales < 44 px de 601** (+ 6 checkbox que no cuentan, decisión 8). Ya no hay palanca barata: el más alto de los cortos mide 36 px, así que son 38 decisiones del DISEÑADOR, una por una. |

#### 💬 Mensajes meta

- Alejo trabaja con **tokens contados**: el objetivo del esquema de roles es que los tres agentes avancen en paralelo y él sólo copie y pegue. De ahí la regla del bloque único.
- Cuando algo no es suyo, quiere que se lo **enrute explícitamente**, no que quede enterrado en un párrafo: *"che, esto puede ser de otra forma, mandale esto al DISEÑADOR: …"*.
- Pregunta cuando no entiende un número o una sigla (*"¿qué decisión de a/b/c?"*) — vale más explicarlo en criollo que asumir que se leyó todo el hilo.
- Ante una acción irreversible pide **calibración explícita**: *"¿qué tan peligroso es del 1 al 5?"*. Y antes de borrar archivos suyos quiere saber **qué hay adentro**, aunque un agente diga que se pueden borrar.

---

### Sesión 22-sep-2026 (tarde) · **`[LOG-EMPLEADA]`** — la pestaña Log, para las dos

Tanda corta y completa sobre el cierre del mediodía (`ea326c6`): **5 commits**, SW v1.1.110 → **v1.1.111**, tema elegido por Alejo. Dos partes que salieron juntas: la **RLS** de `admin_actions` (DDL que corrió Alejo) y la **pestaña Log reescrita** según las decisiones 33-37 del DISEÑADOR. El Log dejó de ser una tabla de 200 filas sólo para el jefe y pasó a ser un feed que la empleada también puede leer.

#### Qué se hizo

- **`82c3645` — el instrumento primero.** `medir_targets.js` estrena **`--fixture <archivo.json>`** y el stub de Supabase pasa de Proxy ciego (devolvía `{data: []}` a cualquier cadena) a **builder con estado**: `from(tabla)` acumula la consulta (`select/eq/in/gte/lte/order/limit`), la resuelve contra datos de mentira y la anota en **`window.__sbCalls`** con qué operaciones y cuántas filas. Así una sonda puede verificar **qué se pidió y cuántas veces** — sin eso no se podía probar que cambiar de vista no dispare una consulta nueva. `rpc(nombre)` sale del fixture si hay clave `"rpc:<nombre>"`, y con `{"__error": "…"}` devuelve error para probar el camino de fallo. **Sin `--fixture` todo queda igual**: `medir_targets.js` a secas daba 601/38 antes y 601/38 después.
- **`de9877b` — la pestaña.** El botón pierde `data-role="jefe"`. Feed **cronológico estricto** con separador por día (`HOY · n` / `AYER · n` / `18 SEP · n`), `〃` cuando el evento anterior **en pantalla** es del mismo perfume, vista **"Por perfume"** como toggle sobre los mismos datos (`localStorage`), buscador por nombre (normalizado, sin acentos, también marca y alias) que consulta **`.in('target_slug', …)` sin filtro de fecha** — los 60 días completos — con la leyenda fija "últimos 60 días", chips por familia de acción y tag **👑 por `actor_email === JEFE_EMAIL`**. Token nuevo **`--superficie`** (`#1a1a1d` oscuro / `#ffffff` claro: las listas son blancas en claro). La tabla de 5 columnas y el `limit(200)` se fueron enteros.
- **`d50b7d9` — el resumen.** `sb.rpc('resumen_stock_dia')` **sin argumentos**: el "hoy" lo decide el servidor en hora Argentina, así el panel y el Telegram de las 23 h no pueden desfasarse al cambiar el día. Pinta "Salieron N · Entraron N · Neto ±N"; la línea de depósito es del jefe. Si el rpc falla, muestra `—` y **el feed sigue entero** (mismo criterio que `logAdminAction`: el log es secundario, nunca aborta lo principal).
- **`a906ea4` — el instrumento otra vez.** `contraste.js` suma **6 filas por tema** para el Log sobre `--superficie`. Y encontró un problema que el brief no había previsto (ver abajo).
- **`1d660de`** — bump a **v1.1.111**, solo.

#### Decisiones / bugs encontrados / workarounds

- **Decidió Alejo:** el tema (`[LOG-EMPLEADA]`) y correr él mismo el DDL de la política antes del merge.
- **Decidió el DISEÑADOR** (vía PREPARADOR): 33 (al abrir, hoy + ayer; antes de ayer sólo buscando) · 34 (el resumen cuenta **unidades**, no movimientos, y dice lo mismo que el mensaje de las 23 h) · **35, corregida a mitad de camino a pedido de Alejo** (el default es **cronológico estricto**, no agrupado: *"el único trabajo del Log es ser verdad"*; se lee como una historia — "qué pasó desde que me fui" — y el estado ya lo da el resumen) · 36 (buscador por nombre, chips por acción, "últimos 60 días" visible) · 37 (la empleada ve por **tipo de acción**, no por actor: ve los del jefe; el único tag es 👑).
- **La fórmula del resumen no se recalcula en JS.** `resumen_stock_dia()` usa la de `daily_summary()`: por perfume y por día en hora Argentina, `delta = último "new" − primer "old"` de sus `stock_update`, contando sólo los perfumes con `delta ≠ 0`. **Es primero/último, no suma de eventos**: un perfume que va 5 → 3 → 5 en el día tiene delta 0 y no aparece, ni en Telegram ni en el panel.
- 🔴 **`auditFormatTime` no servía para el feed**: devuelve "hace 20min" / "hace 3h". El feed necesita `HH:MM` en hora Argentina, así que va una función nueva al lado. Y el día **nunca** se calcula con `getDate()`: el dato viene en UTC y **a las 22:30 ART ya es el día siguiente en UTC**, con lo que "hoy" saldría vacío. Se usa `Intl.DateTimeFormat` con `timeZone` + `Date.UTC(a, m-1, d-1, 3, 0, 0)` (ART es UTC−3 fijo desde 2009), probado en cuatro instantes: 22:30, cambio de día, de mes y de año.
- 🔴 **`.log-dia` en `var(--amarillo)` daba 1,86 sobre la superficie blanca del claro** — el mismo problema que tenían las stat cards antes de `[TEMA-CLARO]`. Lo encontró `contraste.js` al sumarle las filas del Log, no una revisión a ojo. Pasó a `var(--stat-tinta)`, que ya existe con los dos valores decididos (`#e8b800` / `#8a6d00`: 9,33 y 4,92). **Sin inventar color ni token.**
- ⚠️ **`AUDIT_ACTION_LABELS` tiene 31 acciones, no 26** (el recuento del PREPARADOR venía de una vista parcial). Cambia el reparto de la chip **Catálogo**, que con la definición "todo lo que no es stock ni precio" se lleva también `login_success`, `logout` y los dos `backup_*`. Se aplicó así porque es textual del DISEÑADOR; si conviene partirla en `Catálogo` + `Sistema` lo decide él (4 de 31, una línea).
- ⚠️ **Bug de la sonda, no del panel:** el primer conteo por chip dio 19 en todas. La sonda capturaba los botones **antes** de que el re-render los reemplazara, así que los clicks siguientes iban a nodos desconectados. Re-consultando el chip vivo en cada paso: 9 + 3 + 2 + 5 = 19 ✓. Otra vez "corre sin error y no mide lo que dice medir", ahora del lado del verificador.
- **Defensa en profundidad:** además de la RLS, si `currentRole === 'empleado'` el cliente descarta todo lo que no sea `stock_update`/`deposito_update` **antes de pintar**. Verificado con el fixture: los eventos de precio y catálogo están en los datos y no se muestran.
- **El commit 6 del prompt anterior sentó jurisprudencia y acá se aplicó sola:** el PREPARADOR pidió "5 commits" con el resumen aparte; el trabajo ya estaba hecho junto, así que se partió con un script (respaldo → quitar el resumen → commit → restaurar → commit) en vez de commitear los dos juntos y avisar.

#### Keywords cerrados

| Keyword | Qué hace | Commits |
|---|---|---|
| `[LOG-EMPLEADA]` | La pestaña Log para las dos: feed cronológico con `〃`, vista por perfume, buscador de 60 días, chips por acción, 👑 por `actor_email`, resumen por `resumen_stock_dia()` · + la RLS que corrió Alejo | `82c3645` · `de9877b` · `d50b7d9` · `a906ea4` · bump `1d660de` |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[AMARILLO-TINTA-CLARO]` (nuevo) | **41 usos de `color: var(--amarillo)`** en `admin.html`; varios son encabezados que en claro dan 1,86 sobre blanco, el mismo caso que `.log-dia`. Preexistente y fuera del alcance de `[LOG-EMPLEADA]`; el PREPARADOR pidió medirlo **entero**, pero como keyword propia y no ahora. |
| `[DEPOSITO-TRANSFERENCIA-EVENTO]` (nuevo) | El pase depósito→local deja dos eventos (`deposito_update` + `stock_update`). El Log los muestra pegados con `〃` **sin afirmar que hubo transferencia** (decisión 35). Unificarlos en un evento único es este ticket — se cruza con `[DEPOSITO-HISTORIAL-UNIFICADO]`. |
| `[TAP-44]` tanda 2 | Actualizado: **37 controles cortos de 602** (antes 38 de 601). El buscador del Log suma un control y el ↺ dejó de ser corto. |

#### 💬 Mensajes meta

- Alejo interrumpe con *"Intentar nuevamente"* cuando un mensaje se corta o un reenvío queda a medias — no es un pedido de rehacer el trabajo, es "el mensaje no llegó entero".
- Sigue reenviando textual lo que le manda el PREPARADOR, incluidos los archivos `.md` en `Downloads`: el pipeline "N de 3" corre de punta a punta sin que él tenga que interpretar nada.

---

### Sesión 22-sep-2026 (noche) · **`[LOG-SISTEMA-CHIP]`** + el instrumento y la basura que dejaba

Dos tandas chicas sobre `832be33`, las dos pre-aprobadas por el PREPARADOR: la chip `Sistema` que pidió el DISEÑADOR, y el arreglo del selector de navegador de `medir_targets.js`, que había dejado de arrancar. Cierra con una limpieza de 3 GB que nadie había pedido pero que hacía falta.

#### Qué se hizo

- **`c0c26db` + bump `abe2945` — `[LOG-SISTEMA-CHIP]` (v1.1.112).** `login_success`, `logout`, `backup_create_manual` y `backup_create_auto` salen de "Catálogo" y van a una chip **`⚙️ Sistema`**, la última de la fila. Textual del DISEÑADOR: *"un filtro cuyo trabajo es sacar ruido no puede tener adentro 'login 09:02' entre 'Khamrah editado' y 'Pisa oculto'"*. Va última porque **si la fila envuelve a 600 px, la que cae es la que menos se toca**. La empleada no cambia (sigue con sus 3 chips).
- **`9bb5b58` — el selector de navegador.** `medir_targets.js` elegía "el primero que exista en disco", y **Edge dejó de publicar el endpoint de DevTools en la máquina de Alejo** (sale con código 0 y stderr vacío), así que la medición moría aunque hubiera un Chrome sano al lado. Ahora `candidatos()` devuelve la lista y `abrirNavegador()` los prueba en orden hasta que uno responde, informando cada fallo con el nombre del binario y su razón. Sin bump: es sólo `scripts/`.
- **`23f5b07` — `[MEDIR-TEMP-SWEEP]` anotado** y la limpieza a mano (ver abajo).
- **Cuatro capturas del Log para el DISEÑADOR** (v1.1.112, 600 px ×2, tema oscuro, página completa, con el fixture): jefe/empleada × cronológico/por perfume. Están en **`D:\workspace\_correo_agentes\ST_Perfumeria\capturas-log-v1.1.112\`**, no en el scratchpad — que hoy se borró dos veces y se llevó el fixture y las sondas.

#### Decisiones / bugs encontrados / workarounds

- **Decidió el DISEÑADOR:** la chip `Sistema` y su posición (última). **Decidió Alejo:** borrar las 28 carpetas temporales. **Pre-aprobó el PREPARADOR:** las dos tandas, con la condición de verificar antes de mergear.
- 🔴 **La chip nueva empujó a dos vecinas fuera de los 44 px.** Al sumar la séptima chip, **⚙️ y 👑 pasaron de 44 a 46**. No era el emoji: `.log-chips` es un flex **sin `align-items`**, así que el default `stretch` estira los ítems al alto de su línea — y el toggle `Cronológico|Por perfume` mide **46** (44 + 1 px de borde arriba y abajo). Con la chip nueva, ⚙️ y 👑 cayeron a la línea del toggle y se estiraron. **Se verificó contra el blob de `main` que 👑 medía 44 antes**, para no atribuirle el problema al cambio equivocado. Arreglado con `align-items: center` en el contenedor, no tocando las chips.
- ⚠️ **Primera hipótesis descartada midiendo:** probé `line-height: 1` en `.log-chip` creyendo que el glifo del emoji estiraba la caja. **Siguió en 46.** Se revirtió junto con su comentario, que ya explicaba una causa falsa — un comentario equivocado en el CSS dura más que el bug.
- 🔴 **El fallback de navegador destapó un segundo bug propio:** con **un solo perfil temporal compartido** entre candidatos, Chrome rechaza el que dejó Edge (**"Settings version is not 1", código 21**) y el segundo intento falla por una razón que no es suya. Ahora va **un perfil nuevo por candidato**, y los de los intentos fallidos se borran.
- Y un tercero: **`spawn` de una ruta inexistente emite `error`, no `exit`**, así que `--navegador C:/no/existe` reventaba con un stack de Node en vez del mensaje que dice qué se probó. Capturado.
- 🔴 **3 GB de basura propia en `C:`.** Cada corrida de `medir_targets.js` deja un perfil de Chromium (~110 MB) en `%TEMP%\st-medir-*`; el borrado final está en un `try/catch` y **en Windows el perfil queda bloqueado por los procesos hijos que sobreviven al `kill` del padre**, así que falla en silencio. Había **28 carpetas** y `C:` estaba en **14 GB libres** (el `CLAUDE.md` del workspace dice ~25). Limpieza: primer pase borró 16; las otras 12 estaban tomadas por **128 procesos zombis**, identificados por `st-medir-` en su línea de comandos (el navegador de Alejo no la tiene: **30 procesos suyos quedaron intactos**) y terminados; segundo pase borró las 12. **`C:` volvió a 25 GB.**
- **Dato de método, otra vez:** la verificación de la chip encontró el problema de los 46 px porque mide **todas** las chips, no la primera. La vez anterior había medido `$('.log-chip')` — sólo una — y por eso 👑 no aparecía. Un instrumento que mira una muestra dice la verdad sobre la muestra, no sobre la fila.

#### Keywords cerrados

| Keyword | Qué hace | Commits |
|---|---|---|
| `[LOG-SISTEMA-CHIP]` | Login, logout y los backups salen de Catálogo a su propia chip `⚙️ Sistema`, última de la fila · + `align-items: center` para que la fila no estire a sus ítems | `c0c26db` · bump `abe2945` |

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[MEDIR-TEMP-SWEEP]` (nuevo) | Barrer al arrancar los `%TEMP%\st-medir-*` propios que no estén en uso. Sin apuro, pero cada sesión con muchas mediciones deja ~110 MB por corrida en un `C:` que tiene poco margen. |

#### 💬 Mensajes meta

- Alejo aprueba por la vía del PREPARADOR (*"OK de Alejo, borrá las 19 carpetas"*) y espera que lo borrado se **mida y se reporte**: cuántas, cuánto pesaban, cuánto quedó libre.
- Pidió explícitamente que le **avise si vuelve a pasar** — o sea, el chequeo de espacio al final de una sesión con mediciones pasa a ser parte del trabajo, no un extra.

---

### Sesión 23-sep-2026 (mediodía) · **`[LOG-PULIDO]`** — tres cosas del Log, todas medidas

Tanda chica sobre `eeb4b29`, salida del redibujo del DISEÑADOR sobre las 4 capturas de v1.1.112 (decisiones **39** y **41**, más el precio con `$`). Prompt `_w` del PREPARADOR con **merge pre-aprobado** si el stat mostraba sólo `admin.html`, `scripts/contraste.js` y `sw.js` — lo mostró. La base de `.action-btn` (decisión 40) **no** entró: el PREPARADOR la midió, toca 54 botones y no 10, y volvió al DISEÑADOR.

#### Qué se hizo

- **`0657d03` — `admin.html`, los tres cambios:**
  - **`[LOG-POR-PERFUME-COL]` (decisión 39).** `logItem(e, modo)` con `'nombre'` / `'idem'` / `'sin'`; la vista agrupada pasa `'sin'` y no emite el span. A 600 px cada fila de "Por perfume" abría con un renglón que sólo tenía `〃` (**50,8-53,8 px**, medido en `main`); ahora las 8 filas de stock/depósito del fixture miden **44** y hay **0** `.log-nombre` en el feed. El cronológico quedó **idéntico a `main` fila por fila** (17 filas, mismos altos, los mismos 3 `〃`).
  - **`[LOG-FILAS-NEUTRAS]` (decisión 41).** `.log-old` a `var(--gris)` y `.log-new` sin color: hereda el texto del tema. Computado: `.log-old` `rgb(136,136,136)` en oscuro y `rgb(107,107,107)` en claro; `.log-new` = el body (`#fff` / `#1a1a1a`). Antes eran rojo y verde: *"`3 → 0` mostraba un 0 verde; `0 → 6` un 0 rojo. La fila es un hecho, no un juicio"*. El rojo y el verde quedan sólo en el resumen.
  - **`[LOG-PRECIO-PESOS]`.** `auditValueLabel` devuelve `'$' + formatPriceAdmin(v)` para `price` / `promo` / `Precio` / `Promo` numéricos, y `logCambio` tiene rama propia para `price_update` (sin repetir la etiqueta; la promo sólo si cambió). Medido: `Precio: $105.000 → $109.000` · `Precio: $85.000 → $90.000` (el `85,000.00` del seed) · `$45.000 → $48.000` (en `main`: `Precio: 45000 → 48000 · Promo: vacío → vacío`) · `➕ Nuevo perfume · Precio: $52.000`.
- **`112d0d6` — `scripts/contraste.js`:** `.log-new` se mide como texto heredado del body; con el parche, la fila vieja decía *"no pude resolver el texto"* y salía 1. Queda en **0 fallas, 44 mediciones**, `.log-old` 4,90 / 5,33, `.log-new` 17,36 / 17,40.
- **`b456793` — bump v1.1.113**, solo. Merge ff `eeb4b29..b456793`, rama `fix-log-pulido` borrada. Producción verificada con `curl`: las 6 piezas nuevas presentes en el `admin.html` servido, la regla vieja (`--stat-tinta-out` tachado) ausente, SW **v1.1.113**.
- **Fixture, sonda y resumen fuera del scratchpad**, en `D:\workspace\_correo_agentes\ST_Perfumeria\fixture-log\`: `generar.js` (18 eventos con horas relativas a hoy en hora Argentina — un JSON con fechas fijas se vence al otro día, porque el Log pide desde ayer 00:00), `sonda-log-pulido.js` (corre contra `main` y contra la rama: así salió la comparación fila por fila) y `resumir.js`.

#### Decisiones / bugs encontrados / workarounds

- **Decidió el DISEÑADOR:** decisiones 39 y 41 y el `$`. **Pre-aprobó el PREPARADOR:** el merge, con la condición de los tres archivos. **Propuse yo:** los helpers `esPar` / `par` dentro de `logCambio` — la fila de stock y las dos de precio comparten el mismo par de spans; en stock la salida es la misma que en `main`, verificado.
- **Sonda de chips (ítem 4 del `_w`, "que lo decida el número"):** jefe, 600 px, Inter cargada. Línea 1: Todo · Stock · Depósito · Precios · Catálogo, con **90,8 px libres** al final; `⚙️ Sistema` necesita **95,5** (89,9 + 5,6 de gap) → cae por **4,7 px**, y con ella **👑**. Línea 2: ⚙️ Sistema · 👑 Jefe · toggle (a la derecha por su `margin-left: auto`). En la réplica del PREPARADOR sin Inter caía sólo 👑: con Inter las chips son más anchas.
- **`[LOG-CAMBIO-LARGO]`, confirmado con una fila de Foto en el fixture** (preexistente, igual en `main`): `.log-cambio` mide **1.254 px** en un feed de 523; lo recorta `main.admin-main` (`overflow-x: hidden`, borde en x = 569) → se ve sólo el principio de la URL vieja, **la flecha y la URL nueva no se ven**, sin puntos suspensivos ni scroll horizontal. La fila sube a **96,8 px** en cronológico (4 renglones: nombre / hora + acción / cambio / 👑 sola) y a **74,8** en "Por perfume" (97,8 en `main`). No se tocó.
- **Revisión adversarial antes del merge:** 3 lentes (corrección, XSS, fidelidad al `_w`) + 2 escépticos por hallazgo, 7 agentes. **0 confirmados.** Dos refutados por unanimidad: (a) un `price_update` donde sólo cambia la promo muestra el precio igual (`$75.000 → $75.000 · Promo vacío → $60.000`) — es lo que pide el `_w`, ya pasaba en `main` con otro formato y hay 0 eventos en 60 días; (b) el XSS de Combos de abajo, que es preexistente.
- 🟠 **Hallazgo fuera de alcance, no tocado:** un agujero preexistente en Combos, del mismo patrón que S10 / S10-bis → `[S10-TER-XSS-COMBOS]`. *(Detalle retirado el 23-sep a la noche por la regla de los agujeros abiertos: vive fuera del repo hasta que se cierre.)*
- **`%TEMP%\st-medir-*` volvió a pasar**, como se esperaba (`[MEDIR-TEMP-SWEEP]`): 5 corridas → **5 carpetas, 57,5 MB**, esta vez **sin procesos vivos**. No se borraron: esperan el OK. `C:` en 23,3 GB libres.

#### Keywords cerrados

| Keyword | Qué hace | Commits |
|---|---|---|
| `[LOG-POR-PERFUME-COL]` | "Por perfume" sin la columna del nombre: filas de 44 a 600 px | `0657d03` |
| `[LOG-FILAS-NEUTRAS]` | Las filas del Log no opinan: old en `--gris` tachado, new en el texto del tema | `0657d03` · `112d0d6` |
| `[LOG-PRECIO-PESOS]` | `$` y punto de miles en todo precio del Log; `price_update` sin etiqueta repetida y con la promo sólo si cambió | `0657d03` |

Los tres bajo **`[LOG-PULIDO]`**, bump `b456793`.

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[LOG-CAMBIO-LARGO]` (nuevo, 🟡) | La fila de un `perfume_edit` de Foto se sale del ancho a 600 px (medido arriba): 13 eventos así en 60 días. Anotado por el PREPARADOR; el cómo lo decide el DISEÑADOR. |
| `[LOG-CHIP-PRECIOS]` (nuevo, 🟢) | La chip 💰 Precios filtra `price_update`, que tiene **0 eventos en 60 días**: los 43 cambios de precio reales son `perfume_edit` con la clave `Precio` y caen en Catálogo. Semántica de chips → DISEÑADOR. |
| `[S10-TER-XSS-COMBOS]` (propuesto) | Fuera de Pendientes hasta que Alejo lo decida. |

---

### Sesión 23-sep-2026 (tarde) · **`[ESPERA-SEGURA]` + `[XSS-PEDIDOS-PASS]` + los documentos que servía el dominio**

Empezó como un relevamiento de sólo lectura de `[S10-TER-XSS-COMBOS]` para ver si "entraba en el próximo merge" (pregunta de Alejo; la respuesta fue que no: son ~50 lugares) y terminó en una tanda de seguridad con **decisión 47 de Alejo**: *"esto va primero y solo"*. Prompts `_b` y `_c` del PREPARADOR, 5 commits sobre `7a3f7b8`, SW v1.1.113 → **v1.1.114**, en producción y verificado, con Alejo corriendo el SQL en tres bloques en el medio.

#### Qué se hizo

- **`[ESPERA-CAPTURAS]` (sin código):** las 6 capturas de la Lista de espera para el DISEÑADOR (3 del panel a 600 px, página completa; 3 del catálogo a 390, pantalla) en `D:\workspace\_correo_agentes\ST_Perfumeria\capturas-espera\`, con datos inventados y un capturador **fuera del repo** (`_correo_agentes\…\herramientas\capturar.js`: reusa el stub de `medir_targets.js` y deja su perfil temporal en `D:`). Sonda de altos a 600: pestañas Pendientes/Historial **30**, Avisar/Quitar/Re-avisar **22,6**, Avisar a todos **28,4**; la pestaña inactiva cae al gris por defecto del navegador. `medir_targets` cuenta las 2 pestañas (2 de los 37 cortos) pero **no ve la lista**: nunca llama a `loadListaEspera`.
- **Relevamiento de `[S10-TER-XSS-COMBOS]`** (6 agentes, sólo lectura, SQL sólo `SELECT`): ~19 sinks en el panel y ~30 en `js/app.js`; sólo el staff escribe `combos`; 0 datos peligrosos. De yapa encontró dos cosas peores — S15 y S16 de `docs/SECURITY.md` — y dos ortogonales (`[COMBOS-PAUSADOS-VISIBLES]`, `[COMBO-PROMO-NULL]`).
- **S1:** Alejo había rotado las dos contraseñas del panel el **19-sep a las 21:11** sin que quedara anotado. Se verificó sin tocar credenciales: el cambio desde el dashboard no deja evento en `auth_audit_logs` ni en `auth_logs`, pero a las 21:15-21:16 hay login y logout de las dos cuentas, y las sesiones vivas son todas posteriores. `auth.users.updated_at` no sirve de marca (se mueve con cada `token_refreshed`) y `auth.audit_log_entries` está vacía.
- **`4b88e20` — `[XSS-PEDIDOS-PASS]`:** `escapeHtml(r.telefono)` en los dos lugares de "Pedidos pass" · se borra `ADMIN_PASS_EMPLEADO` (código muerto).
- **`fe302d1` — `[ESPERA-SEGURA]`:** el catálogo inserta en `lista_espera` sin leerla (23505 = "¡Ya estás en la lista!") y el ✓ sale de `lista_espera_pendientes` al entrar; `onLogout` borra `st_waitlist`. Agregado mío, aceptado por el PREPARADOR: sólo repinta si el catálogo **ya está pintado** — repintar antes de `loadOverrides` mostraba por un instante el seed, pausados incluidos.
- **`db37b21` — `.vercelignore` + `security-scan.md` sin valores.**
- **`41aa39a` — agregado `_c`:** (a) sin cliente no hay ✓ (se vacía la caché al arrancar), (b) el teléfono es el de la cuenta y el overlay lo muestra como texto — *"una caja que no deja escribir parece rota"* (DISEÑADOR) —, (c) lo que se anota mientras la RPC está en vuelo se une a la respuesta, (d) el espacio del ✓. `index.html`: la descripción del overlay ya no pide el WhatsApp.
- **`dc6fd1f` — bump v1.1.114.** Merge ff `7a3f7b8..dc6fd1f`, rama borrada.
- **SQL (Alejo, `SQL_para_Alejo_ESPERA-SEGURA_2026-09-23.md`):** Bloque 1 (RPC nueva, validación de dígitos en el reset, DELETE sólo jefe) antes de todo; Bloque 2 (índice único parcial) **antes del deploy** en vez de después; Bloque 3 (SELECT sólo `authenticated`) después del deploy.

#### Decisiones / bugs encontrados / workarounds

- **Decidió Alejo:** `[S10-TER-XSS-COMBOS]` como 🟠 · la decisión 47 (esta tanda primero y sola) · correr el Bloque 2 antes del deploy (lo recomendé yo). **Decidió el DISEÑADOR:** 42, 45, 46 y la nota de la caja. **PREPARADOR:** `_b` y `_c`, y el orden del SQL. **Propuse yo:** la guarda del repintado, el teléfono canónico tal cual (abajo) y adelantar el Bloque 2.
- 🔴 **El orden del SQL tenía una ventana.** Entre el deploy y el Bloque 2, el JS nuevo ya no deduplicaba y el índice todavía no existía: un doble anotado dejaba una fila duplicada, un Telegram de más y hacía **fallar** el `create unique index`. Con el JS viejo, correr el índice antes es inofensivo (hacía `select` de cualquier fila antes de insertar). Se corrió antes: 0 duplicados.
- 🔴 **`cleanPhone` no es idempotente:** borra un "15" del medio (`^549(\d{2,4})15(\d+)$`). Aplicado al teléfono de la cuenta, que ya viene canónico, dejaba en 11 dígitos a **2 de 99 clientes** y no podrían anotarse. Se usa el teléfono tal cual si es `^549\d{10}$`; `cleanPhone` sólo como respaldo. `formatPhoneDisplay` recibe los 10 dígitos locales por el mismo motivo.
- **Hoisting de `var`:** la primera sincronización arranca desde `onLogin`, que corre al restaurar la sesión **antes** de que se ejecute la línea que declara las variables de la lista de espera. Por eso `waitlistMarcadosDurante` se declara **sin** inicializador: un `= null` pisaba el array que la sincronización ya había abierto.
- **`medir_targets.js` no se tocó** (hubiera sido un sexto/séptimo archivo fuera de lo pre-aprobado): el `insert` con 23505 y la RPC demorada se le enseñaron al stub con un script inyectado desde fuera del repo.
- **La revisión adversarial de esta tanda se cortó** por el límite de sesión (11 de 15 agentes cayeron): los "refutados" sin votos no eran refutaciones. Se verificaron a mano; de ahí salieron la guarda del repintado y los tres puntos del `_c`.
- **Verificación:** 11 escenarios del catálogo con stub (incluidos sin cliente, overlay con el input manipulado, RPC demorada 5 s con el cliente anotándose en el medio — con la sincronización comprobada en vuelo — y el teléfono con "15"), 0 lecturas de `lista_espera` en todos; Pedidos pass con `<img onerror>` (ejecutaba en `main`, no en la rama); producción por `curl` (6 piezas del código, 8 × 404, 10 × 200) y como `anon` después del Bloque 3.

#### Keywords cerrados

| Keyword | Qué hace | Commits |
|---|---|---|
| `[ESPERA-CAPTURAS]` | 6 capturas de la Lista de espera + sonda de altos para el DISEÑADOR | — (sin código) |
| `[XSS-PEDIDOS-PASS]` | El teléfono de "Pedidos pass" se escapa y la RPC del reset valida dígitos (S16) | `4b88e20` + Bloque 1 |
| `[ESPERA-SEGURA]` (incluye `[ESPERA-SELECT-ANON]`) | `anon` ya no lee `lista_espera`; el ✓ sale de la base; `_c` (S17) | `fe302d1` · `41aa39a` + Bloques 1-3 |
| `[DOCS-PUBLICOS]` | `.vercelignore`: el dominio deja de servir docs, SQL, memoria, herramientas y `*.md` (S15) | `db37b21` |
| `[SECURITY-SCAN-CMD-VALORES]` | Los dos valores de S1 fuera de `security-scan.md` | `db37b21` |

Bump `dc6fd1f`. De `[SECURITY-AUDIT-S1]` queda sólo `ADMIN_PASS` (→ `[VERCEL-ENV-VARS]`).

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|
| `[S10-TER-XSS-COMBOS]` 🟠 (nuevo) | Tanda propia con bump; inventario fuera del repo (S18). |
| `[LOG-PULIDO-2]` 🟡 (nuevo) | Decisiones 36b, 43 y 44; reúne `[LOG-CAMBIO-LARGO]` y `[LOG-CHIP-PRECIOS]`. Prompt aparte. |
| `[COMBOS-PAUSADOS-VISIBLES]` 🟡 (nuevo) | Dos sets pausados salen activos en el sitio. |
| `[COMBO-PROMO-NULL]` 🟢 (nuevo) | `applyOverrideRowToMemory` pisa la promo del combo con `NULL`. |
| Repaso de Pendientes con Alejo | Hay ítems que él hizo y nunca se tacharon (la rotación del 19-sep fue uno). |

#### 💬 Mensajes meta

- Alejo hace cosas por su cuenta y no siempre las avisa (rotó las contraseñas el 19-sep y el pendiente siguió abierto). Él mismo propuso repasar Pendientes para tachar lo hecho.
- Pidió que el bloque para el PREPARADOR traiga **contexto suficiente para verificar solo**, sin depender de un reporte anterior (el PREPARADOR verifica "contra GitHub, no contra tu reporte").

---

### Sesión 23-sep-2026 (noche) · **repaso de Pendientes + la seguridad manual + las capturas del DISEÑADOR**

Después de la tanda de seguridad, Alejo pidió repasar Pendientes: *"hay cosas que no te dije que taches"*. Salió un repaso de sólo lectura (21 agentes, un escéptico por cada "hecho") y, a pedido del DISEÑADOR, un **inventario con una fila por tema y su dueño**, fuera del repo porque describe agujeros abiertos. De ahí cuatro urgentes; tres se cerraron en la misma noche con Alejo en el medio. Después, el `_g` del PREPARADOR: verificaciones, backup de fotos, capturas y este cierre.

#### Qué se hizo

- **Repaso:** `_correo_agentes\ST_Perfumeria\inventario\inventario-pendientes-2026-09-23.md` (por dueño) y `para-DISENADOR-2026-09-23.md` (sólo lo nuevo); evidencia en `herramientas\repaso-pendientes-23sep.json`. 5 tachables confirmados, 8 preguntas para Alejo, 6 pendientes perdidos en la reconciliación del 18-sep y 4 urgentes nuevos.
- **`[SIGNUP-ABIERTO]`:** Alejo apagó el registro de Supabase Auth; verificado `disable_signup: true` (S19).
- **`[ROTAR-DB-PASS]` (São Paulo):** rotada por Alejo; sitio, panel y API en 200 después; ningún código usa conexión directa. Los valores viejos salieron de `SECURITY.md` § S5.
- **`[RESET-SIN-TELEGRAM]`:** regresión del Bloque 1 de la tarde (el 1b partió de `sql/fase1.sql`, anterior al aviso). Alejo corrió el SQL corregido; en producción `cliente_reset_solicitar` tiene otra vez `_aviso_tg` **y** la validación `^[0-9]{8,15}$`, `SECURITY DEFINER`, EXECUTE para `anon` y no para `public`.
- **`[BACKUP-FOTOS-LOCAL]`:** `D:\backups\perfume-fotos-2026-09-23\` — **165/165, 8.689.933 bytes** (igual que `storage.objects`), `manifest.json` con sha256 re-verificado, 3 fotos abiertas al azar. Script fuera del repo (`herramientas\backup-fotos.js`). Dato para S8: `anon` también puede **listar** el bucket.
- **Capturas del DISEÑADOR** (en `capturas-espera\`, la carpeta que él lee): catálogo a 390 en claro y oscuro (grilla con promo, "ST", 🔔 y ✓; grilla de invitado con 🔒; un set; el detalle abierto; el overlay de espera), en claro la píldora «Cerrado» y Categorías, y el panel a 600 en claro y oscuro con las 7 pestañas pedidas (Log, Decants, Analytics, Backups con filas, Puntos, Doctor recortado a los filtros, Espera). 26 PNG, todos con fixture y teléfonos inventados.
- **Tabla C** (`capturas-espera\tabla-C-amarillo-claro-v1.1.114.md`): **85** apariciones de `color: var(--amarillo)` (20 en `<style>`, 65 inline; igual que el PREPARADOR; las otras 23 coincidencias son `border-color` y `accent-color`). Renderizadas con el fixture: 57; **52 por debajo de 4,5**, 49 de ellas entre 1,59 y 1,86. Las 28 no renderizadas van aparte, con línea.
- **`docs/IDEAS.md`** nuevo, con `[COMPARE-V2-GRAFICO]`.

#### Decisiones / hallazgos

- **Decidió Alejo:** la regla de los **flujos multi-agente** (sólo cuando hace falta, y con su OK antes), la de los **agujeros abiertos** (keyword sola en el repo), `[JUEGOS-ST-WIREFRAME]` tachado, `[COMPARE-V2-GRAFICO]` a Ideas, `[SIRENITA]` a Pendientes fusionado con las promos de decants. La cuenta de gmail de `auth.users` es suya. **Decidió el DISEÑADOR:** `[ESPERA-MAS]`, el botón de espera a 44 (`[TAP-44]`), `[CLARO-CATALOGO-2]` y `[SW-BANNER-SMART]`. **PREPARADOR:** el orden del `_g` y `[AUTH-ES-STAFF]`.
- 🔴 **Hallazgo de las capturas:** a 390 px `#setsGrid` (flex, `justify-content: center`, `overflow-x: auto`) empuja las cards a la izquierda: **el primer set queda en −429 px y nadie lo puede ver** → `[SETS-CENTRADO-CORTADO]`.
- **Otros datos medidos:** `.td-price` en claro se ve `#2ecc71` sobre blanco = 2,1 (292 celdas); `.admin-table th` en claro se ve `#222` (13,47), no 1,86 como decía `[AMARILLO-TINTA-CLARO]`; las cards de Categorías en claro son `#ede2c2` (NO ROMPER #7 dice que quedan oscuras: lo revisa el DISEÑADOR); en claro, el recuadro "Qué incluye cada backup" queda oscuro con texto gris casi invisible.
- **Método:** el capturador externo (`herramientas\capturar.js`) ganó `--extra` y recortes pedidos por el setup; `medir_targets.js` no se tocó. La primera versión de la tabla C mezclaba líneas con el mismo `style` literal: se separaron cruzando también el texto que sigue a cada etiqueta.

#### Keywords cerrados

| Keyword | Qué | Cómo se verificó |
|---|---|---|
| `[SIGNUP-ABIERTO]` | Registro de Supabase Auth apagado | `disable_signup: true` |
| `[ROTAR-DB-PASS]` | DB password de São Paulo rotada | sitio y API en 200; valores fuera de `SECURITY.md` |
| `[RESET-SIN-TELEGRAM]` | El reset vuelve a avisar por Telegram | `pg_get_functiondef`: `_aviso_tg` y `[0-9]{8,15}` |
| `[BACKUP-FOTOS-LOCAL]` | Copia local del bucket | 165/165, bytes y sha256 |
| `[CLIENTES-PRUEBA]` | Los 2 clientes de prueba ya no están | 0 filas; 2 DELETE autenticados el 20-sep |
| `[JUEGOS-ST-WIREFRAME]` | Tachado por Alejo | lado a lado desde el 5-may |

También quedaron verificados en el repaso (en docs viejos, no en Pendientes): legibilidad del FAQ en claro (15,12:1), precios de LE BEAU, logo @2x (obsoleto) y deploys viejos de Vercel (protegidos por SSO, 302).

#### Keywords abiertos para próxima sesión

Nuevos en `CLAUDE.md` § Pendientes: `[S8-STORAGE-ANON]` 🟠 · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[SETS-CENTRADO-CORTADO]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` 🟡 · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` 🟢. Siguen sin decidir (en el inventario): `[UPLOADER-WEBP-AUTO]`, Oregon, el dump de mayo, `D:\tmp\contraseñas_supabase.txt`, `[MONITOREO-SUPABASE]` y los pendientes perdidos de performance.

#### 💬 Mensajes meta

- Alejo prefiere **el resumen final entero, sin adelantos parciales**: *"no quiero que me ADELANTES nada"*. El único adelanto útil de esta noche fue el del backup, porque destrababa el SQL de S8.
- Los flujos multi-agente se lanzan **sólo con su OK previo** (qué se barre, con cuántos agentes).

---

### Sesión 23-sep-2026 (noche, cierre) · **`[S8-STORAGE-ANON]` cerrado + `[SETS-CENTRADO-CORTADO]`**

Prompt `_h` del PREPARADOR, sobre el `_g`: verificar el cierre del bucket de fotos que corrió Alejo, aplicar la regla de los agujeros abiertos a lo viejo, y una tanda chica para el bug de los sets que salió de las capturas.

#### Qué se hizo

- **`[S8-STORAGE-ANON]`** — Alejo corrió `SQL_para_Alejo_FOTOS-STAFF_2026-09-23.md` (3 filas) y probó una subida desde el panel: anduvo. Verificado sin escribir en producción: en `storage.objects` quedan **exactamente** `fotos_staff_select`, `fotos_staff_insert` y `fotos_staff_update`, `{authenticated}` con el filtro por los dos emails del panel, y ninguna otra; listar como `anon` → `[]` (antes 165); 3 fotos al azar por URL pública → 200 (el bucket sigue público); `render/image?width=400` → 200, aunque ninguna página lo usa.
- **`30780c7` — `[SETS-CENTRADO-CORTADO]`:** `.sets-grid` pasa de `justify-content: center` a `flex-start` (sólo la regla base: la de ≥ 768 px ya era `flex-start` y no se tocó). **`0b978fc`** — bump v1.1.115. Merge ff `10db966..0b978fc`, en producción y verificado con `curl`.
- Medido con el capturador externo, que ganó `--repo` para medir `main` y la rama con el mismo setup: a 390 px la primera card pasa de −445 px (respecto del contenedor) a **0**, y la última queda alcanzable con scroll (`scrollWidth` 803 → 1248). Con un solo set, queda alineado a la izquierda. A 1280, **idéntico** a `main` (mismas posiciones: 0 · 396 · 792 · 1188). Contraste sin cambios. Capturas `catalogo-v1.1.115-{claro|oscuro}-3-set` y `-3b-set-uno` en `capturas-espera\`.
- **Regla de los agujeros abiertos, aplicada a lo viejo** (respuesta del PREPARADOR: el repo es público y eso vale igual para lo de mayo): S3 y S13 con la keyword sola en `SECURITY.md` y en Pendientes; S8 descrito como cerrado, sin la receta.

#### Decisiones

- **Propuse yo, aceptado por el prompt:** `flex-start` y no `safe center`. En flex, `safe` recién lo soporta Safari 17.6 (julio de 2024, según MDN BCD) y Chrome 115; en un iPhone más viejo que acepte la palabra sin aplicarla, el primer set seguiría invisible. El costo: con un solo set, en el celu queda a la izquierda en vez de centrado.
- **PREPARADOR:** el SQL de las fotos sin ningún DELETE (el panel nunca borra del storage) y la regla de los agujeros también para lo viejo.

#### Keywords cerrados

| Keyword | Qué | Commits / cómo |
|---|---|---|
| `[S8-STORAGE-ANON]` | El bucket de fotos: sólo el staff escribe y lista; nadie borra | SQL de Alejo · verificado con `pg_policies` y como `anon` |
| `[SETS-CENTRADO-CORTADO]` | El primer set vuelve a verse en mobile | `30780c7` · bump `0b978fc` |

---

### Sesión 23-sep-2026 (noche, `_j`) · **`[ESPERA-CLARO]` + `[LOG-PULIDO-2]` + la tanda C del DISEÑADOR**

Prompt `_j` del PREPARADOR (reemplazó al `_i`, que no llegó a salir): tres tandas **en orden, A primero y sola → B → C**, cada una en su rama, con su bump y su merge, y un solo bloque al final. Workflow multi-agente: no hizo falta.

#### Qué se hizo

- **A · `[ESPERA-CLARO]`** (rama `fix-espera-claro`) — `49bf22d`: la ventana «Avisame» en claro. `.waitlist-box` era `#111` en los dos temas y `body:not(.dark-mode) p` (0,1,2) le ganaba a los textos de la caja (0,1,0): quedaban `#2a2a2d` sobre `#111` = **1,32**. Nueve reglas `body:not(.dark-mode) .waitlist-…` (0,2,1), sin `!important`: caja `#fff` + borde `rgba(120,90,0,.28)`, título `#1a1a1d` (17,36), perfume `#8a6d00` (4,92), descripción y × `#5e564a` (7,23), × hover `#1a1a1d` (antes `#fff`: desaparecía, y en táctil el hover queda pegado). Los seis `msgEl.style.color` de `submitWaitlist` pasan a clase por estado (`--ok` / `--ya` / `--error`), y `openWaitlist` limpia la clase: en claro `#1b5e20` (7,87), `#8a6d00` (4,92) y `#b8342a` (5,89); en oscuro, los de siempre. **`7c92f5a`** — bump v1.1.116. Stat de 3 archivos (lo pre-aprobado), merge ff `efb9cfc..7c92f5a`, en producción y verificado con `curl`.
- **Verificación de A:** sonda en el DOM a 390, fixture y teléfono inventado, contra un snapshot de `efb9cfc`: en oscuro los colores computados de la caja, su borde y los 7 textos son **idénticos** en los 4 estados (abierta, ¡Listo!, ¡Ya estás!, error — los mensajes forzados con el stub de `insert`: OK, 23505 y otro error). En claro, los valores de la decisión 53 exactos. 8 capturas `catalogo-v1.1.116-{claro|oscuro}-5*-overlay-espera*` en `capturas-espera\`.
- **`contraste.js` en una rama aparte** (`contraste-espera-claro`; mergeada con el OK de Alejo después del cierre, rebaseada sobre `2838c35` → `3286e61`): 9 filas × 2 temas para la ventana, y el ganador se elige entre la regla de la clase **y la de la etiqueta `p`** — sin eso el script no veía el 1,32. Contra `main`: 0 fallas, 62 mediciones, los 18 valores iguales a la sonda. Contra `efb9cfc`: 8 fallas (título/perfume/descripción 1,32, × 2,61). Quedó aparte porque la pre-aprobación del merge de A era de 3 archivos.
- **B · `[LOG-PULIDO-2]`** (rama `log-pulido-2`) — `c8b1940`: decisiones **36b**, **43** y **44** del DISEÑADOR en `admin.html`. `logFamilia(action)` → **`logFamilias(e)`**, que devuelve un array (un `perfume_edit` con `Precio`/`Promo`/`price`/`promo` en par va a Precios y, si tocó otra clave, también a Catálogo; `nuevo_*` sigue en Catálogo aunque traiga precio; `backup_create_fallback` a Sistema; ningún evento sin familia). El jefe en **dos filas a cualquier ancho** con dos envoltorios `.log-chips-fila` de ancho 100 % (una sola separación: 5,59 px); `.log-chip` a `padding: 0 .7rem`. Fotos con palabras: `Foto` / `url` → agregada · quitada · cambiada; `Fotos extra` → N → M; nunca la ruta. `.log-cambio` se parte, sin elipsis. Bump v1.1.117. Stat de 2 archivos, merge ff `7c92f5a..4f60dca`, en producción y verificado con `curl`.
- **Mediciones de B** (fixture de 25 eventos, Inter cargada, claro y oscuro): (1) fila 1 a 600, jefe: sobran **29,6 px** después de ⚙️ Sistema · (2) la chip más chica, «Todo», **51,9 × 44** · (3) separación entre filas **5,59 px** · (4) a 1005 × 600 (Tab A9 acostada), siguen las dos filas · (5) fila de `📷 Foto: cambiada` a 600: **52,8 px** (antes 96,8) — el brief pedía ≤ 52: 52,8 es lo que mide **cualquier** fila del jefe a 600 (el 👑 de 17 px marca la segunda línea; las de la empleada miden 49,8-50,8), también en `main` · (6) `#logFeed` sin scroll horizontal con un `Nombre` de 919 px · (7) `logFamilias` real sobre la forma de los 2716 eventos de 60 días (SELECT de sólo lectura): Stock 1800 · Depósito 541 · Precios **43** (antes 0) · Catálogo 74 · Sistema 259 = 2717, uno en dos chips · (8) contraste 0 fallas / 44; `medir_targets` **602 / 37**, igual con y sin fixture. La empleada: una fila como antes; sus chips 3,2 px más angostas cada una por el padding. 6 capturas `panel-v1.1.117-{claro|oscuro}-1*-auditlog*`.
- **C · para el DISEÑADOR** (sólo lectura, nada escrito en producción): `tabla-C-catalogo-claro-v1.1.117.md` (35 textos en `#8a6d00` en claro, 28 por debajo de su mínimo; confirmados sus «Explorá por» 3,41 sobre `#e3d6b3` y SALIDA/CORAZÓN/BASE 4,28 sobre `#f5efde`; «Foto próximamente» baja a 2,98 por su `opacity: .75`), `flotantes-390-v1.1.117.md` (9 flotantes con su rect y `z-index`, iguales en los dos temas; con una barra de 60 px quedan tapados 5; al final de la página quedan 23,9 px libres → faltan 36,1 sin safe-area, 70,1 en un iPhone) y `jugar-390-v1.1.117.md` (→ `[JUGAR-NO-LLEGA]`). Las sondas viven en `_correo_agentes\…\herramientas\c-disenador\`.
- **Docs:** NO ROMPER #7 con la decisión 52 (y la línea de § Light mode, que decía lo mismo); S1 y S4 con la keyword sola en `SECURITY.md` y en Pendientes.

#### Decisiones

- **PREPARADOR:** `nuevo_create` / `nuevo_update` en Catálogo aunque traigan precio («es un alta, no un cambio de precio» — su interpretación, pasada al DISEÑADOR); `backup_create_fallback` a Sistema; los huecos de la ventana (× hover y los tres mensajes) con tintas que el DISEÑADOR ya había decidido.
- **Claude Code:** el `.log-chip` a `.7rem` para los dos roles (el brief lo pedía sobre la regla, sin rol); la keyword `[S4-OREGON]` para S4, que no tenía; la captura horizontal del Log con viewport alto (1005 × 1620) en vez de página completa, porque la página completa estira la barra lateral fija y la dibuja encima del contenido (en `main` pasa igual: es de la captura).

#### Keywords cerrados

| Keyword | Qué | Commits / cómo |
|---|---|---|
| `[ESPERA-CLARO]` | La ventana «Avisame» se lee en claro (decisión 53) | `49bf22d` · bump `7c92f5a` |
| `[LOG-PULIDO-2]` | Precios por lo que cambió, el jefe en dos filas, las fotos con palabras (36b, 43, 44) | `c8b1940` · bump `4f60dca` |

---

### Sesión 23-sep-2026 (noche, `_l` + `_m`) · **chicos + `[VER-MAS]` + `[JUEGOS-VENTANA]`**

Prompt `_l` del PREPARADOR (reemplazó al `_k`, que no salió) y, mientras se trabajaba, el `_m` con las decisiones 71-73 del DISEÑADOR. Tres tandas en orden (A → B → C), cada una en su rama, con su bump y su merge. Workflow multi-agente: no hizo falta.

#### Qué se hizo

- **A · chicos** (rama `fix-chicos-24`, SW **v1.1.118**, merge ff `937a40c..35774b5`):
  - **`[DECANTS-DEFAULTS]`** — `decants_config` tiene 9.500 / 9.000 / 8.500 desde el 10-ago (leído con SELECT; **no se escribió en la base**); los valores de respaldo del código decían 8.500 / 7.500. Pasan a los de la base en `DECANTS_CONFIG` (`app.js`) y en el formulario del panel (`def` y los `value`), con un comentario que dice que los reales viven en la base. Medido con un stub que emula `.single()`: con la base andando, `main` y la rama muestran lo mismo en el catálogo (`#decantLadder`) y en el panel; con la base caída, `main` mostraba 8.500 / 7.500 (y un «Guardar» los escribía) y la rama 9.000 / 8.500. Otros lugares con la escalera a mano, sin tocar: los `placeholder` del formulario del panel («Ej: 8500», «Ej: 7500») y comentarios históricos (`app.js` ~L6610, `extras.js` L365, `sql/add_precio_frasco_max.sql`). El comentario de cabecera del bloque (`app.js` L6546) sí se actualizó porque describía los defaults.
  - **`[LOG-NOMBRE-CORTADO]`** (decisión 69) — `.log-nombre` a `flex: 1 0 auto`. Con un `Nombre` de 919 px y con el nombre real más largo (`TUBEES STRAWBERRY CHEESECAKE`, 207,5 px, de `perfumes_nuevos`): el nombre entero a 1005, 800 y 601, sin scroll horizontal; a ≤ 600, igual que antes.
  - **`[LOG-LABEL-FALLBACK]`** (decisión 70) — `backup_create_fallback` → 🛟 «Backup de respaldo», con «el automático no corrió en 3 h» en lugar del tamaño; dentro de ⚙️ Sistema. Capturas `panel-v1.1.118-{claro|oscuro}-1d-log-filas` (viewport alto, sin página completa: la regla nueva de captura).
- **B · `[VER-MAS]` + saltos + `[SET-UNICO-CENTRADO]`** (rama `fix-ver-mas`, SW **v1.1.119**, merge ff `35774b5..984e940`):
  - Sin scroll infinito (decisión 67): bajando hasta el final ya no se cargan cards (20 de 146) y el pie aparece; «Ver más» suma 15 y actualiza el contador.
  - Saltos: el `scroll-padding-top` del `html` (76 / 240) se sumaba al `scroll-margin-top` de cada sección; pasó a `.product-card` / `.catalog-grid`, y el buscador lo lee de la card. **Hallazgo:** en el celu la barra de filtros (`#catalogo`) es hija del `body` y sigue pegada hasta el pie, así que debajo del catálogo lo pegado mide 236,8 → esas secciones frenan en 243 (→ `[FILTROS-STICKY-PIE]`). Y un link con ancla al cargar se re-apunta mientras la página se asienta (8 s, `ResizeObserver`, salvo que la persona toque), midiendo la posición natural del destino aunque sea sticky. **Resultado:** 10 destinos × menú y URL × 390 y 1280 × claro y oscuro = 80 mediciones, todas entre 5,5 y 8,2 px debajo de lo pegado (en `main`: 248 o ~9.000 en el celu). El salto del buscador sigue 2,8 px debajo de los filtros a 390.
  - Decisión 73 (`_m`): `scrollToPerfume` muestra las cards hasta la buscada: saltar a la card 100 deja 100 de 146 y el pie se alcanza.
  - Decisión 63: un solo set centrado en el celu (`:only-child` con margen auto; 29 px de cada lado a 390); con varios, el primero en 0; a 1280, idéntico a `main`.
  - Capturas `catalogo-v1.1.119-{claro|oscuro}-9-ver-mas` y `-3b-set-uno`.
- **C · `[JUEGOS-VENTANA]`** (rama `feat-juegos-ventana`, SW **v1.1.120**, merge ff `984e940..cb65ebb`):
  - «Jugar», «🎮 Juegos ST» y cualquier link a `#quizSection` abren una ventana desde abajo (94 % del alto a 390, manija y «deslizá para cerrar» del detalle, × de 44 × 44, pestañas de 176,5 × 44). Fondo: la misma regla del detalle. Escritorio: centrada, `min(1040px, 94vw)`, los dos juegos lado a lado (487 px cada uno). `z-index` 9995, abajo del detalle (10000); el login (2000) sube a 10005 sólo mientras la ventana está abierta.
  - `#quizBox` y el Desafío se **mudaron** con sus IDs (1 `#quizBox`, 0 `#quizSection` en la página); la sección se fue con su comentario viejo.
  - Decisión 72 (`_m`, reemplazó la viñeta «Historial» del `_l`): «Ver el perfume →» (quiz) y «🔍 Ver el perfume» (Desafío, decisión 71) abren el detalle **encima**; su entrada de historial va después de la de la ventana. Verificado quiz y Desafío × atrás / × / deslizar / tocar afuera: se vuelve a la ventana con los 3 resultados o la carta, y otro «atrás» deja la página en el mismo scroll. `closeBottomSheet` y su `popstate` ya no le devuelven el scroll a la página con la ventana abierta.
  - Decisión 65: abre al cargar `/#quizSection` (el ancla se limpia), en `hashchange`, desde un trust badge (dos veces seguidas) y al tocar un link con el hash ya puesto.
  - Capturas `catalogo-v1.1.120-{claro|oscuro}-10-juegos-quiz`, `-10b-juegos-desafio`, `-10c-juegos-invitado` (el login encima), `-10d-juegos-1280`, `-10e-juegos-detalle-encima` y `-10f-juegos-detalle-encima-1280`.

#### Decisiones

- **Claude Code:** el re-apuntado del ancla al cargar y las secciones de debajo del catálogo en 243 (sin ellos el 0-12 del pedido no se cumplía); la guarda en `scrollToPerfume` (con la ventana abierta abre el detalle en vez de mover la página: pasa desde «Similares»); en el celu, adentro de la ventana, el quiz y el Desafío sin marco propio (la ventana es la card, como en la maqueta del DISEÑADOR); ancho de escritorio `min(1040px, 94vw)`.
- **Lo que no se hizo:** el contraste de la ventana se midió en el DOM (2 fallas heredadas → `[JUEGOS-VENTANA-PULIDO]`). Después del cierre, con el OK de Alejo, `scripts/contraste.js` sumó la ventana (`12f076c`: 10 filas × 2 temas, rgba compuesto sobre el fondo real): 0 fallas + 3 conocidas, 82 mediciones.

#### Keywords cerrados

| Keyword | Qué | Commits / cómo |
|---|---|---|
| `[DECANTS-DEFAULTS]` | Los precios de respaldo de la escalera = los de la base | tanda A · bump `35774b5` |
| `[LOG-NOMBRE-CORTADO]` | El nombre del Log nunca se achica | tanda A |
| `[LOG-LABEL-FALLBACK]` | 🛟 «Backup de respaldo» | tanda A |
| `[VER-MAS]` | Sin scroll infinito; los saltos llegan | tanda B · bump `984e940` |
| `[SET-UNICO-CENTRADO]` | Un solo set centrado en el celu | tanda B |
| `[JUEGOS-VENTANA]` | «Jugar» abre una ventana | tanda C · bump `cb65ebb` |
| `[JUGAR-NO-LLEGA]` | «Jugar» llegaba al medio del catálogo | lo cierran B y C |

### Sesión 24-sep-2026 · `_n` + `_o` · **la tanda de claro (D → G) + la parte H**

Prompt `_n` del PREPARADOR (D, E, F y G, cada una en su rama, con su bump y su merge; el DISEÑADOR confirmó la tabla entera) y, mientras se trabajaba, el `_o` (parte H, después de la G: una rama y un bump). Workflow multi-agente: no hizo falta. Todo medido en el DOM con fixture (catálogo a 390 y 1280, panel a 600) y con `npm run contraste`; en producción, sólo `SELECT` y `curl`.

#### Qué se hizo

- **D · `[AMARILLO-TINTA-CLARO]` + `[ACTION-BTN-BASE]`** (rama `claro-tinta`, SW **v1.1.121**, merge ff `2def710..569b73f`):
  - Token `--amarillo-tinta` en las dos apps: oscuro `#E8B800` (= `--amarillo`), claro `#6b5500` (decisión 66, corrige la 48). En el panel reemplaza a `--stat-tinta`; los 85 `color: var(--amarillo)` pasan al token menos «Cuadro #N» (vista previa de Badges, sobre `#0d0d0d`) y el ▶ del video (sobre `#000`); además `.stat-value`, `.log-dia`, `.client-count`, `.sidebar-hamburger` y el badge «Jefe», que pinta `applyRolePermissions` por JS (no estaba en la cuenta de 85: 1,55 → 5,9). En el catálogo, los `#8a6d00` de texto (incluidos los de `[ESPERA-CLARO]` y el título del quiz); «Foto próximamente» sin la `opacity` en claro.
  - Tablas C corridas de nuevo: panel en claro, los textos del token entre **5,90 y 7,18**; catálogo en claro, **31 textos (230 apariciones) entre 4,97 y 7,18**. Oscuro: catálogo **0 cambios en 3732** elementos; panel, sólo los 22 de la base de los botones. Ningún `!important` nuevo (los que cambian ya lo tenían).
  - `.action-btn` sin modificador = la base de `.log-chip` con radio `--r-md`; 18 estilos inline pasan a clases (`btn-etq-*`, `btn-principal`, `btn-whatsapp`, `btn-gris`, `btn-reavisar`, `btn-quitar-espera`, `btn-modo-sumar/restar` con `.activo`); los filtros del Doctor son `.log-chip`. Los 10 sin estilo: **44 px y 17,36 / 17,4**. `medir_targets`: de 37 cortos a **27** (de 602). Las filas de Backups pasan de 47,2 a 65 px por el 📥 JSON de 44.
  - Hallazgo: en el catálogo en claro quedan 26 textos en `#E8B800` (no `#8a6d00`) sobre fondos claros, 1,24-1,97 → `[AMARILLO-CATALOGO-CLARO]`.
- **E · `[JERARQUIA-CARD]` + `[TAP-44]`** (rama `claro-card`, SW **v1.1.122**, merge ff `569b73f..ad16ea5`): réplica v2 del DISEÑADOR («Jerarquía de la card»).
  - Sale «ST PERFUMERÍA» de la card (`app.js`) y del detalle (`index.html`), con su CSS. En el celu, bajo `.card-info`: nombre **28,8** · marca **14,4** (`.14em`) · precio **26,9** · etiquetas **11,5** · cuotas **13,8** (chip 10,6) · efectivo y Hot Sale **16,3**. A 1280, tamaños y alturas iguales a `main` (lo único distinto: la marca ST y los colores decididos).
  - Precio en oscuro `#E8B800` (`--tinta-precio`, decisión 51): 9,35. Botón de espera: 🔔 y 🔒 en la tinta (claro 1,86 → 7,18); ✓ en `--tinta-efectivo` (oscuro 4,99 · claro 6,73). En el celu, 44 en los tres estados (33,6) y «Consultar» 44 (32/29).
  - Hot Sale en claro: `body:not(.dark-mode) .price-cash.price-cash--hotsale` le gana por especificidad a `.price-cash` (#1b5e20 !important) sin `!important` nuevo: `#c2410c`, franja al 6 % (4,76). En el detalle queda de un solo color, pero sobre el crema del detalle da 4,17 → `[HOTSALE-DETALLE-CLARO]`.
  - `contraste.js`: sección «card» (🔔, ✓, Hot Sale, «Consultar», Hot Sale del detalle) y sale la conocida de `.card-brand-st`.
- **F · `[CLARO-CATALOGO-2]`** (rama `claro-catalogo-2`, SW **v1.1.123**, merge ff `ad16ea5..0b250ff`): «Cerrado» flotante (`.wa-status--closed`) con fondo `#b8342a` opaco, letra blanca .7rem y punto blanco: **3,23 → 5,89** · `.cat-count` `#2a2622`: **3,81 → 11,62** (había dos reglas iguales con `!important`: queda una) · «Ver catálogo» en el celu, en claro, con la píldora de `[LIGHT-CTA-POP]` sin pulso: **1,12 → 12,38** (sólo el banner «Explorá»; el «Consultar» de decants y «Jugar» no entran). Oscuro: **0 cambios en 3584**.
- **G · `[PANEL-CLARO-CAJAS]`** (rama `claro-panel-cajas`, SW **v1.1.124**, merge ff `0b250ff..bd664b9`): las cajas y cabeceras con fondo inline `#1a1a1a` / `#1a1a1c` pasan a `.caja-dorada`, `.cabecera-caja` y `.cabecera-caja-c` (en claro, superficie y borde del tema): Backups **1,0 → 7,18**, Puntos **3,26 → 5,33**, cabeceras de Analytics **1,0 → 5,33**; sus títulos `#E8B800` y los puntos del ranking a `.tinta-dorada`. El efectivo de Precios a `.td-efectivo`: **2,1 → 7,87** en claro. La sombra del menú lateral sólo con `body.sidebar-open`. Oscuro: **0 cambios en 2667**. «Pedidos pass» no estaba en la lista y sigue en 1,0 → `[PEDIDOS-PASS-CLARO]`.
- **H · `_o`** (rama `claro-h`, SW **v1.1.125**, merge ff `bd664b9..022f26a`):
  - **`[FILTROS-SOLO-CATALOGO]`** (decisión 76; era `[FILTROS-STICKY-PIE]`): `.catalogo-scope` (sin estilos) envuelve la barra, el anuncio y la sección del catálogo, así el sticky termina con la sección. A 390, en los dos temas: pegado **236,8** en el catálogo y en «Ver más», **97** en sets, nosotros, FAQ, mapa y pie (antes 236,8 en todos). La barra se va 64 px después de «Ver más» (el padding de la sección; al invitado, además, la caja «Creá tu cuenta»). Las secciones de abajo vuelven a 105.
  - **`[CARD-ESCRITORIO-BANNER]`** (decisión 78): card y grilla a **115** (1280) y **243** (celu). El buscador deja la card **6** (1280) y **5,8** (390) debajo de lo pegado; antes −33 y 2,8.
  - **`[JUEGOS-VENTANA-PULIDO]`** (decisión 77): «deslizá para cerrar» en `--gris` (oscuro 3,19 → 5,33, también el detalle) y la flecha con `currentColor` (en claro era blanca al 40 %: 1,15 → 6,29); puntos del quiz: anillo `--gris` de 1,5 px (Chromium lo dibuja de 1 px) y el hecho en el dorado de cada tema (claro 1,02 / 1,62 → 6,29 / 6,25); opciones del quiz **42,6 → 52** y candado **35,2 / 49 → 52**; en oscuro el candado es la caja punteada de claro (9,26). `contraste.js`: los puntos medidos y la ventana sin conocidas.
  - Los 80 saltos de B: 68 medidos (12 no tienen link en el menú), **entre 5,6 y 8,4** (los que pasaron de 243 a 105 caen 7,5-8,4: 105 − 97 = 8 más el sub-píxel).
  - **`[INVENTARIO-ARCHIVOS]`** (decisión 75, sólo lectura): fuera del repo, `_correo_agentes\ST_Perfumeria\inventario\archivos-sueltos-2026-09-24.md`. `mockups.html`, `mockup-zapato.html`, `mockup-catalogo-issues.html` y `convertir-webp.js` **se sirven (200)**; 251 imágenes (1,3 MB) no las nombra ni el código ni la base. No se borró nada en el relevamiento. **Decidido por Alejo el mismo día** (`3d92262`, sin bump): se borraron `mockup-zapato.html`, `mockup-catalogo-issues.html` y `convertir-webp.js` (de marzo: `sharp` ni estaba instalado, las fotos nuevas van a Storage y borraba los originales; salen también `npm run webp` y `sharp` de `package.json`); `mockups.html` se queda en el repo y sale del dominio (`.vercelignore`); `guia.html` y las 251 fotos se quedan (→ `[GUIA-DESACTUALIZADA]`). Las 6 ramas mergeadas se borraron.

#### Decisiones

- **Claude Code:** F se aplicó a la píldora flotante (`.wa-status--closed`): el `_n` nombraba `.store-status.closed` y su L8413, pero sus números (hoy .62rem, fondo propio y opaco, «sobre cualquier fondo»), la captura 6 y `[CLARO-CATALOGO-2]` eran de la flotante; la del hero quedó igual → `[CERRADO-HERO]`. En D entró el badge «Jefe» (el 86.º, por JS) y en G los puntos del ranking (`#E8B800` inline dentro de las cajas de Puntos). Los 44 de la card, sólo en el celu (el `_n` pedía 1280 igual que hoy).
- **Oregon:** recortadas las menciones de la organización y de lo que hay expuesto (L1530-1536, el cierre del 12-ago, su resumen, «Salieron de la lista» y § Resueltos, y el contexto del 12-ago en `CLAUDE.md`) con la regla del 23-sep. La historia de git conserva la versión anterior.

#### Keywords cerrados

| Keyword | Qué | Commits / cómo |
|---|---|---|
| `[AMARILLO-TINTA-CLARO]` | Un solo dorado de texto en claro (`#6b5500`) | tanda D · `4ac023b` + bump `569b73f` |
| `[ACTION-BTN-BASE]` | La base de los botones del panel | tanda D |
| `[JERARQUIA-CARD]` | La card sin marca ST, al 120 % en el celu | tanda E · `ad16ea5` |
| `[TAP-44]` (catálogo) | Botón de espera y «Consultar» a 44 | tanda E; la tanda 2 del panel sigue abierta |
| `[CLARO-CATALOGO-2]` | «Cerrado», contador de categorías y «Ver catálogo» | tanda F · `0b250ff` |
| `[PANEL-CLARO-CAJAS]` | Ninguna caja oscura en claro, efectivo, sombra del menú | tanda G · `bd664b9` |
| `[FILTROS-SOLO-CATALOGO]` (ex `[FILTROS-STICKY-PIE]`) | La barra se pega sólo en el catálogo | parte H · `022f26a` |
| `[CARD-ESCRITORIO-BANNER]` | La card frena 6 px debajo de lo pegado | parte H |
| `[JUEGOS-VENTANA-PULIDO]` | La ventana de juegos legible y a 52 | parte H |
| `[INVENTARIO-ARCHIVOS]` | Archivos sueltos: 3 borrados, `mockups.html` fuera del dominio | decisión de Alejo · `3d92262` |

---

### Sesión 24-sep-2026 (tarde) · `_q` · **la parte I**

Prompt `_q` del PREPARADOR (reemplazó al `_p`, que no se había arrancado): las decisiones 79-85 del DISEÑADOR, el horario de las dos píldoras y el ref de Oregon. Una rama (`fix-i`), un bump (SW **v1.1.126**), merge ff `59da156..2824efb`. Medido con fixture y datos inventados; en producción, sólo `curl`.

#### Qué se hizo

- **`[AMARILLO-CATALOGO-CLARO]`** (79) — las 11 reglas de los 26 textos (cursiva del hero, «Comodoro.» y Nosotros, ◆ y precio de sets, «Ver perfumes →», links y ● de Nosotros, carrito, «OCASIÓN») a `var(--amarillo-tinta)`. En claro: 0 textos `#E8B800` sobre fondo claro (eran 24 / 43 apariciones con el fixture del día), mínimo **4,80** («identidad.» sobre el degradé del hero; el PREPARADOR había medido 5,87 sobre `#f1e8ce`, otro punto del mismo degradé). Oscuro: 0 cambios.
- **`[HOTSALE-CLARO]`** (80) — un solo naranja `#9a3412` en claro (texto, borde y franja al 6 %): card **6,64** · detalle **5,81** (con `#c2410c` el detalle daba 4,17). Salió de las conocidas de `contraste.js`.
- **`[CERRADO-HERO]`** (81) — `.store-status.closed`: letra y punto, claro `#b8342a` (3,82 → **5,89**) y oscuro `#ff6b6b` (4,47 → **6,15**). Es el único cambio del oscuro de toda la parte.
- **`[PEDIDOS-PASS-CLARO]`** (82) — `.caja-pedido` (claro: superficie y borde del tema, 1,0 → **17,4**), `.no-registrado` (claro `#9a3412`: **7,31**), «Verificá su identidad…» a `.aviso-verificar` (era `#f1c40f`, no `#E8B800`: 1,69 → **7,18** en claro; oscuro igual) y «Pedido: …», «Cargando…» y «No hay pedidos» en `--gris` (3,54 → 5,33). Oscuro: 0 cambios en 2677.
- **`[SALTO-CARD-CENTRO]`** (83) — `'start'` en el celu y `'center'` en escritorio. Con eso solo la card 100 seguía en −6,3: el navegador fija el destino al arrancar y, mientras baja, las cards que se van mostrando cambian de alto (12-13 px; con `'center'` pasaba lo mismo: +10,5 antes de E, −5 después). Se suma un re-apuntado sin animación cuando el scroll se queda quieto, salvo que la persona haya tocado: **5,7** debajo de la barra a 390; a 1280, centrada.
- **`[ANILLO-1PX]`** (84) — el anillo de `.quiz-dot` en `1px`.
- **`[EFECTIVO-UN-RENGLON]`** (85) — «$134.100 efectivo/transf.» en la card y el detalle: **un renglón** en las 19 cards a 390 y 360 (208 px de 288 / 258); antes, dos. El Hot Sale y el carrito no cambian.
- **`[HORARIO-DOS-FUENTES]`** (del PREPARADOR) — `calcularEstadoHorario` (HORARIOS con el ajuste del panel + feriados + cierres especiales) y dos que escriben; se fue `checkStoreStatus`. Con reloj fijo y feriados inventados, 7 casos: domingo, sábado 16:00, feriado, horario ajustado (los 4 del prompt), domingo antes de un feriado, ajustado abierto y cierre especial. **Las dos dicen el mismo día y la misma hora en los 7.** En `main` la flotante se equivocaba en 4 (decía «Abierto» el sábado a las 16, el feriado y con el horario ajustado) y las dos decían «lunes» cuando el lunes era feriado. Textos como antes (la flotante dice «mañana» salvo cuando abre el lunes); lo nuevo es el feriado en la flotante («Hoy feriado · …», como el hero).
  - **La captura del DISEÑADOR (F, 24-sep 00:32):** el hero decía «abrimos HOY a las 10hs» porque eran las 00:32 del jueves; el «LUNES 10hs» de la flotante lo escribió el script de la captura (`setup-d-pildora.js` fuerza ese texto para mostrar «Cerrado»), no el código. La diferencia de fuentes era real igual.
- **Oregon (I9)** — el ref del proyecto sale de las **9** líneas de docs (HISTORIA ×5, BACKEND ×2, DATABASE, SECURITY): queda «ver `[S4-OREGON]` (detalle fuera del repo)». Sigue en 3 archivos de `RECOMENDACIONES_CLAUDECHAT/` (fuera de la lista del prompt; no se tocaron).
- **Capturas** (`capturas-espera\`, claro y oscuro): `catalogo-v1.1.126-{tema}-5-set`, `-11-hub`, `-12-nosotros`, `-1-grilla`, `-1-grilla-360`, `-4-detalle`, `-13-card100-390`, `-14-horario-{1-domingo, 2-sabado-tras-cierre, 3-feriado, 4-horario-ajustado, 3b-domingo-antes-de-feriado, 4b-ajustado-abierto, 5-cierre-especial}` y `panel-v1.1.126-{tema}-8-pedidos-pass`.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[AMARILLO-CATALOGO-CLARO]` | Los dorados que quedaban en claro | decisión 79 · `7b49c6f` + bump `2824efb` |
| `[HOTSALE-CLARO]` (ex `[HOTSALE-DETALLE-CLARO]`) | Un solo naranja en claro | decisión 80 |
| `[CERRADO-HERO]` | «Cerrado» del hero legible | decisión 81 |
| `[PEDIDOS-PASS-CLARO]` | Pedidos pass en claro | decisión 82 |
| `[SALTO-CARD-CENTRO]` | La card 100 a la vista | decisión 83 |
| `[ANILLO-1PX]` | El código dice lo que se ve | decisión 84 |
| `[EFECTIVO-UN-RENGLON]` | El efectivo en un renglón | decisión 85 |
| `[HORARIO-DOS-FUENTES]` | Las dos píldoras, una cuenta | del PREPARADOR |

---

### Sesión 24-sep-2026 (noche) · `_r` · **la barra de abajo del celu (J)**

Prompt `_r` del PREPARADOR: la parte I verificada y J, la barra de abajo del celu (referencia: «Barra inferior del catálogo» v4 del DISEÑADOR, decisiones 61, 62, 68 y 86-93). Una rama (`feat-barra`), un bump (SW **v1.1.127**), merge ff `7476e07..bc40472`. Stat: `index.html`, `css/styles.css`, `js/app.js`, `scripts/contraste.js` y `sw.js` (`extras.js` no se tocó). Medido con fixture y datos inventados; en producción, sólo `curl`.

#### Qué se hizo

- **J1 · la barra** — `#barraCelu`, sólo a < 768: `#0b0b0d` en los dos temas, borde `rgba(232,184,0,.18)`, 60 px + safe-area, `z-index: 9990`. Cinco botones de **78 × 60** a 390 (`medir_targets` los mide de 75 por la barra de scroll del headless), SVG de línea de 22 px con trazo 1,8. Etiquetas 11,5 px / 600 / `.04em`: `#bbbbbb` **10,24**, la activa `#E8B800` **10,57**; «CATÁLOGO» mide **66,7** de 78 y entra sin achicar. Números `#b8342a` con blanco, **5,89**, de los mismos contadores que las flotantes. Es un `<div role="navigation">`: la regla `nav { … }` de `styles.css` le pondría el alto y el fondo del nav de arriba.
- **J2 · qué hace cada uno** — **Catálogo:** va a `#catalogo` (los filtros quedan en 105); si ya estás en el catálogo (`.catalogo-scope` arriba de 110 y ocupando más de media pantalla), vuelve a `scrollY` 0. **Buscar:** `focus({ preventScroll: true })` y después el scroll suave; `document.activeElement === searchInput` en el mismo toque y 1,8 s después, con los filtros en 105. **Decants:** `openDecantBuilder()`. **Carrito:** `openCartPanel()`. **Cuenta:** sin sesión, `openAuth()`; con sesión, la hoja «Hola, <nombre>» (`textContent`) con tres filas de 48 (♥ Mis favoritos con el número, 🌙 Cambiar tema, Cerrar sesión: **16,17** y **6,80**). Se cierra tocando afuera y con «atrás» (`pushState` + `popstate`, como la ventana de juegos). Cambiar tema deja la hoja abierta; favoritos la cierra y filtra.
  - **El doble `openDecantBuilder`** no son dos versiones: el de `app.js` es el stub de `[JS-CHUNK]` (carga `extras.js` y llama a la real) y `extras.js` define la real y reemplaza `window.openDecantBuilder`. El stub corre sólo si se toca antes de que llegue el chunk. Quedan las dos.
- **J3 · lo que se abre encima** — con el login (2000), el menú (200/199) y el armador, la barra se esconde (`body:has(…) .barra-celu { display: none }`): no cambia el orden de hoy entre esas capas. El carrito, los juegos y el detalle ya estaban arriba: la barra queda bajo el velo y no se puede tocar. La hoja de Cuenta va en 9993.
- **J4 · los flotantes** — las 5 reglas. Invitaciones arriba (top 66 + safe-area) **y de a una**: con las dos a la vez se pisaban 358 × 55, así que la de instalar espera a que se vaya la de notificaciones. Comparar se apoya sobre la barra, y WhatsApp y el estado suben 49 mientras está. `.cart-float`, `.decant-float`, `.scroll-top` y `.dark-float` fuera del celu. Con todo prendido a 390, se ven 5 (barra, WhatsApp, estado, comparar, notificaciones) y **0 pares pisados**. El pie termina en 783,7 y la barra empieza en 784; el © queda 24,3 px arriba de la barra.
  - El `padding-bottom` va en `html body`: el CSS crítico inline de `index.html` (`html, body { padding: 0 }`) va después de `styles.css` y con `body` a secas ganaba por orden (medía 0).
- **J5 · safe-area** — `viewport-fit=cover` en `index.html` L6, la barra con `env(safe-area-inset-bottom)` y los costados, `html body` con los insets de los costados y el nav de escritorio con `max(2rem, env(…))`. **Acá no hay WebKit: falta probarlo en un iPhone** (vertical, horizontal y la app instalada; lo prueba Alejo). → **Alejo lo probó el 24-sep: todo bien** (también el teclado de Buscar). En Chromium los `env()` valen 0 y todo mide como antes.
- **1280** — geometría y `scrollHeight` idénticos a `main`.
- **`contraste.js`** — sección nueva de la barra (etiquetas, números y la hoja): 0 fallas + 1 token pisado, 148 mediciones.
- **Oregon (I9 del `_q`)** — el ref sale de los 3 archivos de `RECOMENDACIONES_CLAUDECHAT/` (17 apariciones: Plan B ×14, el prompt de S1 ×2, el prompt general ×1); en comandos y URLs queda `<ref: ver [S4-OREGON], detalle fuera del repo>`. `git grep` del ref: 0.
- **Capturas** (`capturas-espera\`, claro y oscuro, 390 × 844 con fixture): `catalogo-v1.1.127-{tema}-20-barra`, `-21-numeros`, `-22-comparando`, `-23-invitacion`, `-24-hola`, `-25-login`, `-26-menu`, `-27-armador`, `-28-final` y `-29-1280`.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[BARRA-CELU]` | La barra de abajo del celu | decisiones 61, 62, 68 y 86-93 · `12dd1cf` + bump `bc40472` |

**Pendientes nuevos:** `[NAV-REPITE-BARRA]` 🟢 (del DISEÑADOR, para después) · `[RELOAD-CON-LOGIN]` 🟢 (propuesta de Claude Code).

---

### Sesión 24-sep-2026 · `_s` + `_t` · **partes K y L**

Prompts `_s` (**K**: decisiones 94-96 del DISEÑADOR —«la letra la decide el fondo, no el tema»— y `[RELOAD-CON-LOGIN]`) y `_t` (**L**: decisiones 97 y 98 de Alejo). El DISEÑADOR llamaba «J» a la K: J ya era la barra. Dos ramas, dos bumps: **K** (`claro-k`, SW **v1.1.128**, merge ff `0e3ec75..cfa4717`, stat `admin.html`, `css/styles.css`, `js/app.js`, `scripts/contraste.js`, `sw.js`) y **L** (`celu-l`, SW **v1.1.129**, merge ff `cfa4717..f976a64`, stat `css/styles.css` y `sw.js`). Medido con fixture, reloj fijo y datos inventados; en producción, sólo `curl`.

#### K · qué se hizo

- **`[BOTONES-CONTRASTE]`** (94) — `.btn-whatsapp` letra `#1a1a1a` (8,78) y `.btn-gris` `#fff` (7,46) en los dos temas; sale la línea `body.light` que les ponía `#1a1a1a` a todos. Antes: WhatsApp 1,98 en oscuro, «✖ Descartar» 2,33 en claro. Ningún fondo cambia.
- **`[CINTA-TINTA]`** (95) — la cinta de la card (`buildCard`, `app.js`): la letra es `#fff` o `#000`, la que dé más contraste con el color (`letraSobre`, por luminancia: sirve para cualquier color nuevo), y sale el `text-shadow`. Con los 7 colores del panel: NUEVO 9,99 · PERFUME DEL MES 11,29 · MÁS VENDIDO 7,37 · ÚLTIMAS 5,50 · RECOMENDADO 6,66 (negra) · EXCLUSIVO 5,87 · **EDICIÓN LIMITADA 5,44** (blanca); con los dos de la base que no son del panel (`#ff3a30` y `#b51a00`, los «HOT SALE🔥»), 5,90 y 6,75. Antes, blanca siempre: 1,86 a 5,87.
  - **El texto y el color entraban al HTML sin escapar.** Con datos inventados en el fixture, en `main` un texto con `<img onerror>` y un color que cerraba el atributo corrían código; en la rama, el texto se ve escrito tal cual y el color cae al dorado. Ahora: `escapeHTML(p.etiqueta)` y `colorCinta` (sólo `#rgb`, `#rrggbb` o `rgb()` válido).
  - **Los 7 botones de etiqueta del panel**, fijos por clase y en los dos temas: negra en nuevo, mes, vendido, últimas y recomendado; blanca en exclusivo y limitada (mínimo 5,44; antes 2,97 en claro y 2,10 en oscuro). **La vista previa de Editar** usa la misma cuenta (`letraSobreColor`) y pinta por `style.*`: escrita en el atributo, el parche `body.light [style*="color:#fff"]` la pasaba a `#1a1a1a`.
- **`[ESTADO-LOCAL]`** (96) — el hero en claro (letra y punto sobre el `#fff` de mayo): abierto `#1b5e20` (2,10 → **7,87**), feriado la tinta `#6b5500` (1,66 → **7,18**); en oscuro, igual que antes. La flotante, **opaca en los tres estados y los dos temas**, letra y punto blancos a `.7rem`: abierto `#1b5e20` (7,87) · cerrado `#b8342a` (5,89) · feriado `#6b5500` (7,18). En `main`, sobre el banner violeta del juego en oscuro, daba 2,35 cerrado, 3,28 abierto y 3,38 feriado; en claro, «Abierto» 1,28 sobre la página. En feriado la flotante dice **«Feriado · abrimos mañana 10hs»** (o el día: «abrimos martes 10hs» si el lunes también es feriado), con `proximaApertura`, la misma cuenta que «Cerrado» (NO ROMPER #14); el nombre del feriado queda en el hero. En `main` decía «Hoy feriado · Día del Respeto a la Diversidad Cultural»: 303,8 px a 390, se salía por la izquierda; ahora 211,7. Un cierre especial sigue mostrando su motivo. Con reloj fijo, 5 casos × 2 temas: el hero en oscuro, idéntico a `main`.
- **`[RELOAD-CON-LOGIN]`** — `BUSY_MODAL_SELECTORS`: `.auth-overlay.open` (decía `.active`) + `.juegos-overlay.active` + `.waitlist-overlay.active`. Con cualquiera de las tres abierta, la lista da "ocupado" (medido con la lista leída del archivo).
  - **La medición destapó `[RELOAD-NUNCA]`:** con nada abierto la lista **también** da "ocupado", en `main` y en la rama. El único selector que coincide es `.compare-modal`, un elemento fijo de `index.html` (desde el 26-mar, antes de `[PWA-AUTO-RELOAD]`). La recarga automática del sitio no se dispara nunca. No se tocó: decide Alejo.
- **`contraste.js`** — 192 mediciones: los 9 botones del panel con la regla 19, las cintas (lee `colorCinta` y `letraSobre` de `app.js` y los colores de los `setEtiqueta` de `admin.html`, más un color inválido y un intento de romper el atributo: los dos caen al dorado) y los estados (hero y flotante, sobre la página, la card y las paradas del banner violeta). Sobre el `main` anterior, las filas nuevas dan **17 fallas**.
- **Foto de colores** (`main` contra la rama, 3593 elementos del catálogo y 2667 del panel por tema): el catálogo en oscuro cambia 1 (la flotante), en claro 0; el panel, 0 y 0. Lo demás que cambia (cintas, botones de etiqueta, Pedidos pass, estados) no está en ese fixture y lo miden las sondas.
- Con la píldora a `.7rem`, a 390 y 360 y en los dos temas: 0 flotantes pisados.

#### L · qué se hizo

- **`[FINAL-FLOTANTES]`** (97) — `html body { padding-bottom: calc(140px + env(safe-area-inset-bottom)) }` (barra 60 + 16 + WhatsApp 56 + 8). Al final de la página, el © termina **32,3 px** arriba del borde de arriba de WhatsApp a 390 y **31,5** a 360, en los dos temas (en `main`, WhatsApp lo tapaba 47,7), y 46,7 arriba de «Cerrado». El pie queda 80,3 px arriba de la barra.
  - Con «comparar» prendido, WhatsApp sube 49 y vuelve a tapar el ©: 16,7 px a 390 y 17,5 a 360 → `[FINAL-COMPARANDO]`.
- **`[INVITACION-BAJO-BANNER]`** (98) — `.push-banner` y `#pwaInstallBanner` en `top: calc(105px + env(safe-area-inset-top))` (nav 58 + banner 39 + 8): las dos en 105, con 8 px de aire bajo el banner (en `main`, 66: tapaban el texto del banner). Mientras están, tapan el buscador (aceptado).
- **1280** — geometría, `scrollHeight` y padding del body idénticos a `main` (la única diferencia es la opacidad de `.cart-float` a mitad de su animación).

- **Capturas** (`capturas-espera\`, claro y oscuro, fixture): `catalogo-v1.1.128-{tema}-30-estado-{abierto, cerrado, feriado}`, `-31-violeta-{abierto, cerrado, feriado}`, `-32-cintas`, `panel-v1.1.128-{tema}-9-pedidos-pass`, `-10-etiquetas`, y `catalogo-v1.1.129-{tema}-28-final` y `-23-invitacion`.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[BOTONES-CONTRASTE]` | WhatsApp y gris legibles en los dos temas | decisión 94 · `b80e8a3` + bump `cfa4717` |
| `[CINTA-TINTA]` | La letra de la cinta según su color, el texto escapado | decisión 95 |
| `[ESTADO-LOCAL]` | El hero en claro y la flotante opaca | decisión 96 |
| `[RELOAD-CON-LOGIN]` | El login, los juegos y «Avisame» cuentan como ocupado | del PREPARADOR |
| `[FINAL-FLOTANTES]` | El © arriba de WhatsApp | decisión 97 · `celu-l` + bump `f976a64` |
| `[INVITACION-BAJO-BANNER]` | Las invitaciones debajo del banner | decisión 98 |

**Pendientes nuevos:** `[RELOAD-NUNCA]` 🟡 (decide Alejo; **cerrado el mismo día sin código, decisión B**: ver § Resueltos) · `[FINAL-COMPARANDO]` 🟢 · `[QUITAR-ETIQUETA-CONTRASTE]` 🟢 (propuestas de Claude Code; las dos últimas, del DISEÑADOR).

---

### Sesión 24-sep-2026 · `_u` + `_v` · **parte M**

Prompts `_u` (**M**: decisiones 99-103 del DISEÑADOR y `[OVERRIDE-ML]` del PREPARADOR) y `_v` (**M6**, decisión de Alejo), en la misma rama (`celu-m`, desde `7f5fda5`) y un bump: SW **v1.1.130**, merge ff `7f5fda5..b9fc4e8`, stat `admin.html`, `css/styles.css`, `js/app.js`, `scripts/contraste.js`, `sw.js`. Medido con fixture; para M5 y M6, con las tablas públicas del catálogo leídas con GET (overrides, perfumes nuevos, decants de diseñador y el resumen de clicks) y la config de decants comprobada con SELECT (tope 170.000, escalera 9.500 / 9.000 / 8.500, igual que el código).

#### Qué se hizo

- **`[PILDORA-ANILLO]`** (99) — `.wa-status`: `box-shadow: 0 0 0 1.5px #fff, 0 2px 10px rgba(0,0,0,.4)`, los tres estados, los dos temas, todos los anchos. En oscuro, sobre el banner violeta: **6,30** (`#b71c5c`) · **9,39** (`#6a1b9a`) · **11,86** (`#4a148c`); el borde de la píldora daba 1,07-1,51. En claro, sobre el crema del banner, 1,15-1,25: no cuenta (ahí separa el fondo de la píldora, ≥ 5,89).
- **`[QUITAR-ETIQUETA-CONTRASTE]`** (100) — «✕ QUITAR» (`.btn-etq-quitar`): letra y borde `#ff8a80` sobre `#333`, **5,53** en los dos temas (era 3,31); ningún parche de claro la pisa (medido en el DOM).
- **`[FINAL-COMPARANDO]`** (101) — la reserva de abajo del celu pasa de `html body` al **`footer`**: `padding-bottom: calc(1.5rem + 140px + env(safe-area-inset-bottom))`, y `+189` con `body:has(.compare-bar.visible)`. En los 8 casos (con y sin comparar × 390 y 360 × dos temas) el © queda **31,5 a 32,3 px** arriba de WhatsApp (en `main`, con comparar, WhatsApp lo tapaba 16,7-17,5) y el pie llega al final del documento (en `main` sobraban ~140 px: la franja crema en claro).
- **`[ESTADO-MINUSCULA]`** (103) — minúscula después del «·» en `updateStatus` y `pintarWaStatus`: «Abierto · cierra en 5h», «Cerrado · abrimos lunes 10hs», «· ¡última hora!». En el hero el texto cambia pero no se ve: `.store-status` va en mayúsculas. «Hoy feriado · <nombre>» no se tocó; (102) el feriado largo en dos renglones queda así.
- **`[OVERRIDE-ML]`** — `applyOverrideToPerfume` copiaba todo menos `ml` (el panel sí lo aplica). Ahora `if (o.ml) p.ml = o.ml;`, que vale para el cache y para Supabase (las dos llamadas usan la misma función). **16 perfumes** cambian de ml (15 visibles + `cdn-milestone`, pausado): la card y el detalle muestran el del panel. **El único que cambia de estado en el armador es `cdn-precieux`** (100 → 55 ml: 125.000 cada 55 ml son 227.273 cada 100, pasa el tope y queda «a consultar»; hasta hoy se vendía en la escalera con un decant que costaba 11.364). Un pack guardado con `cdn-precieux` lo pierde al cargar (`khamrah` queda).
- **`[DECANT-SOLO-PERFUMES]`** (`_v`, decisión de Alejo) — `decantExcluido` devuelve `true` también cuando `detectProductType` devuelve algo: salen del armador `bare-vanilla`, `velvet-petals`, `coconut-passion`, `pure-seduction` (Body Splash) y `love-spell` (Body Spray). El armador pasa de **182 a 177 perfumes** (171 en la escalera y 6 «a consultar», con M5). Los 5 caen por el «Tipo de producto» del panel; **por el nombre, 0**; en la base no hay ningún tipo «Perfume» escrito (sólo vacío, nulo, «Body Splash» y «Body Spray»). `victoria-secret` tiene un override «Body Splash» pero no existe como perfume (ni en `perfumes.js` ni en `perfumes_nuevos`). Un pack guardado con `bare-vanilla` la pierde; la card del body splash sigue igual (etiqueta «Body Splash», se vende el frasco).
  - **El quick-pick** (el armador vacío, los 6 más vistos) usa el filtro de la lista (sin pausados, excluidos ni duplicados de diseñador), saca los «a consultar» (su único botón es «+ AGREGAR») y sigue sin los sin stock. Con los clicks reales muestra los mismos 6; con clicks forzados, en `main` salían un pausado (`khanjar`), un body splash (`velvet-petals`), uno «a consultar» (`le-beau-le-parfum`) y `cdn-precieux`, y en la rama ninguno. El nombre va con `escapeHTML` (en `main`, uno de mentira metía un `<img>`).
- **`contraste.js`** — el anillo (no es texto: mínimo 3, en oscuro, contra la página, la card y las paradas del violeta) y «✕ QUITAR»; la regla 19 de los botones compara la letra con su propio fondo (con el corte fijo en 0,5, el `#ff8a80` contaba como oscuro). 0 fallas + 1 token pisado, 195 mediciones.
- **Foto de colores** (`main` contra la rama): 0 cambios en el catálogo y el panel, en los dos temas (el anillo es sombra y la foto no la mide). **1280:** idéntico salvo el ancho de la flotante (192,5 → 190,8: la minúscula) y la opacidad de las flotantes a mitad de su animación.
- **Capturas** (`capturas-espera\`, claro y oscuro, fixture): `catalogo-v1.1.130-{tema}-31-violeta-{abierto, cerrado, feriado}`, `-28-final`, `-28-final-comparando`, `-33-precieux-card`, `-34-precieux-armador`, `-35-quickpick` y `panel-v1.1.130-{tema}-10-etiquetas`.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[PILDORA-ANILLO]` | El anillo de la flotante | decisión 99 · `5f92573` + bump `b9fc4e8` |
| `[QUITAR-ETIQUETA-CONTRASTE]` | «✕ QUITAR» legible | decisión 100 |
| `[FINAL-COMPARANDO]` | La reserva en el pie, también comparando | decisión 101 |
| (102) | El feriado largo en dos renglones | queda así |
| `[ESTADO-MINUSCULA]` | Minúscula después del «·» | decisión 103 |
| `[OVERRIDE-ML]` | El ml del override en el sitio | del PREPARADOR |
| `[DECANT-SOLO-PERFUMES]` | Lo que no es perfume, fuera de los decants | decisión de Alejo |

---

### Sesión 24-sep-2026 · `_w` + `_x` · **parte N: la promo de decants (`[PROMO-DECANTS]`, con la Sirenita)**

Prompt `_w` (decisiones 31 y 105-115 del DISEÑADOR, «La promo de decants» v4). Rama `promo-decants` desde `2a588ea`, un commit por parte y un bump (SW **v1.1.131**). **Toca plata: merge no pre-aprobado.** La rama se pusheó y esperó; el PREPARADOR leyó el diff entero y corrió `precioPackDecants` en Node con los datos reales (162 de 171 y los 8 casos exactos) y aprobó en el `_x`: fast-forward `2a588ea..b94e0f9`. Stat: `admin.html`, `index.html`, `css/styles.css`, `js/app.js`, `js/extras.js`, `sw.js`, `scripts/contraste.js`. Las tablas las creó Alejo con el SQL del PREPARADOR y se verificaron con SELECT (checks, políticas y grants tal cual; 0 filas). Todas las pruebas con fixture.

#### Qué se hizo

- **N1 · una sola regla y una sola cuenta** (`df1d671`) — `loadPromoDecants` lee las dos tablas al cargar (si falla, no hay promo); `promoVigente` mira `desde ≤ ahora < hasta` en el cliente cada vez y un reloj por minuto la termina sin recargar. `promoDecantEntra`: en la lista del armador (`decantEnListaArmador`: sin sets, ocultos, pausados, excluidos —que incluye lo que no es perfume— ni duplicados de diseñador), con escalera (sin precio manual ni «a consultar») y, salvo los cambiados a mano, frasco (100 ml) ≤ (precio_pack / n) × 20: **162 de 171** con 3 × 18.000. `precioPackDecants`: precio fijo aparte; escalera por la cantidad de escalera (con 3× y sin 3×); desde n, todas las 3× a min(escalera, precio_pack / n), con tope. Los 8 casos de la tabla, exactos y con la pantalla, el pie y el WhatsApp iguales: 27.000 · 27.000 · 36.000 · 44.500 · 24.000 · 18.000 + diseñador · 42.500 (la escalera es menor: sin rótulo) · apagada, vencida y programada = `main`. **`[DECANT-WA-TOTAL]`**: el WhatsApp no separaba los de precio manual y los cobraba con la escalera (con uno inventado: pantalla $31.000, WhatsApp $27.000; ahora los dos $31.000).
- **N2 · el armador** (`35eaa38`) — chip «3×» adelante del nombre (11,29; tres clases para ganarle a `body:not(.dark-mode) .decant-builder * { color: inherit }`); «Sumá 1 más con 3×» y «Máximo N packs de promo por pedido» en líneas propias del pie (`#decantLadder` no se ve en pantallas de hasta 900 px de alto); «1 decant»; **`[DECANT-TOPE-CONTADOR]`**: el número de la pestaña «Catálogo» usa el filtro de la lista (193 → 184); «Precio a consultar» #9a3412 en claro y sin opacidad (3,27 → 7,31; oscuro 6,45 → 9,03); nombre, marca, foto y alt escapados en `cardHTML`.
- **N3 · la etiqueta de la card** (`9ea992f`) — «🧪 3 decants por $18.000 · hasta el mar 29» y, en las últimas 24 h, «… · termina en 5h 12min» (cada minuto, sin segundos; desaparece sola). Máximo dos etiquetas: cinta → promo → «Último» → «Nuevo»; «Sin stock» y «Próximamente» tapan todas, también la cinta; si la cinta dice lo mismo que una automática, la automática no sale. Apiladas arriba del lado de la foto (en escritorio, en las `.mirror`, a la derecha); «Nuevo» deja de ir al lado del corazón. Con la promo apagada, las 186 cards tienen el mismo precio y el mismo texto que `main`; cambian sólo las etiquetas de la 111 (2 cintas y 6 «Nuevo» tapados por «Sin stock», 1 «Nuevo» que no entra con cinta + «Último»). **El ancho:** «termina en 23h 59min» mide 242,4 px: 25,3 px del corazón a 390, **−4,8 a 360** → `[PROMO-ANCHO-360]`.
- **N4 · el panel** (`8dca8be`) — en la pestaña Decants: el estado (apagada / programada / prendida / terminada, con los textos y colores de la 113: 4,90 a 9,33) y el interruptor; el aviso de costo; N, precio del pack («$X cada uno»; si no se divide justo entre N, no guarda y lo dice), máximo de packs; desde / hasta en hora argentina (no deja prenderla sin «hasta»); «entran solos: 162 de 171» con una copia SINCRO de la regla; el buscador para sumar, sacar o volver a automático (las dos cuentas); las filas a mano con su costo («PINNACE · sumado a mano · costo $6.250 · pierde $250»). a-d y la escalera, con candado para la empleada; nunca el error crudo de la base. Log: `promo_decants_update` y `promo_decants_perfume` con 🧪; la chip, 💰 Precios si cambia el precio o N. Los perfumes nuevos del panel traen `precio_decant` y `decant_excluido`, como el sitio.
- **N5 · controles** (`858bbd3`) — `contraste.js`: el chip, la etiqueta, el pie del armador, «Precio a consultar» y los estados del panel en los dos temas: 0 fallas + 1 token pisado, 217 mediciones.
- **Capturas** (`capturas-espera\`, claro y oscuro, fixture: 3 × 18.000, tope 2, Pinnace sumado, asad sacado): `catalogo-v1.1.131-{tema}-40-card-promo`, `-41-card-24h`, `-42-khadlaj`, `-43-sin-stock`, `-44-cinta-nuevo`, `-45-armador`, `-46-armador-suma1`, `-47-1280-mirror`, `panel-v1.1.131-{tema}-11-promo-{apagada, programada, prendida, terminada}`, `-12-promo-empleada`, `-13-escalera-empleada` y `whatsapp-8-casos-v1.1.131.txt`.
- **La promo no se prende hasta cerrar `[PROMO-ANCHO-360]`.** Después del deploy, `curl` como `anon` a las dos tablas: `[]`.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[PROMO-DECANTS]` (con `[SIRENITA]`) | La promo de decants: regla, cuenta, armador, card y panel | decisiones 31, 105-115 · `df1d671` … `b94e0f9` |
| `[DECANT-TOPE-CONTADOR]` | El número de la pestaña «Catálogo» = lo que muestra la lista | N2 |
| `[DECANT-WA-TOTAL]` | El WhatsApp con la misma cuenta que la pantalla | N1 |

**Pendientes nuevos:** `[PROMO-ANCHO-360]` 🟡 (espera al DISEÑADOR; bloquea prender la promo) · `[NUEVO-EN-111]` 🟢.

---

### Sesión 24-sep-2026 · `_y` · **N-bis: `[PROMO-ANCHO-360]` y el pie del armador**

Prompt `_y` (decisiones 117-120 del DISEÑADOR). Rama `promo-n-bis` desde `339405d`, un bump (SW **v1.1.132**), merge ff `339405d..b628fe1` (pre-aprobado: stat `admin.html`, `js/app.js`, `js/extras.js`, `scripts/contraste.js`, `sw.js`, y B1 con 8 px o más). Fixture; nada de filas en la base de producción.

#### Qué se hizo

- **B1 · `[PROMO-ANCHO-360]` sin reloj** (117, corrige la 112) — `textoEtiquetaPromo`: con más de 24 h, «… · hasta el mar 29»; en las últimas 24 h, «… · termina mañana» o «… · termina hoy» (el día de `hasta − 1 ms` contra el de hoy, en hora argentina, con `diaART`). Sin mayúsculas (118). Medido con los 7 días de la semana, «termina mañana» y «termina hoy», con 3 × $18.000 y con 10 × $90.000: el hueco con el corazón es **16,3 px o más a 360** (el peor, «🧪 10 decants por $90.000 · termina mañana», 221,3 px) y 46,3 a 390; todas en un renglón. Con el reloj era 0,8 / −4,8 a 360.
- **B2 · el pie del armador** (119) — «Sumá 2 más con 3× y cada uno te sale $6.000», sólo si `precio_pack / n` es menor que la escalera con los que tendría el pack al sumar los que faltan (con 3 × 27.000 no sale); «Máximo de la promo: los que sumes van a precio normal» sólo al llegar al tope (3× ≥ `max_packs × n`); «🧪 Promo 3×: 6 × $6.000» igual. Un renglón a 360; 9,33 sobre el pie en los dos temas.
- **B3** — el interruptor del panel dice «Apagada» o «Prendida» según esté (en «Terminó…», «Prendida»); el WhatsApp con uno solo, «un pack de 1 decant»; el buscador de «Quiénes entran», a lo ancho de la caja (el panel envuelve cada `.admin-search` en un `inline-flex` que se achicaba: 270 → 497 px).
- **`[COMPARE-PISA-NOMBRE]`** — a 1280, «Comparar» se cruza con el nombre en 108 de 186 cards (espejadas y normales), **igual en v1.1.130**: no lo trajo la N y no es una línea → pendiente 🟢.
- **Capturas** (`capturas-espera\`, 360, claro y oscuro): `catalogo-v1.1.132-{tema}-50-card-termina-manana`, `-51-card-termina-hoy`, `-52-peor-caso`, `-53-pie-aviso`, `-54-pie-tope` y `panel-v1.1.132-{tema}-14-promo-apagada`.
- `contraste.js`: 0 fallas + 1 token pisado, 219 mediciones.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[PROMO-ANCHO-360]` | La etiqueta de la promo sin reloj, a 8 px o más del corazón a 360 | decisiones 117-119 · `92a7a7b` + bump `b628fe1` |

**La promo ya se puede prender** (se cerró la condición de la parte N). **Pendiente nuevo:** `[COMPARE-PISA-NOMBRE]` 🟢.

---

### Sesión 26-sep-2026 · **`[VALOR-INV-DEPOSITO]`** (pedido urgente de Alejo)

Pedido directo de Alejo, antes de lo planificado: *"que se muestre VALOR TOTAL de inventario y aclarando cuánto corresponde al depósito y cuánto al stock del local, y únicamente para el admin del jefe"*. Rama `valor-inventario` desde `1266fcf`, un bump (SW **v1.1.133**), merge ff `1266fcf..f590ea8` (Alejo: *"si no necesitás nada más, mergeá"*).

#### Qué se hizo

- **La tarjeta 💰 de Precios & Stock** (la de `[OCULTAR-VALOR-INV]`, `data-role="jefe"`): arriba el total (local + depósito), compacto como antes (`$12,4M`) y exacto en el `title`; la etiqueta pasa a «Valor total de inventario»; debajo, «🏪 Local» y «📦 Depósito» con el monto exacto (`.stat-desglose`, colores por token: nombre `--gris-claro`, monto `--stat-tinta-inv`).
- **La cuenta** sale de `renderPrecios` a `pintarValorInventario()`: la misma que tenía el local (precio de venta: la promo si la hay; sin pausados ni sets), sumando `_stockDeposito` al mismo precio. La llaman `renderPrecios` y `renderDeposito` (guardar depósito sin «sumar al local» sólo repinta el Depósito).
- **Realtime:** `applyOverrideRowToMemory` y el resync traen también `stock_deposito`. Sin eso, si otra tablet pasaba 3 unidades del depósito al local, acá llegaba el +3 del local sin el −3 del depósito y el total contaba esas 3 dos veces hasta recargar.
- `contraste.js` mide el desglose: nombre 11,55 (oscuro) / 10,93 (claro), monto 8,82 / 7,73. 0 fallas, 223 mediciones.

#### Verificación

- **Fixture a mano** (7 overrides: uno con promo, un pausado con stock y depósito, uno sin local con depósito, un set, un perfume de `perfumes_nuevos`): total, local y depósito exactos contra la cuenta a mano, y después de 5 cambios seguidos (depósito sin sumar, con sumar, dos eventos de realtime —un pase depósito→local y un pausado— y `renderDeposito`), los 5 exactos. El pausado y el set no cuentan.
- **Datos reales** (sólo lectura, `SELECT`): la tarjeta y una cuenta hecha en Node por fuera del panel (seed + `perfumes_nuevos` + `perfume_overrides`) coinciden al peso. Los montos no van al repo (es público).
- **Layout:** 1280, 1024, 900, 800, 600, 480, 390 y 360, claro y oscuro: cada fila del desglose en un renglón, sin desborde ni scroll horizontal; la tarjeta mide 137,1 (las otras, 86,8: en 4 y en 2 columnas la fila se estira a 137,1). Empleada a 1280, 800 y 390: la tarjeta no se ve y la grilla sigue en 3 / 3 / 1 columnas.
- **Producción:** `sw.js` sirve v1.1.133 y `admin.html` tiene `pintarValorInventario`.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[VALOR-INV-DEPOSITO]` | Valor total de inventario (local + depósito) con el desglose, sólo el jefe | `f461ef3` + bump `f590ea8` |
| `[VALOR-INV-PAUSADOS]` | El valor cuenta los pausados y dice cuánto es de ellos | `5b3ff47` + bump `44ee1d7` |

#### Las respuestas de Alejo · `[VALOR-INV-PAUSADOS]` (SW v1.1.134)

Alejo contestó las dos preguntas del cierre: *"Cuenta todo perfume que tenga al menos 1 unidad en STOCK. De última aclará también, como aclarás cuánto corresponde del depósito, que X cantidad son de los pausados"* y *"así exactamente quiero que sea: el precio de lista"*. Rama `valor-inv-pausados` desde `953d6b1`, merge ff `953d6b1..44ee1d7`.

- `pintarValorInventario` ya no saltea los pausados (los sets siguen afuera: no están en esta pestaña) y suma aparte cuánto del total es de ellos (local + depósito).
- Tercera línea del desglose: «⏸️ Incluye pausados» con el monto en el gris del nombre, no en el verde de los sumandos, porque es una parte del total y no un tercer sumando (`contraste.js`: 11,55 / 10,93; 0 fallas, 225 mediciones).
- Las otras tarjetas (unidades, perfumes activos, sin stock) siguen sin contar los pausados.
- **Layout:** con los montos reales, a 901 y 950 px la línea de pausados no entraba y se salía de la tarjeta. Las filas del desglose ahora pueden partirse: si no entran, el monto baja al renglón de abajo, pegado a la derecha. Desde ~1000 px, y en 1 y 2 columnas, cada fila entra en un renglón; sin scroll horizontal en ningún ancho.
- **Verificación:** con el fixture, 6 de 6 exactos contra la cuenta a mano (el pausado ahora suma; al pausar uno por realtime, el total no cambia y sube la línea de pausados). Con los datos reales, la tarjeta y la cuenta de Node coinciden al peso otra vez.
- **Los sets quedan afuera** (decisión de Alejo, 26-sep: *"los sets que queden afuera; después, cuando tenga más tiempo, lo pienso con el diseñador"*). Sin cambio de código: ya estaban afuera.
- **Queda abierto:** el diseño de la tarjeta (el aire de las otras tres y el gris de pausados) → `[VALOR-INV-DISEÑO]` 🟢, para Alejo con el DISEÑADOR. El bloque para el PREPARADOR quedó armado con las dos tandas en uno y **lo manda Alejo más tarde** (salió de casa).

---

### Sesión 27-sep-2026 · **`[CRON-HEADER-FALSO]` + `[SECURITY-AUDIT-S1]`** (mientras Alejo repone las variables de Vercel)

Alejo arrancó `[VERCEL-ENV-VARS]` («hago eso mientras los otros laburan en lo suyo»). Antes de darle los pasos, dos hallazgos que cambiaban qué se podía cargar.

#### `[CRON-HEADER-FALSO]` · `4b50d52` (sin bump: `api/` no lo guarda el SW)

- `/api/cron/backup` aceptaba cualquier pedido con un header `x-vercel-cron-signature` o un user-agent con «vercel-cron». **Verificado en producción:** con `curl -A 'vercel-cron/1.0'` pasaba el control y frenaba recién por «SUPABASE_URL o SERVICE_KEY no configurados». Con la clave cargada, cualquiera podía disparar backups y, con 12 seguidos, borrar los de verdad (el cleanup deja 12).
- Ahora sólo `Authorization: Bearer <CRON_SECRET>`, que Vercel Cron manda cuando la variable existe (docs de Vercel, «Securing cron jobs»); sin `CRON_SECRET`, `401` a todo. Probado con el módulo real (7 casos: sólo el Bearer correcto pasa) y en producción (header y user-agent falsos → `401`). También se corrigió el comentario («cada 2 horas» → una vez por día, 03:00 UTC; los 12 backups cubren ~12 días).

#### `[SECURITY-AUDIT-S1]` · prompt `_a` del PREPARADOR (camino A de Alejo) · `49200b7` + bump `d7496fb` (SW v1.1.135)

- **El hallazgo:** el push se autorizaba con una constante escrita en `admin.html` (público). Con la variable `ADMIN_PASS` repuesta en Vercel con ese valor, cualquiera podía mandar push a todos. Por eso a Alejo se le indicó **no** cargar `ADMIN_PASS` ni `VAPID_*` hasta cerrar esto.
- **Qué cambió:** `admin.html` pierde la constante; `sendPushNotification()` manda el `access_token` de `sb.auth.getSession()` (sin sesión no llama al backend y muestra «❌ Error: No autorizado»). `/api/send-notification` valida el token contra Supabase Auth (`GET /auth/v1/user`, con la clave de servicio de apikey) y exige un email de `STAFF_EMAILS` (jefe y empleada, a propósito: la pestaña Notificaciones es de las dos). Falla cerrado. `ADMIN_PASS` ya no hace falta.
- **Un dato que corrigió el prompt:** `is_jefe()` mira sólo el email del jefe; los dos emails juntos están en las políticas `*_staff` (`perfume_overrides`, `combos`, `admin_actions`, Storage). El comentario de `STAFF_EMAILS` lo dice así.
- **Verificación:** 9 de 9 casos en Node con el módulo real (Auth y `web-push` simulados): jefe y empleada `200`; email ajeno, Auth `401`, error de red y respuesta sin email → `401`; sin `accessToken`, `null` o el campo viejo → `401` sin consultar a Auth. En el panel con fixture: sin sesión, 0 llamadas al backend; con sesión, el body tiene `title, body, url, accessToken` y no `adminPass`. La pestaña Notificaciones, idéntica a `main` (36 elementos, 0 diferencias a 390 y 1280, claro y oscuro). `git grep` de `ADMIN_PASS` / `adminPass` fuera de docs: 0.
- **Docs:** SECURITY.md § S1 resuelto, § S11 (el `401` ahora es «sin `accessToken` válido») y § S12 (sin `ADMIN_PASS`; `[CRON-HEADER-FALSO]`); BACKEND.md; `.claude/commands/security-scan.md` sin las dos líneas de las constantes que ya no existen (como en `db37b21`).
- **Merge:** el PREPARADOR lo revisó en GitHub y lo aprobó. El primer push a `main` lo frenó el sistema de permisos de la sesión de Claude Code («merge sin revisión»: iba junto con `[CRON-TRIGGER-AUTO]`, que él no había visto); no se subió nada. Alejo eligió mergear las dos (opción A): `main` fast-forward a `82f1f89` (idéntico a lo revisado) y encima `8eec233`. Después, con el OK de Alejo, se borraron las dos ramas de revisión en GitHub (`s1-sesion-push` y `cron-trigger-auto`: su contenido está en `main`) y las copias locales de la sesión; no queda ninguna rama remota sin mergear.
- **Visto al pasar, no tocado:** el anuncio que publica un push (`announcements`) sólo lo puede insertar el jefe (`jefe_insert_announcements`): si manda la empleada, el push sale y el anuncio falla en silencio (ya pasaba antes).

#### `[VERCEL-ENV-VARS]` · las variables y el primer backup del cron desde mayo

- **Qué cargó Alejo** (Vercel → Settings → Environment Variables, sólo Production): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (una secret key nueva de Supabase, sólo para Vercel, así se revoca sola) y `CRON_SECRET`. Ninguna clave pasó por el chat.
- **Un tropiezo con `CRON_SECRET`:** la indicación decía «la generás con el comando» y Alejo pegó el comando entero como valor. Funcionaba, pero no era secreto (el texto estaba en el chat). Se reemplazó por 64 caracteres hex al azar, generados directo en su portapapeles (nunca se mostraron).
- **Redeploy:** el botón del panel de Vercel se quedaba pensando; se hizo por la API (redeploy de `4b50d52`, READY en ~20 s). Las variables recién se aplican en el deploy siguiente.
- **Primer Run → `500`.** En los logs de Vercel, los dos Run pasaron el control (el secreto anda; mis pruebas sin secreto, `401`). En los logs de Supabase, la función leyó las 13 tablas con `200` (la clave anda) y el `POST` a `admin_backups` dio `400`: `admin_backups_trigger_check` sólo acepta `manual` | `auto` y el cron guardaba `'cron'`. Explica también que el backup propio no guardara nada desde mayo.
- **`[CRON-TRIGGER-AUTO]`** (`8eec233`, sin bump): el cron guarda `'auto'`, que es como el panel muestra lo que no es manual («🤖 Auto»). Probado con el módulo real (status `200`, el insert lleva `trigger: 'auto'`). **Segundo Run: la fila nueva**, 27-sep 02:04 UTC, `auto`, 282 KB, las 13 tablas. El cron programado corre todos los días a las 03:00 UTC (00:00 en Argentina).
- **Queda:** el push (un par nuevo de `VAPID_*`; la pública también en `js/app.js`) y ver en producción el `401` de `/api/send-notification` sin `accessToken` válido (hoy `500`, porque la función no carga sin las VAPID). `[VERCEL-ENV-VARS]` sigue abierto, en 🟡 (propuesta).
- **Visto al pasar, no tocado:** el respaldo del panel (`maybeAutoBackup`) inserta `'fallback'`, que el mismo CHECK rechaza, y su umbral de 3 h no sirve con un cron diario → `[BACKUP-FALLBACK-ROTO]` 🟡.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[CRON-HEADER-FALSO]` | El backup aceptaba un header o user-agent falsificable | `4b50d52` |
| `[SECURITY-AUDIT-S1]` | El secreto del push fuera de `admin.html`; el endpoint valida la sesión | `49200b7` + bump `d7496fb` |
| `[CRON-TRIGGER-AUTO]` | El cron guardaba un `trigger` que el CHECK rechazaba (400) | `8eec233` |
| `[BACKUP-FALLBACK-ROTO]` | El respaldo del panel guardaba `'fallback'` (rechazado) con un umbral de 3 h | `3c0c6c9` + bump `a0a595a` |

#### `[BACKUP-FALLBACK-ROTO]` · prompt `_b` del PREPARADOR (camino A de Alejo) · SW v1.1.136

- **Qué era:** el mismo patrón que `[CRON-TRIGGER-AUTO]`. `maybeAutoBackup()` (`admin.html`, corre 3 s después de un login con contraseña) guardaba `trigger 'fallback'`, que `admin_backups_trigger_check` rechaza (sólo `manual` | `auto`), y el error quedaba en el `catch`: fallaba en silencio. Su umbral de 3 h estaba pensado para un cron cada 2 h.
- **Qué se cambió:** `createBackup('auto')` (el Log lo sigue distinguiendo del cron por la acción `backup_create_fallback`), el umbral a **26 h** (el cron es diario, 03:00 UTC, + margen) y los comentarios. Sin migración: el CHECK ya acepta `'auto'` (la fila del cron de hoy lo prueba).
- **El grep:** ningún otro lugar espera `'fallback'` como `trigger` (la lista de backups muestra todo lo que no es `manual` como «🤖 Auto»). Sí aparecieron textos atados a las «3 h», **no tocados**: la etiqueta 🛟 del Log («el automático no corrió en 3 h», decisión 70) → `[LOG-LABEL-26H]` 🟢; el comentario del login («> 24h», L3681) y el texto de la pestaña Backups («Auto cada 24h · Retención 15 días · Máximo 200 snapshots»), que ya no coincidían con el código.
- **Verificación con fixture** (el `insert` interceptado): sin backups, a 26 h 1 min y a 3 días dispara (`trigger: 'auto'`, las columnas `trigger, actor_email, size_bytes, row_counts, data`, y `backup_create_fallback` en el Log); a 1 h y a 25 h 59 min no dispara.
- **Visto al pasar, no tocado:** corre para los dos roles, pero `admin_backups` tiene insert sólo para el jefe (`jefe_insert_backups`): en la tablet de la empleada el respaldo no puede guardar (lo rechaza la RLS y queda en el `catch`). Ya pasaba antes.

---

### Sesión 27-sep-2026 · `_c` · **`[RESUMEN-EN-EL-PANEL]`** (decisión 126 del DISEÑADOR)

Prompt `_c` del PREPARADOR. Dependía de un SQL que corrió Alejo (`resumen_dia(p_dia)`, fuera del repo): la primera consulta de Claude Code todavía no la encontraba; con la luz verde del PREPARADOR se volvió a mirar y ya estaba (`SECURITY DEFINER`, `authenticated` sí, `anon` no). Rama `resumen-panel` desde `8fa3abd`, un bump (SW v1.1.137). **Merge:** el PREPARADOR revisó la rama en GitHub y la aprobó tal cual; fast-forward `8fa3abd..7eee6d6`, en producción (SW v1.1.137, `admin.html` con la pestaña y sin el bloque viejo).

#### Qué se hizo

- **La pestaña «📌 Resumen»**, arriba de Log, sin `data-role` (las dos cuentas, 126b). Selector de día: `‹`, el título («Hoy · domingo 27», o el `fecha_texto` entero para un día cerrado) con «en vivo · hasta las …» / «día cerrado», `›` y `↺`, los tres a 44×44. Tope 60 días atrás (lo que guarda el Log); `›` apagado en hoy.
- **Una sola llamada a `resumen_dia()` por día mostrado:** las tarjetas y el texto de WhatsApp salen del mismo jsonb. **«Hoy» se pide sin `p_dia`:** la función tiene un default, pero un `p_dia` `null` explícito le llega como `NULL` y devuelve todo vacío (el contrato del prompt decía `null` = hoy).
- **Tarjetas** en el orden de 126c: 📦 Stock del local → 🏬 Depósito → 💰 Precios → 👤 Clientes nuevos → ⭐ Puntos, con el número en el título. Stock y depósito: `🔻 −2` / `🔺 +1` con `--stat-tinta-out` / `--stat-tinta-inv`, y el fabricante (`marca_real`, como el renglón gris de Precios & Stock) debajo del nombre. Precios: `~~$135.000~~ → $139.000` con el nuevo en `--amarillo-tinta`; la promo sacada, `~~$X~~ → sin promo` (la palabra vive en `RESUMEN_SIN_PROMO`); sin `old`, `— → $Y`; sin ninguno de los dos, no se muestra. Clientes: nombre, 📱 teléfono (como la pestaña Clientes) y «WhatsApp» a 44. Puntos: `+50 pts` en verde (y `−30 pts` en rojo). Sección vacía: un renglón gris («🏬 Depósito · sin cambios»); día sin nada: una sola caja. A 600, dos columnas y Puntos a lo ancho; a 390, una.
- **«📤 Mandar por WhatsApp»**: `https://wa.me/?text=` + `encodeURIComponent(data.texto)`, un `<a>` (sin pop-up) a lo ancho y a 44.
- **El Log:** el bloque «📌 Resumen de hoy» (Salieron / Entraron / Neto) pasa a ser un renglón «📌 Ver el resumen del día →» (44 de alto) que abre la pestaña. `logCargarResumen()`, sus dos `<div>` y su CSS se fueron; `resumen_stock_dia` quedó sin llamadas (ni en el panel ni en otra función de la base) y no se tocó.
- **Seguridad:** `escHtml` en `name`, `nombre` y `telefono`; el `wa.me` de cada cliente lleva sólo dígitos. Sólo tokens (sobre `--superficie`, oscuro / claro: baja 4,54 / 5,89 · sube 8,26 / 8,04 · precio nuevo 9,33 / 7,18 · gris 4,90 / 5,33), cero `!important`.

#### Verificación (fixture, `resumen_dia` interceptado: responde según el día y anota los argumentos)

- **Selector:** en hoy, `›` apagado; `↺` llama sin `p_dia`; 60 toques de `‹` llegan a hoy − 60 y ahí se apaga (uno más no llama); 60 toques de `›` vuelven a hoy y la última llamada va sin `p_dia`.
- **Capturas** (`_correo_agentes\…\herramientas\resumen-panel\png\`): 600 y 390, claro y oscuro, de hoy con las 5 secciones, un día con secciones vacías, un día sin nada, la empleada (mide igual que el jefe) y el renglón del Log. Todas las filas ≥ 44, sin scroll horizontal; el texto de WhatsApp, idéntico a `data.texto` (también en `.txt`).
- **XSS:** un cliente con `<img src=x onerror=…>` en el nombre se ve como texto, 0 `<img>` en las tarjetas, no se ejecuta.
- `node --check` del script del panel: sin errores. Grep: `logResumenLocal` / `logResumenDep`: 0; `resumen_stock_dia` / `logCargarResumen`: sólo en un comentario.
- **Promo sacada:** 1 en el fixture (puesta a propósito); en la base, 6 en los últimos 60 días (ninguna con el precio en `null`).

#### Hechos para el PREPARADOR / DISEÑADOR (no tocados)

- `resumen_dia` no mira el email (cualquier cuenta logueada). La empleada ve en el Resumen los precios y los clientes, que el Log le oculta (RLS de `admin_actions`) con el pie «Los cambios de precio y catálogo los ve el jefe»: 126b dice que el Resumen es de las dos.
- Los emojis 🔺 y 🔻 son rojos los dos (los dibuja el sistema), así que «+1» verde va al lado de un triángulo rojo.
- Si alguna vez `Precio`/`Promo` trae `old` y `new` vacíos, la tarjeta no lo muestra y el texto sí (`$— -> $—`), y el número del título difiere del texto.

#### Con los datos reales (sólo lectura, cantidades)

- Hoy (domingo 27, sin `p_dia`): las 5 secciones vacías, texto de 94 caracteres. Ayer (sábado 26): stock 36, depósito 51, precios 6, clientes 0, puntos 0; texto de 2.114 caracteres y el link de WhatsApp de 4.282 (no se probó en un teléfono).
- Los 6 precios de ayer son **promo sacada** (`$X -> $—`): el caso que el DISEÑADOR no había dibujado es el común.
- `resumen_dia(null)` explícito: `dia`, `es_hoy`, `fecha_texto` y `texto` en `null`, todo vacío (confirma que «hoy» va sin `p_dia`).

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[RESUMEN-EN-EL-PANEL]` | Pestaña «📌 Resumen» + renglón en el Log + WhatsApp (decisión 126) | `812ad56` + bump `11be3a9` + docs `7eee6d6` |

---

### Sesión 27-sep-2026 · `_d` · el Resumen (126f, 126g, teléfonos, grilla) + 125 / 125b

Prompt `_d` del PREPARADOR. Dependía del SQL v2 de `resumen_dia` (lo corrió Alejo); verificado en la base antes de arrancar: trae `precio_lista` (las 6 promos sacadas del 26-sep, las 6 con valor), el texto dice «vuelve a», `resumen_dia(null)` ya es hoy, `anon` sigue sin `EXECUTE`. Rama `resumen-d` desde `10b0347`, un bump (SW v1.1.138), merge pre-aprobado (`admin.html`, `api/cron/backup.js`, `sw.js` y docs).

#### Qué se hizo

- **126f · promo sacada con precio:** «~~$170.100~~ → sin promo · vuelve a $189.000», todo lo nuevo en `--amarillo-tinta` y negrita; sin `precio_lista`, «sin promo» como antes. «vuelve a» vive en `RESUMEN_VUELVE_A`, al lado de `RESUMEN_SIN_PROMO`. El dato del precio ahora se achica y se parte (entre montos y dentro de la frase, nunca dentro de un monto): la primera versión se salía del margen de la tarjeta a 600 (el dato era `flex: 0 0 auto` y no se partía) y, ya arreglado eso, 1,4 px a 481. Medido después de 360 a 1280: nada se sale.
- **126g · flechas:** ▲ ▼ como texto, del color del número (`--stat-tinta-inv` / `--stat-tinta-out`): los emojis 🔺🔻 los pintaba el sistema rojos los dos. El texto de WhatsApp no cambia (sale de la función).
- **Teléfonos:** `formatPhoneDisplay` portada de `js/app.js` con el mismo nombre y **sin `cleanPhone`**: `5492970000011` → `+54 9 2970 00-0011`; «+54 9 297 000-0022» → `+54 9 2970 00-0022`; con «15» en el medio (`5492971512345`) el panel da `+54 9 2971 51-2345` (conserva todos los dígitos), mientras la del catálogo, con `cleanPhone`, da `+54 9 29 71-2345`. El `wa.me` sigue con sólo dígitos; la pestaña Clientes no se tocó.
- **Grilla:** `.res-grilla { align-items: start }`: «· sin cambios» mide 36,2 en vez de estirarse a 127,4.
- **125:** la etiqueta 🛟 del Log dice «el automático no corrió» (cierra `[LOG-LABEL-26H]`).
- **125b:** el pie de Backups dice «Automático: una vez por día, a la medianoche · Se guardan los últimos 12», con el número de `BACKUPS_QUE_SE_GUARDAN` (cambiada a 13 en la prueba, el pie dijo 13). Comentarios cruzados con `MAX_BACKUPS_TO_KEEP` y el aviso de la hora del cron en `api/cron/backup.js`; NO ROMPER #17.

#### Verificación (fixture)

- Capturas `resumen-d-{claro|oscuro}-{600|390}-{hoy|vacias}.png` y `resumen-d-claro-600-backups-pie.png` (`herramientas\resumen-panel\png\`). Filas ≥ 44, sin scroll horizontal, nada fuera del margen de las tarjetas (medido en 360, 390, 481, 520, 600, 700, 900 y 1280).
- XSS: `precio_lista` y el teléfono con HTML salen escapados (`&lt;img`, sólo dígitos).
- Sintaxis del script del panel y `node --check` de `api/cron/backup.js`: sin errores. Grep: «no corrió en 3» 0; «Retención 15 días» 0.

#### Visto al pasar, no tocado

- `admin_backups_cleanup()` (la función de la base que llama el panel al abrir Backups) todavía dice 15 días / 200; en la práctica no borra nada porque el cron deja 12 antes.

#### Keywords cerrados

| Keyword | Qué | Cómo |
|---|---|---|
| `[LOG-LABEL-26H]` | La etiqueta del Log decía «3 h» | decisión 125 · `fd7b4cd` |
| `[BACKUPS-PIE]` | El pie de Backups decía «cada 24h · 15 días · 200» | decisión 125b · `fd7b4cd` + bump `fc5512e` |

---

### Sesión 27-sep-2026 · `_e` · **`[PRECIOS-EN-UN-LUGAR]`** (decisión 123 del DISEÑADOR, a–f)

Prompt `_e` del PREPARADOR: en el mostrador preguntan el precio de un decant y nadie se acuerda, y Precios & Stock (la pestaña que abre el panel) pasa a mostrarlo. **Sólo se mira.** Dependía de un SQL de Alejo (`decants_config.marcas_disenador`): la columna ya estaba al empezar. Rama `precios-en-un-lugar` desde `119a091`, SW v1.1.139. **Merge no pre-aprobado.**

#### Qué se hizo

- **Los datos:** `cargarDatosPrecios()` trae al entrar, en paralelo y sin bloquear el primer render, los decants de diseñador, la promo y los cambiados a mano, y `decants_config`; al llegar vuelve a pintar. Si uno falla, lo suyo no aparece (`PRECIOS_DATOS`). La pestaña Decants, al abrirse, también actualiza lo de Precios (lo que se guarda ahí se ve sin recargar).
- **123a · la tira:** «💧 Decants árabes (5 ml) · 1–2: $9.500 · 3–4: $9.000 · 5 o más: $8.500», la promo sólo si está vigente («🧪 Promo: 3 × $18.000 ($6.000 c/u) · entran todos menos los que dicen «sin promo» · hasta el mar 29») y «Abajo se marcan sólo las excepciones».
- **123b · excepciones:** «💧 decant $X fijo» y, con la promo vigente, «sin promo n×» (sólo en el armador y con escalera). La regla es **`promoEntraPanel`**, espejo exacto de `promoDecantEntra` (NO ROMPER #16). «Entran solos» sigue contando sólo el paso 4 (`promoEntraPorFrasco`), como antes: con el mismo fixture da «141 de 149» en `main` y en la rama.
- **123c · decants de diseñador como filas:** 💎 nombre y «marca · decant de diseñador · 5 ml», DECANT de contorno (123f; no abre el modal), «$X c/u» o «a consultar», efectivo «—». Por nombre, mezclados (empate: primero el frasco); con precio o stock, al final. No cuentan en las tarjetas.
- **123d · filtro** Todo · Frascos · 💎 Diseñador (`.log-chip`, 44). **123e:** «💎 Diseñador» en dos grupos con título («Frascos · N», «Decants 5 ml · N»); al buscar, un título sin filas se oculta y su N cuenta lo visible. El editor de marcas en Decants: chips con ✕ de 44, «+ Agregar» y «Guardar» para el jefe; gris, con 🔒 y sin sacar ni guardar para la empleada; «Falta correr el SQL…» si la columna no existe.
- **`[XSS-PRECIOS-STOCK]`** (cerrado con el merge, SECURITY.md § S20): `renderPrecios` metía el nombre y la marca crudos en `innerHTML` y el slug dentro de `onclick="openStockModal('…')"` sin escapar; un nombre con HTML se ejecutaba en Precios & Stock para las dos cuentas. Ahora `escHtml` en nombre, marca y `data-search`, y el slug con `escHtml(JSON.stringify(…))`. Mientras estuvo abierto, en el repo fue sólo la keyword.
- **En el celu,** la columna del nombre no parte renglones (regla previa): la línea gris de la marca y la de los decants terminan en «…» y las excepciones se parten, nunca se cortan.

#### Verificación (fixture)

- 32 capturas (`herramientas\precios-en-un-lugar\png\`): 390 y 360, claro y oscuro, de la tabla, «born», «💎 Diseñador», el precio fijo, «sin promo 3×» (Moscow Mule) con la promo prendida y apagada, y las marcas como jefe y como empleada. Sin scroll horizontal, los botones a 44, ninguna excepción cortada.
- **Alto de fila (con Inter; a 390 y 360 igual):** sin excepción 49; con «sin promo 3×» 57 (+8); con «💧 decant $18.500 fijo», que se parte en dos renglones, 69 (+20).
- **XSS:** un frasco (nombre por override) y un decant con `<img src=x onerror=…>`: se ven como texto, 0 `<img>`, no se ejecutan.
- `npm run contraste`: 0 fallas + 1 token pisado, 233 mediciones (DECANT 12,33 / 11,37 sobre la tabla; la línea gris y el «—» 5,58 / 5,33; el título de grupo 10,64 / 7,18). Sintaxis del script del panel: sin errores.

#### Con los datos reales (sólo contar)

- «💧 decant fijo»: 2 filas. «sin promo»: 0 (no hay promo); con 3 × $18.000 serían 9. Filas de decant de diseñador: 13.
- «💎 Diseñador»: **17 frascos**, no 21. Victoria's Secret tiene 5 en los datos: 2 escritos «Victoria's Secret» (entran: coinciden con «VICTORIAS SECRET») y 3 «VICTORIA SECRET» sin S (Bare Vanilla, Coconut Passion, Love Spell), que con la normalización pedida no entran. Aun contándolos serían 20.

### Sesión 27-sep-2026 · `_f` · ronda g de Precios & Stock (123g, 123h, «fijo») + `[XSS-NUEVOS]`

Prompt `_f` del PREPARADOR: tres decisiones del DISEÑADOR sobre lo de `_e` y un arreglo de seguridad en la pestaña de perfumes nuevos. Sin SQL (Alejo ya había corregido «VICTORIA SECRET» en la base, decisión A). Rama `precios-g` desde `a919314`: `4419352` (`admin.html`) + `28eb97a` (bump v1.1.139 → **v1.1.140**, aparte) + docs. Merge **no** pre-aprobado: lo revisa el PREPARADOR.

#### Qué se hizo

- **123g:** la línea gris de los decants de diseñador dice «MARCA · 5 ml» (el 💎 y el DECANT ya dicen «decant de diseñador»). El ml sigue saliendo de `decants_config`.
- **«💧 $X fijo»**, sin la palabra «decant» (el 💧 ya lo dice).
- **123h:** en Precios & Stock, a ≤ 600 (entra la Tab A9), el nombre ocupa hasta 2 renglones y recién ahí «…». El clamp va en un `<span class="td-nombre">` (sobre la celda, `display: table-cell`, no anda) y sólo dentro de `#tbodyPrecios`; la regla de un renglón de las demás tablas no cambia. **No depende del alto de la fila:** `flashRow` busca la fila por la badge y el `onclick` y pinta el `tr` entero; la badge tiene `min-height` 48 y queda centrada cuando la fila crece (ya pasaba con las excepciones de `_e`).
- **`[XSS-NUEVOS]`** (cerrado con el merge, SECURITY.md § S21): `renderNuevos` metía el nombre y la marca de `perfumes_nuevos` crudos en `innerHTML` y el nombre dentro de `onclick="deleteNuevo(id, '…')"` escapando sólo la comilla simple. Ahora `escHtml` y `escHtml(JSON.stringify(…))`. Mientras estuvo abierto, en el repo fue sólo la keyword; la prueba, en cambio, quedó descrita antes del merge (nota del PREPARADOR: con la rama pública, la prueba se describe recién en producción).

#### Verificación (fixture)

- 16 capturas (`herramientas\precios-en-un-lugar\png\precios-g-*.png`): «born», «💎 Diseñador» y el precio fijo a 390 y 360, claro y oscuro; Perfumes nuevos y Depósito a 390, en los dos temas. Sin scroll horizontal.
- **Alto de fila (con Inter; igual a 390 y a 360):** nombre en un renglón 49; nombre en dos renglones 58 (frasco) y 59 (decant, con el 💎); «💧 $18.500 fijo» entra en un renglón: fila de 58 (nombre + marca + excepción; en `_e` era 69).
- **A 390** los cuatro «Born in Roma» (frascos y decants) se leen enteros en dos renglones. **A 360** «BORN IN ROMA INTENSE» y «💎 BORN IN ROMA INTENSE» necesitan tres: se ven «BORN IN / ROMA…» y los distingue de «BORN IN ROMA» sólo el «…».
- **Las otras tablas:** Depósito a ≤ 600 sigue con el nombre en un renglón (`white-space: nowrap`, filas de 49).
- **`[XSS-NUEVOS]`:** un nuevo con `"><img src=x onerror=…>` en el nombre y `"><b>…</b>` en la marca se ven como texto, 0 `<img>` y no se ejecutan; «Editar» y «Eliminar» llaman a `editNuevo(id)` y `deleteNuevo(id, nombre)` con el nombre exacto, también uno con comilla simple (`L'HOMME PRUEBA`).
- `npm run contraste`: 0 fallas + 1 token pisado, 233 mediciones (no cambia). Sintaxis del script del panel: sin errores.

#### Con los datos reales (sólo contar)

- «💎 Diseñador»: **20 frascos**, no 21. En la base hay 6 «Victoria's Secret»; entran los 5 que son perfume (Bare Vanilla, Coconut Passion, Love Spell, Velvet Petals, Pure Seduction). El sexto es el override `victoria-secret` («AQUA KISS»), que no tiene perfume detrás → `[NUEVO-BORRADO-HUERFANO]`. El resto: JPG 5, Carolina Herrera 3, Valentino 2, Azzaro, Armani, Kenzo, Rabanne y Xerjoff 1.
- «💧 fijo»: 2 filas. Filas de decant de diseñador: 13.

#### Hallazgo, no tocado

- **`[NUEVO-BORRADO-HUERFANO]`** 🟡 (propuesta): `deleteNuevo` borra la fila de `perfumes_nuevos` pero no saca el perfume de `PERFUMES` ni toca su override. El 21-sep a las 16:34 ART se borró el nuevo «VICTORIA SECRET» (id 90) y hasta las 16:42 el panel siguió escribiendo en `victoria-secret` (ML 100 → 250 y depósito 3 → 4 → 7 → 8, `admin_actions`). Hoy ese override tiene 2 en el local y 8 en el depósito y no se ve en ningún lado. La pestaña Nuevos muestra el nombre de `perfumes_nuevos` («VICTORIA SECRET»), no el del override («AQUA KISS»).

### Sesión 27-sep-2026 · `_g` · ronda h · **`[ESPERA-MAS]`** (decisiones 42, v3 y 124 del DISEÑADOR)

Prompt `_g` del PREPARADOR: la pestaña Espera para las dos cuentas y anotar desde el mostrador. Rama `espera-mas`, que sale de `precios-g` (`d92150a`): el prompt pedía arrancar desde `main` después de mergear `precios-g` (aprobada por el PREPARADOR), pero el sistema de permisos de la sesión frenó ese merge («Merge Without Review»); lo que iba a ser `main` era exactamente `d92150a`. Después Alejo dio el OK: `precios-g` entró a `main` (fast-forward `a919314..d92150a`, v1.1.140 en producción), la descripción de `[XSS-NUEVOS]` entró en SECURITY.md § S21 (`dc6d94e`, en `main`) y `main` se mergeó en `espera-mas` (sólo SECURITY.md). A pedido de Alejo, la rama pasó por una revisión adversarial de 5 agentes (4 revisores + 1 verificador) antes de la del PREPARADOR. SW **v1.1.141** (bump en commit aparte). Merge **no** pre-aprobado: lo revisa el PREPARADOR en GitHub.

**El SQL ya estaba corrido** (verificado sólo leyendo): la columna `origen` (`text not null default 'web'`, check `web` / `local`, las 42 filas en `web`), `le_insert_anon` con `with check (origen = 'web')`, `le_insert_auth`, `le_delete_staff` por email para las dos cuentas y `trg_lista_espera_aviso` apagado. Las 42 filas y los 100 clientes tienen el teléfono como `549` + 10 dígitos.

#### Qué se hizo

- **a · para las dos cuentas (124):** el botón de la pestaña pierde `data-role="jefe"`; `canAccessTab('espera')` da `true` para la empleada y ve lo mismo que el jefe. Los colores inline oscuros (`#111`, `#fff`, el verde y el rojo del estado) pasan a clases con tokens (`--superficie`, `--borde`, las tintas del tema).
- **b · «+ Anotar del mostrador» (42):** botón de ancho completo, 44, con el contorno de «Avisame cuando vuelva». Abre un formulario copiado de esa ventana:
  - el teléfono con `+54 9` fijo y la misma confirmación («✓ +54 9 2970 00-0011»);
  - la normalización del catálogo: canónico tal cual, si no `cleanPhone` (copia exacta, NO ROMPER #18), y sólo se guarda con 13 dígitos;
  - el nombre sale solo si el teléfono es de un cliente, y se puede editar;
  - los perfumes se eligen de un buscador (visibles, sin sets ni pausados) y quedan como chips con ✕ de 44.
  Una fila por perfume, con `origen: 'local'`. El duplicado (23505) se dice junto al perfume («Ya está anotado para ese perfume»), y el mensaje de abajo dice cuáles entraron y cuáles no. Ningún error de la base se muestra tal cual.
- **c · origen:** el filtro Todo · Web · 🏪 Local (`.log-chip`, 44) y la etiqueta «🏪 Local». Si la columna no existe, la pestaña anda sin filtro y «Anotar» dice «Falta correr el SQL de la lista de espera».
- **d · v3:** Pendientes / Historial en el toggle `.log-vista`; «Avisar», «Re-avisar», «Quitar» y «Avisar a todos» a 44; el teléfono con `formatPhoneDisplay`; las dos tarjetas cuentan siempre a los pendientes (todos, sin importar vista ni filtro). La opacidad del Historial se fue: con ella el gris quedaba por debajo de 4,5 en los dos temas. En el catálogo, «Te avisamos al …» pasa de 10,4 a 12 px y el espacio entre 🔔 / 🔒 y el texto pasa de 0 a 4,7 px (el ✓ ya lo tenía).
- **e · «Quitar» (124):** con RLS, un DELETE que la base no deja hacer no da error (borra 0 filas): se pide la fila borrada (`.select('id')`) y sólo si vuelve se saca de la pantalla; si no, «No se pudo quitar». Cada «Quitar» va al Log: `espera_quitar` con `{ nombre, perfume }`, sin teléfono, «📍 Quitar de la espera · <nombre>», familia Catálogo.
- **f:** el comentario de `submitWaitlist` (`js/app.js`) ya no dice que el trigger manda el Telegram.
- **El formulario scrollea adentro** si es más alto que la pantalla (teclado abierto, muchos resultados): a 390 × 500, «Anotar» se alcanza. Los otros modales del panel no lo tienen.
- **«Quitar» a 4,5:** daba 3,86 en oscuro (de antes) y 3,15 en claro. Letra `#ff8a80` en oscuro (la de «✕ QUITAR», decisión 100): 6,45; la tinta roja del tema en claro: 5,22.

#### Verificación (fixture, nunca la tabla real)

- 42 capturas en `herramientas\espera-mas\png\` (600, 390 y 1280, claro y oscuro): la pestaña, el formulario vacío y con un cliente, el filtro Local, la vista de la empleada, un duplicado y el Log con un «Quitar». Stub con estado: el índice único, el DELETE con y sin permiso y el Log.
- Todos los botones de la pestaña y del formulario miden 44 o más (los chips, 46: el ✕ de 44 más el borde). La ✕ de limpiar que el panel pone en los campos mide 44 en el formulario (en el resto del panel, 36).
- Teléfonos: «2970000011», «02970000011» y «5492970000011» dan `5492970000011`; **«297 15 000 0011» da 15 dígitos y no se guarda** (`cleanPhone` saca el 15 sólo si ya empieza con 549; igual en el catálogo) → `[TEL-15-SIN-549]`.
- Un nombre y un perfume con HTML se ven como texto, 0 imágenes, en la pestaña, el formulario y el Log.
- `npm run contraste`: 0 fallas + 1 token pisado, 283 mediciones (50 nuevas de la Espera). Sintaxis del script del panel y de `app.js`: sin errores.

#### Hallazgos, no tocados

- `[ESPERA-LOW-SIN-STOCK]`: con pocas unidades (`low`) el grupo dice «SIN STOCK».
- `[ESPERA-AYUDA-AUTOMATICO]`: la ayuda de la pestaña promete un aviso automático por WhatsApp que no existe desde el 12-ago.
- `[TEL-15-SIN-549]`: el «15» viejo sin el 549 adelante no se limpia.

### Sesión 27-sep-2026 · `_h` · `espera-mas` en producción + ronda i (123i, badge, 123j, 127, la Espera y `[TEL-15-SIN-549]`)

**La revisión de 5 agentes** (pedida por Alejo, antes de la del PREPARADOR; 4 revisores + 1 verificador, sólo lectura): 10 hallazgos, **los 10 confirmados**, ninguno grave. Se arreglaron en la rama `ronda-i` (el PREPARADOR había aprobado `espera-mas` tal cual, en `24fadc3`):
- #0 un slug «constructor» o «__proto__» (anon puede escribirlo) cortaba la lista → `Object.create(null)` (de antes);
- #1 «Avisar a todos» armaba el `wa.me` con el teléfono crudo de la base: un teléfono con `?text=…` metía otro mensaje → sólo dígitos, como la fila (de antes);
- #2 un «54 0297 …» daba 13 dígitos y se guardaba sin ser 549 + 10 → sólo se guarda `^549\d{10}$`;
- #3 lo que se sacaba mientras se anotaba igual se insertaba, y lo que se sumaba se perdía al cerrarse sola → se saltea lo sacado y se cierra sólo si no queda nada;
- #4 / #9 un canónico pegado con espacios («+54 9 2974 15-1234») perdía su «15» → el canónico se mira sobre los dígitos;
- #5 con el filtro de origen, «Avisar a todos (N)» abría a todos los pendientes → el mismo filtro;
- #6 «Quitar» de una fila que otra tablet ya borró decía «No se pudo quitar» para siempre → se vuelve a leer la lista;
- #7 el cierre solo de 1,5 s cerraba una ventana ya reabierta (y pisaba `editingSlug`) → timer cancelable, sin `closeModal`;
- #8 «Quitar» daba 4,26 antes (no 3,86): corregido el número.
Queda sin tocar el mismo patrón que #0 en `logRenderFeed` («Por perfume», `porSlug`): ahí el slug lo escribe el staff.

**`espera-mas` a producción:** el PREPARADOR la aprobó; con el OK de Alejo en el chat, fast-forward de `main` a `0833be1` (`24fadc3` más la S21 que ya estaba en `main`). v1.1.141 en producción (`curl`: el formulario está, la pestaña sin `data-role`, `.waitlist-phone-preview` a `.75rem`).

**Ronda i** (prompt `_h`, rama `ronda-i` desde `0833be1`; SW v1.1.142 en commit aparte; merge no pre-aprobado):
- **123i:** a ≤ 360 el nombre de Precios & Stock va hasta 3 renglones (un `@media` después del de ≤ 600). «BORN IN ROMA INTENSE» se lee entero a 360.
- **La badge llena el alto de la celda** (decisión 18) con cualquier alto de fila: `#tbodyPrecios td.td-stock { height: 1px }` + `height: 100%` en la badge. Medido en Chromium (0 filas sin llenar); Safari y Firefox no se midieron. Sólo en Precios & Stock.
- **123j:** en «💎 Diseñador» y en «Todo», el decant de diseñador que se llama igual que un frasco (`promoNorm`) va en la fila del frasco: «💎 decant 5 ml $22.500» (el precio en la tinta dorada y en negrita; sin precio, «a consultar»). Con decant, el «💧 $X fijo» del frasco no sale. «Sólo en decant · N» junta los que no tienen frasco entre los que se muestran. El buscador encuentra la fila del frasco también por el nombre del decant.
- **127:** «Pedidos pass» → «Reset contraseñas» (el menú, el `title` y el título de la pestaña); entra en el menú sin cortarse a 360, 390, 600 y 1280.
- **`[ESPERA-LOW-SIN-STOCK]`**, **`[ESPERA-AYUDA-AUTOMATICO]`** y **`[TEL-15-SIN-549]`**: ver CLAUDE.md § Pendientes y NO ROMPER #18.

**Teléfonos** (Node, con las dos copias, idénticas): los 8 casos del PREPARADOR dan `5492970000011` y «5492971512345» queda igual. Sobre 300.000 números armados como los escribe la gente: 44.531 que fallaban ahora dan 13, **0** cambian a otro número de 13, y 286 (0,1 %) que la vieja guardaba quedaban sin guardar, por la regla «con más de una característica posible, no se adivina». **Resuelto antes del merge (ronda j, prompt `_i`): dos posiciones del 15 dan siempre el mismo número** (sólo pueden ser la 2 y la 4, «xx1515…»), así que el 15 se saca siempre que deje 13. De 200.000 canónicos, la vieja rompía 5.905; la nueva, 0.

**Datos reales** (sólo contar): en «💎 Diseñador», Frascos · 20, 10 con su 💎, y «Sólo en decant · 3»: Born in Roma, Most Wanted EDP Intense (el frasco es «The Most Wanted EDP», otro perfume) y Valentino Donna (el frasco existe, pero con la marca vacía: no entra en la lista de diseñador). En «Todo», 11 frascos llevan su 💎 y quedan sueltos Born in Roma y Most Wanted EDP Intense. Hoy no hay un decant «Sauvage Elixir» activo.

**Verificación:** 22 capturas en `herramientas\ronda-i\png\` (390 y 360, claro y oscuro: «💎 Diseñador», «Todo», «born», el menú y la Espera; el menú también a 600 y 1280). Los 10 arreglos de la revisión, uno por uno (`herramientas\espera-mas\cuerpo-revision.js`). Los flujos de la Espera de la ronda h, otra vez. `npm run contraste`: 0 fallas + 1 token pisado, 285 mediciones.

**Ronda j** (prompt `_i` del PREPARADOR: `ronda-i` aprobada con un arreglo de `cleanPhone`, las dos copias, sin bump nuevo): (a1) el 15 se saca aunque aparezca en dos lugares; (a2) el 0 de la característica después del 54 / 549 se saca (`digits.replace(/^(549?)0/, '$1')`): «+54 0297 000 0011» daba `5402970000011`, 13 dígitos, y el catálogo lo guardaba. En Node, con las dos copias idénticas:
- los 13 casos del PREPARADOR dan lo esperado;
- de 600.000 armados con su número conocido (característica 11, de 3 o de 4, con y sin 15, en 10 formatos), la vieja acierta 238.528, `ronda-i` 358.380 y ahora 600.000, sin ninguno de 13 equivocado ni ninguno que la vieja acertara y ahora no;
- las dos posiciones del 15, en 1.000.000 de restos «xx1515…», dan siempre lo mismo;
- la tanda de 300.000 de la ronda i: 0 cambian a otro número y 1 que daba 13 ahora falla: la basura «540183633313», que la vieja convertía en `5490183633313` (no existe: ninguna característica empieza con 0);
- de 200.000 canónicos, ahora 0 tocados.

### Sesión 27-sep-2026 · `_j` · ronda k · **128 `[GUARDAR-ABAJO]`**: la barra fija de «Guardar»

Prompt `_j` del PREPARADOR (decisión del DISEÑADOR, aprobada por Alejo). Rama `guardar-abajo` desde `2b6d343`; SW v1.1.143 en commit aparte. Merge pre-aprobado por el PREPARADOR y autorizado por Alejo en el chat si daban las verificaciones 1 a 5.

#### Qué se hizo
- **a · `.admin-main`:** `overflow-x: clip` (con `hidden` antes, de respaldo) y `min-width: 0` en todos los anchos. Con `hidden`, `overflow-y` pasaba a `auto` y el `main` era un contenedor de scroll: el sticky se quedaba al final del formulario → NO ROMPER #19.
- **b · `.barra-guardar`:** `position: sticky; bottom: 0; z-index: 50`, `--superficie`, borde arriba, sombra (más suave en claro), `padding: 12px 16px calc(12px + env(safe-area-inset-bottom))`. Ocupa el ancho de la caja con un margen negativo igual a su padding (`--caja-pad` en `.con-barra`: 1.5rem en Editar y Nuevo, 1.2rem en promo y marcas, 0 en la escalera). Botones de 48 (`padding: .7rem 1rem`: el padding de 1.8rem de los botones sueltos partía «Guardar configuración»), el secundario a la izquierda (`flex: 1`) y el principal a la derecha (`flex: 2.2`).
- **c · dónde:** Editar (Cancelar + Guardar cambios, antes de «Eliminar»), Nuevo («Cancelar» sólo cuando se edita + «Agregar perfume»), Decants: la escalera (se envolvió en `#decantsEscalera`; «↺ Recargar» + «Guardar configuración»), la promo («Guardar promo») y las marcas («Guardar»; el campo y «+ Agregar» quedan donde estaban). En Decants las tres barras son `data-solo-jefe`. Los botones son los de antes: mismo `id`, `onclick` y texto.
- **e · el teclado:** `html { scroll-padding-bottom: 88px }`. Con `scroll-margin-bottom` en los campos, un `<textarea>` a medias detrás de la barra no subía al hacer `focus()`.

#### Verificación (fixture, Inter; 360×780, 390×844, 600×960, 960×600, 1280×800)
1. **Se pega:** a mitad del formulario (lo que va de la caja a la barra), `barra.bottom === innerHeight` en Editar, Nuevo y la escalera en los 5 anchos (la escalera a 600 × 960 entra en la pantalla); la promo y las marcas entran en la pantalla, y entrando desde abajo la barra ya está pegada. Al final, la barra queda en su lugar y «Eliminar» debajo y fuera de ella. Alto del formulario a 390: Editar 3.335, Nuevo 1.510 (el DISEÑADOR midió ≈ 4.900), escalera 1.019, promo 620, marcas 588.
2. **`.admin-main` mide lo mismo que en `main`** en las 23 pestañas × 5 anchos, y 0 scroll horizontal (en `main` también 0).
3. **El menú la tapa:** abierto (≤ 700) y expandido (> 700), `elementFromPoint` sobre la barra da el menú o su fondo.
4. **Empleada:** ninguna barra en Decants; en Nuevo, como el jefe. **Su «Editar» no abre** (`canAccessTab` encuentra primero el botón del jefe): pasa igual en `main` → `[EDITAR-EMPLEADA-MUERTO]`. Con la pestaña abierta a la fuerza, la barra de Editar sale igual que para el jefe (pegada, 48).
5. **Botones de 48** en todas las barras, salvo la escalera a 360 y 390: «Guardar configuración» no entra en un renglón y la barra mide 52,4 / 50,4. «Guardando…» y deshabilitado: igual que antes (ninguno se deshabilita; sólo Editar escribe «Guardando...» en su mensaje) → `[GUARDAR-DOBLE-TOQUE]`. `npm run contraste`: 0 fallas + 1 token pisado, 291 mediciones (los botones de la barra en los dos temas).
6. **El teclado:** `focus()` en el último campo de arriba de cada barra, desde arriba de todo y desde detrás de la barra: el borde de abajo queda por encima de la barra en las 5 cajas y los 5 anchos.
7. 43 capturas en `herramientas\guardar-abajo\png\` (390, 600 y 1280, claro y oscuro: Editar arriba, en el medio y al final; Nuevo; Decants como jefe y como empleada; Editar a 960 × 600 con el menú expandido; y el menú abierto en los 5 anchos).

### Sesión 28-sep-2026 · `_k` · ronda l · tanda chica (123k, 123l, 129b, doble toque, encabezado de Decants, «Editar» de la empleada) · **sin mergear**

Prompt `_k` del PREPARADOR. Alejo eligió la **A** para el «Editar» de la empleada y autorizó el merge si daban las verificaciones 1 a 5. Rama `tanda-l` desde `2a2ddd6`; SW v1.1.144 en commit aparte. **No se mergeó: el punto 2 no dio** (abajo).

#### Qué se hizo
- **123k:** la línea 💎 dice «💎 5 ml $22.500» (sin «decant»). **123l:** «a consultar» → «sin precio» en la línea 💎 y en «Sólo en decant»; sólo en Precios & Stock.
- **129b:** los botones de la Espera ya no tienen letra propia: toman la de `.action-btn` (`.68rem`).
- **`[GUARDAR-DOBLE-TOQUE]`:** `conGuardando(id, fn)`: el botón principal de las 5 barras (Editar, Nuevo, la escalera, la promo, las marcas) va deshabilitado y con «Guardando…» hasta que termina, y vuelve a su texto en un `finally` (salvo que la función lo haya cambiado: Nuevo pasa a «Agregar perfume» al limpiar). Las funciones pasaron a `…Ahora`; los `onclick` no cambiaron. Ids nuevos: `btnSaveEdit`, `btnSaveDecants`, `btnSavePromo`, `btnSaveMarcas`.
- **`[DC-HEADER-CORTADO]`** (cierra `[DC-HEADER-600]`): el encabezado de columnas de «Decants de diseñador» con la clase `dc-head` (el `display: grid` pasó del inline a la clase) y oculto debajo de 1100.
- **`[EDITAR-EMPLEADA-MUERTO]` (A):** se sacó el botón «Editar» de la empleada y su regla de CSS. En `guia.html` (sección «Precios y Stock», marcada EMPLEADO) se fueron la columna «Acción / Editar» y «Cambiar precio», que ya no existen, y el aviso de roles dice que la empleada gestiona stock y clientes.

#### Verificación (fixture, Inter)
1. Capturas en `herramientas\tanda-l\png\` (360 y 390, claro y oscuro: «💎 Diseñador», la Espera en Pendientes e Historial con nombres largos; Decants a 390, 600 y 1280; el menú como empleada y como jefe).
2. La línea 💎 en un renglón a 360 y 390 (97 de 110 px); filas con 💎 **58 / 72 / 86** (antes 69 / 83 / 97). Los botones de la Espera, 44 o más. **Nombres: no da.** A 360, en el Historial, con la etiqueta «🏪 Local», un nombre de 20 letras va en 3 renglones (en `main`, 2); sin etiqueta, con 34 (en `main`, 2). En Pendientes, con etiqueta, 34 letras → 3 (igual que `main`). Los nombres reales llegan a 21 letras.
3. Doble toque, con un stub que tarda 300 ms: dos `click()` seguidos = **una** escritura en los 5; durante, «Guardando…» y deshabilitado; después, su texto, en éxito, error de la base y validación que corta (Editar: cancelar el «ST»; Nuevo sin nombre; la escalera sin ml; la promo con N = 1). Nuevo editando: «Guardar cambios» → «Agregar perfume».
4. `npm run contraste`: 0 fallas + 1 token pisado, 291 mediciones. Sintaxis del script del panel: sin errores.
5. Empleada: el menú no tiene «Editar» (en `main` tenía uno que no abría). Jefe: igual que antes.

#### De paso, de antes
- `[DC-ELIMINAR-CORTADO]`: en cada fila de «Decants de diseñador», a 390 el botón «Eliminar este perfume» (266 px) se sale 77,9 px de la caja y `main` lo recorta. En `main` igual.

→ Siguió en la ronda m (`_l`, abajo): con la decisión B de Alejo, el 129b salió y la rama se mergeó.

### Sesión 28-sep-2026 · `_l` · ronda m · «Guardar», los estados de la barra, «Guardando…», el 🗑️ y el merge de `tanda-l` (decisión B)

Prompt `_l` del PREPARADOR, sobre la rama `tanda-l` (revisada entera por él: sin observaciones). Alejo eligió la **B**: sacar el 129b y mergear si daban las verificaciones 1 a 6. Sin bump nuevo (la v1.1.144 no había salido). `e5f9048` (`admin.html`) + `9a9b8de` (`scripts/contraste.js`).

#### Qué se hizo
- **128a:** la barra de la escalera dice «Guardar» (era «Guardar configuración»). «↺ RECARGAR» en mayúsculas (`text-transform` + `letter-spacing` en `.barra-sec`) **no entra**: 2 renglones a 360 y a 390 (la barra, 77,4). El prompt decía «si no entra a 360, no va»: quedó como estaba.
- **128b · los estados:** cada `…Ahora` devuelve `{ ok: true }`, `{ ok: false, error: '<el texto de su mensaje>' }` (validación que corta o error de la base) o nada (canceló el «ST» de Editar). `conGuardando`:
  - sale bien → «✓ Guardado» 2 s y vuelve a su texto. Si la función cambió el texto (Nuevo limpia el formulario y pone «Agregar perfume») o el botón ya no se ve, queda lo suyo, sin ✓;
  - sale mal → «No se guardó» 2 s, habilitado, y el motivo arriba de los botones: `<p class="barra-error" role="alert">` con «✕ » + el texto, por `textContent`, en `--stat-tinta-out`, `.72rem`, 2 renglones como mucho. Se va al tocar Guardar de nuevo (y, por lo tanto, al guardar bien). El mensaje del final de la caja, igual;
  - los timers son por botón: un toque durante los 2 s cancela el pendiente, y el timer devuelve el texto sólo si el botón sigue diciendo lo que él puso.
  - Los caminos «⚠ Guardado SIN …» (columnas que faltan en la base, de mayo) cuentan como `{ ok: true }`: guardaron.
  - Si la función tira una excepción, el botón vuelve a su texto como antes, sin estado (puede haber guardado antes de fallar).
- **«Guardando…» legible:** `.barra-guardar > button:disabled { opacity: .7; cursor: progress }`, que le gana a `.modal-btn:disabled` (.3) por especificidad.
- **`[DC-ELIMINAR-CORTADO]`:** el 🗑️ de cada fila de «Decants de diseñador» con `width: auto; min-width: 48px` (`.modal-btn` trae `width: 100%`) y **`min-height: 44px`** (medía 38: el prompt pedía 44 o más y su arreglo dejaba el 38).
- **B:** el 129b salió: `#tab-espera .espera-btn` vuelve a `.58rem` y `.espera-btn-todos` a `.65rem`, como en `main`.

#### Verificación (fixture, Inter; stub con demora y fallas a pedido)
1. «Guardar», un renglón a 360, 390, 600 y 1280. La barra de la escalera: **73 a 390** (en `main`, 75,4), 600 y 1280; **77,4 a 360**, porque «↺ Recargar» va en 2 renglones (igual que en `main`) → `[RECARGAR-360]`. Alejo mergeó igual.
2. **Los estados, en las 5 barras:** bien → «✓ Guardado» al terminar y a +1,7 s, su texto a +2,2 s; error de la base → «No se guardó» y el motivo con `role="alert"` arriba de los botones; al reintentar, el motivo se va en el toque y vuelve si falla otra vez; al guardar bien, se va. Validación que corta (Editar con «XX» en vez de «ST», Nuevo sin nombre ni precio, la escalera sin ml, la promo con N = 1): igual que el error, 0 escrituras. Cancelar el «ST»: nada. Nuevo: después de limpiar, «Agregar perfume» sin ✓ (también editando). Un toque durante los 2 s: otra escritura y el timer viejo no pisa el ✓ nuevo. Salir de la pestaña durante los 2 s: el texto vuelve y ningún error. Si «editar» otro nuevo cambia el texto durante los 2 s, el timer no lo pisa.
3. **Alto de la barra a 390 y 360:** 73 sin motivo; 96 con un renglón; 110 con dos y con un motivo larguísimo (el recorte a 2 funciona). El prompt estimaba 97 / 112: el renglón es de 15 px (`line-height: normal` de Inter a `.72rem`). Los botones siguen en una fila. Un motivo con `"><img src=x onerror=…>` se ve como texto: 0 `<img>`, no se ejecuta.
4. `npm run contraste`: «Guardando…» **6,00** en oscuro y **5,44** en claro; el motivo, 4,54 y 5,89. 0 fallas + 1 token pisado, 295 mediciones.
5. **El 🗑️:** 48 × 44, 0 px afuera de la caja y de la fila a 360, 390, 600 y 1280, en la misma fila que «💾 Guardar» (en `main`: 236 / 266 / 476 / 130 px de ancho y +77,9 / +77,9 / +77,9 / +19,9 afuera).
6. Doble toque: 1 escritura en las 5 barras (0 en las validaciones). `#tab-espera`: 0 diferencias con `main` (56 reglas).
7. Capturas en `herramientas\tanda-l\png\ronda-m-*` (claro y oscuro): Editar a 390 en el medio con «Guardando…» y «✓ Guardado», Nuevo con un nombre repetido («No se guardó» y el motivo), Decants a 360 con «Guardar» y una fila de «Decants de diseñador» a 390 con el 🗑️.

#### De paso, de antes
- `[XSS-ESTADISTICAS]` 🟠: agujero abierto que ya estaba en `main`; salió en la consola durante las mediciones. Sólo la keyword (SECURITY.md § S22).

### Sesión 28-sep-2026 · `_m` · `[XSS-ESTADISTICAS]` (pedido de Alejo: «ponelo ahora»)

Alejo lo puso en la fila apenas salió (ronda m). Rama `xss-estadisticas` desde `fa28417`; **no se publicó antes del merge** (rama local): el agujero se podía escribir desde `anon`.

#### Qué se hizo
- `loadStats` (`admin.html`): `escHtml` en el nombre del top 10 (que es el `slug` de `perfume_clicks_resumen()` cuando el perfume no está en el catálogo) y en los de «Perfumes sin visitas». El resto de la pestaña pinta números y etiquetas fijas; Analytics ya escapaba todo. `776834b` + SW v1.1.145 (`75b7328`).

#### Verificación (fixture, Inter)
- En la base, sólo lectura: `perfume_clicks` la inserta `anon` sin validar el texto (`pc_insert_public`, `with_check true`). Hoy tiene 0 slugs con `< > " '` o espacios, y las 241.141 filas cumplen `^[a-z0-9-]{1,120}$`.
- Con `rpc:perfume_clicks_resumen` en el fixture (un slug `"><img src=x onerror=…>` con 999 clics, más tres perfumes con HTML en el nombre):
  - en `main` (`fa28417`): 4 `<img>` con `onerror` en la pestaña, y se ejecutan el del slug y uno del catálogo;
  - en la rama: los 5 del top 10 se ven como texto, 0 `<img>`, nada se ejecuta.
- Sin clics (todos en «sin visitas»): en `main`, 3 `<img>`; en la rama, 0.
- Sintaxis del script del panel: sin errores.

#### Nuevos
- `[CLICKS-SLUG-CHECK]` 🟢 (propuesta): un `CHECK` en `perfume_clicks.slug` como segunda defensa. No rompe nada con los datos de hoy.
- `[MOTIVO-QUEDA]` 🟢: el motivo de «No se guardó» sigue en la barra al cambiar de perfume en Editar (sale de la ronda m).

### Sesión 28-sep-2026 · `_n` · el barrido de XSS y `[XSS-URL-FILTROS]` (pedido de Alejo: «arreglalo ya»)

**El barrido** (con el OK de Alejo, que antes preguntó para qué servía): 10 agentes en sólo lectura. 4 buscaron, cada uno en una zona: el panel en dos mitades, el catálogo, y las funciones de Vercel y de la base. 6 verificadores intentaron desmentir cada hallazgo. Resultado: 49 confirmados y 10 descartados. El detalle vive en `_correo_agentes` (`ClaudeCode_para_PREPARADOR_2026-09-28_m.md` y `herramientas\xss-estadisticas\barrido.json`). En el repo, sólo las keywords de lo abierto: `[XSS-CATALOGO-STAFF]` y `[XSS-PANEL-STAFF]` 🟠, `[TELEGRAM-HTML-ANON]` 🟡 y `[XSS-NOMBRE-CLIENTE]` 🟢 (SECURITY.md § S24-S27). Además, lo de Combos que ya se conocía (`[S10-TER-XSS-COMBOS]`).

**`[XSS-URL-FILTROS]`** (el único que podía usar cualquiera, con un link): rama local `xss-url-filtros` desde `e89f9d9`, que no se publicó antes del merge. `6e5aee1` (`js/app.js`) + SW v1.1.146 (`add68cc`).
- `applyFiltersFromURL`: `?cat=` sólo acepta `all`, `favs`, `Unisex`, `Hombre` y `Mujer`, sin distinguir mayúsculas (con `hasOwnProperty`: `?cat=constructor` no devuelve una función heredada). `?nota=` y `?ocasion=` ya estaban cubiertos: la nota tiene que coincidir con un chip que existe, y la ocasión, ser `dia` o `noche`.
- `updateActiveFilters`: `escapeHTML` en la etiqueta y el valor del chip. El texto de `?q=` no se pinta en ningún otro lado: las sugerencias resaltan el nombre, no lo tipeado.

#### Verificación (fixture, 390, `index.html` con el stub; `main` = `e89f9d9`)
| Link | `main` | rama |
|---|---|---|
| `?cat=<img src=x onerror=…>` | se ejecuta | se ignora («Todos») |
| `?q=<img src=x onerror=…>` | se ejecuta (en minúsculas) | texto en el chip |
| `?cat=constructor` | chip «constructor», 0 perfumes | se ignora |
| `?cat=Hombre` · `?q=lattafa` · `#filtro-mujer` · `?cat=favs` · sin filtro | andan | igual que `main` |
| `?cat=hombre` | 0 perfumes | filtra Hombre |

Sintaxis de `js/app.js`: sin errores.

### Sesión 28-sep-2026 · `_o` · la Espera (129b + 129c), `[MOTIVO-QUEDA]`, 128f y 128g `[MOTIVO-EN-CRIOLLO]`

El punto 2 de los prompts `_m` y `_n` del PREPARADOR (decisiones 129c, 128e, 128f y 128g del DISEÑADOR), con merge pre-aprobado y el OK de Alejo en el chat. La rama `espera-criollo` arrancó de `d17b309`. `b42fd09` (`admin.html`) + SW v1.1.147 (`c8a2b51`).

#### Qué se hizo
- **129b otra vez:** `#tab-espera .espera-btn` y `.espera-btn-todos` sin letra propia (la de `.action-btn`, `.68rem`).
- **129c:** «🏪 Local» pasa del nombre al final de `.espera-sub` («+54 9 2970 00-0011 · 25/9 🏪 Local»). La hora del Historial va con `hour12: false` («Avisado 27/9 10:00»). El número va en `<span class="espera-tel-num">` (`white-space: nowrap`, escapado).
- **`[MOTIVO-QUEDA]`:** `barraError(…, '')` en `loadEditPerfume`, `cancelEdit`, `clearNuevoForm` y `editNuevo`, el mismo criterio que `#editMsg`.
- **128f:** a ≥ 1100, `.dc-cell-actions { align-items: stretch }`; debajo de 1100, sin cambios.
- **128g `[MOTIVO-EN-CRIOLLO]`:** `errorEnCriollo(err, ctx)`, al lado de `conGuardando`, la usan las cinco `…Ahora` para los errores de la base. Los casos:
  - `23505` o «duplicate key» → «Ya existe un perfume con ese nombre.» (`ctx = 'perfume'`: Editar y Nuevo) o «Ya existe con ese nombre.» (Decants y Marcas);
  - `navigator.onLine === false`, `TypeError` o «Failed to fetch» / «Load failed» (el mensaje de Safari) → «No se pudo conectar…»;
  - `PGRST301` / `PGRST303`, 401 o «JWT» → «Se venció la sesión…»;
  - `42501` o «row-level security» / «permission denied» → «Esta cuenta no puede guardar esto.»;
  - cualquier otro → «No se pudo guardar. Probá de nuevo; si sigue, avisale a Alejo.»
  El mismo texto va en la barra y en el mensaje de abajo, y el error original a `console.error`. Los mensajes que ya estaban en castellano en el `catch` de la escalera y de la promo («sólo el jefe puede cambiar…», «Revisá la conexión…») pasan también por la función: el texto es el de la tabla. Las validaciones propias y los «⚠ Guardado SIN…» no se tocaron.

#### Verificación (fixture, Inter; stub con fallas a pedido)
1. **La Espera** (a 360 y 390, con nombres de 15, 20, 29, 31 y 34 letras, web y 🏪 Local, en Pendientes y en el Historial):
   - ningún nombre de hasta 20 letras va en 3 renglones;
   - a 360, las filas miden: Historial Local 20 letras **83** (nombre en 2), Pendientes Local **61**, Historial web 29 letras **81**. En `main`: 82, 61 y 81;
   - el teléfono nunca se parte, 0 «a. m.» / «p. m.», y todos los botones de 44 o más (Avisar 59, Quitar 61, Re-avisar 80);
   - a 360, «Avisado 27/9 10:00» puede partir entre la fecha y la hora: sólo el número va sin cortes, como se pidió.
2. **128g:** 25 de 25 (5 errores × 5 barras): el texto de la tabla en la barra (con «✕ ») y abajo, y el original en la consola. También con `navigator.onLine === false`. Las 4 validaciones, con su texto de siempre y sin nada en la consola.
3. **`[MOTIVO-QUEDA]`:** con un error en la barra, el motivo se va al cargar otro perfume, al cancelar Editar, al limpiar Nuevo y al editar otro nuevo.
4. **128f:** a 1100 y 1280, el 🗑️ mide 48 × 49,6, lo mismo que «💾 Guardar» (en `main`, 48 × 44); a 390 y 1099, 48 × 44, igual que en `main`. 0 px afuera.
5. **Los estados de la barra** (la prueba de la ronda m, otra vez): iguales, con los textos nuevos. Sin errores en la página.
6. `npm run contraste`: 0 fallas + 1 token pisado, 295 mediciones. Sintaxis del script del panel: sin errores.
7. Capturas en `herramientas\tanda-l\png\ronda-n-*`, en claro y oscuro: la Espera a 360 y 390 en Pendientes y en el Historial; Nuevo con un nombre repetido y Editar sin conexión, a 390.

### Sesión 28-sep-2026 · `_p` · los escapes del barrido de XSS (punto 3 del `_m`)

La decisión A de Alejo: se hacen todos, en una sola tanda. Se trabajó en la rama local `xss-staff`, desde `a99fe14`, **sin subirla**: el PREPARADOR revisó el `diff.patch` en el buzón, junto con la lista contra `barrido.json`. Merge no pre-aprobado. Commits: `268f6e8` (panel), `8604f75` (catálogo y `api/`) + SW v1.1.148 (`c8bb0f7`).

#### Qué se hizo
- **Panel** (`[XSS-PANEL-STAFF]`): 49 reemplazos exactos en `admin.html`, todos los lugares del barrido. Entran también `[S10-TER-XSS-COMBOS]` en el panel (`loadCombos` y el buscador de `addComboItem`) y `loadPuntosHistory`, que hoy está latente.
- **Catálogo** (`[XSS-CATALOGO-STAFF]`, `[XSS-NOMBRE-CLIENTE]`):
  - dos helpers en `js/app.js`, al lado de `escapeHTML`: `jsAttr(x)`, para los 32 valores dentro de un `onclick` (27 en `app.js`, 5 en `extras.js`), y `urlSegura(u)`, que deja pasar sólo `http(s)` o relativos;
  - 122 llamadas nuevas a `escapeHTML` en `app.js`: la card, el detalle, el carrito, comparar (también las «notas exclusivas», que el barrido no había listado), similares, la búsqueda (`highlightMatch` escapa antes de marcar), la Selección, los sets (`renderSets`, el lado público de Combos), el quiz, el Desafío, la votación y el nombre del cliente.
- **`api/share.js` y `api/compare.js`:** el JSON-LD con `<` → `\u003c`. `api/category.js` y `api/blog.js` tienen la misma forma, pero con datos del seed: el barrido los descartó y no se tocaron.
- **No se tocó:**
  - los `onclick` del panel con ids (`bigint` / `uuid`), por la decisión de S10-bis;
  - la encuesta con botones fijos de `index.html`;
  - los textos de WhatsApp, que van con `encodeURIComponent`.

#### Verificación (fixture, Inter; `main` = `a99fe14`)
1. **Fixture envenenado:** HTML en el nombre, la marca, las notas, el perfil, la foto (`"` que cierra el atributo) y el slug (`');…;('`) de los perfumes, y en los combos, los badges (`javascript:` y el truco de `&quot;`), la votación, el anuncio (`javascript:`), las últimas ediciones, los cierres, el ajuste, `puntos_log`, el historial de puntos y el de push.
   - **Panel** (16 pantallas y los `onclick` con el slug raro): `main` ejecuta 20 payloads distintos; **la rama, 0** (0 `<img src=x>`).
   - **Catálogo** (la carga, «ver más», votación, badges, anuncio, detalle, carrito, comparar, similares, búsqueda, Desafío, quiz, decants y los `onclick` con el slug raro): `main` ejecuta 14 y pinta el link `javascript:` del anuncio; **la rama, 0** a 1280 y a 390. El badge con `javascript:` ya no es clickeable, y el del truco con `&quot;` queda como texto adentro del string.
2. **Datos normales:** el HTML de 5 pantallas (la grilla entera con sets, Selección y badges; el detalle; el carrito; Depósito; Editar, con la búsqueda y los similares) es **igual** al de `main`, sin contar las comillas adentro de los `onclick` (`'slug'` contra `"slug"`). Capturas antes y después, en `herramientas\xss-staff\png\igual-*`.
3. `vm.Script` de `admin.html`, `js/app.js` y `js/extras.js`: sin errores. `node --check` de `api/share.js` y `api/compare.js`: ok. En el JSON-LD, un nombre con `</script>` sale sin `</script>` y el JSON sigue siendo igual.
4. `npm run contraste`: 0 fallas + 1 token pisado, 295 mediciones.

#### La revisión del PREPARADOR (prompt `_o`): aprobada, con un agregado chico
- **1a:** `buildSlideHTML`, el slider eliminado (NO ROMPER #2). `escapeHTML` volvía la `'` una entidad antes del `.replace`, y el navegador la decodificaba dentro del atributo. Ahora el slide es clickeable sólo con `urlSegura`, y el `onclick` va con `jsAttr` (`ac09e2e`, sin bump).
- **1b · S18:** se cruzó contra el inventario del PREPARADOR. De sus 3 barridos (panel, catálogo y base), los 50 lugares que marcaba sin escapar o con escapado insuficiente (20 del panel, 30 del catálogo) ya estaban en la tanda. **S18 cerrado.** La colisión de slugs combo / perfume no es XSS: pasa a `[COMBO-SLUG-COLISION]` 🟢.
- **Otra vez, con el fixture envenenado ampliado** (un combo con el slug `yeah-man-edp`: foto que cierra el atributo, nombre, categoría, perfil, marca y precio de texto; un combo con comilla en el slug; un slide con `'` y otro con `javascript:`):
  - **panel:** 0 ejecuciones en la rama (en `main`, la lista de combos, Destacados y los `onclick` con comilla);
  - **catálogo:** 0 a 1280 y a 390 (en `main`, el detalle, el carrito, comparar, recientes, la Selección y el slide);
  - el slide con `javascript:` ya no tiene `onclick`;
  - con datos normales, las 5 pantallas, **iguales**;
  - `vm.Script`, `node --check` y `npm run contraste`: iguales que antes.
- Nuevos, 🟢: `[COMBO-SLUG-COLISION]`, `[ERRORES-CRUDOS-RESTO]` y `[ESCAPE-DOBLE-FUNCION]`.

### Sesión 28-sep-2026 · `_q` · la tanda chica: 129d, 128h `[ERRORES-CRUDOS-RESTO]` y `[ESCAPE-DOBLE-FUNCION]`

El prompt `_p` del PREPARADOR, con el merge autorizado por Alejo si daban las verificaciones 1 a 5. La rama `tanda-q` arrancó de `bb263d0`. `5b17edd` (`admin.html`) + SW v1.1.149 (`6a7580e`).

#### Qué se hizo
- **129d:** «Avisado dd/mm hh:mm» del Historial de la Espera va en `<span class="espera-avisado">`, con el `nowrap` de `.espera-tel-num`. La línea se sigue partiendo en los «·».
- **128h `[ERRORES-CRUDOS-RESTO]`:** `errorEnCriollo` suma un tercer dato, `que` (lo que se intentaba hacer), y `ctx` puede ser la frase del repetido.
  - Las cinco barras de 128g no pasan `que` y dicen lo mismo que antes («No se pudo guardar…»).
  - Los 18 lugares, con su `que`: depósito (`cambiar el stock del depósito`), cliente nuevo (`registrar el cliente`), sumar punto (`sumar el punto`), editar cliente (`guardar el cliente`), borrar cliente, el precio del modal viejo, el stock del modal, eliminar perfume, las tres fotos (`subir la foto`), agregar el cierre, guardar el horario, guardar el combo, pausar / activar el combo, guardar la votación, cargar el ranking y cargar el historial de puntos.
  - «Ya existe un cliente con ese teléfono.» sólo donde la base tiene el único (`clientes.telefono`): alta, sumar punto y editar cliente. Los cierres (`upsert` por `fecha`) y los combos (`upsert` por `slug`) nunca dan 23505: van al genérico.
  - Cada texto sale donde salía: el mensaje del modal o de la caja, el `alert` de pausar un combo, la fila de la tabla en el ranking y el historial de puntos (con `escHtml`). El original va a `console.error`.
- **`[ESCAPE-DOBLE-FUNCION]`:** `escapeHtml(str)` llama a `escHtml`, la única implementación. `null` / `undefined` dan `''` (antes `escHtml` daba «null»), un número se respeta (antes `escapeHtml(0)` daba `''`), y las dos escapan también la comilla simple (`&#39;`). No se renombró ninguna llamada.

#### Verificación (fixture, Inter; `main` = `bb263d0`)
1. **129d:** en el Historial, «Avisado 27/9 10:00» en un renglón a 360 y a 390 en todas las filas, claro y oscuro (0 partidos). El número tampoco se parte, ningún nombre de hasta 20 letras va en 3 renglones y los botones miden 44.
   - Alto de las filas a 360: «🏪 Local» 15 letras 81, 20 letras **95** (antes 83), 29 letras 95, 31 y 34 letras 109; web 15 letras 67, 20 letras 81 (antes 81), 29 letras 81, 31 y 34 letras 95.
   - Con 20 letras, en «🏪 Local» la línea de abajo ocupa 4 renglones («Avisado …» entero en el suyo y la etiqueta sola abajo); en la web, 3.
   - A 390: «🏪 Local» 20 letras 69, web 61.
2. **Los 18, forzados con el stub:** sin red en los 18, el repetido (23505) en los 3 de clientes y el genérico en los 18: **39 de 39** con el texto esperado y el error original en la consola.
3. **Las cinco barras de 128g:** 25 / 25 (repetido, sin red, sesión, permiso y otro en cada una). Las validaciones no cambian y `[MOTIVO-QUEDA]` sigue andando.
4. **Las dos funciones de escape**, sobre 20 valores raros (HTML, comillas, `&amp;`, saltos, emoji, `0`, `1.5`, `null`, `undefined`, `false`): en `main`, 4 diferencias (`0`, `null`, `undefined` y `false`) y ninguna escapaba `'`; en la rama, 0, y las dos escapan los cinco (`& < > " '`).
5. `vm.Script` de `admin.html`: sin errores. `npm run contraste`: 0 fallas + 1 token pisado, 295 mediciones.
6. Capturas a 390, claro y oscuro, del error sin red en cuatro de los 18 (stock, depósito, cliente nuevo y cierre), y de la Espera a 360 (Historial y Pendientes), en `herramientas\tanda-l\png\ronda-q-*`.

#### Hechos, sin tocar
- Hay **31 lugares más** del panel que muestran el error de la base con otras formas («✗ Error: …», «❌ …», `alert('Error al …')`). Uno va a `innerHTML` sin escapar, en «Reset contraseñas», pero es el mensaje de un `select` fijo → `[ERRORES-CRUDOS-OTROS]` 🟢.
- `saveCombo` guarda con `upsert` por `slug` (`'set-' + nombre`): un combo nuevo con el mismo nombre que otro lo pisa sin avisar. `combos` tiene el único de `slug` dos veces → `[COMBO-PISA-COMBO]` 🟢.
- Los textos de 128g («tocá Guardar de nuevo», «guardá de nuevo», «no puede guardar esto») quedaron tal cual también en las cargas (ranking, historial) y en los borrados: así lo pedía la regla.

### Sesión 28-sep-2026 · `_r` · `[SESION-CLIENTE]` (el catálogo con la llave del cliente) y `[TEL-CANONICO-PANEL]` · **sin mergear**

El prompt `_q` del PREPARADOR. El merge no está pre-aprobado porque toca el login de los clientes. La rama `sesion-cliente` salió de `ebad698` y se subió a GitHub (el PREPARADOR lo autorizó: describe el mecanismo, no el agujero). `443493b` (`js/app.js`) + `a3a0b72` (`admin.html`) + SW v1.1.150 (`d0de6e0`). Antes de arrancar, en la base (sólo lectura): los Bloques 1 y 2 ya estaban corridos por Alejo. Las 7 RPC (`anon` y `authenticated`), `cliente_de_token` sin EXECUTE, `cliente_sesiones` vacía y el trigger. Los slugs de `perfumes.js` (150), `perfumes_nuevos` (117), `combos` (5) y `favoritos` (97) cumplen `^[a-z0-9-]{1,120}$`. Los 100 teléfonos de `clientes` ya son `549` + 10. `cliente_login` reescribe la contraseña sólo al activar o al migrar a bcrypt, así que un login normal no corta las otras sesiones.

#### Qué se hizo
- **Entrar:** `cliente_entrar` en vez de `cliente_login`, con la llave en `st_cliente` (`currentUser.token`). Con `ok` / `activado` sin token no queda sesión («Error de conexión»). **El registro:** después de `cliente_registrar`, `cliente_entrar` con los mismos datos. Si no da, la cuenta quedó y se le pide entrar: la misma salida que una sesión sin llave. El prompt decía «que entre como hoy, sin token, y le pide entrar»; una sesión sin llave no podría escribir nada y la próxima carga la cerraría igual.
- **Salir:** `onLogout` llama a `cliente_salir(token)` sin esperar. `onLogout(true)` no llama.
- **Favoritos:** `mis_favoritos` y `favorito_marcar`. Al entrar (`onLogin(…, true)`), los de `st_favs` que no están en la base se suben, uno por llamada, y queda la unión. Al retomar la sesión guardada manda la base, como antes. Un slug que no cumple la regla de la base queda sólo en el dispositivo.
- **Votos:** `voto_guardar` y `mis_votos`. Los resultados agregados siguen con `select`. Un candidato vacío, de más de 120 o con un carácter de control no se manda (si no, el `false` se tomaría por una llave rechazada).
- **Mi selección:** `seleccion_guardar` con hasta 3 slugs. La lectura global sigue igual.
- **Sin llave:** `sesionSinLlave()`. Una sesión guardada sin token (de antes) o una RPC que contesta `false` con la llave de ahora cierra la sesión local sin RPC. Abre «Iniciá sesión» con el aviso en el subtítulo, una vez por carga (aunque fallen varias llamadas juntas), y `st_favs` queda. Es el default hasta que decida el DISEÑADOR. Si otra pestaña ya entró de nuevo (`st_cliente` con otra llave), su sesión no se toca.
- **El panel:** el alta, el alta desde puntos (el número se revisa antes de pedir el nombre; un prompt vacío dice «Cancelado») y la edición guardan `cleanPhone(…)` y validan con `esperaTelValido`. Si no da: «Revisá el número: 10 dígitos, sin 0 ni 15».

#### Verificación (fixture `ronda-r/fx-r.json` con `rpc:*`, stub que guarda lo que se escribe; Inter; a 390)
1. **Entrar → la llave guardada** (`tok-prueba-1`) y `cliente_entrar` con `5492970000011`. Además:
   - `mis_favoritos` y `mis_votos` (`p_mes` `2026-09`) con la llave;
   - favorito no / sí: 2 llamadas a `favorito_marcar`;
   - votar: `voto_guardar`;
   - la selección: `seleccion_guardar` con un array de 3;
   - salir: `cliente_salir` con la llave, `st_cliente` vacío y `st_favs` intacto;
   - **0 escrituras directas** a las tres tablas y 0 lecturas de `favoritos`. Quedan las lecturas de `votos` (mes anterior y resultados) y la global de `mi_seleccion`;
   - `grep` de las escrituras viejas: 0.
2. **Sesión vieja sin token:** al cargar, `st_cliente` y `st_waitlist` se borran, `st_favs` queda, no hay ninguna RPC de la llave y se abre «Iniciá sesión» con el aviso. Una segunda carga (iframe, mismo almacenamiento): sin aviso.
3. **Favoritos locales + entrar:** con `st_favs` = `your-touch-amber`, `slug-local-nuevo`, `Con Espacio` y la base con `your-touch-amber`, `yeah-parfum`, se sube sólo `slug-local-nuevo` (`Con Espacio` no cumple la regla y queda local). La lista queda como la unión, de 4.
4. **Llave rechazada** (`false` en `favorito_marcar`, `voto_guardar`, `seleccion_guardar`): se cierra sin `cliente_salir` y el aviso sale 1 vez aunque fallen 3 llamadas juntas. El voto no queda marcado ni se piden resultados. También dieron bien:
   - el registro (`cliente_registrar` → `cliente_entrar`) y el registro sin llave (se abre «Iniciá sesión» con el aviso);
   - la activación (`activado` con llave);
   - `ok` sin token (no queda sesión);
   - retomar (la base manda, 0 subidas, `mis_votos` con `p_mes`);
   - dos pestañas (la sesión nueva de la otra queda);
   - un candidato con tab o de 130 letras (no se manda, la sesión sigue).
5. **El panel**, en los tres lugares:
   - guardan `5492970000011`: «297 15 000 0011», «2970000011», «+54 9 297 000-0011», «0297 15 000 0011» y **«297 000 0011 x»** (`cleanPhone` saca la letra: quedan 10 dígitos, como en la Espera y el catálogo);
   - rechazan con «Revisá el número…»: «297 000 0011 5», «12345» y vacío (en el prompt de puntos, vacío es «Cancelado»);
   - un 23505 sigue saliendo «Ya existe un cliente con ese teléfono.».
6. `vm.Script` y `node --check`: ok. `npm run contraste`: 0 fallas + 1 token pisado, 295 mediciones. Capturas en `herramientas\ronda-r\png`: el aviso y «Iniciá sesión», a 390, claro y oscuro. El aviso da 13,07 en claro y 4,9 en oscuro.

#### La revisión adversarial (8 agentes: 4 lentes y un verificador por lente)
Salieron 5 arreglos, ya en la rama:
- el candidato que la base no acepta;
- `mis_votos` sin `p_mes` al retomar la sesión (`currentMes` se asigna más abajo en el archivo: daba un error de la RPC en cada carga);
- el registro sin llave con el aviso ya mostrado (cerraba la ventana sin decir nada);
- la pestaña con la llave vieja que borraba la sesión nueva de otra;
- el mensaje viejo de «Sumar punto».

Quedan para el PREPARADOR: `[FAVS-DISPOSITIVO-COMPARTIDO]`, `[PUNTOS-BUSCA-TEL-CRUDO]`, `[REGISTRO-LLAVE]`, `[SESION-BLOQUEADO]` y `[EDITAR-SIN-LIMITE]` (los dos últimos, SQL). Del DISEÑADOR: `[LOGIN-CLARO-CONTRASTE]`. De antes: `[VOTO-RETOMAR-APAGADO]` y `[BACKUP-SIN-FAVORITOS]`.
- `docs/BACKEND.md` describía S13 en «Deuda que queda». Pasó a la keyword sola, por la regla del 23-sep.


### Sesión 28-sep-2026 · `_s` · la ronda s sobre `sesion-cliente`: el aviso de la sesión vieja, los motivos, de quién son los favoritos, votar al retomar, «Sumar punto», 128i y la tarjeta de cliente · **sin mergear**

El prompt `_r` del PREPARADOR, sobre `origin/sesion-cliente` (`19258a1`), sin bump: la v1.1.150 nunca salió. El merge no está pre-aprobado. `e3d760e` (`js/app.js`, `index.html`, `css/styles.css`) + `8ae552f` (`admin.html`). En el punto 3 va la **opción A**: primero fue el default del prompt (el mensaje de Alejo traía el texto «(+ … si elegís B)» de la plantilla, sin elegir), y después **Alejo la confirmó** (28-sep), con las dos opciones graficadas. Antes de arrancar, en la base (sólo lectura): **el Bloque 2b ya estaba corrido**.
- `cliente_de_token` hace `join public.clientes` y pide `bloqueado is not true`.
- `cliente_editar` cuenta los fallos en `cliente_login_intentos` sobre el teléfono de la cuenta y devuelve `bloqueado`.
- Cierra `[SESION-BLOQUEADO]` y `[EDITAR-SIN-LIMITE]` (SECURITY.md § S28 y S29).

#### Qué se hizo
- **1 · la sesión vieja (decisión 130 del DISEÑADOR):** la IIFE encuentra `st_cliente` sin `token` y cierra la sesión local como antes, **sin abrir «Iniciá sesión»**. Sale el aviso chico `#avisoToast`:
  - la caja de `.cart-toast`, sin imagen ni ✓ (el toast del carrito no se tocó);
  - `role="status"`, con el texto exacto «Actualizamos el sitio: volvé a entrar con tu número y contraseña. Tus favoritos siguen guardados.»;
  - dura ~6 s, o hasta que lo toquen;
  - una vez por dispositivo (`st_aviso_reentrar`);
  - espera a `DOMContentLoaded` si hace falta.
  - Agregado de Claude Code: si hay `st_favs` sin marca, se marca con el `id` de esa sesión vieja (el código de antes no los marcaba). Así no se suben a otra cuenta.
- **2 · los otros motivos:** `sesionSinLlave(motivo, esperaSeg)`.
  - Llave rechazada → «Tu sesión se cerró: volvé a entrar con tu número y contraseña. Tus favoritos siguen guardados.» (una vez por carga).
  - Registro sin llave → «Tu cuenta quedó creada. Entrá con tu número y contraseña.» (siempre).
  - Registro con `bloqueado` → «…Por los intentos de antes, esperá N minutos…» (N con la cuenta del login: mínimo 1, «minuto» / «minutos»).
  - «Por seguridad, …» ya no está en el código. `switchAuthMode` vuelve a poner el subtítulo de siempre.
- **3 · `st_favs_de`:**
  - `saveFavs` la escribe con el `id` de la sesión.
  - Al entrar (`onLogin(user, true)`) se leen los favoritos del dispositivo (no los de la memoria de la pestaña). Sin marca o de la misma cuenta, se suben los que faltan y queda la unión. De otra cuenta, no se sube nada y queda lo de la base.
  - Al retomar la sesión, si la marca es de otra cuenta, también manda la base.
  - «Cerrar sesión» borra `st_favs` y `st_favs_de` (opción A); la salida forzada los deja.
- **4 · «Editar perfil»:** `bloqueado` → «Demasiados intentos. Esperá 15 minutos y volvé a probar.», antes del `!== 'ok'`.
- **5 · «Sumar punto»:** `soloDig` (sin espacios, `+`, guiones ni paréntesis), `esNumero` sobre eso, y la búsqueda con `cleanPhone` cuando da válido.
- **6 · votar al retomar la sesión:** `renderVotoButtons` termina con `if (currentUser) unlockVoting()`. `unlockVoting` sin botones sólo oculta el candado y el CTA, y los botones se habilitan cuando ya se saben mis votos.
- **7 · 128i:** `errorEnCriollo(err, ctx, que, tocaGuardar)`.
  - «tocá Guardar / guardá de nuevo» sólo con `tocaGuardar`: Editar («Guardar cambios»), la escalera («Guardar»), la promo («Guardar promo»), las marcas («Guardar») y Nuevo **sólo al editar** (dice «Guardar cambios»; al agregar dice «Agregar perfume»).
  - Todo lo demás dice «probá de nuevo».
- **7 · `[CLIENTES-FECHA-TEL]`:** sin `created_at` (o inválida) no hay `<span>`. El 📱 muestra `formatPhoneDisplay`, y `data-tel` y el link de WhatsApp siguen crudos.

#### Verificación (fixtures `ronda-s/fx-s*.json` con `rpc:*`, stub `ronda-s/stub-s.js`; 390)
- **a · sesión vieja:**
  - el aviso con el texto exacto y `role="status"`; `st_aviso_reentrar = '1'`; sin modal; `st_favs` intacto y `st_favs_de` con el id de esa sesión; 0 RPC de la llave;
  - se fue a los 6,2 s del `DOMContentLoaded`, y a los 0,32 s de tocarlo;
  - una segunda carga con otra sesión vieja (iframe): se cierra, sin aviso y sin modal.
  - Contraste: 16,95 en oscuro y 15,12 en claro.
- **b · llave rechazada:** 3 fallas juntas, 1 modal con «Tu sesión se cerró…», sin `cliente_salir`. Al cambiar de pestaña, al volver a «Iniciá sesión» o al reabrir, el subtítulo de siempre.
- **c · registro sin llave:** con el aviso de b ya mostrado en la misma carga, igual sale «Tu cuenta quedó creada…». Con `bloqueado` y 600 s, «esperá 10 minutos»; con 30 s, «esperá 1 minuto».
- **d · el dueño:**
  - invitado + entrar: se sube sólo lo que falta;
  - salida forzada: quedan `st_favs` y `st_favs_de`;
  - de otra cuenta + entrar: 0 `favorito_marcar`, queda lo de la base;
  - «Cerrar sesión»: los dos borrados, 0 corazones, el badge en 0;
  - una pestaña con otra lista en memoria: se sube lo del dispositivo;
  - retomar con la marca de otra cuenta y la base vacía: 0 favoritos.
- **e · Editar perfil** con `bloqueado`: el texto.
- **f · «Sumar punto»:** «2970000011», «297 15 000 0011» y «+54 9 297 000-0011» buscan `5492970000011`, encuentran al cliente y no piden nombre. «Juan» busca por nombre.
- **g · 128i:**
  - el stock y el cierre sin red, y el stock con la sesión vencida: «probá de nuevo»;
  - Editar, la escalera y Nuevo al editar, sin red: «tocá Guardar de nuevo»;
  - Nuevo al agregar: «probá de nuevo»;
  - la prueba de las 5 barras de 128g da 23 de 25 iguales, y las 2 que cambian son Nuevo al agregar;
  - `grep`: «tocá Guardar» y «guardá de nuevo» sólo en la rama con `tocaGuardar`.
- **h · votar al retomar la sesión:** 4 botones. La categoría votada con sus resultados («3 votos»), la otra habilitada, y `mis_votos` una vez (con `p_mes`). Un invitado: 4 de 4 deshabilitados.
- `vm.Script` y `node --check`: ok. `npm run contraste`: 0 fallas + 1 token pisado, 295 mediciones. 0 `!important` nuevos.
- 14 capturas en `herramientas\ronda-s\png`. La regresión de la ronda r (entrar, favoritos, votar, selección, salir) da igual.

#### La revisión adversarial (8 agentes: catálogo, contrato, panel y seguridad, cada uno verificado)
- 3 arreglos en la rama:
  - al entrar, la lista del dispositivo y no la de la memoria;
  - al retomar, la marca de otra cuenta;
  - los botones de votar, recién con mis votos.
- 6 pendientes nuevos, 🟢: `[CLIENTES-BUSCA-TEL-FORMATO]`, `[TELEFONO2-MUERTO]` (lo pidió el PREPARADOR), `[AVISO-TAPA-LOGIN]`, `[FAVS-MARCA-BORDES]`, `[AUTH-BAJO-DETALLE]` y `[EDITAR-BLOQUEADO]`.

### Sesión 28-sep-2026 · `_t` · el merge de `sesion-cliente` (v1.1.150) y la tanda chica v1.1.151 en `pulido-login` · **sin mergear**

El prompt `_s` del PREPARADOR.

#### El merge de `sesion-cliente`
- Con la revisión del PREPARADOR y el OK de Alejo en el chat: fast-forward `ebad698..5f17464` a las **22:22 (ART) del 28-sep**. Desde esa hora cuentan las 24 h para el Bloque 3.
- Producción: `sw.js` en v1.1.150 a los 30 s. `sw.js`, `js/app.js`, `admin.html`, `index.html` y `css/styles.css` son iguales, byte a byte, a `5f17464`.
- Prueba de humo **sin cuenta** (el navegador del panel de Claude Code):
  - 192 cards, sin sesión, ni aviso, ni modal;
  - 0 errores en la consola;
  - 17 pedidos a Supabase, todos sin error (`perfume_clicks_resumen` y 16 tablas).

#### La tanda chica (rama `pulido-login` desde `5f17464`)
`e42a32e` (catálogo: `js/app.js`, `index.html`, `css/styles.css`, `scripts/contraste.js`) + `fea3057` (`admin.html`, `api/cron/backup.js`) + SW v1.1.151 (`57bfede`).

**En el punto 2.9 va la opción A.** Primero fue el default del prompt (el mensaje de Alejo traía otra vez el texto de la plantilla, sin elegir); después **Alejo la confirmó** (28-sep). La rama `sesion-cliente` se borró, en la compu y en GitHub, con su OK. Antes de arrancar, en la base (sólo lectura), **el Bloque 2c ya estaba corrido**:
- `cliente_editar` devuelve `TABLE(estado text, espera_seg integer)`, mira `v_cli.bloqueado` y avisa por Telegram;
- cierra `[EDITAR-BLOQUEADO]` (SECURITY.md § S30).

- **2.1:** «Tu cuenta quedó creada. Hubo muchos intentos con este número: esperá N minutos y entrá con tu número y contraseña.»
- **2.2:** «Editar perfil» con `bloqueado` → «Demasiados intentos. Esperá N minutos y volvé a probar.» (N de `espera_seg` con la cuenta del login; 15 si no viene).
- **2.3 · 131 `[LOGIN-CLARO-CONTRASTE]`, sólo en claro:**
  - «ENTRAR» / «Unirme» / «Guardar cambios» `#1a1a1d` → 9,33;
  - «Creá una» / «Iniciá sesión» `--amarillo-tinta` → 6,25;
  - «¿Olvidaste tu contraseña?» `#5e564a` → 6,29.
  - Los 6 links de la ventana, más el de «Este número ya está registrado», pasan de `style` inline a `.auth-link` / `.auth-link-sec`. El oscuro, igual (10,06 · 9,33 · 9,04).
  - La ventana entra en `npm run contraste` (10 filas).
- **2.4 · 128j `[ERRORES-CRUDOS-OTROS]`:**
  - los 31, `loadResetRequests` (con `escHtml`), `loadClientes` (antes decía «Sin clientes registrados»; ahora buscar o filtrar no tapa el error) y los «Revisá permisos en Supabase (RLS)» pasan por `errorEnCriollo`. Los de puntos los pidió el PREPARADOR; los otros tres (editar, bloquear y borrar cliente) son iguales;
  - también los dos de «Enviar push»: sin sesión y el error del servidor. Pero el tope de 5 envíos por día (429) conserva su propio mensaje;
  - se sacan los íconos «✗ Error:» / «❌» de los errores (el rojo queda);
  - `tocaGuardar` donde el botón dice «Guardar»: la etiqueta, los beneficios, el mensaje, el slide, el decant y la config de puntos.
- **2.5 `[CLIENTES-BUSCA-TEL-FORMATO]`:** si lo buscado parece un número (dígitos, espacios, `+`, guiones, paréntesis), también por los dígitos del teléfono.
- **2.6 `[AUTH-BAJO-DETALLE]`:** `.auth-overlay` en `z-index` 10005 siempre (se va la regla de los juegos).
- **2.7 `[AVISO-TAPA-LOGIN]`:** el aviso 130 se cierra solo al abrir «Iniciá sesión» o al aparecer el del carrito.
- **2.8 `[TELEFONO2-MUERTO]`:** fuera de la tarjeta y de la búsqueda.
- **2.9 `[BACKUP-SIN-FAVORITOS]` (A):** `favoritos` y `mi_seleccion` en las dos listas. Queda: panel 14, cron 15; la única diferencia, `ventas`, como antes.

#### Verificación (fixtures y stub `ronda-t/stub-t.js`: lecturas que fallan y escrituras sin filas; 390)
- **a:** `bloqueado` 600 s → «esperá 10 minutos»; 45 s → «1 minuto».
- **b:** 180 s → «Esperá 3 minutos»; 40 s → «1 minuto»; sin `espera_seg` → «15 minutos»; `pass_incorrecta` sigue «Contraseña incorrecta».
- **c:** en el DOM, los mismos números que `contraste.js`, en «Iniciá sesión», «Unite a ST» y «Recuperá tu cuenta»; 0 links con color inline.
- **d:** el `grep` de los patrones viejos da 0, salvo dos que no son errores de la base: la validación fija «Error: esta opinión no tiene ID válido» y el «❌» del contador de pushes fallidas. Forzados:
  - clientes sin red → «…probá de nuevo»;
  - beneficios sin red → «…tocá Guardar de nuevo»;
  - «Reset contraseñas» con la sesión vencida → «Se venció la sesión. Volvé a entrar y probá de nuevo.»;
  - sumar punto con 0 filas → el genérico en su `alert`;
  - resetear la contraseña → el genérico en su `alert`;
  - el original en la consola, en los 5.
- **e:** «+54 9 2970 00-0011», «2970 00-0011» y «297 000» encuentran; «Clienta», «web uno», «Clienta 297» y «Uno 0011», por nombre (y teléfono). Sin 📞.
- **f:** la llave rechazada con el detalle abierto: «Iniciá sesión» (10005) arriba del detalle (10000); lo que se ve arriba es la ventana.
- **g:** el aviso 130 se cierra al abrir el login y al aparecer el toast del carrito.
- **h:** las dos listas del backup; `node --check api/cron/backup.js`.
- `vm.Script`, `node --check` (app, extras, backup.js, contraste.js): ok. `npm run contraste`: 0 fallas + 1 token pisado, **305** mediciones. 0 `!important` nuevos.
- 8 capturas en `herramientas\ronda-t\png`.

#### La revisión adversarial (8 agentes: errores, login, clientes y backup, regresiones; cada uno verificado)
- 5 arreglos en la rama:
  - la búsqueda por dígitos, sólo si lo buscado parece un número;
  - el 429 de los pushes con su mensaje;
  - el error de carga de clientes, que no se tapa al buscar o filtrar;
  - el comentario de `errorEnCriollo`;
  - dos comentarios de CSS con el `z-index` 2000 viejo.
- 4 pendientes nuevos, 🟢: `[COMBO-BORRA-SIN-MIRAR]`, `[CRIOLLO-BORDES]`, `[LOGIN-CLARO-TELEFONO]` y `[LOGIN-CAMPOS-QUEDAN]` (este último, de las capturas).

### Sesión 28→29-sep-2026 · `_u` · el merge de `pulido-login` (v1.1.151), el Bloque 3 (S13 cerrado) y la tanda v1.1.152 en `pulido-panel` · **sin mergear**

El prompt `_t` del PREPARADOR.

#### La hora
- Los docs y los reportes de las rondas s y t tenían la hora en UTC: en Git Bash, `TZ=America/Argentina/Buenos_Aires date` devuelve UTC sin avisar. Lo vio el PREPARADOR contra la hora del deploy de Vercel.
- Corregido en los docs: el merge de `sesion-cliente` fue a las **22:22 (ART) del 28-sep** (no a las 01:22 del 29), el Bloque 3 podía correr **desde el 29-sep a las 22:22**, y todo lo de las rondas s y t, con las decisiones A de Alejo, es del **28-sep**.
- Quedan con la fecha vieja los mensajes de `bfdc69c` y `4458f2f` (la historia de git no se reescribe) y los nombres de los reportes `_s` y `_t` en `_correo_agentes`.
- Desde ahora la hora sale de `date` a secas o de `Intl` de Node.

#### El merge de `pulido-login`
- Con la revisión del PREPARADOR y el OK de Alejo en el chat: fast-forward `5f17464..4458f2f` a las **23:21 (ART) del 28-sep**.
- Producción: `sw.js` en v1.1.151; `sw.js`, `js/app.js`, `admin.html`, `index.html` y `css/styles.css`, iguales byte a byte a `4458f2f`.
- Prueba de humo **sin cuenta**: 192 cards, sin sesión ni ventana, 17 pedidos a Supabase sin error, 0 mensajes en la consola, 0 links de la ventana con color inline (la 131) y «Iniciá sesión» en `z-index` 10005.
- Quedan en producción los 7 de la ronda t: `[ERRORES-CRUDOS-OTROS]`, `[LOGIN-CLARO-CONTRASTE]`, `[BACKUP-SIN-FAVORITOS]`, `[CLIENTES-BUSCA-TEL-FORMATO]`, `[TELEFONO2-MUERTO]`, `[AVISO-TAPA-LOGIN]` y `[AUTH-BAJO-DETALLE]`.

#### El Bloque 3: S13 cerrado
- **Ya estaba corrido** cuando se miró, el 28-sep a las ~23:25 (ART): una hora después de la v1.1.150, no 24 h. Se volvió a verificar el 29-sep a las 02:23.
- `pg_policies`: `favoritos` sólo con `favoritos_panel_lee` (SELECT, `authenticated`), `votos` sólo con «Ver votos» y `mi_seleccion` sólo con «Mi seleccion lectura publica» (SELECT).
- `anon` sin permisos de tabla en las tres; por columna lee `votos (categoria, mes, slug)` y `mi_seleccion (slugs)`, lo que usa el catálogo. `has_column_privilege('anon', 'public.votos', 'user_id', 'SELECT')` falso. RLS prendida en las tres.
- `clientes` con `clientes_telefono_canonico` y `clientes_nombre_limpio`.
- Cierra **`[S13-ESCRITURAS-ANON]`** con el detalle (SECURITY.md § S13). La parte de `opiniones` que nombraba S13 en mayo ya no aplica: hoy la tabla no guarda a quién escribe.

#### La tanda v1.1.152 (rama `pulido-panel` desde `4458f2f`)
`d9c0a44` (`admin.html`, `js/app.js`, `css/styles.css`, `scripts/contraste.js`) + SW v1.1.152 (`c8bb2f2`).

- **2.1 · 132 `[CLIENTES-CLARO-CONTRASTE]`:** los colores inline de la tarjeta de «Clientes» (WhatsApp, ⭐ +1 punto, 📜 Historial y las dos etiquetas) pasan a clases con su versión `body.light`: `.client-btn-wa`, `.client-btn-punto`, `.client-btn-historial`, `.client-tag-compro` y `.client-tag-nocompro`. En claro cambia sólo la letra: WhatsApp `#1e7a3c`, Bloquear `#9a5a00`, Eliminar y ✗ NO COMPRÓ `--stat-tinta-out`, ✓ COMPRÓ `--stat-tinta-inv`; Historial conserva el `#333` que le ponía el parche por atributo. Editar, blanco sobre `#2170b0` en los dos temas (Combos usa la misma clase).
- **2.2 `[LOGIN-CLARO-TELEFONO]`:** lo de debajo del número (`.tel-ok`, `.tel-mal`, `.tel-falta`) y el mensaje (`.auth-error`, con `.auth-ok` para el verde) por clase, con `authMsgOk(el, ok)`. En claro `#1b5e20`, `#b8342a` y `#5e564a`. La regla `body:not(.dark-mode) .auth-modal p` pasa a `p:not(.auth-error)`: el mensaje ya no queda en gris.
- **2.3 `[CRIOLLO-BORDES]`:**
  - sin conexión = `navigator.onLine === false` o el mensaje de la red; se va `e.name === 'TypeError'`;
  - un 42501 al leer (`que` empieza con «cargar», o «descargar el backup») → «Esta cuenta no puede ver esto.»;
  - `tocaGuardar` en los cinco de 128h con «Guardar»: Depósito, editar cliente, «Guardar horario», «Guardar combo» y «GUARDAR CANDIDATOS»;
  - los mensajes propios: **`errorPropio(texto)`** arma un `Error` con `propio = true` y `errorEnCriollo` lo devuelve tal cual. Lo usan los tres rechazos de `compressToWebP` («No se pudo comprimir», «Imagen inválida», «No se pudo leer»).
- **2.4:** `[COMBO-BORRA-SIN-MIRAR]` (`deleteCombo` pide la fila: con error o con 0 filas, el combo sigue en la lista, sin Log ni Telegram) y `[COMBO-PISA-COMBO]` (al crear, «Ya existe un combo con ese nombre.» sin escribir si el `slug` ya está en la lista; si no, `insert`, y el 23505 da el mismo mensaje y recarga la lista; editar, `upsert` como antes).
- **2.5 `[LOGIN-CAMPOS-QUEDAN]`:** `limpiarCamposAuth()` en `onLogin` cuando entra, en el registro y en `onLogout`.
- **2.6:** el Bloque 3, arriba. **2.7:** el bump, aparte.

#### Verificación (fixtures, stub `ronda-t/stub-t.js`, 390; `herramientas/ronda-u`)
- **a · 132**, en el DOM, con el fondo compuesto:
  - en claro, WhatsApp 4,80 · Bloquear 4,87 · Eliminar 4,86 · ✗ NO COMPRÓ 5,06 · ✓ COMPRÓ 7,15 · ⭐ +1 punto 6,66 · Historial 10,57;
  - Editar 5,24 en los dos temas; «Desbloquear» (negro sobre `#f39c12`) 9,58 en los dos: no hizo falta tocarlo;
  - el oscuro, contra `main` (`4458f2f`), igual en color, fondo, alto y forma salvo Editar; colores inline en la tarjeta: 0 (en `main`, 9).
- **b · el teléfono**, en claro:
  - «dígitos faltan» 6,29 · «demasiados dígitos» 5,13 · ✓ 6,85 · «no coinciden» 5,13 · «coinciden» 6,85 · el error 5,13 · el ✓ del mensaje 6,85;
  - en `main`: 2,48 / 3,33 / 2,50 / 3,33 / 2,50, y el error y el ✓ en gris (13,07). El oscuro, igual a `main` en los 8.
- **c · `errorEnCriollo`:**
  - un `TypeError` del código → el genérico; «Failed to fetch», «Load failed», «network error» y los dos de Safari 16 → «No se pudo conectar»;
  - 42501 al cargar los clientes → «Esta cuenta no puede ver esto.» en la lista;
  - un archivo que no es una imagen en «Editar» → «Imagen inválida»;
  - sin red, Depósito, editar cliente, horario, combo y votación → «…tocá Guardar de nuevo.».
- **d · combos:**
  - el `delete` con error o con 0 filas → sigue en la lista, sin Log ni Telegram, y el `alert` genérico; borrar bien → Log y 1 Telegram;
  - crear «Asad» (`set-asad`, ya en la lista) → el mensaje, 0 escrituras;
  - crear uno que la base tiene (23505) → el mensaje, un `insert` y la lista recargada;
  - doble toque en «Guardar combo» → un solo `insert` y «Combo creado ✓»; el botón vuelve al cerrarse el formulario;
  - editar → `upsert`, «Combo actualizado ✓».
- **e · la ventana de entrar:**
  - vacía después de entrar, de cerrar sesión y reabrir, de registrarse y del registro sin llave;
  - después de entrar mal, los campos quedan (para corregir);
  - en `main`, el número y la contraseña seguían escritos al reabrir después de cerrar sesión.
- `vm.Script` y `node --check` (app, extras, contraste): ok. `npm run contraste`: **0 fallas** + 1 token pisado + **2 conocidas** (`[CLIENTES-OSCURO-ROJO]`), **333** mediciones (antes 305). 0 `!important` nuevos.
- 7 capturas en `herramientas\ronda-u\png`.

#### La revisión adversarial (10 agentes: 4 revisores y un verificador por hallazgo)
- CSS y contraste: 0 hallazgos.
- 6 confirmados. 5 arreglados en la rama:
  - el regex de red suma los mensajes de Chrome y Safari que faltaban;
  - «descargar el backup» cuenta como lectura;
  - `deleteCombo` detecta las 0 filas;
  - «Guardar combo» se apaga mientras guarda: con `insert`, un segundo toque sobre un alta que salió bien decía «Ya existe…»;
  - el 23505 al crear recarga la lista.
- 1 queda como opción, para el PREPARADOR: el registro sin llave vacía el número y la contraseña, y «Iniciá sesión» pide escribirlos de nuevo. Es la lectura literal del 2.5 («registrarse bien»). La otra opción es dejarlos, como en `main`, para entrar con un toque cuando termina la espera.
- 2 pendientes nuevos, 🟢, del DISEÑADOR: `[CLIENTES-OSCURO-ROJO]` y `[CLIENTES-HOVER]`.

### Sesión 29-sep-2026 · `_v` · el merge de `pulido-panel` (v1.1.152) y la tanda v1.1.153 en `pulido-textos` · **sin mergear**

El prompt `_u` del PREPARADOR.

#### El merge de `pulido-panel`
- Con la revisión del PREPARADOR y el OK de Alejo en el chat: fast-forward `4458f2f..8da11ab` a las **02:35:08 (ART) del 29-sep**.
- Producción: `sw.js` en v1.1.152 a los 20 s; `sw.js`, `js/app.js`, `admin.html`, `index.html` y `css/styles.css`, iguales byte a byte a `8da11ab`.
- Prueba de humo **sin cuenta**: 192 cards, sin sesión ni ventana, 17 pedidos a Supabase todos 200, 0 errores en la consola.
- Con el mismo OK se borró `pulido-login` (`4458f2f`, ya en `main`), en la compu y en GitHub.
- Quedan en producción los 5 de la ronda u: `[COMBO-PISA-COMBO]`, `[COMBO-BORRA-SIN-MIRAR]`, `[CRIOLLO-BORDES]`, `[LOGIN-CLARO-TELEFONO]` y `[LOGIN-CAMPOS-QUEDAN]`.

#### La tanda v1.1.153 (rama `pulido-textos` desde `8da11ab`)
`f693ea2` (`admin.html`, `js/app.js`, `scripts/contraste.js`) + SW v1.1.153 (`bade743`).

- **2.1 · 128k `[ERROR-AL-CARGAR]`:** `errorEnCriollo` sabe si es una carga (`que` empieza con «cargar») y el 4.º parámetro dice cómo se vuelve a pedir: `'↺'` o `'recargar'` (o nada).
  - Con ↺: el Log («↺»), Analítica («↺ Refrescar»), Backups («↺ Refrescar»), el historial de puntos («↺») y Decants de diseñador sólo para el jefe (el «↺ Recargar» de su barra llama a `loadDecantsCustom`). Sin red: «No se pudo conectar. Revisá internet y tocá ↺.»; genérico: «No se pudo cargar X. Tocá ↺; si sigue, avisale a Alejo.».
  - Sin botón: Reset contraseñas, Clientes, los mensajes, los slides, el ranking de puntos y Decants de diseñador para la empleada. «…recargá la página.» / «…Recargá la página; si sigue, avisale a Alejo.».
  - Sesión vencida: «Se venció la sesión. Volvé a entrar.». El 42501, «Esta cuenta no puede ver esto.». «descargar el backup» (se hace con un botón), guardar, borrar y sumar, como antes.
  - El ranking y el historial de puntos no miraban `r.error`: un error se veía como «Sin clientes» / «Sin movimientos» (ya pasaba en `main`; salió de la revisión).
- **2.2, opción B** (el default: Alejo no eligió A): un registro que termina **sin** sesión deja el número y la contraseña en «Iniciá sesión», con la vista previa del número; el nombre y «repetí tu número», que ahí no se usan, se vacían. Con sesión, los vacía `onLogin` como antes.
- **2.3 `[HORARIO-BORRA-ANTES]`:** `saveAjuste` inserta primero (`.select('id').single()`) y, si salió, borra sólo los **anteriores** (`lt('id', nuevo)`). El catálogo y el panel leen el más nuevo (`order created_at desc, limit 1`): si por un momento hay dos filas, manda el nuevo. «Guardar horario» se apaga mientras guarda. Si falla el borrado, el nuevo queda y manda, el formulario también, y el aviso («Horario guardado: … . No se pudo …») no se va solo. «Volver al horario normal» borra todos (`neq('id', 0)`) y mira el error.
- **2.4:** `[CLIENTES-OSCURO-ROJO]` (Eliminar y ✗ NO COMPRÓ `#ff8a80` en oscuro) y `[CLIENTES-HOVER]` (los `:hover` en `@media (hover: hover)`; Editar `#1a5a8f`; Bloquear y Eliminar sobre `.18`). Combos usa las mismas clases.
- **2.5:** el bump, aparte.

#### Verificación (fixtures, stub `ronda-v/stub-v.js`: el de la ronda t más los filtros de cada escritura, el id del insert y `__fallaOp`; 390)
- **a · 128k**, jefe y empleada: Clientes, sin red / genérico / sesión / 42501 → «…recargá la página.» / «No se pudo cargar los clientes. Recargá la página; …» / «Se venció la sesión. Volvé a entrar.» / «Esta cuenta no puede ver esto.». El Log y el historial de puntos, con «tocá ↺». Decants de diseñador: «tocá ↺» el jefe, «recargá la página» la empleada. El ranking, «recargá la página». «descargar el backup» sin red → «…probá de nuevo.».
- **b · 2.2 (B):** registro con `cliente_entrar` = `'bloqueado'` → «Iniciá sesión» con el número y la contraseña, la vista previa «📱 +54 9 2970 00-0022 ✓», y el nombre y el número repetido vacíos. Un toque en «Entrar» (después) llama a `cliente_entrar` con esos datos y entra; los campos quedan vacíos. Registro con llave → vacíos.
- **c · 2.3:**
  - el `insert` fallando → no hay `delete`, el ajuste de antes sigue, sin Telegram;
  - el `insert` bien → `delete lt(id, nuevo)`, 1 Telegram, el formulario se vacía;
  - el borrado fallando → el aviso con los dos textos, el formulario queda, 1 Telegram, y a los 3 s sigue;
  - doble toque en «Guardar horario» → un solo `insert` y un solo `delete`;
  - el temporizador de un guardado anterior no borra el aviso del siguiente;
  - «Volver al horario normal» → `delete neq(id, 0)` y 1 `horario_reset` en el Log; si falla, el aviso y 0 en el Log.
- **d · 2.4**, en el DOM:
  - oscuro: Eliminar 7,13 y ✗ NO COMPRÓ 7,39;
  - con mouse: Editar 7,23 en los dos temas; claro Bloquear 4,76 y Eliminar 4,67; oscuro 6,31 y 6,86;
  - las tres reglas `:hover` están sólo dentro de `(hover: hover)`: sin mouse el botón queda con su fondo y su letra.
- `vm.Script` y `node --check`: ok. `npm run contraste`: **0 fallas** + 1 token pisado, **339** mediciones (sin conocidas). 0 `!important` nuevos.
- 6 capturas en `herramientas\ronda-v\png`.

#### La revisión adversarial (12 agentes: 3 revisores y un verificador por hallazgo)
- 7 confirmados, 2 descartados. 6 arreglados en la rama:
  - el ranking y el historial de puntos miran `r.error`;
  - **el doble toque en «Guardar horario» podía dejar la tabla vacía** (regresión del orden nuevo con `neq`): se borra con `lt` y el botón se apaga;
  - si falla el borrado, el formulario queda (el aviso pide guardar de nuevo);
  - «Volver al horario normal» borra todos y mira el error (ya pasaba en `main`);
  - el temporizador de 3 s ya no borra un aviso nuevo;
  - en la B, el nombre y «repetí tu número» se vacían y el número muestra su vista previa.
- 1 queda, porque es parte de la B: con `'bloqueado'`, la contraseña queda en la ventana durante la espera (misma pestaña, sin recargar).
- Descartados: el ↺ de Decants para el jefe (está en su barra, a la vista) y `docs/DATABASE.md` con el orden viejo (se corrige en estos docs).

### Sesión 29-sep-2026 · `_w` · el merge de `pulido-textos` (v1.1.153), las capturas al DISEÑADOR y la tanda v1.1.154 en `pulido-clientes` · **sin mergear**

El prompt `_v` del PREPARADOR.

#### El merge de `pulido-textos` (antes del prompt)
- Alejo lo autorizó en el chat, antes de que lo revisara el PREPARADOR: fast-forward `8da11ab..91c7e37` a las **03:05:57 (ART) del 29-sep**. El PREPARADOR lo revisó después, sobre `main`, y lo aprobó.
- Producción: `sw.js` en v1.1.153 a los 25 s; los 5 archivos, iguales byte a byte a `91c7e37`. Prueba de humo sin cuenta: 192 cards, sin sesión ni ventana, 17 pedidos a Supabase todos 200, 0 errores en la consola.
- Borradas `pulido-panel` y `pulido-textos` (las dos ya en `main`), en la compu y en GitHub, con el OK de Alejo.
- Quedan en producción `[CLIENTES-OSCURO-ROJO]`, `[CLIENTES-HOVER]` y `[HORARIO-BORRA-ANTES]`.
- Para el DISEÑADOR, las capturas de 132c en la tablet: el capturador de `herramientas` suma `--tactil` (hover: none, pointer: coarse, toque de verdad). Después del toque, «Editar» sigue con `#2170b0` aunque el navegador lo marque `:hover`; con el mouse encima, `#1a5a8f`.

#### Reglas nuevas (prompt `_v`, decisión de Alejo)
- En cada tanda, `ClaudeCode_para_Disenador_<fecha>_<letra>.md` además del reporte al PREPARADOR: las capturas (ruta, qué muestra, qué mirar, números) y los 📐, sólo como datos. El de la ronda v (`ClaudeCode_para_Disenador_2026-09-29_v.md`, 11 capturas) salió al principio de esta sesión.
- El OK de un merge es la línea del PREPARADOR («…revisada y aprobada por el PREPARADOR»).
- Un rato de la sesión el chequeo automático del modo auto no respondió (ni a un `date`): se siguió con Alejo aprobando cada acción.

#### La tanda v1.1.154 (rama `pulido-clientes` desde `91c7e37`)
- **2.1 · 132d `[CLIENTES-BLOQUEADO-BADGE]`:** `.client-blocked-badge` sobre `var(--rojo-fondo)` (`#b8342a`, el de `.modal-btn-danger`): blanco encima **5,89** en los dos temas (antes `#e74c3c`, 3,82).
- **2.2 `[PANEL-HOY-UTC]`:** `loadCierres` y `loadAjuste` usan `resumenHoyART()` (la que ya existía, ~L11365). `loadCierres` mira el error: `errorEnCriollo(error, null, 'cargar los cierres', 'recargar')` dentro de la tabla (antes, un error decía «No hay cierres programados»). ~L8247 (`addCierre`, `fechas.push(d.toISOString()…)`) **no** tiene el problema: cada fecha se arma al mediodía local, y en Argentina (UTC−3) eso cae el mismo día en UTC.
- **2.3 · la concordancia:** `noSePudo(que)` en `errorEnCriollo`: «No se pudieron …» si lo que sigue al verbo empieza con «los» o «las» («No se pudieron cargar los clientes», «No se pudieron guardar los beneficios»); los singulares, igual («No se pudo cargar el log»).
- **2.4:** el bump, aparte.

#### Verificación (fixtures, stub `ronda-v/stub-v.js`, reloj falso en `--antes`; 390; contra `main` = `91c7e37`)
- **a · 132d:** «BLOQUEADO» blanco sobre `#b8342a` → **5,89** en claro y en oscuro (`main`: sobre `#e74c3c`, 3,82).
- **b · 2.2**, con el reloj a las **22:30 del 29-09 (ART)** = 01:30 UTC del 30-09:
  - el ajuste que termina el 29-09 se ve (`main`: escondido);
  - el cierre del 29-09 no sale como pasado (`main`: sí); el del 28-09 sí, el del 01-10 no;
  - `loadCierres` con error: sin red «No se pudo conectar. Revisá internet y recargá la página.», genérico «No se pudieron cargar los cierres. Recargá la página; si sigue, avisale a Alejo.», sesión vencida «Se venció la sesión. Volvé a entrar.».
- **c · 2.3:** «No se pudieron cargar los clientes. Recargá la página; …» (también en la pantalla de Clientes), «No se pudieron guardar los beneficios. Probá de nuevo; …», «No se pudo cargar el log. Tocá ↺; …», «No se pudieron cargar las estadísticas…», «No se pudo sumar el punto…», «No se pudieron ajustar los puntos…», «No se pudo guardar.» (por defecto).
- `vm.Script`: ok. `npm run contraste`: **0 fallas** + 1 token pisado, **341** mediciones (la etiqueta, en los dos temas).
- 4 capturas en `herramientas\ronda-w\png`.

#### La revisión (a mano)
- Se lanzó la revisión adversarial con agentes (2 revisores), pero se frenó a los segundos: con la sesión en el modo que pide permiso para cada acción, los agentes de fondo no podían avanzar. La hizo Claude Code a mano, sobre el diff (81 líneas):
  - `resumenHoyART` es una función del script principal del panel: la prueba b la usa desde `loadCierres` y desde `loadAjuste`;
  - su formato (`YYYY-MM-DD`) es el de `cierres_especiales.fecha` y `ajuste_horario.hasta`;
  - el error de `loadCierres` va escapado (`escHtml`); `loadCombos` también la llama y `#tbodyCierres` existe siempre;
  - `--rojo-fondo` sólo se define en `:root`, así que es el mismo en los dos temas; `.client-blocked-badge` sólo se usa en la tarjeta de Clientes;
  - las 66 llamadas a `errorEnCriollo`: todos los `que` empiezan con el verbo; los plurales empiezan con «los» o «las» (ninguno con «unos», «sus» o parecido); sin `que`, queda «guardar».
- 0 hallazgos.

### Sesión 29-sep-2026 · `_x` · el merge de `pulido-clientes` (v1.1.154), la tanda v1.1.155 en `carga-fallida` · **sin mergear** · y el arranque de los dos temas (sólo medido)

El prompt `_w` del PREPARADOR.

#### 0 · El merge de `pulido-clientes`
- OK de Alejo con la línea del PREPARADOR: fast-forward `91c7e37..ac74be1` a las **03:50:18 (ART) del 29-sep**. Vercel sirvió `ac74be1` a los ~29 s: los archivos, iguales byte a byte. Prueba de humo sin cuenta: 192 cards, 17 pedidos a Supabase todos 200, 0 errores en la consola.
- `pulido-clientes` borrada, en la compu y en GitHub. Cierra `[PANEL-HOY-UTC]` (y quedan en producción 132d y la concordancia).

#### 1 · La tanda v1.1.155 (rama `carga-fallida` desde `ac74be1`)
- **1.1 · 128m `[CARGA-FALLIDA-CERO]`:** un contador que depende de una carga dice «—» (con la palabra) mientras carga y si la carga falla; «0» sólo con la carga buena y 0 de verdad. Inventario con 3 agentes buscando por separado (el HTML, el JS y las cargas: 53, 42 y 44 contadores). Lo que se tocó, y qué decía en `main` con la carga fallida:
  - Clientes (`#clientCount`): «0 clientes» → «— clientes» (también mientras carga, y buscar no lo pisa).
  - Combos (`#comboCount`): «4 combos», los de `perfumes.js` → «— combos» y el error en vez de la lista (`loadCombosFromDB` ignoraba el error).
  - La Espera (ESPERANDO, PERFUMES y «Pendientes (N) / Historial (N)»): «0» y «0» sin aviso (o los números de antes) → «—» y el error en vez de «Nadie esperando».
  - Nuevos (`#nuevosCount`): «0» y «Sin perfumes agregados aún» → «—» y el error (buscar no lo tapa con «Sin resultados»).
  - Destacados (`#destacadosCount`): «0/7» y «No hay destacados. Buscá un perfume arriba para agregar.» → «—/7» y el error.
  - Push (`#pushSubCount`): «0» → «—» (supabase-js no tira; el «?» del `catch` casi no salía).
  - Estadísticas: 👥 Clientes, 💬 Opiniones, 👁️ Visitas y 📊 Promedio en «0» → «—»; el top 10 decía «Sin datos aún» y «los olvidados» mostraba todos los perfumes → el error y «— perfumes sin visitas de N totales».
  - Precios & Stock y Depósito: las tarjetas de arriba se calculaban con `perfumes.js` si fallaba `perfume_overrides` («0», «$0», o los pausados como activos) → «—» hasta la primera lectura buena (`stockCargado`: la del login o, si falló, el primer resync completo). «N perfumes en la lista» con «sólo los que tienen unidades» → «—».
  - Analítica: los totales y las tablas quedaban con la carga anterior (quizás de otro rango) → «—» mientras carga y si falla.
  - Backups (`#backupsMeta`): quedaba «N backups · actualizado …» de antes → «— backups» si falla.
  - Ya estaban bien: el Log (el error en vez del feed; los chips no llevan números) y el Resumen.
- **1.2:** `loadAjuste` mira su error: el recuadro «Horario modificado» con «No se pudo cargar el horario modificado. Recargá la página; si sigue, avisale a Alejo.» en `--stat-tinta-out`, escapado, y sin «Volver al horario normal» (no se sabe si hay algo a qué volver).
- **1.3:** `noSePudo` queda como está. Los textos nuevos de `errorEnCriollo`: «No se pudieron cargar los combos.», «No se pudo cargar la lista de espera.», «No se pudieron cargar los perfumes nuevos.», «No se pudieron cargar los destacados.», «No se pudieron cargar las visitas.», «No se pudo cargar el horario modificado.», todos con «Recargá la página; si sigue, avisale a Alejo.».
- **1.4:** el bump, aparte.

#### Verificación (fixtures, stub `ronda-x/stub-x.js`, 390; contra `main` = `ac74be1`)
- Cada contador con la carga buena, fallida, vacía (0 de verdad) y colgada (cargando): en la rama «—» con la carga fallida y colgada, y «0» con la base vacía; en `main`, «0», «$0», «0/7», «4 combos» o los números de antes.
- `loadAjuste` con error: el recuadro con el texto y sin el botón (`main`: escondido).
- Los arreglos de la revisión (pruebas f a h): el «✅ Backup creado» se ve; «Quitar» con la relectura fallida avisa «No se pudo quitar»; una carga vieja de la Espera que falla tarde no tapa una nueva; Depósito abierto durante el arranque pasa de «—» a los números (`main`: queda en «0 · 0 · 0»); el resync completo trae el stock aunque el realtime ya haya fijado `rtLastSyncAt`.
- `vm.Script`: ok. `npm run contraste`: **0 fallas** + 1 token pisado, **341** mediciones. El error del horario medido aparte: claro 5,60, oscuro 4,34 → `[HORARIO-ERROR-OSCURO]`.
- 4 capturas en `herramientas\ronda-x\png` (Clientes y la Espera con la carga fallida; el horario en claro y en oscuro).

#### La revisión adversarial (19 agentes, ultracode)
- 4 enfoques (los estados, las regresiones, el escapado y los textos, el arranque y los roles) y un verificador por hallazgo: 15 veredictos, 12 reales y 3 refutados.
- De este cambio, arreglados en la rama (`3c3b046`): el «— backups» del arranque de la carga pisaba el «✅ Backup creado»; si fallaba la relectura, «Quitar» daba la fila por borrada y no avisaba; una carga vieja de la Espera que fallaba tarde tapaba una nueva; Depósito abierto durante el arranque quedaba en «—»; y, opcionales, el resync completo mientras el stock no cargó y Analítica en «—» mientras carga.
- De antes, a Pendientes: `[DESTACADOS-BORRA-SI-FALLA]` 🟠 y `[PANEL-STOCK-CALLA]` 🟡. Del inventario: `[CARGA-FALLIDA-SEED]` 🟢. De medir: `[HORARIO-ERROR-OSCURO]` 🟢.

#### 2 · El arranque de los dos temas (sólo medido, sobre `main` = `ac74be1`)
- Con fixtures de los **volúmenes reales** (contados con `count(*)`, sin leer datos: 100 clientes, 42 en la espera, 117 nuevos, 272 filas de stock con 73 pausados, 36 movimientos del Log en 2 días, etc.) y datos inventados.
- `[DISEÑOACORTADOR-PANELADMIN]`, a 600 × 960: 23 pestañas el jefe y 15 la empleada; con el menú fuera de pantalla, 2 toques por pestaña (3 en «Avanzado», plegado); el contenido arranca a 175 px; Precios & Stock 11,3 pantallas (la tabla empieza a 703), Depósito 14,1, Clientes 20,5 y el Doctor 40.
- `[FACILITAR-MOBILE-EN-CATALOGO]`, a 390 × 844: la primera tarjeta a 2.506 px (2,97 pantallas); una tarjeta mide 592 y la zona útil con lo pegado 547, así que ninguna entra entera; el mazo de género queda tapado con el catálogo pegado (`[MAZO-TAPADO]`) y «Ordenar» tapa la primera sugerencia (`[SUGERENCIAS-BAJO-ORDENAR]`).
- El detalle, las preguntas y la tabla «hago / no hago / decide Alejo»: `_correo_agentes\ST_Perfumeria\ClaudeCode_para_PREPARADOR_2026-09-29_x2.md`; las 60 capturas, en `herramientas\ronda-x\png` (`panel-*`, `catalogo-*`).

### Sesión 29-sep-2026 · `_y` · el merge de `carga-fallida` (v1.1.155, 19:07 del 29-sep, por orden de Alejo) y la tanda v1.1.156 en `no-pisar` · **sin mergear**

El prompt `_x` del PREPARADOR.

#### 0 · `carga-fallida`
- Revisada y aprobada por el PREPARADOR, con sus tres decisiones: «Volver al horario normal» escondido si la carga falló; el error en vez de la lista en Combos y en la Espera; los números de antes mientras recarga.
- **Mergeada a las 19:07:31 (ART), antes de las 21, por orden de Alejo** («mergea ahora»; la aprobación del PREPARADOR ya estaba en su prompt): fast-forward `ac74be1..92226c8`. Vercel sirvió `92226c8` a los ~30 s: los 7 archivos (`index.html`, `admin.html`, `sw.js`, `js/app.js`, `js/extras.js`, `css/styles.css`, `perfumes.js`), iguales byte a byte. Prueba de humo sin cuenta: 192 cards, sin sesión ni ventana, 17 pedidos a Supabase todos 200, 0 errores en la consola. `carga-fallida` borrada, en la compu y en GitHub. El riesgo de hacerlo en horario: las tablets del panel ven el banner «Nueva versión del panel» y no se recargan solas.

#### 1 · La tanda v1.1.156 (rama `no-pisar` desde `92226c8`)
- **1.1 · `[DESTACADOS-BORRA-SI-FALLA]`:**
  - Sin la lista de la base, agregar, quitar y mover no escriben y lo dicen en `#destacadoMsg` (`--stat-tinta-out`). La lista falta cuando la carga falló o, desde la revisión, cuando todavía no llegó: «Todavía se están cargando los destacados. Esperá un momento.».
  - `syncDestacadosToDB` mira el error del borrado (si falla, no cambió nada) y el del alta (si falla, vuelve a escribir los de antes y relee la base).
  - La lista, el Log y la pantalla cambian sólo con el alta buena, y «agregado» / «eliminado» salen después de guardar.
  - Desde la revisión: un guardado por vez; los resultados se esconden antes de guardar, como antes; una lectura que salió antes de un guardado bueno no lo pisa.
- **1.2 · `[GUARDAR-SIN-LEER]`** (NO ROMPER #20):
  - Helpers: `SIN_LEER`, `sinLeer`, `leido(clave, el)`, `avisoLectura`, `faltaLeer`, `faltaStock`, `faltaOverrides`.
  - Con la lectura fallida, el formulario queda vacío y con el error, y «Guardar» no escribe. Con la tabla vacía de verdad, como antes. El barrido (3 agentes buscando por lecturas, por escrituras y por botones, más un cruce) dio esta lista:

| Formulario | Con la lectura fallida, antes | Ahora |
|---|---|---|
| Beneficios | Los 4 de fábrica, sin aviso; «Guardar» borraba todo e insertaba esos | El error en vez de la lista; ni «Guardar» ni «Restaurar» escriben |
| Votación | «Sin configurar» con los candidatos vacíos (o los de antes); «Guardar» pisaba el mes | El error en el estado, los campos vacíos, no escribe |
| Puntos · configuración | 1 / 0,10 / 2 / 5 sin el id: «Guardar» creaba **otra fila** (el catálogo lee una cualquiera) | El error, los campos vacíos, no escribe |
| Decants · escalera | Los de fábrica con «No se encontró configuración guardada…»; «Guardar» escribía la fila entera | El error, los campos vacíos, no escribe |
| Decants · marcas de diseñador | «Ninguna.»; «Guardar» dejaba sólo lo agregado | El error en vez de la lista, sin «Agregar», no escribe |
| Decants · promo | «Apagada» y N = 3; «Guardar» pisaba la promo (una vigente se apagaba) | El error en el estado, N vacío, no escribe |
| Decants · perfumes de la promo | Todos «automáticos»; «Sumar» / «Sacar» escribían sobre lo de la base | El error; no escriben (si falla sólo la promo, estos siguen andando) |
| Editar perfume | Lo de `perfumes.js` (unos 25 campos); «Guardar cambios» pisaba la fila | El error arriba y en la barra; no escribe, tampoco mientras cargan; si llegan con el formulario abierto, se vuelve a llenar |
| Modal de stock | 5 u. y «Pausado» destildado; «Guardar» escribía 5 (y despausaba) | El error; no escribe; si el stock llega con el modal abierto, se vuelve a abrir con lo de la base |
| Modal de depósito | 0 y «En el local: sin dato»; «Guardar» escribía encima de lo real | Ídem |
| Migrar tipos | Los que tienen tipo en la base contaban «sin tipo» y se les pisaba | Un aviso con el error; no escribe |
| Etiqueta de la Selección | «TOP VENTAS» aunque el sitio dijera otra; «Guardar» lo escribía | El campo vacío y el error; no escribe |
| Editar combo (con un perfume nuevo, si falló `perfumes_nuevos`) | El ítem quedaba vacío y «Guardar» lo sacaba del combo | El error; no escribe (los combos sin nuevos, como siempre) |
| «Sumar punto» | La búsqueda fallida era «no está registrado» y ofrecía registrarlo | «No se pudo buscar el cliente…»; no ofrece nada |
| Ranking de puntos | El buscador volvía a pintar la lista vieja con «Ajustar», que pisaba los puntos | El error queda aunque se busque; «Ajustar» no escribe |

  - **Ya estaban bien:**
    - Decants de diseñador, Home (la cinta B/N), Horario (cierres y horario modificado), Clientes (editar, bloquear, alta), Reset contraseñas, la Espera, Combos (lista, crear, borrar), Nuevos (la lista), Notificaciones, y Resumen, Log, Estadísticas y Analítica (sólo leen).
    - Opiniones y Backup no escriben mal: van a `[CARGA-FALLIDA-SEED]` y `[BACKUP-INCOMPLETO]`.
    - Combos ⏸/▶ sólo puede pausar uno ya pausado, o pausar a pedido. El modal de precio es código muerto.
  - **El stock se lee después de los nuevos.** Antes, los ~117 nuevos quedaban sin stock aunque `stockCargado` dijera que estaba todo. Si los nuevos llegan tarde (al guardar un Nuevo), se vuelven a leer los overrides.
- **1.3 · `[ACCION-TILDE]`:** «Acción» en las tablas de cierres y de opiniones.
- **1.4 · `[HORARIO-ERROR-OSCURO]`:** `.ajuste-error` en `#ff8a80` en oscuro (7,29), `--stat-tinta-out` en claro (5,60).
- **1.5 · `[SUGERENCIAS-BAJO-ORDENAR]`:**
  - `.filter-zone--center:has(.search-suggestions.active) { z-index: 101 }`: `.sort-wrapper` arma su contexto en 100.
  - Desde la revisión, `.filter-bar` lleva `isolation: isolate` a partir de 768. En Safari ≤ 17 (sin `backdrop-filter` sin prefijo) el 101 y el 100 quedaban encima del nav.
- **1.6:** el bump, aparte (`1dad3ea`).

#### Verificación (fixtures, stub `ronda-y/stub-y.js`; contra `main` = `92226c8`)
- **a · Destacados:**
  - Carga fallida: rama 0 escrituras y el error; `main` 3, «agregado».
  - Borrado bueno y alta fallida: rama borra, falla el alta y reescribe los 3, que quedan en 3; `main` dice «agregado» y 4.
  - Borrado fallido: rama nada.
  - Todo bien: como hoy.
- **Revisión (e1):**
  - Cargando: rama 0; `main` borra y escribe 1.
  - Dos toques: rama 1 guardado; `main` 2 borrados y 2 altas.
  - Lectura vieja: rama queda lo guardado; `main` vuelve a la lista de antes.
- **b · por formulario, lectura fallida / buena / vacía:** en la rama, 0 escrituras con la fallida en los 15, y como hoy con la buena y la vacía. En `main`, la fallida escribía en todos (Puntos, con un `insert` nuevo).
- **Revisión (e2 a e4):**
  - El stock que llega con el modal abierto: rama lo vuelve a abrir con 7 y, al guardar de nuevo, escribe 7; `main` escribía 5, o movía 4 al local.
  - Editar mientras cargan: rama 0 escrituras; cuando llegan, «Llegaron los datos…» y 99,000; `main` escribía 68000.
  - Combo sin nuevos: guarda. Combo con un nuevo: no guarda.
  - El merge tardío: el nuevo con su stock (9 / 3); `main` sin stock.
- **c:** `npm run contraste`: **0 fallas** + 1 token pisado, **343** mediciones. El error del horario en oscuro, 7,29.
- **d:** con «LA VOI», a 390 y 360, en los dos temas, `elementFromPoint` en el centro de la primera sugerencia y en 4 puntos más da la sugerencia; en `main`, «Ordenar». A 1280, igual que `main` (las sugerencias, el menú de Ordenar y el nav).
- Pasada por las 23 pestañas (jefe) y las 15 (empleada): 0 errores de página. El script del panel compila (`vm.Script`) y `node --check` pasa.
- Contraste de cada error nuevo, medido en la página (el cuadro, en el informe al DISEÑADOR): en claro 5,32 a 5,89; en oscuro 4,54 a 5,18. Editar combo va en `#e74c3c` (4,94), porque su caja es oscura también en claro.
- 6 capturas en `herramientas\ronda-y\png` (`ronda-y-*`).

#### El barrido y la revisión (ultracode)
- **Barrido de 1.2:** 4 agentes (lecturas, escrituras, botones y el cruce).
- **Revisión adversarial:** 10 agentes (destacados, guardas que frenan de más, guardas que faltan, stock y depósito, CSS y textos, con un verificador para cada uno). Dieron 17 hallazgos: 11 reales y 6 descartados.
  - De los 11 reales, 10 se arreglaron en la rama (`03afbfb`): destacados cargando, dos toques y lectura vieja; los modales con el stock que llega tarde; Editar y Migrar tipos mientras cargan; el stock de los nuevos; el merge tardío; Editar combo, que frenaba de más; Safari ≤ 17.
  - El que queda es la vuelta de los de antes cuando se corta la red. Ahora la lista sale en la consola, y va a `[DESTACADOS-RPC]`.
  - De los descartados: «buscar…» con 42501 ahora dice «no puede ver esto». El color del ranking y los de Destacados van a `[MENSAJES-FIJOS-CLARO]`.
- **Pendientes nuevos:**
  - 🟡 `[QUOTE-JEFE-SE-BORRA]` (hoy 0 quotes), `[CAT-DOBLE-SE-PIERDE]` (18 de los 19 ya en «Unisex»; **Alejo decidió que se queden así**: baja a 🟢, queda el formulario), `[COMBO-FORM-CLARO]`.
  - 🟢 `[DESTACADOS-RPC]`, `[BADGES-BORRA-SI-FALLA-EL-ALTA]`, `[DESCUENTO-HASTA-UTC]` (hoy 0), `[MENSAJES-FIJOS-CLARO]`, `[BACKUP-INCOMPLETO]`, `[EDITAR-NUEVO-SIN-AVISO]`, `[PUNTOS-CARRERA-TABLETS]`.
  - Los números de la base salen de `SELECT` de sólo lectura.

#### Los temas
- `[DISEÑOACORTADOR-PANELADMIN]`: Alejo eligió «menos pestañas a la vista», más una pantalla de inicio (Precios & Stock · Depósito · Log · Espera + «Ver todas»), igual para el jefe y la empleada. Lo dibuja el DISEÑADOR.
- `[FACILITAR-MOBILE-EN-CATALOGO]`: sólo medido (en `_x`).

---

**Última actualización:** **Septiembre 29, 2026 (`_y`)** — `carga-fallida` aprobada por el PREPARADOR y mergeada a las 19:07 por orden de Alejo (v1.1.155 en producción) y la tanda v1.1.156 en `no-pisar`, sin mergear: 1.1 `[DESTACADOS-BORRA-SI-FALLA]`, 1.2 `[GUARDAR-SIN-LEER]` (15 formularios; NO ROMPER #20), 1.3 «Acción», 1.4 `[HORARIO-ERROR-OSCURO]`, 1.5 `[SUGERENCIAS-BAJO-ORDENAR]`. Nuevos: `[QUOTE-JEFE-SE-BORRA]`, `[CAT-DOBLE-SE-PIERDE]` y `[COMBO-FORM-CLARO]` 🟡; `[DESTACADOS-RPC]`, `[BADGES-BORRA-SI-FALLA-EL-ALTA]`, `[DESCUENTO-HASTA-UTC]`, `[MENSAJES-FIJOS-CLARO]`, `[BACKUP-INCOMPLETO]`, `[EDITAR-NUEVO-SIN-AVISO]` y `[PUNTOS-CARRERA-TABLETS]` 🟢.

**Última actualización:** **Septiembre 29, 2026 (`_x`)** — el merge de `pulido-clientes` (03:50 del 29-sep, v1.1.154 en producción), la tanda v1.1.155 en `carga-fallida`, sin mergear, y el relevamiento de los dos temas. Cerrado, en producción: `[PANEL-HOY-UTC]`. Nuevos: `[DESTACADOS-BORRA-SI-FALLA]` 🟠, `[PANEL-STOCK-CALLA]`, `[MAZO-TAPADO]` y `[SUGERENCIAS-BAJO-ORDENAR]` 🟡, `[CARGA-FALLIDA-SEED]` y `[HORARIO-ERROR-OSCURO]` 🟢.

**Última actualización:** **Septiembre 29, 2026 (`_w`)** — el merge de `pulido-textos` (03:05 del 29-sep, v1.1.153 en producción), las capturas al DISEÑADOR y la tanda v1.1.154 en `pulido-clientes`, sin mergear. Cerrados, en producción: `[CLIENTES-OSCURO-ROJO]`, `[CLIENTES-HOVER]`, `[HORARIO-BORRA-ANTES]`. Nuevo, 🟢: `[PANEL-HOY-UTC]` (en la rama).

**Última actualización:** **Septiembre 29, 2026 (`_v`)** — el merge de `pulido-panel` (02:35 del 29-sep, v1.1.152 en producción) y la tanda v1.1.153 en `pulido-textos`, sin mergear. Cerrados, en producción: los 5 de `pulido-panel`. Nuevo, 🟢: `[HORARIO-BORRA-ANTES]` (en la rama).

**Última actualización:** **Septiembre 29, 2026 (`_u`)** — el merge de `pulido-login` (23:21 del 28-sep, v1.1.151 en producción), el Bloque 3 (cierra `[S13-ESCRITURAS-ANON]`), la hora de las rondas s y t corregida y la tanda v1.1.152 en `pulido-panel`, sin mergear. Cerrados, en producción: los 7 de `pulido-login`. Nuevos, 🟢: `[CLIENTES-OSCURO-ROJO]`, `[CLIENTES-HOVER]`.

**Última actualización:** **Septiembre 28, 2026 (`_t`)** — el merge de `sesion-cliente` (22:22, v1.1.150 en producción) y la tanda chica v1.1.151 en `pulido-login`, sin mergear. Cerrados: `[FAVS-DISPOSITIVO-COMPARTIDO]`, `[REGISTRO-LLAVE]`, `[VOTO-RETOMAR-APAGADO]`, `[PUNTOS-BUSCA-TEL-CRUDO]` (en producción), `[EDITAR-BLOQUEADO]` (el Bloque 2c) y `[FAVS-MARCA-BORDES]` (aceptado). Nuevos, 🟢: `[COMBO-BORRA-SIN-MIRAR]`, `[CRIOLLO-BORDES]`, `[LOGIN-CLARO-TELEFONO]`, `[LOGIN-CAMPOS-QUEDAN]`.

**Última actualización:** **Septiembre 28, 2026 (`_s`)** — la ronda s sobre `sesion-cliente` (sin bump, v1.1.150), sin mergear. Cerrados: `[SESION-BLOQUEADO]` y `[EDITAR-SIN-LIMITE]` (el Bloque 2b). En la rama: `[FAVS-DISPOSITIVO-COMPARTIDO]`, `[REGISTRO-LLAVE]`, `[VOTO-RETOMAR-APAGADO]`, `[PUNTOS-BUSCA-TEL-CRUDO]`. Nuevos, 🟢: `[CLIENTES-BUSCA-TEL-FORMATO]`, `[TELEFONO2-MUERTO]`, `[AVISO-TAPA-LOGIN]`, `[FAVS-MARCA-BORDES]`, `[AUTH-BAJO-DETALLE]`, `[EDITAR-BLOQUEADO]`.

**Última actualización:** **Septiembre 28, 2026 (`_r`)** — `[SESION-CLIENTE]` y `[TEL-CANONICO-PANEL]` en la rama `sesion-cliente` (SW v1.1.150), sin mergear. Nuevos: `[EDITAR-SIN-LIMITE]` 🟠, `[FAVS-DISPOSITIVO-COMPARTIDO]`, `[VOTO-RETOMAR-APAGADO]`, `[PUNTOS-BUSCA-TEL-CRUDO]` 🟡, `[SESION-BLOQUEADO]`, `[REGISTRO-LLAVE]`, `[LOGIN-CLARO-CONTRASTE]`, `[BACKUP-SIN-FAVORITOS]` 🟢.

**Última actualización:** **Septiembre 28, 2026 (`_q`)** — la tanda chica (129d, 128h y `[ESCAPE-DOBLE-FUNCION]`), SW v1.1.149. Cerrados: `[ERRORES-CRUDOS-RESTO]` y `[ESCAPE-DOBLE-FUNCION]`. Nuevos, 🟢: `[COMBO-PISA-COMBO]` y `[ERRORES-CRUDOS-OTROS]`.

**Última actualización:** **Septiembre 28, 2026 (`_p`)** — los escapes del barrido de XSS, SW v1.1.148 (S18, S24, S25 y S27 cerrados).

**Última actualización:** **Septiembre 28, 2026 (`_o`)** — la Espera (129b + 129c), `[MOTIVO-QUEDA]`, 128f y `[MOTIVO-EN-CRIOLLO]`, SW v1.1.147. Cerrados: `[ESPERA-NOMBRE-3-RENGLONES]`, `[MOTIVO-QUEDA]`, `[RECARGAR-360]` y `[CLICKS-SLUG-CHECK]`. S26 en parte.

**Última actualización:** **Septiembre 28, 2026 (`_n`)** — el barrido de XSS (49 confirmados; en el repo, sólo las keywords de lo abierto) y `[XSS-URL-FILTROS]` cerrado (SECURITY.md § S23), SW v1.1.146.

**Última actualización:** **Septiembre 28, 2026 (`_m`)** — `[XSS-ESTADISTICAS]` cerrado (SECURITY.md § S22), SW v1.1.145. Nuevos: `[MOTIVO-QUEDA]` y `[CLICKS-SLUG-CHECK]` 🟢.

**Última actualización:** **Septiembre 28, 2026 (`_l`)** — la ronda m sobre `tanda-l` y, con la decisión B de Alejo (sin el 129b), el merge: SW v1.1.144 en producción. Cerrados `[EDITAR-EMPLEADA-MUERTO]`, `[DC-HEADER-600]`, `[DC-ELIMINAR-CORTADO]`, `[GUARDAR-DOBLE-TOQUE]` y `[GUARDAR-AVISO-LEJOS]`. Nuevos: `[XSS-ESTADISTICAS]` 🟠 y `[RECARGAR-360]` 🟢.

**Última actualización:** **Septiembre 28, 2026 (`_k`)** — la ronda l en la rama `tanda-l` (SW v1.1.144), sin mergear: el punto 2 (ningún nombre en 3 renglones a 360) no dio → `[ESPERA-NOMBRE-3-RENGLONES]`. Nuevo, de antes: `[DC-ELIMINAR-CORTADO]`.

**Última actualización:** **Septiembre 27, 2026 (`_j`)** — `[GUARDAR-ABAJO]` en la rama `guardar-abajo`, SW v1.1.143. Nuevos: `[EDITAR-EMPLEADA-MUERTO]` 🟡, `[GUARDAR-DOBLE-TOQUE]` y `[GUARDAR-AVISO-LEJOS]` 🟢.

**Última actualización:** **Septiembre 27, 2026 (`_i`)** — la ronda j (el arreglo de `cleanPhone`, a1 + a2) sobre `ronda-i`, sin bump nuevo; con el OK de Alejo, fast-forward `0833be1..29b925b`: **v1.1.142 en producción** (`curl`: el `cleanPhone` nuevo en el `app.js` servido, «Reset contraseñas» en el panel). Con la marca de Valentino Donna cargada, los datos reales dan «💎 Diseñador» Frascos · 21 (11 con su 💎) y Sólo en decant · 2. Cerrados `[ESPERA-LOW-SIN-STOCK]`, `[ESPERA-AYUDA-AUTOMATICO]` y `[TEL-15-SIN-549]`.

**Última actualización:** **Septiembre 27, 2026 (`_h`)** — `espera-mas` en producción (v1.1.141) con el OK de Alejo; los 10 arreglos de la revisión y la ronda i en la rama `ronda-i` (v1.1.142), esperando la revisión del PREPARADOR.

**Última actualización:** **Septiembre 27, 2026 (`_g`)** — la ronda h (`[ESPERA-MAS]`) en la rama `espera-mas`, SW v1.1.141, esperando la revisión del PREPARADOR. `precios-g` mergeada con el OK de Alejo (v1.1.140 en producción) y `[XSS-NUEVOS]` cerrado (§ S21). Nuevos: `[ESPERA-LOW-SIN-STOCK]`, `[ESPERA-AYUDA-AUTOMATICO]`, `[TEL-15-SIN-549]` 🟢.

**Última actualización:** **Septiembre 27, 2026 (`_f`)** — la ronda g (123g, 123h, «fijo» y `[XSS-NUEVOS]`) aprobada por el PREPARADOR y mergeada con el OK de Alejo (fast-forward `a919314..d92150a`), en producción (SW v1.1.140). Cerrado `[XSS-NUEVOS]` (SECURITY.md § S21, `dc6d94e`). Nuevo: `[NUEVO-BORRADO-HUERFANO]` 🟡.

**Última actualización:** **Septiembre 27, 2026 (`_e`)** — `[PRECIOS-EN-UN-LUGAR]` revisado y aprobado por el PREPARADOR, en producción (SW v1.1.139, fast-forward `119a091..d4a5629`). Cerrado `[XSS-PRECIOS-STOCK]` (SECURITY.md § S20).

**Última actualización:** **Septiembre 27, 2026 (`_d`)** — la ronda `_d` del Resumen y las decisiones 125 / 125b en producción, SW v1.1.138. Cerrado `[LOG-LABEL-26H]`.

**Última actualización:** **Septiembre 27, 2026 (`_c`)** — `[RESUMEN-EN-EL-PANEL]` aprobado por el PREPARADOR y en producción (SW v1.1.137). La próxima ronda (lo del DISEÑADOR + 3 detalles, un prompt y un SQL) ya la anotó el PREPARADOR.

**Última actualización:** **Septiembre 27, 2026 (`_b`)** — `[BACKUP-FALLBACK-ROTO]` en producción, SW v1.1.136: el respaldo del panel guarda `'auto'` y espera 26 h. Nuevo `[LOG-LABEL-26H]` 🟢.

**Última actualización:** **Septiembre 27, 2026** — `[CRON-HEADER-FALSO]`, `[SECURITY-AUDIT-S1]` (aprobado por el PREPARADOR) y `[CRON-TRIGGER-AUTO]` en producción, `main` = `8eec233`, SW v1.1.135. El backup del cron anda (primera fila `auto` desde mayo). `[VERCEL-ENV-VARS]` a medias (falta el push); nuevo `[BACKUP-FALLBACK-ROTO]`.

**Última actualización:** **Septiembre 26, 2026** — `[VALOR-INV-DEPOSITO]` y `[VALOR-INV-PAUSADOS]` en producción, SW **v1.1.134**: la tarjeta 💰 del jefe muestra el total (local + depósito, pausados incluidos) y el desglose, con cuánto es de los pausados. Los sets quedan afuera. Abierto: `[VALOR-INV-DISEÑO]` 🟢; el bloque para el PREPARADOR lo manda Alejo después.

**Última actualización:** **Septiembre 24, 2026 (N-bis)** — la N-bis (`_y`) en producción, SW **v1.1.132**: `[PROMO-ANCHO-360]` cerrado; la promo se puede prender. Nuevo: `[COMPARE-PISA-NOMBRE]` 🟢.

**Última actualización:** **Septiembre 24, 2026 (parte N)** — N (`_w` + `_x`) en producción, SW **v1.1.131**: `[PROMO-DECANTS]` (con `[SIRENITA]`), `[DECANT-TOPE-CONTADOR]` y `[DECANT-WA-TOTAL]` cerrados. La promo sigue sin filas en la base hasta cerrar `[PROMO-ANCHO-360]` 🟡. Nuevo: `[NUEVO-EN-111]` 🟢.

**Última actualización:** **Septiembre 24, 2026 (parte M)** — M (`_u` + `_v`) en producción, SW **v1.1.130**: `[PILDORA-ANILLO]`, `[QUITAR-ETIQUETA-CONTRASTE]`, `[FINAL-COMPARANDO]`, `[ESTADO-MINUSCULA]`, `[OVERRIDE-ML]` y `[DECANT-SOLO-PERFUMES]` cerrados. `[DECANT-TOPE-CONTADOR]` suma el número de la pestaña «Catálogo» (193 contra 184).

**Última actualización:** **Septiembre 24, 2026 (después de la J)** — K (`_s`, SW **v1.1.128**) y L (`_t`, SW **v1.1.129**) en producción: `[BOTONES-CONTRASTE]`, `[CINTA-TINTA]`, `[ESTADO-LOCAL]`, `[RELOAD-CON-LOGIN]`, `[FINAL-FLOTANTES]` e `[INVITACION-BAJO-BANNER]` cerrados. **Pendientes nuevos:** `[RELOAD-NUNCA]` 🟡 · `[FINAL-COMPARANDO]` 🟢 · `[QUITAR-ETIQUETA-CONTRASTE]` 🟢.

**Última actualización:** **Septiembre 24, 2026 (noche)** — J (`_r`) en producción, SW **v1.1.127**: `[BARRA-CELU]` cerrado; el ref de Oregon, fuera de `RECOMENDACIONES_CLAUDECHAT/`. **Pendientes nuevos:** `[NAV-REPITE-BARRA]` 🟢 · `[RELOAD-CON-LOGIN]` 🟢.

**Última actualización:** **Septiembre 24, 2026 (tarde)** — la parte I (`_q`) en producción, SW **v1.1.126**: `[AMARILLO-CATALOGO-CLARO]`, `[HOTSALE-CLARO]`, `[CERRADO-HERO]`, `[PEDIDOS-PASS-CLARO]`, `[SALTO-CARD-CENTRO]`, `[ANILLO-1PX]`, `[EFECTIVO-UN-RENGLON]` y `[HORARIO-DOS-FUENTES]` cerrados; el ref de Oregon fuera de los docs. **Pendiente nuevo:** `[BOTONES-CONTRASTE]` 🟢.

**Última actualización:** **Septiembre 24, 2026** — D (v1.1.121), E (v1.1.122), F (v1.1.123), G (v1.1.124) y H (v1.1.125) en producción: `[AMARILLO-TINTA-CLARO]`, `[ACTION-BTN-BASE]`, `[JERARQUIA-CARD]`, `[TAP-44]` (catálogo), `[CLARO-CATALOGO-2]`, `[PANEL-CLARO-CAJAS]`, `[FILTROS-SOLO-CATALOGO]`, `[CARD-ESCRITORIO-BANNER]` y `[JUEGOS-VENTANA-PULIDO]` cerrados. **Pendientes nuevos:** `[AMARILLO-CATALOGO-CLARO]` 🟡 · `[PEDIDOS-PASS-CLARO]` 🟡 · `[HOTSALE-DETALLE-CLARO]` 🟡 · `[GUIA-DESACTUALIZADA]` 🟢 (`[INVENTARIO-ARCHIVOS]` se cerró el mismo día) · `[SALTO-CARD-CENTRO]` 🟢 · `[CERRADO-HERO]` 🟢. Oregon recortado.

**Última actualización:** **Septiembre 23, 2026 (noche, `_l` + `_m`)** — A (v1.1.118), B (v1.1.119) y C (v1.1.120) en producción: `[DECANTS-DEFAULTS]`, `[LOG-NOMBRE-CORTADO]`, `[LOG-LABEL-FALLBACK]`, `[VER-MAS]`, `[SET-UNICO-CENTRADO]`, `[JUEGOS-VENTANA]` y `[JUGAR-NO-LLEGA]` cerrados. **Pendientes nuevos:** `[FILTROS-STICKY-PIE]` 🟡 · `[ESPERA-ERROR-CRUDO]` 🟢 · `[CARD-ESCRITORIO-BANNER]` 🟢 · `[JUEGOS-VENTANA-PULIDO]` 🟢. **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[FILTROS-STICKY-PIE]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[CARD-ESCRITORIO-BANNER]` · `[JUEGOS-VENTANA-PULIDO]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → la tanda de claro (prompt del PREPARADOR: el dorado nuevo `#6b5500`, decisión 66, en las dos apps) → lo que dibuje el DISEÑADOR con los números de estas tandas (`[FILTROS-STICKY-PIE]`, `[JUEGOS-VENTANA-PULIDO]`, la barra de abajo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 23, 2026 (noche, `_j`)** — `[ESPERA-CLARO]` (SW **v1.1.116**) y `[LOG-PULIDO-2]` (SW **v1.1.117**) cerrados y en producción; la tanda C para el DISEÑADOR (tabla C del catálogo, flotantes contra la barra, «Jugar»); S1 y S4 con la keyword sola. **Pendientes nuevos:** `[JUGAR-NO-LLEGA]` 🟡 · `[S4-OREGON]` 🟡 · `[LOG-NOMBRE-CORTADO]` 🟢 · `[LOG-LABEL-FALLBACK]` 🟢. **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[JUGAR-NO-LLEGA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[LOG-NOMBRE-CORTADO]` · `[LOG-LABEL-FALLBACK]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → la tanda de claro (prompt del PREPARADOR: amarillos, botones, card, «Cerrado», cajas del panel) → lo que dibuje el DISEÑADOR con los números de la tanda C (la tabla C del catálogo, los flotantes contra la barra, `[JUGAR-NO-LLEGA]`) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 23, 2026 (noche, cierre)** — `[S8-STORAGE-ANON]` cerrado (bucket de fotos sólo para el staff, nadie borra, las fotos se siguen sirviendo) y `[SETS-CENTRADO-CORTADO]` arreglado (SW **v1.1.115**, en producción). S3 y S13 con la keyword sola. **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[LOG-PULIDO-2]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[LOG-PULIDO-2]` (prompt del PREPARADOR) → las decisiones de diseño que vengan del DISEÑADOR (verdes, Categorías, Backups en claro, la sombra) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 23, 2026 (noche)** — repaso de Pendientes por dueño (fuera del repo), tres urgentes cerrados con Alejo (`[SIGNUP-ABIERTO]`, `[ROTAR-DB-PASS]`, `[RESET-SIN-TELEGRAM]`), backup local de las 165 fotos, 26 capturas y la tabla C para el DISEÑADOR, y dos reglas nuevas de Alejo (flujos multi-agente con OK previo, agujeros abiertos con la keyword sola). **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · `[S8-STORAGE-ANON]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[LOG-PULIDO-2]` · `[SETS-CENTRADO-CORTADO]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** seguridad que queda: `[S8-STORAGE-ANON]` (SQL del PREPARADOR) y `[VERCEL-ENV-VARS]` (Alejo) → `[LOG-PULIDO-2]` (prompt aparte) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 23, 2026 (tarde)** — tanda de seguridad **`[ESPERA-SEGURA]` + `[XSS-PEDIDOS-PASS]` + `.vercelignore`** (decisión 47 de Alejo): 5 commits sobre `7a3f7b8`, SW v1.1.113 → **v1.1.114**, en producción. El dominio dejó de servir los documentos internos (404 en las 8 rutas), el teléfono de "Pedidos pass" se escapa y la RPC valida dígitos, `anon` ya no lee `lista_espera` y el ✓ sale de la base; las contraseñas de S1 estaban rotadas desde el 19-sep. **Pendientes nuevos:** `[S10-TER-XSS-COMBOS]` 🟠 · `[LOG-PULIDO-2]` 🟡 · `[COMBOS-PAUSADOS-VISIBLES]` 🟡 · `[COMBO-PROMO-NULL]` 🟢. **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[LOG-PULIDO-2]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[COMBO-PROMO-NULL]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[LOG-PULIDO-2]` (prompt aparte) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`; lo manual de seguridad es `[VERCEL-ENV-VARS]` (Alejo).

**Última actualización:** **Septiembre 23, 2026 (mediodía)** — tanda **`[LOG-PULIDO]`** (prompt `_w`, pre-aprobada): 3 commits sobre `eeb4b29`, SW v1.1.112 → **v1.1.113**, en producción. "Por perfume" deja de emitir el nombre en cada fila (**44 px** a 600, antes 50,8-53,8), las filas del Log dejan de opinar (old gris tachado, new en el texto del tema; el rojo y el verde quedan en el resumen) y todo precio del Log sale en pesos (`$105.000`, también el `85,000.00` del seed). `contraste.js` mide `.log-new` como heredado: 0 fallas, 44 mediciones. Revisión adversarial antes del merge: 0 confirmados. **Pendientes nuevos:** `[LOG-CAMBIO-LARGO]` 🟡 · `[LOG-CHIP-PRECIOS]` 🟢 · propuesto `[S10-TER-XSS-COMBOS]` (decide Alejo). **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[LOG-CAMBIO-LARGO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[LOG-CHIP-PRECIOS]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** S1 + env vars (Alejo, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 22, 2026 (noche)** — dos tandas chicas: **`[LOG-SISTEMA-CHIP]`** (login, logout y los backups salen de Catálogo a su propia chip `⚙️ Sistema`, última de la fila · SW v1.1.111 → **v1.1.112**, en producción) y el **selector de navegador de `medir_targets.js`**, que probaba uno solo y moría cuando Edge dejó de publicar el endpoint de DevTools: ahora prueba los candidatos en orden, con un perfil temporal por intento y mensajes que dicen cuál falló y por qué. La chip nueva destapó que `.log-chips` estiraba a sus ítems (⚙️ y 👑 pasaron de 44 a 46 por culpa del toggle, que mide 46): arreglado con `align-items: center`. Y se limpiaron **3 GB** de perfiles temporales propios (28 carpetas, 128 procesos zombis) que habían dejado `C:` en 14 GB libres → **25 GB**. **Pendiente nuevo:** `[MEDIR-TEMP-SWEEP]` 🟢. **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2 · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** S1 + env vars (Alejo, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 22, 2026 (tarde)** — tanda **`[LOG-EMPLEADA]`**: 5 commits sobre `ea326c6`, SW v1.1.110 → **v1.1.111**, en producción. La pestaña Log dejó de ser del jefe: la empleada ve **stock y depósito de quien sea** (RLS alterada por Alejo + filtro de cliente como defensa en profundidad), con feed **cronológico** (`〃` cuando se repite el perfume), vista "Por perfume" a un toque sin volver a pedir datos, buscador por nombre sobre 60 días, chips por acción, tag **👑** por `actor_email` y un resumen que sale de **`resumen_stock_dia()`** — la misma fórmula que el Telegram de las 23 h, así el panel y el mensaje no pueden desfasarse. El instrumento se amplió primero: `medir_targets.js` con **`--fixture`** y stub de Supabase con estado (`window.__sbCalls`), y `contraste.js` con 6 filas por tema para el Log — que de paso encontró `.log-dia` en 1,86 sobre blanco y lo mandó a `var(--stat-tinta)`. **Pendientes nuevos:** `[AMARILLO-TINTA-CLARO]` 🟡 · `[DEPOSITO-TRANSFERENCIA-EVENTO]` 🟢. **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2 · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** S1 + env vars (Alejo, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 22, 2026 (madrugada + mediodía)** — sesión de **26 commits**, SW v1.1.105 → **v1.1.110**, con el esquema de tres roles (DISEÑADOR / PREPARADOR / CLAUDE CODE) estrenado y **un bloque por turno** como regla de ruteo. Cerrados **`[BADGE-48]`**, **`[BADGE-TEXTO]`** (las 6 badges ≥ 4,5:1 y la regla 19 escrita en el CSS), **`[TAP-44]` decisión 7**, **`[FONTS-SELFHOST]`** (las 3 familias desde `/fonts/`: 4 woff2 variables, 17 `@font-face` 1:1, Inter precacheada y verificada **sin red**) y **`[TEMA-CLARO]` + `[ESCALA-8-A-6]`** (tokens de tema en las dos superficies, rojo partido, stat cards crema, `--gris` a `#888` en el orden ①②③, Depósito sin un solo color inline). Dos instrumentos nuevos en `scripts/`: **`contraste.js`** (valor efectivo en cascada, dice qué regla lo impone, `npm run contraste`) y **`medir_targets.js`** (Edge headless por CDP, sin dependencias, **se niega** si Inter no cargó). **El hallazgo de la sesión:** el catálogo en claro nunca estuvo roto — los 1,51/2,78/3,95 eran la declaración base; lo que se ve desde mayo es 17,36/7,87/15,01 por las **56 reglas `!important`** de `193e3dd`, escritas porque una usuaria real no podía leer el sitio. **Pendientes nuevos:** `[LIGHT-MAYO-56]` 🟡 · `[JERARQUIA-CARD]` 🟢 · `[TAP-44]` tanda 2 🟢. **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2 · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** S1 + env vars (Alejo, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Última actualización:** **Septiembre 20, 2026 (noche)** — **`[CLICKS-RESUMEN]` RESUELTO** (rama `fix-clicks-resumen` → `main` fast-forward `6b44d80`, docs `7dbfaec`, SW **v1.1.104 → v1.1.105**): `loadPerfumeViews()` (catálogo público) y `loadStats()` (panel) dejaron de leer `perfume_clicks` cruda (230.901 filas, RLS de `SELECT` exige `authenticated` → el anónimo leía 0 filas y "más visitados" caía al alfabético en silencio) y pasaron a `sb.rpc('perfume_clicks_resumen')` (`SECURITY DEFINER`, agrupa por slug, `EXECUTE` a propósito para `anon` — verificado `anon=true`/`authenticated=true`/`public=false`). `admin.html` deriva `totalClicks` sumando el resumen en vez de un `count` aparte (verificado `SUM=COUNT=230.901`). Documentado en `DATABASE.md`/`SECURITY.md` con los valores reales. **De yapa**, cierre de proceso retroactivo de la tanda `[S10-BIS-XSS-ESPERA-OPINIONES]` + `[WA-LINK-549-DUPLICADO]` (ya resuelta esa misma tarde, nunca tuvo su `docs: cierre sesión`). Detalle en § "Sesión 20-sep-2026 (más tarde) · `[CLICKS-RESUMEN]`" y § "Sesión 20-sep-2026 · S10-XSS→S10-bis→WA-LINK". **Pendiente nuevo:** `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` 🟢 (descripciones del problema original en presente debajo de headers "✅ RESUELTO" en `SECURITY.md`, ej. S14 L368 — pasarlas a pasado). **Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** S1 + env vars (Alejo, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

**Estado del repo al cierre (23-sep, noche, `_l` + `_m`):** `origin/main` = `cb65ebb` (+ este commit de docs) · `fix-chicos-24`, `fix-ver-mas` y `feat-juegos-ventana` mergeadas ff · SW en producción **v1.1.120**, verificado con `curl` · `npm run contraste` 0 fallas / 82 (con la ventana, `12f076c`) · `medir_targets` sobre la ventana: pestañas 176,5 × 44, × 44 × 44.

**Estado del repo al cierre (23-sep, noche, `_j`):** `origin/main` = `4f60dca` (+ este commit de docs) · `fix-espera-claro` y `log-pulido-2` mergeadas ff · `contraste-espera-claro` (sólo `scripts/contraste.js`) mergeada ff con el OK de Alejo (`3286e61`) y borrada · SW en producción **v1.1.117**, verificado con `curl` · `npm run contraste` en `main`: 0 fallas / 62 · `medir_targets` 602 / 37.

**Estado del repo al cierre (23-sep, noche, cierre):** `origin/main` = `0b978fc` (+ este commit de docs) · árbol limpio, sin ramas abiertas (`fix-sets-centrado` mergeada ff y borrada) · SW en producción **v1.1.115**, verificado con `curl` · contraste 0 fallas / 44 · `storage.objects`: sólo las 3 políticas `fotos_staff_*` · listar `perfume-fotos` como `anon` → `[]`.

**Estado del repo al cierre (23-sep, noche):** `origin/main` = `f6a4ffb` (+ este commit de docs) · árbol limpio, sin ramas abiertas · SW en producción **v1.1.114** (sin cambios de código en este cierre) · Supabase: `disable_signup: true`, `cliente_reset_solicitar` con `_aviso_tg` y validación de dígitos · backup de fotos en `D:\backups\perfume-fotos-2026-09-23\` (165 · 8.689.933 bytes).

**Estado del repo al cierre (23-sep, tarde):** `origin/main` = `dc6fd1f` (+ este commit de docs) · rama de trabajo `claude/st-perfumeria-tablet-responsive-2974b8` = main · árbol limpio, sin ramas abiertas (`fix-espera-segura` mergeada ff y borrada) · SW en producción **v1.1.114**, verificado con `curl` · `npm run contraste` en 0 fallas + 1 ⚠️ token pisado + 1 ⚠️ conocida · 44 mediciones · `node scripts/medir_targets.js` (con `TEMP` en `D:`) en **602 controles / 37 cortos** · `%TEMP%\st-medir-*` en `C:`: **0** · Supabase: `lista_espera_pendiente_uniq` creado, `le_select_public` → `{authenticated}`, `le_delete_auth` → `is_jefe()`.

**Estado del repo al cierre (23-sep, mediodía):** `origin/main` = `b456793` (+ este commit de docs) · rama de trabajo `claude/st-perfumeria-tablet-responsive-2974b8` = main · árbol limpio, sin ramas abiertas (`fix-log-pulido` mergeada ff y borrada) · SW en producción **v1.1.113**, verificado con `curl` · `npm run contraste` en 0 fallas + 1 ⚠️ token pisado + 1 ⚠️ conocida · 44 mediciones · `node scripts/medir_targets.js` en **602 controles / 37 cortos** (igual con y sin fixture) · `%TEMP%\st-medir-*`: **5 carpetas, 57,5 MB**, sin procesos vivos, esperando OK para borrarlas · `C:` con 23,3 GB libres.

**Estado del repo al cierre (22-sep, noche):** `origin/main` = `23f5b07` (+ este commit de docs) · rama de trabajo `claude/st-perfumeria-tablet-responsive-2974b8` = main · árbol limpio, sin ramas abiertas · SW en producción **v1.1.112**, verificado con `curl` (chip `Sistema` y `align-items` presentes en el `admin.html` servido) · `npm run contraste` en 0 fallas + 1 ⚠️ token pisado + 1 ⚠️ conocida · `node scripts/medir_targets.js` **a secas** (elige Chrome solo) en **602 controles / 37 cortos** · `%TEMP%\st-medir-*`: **0 carpetas**, `C:` con 25 GB libres.

**Estado del repo al cierre (22-sep, tarde):** `origin/main` = `1d660de` (+ este commit de docs) · rama de trabajo `claude/st-perfumeria-tablet-responsive-2974b8` = main · árbol limpio, sin ramas abiertas (`feat-log-empleada` mergeada ff y borrada) · SW en producción **v1.1.111**, verificado con `curl` (`resumen_stock_dia` ×2 en el `admin.html` servido, el botón del Log **sin** `data-role="jefe"`, `tbodyAuditLog` en 0) · `npm run contraste` en 0 fallas + 1 ⚠️ token pisado + 1 ⚠️ conocida · `node scripts/medir_targets.js` en **602 controles / 37 cortos**.

**Estado del repo al cierre (22-sep, 13:40):** `origin/main` = `a182a91` (+ este commit de docs) · rama de trabajo `claude/st-perfumeria-tablet-responsive-2974b8` = main · árbol limpio, sin ramas abiertas (`fix-fonts-selfhost` y `fix-tema-claro` mergeadas ff y borradas) · SW en producción **v1.1.110** · `npm run contraste` en 0 fallas + 1 ⚠️ token pisado (`.card-brand`) + 1 ⚠️ conocida (`[JERARQUIA-CARD]`) · `node scripts/medir_targets.js` en 601 controles / 38 cortos.

**Estado del repo al cierre (20-sep, noche):** `origin/main` = `7dbfaec` (+ este commit de docs) · árbol limpio salvo untracked pre-existentes sin relación (`.codegraph/`, `Claude outputs/`, reportes PDF/PNG, `add_precio_decant.sql`, `sql/forgot-pass-a-create-table.sql` — ninguno tocado ni commiteado) · SW **v1.1.105** en producción (verificado con `curl`) · `perfume_clicks_resumen()` con `EXECUTE` para `anon`/`authenticated`, no para `public` · rama `fix-clicks-resumen` mergeada y puede borrarse.

**Estado del repo al cierre (19-sep):** `origin/main` = `154e51c` (+ este commit de docs) · rama de worktree `claude/st-perfumeria-tablet-responsive-2974b8` = main (worktree `serene-jennings-e9d305`) · árbol limpio · 0 `.patch` sueltos · SW **v1.1.102** en producción · `send_telegram` y `admin_actions_cleanup` sin EXECUTE para anon · token de Telegram vigente (rotado 19-sep 04:07, verificado por entrega) · 99 clientes (97 reales + 2 de prueba), un real nuevo desde ayer ya con bcrypt · `git worktree prune` sigue pendiente desde Windows.

**Estado del repo al cierre (18-sep):** `origin/main` = `c1fa9de` (+ este commit de docs) · rama de worktree `claude/st-perfumeria-tablet-responsive-2974b8` = main (worktree `serene-jennings-e9d305`) · árbol limpio · 0 `.patch` sueltos · `feat/s2-bcrypt` local sin commits propios (`git worktree prune` desde Windows, pendiente) · SW **v1.1.101** en producción · 98 clientes (96 + 2 de prueba), bcrypt creciendo con cada login.

**Estado del repo al cierre (17-sep, noche):** `origin/main` = `7ab38cd` (+ este commit de docs) · rama de worktree `claude/st-perfumeria-tablet-responsive-2974b8` = main (worktree `serene-jennings-e9d305`; el anterior fue reciclado) · `feat/s2-bcrypt` local sin commits propios, ligada a un worktree borrado → `git worktree prune` desde Windows en otra sesión · **0 `.patch` sueltos** · SW **v1.1.101** en producción · policies de `clientes`: sólo 4 `authenticated` · 98 clientes (96 + 2 de prueba a borrar desde el panel), bcrypt creciendo con cada login.

**Estado del repo al cierre (16-sep):** `origin/main` = `1cb7246` (+ este commit de docs) · rama de worktree `claude/st-perfumeria-tablet-responsive-2974b8` = main · árbol limpio · SW **v1.1.99** pusheado (dos bumps seguidos: las tablets ven el banner amarillo dos veces) · pendiente de probar en la Tab A9 real: Depósito → número verde → − − → casilla; badge Local → modal de Stock; buscar + guardar → la búsqueda sigue.

**Estado del repo al cierre (15-sep, noche):** `origin/main` = `0f11376` (+ este commit de docs) · rama de worktree `claude/st-perfumeria-tablet-responsive-2974b8` = main · árbol limpio · SW **v1.1.97** pusheado (Vercel deploya solo; las tablets ven el banner amarillo) · breakpoint 700 sin cambios, decisión documentada.

**Estado del repo al cierre (15-sep):** `origin/main` = `f6492f9` · rama `feat/admin-fluido` = main · árbol limpio · SW **v1.1.96** confirmado en `www.stperfumeria.com` · SQL `add_precio_frasco_max.sql` y `add_precio_decant.sql` ya corridos por Alejo (columnas verificadas).

**Estado del repo al 12-ago (mañana):** `origin/main` = `196586e` · nadie tocó nada en 6,5 semanas · sitio corriendo estable con SW v1.1.78, sin reportes de fallas.

---

**⭐⭐ CIERRE DEFINITIVO DE LA SESIÓN — Agosto 12, 2026 (noche).** 16 commits. Arrancó como "¿qué pendientes tenemos?" y terminó con **6 keywords cerrados, 1 plan nuevo diseñado y 2 bugs que costaban ventas arreglados**. SW v1.1.78 → **v1.1.83** (5 bumps).

**Lo que se cerró:** `[FOTOS-OREGON]` (97 URLs de fotos reapuntadas · la migración de mayo estaba a medias) · **Oregon: ver `[S4-OREGON]`** · **S11** (auth *fail-open* en `/api/send-notification`, arreglado antes de que fuera alcanzable) · `[WAITLIST-AVISO-REAL]` (el aviso de reposición fallaba en silencio **y reportaba éxito**) · `[DEPOSITO]` (pestaña nueva con el stock del depósito) · `[PAUSADO-OCULTO]` (los pausados = archivados salen de toda la web · 71 productos) · `[DECANTS-ESPACIO]` (**un cliente real no pudo comprar**: el marco fijo del armador dejaba 1 card visible en celular · ahora 3-5) · `[OCULTAR-PAUSADOS]` + `[OCULTAR-VALOR-INV]`.

**Lo que quedó diseñado sin implementar:** `[AVISOS-PRIORIDAD]` — ventana de privilegio para la lista de espera, con SQL escrito y **sin testear**, en `docs/PLAN_AVISOS_PRIORIDAD.md`. Decisión de Alejo: **prioridad 100% manual**.

**Los tres hallazgos que más importan para la próxima:** (1) **Vercel no tiene NINGUNA variable de entorno** → backup propio y push rotos desde mayo; (2) los backups diarios de Supabase funcionan pero **NO incluyen las fotos**; (3) **82 fichas de clientes y 78 contraseñas en texto plano** descargables con la clave pública.

**Patrón que se repitió 3 veces en la misma sesión** (`[FORGOT-PASS-WA]`, `[WAITLIST-AVISO-REAL]`, y el `avisarTodos` de la tab Espera): **`window.open` después de un `await` lo frena el bloqueador de pop-ups**, y peor todavía cuando el código marca "hecho" antes de confirmar. Regla que sale de acá: *nunca marcar como hecho antes de verificar, y el disparador de una notificación no puede vivir en el navegador de una persona*.

**Dos veces me equivoqué y las dos las corregí midiendo, no discutiendo:** la consulta de descubrimiento de `[FOTOS-OREGON]` dejaba afuera las columnas `ARRAY` (lo destapó Alejo preguntando *"¿es así?"*), y el diagnóstico inicial de `[DECANTS-ESPACIO]` (`min-height: 0`) era un mito desmentido por un A/B. **Ambas correcciones están documentadas a propósito**, porque el error plausible es el que se repite.

**Estado al cierre:** repo limpio, todo pusheado, `origin/main` = `bcc0ffe`, sitio verificado en vivo (141 imágenes desde São Paulo, 0 rotas).

**Próxima revisión cuando:** 🔴 `[VERCEL-ENV-VARS]` (revive backup + push · **re-testear el 401 de `/api/send-notification`**, que hoy no es observable) · 🔴 `[BCRYPT-MIGRATION]`/S2 (pasos 1 y 2 juntos, con el local cerrado) · 🟡 `[BACKUP-FOTOS-LOCAL]` · 🟠 `[SECURITY-AUDIT-S1]` + S10 · 🟢 `[AVISOS-PRIORIDAD]` Etapa 1 · 🟢 CLS iter 5, SW-BANNER-SMART, logo @2x, `?width=400`, JS-CHUNK iter 2.

---

**Agosto 12, 2026 (tarde/noche · sesión `[FOTOS-OREGON]`).** Se fue a bajar el proyecto de Oregon y se descubrió que **la migración de mayo había quedado a medias**: 97 filas en 5 tablas apuntaban las fotos al servidor viejo (el navegador sólo mostraba 80 · **la BD es la fuente de verdad**). Se corrigieron con respaldo + ensayo + bloque atómico y se verificó doble: **0 rastros en la BD y 141 imágenes desde São Paulo, 0 rotas, en el sitio vivo**. Oregon: ver `[S4-OREGON]`. Dos hallazgos nuevos serios: **Vercel no tiene NINGUNA variable de entorno** (backup propio + push rotos desde mayo) y **los backups diarios de Supabase SÍ funcionan pero NO incluyen las fotos**. Se midió S2 con números: **82 fichas de clientes y 78 contraseñas en texto plano descargables con la clave pública**. Features nuevas `[OCULTAR-PAUSADOS]` + `[OCULTAR-VALOR-INV]` (`c5678ae`). **SW v1.1.78 → v1.1.79.** Detalle exhaustivo en la sección "Sesión 12-ago-2026 (tarde/noche)" arriba.

**Estado del repo al cierre:** `origin/main` = `c5678ae` · SW **v1.1.79** · sitio verificado OK post-cambios (141 imágenes SP, 0 rotas, 462 tarjetas, 233 filas de stock).

**Contexto histórico previo (27-jun mañana):** Sesión larga y productiva. Dos features grandes ANDANDO: (1) `[TG-RESUMEN-DIARIO]` resumen diario de Telegram (función `daily_summary` + `pg_cron` 23:00 ART + 6 notifs silenciadas · commit `1ded56a`) que reemplaza el bombardeo de 16-114 Telegrams/día por 1 resumen al cierre; (2) `[FORGOT-PASS-A]` recuperación de contraseña de clientes COMPLETA (tabla `password_reset_requests` + botón "¿Olvidaste tu contraseña?" en login + tab admin "Pedidos pass" · commit `db9d485`) · reusa el flujo "primer login setea pass" (password=NULL) · NO toca el login existente. SW v1.1.73 → **v1.1.75** (badge violeta `[BADGE-LAST-VIOLETA]` `42b5dce` + TG-RESUMEN `1ded56a` + docs `8229726` + FORGOT-PASS `db9d485`). Telegram confirmado FUNCIONANDO (`[FIX-TELEGRAM-PG-NET]` era falsa alarma · obsoleto). **El MCP de Supabase es la vía principal para SQL/infra** (psql/pg_dump desaparecieron del sistema). Detalle exhaustivo en sección "Sesión 27-jun-2026" arriba + `docs/BACKEND.md` + `docs/DATABASE.md`.
**Próxima revisión cuando:** (orden recomendado al **cierre del 12-ago noche**)

1. 🔴 **`[BCRYPT-MIGRATION]` / S2 — LO MÁS IMPORTANTE.** Medido el 12-ago: **82 fichas y 78 contraseñas en texto plano** descargables con la clave pública. El daño real le cae a los clientes (reutilizan contraseñas). Plan de 3 escalones acordado con Alejo: **(1) cerrar la RLS + login por función `SECURITY DEFINER` que devuelva un booleano ~1 h · (2) hashear con bcrypt + migración perezosa ~1-2 h · (3) Supabase Auth, sesión aparte.** ⚠️ **Los pasos 1 y 2 van juntos o no van** — cerrar la policy a secas rompe el login. Hacerlo con el local cerrado.
2. 🔴 **`[VERCEL-ENV-VARS]` (nuevo)** — Vercel está **sin ninguna variable**: backup propio, alta de suscriptores y envío de push **rotos desde mayo**. Reponer `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`. ⚠️ La service key se copia **directo de Supabase a Vercel, nunca por chat**. Se solapa con S1 (si el push pasa a auth de sesión, `ADMIN_PASS` desaparece).
3. 🟡 **`[BACKUP-FOTOS-LOCAL]` (nuevo)** — bajar el bucket `perfume-fotos` a `D:\backups\`. Los backups diarios de Supabase **no incluyen Storage**; hoy la única segunda copia son los archivos que quedaron en el proyecto de Oregon.
4. 🟠 **`[SECURITY-AUDIT-S1]` (re-scoped)** — (a) borrar `ADMIN_PASS_EMPLEADO` (código muerto, trivial) · (b) sacar `ADMIN_PASS` del JS público cambiando `/api/send-notification` a auth de sesión server-side. **Ya NO es login-bypass** (verificado 27-jun).
5. 🟠 **S10 · stored XSS en el admin** — escapar `c.nombre`/`c.nota` en `renderClients` (~L3900) y auditar el resto de los `innerHTML` del panel.
6. 🟡 Rotar token de Telegram (S3) + DB passwords (S5) · migrar a Supabase Auth.
7. 🟢 CLS Desktop iter 5 · `[SW-BANNER-SMART]` · logo @2x · imágenes Supabase con `?width=400` · JS-CHUNK iter 2 · tab "Orden de compra sugerida".

✅ **Salieron de la lista:** testear `[FORGOT-PASS-A]` (hecho y verificado en prod) · `git pull` del main repo desincronizado (los commits van por worktree con `git push origin <branch>:main`) · 💸 **bajar Oregon** (ver `[S4-OREGON]`) · `[FOTOS-OREGON]` (97 URLs corregidas y verificadas).

⚠️ **Pendiente de decisión, no de trabajo:** Oregon: ver `[S4-OREGON]` (detalle fuera del repo; la historia de git conserva la versión anterior de esta línea).

---

## ✅ Resueltos (movidos desde `CLAUDE.md` § Pendientes)

> Desde el 18-sep-2026, `CLAUDE.md` § Pendientes lista **sólo los abiertos** (ID = keyword). Lo que se cierra viene acá con su texto completo, tal como estaba, para no perder nada. Numeración original de CLAUDE.md quitada (los números se repetían y no identificaban nada).

**Movidos el 2-oct-2026 (`_aw`, tanda `chicos-panel`):** todo esto salió a producción la noche del 1-oct (v1.1.159 a v1.1.163, `main` = `d82054f`). Los textos dicen «en la rama…» o «sin mergear» porque se escribieron antes del despliegue.

- ✅ ~~**`[DESTACADOS-BORRA-SI-FALLA]`**~~ (29-sep, salió de la revisión de la ronda x · 🟠, prioridad propuesta por Claude Code: se pierden datos; de antes) — **Arreglado en v1.1.156, en producción desde el 1-oct (rama `no-pisar`, ya borrada) (v1.1.156, 1.1 del prompt `_x`), sin mergear:** sin la lista de la base (falló o todavía no llegó) agregar, quitar y mover no escriben; un guardado por vez; el borrado y el alta miran su error (si falla el alta, se vuelven a escribir los de antes). Lo que queda es `[DESTACADOS-RPC]`. — si falla la lectura de `destacados` (`loadDestacados`, `admin.html`), la lista en memoria queda vacía, y agregar un perfume desde el buscador de la pestaña llama a `syncDestacadosToDB([slug])`, que borra todos los destacados de la base (`delete().neq('id', 0)`) y escribe sólo ése: la «Selección ST» del sitio queda con 1. Pasa si la carga falla y el alta anda (un corte pasajero). `syncDestacadosToDB` tampoco mira el resultado del borrado ni del alta. En `main` el panel encima invitaba a agregar («0/7», «No hay destacados. Buscá un perfume arriba para agregar.»); desde la ronda x (en la rama `carga-fallida`) muestra «—/7» y el error, pero agregar sigue andando. Arreglo propuesto por los verificadores: `addDestacado` no escribe si la carga falló. Del PREPARADOR. No se tocó.
- ✅ ~~**`[PANEL-STOCK-CALLA]`**~~ (29-sep, salió del inventario de la ronda x · 🟡, prioridad propuesta por Claude Code; de antes) — **Arreglado en v1.1.157, en producción desde el 1-oct:** 128n: sin la lectura del stock, la línea «No se pudo cargar el stock…» arriba de la tabla (Precios & Stock y Depósito) y el Estado de cada fila en «—» gris, sin toque; el precio y el efectivo también en «—» si falló la de los overrides (de ahí salen los precios que cambió el jefe). (desde la rama `no-pisar`, 1.2: los modales de stock y de depósito, Editar y Migrar tipos ya no escriben sin el stock o los overrides de la base; lo que sigue callado es la tabla) — si al entrar al panel falla la lectura de `perfume_overrides`, las tablas de Precios & Stock y Depósito muestran el stock de `perfumes.js` (todas las filas «En stock» o «Vacío») sin ningún aviso; desde la ronda x (rama `carga-fallida`) las tarjetas de arriba dicen «—», pero las filas no. Si falla `perfumes_nuevos` (`mergeNuevosIntoPerfumes` no mira el error), los ~117 nuevos no están en el panel hasta recargar y los totales los dejan afuera sin decirlo. Del PREPARADOR / DISEÑADOR (¿un aviso arriba de la tabla?). No se tocó.
- ✅ ~~**`[MAZO-TAPADO]`**~~ (29-sep, salió del relevamiento de `[FACILITAR-MOBILE-EN-CATALOGO]` · 🟡, prioridad propuesta por Claude Code; de antes) — **Arreglado en v1.1.157, en producción desde el 1-oct:** 134: con la barra pegada (celu) el mazo se esconde (`.filter-bar--pegada`, un IntersectionObserver en `app.js`): debajo de la cinta no queda nada tocable (70 de 260 puntos caían en el mazo; ahora 0) y la geometría no cambia (236,8). a 390, con el catálogo pegado arriba, el botón del género activo (`#filterDeck .filter-btn.active`, 160 × 31) queda en 71-102, debajo de la cinta de cuotas (58-97): se ven 5 px, y un toque en su centro cae en la cinta (`#homeTopBannerTrack`). Para filtrar por género hay que volver al comienzo del catálogo (ahí queda en 148-179 y se toca). Del DISEÑADOR. No se tocó.
- ✅ ~~**`[SUGERENCIAS-BAJO-ORDENAR]`**~~ (29-sep, ídem · 🟡, prioridad propuesta por Claude Code; de antes) — **Arreglado en v1.1.156, en producción desde el 1-oct (rama `no-pisar`, ya borrada) (v1.1.156, 1.5), sin mergear:** con sugerencias, `.filter-zone--center` va en `z-index: 101` (`:has`), y `.filter-bar` lleva `isolation` a partir de 768 (Safari ≤ 17). — a 390, al escribir en el buscador, «Ordenar» (`.filter-btn`, `z-index: auto`, 237-270) queda encima de la primera sugerencia (`#searchSuggestions`, `z-index: 95`, 227-287) y tapa su nombre. Del DISEÑADOR / PREPARADOR. No se tocó.
- ✅ ~~**`[QUOTE-JEFE-SE-BORRA]`**~~ (29-sep, salió del barrido de la ronda y · 🟡, prioridad propuesta por Claude Code: borra datos en cada guardado; de antes) — **Arreglado en v1.1.157, en producción desde el 1-oct:** `loadOverridesIntoPerfumes` copia `nota_jefe`: Editar la muestra y «Guardar cambios» ya no la pisa con vacío. Editar abre la «Quote del jefe» siempre vacía: `loadOverridesIntoPerfumes` (`admin.html`) no copia `nota_jefe` a `PERFUMES` (el catálogo sí, `js/app.js`). Y `saveEditPerfumeAhora` escribe `nota_jefe: ''`: cada «Guardar cambios» de un perfume borra su quote de la Selección ST, sin dejarlo en el Log. Hoy hay **0** filas con quote en `perfume_overrides`. Arreglo de una línea (copiar `nota_jefe` como las otras notas); del PREPARADOR. No se tocó.
- ✅ ~~**`[COMBO-FORM-CLARO]`**~~ (29-sep, salió de medir la ronda y · 🟡, del DISEÑADOR; de antes) — **Arreglado en la rama `tintas` (v1.1.158, 30-sep), sin mergear:** 137: la caja pasa a `--superficie` en claro (el borde `--amarillo` se queda), «Cancelar» con fondo `rgba(0,0,0,.06)` y el ✕ en `--tinta-error`. en claro, la caja de Editar combo (`#comboForm`) queda `#111`: el título «Editar: …» `#6b5500` **2,63**, las etiquetas `#444` **1,94**, «Cancelar» `#333` sobre `#292929` **1,15** (en oscuro 10,15 / 11,76 / 9,08). No se tocó.
- ✅ ~~**`[ESPERA-LIBRE]`**~~ (1-oct, el dibujo del DISEÑADOR 142 a 142d · 🟡, del PREPARADOR) — **Hecho en la rama `espera-libre` (v1.1.161, 1-oct), sin mergear y con un SQL sin aplicar:** anotar en la lista de espera algo que no está en el catálogo. Ver NO ROMPER #24. **Orden de despliegue: primero el SQL (columna `libre` + CHECK), después el merge**; sin la columna sólo falla anotar algo libre (lo de siempre anda, porque la columna se manda sólo en lo libre).
- ✅ ~~**`[HORARIO-ERROR-OSCURO]`**~~ (29-sep, salió de medir la ronda x · 🟢, del DISEÑADOR) — **Arreglado en v1.1.156, en producción desde el 1-oct (rama `no-pisar`, ya borrada) (v1.1.156, 1.4), sin mergear:** `.ajuste-error` `#ff8a80` en oscuro (7,29), `--stat-tinta-out` en claro (5,60). — el error nuevo de «Horario modificado» (1.2, en la rama `carga-fallida`) va en `--stat-tinta-out`, como pidió el prompt: en claro `#b8342a` sobre `#fdf9eb` **5,60**; en oscuro `#e74c3c` sobre `#221e10` (el recuadro amarillento sobre `#111`) **4,34**, debajo de 4,5. Medidas para elegir: `#ff6b6b` 6,00 y `#ff8a80` 7,29 (el de `[CLIENTES-OSCURO-ROJO]`). No se tocó.
- ✅ ~~**`[MENSAJES-FIJOS-CLARO]`**~~ (29-sep, salió de medir la ronda y · 🟢, del DISEÑADOR; de antes) — **Arreglado en la rama `tintas` (v1.1.158, 30-sep), sin mergear:** 136: los mensajes del panel usan `--tinta-ok` / `--tinta-aviso` / `--tinta-error` (NO ROMPER #22). mensajes con color fijo que en claro no se leen: el error del ranking de puntos `#ff7a7a` **2,52**; los otros de «Sumar punto» `#e74c3c` **3,82**; en Destacados, «agregado» 1,90, «Ya está» 1,50, «eliminado» y «Máximo 7» 3,45 (sobre `#f5f3ee`). No se tocó.
- ✅ ~~**`[BACKUP-INCOMPLETO]`**~~ (29-sep, salió del barrido de la ronda y · 🟡 desde el 30-sep por `decants_custom` (16 filas con precios de decants), decisión del PREPARADOR: va en una ronda propia, tablas de configuración sí, logs no; de antes) — **Arreglado en la rama `backup-completo` (v1.1.159, 1-oct), sin mergear:** las dos listas (`BACKUP_TABLES` de `admin.html` y de `api/cron/backup.js`) iguales y completas, 23 tablas (NO ROMPER #23). si una tabla no se pudo leer, «Crear backup» (y el de respaldo) guarda el backup sin ella y dice «✅ Backup creado», sin nombrarla (va en `errors` del JSON). Como se guardan los últimos 12, varios incompletos pueden sacar a uno completo. No se tocó.
- ✅ ~~**`[COMBO-REGALO-ROJO]`**~~ (1-oct, salió de medir 138b · 🟢, prioridad propuesta por Claude Code; de antes) — **Arreglado en la rama `combos-ranking` (v1.1.160, 1-oct), sin mergear:** 138c: REGALO y ROTO a `--rojo-fondo` con letra blanca (5,89); ROTO pasó del inline a `.combo-badge-roto`. la etiqueta REGALO de los combos (`.combo-badge-regalo`) es `#fff` sobre `#e74c3c`: **3,82** en los dos temas. Está en `contraste.js` como «conocida». El rojo de fondo con letra blanca es `--rojo-fondo` (`#b8342a`, 5,89). Del DISEÑADOR. No se tocó.
- ✅ ~~**`[VENTAS-SIN-POLITICA]`**~~ (1-oct · 🟡 y de vuelta a 🟢 el mismo día, decisión del PREPARADOR: nada escribe en `ventas`, así que el riesgo que se había marcado no existe) — `ventas` tiene RLS prendida y **0 políticas**: el panel la lee vacía y sin error; el cron del backup, con la clave de servicio, sí la trae. Se cierra para que el backup del panel y el del cron den lo mismo: **migración `ventas_select_staff`** (`FOR SELECT TO authenticated`, con la misma expresión por email de `pd_select_staff`; nada de INSERT, UPDATE ni DELETE), **a aplicar fuera de 10–21 (desde las 21:00 del 1-oct)**; después se pega `pg_policies`. Medido: 0 filas; ningún código escribe en `ventas` (la escribía la pestaña «Registrar Ventas», `4bc52d4`, eliminada en `4cd33d6`).
- ✅ ~~**`[MAYOR-STOCK]`**~~ (1-oct, idea de los chicos y decidida por Alejo · 🟡, prioridad propuesta por Claude Code) — **Hecho en la rama `mayor-stock` (v1.1.162, 1-oct), sin mergear:** en Precios & Stock (el stock del local), «En stock primero» (`stock-ok`) pasa a «Mayor stock primero» (`stock-max`): cuatro grupos, con los campos del perfume (`_stockQty` y `_stockStatus`): (0) cantidad mayor que 0, de mayor a menor; (1) estado `ok` o `low` con la cantidad vacía («En stock» / «Último» sin número); (2) cantidad 0 o negativa, estado `out`, o ni cantidad ni estado; (3) pausados al final (sólo se ven con «Mostrar pausados»). Si cantidad y estado se contradicen, manda la cantidad. En cada grupo y en los empates, por nombre de la A a la Z. **Medido en la base (1-oct):** los 263 perfumes tienen fila de override, 184 con cantidad, 0 «En stock» sin número, 8 «Sin stock», 71 pausados, 0 contradictorios y 0 sin cantidad ni estado. **Depósito no cambia:** nunca tuvo «En stock primero»; su «Más en depósito» ya ordena por la cantidad del depósito con el desempate por nombre. El orden no se guarda (el select vuelve a «Nombre A-Z» al abrir el panel). Va después de `espera-libre` (desde el 3-oct).
- ✅ ~~**`[ESPERA-INVITADO]`**~~ (142m, 1-oct, idea de Alejo, elegida A + B · 🟡, prioridad propuesta por Claude Code) — **Hecho en la rama `espera-invitado` (v1.1.163, 1-oct), sin mergear:** A, el invitado se anota desde la web con teléfono y nombre opcional; B, el cartel «Tenés N avisos pendientes» al entrar; con los textos, la línea de dígitos, la card y el cartel de 142m1 a 142m6 del DISEÑADOR. Ver NO ROMPER #25. **Orden de despliegue: primero el SQL de la función `lista_espera_pendientes` (devuelve `libre:` a secas para lo libre; aprobado por el PREPARADOR, `_at`), después el OK del DISEÑADOR y del PREPARADOR sobre el HEAD final, después el push de Alejo fuera de 10-21.** Sin otro SQL.
- ✅ ~~**`[WEB-STOCK-DUDOSO]`**~~ (142l, 1-oct · **cerrado por el DISEÑADOR**, la web no se toca, a propósito) — la web pública decide por el estado (`'ok'` si falta); un perfume con cantidad negativa o sin cantidad ni estado se ve disponible con «Consultar». El panel avisa a la chica (142k) y la consulta termina en WhatsApp con una persona. **Condición para SiPago (ítem 74 del DISEÑADOR, que no vive en este repo):** el día que la web tenga «Pagar», sólo se paga con una cantidad leída ≥ 1; los negativos y los sin dato quedan en «Consultar», sin «Pagar».

**Movidos el 29-sep-2026 (`_x`):**

- ✅ ~~**`[PANEL-HOY-UTC]`**~~ (29-sep, salió de la revisión de la ronda v · 🟢, confirmado por el PREPARADOR) — `loadCierres` y `loadAjuste` (`admin.html`) calculaban «hoy» con `new Date().toISOString()`, en UTC (NO ROMPER #6): de 21 a 24 (ART) el panel mostraba como pasado el cierre de hoy y escondía el ajuste de horario que terminaba ese día, aunque el catálogo lo seguía aplicando. **En la rama `pulido-clientes` (ronda w, `_w`):** las dos usan `resumenHoyART()`, y `loadCierres` muestra su error (antes un error decía «No hay cierres programados»). Con el reloj a las 22:30 del 29-09, el cierre de hoy ya no sale como pasado y el ajuste que termina hoy se ve. `addCierre` (`fechas.push(d.toISOString()…)`) no tiene el problema: arma cada fecha al mediodía local. **En producción desde el 29-sep a las 03:50 (ART), v1.1.154.**

**Movidos el 29-sep-2026 (`_w`):**

- ✅ ~~**`[CLIENTES-OSCURO-ROJO]`**~~ (28-sep, salió de medir la 132 · 🟢, del DISEÑADOR) — en oscuro, el rojo `#e74c3c` de la tarjeta de «Clientes» no llega a 4,5: 🗑️ Eliminar **4,26** (sobre `#311a17`) y ✗ NO COMPRÓ **4,42** (sobre `#2b1816`). La 132 cambió sólo el claro (y Editar); ya era así en `main`. `npm run contraste` los marca como conocidos. No se tocó. **En la rama `pulido-textos` (ronda v, `_v`):** en oscuro, Eliminar y ✗ NO COMPRÓ pasan a `#ff8a80` (el rojo de la decisión 100): 7,13 y 7,39. El claro, igual. `npm run contraste` ya no los marca como conocidos. → **RESUELTO el 29-sep**, en producción con v1.1.153 (merge de `pulido-textos`, 03:05 ART).
- ✅ ~~**`[CLIENTES-HOVER]`**~~ (29-sep, salió de medir la 132 · 🟢, del DISEÑADOR) — los `:hover` de los botones de la tarjeta de «Clientes» (Combos usa las mismas clases): Editar, blanco sobre `#5dade2`, **2,46** en los dos temas; en claro, Bloquear **4,32** y Eliminar **3,97**; en oscuro, Eliminar **3,42**. En la tablet el hover queda puesto después del toque. Ya era así en `main` (el hover de Editar no cambió). No se tocó. **En la rama `pulido-textos` (ronda v, `_v`):** los `:hover` van sólo con mouse (`@media (hover: hover)`): en la tablet no quedan puestos. Editar se oscurece a `#1a5a8f` (7,23). Bloquear y Eliminar, la misma letra sobre un fondo `.18`: claro 4,76 / 4,67, oscuro 6,31 / 6,86. `npm run contraste` mide también el hover. → **RESUELTO el 29-sep**, en producción con v1.1.153 (merge de `pulido-textos`, 03:05 ART).
- ✅ ~~**`[HORARIO-BORRA-ANTES]`**~~ (29-sep, salió de la revisión de la ronda u · 🟢, anotado por el PREPARADOR) — `saveAjuste` (`admin.html`) borraba todos los ajustes de horario (`delete().neq('id', 0)`, sin mirar el resultado) antes del `insert`: si el `insert` fallaba, el ajuste activo se perdía y la web volvía al horario de siempre. **En la rama `pulido-textos` (ronda v, `_v`):** primero el `insert` y, si salió, se borran sólo los anteriores (`lt('id', nuevo)`: con dos guardados cruzados queda el último). «Guardar horario» se apaga mientras guarda. Si falla el borrado, el nuevo manda, el formulario queda y el aviso no se va solo. «Volver al horario normal» borra todos y mira el error. El catálogo y el panel leen el más nuevo (`order created_at desc, limit 1`). → **RESUELTO el 29-sep**, en producción con v1.1.153 (merge de `pulido-textos`, 03:05 ART).

**Movidos el 29-sep-2026 (`_v`):**

- ✅ ~~**`[COMBO-PISA-COMBO]`**~~ (28-sep, salió de 128h · 🟢, prioridad propuesta por Claude Code) — `saveCombo` (`admin.html`) arma el `slug` de un combo nuevo con el nombre (`'set-' + nombre`, en minúsculas) y guarda con `upsert` por `slug`: si ya hay un combo que da el mismo `slug` («Verano» y «VERANO»), el nuevo lo pisa sin avisar. Por eso Combos no tiene «Ya existe…» en 128h: la base nunca responde 23505. Además, `combos` tiene el único de `slug` dos veces (`combos_slug_key` y `combos_slug_unique`). No se tocó. **En la rama `pulido-panel` (ronda u, `_u`):** al crear, un nombre que da el `slug` de algo que ya está en la lista no pisa al otro: «Ya existe un combo con ese nombre.», sin escribir. Si no está en la lista va `insert`: el 23505 de la base da el mismo mensaje y recarga la lista. «Guardar combo» se apaga mientras guarda y hasta que se cierra el formulario. Editar, `upsert` como antes. → **RESUELTO el 29-sep**, en producción con v1.1.152 (merge de `pulido-panel`, 02:35 ART).
- ✅ ~~**`[COMBO-BORRA-SIN-MIRAR]`**~~ (28-sep, salió de la revisión de la ronda t · 🟢, de antes, prioridad propuesta por Claude Code) — `deleteCombo` (`admin.html`) no mira el resultado del `delete`: si la base lo rechaza, igual saca el combo de la lista, lo anota en el Log y manda el Telegram; vuelve al recargar. El `catch` (128j) sólo corre con una excepción. Del PREPARADOR. **En la rama `pulido-panel` (ronda u, `_u`):** `deleteCombo` pide la fila (`.select('slug')`): con error, o con 0 filas (un DELETE que la RLS no deja no da error), el combo sigue en la lista, sin Log ni Telegram, y el mensaje sale por `errorEnCriollo`. → **RESUELTO el 29-sep**, en producción con v1.1.152 (merge de `pulido-panel`, 02:35 ART).
- ✅ ~~**`[CRIOLLO-BORDES]`**~~ (28-sep, salió de la revisión de la ronda t · 🟢, prioridad propuesta por Claude Code) — bordes de `errorEnCriollo` que aparecen al usarla también en las cargas: un `TypeError` del propio código (no de la red) sale como «No se pudo conectar»; un `42501` al cargar dice «Esta cuenta no puede guardar esto.»; los «Guardar» de 128h (Depósito, horario, combo, candidatos, editar cliente) no llevan `tocaGuardar`; y las validaciones propias de las fotos («Imagen inválida») pasan a «Probá de nuevo». Del PREPARADOR. **En la rama `pulido-panel` (ronda u, `_u`):** sin conexión = `navigator.onLine === false` o el mensaje de la red (se va `e.name === 'TypeError'`; el regex suma «network error» y los de Safari: «The network connection was lost.», «The request timed out.»…); un 42501 al leer («cargar …» o «descargar el backup») → «Esta cuenta no puede ver esto.»; `tocaGuardar` en los cinco de 128h con «Guardar»; los mensajes propios se arman con `errorPropio(texto)` y van tal cual (las fotos: «Imagen inválida»). → **RESUELTO el 29-sep**, en producción con v1.1.152 (merge de `pulido-panel`, 02:35 ART).
- ✅ ~~**`[LOGIN-CLARO-TELEFONO]`**~~ (28-sep, salió de la revisión de la ronda t · 🟢, de antes, del DISEÑADOR) — en claro, en «Unite a ST», los textos del teléfono con color inline: ✓ verde `#27ae60` 2,50, rojo `#e74c3c` 3,33 y «(N dígitos faltan)» `#999` 2,48 sobre `#f5efde`. Además, la regla `body:not(.dark-mode) .auth-modal p { color: #2a2622 !important }` deja el error y el ✓ de la ventana en gris oscuro, sin rojo ni verde. No se tocó. **En la rama `pulido-panel` (ronda u, `_u`):** en claro, por clase: ✓ `#1b5e20` (6,85), el rojo y `.auth-error` `#b8342a` (5,13), «(N dígitos faltan)» `#5e564a` (6,29). La regla de los `<p>` de la ventana pasa a `p:not(.auth-error)` (sin otro `!important`). El oscuro, igual. → **RESUELTO el 29-sep**, en producción con v1.1.152 (merge de `pulido-panel`, 02:35 ART).
- ✅ ~~**`[LOGIN-CAMPOS-QUEDAN]`**~~ (28-sep, salió de las capturas de la ronda t · 🟢, de antes) — después de entrar, el número y la contraseña quedan escritos en los campos de «Iniciá sesión» (sólo se vacían al recargar): si la sesión se corta en esa misma carga, la ventana se reabre con los dos cargados. No se tocó. **En la rama `pulido-panel` (ronda u, `_u`):** `limpiarCamposAuth()` después de entrar, de registrarse (también cuando la cuenta quedó creada pero entrar no dio llave) y al cerrar sesión (también en una salida forzada). → **RESUELTO el 29-sep**, en producción con v1.1.152 (merge de `pulido-panel`, 02:35 ART). En `pulido-textos` el registro que termina sin sesión pasa a la opción B (quedan el número y la contraseña).

**Movidos el 29-sep-2026 (`_u`):**

- ✅ ~~**`[S13-ESCRITURAS-ANON]` / S2-bis**~~ (16-sep · 🟠) — agujero abierto: **sólo la keyword** (regla del 23-sep, aplicada también a lo viejo). Se resuelve con `[SUPABASE-AUTH]`. Ver `docs/SECURITY.md` § S13. En camino: `[SESION-CLIENTE]` está en producción desde el 28-sep a las 22:22 (ART); falta el Bloque 3 del PREPARADOR (desde el 29-sep a las 22:22, hora de Argentina). → **RESUELTO el 28-sep**: la llave de `[SESION-CLIENTE]` (v1.1.150) y el Bloque 3 del PREPARADOR, ya corrido cuando se miró (28-sep, ~23:25 ART); verificado en `pg_policies` y en los permisos el 28-sep y el 29-sep a las 02:23. Detalle en SECURITY.md § S13.
- ✅ ~~**`[ERRORES-CRUDOS-OTROS]`**~~ (28-sep, salió de 128h · 🟢, prioridad propuesta por Claude Code) — fuera de los 18 de 128h, el panel muestra el error de la base en **31 lugares más**, con otras formas: «✗ Error: …» (badges, banner, slides), «❌ Error al guardar: …», «✗ …» (Decants de diseñador, backups), `alert('Error al eliminar: …')` y parecidos. Uno va a `innerHTML` sin escapar (`loadResetRequests`, «Reset contraseñas»: es el mensaje de un `select` fijo, no lo escribe nadie de afuera). Varios tienen un texto propio de respaldo («¿Creaste la tabla…?»). Si pasan por `errorEnCriollo`, lo decide el DISEÑADOR. No se tocó. **En la rama `pulido-login` (ronda t, `_t`):** 128j: los 31, `loadResetRequests`, `loadClientes` y los «Revisá permisos en Supabase (RLS)» pasan por `errorEnCriollo`, en el mismo lugar y forma («probá de nuevo»; `tocaGuardar` donde el botón dice «Guardar»). El tope de pushes por día conserva su mensaje. → **RESUELTO el 28-sep**, en producción con v1.1.151 (merge de `pulido-login`, 23:21 ART).
- ✅ ~~**`[LOGIN-CLARO-CONTRASTE]`**~~ (28-sep, de antes · 🟢, del DISEÑADOR) — en claro, en «Iniciá sesión»: «ENTRAR» **1,29** (`#e3d6b3` sobre `#E8B800`), «Creá una» **1,62** y «¿Olvidaste tu contraseña?» **1,67** (sobre `#f5efde`). En oscuro: 10,06 · 9,33 · 9,04. `npm run contraste` no mide esta ventana. No se tocó. **En la rama `pulido-login` (ronda t, `_t`):** 131, sólo en claro: «ENTRAR» / «Unirme» / «Guardar cambios» `#1a1a1d` (9,33), «Creá una» / «Iniciá sesión» `--amarillo-tinta` (6,25), «¿Olvidaste tu contraseña?» `#5e564a` (6,29); los links pasan a `.auth-link` / `.auth-link-sec` y la ventana entra en `npm run contraste`. El oscuro, igual. → **RESUELTO el 28-sep**, en producción con v1.1.151 (merge de `pulido-login`, 23:21 ART).
- ✅ ~~**`[BACKUP-SIN-FAVORITOS]`**~~ (28-sep, salió de la revisión de `[SESION-CLIENTE]` · 🟢) — ni el backup del panel (`BACKUP_TABLES`, `admin.html`) ni el del cron (`api/cron/backup.js`) incluyen `favoritos` ni `mi_seleccion`. Decide Alejo si se suman (si cambia una lista, cambiar la otra). **En la rama `pulido-login` (ronda t, `_t`):** opción A, decisión de Alejo (28-sep): `favoritos` y `mi_seleccion` en las dos listas (panel y cron). Con el Bloque 3, el PREPARADOR suma que el panel pueda leerlas. → **RESUELTO el 28-sep**, en producción con v1.1.151 (merge de `pulido-login`, 23:21 ART).
- ✅ ~~**`[CLIENTES-BUSCA-TEL-FORMATO]`**~~ (28-sep, salió de la revisión de la ronda s · 🟢, prioridad propuesta por Claude Code) — la tarjeta de «Clientes» muestra el teléfono con formato («+54 9 2970 00-0011», `[CLIENTES-FECHA-TEL]`), pero el buscador busca en `data-tel`, que sigue crudo (lo pidió el PREPARADOR): escribir el número como se ve no lo encuentra. Del PREPARADOR (por ejemplo, comparar los dígitos). **En la rama `pulido-login` (ronda t, `_t`):** si lo buscado parece un número, también encuentra por los dígitos del teléfono («+54 9 2970 00-0011», «297 000»). → **RESUELTO el 28-sep**, en producción con v1.1.151 (merge de `pulido-login`, 23:21 ART).
- ✅ ~~**`[TELEFONO2-MUERTO]`**~~ (28-sep, del PREPARADOR · 🟢) — la línea 📞 de `telefono2` en `renderClientes` (`admin.html`) es código muerto: esa columna no existe en la base. No se tocó. **En la rama `pulido-login` (ronda t, `_t`):** fuera de la tarjeta y de la búsqueda. → **RESUELTO el 28-sep**, en producción con v1.1.151 (merge de `pulido-login`, 23:21 ART).
- ✅ ~~**`[AVISO-TAPA-LOGIN]`**~~ (28-sep, salió de la revisión de la ronda s · 🟢, del DISEÑADOR) — el aviso de la sesión vieja (`#avisoToast`) usa la caja de `.cart-toast`: centrado y en `z-index` 99998. Si en esos ~6 s se abre «Iniciá sesión» o se agrega algo al carrito, el aviso queda encima (se cierra tocándolo). **En la rama `pulido-login` (ronda t, `_t`):** el default del PREPARADOR hasta que conteste el DISEÑADOR: el aviso se cierra solo al abrir «Iniciá sesión» o al aparecer el aviso del carrito. → **RESUELTO el 28-sep**, en producción con v1.1.151 (merge de `pulido-login`, 23:21 ART).
- ✅ ~~**`[AUTH-BAJO-DETALLE]`**~~ (28-sep, salió de la revisión de la ronda s · 🟢, de la ronda r) — si la llave se rechaza desde el detalle de un perfume, «Iniciá sesión» (`z-index` 2000) se abre debajo del detalle (10000) y gasta su «una vez por carga». Con la ventana de juegos ya hay una regla que lo sube (`body.juegos-open .auth-overlay`). Del DISEÑADOR / PREPARADOR. **En la rama `pulido-login` (ronda t, `_t`):** `.auth-overlay` en `z-index` 10005 siempre. → **RESUELTO el 28-sep**, en producción con v1.1.151 (merge de `pulido-login`, 23:21 ART).

**Movidos el 28-sep-2026 (`_t`):**

- ✅ ~~**`[FAVS-DISPOSITIVO-COMPARTIDO]`**~~ (28-sep, salió de la revisión de `[SESION-CLIENTE]` · 🟡, prioridad propuesta por Claude Code) — al entrar se suben los favoritos de este dispositivo que no están en la base (punto 3 del prompt `_q` del PREPARADOR), pero `st_favs` no se borra al salir: en un dispositivo compartido, los del cliente anterior se suben a la cuenta del que entra después. Decide el PREPARADOR (por ejemplo, guardar de quién es `st_favs` y subir sólo lo de invitado o lo de la misma cuenta). En la rama `sesion-cliente`, sin tocar. **En la rama `sesion-cliente` (ronda s, `_s`):** marca nueva `st_favs_de` (el `id` del dueño de `st_favs`): al entrar se suben sólo si son de invitado o de la misma cuenta; si son de otra, queda lo de la base (también al retomar la sesión). «Cerrar sesión» los borra (opción A, decisión de Alejo del 28-sep); una salida forzada los deja. → **RESUELTO el 28-sep**, en producción con v1.1.150 (merge de `sesion-cliente`, 22:22 ART).
- ✅ ~~**`[REGISTRO-LLAVE]`**~~ (28-sep, salió de la revisión de `[SESION-CLIENTE]` · 🟢) — la llave de quien se acaba de registrar sale de `cliente_entrar` con los mismos datos. Si ese teléfono venía bloqueado por intentos (`cliente_login_intentos`, 15 min), `cliente_registrar` da `ok` pero `cliente_entrar` da `bloqueado`: la persona ve «Por seguridad, volvé a entrar…» y, al entrar, «Demasiados intentos». Que `cliente_registrar` devuelva la llave lo resolvería (SQL del PREPARADOR). **En la rama `sesion-cliente` (ronda s, `_s`):** con `bloqueado`, «Tu cuenta quedó creada. Por los intentos de antes, esperá N minutos y entrá con tu número y contraseña.» (sin tocar el SQL). → **RESUELTO el 28-sep**, en producción con v1.1.150 (merge de `sesion-cliente`, 22:22 ART). La frase cambia otra vez en `pulido-login` (2.1).
- ✅ ~~**`[VOTO-RETOMAR-APAGADO]`**~~ (28-sep, de antes · 🟡, prioridad propuesta por Claude Code) — al retomar la sesión guardada, los botones de la votación quedan deshabilitados: `unlockVoting` corre desde `onLogin` antes de que `loadVotacionFromDB` (diferida) arme los botones, y `renderVotoButtons` los arma con `disabled`. Con fixture: 4 de 4 apagados, en la rama y en `main`. Se puede votar sólo saliendo y entrando. No se tocó. **En la rama `sesion-cliente` (ronda s, `_s`):** `renderVotoButtons` llama a `unlockVoting` con sesión; sin botones no se piden mis votos, y los botones se habilitan cuando ya se saben. Medido: 4 botones, la categoría votada con sus resultados y `mis_votos` una vez. → **RESUELTO el 28-sep**, en producción con v1.1.150 (merge de `sesion-cliente`, 22:22 ART).
- ✅ ~~**`[PUNTOS-BUSCA-TEL-CRUDO]`**~~ (28-sep, salió de `[TEL-CANONICO-PANEL]` · 🟡, prioridad propuesta por Claude Code) — «Sumar punto» busca al cliente con `.eq('telefono', query)` tal cual se tipeó. Como los 100 teléfonos están como `549` + 10, «2970000011» no encuentra a 5492970000011: pide el nombre y el alta choca con el único («Ya existe un cliente con ese teléfono.»; antes creaba un duplicado en silencio). Y un número con espacios en el buscador se toma como nombre (`esNumero` es `^\d{6,}$`). Arreglo propuesto: buscar también con `cleanPhone(query)` cuando da válido. Del PREPARADOR. **En la rama `sesion-cliente` (ronda s, `_s`):** se busca `cleanPhone` de lo tipeado sin espacios, `+`, guiones ni paréntesis: «2970000011», «297 15 000 0011» y «+54 9 297 000-0011» encuentran al cliente y no piden nombre. → **RESUELTO el 28-sep**, en producción con v1.1.150 (merge de `sesion-cliente`, 22:22 ART).
- ✅ ~~**`[EDITAR-BLOQUEADO]`**~~ (28-sep, salió de la ronda s · 🟢, prioridad propuesta por Claude Code) — **sólo la keyword**; el detalle vive en `_correo_agentes`. SQL del PREPARADOR. → **RESUELTO el 28-sep** (el Bloque 2c del PREPARADOR, corrido por Alejo; verificado en `pg_proc`): un cliente bloqueado desde el panel recibe `pass_incorrecta` y cuenta como un intento fallido, como en el login; al trabarse avisa por Telegram; la función devuelve también `espera_seg`. Antes, un bloqueado no podía entrar pero con su contraseña todavía cambiaba su nombre y su teléfono. Ver SECURITY.md § S30.
- ✅ ~~**`[FAVS-MARCA-BORDES]`**~~ (28-sep, salió de la revisión de la ronda s · 🟢, prioridad propuesta por Claude Code) — tres bordes de `st_favs_de`: (1) lo que marca un invitado después de una salida forzada queda a nombre de la cuenta anterior y se pierde si entra otra (es la regla del punto 3 tal cual); (2) quien hizo «Cerrar sesión» con la v1.1.149 dejó `st_favs` sin marca, y eso se sube a la próxima cuenta que entre (no se distingue de un invitado); (3) con otra pestaña de la misma cuenta abierta, después de «Cerrar sesión» esa pestaña vuelve a escribir `st_favs` y su salida forzada lo deja (y dice «Tu sesión se cerró…»). Decide el PREPARADOR. → **CERRADO el 28-sep, aceptado así** (el PREPARADOR, `_s`): a es la regla, b es de transición y se va sola, c es un borde con dos pestañas de la misma cuenta.

**Movidos el 28-sep-2026 (`_s`):**

- ✅ ~~**`[EDITAR-SIN-LIMITE]`**~~ (28-sep, salió de la revisión de `[SESION-CLIENTE]` · 🟠, prioridad propuesta por Claude Code) — agujero abierto: **sólo la keyword** (regla del 23-sep). Ya estaba en `main`; el detalle vive en `_correo_agentes`. Es SQL del PREPARADOR. → **RESUELTO el 28-sep** (el Bloque 2b del PREPARADOR, corrido por Alejo; verificado en `pg_proc` el 28-sep): `cliente_editar` cuenta los fallos en `cliente_login_intentos` sobre el teléfono de la cuenta (5 → 15 min, el mismo contador que entrar) y devuelve `bloqueado`. Antes, con el `uuid` de un cliente se podían probar claves sin límite. Ver SECURITY.md § S28.
- ✅ ~~**`[SESION-BLOQUEADO]`**~~ (28-sep, salió de la revisión de `[SESION-CLIENTE]` · 🟢, prioridad propuesta por Claude Code) — **sólo la keyword**; el detalle vive en `_correo_agentes`. Es SQL del PREPARADOR (va con el Bloque 3). → **RESUELTO el 28-sep** (el Bloque 2b): `cliente_de_token` hace `join public.clientes` y pide `bloqueado is not true`. Antes, un cliente bloqueado desde el panel seguía escribiendo con su llave hasta que venciera. Ver SECURITY.md § S29.

**Movidos el 28-sep-2026 (`_q`):**

- ✅ ~~**`[ERRORES-CRUDOS-RESTO]`**~~ (28-sep, salió de 128g · 🟢, del PREPARADOR) — 18 mensajes del panel siguen mostrando el error de la base tal cual («Error: …»), fuera de las cinco barras de «Guardar» que pasan por `errorEnCriollo`: stock, depósito, clientes, combos y otros. Si van por `errorEnCriollo`, lo decide el DISEÑADOR. → **RESUELTO el 28-sep** (`5b17edd`, v1.1.149, 128h): los 18 pasan por `errorEnCriollo(err, ctx, que)`. Quedan 31 con otras formas → `[ERRORES-CRUDOS-OTROS]`.
- ✅ ~~**`[ESCAPE-DOBLE-FUNCION]`**~~ (28-sep · 🟢, del PREPARADOR) — `admin.html` tiene dos funciones de escape iguales, `escapeHtml` y `escHtml`. Hay que dejar una sola y que la otra la llame. → **RESUELTO el 28-sep** (`5b17edd`, v1.1.149): `escHtml` es la única y `escapeHtml` la llama.

**Movidos el 28-sep-2026 (`_p`):**

- ✅ ~~**`[S10-TER-XSS-COMBOS]`**~~ (23-sep · 🟠, decidido por Alejo) — agujero abierto: por la regla del 23-sep va **sólo la keyword**; el detalle (archivo:línea y arreglo) vive en el inventario de `_correo_agentes` y entra acá cuando se cierre. Tanda propia con bump. Ver `docs/SECURITY.md` § S18. → **RESUELTO el 28-sep** (`268f6e8` + `8604f75` + `ac09e2e`, v1.1.148), cruzado contra el inventario del PREPARADOR. Ver SECURITY.md § S18.

- ✅ ~~**`[XSS-PANEL-STAFF]`**~~ (28-sep, salió del barrido de XSS · 🟠, prioridad propuesta por Claude Code) — agujero abierto: **sólo la keyword** (regla del 23-sep); el detalle vive en `_correo_agentes` y entra acá cuando se cierre. Ver `docs/SECURITY.md` § S25. → **RESUELTO el 28-sep** (`268f6e8`, v1.1.148). Ver SECURITY.md § S25.
- ✅ ~~**`[XSS-CATALOGO-STAFF]`**~~ (28-sep, salió del barrido de XSS · 🟠, prioridad propuesta por Claude Code) — agujero abierto: **sólo la keyword** (regla del 23-sep); el detalle vive en `_correo_agentes` y entra acá cuando se cierre. Ver `docs/SECURITY.md` § S24. → **RESUELTO el 28-sep** (`8604f75`, v1.1.148). Ver SECURITY.md § S24.
- ✅ ~~**`[XSS-NOMBRE-CLIENTE]`**~~ (28-sep, salió del barrido de XSS · 🟢, prioridad propuesta por Claude Code) — agujero abierto: **sólo la keyword** (regla del 23-sep); el detalle vive en `_correo_agentes` y entra acá cuando se cierre. Ver `docs/SECURITY.md` § S27. → **RESUELTO el 28-sep** (`8604f75`, v1.1.148). Ver SECURITY.md § S27.

**Movidos el 28-sep-2026 (`_o`):**

- ✅ ~~**`[ESPERA-NOMBRE-3-RENGLONES]`**~~ (28-sep, salió de la ronda l · 🟡, del DISEÑADOR) — con el 129b (los botones de la Espera con la letra de `.action-btn`, `.68rem`), a 360 el nombre tiene ~110 px en el Historial («Re-avisar» + «Quitar») y ~125 en Pendientes. Con la etiqueta «🏪 Local», un nombre de 20 letras pasa a 3 renglones en el Historial (en `main`, 2); sin etiqueta, recién con 34. Los nombres reales llegan hoy a 21 letras (mediana 7) y todas las filas son de la web. Fue el punto 2 de la ronda l, que no dio. **Con la decisión B de Alejo (28-sep) el 129b salió de `tanda-l` antes del merge**: en producción los botones de la Espera siguen en `.58rem` / `.65rem`, y el 129b vuelve junto con el arreglo de los nombres que decida el DISEÑADOR. → **RESUELTO el 28-sep** (129c, `b42fd09`): «🏪 Local» en la línea del teléfono y la hora en 24 h; a 360, ningún nombre de hasta 20 letras en 3 renglones. El 129b volvió en la misma tanda.
- ✅ ~~**`[MOTIVO-QUEDA]`**~~ (28-sep, salió de la ronda m · 🟢, del DISEÑADOR) — el motivo de «No se guardó» (`.barra-error`) se va sólo al tocar Guardar de nuevo (así lo pidió el prompt): si Editar falla y después se abre otro perfume, o se cancela y se abre otro, el motivo del anterior sigue en la barra, mientras el mensaje de abajo (`#editMsg`) sí se borra. Si se decide limpiarlo, es un renglón en `loadEditPerfume` / `cancelEdit` / `clearNuevoForm` / `editNuevo`. No se tocó. → **RESUELTO el 28-sep** (`b42fd09`): el motivo se va en `loadEditPerfume`, `cancelEdit`, `clearNuevoForm` y `editNuevo`.
- ✅ ~~**`[RECARGAR-360]`**~~ (28-sep, salió de la ronda m · 🟢, del DISEÑADOR) — a 360, «↺ Recargar» de la barra de la escalera (Decants) va en 2 renglones (el botón mide 93,9 px, 1 : 2,2 con «Guardar») y la barra queda en 77,4 en vez de 73 (botones de 52,4). Ya pasaba igual en `main`; a 390 la barra ya da 73. En mayúsculas (128a) no entra ni a 360 ni a 390, así que no se aplicó. Alejo mergeó igual (28-sep). → **CERRADO el 28-sep sin código** (decisión 128e del DISEÑADOR: se deja; a 360 se lee bien como botón con ícono).
- ✅ ~~**`[CLICKS-SLUG-CHECK]`**~~ (28-sep, salió de `[XSS-ESTADISTICAS]` · 🟢, propuesta de Claude Code) — segunda defensa en la base: un `CHECK` en `perfume_clicks.slug` (por ejemplo `slug ~ '^[a-z0-9-]{1,120}$'`). `anon` inserta en esa tabla sin validar el texto (`pc_insert_public`, `with_check true`). Medido el 28-sep: las 241.141 filas cumplen ese formato (29 caracteres como mucho), así que no rompe nada. Es SQL: lo deciden Alejo y el PREPARADOR. → **RESUELTO el 28-sep** (SQL del PREPARADOR, corrido por Alejo): `perfume_clicks_slug_formato`, verificado en la base.

**Movidos el 28-sep-2026 (`_m`):**

- ✅ ~~**`[XSS-ESTADISTICAS]`**~~ (28-sep, salió de la ronda m · 🟠, prioridad propuesta por Claude Code) — agujero abierto: **sólo la keyword** (regla del 23-sep); el detalle vive en `_correo_agentes` y entra acá cuando se cierre. Ya estaba en `main`: no lo trajo la ronda. Ver `docs/SECURITY.md` § S22. → **RESUELTO el 28-sep** (`776834b`, v1.1.145): `escHtml` en los nombres de «Estadísticas» (y en el slug de `perfume_clicks`, que escribe `anon`). Ver SECURITY.md § S22.

**Movidos el 28-sep-2026 (`_l`):**

- ✅ ~~**`[EDITAR-EMPLEADA-MUERTO]`**~~ (27-sep, salió de `[GUARDAR-ABAJO]` · 🟡, prioridad propuesta por Claude Code) — **la empleada no puede abrir Editar**: su botón (`data-only-empleado`) llama a `switchTab('editar')`, pero `canAccessTab` busca el **primer** `.tab-btn[data-tab="editar"]`, que es el del jefe (`data-role="jefe"`, escondido con CSS), y devuelve `false`. Pasa igual en `main` (medido con fixture: `canAccessTab('editar')` → `false`, la pestaña no se abre). **En la rama `tanda-l`** (decisión A de Alejo, 28-sep): se sacó el botón «Editar» de la empleada y su regla de CSS; `guia.html` ya no le dice que cambia precios. → **RESUELTO el 28-sep** (ronda l, `e18487a`, en producción con v1.1.144).
- ✅ ~~**`[DC-HEADER-600]`**~~ — el mini-header de columnas del grid de decants de diseñador (`admin.html` ~L2687) asoma −43 px a 600 y no sigue el stack de `.dc-row`. **En la rama `tanda-l`** (`[DC-HEADER-CORTADO]`): el encabezado se ve sólo ≥ 1100; debajo, cada fila tiene sus etiquetas. → **RESUELTO el 28-sep** (ronda l, `e18487a`).
- ✅ ~~**`[DC-ELIMINAR-CORTADO]`**~~ (28-sep, salió de la ronda l · 🟢, de antes: en `main` igual) — en cada fila de «Decants de diseñador», a 390 el botón «Eliminar este perfume» mide 266 px, se sale 77,9 px de la caja y `main` lo recorta (9 de 9 filas del fixture). A 1280 se sale 19,9 px de la caja pero entra en `main`. Es del DISEÑADOR. No se tocó. → **RESUELTO el 28-sep** (ronda m, `e5f9048`): `width: auto; min-width: 48px` y 44 de alto; 0 px afuera a 360, 390, 600 y 1280.
- ✅ ~~**`[GUARDAR-DOBLE-TOQUE]`**~~ (27-sep, salió de `[GUARDAR-ABAJO]` · 🟢, prioridad propuesta) — ningún «Guardar» del panel (Editar, Nuevo, la escalera, la promo, las marcas) se deshabilita ni dice «Guardando…» mientras guarda: sólo Editar escribe «Guardando...» en su línea de mensaje. Con la barra siempre a mano, un doble toque guarda dos veces. **En la rama `tanda-l`:** el botón principal de cada barra va deshabilitado y con «Guardando…» hasta que termina (`conGuardando`), y vuelve a su texto en éxito, error y validación. → **RESUELTO el 28-sep** (ronda l, `e18487a`): 1 escritura por doble toque en las 5 barras.
- ✅ ~~**`[GUARDAR-AVISO-LEJOS]`**~~ (27-sep, salió de `[GUARDAR-ABAJO]` · 🟢, del DISEÑADOR) — la confirmación de guardar («✓ … actualizado», `#editMsg`, `#nuevoMsg`, `#decMsg`, `#promoMsg`, `#marcasMsg`) sigue al final de cada caja: si se guarda desde la mitad del formulario con la barra (a 390, Editar mide 3.335 px), no se ve. No se tocó. → **RESUELTO el 28-sep** (ronda m, 128b, `e5f9048`): el botón dice «✓ Guardado» o «No se guardó» 2 s y el motivo queda en la barra hasta el próximo toque.

**Movidos el 27-sep-2026 (`_d`):**

- ✅ ~~**`[LOG-LABEL-26H]`**~~ (27-sep, salió de `[BACKUP-FALLBACK-ROTO]` · 🟢 propuesta) — la etiqueta 🛟 del Log para `backup_create_fallback` dice «el automático no corrió en 3 h» (`admin.html`, `[LOG-LABEL-FALLBACK]`, decisión 70), pero desde el 27-sep el panel lo crea recién a las 26 h: el texto quedó falso. No se tocó (texto del DISEÑADOR; el prompt pedía pausar si aparecía otra cosa): lo deciden el PREPARADOR y el DISEÑADOR («26 h», o sin número). → **RESUELTO el 27-sep** (decisión 125, `fd7b4cd`): «el automático no corrió», sin número.

**Movidos el 27-sep-2026 (`_b`):**

- ✅ ~~**`[BACKUP-FALLBACK-ROTO]`**~~ (27-sep, salió de `[VERCEL-ENV-VARS]` · 🟡 propuesta) — el respaldo del panel (`maybeAutoBackup`, `admin.html`) inserta `trigger: 'fallback'`, que `admin_backups_trigger_check` rechaza (sólo `manual` | `auto`): falla en silencio (`console.warn`). Además su umbral es de 3 h, pensado para un cron «cada 2 horas»; el cron real es diario (plan Hobby), así que arreglar sólo el valor haría un backup cada vez que alguien abre el panel más de 3 h después del último (y el cleanup deja 12). Decidir: `'auto'` con umbral de ~26 h, ampliar el CHECK, o sacarlo. Lo deciden Alejo y el PREPARADOR. → **RESUELTO el 27-sep** (`3c0c6c9`, camino A de Alejo): `'auto'` y umbral de 26 h.

**Movidos el 27-sep-2026 (`_a`):**

- ✅ ~~**`[SECURITY-AUDIT-S1]`**~~ (re-scoped 27-jun · 23-sep · 🟠) — agujero abierto: **sólo la keyword** (regla del 23-sep). Lo cerrado: las dos contraseñas del panel se rotaron el 19-sep (Alejo, 21:11 ART; verificado por los logs de auth), la constante muerta se borró (`4b88e20`) y `.claude/commands/security-scan.md` quedó sin valores (`db37b21`). Se cierra junto con `[VERCEL-ENV-VARS]`. Ver `docs/SECURITY.md` § S1. → **RESUELTO el 27-sep** (`49200b7`): el secreto del push salió de `admin.html`; `/api/send-notification` valida la sesión de Supabase contra `STAFF_EMAILS`. Ver SECURITY.md § S1.

**Movidos el 24-sep-2026 (`_y`):**

- ✅ ~~**`[PROMO-ANCHO-360]`**~~ (24-sep, salió de N · 🟡) — la etiqueta de la promo con «termina en…» (las últimas 24 h) pisa el corazón a 360: 0,8 px con «5h 13min» y −4,8 con «23h 59min» (a 390 entra: 25,3 px; «hasta el …», 26 px a 360). Espera al DISEÑADOR (y si va en mayúsculas). **La promo no se prende hasta cerrar esto**: hoy `promos_decants` tiene 0 filas y en el sitio no aparece. Va en la N-bis, con el «un pack de 1 decants» del WhatsApp. → **RESUELTO el 24-sep** (N-bis, decisión 117): sin reloj, «termina mañana» / «termina hoy»; 16,3 px o más del corazón a 360 con todas las variantes. La promo ya se puede prender.

**Movidos el 24-sep-2026 (`_w` + `_x`):**

- ✅ ~~**`[SIRENITA]`**~~ (decidido por Alejo el 23-sep · 🟡) — **fusionado con las promos de decants**: una pantalla del panel para prender y apagar promos con precio y fechas (Hot Sale, Black Friday) sin tocar código. Espera el costo por decant de los jefes. Meta: Black Friday. → **RESUELTO el 24-sep** (parte N, `[PROMO-DECANTS]`): la pantalla del panel para prender y apagar la promo de decants con precio cerrado y fechas. El Hot Sale / Black Friday de perfumes sigue siendo otra cosa (`descuento_pct` no se tocó).
- ✅ ~~**`[DECANT-TOPE-CONTADOR]`**~~ — el contador de perfumes "a consultar" del armador infla (7 mostrados, 6 reales): restar los que tienen decant custom. Además (24-sep, medido en M): el número de la pestaña «Catálogo» del armador (`updateDecantHeader`, `extras.js` ~L146) cuenta los no ocultos ni pausados más los de diseñador y no mira `decantExcluido` ni los duplicados: dice **193** con **184** tarjetas (177 perfumes + 7 de diseñador). → **RESUELTO el 24-sep** (parte N, N2): el número de la pestaña «Catálogo» usa el filtro de la lista (184).

**Movidos el 24-sep-2026 (`_u` + `_v`):**

- ✅ ~~**`[FINAL-COMPARANDO]`**~~ (24-sep, salió de L · 🟢 propuesta) — con «comparar» prendido, WhatsApp sube 49 y al final de la página vuelve a tapar el ©: 16,7 px a 390, 17,5 a 360 (la reserva de 140 cuenta sin comparar). Y debajo del pie quedan ~80 px del fondo de la página (en claro, una franja crema bajo el pie oscuro). Del DISEÑADOR. → **RESUELTO el 24-sep** (parte M, decisión 101): la reserva va en el pie (+49 con comparar); el © queda 31,5 px o más arriba de WhatsApp y abajo del pie no queda otro color.
- ✅ ~~**`[QUITAR-ETIQUETA-CONTRASTE]`**~~ (24-sep, salió de K · 🟢 propuesta) — «✕ QUITAR» de la etiqueta (`.btn-etq-quitar`, `admin.html`): `#e74c3c` sobre `#333` = **3,31** en los dos temas. No estaba en la K. Del DISEÑADOR. → **RESUELTO el 24-sep** (parte M, decisión 100): `#ff8a80` sobre `#333`, 5,53.

**Movidos el 24-sep-2026 (`_s` + `_t`):**

- ✅ ~~**`[RELOAD-NUNCA]`**~~ (24-sep, salió de K · 🟡 propuesta) — `BUSY_MODAL_SELECTORS` (`app.js`, `[PWA-AUTO-RELOAD]`) incluye `.compare-modal`, que es un elemento fijo de `index.html` (adentro de `#compareOverlay`, desde el 26-mar): con nada abierto, la lista ya da "ocupado", `safeReload` se reprograma cada 5 s y **la recarga automática del sitio público no se dispara nunca** desde v1.1.32 (15-may). Medido en `main` y en la rama de K con la lista leída del archivo. El arreglo es sacar esa línea (`.compare-overlay.active`, ya en la lista, cubre el comparador abierto). **Decide Alejo:** prenderla cambia el comportamiento del sitio (después de cada deploy, el que esté quieto recarga solo). → **CERRADO el 24-sep sin código** (decisión B de Alejo, después de descartar A y C): con CSS/JS/fuentes en network-first desde `3cee019` (12-may), cada carga con red ya trae la versión nueva, y la versión nueva se detecta justo en esa carga: recargar no mostraría nada nuevo. Con la C (recargar al pasar al fondo) la recarga caía justo en «Consultar» → WhatsApp, para volver a cargar lo mismo. Lo único que no se actualiza solo es una pestaña (o la app instalada) que quedó abierta durante un deploy, hasta que se recarga: cubrir eso sería una función nueva (preguntar por la versión al volver a la pestaña), no este arreglo. La corrección de paso: los docs decían que CSS/JS eran stale-while-revalidate (`899f43f`).

- ✅ ~~**`[BOTONES-CONTRASTE]`**~~ (24-sep, salió de la parte I · 🟢 propuesta) — dos modificadores de `.action-btn` que no pasan: `.btn-gris` en claro (`#1a1a1a` sobre `#555`: **2,33**; es «✖ Descartar» de Pedidos pass, entre otros) y `.btn-whatsapp` en oscuro (blanco sobre `#25D366`: **1,98**). Así estaban desde antes de D (D sólo los pasó de inline a clase). Del DISEÑADOR. → **RESUELTO el 24-sep** (parte K, decisión 94): WhatsApp `#1a1a1a` (8,78) y gris `#fff` (7,46) en los dos temas.
- ✅ ~~**`[RELOAD-CON-LOGIN]`**~~ (24-sep, salió de J · 🟢 propuesta) — `BUSY_MODAL_SELECTORS` (`app.js`, `[PWA-AUTO-RELOAD]`) busca `.auth-overlay.active`, pero el login se abre con `.open`: con el login abierto y sin un campo con foco, la recarga automática no lo cuenta como ocupado y puede recargar. Ya pasaba antes de J. No se tocó. → **RESUELTO el 24-sep** (parte K): `.auth-overlay.open` + juegos + «Avisame». Corrección a este texto: no "puede recargar": la recarga automática no se dispara nunca porque `.compare-modal` siempre coincide → `[RELOAD-NUNCA]`.

**Movidos el 24-sep-2026 (tarde, `_q`):**

- ✅ ~~**`[AMARILLO-CATALOGO-CLARO]`**~~ (24-sep, salió de la tabla C de D · 🟡 propuesta) — en el catálogo en claro quedan **26 textos (45 apariciones) en `#E8B800`** (`--amarillo`, no `#8a6d00`: no eran de los 35 de D) sobre fondos claros, entre **1,24 y 1,97**: la `em` del hero («identidad.»), la de «Comodoro.» y la de nosotros, los ◆ y el precio de los sets, los «Ver perfumes … →» del hub, los links y los ● de nosotros, el precio del carrito y «OCASIÓN». Medido en el DOM a 390. Del DISEÑADOR: ¿van a la tinta o se quedan? → **RESUELTO el 24-sep** (decisión 79, parte I, SW v1.1.126, `2824efb`): las 11 reglas a `--amarillo-tinta`; en claro, 0 textos `#E8B800` sobre fondo claro (mínimo 4,80, «identidad.» sobre el degradé del hero). Oscuro igual.
- ✅ ~~**`[PEDIDOS-PASS-CLARO]`**~~ (24-sep, salió de G · 🟡 propuesta) — en claro, cada pedido de «Pedidos pass» es una caja `#1a1a1a` (inline, desde JS) con la letra heredada `#1a1a1a`: **1,0**, no se lee. No estaba en la lista de 54; mismo arreglo que las cajas de G. → **RESUELTO el 24-sep** (decisión 82, parte I): `.caja-pedido` (claro 1,0 → 17,4), `.no-registrado` (claro `#9a3412`: 7,31), `.aviso-verificar` (era `#f1c40f`: 1,69 → 7,18) y «Pedido: …» en `--gris` (3,54 → 5,33). Oscuro igual.
- ✅ ~~**`[HOTSALE-DETALLE-CLARO]`**~~ (24-sep, salió de E · 🟡 propuesta) — en el detalle, en claro, el Hot Sale `#c2410c` va sobre el crema del detalle (`#f5efde`), no sobre blanco: **4,17** al principio de la franja al 6 %, 4,51 sin franja (la réplica medía la card: 4,76). `contraste.js` lo lista como ⚠️ conocida. Del DISEÑADOR. → **RESUELTO el 24-sep** como `[HOTSALE-CLARO]` (decisión 80, parte I): un solo naranja `#9a3412` en claro (texto, borde y franja): card 6,64 · detalle 5,81. Salió de las conocidas de `contraste.js`.
- ✅ ~~**`[SALTO-CARD-CENTRO]`**~~ (24-sep, salió de H · 🟢 propuesta) — `scrollToPerfume` centra la card (`block: 'center'`); desde E la card del celu (614-660 px) más su margen de 243 no entra en 844, y al saltar a la card 100 queda **5-6 px debajo de la barra**. Ya pasa en `main` desde E. Candidato: `'start'` en el celu. Decide el PREPARADOR con el DISEÑADOR. → **RESUELTO el 24-sep** (decisión 83, parte I): `'start'` en el celu, `'center'` en escritorio, y un re-apuntado sin animación cuando el scroll se queda quieto (el destino se corría 12-13 px). Card 100 a 390: 5,7 debajo de la barra.
- ✅ ~~**`[CERRADO-HERO]`**~~ (24-sep, salió de F · 🟢 propuesta) — la píldora «Cerrado» del hero (`.store-status.closed`, `#e74c3c`) da **3,82** en claro (sobre el `#fff !important` de mayo) y **4,47** en oscuro. F cambió la flotante (`.wa-status--closed`). Del DISEÑADOR. → **RESUELTO el 24-sep** (decisión 81, parte I): letra y punto claro `#b8342a` (5,89) y oscuro `#ff6b6b` (6,15); el fondo no cambia.
- ✅ ~~**`[ANILLO-1PX]`**~~ (decisión 84, salió de la parte H) — el anillo de 1,5 px Chromium lo dibuja de 1. → **RESUELTO el 24-sep** (parte I): se escribe `1px`.
- ✅ ~~**`[EFECTIVO-UN-RENGLON]`**~~ (decisión 85, salió de E) — a 16,3 px el efectivo se partía en dos renglones a 390. → **RESUELTO el 24-sep** (parte I): sin «descuento», un renglón a 390 y 360.
- ✅ ~~**`[HORARIO-DOS-FUENTES]`**~~ (del PREPARADOR) — la píldora flotante calculaba el horario aparte (lunes a sábado 10 a 20 escrito a mano, sin feriados ni ajuste). → **RESUELTO el 24-sep** (parte I): una sola cuenta, `calcularEstadoHorario`; NO ROMPER #14.

**Movidos el 24-sep-2026 (`_n` + `_o`):**

- ✅ ~~**`[INVENTARIO-ARCHIVOS]`**~~ (decisión 75 · 🟢) — inventario de sólo lectura hecho el 24-sep, fuera del repo (`_correo_agentes\ST_Perfumeria\inventario\archivos-sueltos-2026-09-24.md`). Queda abierto hasta que Alejo decida qué se borra y qué deja de servirse. → **RESUELTO el 24-sep** con la decisión de Alejo (`3d92262`): 3 archivos borrados, `mockups.html` fuera del dominio, la guía y las fotos se quedan (→ `[GUIA-DESACTUALIZADA]`).
- ✅ ~~**`[AMARILLO-TINTA-CLARO]`**~~ (22-sep, salió de `[LOG-EMPLEADA]`) — **41 usos de `color: var(--amarillo)`** en `admin.html`; varios son encabezados (`.admin-table th` y compañía) que en tema claro dan **1,86 sobre blanco**, el mismo caso que tenía `.log-dia` antes de pasarlo a `var(--stat-tinta)`. Medirlos **todos** con `npm run contraste` y decidir con el DISEÑADOR cuáles pasan a `--stat-tinta` (`#8a6d00` en claro) — pedido del PREPARADOR como keyword propia, no dentro de otra tanda. → **RESUELTO el 24-sep** (tanda D, SW v1.1.121, `569b73f`): token `--amarillo-tinta` (oscuro `#E8B800`, claro `#6b5500`, decisión 66) en las dos apps; los 85 textos del panel más `.stat-value`, `.log-dia`, `.client-count`, `.sidebar-hamburger` y el badge «Jefe» (5,90-7,18 en claro); los `#8a6d00` del catálogo (31 textos, 4,97-7,18). Oscuro idéntico.
- ✅ ~~**`[CLARO-CATALOGO-2]`**~~ (23-sep, nueva del DISEÑADOR · 🟡) — en tema claro, la píldora «Cerrado» (`.wa-status--closed`, `#c0392b` sobre su fondo al 12 %) da **3,23** sobre la página (`#e3d6b3`) y 4,55 sobre las cards, que en claro son blancas; `.cat-count` (`#8a6d00` sobre `#ede2c2`) da **3,81**. El DISEÑADOR los quiere cambiar. Medido en el DOM a 390 px. → **RESUELTO el 24-sep** (tanda F, SW v1.1.123, `0b250ff`): «Cerrado» flotante con fondo `#b8342a` opaco y letra blanca .7rem (5,89) · `.cat-count` `#2a2622` (11,62; se fue la regla duplicada) · «Ver catálogo» dorado en el celu, sin pulso (1,12 → 12,38). La píldora del hero quedó igual → `[CERRADO-HERO]`.
- ✅ ~~**`[ACTION-BTN-BASE]`**~~ (decisión 40 · 🟡) — la base de `.action-btn` (54 botones; 18 con estilo inline): hoy caen al botón por defecto del navegador (ej.: la pestaña Historial inactiva, `rgb(240,240,240)`). Volvió al DISEÑADOR; capturas de las 7 pestañas en `_correo_agentes\…\capturas-espera\panel-v1.1.114-*`. → **RESUELTO el 24-sep** (tanda D, SW v1.1.121): `.action-btn` sin modificador = la base de `.log-chip` con radio `--r-md`; 18 estilos inline a clases modificadoras; los filtros del Doctor son `.log-chip`. Los 10 sin estilo: 44 px, 17,36 / 17,4 de contraste.
- ✅ ~~**`[FILTROS-STICKY-PIE]`**~~ (23-sep, salió de `[VER-MAS]` · 🟡 propuesta) — en el celu la barra de filtros (`#catalogo`, 178,8 px) es sticky **hasta el pie**, no sólo en el catálogo: debajo del catálogo quedan 236,8 px (28 % de la pantalla) ocupados por nav + banner + filtros. Los saltos ya frenan debajo (243), pero lo que se ve bajando es eso. Decide el DISEÑADOR si se pega sólo dentro del catálogo; si sí, esas secciones vuelven a `scroll-margin-top: 105`. → **RESUELTO el 24-sep** como `[FILTROS-SOLO-CATALOGO]` (decisión 76, parte H, SW v1.1.125, `022f26a`): `.catalogo-scope` envuelve barra + anuncio + sección; a 390 lo pegado mide 236,8 en el catálogo y 97 en sets, nosotros, FAQ, mapa y pie; esas secciones vuelven a 105.
- ✅ ~~**`[CARD-ESCRITORIO-BANNER]`**~~ (23-sep, salió de `[VER-MAS]`) — a 1280, un salto a una card desde el buscador la deja en 76 px: **33 px debajo del banner** (lo pegado mide 109). Ya pasaba en `main`; el `scroll-margin-top: 76px` de escritorio viene del viejo `scroll-padding-top`. Un número, del DISEÑADOR. → **RESUELTO el 24-sep** (decisión 78, parte H, SW v1.1.125): card y grilla frenan en 115 a 1280 y en 243 en el celu; el buscador deja la card 6 y 5,8 px debajo de lo pegado (antes −33 y 2,8).
- ✅ ~~**`[JUEGOS-VENTANA-PULIDO]`**~~ (23-sep, salió de `[JUEGOS-VENTANA]`) — lo que se mudó a la ventana tal cual y quedó a la vista: en oscuro «deslizá para cerrar» da **3,21** (la misma manija del detalle, que también da 3,21); en claro «Encontrá tu perfume» da **4,28** sobre `#f5efde` (va con el dorado nuevo de la tanda de claro); el 🔒 del Desafío mide **35,2** de alto en oscuro (49 en claro) y las opciones del quiz **42,6**; los puntitos de progreso apagados casi no se ven en claro. Del DISEÑADOR. → **RESUELTO el 24-sep** (decisión 77, parte H, SW v1.1.125): «deslizá para cerrar» en `--gris` (oscuro 5,33) y la flecha con el texto (claro 1,15 → 6,29); puntos del quiz: anillo `--gris` (5,33 / 6,29) y el hecho en el dorado de cada tema (10,15 / 6,25); `.quiz-opt` y `.misel-lock` a 52; el candado en oscuro, caja punteada (9,26). El título del quiz lo arregló D (6,25).
- ✅ ~~**`[JERARQUIA-CARD]`**~~ (22-sep, salió de `[TEMA-CLARO]`) — `.card-brand-st` (el "ST" de cada card) en tema claro da **1,86** sobre la card blanca. No se arregla sola: el DISEÑADOR rediseña la jerarquía de la card entera con esta keyword. `scripts/contraste.js` la lista como ⚠️ conocida y **no falla** por ella. → **RESUELTO el 24-sep** (tanda E, SW v1.1.122, `ad16ea5`): sin «ST PERFUMERÍA» en la card ni en el detalle; en el celu nombre 28,8 · marca 14,4 · precio 26,9 · etiquetas 11,5 · cuotas 13,8 · efectivo y Hot Sale 16,3 (réplica v2 del DISEÑADOR); precio en oscuro `#E8B800`; botón de espera en la tinta y ✓ en el verde de efectivo; Hot Sale en claro `#c2410c` por especificidad. A 1280, tamaños iguales.

**Movidos el 23-sep-2026 (noche, `_l` + `_m`):**

- ✅ ~~**`[LOG-NOMBRE-CORTADO]`**~~ (23-sep, salió de `[LOG-PULIDO-2]`) — desde que `.log-cambio` se parte (decisión 44), un cambio muy largo le saca ancho al nombre del perfume: con un `Nombre` de 919 px, a 1005 el nombre queda en 60,6 de 83 px («YEAH P…») y a 800 en 43,5. Antes (v1.1.116) esas filas perdían el nombre entero. Lo decide el DISEÑADOR. → **RESUELTO el 23-sep** (v1.1.118: el nombre entero a 1005, 800 y 601).
- ✅ ~~**`[LOG-LABEL-FALLBACK]`**~~ (23-sep, salió de `[LOG-PULIDO-2]`) — `backup_create_fallback` no está en `AUDIT_ACTION_LABELS` (`admin.html`): en la chip ⚙️ Sistema sale «• backup create fallback». 0 eventos en 60 días. Ícono y texto, del DISEÑADOR. → **RESUELTO el 23-sep** (v1.1.118: 🛟 «Backup de respaldo · el automático no corrió en 3 h»).
- ✅ ~~**`[JUGAR-NO-LLEGA]`**~~ (23-sep, salió de la tanda C del DISEÑADOR · 🟡 propuesta) — en el celular, «Jugar» (`index.html` L634) y «🎮 Juegos ST» del menú (L521) **no llegan al quiz**: el scroll suave calcula el destino al arrancar y, a mitad de camino, el scroll infinito carga 15 cards y empuja `#quizSection` ~8.900 px; la pantalla queda en medio del catálogo, con el quiz 9.212 px más abajo, y cada toque repite lo mismo. Aun con todas las cards cargadas, el quiz queda a 345 px del techo (`scroll-padding-top: 240px` de mobile + `scroll-margin-top: 105px`). Medido a 390 en los dos temas; detalle en `_correo_agentes\…\capturas-espera\jugar-390-v1.1.117.md`. No se tocó: va con lo que dibuje el DISEÑADOR. → **RESUELTO el 23-sep** (lo cierran B (sin scroll infinito, v1.1.119) y C (la ventana, v1.1.120)).

**Movidos el 23-sep-2026 (noche, `_j`):**

- ✅ ~~**`[LOG-PULIDO-2]`**~~ (23-sep, reúne `[LOG-CAMBIO-LARGO]` y `[LOG-CHIP-PRECIOS]`) — decisiones del DISEÑADOR **36b** (la chip 💰 Precios filtra por las claves `Precio`/`Promo`/`price`/`promo`: hoy filtra `price_update`, con 0 eventos en 60 días, y los 43 cambios de precio reales caen en Catálogo; un evento puede estar en dos chips), **43** (👑 abre la segunda fila por regla: a 600 px con Inter caen ⚙️ Sistema y 👑, a Sistema le faltan 4,7 px) y **44** (las rutas no se muestran: la fila de un `perfume_edit` de Foto mide 1.254 px en un feed de 523 y `main.admin-main` la recorta sin elipsis). Prompt aparte del PREPARADOR. → **RESUELTO el 23-sep** (v1.1.117: `logFamilias` devuelve un array — Precios 43 de 2716 eventos reales, antes 0 —; el jefe en dos filas a cualquier ancho; la fila de foto a 600 baja de 96,8 a 52,8 px).

**Movidos el 23-sep-2026 (noche, cierre):**

- ✅ ~~**`[S8-STORAGE-ANON]`**~~ (23-sep, salió del repaso · 🟠) — agujero abierto (el bucket de fotos): **sólo la keyword**. Backup local hecho el 23-sep: `D:\backups\perfume-fotos-2026-09-23\`, 165/165 objetos, 8.689.933 bytes, sha256 en `manifest.json`. El SQL lo arma el PREPARADOR. Ver `docs/SECURITY.md` § S8. → **RESUELTO el 23-sep** (SQL de Alejo; verificado: 3 políticas por email, `anon` lista `[]`, fotos por URL pública en 200, subida desde el panel OK).
- ✅ ~~**`[SETS-CENTRADO-CORTADO]`**~~ (23-sep, salió de las capturas del DISEÑADOR · 🟡) — a 390 px `#setsGrid` es flex con `justify-content: center` y `overflow-x: auto`: las 4 cards de 300 px no entran en 358 y el centrado las empuja a la izquierda — **la primera queda en −429 px y nadie la puede ver**, la segunda sale cortada. Arreglo probable: `justify-content: safe center` (o `flex-start` en mobile); lo decide el DISEÑADOR. → **RESUELTO el 23-sep** (`30780c7`, v1.1.115: `flex-start`; a 390 la primera card en 0 y la última alcanzable; a 1280 idéntico).

**Movidos el 23-sep-2026 (noche):**

- ✅ ~~**`[CLIENTES-PRUEBA]`**~~ — borrar `549000000000[12]` (Test QA, de la verificación de S2) desde "Eliminar definitivamente" del panel; de paso prueba `clientes_delete_auth`. Lo hace Alejo. → **HECHO** (lo hizo Alejo el 20-sep 04:34 ART desde el panel; verificado el 23-sep: 0 filas, 2 DELETE autenticados en `edge_logs`).
- ✅ ~~**`[JUEGOS-ST-WIREFRAME]`**~~ — Quiz + Desafío side by side. → **TACHADO por Alejo el 23-sep** (lado a lado en desktop desde el 5-may).
- ✅ ~~**`[BACKUP-FOTOS-LOCAL]`**~~ (12-ago) — bajar el bucket `perfume-fotos` a `D:\backups\`. Los backups diarios de Supabase **NO incluyen Storage** (lo avisa el propio panel); hoy la única segunda copia son los archivos del proyecto viejo de Oregon. Lo hace Claude Code (script de descarga). → **HECHO el 23-sep** (`D:\backups\perfume-fotos-2026-09-23\`, 165/165, sha256).
- ✅ ~~**`[ROTAR-DB-PASS]` / S5**~~ — las DB passwords de ambos proyectos pasaron por chat en la migración de mayo; reset desde Settings → Database. Lo hace Alejo (~30 s cada una). Ver `docs/SECURITY.md` § S5. → **HECHO el 23-sep para São Paulo** (Oregon, pausado, va con la decisión de borrarlo).

**Movidos el 23-sep-2026 (tarde):**

- ✅ ~~**`[SECURITY-SCAN-CMD-VALORES]`**~~ — `.claude/commands/security-scan.md` conserva las dos contraseñas de S1 como ejemplo (único doc que las tiene). Decide Alejo. → **RESUELTO el 23-sep** (`db37b21`): los dos valores literales pasaron a `<valor>`; las contraseñas ya estaban rotadas desde el 19-sep.
- ↪️ **`[LOG-CAMBIO-LARGO]`** y **`[LOG-CHIP-PRECIOS]`** (23-sep, mediodía) → no se resolvieron: pasan a **`[LOG-PULIDO-2]`** con las decisiones 44 y 36b del DISEÑADOR (texto completo en `CLAUDE.md`).

**Movidos el 20-sep-2026 (más tarde):**

- ✅ ~~**`[S10-BIS-XSS-ESPERA-OPINIONES]`**~~ (20-sep, salió de cerrar S10 → **RESUELTO el mismo día** · rama `fix-s10-bis-xss-espera-opiniones` → `main` fast-forward · `033ab70` + `ce52def` + `aae744e` · SW **v1.1.104**, verificado en producción con `curl`) — mismo stored XSS de S10 (Clientes), en las dos pestañas que quedaban: **Lista de espera** (`renderListaEspera`: `group.name`, `item.telefono` e `item.nombre` ahora por `escapeHtml()`; el `href` de WhatsApp usa el teléfono limpiado a solo dígitos, no `escapeHtml()`, mismo patrón que `renderClientes`) y **Opiniones** (`loadOpiniones`: `o.nombre`, `o.perfume_slug` y `o.texto` — el `title`, que antes sólo reemplazaba `"`, ahora usa `escapeHtml()` por consistencia, aunque no era explotable como estaba). **Hallazgo más grave que los seis originales:** el botón "Avisar a todos" armaba `onclick="avisarTodos('` + `slug` + `')"` sin escapar, y `escapeHtml()` no escapa comillas simples — un `slug` (dato de `lista_espera`, alcanzable por `anon` desde el insert público de `js/app.js`) con un `'` rompía el string JS y ejecutaba código en la sesión admin; con `" onmouseover="..."` alcanzaba con pasar el mouse, sin click. Verificado con 7 payloads antes y después. Fix: `escapeHtml(JSON.stringify(slug))` (`JSON.stringify` pone sus propias comillas dobles, sin necesitar escapar `'`; `escapeHtml()` neutraliza esas comillas para el atributo HTML). `escapeHtml(` pasa de 20 a 28 ocurrencias (25 líneas). `item.id`/`o.id` en `onclick` se dejaron sin escapar a propósito (`bigint`/`uuid` de la DB, no texto libre — mismo criterio que el resto del panel). Ver `docs/SECURITY.md` § S10.
- ✅ ~~**`[WA-LINK-549-DUPLICADO]`**~~ (20-sep, hallado durante el análisis de arriba → **RESUELTO el mismo día**, commit aparte `ce52def`, no es un issue de seguridad) — `renderClientes` armaba el link de WhatsApp con `'https://wa.me/549' + tel`, pero `tel` ya viene con el `549` guardado en la columna (verificado contra las 97 filas de `clientes`): el link quedaba con 16 dígitos y no abría WhatsApp. Ahora son 13. `renderListaEspera` nunca tuvo el prefijo de más, no se tocó.

**Movidos el 19-sep-2026:**

- ✅ ~~**`[TELEGRAM-ANON-ABIERTO]` / S14**~~ (17-sep → **RESUELTO 19-sep** · `b0cde5e` + `5af3d85` · ver § "Sesión 19-sep-2026" y `SECURITY.md` § S14) — `anon` tiene **EXECUTE sobre `public.send_telegram(text)`** y la función acepta texto libre (`has_function_privilege('anon', …)` → true): con la anon key (pública, está en `app.js`) cualquiera hace `POST /rest/v1/rpc/send_telegram` y el bot lo entrega en el chat del jefe. **Rotar el token no cierra esto.** Fix: los avisos del sitio público salen desde las RPC de S2 en el servidor (`cliente_login` activado/bloqueado, `cliente_reset_solicitar`, `cliente_editar`, y `lista_espera` por trigger o RPC), `revoke execute … from anon` (explícito por rol, por los *default privileges*), `set search_path = public, extensions` (hoy `proconfig` null). ⚠️ El panel admin también la llama (`notifyTelegram`, 31 avisos, como `authenticated`): el revoke no puede incluir `authenticated` sin reemplazo. Brief escrito; patch del cowork; Claude Code verifica. Ver `docs/SECURITY.md` § S14.
- ✅ ~~**`[SW-PRECACHE-PERFUMES]`**~~ (18-sep → **RESUELTO 19-sep** · `5af3d85`, SW v1.1.102) — el precache de `sw.js` (L63) pide `'/js/perfumes.js'` → **404** (`perfumes.js` vive en la raíz). El SW **no se rompe** (`cache.add` uno por uno con `catch`, L74-76); desperdicia un 404 por instalación. 1 línea (`'/perfumes.js'`) + bump; viaja con la tanda de seguridad.

**Movidos el 18-sep-2026** (nota: `{ERROR-PRECIO-PERFUME-EN-SECTOR-DECANT}` seguía 🟡 en CLAUDE.md pero ya estaba cerrado por `[DECANT-TOPE]` — era el bug de plata):

- ✅ ~~**`[BCRYPT-MIGRATION]` / S2**~~ — **RESUELTO el 17-sep-2026** (`98b556c` + `sql/fase1.sql` y `sql/fase3.sql` corridos por Alejo). Login por RPC, bcrypt con migración perezosa, rate-limit server-side, `anon` sin ninguna policy sobre `clientes` (verificado: 0 filas por REST, antes 98). **D ✅** (migración perezosa verificada por Alejo en producción: los 92 en plano entran con su clave de siempre y quedan hasheados). Queda: borrar los 2 clientes de prueba desde el panel · `[LOGIN-INTENTOS-CLEANUP]` 🟢 · escalón 3 (Supabase Auth) · **S13** nuevo. Ver `docs/SECURITY.md` § S2 y S13.
- ✅ ~~**S11 · auth "fail-open" en `/api/send-notification`**~~ — ARREGLADO el 12-ago (`ef1507d`). Comparaba `adminPass !== ADMIN_PASS` sin chequear que la variable existiera → sin env var, una request que omitiera el campo pasaba. Ahora **falla cerrado**. Sin esto, reponer las variables olvidando `ADMIN_PASS` dejaba el endpoint abierto para que cualquiera mandara push a todos los suscriptores.
- ✅ ~~**Botón "Olvidé mi contraseña"**~~ — HECHO y **TESTEADO E2E en producción** 27-jun (`[FORGOT-PASS-A]` `db9d485` + `[FORGOT-PASS-WA]` `3e52dbd` + nombre del cliente `eefdfe9`). Cerrado.
- ✅ ~~**Bajar proyecto viejo Supabase Oregon**~~ — ver `[S4-OREGON]` (detalle fuera del repo). Antes hubo que corregir `[FOTOS-OREGON]` (97 URLs).
- ✅ ~~**`{CAMPOS-X}`**~~ (antes `[BUSCADOR-X-TOGGLES]`) — **HECHO el 5-sep-2026.** Alejo aclaró que no eran "toggles": quería la ✕ para limpiar **en todos los campos de texto** del panel, no sólo en los buscadores (ejemplo que dio: `puntoQuery`, el buscador de cliente para cargarle puntos). Había **54 campos** y sólo 7 la tenían. Ahora se aplican **por selector**, no por una lista de IDs a mano — así los campos que se agreguen en el futuro la traen solos. Para dejar uno afuera: `data-sin-x="1"`. Verificado: 54/54 con ✕, 43 medidos sin desbordes (el más angosto, votación, conserva 134px útiles).
- ✅ ~~**`[DEPOSITO-MISMO-+/-]`**~~ — **HECHO el 16-sep-2026** (`e18ac20`). El modal de Depósito tiene la misma fila `− / campo / +` que `modalStock` (`depQtyStep`), y cada toque en − muestra en vivo la casilla "No sumar al stock local" de `[DEP-SUMAR]`. De yapa **`[DEPOSITO-LOCAL-CLICK]`**: la badge de **Local** en la tabla de Depósito abre `openStockModal` (el mismo modal de Precios & Stock) y `saveStock` refresca `renderDeposito`. Y el buscador ya no se pierde al guardar (`filterTable` al final de `renderPrecios` / `renderDeposito`). Verificado a 600 px con clicks reales.
- ✅ ~~**`[DEPOSITO-A-LOCAL]`**~~ — **HECHO el 2-sep-2026** (patch de Alejo aplicado y verificado). Cuando el depósito baja de **≥2 directo a 0**, esas N unidades **se suman al stock local** en el **mismo upsert** (atómico: `stock_deposito` + `stock_qty` + `stock_status` en una sola escritura). La trampa que había que resolver — que no toda resta es un pase al local — se resuelve con una casilla **"No sumar al stock local"** que aparece sólo en ese caso; destildada mueve, tildada sólo vacía el depósito. Si es `1 → 0` o el valor nuevo no es 0, no pasa nada. Respeta `pausado`. Los 6 casos del checklist verificados con el cliente de Supabase stubbeado (sin escribir en producción). ⚠️ Queda un detalle menor: deja **dos** registros en el historial (`deposito_update` + `stock_update`), no uno solo que diga "movió N del depósito al local".
- 🟡 **`{ERROR-PRECIO-PERFUME-EN-SECTOR-DECANT}`** (anotado 2-sep-2026) — Alejo detectó un **error en el precio del perfume dentro del sector de decants**. ⚠️ **Sin diagnosticar todavía: falta que Alejo describa qué se ve mal exactamente** (¿muestra el precio del frasco entero en vez del precio del decant? ¿el precio por unidad no coincide con la escalera 1-2 / 3-4 / 5+? ¿un perfume puntual o todos?). Sin ese dato no se puede reproducir. Sospechas a chequear cuando se encare: `renderDecantGrid()` (`js/app.js` y `js/extras.js`, el precio "c/u" de cada card) y el cálculo de la escalera en el bloque del contador/progreso.

---

## 🚀 Cómo arrancar la próxima sesión (handoff para Claude que vuelve)

### ⭐ SESIÓN PRIORITARIA AGENDADA · `[SECURITY-AUDIT-S1]`

**Cuándo:** Alejo planea ejecutar en 1-2 días desde el 21-may. Antes de eso, hace acciones manuales urgentes (cambiar passwords admin via Dashboard + revocar bot Telegram + reset DB passwords) que mitigan los issues CRÍTICOS sin esperar Claude Code.

**📖 Brief para esta sesión:** `RECOMENDACIONES_CLAUDECHAT/Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md` · este es el archivo de instrucciones para ClaudeChat (igual que el Plan B v1) que va a generar el plan EXPANDIDO con comandos exactos para Claude Code (igual que el Plan B v2).

**📖 Inventario de issues:** `docs/SECURITY.md` · documento fuente de verdad con los 9 issues detectados durante la sesión 21-may (3 críticos · 4 altos · 2 medios). Cada issue tiene: severidad, archivo/línea exacta, cómo explotarlo, impacto, fix recomendado.

**Pattern Claude↔Claude (validado 2 veces previas):**
1. Alejo abre ClaudeChat con `docs/SECURITY.md` + `Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md` como contexto
2. ClaudeChat genera el plan EXPANDIDO con comandos exactos / verificaciones / rollback per cada issue
3. Alejo valida el plan
4. Alejo abre Claude Code y dice "ejecutemos SECURITY-AUDIT-S1"
5. Claude Code lee los .md + el plan expandido + ejecuta con disciplina

**Restricciones críticas para la sesión:**
- NO romper login admin (las chicas tienen que poder seguir entrando)
- NO romper catálogo público
- NO romper storage / realtime
- Cambios al admin SOLO en horario muerto (post 21 ARG / pre 10 ARG)
- Bumpear SW en cada cambio a archivos cacheados (regla sagrada)
- Maintain habits de los aprendizajes en `memory/preferencias_alejo.md` #41/46 · documentación exhaustiva en pasos delicados

---

### ⭐ SESIÓN PRIORITARIA HISTÓRICA · Plan B Supabase São Paulo (COMPLETADO 21-may)

**Cuándo:** Alejo planea ejecutar esta noche del 20-may-2026 (o cuando esté off del horario de perfumería · NO en horario operativo 10-21 ARG).

**📖 Playbook completo y EXHAUSTIVO:** `RECOMENDACIONES_CLAUDECHAT/Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md` (versión 2 · expandida por Claude Code el 20-may-2026 con TODOS los comandos exactos, verificaciones post-cada-paso, plan de rollback explícito, y notas de seguridad sobre service_role keys).

**Cómo arrancar la sesión cuando Alejo abra Claude Code:**

1. **PRIMERO** leer el playbook expandido completo. Es largo (intencionalmente) porque la migración toca auth + data + storage + functions productivos. Cada sección tiene comando exacto + cómo verificar que salió bien.
2. **NO arrancar** la migración hasta que Alejo confirme que tiene preparado lo del bloque "Pre-requisitos · ANTES de arrancar" del playbook (Supabase CLI verificado, pg_dump/psql disponibles, dos terminales abiertas, archivo temporal de credenciales).

**Estructura del playbook v2 (9 pasos · 60-90 min total):**

- **Paso 0 (CRÍTICO · nuevo en v2):** Dump completo pre-migración a `D:\backups\` + GitHub Release. Sin este paso, NO hay rollback si algo sale catastróficamente mal.
- **Paso 1:** Alejo crea proyecto nuevo en SP desde Dashboard (5 min)
- **Paso 2:** Migrar schema con `pg_dump --schema-only` filtrado + verificar RLS policies presentes
- **Paso 3:** Migrar data con `--data-only --disable-triggers --single-transaction` + verificación row counts por tabla
- **Paso 4 (ALTO RIESGO):** Migrar `auth.users` con `encrypted_password` hashes intactos + **test funcional de login** ANTES de continuar (si falla → NO seguir)
- **Paso 5:** Re-deploy Edge Functions con paso opcional de versionarlas en el repo PRIMERO (que hoy viven solo en dashboard)
- **Paso 6:** Script Node de migración del bucket `perfume-fotos` aplicando `cacheControl: '604800'` (sinergia con el commit `f4edd3d` de hoy)
- **Paso 7:** Cambiar env vars Vercel + redeploy + verificación (este es el "punto de no retorno perceptible")
- **Paso 8:** Verificación E2E manual desde tablet de Alejo (6 sub-checks)
- **Paso 9:** Mantener proyecto viejo activo 1 semana como safety net antes de pausar

**Rollback documentado** para 3 escenarios distintos (antes del paso 7, después del paso 7, catastrófico).

**Cleanup explícito** al final · borrar `D:\tmp\plan-b-credentials.txt` (CRÍTICO · contiene service_role keys).

**Contexto reciente:** Plan A `[LOGIN-RETRY-SP]` se desplegó hoy (commit `267e7e2`). Alejo decidió NO esperar 1-2 semanas de telemetría · prefiere atacar la causa raíz (latencia us-west-2 Oregon → 250ms · sa-east-1 São Paulo → 30-50ms). Plan A queda igual desplegado · sirve de fallback si el Plan B tiene algún hiccup.

**Sinergia con commits del 20-may:**
- `[CACHE-CONTROL-1W]` (commit `f4edd3d`): el paso 6 del playbook aplica este cacheControl a TODOS los archivos del bucket al migrarlos (no solo nuevos uploads). Resultado: bucket nuevo nace completamente con cache 1 semana.
- `[LOGIN-RETRY-SP]` (commit `267e7e2`): post-migración, los timeouts deberían reducirse drásticamente (~250ms → ~50ms latencia). El reintento queda como defensa de profundidad por si hay algún jitter de red.

---

### Si NO es la sesión del Plan B (sesión genérica)

Cuando Alejo abra un chat nuevo de Claude Code en este repo:

1. **Leer `CLAUDE.md`** (convenciones generales, estructura, NO ROMPER, stack)
2. **Leer este archivo `docs/HISTORIA.md`** (TODO el histórico)
3. **Si hay tarea específica:** preguntar qué quiere atacar
4. **Si no hay tarea:** ofrecer la lista de pendientes:
   - 🔥 **Cargar precios LE BEAU LE PARFUM + LE BEAU EDT** — 2 decants de diseñador con `precio_unit = NULL`. Bloqueados por `[DC-PRECIO-GUARD]` (no se pueden vender mal) pero pendientes de carga real desde admin tab Decants. ~3 min cada uno.
   - `[SIRENITA]` — sistema de Campañas multi-promo (tabla DB nueva)
   - `[JS-CHUNK]` iter 2 — mover quiz, juegos, custom cursor a `extras.js`
   - `[BCRYPT-MIGRATION]` — hashear passwords lazy migration
   - `[SUPABASE-AUTH]` — migrar de custom auth a Supabase Auth
   - `[ORDEN-COMPRA-TAB]` — tab admin con sugerencias de pedido

**Reglas de oro al arrancar:**
- Antes de cambios grandes / riesgosos: **explicarle a Alejo el riesgo** y dar opciones.
- Si toca el admin: **deploy fuera de 10-21 ARG** (horario operativo del local).
- Si toca el catálogo público: deploy con cuidado pero menos crítico.
- Siempre **bumpear SW** al tocar HTML/JS/CSS cacheado (regla sagrada).
- Mockups nuevos van a **`mockups.html`** (NO crear archivos nuevos sueltos).
- Castellano rioplatense, vos (no usted).
- Emojis con moderación en respuestas, NO en código salvo pedido.

---

## 🔑 Keywords para retomar en próxima conversación

Si volvés a hablar con Claude (esta misma o en otra compu), referite a estos features con sus keywords y Claude sabe a qué te referís:

- `[NAV-CART]` — carrito en navbar
- `[PENDULO]` — cart-float convertido en círculo gemelo del wa-float (justo arriba, gap 12px)
- `[GATO]` — `buildWaMessage(items, note)` unifica el mensaje de WhatsApp: carrito, "Consultar" en card individual y "Consultar" en sets generan el mismo formato (lista numerada + 💰 precio + 📦 N + 💳 cuotas + 💵 efectivo off). Casos especiales (stockNote, decants armador, banner decants) quedan con su lógica propia.
- `[FANTASMA]` — revert parcial de [IMG-DIMS] (v1.1.10). El bloque CSS sobreescribía width/height explícitos de search-sug-img (32x42 → 463x463), set-img-slot, collectible, recent-view, quiz, etc. Las cards del catálogo ya tienen width/height en HTML attrs (app.js:1666) → no necesitaban el CSS hack. Se mantiene el segundo bloque para cart/modales.
- `[HOTSALE]` — refactor de pricing. `p.price` = precio TARJETA (base para cuotas), `p.promo` = precio EFECTIVO/TRANSFER override (si existe, ES el cash final sin doble descuento; si no, default 10% off). Helpers `getListaPrice / getCashPrice / getCuotaPrice / hasHotSale / getDiscountPct`. Label "🔥 HOT SALE EFECTIVO" hardcoded en constante `HOT_SALE_LABEL`. % off calculado dinámico. Eliminado del front el render de `descuento_pct + descuento_hasta` (DB intacta para futuro). Aplicado a card del catálogo, cart panel, buildWaMessage y modal bsPrice. Sets NO modificados (tienen modelo distinto).
- `[WATCHDOG]` — máquina de estados para Realtime en `admin.html`. Estados `INIT/CONNECTING/LIVE/DEGRADED/RECONNECTING`. Si el WS se cae arranca polling diferencial cada 10s (`gt('updated_at')`) y reintenta con backoff 2s→60s. Listeners `visibilitychange`/`online`/`offline`/heartbeat. Indicador `#syncIndicator` en el header. Trigger SQL `perfume_overrides_updated_at` aplicado en prod. Anti-echo en `savePrice`/`saveStock` via `lastLocalUpsert`. Plan original en `PLAN_REALTIME_WATCHDOG.md`. Ver bug "Watchdog de Realtime (mayo 2026)" arriba.
- `[CATALOGO-POLISH]` — pack de 6 fixes visuales del catálogo aplicados en una sola tanda (madrugada 14-may-2026, fuera de horario operativo). **3B**: placeholder "Foto próximamente" pasa de SVG-botella + cinta diagonal amarilla a inicial display grande + nombre tenue + label sutil sobre fondo radial dorado. **4B**: CTA del banner "EXPLORÁ NUESTRO CATÁLOGO" pasa de pillita 80px a pill grande contrastada (texto "Ver catálogo →", border-radius pill, box-shadow). **4A**: marquee del banner Hot Sale suavizado de 22s→45s + pausa al hover (desktop). **5**: `.price-original` / `.note-prev` / `.reveal-pricing .price-label` cambian de `#999` hardcoded a `var(--gris-claro)` / `var(--gris)` — adaptables a dark+light, fix contraste WCAG en light mode. **1**: card del catálogo muestra el VALOR de cada cuota ("3 cuotas $49.667 sin interés") con chip dorado en lugar del label microscópico de antes. Hot Sale bloque destacado con border-left naranja + bg gradient. **2**: ❤ filter button con borde neutro (rojo solo cuando active) + chip de filtro activo con styling de continuidad visual al filter-bar. Aplicado a `renderCatalog`, `bsPrice` (modal detalle) y `.reveal-pricing` (mini-precio del reveal lateral con overrides para que el bloque hot-sale no rompa los tamaños chicos).
- `[PACK-CHIVATO]` — defensa en `sendDecantPackToWA` contra slugs inválidos (null/undefined/empty strings) que podían llegar desde localStorage corrupto y causar inconsistencia "header dice 6 decants / cuerpo muestra 4" en el WhatsApp al vendedor. Fix: `decantsPack.filter(s => s != null && typeof s === 'string' && s.trim())` antes de usar. Garantiza que `qty` sea SIEMPRE consistente entre header, lista y resumen. Bonus: emojis "los justos y necesarios" en el mensaje (👋 saludo, 🧪 título, 💰 precio en negrita, 🙏 cierre). El bug original del screenshot no se pudo reproducir con código actual (probé 7 casos edge), pero la defensa cubre cualquier corrupción futura del localStorage.
- `[BACKDROP]` — tuning del backdrop blur de `.card-gallery-slide` para cohesión visual del catálogo. Las cards con foto fondo blanco quemaban en dark mode, las de fondo negro chocaban en light. Cambios: `brightness .75→.6` (dark) y `.92→.85` (light) — apaga blancos sin matar colores; `saturate 1.3→1.5` (dark) y `1.2→1.3` (light) — preserva identidad cromática; `scale 1.15→1.2` — más cobertura del blur; vignette de `rgba(0,0,0,.35)→.55` en dark; nuevo overlay con linear-gradient dorado tenue + radial dorado en light. Cero cambios estructurales, solo valores en `.card-gallery-slide::before` y `::after`.
- `[ZAPATO]` — admin con sidebar lateral en lugar de tab-bar horizontal. 5 grupos colapsables (Top fijo, Productos, Gestión jefe-only, Marketing & Home, Sistema). Tabs originales mantienen clases `.tab-btn`/data-attributes → `switchTab()` intacto. Responsivo: ≥1100px sidebar 240px / 701-1100px sidebar 200px / ≤700px sidebar oculto con hamburguesa overlay. Persistencia en localStorage (`st_admin_sidebar_collapsed` + `st_admin_sidebar_groups`): cada tablet recuerda si dejó el sidebar plegado y qué grupos colapsados. Light mode aplicado al sidebar. `applyRolePermissions` actualizada para apuntar a `.sidebar .tab-btn`. Mockup HTML standalone original en `mockup-zapato.html`.
- `[JS-CHUNK]` iter 1 — primer split del bundle `app.js` (6609 → 6439 líneas). El armador de decants (renderDecantGrid + open/close + sendDecantPackToWA + popstate handler, ~170 líneas) vive en `js/extras.js` que se carga via `requestIdleCallback` post-TTI (fallback: setTimeout 2s post-load). Stubs en core: `openDecantBuilder()`, `closeDecantBuilder()`, `sendDecantPackToWA()`, `renderDecantGrid()` — disparan `loadExtras()` si el cliente toca antes del idle. **Pendiente iter 2**: mover quiz, juegos ST, custom cursor, compare modal, banner decants WA, share/sharePerfume — todo a `extras.js`. Eso podría sacar otros ~3000 líneas del bundle inicial.
- `[BANNER-V2]` — rediseño completo del banner Decants en `index.html` (post foto IA del usuario). Layout grid 3 columnas desktop (izquierda texto+CTA / centro frascos / derecha trust badges) sobre gradient violeta-magenta `#2a0a3a → #b71c5c`. **Centro**: 3 frascos atomizadores SVG transparentes (vidrio + líquido ámbar + brillo lateral) sobre podiums morados 3D escalonados (5ml chico → 10ml medio → 20ml grande), humo CSS animado (radial gradient + blur, 9s loop), flor 🪻 decorativa con drop-shadow, cintas amarillas diagonales "PRÓXIMAMENTE" en 10/20, 5ml destacado con drop-shadow dorado + label "5 ml ✓" + check verde. **Izquierda**: title "Decants" con gradient blanco→dorado, tagline "tu fragancia, tu medida" en Cormorant Garamond cursiva dorada, CTA pill blanca grande "💧 Armá tu pack →". **Derecha**: 3 trust badges con iconos SVG circulares dorados (estrella/valija/corazón). **Mobile Variante C**: stack vertical, 5ml protagonista grande centrado con 10/20 thumbnails .55 scale al costado, badges en fila compacta sin descripciones. Mockup que sirvió de referencia: `mockups.html` Opción 2 + Variante C (commit 7002cac).
- `[CARD-STRETCH-FIX]` — bug: card del catálogo se estiraba a 900px alto con 1 favorito filtrado. Causa: `[CLS-RESERVE]` reservaba min-height al grid; con 1 sola row visible, esa row heredaba la altura completa. El botón ❤ liked (bg rojo) se veía gigante porque la card está stretched. Fix en `.catalog-grid`: `align-content: start` + `grid-auto-rows: max-content` (inline en index.html + canónico en styles.css). Cards mantienen altura natural, el grid mantiene min-height del skeleton reserve.
- `[SORTMENU-Z]` — bug: dropdown "Ordenar" tapado por las cards después de toggle de filtro favoritos. Causa: cards reciben animation `filter-entering` con transform → crean stacking context propio. `.sort-menu` z-index 50 dentro de `.filter-bar` position:static (z-index ignorado). Cards posteriores en DOM ganaban. Fix: `.sort-wrapper` con `position:relative + z-index:100 + isolation:isolate` (stacking context aislado). Garantía: el menú siempre queda arriba.
- `[DECANTS-UX-2]` — iter 2 del armador (post DECANTS-UX iter 1). **Tab switcher Catálogo/Mis decants** (Variante A pills): 2 tabs con badge de count, mobile-first. Auto-switch a Catálogo si "Mis decants" queda vacío. **Combo sugerido sticky** "💡 Combinás bien con: X" (Variante B): pill flotante arriba del footer cuando hay ≥1 decant en el pack, mobile responsive. Algoritmo `findCombinaBienCon()`: scoring marca_real +3, perfil +2, notas comunes +1 c/u (máx +5), cat +1, umbral mínimo score >=2. Empty hero movido ADENTRO del grid scrollable (fix crítico mobile: header con tabs + empty + search + footer excedían 95vh en celulares chicos, el grid quedaba sin altura para scrollear).
- `[DISEÑADOR]` — rename "⭐ Especiales" → "💎 Decants de diseñador" coherente en toda la app. extras.js: título sección armador + mensaje WA al vendedor ("+ de diseñador") + fallback marca ("De diseñador" cuando vacía). admin.html: título de tab y copy explicativo ("Para decants de diseñador (Jean Paul Gaultier, Creed, Dior, etc.) que NO están cargados al stock regular pero querés ofrecerlos en el armador. Aparecen 💎 primero en el grid del armador"). Cambio puramente nomenclatura · sin tocar lógica de la tabla `decants_custom`.
- `[COMPARE-V2]` — modal Compare iter 2 (en sesión 15-may-2026). **2A "🔥 Diferencias destacadas"**: bloque debajo de "✨ Notas en común" con notas únicas por perfume — las que SOLO ese tiene contra el set de los otros. Paleta rosa/magenta (`#f48fb1`) para distinguir visualmente de "comunes" amarillas. Algoritmo en `renderUniqueNotes()`. **2B "💕 Elegir este"**: pill dorada full-width al final de cada `compare-col`. Click → `elegirCompare(slug)` → addToCart + closeCompareModal. Cierra el ciclo comparar→decidir→carrito→WA. Mobile responsive (375px): cards apiladas 1col, bloque diferencias 1col por perfume con grid `minmax(110px, 28%) 1fr`.
- `[SELECCION-PODIO]` — sección "Selección ST" rejugada. **1A podio**: las primeras 3 cards reciben `.rank-badge.rank-1/2/3` con linear-gradient metálico oro (#ffd700) / plata (#c0c0c0) / bronce (#cd7f32) + border de card matcheando. Posición absolute top-left 8px. Cards 4+ siguen sin badge. **1B quote del jefe**: `.collectible-quote` en italic Cormorant Garamond debajo del nombre · max 3 líneas con `-webkit-line-clamp`. `applyOverrideToPerfume` lee `p.nota_jefe` del override. Aparece SOLO si el quote está cargado en `perfume_overrides.nota_jefe` (columna SQL creada por el jefe el 15-may; UI admin pendiente).
- `[JUEGOS-3A]` — primer move (lógico via JS) de `#quizSection` antes de `#nosotros` para que no se vea "escondido" después del FAQ. Implementado via JS-move sync inline justo antes de `</body>`: cero FOUC visible. **Cerrado por `[JUEGOS-3A-FINAL]` en commit `b162b29`** (move físico HTML real + IIFE eliminado).
- `[JUEGOS-3C]` — CTA banner "Encontrá tu perfume" copy reescrito de pregunta abstracta a imperativo directo: "¿No sabés cuál perfume comprar? · 4 preguntas, 3 recomendaciones, gratis →" + "Jugar" (antes "¿3 opciones distintas con solo 4 preguntas? · Jugá gratis y elegí" + "Probar"). Mejor CTR esperado siguiendo UX best-practice (verbos activos > preguntas abstractas).
- `[PWA-AUTO-RELOAD]` — auto-reload mágico post-SW-update. Cuando se deploya versión nueva, el SW v1.1.32+ toma control inmediato (skipWaiting + clients.claim ya estaban) y ahora el frontend RECARGA SOLO la página para que el cliente vea la versión nueva sin tocar F5. **Mitigación anti-interrupción**: el reload SOLO ocurre si el cliente NO está interactuando (modal abierto, input/textarea/select focused, scroll últimos 3s, first visit sin SW previo). Se postergan los reloads con `setTimeout(safeReload, 5000)` hasta que esté "quieto". El tracker de scroll es `passive` sin impacto perf. Implementado en `app.js` reemplazando el listener `controllerchange` simple. Garantía: cliente nunca pierde scroll position, datos de formulario, modal en curso ni armado de pack. NOTA: cliente con SW previo a v1.1.32 sigue necesitando F5 una vez para tomar v1.1.32; de ahí en adelante todos los updates futuros son auto-reload.
- `[SIMILARES-CDA]` — modal "Ver similares" full premium (combo C+D+A según mockup aprobado el 15-may). **Ring** SVG circular de % match (`.sim-ring-fg-arc` con `stroke-dashoffset` animado .7s ease) con 3 score classes: high (≥85%, oro #ffd700), mid (70-85%, dorado), low (<70%, bronce #cd7f32). **Botón "⚖ Comparar"** (`.sim-btn-comparar`) que llama `compareSimilar(anchorSlug, similarSlug)` → agrega ambos a `compareList` + activa visualmente los `.compare-btn` de las cards + cierra modal de similares. **Razón humana** (`.sim-razon-humana`): chips de notas compartidas (max 6 visibles + "+N más" si excede) calculados con `getCommonNotesList(anchor, similar)`. **Badges premium** (`.sim-badges`) con regla "**condición fuerte + máx 2 badges por item**": 🏆 Mejor match (solo el #1 absoluto), 💎 Misma casa (marca_real coincide), 🎯 Mismo perfil (perfil coincide AND pct≥75 — la regla fuerte que evita saturar con badges débiles), 🔥 El más elegido (slug en `TOP_VENTAS_SLUGS[0..2]`). Prioridad de inserción al pick 2: best > elegido > casa > perfil. Mobile @ <540px: 3 cols + reflow del botón comparar a row 2 full-width. Light mode override completo. Helpers nuevos: `getCommonNotesList`, `getMatchPct`, `getSimilarityBadges`, `compareSimilar`. `buildSimilarItemHTML` reescrito completamente con firma `(p, opts)` donde opts incluye anchorPerfume + pct + isBest + subtitle + topElegidosSlugs. `showSimilares` calcula `bestSlug` (primer manual si hay, sino primer algorítmico) y pasa opts a cada item.
- `[DC-RESPONSIVE-FIX]` — fix urgente del 15-may: la grid de "decants de diseñador" en el admin (`renderDecantsCustomList`) era fija de 7 cols (60+1.3fr+1fr+110+70+80+110 = ~800px) y se cortaba en Galaxy Tab A9 vertical (800px) → el campo PRECIO quedaba afuera de la pantalla → las chicas no lo veían → cargaban precio NULL → el armador caía a la escalera regular ($9500). Fix: convertir la grid a responsive con 3 breakpoints (≥1100 desktop · 701-1099 tablet stack · ≤540 mobile stack). Labels arriba de cada input en tablet/mobile · label "💰 Precio" SIEMPRE visible en amarillo. Sin tocar JS.
- `[DC-PRECIO-GUARD]` — defensa preventiva del 15-may: si un decant custom NO tiene `precio_unit` válido (>0), en `customCardHTML` se muestra atenuado (opacity .68 + filter saturate .6) con texto "⏳ Precio pendiente" naranja en lugar del precio · botón "+" deshabilitado con tooltip "El admin todavía está cargando el precio" · cliente NO PUEDE agregarlo al pack. Apenas el admin carga el precio, la card vuelve al estado normal (next reload con `[PWA-AUTO-RELOAD]`). Garantía cero venta a $9500 escalera por decant de diseñador con precio NULL.
- `[DC-PRECIO-PROMINENT]` — prioridad visual del campo PRECIO + botón GUARDAR en la fila de decants custom. Caja amarilla destacada con border 1.5px dorado + box-shadow + bg amarillo soft. Input precio con font 1rem desktop (1.2rem mobile), peso 800, color dorado, bg negro contrastante. Warning animado (border rojo + pulse 2s) si el input está vacío. Botón GUARDAR full-width en tablet/mobile con min-height 44px (target táctil cómodo). Label "💰 PRECIO" siempre visible incluso desktop.
- `[FAQ-LIGHT-LEGIBILIDAD]` — bug detectado en QA del 15-may noche. Pendiente fix. Texto de `.faq-question` en light mode tiene color `rgb(224,224,224)` (casi blanco) sobre fondo `rgb(245,239,222)` (crema clarito) · contraste ~1.2:1 → WCAG fail catastrófico · las preguntas del FAQ son ilegibles en light mode. Verificado en preview con `getComputedStyle`. La regla `body:not(.dark-mode) .faq-question` existe en línea 7158 (color #1a1a1d) pero hay otra regla más específica que está ganando. Fix esperado: agregar `!important` a la regla light + investigar qué regla más específica gana. Esfuerzo ~10 min.
- `[EMERGENCY-BUMP]` — técnica del 15-may noche para forzar update remoto de la tablet del admin cuando se quedó "colgada" con cache híbrido. Consiste en bumpear el SW (v1.1.37→v1.1.38) sin cambios reales · eso dispara el `updatefound` listener en los clientes con SW v1.1.32+ · `[PWA-AUTO-RELOAD]` recarga la página automáticamente · cliente ve la versión nueva sin tocar nada. Útil cuando el feedback del usuario es "se quedó colgado" y se sospecha cache. Documentado como patrón replicable.
- `[SW-BANNER-V2]` — rediseño del `[SW-UPDATE-BANNER]` original (pill chica 46px) a versión "Amarillo BIG" (variante C de los mockups). Layout nuevo: ícono 🔄 grande (44×44) dentro de círculo negro · título "Nueva versión del panel disponible" (1rem · 800w) · subtítulo "Tocá actualizar para tomar los últimos cambios y mejoras" (.7rem · 78% opacity) · botón "ACTUALIZAR" gigante pill negra (padding 10×22 · 900w · 24px radius) · botón × redondo. Gradient 135deg `#ffd000 → #e8b800 → #c89800` + box-shadow dorado 24px. ~75px alto vs 46px anterior. Responsive: desktop horizontal · tablet (≤900) más compacto · mobile (≤540) botón pasa a fila propia full-width. Razón del cambio: la pill anterior era discreta y la chica del local no le prestó atención cuando la tablet se colgó · la nueva versión es imposible de ignorar manteniendo paleta amarilla coherente.
- `[QA-PRE-JULIO]` — checklist exhaustivo de ~170 items para validar todo el flujo antes del viaje de Alejo a Buenos Aires en julio. Cubre: admin (login, navegación, precios, decants, destacados, horario, puntos, push) + público (nav, catálogo, filtros, card detalle, similares, compare, armador, carrito, selección ST, juegos, login, light mode) + perf (LCP/FCP/CLS) + PWA + SEO. Items críticos marcados con palabra "CRITICO" · items que requieren tablet real con 🪨 (~10 items: touch, performance, fuentes). Setup instructivo al inicio (F12 emulado 800×1280 para Tab A9). Template al final para reportar bugs en formato parseable. Vive en `docs/QA-PRE-JULIO.md`. Reutilizable cada vez que se quiera validar el sitio.
- `[BUG-DEC-ADMIN]` — bug pendiente (no fixeado todavía). En el admin, al entrar a la tab "💧 Decants" desde algunos viewports, el contenido del panel ("Configuración Pack de Decants") aparece con un ESPACIO NEGRO ENORME arriba · está rendereándose MUY DEBAJO del menú lateral, como si el sidebar `[ZAPATO]` tuviera height fija que empuja el main hacia abajo. Hipótesis: el sidebar es position:relative o static y ocupa altura completa del viewport en ciertos breakpoints · el `.admin-main` no tiene margin-left adecuado · o overflow mal configurado. Sugerencia del usuario: convertir el sidebar a overlay (position: fixed + z-index alto) que TAPE el contenido principal en lugar de empujarlo. Esfuerzo ~1-2hs · validar con tablet real antes del fix. Documentado en `memory/pendientes_post_15_may_2026.md`.
- `[SELECCION-BADGE]` — texto del badge amarillo de las cards de Selección ST editable desde admin. Antes hardcoded "HOT SALE" → ahora dinámico cargado desde Supabase tabla `seleccion_st_config` (single-row, id=1, badge_text TEXT, updated_at TIMESTAMPTZ) con default "TOP VENTAS" + RLS pública. **Admin** (`admin.html` tab Destacados, arriba del buscador de perfumes): nuevo bloque `🏷️ Texto del banner amarillo (badge)` con input `maxlength=20` auto-uppercase + botón "💾 Guardar badge" + mensaje inline éxito/error 4s. Handler `saveSeleccionBadge()` hace upsert con `onConflict:'id'` + `logAdminAction('seleccion_badge_update')`. `loadSeleccionBadge()` se invoca dentro de `loadDestacados()` para cargar el valor actual cuando la chica abre la tab. **Frontend** (`app.js`): variable global `SELECCION_BADGE_TEXT` con default 'TOP VENTAS' (para primer paint sin Supabase). `loadSeleccionStConfig()` vía deferTask → si Supabase devuelve badge_text válido, actualiza la variable + re-renderea `renderSeleccionST()`. `renderSeleccionST()` ahora usa `escapeHTML(SELECCION_BADGE_TEXT)` en lugar del 'HOT SALE' hardcoded. Útil para campañas: HOT SALE, NUEVO, OFERTA, 50% OFF, BLACK FRIDAY, ANIVERSARIO ST, DÍA DEL PADRE, etc.
- `[SW-UPDATE-BANNER]` — aviso "Hay una versión nueva del panel disponible" en `admin.html`. A diferencia del `[PWA-AUTO-RELOAD]` del front público (que recarga sola con mitigación), en admin la chica decide CUÁNDO actualizar — podrían estar en medio de una venta, editando precios o ajustando stock; una recarga forzada perdería lo que están haciendo. **HTML**: pill amarilla sticky-top con ícono 🔄 (gira lento, 2.5s linear infinite) + texto "Hay una **versión nueva** del panel disponible" + botón "Actualizar →" (pill negra contrastante, click → `location.reload()`) + botón cerrar × (esconde el banner, la chica decide actualizar más tarde). hidden por default. **CSS**: `position: sticky; top: 0; z-index: 9999` (arriba de todo, sobre nav admin y sidebar). Gradient `#f5d442 → #e8b800`. Slide-down animation .4s al aparecer (respeta `prefers-reduced-motion`). Mobile @<540px: padding más justo, fuentes chicas. **JS**: `serviceWorker.register('/sw.js', { updateViaCache: 'none' })` propio del admin (antes no tenía). Si `reg.waiting` existe al cargar Y hay `controller` → muestra banner (caso: la chica abre admin después de que index.html bajara la nueva). Listener `updatefound` cuando `newSW.state === 'installed'` Y hay controller → showUpdateBanner() + `postMessage SKIP_WAITING`. El cliente sin SW previo (first visit) NO ve banner — no hay nada que actualizar.
- `[BUG-DEC-ADMIN]` — `</div>` extra en admin.html:2127 (después de tab-combos) cerraba `<main>` implícitamente · 9 tabs del admin (votación/push/espera/doctor/**decants**/auditlog/analytics/backups/puntos) quedaban como siblings del `.app-shell`, no como hijas del `<main>` · al activarse aparecían debajo del sidebar con espacio fantasma · descubierto verificando una propuesta de fix CSS con `preview_eval` (la causa real era HTML, no CSS) · 1 línea borrada en commit `4f69dee`.
- `[SELECCION-ST-1B]` — textarea `editNotaJefe` en el modal Editar Perfume (admin.html:1596), maxlength 180, rows 2, ubicado arriba del bloque "Notas de stock". El frontend público ya renderizaba `p.nota_jefe` como `.collectible-quote` (cursiva Cormorant Garamond, bajo el nombre) en cards de Selección ST top 6 desde commit 1.1.30, pero hasta ahora no había forma de cargar el quote desde admin sin tocar SQL. `saveEditPerfume` lo upsertea en `perfume_overrides.nota_jefe`; `fieldsToLog` lo loguea como "Quote del jefe". Commit `ea42a66`.
- `[JUEGOS-3A-FINAL]` — cierre del pendiente original `[JUEGOS-3A]` (que reposicionaba `#quizSection` via JS-move sync inline antes de `</body>`). Ahora el HTML estático ya tiene el orden correcto: `<section id="quizSection">` vive físicamente entre `#seo-hub` y `#nosotros`. Se eliminaron las 14 líneas del IIFE `moveQuizSection`. 118 líneas movidas (comentarios + section completo) con script Node temporal para preservar HTML entities (`&#225;`, `&aacute;`, etc.). Commit `b162b29`.
- `[CATALOG-IMG-RESIZE]` — resize masivo de las 344 fotos del catálogo en `/img/` con sharp 0.34.5 vía script Node temporal (`fs.readFileSync` → `sharp(buffer)` → `fs.writeFileSync` para evitar EPERM/locks de Windows). Antes: típicamente 600×750 portrait, mostradas a 155-178 px wide en mobile. Ahora: max-width 400 (cubre desktop retina · display ~200 × DPR 2 = 400) quality 80. Resultado: **3.69 MiB → 1.86 MiB · -50% global**. Paths SIN cambiar (template de cards en `app.js` no se toca). Backup local en `img/.backup-pre-resize/` (gitignored). Excluidos: `og-preview.webp` (1200×630 deliberado para social cards). Commit `0e69ecc` (rebased en `a8df5df`).
- `[BATCH-REFLOW]` — fix de antipattern read-after-write en `applyCardVisibility` de `app.js` (filtros del catálogo). Antes había `void card.offsetWidth` dentro de un `forEach` sobre las 162 cards = **162 reflows forzados = 151ms TBT** según Lighthouse. Ahora: batch reads/writes — todas las cards que entran a la vista se marcan en un array dentro del loop, después del loop UN solo `void grid.offsetWidth` en el contenedor (afecta a los hijos automáticamente) y aplica la clase de animación a todas en otra iteración simple sin reflow. **-140ms TBT** medido. Patrón general: NUNCA hacer reflows forzados dentro de loops; siempre batchear lecturas/escrituras de DOM. Commit `8449850`.
- `[HERO-SUB-MOVE]` — move físico del `<p class="hero-sub">` (texto largo "Perfumes árabes importados de larga duración..." con keywords SEO valiosas: perfumes árabes, Comodoro Rivadavia, cuotas, envíos) desde el `<section class="hero">` a la sección `#nosotros` como nuevo `.nosotros-intro`. Razón: en mobile el `<p>` wrappeaba a 5-8 líneas y el shift por swap de fuentes generaba el grueso del CLS del hero (0.845 de 0.978). Hero queda solo con tagline + title (textos cortos de 1 línea cada uno = cero shift por swap). SEO mantenido (texto sigue en la página). UX mejorada (hero más punchy, Nosotros más completo). Commit `4666fe5`.
- `[HERO-MIN-HEIGHT-DOWN]` — paso intermedio donde se bajó el `min-height` del hero de 320/380 a 220/260. Insuficiente — seguía dejando ~60px de hueco fantasma. Reemplazado por `[HERO-COMPACT]`. Commit `2ce5c09` (rebased en `08ea45e`).
- `[HERO-COMPACT]` — **ELIMINAR completamente el `min-height` del `.hero`** (CSS + critical inline) + bajar padding-bottom (2.5rem → 1.25rem mobile · 3rem → 1.5rem tablet · 4rem → 1.75rem desktop). El hero queda en altura natural ~140-180px según viewport. **MEDICIÓN FINAL en preview Vercel: 100% Performance Mobile + 100% A11y + 100% Best Practices**. ⚠️ REGLA: nunca volver a poner `min-height` ALTO en el hero · dispara el layout-recalc raro de v1.1.43 (CLS 0.132 → 0.957). BAJAR/quitar está OK, SUBIR está prohibido. Commit `50c2f80`.
- `[LCP-PRELOAD]` — preload + fetchpriority de imagen LCP
- `[CLS-RESERVE]` — min-height reservado en skeleton/grid
- `[CLS-BANNERS-RESERVE]` — min-height reservado en `<style>` inline para 3 elementos above-the-fold mobile que crecen sin estilos: `.trust-badges` (vacío → 240px cuando Supabase rendea 4 cards), `.quiz-cta-banner` (40-60px → 235px cuando styles.css aplica padding+flex+gradient), `.price-banner-wrap--big .price-banner--big` (40-60px → 129px similar). Más equivalentes desktop con valores menores (145/115/105). Valores medidos con `preview_inspect` mobile 375 + desktop 1280 + buffer 5-10px. Resultado: CLS Mobile 1.044 → 0.025 (-97%) · score 49 → 84 (+35) · LCP 4.6s → 2.45s. Validado con 5 runs limpios (3 Lighthouse local + 2 PSI clean). Desktop NO resuelto (top shift desktop es `svg.search-icon` score 0.858 · culprit distinto · queda para iter 3). Commit `a761035` (squash de 4 commits intermedios: v1 → temp canonical → v2 → revert canonical).
- `[FCP-CSS]` — CSS no bloqueante + critical inline
- `[IMG-DIMS]` — aspect-ratio defensivo en imgs
- `[SDK-DEFER]` — Supabase SDK con defer (ya estaba)
- `[LOGIN-RETRY-SP]` — login del panel admin con loop de hasta 2 intentos · reintento silencioso solo si timeout/red (NO si pass incorrecta) · 1.2s entre intentos · timeout 8s → 10s · UX "Reintentando…" · NO cuenta timeout como fail (preserva regla anti-lockout original). Causa raíz: latencia intermitente Supabase Oregon + WiFi local. Plan A diseñado con ClaudeChat (instancia separada) · ejecutado por Claude Code con mejora `[LOGIN-RETRY-TELEMETRY]` agregada. Commit `267e7e2`. Plan B (migración Supabase a `sa-east-1` São Paulo) documentado pero NO ejecutado · esperar señal de telemetría · ver `RECOMENDACIONES_CLAUDECHAT/Plan_B_*.md`.
- `[LOGIN-RETRY-TELEMETRY]` — notifyTelegram cuando un reintento es exitoso · permite contar frecuencia del problema en producción · si llegan muchos por semana → activar Plan B · mejora agregada al Plan A (commit `267e7e2`).

Y para mejoras futuras planteadas pero no hechas:
- `[SIRENITA]` — sistema de Campañas (tabla `campaigns` en Supabase) para que las empleadas puedan crear/activar/desactivar campañas (Hot Sale, Black Friday, Aniversario, etc) sin tocar código. Cada campaña define label, emoji, color. Solo 1 activa por vez. Mockup propuesto en `mockup-zapato.html` tab "Campañas". Hoy `HOT_SALE_LABEL` está hardcoded — esto lo haría editable desde admin.
- `[DECANTS-UX]` armador iter 2 — quedaron pendientes 2 de las 6 ideas charladas en mayo-2026 (las otras 4 se implementaron en commit f33386a):
  - **#4 Tab switcher "Catálogo / Mis decants"** — 2 tabs con badge de cantidad: ver todo el catálogo o solo los que ya agregaste al pack. Útil para revisar el pack pre-mandar sin scrollear. Mockup en `mockups.html` sección #4. Estimado: 20 min de laburo. Toca: HTML modal armador (header), CSS de las tabs, JS para filtrar el grid según tab activa.
  - **#6 "Combinás bien con: X"** — sugerencia inteligente cuando el pack tiene 1+ decants. Muestra 1 perfume "que combina" basado en perfil/notas/marca. Botón "+ Sumar" para agregar de 1 toque. Mockup en `mockups.html` sección #6. Estimado: 1-2 hs reutilizando el algoritmo de matching del quiz (`detectProductType` + matching por notas en `app.js`). Si no, 4-5 hs armando algoritmo desde cero. Decisión: hacerlo cuando se quiera atacar la "experiencia premium" del armador.
- `[DECANTS-BANNER-V2]` — Alejo generó una foto con IA (GPT/DALL-E) preciosa del banner: 3 frascos atomizadores transparentes sobre podiums morados, flor 🪻 violeta, humo rosado de fondo. Se charló iterar el banner que ya está live (commit f33386a, opción B SVG simple) hacia algo más cercano a esa estética. Mockup `mockups.html` mostró 3 opciones desktop (foto directa / recrear en CSS+SVG con podiums+humo+flor / híbrido) + 3 variantes mobile (A stack vertical / B texto primero / C reducción con 5ml protagonista). **Pendiente decisión del usuario** sobre cuál combo (desktop+mobile) implementar. Voto sugerido: Opción 2 (CSS+SVG) + Variante C (reducción) por performance y enfocar el único frasco disponible. Si elige Opción 1 (foto directa) hay que verificar derechos comerciales según qué IA usó.
- `[LCP-V2]` — segunda capa de LCP (comprimir logo, lazy real cards 7+)
- `[HERO-OPTIMIZE]` — optimización específica del hero
- `[JS-CHUNK]` iter 2+ — el iter 1 (decants) ya está deployed. Falta mover: quiz + juegos ST + custom cursor + compare modal + banner decants WA + share/sharePerfume. Estimado: -3000 líneas más del bundle inicial. Riesgo: medio. Recomendado hacerlo en branch dedicada con preview Vercel (igual que se hizo iter 1 — ver commit bcd4eec).
- `[BCRYPT-MIGRATION]` — hashear passwords lazy migration
- `[SUPABASE-AUTH]` — migrar de custom auth a Supabase Auth nativo
- `[ORDEN-COMPRA-TAB]` — tab admin con sugerencias de pedido

### 💡 Ideas futuras para enriquecer la landing (brainstorm mayo 2026)

Cosas que se charlaron o aparecieron como "estaría bueno tener" durante las sesiones. **NO están priorizadas** — el jefe / Alejo decide cuándo atacar.

| Idea | Por qué | Esfuerzo aprox |
|---|---|---|
| `[REVIEWS]` Reviews con estrellas + comentarios de clientes (moderados desde admin) | Social proof real, aumenta conversión | 3-4 hs (tabla `reviews` + UI cliente + tab admin moderación) |
| `[WISHLIST-SHARE]` Wishlist compartible por link/WhatsApp | "Mandale esta lista a tu pareja" — viralización orgánica | 2-3 hs (slug compartible + landing dinámica `/wish/abc123`) |
| `[NEWSLETTER]` Email signup con descuento bienvenida | Captar leads para campañas futuras | 1-2 hs (form + Supabase tabla + email service) |
| `[NOTAS-CATADOR]` Reseña corta del jefe en cada perfume ("A mí me gusta porque...") | Diferenciación + personalidad de la perfumería | 30 min UI + cargar texto perfume por perfume |
| `[BIRTHDAY-CLUB]` Descuento automático en mes de cumpleaños del cliente | Retención + sensación VIP | 1-2 hs (date check + banner contextual) |
| `[STOCK-URGENCY-V2]` Banner sticky inferior "Solo quedan N de este perfume" cuando hay <3 | El badge del catálogo ya existe — esto es la versión "alarma fuerte" en card abierta | 1 hs |
| `[QUIZ-V2]` Quiz "encontrá tu perfume" más refinado (preguntas con visuales + ranking de 3 finalistas) | Ya hay quiz básico — esta versión engancha más | 2-3 hs |
| `[CALCULADORA-PACK]` "¿Qué perfume me queda?" según ocasión + estación + presupuesto | Asistente compra interactivo | 3-4 hs |
| `[VIDEO-EMBEDS]` Embebido de TikToks / Reels del local + clientes | UGC y "ver el local" sin venir | 1-2 hs (responsive iframe + admin para agregar) |
| `[NOTAS-VISUAL]` Mapas interactivos de notas (top/middle/base) en cada perfume | Educa al cliente, hace catálogo más rico | 2-3 hs (SVG triangle + CSS) |
| `[REFERIDOS]` Programa "invitá un amigo, ambos ganan puntos" | El sistema de puntos ya existe — esto le da viralización | 2-3 hs |
| `[STORE-INFO]` Modal "Cómo conservar tu perfume" educativo | Confianza + autoridad | 30 min (modal con copy) |
| `[COMPARE-V2]` Mejorar el compare actual (mostrar diferencias destacadas, gráfico de notas) | Ya existe pero es básico | 2-3 hs |
| `[ONBOARDING-MODAL]` Modal de bienvenida primer visita con tour rápido | UX premium primera impresión | 1-2 hs |
| `[BOTON-VOLVER-CAT]` Botón sticky "Volver al catálogo" cuando scrolleás muy abajo | Navegación + UX | 30 min |

**Cómo elegir qué hacer**: priorizar lo que aumenta conversión a venta + lo que el jefe pide específicamente. Las "experiencia premium" (quiz, calculadora, video embeds) son nice pero el revenue real viene de fricción reducida (wishlist share, reviews, stock urgency).

---

## Sesión 30-sep-2026 · `_z` — la tanda v1.1.157 (rama `inicio`, sin mergear)

Del prompt `_y` del PREPARADOR (§ 3) y el dibujo `_z` del DISEÑADOR (`herramientas\panel-inicio\diseno\`). La rama sale de `0f4c8b7` (`no-pisar`, v1.1.156, todavía sin mergear: el merge espera el «mergeá no-pisar» de Alejo). Un commit por punto:

1. **`[QUOTE-JEFE-SE-BORRA]`** — `loadOverridesIntoPerfumes` copia `nota_jefe` como las otras notas: Editar muestra la quote y «Guardar cambios» ya no la pisa con vacío.
2. **128n `[PANEL-STOCK-CALLA]`** — sin la lectura del stock (`stockCargado`), la línea «No se pudo cargar el stock. Recargá la página; si sigue, avisale a Alejo.» arriba de la tabla (`#avisoStockPrecios`, `#avisoStockDep`; `--stat-tinta-out`: 5,32 claro / 5,18 oscuro) y el Estado de cada fila en «—» gris, sin badge y sin toque (`.stock-sin-lectura`). En Depósito, las dos columnas. **Decisión de Claude Code:** el precio y el efectivo también van en «—» cuando falló la lectura de los overrides (`overridesCargado`), porque de ahí salen los precios que cambió el jefe; el dibujo los muestra con el número de `perfumes.js`.
3. **«Cerrar sesión»** con tilde.
4. **134 `[MAZO-TAPADO]`** — `app.js` le pone `.filter-bar--pegada` a `#catalogo` cuando la barra se pega (IntersectionObserver con `rootMargin: -59px`, `threshold: [1]`, `boundingClientRect.top <= 59`) y a < 768 el mazo pasa a `visibility: hidden`. Medido a 390, claro y oscuro: de 260 puntos debajo de la cinta, 70 caían en el mazo (`#filtro-todos` / `#filterDeck`); ahora 0. La barra mide lo mismo (58 → 236,8) y el buscador sigue en 135,4: la banda vacía del dibujo se mantiene (📐 para el DISEÑADOR: si se la quiere sacar, el buscador sube ~29 px y hay que tocar los `scroll-margin-top` de NO ROMPER #12).
5. **133a–g `[PANEL-INICIO]` + 135 `[BADGE-EMPLEADO-CLARO]`** — `#tab-inicio` (4 botones 2 × 2, «Ver todas las pestañas»), el botón «Inicio» del encabezado (casita SVG; a ≤ 480 sólo la casita y el título «ST Admin»), «Home» → «📣 Banner», la badge «Empleado» con `--gris-claro` / `--gris` inline. Medidas: 600 → botones 262,8 × 184, 12 entre botones, todo termina en 619,4; 390 → 157,8 × 148, termina en 547,4; 960 × 600 → 314 × 150 (grilla de 640). A 360 «ST Admin» + EMPLEADO entra en una línea con 3,4 px de sobra (hubo que sacarle el `margin-right` a ☰ —en el dibujo el ☰ está a 6 px de la casita— y achicar el margen de la badge a .3rem); a 360 los botones miden 142,8 y con `padding: .5rem .25rem` «Precios & Stock» entra en un renglón. Un toque en cada botón lleva a su pestaña con el menú marcado; «Ver todas» abre el cajón (≤ 700) o el riel (≥ 701) y no lo cierra si ya estaba abierto. **Contraste:** el gris de «— esperando» sobre el botón tocado en oscuro daba 4,15 (#888 sobre #28282b); mientras está tocado pasa a `--gris-claro` (9,15).

**Achique de `CLAUDE.md`:** los «Contexto previo» (del 12-ago al 29-sep `_x`) pasaron tal cual al archivo de más abajo: 199.006 → 61.538 bytes, 25.580 → 9.096 palabras (~62 k → ~19 k tokens por sesión). **Verificación:** `npm run contraste` 0 fallas + 1 token pisado, 369 mediciones; `medir_targets.js` 27 cortos de 636 (los mismos 27); `node --check` del script de `admin.html` y de `js/app.js`.

---

## Sesión 30-sep-2026 · `_aa` — la tanda v1.1.158 (rama `tintas`, sin mergear)

Del prompt `_z` del PREPARADOR (§ 1) y su `_aa`, con el dibujo `Disenador_para_PREPARADOR_2026-09-29_aa.md` (136 a 140). La rama sale de `c1e7e66` (`inicio`). Un commit por punto:

1. **136 `[TINTA-MENSAJES]`** — tres tokens (`--tinta-ok` / `--tinta-aviso` / `--tinta-error`, claro y oscuro) y todo lo que el panel contesta pasa a ellos: 141 `.style.color = '#…'` (cada uno por lo que dice), los mensajes en strings y en clases (`.login-error`, `.modal-success`, `.barra-error`, `.aviso-lectura-tabla`, `.espera-ok/ya/error`, `.ajuste-error`, `.promo-estado--*`, `.promo-aviso-costo`, `.promo-fila-nota--pierde`, «Activa», «✓ Completo», las filas de error de las tablas), `msgDestacados`, `avisoLectura` y `errorDestacados`. Decisiones de Claude Code «por lo que dice»: «Cancelado» (3 lugares, estaba en rojo) → aviso; «Máximo 7 destacados» y «Ya está en destacados» → aviso; «eliminado de destacados» → ok; `.promo-estado--terminada` → aviso; `.promo-aviso-costo` y `.promo-fila-nota--pierde` → error. No pasan: badges, números de tarjetas, `#25D366`, los botones, los colores de las filas de diferencias del Log. Se borraron 4 reglas de `body.light` que pisaban a las clases (`.promo-estado--prendida/terminada`, `.promo-aviso-costo`, `.promo-fila-nota--pierde`) y la de `.ajuste-error`. Lista línea por línea: `herramientas\tintas\lista136.md`.
2. **137 `[COMBO-FORM-CLARO]`** — `#comboForm` pasa a la clase `.combo-form` (#111 en oscuro, `--superficie` en claro, con el borde `--amarillo`); «Cancelar» a `.btn-cancelar-combo` (`rgba(255,255,255,.1)` / `rgba(0,0,0,.06)`); el ✕ de cada fila y el de la foto en `--tinta-error`. **Hallazgo:** `clearComboFoto` borraba el color de la ayuda de la foto (`style.color = ''`) y la ayuda heredaba el del texto (blanco en oscuro, `#1a1a1a` en claro): ahora vuelve a `var(--gris)` (5,33).
3. **138 `[BTN-STOCK-AZUL]`** — `.btn-stock` a `#2170b0` (5,24) y con mouse a `#1a5a8f` (7,23) sólo bajo `@media (hover: hover)`; vale para los 9 lugares (también el − / + del stock y del depósito).
4. **139 + 140** — «↻ Restaurar por defecto» arranca escondido y aparece cuando la lectura de Beneficios anda (no había otro botón que reemplace o borre todo en los formularios de 1.2: «Migrar tipos» ya frenaba con `faltaOverrides`). El aviso del toque dice qué pasó con lo tocado: «No se agregó «YEAH PARFUM»: la lista de destacados no cargó.» (y «…todavía se está cargando.»; «No se quitó» / «No se movió» sin nombre) y «No se guardó: los beneficios no cargaron.»; la línea gris sigue diciendo qué pasa y qué hacer.
5. **128p `[TIP-SIN-BADGE]`** — sin la lectura del stock se esconden los tips «Tip: tocá la badge de Estado…» (Precios & Stock) y «Tip: tocá el número de Depósito…» (Depósito).
6. **Chicos** — `[RANKING-TEL-CRUDO]` (el ranking de Puntos muestra el teléfono con `formatPhoneDisplay`; el buscador encuentra por el número guardado y por el que se ve); el buscador `#puntosFilterCliente` pasa a la clase `.puntos-filtro` (en claro, `--superficie` y color heredado) y recupera el `padding-right` de 2,5 rem: la ✕ ya no pisa el placeholder; `[INICIO-ESPERA-VIEJO]` (`irAInicio()` relee la Espera); y si falla sólo la lectura completa (`stockCargado` bien, `overridesCargado` falso) la línea de Precios & Stock muestra `SIN_LEER.overrides`.
7. `.claude/commands/handoff.md`: la «Última actualización» anterior va al archivo de HISTORIA (sin bump).

**Verificación `_aa` § 1.2 (las tarjetas de `encabezado-360-claro-empleada-en-pestana.png`):** dicen «0 unidades en stock» y «0 sin stock» porque el fixture de esa captura trae `perfume_overrides: []`: todos los perfumes salen del seed, con `stock_status` y sin `stock_qty`, y las tarjetas suman `_stockQty` (Estadísticas y filas dicen cosas distintas sólo en el fixture). **En la base (`znmjhproimtprptheumy`): 11 filas de `perfume_overrides` tienen `stock_status` y `stock_qty` nulo** (de 272): siete pausados (`set-asad`, `set-dia-de-la-madre`, `rayhaan-pacific`, `rayhaan-tropical-vibe`, `candid`, `cherry-bouquet`, `art-of-nature-i`) y cuatro en «ok»: `set-yara` y `set-yara-mini` (sets: no entran en las tarjetas) y dos ocultos (`decant-le-beau-edt`, `desodorante-asad-bourbon`). Ninguno es un perfume visible en stock: no cambian las tarjetas. Anotado al PREPARADOR.

**Verificación:** `npm run contraste` 0 fallas + 1 token pisado, 399 mediciones (filas nuevas: las tres tintas sobre los fondos reales, las clases que las usan y `.btn-stock`); `node --check` de los scripts de `admin.html`.

---

## Sesión 1-oct-2026 · `_ab` — la tanda v1.1.159 (rama `backup-completo`, sin mergear)

Del prompt `_ab` del PREPARADOR (§ 2) y su `_ac`. La rama sale de `32cb2c3` (`tintas`, aprobada). Antes: `inicio` quedó mergeada la noche del 30-sep (el push a `main` lo corrió Alejo en PowerShell: el modo automático lo bloqueó como «Production Deploy») y las 11 filas de `perfume_overrides` con estado y sin cantidad se cerraron sin SQL (son pausados, sets y ocultos).

1. **`[BACKUP-INCOMPLETO]`** — `BACKUP_TABLES` de `admin.html` y de `api/cron/backup.js` iguales (23 tablas, mismo orden, comentario cruzado): + `decants_custom`, `promos_decants`, `promos_decants_perfumes`, `home_top_banner`, `home_slides`, `trust_badges`, `seleccion_st_config`, `announcements`, y `ventas` en el panel. Afuera a propósito (con el motivo en el comentario): `cliente_sesiones`, `cliente_login_intentos`, `password_reset_requests`, `push_subscriptions`, los logs y `admin_backups`. **Tamaño medido (base real, `row_to_json`):** 302.176 bytes (~295 KB) antes; +6.647 bytes de las tablas nuevas (`decants_custom` 16 filas / 4.766 B, `home_slides` 3 / 947, `trust_badges` 4 / 697, `home_top_banner` 1 / 155, `seleccion_st_config` 1 / 82; `promos_decants`, `promos_decants_perfumes`, `announcements` y `ventas` en 0) = 308.823 bytes (~302 KB), +2,2 %. **Lectura del panel (políticas, no cuenta real):** `pg_policies` + `has_table_privilege` dicen que la cuenta del jefe lee las 8 tablas nuevas (`decants_custom`, `home_*`, `seleccion_st_config` y `announcements` por SELECT público o `authenticated`; `trust_badges` por `authenticated ALL`, así que ve también las inactivas; `promos_decants*` por `pd_select_staff` / `pdp_*_staff`). **Excepción:** `ventas` tiene RLS prendida y **ninguna política**: el panel la lee siempre vacía y sin error; el cron sí la trae. Hoy son 0 filas → `[VENTAS-SIN-POLITICA]` 🟢. No se tocó ninguna política.
2. **136a** — los estados de la promo: Apagada `--gris`, Programada `--tinta-aviso`, Prendida `--tinta-ok`, Terminó `--tinta-error` (y su renglón de abajo). Se sacaron las reglas `body.light` de Apagada y Programada.
3. **128q `[VALOR-SIN-PRECIOS]`** — `pintarValorInventario` usa `sinDato = !stockCargado || !overridesCargado`: sin los overrides, las cuatro cifras de la tarjeta (total, Local, Depósito, Incluye pausados) dicen «—»; unidades y «sin stock» siguen con número (lectura liviana).
4. **138b** — `.combo-badge-mini` a `#2170b0` (5,24). Se ve en la pestaña Combos, al lado del nombre de un combo de tipo «Mini Collection». De paso, `contraste.js` mide PACK (11,29) y REGALO: **REGALO da 3,82** (`#fff` sobre `#e74c3c`, de antes) → `[COMBO-REGALO-ROJO]` 🟢, anotada en `CONOCIDAS`.
5. **141 `[TEL-SIN-CORTE]`** — `telHtml(raw)` arma el HTML del teléfono con el tramo final en un `<span class="tel-fin">` (`nowrap`); `formatPhoneDisplay` no cambia (el buscador del ranking compara contra su texto). Se aplicó en el ranking, en el detalle de Clientes y en los resultados del buscador de puntos. Espera ya tenía `.espera-tel-num` con `nowrap` entero (129c). Medido a 360 y 390 (celda de 70 px, 3 renglones antes y después): antes «2974 56-» / «7890», ahora «2974» / «56-7890».

**Verificación:** `npm run contraste` 0 fallas + 1 token pisado + 2 conocidas, 411 mediciones; `node --check` de los scripts de `admin.html` y de `api/cron/backup.js`; las dos listas comparadas por script (23 y 23, mismo orden).

---

## Sesión 1-oct-2026 · `_ac` — la tanda chica v1.1.160 (rama `combos-ranking`, sin mergear)

Del prompt `_ad` del PREPARADOR. La rama sale de `d21c46d` (`backup-completo`, aprobada: su merge es desde las 21:00). **Antes del push, medido:** `origin/main` = `32cb2c3`; `origin/backup-completo` = `d21c46d`; `git merge-base --is-ancestor` OK; `sw.js` v1.1.159 con LF (0 CRLF, 260 LF en el blob); y el «1 token pisado» de `contraste.js` es el mismo en la 158 y en la 159 (`.card-brand` `#2a2622`, `styles.css:8344 !important`).

1. **138c `[COMBO-REGALO-ROJO]`** — `.combo-badge-regalo` y la nueva `.combo-badge-roto` a `--rojo-fondo` con letra `#fff` (5,89, los dos temas). ROTO era una etiqueta con estilo inline (`color:#fff`) y el parche `body.light [style*="color:#fff"]` le ponía letra `#1a1a1a`: **medido, ya no la toca** (la etiqueta no tiene atributo `style`; en claro sale `rgb(255,255,255)` sobre `rgb(184,52,42)`). El borde de la tarjeta rota no cambia (`2px solid #e74c3c` inline). REGALO deja de ser una «conocida» de `contraste.js`.
2. **138d `[COMBO-PAUSADO]`** — `.client-btn-pausar` (`#95a5a6`) y `.client-btn-activar` (`#2ecc71`) con letra `#1a1a1a` en los dos temas (6,80 / 8,28); la tarjeta pausada sin `opacity` (medido: las 8 tarjetas en `opacity: 1`); «⏸ PAUSADO» es `.combo-badge-pausado` (`#95a5a6` + `#000`, 8,21). **Hallazgo del propio dibujo:** con MINI + ROTO + «⏸ PAUSADO» a 390 la etiqueta se partía («⏸» arriba, «PAUSADO» abajo): se agregó `white-space: nowrap` a `.combo-badge`.
3. **141b `[RANKING-BUSCAR-ANCHO]`** — `flex: 1 1 200px` en el buscador del ranking (el script de la ✕ lleva el `flex` inline al wrapper). Medido a 390: el buscador baja a su renglón con 294 px de ancho y el texto de ayuda entra entero.
4. **141c `[PUNTOS-COMA]`** — `puntosTxt(n)` («8,5») en el ranking y en «Puntos actuales»; el teléfono de esa línea con `formatPhoneDisplay` («+54 9 2974 56-7890»). Sólo lo que se muestra: lo guardado y lo calculado siguen con punto. **Otros lugares donde se muestran puntos (grep, sin tocar):** el detalle de cliente (`var puntos = c.puntos || 0`, ~L5655); «✓ <nombre> ahora tiene N punto(s)» (~L5902); el encabezado del historial «<nombre> — N pts» (~L5973); el valor del campo del modal de edición (`modalClientPuntos`, ~L6009); el Telegram «✏️ Cliente editado … N pts» (~L6051); el Resumen del día («⭐ Puntos», ~L11897); los valores por defecto de la configuración (`puntos_por_*`, ~L12341-12343); y la tabla del historial de puntos (~L12523).

**Para el PREPARADOR, medido:**
- **`ventas`:** 0 filas, RLS prendida y **0 políticas**; **ningún código escribe en `ventas`** (ni el panel, ni el catálogo, ni `api/`; ninguna función ni trigger de la base la nombra). La escribía la pestaña «Registrar Ventas» (`4bc52d4`, rol `authenticated`, jefe y empleadas), eliminada en `4cd33d6`. Los permisos de tabla siguen completos para `anon` y `authenticated`, frenados por la RLS. Políticas SELECT hermanas: `clientes_select_auth` (`{authenticated}`, `true`), `le_select_public` de `lista_espera` (`{authenticated}`, `true`), `op_select_all` de `opiniones` (`{public}`, `true`); `combos_write_staff` (`ALL`, jefe o empleado por `auth.jwt() ->> 'email'`).
- **`lista_espera` (para `[ESPERA-LIBRE]`):** columnas `id` bigint NOT NULL (PK) · `slug` text NOT NULL · `telefono` text NOT NULL · `nombre` text null default `''` · `perfume_name` text null default `''` · `created_at` timestamptz null default `now()` · `notified_at` timestamptz null · `origen` text NOT NULL default `'web'` con `CHECK (origen IN ('web','local'))`. **Sin ninguna FK** (ni a perfumes: los perfumes viven en `perfumes.js` y en `perfumes_nuevos`, así que `slug` es texto libre). Índices: `lista_espera_pkey` y el único parcial `lista_espera_pendiente_uniq (slug, telefono) WHERE notified_at IS NULL`. Políticas: `le_insert_anon` (INSERT, `{anon}`, `WITH CHECK origen = 'web'`), `le_insert_auth` (INSERT, `{authenticated}`, `true`), `le_select_public` (SELECT, `{authenticated}`, `true`; el nombre es engañoso: no es público), `le_update_auth` (UPDATE, `{authenticated}`, `true`), `le_delete_staff` (DELETE, `{authenticated}`, jefe o empleado por email). Trigger `trg_lista_espera_aviso` (AFTER INSERT): **APAGADO**. Permisos de tabla completos para `anon` y `authenticated`. **`unaccent` NO está instalada** (disponible, versión 1.1); `pg_trgm` tampoco (1.6).

**Verificación:** `npm run contraste` 0 fallas + 1 token pisado, 419 mediciones; `node --check` de los scripts de `admin.html`.

---

## Sesión 1-oct-2026 · `_ad` — `[ESPERA-LIBRE]` (rama `espera-libre`, v1.1.161, sin mergear)

Del prompt `_af` del PREPARADOR. La rama sale de `71ff959` (`combos-ranking`, todavía no aprobada). **El SQL no está aplicado**: columna `libre boolean NOT NULL DEFAULT false` y el CHECK `NOT libre OR (origen = 'local' AND slug LIKE 'libre:%' AND char_length(perfume_name) BETWEEN 3 AND 60)` (en el reporte al PREPARADOR, con una observación: un `perfume_name` nulo pasa ese CHECK; la variante con `coalesce` lo cierra).

**Medido antes de empezar:** ningún slug con «:» en `lista_espera` (42 filas), `perfumes_nuevos` (117), `combos` (5), `perfume_overrides` (272) ni `perfumes.js` (160); el slug más largo mide 29 (`libre:` + 60 entra sin problema).

**Corrección del PREPARADOR (prompt `_ag`, 1-oct, 13:25):** el CHECK final es `check ((slug like 'libre:%') = libre and (not libre or (origen = 'local' and char_length(coalesce(perfume_name,'')) between 3 and 60)))`: cierra el agujero de anon (un slug «libre:…» con `libre = false`) y el de `perfume_name` nulo. Se aplica esta noche, desde las 21:00, con una prueba previa en transacción con rollback (`set local role anon`, INSERT con slug `'libre:x'` y `libre = false`: tiene que fallar con 23514). **Verificado en el fixture (360, 390 y 600):** Enter con resultados elige el primero (YARA TOUS); sin resultados, la opción; la opción se esconde con «yara tous», «YARA  TOUS», «Yará Tous», «  yara   tous  » y con el mismo texto que un chip («cargador de auto», «CARGADOR  DE   AUTO», «cárgador de áuto») y sigue con «cargador de auto 2» y «yara tou»; la bajada «Le avisamos por WhatsApp apenas lo tengamos.» mide 16,8 (un renglón) a 360, 390 y 600; el mensaje queda «✓ Anotado para YARA TOUS, «Cargador de auto»».

**Ajuste de la clave (prompt `_ag` actualizado y `_ah` del DISEÑADOR, 1-oct, 13:40), antes del merge de `espera-libre`:** la clave queda guardada en el slug, así que cambiarla después partiría los grupos. `esperaClave` ahora también **saca** (no cambia por un espacio) `. , ; : ! ¡ ? ¿ ' " -`; vale para esconder la opción, para agrupar y para «Ya estaba anotado»; lo que se guarda en `perfume_name` y lo que se muestra no cambian; una clave de menos de 3 caracteres no ofrece la opción. **Medido (fixture, 360):** con el chip «Reloj casio dorado» puesto, «Reloj casio dorado!!», «reloj casio dorado.», «¡Reloj, Casio  Dorado!», «RELOJ - casio dorado» y «Reloj casio dorado?!» **no ofrecen la opción** (aparece «No hay perfumes con ese nombre»); «!!!», «a.b», «¿?» y «ab» tampoco; «Reloj casio dorado 2» sí. Anotar «Reloj casio dorado!!» guarda `slug = 'libre:reloj casio dorado'`, `perfume_name = 'Reloj casio dorado!!'`, `libre = true`, `origen = 'local'`. En la lista, «reloj casio dorado.» se agrupa con los otros dos (3 esperando; el título del grupo es el texto de la fila más nueva). Apuntado, sin hacer: `[ETIQUETA-AL-BAJAR]` (142e) y los tres chicos del DISEÑADOR (138e, 141d, 141e).

**Segundo ajuste de la clave (prompts `_aj` y `_ak` del PREPARADOR, con el `_aj` del DISEÑADOR, 1-oct, 16:00), también antes del merge:** (142i) `esperaClave`, en orden: NFD sin tildes y minúsculas → los tres guiones `- – —` a **un espacio** → se sacan sin espacio `. , ; : ! ¡ ? ¿ ' " « » “ ” ‘ ’ … ´` → se colapsan los espacios; el mínimo de 3 se cuenta sobre la clave ya normalizada y **sin espacios** (`esperaClaveValida`). (142g) con la opción escondida porque lo escrito ya es un chip y sin resultados, el texto dice «Ya está agregado abajo» (misma clase, tamaño y color; «No hay perfumes con ese nombre» queda para lo que no coincide con nada o tiene clave corta). (142h) el título de un grupo libre sale de la fila más vieja que sigue en la lista (`esperaMasVieja`: fecha y, si empatan, id); si se quita, pasa a la siguiente más vieja; el WhatsApp de cada fila no cambia. Medido a 360 (fixture): «Cargador de-auto» = «cargador de auto» (slug `libre:cargador de auto`); «L'Aventure» → «laventure»; «Eau-de-parfum» → «eau de parfum»; «Sí - Armani» → «si armani»; «“Reloj” casio – dorado…» → «reloj casio dorado»; «a-b», «a.b», «a – b» no ofrecen la opción; «5 ml» sí. Con el chip «Reloj casio dorado» puesto, ocho grafías (comillas tipográficas, guiones, «…», «!!», «reloj-casio-dorado») no la ofrecen y dicen «Ya está agregado abajo». Tres anotadas en orden → un grupo, 3 esperando, título «Reloj casio dorado»; quitar la primera → «Reloj casio dorado!!»; Historial igual con las avisadas. `contraste`: 0 fallas, 427. `sw.js` se queda en v1.1.161 (nunca estuvo en producción).

**Lo que hace** (142 a 142d, el dibujo del DISEÑADOR): la opción «+ Anotar «…»» debajo de los resultados y fuera de su scroll, desde 3 caracteres y haya o no coincidencias (se esconde si lo escrito es igual —sin mayúsculas, tildes ni espacios de más— al nombre de un resultado o a un chip; Enter sin resultados la elige; el buscador acepta 60 caracteres); el chip con el texto tal como lo escribió y «fuera del catálogo» donde va el estado («Ya estaba anotado» si ya estaba); la marca «FUERA DEL CATÁLOGO» en Pendientes e Historial; el WhatsApp «ya tenemos lo que nos consultaste: *nombre*» (cada fila libre manda el suyo; se sacan `*`, `_` y `~`); y los textos del formulario («Qué busca», «…apenas lo tengamos.», «✓ Anotado para «…»»). **Medido** (fixture, claro y oscuro, 360 y 600): fila de la opción 44, 4 px (.25rem) entre la lista y la opción, fuera del scroll (la lista de 5 resultados mide 236); borde `dashed 1px` `#6b5500` / `#e8b800`; «+» 16 px 700; «Anotar «yara»» 12 px 600; «fuera del catálogo» 10,4 px, gris 5,33 / 4,90; chip de 46 a 360; encabezado de grupo 35. `contraste.js`: las cuatro filas nuevas dan 7,18 / 9,33, 5,33 / 4,90.

**Decisiones de Claude Code:** (a) los espacios de más del texto escrito se colapsan al guardar (la clave y el nombre); (b) el buscador también colapsa los espacios de la consulta (si no, «YARA  tous» no encontraba «YARA TOUS» y salía la opción); (c) **`esperaEsLibre` mira sólo `libre === true`**, no el prefijo `libre:`: el catálogo (anon) puede insertar un slug «libre:…» con `origen = 'web'` y `libre = false` (el CHECK sólo ata lo libre), y su `perfume_name` iría a un WhatsApp; (d) sólo lo libre manda la columna `libre` al insertar: lo de siempre anda aunque falte el SQL.

**Confirmado:** `saveStock` → `autoNotifyWaitlist(slug)` busca por `.eq('slug', slug)` con slugs del catálogo (ninguno tiene «:»): nunca agarra una fila libre; lo demás de la lista se mueve por `id`; la RPC `lista_espera_pendientes(telefono)` devuelve slugs y el catálogo ignora los que no son de un perfume. **Backup:** `lista_espera` está en las dos listas y se baja con `select('*')`, así que lleva la columna sola; **el panel no restaura** (sólo descarga), así que no hay un camino por donde entre un backup viejo; si algún día lo hubiera, `DEFAULT false` cubre las filas sin la columna.

**`[VENTAS-SIN-POLITICA]` vuelve a 🟢** (decisión del PREPARADOR: nada escribe en `ventas`): migración `ventas_select_staff` (`FOR SELECT TO authenticated`, la misma expresión por email que `pd_select_staff`), a aplicar fuera de 10–21.

**Verificación:** `npm run contraste` 0 fallas + 1 token pisado, 427 mediciones; `node --check` de los scripts de `admin.html`.

---

## Sesión 1-oct-2026 · `_al` — `[MAYOR-STOCK]` (rama `mayor-stock`, v1.1.162, sin mergear)

Del prompt `_al` del PREPARADOR (decisión de Alejo). La rama sale de `a3b7764` (el HEAD final de `espera-libre`, aprobada por el PREPARADOR y el DISEÑADOR). Sin SQL. **Medido antes de tocar:** «En stock primero» era la opción `stock-ok` del `<select id="sortPrecios">` de Precios & Stock (`admin.html`), resuelta en `sortPerfumes` (ok, low, out, pausado, sin desempate); `sortPerfumes` sólo la llama `renderPrecios`; el catálogo público, `js/app.js` y las demás pestañas no la usan; **no se guarda** (ni `localStorage` ni otra cosa: el select abre en «Nombre A-Z»), así que no hay elección vieja que migrar. **Depósito (`#sortDeposito`) no tenía «En stock primero»:** sus opciones son «Más en depósito» (la de abajo, por defecto), «Menos en depósito», «Nombre A-Z» y «Para reponer primero»; «Más en depósito» ya ordena por la cantidad del depósito de mayor a menor con el desempate por nombre, así que no se tocó.

**Lo que hace** (corregido por el prompt `_an` del PREPARADOR, 1-oct 17:00 hora de Argentina: la primera versión mezclaba los «En stock» sin número con los «Sin stock»): la opción pasa a `stock-max` «Mayor stock primero». Cuatro grupos, con los dos campos que lee `sortPerfumes` (`_stockQty`, de `perfume_overrides.stock_qty`, y `_stockStatus`, de `stock_status`): (0) cantidad numérica mayor que 0, de mayor a menor; (1) estado `ok` o `low` con la cantidad vacía; (2) cantidad 0 o negativa, estado `out`, o ni cantidad ni estado; (3) pausados; si cantidad y estado se contradicen, manda la cantidad; en los cuatro, el empate por nombre (`localeCompare`, A-Z). Depósito: el DISEÑADOR y el PREPARADOR decidieron dejarlo igual. **Medido en la base (sólo lectura):** de los 263 perfumes del local (146 de `perfumes.js` sin sets + 117 de `perfumes_nuevos`) todos tienen fila de override: 184 con cantidad mayor que 0, **0** «En stock» sin número, 8 «Sin stock», 71 pausados (6 de ellos con cantidad), **0** contradictorios, 0 cantidades negativas y 0 sin cantidad ni estado. «YEAH PARFUM» y «YOUR TOUCH AMBER» son `pausado` con 0 y «YOUR TOUCH INTENSE» es `out` con 0: sólo se veían «En stock» en el fixture porque no tenía su fila. **Medido (fixture con fila para todos menos dos, 360 y 600, mismo resultado):** primeras filas 20, 15, 12, 9, 9, 8, 7, 7; los empates salen A-Z («ANTIQUE» antes de «ART OF NATURE I», los dos con 9; «9 PM», «9 PM ELIXIR» y «9AM Dive», los tres con 7); 133 con cantidad, 3 «En stock» o «Último» sin número, 7 en el grupo de «Sin stock» y 3 pausados; sin una fila fuera de grupo ni de A-Z. El corte: la última con cantidad es #133 «AMBER OUD DUBAI NIGTH (1 u.)»; «En stock» sin número #134-#136; la primera «Sin stock» es #137 «Amber Oud Gold Edition». Contradictorios: cantidad 6 con estado `out` → grupo 0 (#33), cantidad 0 con estado `ok` → #140 en «Sin stock». Los dos sin cantidad ni estado van a #142 y #143, **pero su etiqueta dice «En stock»** (el estado por defecto del panel). Con «Mostrar pausados» apagado no aparece ninguno; prendido, los 3 al final (#144-#146) de la A a la Z. El texto «Mayor stock primero» mide 156,1 px contra 165,9 de «Precio mayor a menor»: el select (213,6 px) no cambia de ancho, entra en una línea y no desborda a 360 ni a 600. `contraste`: 0 fallas. `sw.js` v1.1.161 → v1.1.162 (hay un deploy entre las dos: `espera-libre` sale el 2-oct y esta el 3-oct).

## Sesión 1-oct-2026 · `_an` — `[ESPERA-INVITADO]` A + B (rama `espera-invitado`, v1.1.163, sin mergear, sin SQL)

Del prompt `_as` del PREPARADOR (Alejo eligió A + B). La rama sale de `main` = `d3f3cd6`. **Medido antes de tocar (base real, sólo lectura):** `lista_espera_pendientes(p_telefono text)` devuelve `SETOF text` con el **`slug`** de cada pendiente del teléfono (no el nombre; **sí lo libre**, como `libre:…`), es `SECURITY DEFINER` (search_path `public`), `STABLE`, ejecutable por `anon` y `authenticated`, y compara `telefono = p_telefono` exacto con `p_telefono ~ '^[0-9]{8,15}$'`: **no normaliza**. Los 42 teléfonos de la espera y los 102 de `clientes` son canónicos (`549` + 10 dígitos). `cleanPhone` de la web da `5492974123456` para «297 412 3456», «2974123456», «+54 9 297 412 3456», «(0297) 412-3456», «297 15 412 3456» y «549 297 412 3456»; «297412345» (9 dígitos) y «29741234567» (11) no llegan a 13 y no se anotan. Duplicado: el único parcial `(slug, telefono) WHERE notified_at IS NULL` da 23505 y la web ya contestaba «¡Ya estás en la lista!». `le_insert_anon`: `WITH CHECK (origen = 'web')`; `anon` puede insertar todas las columnas (incluidas `nombre` y `libre`; `libre = true` lo frena el CHECK con 23514); `origen` tiene default `'web'` y `nombre` default `''` y admite null. Conteo: 42 filas, todas `origen = 'web'`, 0 libres, 0 locales, 10 pendientes (8 teléfonos) y 32 avisadas; las 42 tienen el teléfono de una cuenta existente; 0 filas libres comparten teléfono con una cuenta (no hay libres todavía). Prueba en transacción que se deshizo: anon sin nombre OK, con nombre OK, duplicado 23505, anon con origen `local` 42501. **B va sin SQL:** la función ya trae lo libre. **Hecho que importa:** como devuelve el `slug` de lo libre (`libre:` + el texto escrito sin signos ni mayúsculas), cualquiera que llame con un teléfono ajeno lee ese texto; el cartel de B no lo muestra (sólo «N pedidos especiales»), pero el RPC sí lo devuelve. SQL propuesto, **sin aplicar**: `create or replace function public.lista_espera_pendientes(p_telefono text) returns setof text language sql stable security definer set search_path to 'public' as $$ select case when libre then 'libre:' else slug end from public.lista_espera where p_telefono ~ '^[0-9]{8,15}$' and telefono = p_telefono and notified_at is null; $$;` (mismos permisos; la web funciona igual con o sin él).

**Qué se hizo** (`index.html`, `js/app.js`, `css/styles.css`, `sw.js` v1.1.163): ver NO ROMPER #25. En claro, el campo del teléfono (blanco sobre blanco, nunca se había visto porque la caja se escondía para el cliente) ahora tiene borde, texto `#1a1a1d` y prefijo `--amarillo-tinta`; el placeholder pasó de `#555` a `#8a8a8a` (4,83) en oscuro y `#756d60` (5,11) en claro. `scripts/contraste.js`: 14 mediciones nuevas; 0 fallas, 441. **Probado (fixture, 360):** el invitado anota con las tres formas del teléfono y siempre se guarda `5492974123456` (nombre vacío → `null`); número corto → «Revisá el número…» y 0 inserts; duplicado → «¡Ya estás en la lista!» con la card marcada; la card dice «✓ Te avisamos al +54 9 2974 12-3456» y queda marcada al recargar (consulta la RPC con ese número); con sesión la hoja no cambia (sin nombre ni «Ya tengo cuenta», «Avisame»); el cartel NO sale al retomar la sesión guardada, SÍ al entrar («Tenés 4 cosas en espera» con 2 nombres y «2 pedidos especiales») y se cierra con la ✕; las claves `libre:` no se guardan en el navegador.

## Sesión 1-oct-2026 · `_ao` — `[ESPERA-INVITADO]` 142m1 a 142m6 (rama `espera-invitado`, v1.1.163, sin mergear)

De los prompts `_at` y `_au` del PREPARADOR, con las decisiones del DISEÑADOR (`_aq` y su dibujo `espera-invitado-propuesta-360.png`), aprobadas tal cual. **Medido antes:** la línea de dígitos de la hoja (`previewWaitlistPhone`) **no es la misma función** que la de «Unite a ST» (131b, `previewPhone`, que sirve a `authPhonePreview` y a `editPhonePreview`): sólo comparten `cleanPhone` y `formatPhoneDisplay`; se cambió únicamente la de la hoja. Lo libre sólo se puede cargar desde el panel: `le_insert_anon` exige `origen = 'web'` y el CHECK de `lista_espera` pide `origen = 'local'` para `libre = true` (23514 para anon); la otra puerta es una sesión `authenticated` (`le_insert_auth`, `WITH CHECK true`: sólo las dos cuentas del panel, con el registro cerrado) y `service_role`; la web nunca manda `libre`.

**Qué cambia:** (142m1) bajada del invitado «Te escribimos por WhatsApp apenas vuelva. No hace falta crear una cuenta.» y botón «🔔 Avisame» en los dos modos, placeholder «Ej: 297 412 3456»; (142m2) la línea de debajo del teléfono: «Faltan N dígitos» en `--gris`, «✓ +54 9 2974 12-3456» en el verde de efectivo y, al tocar «Avisame» con el número mal, el error en `--tinta-error` 600 con el campo en 2 px y el foco de vuelta (se va el rojo de abajo de todo; con 1 dígito se dice «Falta 1 dígito», en singular); (142m3) la card del invitado en dos renglones («✓ TE AVISAMOS» y «al +54 9 …» a .72rem, 400, `nowrap`); (142m4) el cartel «Tenés N avisos pendientes» con los perfumes por nombre (más de 4: los 3 primeros y «y N más»), «Y N cosas que pediste en el local» en `--gris` y el pie «Te escribimos por WhatsApp apenas los tengamos.»; (142m5) lo libre sólo como cuenta; (142m6) el cartel con fondo opaco `#0a0a0a` en oscuro (en claro ya era `#f5efde`). `--tinta-error` se definió también en `styles.css`.

**Medido (fixture, 360):** «297 412» → «Faltan 4 dígitos» (gris `#5e564a` en claro); «297412345678» → «Sobran 2 dígitos»; «2974123456» → «✓ +54 9 2974 12-3456» (`#1b5e20`); al tocar «Avisame» con «297 412»: «Faltan 4 dígitos: son 10, con la característica y sin el 0 ni el 15.» en `#b8342a` 600, 0 inserts, el foco en el campo y el borde de 2 px (en los dos temas); el cartel con la RPC de 4 (2 del catálogo + 2 libres) dice «Tenés 4 avisos pendientes · ASAD · KHAMRAH · Y 2 cosas que pediste en el local»; con 6 perfumes, «ASAD · KHAMRAH · 9 AM · y 3 más»; sólo libres, «Tenés 2 avisos pendientes · 2 cosas que pediste en el local» (y con una, «Tenés 1 aviso pendiente · 1 cosa…»). `npm run contraste`: 0 fallas, 449 mediciones (la ayuda en sus tres estados, la cuenta de lo libre y el cartel). `sw.js` sigue en v1.1.163 (la rama no salió).

**Pendiente del SQL:** `lista_espera_pendientes` hoy devuelve el `slug` de lo libre (el texto escrito sin signos); el SQL aprobado (`libre:` a secas) va **antes** del merge. Estado de la función antes: `SECURITY DEFINER`, `STABLE`, `search_path = public`, `EXECUTE` para `anon`, `authenticated`, `postgres` y `service_role`; huella `23ad9d7a74cdecd389ff832c23ad0ecf`.

## Sesión 2-oct-2026 · `_aw` — tanda `chicos-panel` (rama `chicos-panel`, v1.1.164, sin mergear)

Del prompt `_aw` del PREPARADOR, sobre `main` = `d82054f`. Primer commit: sólo docs (`CLAUDE.md` al día: v1.1.163 en producción, los Pendientes de las cinco ramas de la noche del 1-oct pasan a § ✅ Resueltos, `[AUTH-ES-STAFF]` con lo medido de `le_insert_auth`). **Backup automático de las 00:11 del 2-oct (medido):** fila `auto` de `admin_backups` del 02/10 00:11:54, 310.891 bytes, **23 tablas** en `row_counts` (las mismas de NO ROMPER #23: `ajuste_horario`, `announcements`, `cierres_especiales`, `clientes`, `combos`, `decants_config`, `decants_custom`, `destacados`, `favoritos`, `home_slides`, `home_top_banner`, `lista_espera`, `mi_seleccion`, `opiniones`, `perfume_overrides`, `perfumes_nuevos`, `promos_decants`, `promos_decants_perfumes`, `seleccion_st_config`, `trust_badges`, `ventas`, `votacion_config`, `votos`) y `errors` vacío; el automático del 01/10 traía 15 tablas. Los automáticos salen ~00:11:5x ART.

**Qué cambia (todo en `admin.html`, más `sw.js` v1.1.164):** 138e la tarjeta de combo rota por clase (`.combo-card--rota`, borde de 2 px en `--tinta-error`; antes el borde iba inline y en claro lo pisaba `body.light .combo-card { border-color: #e3e0d5 !important }`: se veía beige, 2 px `rgb(227,224,213)`), el tachado `.combo-item-roto` y `.combo-item-eliminado`; 141d «+ Sumar» / «− Restar» como selector de dos por tokens (no elegido `--superficie` + `--borde` + la letra del rol 700; elegido borde de 2 px y el rol al 10 %, con el padding 1 px menos: los botones miden 33 px en los tres estados y el campo Cantidad no se mueve); 141e `#modalPuntos .admin-search-wrap { display: flex; width: 100% }` (la nota medía menos que los otros campos), etiqueta «Nota (opcional)» y el ejemplo «Ej: 1 · 2 · 0,5»; 142e el hueco entre el nombre y las etiquetas de combo, y entre ellas, es un ESPACIO (`.combo-sep`) y no un `margin-left`: la etiqueta que baja de renglón arranca en x = 0 (antes 4,8 px adentro) y los huecos en línea quedan iguales (nombre→MINI 10 px, MINI→ROTO 4,8); 142j lo mismo para el chip «Local» (`.espera-sep`): al bajar, x = 0 (antes 5,6); en línea, +0,4 px; 142k (`deriveStockInfo`): cantidad negativa → `.badge-out` con el número («-1 u.»), ni cantidad ni estado → «SIN DATO» en `.badge-out`; el `status` que devuelve no cambia, así que el orden de «Mayor stock primero» y las cuentas siguen igual. La web pública no se tocó (142l).

**141e, la coma (medido con teclas reales por CDP, sin escribir en la base):** `#modalPuntosCantidad` es `type="number" step="0.1" min="0"`, sin `inputmode`; `confirmPuntosModal` hace `parseFloat(el.value)`. Con el navegador en **es-AR**, tipear «0,5» deja `.value = "0.5"` (válido; el navegador convierte la coma) y se suma 0,5. **Con el navegador en en-US, tipear «0,5» deja `.value = "05"` → se suma 5** (la coma se descarta sin avisar). «0.5» anda en los dos. Se eligió «Ej: 1 · 2 · 0,5» porque el campo acepta coma en es-AR; **si alguna tablet del local está en otro idioma, «0,5» se convierte en 5**: la prueba en las tablets de verdad va al humo de Alejo. Endurecimiento propuesto, no hecho (queda fuera de esta tanda): `type="text" inputmode="decimal"` y `replace(',', '.')` antes del `parseFloat`.

**142k en la base real (sólo lectura, 2-oct):** 0 perfumes con cantidad negativa y 0 sin cantidad ni estado (los 263 tienen fila de `perfume_overrides`; `stock_qty` negativo: 0). Fixture con los dos casos + un `out` con 0 de control: «CANDID -1 u.», «YOUR TOUCH AMBER SIN DATO», «YOUR TOUCH INTENSE SIN DATO» y «Amber Oud Gold Edition Sin stock» (los cuatro `#b8342a` con letra blanca, 5,89).

`npm run contraste`: 0 fallas, 463 mediciones (filas nuevas: 138e tachado 5,89 / 8,27 y borde 5,32 / 8,67; 141d seis filas por tema, el peor 5,07; 142k `.badge-out` 5,89).

## Sesión 2-oct-2026 · `_ax` — tanda `puntos-coma` (rama `puntos-coma`, v1.1.165, sin mergear)

Del prompt `_ax` del PREPARADOR (con el OK a `chicos-panel` `184431b` y la decisión de endurecer la coma). La rama sale de `184431b` (punta de `chicos-panel`, que todavía no se mergeó: no hizo falta reconciliar `CLAUDE.md`). **141g:** `#modalPuntosCantidad` `type="text" inputmode="decimal"`; `parseCantidadPuntos` (recorta; una sola coma o punto; sólo dígitos; máximo un decimal; mayor que 0). **Tabla medida con teclas reales (CDP) en `--lang=es-AR` y `--lang=en-US`, idéntica en los dos:** «0,5» → queda «0,5», se suma 0,5 · «0.5» → 0,5 · «1» → 1 · «5» → 5 · «0» → inválido · «-1» → inválido · «0,55» → inválido (más de un decimal) · «1,5,2» → inválido · «abc» → inválido · vacío → inválido. «Confirmar» con «0,55» dice «Cantidad inválida» y hace 0 pedidos a `clientes`. **141f:** Sumar y Restar a 44 px (`min-height: var(--tap-min)`) en los tres estados, claro y oscuro (antes 33); Cantidad baja 8 px en pantalla (376,5 → 384,5). **142m7 no se hizo:** vive en `js/app.js` (`mostrarCartelEspera`, ~4676-4677), la web pública. `sw.js` v1.1.165.

## Sesión 2-oct-2026 · `_ay` — tanda `puntos-foco` (rama `puntos-foco`, v1.1.166, sin mergear)

Del prompt `_ay` del PREPARADOR (con el OK a `puntos-coma` `5c681cf`, la regla de **un decimal** decidida y 142m7 en Pendientes). La rama sale de `5c681cf`; los merges de `chicos-panel` y `puntos-coma` **no se hicieron** (falta el «mergeá» de Alejo), así que `main` sigue en `d82054f` y no hubo qué reconciliar. **141i:** el mensaje de Cantidad pasa a «Cantidad inválida: mayor que 0 y hasta un decimal (ej: 0,5).» (sale con `0,55`, `0`, `-1`, `abc` y vacío; 0 pedidos a `clientes`). **141h, medido (390, claro, foco real con `document.hasFocus()`, dos commits):** el borde con y sin foco es `rgb(207,202,188)` (`#cfcabc`) en `#searchPrecios`, `#modalPuntosCantidad`, `#modalPuntosNota` y `#modalPuntosMotivo`, en `184431b` (Cantidad `number`) y en `5c681cf` (Cantidad `text`): la regla que lo pinta, en los dos casos, es `body.light input[type="text"], … textarea, select { border-color: #cfcabc !important }`, que le gana a `.admin-search:focus` / `.modal-input:focus` (`var(--amarillo)`); en los dos commits el alto de Cantidad con foco es 44,4 px. **No se perdió con 141g: ya faltaba en todo el panel**, así que no se arregló en esta rama. **Campos así (115 de 133):** searchPrecios, sortPrecios, searchDeposito, sortDeposito, modalDepQty, editSearch, editTipo, editTipoOtro, editName, editMarca, editMarcaReal, editCat, editPerfil, editPrice, editPromo, editMl, editPrecioDecant, editDescuentoPct, editDescuentoHasta, editFoto, editFotosExtra, editAlias, editEtiqueta, editSalida, editCorazon, editBase, editSimilaresNota, editNotaJefe, editNotaSinStock, editNotaProximamente, nuevoTipo, nuevoTipoOtro, nuevoName, nuevoMarca, nuevoMarcaReal, nuevoCat, nuevoPerfil, nuevoPrice, nuevoPromo, nuevoMl, nuevoPrecioDecant, nuevoFoto, nuevoSalida, nuevoCorazon, nuevoBase, nuevoAlias, searchNuevos, seleccionBadgeInput, destacadoSearch, cierreFechaDesde, cierreFechaHasta, cierreMotivo, ajusteOpen, ajusteClose, ajusteCloseSab, ajusteDesde, ajusteHasta, ajusteMotivo, searchClientes, newClientName, newClientNota, puntoQuery, comboName, comboCat, comboTipo, comboPrice, comboPromo, comboFoto, votoM1 a votoM4, votoF1 a votoF4, pushTitle, pushBody, pushUrl, decPrecio1, decPrecio3, decPrecio5, decMl, decMax, decFrascoMax, decAviso, promoN, promoPrecio, promoMax, promoDesde, promoHasta, promoBuscar, marcaNueva, logBuscar, analyticsRange, cfgPuntosPerfume, cfgPuntosDecant, cfgPuntosCombo, cfgThreshold, cfgMensajePromo, puntosFilterCliente, esperaNombre, esperaBuscarPerfume, modalPuntosCantidad, modalPuntosMotivo, modalPuntosNota, modalPriceValue, modalPromoValue, modalStockQty, modalClientNombre, modalClientTel, modalClientPuntos, modalClientNota, modalClientCompro, modalDeleteConfirm. **Afuera:** `chkVerPausados`, `chkSoloConDeposito`, `modalDepNoSumar`, `editDecantExcluido`, `nuevoDecantExcluido`, `ajusteMostrarNota`, `newClientCompro`, `decActivo`, `promoActiva`, `modalStockPaused` (checkbox), `editSlug` y `nuevoEditId` (hidden), `editEtiquetaColor` (color), 3 `file` y los `tel` `newClientPhone` y `esperaTel`. `sw.js` v1.1.166.

## Sesión 2-oct-2026 · `_az` — tanda `foco-claro` (rama `foco-claro`, v1.1.167, sin mergear)

Del prompt `_az` del PREPARADOR (OK a `puntos-foco` `76c233c`; el foco va global, en una rama aparte, después de la cadena de merges, que **no se hizo**: falta el «mergeá» de Alejo; `main` sigue en `d82054f`). La rama sale de `76c233c`. **La regla** (`admin.html`, bajo la de reposo `#cfcabc`): ver NO ROMPER/Pendientes `[FOCO-CLARO]`. **Medido a 390 con foco real, en `76c233c` y en la rama, claro y oscuro:** 117 campos medibles (133 menos 16 checkbox/hidden/file/color); claro: 0 mostraban el foco antes, **116 ahora** (todos con `rgb(107,85,0)`), sólo `esperaTel` sin marcar; **0 cambian de alto**; oscuro: **0 diferencias** contra la base (114 marcan el foco, igual que antes; sin foco visible: `analyticsRange`, `puntosFilterCliente` y `esperaTel`). `newClientPhone` (tel): antes `rgb(214,209,195)` con y sin foco; ahora `rgb(107,85,0)`. `esperaTel`: el contenedor `.espera-tel` en claro `rgb(214,209,195)` con y sin foco (la regla `body.light .espera-tel` 0,2,1 le gana a `:focus-within` 0,2,0), en oscuro `rgb(232,184,0)`. Estados: `.dc-precio` vacío rojo `rgb(231,76,60)` con y sin foco, igual que en la base. `npm run contraste`: 0 fallas, 465 mediciones (una fila nueva por tema: el borde con foco, 6,48 en claro contra el peor de los cinco fondos; 8,95 en oscuro). `sw.js` v1.1.167.

**`_ba` (2-oct, 01:40 ART): 141h-b y 141h-c en la misma rama, `sw.js` v1.1.168.** 141h-b: `body.light .espera-tel:focus-within` (la caja marca el foco en claro). 141h-c: `body:not(.light) #analyticsRange:focus, … #puntosFilterCliente:focus { border-color: var(--amarillo) !important }`. Medido a 390 contra `146ed1e`: claro **117/117** y oscuro **117/117** (`esperaTel` por su caja), 0 cambios de alto o de grosor, 0 campos distintos fuera de la caja `.espera-tel` y los dos de 141h-c; `.dc-precio` vacío sigue rojo `rgb(231,76,60)` con foco en los dos temas. `contraste.js`: 0 fallas + 1 ⚠️, 465 mediciones (sin par nuevo: la caja es `#faf8f3`, ya en la lista). Dato: `analyticsRange` y `puntosFilterCliente` llevan `outline: auto` (anillo del navegador) con foco en los dos temas; los demás campos del panel, `outline: none`.

**`_bb` (2-oct, 02:00 ART): `outline: none` en esos dos, `sw.js` v1.1.169** (`#analyticsRange:focus, #puntosFilterCliente:focus`, los dos temas; decisión del DISEÑADOR y el PREPARADOR). Medido a 390 contra `310efe9`: `outline-style` `none` con foco en los dos campos y los dos temas (antes `auto`); borde con foco igual (oscuro `rgb(232,184,0)`, claro `rgb(107,85,0)`); claro 117/117 y oscuro 117/117; 0 cambios de alto o grosor; 0 campos distintos en borde, alto, grosor y sombra; `.dc-precio` vacío sigue rojo. `npm run contraste`: 0 + 1 ⚠️ · 465.

**`_bc` (2-oct, 02:10 ART): `puntos-enteros` (v1.1.170), encima de `foco-claro` `ca234a6`.** El humo de 1b (`puntos-coma` servida, `main` = `5c681cf`) falló: «Ajustar puntos» con `0,5` no guarda porque `clientes.puntos` es `integer`. Alejo decidió que los puntos son enteros (opción A): `parseCantidadPuntos` sólo dígitos > 0, `inputmode="numeric"`, ejemplo «Ej: 1 · 2 · 5», suma sin redondeo, `puntosTxt` en enteros y el mensaje «La cantidad tiene que ser un número entero mayor que 0 (ej: 5)». Medido a 390 contra `ca234a6`: los 10 casos igual en es-AR y en-US (teclas reales), `5` manda `{puntos: 17}` a un cliente de 12 (stub, nada escrito en la base), Cantidad 44,4 y el foco igual, 117/117 en los dos temas, 0 campos distintos, contraste 0 + 1 ⚠️ · 465. Pendientes nuevos: `[PUNTOS-ENTEROS]` (hecho en la rama) y `[PUNTOS-LOG]`.

**`_bd` (2-oct, 02:40 ART): 141i-b y `[PUNTOS-SIN-NEGATIVOS]` en `puntos-enteros` (v1.1.171).** El texto de Cantidad pasa a «Cantidad inválida: entero mayor que 0 (ej: 5).» (decisión del DISEÑADOR), el tope es 9 dígitos y no se puede restar más de lo que hay («Cantidad inválida: tiene N pts, no se pueden restar M.», sin escribir nada; restar justo lo que tiene vale). Medido a 390 contra `15fcfd4`: los 11 casos igual en es-AR y en-US con teclas reales; `5` manda `{puntos: 17}`; restar 13 y 20 de 12: mensaje y 0 pedidos; restar 12: `{puntos: 0}`; 133 campos sin diferencias, foco 117/117 en los dos temas; `contraste` 0 + 1 ⚠️ · 465.

**`_be` (2-oct, 02:52 ART): 141i-c en `puntos-enteros` (v1.1.172).** El aviso de restar de más pasa a «Cantidad inválida: se pueden restar hasta N.» (saldo mayor que 0) y «Cantidad inválida: no tiene puntos para restar.» (saldo 0 o menos), después de validar Cantidad; `#modalPuntosMsg { text-wrap: balance }`. Medido a 390 contra `08a53e8` con el proxy de `window.sb` (nada escrito en la base): 12/20 y 12/13 el aviso con 12, 12/12 `{puntos: 0}`, 0/5 «no tiene puntos», 0/`0,5` el de 141i-b, 0/sumar 5 guarda `{puntos: 5}`, 1250/2000 «hasta 1250»; todos en un renglón (19,2 px) en los dos temas, alto del modal igual (502,7); 133 campos sin diferencias, foco 117/117, `contraste` 0 + 1 ⚠️ · 465.

**`_bi` (2-oct, 04:30 ART): `busqueda-143` (v1.1.174), rama aparte desde `2f6b08a`.** `[FACILITAR-MOBILE-EN-CATALOGO]` paso 1 (el DISEÑADOR): **143a** `selectSuggestion` abre la ficha del perfume (`openBottomSheet`) después de bajar a la card como siempre (en el celu la hoja de abajo; en la compu, el panel lateral); **143b** Enter sin sugerencia elegida y con algo escrito baja a la primera card visible (mismo cálculo: el `scroll-margin-top` de la card, instantáneo, a los 500 ms como `selectSuggestion`); sin resultados o con el buscador vacío no se mueve. Helper nuevo `bajarACard(destino)` (el cálculo que estaba en `selectSuggestion`). Enter ahora aplica ya el filtro pendiente (`debouncedSearch` espera 120 ms: con Enter antes, las sugerencias se volvían a abrir). `js/app.js` y `sw.js`; nada en el panel ni en la base.

**`_bj` (2-oct, 05:10 ART): `busqueda-143` 143c y 143d.** **143c `[BUSQUEDA-SIN-RESULTADOS]`:** con 0 resultados y algo escrito, en el lugar de la grilla (que se oculta) y centrado: «No encontramos «<lo escrito>»» (17 px / 700, `--blanco`; lo escrito va con `textContent`) · «Probá con otra palabra: el nombre, la marca o una nota (vainilla, oud…).» (13 px, `--gris`) · «BORRAR LA BÚSQUEDA» (44 px, contorno de 1 px y letra en `--amarillo-tinta`, radio 8) que hace lo mismo que la ✕ del chip «Búsqueda» (`removeFilter('search')`: deja los otros filtros). `main` no tenía un «sin resultados» para el buscador (sólo `#favsEmpty`, de favoritos): es un bloque nuevo `#sinResultados` en `index.html` con su CSS (`.sin-resultados .sin-resultados-*`: en claro `body:not(.dark-mode) p` (0,1,2) pisaba el color de un `<p>` con una sola clase) y 3 filas en `contraste.js`. **143d `[FRAGANCIAS-SINGULAR]`:** «1 fragancia» (y «1 favorito»); 0 y 2 o más, en plural. Dato aparte: una búsqueda larga (66 caracteres) ensancha la página a 473 px a 390 de ancho porque el chip «Búsqueda» no se parte (ya pasaba en `main`).

## 🗄️ Archivo de “Última actualización” (movido desde `CLAUDE.md`, 30-sep-2026)

Los bloques «Contexto previo» que `CLAUDE.md` acumulaba debajo de su «Última actualización», del más nuevo al más viejo, sin cambios (los más viejos están anidados adentro de los más nuevos, como estaban). Son historial: el estado vigente está en `CLAUDE.md` § Pendientes y en las secciones de sesión de más arriba.

### Última actualización del 1-oct-2026 (`_ad`) — pasó de `CLAUDE.md` al archivo el 2-oct

**Última actualización:** **Octubre 1, 2026 (`_ad`)** — el prompt `_af` del PREPARADOR. **`backup-completo` (v1.1.159, `d21c46d`) sigue aprobada: va esta noche, desde las 21:00, como está** (el push lo corre Alejo). **`combos-ranking` (v1.1.160, `71ff959`)**: bien, pero todavía no va: falta que el DISEÑADOR vea las capturas (incluido el `nowrap`); medido a 360 en los dos temas con tres etiquetas (MINI + ROTO + «⏸ PAUSADO»): la tarjeta, el nombre, `.admin-main` y la página con `scrollWidth ≤ clientWidth`. Las «2 conocidas» de `contraste.js` eran las dos filas de REGALO (`#fff` sobre `#e74c3c`, 3,82, oscuro y claro, `[COMBO-REGALO-ROJO]`), agregadas en `005e901` y sacadas por `2b848f2` (138c). Nueva: la rama **`espera-libre`** (desde `71ff959`, **v1.1.161**, sin mergear): **`[ESPERA-LIBRE]`** (142 a 142d), con un **SQL sin aplicar** (columna `libre` + CHECK) que va en el reporte al PREPARADOR; NO ROMPER #24. `[VENTAS-SIN-POLITICA]` vuelve a 🟢 con su migración `ventas_select_staff` (a aplicar desde las 21:00). `npm run contraste`: 0 fallas + 1 token pisado, 427 mediciones. Detalle en `docs/HISTORIA.md` § «Sesión 1-oct-2026 · `_ad`». **Orden de trabajo:** el merge de `backup-completo` (21:00, push de Alejo) → la migración de `ventas` (21:00) → la revisión de `combos-ranking` (otra noche) → el SQL de `[ESPERA-LIBRE]` y la revisión de `espera-libre` → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 → `[FACILITAR-MOBILE-EN-CATALOGO]` y `[DISEÑOACORTADOR-PANELADMIN]`.

### Última actualización del 1-oct-2026 (`_ac`) — pasó de `CLAUDE.md` al archivo el mismo día

**Última actualización:** **Octubre 1, 2026 (`_ac`)** — el prompt `_ad` del PREPARADOR. **`tintas` mergeada** (v1.1.158 en producción, `main` = `32cb2c3`, push de Alejo; archivos servidos iguales, humo sin cuenta bien, rama borrada). **`backup-completo` (v1.1.159, `d21c46d`) aprobada por el PREPARADOR: el merge es desde las 21:00 del 1-oct** (el push lo corre Alejo: `git push origin d21c46d:refs/heads/main`; después archivos servidos, humo sin cuenta y borrar la rama). Mientras, la tanda chica **v1.1.160** en la rama **`combos-ranking`** (desde `d21c46d`), **sin mergear**, un commit por punto: **138c `[COMBO-REGALO-ROJO]`** (REGALO y ROTO a `--rojo-fondo`; ROTO a una clase), **138d `[COMBO-PAUSADO]`** (Pausar y Activar con letra `#1a1a1a` por clase, la tarjeta pausada sin `opacity`, «⏸ PAUSADO» como etiqueta; las etiquetas de combo no se parten), **141b `[RANKING-BUSCAR-ANCHO]`** y **141c `[PUNTOS-COMA]`** («8,5» en el ranking y en «Puntos actuales»). `npm run contraste`: 0 fallas + 1 token pisado, 419 mediciones (el mismo token pisado que en la 158: `.card-brand`; REGALO ya no es «conocida»). **Medido para el PREPARADOR:** `[VENTAS-SIN-POLITICA]` sube a 🟡 (ningún código escribe en `ventas`) y el esquema de `lista_espera` para `[ESPERA-LIBRE]` (en `docs/HISTORIA.md` § «Sesión 1-oct-2026 · `_ac`»). **Orden de trabajo:** el merge de `backup-completo` (21:00) → la revisión de `combos-ranking` y el OK de Alejo → la migración de `ventas` → `[ESPERA-LIBRE]` (cuando el PREPARADOR defina cómo se guarda) → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 → `[FACILITAR-MOBILE-EN-CATALOGO]` y `[DISEÑOACORTADOR-PANELADMIN]`.

### Última actualización del 1-oct-2026 (`_ab`) — pasó de `CLAUDE.md` al archivo el mismo día

**Última actualización:** **Octubre 1, 2026 (`_ab`)** — los prompts `_ab` y `_ac` del PREPARADOR. **`inicio` mergeada** (v1.1.157 en producción, `main` = `c1e7e66`, el push lo hizo Alejo en PowerShell porque el modo automático bloquea el push a `main`; archivos servidos iguales, humo sin cuenta bien, `no-pisar` e `inicio` borradas). **`tintas` mergeada** (v1.1.158 en producción, `main` = `32cb2c3`, push de Alejo; los 7 archivos servidos iguales, humo sin cuenta: 192 cards, 17 pedidos todos 200, 0 errores; `tintas` borrada). Mientras, la tanda **v1.1.159** en la rama **`backup-completo`** (desde `32cb2c3`), **sin mergear**, un commit por punto: **`[BACKUP-INCOMPLETO]`** (las dos listas iguales, 23 tablas; NO ROMPER #23), **136a** (los estados de la promo con su token: Apagada `--gris`, Programada `--tinta-aviso`, Prendida `--tinta-ok`, Terminó `--tinta-error`), **128q `[VALOR-SIN-PRECIOS]`** (sin los overrides, las cuatro cifras de la tarjeta de valor dicen «—»), **138b** (la etiqueta MINI de los combos a `#2170b0`), **141 `[TEL-SIN-CORTE]`** (el tramo final del teléfono no se parte). `npm run contraste`: 0 fallas + 1 token pisado + 2 conocidas, 411 mediciones. **Pendientes nuevos:** `[COMBO-REGALO-ROJO]` y `[VENTAS-SIN-POLITICA]` 🟢. Detalle en `docs/HISTORIA.md` § «Sesión 1-oct-2026 · `_ab`». **Orden de trabajo:** la revisión de `backup-completo` (PREPARADOR) y el OK de Alejo → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 → `[FACILITAR-MOBILE-EN-CATALOGO]` y `[DISEÑOACORTADOR-PANELADMIN]`.

### Última actualización del 30-sep-2026 (`_aa`) — pasó de `CLAUDE.md` al archivo el 1-oct

**Última actualización:** **Septiembre 30, 2026 (`_aa`)** — los prompts `_z` y `_aa` del PREPARADOR. **`inicio` (v1.1.157, `c1e7e66`, trae `no-pisar` adentro) mergeada a `main` en la madrugada del 1-oct** (fast-forward `92226c8..c1e7e66`; el push lo hizo Alejo en PowerShell porque el modo automático bloquea el push a `main` como «Production Deploy»). Verificado: los 7 archivos servidos (`index.html`, `admin.html`, `sw.js`, `js/app.js`, `js/extras.js`, `css/styles.css`, `perfumes.js`) son iguales a `c1e7e66`, `sw.js` dice v1.1.157; humo sin cuenta: 192 cards, sin sesión ni ventana, 17 pedidos a Supabase todos 200, 0 errores en la consola. `no-pisar` e `inicio` borradas en GitHub (la local `no-pisar` sigue viva en el worktree `serene-jennings-e9d305`). Mientras, la tanda **v1.1.158** en la rama **`tintas`** (desde `c1e7e66`), **sin mergear**, un commit por punto: **136 `[TINTA-MENSAJES]`** (las tres tintas: 141 `.style.color`, los mensajes en strings y en clases, `msgDestacados`, `avisoLectura`, 128n y 128b), **137 `[COMBO-FORM-CLARO]`**, **138 `[BTN-STOCK-AZUL]`**, **139** (sin la lectura de Beneficios, «Restaurar por defecto» escondido), **140 `[AVISO-DEL-TOQUE]`**, **128p `[TIP-SIN-BADGE]`**, los chicos (`[RANKING-TEL-CRUDO]` + la ✕ del buscador del ranking, `[INICIO-ESPERA-VIEJO]`, la línea de Precios & Stock con `SIN_LEER.overrides`) y `handoff.md` (la «Última actualización» anterior va al archivo). `npm run contraste`: 0 fallas + 1 token pisado, 399 mediciones. **Pendientes:** los de la `_z`, con `[COMBO-FORM-CLARO]` y `[MENSAJES-FIJOS-CLARO]` arreglados en la rama `tintas`; `[BACKUP-INCOMPLETO]` sube a 🟡 (ronda propia). Detalle en `docs/HISTORIA.md` § «Sesión 30-sep-2026 · `_aa`». **Orden de trabajo:** el merge de `inicio` (21:00) → la revisión de `tintas` (PREPARADOR) y el OK de Alejo → la ronda de `[BACKUP-INCOMPLETO]` → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 → `[FACILITAR-MOBILE-EN-CATALOGO]` y `[DISEÑOACORTADOR-PANELADMIN]`.

### Última actualización del 30-sep-2026 (`_z`) — pasó de `CLAUDE.md` al archivo el mismo día

**Última actualización:** **Septiembre 30, 2026 (`_z`)** — el prompt `_y` del PREPARADOR. **`no-pisar` (v1.1.156, `0f4c8b7`) aprobada por el PREPARADOR: el merge espera el «mergeá no-pisar» de Alejo (a las 21 o después).** Mientras, la tanda **v1.1.157** en la rama **`inicio`** (desde `0f4c8b7`), **sin mergear**, un commit por punto: **`[QUOTE-JEFE-SE-BORRA]`**, **128n `[PANEL-STOCK-CALLA]`** (la línea arriba de la tabla; el Estado en «—» sin toque, en Precios & Stock y en Depósito), «Cerrar sesión» con tilde, **134 `[MAZO-TAPADO]`** (el mazo no asoma con la barra pegada), **133a–g `[PANEL-INICIO]`** (el panel arranca en Inicio: 4 botones, «Ver todas las pestañas», «Inicio» en el encabezado, «Home» → «Banner»; NO ROMPER #21) y **135 `[BADGE-EMPLEADO-CLARO]`**; y el achique de `CLAUDE.md` (los «Contexto previo» a `docs/HISTORIA.md`, tal cual: 199.006 → ~62 KB). `npm run contraste`: 0 fallas + 1 token pisado, 369 mediciones (filas nuevas: Inicio, la badge y 128n). Detalle en `docs/HISTORIA.md` § «Sesión 30-sep-2026 · `_z`». **Orden de trabajo:** el «mergeá no-pisar» de Alejo → la revisión de `inicio` (PREPARADOR) y el OK de Alejo → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 → `[FACILITAR-MOBILE-EN-CATALOGO]` (el tema 3: cómo se elige el género en el celu) y `[DISEÑOACORTADOR-PANELADMIN]`. **Pendientes:** los mismos de la `_y` (§ Pendientes), con `[QUOTE-JEFE-SE-BORRA]`, `[PANEL-STOCK-CALLA]` y `[MAZO-TAPADO]` arreglados en la rama `inicio`.

### Última actualización del 29-sep-2026 (`_y`) — pasó de `CLAUDE.md` al archivo el 30-sep

**Última actualización:** **Septiembre 29, 2026 (`_y`)** — el prompt `_x` del PREPARADOR. **`carga-fallida` (v1.1.155) revisada y aprobada por el PREPARADOR** (con sus tres decisiones: «Volver al horario normal» escondido si la carga falló, el error en vez de la lista en Combos y la Espera, y los números de antes mientras recarga) y **mergeada a las 19:07 (ART) por orden de Alejo** («mergea ahora»: antes de las 21, que era lo pedido; el panel de las tablets muestra el banner de versión nueva y no se recarga solo): fast-forward `ac74be1..92226c8`; **v1.1.155 en producción** (los 7 archivos, iguales a `92226c8`; prueba de humo sin cuenta: 192 cards, 17 pedidos todos 200, 0 errores); `carga-fallida` borrada. Después, la tanda del prompt `_x` en la rama **`no-pisar`** (SW **v1.1.156**), **sin mergear**: **1.1 `[DESTACADOS-BORRA-SI-FALLA]`** (sin la lista de la base no se escribe; el borrado y el alta miran su error), **1.2 `[GUARDAR-SIN-LEER]`** (con la lectura fallida, el formulario queda con el error y «Guardar» no escribe: los 4 conocidos y 8 más del barrido; NO ROMPER #20), **1.3** «Acción», **1.4 `[HORARIO-ERROR-OSCURO]`** (7,29) y **1.5 `[SUGERENCIAS-BAJO-ORDENAR]`**. Barrido de 4 agentes (3 enfoques + cruce) y revisión adversarial de 10 (ultracode): 11 confirmados, 10 arreglados en la rama y 1 a Pendientes (`[DESTACADOS-RPC]`). Detalle en `docs/HISTORIA.md` § "Sesión 29-sep-2026 · `_y`". **Pendientes (mismo orden que § Pendientes, 58):** 🔴 (ninguno) · 🟠 `[DESTACADOS-BORRA-SI-FALLA]` (en la rama) · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[PANEL-STOCK-CALLA]` · `[MAZO-TAPADO]` · `[SUGERENCIAS-BAJO-ORDENAR]` (en la rama) · `[QUOTE-JEFE-SE-BORRA]` · `[COMBO-FORM-CLARO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[CARGA-FALLIDA-SEED]` · `[HORARIO-ERROR-OSCURO]` (en la rama) · `[DESTACADOS-RPC]` · `[BADGES-BORRA-SI-FALLA-EL-ALTA]` · `[DESCUENTO-HASTA-UTC]` · `[MENSAJES-FIJOS-CLARO]` · `[BACKUP-INCOMPLETO]` · `[EDITAR-NUEVO-SIN-AVISO]` · `[CAT-DOBLE-SE-PIERDE]` (decidido: quedan en «Unisex») · `[PUNTOS-CARRERA-TABLETS]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `no-pisar` (PREPARADOR) y el OK de Alejo con su línea (el merge, también fuera de 10-21) → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 (Clientes primero) → `[DISEÑOACORTADOR-PANELADMIN]` (Alejo eligió «menos pestañas a la vista» + una pantalla de inicio: Precios & Stock · Depósito · Log · Espera + «Ver todas», igual para el jefe y la empleada; lo dibuja el DISEÑADOR) y `[FACILITAR-MOBILE-EN-CATALOGO]` (sólo medido) → `[LAUTARO-MIMANODERECHA]`.

<details>
<summary>Contexto previo (29-sep-2026 · `_x`)</summary>

**Última actualización:** **Septiembre 29, 2026 (`_x`)** — **`pulido-clientes` mergeada** con el OK de Alejo y la revisión del PREPARADOR: fast-forward `91c7e37..ac74be1` a las **03:50 (ART) del 29-sep**; **v1.1.154 en producción** (los archivos servidos, iguales a `ac74be1`; prueba de humo sin cuenta: 192 cards, 17 pedidos todos 200, 0 errores); `pulido-clientes` borrada. Cierra `[PANEL-HOY-UTC]`. Después, la tanda del prompt `_w` en la rama **`carga-fallida`** (SW **v1.1.155**), **sin mergear**: **128m `[CARGA-FALLIDA-CERO]`** (los contadores que dependen de una carga dicen «— clientes», «— combos», «—/7», etc. mientras cargan y si la carga falla; «0» sólo con la carga buena: Clientes, Combos, la Espera, Nuevos, Destacados, Push, las tarjetas de Estadísticas, los totales de Precios & Stock y de Depósito, Analítica y el pie de Backups; donde la lista decía «vacío» va el error) y **1.2** (`loadAjuste` muestra su error en «Horario modificado», sin «Volver al horario normal»). Revisión adversarial de 19 agentes (ultracode): 5 arreglos en la rama y 5 pendientes nuevos. Y el arranque de los dos temas, sólo medido (`[DISEÑOACORTADOR-PANELADMIN]` en la tablet y `[FACILITAR-MOBILE-EN-CATALOGO]` en el celu), con fixtures de los volúmenes reales: reporte en `_correo_agentes` (`ClaudeCode_para_PREPARADOR_2026-09-29_x2.md`). Detalle en `docs/HISTORIA.md` § "Sesión 29-sep-2026 · `_x`". **Pendientes (mismo orden que § Pendientes, 48):** 🔴 (ninguno) · 🟠 `[DESTACADOS-BORRA-SI-FALLA]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[PANEL-STOCK-CALLA]` · `[MAZO-TAPADO]` · `[SUGERENCIAS-BAJO-ORDENAR]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[CARGA-FALLIDA-SEED]` · `[HORARIO-ERROR-OSCURO]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `carga-fallida` (PREPARADOR) y el OK de Alejo con su línea → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 (Clientes primero, pedido del DISEÑADOR) → `[DISEÑOACORTADOR-PANELADMIN]` y `[FACILITAR-MOBILE-EN-CATALOGO]` (arrancaron juntos el 29-sep, decisión de Alejo: relevados en `_x`, esperan las respuestas) → `[LAUTARO-MIMANODERECHA]`.

</details>

<details>
<summary>Contexto previo (29-sep-2026 · `_w`)</summary>

**Última actualización:** **Septiembre 29, 2026 (`_w`)** — **`pulido-textos` mergeada** con el OK de Alejo en el chat (antes de la revisión del PREPARADOR, que después la aprobó sobre `main`): fast-forward `8da11ab..91c7e37` a las **03:05 (ART) del 29-sep**; **v1.1.153 en producción** a los 25 s (los 5 archivos iguales a `91c7e37`; prueba de humo sin cuenta: 192 cards, 17 pedidos todos 200, 0 errores). Borradas `pulido-panel` y `pulido-textos`. **Reglas nuevas** (prompt `_v`): las capturas van también directo al DISEÑADOR (`ClaudeCode_para_Disenador_<fecha>_<letra>.md`) y el OK de un merge es la línea del PREPARADOR (§ Roles). Después, la tanda del prompt `_v` en la rama **`pulido-clientes`** (SW **v1.1.154**), **sin mergear**: 132d (la etiqueta «BLOQUEADO» sobre `--rojo-fondo`: 5,89 en los dos temas; antes 3,82), `[PANEL-HOY-UTC]` (el cierre de hoy y el ajuste que termina hoy, con la fecha de Argentina; `loadCierres` muestra su error) y la concordancia («No se pudieron cargar los clientes»). La revisión adversarial con agentes se frenó (la sesión estaba en el modo que pide permiso para cada acción) y la hizo Claude Code a mano: 0 hallazgos. Cerrados, en producción: `[CLIENTES-OSCURO-ROJO]`, `[CLIENTES-HOVER]` y `[HORARIO-BORRA-ANTES]`. Nuevo, 🟢: `[PANEL-HOY-UTC]` (ya en la rama). Detalle en `docs/HISTORIA.md` § "Sesión 29-sep-2026 · `_w`". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 (ninguno) · 🟠 (ninguno) · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[PANEL-HOY-UTC]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `pulido-clientes` (PREPARADOR) y el OK de Alejo con su línea → el par nuevo de `VAPID_*` → `[TAP-44]` tanda 2 (Clientes primero, pedido del DISEÑADOR) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (29-sep-2026 · `_v`)</summary>

**Última actualización:** **Septiembre 29, 2026 (`_v`)** — **`pulido-panel` mergeada** con el OK de Alejo y la revisión del PREPARADOR: fast-forward `4458f2f..8da11ab` a las **02:35 (ART) del 29-sep**; **v1.1.152 en producción** a los 20 s (los 5 archivos servidos, iguales a `8da11ab`; prueba de humo sin cuenta: 192 cards, sin sesión ni ventana, 17 pedidos a Supabase todos 200, 0 errores en la consola). `pulido-login` borrada (compu y GitHub). Después, la tanda del prompt `_u` en la rama **`pulido-textos`** (SW **v1.1.153**), **sin mergear**: 128k (una carga que falla dice «tocá ↺» o «recargá la página»; el ranking y el historial de puntos ahora ven su error), el registro sin llave con la **opción B** (el default: Alejo no eligió A; quedan el número y la contraseña), `[HORARIO-BORRA-ANTES]` (primero el nuevo, después los anteriores), y la tarjeta de Clientes en oscuro (`#ff8a80`) y con mouse (`@media (hover: hover)`). Revisión adversarial de 12 agentes (ultracode): 7 confirmados, 6 arreglados en la rama (uno era una regresión: con doble toque la tabla del horario podía quedar vacía) y 1 que es parte de la B. Cerrados, en producción: los 5 de `pulido-panel`. Nuevo, 🟢: `[HORARIO-BORRA-ANTES]` (ya en la rama). Detalle en `docs/HISTORIA.md` § "Sesión 29-sep-2026 · `_v`". **Pendientes (mismo orden que § Pendientes, 45):** 🔴 (ninguno) · 🟠 (ninguno) · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[CLIENTES-OSCURO-ROJO]` · `[CLIENTES-HOVER]` · `[HORARIO-BORRA-ANTES]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `pulido-textos` (PREPARADOR) y el OK de Alejo → el par nuevo de `VAPID_*` → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (29-sep-2026 · `_u`)</summary>

**Última actualización:** **Septiembre 29, 2026 (`_u`)** — **`pulido-login` mergeada** con el OK de Alejo y la revisión del PREPARADOR: fast-forward `5f17464..4458f2f` a las **23:21 (ART) del 28-sep**. **v1.1.151 en producción**: los 5 archivos servidos son iguales a `4458f2f`, y la prueba de humo sin cuenta dio bien (192 cards, sin sesión ni ventana, 17 pedidos a Supabase sin error, 0 mensajes en la consola). **El Bloque 3 ya estaba corrido** cuando se miró (28-sep, ~23:25 ART: una hora después de la v1.1.150, no 24 h) y se volvió a verificar el 29-sep a las 02:23: **S13 `[S13-ESCRITURAS-ANON]` cerrado** (SECURITY.md § S13). **La hora:** los docs de las rondas s y t tenían la hora en UTC (en Git Bash, `TZ=America/…` da UTC sin avisar); corregidos: el merge de `sesion-cliente` fue a las 22:22 del 28-sep, el Bloque 3 podía correr desde el 29-sep a las 22:22 y todo lo de s y t es del 28-sep. Después, la tanda del prompt `_t` en la rama **`pulido-panel`** (SW **v1.1.152**), **sin mergear**: 132 (la tarjeta de Clientes en claro; Editar sobre `#2170b0` en los dos temas), el teléfono de «Unite a ST» en claro, los bordes de `errorEnCriollo` (`errorPropio`, el 42501 al leer, `tocaGuardar` en 128h), los combos que miran lo que contesta la base (borrar con error o con 0 filas, crear sin pisar, «Guardar combo» sin doble toque) y la ventana de entrar vacía después de entrar, registrarse o salir. Revisión adversarial de 10 agentes (ultracode): 6 confirmados, 5 arreglados en la rama y 1 que queda como opción (el registro sin llave vacía los campos). Cerrados, en producción: los 7 de `pulido-login`. Nuevos, 🟢: `[CLIENTES-OSCURO-ROJO]` y `[CLIENTES-HOVER]`. Detalle en `docs/HISTORIA.md` § "Sesión 28→29-sep-2026 · `_u`". **Pendientes (mismo orden que § Pendientes, 49):** 🔴 (ninguno) · 🟠 (ninguno) · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[COMBO-PISA-COMBO]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[COMBO-BORRA-SIN-MIRAR]` · `[CRIOLLO-BORDES]` · `[LOGIN-CLARO-TELEFONO]` · `[LOGIN-CAMPOS-QUEDAN]` · `[CLIENTES-OSCURO-ROJO]` · `[CLIENTES-HOVER]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `pulido-panel` (PREPARADOR) y el OK de Alejo → el par nuevo de `VAPID_*` → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_t`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_t`)** — **`sesion-cliente` mergeada** con el OK de Alejo y la revisión del PREPARADOR: fast-forward `ebad698..5f17464` a las **22:22 (ART) del 28-sep**. Desde esa hora cuentan las 24 h para el Bloque 3. **v1.1.150 en producción**: los 5 archivos servidos son iguales a `5f17464`, y la prueba de humo sin cuenta dio bien (192 cards, 0 errores en la consola, 17 pedidos a Supabase sin errores). Después, la tanda chica del prompt `_s` en la rama **`pulido-login`** (SW **v1.1.151**), **sin mergear**: el registro con intentos y «Editar perfil» con los minutos (Bloque 2c ya corrido: cierra `[EDITAR-BLOQUEADO]`), 131 (la ventana de entrar en claro), 128j (los errores crudos que quedaban), buscar clientes por el teléfono como se ve, «Iniciá sesión» arriba del detalle, el aviso 130 que se va al abrir el login, sin `telefono2`, y el backup con `favoritos` y `mi_seleccion` (opción A, decisión de Alejo del 28-sep). `[FAVS-MARCA-BORDES]` se cierra como aceptado. Revisión adversarial de 8 agentes (ultracode): 5 arreglos y 4 pendientes nuevos, 🟢. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_t`". **Pendientes (mismo orden que § Pendientes, 55):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[COMBO-PISA-COMBO]` · `[ERRORES-CRUDOS-OTROS]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[LOGIN-CLARO-CONTRASTE]` · `[BACKUP-SIN-FAVORITOS]` · `[CLIENTES-BUSCA-TEL-FORMATO]` · `[TELEFONO2-MUERTO]` · `[AVISO-TAPA-LOGIN]` · `[AUTH-BAJO-DETALLE]` · `[COMBO-BORRA-SIN-MIRAR]` · `[CRIOLLO-BORDES]` · `[LOGIN-CLARO-TELEFONO]` · `[LOGIN-CAMPOS-QUEDAN]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `pulido-login` (PREPARADOR) y el OK de Alejo → el Bloque 3 (desde el 29-sep a las 22:22, hora de Argentina) → el par nuevo de `VAPID_*` → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_s`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_s`)** — el prompt `_r` del PREPARADOR sobre **`origin/sesion-cliente`**, sin bump (la **v1.1.150** nunca salió), **sin mergear**: toca el login de los clientes. El Bloque 2b ya estaba corrido (lo muestra `pg_proc`), así que se cierran **`[SESION-BLOQUEADO]`** y **`[EDITAR-SIN-LIMITE]`** (SECURITY.md § S28 y S29). **Catálogo** (`e3d760e`): la sesión vieja se cierra al cargar con un aviso chico («Actualizamos el sitio: volvé a entrar con tu número y contraseña. Tus favoritos siguen guardados.»: la caja de `.cart-toast`, `role="status"`, ~6 s o tocándolo, una vez por dispositivo), sin abrir «Iniciá sesión». La llave rechazada y el registro sin llave abren «Iniciá sesión» con su propio texto; el registro con `bloqueado` dice cuántos minutos esperar. Los favoritos del dispositivo tienen dueño (`st_favs_de`) y «Cerrar sesión» los borra (opción A, decisión de Alejo del 28-sep). «Editar perfil» dice «Demasiados intentos…» con `bloqueado`. Los botones de votar se habilitan al retomar la sesión. **Panel** (`8ae552f`): «Sumar punto» busca el número normalizado; 128i («probá de nuevo» fuera de las barras de «Guardar»); la tarjeta de cliente sin «Invalid Date» y con el teléfono como en el catálogo. Revisión adversarial de 8 agentes (ultracode): 3 arreglos en la rama y 6 pendientes nuevos, 🟢. Producción sigue en v1.1.149. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_s`". **Pendientes (mismo orden que § Pendientes, 57):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[FAVS-DISPOSITIVO-COMPARTIDO]` · `[VOTO-RETOMAR-APAGADO]` · `[PUNTOS-BUSCA-TEL-CRUDO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[COMBO-PISA-COMBO]` · `[ERRORES-CRUDOS-OTROS]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[REGISTRO-LLAVE]` · `[LOGIN-CLARO-CONTRASTE]` · `[BACKUP-SIN-FAVORITOS]` · `[CLIENTES-BUSCA-TEL-FORMATO]` · `[TELEFONO2-MUERTO]` · `[AVISO-TAPA-LOGIN]` · `[FAVS-MARCA-BORDES]` · `[AUTH-BAJO-DETALLE]` · `[EDITAR-BLOQUEADO]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `sesion-cliente` (PREPARADOR) y el OK de Alejo → el Bloque 3 (no antes de 24 h en producción) → el par nuevo de `VAPID_*` → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_r`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_r`)** — el prompt `_q` del PREPARADOR en la rama **`sesion-cliente`** (SW **v1.1.150**), **sin mergear**: toca el login de los clientes y el merge no está pre-aprobado. Alejo ya había corrido los Bloques 1 y 2 del PREPARADOR (se ven en `pg_proc`: las 7 RPC, `cliente_sesiones` y el trigger). **`[SESION-CLIENTE]`** (`443493b`): se entra con `cliente_entrar`, que da una llave (`token`) que se guarda en `st_cliente`; favoritos, votos y «Mi selección» van por RPC con la llave (`mis_favoritos`, `favorito_marcar`, `mis_votos`, `voto_guardar`, `seleccion_guardar`), y salir llama a `cliente_salir`. Al entrar se suben los favoritos locales que faltan (queda la unión). Una sesión guardada sin llave, o una llave que la base rechaza, cierra la sesión local y abre «Iniciá sesión» con «Por seguridad, volvé a entrar con tu número y contraseña. Tus favoritos no se pierden.», una vez; `st_favs` queda. **`[TEL-CANONICO-PANEL]`** (`a3a0b72`): el alta, el alta desde puntos y la edición de clientes guardan `549` + 10 (`cleanPhone` + `esperaTelValido`). Con fixture: 0 escrituras directas a `favoritos`, `votos` ni `mi_seleccion`, y las 5 RPC con la llave. Hay una revisión adversarial de 8 agentes (ultracode prendido en la sesión) y 5 arreglos que salieron de ella. `[S13-ESCRITURAS-ANON]` sigue con la keyword sola hasta el Bloque 3. Nuevos: `[EDITAR-SIN-LIMITE]` 🟠, `[FAVS-DISPOSITIVO-COMPARTIDO]`, `[VOTO-RETOMAR-APAGADO]` y `[PUNTOS-BUSCA-TEL-CRUDO]` 🟡, `[SESION-BLOQUEADO]`, `[REGISTRO-LLAVE]`, `[LOGIN-CLARO-CONTRASTE]` y `[BACKUP-SIN-FAVORITOS]` 🟢. Producción sigue en v1.1.149. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_r`". **Pendientes (mismo orden que § Pendientes, 53):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[EDITAR-SIN-LIMITE]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[FAVS-DISPOSITIVO-COMPARTIDO]` · `[VOTO-RETOMAR-APAGADO]` · `[PUNTOS-BUSCA-TEL-CRUDO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[COMBO-PISA-COMBO]` · `[ERRORES-CRUDOS-OTROS]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[SESION-BLOQUEADO]` · `[REGISTRO-LLAVE]` · `[LOGIN-CLARO-CONTRASTE]` · `[BACKUP-SIN-FAVORITOS]` · `[TAP-44]` tanda 2 **Orden de trabajo:** la revisión de `sesion-cliente` (PREPARADOR) y el OK de Alejo → el Bloque 3 (no antes de 24 h en producción) → el par nuevo de `VAPID_*` → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_q`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_q`)** — la tanda chica del prompt `_p` del PREPARADOR, SW **v1.1.149**, con el merge autorizado por Alejo si daban las verificaciones 1 a 5. **129d:** «Avisado dd/mm hh:mm» va en su `<span class="espera-avisado">` (`nowrap`), y a 360 y 390 queda en un renglón. En el Historial a 360, «🏪 Local» con un nombre de 20 letras pasa de 83 a **95** (la línea de abajo ocupa 4 renglones: la etiqueta baja sola); la web de 20 letras queda en 81. **128h `[ERRORES-CRUDOS-RESTO]`:** los 18 «'Error: ' + …» del panel pasan por `errorEnCriollo(err, ctx, que)`. Sin red, sesión vencida y sin permiso salen como en 128g. «Ya existe un cliente con ese teléfono.» sale donde la base tiene el único (alta, sumar punto y editar cliente). El resto dice «No se pudo <qué>. Probá de nuevo; si sigue, avisale a Alejo.». Cada texto sale donde salía (el de pausar un combo sigue siendo un `alert`) y el original va a la consola. Las cinco barras de 128g, iguales (25 / 25). **`[ESCAPE-DOBLE-FUNCION]`:** `escHtml` es la única implementación y `escapeHtml` la llama. Sobre 20 valores raros, `main` daba 4 diferencias (`0`, `null`, `undefined`, `false`) y ahora 0; las dos escapan también la comilla simple. Nuevos, 🟢: `[COMBO-PISA-COMBO]` y `[ERRORES-CRUDOS-OTROS]`. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_q`". **Pendientes (mismo orden que § Pendientes, 45):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[COMBO-PISA-COMBO]` · `[ERRORES-CRUDOS-OTROS]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2 **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_p`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_p`)** — el punto 3 del prompt `_m` del PREPARADOR (decisión A de Alejo): **los escapes del barrido de XSS**, SW **v1.1.148**. Se hizo en una rama local (`xss-staff`) que no se subió antes del merge; el PREPARADOR revisó el `diff.patch` y después dio el OK Alejo. **Panel** (`[XSS-PANEL-STAFF]`): 49 reemplazos en `admin.html` (54 `escHtml` nuevos), con `escHtml` en el contenido, `escHtml(JSON.stringify(x))` en los `onclick` y `Number()` en los números de `jsonb`. **Catálogo** (`[XSS-CATALOGO-STAFF]`, `[XSS-NOMBRE-CLIENTE]`): `escapeHTML` en cada lugar donde se pinta un dato. Hay dos helpers nuevos en `js/app.js`: `jsAttr(x)`, para los 32 valores dentro de un `onclick` (27 en `app.js`, 5 en `extras.js`), y `urlSegura(u)`, para que los links de datos (los badges, el anuncio) sean sólo `http(s)` o relativos. `highlightMatch` escapa antes de marcar. En `api/share.js` y `api/compare.js`, el JSON-LD lleva `<` → `\u003c`. **Verificado** con un fixture con HTML en cada lugar: en `main` se ejecutan 20 payloads en el panel y 14 en el catálogo; en la rama, 0 (a 1280 y 390). Con datos normales, 5 pantallas dan el mismo HTML que en `main` (catálogo, detalle, carrito, Depósito, Editar). Con la revisión del PREPARADOR entró un agregado chico: el slide muerto (`buildSlideHTML`) con `urlSegura` y `jsAttr`. Cerrados: `[XSS-PANEL-STAFF]`, `[XSS-CATALOGO-STAFF]`, `[XSS-NOMBRE-CLIENTE]` y **`[S10-TER-XSS-COMBOS]`** (SECURITY.md § S24, S25, S27 y S18). S18 se cruzó contra el inventario del PREPARADOR: los 50 lugares que marcaba sin escapar, 20 del panel y 30 del catálogo, están cubiertos; la prueba envenenada incluye un combo con el slug de un perfume. Nuevos, 🟢: `[COMBO-SLUG-COLISION]` (no es XSS), `[ERRORES-CRUDOS-RESTO]` y `[ESCAPE-DOBLE-FUNCION]`. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_p`". **Pendientes (mismo orden que § Pendientes, 45):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[TELEGRAM-HTML-ANON]` · `[COMBO-SLUG-COLISION]` · `[ERRORES-CRUDOS-RESTO]` · `[ESCAPE-DOBLE-FUNCION]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2 **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_o`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_o`)** — el punto 2 de los prompts `_m` / `_n` del PREPARADOR, SW **v1.1.147**. **La Espera:** vuelve el 129b (los botones con la letra de `.action-btn`), «🏪 Local» baja al final de la línea del teléfono (129c), la hora del Historial va en 24 h y el número no se parte (`.espera-tel-num`). A 360, ningún nombre de hasta 20 letras va en 3 renglones (Historial Local 83, Pendientes Local 61, Historial web 81). Cierra `[ESPERA-NOMBRE-3-RENGLONES]`. **`[MOTIVO-QUEDA]`:** el motivo de «No se guardó» se va al cambiar de perfume, al cancelar y al limpiar o editar un Nuevo. **128f:** a ≥ 1100, el 🗑️ de Decants de diseñador tiene el alto de «💾 Guardar» (49,6). **128g `[MOTIVO-EN-CRIOLLO]`:** `errorEnCriollo(err, ctx)` en las cinco barras. Traduce cinco casos: repetido, sin red, sesión vencida, sin permiso y otro. El mismo texto va en la barra y abajo, y el original a la consola; las validaciones quedan como estaban. Cerrados también `[RECARGAR-360]` (128e: se deja) y `[CLICKS-SLUG-CHECK]` (el SQL de Alejo). `[TELEGRAM-HTML-ANON]` baja a 🟢: lo cerrado, en SECURITY.md § S26. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_o`". **Pendientes (mismo orden que § Pendientes, 46):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · `[XSS-CATALOGO-STAFF]` · `[XSS-PANEL-STAFF]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[XSS-NOMBRE-CLIENTE]` · `[TELEGRAM-HTML-ANON]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2 **Orden de trabajo:** los escapes del barrido (`[XSS-PANEL-STAFF]`, `[XSS-CATALOGO-STAFF]`, `[XSS-NOMBRE-CLIENTE]` y `[S10-TER-XSS-COMBOS]`: punto 3 del `_m`, rama local, lo revisa el PREPARADOR) → el par nuevo de `VAPID_*` → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_n`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_n`)** — **`[XSS-URL-FILTROS]` cerrado** (pedido de Alejo: «arreglalo ya»), SW **v1.1.146**. Lo encontró el barrido de XSS (10 agentes, sólo lectura, con el OK de Alejo): en el catálogo, `?cat=` y `?q=` llegaban crudos al chip del filtro (`updateActiveFilters`), así que un link armado ejecutaba código en `stperfumeria.com`, el mismo dominio donde el panel guarda su sesión. Ahora `?cat=` tiene lista blanca (`all`, `favs`, `Unisex`, `Hombre`, `Mujer`, sin distinguir mayúsculas) y el chip se escapa. Con fixture, los usos de siempre dan igual que en `main`, y `?cat=hombre` ahora filtra (antes daba 0). El barrido dejó cuatro agujeros abiertos, con la keyword sola: `[XSS-CATALOGO-STAFF]` y `[XSS-PANEL-STAFF]` 🟠, `[TELEGRAM-HTML-ANON]` 🟡 y `[XSS-NOMBRE-CLIENTE]` 🟢 (propuestas de Claude Code; el detalle, en `_correo_agentes`). Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_n`" y `docs/SECURITY.md` § S23. **Pendientes (mismo orden que § Pendientes, 50):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · `[XSS-CATALOGO-STAFF]` · `[XSS-PANEL-STAFF]` · 🟡 `[VERCEL-ENV-VARS]` · `[TELEGRAM-HTML-ANON]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ESPERA-NOMBRE-3-RENGLONES]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[XSS-NOMBRE-CLIENTE]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[RECARGAR-360]` · `[MOTIVO-QUEDA]` · `[CLICKS-SLUG-CHECK]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2 **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → los agujeros del barrido y `[S10-TER-XSS-COMBOS]`, cuando Alejo los ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_m`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_m`)** — **`[XSS-ESTADISTICAS]` cerrado** (pedido de Alejo: «ponelo ahora»), SW **v1.1.145**: en «📊 Estadísticas», `loadStats` metía crudos en `innerHTML` el nombre del top 10 (o el `slug` de `perfume_clicks` cuando el perfume no está en el catálogo, y esa tabla la escribe `anon`) y los de «Perfumes sin visitas». Ahora van con `escHtml`, como en S20 / S21. Con fixture, en `main` un slug con HTML en el top 10 y los nombres con HTML se ejecutaban; en la rama se ven como texto, con 0 `<img>`. Nuevos: `[MOTIVO-QUEDA]` 🟢 (salió de la ronda m) y `[CLICKS-SLUG-CHECK]` 🟢 (un `CHECK` en la base como segunda defensa: las 241.141 filas ya cumplen el formato). Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_m`" y `docs/SECURITY.md` § S22. **Pendientes (mismo orden que § Pendientes, 46):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ESPERA-NOMBRE-3-RENGLONES]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[RECARGAR-360]` · `[MOTIVO-QUEDA]` · `[CLICKS-SLUG-CHECK]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2 **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_l`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_l`)** — la ronda m del PREPARADOR (prompt `_l`) sobre la rama `tanda-l` y, con la **decisión B de Alejo**, el merge de las rondas l y m: SW **v1.1.144** en producción. **128a:** la barra de la escalera dice «Guardar» (un renglón en los 4 anchos); «↺ RECARGAR» en mayúsculas no entraba a 360 ni a 390 y no va; a 360 «↺ Recargar» sigue en 2 renglones y la barra en 77,4, igual que antes → `[RECARGAR-360]`, y Alejo mergeó igual. **128b:** después de guardar, el botón dice «✓ Guardado» 2 s (salvo que la función haya cambiado su texto: Nuevo limpia y queda «Agregar perfume») o «No se guardó» 2 s, con el motivo en la barra (`.barra-error`, `role="alert"`, 2 renglones como mucho) hasta el próximo toque; cada `…Ahora` devuelve `{ ok }`, `{ ok: false, error }` o nada (canceló el «ST»). «Guardando…» a opacidad .7: 6,00 en oscuro y 5,44 en claro (con .3, 2,12 y 1,74). **`[DC-ELIMINAR-CORTADO]`:** el 🗑️ de «Decants de diseñador» mide 48 × 44 y no se sale en ningún ancho (antes, 266 px y +77,9 a 390). **B:** el 129b salió de la rama: los botones de la Espera, iguales a `main` (0 diferencias en el CSS de `#tab-espera`); vuelve con `[ESPERA-NOMBRE-3-RENGLONES]`. Cerrados: `[EDITAR-EMPLEADA-MUERTO]`, `[DC-HEADER-600]`, `[DC-ELIMINAR-CORTADO]`, `[GUARDAR-DOBLE-TOQUE]`, `[GUARDAR-AVISO-LEJOS]`. Nuevos: `[XSS-ESTADISTICAS]` 🟠 (agujero abierto, ya estaba en `main`: sólo la keyword) y `[RECARGAR-360]` 🟢. `npm run contraste`: 0 fallas + 1 token pisado, 295 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_l`". **Pendientes (mismo orden que § Pendientes, 45):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[XSS-ESTADISTICAS]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ESPERA-NOMBRE-3-RENGLONES]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[RECARGAR-360]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2 **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` y `[XSS-ESTADISTICAS]` cuando Alejo los ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (28-sep-2026 · `_k`)</summary>

**Última actualización:** **Septiembre 28, 2026 (`_k`)** — la ronda l del PREPARADOR (prompt `_k`: 123k, 123l, 129b, `[GUARDAR-DOBLE-TOQUE]`, `[DC-HEADER-CORTADO]` y `[EDITAR-EMPLEADA-MUERTO]` con la decisión A de Alejo) en la rama `tanda-l` (SW **v1.1.144**), **sin mergear**: el merge estaba autorizado si daban las verificaciones 1 a 5, y el punto 2 no dio. Con el 129b (la letra de los botones de la Espera a la de `.action-btn`), a 360 en el Historial un nombre de 20 letras con la etiqueta «🏪 Local» pasa a 3 renglones (en `main`, 2) → `[ESPERA-NOMBRE-3-RENGLONES]`, para el DISEÑADOR. Todo lo demás dio: la línea 💎 en un renglón (filas 58 / 72 / 86, antes 69 / 83 / 97), «sin precio», dos toques = una escritura en los 5 «Guardar» (y el botón vuelve a su texto en éxito, error y validación), el encabezado de Decants de diseñador sólo ≥ 1100, y la empleada sin «Editar» (`guia.html` ya no le dice que cambia precios). Nuevo, de antes: `[DC-ELIMINAR-CORTADO]`. Producción sigue en v1.1.143. Detalle en `docs/HISTORIA.md` § "Sesión 28-sep-2026 · `_k`". **Pendientes (mismo orden que § Pendientes, 48):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[EDITAR-EMPLEADA-MUERTO]` (en la rama) · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` (en la rama) · `[DC-ELIMINAR-CORTADO]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[GUARDAR-DOBLE-TOQUE]` (en la rama) · `[ESPERA-NOMBRE-3-RENGLONES]` · `[GUARDAR-AVISO-LEJOS]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** la rama `tanda-l` (punto 2 de la ronda l, con el DISEÑADOR) → el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_j`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_j`)** — la ronda k del PREPARADOR (prompt `_j`: **128 `[GUARDAR-ABAJO]`**, la barra fija de «Guardar», decisión del DISEÑADOR aprobada por Alejo), SW **v1.1.143**, merge pre-aprobado y autorizado por Alejo si daban las verificaciones 1 a 5. `.admin-main` pasa a `overflow-x: clip` (con `hidden` de respaldo) y `min-width: 0` en todos los anchos (NO ROMPER #19). La barra (`.barra-guardar`: sticky abajo, z 50, los botones de siempre movidos, 48 de alto) en Editar, Nuevo y Decants (escalera, promo y marcas; en Decants, sólo el jefe), y `html { scroll-padding-bottom: 88px }` para el teclado. Verificado con fixture: se pega en las 5 cajas y los 5 anchos; `.admin-main` mide lo mismo que en `main` en las 23 pestañas × 5 anchos, sin scroll horizontal; el menú (abierto y expandido) la tapa; la empleada no ve barras en Decants. Nuevos: `[EDITAR-EMPLEADA-MUERTO]` (de antes: el «Editar» de la empleada no abre nada), `[GUARDAR-DOBLE-TOQUE]`, `[GUARDAR-AVISO-LEJOS]`. `npm run contraste`: 0 fallas + 1 token pisado, 291 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_j`". **Pendientes (mismo orden que § Pendientes, 46):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[EDITAR-EMPLEADA-MUERTO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[GUARDAR-DOBLE-TOQUE]` · `[GUARDAR-AVISO-LEJOS]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_i`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_i`)** — `ronda-i` revisada por el PREPARADOR y aprobada con un arreglo de `cleanPhone` (ronda j, prompt `_i`, las dos copias, sin bump nuevo): el «15» se saca siempre que deje 13 (dos posiciones posibles sólo pueden ser la 2 y la 4 y dan lo mismo) y el 0 después del 54 / 549 se va. Mergeada con el OK de Alejo (fast-forward `0833be1..29b925b`): **v1.1.142 en producción**. En Node, 600.000 teléfonos armados con su número conocido: la vieja acierta 238.528, ahora 600.000. Datos reales, con la marca de Valentino Donna ya cargada: «💎 Diseñador» Frascos · 21 (11 con su 💎) y Sólo en decant · 2 (Born in Roma y Most Wanted EDP Intense). Cerrados: `[ESPERA-LOW-SIN-STOCK]`, `[ESPERA-AYUDA-AUTOMATICO]`, `[TEL-15-SIN-549]`. Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_h`". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_h`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_h`)** — `espera-mas` mergeada con el OK de Alejo (fast-forward a `0833be1`, **v1.1.141 en producción**: la Espera para las dos cuentas); antes, a pedido de Alejo, una revisión adversarial de 5 agentes confirmó 10 detalles chicos y se arreglaron en la ronda i. Ronda i del PREPARADOR (prompt `_h`), SW **v1.1.142**: revisada por el PREPARADOR, con el arreglo de la ronda j, y mergeada con el OK de Alejo. Precios & Stock: a ≤ 360 el nombre hasta 3 renglones (123i), la badge llena el alto de la celda (decisión 18), y en «💎 Diseñador» un renglón por perfume: el decant de diseñador que se llama igual que un frasco va en su fila («💎 decant 5 ml $22.500»), y los otros en «Sólo en decant» (123j). «Pedidos pass» pasa a «Reset contraseñas» (127). La Espera: `low` dice «EN STOCK» y un perfume que no está, nada; la ayuda ya no promete un aviso automático. **`cleanPhone` nueva en las dos copias** (`[TEL-15-SIN-549]`, NO ROMPER #18): canónico tal cual, el «15» viejo se saca si deja 13 (dos posiciones posibles dan siempre lo mismo) y el 0 después del 54 / 549 se va (ronda j). Datos reales: 10 decants se juntan en «💎 Diseñador» (11 en «Todo»: Valentino Donna tiene la marca vacía) y quedan solos Born in Roma y Most Wanted EDP Intense (más Valentino Donna en Diseñador). `npm run contraste`: 0 fallas + 1 token pisado, 285 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_h`". **Pendientes (mismo orden que § Pendientes, 46):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[ESPERA-LOW-SIN-STOCK]` · `[ESPERA-AYUDA-AUTOMATICO]` · `[TEL-15-SIN-549]` (los tres en la rama) · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** la revisión de `ronda-i` (PREPARADOR) y el OK de Alejo → el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_g`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_g`)** — la ronda h del PREPARADOR (prompt `_g`: **`[ESPERA-MAS]`**, decisiones 42, v3 y 124 del DISEÑADOR), SW **v1.1.141**, aprobada por el PREPARADOR y mergeada con el OK de Alejo (fast-forward a `0833be1`), en producción. El SQL de Alejo ya estaba corrido (columna `origen`, `le_insert_anon` sólo `web`, `le_delete_staff` para las dos cuentas, `trg_lista_espera_aviso` apagado). La pestaña **«📍 Espera» es de las dos cuentas**, con los colores por clase (se lee en claro), **«+ Anotar del mostrador»** (una fila por perfume, `origen: 'local'`, el nombre sale solo si el teléfono es de un cliente, el duplicado se dice junto al perfume), el filtro **Todo · Web · 🏪 Local**, Pendientes / Historial en el toggle del Log, los botones a 44, el teléfono como en el catálogo y las tarjetas contando siempre a los pendientes. **«Quitar»** mira lo que contesta la base (con RLS, un DELETE no permitido no da error: se pide la fila) y va al Log («📍 Quitar de la espera», sin teléfono). `cleanPhone` es copia exacta de la del catálogo: **NO ROMPER #18**. En el catálogo, «Te avisamos al …» a `.75rem` y el espacio de 🔔 / 🔒 (medía 0 px). `npm run contraste`: 0 fallas + 1 token pisado, 283 mediciones («Quitar» daba 3,86 en oscuro y 3,15 en claro). Nuevos: `[ESPERA-LOW-SIN-STOCK]`, `[ESPERA-AYUDA-AUTOMATICO]`, `[TEL-15-SIN-549]`. `precios-g` ya está en producción (v1.1.140, fast-forward `a919314..d92150a`, con el OK de Alejo: el sistema de permisos de la sesión había frenado el primer intento) y cierra `[XSS-NUEVOS]` (SECURITY.md § S21, `dc6d94e`). Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_g`". **Pendientes (mismo orden que § Pendientes, 47):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ESPERA-MAS]` (en la rama) · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[ESPERA-LOW-SIN-STOCK]` · `[ESPERA-AYUDA-AUTOMATICO]` · `[TEL-15-SIN-549]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el merge de `espera-mas` (con la revisión del PREPARADOR) → el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_f`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_f`)** — la ronda g del PREPARADOR (prompt `_f`: 123g, 123h y «fijo» del DISEÑADOR, y `[XSS-NUEVOS]`), SW **v1.1.140** (`4419352` + `28eb97a` + docs `d92150a`), revisada y aprobada por el PREPARADOR, mergeada con el OK de Alejo, en producción. En Precios & Stock la línea gris de los decants de diseñador dice «MARCA · 5 ml», la excepción «💧 $X fijo» entra en un renglón (fila de 58; antes 69) y, a ≤ 600, el nombre ocupa hasta 2 renglones antes del «…» (sólo en esa tabla: un `<span class="td-nombre">` con line-clamp; las demás siguen en uno). Filas con nombre largo: 58 (frasco) y 59 (decant). A 360, «BORN IN ROMA INTENSE» se ve «BORN IN ROMA…». Cierra `[XSS-NUEVOS]`: el nombre y la marca de la pestaña de perfumes nuevos iban sin escapar (SECURITY.md § S21). «💎 Diseñador» con los datos reales: **20 frascos**; el sexto «Victoria's Secret» de la base es un override sin perfume → `[NUEVO-BORRADO-HUERFANO]`. `npm run contraste`: 0 fallas + 1 token pisado, 233 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_f`". **Pendientes (mismo orden que § Pendientes, 44):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[NUEVO-BORRADO-HUERFANO]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_e`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_e`)** — la ronda `_e` del PREPARADOR (**`[PRECIOS-EN-UN-LUGAR]`**, decisión 123 del DISEÑADOR, a–f), SW **v1.1.139** (`dee6fef` + `433dcf1` + `f05dded` + docs `d4a5629`), revisado y aprobado por el PREPARADOR, en producción. Precios & Stock muestra también los precios de decants (sólo se miran): la tira con la escalera (y la promo si está vigente), «💧 decant $X fijo» y «sin promo n×» debajo del nombre (la regla es `promoEntraPanel`, espejo de `promoDecantEntra`: NO ROMPER #16), los decants de diseñador como filas con un DECANT de contorno, el filtro Todo · Frascos · 💎 Diseñador y el editor de marcas de diseñador en Decants (sólo el jefe). Cierra `[XSS-PRECIOS-STOCK]`: el nombre, la marca y el slug de la fila de Precios & Stock iban sin escapar (SECURITY.md § S20). Datos reales: 2 filas con precio de decant fijo, 13 decants de diseñador, 17 frascos en «💎 Diseñador» (los 3 «VICTORIA SECRET» sin S no entran con la lista actual). Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_e`". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_d`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_d`)** — la ronda `_d` del PREPARADOR (el Resumen: 126f, 126g, teléfonos, grilla; y las decisiones 125 / 125b), con el SQL v2 de `resumen_dia` ya corrido: SW **v1.1.138** (`fd7b4cd` + `fc5512e`), merge pre-aprobado. En el Resumen: la promo sacada dice «sin promo · vuelve a $Y» (con `precio_lista` de la v2), las flechas son ▲ ▼ del color del número, los teléfonos salen como en el catálogo (`formatPhoneDisplay`, sin `cleanPhone`) y una sección vacía no se estira. En el Log, «el automático no corrió» (sin número: cierra `[LOG-LABEL-26H]`); en Backups, «Automático: una vez por día, a la medianoche · Se guardan los últimos 12», de `BACKUPS_QUE_SE_GUARDAN` (= `MAX_BACKUPS_TO_KEEP`, NO ROMPER #17). Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_d`". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_c`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_c`)** — el `_c` del PREPARADOR (**`[RESUMEN-EN-EL-PANEL]`**, decisión 126 del DISEÑADOR), una rama y un bump: SW **v1.1.137** (`812ad56` + `11be3a9` + docs `7eee6d6`; revisado y aprobado por el PREPARADOR, mergeado fast-forward, en producción). Pestaña nueva «📌 Resumen», arriba de Log, para las dos cuentas: selector de día (‹ Hoy › ↺, 44×44, tope 60 días, › apagado en hoy), cinco tarjetas (stock, depósito, precios, clientes nuevos, puntos) y «📤 Mandar por WhatsApp», todo de una sola llamada a `resumen_dia()` (hoy se pide sin `p_dia`). En el Log, el bloque «Resumen de hoy» pasó a ser un renglón que lleva a la pestaña; `logCargarResumen` se fue y `resumen_stock_dia` quedó sin llamadas. Fixture: 20 capturas (600 y 390, claro y oscuro), la empleada ve lo mismo que el jefe, un nombre con HTML se escapa. Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026 · `_c`" y `docs/DATABASE.md` § `resumen_dia`. **Pendientes (mismo orden que § Pendientes, 44):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOG-LABEL-26H]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** la próxima ronda del Resumen (lo del DISEÑADOR + 3 detalles, un prompt y un SQL, ya anotada por el PREPARADOR) → el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · `_b`)</summary>

**Última actualización:** **Septiembre 27, 2026 (`_b`)** — el `_b` del PREPARADOR (**`[BACKUP-FALLBACK-ROTO]`**, camino A de Alejo), una rama y un bump: SW **v1.1.136** (`3c0c6c9` + `a0a595a`), merge pre-aprobado. `maybeAutoBackup()` guardaba `trigger 'fallback'`, que el CHECK de `admin_backups` rechaza: ahora `'auto'` (el Log lo sigue distinguiendo por `backup_create_fallback`), y el umbral pasa de 3 h a 26 h (el cron es diario). Con fixture: dispara sin backups y a 26 h 1 min; no a 25 h 59 min. Sin migración. Salió `[LOG-LABEL-26H]` 🟢 (la etiqueta del Log dice «3 h»); y, visto al pasar, el respaldo sólo puede guardar si entra el jefe (`jefe_insert_backups`). Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026". **Pendientes (mismo orden que § Pendientes, 44):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOG-LABEL-26H]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (27-sep-2026 · variables de Vercel, S1, backup)</summary>

**Última actualización:** **Septiembre 27, 2026** — Alejo repuso las variables de Vercel y salieron tres arreglos, todos en producción (`main` = `8eec233`, SW **v1.1.135**). **`[CRON-HEADER-FALSO]`** (`4b50d52`): `/api/cron/backup` aceptaba un header o un user-agent falsificable; ahora sólo `Authorization: Bearer <CRON_SECRET>`. **`[SECURITY-AUDIT-S1]` cerrado** (prompt `_a` del PREPARADOR, `49200b7` + bump `d7496fb` + docs `82f1f89`, revisado y aprobado por él): `admin.html` ya no tiene el secreto del push; `/api/send-notification` valida la sesión de Supabase contra `STAFF_EMAILS`. **`[CRON-TRIGGER-AUTO]`** (`8eec233`): el cron guardaba `trigger 'cron'` y el CHECK de `admin_backups` sólo acepta `manual` | `auto` → 400; ahora `'auto'`. **`[VERCEL-ENV-VARS]` a medias:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y `CRON_SECRET` cargadas (Production); el backup del cron **anda** (27-sep 02:04 UTC, fila `auto`, las 13 tablas); falta el push (par nuevo de `VAPID_*`) → baja a 🟡 (propuesta). Nuevo: `[BACKUP-FALLBACK-ROTO]` 🟡. El primer push a `main` lo frenó el sistema de permisos de la sesión (iba con un commit sin revisar); Alejo eligió mergear las dos. Detalle en `docs/HISTORIA.md` § "Sesión 27-sep-2026". **Pendientes (mismo orden que § Pendientes, 44):** 🔴 (ninguno) · 🟠 `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[VERCEL-ENV-VARS]` · `[BACKUP-FALLBACK-ROTO]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** el par nuevo de `VAPID_*` (prompt del PREPARADOR; Alejo carga la privada) → `[BACKUP-FALLBACK-ROTO]` (decisión) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (26-sep-2026 · `[VALOR-INV-DEPOSITO]` + `[VALOR-INV-PAUSADOS]`)</summary>

**Última actualización:** **Septiembre 26, 2026** — pedido urgente de Alejo, antes de lo planificado: **`[VALOR-INV-DEPOSITO]`**, una rama y un bump: SW **v1.1.133** (`f461ef3` + `f590ea8`), en producción; y, con las respuestas de Alejo, **`[VALOR-INV-PAUSADOS]`** (SW **v1.1.134**, `5b3ff47` + `44ee1d7`). Los sets quedan afuera (decisión de Alejo); el diseño de la tarjeta lo revisa con el DISEÑADOR más adelante → `[VALOR-INV-DISEÑO]` 🟢. El bloque para el PREPARADOR (las dos tandas en uno) lo manda Alejo después. La tarjeta 💰 de Precios & Stock (sólo el jefe, `[OCULTAR-VALOR-INV]`) muestra el **valor total** (local + depósito) y, debajo, cuánto es del local y cuánto del depósito, exacto; el total sigue compacto. A precio de lista (la promo si la hay: la cuenta que tenía para el local), sin sets; **los pausados cuentan** (decisión de Alejo: "todo perfume con al menos 1 unidad") y la última línea, «⏸️ Incluye pausados», dice cuánto del total es de ellos. Las otras tarjetas siguen sin contarlos. Si nombre y monto no entran en un renglón (de 901 a ~1000 px), el monto baja al de abajo. La pintan `renderPrecios` y `renderDeposito`; el realtime y el resync traen también `stock_deposito` (si no, un pase depósito→local hecho en otra tablet contaba esas unidades dos veces). Verificado con fixture (a mano, 5 cambios seguidos) y con los datos reales contra una cuenta hecha por fuera del panel: coinciden al peso. `npm run contraste`: 0 fallas + 1 token pisado, 225 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 26-sep-2026". **Pendientes (mismo orden que § Pendientes, 44):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[VALOR-INV-DISEÑO]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (24-sep-2026, N-bis · `_y`)</summary>

**Última actualización:** **Septiembre 24, 2026 (N-bis)** — el `_y` del PREPARADOR (**N-bis: cierra `[PROMO-ANCHO-360]`**, decisiones 117-120), una rama y un bump: SW **v1.1.132** (`92a7a7b` + `b628fe1`), en producción. La etiqueta de la card pierde el reloj: en las últimas 24 h dice «… · termina mañana» o «… · termina hoy» (117; sin mayúsculas, 118); con todas las variantes, el hueco con el corazón es **16,3 px o más a 360** (el peor, «10 decants por $90.000 · termina mañana», 221 px) y 46,3 a 390. El pie del armador: «Sumá 2 más con 3× y cada uno te sale $6.000», sólo si la promo baja el precio, y «Máximo de la promo: los que sumes van a precio normal» sólo al llegar al tope (119); cada línea, un renglón a 360. El interruptor del panel dice «Apagada» o «Prendida»; el WhatsApp con uno solo, «un pack de 1 decant». **La promo ya se puede prender**: se carga desde el panel (pestaña Decants); hoy `promos_decants` sigue sin filas. `[COMPARE-PISA-NOMBRE]` ya pasaba en v1.1.130 y no es una línea: queda 🟢. `npm run contraste`: 0 fallas + 1 token pisado, 219 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026 · `_y`". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMPARE-PISA-NOMBRE]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (24-sep-2026, parte N · `_w` + `_x`)</summary>

**Última actualización:** **Septiembre 24, 2026 (parte N)** — el `_w` del PREPARADOR (**parte N: `[PROMO-DECANTS]`, con la Sirenita**; decisiones 31 y 105-115 del DISEÑADOR) en la rama `promo-decants`, un commit por parte y un bump: SW **v1.1.131**. Toca plata: el merge esperó a que el PREPARADOR leyera el diff y corriera la cuenta en Node con los datos reales (`_x`); fast-forward `2a588ea..b94e0f9`. **N1** (`df1d671`): una sola regla (`promoDecantEntra`: en la lista del armador, con escalera y, salvo los cambiados a mano, frasco ≤ (precio_pack / n) × 20 → **162 de 171** con 3 × 18.000) y una sola cuenta (`precioPackDecants`) para la pantalla, el pie y el WhatsApp; los 8 casos exactos. **N2** (`35eaa38`): el armador (chip «3×», «Sumá 1 más con 3×» y el tope en el pie, «1 decant», el contador en 184, «Precio a consultar» 7,31 en claro, nombre y marca escapados). **N3** (`9ea992f`): la etiqueta de la card «🧪 3 decants por $18.000 · hasta el mar 29» / «… · termina en 5h 12min», máximo dos etiquetas, «Sin stock» tapa todas. **N4** (`8dca8be`): el panel (cuatro estados, aviso de costo, «entran solos», buscador, candados de la empleada también en la escalera, Log con 🧪). `npm run contraste`: 0 fallas + 1 token pisado, 217 mediciones. **La promo no se prende hasta cerrar `[PROMO-ANCHO-360]`**: hoy `promos_decants` tiene 0 filas y en el sitio no aparece (`curl` como `anon`: `[]`). Cerrados: `[PROMO-DECANTS]` (con `[SIRENITA]`), `[DECANT-TOPE-CONTADOR]` y `[DECANT-WA-TOTAL]`. NO ROMPER #16. Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026 · `_w` + `_x`". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[PROMO-ANCHO-360]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[NUEVO-EN-111]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → la N-bis (`[PROMO-ANCHO-360]` y el «1 decants» del WhatsApp, con las respuestas del DISEÑADOR) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (24-sep-2026, parte M · `_u` + `_v`)</summary>

**Última actualización:** **Septiembre 24, 2026 (parte M)** — el `_u` del PREPARADOR (**parte M**: decisiones 99-103 y `[OVERRIDE-ML]`) y el `_v` (**M6**, decisión de Alejo), en la misma rama y un bump: SW **v1.1.130** (`5f92573` + `b9fc4e8`), en producción. **`[PILDORA-ANILLO]`** (anillo blanco de 1,5 px en la flotante: en oscuro, contra el banner violeta, 6,30 / 9,39 / 11,86; el borde daba 1,07-1,51) · **`[QUITAR-ETIQUETA-CONTRASTE]`** («✕ QUITAR» `#ff8a80` sobre `#333`: 5,53) · **`[FINAL-COMPARANDO]`** (la reserva de abajo del celu pasa del body al **pie** —1.5rem + 140 + safe-area, +49 con «comparar»—: el © queda 31,5 px o más arriba de WhatsApp con y sin comparar, y abajo del pie no queda otro color) · **`[ESTADO-MINUSCULA]`** (minúscula después del «·»; en el hero no se nota porque va en mayúsculas) · **`[OVERRIDE-ML]`** (`applyOverrideToPerfume` aplica el ml del override, como el panel: 16 perfumes cambian de ml —15 visibles— y `cdn-precieux`, 55 ml, pasa a «a consultar»; un pack guardado lo pierde) · **`[DECANT-SOLO-PERFUMES]`** (lo que no es perfume no va en decants: `decantExcluido` mira `detectProductType`; el armador pasa de 182 a 177 perfumes, 171 en la escalera y 6 «a consultar»; el quick-pick usa el filtro de la lista, saca los «a consultar» y escapa el nombre). `npm run contraste`: 0 fallas + 1 token pisado, 195 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026 · `_u` + `_v`". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (24-sep-2026 · `_s` + `_t`)</summary>

**Última actualización:** **Septiembre 24, 2026 (después de la J)** — el `_s` del PREPARADOR (**parte K**: decisiones 94-96 del DISEÑADOR, «la letra la decide el fondo, no el tema», y `[RELOAD-CON-LOGIN]`) y el `_t` (**parte L**: decisiones 97 y 98 de Alejo), cada una en su rama con su bump, las dos en producción. **K** (SW **v1.1.128**, `cfa4717`): **`[BOTONES-CONTRASTE]`** (WhatsApp `#1a1a1a` 8,78 y gris `#fff` 7,46 en los dos temas) · **`[CINTA-TINTA]`** (la cinta de la card con letra `#fff` o `#000` según la luminancia del color —mínimo 5,44 con los 7 colores del panel—, sin sombra, el texto escapado y el color sólo si es hex o `rgb()` válido; los 7 botones de etiqueta del panel y la vista previa, con la misma regla) · **`[ESTADO-LOCAL]`** (hero en claro: abierto 7,87, feriado 7,18; la flotante opaca en los tres estados y los dos temas, blanca a `.7rem`, y en feriado «Feriado · abrimos <cuándo>») · **`[RELOAD-CON-LOGIN]`** (`.auth-overlay.open` + la ventana de juegos + «Avisame»). Al medirlo salió **`[RELOAD-NUNCA]`**: `.compare-modal` está en la lista y existe siempre, así que la recarga automática del sitio no se dispara nunca desde que existe. **Alejo decidió dejarla apagada (B):** con CSS/JS/fuentes en network-first desde `3cee019` (12-may), cada carga con red ya trae la versión nueva, y la versión nueva se detecta justo en esa carga: recargar no mostraría nada nuevo; cerrado sin código. **L** (SW **v1.1.129**, `f976a64`): **`[FINAL-FLOTANTES]`** (la reserva de abajo del celu pasa a 140 + safe-area: el © termina 32,3 px arriba de WhatsApp a 390 y 31,5 a 360) · **`[INVITACION-BAJO-BANNER]`** (las dos invitaciones en top 105, 8 px debajo del banner blanco y negro). `npm run contraste`: 0 fallas + 1 token pisado, 192 mediciones (las filas nuevas dan 17 fallas sobre el `main` anterior). Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026 · `_s` + `_t`". **Pendientes (mismo orden que § Pendientes, 45):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMBO-PROMO-NULL]` · `[FINAL-COMPARANDO]` · `[QUITAR-ETIQUETA-CONTRASTE]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **La barra en un iPhone:** Alejo la probó el 24-sep (vertical, horizontal, la app instalada y el teclado de Buscar): todo bien. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (24-sep-2026, noche · `_r`)</summary>

**Última actualización:** **Septiembre 24, 2026 (noche)** — el `_r` del PREPARADOR (**J: la barra de abajo del celu**, «Barra inferior del catálogo» v4 del DISEÑADOR, decisiones 61, 62, 68 y 86-93), una rama y un bump: SW **v1.1.127** (`bc40472`), en producción. **`[BARRA-CELU]`**: a < 768, cinco destinos (Catálogo · Buscar · Decants · Carrito · Cuenta) de 78 × 60 a 390; etiquetas 10,24 / 10,57, números 5,89, «CATÁLOGO» 66,7 de 78. La barra se esconde con el login, el menú y el armador; el carrito, los juegos y el detalle la tapan. `.cart-float`, `.decant-float`, `.scroll-top` y `.dark-float` no se muestran en el celu; comparar se apoya sobre la barra y WhatsApp y el estado suben 49; las invitaciones van arriba, de a una; con todo prendido, 0 flotantes pisados; el pie termina a 0,3 px de la barra. Buscar deja el foco en `#searchInput` en el mismo toque. Cuenta: el login, o la hoja «Hola, <nombre>» (se cierra tocando afuera y con «atrás»). `viewport-fit=cover` + safe-area abajo, en los costados y en el nav: **falta probarlo en un iPhone** (acá no hay WebKit). A 1280, idéntico a `main`. El doble `openDecantBuilder` es a propósito (el stub de `[JS-CHUNK]` y la real de `extras.js`). Oregon: el ref sale también de los 3 archivos de `RECOMENDACIONES_CLAUDECHAT/` (17 apariciones) y ya no queda en ningún archivo del repo. NO ROMPER #15. `npm run contraste`: 0 fallas + 1 token pisado, 148 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026 (noche)". **Pendientes (mismo orden que § Pendientes, 45):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[BOTONES-CONTRASTE]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMBO-PROMO-NULL]` · `[RELOAD-CON-LOGIN]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → la prueba de la barra en un iPhone (Alejo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (24-sep-2026, tarde · `_q`)</summary>

**Última actualización:** **Septiembre 24, 2026 (tarde)** — el `_q` del PREPARADOR (**parte I**: decisiones 79-85 del DISEÑADOR y dos del PREPARADOR; reemplazó al `_p`), una rama y un bump: SW **v1.1.126** (`2824efb`), en producción. **`[AMARILLO-CATALOGO-CLARO]`** (los 11 dorados que quedaban en `#E8B800` en claro, a la tinta: mínimo 4,80) · **`[HOTSALE-CLARO]`** (un solo naranja `#9a3412` en claro: card 6,64, detalle 5,81) · **`[CERRADO-HERO]`** (claro 5,89, oscuro 6,15) · **`[PEDIDOS-PASS-CLARO]`** (la caja y sus textos, 5,33 o más) · **`[SALTO-CARD-CENTRO]`** (`'start'` en el celu + re-apuntado al terminar: 5,7 debajo de la barra) · **`[ANILLO-1PX]`** · **`[EFECTIVO-UN-RENGLON]`** («$134.100 efectivo/transf.», un renglón a 390 y 360) · **`[HORARIO-DOS-FUENTES]`** (las dos píldoras salen de una sola cuenta: con reloj fijo en 7 casos dicen el mismo día y la misma hora; `main` se equivocaba en 4 → NO ROMPER #14). Oregon: el ref sale de las 9 líneas de docs. `npm run contraste`: 0 fallas y sin conocidas, 136 mediciones. Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026 (tarde)". **Pendientes (mismo orden que § Pendientes, 43):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2 · `[BOTONES-CONTRASTE]`. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (24-sep-2026 · `_n` + `_o`)</summary>

**Última actualización:** **Septiembre 24, 2026** — el `_n` del PREPARADOR (**la tanda de claro**, D → G, cada una en su rama con su bump y su merge) y el `_o` (**parte H**, una rama y un bump), todo en producción. **D** (SW **v1.1.121**, `569b73f`): `[AMARILLO-TINTA-CLARO]` — un solo dorado de texto para todo ST, `--amarillo-tinta` (claro `#6b5500`, decisión 66): los 85 textos del panel y los `#8a6d00` del catálogo, 4,97-7,18 en claro, oscuro idéntico — y `[ACTION-BTN-BASE]` (la base de `.log-chip`; los 10 sin estilo a 44). **E** (SW **v1.1.122**, `ad16ea5`): `[JERARQUIA-CARD]` + `[TAP-44]` del catálogo — sin «ST PERFUMERÍA», el texto de la card al 120 % en el celu, precio oscuro `#E8B800`, botones a 44, Hot Sale en claro por especificidad. **F** (SW **v1.1.123**, `0b250ff`): `[CLARO-CATALOGO-2]` — «Cerrado» flotante 5,89, `.cat-count` 11,62, «Ver catálogo» dorado en el celu. **G** (SW **v1.1.124**, `bd664b9`): `[PANEL-CLARO-CAJAS]` — ninguna caja del panel queda oscura en claro, el efectivo de Precios 7,87, la sombra del menú sólo abierto. **H** (SW **v1.1.125**, `022f26a`): `[FILTROS-SOLO-CATALOGO]` (ex `[FILTROS-STICKY-PIE]`: la barra se pega sólo en el catálogo, debajo quedan 97), `[CARD-ESCRITORIO-BANNER]` (115 / 243) y `[JUEGOS-VENTANA-PULIDO]` (52 de alto, puntos y «deslizá» legibles); `[INVENTARIO-ARCHIVOS]` cerrado el mismo día con la decisión de Alejo (`3d92262`: se borraron `mockup-zapato.html`, `mockup-catalogo-issues.html` y `convertir-webp.js` —con su script y `sharp`—, `mockups.html` dejó de servirse; la guía y las 251 fotos se quedan → `[GUIA-DESACTUALIZADA]`). `npm run contraste`: 0 fallas + 1 token pisado + 1 conocida (`[HOTSALE-DETALLE-CLARO]`), 104 mediciones. Oregon: recortadas las menciones de la organización (regla del 23-sep). Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026". **Pendientes (mismo orden que § Pendientes, 47):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[AMARILLO-CATALOGO-CLARO]` · `[PEDIDOS-PASS-CLARO]` · `[HOTSALE-DETALLE-CLARO]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[SALTO-CARD-CENTRO]` · `[CERRADO-HERO]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → lo que decida el DISEÑADOR con los números de hoy (`[AMARILLO-CATALOGO-CLARO]`, `[PEDIDOS-PASS-CLARO]`, `[HOTSALE-DETALLE-CLARO]`, `[CERRADO-HERO]`, `[SALTO-CARD-CENTRO]`) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (23-sep-2026, noche · `_l` + `_m`)</summary>

**Última actualización:** **Septiembre 23, 2026 (noche, `_l` + `_m`)** — tres tandas del PREPARADOR en orden, cada una con su rama, su bump y su merge, todas en producción. **A · chicos** (SW **v1.1.118**, `35774b5`): `[DECANTS-DEFAULTS]` (los precios de respaldo de la escalera de decants pasan a 9.500 / 9.000 / 8.500, los mismos que la base; con la base caída `main` mostraba 8.500 / 7.500 y un «Guardar» del panel los escribía), `[LOG-NOMBRE-CORTADO]` (el nombre del Log nunca se achica) y `[LOG-LABEL-FALLBACK]` (🛟 «Backup de respaldo · el automático no corrió en 3 h»). **B · `[VER-MAS]`** (SW **v1.1.119**, `984e940`): sin scroll infinito (decisión 67), los saltos frenan con el `scroll-margin-top` del destino (10 destinos × menú y URL × 390 y 1280 × dos temas: todos entre 5,5 y 8,2 px debajo de lo pegado; antes 248 o ~9.000 en el celu), un link con ancla se re-apunta mientras la página se asienta, `scrollToPerfume` muestra hasta la card (decisión 73) y `[SET-UNICO-CENTRADO]`. **C · `[JUEGOS-VENTANA]`** (SW **v1.1.120**, `cb65ebb`): «Jugar» abre una ventana desde abajo con el quiz y el Desafío (movidos, no copiados); `#quizSection` se fue como sección y quedó como ancla; «Ver el perfume» abre el detalle encima y al cerrarlo se ve la ventana con los mismos resultados (decisión 72). Cierra `[JUGAR-NO-LLEGA]`. Hallazgo: en el celu la barra de filtros es sticky hasta el pie → `[FILTROS-STICKY-PIE]`. S11 y la línea de Oregon recortados (regla de los agujeros abiertos). Detalle en `docs/HISTORIA.md` § "Sesión 23-sep-2026 (noche, `_l` + `_m`)". **Pendientes (mismo orden que § Pendientes, 48):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[FILTROS-STICKY-PIE]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[CARD-ESCRITORIO-BANNER]` · `[JUEGOS-VENTANA-PULIDO]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → la tanda de claro (prompt del PREPARADOR: el dorado nuevo `#6b5500`, decisión 66, en las dos apps) → lo que dibuje el DISEÑADOR con los números de estas tandas (`[FILTROS-STICKY-PIE]`, `[JUEGOS-VENTANA-PULIDO]`, la barra de abajo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (23-sep-2026, noche · `_j`)</summary>

**Última actualización:** **Septiembre 23, 2026 (noche, `_j`)** — tres tandas del PREPARADOR en orden, cada una en su rama, con su bump y su merge. **`[ESPERA-CLARO]`** (SW v1.1.115 → **v1.1.116**, en producción): la ventana «Avisame» se lee en claro — caja blanca y los textos de la decisión 53 (título 17,36 · perfume 4,92 · descripción y × 7,23), los mensajes pasan de color inline a una clase por estado; en oscuro, los colores computados idénticos a v1.1.115 en los 4 estados. **`[LOG-PULIDO-2]`** (SW **v1.1.117**, en producción): 💰 Precios filtra por lo que cambió (`logFamilias` devuelve un array: sobre los 2716 eventos reales de 60 días, Precios pasa de 0 a 43 y uno solo está en dos chips), el jefe tiene dos filas a cualquier ancho (una sola separación, 5,59 px) y las fotos se dicen con palabras (la fila de foto a 600 baja de 96,8 a 52,8 px). **Tanda C para el DISEÑADOR** (sólo lectura): la tabla C del catálogo (28 de 35 textos en `#8a6d00` por debajo de su mínimo; confirmados sus 3,41 y 4,28), los flotantes contra una barra de 60 px (5 tapados; al final de la página quedan 23,9 px libres) y **«Jugar» no llega al quiz** → `[JUGAR-NO-LLEGA]`. `contraste.js` con la ventana «Avisame» fue en una rama aparte (`contraste-espera-claro`) porque la pre-aprobación del merge era de 3 archivos; Alejo dio el OK y se mergeó (`3286e61`): 0 fallas, 62 mediciones. S1 y S4 con la keyword sola (S4 estrena `[S4-OREGON]`). Detalle en `docs/HISTORIA.md` § "Sesión 23-sep-2026 (noche, `_j`)". **Pendientes (mismo orden que § Pendientes, 47):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[JUGAR-NO-LLEGA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[LOG-NOMBRE-CORTADO]` · `[LOG-LABEL-FALLBACK]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → la tanda de claro (prompt del PREPARADOR: amarillos, botones, card, «Cerrado», cajas del panel) → lo que dibuje el DISEÑADOR con los números de la tanda C (la tabla C del catálogo, los flotantes contra la barra, `[JUGAR-NO-LLEGA]`) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (23-sep-2026, noche, cierre · [S8-STORAGE-ANON])</summary>

**Última actualización:** **Septiembre 23, 2026 (noche, cierre)** — **`[S8-STORAGE-ANON]` cerrado:** después del backup local, Alejo corrió el SQL del PREPARADOR y el bucket de fotos quedó para las dos cuentas del panel por email (3 políticas, ningún DELETE); `anon` ya no lista (`[]`) ni escribe, las fotos se siguen sirviendo por URL pública y la subida desde el panel anda. **`[SETS-CENTRADO-CORTADO]` arreglado** (SW v1.1.114 → **v1.1.115**, en producción): `.sets-grid` pasó de `center` a `flex-start` en mobile — a 390 px el primer set quedaba en −429 px y nadie lo veía; se descartó `safe center` porque en flex recién lo soporta Safari 17.6. A 1280, idéntico a antes. La regla de los agujeros abiertos se aplicó también a lo de mayo (S3 y S13 con la keyword sola). Detalle en `docs/HISTORIA.md` § "Sesión 23-sep-2026 (noche, cierre)". **Pendientes (mismo orden que § Pendientes, 44):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[LOG-PULIDO-2]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[LOG-PULIDO-2]` (prompt del PREPARADOR) → las decisiones de diseño que vengan del DISEÑADOR (verdes, Categorías, Backups en claro, la sombra) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (23-sep-2026, noche · repaso de Pendientes)</summary>

**Última actualización:** **Septiembre 23, 2026 (noche)** — repaso de Pendientes pedido por Alejo (*"hay cosas que no te dije que taches"*): sólo lectura, 21 agentes con un escéptico por cada "hecho", e inventario **por dueño** fuera del repo (`_correo_agentes\…\inventario\`). Salieron cuatro urgentes y tres se cerraron hoy: **`[SIGNUP-ABIERTO]`** (Alejo apagó el registro de Supabase Auth; `disable_signup: true`), **`[ROTAR-DB-PASS]`** (São Paulo rotada) y **`[RESET-SIN-TELEGRAM]`** (la regresión del Bloque 1 de la tarde: el reset volvió a avisar por Telegram). El cuarto, `[S8-STORAGE-ANON]`, ya tiene el **backup local de las 165 fotos** (8.689.933 bytes, sha256) y espera el SQL. Para el DISEÑADOR: **26 capturas** (catálogo 390 y panel 600, claro y oscuro) y la **tabla C** (85 `color: var(--amarillo)`, 52 de 57 renderizadas por debajo de 4,5). Reglas nuevas de Alejo: **flujos multi-agente sólo con su OK previo** y **agujeros abiertos con la keyword sola**. Tachados: `[CLIENTES-PRUEBA]`, `[JUEGOS-ST-WIREFRAME]`, `[BACKUP-FOTOS-LOCAL]`, `[ROTAR-DB-PASS]`. Hallazgo de las capturas: `[SETS-CENTRADO-CORTADO]` (el primer set queda fuera de pantalla en mobile). Las prioridades de los pendientes nuevos son propuesta: las ajustan el PREPARADOR y Alejo. Detalle en `docs/HISTORIA.md` § "Sesión 23-sep-2026 (noche)". **Pendientes (mismo orden que § Pendientes, 46):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · `[S8-STORAGE-ANON]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[LOG-PULIDO-2]` · `[SETS-CENTRADO-CORTADO]` · `[CLARO-CATALOGO-2]` · `[ESPERA-MAS]` · `[ACTION-BTN-BASE]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[COMBO-PROMO-NULL]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** seguridad que queda: `[S8-STORAGE-ANON]` (SQL del PREPARADOR) y `[VERCEL-ENV-VARS]` (Alejo) → `[LOG-PULIDO-2]` (prompt aparte) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (23-sep-2026, tarde · [ESPERA-SEGURA])</summary>

**Última actualización:** **Septiembre 23, 2026 (tarde)** — tanda de seguridad **`[ESPERA-SEGURA]` + `[XSS-PEDIDOS-PASS]` + `.vercelignore`** (prompts `_b` + `_c` del PREPARADOR · decisión 47 de Alejo: *"esto va primero y solo"*): 5 commits sobre `7a3f7b8`, SW v1.1.113 → **v1.1.114**, en producción y verificado. Salió del relevamiento de sólo lectura de `[S10-TER-XSS-COMBOS]`, que encontró dos cosas peores que Combos: **el dominio servía los documentos internos** (`/docs/SECURITY.md`, `/sql/*.sql`, `/memory/…`, `/.claude/commands/security-scan.md` con los valores de S1 → 200) — ahora `.vercelignore`, 404 en las 8 rutas y 200 en el sitio —, y un **XSS almacenado desde `anon` hacia el panel** en "Pedidos pass" (el teléfono del pedido se pintaba crudo y la RPC aceptaba cualquier texto) — escapado, y la RPC valida dígitos. **`[ESPERA-SEGURA]`**: el catálogo ya no lee `lista_espera` (`anon` leía las 43 filas con 27 teléfonos; ahora `GET` como `anon` → `[]`), inserta directo con un índice único parcial que responde 23505, y el "✓ Te avisamos" sale de la base (`lista_espera_pendientes`). El `_c` sumó: sin cliente no hay ✓, el teléfono es el de la cuenta y se muestra como texto, la carrera con la RPC en vuelo y el espacio del ✓. **S1:** las dos contraseñas se habían rotado el 19-sep (verificado por logs); se borró `ADMIN_PASS_EMPLEADO` y `security-scan.md` quedó sin valores. `[ESPERA-CAPTURAS]` hecho (6 PNG en `_correo_agentes`). **Pendientes nuevos:** `[S10-TER-XSS-COMBOS]` 🟠 · `[LOG-PULIDO-2]` 🟡 (reúne `[LOG-CAMBIO-LARGO]` y `[LOG-CHIP-PRECIOS]`) · `[COMBOS-PAUSADOS-VISIBLES]` 🟡 · `[COMBO-PROMO-NULL]` 🟢. Detalle en `docs/HISTORIA.md` § "Sesión 23-sep-2026 (tarde)" y `docs/SECURITY.md` § S1, S15-S18. **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[LOG-PULIDO-2]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[COMBO-PROMO-NULL]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** `[LOG-PULIDO-2]` (prompt aparte) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`; lo manual de seguridad es `[VERCEL-ENV-VARS]` (Alejo).

</details>

<details>
<summary>Contexto previo (23-sep-2026, mediodía · [LOG-PULIDO])</summary>

**Última actualización:** **Septiembre 23, 2026 (mediodía)** — tanda **`[LOG-PULIDO]`** (prompt `_w` del PREPARADOR, merge pre-aprobado): 3 commits sobre `eeb4b29`, SW v1.1.112 → **v1.1.113**, en producción y verificado con `curl`. Tres cosas del Log salidas del redibujo del DISEÑADOR sobre las capturas de v1.1.112: **`[LOG-POR-PERFUME-COL]`** (decisión 39: en "Por perfume" las filas ya no emiten el nombre — a 600 px cada una abría con un renglón que sólo tenía `〃`, 50,8-53,8 px — y ahora miden **44**; el cronológico queda idéntico a `main` fila por fila), **`[LOG-FILAS-NEUTRAS]`** (decisión 41: old en `--gris` tachado, new en el texto del tema — *"la fila es un hecho, no un juicio"*; el rojo y el verde quedan sólo en el resumen) y **`[LOG-PRECIO-PESOS]`** (`$` y punto de miles en todo precio del Log, incluido el `85,000.00` del seed; `price_update` sin `Precio:` repetido y con la promo sólo si cambió). `contraste.js` mide `.log-new` como heredado del body: 0 fallas, 44 mediciones. Revisión adversarial antes del merge (7 agentes): **0 confirmados**. **La sonda de chips** dice que a 600 px con Inter caen **⚙️ Sistema y 👑** (a Sistema le faltan 4,7 px). **Hallazgos, no tocados:** la fila de Foto se sale del ancho (`.log-cambio` de 1.254 px recortado por `main.admin-main`) → `[LOG-CAMBIO-LARGO]` 🟡; la chip 💰 Precios no muestra nada en producción (0 `price_update` en 60 días) → `[LOG-CHIP-PRECIOS]` 🟢; y un agujero preexistente en Combos → `[S10-TER-XSS-COMBOS]` (el detalle vive fuera del repo por la regla del 23-sep). Fixture y sonda del Log en `D:\workspace\_correo_agentes\ST_Perfumeria\fixture-log\`. Detalle en `docs/HISTORIA.md` § "Sesión 23-sep-2026 (mediodía)". **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[LOG-CAMBIO-LARGO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[LOG-CHIP-PRECIOS]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2. **Orden de trabajo:** lo que queda de seguridad es manual (S1 + env vars, lo hace Alejo) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (22-sep-2026, noche · [LOG-SISTEMA-CHIP])</summary>

**Última actualización:** **Septiembre 22, 2026 (noche)** — dos tandas chicas, las dos pre-aprobadas. **`[LOG-SISTEMA-CHIP]`** (SW v1.1.111 → **v1.1.112**, en producción): `login_success`, `logout` y los dos `backup_*` salen de "Catálogo" y van a una chip **`⚙️ Sistema`**, **última de la fila** — *"un filtro cuyo trabajo es sacar ruido no puede tener adentro 'login 09:02'"*, y si la fila envuelve a 600 px la que cae es la que menos se toca. Verificado con el fixture: 7 chips del jefe, `9+3+2+3+2 = 19 = Todo`, la empleada sin cambios. **La chip nueva destapó un bug de layout:** ⚙️ y 👑 pasaron de 44 a 46 px porque `.log-chips` es un flex sin `align-items` y el default `stretch` los estiraba al alto de su línea, que la marca el toggle `Cronológico|Por perfume` (46 = 44 + 1 px de borde arriba y abajo) — arreglado con `align-items: center`, y verificado contra el blob de `main` que 👑 **sí** medía 44 antes. **`scripts/medir_targets.js`** pasó a **probar los navegadores en orden** hasta que uno publique el endpoint de DevTools (Edge dejó de hacerlo en esta máquina: sale con código 0 y en silencio), con **un perfil temporal por candidato** — compartirlo hacía que Chrome rechazara el que dejó Edge — y mensajes que dicen cuál falló y por qué; sin bump, es sólo `scripts/`. **Y se limpiaron 3 GB** de perfiles temporales propios (28 carpetas + 128 procesos zombis) que habían dejado **`C:` en 14 GB libres**: volvió a 25 GB → pendiente nuevo **`[MEDIR-TEMP-SWEEP]`** 🟢. Las **4 capturas del Log** para el DISEÑADOR quedaron en `D:\workspace\_correo_agentes\ST_Perfumeria\capturas-log-v1.1.112\`. Detalle en `docs/HISTORIA.md` § "Sesión 22-sep-2026 (noche)". **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2 · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** lo que queda de seguridad es manual (S1 + env vars, lo hace Alejo) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (22-sep-2026, tarde · [LOG-EMPLEADA])</summary>

**Última actualización:** **Septiembre 22, 2026 (tarde)** — tanda **`[LOG-EMPLEADA]`** cerrada: 5 commits, SW v1.1.110 → **v1.1.111**, en producción y verificado con `curl`. **La pestaña Log dejó de ser sólo del jefe**: la empleada ve los movimientos de **stock y depósito de quien sea** (RLS alterada por Alejo antes del merge + filtro de cliente como defensa en profundidad). El feed es **cronológico estricto** con `〃` cuando se repite el perfume — el par depósito+stock queda pegado sin afirmar que hubo transferencia (decisión 35, corregida a pedido de Alejo: *"el único trabajo del Log es ser verdad"*) —, con vista **"Por perfume"** a un toque **sin volver a pedir datos**, buscador por nombre sobre los 60 días (`.in('target_slug', …)` sin filtro de fecha), chips por familia de acción y tag **👑 por `actor_email`**. El **resumen del día** sale de `resumen_stock_dia()`, la misma fórmula que el Telegram de las 23 h (delta = último `new` − primer `old` por perfume y día, sólo los que cambiaron), y si el rpc falla muestra `—` sin romper el feed. **Los instrumentos se ampliaron primero**: `medir_targets.js` con `--fixture` y un stub de Supabase con estado (`window.__sbCalls`: qué se pidió y cuántas veces), y `contraste.js` con 6 filas por tema para el Log — que encontró `.log-dia` en **1,86** sobre blanco y lo mandó a `var(--stat-tinta)`. Detalle en `docs/HISTORIA.md` § "Sesión 22-sep-2026 (tarde)". **Pendientes nuevos:** `[AMARILLO-TINTA-CLARO]` 🟡 (41 usos de `var(--amarillo)`, varios ilegibles en claro) · `[DEPOSITO-TRANSFERENCIA-EVENTO]` 🟢. **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[AMARILLO-TINTA-CLARO]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2 · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** lo que queda de seguridad es manual (S1 + env vars, lo hace Alejo) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (22-sep-2026, madrugada + mediodía · los tres roles)</summary>

**Última actualización:** **Septiembre 22, 2026** — sesión larga con el **esquema de tres roles** estrenado (DISEÑADOR / PREPARADOR / CLAUDE CODE · ver § Roles) y **un bloque por turno** como regla de ruteo: **26 commits**, SW v1.1.105 → **v1.1.110**, todo verificado en navegador. **Cerrados:** **`[BADGE-48]`** (la badge de stock llena la celda: 48 px de alto, fila 49, a 600 y 800 — antes 20,6), **`[BADGE-TEXTO]`** (texto de ok/mid/paused a negro y rojo de out a `#b8342a`: las 6 badges ≥ 4,5:1, con la **regla 19** escrita como comentario en el CSS), **`[TAP-44]` decisión 7** (`.modal-input` y `.admin-search` a `min-height: 44px` — por la métrica y por robustez cuando la fuente no llega), **`[FONTS-SELFHOST]`** (Inter + Playfair + Bodoni desde `/fonts/` en `index`, `admin` y `guia`: **4 woff2 variables** de Google y los **17 `@font-face` del subset latin replicados 1:1** con pesos fijos; Inter en `PRECACHE_URLS` y `Cache-Control: immutable` en `vercel.json`; verificado con el SW registrado y **la red cortada**: Inter carga sin red) y **`[TEMA-CLARO]` + `[ESCALA-8-A-6]`** (tokens de tema en las dos superficies — panel `body.light`, catálogo `body:not(.dark-mode)` —, **rojo partido** `--rojo-fondo`/`--rojo-tinta`, stat cards crema `#fffaf0` con las 4 tintas de 1,86/3,82/2,46/2,10 a 4,73/5,67/5,67/7,73, `--gris` a `#888` en el orden obligatorio ①②③ que mejora **154 elementos** de 3,89 a 4,91, y la columna Depósito con la escala compartida de badges **sin un solo color inline** — eso mata de raíz el bug de claro 2,17/1,53). **Instrumentos nuevos en `scripts/`:** `contraste.js` (mide el **valor efectivo** en cascada `!important` → especificidad → orden, dice qué regla lo impone, `npm run contraste`, sale 1 si algo baja de 4,5) y `medir_targets.js` (Edge headless por CDP, sin dependencias, **se niega a reportar** si Inter no cargó). **El hallazgo de la sesión:** el catálogo en claro **nunca estuvo roto** — los 1,51/2,78/3,95 eran la declaración base; lo que se ve desde mayo es 17,36/7,87/15,01, impuesto por las **56 reglas `!important`** de `193e3dd`, escritas porque una usuaria real no podía leer el sitio (→ `[LIGHT-MAYO-56]`). Detalle completo en `docs/HISTORIA.md` § "Sesión 21→22-sep-2026". **Pendientes nuevos:** `[LIGHT-MAYO-56]` 🟡 · `[JERARQUIA-CARD]` 🟢 · `[TAP-44]` tanda 2 🟢. **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[LIGHT-MAYO-56]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[JERARQUIA-CARD]` · `[TAP-44]` tanda 2 · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** lo que queda de seguridad es manual (S1 + env vars, lo hace Alejo) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (20-sep-2026, noche · cierre [CLICKS-RESUMEN])</summary>

**Última actualización:** **Septiembre 20, 2026 (noche)** — **`[CLICKS-RESUMEN]` RESUELTO** (rama `fix-clicks-resumen` → `main` fast-forward `6b44d80`, docs `7dbfaec`, SW **v1.1.104 → v1.1.105**, deploy verificado con `curl` contra producción): `loadPerfumeViews()` (catálogo público) y `loadStats()` (panel) dejan de leer `perfume_clicks` cruda (230.901 filas; su RLS de `SELECT` exige `authenticated` → el visitante anónimo leía 0 filas y "más visitados" caía al alfabético en silencio, sin avisar) y pasan a `sb.rpc('perfume_clicks_resumen')` (`SECURITY DEFINER`, agrupa por slug en Postgres — 264 filas en vez de 230k+ — con `EXECUTE` **a propósito** para `anon`: verificado en producción `anon=true`, `authenticated=true`, `public=false`). `admin.html` además deja de pagar un `count:'exact',head:true` aparte para "Visitas totales": suma el resumen (`SUM(clicks) = COUNT(*) = 230.901`, verificado idéntico). Documentado con estos valores reales en `docs/DATABASE.md` (subsección nueva) y `docs/SECURITY.md` (tabla "✅ Lo que SÍ está OK") — **sin** copiar el estilo de S14/L368, que describe un problema ya resuelto en presente (ver pendiente nuevo abajo). Verificado con un harness de Node sobre el código real extraído de los archivos (3 escenarios: datos/error/vacío, 21 asserts) en vez de instalar Playwright/Puppeteer (decisión de Alejo). Detalle en `docs/HISTORIA.md` § "Sesión 20-sep-2026 (más tarde) · `[CLICKS-RESUMEN]`". **De yapa, cierre de proceso retroactivo:** la tanda `[S10-BIS-XSS-ESPERA-OPINIONES]` + `[WA-LINK-549-DUPLICADO]` (resuelta más temprano hoy, ver `<details>` de abajo) nunca había tenido su commit `docs: cierre sesión` — queda cerrada formalmente ahora. **Pendiente nuevo:** `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` 🟢 — `docs/SECURITY.md` tiene descripciones del problema *original* en presente debajo de headers "✅ RESUELTO" (ej. S14 § `send_telegram`, L368) que pueden citarse por error como estado vigente; pasarlas a pasado. **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** lo que queda de la tanda de seguridad (S1 + env vars, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

</details>

<details>
<summary>Contexto previo (20-sep-2026, más tarde · cierre S10-bis + WA-LINK-549)</summary>

**Última actualización:** **Septiembre 20, 2026 (más tarde)** — **`[S10-BIS-XSS-ESPERA-OPINIONES]` RESUELTO** (rama `fix-s10-bis-xss-espera-opiniones` → `main` fast-forward, `033ab70` + `ce52def` + `aae744e`, SW **v1.1.104**, verificado en producción con `curl`): mismo stored XSS de S10 (Clientes), ahora cerrado también en **Lista de espera** (`renderListaEspera`: `group.name`, `item.telefono`, `item.nombre` vía `escapeHtml()`; el `href` de WhatsApp usa teléfono limpiado a solo dígitos en vez de `escapeHtml()`; el `onclick` de "Avisar a todos" pasaba el `slug` sin escapar dentro de un string JS — como `escapeHtml()` no escapa comillas simples, alcanzaba con un `'` para ejecutar JS arbitrario al pasar el mouse por un botón, sin click; fix real: `escapeHtml(JSON.stringify(slug))`, probado con 7 payloads) y **Opiniones** (`loadOpiniones`: `o.nombre`, `o.perfume_slug`, `o.texto` — el `title` que antes sólo escapaba comillas ahora usa `escapeHtml()` también, por consistencia). `escapeHtml(` pasa de 20 a 28 ocurrencias (25 líneas). De yapa, **`[WA-LINK-549-DUPLICADO]` RESUELTO** (commit aparte `ce52def`): `renderClientes` armaba el link de WhatsApp con `549` duplicado (el teléfono ya lo trae guardado) → número de 16 dígitos que no abría; ahora son 13. Detalle completo (los 3 pasos del análisis, los 9 diffs, las verificaciones con `node --check` y payloads) en `docs/HISTORIA.md` § "✅ Resueltos" (movidos 20-sep-2026, más tarde) y `docs/SECURITY.md` § S10. **Sin resolver de este tema:** `item.id`/`o.id` sin escapar en `onclick` se dejaron afuera a propósito (son `bigint`/`uuid` de la DB, no texto libre) — no es deuda pendiente, es la decisión tomada. **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** lo que queda de la tanda de seguridad (S1 + env vars, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

<details>
<summary>Contexto previo (20-sep-2026 · cierre S10 Clientes)</summary>

**Última actualización:** **Septiembre 20, 2026** — **S10 `[S10-XSS-CLIENTES]` RESUELTO** (`f457b89`, rama `fix-xss-admin-panel` → `main` fast-forward, SW **v1.1.103**): la pestaña Clientes escapa nombre/teléfonos/nota antes de `innerHTML`. Queda **`[S10-BIS-XSS-ESPERA-OPINIONES]`** 🟠: mismo patrón en Lista de espera y Opiniones. El 19-sep: **S14 `[TELEGRAM-ANON-ABIERTO]` RESUELTO y verificado**: los 5 avisos del sitio público los manda el servidor desde las RPC de S2 (+ trigger en `lista_espera`), `anon` sin EXECUTE sobre `send_telegram` **ni sobre `admin_actions_cleanup`** (que borraba filas y también estaba abierta) — POST anónimo → 401, los 5 avisos entregados con `200` en `pg_net`. `[SW-PRECACHE-PERFUMES]` en el mismo bump · SW v1.1.102. **Hallazgo:** el token de Telegram rotado el 17-sep estaba **mal pegado** (arrastraba la hora del mensaje de BotFather): ningún Telegram se entregó entre el 18-sep 21:05 y el 19-sep 04:02, incluido el resumen diario — corregido con un `DO` que valida el formato antes de tocar la función, y **rotado de nuevo** porque el valor apareció en una captura de pantalla. `pg_net` (`net._http_response`) es la única verificación real de entrega; el md5 no verifica un token. Detalle en `docs/HISTORIA.md` § "Sesión 19-sep-2026". **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S10-BIS-XSS-ESPERA-OPINIONES]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** lo que queda de la tanda de seguridad (S1 + env vars, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

<details>
<summary>Contexto previo (18-sep-2026 · cierre con /handoff v2)</summary>

**Última actualización:** **Septiembre 18, 2026** — cierre con el `/handoff` revisado (`c1fa9de`): § Pendientes **reconciliada** (sólo abiertos, ID = keyword entre corchetes, 8 resueltos movidos a `docs/HISTORIA.md` § "✅ Resueltos") y este pie sincronizado con el cuerpo. **Estado:** S2 `[BCRYPT-MIGRATION]` **resuelto y verificado** el 17-sep (login por RPC `SECURITY DEFINER`, bcrypt con migración perezosa, rate-limit server-side, `anon` sin ninguna policy sobre `clientes`) · `[RESET-TEXTOS]` arriba · **SW v1.1.101** · token de Telegram rotado · `SECURITY.md` sin valores de credenciales (regla § 📏) · orden de trabajo decidido por Alejo. Detalle en `docs/HISTORIA.md` § "Sesión 16→17-sep-2026" y "Sesión 18-sep-2026". **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · `[TELEGRAM-ANON-ABIERTO]` · 🟠 `[SECURITY-AUDIT-S1]`+S10 · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[SW-PRECACHE-PERFUMES]` · `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** tanda de seguridad chica → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

<details>
<summary>Contexto previo (12-ago-2026 · cierre `[FOTOS-OREGON]`)</summary>

**Última actualización:** **Agosto 12, 2026 (tarde/noche)** — sesión **`[FOTOS-OREGON]`**. Se fue a bajar el proyecto viejo de Oregon y se descubrió que **la migración de mayo había quedado a medias**: **97 filas en 5 tablas** apuntaban las fotos al servidor viejo (el navegador sólo mostraba 80 · **la BD es la fuente de verdad, el navegador el testigo**). Corregidas con respaldo + ensayo + bloque atómico, y verificado doble: **0 rastros en la BD** y **141 imágenes desde São Paulo, 0 rotas** en el sitio vivo. Oregon: ver `[S4-OREGON]` (detalle fuera del repo; la historia de git conserva la versión anterior de esta línea). **Hallazgos nuevos:** Vercel **no tiene ninguna variable de entorno** (backup propio + push rotos desde mayo · `[VERCEL-ENV-VARS]`), los backups diarios de Supabase **sí funcionan pero NO incluyen las fotos** (`[BACKUP-FOTOS-LOCAL]`), y **S11**: auth *fail-open* en `/api/send-notification`. **S2 medido:** 82 fichas y 78 contraseñas en texto plano descargables con la clave pública. También se arregló **`[WAITLIST-AVISO-REAL]`** (el aviso de "Avisame cuando vuelva" fallaba en silencio y encima reportaba éxito: marcaba a todos como avisados ANTES de mandar nada e intentaba abrir N ventanas de WhatsApp que el pop-up blocker frenaba · `0dc444f`) y quedó **diseñada** la ventana de privilegio `[AVISOS-PRIORIDAD]` (ver `docs/PLAN_AVISOS_PRIORIDAD.md`). Se arregló **`[DECANTS-ESPACIO]`** (un cliente real no pudo agregar decants: el marco fijo del armador se comía el 67% del modal y dejaba UNA card visible en celular · ahora 3-5 · ojo: mi primera hipótesis `min-height:0` era FALSA, ver `docs/FRONTEND.md` § Decant builder). Features nuevas **`[DEPOSITO]`** (pestaña con el stock del depósito, aparte del local · columna `perfume_overrides.stock_deposito` · ambos roles), **`[PAUSADO-OCULTO]`** (los pausados = ARCHIVADOS ya no salen en ningún lado público · 71 productos · el panel decía que los ocultaba y era mentira), **`[OCULTAR-PAUSADOS]`** (casilla "Mostrar pausados", ambos roles, preferencia por dispositivo) y **`[OCULTAR-VALOR-INV]`** (la empleada no ve el valor de inventario) · commit `c5678ae` · **SW v1.1.78 → v1.1.83**. Detalle exhaustivo en `docs/HISTORIA.md` § "Sesión 12-ago-2026 (tarde/noche)" + `docs/SECURITY.md`. **Pendientes (orden):** 🔴 `[BCRYPT-MIGRATION]`/S2 · 🔴 `[VERCEL-ENV-VARS]` (con S11 antes) · 🟡 `[BACKUP-FOTOS-LOCAL]` · 🟠 S1 re-scoped + S10 · 🟡 rotar token TG y DB pass · 🟢 CLS iter 5, SW-BANNER-SMART, logo @2x, `?width=400`, JS-CHUNK iter 2.

<details>
<summary>Contexto previo (cierre 27-jun parte 2 · doc cerrada el 12-ago)</summary>

**Agosto 12, 2026** — cierre de la sesión 27-jun parte 2 (el trabajo técnico es del 27-jun · la doc se cerró el 12-ago tras 6,5 semanas sin actividad · `origin/main` quedó clavado en `196586e` y el sitio corrió estable todo ese tiempo). **`[FORGOT-PASS-A]` CERRADO y verificado E2E en producción** (cliente pide → admin resetea → cliente re-loguea con clave nueva · puntos intactos · 3 Telegrams confirmados). Se arregló **`[FORGOT-PASS-WA]`** (el `window.open` de "Avisar por WhatsApp" corría tras `await`+`setTimeout` → sin *user activation* → bloqueado por el pop-up blocker · ahora es link tappable · `3e52dbd`) y se sumó el nombre del cliente en "Pedidos pass" (`eefdfe9`). SW v1.1.75 → **v1.1.78**. En seguridad (`196586e`): **S1 re-scopeado** (el login admin ya NO usa las passwords hardcoded), **S2 agravado** (RLS abierta + anon key pública = passwords en plano por REST) y **S10 nuevo** (stored XSS en la tab Clientes). Detalle en `docs/HISTORIA.md` § "Sesión 27-jun-2026 · parte 2" + `docs/SECURITY.md`. **Pendientes (orden):** 💸 bajar Oregon (~USD 60-75 de más) · 🔴 `[BCRYPT-MIGRATION]`/S2 · 🟠 S1 re-scoped + S10 · 🟡 rotar token TG y DB pass · 🟢 CLS iter 5, SW-BANNER-SMART, logo @2x, `?width=400`, JS-CHUNK iter 2.

<details>
<summary>Contexto histórico previo (27-jun mañana)</summary>

Sesión larga con 2 features grandes ANDANDO: **`[TG-RESUMEN-DIARIO]`** (resumen diario de Telegram al cierre 23:00 ART · función SQL `daily_summary` + `pg_cron` + 6 notifs instantáneas silenciadas · commit `1ded56a`) que reemplaza el bombardeo de 16-114 Telegrams/día, y **`[FORGOT-PASS-A]`** (recuperación de contraseña de clientes COMPLETA · tabla `password_reset_requests` + botón "¿Olvidaste tu contraseña?" en login + tab admin "Pedidos pass" · commit `db9d485` · reusa el flujo "primer login setea pass", NO toca el login existente). También: badge violeta admin `[BADGE-LAST-VIOLETA]` (`42b5dce`), 3 slash commands implementados (`.claude/commands/`), CodeGraph MCP instalado, QA post Plan B OK. SW v1.1.71 → **v1.1.75**. **Telegram CONFIRMADO funcionando** (el `[FIX-TELEGRAM-PG-NET]` del 21-may era falsa alarma · obsoleto · el worker de pg_net tardó en arrancar y las queries vía psql se colgaban, pero vía MCP responden bien). **El MCP de Supabase es ahora la vía principal para SQL/infra** (psql/pg_dump desaparecieron del sistema · `C:\Program Files\PostgreSQL\18\` vacío). 🚨 **Issues de seguridad SIGUEN pendientes** (de la sesión 21-may): passwords admin **HARDCODED en `admin.html` L2766-2767** · agendado **`[SECURITY-AUDIT-S1]`** (CRÍTICO). Detalle exhaustivo en `docs/HISTORIA.md` § "Sesión 27-jun-2026" + `docs/BACKEND.md` + `docs/DATABASE.md`. **Pendientes:** ⚠️ **`[SECURITY-AUDIT-S1]`** (CRÍTICO) · `[BCRYPT-MIGRATION]` (más relevante con FORGOT-PASS activo) · **bajar proyecto viejo Oregon** (pagando 2 Pro desde 28-may) · `git pull` en main repo desincronizado · **testear FORGOT-PASS-A** con cuenta de prueba · CLS Desktop iter 5 · `[SW-BANNER-SMART]` · logo @2x · imágenes con `?width=400` · JS-CHUNK iter 2 · SUPABASE-AUTH.

</details>

</details>

</details>

</details>

</details>

</details>
