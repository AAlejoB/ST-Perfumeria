# CLAUDE.md — ST Perfumería

> Este archivo lo lee Claude Code automáticamente al abrir una sesión en este repo.
> Contiene contexto, convenciones y reglas del proyecto.
> Si modificás algo importante, actualizá este archivo.

## 📚 Documentación detallada (deep dives)

Si necesitás profundizar en un área específica:

| Si tu pregunta es sobre... | Leé |
|---|---|
| UI, CSS, HTML, light mode, layout, performance del front | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| Auth, Realtime, SW, push, cron, Vercel functions, audit log | [`docs/BACKEND.md`](docs/BACKEND.md) |
| Tablas, schemas, RLS, migraciones, índices | [`docs/DATABASE.md`](docs/DATABASE.md) |
| Decisiones tomadas, bugs históricos, evolución | [`docs/HISTORIA.md`](docs/HISTORIA.md) |
| Validar todo el sitio antes de releases (170 items) | [`docs/QA-PRE-JULIO.md`](docs/QA-PRE-JULIO.md) |
| Seguridad: issues abiertos, severidad, planes de fix | [`docs/SECURITY.md`](docs/SECURITY.md) |
| Ventana de privilegio para la lista de espera (diseñado, sin implementar) | [`docs/PLAN_AVISOS_PRIORIDAD.md`](docs/PLAN_AVISOS_PRIORIDAD.md) |

Este archivo (`CLAUDE.md`) tiene el resumen general. Para dive deep, andá a la doc específica.

---

## 🎯 Qué es este proyecto

**ST Perfumería** (stperfumeria.com) es un e-commerce para una perfumería árabe en Comodoro Rivadavia, Argentina. Vende ~150 perfumes importados con catálogo + filtros + decants armables + checkout vía WhatsApp.

**Cliente / dueño:** Alejo Bello (yo).
**Empleados:** trabajan con el panel admin desde tablets en el local.

---

## 🛠️ Stack

| Pieza | Herramienta | Notas |
|---|---|---|
| Frontend | HTML + JS vanilla + CSS modular | Sin frameworks, sin build steps. `app.js` (core) + `extras.js` (lazy via `requestIdleCallback`) desde [JS-CHUNK] mayo 2026 |
| Backend | Supabase (Postgres + Realtime + Storage) | **Pro tier** (USD 25/mes desde mayo 2026). Tiene defensas anti-degradación: timeout 3s + cache local 30min + seed hardcoded — ver `docs/BACKEND.md` § "Resilencia frente a Supabase degradado" |
| Hosting | Vercel | Free tier |
| Dominio | stperfumeria.com (también legacy `st-perfumeria.vercel.app`) |
| PWA | Service Worker custom (`sw.js`) | Versionado manual |
| Auth | Custom phone+password en tabla `clientes`, **vía RPC `SECURITY DEFINER`** | ✅ **bcrypt desde 17-sep-2026** (`[BCRYPT-MIGRATION]`) · `anon` sin acceso directo · pendiente escalón 3 (Supabase Auth) |

---

## 📂 Estructura de archivos

```
ST_Perfumeria/
├── index.html              ← Página pública (catálogo, decants, etc.)
├── admin.html              ← Panel admin (jefe + empleadas) — con sidebar lateral desde [ZAPATO] may-2026
├── offline.html
├── sw.js                   ← Service Worker (versionado manual)
├── perfumes.js             ← Array de los ~150 perfumes (catálogo seed) · en la RAÍZ, lo cargan index.html y admin.html con src="perfumes.js"
├── manifest.json           ← PWA
├── mockups.html            ← Archivo único de mockups (convención may-2026, lección #7). Esqueleto vacío entre sesiones. No se sirve (`.vercelignore`, 24-sep).
├── js/
│   ├── app.js              ← Core JS del front público (~6500 líneas tras [JS-CHUNK])
│   ├── extras.js           ← Chunk lazy-loaded (armador decants) — se carga con requestIdleCallback
├── css/
│   └── styles.css          ← TODO el CSS (~8000 líneas) — incluye light mode + admin sidebar
├── img/                    ← Logos, banners
├── fonts/                  ← [FONTS-SELFHOST] Inter + Playfair + Bodoni (4 woff2 variables, subset latin) + fonts.css con los 17 @font-face + los OFL
├── scripts/                ← Herramientas de medición (no se sirven): contraste.js (npm run contraste), medir_targets.js, metricas.sh
├── api/                    ← Vercel serverless functions
│   ├── cron/backup.js      ← Backup diario a Supabase
│   └── og/perfume.js       ← OG image dinámica
├── sql/
│   ├── create_puntos_system.sql      ← Schema de puntos
│   └── add_updated_at_trigger.sql    ← Trigger para [WATCHDOG] Realtime (may-2026)
└── docs/
    ├── HISTORIA.md         ← Decisiones tomadas, bugs significativos, keywords
    ├── FRONTEND.md         ← Patrones de frontend
    ├── BACKEND.md          ← Auth, Realtime, watchdog, resilencia Supabase
    ├── DATABASE.md         ← Tablas, RLS, migraciones
    └── planes-archivados/  ← Planes históricos (ej. PLAN_REALTIME_WATCHDOG.md)
```

⚠️ Tanto `app.js` como `admin.html` y `styles.css` son **monolitos grandes**. Cuando edites, andá con cuidado: usá Grep + Read primero, evitá rewrites masivos.

---

## 🗄️ Base de datos (Supabase)

Tablas principales:

| Tabla | Función |
|---|---|
| `clientes` | Auth custom (telefono + password **bcrypt**, sólo por RPC) + datos + `puntos` · `id` es **uuid** |
| `ventas` | Tabla histórica (la tab "Registrar Venta" del admin fue eliminada — el jefe va a re-pensar el flujo). NO escribir desde el front por ahora. |
| `perfume_overrides` | Stock + status por perfume (`stock_qty`, `stock_status`, `nota_*`) |
| `perfumes_nuevos` | Perfumes agregados por admin (extra al seed) |
| `combos` | Packs/sets de perfumes |
| `destacados` | Slugs ordenados de la "Selección ST" |
| `home_top_banner` | Mensajes B/N rotativos arriba (carrusel multi-msg) |
| `trust_badges` | Los 4 cuadros de beneficios bajo el hero |
| `votacion_config` + `votos` | Voto del perfume del mes |
| `cierres_especiales` | Días cerrados programados |
| `ajuste_horario` | Override de horario (1 fila activa a la vez) |
| `puntos_config` + `puntos_log` | Sistema de puntos (1 fila config + log de movimientos) |
| `decants_custom` | Perfumes "estrella" para el armador que no están en catálogo |
| `favoritos` | `(user_id, slug)` — favoritos por cliente logueado |
| `lista_espera` | "Avisame cuando vuelva" |
| `opiniones` | Mensajes públicos de clientes en "Tu sector" |
| `announcements` | Pushes que aparecen en banner público (últimos 7 días) |
| `audit_log` | Cambios admin (logAdminAction) |
| `analytics_events` + `perfume_clicks` + `perfume_views` | Tracking |
| `backups` | Snapshots diarios |

**RLS:** todas las tablas deben tener:
- `select_public` con `USING (true)` para anon (catálogo es público)
- `write_auth` con `USING (auth.role() = 'authenticated')` para edición

⚠️ **Si creás una tabla nueva → SIEMPRE habilitá RLS y crear policies, sino se rompen lecturas anon.** Aprendido por las malas con `ajuste_horario`.

---

## 🎨 Convenciones de código

### Idioma
- **Variables, comments y commits**: en castellano (es-AR).
- **Strings de UI**: castellano rioplatense (vos, tildes, etc.).
- **Nombres de clases CSS**: en inglés OK (`.card-name`, `.product-card`).

### Estilo
- 2 espacios de indent.
- `var` en `app.js` (no ES6 `let`/`const`) — el archivo es viejo y consistente con eso.
- En `admin.html` y nuevos módulos `let`/`const` están bien.
- Strings con comilla simple `'` salvo cuando contienen `'`.

### Commits
Formato:
```
<tipo>(<scope>): <descripción corta en castellano>

<cuerpo opcional con detalles>

SW v1.0.XX (cuando aplique)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Tipos: `feat`, `fix`, `chore`, `style`, `perf`, `docs`, `refactor`.
Ejemplo: `fix(decants): grid alfabético + agregados arriba en builder`

---

## 🔄 Service Worker — REGLA SAGRADA

**Cada vez que tocás `index.html`, `admin.html`, `app.js`, `perfumes.js` o `styles.css` → BUMPÉ EL SW.**

```js
// sw.js línea 16
var CACHE_VERSION = 'v1.1.64';   // ← incrementá este
```

Si no lo bumpeás, los usuarios siguen viendo el archivo viejo cacheado. Versión actual al momento de escribir esto: **v1.1.129** (24-sep-2026, partes K y L).

> **Desde v1.1.32 (sesión 15-may-2026)** existe `[PWA-AUTO-RELOAD]`: cuando se deploya una versión nueva del SW, el frontend RECARGA SOLA la página (sin que el cliente toque F5 ni cierre tabs) — siempre que NO esté interactuando (modal abierto / input focused / scroll < 3s). Ver `docs/HISTORIA.md` para detalles. ⚠️ **Medido el 24-sep: en el sitio público no se dispara nunca** — `.compare-modal`, uno de los selectores de "ocupado", es un elemento fijo de `index.html` y siempre coincide. **Se deja así** (`[RELOAD-NUNCA]`, decisión B de Alejo, 24-sep): con CSS/JS/fuentes en network-first desde `3cee019` (12-may), cada carga con red ya trae la versión nueva, y la versión nueva se detecta justo en esa carga: recargar no mostraría nada nuevo. No prenderla sin revisar eso.
>
> **Desde v1.1.35 (sesión 15-may-2026)** existe `[SW-UPDATE-BANNER]` en admin · rediseñado en v1.1.39 a versión "Amarillo BIG" (`[SW-BANNER-V2]`): cuando se detecta una versión nueva, aparece un banner sticky-top con ícono 🔄 grande en círculo negro + título "Nueva versión del panel disponible" + subtítulo + botón "ACTUALIZAR" gigante. A diferencia del público, en admin **NO hace auto-reload** — la chica decide cuándo (podrían estar en medio de una venta).
>
> **Técnica `[EMERGENCY-BUMP]` (15-may-2026)** — ⚠️ lo de "recarga sola" no pasa (ver la advertencia de `[PWA-AUTO-RELOAD]`, arriba): lo que actualiza es la próxima carga de la página: si una tablet del admin se "queda colgada" con cache híbrido, bumpear el SW sin cambios reales fuerza el flujo `[PWA-AUTO-RELOAD]` en clientes con SW v1.1.32+ y la tablet recarga sola en ~2 min sin que las chicas tengan que tocar nada. Patrón replicable.

Estrategias por tipo de recurso (definidas en `sw.js`):
- HTML → network-first con fallback a cache + offline
- CSS/JS/fuentes → network-first con fallback a cache (desde `3cee019`, 12-may-2026; antes era stale-while-revalidate): con red, cada carga trae la versión nueva
- Imágenes → cache-first
- Supabase / WhatsApp / Telegram → network-only (no cachear)

---

## ⚙️ Patrones / convenciones técnicas establecidas

### Performance
- **`deferTask(fn)` y `onDeferred(fn)`** en `app.js` — para diferir loaders no críticos hasta `requestIdleCallback` post-`load`. Usar SIEMPRE para loaders secundarios (announcement, votación, decants custom, etc.). NO usar para `loadHomeTopBanner` ni el path crítico del catálogo.
- **Slider de la home → ELIMINADO** (descontinuado, no reactivar). La función `loadHomeSlides` queda en código pero no se invoca.
- **Imágenes con `width`/`height` explícitos** + `fetchpriority="high"` en above-the-fold (slide #0 si volvés a usar slider, o hero), `loading="lazy"` en el resto.
- **Backdrop blur en cards**: cada `.card-gallery-slide` tiene `background-image` con la misma foto + `::before` con `filter: blur(28px)` para llenar bandas vacías cuando la botella es alta y angosta.

### Realtime
- `setupRealtimeStock()` en `admin.html` se subscribe a `perfume_overrides` (UPDATE) y `ventas` (INSERT). Cuando una empleada vende, otra tablet ve toast.
- Si agregás una tabla nueva que necesita realtime → activarlo en Supabase (Database → Replication).

### Modales
- Convención: `<div class="modal-overlay" id="modalX"><div class="modal-box">...</div></div>`
- Abrir con `.classList.add('active')` (NO `'open'` — error común)
- Cerrar con `closeModal('modalX')` o `event.target === overlay`

### Filtros del catálogo (deck pattern)
- Filter buttons apilados en mobile, `position: absolute`. Solo el `.active` se ve cuando deck está cerrado. Tap abre el deck (clase `.deck-open`), tap fuera cierra.
- En desktop **NO sticky** (causaba "navbar fantasma" sobre Tu Sector).
- En mobile **es sticky sólo dentro del catálogo** (`[FILTROS-SOLO-CATALOGO]`, decisión 76, 24-sep): la barra, el anuncio y la sección del catálogo van dentro de `.catalogo-scope` (`index.html`, sin estilos), y el sticky termina con la sección. En el catálogo lo pegado mide 236,8 (nav + banner + filtros); debajo, 97 (nav + banner), y las secciones frenan en 105.

### Barra de abajo del celu (`[BARRA-CELU]`, 24-sep)
- Sólo a < 768: `#barraCelu` (`index.html`), fija abajo, 60 px + `env(safe-area-inset-bottom)`, `z-index: 9990`. Es un `<div role="navigation">` y no un `<nav>`: la regla `nav { … }` de `styles.css` le pondría el alto, el padding y el fondo del nav de arriba.
- Cinco destinos: **Catálogo** (va a `#catalogo`; si ya estás adentro, arriba de todo) · **Buscar** (`focus()` en el mismo toque y después el scroll: en iPhone, un foco después del scroll suave no abre el teclado) · **Decants** · **Carrito** · **Cuenta** (el login sin sesión; con sesión, la hoja «Hola, <nombre>», que se cierra tocando afuera y con «atrás» por `pushState`). El activo es siempre Catálogo.
- Los números salen de `updateCartUI` / `updateDecantUI`, los mismos contadores de `.cart-float` / `.decant-float`, que en el celu no se muestran (tampoco `.scroll-top` ni `.dark-float`).
- El final de la página se reserva con `html body { padding-bottom: … }`: `html body` y no `body`, porque el CSS crítico inline de `index.html` (`html, body { padding: 0 }`) va después de `styles.css` y ganaría por orden.

### Sort default
- `renderCatalog()` SIEMPRE termina con `sortCards('price-desc')`. No removerlo.

### Light mode
- Tema controlado por clase en `<body>`. Default = `dark-mode` (presente al iniciar). Toggle = `body.classList.toggle('dark-mode')`.
- Light mode = `body:not(.dark-mode)` en CSS.
- **Excepción que SIEMPRE queda oscura:** los trust badges (NO ROMPER #7, decisión 52 del DISEÑADOR). Las cards de Categorías y el banner "EXPLORÁ NUESTRO CATÁLOGO" son crema desde v1.1.54-58; el banner de puntos también (medido el 23-sep en v1.1.117: fondo `#f5efde`).
- Paleta light: `#e3d6b3` bg, `#ede2c2` cards, `#1a1a1d` texto, **`#6b5500` la tinta dorada de texto** (`--amarillo-tinta`, decisión 66, 24-sep: era `#8a6d00` en el catálogo y `--stat-tinta` en el panel; 4,97 sobre `#e3d6b3`, el peor fondo).
- **El dorado de TEXTO es `var(--amarillo-tinta)`** en las dos apps (oscuro `#E8B800` = `--amarillo`, claro `#6b5500`). Bordes, fondos, `accent-color` y un texto en claro sobre fondo oscuro (la vista previa de Badges) siguen en `--amarillo`.
- **La letra la decide el fondo, no el tema** (decisiones 94-96, 24-sep): un botón, una cinta o una píldora con fondo de color propio lleva la letra que le pide ese fondo, igual en los dos temas (regla 19). La cinta de la card la elige `letraSobre` (`app.js`, `#fff` o `#000` por luminancia), los botones del panel la tienen fija por clase y la flotante del horario es opaca. `contraste.js` lo controla.
- Si agregás una sección nueva, asegurate que se vea legible en ambos temas. Los textos hardcoded `#999`/`#888`/`#777` se ven invisibles en light → usá variables.

### Sistema de puntos
- Tabla `puntos_config` (1 sola fila). Cada venta calcula puntos según `puntos_por_perfume`/`puntos_por_decant`/`puntos_por_set_combo`.
- `ventas.puntos_otorgados` guarda cuánto sumó. Cuando se elimina una venta, se RESTAN esos puntos al cliente (lookup por `cliente_id_puntos`).
- Banner contextual sobre el catálogo si el cliente está cerca del threshold.

### Push notifications
- VAPID keys hardcoded en admin.
- Una empleada manda push → Edge function `send-push` → suscriptores reciben.
- Subscribe se hace solo si el cliente toca explícitamente el botón.

---

## ❌ NO ROMPER

Cosas que aprendimos a la mala y NO hay que volver a tocar:

1. **Filter-bar NO sticky en desktop** (causaba navbar fantasma flotando)
2. **Slider de la home eliminado** — no reactivar sin pedido explícito
3. **`renderCatalog()` siempre termina con `sortCards('price-desc')`**
4. **SW DEBE bumpearse** al tocar archivos cacheados (sino los users ven viejo)
5. **RLS pública** en cada tabla nueva — sino el front público no puede leer
6. **Timezone Argentina** al guardar fechas — usar `toLocaleString('en-US', {timeZone: 'America/Argentina/Buenos_Aires'})`, NO `new Date().toISOString()` (eso es UTC y rompe a la noche)
7. **En claro sólo los trust badges quedan oscuros; las categorías y el banner «Explorá» son crema desde v1.1.54-58** (decisión 52 del DISEÑADOR, 23-sep-2026; antes decía "Categorías y trust badges quedan oscuros", y no era así desde mayo)
8. **Tabs del admin con `data-role="jefe"`** son SOLO para el jefe. Para empleadas, no poner ese atributo.
9. **Auth de clientes: SÓLO por las RPC `cliente_*`** (`sql/fase1.sql`) — el sitio público no lee ni escribe `clientes` (anon no tiene policies). Cualquier flujo nuevo que necesite la tabla va como función `SECURITY DEFINER`, nunca como `from('clientes')` desde `app.js`. Compat con clientes existentes garantizada por la migración perezosa.
10. **Lo interno no se sirve** (`.vercelignore`, 23-sep-2026): `docs/`, `sql/`, `memory/`, `RECOMENDACIONES_CLAUDECHAT/`, `.claude/`, `scripts/`, todo `*.md` y `mockups.html` (24-sep) quedan fuera del deploy. Hasta ese día el dominio servía `/docs/SECURITY.md` y compañía. Si agregás una carpeta interna nueva, sumala ahí; si el sitio necesita un archivo nuevo, verificá con `curl -I` que no caiga en la lista.
11. **`lista_espera`: el sitio público no la lee** (`[ESPERA-SEGURA]`, 23-sep-2026) — inserta directo (el índice único parcial `(slug, telefono) WHERE notified_at IS NULL` responde 23505 si ya estaba pendiente) y el ✓ sale de `lista_espera_pendientes(p_telefono)`. `anon` no tiene SELECT sobre la tabla; el panel sí (`authenticated`).
12. **Sin scroll infinito** (`[VER-MAS]`, decisión 67 de Alejo, 23-sep-2026): «Ver más fragancias» es el único modo. Con scroll infinito lo que está debajo del catálogo (juegos, nosotros, FAQ, mapa, pie) se alejaba cada vez y ningún salto llegaba. **Los saltos frenan con el `scroll-margin-top` del DESTINO** (secciones 105 mobile / 115 desktop; card y grilla 243 / 115: 6 px debajo de lo pegado), **nunca con `scroll-padding-top` en el `html`**: ese se suma a todos los saltos.
13. **`#quizSection` no es un elemento** (`[JUEGOS-VENTANA]`, 23-sep-2026): es el ancla que abre la ventana de juegos (al cargar, en `hashchange`, al tocar un link y desde los trust badges). El quiz y el Desafío existen UNA sola vez, adentro de `#juegosOverlay`, con sus IDs de siempre. Un «Ver» desde un resultado abre el detalle ENCIMA de la ventana (decisión 72).
14. **El horario del local sale de UNA cuenta** (`[HORARIO-DOS-FUENTES]`, 24-sep-2026): `calcularEstadoHorario` (en la IIFE de `HORARIOS`, `app.js`) usa `HORARIOS` con el ajuste del panel, los feriados y los cierres especiales, y de ahí escriben las dos píldoras (la del hero y la flotante de WhatsApp). La flotante tenía su propio horario escrito a mano y decía «Abierto» un sábado a las 16, un feriado o con el horario ajustado. No volver a calcular el horario aparte.
15. **Lo que se abre encima de la barra del celu, la tapa** (`[BARRA-CELU]`, 24-sep-2026): la barra vive en `z-index: 9990`. Un overlay nuevo va arriba (carrito y armador 9999, juegos 9995, detalle 10000, la hoja de Cuenta 9993) o esconde la barra mientras está abierto, como el login (2000), el menú (200/199) y el armador: `body:has(.x.open) .barra-celu { display: none }`. Y un flotante nuevo del celu se apoya arriba de la barra (60 px + safe-area), nunca en `bottom: 0`.

---

## 🔐 Cuentas de admin

- **Jefe**: rol `jefe` — ve TODAS las tabs
- **Empleadas**: rol `empleado` — ve solo las tabs sin `data-role="jefe"`

Definido en la lógica de admin.html (`currentRole`).

> **Desde 15-may-2026** (commit `eaae7cf`) la tab "💧 Decants" es visible para empleadas también (antes era solo jefe). Si querés esconder solo la sección de "config global de precios escalera" a empleadas pero dejarles cargar decants de diseñador, podés agregar `data-role="jefe"` a las cards específicas en lugar de a toda la tab.

> **Desde 22-sep-2026** (`[LOG-EMPLEADA]`, `de9877b`) la tab **"📋 Log" también es visible para las empleadas**: perdió su `data-role="jefe"`. Lo que ve cada una lo decide la **RLS** de `admin_actions` (la empleada lee `stock_update` y `deposito_update`, **de quien sea**) y, como defensa en profundidad, el cliente descarta cualquier otra acción antes de pintar. El único tag es 👑 y sale de `actor_email === JEFE_EMAIL`, no de `actor_role` (que lo manda el cliente: sirve para pintar, no para decidir).

---

## 📌 Pendientes conocidos (con prioridad)

> **Convención (desde 18-sep-2026):** el identificador de cada pendiente es su **keyword entre corchetes** — no el número de posición (los números se reordenan y se repetían: había 7 y 8 dos veces). Acá quedan **sólo los abiertos**; al cerrar cada sesión, `/handoff` mueve los resueltos a `docs/HISTORIA.md` § "✅ Resueltos" con su texto completo. Orden: 🔴 → 🟠 → 🟡 → 🟢, y dentro de cada grupo por importancia.
>
> **Agujeros abiertos (decisión de Alejo, 23-sep-2026):** mientras un agujero de seguridad esté abierto, acá va **la keyword sola**; la descripción entra cuando se cierra. El repo de GitHub es público. El detalle vive fuera del repo (`D:\workspace\_correo_agentes\`).

### 🔴 Urgentes

- **`[VERCEL-ENV-VARS]`** (12-ago) — Vercel **no tiene NINGUNA variable de entorno**: el backup propio, el alta de suscriptores y el envío de push están **rotos desde mayo**. Reponer `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASS`, `VAPID_*`, `CRON_SECRET`. La service key se copia **directo Supabase→Vercel, nunca por chat**. Ver `docs/SECURITY.md` § S12. Lo hace **Alejo a mano**; Claude Code verifica después (cron, fila nueva en `backups`, push). Se destraba con `[SECURITY-AUDIT-S1]`. *(S11, la trampa que había acá, ya está arreglada · `ef1507d`.)*

### 🟠 Altos

- **`[SECURITY-AUDIT-S1]`** (re-scoped 27-jun · 23-sep · 🟠) — agujero abierto: **sólo la keyword** (regla del 23-sep). Lo cerrado: las dos contraseñas del panel se rotaron el 19-sep (Alejo, 21:11 ART; verificado por los logs de auth), la constante muerta se borró (`4b88e20`) y `.claude/commands/security-scan.md` quedó sin valores (`db37b21`). Se cierra junto con `[VERCEL-ENV-VARS]`. Ver `docs/SECURITY.md` § S1.
- **`[S13-ESCRITURAS-ANON]` / S2-bis** (16-sep · 🟠) — agujero abierto: **sólo la keyword** (regla del 23-sep, aplicada también a lo viejo). Se resuelve con `[SUPABASE-AUTH]`. Ver `docs/SECURITY.md` § S13.
- **`[S10-TER-XSS-COMBOS]`** (23-sep · 🟠, decidido por Alejo) — agujero abierto: por la regla del 23-sep va **sólo la keyword**; el detalle (archivo:línea y arreglo) vive en el inventario de `_correo_agentes` y entra acá cuando se cierre. Tanda propia con bump. Ver `docs/SECURITY.md` § S18.

### 🟡 Medios

- **`[RESET-EXPIRES]`** (17-sep) — `password_reset_requests.expires_at` **no se respeta**: la tabla pone 24 h por default pero `loadResetRequests` (`admin.html`) filtra sólo por `status = 'pending'`; un pedido de hace 5 días aparece en "Pedidos pass" como de hoy. Fix: filtrar `expires_at > now()` (o marcar vencidos) y mostrar la antigüedad.
- **`[S3-VAULT]`** (🟡) — agujero abierto: **sólo la keyword** (regla del 23-sep). El token del bot ya se rotó (17 y 19-sep). Ver `docs/SECURITY.md` § S3.
- **`[S4-OREGON]`** (23-sep, keyword nueva para S4 · 🟡) — agujero abierto: **sólo la keyword** (regla del 23-sep). Decide Alejo. Ver `docs/SECURITY.md` § S4.
- **`[SUPABASE-AUTH]`** — escalón 3 de S2: migrar los clientes a Supabase Auth (`auth.uid()` en policies, mantener `clientes.id` uuid). Resuelve `[S13-ESCRITURAS-ANON]` y la deuda de `cliente_puntos` / `cliente_reset_solicitar` (responden con sólo el teléfono). Sólo en una "semana sin grandes cambios".
- **`[AUTH-ES-STAFF]`** (23-sep, del PREPARADOR · 🟡) — agujero abierto: **sólo la keyword**. Inventario de las políticas que confían en el rol y no en el email del staff. Con el registro cerrado (`[SIGNUP-ABIERTO]`, 23-sep) el riesgo baja. No ahora.
- **`[BCRYPT-RESTO]`** (23-sep, salió del repaso · 🟡) — agujero abierto: **sólo la keyword**. Decide Alejo si se resuelve ya del lado del servidor o se espera a la migración perezosa.
- **`[TELEGRAM-PANEL-401]`** (23-sep, salió del repaso · 🟡) — los avisos del panel de login fallido y de bloqueo salen sin sesión y **rebotan 401 desde el 19-sep** (`send_telegram` ya no es de `anon` desde S14); el `.catch` vacío se traga el error. Además `send_telegram` no fija timeout ni reintenta: el 23-sep se perdió 1 aviso de 5. El enfoque lo deciden Alejo y el PREPARADOR.
- **`[LIGHT-MAYO-56]`** (22-sep, salió de `[TEMA-CLARO]`) — las **56 reglas `!important`** bajo `body:not(.dark-mode)` de `193e3dd` (8-may, *"parche masivo de legibilidad en light mode"*, `css/styles.css` L8040-8200) son las que gobiernan el catálogo en claro: `.price-promo` `#1a1a1d`, `.price-cash` `#1b5e20`, `.card-brand` `#2a2622`. Los tokens de claro ya tienen **esos mismos valores** (decisión 32), así que pasar cada regla a `var(--…)` no cambia nada en pantalla y saca 56 `!important` de la métrica. ⚠️ Se escribieron por un pedido real de una usuaria (*"la tía del jefe no podía leer"*): cada una la revisa el DISEÑADOR, no se borran en masa.
- **`[COMBOS-PAUSADOS-VISIBLES]`** (23-sep, salió del relevamiento de `[S10-TER-XSS-COMBOS]`) — `set-asad` y `set-dia-de-la-madre` tienen `perfume_overrides.stock_status = 'pausado'`, pero en stperfumeria.com las 5 cards de sets salen activas, sin "Próximamente". Contradice `[PAUSADO-OCULTO]`. No se tocó; la prioridad (🟡) es propuesta de Claude Code.
- **`[ESPERA-MAS]`** (decisión 42 + barrido del 23-sep · 🟡) — columna `origen` y `+` en la pestaña Espera; además, decidido por el DISEÑADOR: la tarjeta «ESPERANDO» cuenta sólo pendientes (hoy, en Historial, cuenta a los avisados), `.75rem` para "Te avisamos al …" (hoy `.65rem`) y espacio en 🔔 y 🔒. Sin código todavía.
- **`[SIRENITA]`** (decidido por Alejo el 23-sep · 🟡) — **fusionado con las promos de decants**: una pantalla del panel para prender y apagar promos con precio y fechas (Hot Sale, Black Friday) sin tocar código. Espera el costo por decant de los jefes. Meta: Black Friday.
- **`[ORDEN-COMPRA-SUGERIDA]`** — tab "Orden de compra sugerida", on-demand, opción C definida.

### 🟢 Bajos

- **`[LOGIN-INTENTOS-CLEANUP]`** — `pg_cron` que borre de `cliente_login_intentos` las filas de más de un día (crece con cada intento fallido de cualquier número, exista o no).
- **`[MEDIR-TEMP-SWEEP]`** (22-sep, salió de `[LOG-EMPLEADA]`) — `scripts/medir_targets.js` crea un perfil temporal por corrida (`%TEMP%st-medir-*`) y el borrado final está en un `try/catch`: en Windows el perfil suele quedar bloqueado por procesos hijos de Chromium que sobreviven al `kill` del padre, así que **se acumulan**. El 22-sep había **28 carpetas = 3 GB** y `C:` había bajado a 14 GB libres (se limpiaron a mano: 128 procesos zombis terminados y las 28 carpetas borradas → 25 GB). El 23-sep volvió a pasar: 5 corridas → 5 carpetas (57,5 MB), esta vez sin procesos vivos (las borró Alejo). Desde la tarde del 23-sep Claude Code corre las mediciones con `TEMP` en `D:` y el capturador externo usa su propio perfil en `D:`, así que `C:` no acumula; el barrido sigue pendiente para quien corra el script a secas. Fix: al arrancar, barrer los `st-medir-*` propios que no estén en uso. Sin apuro.
- **`[RESET-TEMP-PASSWORD-MUERTA]`** (17-sep) — `password_reset_requests.temp_password` es **columna muerta** (reservada en `[FORGOT-PASS-A]`, el panel nunca la usa): dropearla o documentarla como no usada en `DATABASE.md`.
- **`[DC-HEADER-600]`** — el mini-header de columnas del grid de decants de diseñador (`admin.html` ~L2687) asoma −43 px a 600 y no sigue el stack de `.dc-row`.
- **`[DECANT-TOPE-CONTADOR]`** — el contador de perfumes "a consultar" del armador infla (7 mostrados, 6 reales): restar los que tienen decant custom.
- **`[DEPOSITO-HISTORIAL-UNIFICADO]`** — el pase depósito→local deja **2 registros** (`deposito_update` + `stock_update`) en vez de uno que diga "movió N del depósito al local".
- **`[DEPOSITO-TRANSFERENCIA-EVENTO]`** (22-sep, salió de `[LOG-EMPLEADA]`) — el mismo par de eventos, visto desde el Log: hoy se muestran pegados con `〃` **sin afirmar que hubo transferencia** (decisión 35 del DISEÑADOR). Unificarlos en un evento único "movió N del depósito al local" es esto; se cruza con `[DEPOSITO-HISTORIAL-UNIFICADO]`, que es el mismo problema del lado del registro.
- **`[ESPERA-ERROR-CRUDO]`** (23-sep, anotado por el PREPARADOR) — la ventana «Avisame» muestra el error de la base tal cual («Error: …»). No se tocó.
- **`[GUIA-DESACTUALIZADA]`** (24-sep, salió de `[INVENTARIO-ARCHIVOS]` · 🟢) — `guia.html` («Guía del equipo»: pública, `noindex`, sin credenciales) no cambia de contenido desde el **23-abr**: no cubre el Depósito, Pedidos pass ni el Log de las empleadas. Alejo les pregunta a las chicas si la usan: si no, va a `.vercelignore`; si sí, se actualiza. Vercel no tiene Web Analytics, así que no hay datos de visitas.
- **`[NAV-REPITE-BARRA]`** (24-sep, del DISEÑADOR, para después · 🟢) — con la barra de abajo, el nav del celu repite Carrito, Cuenta y Favoritos. No se toca hasta que lo dibuje el DISEÑADOR.
- **`[COMBO-PROMO-NULL]`** (23-sep, ídem) — `applyOverrideRowToMemory` (`admin.html` ~L8566) pisa `p.promo` del combo con `NULL` porque chequea `typeof !== 'undefined'`, y `toggleComboStock` crea justo esa fila con promo `NULL`. No se tocó.
- **`[FINAL-COMPARANDO]`** (24-sep, salió de L · 🟢 propuesta) — con «comparar» prendido, WhatsApp sube 49 y al final de la página vuelve a tapar el ©: 16,7 px a 390, 17,5 a 360 (la reserva de 140 cuenta sin comparar). Y debajo del pie quedan ~80 px del fondo de la página (en claro, una franja crema bajo el pie oscuro). Del DISEÑADOR.
- **`[QUITAR-ETIQUETA-CONTRASTE]`** (24-sep, salió de K · 🟢 propuesta) — «✕ QUITAR» de la etiqueta (`.btn-etq-quitar`, `admin.html`): `#e74c3c` sobre `#333` = **3,31** en los dos temas. No estaba en la K. Del DISEÑADOR.
- **`[SW-BANNER-SMART]`** (se había perdido el 18-sep; decisión del DISEÑADOR el 23-sep) — el banner "Nueva versión del panel" aparece sólo sin modal abierto, sin campo con foco y sin nada sin guardar; si no, espera al próximo cierre de modal o cambio de pestaña; **nunca recarga solo**.
- **`[MODAL-PRECIO-MUERTO]`** (del PREPARADOR, 22-sep) — `modalPrice` y su historial en `localStorage` son código muerto: los precios se cambian desde Editar (`perfume_edit · Precio`). Decide Alejo: borrarlo o volver a conectarlo (¿cambiar un precio desde Precios & Stock sin ir a Editar?).
- **`[CACHE-CONTROL-1W]`** (23-sep, salió del repaso) — 61 fotos con `max-age=3600` en vez de una semana: las subidas de perfume nuevo y de combo no pasan `cacheControl`.
- **`[RESUMEN-23H]`** (del PREPARADOR, 22-sep) — el Telegram de las 23 h todavía no muestra el depósito; cuando lo muestre, sale de `resumen_stock_dia()` (los mismos `dep_*`).
- **`[SATURACION-BADGES]`** (del PREPARADOR) — saturación ×0,6 de las badges de stock: 771 con "Mostrar pausados" prendido, 699 en pantalla por defecto. Del DISEÑADOR.
- **`[VERDES]`** (del PREPARADOR) — sin detalle en los docs del repo: está en su inventario. El dato del 23-sep (`.td-price` en claro, `#2ecc71` sobre blanco = 2,1) quedó resuelto en G: el efectivo de Precios es `.td-efectivo` (`#1b5e20` en claro, 7,87).
- **`[ALTA-NOMBRE-3-LINEAS]`** (del PREPARADOR) — sin detalle en los docs del repo: está en su inventario.
- **`[LAUTARO-MIMANODERECHA]`** — uno de los tres temas del orden de trabajo del 18-sep; sin brief todavía.
- **`[CUENTAS-POR-EMPLEADA]`** — las dos chicas comparten `empleado@…`: no se puede medir uso por persona. Cuenta por persona + el panel entendiendo varios mails de empleada. Requiere acuerdo con ellas.
- **`[AVISOS-PRIORIDAD]`** (12-ago) — ventana de privilegio para la lista de espera (los ⭐ se enteran primero, el producto sigue oculto N horas). Diseño cerrado, SQL escrito sin testear en [`docs/PLAN_AVISOS_PRIORIDAD.md`](docs/PLAN_AVISOS_PRIORIDAD.md). Requiere acuerdo previo con las chicas (apartar unidades de verdad).
- **`[PERMISOS-TABS-JEFE]`** — permisos de tabs configurables por el jefe · postergado.
- **`[PUNTOS-DECANTS]`** — sistema de puntos para decants desde el armador.
- **`[UPLOADER-WEBP-AUTO]`** — estandarizador automático del uploader (compresión + resize webp).
- **`[TIKTOK-SLIDE]`** — TikTok como slide con video + link. ⚠️ El slider está eliminado (NO ROMPER #2): revisar si sigue teniendo sentido.
- **`[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]`** (20-sep, salió de `[CLICKS-RESUMEN]`) — `docs/SECURITY.md` tiene descripciones del problema *original* en presente debajo de headers "✅ RESUELTO" (ej. S14 § `send_telegram`, L368) que pueden citarse por error como estado vigente. Pasarlas a pasado o marcarlas como históricas.
- **`[TAP-44]` tanda 2** (22-sep · al 24-sep: **27 cortos de 602**, la base de `.action-btn` subió 10; el catálogo cerró su parte en E) — quedaban **37 controles reales por debajo de 44 px, de 602** (eran 38 de 601 antes de `[LOG-EMPLEADA]`: el buscador del Log suma un control y el ↺ dejó de ser corto) (+ 6 checkbox que no cuentan: el `<label>` ya mide 44, decisión 8). Medidos con Inter cargada: **ya no hay "casi"** — el más alto de los cortos mide 36 px —, así que son 38 decisiones del DISEÑADOR una por una, sin regla que las cierre de golpe. Se miden con `node scripts/medir_targets.js`. · El botón de lista de espera del catálogo ya mide 44 en los tres estados, y «Consultar» también (E, 24-sep).

### 🎯 Orden de trabajo (decidido por Alejo el 18-sep-2026)

1. **Tanda de seguridad chica, una sesión:** ~~`[TELEGRAM-ANON-ABIERTO]`~~ ✅ y ~~`[SW-PRECACHE-PERFUMES]`~~ ✅ hechos el 19-sep. Quedan **`[SECURITY-AUDIT-S1]` + `[VERCEL-ENV-VARS]`** (Alejo a mano; Claude Code verifica después).
2. **Los tres temas:** `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]` (sin brief todavía; se definen al arrancar cada uno).

Ordenar el repo: **de a poco, dentro de cada tema** — no antes (era recomendación del cowork, no decisión de Alejo).

Lista completa con detalles en `docs/HISTORIA.md`.

---

## 💬 Comunicación esperada conmigo

- Soy **Alejo**, hablamos en castellano rioplatense.
- Soy técnico (entiendo código) pero no me gustan los rewrites sin explicación.
- Antes de cambios grandes / riesgosos: **explicame el riesgo** y dame opción.
- Cuando termines algo: **resumime qué hiciste**, no solo "listo".
- Si encontrás un bug ortogonal mientras hacés algo, no lo arregles solo — flageámelo.
- Cuando dudes entre opciones, dame las opciones (idealmente en tabla) en vez de elegir solo.
- Sí me gustan los emojis en respuestas (con moderación). En código solo si lo pido.

### 🎭 Roles del equipo (definidos por Alejo el 21-sep-2026)

| Rol | Quién | Qué hace |
|---|---|---|
| **DISEÑADOR** | ClaudeChat | Dibuja: dimensiones, botones, qué se ve y qué se toca. A él se le pregunta lo estético / visual / interactivo. No aplica ni mide. |
| **PREPARADOR** | ClaudeChat (rol de revisión) | Revisa lo del diseñador (y viceversa), se repregunta, manda a corregir, y arma el prompt **limpio** para Claude Code: base (`commit` + blob), archivos enteros para SQL, checklist con números, orden de despliegue, quién decide qué. |
| **CLAUDE CODE** | esta sesión | **Acciona**: ritual git → aplica → mide (navegador, base, producción) → reporta números. Corrige **sólo si es necesario**. Cuando algo del prompt no cierra con el repo o la base, no rediseña: devuelve **hechos** (línea, medida, ACL, hash) dirigidos al PREPARADOR. No elige por Alejo ni aplica dos versiones de lo mismo. |

Un prompt que llega "de 3" ya pasó por dos revisiones: menos preguntas de alcance, más ejecución — pero la verificación contra repo/producción no se saltea (eso es el "corregir si es necesario"). Lo estético lo decide el DISEÑADOR con Alejo; Claude Code lo mide. Las decisiones siguen siendo de Alejo: una "recomendación" sin su firma se pregunta una sola vez (#88).

**Enrutar, no enterrar — en UN solo bloque.** Cada vez que Claude Code se cruza con algo que no es suyo, lo saca con **texto listo para pegar**, nunca como una frase perdida en un párrafo. Desde el **22-sep-2026** (regla propuesta por el PREPARADOR, decidida por Alejo) el turno termina con **un único bloque dirigido al PREPARADOR**: `## 🧾 Para el PREPARADOR — mandale esto tal cual`. Lo que sea para el DISEÑADOR va **adentro** de ese bloque, marcado ("Para el DISEÑADOR, adentro de este bloque: …"); el PREPARADOR lo verifica y lo rutea. **No** se mandan bloques separados por destinatario.

> Qué va adentro: 📐 lo estético / visual / interactivo (medidas, radios, colores, qué se ve y qué se toca), con el número que lo motiva · 🧾 lo que cambia un prompt futuro (bases `commit` + blob, hechos del repo o de la base que contradicen el diseño, colisiones con `main`, prompts superados) · hechos medidos, nunca "creo que".
> Lo único que queda **afuera** del bloque es lo que decide Alejo (`🧑 Para Alejo (decidís vos)`, una línea con las opciones): eso no se reenvía a nadie.

Alejo es el único humano de la cadena: cada mensaje extra que tiene que clasificar es carga suya, no de Claude Code. El objetivo sigue siendo que los tres trabajen a la vez y él sólo copie y pegue — **una vez por turno**.

**Skills globales** (21-sep, en `C:\Users\Alejo\.claude\skills\`, valen en todos los proyectos): `/idea` (ficha en `docs/IDEAS.md`, sin tocar código), `/arranque` (tablero de quién espera qué), `/enrutar` (el bloque único de arriba, sistemático), `/bases` (commit + blob + EOL + SW real para el PREPARADOR). Detalle en `docs/SLASH_COMMANDS.md` § Skills globales.

**Flujos de trabajo multi-agente: sí, pero sólo cuando hace falta** (decisión de Alejo, 23-sep-2026). Para barridos y auditorías (seguridad, inventarios, revisar un cambio grande antes de mergear). No para aplicar un prompt ya decidido. **Antes de lanzar uno, Claude Code le dice a Alejo qué va a barrer y con cuántos agentes, y espera su OK.**

---

## 🚀 Workflow típico

```
1. git status / git pull
2. Hacer cambios (con Read + Edit, no Write masivos)
3. Si tocás archivos cacheados → bump SW en sw.js
4. git add -A
5. git commit -m "tipo(scope): descripción"
6. git push
7. Vercel deploya solo (~1 min)
```

No suelo hacer PRs en este repo — es un solo dev. Commits van directo a `main`.

---

**Última actualización:** **Septiembre 24, 2026 (después de la J)** — el `_s` del PREPARADOR (**parte K**: decisiones 94-96 del DISEÑADOR, «la letra la decide el fondo, no el tema», y `[RELOAD-CON-LOGIN]`) y el `_t` (**parte L**: decisiones 97 y 98 de Alejo), cada una en su rama con su bump, las dos en producción. **K** (SW **v1.1.128**, `cfa4717`): **`[BOTONES-CONTRASTE]`** (WhatsApp `#1a1a1a` 8,78 y gris `#fff` 7,46 en los dos temas) · **`[CINTA-TINTA]`** (la cinta de la card con letra `#fff` o `#000` según la luminancia del color —mínimo 5,44 con los 7 colores del panel—, sin sombra, el texto escapado y el color sólo si es hex o `rgb()` válido; los 7 botones de etiqueta del panel y la vista previa, con la misma regla) · **`[ESTADO-LOCAL]`** (hero en claro: abierto 7,87, feriado 7,18; la flotante opaca en los tres estados y los dos temas, blanca a `.7rem`, y en feriado «Feriado · abrimos <cuándo>») · **`[RELOAD-CON-LOGIN]`** (`.auth-overlay.open` + la ventana de juegos + «Avisame»). Al medirlo salió **`[RELOAD-NUNCA]`**: `.compare-modal` está en la lista y existe siempre, así que la recarga automática del sitio no se dispara nunca desde que existe. **Alejo decidió dejarla apagada (B):** con CSS/JS/fuentes en network-first desde `3cee019` (12-may), cada carga con red ya trae la versión nueva, y la versión nueva se detecta justo en esa carga: recargar no mostraría nada nuevo; cerrado sin código. **L** (SW **v1.1.129**, `f976a64`): **`[FINAL-FLOTANTES]`** (la reserva de abajo del celu pasa a 140 + safe-area: el © termina 32,3 px arriba de WhatsApp a 390 y 31,5 a 360) · **`[INVITACION-BAJO-BANNER]`** (las dos invitaciones en top 105, 8 px debajo del banner blanco y negro). `npm run contraste`: 0 fallas + 1 token pisado, 192 mediciones (las filas nuevas dan 17 fallas sobre el `main` anterior). Detalle en `docs/HISTORIA.md` § "Sesión 24-sep-2026 · `_s` + `_t`". **Pendientes (mismo orden que § Pendientes, 45):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · `[S10-TER-XSS-COMBOS]` · 🟡 `[RESET-EXPIRES]` · `[S3-VAULT]` · `[S4-OREGON]` · `[SUPABASE-AUTH]` · `[AUTH-ES-STAFF]` · `[BCRYPT-RESTO]` · `[TELEGRAM-PANEL-401]` · `[LIGHT-MAYO-56]` · `[COMBOS-PAUSADOS-VISIBLES]` · `[ESPERA-MAS]` · `[SIRENITA]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[LOGIN-INTENTOS-CLEANUP]` · `[MEDIR-TEMP-SWEEP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[DEPOSITO-TRANSFERENCIA-EVENTO]` · `[ESPERA-ERROR-CRUDO]` · `[GUIA-DESACTUALIZADA]` · `[NAV-REPITE-BARRA]` · `[COMBO-PROMO-NULL]` · `[FINAL-COMPARANDO]` · `[QUITAR-ETIQUETA-CONTRASTE]` · `[SW-BANNER-SMART]` · `[MODAL-PRECIO-MUERTO]` · `[CACHE-CONTROL-1W]` · `[RESUMEN-23H]` · `[SATURACION-BADGES]` · `[VERDES]` · `[ALTA-NOMBRE-3-LINEAS]` · `[LAUTARO-MIMANODERECHA]` · `[CUENTAS-POR-EMPLEADA]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[TAP-44]` tanda 2. **La barra en un iPhone:** Alejo la probó el 24-sep (vertical, horizontal, la app instalada y el teclado de Buscar): todo bien. **Orden de trabajo:** `[VERCEL-ENV-VARS]` (Alejo) → `[S10-TER-XSS-COMBOS]` cuando Alejo lo ponga en la fila → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

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

*Ubicación de este archivo: `D:\workspace\ST_Perfumeria\CLAUDE.md`*
