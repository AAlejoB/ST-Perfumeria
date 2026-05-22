---
description: Audit completo del repo buscando secretos hardcoded (passwords, tokens, JWTs, bot tokens). Solo reporta · NO modifica nada
---

Hacé un security scan COMPLETO del repo · solo LECTURA · NO modificás nada.

Buscás patrones que parezcan secretos hardcoded.

## Alcance

**Buscar en:** todos los archivos del repo
**Excluir:** `node_modules/`, `.git/`, `.vercel/`, `dist/`, `build/`, `*.lock`, `*.min.js`, archivos binarios (`.webp`, `.png`, `.jpg`, `.pdf`)

## Patrones a detectar

### 🔴 Severidad CRÍTICA · expuestos al frontend (HTML público)

```regex
# Passwords en JS
\b(password|PASS|PASSWORD|ADMIN_PASS|SECRET)\s*[:=]\s*['"][^'"]{4,}['"]

# Variables sospechosas tipo TOKEN_, KEY_, SECRET_
\b(TOKEN_\w*|API_KEY_\w*|SECRET_\w*)\s*=\s*['"][^'"]{10,}['"]
```

### 🟡 Severidad ALTA · tokens server-side hardcoded

```regex
# JWT tokens (formato eyJ...eyJ...XXX)
eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}

# Supabase service role / publishable keys (formato moderno)
sb_(secret|publishable)_[a-zA-Z0-9_]{20,}

# Telegram bot tokens (formato: número:AAEXX...)
\b\d{9,12}:AAE[A-Za-z0-9_-]{30,}

# Strings que parecen UUIDs como chat_id de Telegram (10 dígitos solitos)
chat_id\s*[:=]\s*['"]?(\d{9,12})['"]?
```

### 🟢 Severidad MEDIA · URLs con credenciales

```regex
# Postgres connection strings con password embebida
postgres(ql)?://[^:]+:[^@\s]+@

# URLs con basic auth embebido
https?://[^/]+:[^@/]+@
```

### Cosas conocidas (NO alarmar)

NO marcar como issue (son falsos positivos conocidos):

- `sb_publishable_*` en `admin.html` línea 2769 o `js/app.js` línea 5 · ES la anon key del frontend (pública por diseño)
- `var ADMIN_PASS = 'SANTOMY2026'` en `admin.html` línea 2766 · YA marcado como issue conocido en `docs/SECURITY.md` § S1
- `var ADMIN_PASS_EMPLEADO = 'CAFE_MATE_PROHIBIDO'` en `admin.html` línea 2767 · YA marcado, código muerto, ver SECURITY.md § S1
- Bot Telegram token en función SQL `send_telegram` · YA marcado en SECURITY.md § S3 (pero NO está en el frontend · solo en BD)
- Cualquier `eyJ...` en `docs/HISTORIA.md` o `docs/SECURITY.md` o `RECOMENDACIONES_CLAUDECHAT/*.md` · son ejemplos de documentación

Estos los **mencionás** en el reporte pero etiquetá como "**ya conocido · ver SECURITY.md**" en lugar de "🔴 NUEVO HALLAZGO".

## Output esperado

Tabla en este formato:

```
| # | Archivo | Línea | Tipo | Severidad | Status |
|---|---|---|---|---|---|
| 1 | admin.html | 2766 | password hardcoded | 🔴 Crítica | ya conocido (S1) |
| 2 | js/app.js  | 5    | sb_publishable_*    | 🟢 OK     | esperado (anon key) |
| 3 | ?         | ?    | NUEVO              | 🔴/🟡/🟢   | requiere acción     |
```

Al final del reporte:

```
### Resumen
- Total matches: X
- Issues NUEVOS no documentados: X (CRÍTICO si > 0)
- Issues ya conocidos en docs/SECURITY.md: X
- Falsos positivos esperados (anon keys públicas, ejemplos en docs): X

### Acciones recomendadas
- Si hay issues NUEVOS no documentados: PARÁ y avísame · agendamos fix
- Si todo está ya conocido: bien · seguir con SECURITY-AUDIT-S1 cuando aplique
```

## Restricciones

- **NO modificás NINGÚN archivo** · este comando es read-only puro
- **NO ejecutás commits** · NO ejecutás push
- **NO hacés sugerencias de fix automático** · solo reportás (las decisiones de fix son de Alejo)
- **Tiempo máximo:** 5 min · si tarda más, algo está mal con el grep (probablemente incluyendo node_modules) · abortar y avisarme

## Herramientas a usar

- `Grep` (rg) con los patrones de arriba · output_mode "content"
- NO `Bash grep` directo (más lento)
- Filtrar por glob: `--glob='!node_modules/**'` etc.
