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

- `mockup-zapato.html`: admin con sidebar lateral + tab "Campañas" como mockup de `[SIRENITA]`. Sirvió de referencia para implementar [ZAPATO] en el admin real.
- `mockup-catalogo-issues.html`: 6 oportunidades visuales del catálogo público con vista before/after. Sirvió como guía visual para [CATALOGO-POLISH].

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
> *"Hacé login con la password del jefe que usás normalmente (`SANTOMY2026` según el código)."*

Alejo me detectó que esa frase "según el código" sugería que la password estaba en el código (HTML público). Le confirmé que sí: `admin.html` líneas 2766-2767 tiene:
```js
var ADMIN_PASS = 'SANTOMY2026';
var ADMIN_PASS_EMPLEADO = 'CAFE_MATE_PROHIBIDO';
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

#### Pendiente inmediato

- **`[FORGOT-PASS-A]`** · es lo próximo que pidió Alejo. El SQL de la tabla `password_reset_requests` quedó escrito en `sql/forgot-pass-a-create-table.sql` (en el main repo, sin ejecutar). Ahora con el MCP de Supabase la tabla se puede crear directo (sin copy/paste). Toca admin.html (tab "Pedidos pass") → ventana segura.
- Decisión menor pendiente: ¿el resumen diario manda "Sin movimientos 😴" los días sin actividad, o silencio total? Quedó con el 😴 (ajustable en 1 línea).

#### Herramienta nueva validada

El **MCP de Supabase** (`mcp__...__execute_sql`, `list_extensions`, etc.) resultó clave esta sesión: ejecuta SQL directo y confiable (no se cuelga como psql/pooler), y permite crear funciones/extensiones/cron sin que Alejo copie/pegue en el dashboard. **Bonus:** `psql`/`pg_dump` desaparecieron del sistema (carpeta `C:\Program Files\PostgreSQL\18\` quedó vacía entre el 21-may y el 27-jun) · el MCP los reemplaza para casi todo.

---

**Última actualización:** Junio 27, 2026 (sábado madrugada) — Resumen diario de Telegram `[TG-RESUMEN-DIARIO]` implementado y ANDANDO (función `daily_summary` + `pg_cron` job a las 23:00 ART + 6 notifs instantáneas silenciadas · commit `1ded56a` · SW → **v1.1.74**). Reemplaza el bombardeo de 16-114 Telegrams/día por 1 resumen al cierre. Telegram confirmado FUNCIONANDO (el `[FIX-TELEGRAM-PG-NET]` era falsa alarma · obsoleto). También: badge violeta admin `[BADGE-LAST-VIOLETA]` (`42b5dce`), 3 slash commands implementados, QA post Plan B OK. **El MCP de Supabase es ahora la vía principal para SQL/infra** (psql/pg_dump desaparecieron del sistema). Detalle completo en sección "Sesión 27-jun-2026" arriba + `docs/BACKEND.md`.
**Próxima revisión cuando:** **`[FORGOT-PASS-A]`** (próximo · SQL en `sql/forgot-pass-a-create-table.sql`) · ⚠️ **`[SECURITY-AUDIT-S1]` (CRÍTICO · passwords admin hardcoded públicas)** · `[BCRYPT-MIGRATION]` (cae adentro de S1) · bajar proyecto viejo Oregon (sigue ACTIVE_HEALTHY · pagando de más desde el 28-may) · `git pull` en main repo desincronizado · CLS Desktop iter 5 · `[SW-BANNER-SMART]` · logo @2x · imágenes Supabase con `?width=400` · JS-CHUNK iter 2.

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
