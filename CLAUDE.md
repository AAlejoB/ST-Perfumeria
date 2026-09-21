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
├── mockups.html            ← Archivo único de mockups (convención may-2026, lección #7). Esqueleto vacío entre sesiones.
├── js/
│   ├── app.js              ← Core JS del front público (~6500 líneas tras [JS-CHUNK])
│   ├── extras.js           ← Chunk lazy-loaded (armador decants) — se carga con requestIdleCallback
├── css/
│   └── styles.css          ← TODO el CSS (~8000 líneas) — incluye light mode + admin sidebar
├── img/                    ← Logos, banners
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

Si no lo bumpeás, los usuarios siguen viendo el archivo viejo cacheado. Versión actual al momento de escribir esto: **v1.1.105** (20-sep-2026, noche).

> **Desde v1.1.32 (sesión 15-may-2026)** existe `[PWA-AUTO-RELOAD]`: cuando se deploya una versión nueva del SW, el frontend RECARGA SOLA la página (sin que el cliente toque F5 ni cierre tabs) — siempre que NO esté interactuando (modal abierto / input focused / scroll < 3s). Ver `docs/HISTORIA.md` para detalles.
>
> **Desde v1.1.35 (sesión 15-may-2026)** existe `[SW-UPDATE-BANNER]` en admin · rediseñado en v1.1.39 a versión "Amarillo BIG" (`[SW-BANNER-V2]`): cuando se detecta una versión nueva, aparece un banner sticky-top con ícono 🔄 grande en círculo negro + título "Nueva versión del panel disponible" + subtítulo + botón "ACTUALIZAR" gigante. A diferencia del público, en admin **NO hace auto-reload** — la chica decide cuándo (podrían estar en medio de una venta).
>
> **Técnica `[EMERGENCY-BUMP]` (15-may-2026)**: si una tablet del admin se "queda colgada" con cache híbrido, bumpear el SW sin cambios reales fuerza el flujo `[PWA-AUTO-RELOAD]` en clientes con SW v1.1.32+ y la tablet recarga sola en ~2 min sin que las chicas tengan que tocar nada. Patrón replicable.

Estrategias por tipo de recurso (definidas en `sw.js`):
- HTML → network-first con fallback a cache + offline
- CSS/JS/fuentes → stale-while-revalidate
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

### Sort default
- `renderCatalog()` SIEMPRE termina con `sortCards('price-desc')`. No removerlo.

### Light mode
- Tema controlado por clase en `<body>`. Default = `dark-mode` (presente al iniciar). Toggle = `body.classList.toggle('dark-mode')`.
- Light mode = `body:not(.dark-mode)` en CSS.
- **Excepciones que SIEMPRE quedan oscuras** (decisión del jefe): trust badges, banner "EXPLORÁ NUESTRO CATÁLOGO", banner "Tenés X puntos", cards de Categorías.
- Paleta light: `#e3d6b3` bg, `#ede2c2` cards, `#1a1a1d` texto, `#8a6d00` acento dorado-marrón.
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
7. **Categorías y trust badges quedan oscuros también en light** (decisión del jefe)
8. **Tabs del admin con `data-role="jefe"`** son SOLO para el jefe. Para empleadas, no poner ese atributo.
9. **Auth de clientes: SÓLO por las RPC `cliente_*`** (`sql/fase1.sql`) — el sitio público no lee ni escribe `clientes` (anon no tiene policies). Cualquier flujo nuevo que necesite la tabla va como función `SECURITY DEFINER`, nunca como `from('clientes')` desde `app.js`. Compat con clientes existentes garantizada por la migración perezosa.

---

## 🔐 Cuentas de admin

- **Jefe**: rol `jefe` — ve TODAS las tabs
- **Empleadas**: rol `empleado` — ve solo las tabs sin `data-role="jefe"`

Definido en la lógica de admin.html (`currentRole`).

> **Desde 15-may-2026** (commit `eaae7cf`) la tab "💧 Decants" es visible para empleadas también (antes era solo jefe). Si querés esconder solo la sección de "config global de precios escalera" a empleadas pero dejarles cargar decants de diseñador, podés agregar `data-role="jefe"` a las cards específicas en lugar de a toda la tab.

---

## 📌 Pendientes conocidos (con prioridad)

> **Convención (desde 18-sep-2026):** el identificador de cada pendiente es su **keyword entre corchetes** — no el número de posición (los números se reordenan y se repetían: había 7 y 8 dos veces). Acá quedan **sólo los abiertos**; al cerrar cada sesión, `/handoff` mueve los resueltos a `docs/HISTORIA.md` § "✅ Resueltos" con su texto completo. Orden: 🔴 → 🟠 → 🟡 → 🟢, y dentro de cada grupo por importancia.

### 🔴 Urgentes

- **`[VERCEL-ENV-VARS]`** (12-ago) — Vercel **no tiene NINGUNA variable de entorno**: el backup propio, el alta de suscriptores y el envío de push están **rotos desde mayo**. Reponer `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASS`, `VAPID_*`, `CRON_SECRET`. La service key se copia **directo Supabase→Vercel, nunca por chat**. Ver `docs/SECURITY.md` § S12. Lo hace **Alejo a mano**; Claude Code verifica después (cron, fila nueva en `backups`, push). Se destraba con `[SECURITY-AUDIT-S1]`. *(S11, la trampa que había acá, ya está arreglada · `ef1507d`.)*

### 🟠 Altos

- **`[SECURITY-AUDIT-S1]`** (re-scoped 27-jun) — las constantes `ADMIN_PASS` / `ADMIN_PASS_EMPLEADO` siguen en `admin.html` (público, ~L2778); el login admin **ya no las usa** (Supabase Auth) → no es login-bypass. Queda: **rotar la contraseña** (Alejo), borrar `ADMIN_PASS_EMPLEADO` (código muerto) y sacar `ADMIN_PASS` del JS cambiando la auth de `/api/send-notification` (se cruza con `[VERCEL-ENV-VARS]`). Ver `docs/SECURITY.md` § S1. *(S10, el XSS de la tab Clientes, ya está resuelto · `f457b89`. S10-bis, el mismo patrón en Lista de espera y Opiniones, también resuelto · ver HISTORIA.md.)*
- **`[S13-ESCRITURAS-ANON]` / S2-bis** (16-sep) — `favoritos`, `votos` y `opiniones` se escriben como `anon` con el `user_id` del localStorage: cualquiera puede escribir a nombre de otro cliente conociendo su uuid (ya no se listan desde S2, baja mucho la explotabilidad). Se resuelve de verdad con `[SUPABASE-AUTH]`. Ver `docs/SECURITY.md` § S13.

### 🟡 Medios

- **`[BACKUP-FOTOS-LOCAL]`** (12-ago) — bajar el bucket `perfume-fotos` a `D:\backups\`. Los backups diarios de Supabase **NO incluyen Storage** (lo avisa el propio panel); hoy la única segunda copia son los archivos del proyecto viejo de Oregon. Lo hace Claude Code (script de descarga).
- **`[RESET-EXPIRES]`** (17-sep) — `password_reset_requests.expires_at` **no se respeta**: la tabla pone 24 h por default pero `loadResetRequests` (`admin.html`) filtra sólo por `status = 'pending'`; un pedido de hace 5 días aparece en "Pedidos pass" como de hoy. Fix: filtrar `expires_at > now()` (o marcar vencidos) y mostrar la antigüedad.
- **`[S3-VAULT]`** — `send_telegram` lleva el token como constante en el cuerpo de la función; pasarlo a `vault.secrets`. (Token **ya rotado** el 17-sep; el valor vive sólo en Supabase.) Ver `docs/SECURITY.md` § S3.
- **`[ROTAR-DB-PASS]` / S5** — las DB passwords de ambos proyectos pasaron por chat en la migración de mayo; reset desde Settings → Database. Lo hace Alejo (~30 s cada una). Ver `docs/SECURITY.md` § S5.
- **`[SUPABASE-AUTH]`** — escalón 3 de S2: migrar los clientes a Supabase Auth (`auth.uid()` en policies, mantener `clientes.id` uuid). Resuelve `[S13-ESCRITURAS-ANON]` y la deuda de `cliente_puntos` / `cliente_reset_solicitar` (responden con sólo el teléfono). Sólo en una "semana sin grandes cambios".
- **`[ORDEN-COMPRA-SUGERIDA]`** — tab "Orden de compra sugerida", on-demand, opción C definida.

### 🟢 Bajos

- **`[CLIENTES-PRUEBA]`** — borrar `549000000000[12]` (Test QA, de la verificación de S2) desde "Eliminar definitivamente" del panel; de paso prueba `clientes_delete_auth`. Lo hace Alejo.
- **`[LOGIN-INTENTOS-CLEANUP]`** — `pg_cron` que borre de `cliente_login_intentos` las filas de más de un día (crece con cada intento fallido de cualquier número, exista o no).
- **`[RESET-TEMP-PASSWORD-MUERTA]`** (17-sep) — `password_reset_requests.temp_password` es **columna muerta** (reservada en `[FORGOT-PASS-A]`, el panel nunca la usa): dropearla o documentarla como no usada en `DATABASE.md`.
- **`[DC-HEADER-600]`** — el mini-header de columnas del grid de decants de diseñador (`admin.html` ~L2687) asoma −43 px a 600 y no sigue el stack de `.dc-row`.
- **`[DECANT-TOPE-CONTADOR]`** — el contador de perfumes "a consultar" del armador infla (7 mostrados, 6 reales): restar los que tienen decant custom.
- **`[DEPOSITO-HISTORIAL-UNIFICADO]`** — el pase depósito→local deja **2 registros** (`deposito_update` + `stock_update`) en vez de uno que diga "movió N del depósito al local".
- **`[CUENTAS-POR-EMPLEADA]`** — las dos chicas comparten `empleado@…`: no se puede medir uso por persona. Cuenta por persona + el panel entendiendo varios mails de empleada. Requiere acuerdo con ellas.
- **`[SECURITY-SCAN-CMD-VALORES]`** — `.claude/commands/security-scan.md` conserva las dos contraseñas de S1 como ejemplo (único doc que las tiene). Decide Alejo.
- **`[AVISOS-PRIORIDAD]`** (12-ago) — ventana de privilegio para la lista de espera (los ⭐ se enteran primero, el producto sigue oculto N horas). Diseño cerrado, SQL escrito sin testear en [`docs/PLAN_AVISOS_PRIORIDAD.md`](docs/PLAN_AVISOS_PRIORIDAD.md). Requiere acuerdo previo con las chicas (apartar unidades de verdad).
- **`[PERMISOS-TABS-JEFE]`** — permisos de tabs configurables por el jefe · postergado.
- **`[PUNTOS-DECANTS]`** — sistema de puntos para decants desde el armador.
- **`[JUEGOS-ST-WIREFRAME]`** — Quiz + Desafío side by side.
- **`[UPLOADER-WEBP-AUTO]`** — estandarizador automático del uploader (compresión + resize webp).
- **`[TIKTOK-SLIDE]`** — TikTok como slide con video + link. ⚠️ El slider está eliminado (NO ROMPER #2): revisar si sigue teniendo sentido.
- **`[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]`** (20-sep, salió de `[CLICKS-RESUMEN]`) — `docs/SECURITY.md` tiene descripciones del problema *original* en presente debajo de headers "✅ RESUELTO" (ej. S14 § `send_telegram`, L368) que pueden citarse por error como estado vigente. Pasarlas a pasado o marcarlas como históricas.

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

**Última actualización:** **Septiembre 20, 2026 (noche)** — **`[CLICKS-RESUMEN]` RESUELTO** (rama `fix-clicks-resumen` → `main` fast-forward `6b44d80`, docs `7dbfaec`, SW **v1.1.104 → v1.1.105**, deploy verificado con `curl` contra producción): `loadPerfumeViews()` (catálogo público) y `loadStats()` (panel) dejan de leer `perfume_clicks` cruda (230.901 filas; su RLS de `SELECT` exige `authenticated` → el visitante anónimo leía 0 filas y "más visitados" caía al alfabético en silencio, sin avisar) y pasan a `sb.rpc('perfume_clicks_resumen')` (`SECURITY DEFINER`, agrupa por slug en Postgres — 264 filas en vez de 230k+ — con `EXECUTE` **a propósito** para `anon`: verificado en producción `anon=true`, `authenticated=true`, `public=false`). `admin.html` además deja de pagar un `count:'exact',head:true` aparte para "Visitas totales": suma el resumen (`SUM(clicks) = COUNT(*) = 230.901`, verificado idéntico). Documentado con estos valores reales en `docs/DATABASE.md` (subsección nueva) y `docs/SECURITY.md` (tabla "✅ Lo que SÍ está OK") — **sin** copiar el estilo de S14/L368, que describe un problema ya resuelto en presente (ver pendiente nuevo abajo). Verificado con un harness de Node sobre el código real extraído de los archivos (3 escenarios: datos/error/vacío, 21 asserts) en vez de instalar Playwright/Puppeteer (decisión de Alejo). Detalle en `docs/HISTORIA.md` § "Sesión 20-sep-2026 (más tarde) · `[CLICKS-RESUMEN]`". **De yapa, cierre de proceso retroactivo:** la tanda `[S10-BIS-XSS-ESPERA-OPINIONES]` + `[WA-LINK-549-DUPLICADO]` (resuelta más temprano hoy, ver `<details>` de abajo) nunca había tenido su commit `docs: cierre sesión` — queda cerrada formalmente ahora. **Pendiente nuevo:** `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` 🟢 — `docs/SECURITY.md` tiene descripciones del problema *original* en presente debajo de headers "✅ RESUELTO" (ej. S14 § `send_telegram`, L368) que pueden citarse por error como estado vigente; pasarlas a pasado. **Pendientes (mismo orden que § Pendientes):** 🔴 `[VERCEL-ENV-VARS]` · 🟠 `[SECURITY-AUDIT-S1]` · `[S13-ESCRITURAS-ANON]` · 🟡 `[BACKUP-FOTOS-LOCAL]` · `[RESET-EXPIRES]` · `[S3-VAULT]` · `[ROTAR-DB-PASS]` · `[SUPABASE-AUTH]` · `[ORDEN-COMPRA-SUGERIDA]` · 🟢 `[CLIENTES-PRUEBA]` · `[LOGIN-INTENTOS-CLEANUP]` · `[RESET-TEMP-PASSWORD-MUERTA]` · `[DC-HEADER-600]` · `[DECANT-TOPE-CONTADOR]` · `[DEPOSITO-HISTORIAL-UNIFICADO]` · `[CUENTAS-POR-EMPLEADA]` · `[SECURITY-SCAN-CMD-VALORES]` · `[SECURITY-MD-DESCRIPCIONES-EN-PRESENTE]` · `[AVISOS-PRIORIDAD]` · `[PERMISOS-TABS-JEFE]` · `[PUNTOS-DECANTS]` · `[JUEGOS-ST-WIREFRAME]` · `[UPLOADER-WEBP-AUTO]` · `[TIKTOK-SLIDE]`. **Orden de trabajo:** lo que queda de la tanda de seguridad (S1 + env vars, a mano) → `[DISEÑOACORTADOR-PANELADMIN]` → `[LAUTARO-MIMANODERECHA]` → `[FACILITAR-MOBILE-EN-CATALOGO]`.

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

**Última actualización:** **Agosto 12, 2026 (tarde/noche)** — sesión **`[FOTOS-OREGON]`**. Se fue a bajar el proyecto viejo de Oregon y se descubrió que **la migración de mayo había quedado a medias**: **97 filas en 5 tablas** apuntaban las fotos al servidor viejo (el navegador sólo mostraba 80 · **la BD es la fuente de verdad, el navegador el testigo**). Corregidas con respaldo + ensayo + bloque atómico, y verificado doble: **0 rastros en la BD** y **141 imágenes desde São Paulo, 0 rotas** en el sitio vivo. Oregon **no se pudo pausar** (deshabilitado en plan pago) → Alejo creó la organización Free **`BACKUP_ST_desdeMayo2026`** y **transfirió el proyecto**: costo → 0, **sin borrar nada**, y queda como única segunda copia de las fotos. **Hallazgos nuevos:** Vercel **no tiene ninguna variable de entorno** (backup propio + push rotos desde mayo · `[VERCEL-ENV-VARS]`), los backups diarios de Supabase **sí funcionan pero NO incluyen las fotos** (`[BACKUP-FOTOS-LOCAL]`), y **S11**: auth *fail-open* en `/api/send-notification`. **S2 medido:** 82 fichas y 78 contraseñas en texto plano descargables con la clave pública. También se arregló **`[WAITLIST-AVISO-REAL]`** (el aviso de "Avisame cuando vuelva" fallaba en silencio y encima reportaba éxito: marcaba a todos como avisados ANTES de mandar nada e intentaba abrir N ventanas de WhatsApp que el pop-up blocker frenaba · `0dc444f`) y quedó **diseñada** la ventana de privilegio `[AVISOS-PRIORIDAD]` (ver `docs/PLAN_AVISOS_PRIORIDAD.md`). Se arregló **`[DECANTS-ESPACIO]`** (un cliente real no pudo agregar decants: el marco fijo del armador se comía el 67% del modal y dejaba UNA card visible en celular · ahora 3-5 · ojo: mi primera hipótesis `min-height:0` era FALSA, ver `docs/FRONTEND.md` § Decant builder). Features nuevas **`[DEPOSITO]`** (pestaña con el stock del depósito, aparte del local · columna `perfume_overrides.stock_deposito` · ambos roles), **`[PAUSADO-OCULTO]`** (los pausados = ARCHIVADOS ya no salen en ningún lado público · 71 productos · el panel decía que los ocultaba y era mentira), **`[OCULTAR-PAUSADOS]`** (casilla "Mostrar pausados", ambos roles, preferencia por dispositivo) y **`[OCULTAR-VALOR-INV]`** (la empleada no ve el valor de inventario) · commit `c5678ae` · **SW v1.1.78 → v1.1.83**. Detalle exhaustivo en `docs/HISTORIA.md` § "Sesión 12-ago-2026 (tarde/noche)" + `docs/SECURITY.md`. **Pendientes (orden):** 🔴 `[BCRYPT-MIGRATION]`/S2 · 🔴 `[VERCEL-ENV-VARS]` (con S11 antes) · 🟡 `[BACKUP-FOTOS-LOCAL]` · 🟠 S1 re-scoped + S10 · 🟡 rotar token TG y DB pass · 🟢 CLS iter 5, SW-BANNER-SMART, logo @2x, `?width=400`, JS-CHUNK iter 2.

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
