# DATABASE — ST Perfumería

> Todo lo relacionado al schema de Supabase: tablas, columnas, RLS,
> migraciones, índices, relaciones.
>
> Si tu pregunta es "qué columna guarda X" o "cómo agregar una tabla nueva" —
> está acá.
> Para auth/realtime/SW → `BACKEND.md`.
> Para CSS/HTML/UI → `FRONTEND.md`.

---

## 📍 Proyecto activo (post Plan B · 21-may-2026)

| Item | Valor |
|---|---|
| **Project ref activo** | `znmjhproimtprptheumy` |
| **URL** | `https://znmjhproimtprptheumy.supabase.co` |
| **Región** | `sa-east-1` (South America São Paulo) |
| **Plan** | Pro ($25/mes) |
| **Compute** | MICRO (1 GB RAM · default del Pro · suficiente para el tráfico actual) |
| **Postgres version** | 17.6 |
| **Anon key format** | `sb_publishable_*` (nuevo formato post-2024) |
| **Connection method** | Session Pooler IPv4: `aws-1-sa-east-1.pooler.supabase.com:5432` con user `postgres.znmjhproimtprptheumy` |
| **Direct connection** | IPv6-only (no funciona desde IPv4 argentino · solo usable con add-on IPv4 add-on $4/mes) |
| **Project ref legacy** | `rtgjzzkjrwbkdhkslxix` (us-west-2 Oregon) · activo hasta 28-may como rollback safety net |

### Backup pre-migración disponible

- **Ubicación local:** `D:\backups\st-perfumeria-pre-migracion-20may2026.sql` (6.2 MB)
- **Contenido:** dump completo del proyecto viejo · 59 tablas · 93 RLS policies · todos los datos incluyendo `auth.users.encrypted_password` (bcrypt) y `public.clientes.password` (PLANO · sensible)
- **Conservar:** hasta 28-may (después se borra al pausar el proyecto viejo)
- **NO commitear al repo NUNCA**
- **Restore:** `psql --host=... --file=st-perfumeria-pre-migracion-20may2026.sql`

---

## 🗂️ Inventario de tablas

| Tabla | Función | Notas |
|---|---|---|
| `clientes` | Auth custom + datos + `puntos` | ⚠️ password en plano |
| `ventas` | Histórica (UI de registro eliminada en v1.0.80) | No escribir desde el front por ahora |
| `perfume_overrides` | Stock + status por perfume | Editado masivamente desde admin |
| `perfumes_nuevos` | Perfumes agregados por admin (extra al seed `perfumes.js`) | |
| `combos` | Packs/sets de perfumes | |
| `destacados` | Slugs ordenados de "Selección ST" | 1 fila por slug + posición |
| `home_top_banner` | Mensajes B/N rotativos | Carrusel multi-mensaje |
| `trust_badges` | Los 4 cuadros de beneficios | |
| `votacion_config` | Candidatos del perfume del mes | 1 fila por mes |
| `votos` | Votos individuales | `(user_id, categoria, mes)` |
| `cierres_especiales` | Días cerrados programados | |
| `ajuste_horario` | Override de horario | **1 sola fila activa** (delete-then-insert pattern) |
| `puntos_config` | 1 sola fila con conversiones globales | |
| `puntos_log` | Auditoría de movimientos de puntos | Inmutable |
| `decants_custom` | Perfumes "estrella" del armador no en catálogo | |
| `favoritos` | `(user_id, slug)` | |
| `lista_espera` | "Avisame cuando vuelva" | |
| `password_reset_requests` | `[FORGOT-PASS-A]` pedidos de reset de contraseña de clientes | INSERT anon (cliente no logueado), SELECT/UPDATE/DELETE solo authenticated. Creada 27-jun-2026 vía MCP. Ver detalle abajo |
| `opiniones` | Mensajes en "Tu sector" | Públicos |
| `announcements` | Pushes que aparecen en banner (últimos 7d) | |
| `admin_actions` | Audit log de acciones admin | Inmutable, 60d retención |
| `analytics_events` | Tracking de eventos | |
| `perfume_clicks` | Tracking de clicks | |
| `perfume_views` | Stats de visitas por perfume | Mostrado como "+N personas vieron" |
| `backups` | Snapshots diarios | Retención 15d / 200 snapshots |
| `push_subscriptions` | Suscripciones a web push | Dedupe por `endpoint` |

---

## 🔑 `[FORGOT-PASS-A]` · tabla `password_reset_requests` (27-jun-2026)

Trackea los pedidos de "olvidé mi contraseña" de clientes. SQL fuente en `sql/forgot-pass-a-create-table.sql`. Creada vía MCP de Supabase.

```sql
CREATE TABLE public.password_reset_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    uuid REFERENCES clientes(id) ON DELETE CASCADE,  -- NULL si el tel no matchea
  telefono      text NOT NULL,
  status        text DEFAULT 'pending' CHECK (status IN ('pending','resolved','rejected','expired')),
  created_at    timestamptz DEFAULT now(),
  expires_at    timestamptz DEFAULT (now() + interval '24 hours'),
  resolved_by   text,           -- 'jefe' | 'empleado'
  resolved_at   timestamptz,
  temp_password text,           -- reservado · hoy NO se usa (el reset pone clientes.password=NULL)
  notes         text
);
```

**RLS (clave · distinto del patrón estándar):**
- `prr_insert_open` · INSERT TO **anon**, authenticated · el cliente NO está logueado en Supabase Auth cuando pide reset (usa anon key). Sin esto, el botón no funciona.
- `prr_select_auth` / `prr_update_auth` / `prr_delete_auth` · solo **authenticated** · los pedidos tienen teléfono, NO son públicos. Solo el admin (logueado en Supabase Auth) los ve/resuelve.

**Índices:** partial sobre `status='pending'` (query frecuente del admin), por `cliente_id`, por `telefono`.

**Flujo:** cliente toca "¿Olvidaste tu contraseña?" → INSERT (anon) + Telegram al jefe → admin verifica identidad por WhatsApp → "Resetear" pone `clientes.password=NULL` (reusa flujo "primer login setea pass" de app.js L391-407) → marca `status='resolved'`. Ver `docs/BACKEND.md` § Auth para el detalle del flujo.

---

## 🔐 RLS — reglas obligatorias

**TODAS las tablas deben tener:**

```sql
-- Lectura pública (anon puede leer)
ALTER TABLE mi_tabla ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mi_tabla_select_public" ON mi_tabla;
CREATE POLICY "mi_tabla_select_public" ON mi_tabla
  FOR SELECT USING (true);

-- Escritura solo autenticados (admin)
DROP POLICY IF EXISTS "mi_tabla_write_auth" ON mi_tabla;
CREATE POLICY "mi_tabla_write_auth" ON mi_tabla
  FOR ALL USING (auth.role() = 'authenticated')
            WITH CHECK (auth.role() = 'authenticated');
```

### Casos especiales

- **`admin_actions`**: read **solo el mail del jefe** (`admin_actions_select` filtra por `auth.jwt() ->> 'email' = 'jefe@stperfumeria.local'`), NO update, NO delete (inmutable). ⚠️ Decía "read solo auth", que se leía como "cualquier usuario autenticado" — es falso: la cuenta de empleada está autenticada y **no** puede leer esta tabla. Verificado contra `pg_policies` el 2-sep-2026.
- **`puntos_log`**: read pública, write auth, NO update, NO delete.
- **`favoritos`**: read sólo del propio user, write sólo del propio user.
- **`backups`**: read auth (solo admin), write auth.

### ⚠️ Bug histórico

`ajuste_horario` se creó sin RLS pública → la web pública no podía leer el horario nuevo aunque admin guardaba bien. **Lección: cada tabla nueva configurar RLS desde día 1.**

---

## 📋 Schemas detallados

### `clientes`

```sql
id           BIGSERIAL PRIMARY KEY,
nombre       TEXT,
telefono     TEXT UNIQUE NOT NULL,
password     TEXT,                                -- ⚠️ plano, pendiente bcrypt
puntos       NUMERIC(8,2) NOT NULL DEFAULT 0,
created_at   TIMESTAMPTZ DEFAULT NOW()
```

**Anti-patterns conocidos:**
- `password` en plano → migrar a bcrypt (lazy migration).
- `id` BIGSERIAL — si migramos a Supabase Auth, mantener este id y agregar `auth_uid TEXT REFERENCES auth.users(id)`.

### `perfume_overrides`

```sql
slug              TEXT PRIMARY KEY,                -- = perfumes.js[].slug
stock_status      TEXT,                             -- 'ok' | 'low' | 'out' | 'pausado'
stock_qty         INT,
price             NUMERIC(10,2),                    -- override de precio
promo             NUMERIC(10,2),
foto              TEXT,                              -- override de URL
tipo              TEXT,
alias             TEXT,
notas_salida      TEXT,
notas_corazon     TEXT,
notas_base        TEXT,
similares_manual  TEXT[],                           -- slugs recomendados por ST
similares_nota    TEXT,                              -- aclaración del jefe
nota_ultimo       TEXT,
nota_sin_stock    TEXT,
nota_proximamente TEXT,
oculto            BOOLEAN DEFAULT FALSE,
created_at        TIMESTAMPTZ DEFAULT NOW(),
updated_at        TIMESTAMPTZ DEFAULT NOW()
```

**Realtime activado:** sí (para sincronización entre tablets).

### `ventas`

```sql
id                  BIGSERIAL PRIMARY KEY,
fecha               TIMESTAMPTZ,
slug_perfume        TEXT,
perfume_nombre      TEXT,
marca               TEXT,
cliente_nombre      TEXT,
monto_mp            NUMERIC(10,2),
monto_efectivo      NUMERIC(10,2),
monto_total         NUMERIC(10,2),
cantidad            INT DEFAULT 1,
notas               TEXT,
vendedor            TEXT,                             -- 'sofia', 'angelina', 'lautaro', 'jefe'
puntos_otorgados    NUMERIC(8,2) DEFAULT 0,           -- agregado en sistema puntos
cliente_id_puntos   BIGINT,                           -- referencia a clientes.id
created_at          TIMESTAMPTZ DEFAULT NOW()
```

**Estado actual:** la UI de registro fue eliminada. La tabla queda como histórica. No escribir desde el front. Datos preservados por si el nuevo flujo los necesita.

### `puntos_config` (1 sola fila)

```sql
id                        BIGSERIAL PRIMARY KEY,
puntos_por_perfume        NUMERIC(6,2) NOT NULL DEFAULT 1.00,
puntos_por_decant         NUMERIC(6,2) NOT NULL DEFAULT 0.10,    -- 10 decants = 1 pt
puntos_por_set_combo      NUMERIC(6,2) NOT NULL DEFAULT 2.00,
threshold_proximo_premio  INT NOT NULL DEFAULT 5,                -- avisar al cliente
mensaje_promo             TEXT,                                   -- editable, ej "SUMÁ 1 MÁS Y CONSULTÁ POR TU PREMIO 📲"
updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

### `puntos_log`

```sql
id               BIGSERIAL PRIMARY KEY,
cliente_id       BIGINT,                                          -- ref clientes.id
cliente_telefono TEXT,                                              -- fallback identificador
cliente_nombre   TEXT,                                              -- snapshot
delta            NUMERIC(8,2) NOT NULL,                             -- positivo o negativo
motivo           TEXT,                                              -- 'venta_auto', 'venta_eliminada', 'manual_jefe', 'canje'
venta_id         BIGINT,                                            -- si aplica
actor            TEXT,                                              -- email o 'sistema'
created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Índices:
```sql
CREATE INDEX idx_puntos_log_cliente ON puntos_log(cliente_id, created_at DESC);
CREATE INDEX idx_puntos_log_telefono ON puntos_log(cliente_telefono);
CREATE INDEX idx_puntos_log_venta ON puntos_log(venta_id);
```

### `home_top_banner`

```sql
id            BIGSERIAL PRIMARY KEY,
texto         TEXT NOT NULL,
activo        BOOLEAN DEFAULT TRUE,
modo_marquee  BOOLEAN DEFAULT FALSE,                  -- si fuerza scroll horizontal
orden         INT,
created_at    TIMESTAMPTZ DEFAULT NOW()
```

Lee mensajes activos ordenados por `id`; si hay >1, rotan cada 4.5s en el banner.

### `ajuste_horario` (1 sola fila activa)

```sql
id              BIGSERIAL PRIMARY KEY,
hora_abre       INT,
hora_cierra     INT,
hora_cierra_sab INT,                                   -- opcional
desde           DATE,                                   -- null = "siempre vigente desde antes"
hasta           DATE,                                   -- null = "siempre vigente hacia adelante"
motivo          TEXT,
mostrar_nota    BOOLEAN DEFAULT FALSE,
created_at      TIMESTAMPTZ DEFAULT NOW()
```

**Pattern de uso:** delete-then-insert para garantizar 1 fila vigente:
```sql
DELETE FROM ajuste_horario WHERE id != 0;
INSERT INTO ajuste_horario (...) VALUES (...);
```

⚠️ Frontend tolera `desde`/`hasta` null como "siempre vigente" (fix tras bug de timezone).

### `votos`

```sql
id          BIGSERIAL PRIMARY KEY,
user_id     BIGINT,
categoria   TEXT,                                       -- 'masculino' | 'femenino'
slug        TEXT,                                        -- perfume votado
mes         TEXT,                                        -- 'YYYY-MM'
created_at  TIMESTAMPTZ DEFAULT NOW(),
UNIQUE(user_id, categoria, mes)                          -- 1 voto por user/cat/mes
```

### `votacion_config`

```sql
id                BIGSERIAL PRIMARY KEY,
mes               TEXT UNIQUE,                           -- 'YYYY-MM'
candidatos_masc   TEXT[],                                 -- array de slugs
candidatos_fem    TEXT[],
created_at        TIMESTAMPTZ DEFAULT NOW()
```

Lectura del mes actual: `WHERE mes = currentMes` (`YYYY-MM`).

### `admin_actions`

```sql
id            BIGSERIAL PRIMARY KEY,
actor_email   TEXT,                                       -- del JWT de Supabase Auth
actor_role    TEXT,                                       -- 'jefe' | 'empleado' | 'admin'
action        TEXT,                                       -- 'stock_update', 'price_update', etc.
target_slug   TEXT,
changes       JSONB,                                      -- { old: ..., new: ... }
created_at    TIMESTAMPTZ DEFAULT NOW()
```

**Inmutable:** RLS bloquea UPDATE y DELETE para anon/auth.

Retención: 60 días (cleanup manual o por trigger).

### `backups`

```sql
id              BIGSERIAL PRIMARY KEY,
data            JSONB NOT NULL,                           -- todo el snapshot
size_kb         INT,
rows_count      INT,
origen          TEXT,                                       -- 'cron' | 'manual' | 'fallback_login'
created_at      TIMESTAMPTZ DEFAULT NOW()
```

Retención: 15 días o 200 snapshots, lo que ocurra antes. Cleanup en `cron/backup.js` y en `loadBackups()` del admin.

---

## 🛠️ Cómo agregar una tabla nueva

Checklist (paso a paso):

1. **Schema en SQL Editor de Supabase:**
   ```sql
   CREATE TABLE IF NOT EXISTS mi_tabla (
     id BIGSERIAL PRIMARY KEY,
     ...
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

2. **RLS desde día 1:**
   ```sql
   ALTER TABLE mi_tabla ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "mi_tabla_select_public" ON mi_tabla FOR SELECT USING (true);
   CREATE POLICY "mi_tabla_write_auth" ON mi_tabla
     FOR ALL USING (auth.role() = 'authenticated')
               WITH CHECK (auth.role() = 'authenticated');
   ```

3. **Índices si hace falta** (en columnas de búsqueda frecuente).

4. **Realtime** si necesitás sync entre tablets:
   - Database → Replication → tildar la tabla.
   - En JS: `sb.channel(...).on('postgres_changes', { table: 'mi_tabla' }, cb)`.

5. **Guardar el SQL** en `sql/` del repo (ej: `sql/create_mi_tabla.sql`).

6. **Documentar en este archivo** (agregar a la tabla de inventario arriba).

7. **Si afecta el catálogo público**, también:
   - Lazy-load con `deferTask` o `onDeferred` para no bloquear el primer paint.
   - Fallback si la query falla (no romper la página).

---

## 📊 Realtime: tablas con sync activado

| Tabla | Eventos escuchados |
|---|---|
| `perfume_overrides` | `UPDATE` — actualiza stock entre tablets |
| (`ventas`) | ~~`INSERT`~~ eliminado en v1.0.80 |

Para agregar realtime a una tabla nueva, ver paso #4 de "Cómo agregar tabla nueva".

---

## 🧹 Tareas de mantenimiento periódicas

### Cleanup de logs viejos

`admin_actions` y `puntos_log` no se limpian automáticamente. Sugerencia (manual, cada 3-6 meses):

```sql
DELETE FROM admin_actions WHERE created_at < NOW() - INTERVAL '60 days';
DELETE FROM puntos_log WHERE created_at < NOW() - INTERVAL '1 year';
```

### Cleanup de backups (automático)

Ya implementado en `cron/backup.js` y en `loadBackups()` del admin. Mantiene últimos 15 días / 200 snapshots.

### Cleanup de push_subscriptions vencidas

Cuando una sub falla con 410 Gone (browser desinstaló), `send-push.js` la borra automáticamente.

---

## 🔄 Migraciones (cómo aplicarlas)

No usamos sistema de migrations formal (Sqitch, dbmate, etc.). Cada cambio de schema:

1. Lo escribimos como SQL idempotente (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
2. Lo corremos en SQL Editor de Supabase.
3. Lo guardamos en `sql/` del repo.

Archivos actuales en `sql/`:
- `create_puntos_system.sql` — sistema de puntos

⚠️ **Para Fase 2 / DeCalle**: usar migrations formales numeradas (`001_init.sql`, `002_add_X.sql`, etc.).

---

## 📌 NO ROMPER (lecciones DB)

1. **RLS pública en cada tabla nueva** — sino el front público no puede leer.
2. **`auth.role() = 'authenticated'`** para writes — esto vincula con Supabase Auth del admin.
3. **`select_public USING (true)`** es el patrón estándar para tablas leídas por anon.
4. **No exponer `service_role` key** en el cliente.
5. **Cron Hobby de Vercel: 1 daily máximo** (no más, sino el deploy falla).
6. **Patterns idempotentes**: `IF NOT EXISTS`, `ON CONFLICT DO UPDATE/NOTHING`.
7. **Tabla `ajuste_horario`**: SIEMPRE 1 fila vigente (delete-then-insert).
8. **`votos`**: UNIQUE(`user_id`, `categoria`, `mes`) para evitar votos duplicados.

---

## 🐛 Bugs históricos de DB

### `ajuste_horario` sin RLS pública
Síntoma: admin guardaba horario nuevo, web pública no lo veía.
Causa: tabla creada sin policy de SELECT pública.
Fix: agregar policy `select_public USING (true)`.
Lección: SIEMPRE configurar RLS al crear tabla.

### Timezone UTC vs Argentina en `ajuste_horario.desde`
Síntoma: ajuste guardado a las 23 ARG no aplicaba ese día.
Causa: admin guardaba `desde = new Date().toISOString().split('T')[0]` (UTC = mañana ARG).
Fix doble: admin usa zona horaria Argentina + frontend tolera `desde` null o futuro de 1 día.
Lección: NUNCA `toISOString()` para fechas locales.

### Push subscriptions duplicadas
Síntoma: misma persona recibía 3 notifs.
Fix: `ON CONFLICT (endpoint) DO UPDATE` al insertar.

### Cron Vercel rechazado en deploy
Síntoma: Vercel rechazaba `0 */2 * * *` (cada 2h).
Causa: Hobby plan limita a 1 cron diario.
Fix: `0 3 * * *` (3 AM).
Lección: planear cron jobs respetando límites del tier.

---

**Última actualización:** mayo 2026. Actualizar cuando agregues/elimines tablas o cambies schemas.
