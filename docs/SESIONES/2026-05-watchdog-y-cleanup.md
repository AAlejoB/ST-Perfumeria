# Sesión Mayo 2026 — Watchdog Realtime + Cleanup masivo

> Resumen de una sesión multi-tema que cubrió desde fixes chicos hasta arquitectura
> backend pesada. Escrito como handoff para el Alejo / Claude del futuro.
>
> **Status al cerrar:** todo pusheado a `main`, SW v1.1.15 deployado en Vercel.

---

## 🎯 TL;DR

- **7 commits propios** en una sola sesión cubriendo: similares, formatPrice, feriados API, votación 406, botón "Quitar foto", DVD bouncer, filtros de ocultos, purga física de perfume, **watchdog Realtime production-grade**.
- **40 commits totales en 48hs** sumando el laburo paralelo del chat frontend (light mode, Lighthouse, etc.).
- **Decisión de arquitectura tomada:** no migrar los 147 viejos a Supabase ahora — postergar para post-lanzamiento (~4 hs de trabajo).
- **Pendientes accionables que no se cerraron:** 5 items concretos abajo.

---

## ✅ Cambios commiteados a `main`

### 1. Threshold de similares más permisivo (`2fec053` aprox)

**Problema:** `findSimilares` con umbral `> 60%` dejaba **59% de los perfumes como "huérfanos"** (clic en "Ver similares" → vacío).

**Fix:** `app.js:1381` cambió `if (pct > 60)` a `if (pct >= 45)`. Cobertura subió de 41% a ~88%.

**Reversibilidad:** trivial. Si en algún momento querés más estricto, subís el número.

### 2. `formatPrice` acepta números además de strings (`2fec053`)

**Problema:** crasheaba con `TypeError: str.replace is not a function` cuando se le pasaba un número (caso real: cálculo de "Ahorrás $X" en combos). Eso rompía `renderSets`, por eso los combos no aparecían en el catálogo.

**Fix:** `app.js:850-855`. Ahora hace `String(str)` antes de `.replace`. Devuelve `''` si NaN o nullable.

### 3. API de feriados argentinos (`2fec053`)

**Problema:** `nolaborables.com.ar` está caído (DNS no resuelve). El sitio mostraba error rojo en consola cada page load.

**Fix:** switcheado a `api.argentinadatos.com/v1/feriados/{año}` con transformación de formato (devuelve `{fecha, nombre}` → mapeamos a `{mes, dia, motivo}`). Mantiene fallback `[]` si esa también cae.

**Si vuelve a caer:** considerar hardcodear feriados argentinos 2026-2027 como fallback final. No cambian día a día.

### 4. Bug 406 en `votacion_config` (`2fec053`)

**Problema:** `.single()` tiraba 406 cuando no había fila para el mes actual. Errores rojos en consola en `app.js` y `admin.html`.

**Fix:** cambiado a `.maybeSingle()` en ambos lugares — devuelve `null` si no hay fila, sin error.

### 5. Botón "Quitar foto" siempre visible (`4ce8c6a`)

**Problema:** el botón existía pero estaba con `display:none` cuando el perfume no tenía foto cargada. La feature era "invisible" → vos no la encontrabas.

**Fix:** ahora siempre visible. **Gris/disabled** si no hay foto, **rojo/activo** si hay. Discoverable.

### 6. DVD bouncer cíclico (`183b9de`)

**Antes:** a los 2:30 aparecía y rebotaba **para siempre**.
**Ahora:** cada 5 min aparece por 30 seg, se oculta, repite. Solo desktop. Cada aparición resetea posición y dirección (se siente fresca, no como "volvió a prenderse"). Pausa loop cuando tab no está visible para ahorrar CPU.

### 7. Filtro `_oculto` faltante en 6 lugares (`2b00add`)

**Bug gordo encontrado:** `_oculto` solo se filtraba en el render del catálogo principal. **Los perfumes ocultos se colaban en:**
- Buscador general (`showSearchSuggestions`)
- Recomendador por aroma/ocasión
- Similares (`findSimilares`)
- Desafío ST (misel dropdown + scoring — además había un typo `!p.oculto` sin underscore)
- Price slider (los ocultos inflaban el rango de precios)
- `markNewPerfumes` (badge NUEVO podía caer en uno oculto)

**Fix:** `!p._oculto` agregado en todos lados. Bug del Desafío también corregido.

### 8. Purga física de `cdn-untold` (`1067f81`)

**Único perfume marcado oculto en la DB.** Discutimos arquitectura y decidiste purgarlo físicamente porque sabías que no lo ibas a re-vender.

**Acción:** removido bloque de `perfumes.js` (líneas 1677-1691) + entrada del `sitemap.xml`. Google va a dar 404 en el próximo crawl y desindexar en ~2 semanas.

**⚠️ PENDIENTE MANUAL (no hecho):** correr en Supabase SQL Editor:
```sql
DELETE FROM perfume_overrides WHERE slug = 'cdn-untold';
```
No es crítico, solo limpia una fila huérfana en la tabla de overrides.

### 9. Watchdog Realtime production-grade (`96f74ca`)

**Bug crónico:** las tablets quedaban desincronizadas hasta F5 cuando el WebSocket de Supabase se caía (pantalla apagada, WiFi microcortes, tab en background). El cliente `supabase-js` no se reconecta solo.

**Solución implementada:** máquina de estados con polling de respaldo.

**Estados:** `INIT` → `CONNECTING` → `LIVE` ↔ `DEGRADED` ↔ `RECONNECTING`

**Features:**
- Detección de desconexión vía callback de `.subscribe(status, err)`.
- Backoff exponencial 2s → 60s max.
- Polling diferencial cada 10s en modo `DEGRADED` con filtro `gt('updated_at', rtLastSyncAt)`.
- Listeners `visibilitychange`, `online`, `offline`.
- Heartbeat 60s (si >90s sin mensajes en LIVE → resync silencioso).
- Indicador visual `#syncIndicator` (verde/amarillo/naranja) en el header del admin.
- Anti-echo: no parpadea la fila si es eco de upsert propio (<2s).

**Trigger SQL aplicado en prod via MCP:** `perfume_overrides_updated_at` BEFORE UPDATE que bumpea `updated_at = NOW()`. Sin esto el polling diferencial no funcionaba (la columna tenía `DEFAULT now()` pero no se actualizaba en UPDATEs).

**Archivos tocados:**
- `admin.html` (+234 líneas — bloque watchdog completo + indicador + anti-echo en savePrice/saveStock + llamada en enterAdminPanel)
- `sw.js` (v1.1.14 → v1.1.15)
- `sql/add_updated_at_trigger.sql` (NUEVO)
- `docs/BACKEND.md` y `docs/HISTORIA.md` (sección Realtime + bug histórico + tabla SW + keyword)

**Plan archivado:** `docs/planes-archivados/realtime-watchdog.md` — contiene los 20 gotchas técnicos detallados, 5 tests manuales para regression, especificaciones de comunicación, etc. Conservado por si alguien rompe el watchdog en 6 meses y necesita el "por qué" completo.

**Decisión consciente clave:** flash en DEGRADED polling **sí**, flash en resync silencioso post-`SUBSCRIBED` **no**. Razón: en DEGRADED la empleada necesita ver "esto cambió ahora aunque haya 10s de delay". En post-reconnect podrían venir cambios de hace mucho — flashearlos sería ruido confuso.

### 10. Archivado de plan + borrado de handoff efímero (`57a1a59`)

- `PLAN_REALTIME_WATCHDOG.md` → `docs/planes-archivados/realtime-watchdog.md`
- `HANDOFF_BACKEND.md` borrado (era efímero, referenciaba SW v1.1.14 ya obsoleto)
- Se estableció **convención nueva**: `docs/planes-archivados/` para planes de Claude antes de implementar.

---

## 💬 Discusiones de arquitectura SIN acción concreta (solo charla)

### Counter "152+1 perfumes"

**Pregunta tuya:** cuándo se "actualiza" ese contador.
**Aclaración:** ese contador **no existe en el sitio público**, solo en el panel admin → tab PANEL/STATS. En el catálogo público no aparece ningún número total.

**Cuando agregás un perfume nuevo:**
- Se guarda en Supabase (`perfumes_nuevos`) instantáneo.
- El próximo cliente que abra la página lo ve (porque `loadPerfumesNuevos()` corre en cada page load).
- Si un cliente tiene la pestaña abierta sin refrescar → **no lo ve** hasta F5.

**No hay auto-refresh del catálogo en vivo** y no es necesario para tu escala.

### Eliminación de perfumes: arquitectura dual

Tema importante que conversamos largo. Hay **dos categorías**:

| Categoría | Cómo se elimina | Reversibilidad |
|---|---|---|
| **Viejos** (de los 147 en `perfumes.js`) | Se marca `oculto=true` en `perfume_overrides`. Sigue ocupando espacio en el archivo estático. | Reversible (destildás y vuelve) |
| **Nuevos** (cargados desde admin a `perfumes_nuevos`) | Se borra fila de la tabla. Desaparece de verdad. | NO reversible |

**Migración propuesta para post-launch:** meter los 147 viejos en Supabase también, así "eliminar = eliminar" para todo. **~4 hs de trabajo**, no urgente, se hace cuando el sitio esté estable.

### MCP (Model Context Protocol)

Te expliqué qué es. **Tools conectadas en tu setup:**
- Supabase (lo usé hoy para aplicar el trigger SQL via `apply_migration`)
- Vercel (deployments, logs)
- Gmail (búsqueda, drafts)
- Drive (búsqueda, lectura de docs)
- Notion (lectura, edición)
- Chrome (control del browser)

**Importante:** los tools son acciones reales. Si te tiro `apply_migration` mal, modifica tu DB de verdad. Por eso siempre muestro el SQL antes y pido confirmación para cosas destructivas.

---

## ⏳ PENDIENTES ACCIONABLES (importante para retomar)

### 🔴 P1 — SQL manual de limpieza

**Acción:** abrir Supabase Dashboard → SQL Editor → correr:
```sql
DELETE FROM perfume_overrides WHERE slug = 'cdn-untold';
```
**Por qué:** quedó fila huérfana después de purgar el perfume. No rompe nada, pero ensucia.
**Tiempo:** 10 segundos.

### 🟡 P2 — 240 fotos nuevas en Drive

**Contexto:** tenés 240 fotos nuevas en una carpeta de Drive. Mezcla de:
- Reemplazos de fotos viejas
- Fotos adicionales (galería extra)
- Perfumes completamente nuevos

**Lo que necesito de vos para arrancar:**
1. 5 ejemplos de cómo están nombrados los archivos (para definir si auto-matching funciona)
2. ¿Están en 1 carpeta suelta o en subcarpetas por perfume?
3. ¿Cuántos perfumes NUEVOS hay (que no estén ya en tu catálogo)?

**Caminos según respuestas:**

| Escenario | Plan |
|---|---|
| Archivos bien nombrados + pocos nuevos (<10) | Script de carga masiva (~2 hs) |
| Bien nombrados + muchos nuevos (>10) | Script + plantilla Excel para datos de nuevos |
| Mal nombrados | Recomendación: renombrarlos en Drive con multi-rename de Windows ANTES de empezar |
| Subcarpetas por perfume | Script aún más automatizado |

### 🟡 P3 — Reducir rastros del link viejo de Vercel

**Contexto:** tu dominio definitivo es `stperfumeria.com`. El link legacy `st-perfumeria.vercel.app` sigue figurando en algunos lugares (Google Search Console, posiblemente sitemap o metadata).

**Status:** quedó abierto sin investigar. Posibles lugares para revisar:
- Google Search Console (request URL removal del dominio viejo)
- Verificar que `sitemap.xml` y `robots.txt` no referencien el viejo
- Verificar `og:url` en index.html y admin.html
- Vercel: en el dashboard, verificar que `stperfumeria.com` sea el primary domain
- Considerar **redirect 301** desde `st-perfumeria.vercel.app/*` → `stperfumeria.com/*` (creo que esto ya está pero conviene confirmar)

### 🟢 P4 — Migración de los 147 viejos a Supabase

**Trigger:** post-lanzamiento, cuando el sitio esté estable.
**Beneficio:** "eliminar = eliminar" para todo el catálogo. Cero deuda técnica de archivo estático + overrides.
**Trabajo estimado:** ~4 hs (migrar datos + fotos + overrides + testing exhaustivo).
**No urgente.**

### 🟢 P5 — Bcrypt password hashing

**Pendiente histórico del proyecto.** Plan de migración lazy ya documentado en `docs/HISTORIA.md`. No es de esta sesión, pero sigue ahí.

---

## 📊 Estado del proyecto al cerrar la sesión

| Item | Estado |
|---|---|
| Branch activa | `main` (sincronizada con origin) |
| Branch backend | `backend/watchdog-realtime` (queda en local por si querés revisitar diff aislado) |
| SW version | **v1.1.15** |
| Trigger SQL en prod | ✅ aplicado |
| Watchdog activo | ✅ en `admin.html` |
| Vercel | deployando automático tras el último push |
| Working tree | limpio |
| Untracked files en raíz | ninguno (limpieza hecha) |

---

## 🎓 Lecciones de esta sesión

1. **WebSockets en clientes de vida larga (PWA en tablets) siempre necesitan watchdog.** Patrón replicable: máquina de estados + polling de respaldo + backoff + indicador visual + listeners de visibilidad/red.

2. **Trigger SQL para `updated_at` es prerequisito de cualquier polling diferencial.** Sin esto, una columna con `DEFAULT now()` queda fija en el INSERT inicial.

3. **Cuando un filtro defensivo (`!p._oculto`) está bien implementado en UN lugar, conviene `grep` para ver si falta en OTROS lugares similares.** Caso típico de bug "se ve raro solo a veces" → es porque el filtro está parcialmente aplicado.

4. **Archivos `.md` efímeros (handoffs entre sesiones) NO van a `git`.** Si van, quedan obsoletos el día 1 y confunden. Para histórico permanente → mover a `docs/HISTORIA.md` o `docs/planes-archivados/`.

5. **El cliente Supabase abstrae mucho.** Cuando recibís un evento de Realtime, el `commit_timestamp` puede tener skew con el reloj del cliente — para anti-echo usar `Date.now()` propio, NO timestamps del servidor.

6. **Si una conversación dura mucho y cubre muchos temas → persistir en `.md` antes de cerrar.** Cada Claude futuro arranca de cero; los `.md` son la única memoria real.

---

## 🔗 Referencias

- Plan original del watchdog (con 20 gotchas + 5 tests): `docs/planes-archivados/realtime-watchdog.md`
- Bug histórico: `docs/HISTORIA.md` → "Watchdog de Realtime (mayo 2026)"
- Arquitectura del Realtime: `docs/BACKEND.md` → "Realtime entre tablets"
- Trigger SQL: `sql/add_updated_at_trigger.sql`
- Commits clave: `96f74ca` (watchdog), `57a1a59` (archivado), `2b00add` (filtros ocultos), `1067f81` (purga cdn-untold)

---

**Autor:** Claude (sesión que cubrió frontend fixes + sesión backend watchdog)
**Co-author humano:** Alejo Bello
**Fecha:** Mayo 2026 (multi-sesión comprimida)
