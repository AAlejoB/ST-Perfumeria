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

Si no lo bumpeás, los usuarios siguen viendo el archivo viejo cacheado. Versión actual al momento de escribir esto: **v1.1.78**.

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

1. 💸 **Bajar proyecto viejo Supabase Oregon** (`rtgjzzkjrwbkdhkslxix`) — **lo más caro y lo más fácil.** El rollback window venció el 28-may; si sigue activo van ~2,5 meses de 2 proyectos Pro (**≈ USD 60-75 de más**). Pausar es reversible y no toca código. ⚠️ Verificar primero que siga ACTIVE.
2. 🔴 **`[BCRYPT-MIGRATION]` / S2** — `clientes.password` sigue PLANO **y es remotamente explotable**: la anon key es pública y `clientes` tiene `SELECT public USING(true)` → cualquiera baja teléfonos + passwords por REST. Apretar la RLS a secas rompe el login → mitigar con función `SECURITY DEFINER`. Ver `docs/SECURITY.md` § S2.
3. 🟠 **`[SECURITY-AUDIT-S1]` (re-scoped 27-jun)** — las constantes están en **L2778-2779** y **el login admin YA NO las usa** (usa Supabase Auth) → no es login-bypass. Queda: borrar `ADMIN_PASS_EMPLEADO` (código muerto) + sacar `ADMIN_PASS` del JS público cambiando la auth de `/api/send-notification`. **+ S10 nuevo:** stored XSS por `c.nombre` sin escapar en la tab Clientes (~L3900).
4. 🟡 **Migrar a Supabase Auth** — solo en una "semana sin grandes cambios".
5. 🟡 **Tab "Orden de compra sugerida"** (on-demand, opción C definida).
6. ✅ ~~**Botón "Olvidé mi contraseña"**~~ — HECHO y **TESTEADO E2E en producción** 27-jun (`[FORGOT-PASS-A]` `db9d485` + fix del aviso WhatsApp `[FORGOT-PASS-WA]` `3e52dbd` + nombre del cliente en la tab `eefdfe9`). Cerrado.
7. 🟢 **Permisos de tabs configurables por jefe** — postergado.
8. 🟢 **Sistema de puntos para decants** desde el armador.
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

**Última actualización:** **Agosto 12, 2026** — cierre de la sesión 27-jun parte 2 (el trabajo técnico es del 27-jun · la doc se cerró el 12-ago tras 6,5 semanas sin actividad · `origin/main` quedó clavado en `196586e` y el sitio corrió estable todo ese tiempo). **`[FORGOT-PASS-A]` CERRADO y verificado E2E en producción** (cliente pide → admin resetea → cliente re-loguea con clave nueva · puntos intactos · 3 Telegrams confirmados). Se arregló **`[FORGOT-PASS-WA]`** (el `window.open` de "Avisar por WhatsApp" corría tras `await`+`setTimeout` → sin *user activation* → bloqueado por el pop-up blocker · ahora es link tappable · `3e52dbd`) y se sumó el nombre del cliente en "Pedidos pass" (`eefdfe9`). SW v1.1.75 → **v1.1.78**. En seguridad (`196586e`): **S1 re-scopeado** (el login admin ya NO usa las passwords hardcoded), **S2 agravado** (RLS abierta + anon key pública = passwords en plano por REST) y **S10 nuevo** (stored XSS en la tab Clientes). Detalle en `docs/HISTORIA.md` § "Sesión 27-jun-2026 · parte 2" + `docs/SECURITY.md`. **Pendientes (orden):** 💸 bajar Oregon (~USD 60-75 de más) · 🔴 `[BCRYPT-MIGRATION]`/S2 · 🟠 S1 re-scoped + S10 · 🟡 rotar token TG y DB pass · 🟢 CLS iter 5, SW-BANNER-SMART, logo @2x, `?width=400`, JS-CHUNK iter 2.

<details>
<summary>Contexto histórico previo (27-jun mañana)</summary>

Sesión larga con 2 features grandes ANDANDO: **`[TG-RESUMEN-DIARIO]`** (resumen diario de Telegram al cierre 23:00 ART · función SQL `daily_summary` + `pg_cron` + 6 notifs instantáneas silenciadas · commit `1ded56a`) que reemplaza el bombardeo de 16-114 Telegrams/día, y **`[FORGOT-PASS-A]`** (recuperación de contraseña de clientes COMPLETA · tabla `password_reset_requests` + botón "¿Olvidaste tu contraseña?" en login + tab admin "Pedidos pass" · commit `db9d485` · reusa el flujo "primer login setea pass", NO toca el login existente). También: badge violeta admin `[BADGE-LAST-VIOLETA]` (`42b5dce`), 3 slash commands implementados (`.claude/commands/`), CodeGraph MCP instalado, QA post Plan B OK. SW v1.1.71 → **v1.1.75**. **Telegram CONFIRMADO funcionando** (el `[FIX-TELEGRAM-PG-NET]` del 21-may era falsa alarma · obsoleto · el worker de pg_net tardó en arrancar y las queries vía psql se colgaban, pero vía MCP responden bien). **El MCP de Supabase es ahora la vía principal para SQL/infra** (psql/pg_dump desaparecieron del sistema · `C:\Program Files\PostgreSQL\18\` vacío). 🚨 **Issues de seguridad SIGUEN pendientes** (de la sesión 21-may): passwords admin **HARDCODED en `admin.html` L2766-2767** · agendado **`[SECURITY-AUDIT-S1]`** (CRÍTICO). Detalle exhaustivo en `docs/HISTORIA.md` § "Sesión 27-jun-2026" + `docs/BACKEND.md` + `docs/DATABASE.md`. **Pendientes:** ⚠️ **`[SECURITY-AUDIT-S1]`** (CRÍTICO) · `[BCRYPT-MIGRATION]` (más relevante con FORGOT-PASS activo) · **bajar proyecto viejo Oregon** (pagando 2 Pro desde 28-may) · `git pull` en main repo desincronizado · **testear FORGOT-PASS-A** con cuenta de prueba · CLS Desktop iter 5 · `[SW-BANNER-SMART]` · logo @2x · imágenes con `?width=400` · JS-CHUNK iter 2 · SUPABASE-AUTH.

</details>

*Ubicación de este archivo: `D:\workspace\ST_Perfumeria\CLAUDE.md`*
