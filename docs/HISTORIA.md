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
  --username=postgres.rtgjzzkjrwbkdhkslxix --dbname=postgres \
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

Verificación reveló 0 Edge Functions en el proyecto viejo (`https://supabase.com/dashboard/project/rtgjzzkjrwbkdhkslxix/functions` mostraba "DEPLOY YOUR FIRST EDGE FUNCTION").

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
- 0 referencias al ref viejo (`rtgjzzkjrwbkdhkslxix`) en HTML público
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

- 💸 **Bajar el proyecto Supabase viejo de Oregon (`rtgjzzkjrwbkdhkslxix`)** · el rollback window venció el **28-may**. Si sigue activo, son **~2,5 meses de facturación doble** (2 proyectos Pro ≈ **USD 60-75 de más**). Es lo más caro de la lista y lo más barato de resolver (pausar es reversible y no toca código). ⚠️ **Verificar primero que siga activo** — en el cierre del 12-ago el MCP de Supabase estaba desconectado y no se pudo confirmar.
- 🔴 Los issues de seguridad llevan **~3 meses** abiertos desde que se detectaron el 21-may.

#### 💬 Mensajes meta

- Alejo cerró preguntando *"¿me prometés que si me avisan que algo falla lo resolvemos juntos?"*. La respuesta honesta funcionó mejor que una promesa vacía: **no** prometer que nada se rompe, sí acotar el radio de impacto real (se tocó una sola tab · login/catálogo/ventas intactos), recordar que **el rollback de Vercel está a un click** (el deploy previo figura como `isRollbackCandidate`), y confirmar que sí, cuando vuelva se resuelve juntos. Ver aprendizaje #67.
- El hueco de 6,5 semanas confirma que **`HISTORIA.md` ES la memoria real del proyecto**, no el chat. Al volver, la primera pregunta de Alejo fue *"¿dejamos algo en el .md?"*. Ver aprendizaje #68.

---

### Sesión 12-ago-2026 (tarde/noche) · **`[FOTOS-OREGON]` — la mudanza de mayo había quedado a medias**

Sesión que arrancó como *"bajemos el proyecto viejo para dejar de pagar"* (el pendiente #1 desde mayo) y terminó destapando que **la migración a São Paulo nunca se completó del todo**: 97 filas de la base seguían apuntando las fotos al servidor de Oregon. Apagarlo sin mirar habría dejado el catálogo público con 80 imágenes rotas. De paso aparecieron dos hallazgos serios (backup propio y notificaciones caídos hace 3 meses) y se midió **por primera vez con números** la exposición de los datos de clientes.

#### `[FOTOS-OREGON]` · 97 direcciones apuntando al servidor viejo

**Cómo se descubrió.** Antes de pausar Oregon se verificó qué dependía de él. El repo estaba limpio (`grep rtgjzzkjrwbkdhkslxix` sólo aparecía en `.claude/settings.local.json`, que no ejecuta nada) y Vercel no tenía ninguna variable configurada. **Pero el navegador contra producción mostró 80 `<img>` cargando desde `rtgjzzkjrwbkdhkslxix.supabase.co`.** Las URLs se guardan enteras en la BD: el Plan B de mayo copió los archivos al bucket nuevo pero **no reescribió las direcciones guardadas**.

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
