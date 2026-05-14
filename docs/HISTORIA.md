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
| Reciente | Light mode completo, reorder home, performance pass mobile |

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

## 🎓 Lecciones meta

1. **No empezar por la UI.** Diseñar la DB primero. Lo aprendí con la tabla de puntos que se replanificó 3 veces.
2. **CSS modular desde el día 1.** El monolito de 6700 líneas fue invivible cuando agregamos light mode.
3. **Light mode debería haberse pensado al inicio**, no como retrofit. 200+ overrides después estoy aprendiendo.
4. **RLS desde el día 1**. Cada tabla nueva con policies. Aprendí con el bug de `ajuste_horario`.
5. **Convos chicas con Claude.** Una conversación gigante (esta misma) es invivible para retomar contexto.
6. **Linear / Notion fuera del chat.** Pendientes que vayas pensando NO van en el chat — se pierden.
7. **Mockups en UN solo archivo `mockups.html`.** Convención acordada mayo 2026: cuando Claude necesite hacer un mockup standalone, lo agrega como sección/tab interna a `mockups.html`, no como archivo nuevo. Evita que se acumulen `mockup-zapato.html`, `mockup-catalogo-issues.html`, etc. — esos 2 quedan como histórico hasta que ya no sirvan de referencia, después se borran. Si todavía no existe `mockups.html` cuando se necesite hacer el primero "post-convención", crearlo entonces. Cada sección dentro del archivo tiene su propio anchor (#nombre-feature) para linkear.

---

**Última actualización:** Mayo 14, 2026 (madrugada) — fin de sesión maratónica con 10 commits live + 2 mockups + 1 incidente Supabase documentado.
**Próxima revisión cuando:** se haga la migración a bcrypt, se agregue la tab Orden de Compra, se mida Lighthouse mobile real post-fixes, o cualquier cambio de arquitectura.

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
- `[LCP-PRELOAD]` — preload + fetchpriority de imagen LCP
- `[CLS-RESERVE]` — min-height reservado en skeleton/grid
- `[FCP-CSS]` — CSS no bloqueante + critical inline
- `[IMG-DIMS]` — aspect-ratio defensivo en imgs
- `[SDK-DEFER]` — Supabase SDK con defer (ya estaba)

Y para mejoras futuras planteadas pero no hechas:
- `[SIRENITA]` — sistema de Campañas (tabla `campaigns` en Supabase) para que las empleadas puedan crear/activar/desactivar campañas (Hot Sale, Black Friday, Aniversario, etc) sin tocar código. Cada campaña define label, emoji, color. Solo 1 activa por vez. Mockup propuesto en `mockup-zapato.html` tab "Campañas". Hoy `HOT_SALE_LABEL` está hardcoded — esto lo haría editable desde admin.
- `[LCP-V2]` — segunda capa de LCP (comprimir logo, lazy real cards 7+)
- `[HERO-OPTIMIZE]` — optimización específica del hero
- `[JS-CHUNK]` iter 2+ — el iter 1 (decants) ya está deployed. Falta mover: quiz + juegos ST + custom cursor + compare modal + banner decants WA + share/sharePerfume. Estimado: -3000 líneas más del bundle inicial. Riesgo: medio. Recomendado hacerlo en branch dedicada con preview Vercel (igual que se hizo iter 1 — ver commit bcd4eec).
- `[BCRYPT-MIGRATION]` — hashear passwords lazy migration
- `[SUPABASE-AUTH]` — migrar de custom auth a Supabase Auth nativo
- `[ORDEN-COMPRA-TAB]` — tab admin con sugerencias de pedido
