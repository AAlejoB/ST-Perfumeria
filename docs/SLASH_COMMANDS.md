# SLASH COMMANDS · custom para ST Perfumería

> Catálogo de slash commands custom recomendados para Claude Code en este proyecto. Cada uno automatiza un flow REPETITIVO de Alejo. **NO están implementados todavía** · este archivo es el design doc para cuando los queramos crear.
>
> **Creado:** 22-may-2026 (después del QA post Plan B). Pensados en base a 2+ meses de trabajo en este proyecto con Claude Code · NO son slash commands genéricos sacados de TikTok · son específicos del flow ST Perfumería.

---

## 🛠 Cómo funcionan los slash commands custom

Un slash command es **un archivo markdown** en una carpeta especial que Claude Code lee al arrancar. Cuando vos escribís `/<nombre>`, Claude Code carga el contenido de ese archivo como prompt y lo aplica al contexto actual.

### Ubicación

- **Por proyecto:** `<repo>/.claude/commands/<nombre>.md` ← solo disponible en ese repo
- **Global (todos tus proyectos):** `~/.claude/commands/<nombre>.md` ← disponible siempre

### Sintaxis del archivo

```markdown
# .claude/commands/mi-comando.md

[Cualquier instrucción en lenguaje natural para Claude]

Si querés pasar argumentos: $ARGUMENTS contiene lo que escribiste después
del nombre del comando.

Ejemplo: si escribís "/mi-comando admin.html L100", entonces:
$ARGUMENTS = "admin.html L100"
```

### Cómo lo invocás

En el chat de Claude Code, escribís `/<nombre>` + opcionalmente argumentos:
```
/quick-fix-ui admin.html L450 fix contraste botón
```

---

## 📋 Los 8 slash commands recomendados para vos

### 🥇 1. `/handoff` · cierre limpio de sesión

**Cuándo usarlo:** al final de CADA sesión productiva (después de varios commits).

**Qué hace:**
1. Lee todos los commits que hicimos en esta sesión (`git log` desde el último handoff)
2. Genera una sección nueva en `docs/HISTORIA.md` con:
   - Fecha de hoy
   - Resumen de qué se trabajó (commits + decisiones + bugs encontrados)
   - Keywords cerrados (`[XYZ]`)
   - Keywords abiertos pendientes
3. Actualiza la sección "Última actualización" + "Próxima revisión cuando"
4. Si hay aprendizajes meta (cosas que aprendí sobre cómo trabajar con vos), los agrega a `memory/preferencias_alejo.md`
5. Commit con mensaje `docs: cierre sesión <fecha>` + push a main

**Por qué te sirve:** terminás cansado · te olvidás de actualizar HISTORIA.md · al día siguiente perdés contexto. Este comando lo hace solo.

**Prompt template a crear en `.claude/commands/handoff.md`:**
```markdown
Cerrá esta sesión con disciplina:

1. Mirá los commits desde el último "docs: cierre sesión" o handoff
2. Identificá qué cosas se trabajaron · agrupá por keyword
3. Agregá una sección nueva a docs/HISTORIA.md tipo "### Sesión <FECHA> · <KEYWORD principal>"
4. Documentá:
   - Qué se hizo (con commit hashes)
   - Bugs/decisiones encontradas
   - Keywords cerrados
   - Pendientes para próxima sesión
5. Actualizá "Última actualización" y "Próxima revisión cuando" al final de HISTORIA.md
6. Si descubriste algún patrón NUEVO de cómo trabajo, agregalo numerado al final de memory/preferencias_alejo.md
7. Commit `docs: cierre sesión <fecha-aaaammdd> · <breve resumen>`
8. Push a main

Aplicá los aprendizajes #41/#46 (cuando es crítico, documentación EXHAUSTIVA).
Aplicá el aprendizaje #25 (cierre con tabla de keywords + commits + estado).
```

---

### 🥇 2. `/quick-fix-ui` · cambio chico de CSS/HTML

**Cuándo usarlo:** cuando hacés ajustes cosméticos · ej. "fix contraste de un botón en light mode" · "subir padding del banner X 2px".

**Qué hace:**
1. Aplica el cambio CSS/HTML que pediste en `$ARGUMENTS`
2. NO toca lógica JS · NO toca BD · NO toca auth
3. Bumpea `sw.js` CACHE_VERSION en +1
4. Genera mensaje de commit con keyword auto-detectado o uno random tipo `[QUICK-FIX-XXX]`
5. Commit + push a main
6. Espera Vercel deploy + verifica HTTP 200 + bump SW version visible

**Por qué te sirve:** los fixes UI los hacés MUCHAS veces. Olvidarse de bumpear el SW = tablets cacheadas = bug fantasma. Este comando lo previene.

**Prompt template:**
```markdown
Hacé un fix UI quirúrgico en base a esto: $ARGUMENTS

REGLAS:
1. Solo CSS o HTML cosmético · NO tocar lógica JS
2. NO crear archivos nuevos · NO refactors
3. Si necesitás cambiar más de 1 archivo, PARÁ y preguntame antes
4. Bumpear sw.js CACHE_VERSION (regla sagrada)
5. Generar keyword corto entre corchetes para el commit (ej. [PADDING-FIX] o [LIGHT-CONTRAST])
6. Commit + push a main
7. Esperar Vercel deploy + verificar v1.1.XX nuevo visible en producción

Convenciones del proyecto: castellano rioplatense en código y commit · ver CLAUDE.md.
```

---

### 🥇 3. `/security-scan` · audit rápido de secretos en repo

**Cuándo usarlo:** antes de pushear cualquier branch que toque admin o auth · o periódicamente como housekeeping.

**Qué hace:**
1. `grep` en todo el repo (excluyendo `node_modules`, `.git`, archivos binarios) por patrones de:
   - Passwords hardcoded (`PASSWORD = '...'`, `password: "..."`, etc.)
   - API tokens JWT (`eyJhbGc...`)
   - Service role keys (`sb_secret_...`)
   - Telegram bot tokens (`<digits>:AAE...`)
   - Numbers que parecen `chat_id` de Telegram (10 dígitos hardcoded)
   - URLs internas con credenciales (formato `://user:pass@`)
2. Reporta cada match con archivo + línea + tipo de issue
3. Verifica si está en `.gitignore` o si está committeado
4. NO hace fix automático · solo reporta para que vos decidas

**Por qué te sirve:** después del descubrimiento del 21-may (las "passwords del jefe" hardcoded), tu paranoia es legítima. Mejor escanear seguido que descubrir un problema en producción.

**Prompt template:**
```markdown
Hacé un security scan COMPLETO del repo (excluir node_modules, .git, .vercel, dist):

Buscá patrones que parezcan secretos:
1. `password\s*[:=]\s*['"][^'"]+['"]` (passwords hardcoded)
2. JWT tokens: `eyJ[A-Za-z0-9-_]{20,}\.eyJ[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}`
3. Supabase keys: `sb_secret_\w+`, `sb_publishable_\w+` (estos son menos críticos pero documentar)
4. Telegram bot tokens: `\d{9,12}:AAE[A-Za-z0-9_-]{30,}`
5. Constantes ADMIN_*, SECRET_*, TOKEN_*, KEY_* con valores hardcoded
6. URLs con credenciales: `://[^/]+:[^@]+@`

Para cada match:
- Archivo + línea
- Tipo de issue (clasificá según severidad: 🔴 expuesto al frontend / 🟡 server-only pero hardcoded / 🟢 falso positivo conocido)
- Recomendación de fix corto

NO modificás nada · solo reportás en una tabla.

Al final · sugerí si hay algo crítico que MERECE fix inmediato vs esperar a SECURITY-AUDIT-S1.
```

---

### 🥈 4. `/perf-measure` · Lighthouse local con mediana

**Cuándo usarlo:** después de cualquier cambio visual significativo · o cuando dudás de un nuevo regression.

**Qué hace:**
1. Corre Lighthouse CLI local sobre `https://www.stperfumeria.com/` con `--preset=desktop` y mobile (3 runs cada uno)
2. Calcula la mediana de las 6 corridas (3 mobile + 3 desktop)
3. Reporta: Score · FCP · LCP · TBT · CLS · SI
4. Si CLS > 0.1 (umbral good) o Score < 80, sugiere posibles culprits leyendo el shift detail del JSON
5. Compara contra el baseline guardado en `docs/HISTORIA.md` (lo busca por keyword `[MEDICION-BASELINE]`)

**Por qué te sirve:** las 7 reglas de oro de performance del proyecto (HISTORIA.md "Maratón Lighthouse") dicen 3-5 mediciones mediana SIEMPRE. Este comando lo automatiza · no te olvidás.

**Prompt template:**
```markdown
Corre Lighthouse local sobre $ARGUMENTS (si no se pasa argumento, usar producción: https://www.stperfumeria.com/).

Pasos:
1. Crear `/d/tmp/lh-runs/` si no existe
2. 3 runs mobile (--form-factor=mobile)
3. 3 runs desktop (--preset=desktop)
4. Procesar los 6 JSON con script `D:/tmp/lh/summarize.js` (ya existe en /d/tmp/lh/)
5. Reportar mediana de score, FCP, LCP, TBT, CLS, SI por viewport
6. Si CLS > 0.1 · usar script shifts-deep.js para identificar top culprits
7. NO commitear los JSON ni reportes · son temporales

Reglas críticas (de docs/HISTORIA.md "Maratón Lighthouse"):
- SIEMPRE 3-5 mediciones + mediana
- NUNCA medir el dominio main si validás una branch · medir el preview Vercel
- Diferenciar entre medir producción vs preview

Si me pasaste un PR/branch · medí el preview Vercel correspondiente · NO main.
```

---

### 🥈 5. `/check-supabase` · QA rápido post-deploy

**Cuándo usarlo:** después de un deploy grande (cambio de schema, migración, fix de auth) · o cuando te da paranoia que algo se rompió.

**Qué hace:**
1. Verifica conectividad al proyecto Supabase activo (sa-east-1)
2. Lista row counts de las 12 tablas críticas (clientes, perfume_overrides, etc.)
3. Verifica que `auth.users` tiene los 3 usuarios + hashes bcrypt + last_sign_in
4. Sample HEAD a 3 fotos del bucket · verifica HTTP 200 + Cache-Control
5. Status de Vercel deployment (último Production Ready)
6. HEAD a `https://www.stperfumeria.com/` · verifica 200 + refs correctas + supabase-js v2 cargando
7. Reporta TODO en tabla con ✅/⚠️/❌

**Por qué te sirve:** post Plan B (21-may-2026) te dio paranoia real. Tener un comando para verificar "¿está TODO OK?" en 2 minutos te da paz mental.

**⚠️ Importante:** este comando SOLO hace SELECT y HEAD. Ningún INSERT/UPDATE/DELETE. (Lección de hoy: el test de RLS INSERT que rompió mi promesa de "solo lectura" · ese error no se repite.)

**Prompt template:**
```markdown
QA post-deploy del proyecto Supabase ST Perfumería. SOLO LECTURA · NO escribir nada.

Pasos:
1. Conectividad al proyecto nuevo (znmjhproimtprptheumy via aws-1-sa-east-1.pooler.supabase.com)
2. Row counts de tablas críticas: clientes, perfume_overrides, perfumes_nuevos, combos, destacados, favoritos, ventas, opiniones, votos, lista_espera, announcements, trust_badges
3. Auth users: SELECT email, substring(encrypted_password,1,7), last_sign_in_at FROM auth.users
4. Sample HEAD a 3 fotos del bucket perfume-fotos (HTTPS · verificar 200 + cache-control)
5. Vercel ls + verificar último Production Ready
6. HEAD https://www.stperfumeria.com/?cb=<timestamp> · contar refs al proyecto VIEJO (debe ser 0) y NUEVO (debe ser >=1)

Reportá TODO en una tabla con columnas: Check · Resultado · Severidad.

NO HAGAS NINGÚN INSERT, UPDATE, DELETE NI POST con write. Si necesitás verificar policies, leé pg_policies, NO pruebes haciendo write real.

Las credenciales DB están en D:/tmp/.env (si existe) o pedímelas. NO las pegues en chat.
```

---

### 🥈 6. `/bump-sw` · solo bump del SW para forzar reload

**Cuándo usarlo:** cuando alguna tablet del admin se "queda colgada" con cache híbrido · `[EMERGENCY-BUMP]` ya documentado en CLAUDE.md.

**Qué hace:**
1. Bumpea `sw.js` CACHE_VERSION en +1 (sin tocar nada más)
2. Commit con mensaje `chore(sw): [EMERGENCY-BUMP] vX.X.XX → vX.X.YY · forzar reload remoto`
3. Push a main
4. Espera Vercel deploy + verifica que el sw.js de producción tiene la versión nueva

**Por qué te sirve:** ya pasó varias veces que una tablet queda colgada y la chica no sabe qué hacer. Este comando dispara el flujo `[PWA-AUTO-RELOAD]` y la tablet recarga sola en ~2 min sin que nadie toque nada.

**Prompt template:**
```markdown
[EMERGENCY-BUMP] · forzar reload remoto de las tablets del admin.

Pasos:
1. Leer sw.js · encontrar línea `var CACHE_VERSION = 'v1.1.XX'`
2. Bumpear a v1.1.(XX+1) · SIN tocar nada más del SW
3. NO tocar admin.html, index.html, app.js, css ni nada else
4. Commit `chore(sw): [EMERGENCY-BUMP] v1.1.XX → v1.1.YY · forzar reload remoto`
5. Push a main
6. Esperar Vercel deploy
7. Verificar que sw.js producción tiene la nueva versión

Este patrón está documentado en CLAUDE.md y dispara el flujo [PWA-AUTO-RELOAD] para que los clientes con SW v1.1.32+ recarguen solos en ~2 min.
```

---

### 🥉 7. `/rollback` · revert + push del último commit

**Cuándo usarlo:** cuando algo recién pusheado **rompe producción** y necesitás volver al estado anterior YA.

**Qué hace:**
1. `git log` muestra los últimos 3 commits a main
2. Pregunta cuál querés revertir (default: HEAD)
3. `git revert <commit> --no-edit`
4. Si el revert necesita resolver conflictos · te avisa y para
5. Push a main
6. Espera Vercel deploy
7. Verifica producción HTTP 200

**Por qué te sirve:** la regla del proyecto es "los commits van directo a main · no hay PR review". Eso significa que si algo rompe, vos sos el único que puede revertir. Cuando estás nervioso (sitio caído), querés un comando que NO te haga pensar.

**Prompt template:**
```markdown
ROLLBACK · revertir el último commit y volver a producción estable.

Pasos:
1. git log --oneline -5 · mostrame los últimos commits
2. Por default, revertir HEAD (último commit). Si $ARGUMENTS tiene un commit hash, revertir ese.
3. ANTES de revertir, AVISÁ qué archivos van a cambiar (git show <commit> --stat)
4. Esperá mi OK explícito antes de ejecutar el revert
5. git revert <commit> --no-edit
6. Si hay conflictos, PARÁ y mostrame el conflicto · NO resuelvas automático
7. Si NO hay conflictos, push origin main
8. Esperar Vercel deploy
9. HEAD a https://www.stperfumeria.com/ · verificar HTTP 200

NUNCA hagas reset --hard ni force push. SOLO revert (que crea un commit nuevo · rollback safe).
```

---

### 🥉 8. `/migrate-table` · crear SQL para nueva tabla con RLS estándar

**Cuándo usarlo:** cuando agregás una feature nueva que necesita tabla en BD (ej. `password_reset_requests` para FORGOT-PASS-A · `campaigns` para SIRENITA · etc.).

**Qué hace:**
1. Toma el nombre de la tabla y lista de columnas en `$ARGUMENTS`
2. Genera un archivo SQL en `sql/<nombre>.sql` con:
   - `CREATE TABLE IF NOT EXISTS`
   - `ALTER TABLE ENABLE ROW LEVEL SECURITY`
   - Policy `select_public` con `USING (true)` (para que el frontend público pueda leer)
   - Policy `write_auth` con `USING (auth.role() = 'authenticated')` (para que solo admin pueda escribir)
   - Comentarios sobre cada columna
3. Te muestra el SQL antes de hacer cualquier cosa
4. Te pregunta si querés ejecutarlo via Supabase SQL Editor (te da el link) o agregarlo a `supabase/migrations/`
5. NO ejecuta nada automático en la BD productiva

**Por qué te sirve:** olvidarse de RLS al crear una tabla nueva = frontend público no puede leer = bug que descubrís después. Este comando previene la lección que aprendiste con `ajuste_horario` ("RLS sin SELECT pública en tabla nueva → frontend público no podía leer").

**Prompt template:**
```markdown
Generá SQL para crear una tabla nueva en Supabase con RLS standard del proyecto.

Input ($ARGUMENTS): nombre de tabla + columnas en formato libre.

Ejemplo de input:
"password_reset_requests · id uuid pk · cliente_id uuid fk clientes · telefono text · status text default 'pending' · created_at timestamptz default now() · expires_at timestamptz"

Output:
1. Generar SQL en sql/<nombre>.sql:
   ```sql
   CREATE TABLE IF NOT EXISTS public.<nombre> (
     <columnas>
   );

   ALTER TABLE public.<nombre> ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "<nombre>_select_public" ON public.<nombre>
     FOR SELECT TO anon, authenticated
     USING (true);

   CREATE POLICY "<nombre>_write_auth" ON public.<nombre>
     FOR ALL TO authenticated
     USING (true) WITH CHECK (true);
   ```

2. Mostrar el SQL completo antes de ejecutar
3. Esperar confirmación
4. Si OK · dar la URL del SQL Editor:
   https://supabase.com/dashboard/project/znmjhproimtprptheumy/sql/new
5. Alejo lo copia/pega y ejecuta
6. Verificar después con: SELECT count(*) FROM information_schema.tables WHERE table_name='<nombre>'

REGLA SAGRADA (HISTORIA.md): "Si creás una tabla nueva → SIEMPRE habilitá RLS y crear policies, sino se rompen lecturas anon." Aprendido a la mala con ajuste_horario.

NO ejecutar nada en la BD automático · solo generar el SQL y darle el link al Editor.
```

---

## 📊 Resumen · cuándo usar cada uno

| Comando | Frecuencia estimada | Tiempo ahorra | Prioridad implementar |
|---|---|---|---|
| `/handoff` | Cada cierre de sesión | 10-15 min | 🥇 Alta · es lo que más olvidás |
| `/quick-fix-ui` | 3-5 veces por semana | 5 min | 🥇 Alta · previene olvido SW bump |
| `/security-scan` | 1 vez por semana | 15-20 min | 🥇 Alta · ya tenés paranoia post 21-may |
| `/perf-measure` | Después de cambios visuales | 10 min | 🥈 Media · ya tenés scripts manuales |
| `/check-supabase` | Después de deploy grande | 5 min | 🥈 Media · paz mental |
| `/bump-sw` | Cuando una tablet se cuelga | 3 min | 🥈 Media · ya documentado el flow |
| `/rollback` | Cuando algo rompe en prod (raro) | 2 min | 🥉 Baja · esperás no usarlo nunca |
| `/migrate-table` | Cuando agregás feature con BD | 10 min | 🥉 Baja · pero crítico cuando aplica |

---

## 🚀 Cómo crearlos cuando estés listo

Cuando me digas "armemos los slash commands", voy a:

1. Crear la carpeta `.claude/commands/` si no existe
2. Por cada comando aprobado · crear `<nombre>.md` con el prompt template de arriba
3. Commitear (los archivos `.claude/commands/` SÍ van al repo · NO en `.gitignore`)
4. Vos cerrás Claude Code y abrís de nuevo · los comandos aparecen disponibles

**Decisión a tomar:** ¿armamos los 3 más prioritarios primero (handoff + quick-fix-ui + security-scan) y vemos cómo te funcionan? O los 8 de un saque?

Para mí · arrancar con 3 te deja probar la idea sin sobre-ingeniería. Si los usás bien, sumamos los otros 5 después.

---

*Documento creado el 22-may-2026 · post QA del Plan B Supabase São Paulo. NO implementar todavía · pendiente decisión de Alejo sobre cuál arrancar primero.*
