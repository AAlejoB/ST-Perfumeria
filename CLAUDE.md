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
| Auth | Custom phone+password en tabla `clientes` | ⚠️ **Pass en plano — pendiente migrar a bcrypt** |

---

## 📂 Estructura de archivos

```
ST_Perfumeria/
├── index.html              ← Página pública (catálogo, decants, etc.)
├── admin.html              ← Panel admin (jefe + empleadas) — con sidebar lateral desde [ZAPATO] may-2026
├── offline.html
├── sw.js                   ← Service Worker (versionado manual)
├── manifest.json           ← PWA
├── mockups.html            ← Archivo único de mockups (convención may-2026, lección #7). Esqueleto vacío entre sesiones.
├── js/
│   ├── app.js              ← Core JS del front público (~6500 líneas tras [JS-CHUNK])
│   ├── extras.js           ← Chunk lazy-loaded (armador decants) — se carga con requestIdleCallback
│   └── perfumes.js         ← Array de los ~150 perfumes (catálogo seed)
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
| `clientes` | Auth custom (telefono + password en plano) + datos + `puntos` |
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

Si no lo bumpeás, los usuarios siguen viendo el archivo viejo cacheado. Versión actual al momento de escribir esto: **v1.1.64**.

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
9. **Auth: pass en plano por ahora** — si se modifica el flujo, mantener compat con clientes existentes (lazy migration, ver `docs/HISTORIA.md`)

---

## 🔐 Cuentas de admin

- **Jefe**: rol `jefe` — ve TODAS las tabs
- **Empleadas**: rol `empleado` — ve solo las tabs sin `data-role="jefe"`

Definido en la lógica de admin.html (`currentRole`).

> **Desde 15-may-2026** (commit `eaae7cf`) la tab "💧 Decants" es visible para empleadas también (antes era solo jefe). Si querés esconder solo la sección de "config global de precios escalera" a empleadas pero dejarles cargar decants de diseñador, podés agregar `data-role="jefe"` a las cards específicas en lugar de a toda la tab.

---

## 📌 Pendientes conocidos (con prioridad)

1. 🔴 **Hashear contraseñas con bcrypt** (lazy migration) — riesgo de seguridad.
2. 🟡 **Migrar a Supabase Auth** — solo en una "semana sin grandes cambios".
3. 🟡 **Tab "Orden de compra sugerida"** (on-demand, opción C definida).
4. 🟢 **Permisos de tabs configurables por jefe** — postergado.
5. 🟢 **Botón "Olvidé mi contraseña"** estilo A (avisa al admin por Telegram).
6. 🟢 **Sistema de puntos para decants** desde el armador.
7. 🟢 **Wireframe Juegos ST** (Quiz + Desafío side by side).
8. 🟢 **Estandarizador automático del uploader del slider** (compresión + resize webp).
9. 🟢 **TikTok como slide del slider con video + link**.

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

**Última actualización:** Mayo 20, 2026 — sesión LOGIN-RETRY-SP (Plan A · reintento silencioso por latencia Supabase Oregon). Diseñado con ClaudeChat (instancia separada, archivos preservados en `RECOMENDACIONES_CLAUDECHAT/`) · ejecutado por Claude Code con mejora `[LOGIN-RETRY-TELEMETRY]` para medir frecuencia en producción. Fix en commit `267e7e2` · solo `admin.html` (40 líneas en 1 sola función `_doAuthOnce`) + SW bump. **Comportamiento:** loop de hasta 2 intentos · si 1ro arroja timeout → "Reintentando…" 1.2s → 2do intento · timeout 8s→10s · NO cuenta timeout como fail · NO reintenta con pass incorrecta · `notifyTelegram` cuando reintento es exitoso. **Plan B** (migración Supabase us-west-2 → sa-east-1 São Paulo) **documentado pero NO ejecutado** · activar solo si telemetría muestra muchos reintentos por semana · ver `RECOMENDACIONES_CLAUDECHAT/Plan_B_*.md`. SW v1.1.66 → **v1.1.67**. Sesión 18-may-2026 (CLS Reserve Banners mobile · commit `a761035`) sigue siendo el último cambio visual · desktop CLS sigue pendiente (`svg.search-icon` score 0.858 + sel ST grid). **Pendientes abiertos:** validar telemetría Plan A en 1-2 semanas (¿Plan B necesario?) · **CLS Desktop iter 3** · cache Supabase Storage (1h → 1 año en dashboard) · A11y 92 → 100 (5 contrastes) · logo @2x retina · imágenes Supabase con `?width=400` · JS-CHUNK iter 2 · BCRYPT-MIGRATION · SUPABASE-AUTH.
