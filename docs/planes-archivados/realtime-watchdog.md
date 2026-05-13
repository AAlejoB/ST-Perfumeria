# Plan de implementación — Realtime + Watchdog para sincronización entre tablets

> Documento para Claude Code. Lo escribió Claude Opus 4.7 (planning) tras analizar el repo `ST_Perfumeria`.
> Autor de referencia: Alejo Bello. Castellano rioplatense, técnico pero no le gustan los rewrites sin explicación.

---

## TL;DR

**Objetivo:** que cuando la Tablet A descuenta stock, la Tablet B vea el cambio sin tener que refrescar — incluso si pasó por pantalla apagada, cambio de WiFi, o pestaña en background.

**Estrategia:** mantener el Realtime que ya existe (`setupRealtimeStock` en `admin.html`), pero envolverlo en un **watchdog** que detecta cuándo el canal se cayó y se reengancha solo, más un **polling de respaldo** que se activa SOLO cuando el WebSocket está caído, más un **re-sync forzado** al volver al foco.

**Archivos que tocás:**
- `admin.html` (lo grueso, ~150 líneas nuevas)
- `sw.js` (1 línea: bump de `CACHE_VERSION`)
- Supabase Dashboard → SQL Editor (1 trigger nuevo)
- `docs/BACKEND.md` (actualizar la sección "Realtime entre tablets")
- `docs/HISTORIA.md` (entrada nueva con el bug y el fix)

**Lo que NO vas a tocar:** la lógica de venta (`savePrice`, `saveStock`), el schema de `perfume_overrides`, el flujo de login, ninguna otra tab. Esto es quirúrgico.

---

## Contexto del problema (leelo aunque te aburra)

### Lo que ya existe

En `admin.html` hay una función `setupRealtimeStock()` que se subscribe a `UPDATE` de `perfume_overrides` vía Supabase Realtime. Cuando una tablet hace upsert (en `savePrice` o `saveStock`), las otras tablets reciben el evento, actualizan `p._stockQty` / `p._stockStatus` en memoria y llaman `renderPrecios()` con un parpadeo amarillo.

**Está bien programada.** El bug no es lógico, es de confiabilidad.

### Por qué falla en la vida real

Las tablets están encendidas todo el turno (12h). Durante ese tiempo:
- La pantalla se apaga → el navegador suspende la pestaña → el WebSocket de Supabase se cae silenciosamente.
- El WiFi del local tiene microcortes → la conexión se rompe.
- Android/iPad mete la pestaña en background al cambiar de app (calculadora, WhatsApp) → idem.

El cliente de Supabase **NO se reconecta automáticamente** cuando esto pasa. El canal queda en estado `CLOSED` o `CHANNEL_ERROR` y silencia para siempre. La empleada no se entera porque no hay ningún indicador visual. La única forma de "destrabarse" es F5.

### Por qué el polling solo no alcanza

Si tirábamos polling cada 10s desde el día 1, todo el mundo viviría con 10s de delay. Cuando funciona, el Realtime es instantáneo (<1s) y se siente magia. Lo que necesitamos es: **Realtime cuando se puede, polling cuando se debe, transparente al usuario**.

---

## Arquitectura: state machine del watchdog

El canal vive en uno de 5 estados:

```
  INIT
   │
   ▼
CONNECTING ────────────────────┐
   │                           │
   │ SUBSCRIBED                │ CHANNEL_ERROR / TIMED_OUT
   ▼                           ▼
  LIVE ─────────────────► DEGRADED
   ▲    CLOSED / error      │
   │                        │ backoff (2s → 60s)
   │                        ▼
   └──── SUBSCRIBED ───  RECONNECTING
```

| Estado | Qué hace | Indicador UI |
|---|---|---|
| `INIT` | Estado inicial al cargar el panel | (oculto) |
| `CONNECTING` | Pidió subscribe(), esperando respuesta | 🟡 "Conectando..." |
| `LIVE` | Recibiendo eventos en tiempo real | 🟢 "En vivo" |
| `DEGRADED` | WebSocket caído. Polling activo cada 10s | 🟠 "Modo respaldo" |
| `RECONNECTING` | Intentando volver a LIVE con backoff exponencial | 🟡 "Reconectando..." |

**Transiciones disparadas por:**
- Callback de `.subscribe(status)` de Supabase (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`).
- Evento `visibilitychange` → si vuelve a visible y estado ≠ LIVE → forzar reconexión.
- Eventos `online` / `offline` del navegador.
- Heartbeat propio cada 60s (si pasaron >90s sin recibir nada y supuestamente estamos en LIVE, hacer ping forzado).

---

## Decisiones técnicas (con justificación)

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Polling cada 10s en estado DEGRADED | Polling siempre (más simple) o cada 30s (más conservador) | Con Pro tenés 250GB de egress: el cuello de botella ya no es la red. 10s deja el peor caso aceptable. |
| Resync diferencial con `updated_at` | Resync completo de 150 filas | Aunque Pro aguanta, el diferencial es elegante y deja headroom para crecer (más perfumes, más tablets, eventual app cliente). |
| Trigger SQL para `updated_at` | Setear `updated_at` desde JS en cada upsert | Trigger es "set and forget", no se puede olvidar nadie. |
| Indicador visual en el header | Sin indicador (silencioso) | La empleada TIENE que saber si su tablet está sincronizada antes de cobrar. Es información crítica. |
| Backoff exponencial (2s, 4s, 8s, 16s, 30s, 60s max) | Reintento fijo cada N segundos | Si Supabase está caído, no queremos martillarlo. |
| Heartbeat de 60s + max 90s sin mensajes | Heartbeat más agresivo (15s) | El watchdog YA tiene visibilitychange y online events. 60s es suficiente safety net. |
| NO `notifyTelegram` desde el watchdog | Avisar a Alejo por Telegram cada desconexión | Spam. Si hay un problema persistente Alejo se entera por otros medios. |
| Mover `setupRealtimeStock` adentro de `enterAdminPanel` | Dejarlo a nivel módulo (como está hoy) | Hoy se llama incluso antes del login. Es un mini-bug pre-existente. Lo aprovechamos para limpiar. |

---

## Especificaciones de comunicación

Esta sección documenta CÓMO viajan los datos entre las piezas. Es opcional para implementar (el cliente `supabase-js` te abstrae casi todo), pero crítica para debuggear si algo se rompe.

### Piezas que se comunican

```
  ┌───────────┐                          ┌───────────┐
  │ Tablet A  │                          │ Tablet B  │
  │ (admin)   │                          │ (admin)   │
  └─────┬─────┘                          └─────┬─────┘
        │                                      │
        │ ① upsert (escritura)                 │ ④ recibe push o ⑤ pollea
        │ HTTPS POST                           │ WSS in / HTTPS GET out
        ▼                                      ▲
  ┌──────────────────────────────────────────────┐
  │           Supabase (cluster)                  │
  │  ┌─────────┐  ② trigger  ┌──────────────┐    │
  │  │ Postgres │ ──────────► │  Realtime    │    │
  │  │  + RLS   │  postgres_  │  cluster     │    │
  │  │          │  changes    │  (WebSocket) │    │
  │  └─────────┘             └──────┬───────┘    │
  │      ▲                          │             │
  │      │ ③ updated_at trigger     │ ⑥ broadcast │
  │      └──────────────────────────┘             │
  └──────────────────────────────────────────────┘
```

Pasos numerados:
1. Tablet A hace `sb.from('perfume_overrides').upsert(...)` → HTTPS POST a `https://<proyecto>.supabase.co/rest/v1/perfume_overrides`.
2. Postgres recibe el UPDATE. El trigger `perfume_overrides_updated_at` bumpea `updated_at = NOW()` (paso 3).
3. El sistema de Logical Replication de Postgres envía el cambio al cluster de Realtime.
4. Realtime cluster broadcastea el evento `postgres_changes` por el canal `admin-stock-sync-v2` a todos los clientes suscriptos.
5. Tablet B (suscripta) recibe el mensaje por WebSocket → invoca `handleRealtimePayload`.
6. (Fallback) Si la WebSocket de Tablet B está caída, su polling cada 10s hace HTTPS GET con filtro `updated_at gt <lastSync>` y trae lo nuevo.

### Protocolos y endpoints

| Operación | Protocolo | Endpoint | Cuándo se usa |
|---|---|---|---|
| Escritura (upsert de stock/precio) | HTTPS REST (POST) | `/rest/v1/perfume_overrides` | Siempre que el empleado modifica algo |
| Lectura Realtime (push) | WebSocket Secure (WSS) | `/realtime/v1/websocket` | Estado LIVE, recibe eventos automáticos |
| Lectura polling (pull) | HTTPS REST (GET) | `/rest/v1/perfume_overrides?select=...&updated_at=gt.<iso>` | Estado DEGRADED y al volver al foco |
| Auth (sesión persistente) | HTTPS REST | `/auth/v1/token` | Login y refresh automático del JWT |

Todos los endpoints van por TLS (puerto 443). No hay tráfico en claro nunca.

### Headers que viajan en cada request

El cliente `supabase-js` arma estos headers automáticamente — no los tipeás, pero te conviene conocerlos para debuggear con DevTools → Network:

```
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <JWT_DE_LA_SESION_ADMIN>
Content-Type: application/json
Prefer: return=representation     ← en upserts
```

Si ves un 401 en DevTools, lo más probable es que el JWT haya expirado y el refresh haya fallado. El cliente Supabase lo refresca solo, pero si algo lo rompe (storage corrompido, etc.) ahí está la causa.

### Formato del payload de Realtime

Cuando llega un evento por WebSocket, el callback `handleRealtimePayload(payload)` recibe esto:

```json
{
  "schema": "public",
  "table": "perfume_overrides",
  "commit_timestamp": "2026-05-12T15:34:21.123Z",
  "eventType": "UPDATE",
  "new": {
    "slug": "creed-aventus",
    "stock_qty": 3,
    "stock_status": "ok",
    "price": 85000,
    "promo": null,
    "updated_at": "2026-05-12T15:34:21.123Z",
    "...": "todas las columnas"
  },
  "old": {
    "slug": "creed-aventus",
    "stock_qty": 4,
    "..."
  },
  "errors": null
}
```

`new` es el estado nuevo, `old` el anterior. El watchdog usa `new` para aplicar el cambio. NO uses `commit_timestamp` para anti-echo — usá tu propio `lastLocalUpsert` con `Date.now()` del cliente, porque los timestamps de servidor pueden tener skew respecto al reloj de la tablet.

### Permisos (RLS) en `perfume_overrides`

Para que esto funcione, las policies de Postgres deben permitir:

- **SELECT pública** (`USING (true)`) — para que el catálogo y el polling puedan leer.
- **INSERT/UPDATE para `authenticated`** — sólo si la sesión de Supabase Auth está activa (jefe o empleado logueado).
- **DELETE bloqueado** o solo para `service_role` — no queremos que un empleado borre filas accidentalmente.

Esto ya está configurado en el proyecto (ver `docs/DATABASE.md` → sección RLS). Si Claude Code agrega columnas o cambia la tabla, mantener estas policies.

### Reintentos y manejo de errores

| Error | Quién lo maneja | Estrategia |
|---|---|---|
| `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` (WebSocket) | Watchdog | Pasa a DEGRADED + arranca polling + reintenta canal con backoff 2s, 4s, 8s, 16s, 30s, 60s. |
| HTTP 5xx en upsert | El componente que hizo el upsert (savePrice/saveStock) | Muestra error rojo al empleado. NO retry automático — el empleado decide. |
| HTTP 5xx en polling | Watchdog | Log warning. Siguiente tick lo reintenta. Sin spam. |
| HTTP 401 (token expirado) | `supabase-js` (refresh automático) | Si el refresh falla → kick a login. Lo maneja el flujo de Auth existente. |
| Pérdida de red (`offline`) | Watchdog | DEGRADED + stop polling (sin red no tiene sentido). Espera `online`. |
| Vuelve la red (`online`) | Watchdog | Resync inmediato + resubscribir canal. |
| Heartbeat: >90s sin mensajes en LIVE | Watchdog | Resync forzado (silent). Si vuelve a llegar tráfico, todo OK. |

**Lo que NO se reintenta jamás:**
- Upserts del empleado. Si falló, decide la persona si reintentarlo.
- Eventos perdidos por reconexión. Por eso al pasar a SUBSCRIBED hacemos un `resyncFromDB({ silent: true })` — recupera lo que se haya perdido mientras estábamos caídos.

### Eventos del navegador que escuchamos

| Evento | Cuándo dispara | Qué hace el watchdog |
|---|---|---|
| `visibilitychange` (→ visible) | Empleado vuelve a la pestaña / desbloquea tablet | Resync + si no estaba LIVE, reintenta canal |
| `online` | Browser detecta que volvió la red | Reintenta canal + resync |
| `offline` | Browser detecta caída de red | Pasa a DEGRADED, frena polling |
| `pageshow` (opcional, ver gotcha 6) | iOS Safari en modo PWA al volver del background | Idéntico a visibilitychange |

### Consumo estimado (con Supabase Pro)

Con polling cada 10s en peor caso, 2 tablets, 12h/día:

- Egress: 2 tablets × 6 req/min × 720 min × ~200 bytes/req = ~1.7 MB/día = ~52 MB/mes. **Estás usando el 0.02% del límite Pro (250 GB).**
- Requests: 2 × 6 × 720 × 30 = 259.200/mes. Supabase no factura por requests en sí.
- Realtime messages: ~10-50 cambios de stock/día × 30 días = 300-1.500/mes. **Estás en el 0.03% del límite (5M/mes).**

**Tenés margen de 50× sobre tu uso real sin pagar un peso extra.** Por eso el polling agresivo de 10s no es problema.

### Si querés ver el tráfico en vivo

En cualquier tablet, abrí DevTools → Network → filtrá por:
- `supabase.co` → ves los REST calls
- WS → ves el WebSocket de Realtime con sus mensajes

El Realtime Inspector de Supabase (`https://realtime.supabase.com/inspector/new`) también te deja meter las credenciales y monitorear el canal sin tocar el cliente.

---

## Implementación paso a paso

### Paso 0 — Pre-checks (5 min)

Antes de tocar nada:

```bash
git status                    # working tree limpio
git pull                      # estás en la última main
grep -n "setupRealtimeStock" admin.html   # confirmá que existe
grep -n "CACHE_VERSION" sw.js             # debe decir 'v1.1.14'
```

Si `CACHE_VERSION` ya cambió desde que se escribió este doc, usá la siguiente versión partiendo de la actual (no de v1.1.14 fija).

### Paso 1 — SQL trigger para `updated_at` (correr UNA vez en Supabase)

Esto garantiza que cada UPDATE en `perfume_overrides` bumpee `updated_at`. El polling diferencial depende de esto.

```sql
-- Idempotente: se puede correr cuantas veces quieras.
CREATE OR REPLACE FUNCTION trg_perfume_overrides_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS perfume_overrides_updated_at ON perfume_overrides;
CREATE TRIGGER perfume_overrides_updated_at
  BEFORE UPDATE ON perfume_overrides
  FOR EACH ROW EXECUTE FUNCTION trg_perfume_overrides_set_updated_at();
```

**Guardalo en `sql/add_updated_at_trigger.sql`** (siguiendo la convención del repo de tener cada cambio de schema en `sql/`).

**Verificá** con esto desde el SQL Editor:
```sql
UPDATE perfume_overrides SET stock_qty = stock_qty WHERE slug = (SELECT slug FROM perfume_overrides LIMIT 1);
SELECT slug, updated_at FROM perfume_overrides ORDER BY updated_at DESC LIMIT 3;
```
`updated_at` de esa fila debe ser de hace segundos.

### Paso 2 — Reemplazar `setupRealtimeStock` en `admin.html`

Buscá el bloque actual:

```js
function setupRealtimeStock() {
  try {
    sb.channel('admin-stock-sync')
      .on('postgres_changes', ...)
      .subscribe();
  } catch(e) {
    console.error('No se pudo activar Realtime:', e);
  }
}

setTimeout(setupRealtimeStock, 1500);
```

Reemplazalo COMPLETO con el bloque del Paso 3 (abajo). El `setTimeout(setupRealtimeStock, 1500)` a nivel módulo lo BORRÁS — ahora se llama desde `enterAdminPanel`.

### Paso 3 — Código del watchdog (pegar tal cual donde estaba `setupRealtimeStock`)

```js
// ============================================================
// SUPABASE REALTIME + WATCHDOG — sincronización entre tablets.
//
// Diseño:
//   - Estado del canal: 'INIT' | 'CONNECTING' | 'LIVE' | 'DEGRADED' | 'RECONNECTING'
//   - Si Realtime cae, polling cada 10s toma el relevo (resync diferencial
//     usando updated_at).
//   - visibilitychange / online → forzar resync + reintentar canal.
//   - Backoff exponencial en reconexiones (2s, 4s, 8s, ..., 60s max).
//   - Indicador visual #syncIndicator en el header (verde/amarillo/naranja).
//   - Echo silencioso: si recibo el UPDATE que yo mismo upserté, no flasheo
//     la fila (ver lastLocalUpsert).
//
// Histórico: ver docs/HISTORIA.md → "Watchdog de Realtime (mayo 2026)".
// ============================================================
let rtState         = 'INIT';
let rtChannel       = null;
let rtBackoffMs     = 2000;
let rtBackoffTimer  = null;
let rtPollTimer     = null;
let rtHeartbeatTimer = null;
let rtLastMessageAt = 0;
let rtLastSyncAt    = null;          // ISO string de la última fila procesada
let rtWatchdogStarted = false;
let lastLocalUpsert = { slug: null, at: 0 };  // anti-echo (ver savePrice/saveStock)

const RT_POLL_INTERVAL_MS      = 10 * 1000;  // 10s — agresivo (Pro permite holgura de egress)
const RT_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const RT_STALE_THRESHOLD_MS    = 90 * 1000;
const RT_BACKOFF_MAX_MS        = 60 * 1000;

function setRtState(next) {
  if (rtState === next) return;
  console.log('[realtime] ' + rtState + ' → ' + next);
  rtState = next;
  renderSyncIndicator();
}

function renderSyncIndicator() {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  const cfg = {
    INIT:         { dot: '#888',     text: '',                 title: 'Iniciando' },
    CONNECTING:   { dot: '#e8b800',  text: 'Conectando…',      title: 'Conectando al canal en vivo' },
    LIVE:         { dot: '#2ecc71',  text: 'En vivo',          title: 'Sincronización en tiempo real activa' },
    DEGRADED:     { dot: '#e67e22',  text: 'Modo respaldo',    title: 'Sin tiempo real. Actualizando cada 10s.' },
    RECONNECTING: { dot: '#e8b800',  text: 'Reconectando…',    title: 'Intentando recuperar tiempo real' }
  }[rtState] || {};
  el.innerHTML = '<span class="sync-dot" style="background:' + cfg.dot + '"></span>'
               + '<span class="sync-text">' + (cfg.text || '') + '</span>';
  el.title = cfg.title || '';
  el.style.display = (rtState === 'INIT') ? 'none' : 'inline-flex';
}

function applyOverrideRowToMemory(ov) {
  if (!ov || !ov.slug) return false;
  const p = PERFUMES.find(function(pf) { return pf.slug === ov.slug; });
  if (!p) return false;
  let changed = false;
  if (typeof ov.stock_qty === 'number' && p._stockQty !== ov.stock_qty) { p._stockQty = ov.stock_qty; changed = true; }
  if (ov.stock_status && p._stockStatus !== ov.stock_status)            { p._stockStatus = ov.stock_status; changed = true; }
  if (ov.price && p.price !== ov.price)                                 { p.price = ov.price; changed = true; }
  if (typeof ov.promo !== 'undefined' && p.promo !== ov.promo)          { p.promo = ov.promo; changed = true; }
  return changed;
}

function flashRow(slug) {
  const rows = document.querySelectorAll('#tbodyPrecios tr');
  rows.forEach(function(tr) {
    if (tr.querySelector('.badge-stock') && tr.querySelector('[onclick*="' + slug + '"]')) {
      tr.style.transition = 'background-color .4s ease';
      tr.style.backgroundColor = 'rgba(232,184,0,.18)';
      setTimeout(function() { tr.style.backgroundColor = ''; }, 1800);
    }
  });
}

function handleRealtimePayload(payload) {
  rtLastMessageAt = Date.now();
  if (rtState !== 'LIVE') setRtState('LIVE');
  const ov = payload && payload.new;
  if (!ov || !ov.slug) return;
  const changed = applyOverrideRowToMemory(ov);
  if (ov.updated_at) rtLastSyncAt = ov.updated_at;
  if (!changed) return;
  try { renderPrecios(); } catch(e) {}
  // Anti-echo: si yo upserté hace <2s este mismo slug, no flasheo (es mi propio eco)
  const isEcho = lastLocalUpsert.slug === ov.slug && (Date.now() - lastLocalUpsert.at) < 2000;
  if (!isEcho) setTimeout(function() { flashRow(ov.slug); }, 50);
}

function subscribeChannel() {
  if (rtChannel) {
    try { sb.removeChannel(rtChannel); } catch(e) {}
    rtChannel = null;
  }
  setRtState('CONNECTING');
  rtChannel = sb.channel('admin-stock-sync-v2')
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'perfume_overrides' },
        handleRealtimePayload)
    .subscribe(function(status, err) {
      if (status === 'SUBSCRIBED') {
        rtBackoffMs = 2000;        // reset backoff
        rtLastMessageAt = Date.now();
        stopPolling();             // si estaba polleando, basta
        setRtState('LIVE');
        // Resync por las dudas (puede haber habido cambios mientras estábamos caídos)
        resyncFromDB({ silent: true });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn('[realtime] estado problemático:', status, err || '');
        startDegradedMode();
      }
    });
}

function scheduleReconnect() {
  if (rtBackoffTimer) clearTimeout(rtBackoffTimer);
  setRtState('RECONNECTING');
  console.log('[realtime] reintento en ' + (rtBackoffMs / 1000) + 's');
  rtBackoffTimer = setTimeout(function() {
    rtBackoffTimer = null;
    subscribeChannel();
  }, rtBackoffMs);
  rtBackoffMs = Math.min(rtBackoffMs * 2, RT_BACKOFF_MAX_MS);
}

function startDegradedMode() {
  setRtState('DEGRADED');
  startPolling();
  scheduleReconnect();
}

function startPolling() {
  if (rtPollTimer) return;
  rtPollTimer = setInterval(function() { resyncFromDB(); }, RT_POLL_INTERVAL_MS);
}

function stopPolling() {
  if (rtPollTimer) { clearInterval(rtPollTimer); rtPollTimer = null; }
}

async function resyncFromDB(opts) {
  opts = opts || {};
  try {
    let query = sb.from('perfume_overrides')
      .select('slug, stock_qty, stock_status, price, promo, updated_at')
      .order('updated_at', { ascending: true });
    if (rtLastSyncAt) query = query.gt('updated_at', rtLastSyncAt);
    const { data, error } = await query;
    if (error) { console.warn('[resync] error:', error.message); return; }
    if (!data || !data.length) return;
    let touchedAny = false;
    data.forEach(function(ov) {
      if (applyOverrideRowToMemory(ov)) touchedAny = true;
      if (ov.updated_at) rtLastSyncAt = ov.updated_at;
    });
    if (touchedAny) {
      try { renderPrecios(); } catch(e) {}
      if (!opts.silent) {
        // En modo polling SÍ flasheamos lo que cambió, así la empleada lo nota
        data.forEach(function(ov) { flashRow(ov.slug); });
      }
    }
  } catch(e) {
    console.warn('[resync] excepción:', e);
  }
}

function startHeartbeat() {
  if (rtHeartbeatTimer) return;
  rtHeartbeatTimer = setInterval(function() {
    if (rtState === 'LIVE') {
      const since = Date.now() - rtLastMessageAt;
      if (since > RT_STALE_THRESHOLD_MS) {
        console.warn('[realtime] heartbeat: ' + Math.round(since/1000) + 's sin mensajes, sospechoso. Resync forzado.');
        resyncFromDB({ silent: true });
      }
    }
  }, RT_HEARTBEAT_INTERVAL_MS);
}

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  // Al volver al foco, SIEMPRE resync. Y si el canal no está LIVE, forzar resubscribe.
  resyncFromDB({ silent: false });
  if (rtState !== 'LIVE') {
    if (rtBackoffTimer) { clearTimeout(rtBackoffTimer); rtBackoffTimer = null; }
    rtBackoffMs = 2000;
    subscribeChannel();
  }
}

function onOnline() {
  console.log('[network] online');
  if (rtBackoffTimer) { clearTimeout(rtBackoffTimer); rtBackoffTimer = null; }
  rtBackoffMs = 2000;
  subscribeChannel();
  resyncFromDB({ silent: false });
}

function onOffline() {
  console.log('[network] offline');
  setRtState('DEGRADED');
  stopPolling();   // si no hay red, polling tampoco va a andar
}

// Entry point. Llamar UNA sola vez desde enterAdminPanel.
function setupRealtimeStock() {
  if (rtWatchdogStarted) return;
  rtWatchdogStarted = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  startHeartbeat();
  subscribeChannel();
}
```

### Paso 4 — Llamar `setupRealtimeStock` desde `enterAdminPanel`

Buscá `async function enterAdminPanel(role)` en `admin.html`. Al final de la función (después de `loadNuevos();` y antes del cierre `}`), agregá:

```js
  // Realtime + watchdog (1 sola vez por sesión)
  setupRealtimeStock();
```

Y borrá la línea suelta a nivel módulo que decía `setTimeout(setupRealtimeStock, 1500);` (ya no hace falta — el delay no resolvía nada y se ejecutaba incluso antes del login).

### Paso 5 — Anti-echo en `savePrice` y `saveStock`

Buscá `async function savePrice()` en `admin.html`. Después de la línea `var result = await sb.from('perfume_overrides').upsert(...)`, si `!result.error`, agregá:

```js
  lastLocalUpsert = { slug: editingSlug, at: Date.now() };
```

Hacé lo mismo en `async function saveStock()` después de su upsert exitoso.

Esto evita que veas el parpadeo amarillo de tu propio cambio.

### Paso 6 — HTML del indicador

En el header del panel admin (donde está el botón "Cerrar sesión"), agregá este span ANTES del botón:

```html
<span id="syncIndicator" class="sync-indicator" style="display:none;"></span>
```

Buscá el bloque del header con `grep -n "Cerrar sesion" admin.html` o `grep -n "doLogout" admin.html` para ubicar el lugar exacto.

### Paso 7 — CSS del indicador

Esto va en la zona de estilos de `admin.html` (es un monolito, tiene `<style>` inline). Buscá una zona de estilos del header y agregá:

```css
.sync-indicator {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  font-size: .65rem;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--gris-claro);
  padding: .35rem .65rem;
  border-radius: 4px;
  background: rgba(255,255,255,.04);
  border: 1px solid var(--borde);
  margin-right: .5rem;
  cursor: default;
  user-select: none;
}
.sync-indicator .sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.sync-indicator .sync-text {
  white-space: nowrap;
}
@media (max-width: 480px) {
  .sync-indicator .sync-text { display: none; }  /* en mobile dejamos solo el puntito */
}
```

Usá las variables CSS que ya existen en el proyecto (`--gris-claro`, `--borde`). No inventes colores nuevos. Los colores del puntito (verde/amarillo/naranja) van inline en el JS porque dependen del estado.

### Paso 8 — Bump del Service Worker

En `sw.js`, línea 16 (o donde esté):

```js
var CACHE_VERSION = 'v1.1.15';   // ← incrementá desde v1.1.14
```

Si ya estás en una versión más nueva que `v1.1.14`, hacé +1 sobre la actual. La regla SAGRADA del repo es bumpear siempre que tocás `admin.html` (y acá la tocamos a fondo).

### Paso 9 — Actualizar `docs/BACKEND.md`

Buscá la sección "🔄 Realtime entre tablets" y reemplazala con esto (mantené el resto del archivo):

```markdown
## 🔄 Realtime entre tablets

### Setup (con watchdog, mayo 2026 en adelante)

`admin.html` mantiene una máquina de estados para el canal de Realtime que
se reengancha sola, hace polling de respaldo, y muestra un indicador visual
del estado de sincronización.

Estados: INIT → CONNECTING → LIVE ↔ DEGRADED ↔ RECONNECTING

Triggers de transición:
- Callback de `.subscribe(status)` de Supabase.
- `visibilitychange` (vuelve al foco) → resync + reintentar canal.
- `online` / `offline` events.
- Heartbeat propio cada 60s (si >90s sin mensajes y supuestamente LIVE → resync forzado).

En modo DEGRADED:
- Polling cada 10s a `perfume_overrides` (`select` con filtro `gt('updated_at', lastSyncAt)`).
- Backoff exponencial para reintentar el canal: 2s, 4s, 8s, 16s, 30s, 60s max.

Indicador visual: pill `#syncIndicator` en el header. Verde = LIVE, amarillo = transicionando, naranja = DEGRADED.

### Trigger SQL requerido

```sql
-- En sql/add_updated_at_trigger.sql
CREATE TRIGGER perfume_overrides_updated_at
  BEFORE UPDATE ON perfume_overrides
  FOR EACH ROW EXECUTE FUNCTION trg_perfume_overrides_set_updated_at();
```

Necesario para que el polling diferencial funcione.

### Cómo agregar realtime a otra tabla

(Igual que antes, ver instrucciones más abajo.)
```

### Paso 10 — Agregar entrada a `docs/HISTORIA.md`

Al inicio de la lista de bugs / decisiones, agregá:

```markdown
### Watchdog de Realtime (mayo 2026)

**Síntoma:** la Tablet B mostraba stock viejo cuando la Tablet A vendía un
perfume; sólo se actualizaba con F5.

**Diagnóstico:** el Realtime de Supabase funcionaba en el primer minuto,
pero el WebSocket se caía silenciosamente cuando la pantalla se apagaba,
el WiFi tenía un microcorte, o el navegador suspendía la pestaña en
background. El canal quedaba en `CHANNEL_ERROR` o `CLOSED` y nunca se
reconectaba. No había ningún indicador visual de eso.

**Fix:** se reescribió `setupRealtimeStock` como una máquina de estados
(`INIT`/`CONNECTING`/`LIVE`/`DEGRADED`/`RECONNECTING`) con:
- detección de desconexión vía callback de `.subscribe(status)`.
- backoff exponencial para reintentos (2s → 60s max).
- polling de respaldo cada 10s SOLO en modo DEGRADED, usando filtro
  diferencial `gt('updated_at', lastSyncAt)`.
- listeners de `visibilitychange` y `online`/`offline` para forzar resync.
- heartbeat propio cada 60s como red de seguridad final.
- indicador visual `#syncIndicator` en el header (verde/amarillo/naranja).
- anti-echo: si la tablet recibe el evento de su propio upsert, no flashea
  la fila (evita ruido visual).

También requirió:
- Un trigger SQL para que `updated_at` se actualice automáticamente en
  cada UPDATE de `perfume_overrides` (sin esto el polling diferencial no
  funcionaría). Guardado en `sql/add_updated_at_trigger.sql`.
- Mover la llamada a `setupRealtimeStock` desde el nivel de módulo
  (`setTimeout(..., 1500)`) hacia adentro de `enterAdminPanel`. El llamado
  viejo se ejecutaba incluso antes del login.

**Lección:** los WebSockets en clientes con vida larga (tablets de 12h)
SIEMPRE necesitan watchdog. El Realtime de Supabase no se reengancha solo.
```

---

## Recomendaciones (gotchas a tener en mente)

Estas son las cosas que se pueden romper si las hacés mal. Te las anoto para que las tengas presentes mientras tipeás.

1. **NO subscribir dos veces.** Por eso existe `rtWatchdogStarted` y por eso `subscribeChannel` empieza haciendo `sb.removeChannel(rtChannel)`. Si subscribís dos veces, recibís el evento dos veces y `renderPrecios` se llama doble. No es catastrófico pero es feo.

2. **El callback de `.subscribe(status, err)` tiene DOS argumentos.** No tipees solo `status`. El `err` es útil para el `console.warn`.

3. **Status que existen:** `'SUBSCRIBED'`, `'CHANNEL_ERROR'`, `'TIMED_OUT'`, `'CLOSED'`. NO existe `'CONNECTING'` ni `'DISCONNECTED'` en la API de Supabase — esos son nuestros estados internos.

4. **`document.visibilityState`** puede valer `'visible'` o `'hidden'`. Algunas refs viejas usan `document.hidden` (boolean inverso). Usá el state, es más legible.

5. **`visibilitychange` también dispara cuando abrís/cerrás DevTools** en algunos navegadores. Eso es OK, simplemente vas a hacer un resync extra. No causa daño.

6. **iOS / iPad PWA tiene quirks** con visibilitychange en modo standalone. Si en testing notás que el resync no dispara al volver al foco en iPad, agregá también un listener a `window.addEventListener('pageshow', onVisibilityChange)`. Sólo si hace falta, no preventivamente.

7. **NO uses `notifyTelegram` desde el watchdog.** En un día con WiFi malo podés generar 50 notificaciones de "reconectando" a Alejo. Si querés un log persistente, usá `logAdminAction('realtime_reconnect', null, { reason })` — eso ya está en la DB y no spamea.

8. **El anti-echo en `lastLocalUpsert`** sólo cubre 2 segundos. Si la red está muy lenta y el eco vuelve a los 3s, vas a flashear tu propia fila. Es aceptable — preferible eso a no flashear cambios reales por confundirlos con eco.

9. **El polling diferencial depende del trigger SQL.** Si el SQL no se aplicó, `updated_at` queda fijo en el `DEFAULT NOW()` original de cuando se insertó la fila, y `gt('updated_at', lastSyncAt)` nunca devuelve nada. **VERIFICÁ EL TRIGGER ANTES DE PROBAR EL POLLING.**

10. **No expongas `lastLocalUpsert` como global accidentalmente.** Está bien que sea `let` a nivel del bloque del watchdog. Si lo declarás dos veces (en el watchdog y en algún otro lado) tirás un SyntaxError silencioso al cargar `admin.html`. Si Claude Code tiene dudas, hacé `grep -n "lastLocalUpsert" admin.html` antes de pegar.

11. **El `renderSyncIndicator` ignora silenciosamente si el elemento no existe** (`if (!el) return`). Eso es para que el watchdog NO falle si por alguna razón el indicador no se agregó al HTML. Defensivo.

12. **El indicador en mobile (≤480px) oculta el texto y deja solo el puntito.** Eso libera espacio en pantallas chicas. El `title` attribute sigue ahí para hover/long-press.

13. **Backoff reset SOLO en `SUBSCRIBED`.** No lo resetees en otros lados o vas a generar tormentas de reconexión.

14. **El `removeChannel` puede tirar excepción** si el canal ya estaba muerto. Por eso va envuelto en try/catch silencioso.

15. **En el resync diferencial**, ordenamos por `updated_at` ASC para que `rtLastSyncAt` quede igual a la fila MÁS RECIENTE procesada. Si ordenás DESC podés perderte cambios intermedios si llegan mientras estás procesando.

16. **El `select` del polling NO trae `foto`, `notas_*`, ni columnas grandes.** Sólo lo que cambia en una venta. Bandwidth importa para el free tier.

17. **No pongas `await` adentro del callback de Realtime (`handleRealtimePayload`).** El callback es síncrono. Si necesitás algo async, llamá una función async sin esperarla.

18. **`renderPrecios` puede fallar si la tab Precios no está montada.** Por eso va dentro de try/catch en todos los lados. Lo mismo aplica a `flashRow`.

19. **NO toques `loadStockFromDB`, `loadOverridesIntoPerfumes`, ni el flujo de `enterAdminPanel` más allá de agregar la línea final.** Esas funciones están bien y son ortogonales al watchdog.

20. **Si encontrás otro bug ortogonal mientras hacés esto, NO LO ARREGLES, flageámelo a Alejo.** Es regla del repo.

---

## Testing manual (después de implementar)

Hay que probar los 4 caminos críticos. Idealmente con 2 tablets/ventanas/incógnitos abiertos.

### Test 1 — Camino feliz (debería ser instantáneo)

1. Abrí dos pestañas en `/admin.html`, ambas logueadas.
2. En ambas, el indicador debe estar en verde con "En vivo" después de ~1-2s.
3. En la pestaña A, modificá el stock de un perfume cualquiera.
4. En la pestaña B, la fila correspondiente debe parpadear amarillo y mostrar la nueva cantidad **en menos de 1 segundo**.
5. En la pestaña A NO debe parpadear nada (anti-echo funcionando).

### Test 2 — Recuperación de visibilidad

1. Con dos pestañas abiertas en LIVE, andate a otra tab del navegador (no a otra ventana).
2. Esperá 30 segundos.
3. En la pestaña A (que SÍ está visible), modificá un stock.
4. Volvé a la pestaña B. En cuanto vuelva al foco, debe disparar un resync — la fila modificada aparece con la cantidad nueva (puede parpadear o no, según si llegó por canal o por resync).

### Test 3 — Recuperación de red

1. Con dos pestañas abiertas en LIVE, en la pestaña B abrí DevTools → Network → tildá "Offline".
2. En 5-15 segundos el indicador de B pasa a naranja "Modo respaldo".
3. En la pestaña A modificá un stock.
4. Destildá "Offline" en B. En cuanto reconecte, el indicador vuelve a verde y la fila aparece actualizada (vía el resync inicial post-SUBSCRIBED).

### Test 4 — Polling de respaldo

1. Difícil de simular sin tirar el WebSocket a propósito. Una opción: en DevTools → Application → Service Workers → marcá "Offline" pero dejá la red normal. Eso a veces rompe sólo el WS.
2. Alternativa: en consola, hacé `sb.realtime.disconnect()`. Eso fuerza CLOSED.
3. El indicador debe pasar a naranja en segundos.
4. Modificá un stock en otra pestaña. En la primera, en menos de 10s, debe aparecer el cambio (vía polling).
5. Mientras tanto, el watchdog está reintentando subscribirse en background. Si Supabase responde, el indicador vuelve a verde.

### Test 5 — Compatibilidad con el flujo viejo

1. Editar precio en pestaña A → debe persistir en DB Y verse en pestaña B (igual que antes).
2. Cambiar status pausado/activo → idem.
3. Doctor / Stats / Editar / Combos / cualquier otra tab → deben funcionar exactamente igual que antes (no tocamos esas funciones).

---

## Rollback plan

Si algo se rompe en producción y necesitás revertir rápido:

```bash
git revert <hash-del-commit-del-fix>
git push
```

El trigger SQL es seguro dejarlo (no rompe nada si no se usa). El indicador `#syncIndicator` desaparece solo porque ya no hay JS que lo manipule. Vercel redeploya en ~1 min.

Si te falta tiempo, alternativa sin git: cambiá temporalmente la línea `setupRealtimeStock();` adentro de `enterAdminPanel` por nada y bumpeá el SW. Eso "apaga" el watchdog y dejás el panel sin sincronización entre tablets (volvemos al bug original pero al menos no rompe nada).

---

## Resumen para Alejo (cuando termines)

Cuando termines, pegale un mensaje a Alejo con este formato:

> Implementé el watchdog de Realtime. Cambios:
>
> 1. `sql/add_updated_at_trigger.sql` — trigger para que `updated_at` se bumpee en cada UPDATE de `perfume_overrides`. **Lo corrí en Supabase**.
> 2. `admin.html` — reescribí `setupRealtimeStock` como máquina de estados con polling de respaldo, backoff exponencial, listeners de visibilitychange/online, heartbeat, y un indicador visual `#syncIndicator` en el header.
> 3. `admin.html` — anti-echo en `savePrice` y `saveStock` (no flashea tu propio cambio).
> 4. `sw.js` — bump a `v1.1.15`.
> 5. `docs/BACKEND.md` — sección "Realtime entre tablets" actualizada.
> 6. `docs/HISTORIA.md` — entrada nueva "Watchdog de Realtime (mayo 2026)".
>
> Probé los 4 caminos críticos: camino feliz, vuelta de foco, vuelta de red, polling de respaldo. Todos OK.
>
> Recomendaciones para vos:
> - En la primera semana, miráte el indicador del header cuando entres al panel. Si lo ves naranja seguido, contame y vemos.
> - Si en algún momento ves que el indicador queda en amarillo "Reconectando…" más de 1 minuto, recargá la tablet — significa que algo raro está pasando que no manejé.
> - Pendiente para más adelante: si querés, podemos tirarle el mismo tratamiento a otras tablas que necesiten sync (por ejemplo si activamos `ventas` o `combos`). El patrón ya está armado, copy-paste.

Commit message sugerido:

```
fix(realtime): watchdog con polling de respaldo + indicador de sync

Reescribe setupRealtimeStock como máquina de estados con reconexión
automática (backoff exponencial), polling de respaldo cada 10s en
modo DEGRADED, listeners de visibilitychange/online, heartbeat de 60s
e indicador visual en el header.

También agrega trigger SQL para updated_at en perfume_overrides
(necesario para el polling diferencial) y mueve setupRealtimeStock
del nivel módulo al final de enterAdminPanel.

Fix del bug de tablets que quedaban desincronizadas hasta F5 cuando
se cortaba el WebSocket por pantalla apagada o WiFi.

SW v1.1.15

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Apéndice: el flujo completo, en una sola figura mental

```
  ┌────────────────────────────────────────────────────────────┐
  │                       enterAdminPanel                      │
  │                            │                               │
  │                            ▼                               │
  │              setupRealtimeStock()    (1 sola vez)          │
  │                            │                               │
  │           ┌────────────────┼────────────────┐              │
  │           ▼                ▼                ▼              │
  │  document.visibility    online/offline   subscribeChannel  │
  │  change listener         listeners          │              │
  │           │                │                ▼              │
  │           │                │           [estados]           │
  │           │                │       CONNECTING→LIVE          │
  │           │                │       LIVE→DEGRADED            │
  │           │                │       DEGRADED→RECONNECTING    │
  │           ▼                ▼                ▼              │
  │       resyncFromDB ←─── trigger ───► subscribeChannel      │
  │           │                                                │
  │           ▼                                                │
  │  PERFUMES en memoria actualizado                            │
  │           │                                                │
  │           ▼                                                │
  │  renderPrecios() + flashRow(slug) (si no es echo)          │
  └────────────────────────────────────────────────────────────┘
```

Todo el resto del panel (`Editar`, `Doctor`, `Stats`, `Combos`, `Clientes`, etc.) sigue leyendo de `PERFUMES` igual que siempre. Por eso no hace falta tocar ninguna otra tab.

Buena suerte 🍀 — el plan está pensado para que sea mecánico. Si en algún paso te quedan dudas reales (no de "qué nombre le pongo a la variable" sino de "esto va a romper X"), preguntale a Alejo antes de seguir.
