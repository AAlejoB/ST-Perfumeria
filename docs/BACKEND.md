# BACKEND — ST Perfumería

> Todo lo relacionado a la capa de datos / servidor / sincronización:
> Service Worker, Supabase Auth, Realtime, Vercel functions, push
> notifications, cron jobs, audit log, lógica de negocio del admin.
>
> Si tu pregunta es "cómo guardamos X" o "por qué este flujo se rompe en
> producción" — está acá.
> Para CSS/HTML/layout → `FRONTEND.md`.
> Para schema/tablas/RLS → `DATABASE.md`.

---

## 🛠️ Stack del backend

| Pieza | Herramienta | Notas |
|---|---|---|
| BaaS | Supabase (Postgres + Realtime + Storage) | Free tier |
| Auth admin | Supabase Auth (email + password) | 2 cuentas: jefe y empleado |
| Auth cliente | Custom (telefono + password plano en `clientes`) | ⚠️ Pendiente migrar a bcrypt |
| Realtime | Supabase channels | `admin-stock-sync` |
| Serverless | Vercel functions (Edge runtime para OG) | `/api/cron/`, `/api/og/` |
| Push notifications | Web Push API + VAPID | Edge function `send-push` |
| Hosting | Vercel | Free, deploy auto en push |
| Cron | Vercel Cron Jobs (1 daily en Hobby) | Backup diario |
| Service Worker | Custom `sw.js` | Versionado manual |

---

## 🔐 Auth admin (Supabase Auth)

### Flujo de login

```js
// En admin.html
async function doLogin() {
  // 1. Probar como jefe
  var r1 = await sb.auth.signInWithPassword({ email: JEFE_EMAIL, password: pass });
  if (r1?.data?.user) role = 'jefe';
  else {
    // 2. Probar como empleado
    var r2 = await sb.auth.signInWithPassword({ email: EMPLEADO_EMAIL, password: pass });
    if (r2?.data?.user) role = 'empleado';
  }
  if (role) {
    await enterAdminPanel(role);
    logAdminAction('login_success', null, null);
  }
}
```

**Lockout:** después de N intentos fallidos hay cooldown progresivo. Estado guardado en `localStorage`.

**Auto-logout por inactividad:**
- Jefe: límite más laxo
- Empleado: más estricto
Loguea en `admin_actions` y notifica por Telegram.

**Sesión persistente:** Supabase Auth guarda el JWT en localStorage automáticamente. `resumeSession()` lo lee al cargar la página.

### Roles

| Rol | Cómo se distingue | Acceso |
|---|---|---|
| `jefe` | Email coincide con `JEFE_EMAIL` | TODAS las tabs |
| `empleado` | Email coincide con `EMPLEADO_EMAIL` | Tabs sin `data-role="jefe"` |

`applyRolePermissions()` aplica `body.role-empleado` que activa CSS para ocultar items con `data-role="jefe"`.

---

## 👤 Auth cliente (custom, A MIGRAR)

### Estado actual

Tabla `clientes` con columnas `telefono` + `password` (texto plano).

Login en `js/app.js`:
```js
var existing = await sb.from('clientes').select('id, nombre, telefono, password').eq('telefono', phone).limit(1);
var cliente = existing.data[0];
if (cliente.password === pass) { ... } // ⚠️ COMPARACIÓN EN PLANO
```

### Por qué se hizo así

Velocidad inicial. Funciona pero es inseguro:
- Si la DB se filtra → contraseñas en claro
- La gente reusa pass → robar IG/Gmail/etc.

### Plan de migración (lazy bcrypt)

1. Agregar `bcryptjs` vía CDN en `index.html` (5KB).
2. En login (línea ~378 de `app.js`):
   - Si `cliente.password` arranca con `$2` → bcrypt, comparar con `bcrypt.compare`
   - Si no → es plano, comparar plano. Si match: hashear y guardar (`UPDATE clientes SET password = hashed`). Próximo login usa hash.
3. En register: hashear ANTES de insertar.

**Riesgo del cambio para clientes:** CERO (transparente, lazy migration). +200ms en primer login.

**Tiempo total:** 30-60 min.

### Plan a futuro: Supabase Auth

Migrar a `auth.users` con relación a `clientes` vía `auth_uid`. Beneficios:
- Reset por email gratis
- JWT con TTL
- RLS más limpia

**Cuándo:** una semana sin grandes cambios (no mezclar bugs de auth con UI).

---

## 🔄 Realtime entre tablets

### Setup (con watchdog, mayo 2026 en adelante)

`admin.html` mantiene una máquina de estados para el canal de Realtime que
se reengancha sola, hace polling de respaldo, y muestra un indicador visual
del estado de sincronización.

**Estados:** `INIT` → `CONNECTING` → `LIVE` ↔ `DEGRADED` ↔ `RECONNECTING`

| Estado | Qué hace | UI |
|---|---|---|
| INIT | Recién montado, sin canal | (oculto) |
| CONNECTING | Pidió subscribe, esperando | 🟡 "Conectando…" |
| LIVE | Recibiendo eventos en tiempo real | 🟢 "En vivo" |
| DEGRADED | WebSocket caído, polling cada 10s | 🟠 "Modo respaldo" |
| RECONNECTING | Intentando volver a LIVE, backoff 2s→60s | 🟡 "Reconectando…" |

**Triggers de transición:**
- Callback de `.subscribe(status, err)` (`SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`).
- `visibilitychange` (vuelve al foco) → `resyncFromDB` + reintentar canal si no estaba LIVE.
- `online` / `offline` events del navegador.
- Heartbeat propio cada 60s: si >90s sin mensajes en LIVE → resync forzado silencioso.

**En modo DEGRADED:**
- Polling cada 10s sobre `perfume_overrides` con `select` mínimo + filtro `gt('updated_at', rtLastSyncAt)` (diferencial).
- Backoff exponencial para reintentar el canal: 2s, 4s, 8s, 16s, 30s, 60s (max).
- Si el resync trae cambios, las filas afectadas **sí** parpadean (la empleada tiene que ver que algo cambió).
- Reset de backoff sólo al pasar a `SUBSCRIBED`.

**Resync silencioso post-SUBSCRIBED:**
- Al volver a LIVE, `resyncFromDB({ silent: true })` recupera lo que se perdió mientras estaba caído.
- En este caso **no** flashea filas (sería ruido visual si trae cambios viejos). Los próximos UPDATEs por Realtime sí flashearán.

**Anti-echo:** cada `savePrice` / `saveStock` setea `lastLocalUpsert = { slug, at: Date.now() }`. Cuando llega el evento de Realtime, si el slug coincide y pasaron <2s, no se flashea la fila (es mi propio eco).

**Indicador visual:** pill `#syncIndicator` en el header. Definido en CSS `.sync-indicator` y manejado por `renderSyncIndicator()`. En pantallas <480px sólo se muestra el puntito (texto oculto, `title` queda).

### Trigger SQL requerido (one-time)

```sql
-- Ver sql/add_updated_at_trigger.sql
CREATE TRIGGER perfume_overrides_updated_at
  BEFORE UPDATE ON perfume_overrides
  FOR EACH ROW
  EXECUTE FUNCTION trg_perfume_overrides_set_updated_at();
```

Sin este trigger, `updated_at` queda fijo en el `DEFAULT NOW()` del INSERT
inicial y el polling diferencial nunca devuelve cambios.

Aplicado en producción el 2026-05-13 via Supabase MCP (`apply_migration`).

### Consumo (Supabase Pro)

Polling 10s × 2 tablets × 12h/día ≈ 1.7 MB egress/día ≈ 52 MB/mes.
Estás usando el **0.02%** del límite Pro de 250 GB.

### Qué escuchaba antes (ELIMINADO)

Hasta v1.0.80 también escuchaba `INSERT` en `ventas` para mostrar toast tipo "💵 Empleada X vendió perfume Y". Removido junto con la tab "Registrar Ventas" (el jefe va a re-pensar el flujo).

La función `showSaleToast` y `saleToastStack` también fueron eliminadas.

### Cómo agregar realtime a una tabla nueva

1. En Supabase Dashboard → Database → Replication → activar la tabla.
2. En el JS:
   ```js
   sb.channel('mi-canal').on('postgres_changes',
     { event: 'UPDATE', schema: 'public', table: 'mi_tabla' },
     callback
   ).subscribe();
   ```
3. Si necesitás polling diferencial: agregar columna `updated_at` con trigger
   `BEFORE UPDATE` (ver patrón en `sql/add_updated_at_trigger.sql`).
4. Considerá si necesitás también el watchdog completo (estados / backoff /
   indicador). Si la tabla es crítica como `perfume_overrides`, copiá el patrón.

---

## ⚠️ Resilencia frente a Supabase degradado

Supabase (como todo servicio cloud) tiene degradaciones temporales: las queries
pueden tardar más de lo esperado o no responder durante minutos. SLA Pro = 99.9%
uptime = hasta **~8 horas/año** de degradación aceptable. No es la DB la que se
"cae" — los datos quedan intactos —, suele ser la capa Cloudflare/PostgREST del
front o problemas de ruta regional.

### Defensas instaladas en el frontend

| Capa | Qué hace | Dónde está |
|---|---|---|
| **Timeout 3s en queries** | Si Supabase tarda más, no se cuelga, sigue con fallback | `app.js` (helpers `loadPerfumesNuevos`, `loadOverrides`, etc — buscar `timeout: 3000`) |
| **Cache local stale-while-revalidate** | Guarda la última respuesta exitosa por 30 min; si Supabase falla, sirve la cacheada | mismos helpers; clave `st_cache_<query>` en localStorage |
| **Seed hardcoded** | 150 perfumes en `js/perfumes.js` como último recurso si todo lo demás falla | `js/perfumes.js` |

### Cómo se ve en el sitio cuando Supabase está caído

| Cosa | Estado degradado |
|---|---|
| Catálogo | Muestra los 150 perfumes del seed (sin los agregados por admin) |
| Hot Sale en cards | Sin mostrar (porque viene de `perfume_overrides`) |
| Destacados | Vacíos / hardcoded |
| Horario operativo | Cae al default (10-20 hs) |
| Trust badges | Solo los del HTML estático (1 visible típicamente) |
| **Carrito → WhatsApp** | **Funciona OK** — wa.me no depende de Supabase |
| **Catálogo navegable** | **Sí** — el cliente puede igual ver/agregar/consultar |

### Incidente de referencia: 14-may-2026 (madrugada)

Verificado con curl desde la zona de Alejo: queries a `*.supabase.co/rest/v1/`
con status 522 (Cloudflare→origin timeout) tras 92s. Otro intento timeouteó a
los 5s sin respuesta. Status page de Supabase decía "All Systems Operational"
(suelen tardar en updates de incidentes regionales).

El sitio siguió funcional (con los 150 hardcoded). No se perdieron ventas — el
checkout vía WhatsApp NO depende de Supabase en tiempo real.

### Qué hacer si vuelve a pasar

1. **Esperar 15-60 min** — la mayoría de blips se autoresuelven
2. **Verificar status:** https://status.supabase.com + https://status.supabase.com/api/v2/status.json (API)
3. **Test directo con curl:**
   ```bash
   curl -s --max-time 10 \
     -H "apikey: ANON_KEY" \
     "https://rtgjzzkjrwbkdhkslxix.supabase.co/rest/v1/perfumes_nuevos?select=slug&limit=1" \
     -w "\nstatus: %{http_code}, time: %{time_total}s\n"
   ```
   Si status ≠ 200 o time > 5s → degradado.
4. **Soporte Pro:** Dashboard Supabase → Support → submit ticket (Alejo es Pro, tiene soporte directo)
5. **Si persiste >2h:** considerar subir el timeout en `app.js` (3000 → 8000ms)

### Lo que NO está documentado todavía y deberíamos

- [ ] Monitoring alert (Telegram?) cuando una query falla N veces seguidas
- [ ] Healthcheck periódico del frontend a Supabase (no implementado)
- [ ] Página de status interna `/status` para que el jefe la abra en mobile

---

## 🔔 Push Notifications (Web Push)

### Arquitectura

1. Cliente toca botón "Recibí ofertas" → pide permiso al browser.
2. Browser genera `PushSubscription` con endpoint + keys.
3. Se guarda en tabla `push_subscriptions` (Supabase).
4. Admin envía push → Edge function `send-push` itera suscriptores y manda con VAPID.

### VAPID keys

Hardcoded en admin (public + private). La private NO debe quedar en client-side production, pero por simplicidad inicial está ahí. Para Fase 2 mover a env var.

### Service Worker

```js
// sw.js
self.addEventListener('push', function(event) {
  var data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      data: { url: data.url },
      actions: [{ action: 'open', title: 'Ver ahora' }]
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  // Foca tab abierta o abre nueva
});
```

### Banner público de anuncios

`announcements` tabla con los últimos 3 pushes (últimos 7 días). Aparece como banner cerrable en index.html. Dismissals con TTL 24h en localStorage.

---

## 💾 Service Worker (sw.js)

### Versionado MANUAL

```js
var CACHE_VERSION = 'v1.0.82';   // ← incrementá cada commit que toca archivos cacheados
```

⚠️ **REGLA SAGRADA:** cada vez que tocás `index.html`, `admin.html`, `app.js`, `perfumes.js` o `styles.css` → BUMPEAR EL SW. Sino los usuarios siguen viendo el archivo viejo.

Versiones recientes:
| Versión | Cambio principal |
|---|---|
| v1.0.79 | Decants alfabético + agregados arriba |
| v1.0.80 | Eliminada tab "Registrar Ventas" |
| v1.0.81 | Hotfix sintaxis rota en setupRealtimeStock |
| v1.0.82 | Columna Acción removida de Precios |

### Estrategias por tipo

```js
// HTML → network-first con fallback a cache + offline
// CSS/JS/fuentes → stale-while-revalidate
// Imágenes → cache-first
// Supabase / WhatsApp / Telegram → network-only (no cachear)
```

### Precache en install

```js
var PRECACHE_URLS = [
  '/', '/index.html', '/offline.html',
  '/css/styles.css', '/js/app.js', '/js/perfumes.js',
  '/manifest.json', '/img/icon-st.svg'
];
```

Si fallás `add` individualmente → log warning pero no rompe la install.

---

## 🎯 Sistema de puntos

### Flow general

1. **Manual** (único flow vivo actualmente): el jefe ajusta puntos desde la tab "🎯 Puntos" → modal Sumar/Restar con motivo.
2. **Automático (DESACTIVADO):** antes registrarVenta sumaba puntos automáticamente. Eliminado con la tab Ventas.

### Tablas involucradas

- `puntos_config`: 1 sola fila con conversiones (`puntos_por_perfume`, `puntos_por_decant`, `puntos_por_set_combo`, `threshold_proximo_premio`, `mensaje_promo`).
- `puntos_log`: cada movimiento (delta, motivo, actor, venta_id si aplica).
- `clientes.puntos`: balance actual.
- `ventas.puntos_otorgados`: cuánto sumó esa venta (lo usaba la lógica automática para revertir al eliminar venta).
- `ventas.cliente_id_puntos`: quién recibió esos puntos.

### Mensaje contextual

En el banner amarillo "EXPLORÁ NUESTRO CATÁLOGO" hay un sub-banner que aparece SOLO si el cliente está logueado y tiene puntos. Lógica:

```js
// js/app.js renderPuntosBanner()
if (puntos === 0) msg = '¡Hola X! Sumá puntos por cada compra...';
else if (resto === 0 && puntos >= threshold) msg = '⭐ Tenés N pts · ¡Pedí un premio!';
else if (resto >= threshold - 1) msg = '⭐ Tenés N pts · SUMÁ 1 MÁS Y CONSULTÁ POR TU PREMIO 📲';
else msg = 'Hola X! Saldo: N';
```

Threshold y mensaje editables desde admin tab "🎯 Puntos".

---

## 📊 Audit log

```js
// admin.html
async function logAdminAction(action, target_slug, changes) {
  await sb.from('admin_actions').insert({
    actor_email: email,        // del JWT de Supabase Auth
    actor_role: currentRole,    // 'jefe' | 'empleado'
    action: action,             // 'stock_update', 'price_update', 'login_success', etc.
    target_slug: target_slug,
    changes: changes            // { old, new } JSON
  });
}
```

Inmutable (RLS no permite UPDATE ni DELETE para anon/auth). 60 días retención.

Cuando agregues una acción nueva del admin, **llamá `logAdminAction()`** para que quede trazado quién/cuándo/qué cambió.

---

## 🔄 Backup automático

### Cron de Vercel

`/api/cron/backup.js` corre **1 vez al día** (Hobby plan permite solo 1 cron diario):

```js
// vercel.json
"crons": [{ "path": "/api/cron/backup", "schedule": "0 3 * * *" }]
```

Recolecta tablas críticas (perfumes_nuevos, perfume_overrides, combos, destacados, cierres, horario, votación, decants, clientes, opiniones, lista_espera, votos) y guarda 1 snapshot en tabla `backups`.

Retención: 15 días o 200 snapshots, lo que ocurra antes.

### Backup manual

Desde tab "💾 Backup" del admin (solo jefe). Mismo flow pero on-demand.

### Fallback en login

`maybeAutoBackup()` se llama 3s tras login. Si el último backup tiene >24h, dispara uno (silencioso, no bloquea).

---

## 🌐 Vercel functions

### `/api/cron/backup.js`
Cron diario. Snapshot de DB.

### `/api/og/perfume.js`
Genera OG image dinámica por perfume (Edge runtime, retorna `<svg>` o `<png>`). Para que cuando comparten un link de perfume por WhatsApp aparezca preview personalizada.

### `/api/send-push.js`
Edge function que recibe `{ title, body, url }` + lista de subs, manda push con VAPID.

---

## 🗓️ Horario del local

Tabla `ajuste_horario` permite override del horario default. Lógica en `js/app.js`:

```js
sb.from('ajuste_horario').select('*').order('created_at', { ascending: false }).limit(1)
```

Si hay un ajuste vigente (`desde <= hoy <= hasta`), reemplaza `HORARIOS[1..5]` y `HORARIOS[6]`.

### Bug histórico de timezone

**Síntoma:** jefe guardaba horario 21:00 ARG y la web seguía mostrando 20:00.

**Causa raíz:** admin guardaba `desde` con `new Date().toISOString().split('T')[0]` que devuelve UTC. A las 23:08 ARG ya es día siguiente UTC, entonces el ajuste no aplicaba HOY (su rango era "desde mañana").

**Fix definitivo:** usar zona horaria Argentina al guardar:
```js
var hoyAR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
var hoyARStr = hoyAR.getFullYear() + '-' + String(hoyAR.getMonth()+1).padStart(2,'0') + '-' + String(hoyAR.getDate()).padStart(2,'0');
```

Lección: **NUNCA `toISOString()` para fechas locales** — usar el TZ explícito.

---

## 🔔 Notificaciones a Telegram (al admin)

`notifyTelegram(msg)` manda POST a `api.telegram.org/bot.../sendMessage` con el token.

Eventos que disparan:
- Login exitoso (con rol)
- Auto-logout por inactividad
- Lockout por intentos fallidos
- Backup creado
- Acciones críticas (delete perfume, etc.)

---

## 📌 NO ROMPER (lecciones backend)

1. **Bumpear SW** cada commit que toca archivos cacheados.
2. **Timezone Argentina** al guardar fechas (no UTC).
3. **`logAdminAction()`** en cada mutación importante.
4. **No remover RLS** sin pensar en seguridad.
5. **No exponer service_role key** en el cliente (solo anon).
6. **Cron Vercel Hobby: 1 daily máximo** (no agregar más).
7. **No mezclar Supabase Auth (admin) con custom auth (clientes)** — son flujos separados.

---

## 🐛 Bugs históricos del backend

### RLS bloqueando lecturas anónimas
Síntoma: tabla nueva creada y la web pública no podía leer.
Fix: SIEMPRE crear policy `select_public USING (true)` al crear tabla.

### Sintaxis JS rota tras refactor
Síntoma: login no funcionaba después de eliminar tab Ventas.
Causa: regex DOTALL al borrar listener INSERT dejó `catch(e) {}` huérfano.
Lección: después de regex masivo, leer el bloque resultante antes de pushear.

### Backup cron fallaba en deploy
Síntoma: Vercel Hobby rechaza schedule `0 */2 * * *` (limita a 1 cron diario).
Fix: cambiar a `0 3 * * *`.

### Push subscriptions duplicadas
Síntoma: misma persona recibía 3 notifs.
Fix: dedupear por `endpoint` antes de insertar (`onConflict: 'endpoint'`).

---

**Última actualización:** mayo 2026. Actualizar cuando cambien decisiones de auth, realtime, cron, push o SW.
