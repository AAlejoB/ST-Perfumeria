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

### Setup

```js
// admin.html
function setupRealtimeStock() {
  sb.channel('admin-stock-sync')
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'perfume_overrides' },
        function(payload) {
          // Actualiza cache local y re-renderiza
          // Parpadeo amarillo en la fila modificada
        }
    )
    .subscribe();
}
setTimeout(setupRealtimeStock, 1500); // tras login
```

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
