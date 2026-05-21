# Plan B — Migrar ST Perfumeria a Supabase São Paulo (sa-east-1)

> **Versión 2 · 20-may-2026** · expandida por Claude Code post-charla con Alejo.
> El playbook v1 (ClaudeChat) era 40 líneas. Esta v2 es más larga porque la
> migración toca **autenticación + datos + storage + funciones edge productivos**.
> Cuando el negocio depende de algo, los pasos delicados se documentan con
> comando exacto, verificación, y plan de rollback. NO es over-engineering ·
> es lo mínimo para una migración seria.

**Objetivo:** bajar la latencia base de Supabase de ~250ms (us-west-2 Oregon) a ~30-50ms (sa-east-1 São Paulo) moviendo el proyecto entero. Causa raíz del cartel "Supabase no respondió" en el panel admin.

**Cuándo usar este plan:** Alejo ya decidió ejecutarlo el 20-may-2026 (esta noche) en lugar de esperar 1-2 semanas de telemetría del Plan A (`[LOGIN-RETRY-SP]`). El Plan A queda desplegado igual como fallback durante la transición.

**Tiempo total estimado:** 60-90 minutos (15 min de corte real perceptible · el resto es preparación y verificación post).

**Reversibilidad:** total · NO se da de baja el proyecto viejo hasta confirmar el nuevo al 100% en producción. Si algo falla, rollback = cambiar 2 env vars en Vercel y volver al viejo.

---

## ⚠️ Pre-requisitos · ANTES de arrancar

Alejo (en su máquina, antes de abrir Claude Code):

1. **Acceso confirmado:**
   - Login a Supabase Dashboard (`supabase.com/dashboard`) ✓
   - Login a Vercel Dashboard (`vercel.com/dashboard`) o `vercel` CLI auth ✓
   - GitHub auth para `git push` ✓

2. **Horario:** ya fuera de horario operativo de la perfumería (~10-21 ARG · fuera de esa ventana). El Plan B se ejecuta esta noche post-21 ARG.

3. **Avisar a las chicas:** decirles que el panel admin va a estar inestable o caído ~15 min en la ventana que vos elijas. Pedirles que terminen lo que están haciendo y no carguen ventas durante esos minutos.

4. **Tener a mano dos terminales** (PowerShell · una para Supabase CLI, otra para git):
   ```powershell
   # Terminal 1 · supabase + node + git
   cd D:\workspace\ST_Perfumeria
   ```

5. **Supabase CLI instalado:**
   ```powershell
   # Verificar versión (cualquiera 1.x+ sirve)
   npx supabase --version
   ```

6. **`pg_dump` y `psql` accesibles** (vienen con PostgreSQL client). Si no están:
   ```powershell
   # Verificar
   pg_dump --version
   psql --version
   # Si fallan, instalar PostgreSQL 16+ desde postgresql.org/download/windows
   # Solo necesitamos el cliente (no el server), pero el installer instala todo.
   ```

---

## 📋 Datos críticos a anotar

Antes de empezar, abrí un archivo de texto temporal `D:\tmp\plan-b-credentials.txt` (BORRAR DESPUÉS DE LA MIGRACIÓN) y andá llenando con cada paso:

```
=== PROYECTO VIEJO (Oregon · us-west-2) ===
Project ref:           rtgjzzkjrwbkdhkslxix
Project URL:           https://rtgjzzkjrwbkdhkslxix.supabase.co
DB connection string:  postgresql://postgres.<ref>:<password>@aws-0-us-west-2.pooler.supabase.com:5432/postgres
Anon key:              <copiar de Settings → API>
Service role key:      <copiar de Settings → API · NO COMPARTIR NUNCA>

=== PROYECTO NUEVO (São Paulo · sa-east-1) ===
Project ref:           <después del paso 1>
Project URL:           <después del paso 1>
DB connection string:  <después del paso 1 · session pooler conn string>
Anon key:              <después del paso 1>
Service role key:      <después del paso 1>
```

**⚠️ Seguridad de las service_role keys:**
- NO compartir en chat público
- NO commitear al repo NUNCA
- Las pegás SOLO en `D:\tmp\plan-b-credentials.txt` (local) y en variables de entorno
- Después de la migración, **BORRAR el archivo temporal**
- Si en algún momento sentís que alguna key se filtró, regenerarla desde Supabase Dashboard → Settings → API → Reset

---

## 🗺 Tabla de pasos (resumen ejecutivo)

| Paso | Quién | Tiempo | Riesgo |
|---|---|---|---|
| **0** | Claude Code | 10 min | Bajo · solo lectura | Backup full pre-migración (CRÍTICO) |
| **1** | Alejo | 5 min | Nulo | Crear proyecto nuevo en SP |
| **2** | Claude Code | 5 min | Bajo | Migrar schema |
| **3** | Claude Code | 10 min | Bajo | Migrar data (rows) |
| **4** | Claude Code | 10 min | **ALTO** | **Migrar auth.users con password hashes** |
| **5** | Claude Code | 10 min | Medio | Re-deploy Edge Functions |
| **6** | Claude Code | 15 min | Bajo | Migrar bucket perfume-fotos (aplicar cacheControl 1 semana) |
| **7** | Claude Code | 2 min | Bajo | Cambiar env vars Vercel |
| **8** | Alejo + Claude | 5-10 min | - | Verificación E2E |
| **9** | Alejo | 1 semana | - | NO bajar viejo · monitorear |

---

## PASO 0 · DUMP COMPLETO PRE-MIGRACIÓN (CRÍTICO) · 10 min

**Quién:** Claude Code (con ayuda de Alejo para credentials).

**Por qué:** si algo sale catastróficamente mal en cualquier paso siguiente, tenés un backup completo desde el cual restaurar. Hoy NO existe ese backup externo · el cron diario `api/cron/backup.js` guarda EN la misma Supabase (riesgo: si Supabase tiene un incidente, perdés data + backup).

**0.1 Generar el dump completo con `pg_dump`**

Desde PowerShell, con el connection string del proyecto viejo (paso 0 de "Pre-requisitos"):

```powershell
# Crear carpeta de backups si no existe
mkdir -Force D:\backups\

# Dump COMPLETO (schema + data + auth + storage metadata)
# Reemplazar <PASS> con la DB password del proyecto viejo
$env:PGPASSWORD = "<PASS-DEL-PROYECTO-VIEJO>"
pg_dump `
  --host=aws-0-us-west-2.pooler.supabase.com `
  --port=5432 `
  --username=postgres.rtgjzzkjrwbkdhkslxix `
  --dbname=postgres `
  --no-owner --no-privileges `
  --schema=public --schema=auth --schema=storage `
  --file=D:\backups\st-perfumeria-pre-migracion-20may2026.sql

# Verificar tamaño · debe ser > 100 KB típico (con 150 perfumes + clientes)
ls D:\backups\st-perfumeria-pre-migracion-20may2026.sql | Select-Object Length
```

**Verificación post-paso 0:**

```powershell
# Que el archivo exista y tenga peso razonable
Get-Item D:\backups\st-perfumeria-pre-migracion-20may2026.sql
# Esperado: Length > 100000 (al menos 100 KB)

# Que contenga las tablas críticas
Select-String -Path D:\backups\*.sql -Pattern "CREATE TABLE.*clientes|CREATE TABLE.*perfume_overrides|CREATE TABLE.*ventas" | Select-Object -First 5
# Esperado: 3 matches (o más)
```

**0.2 Subir el dump a GitHub Release (cloud externa a Supabase)**

```powershell
cd D:\workspace\ST_Perfumeria
gh release create pre-migracion-20may2026 D:\backups\st-perfumeria-pre-migracion-20may2026.sql `
  --title "Pre-migración a São Paulo · 20-may-2026" `
  --notes "Dump completo del proyecto Supabase us-west-2 antes de migrar a sa-east-1. Restaurable con pg_restore o psql. BORRAR este release después de 6 meses · contiene data sensible de clientes (telefonos, passwords hasheados, ventas)."
```

Si `gh` no está autenticado:
```powershell
gh auth login
# Seguir el wizard
```

**Verificación 0.2:** abrir `https://github.com/AAlejoB/ST-Perfumeria/releases` y confirmar que el release "pre-migracion-20may2026" existe con el archivo .sql adjunto.

**⚠️ Después de la migración exitosa (1 semana):** considerá si dejar el release o borrarlo. Tiene data sensible de clientes (passwords hasheados, teléfonos, historial). Recomendación: borrar al confirmar éxito Y haber pasado >7 días.

---

## PASO 1 · CREAR PROYECTO NUEVO EN SÃO PAULO · 5 min

**Quién:** Alejo (NO Claude Code · es UI de Supabase Dashboard).

**1.1 Crear el proyecto:**

1. Abrir `https://supabase.com/dashboard/new`
2. **Organization:** la misma que el proyecto viejo
3. **Project name:** `st-perfumeria-sp` (o `st-perfumeria-v2` · cualquiera)
4. **Database password:** generar uno fuerte (Supabase tiene botón "Generate"). **GUARDARLO** en `D:\tmp\plan-b-credentials.txt` línea "DB password proyecto nuevo".
5. **Region:** `sa-east-1 (São Paulo)` ← **CRÍTICO · confirmar esta opción**
6. **Pricing plan:** `Pro` (USD 25/mes · mismo plan que el actual). Confirmar el cargo.
7. **Create new project** · esperar 2-3 minutos hasta que esté "Healthy"

**1.2 Anotar credenciales del nuevo proyecto** (Settings → API):

```
Project URL:        https://<NEW-PROJECT-REF>.supabase.co
Anon key:           eyJhbGciOi... (público, va en frontend)
Service role key:   eyJhbGciOi... (SECRETO · acceso total a la BD)
```

**1.3 Obtener connection string del DB** (Settings → Database → Connection string → URI):

```
postgresql://postgres.<NEW-REF>:<PASS>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

**Pegar todo eso en `D:\tmp\plan-b-credentials.txt`** y avisarle a Claude Code "ya está creado, paso 2".

**Verificación post-paso 1:**

```powershell
# Test de conectividad básico al nuevo DB
$env:PGPASSWORD = "<PASS-NUEVO>"
psql `
  --host=aws-0-sa-east-1.pooler.supabase.com `
  --port=5432 `
  --username=postgres.<NEW-REF> `
  --dbname=postgres `
  --command="SELECT current_database(), current_user, version();"
```

Esperado: respuesta con `postgres | postgres.<NEW-REF> | PostgreSQL 17.x ...`

Si falla con timeout: probar el "session pooler" alt port 6543 en lugar de 5432. Si falla con auth: chequear que la password se copió bien.

---

## PASO 2 · MIGRAR SCHEMA · 5 min

**Quién:** Claude Code.

**Por qué primero el schema:** así las tablas existen antes de meter data. Si hicieramos data antes, las inserts fallan porque no hay tabla destino.

**2.1 Dump del schema (solo estructura, NO data):**

```powershell
$env:PGPASSWORD = "<PASS-VIEJO>"
pg_dump `
  --host=aws-0-us-west-2.pooler.supabase.com `
  --port=5432 `
  --username=postgres.rtgjzzkjrwbkdhkslxix `
  --dbname=postgres `
  --schema-only --no-owner --no-privileges `
  --schema=public --schema=auth --schema=storage `
  --file=D:\tmp\schema-only.sql
```

**2.2 Limpiar conflictos del schema** (Supabase nuevo tiene partes de `auth` y `storage` ya inicializadas · evitar duplicates con `CREATE TABLE IF NOT EXISTS` o filtrar):

```powershell
# Filtrar solo las CREATE de tablas/sequences/types del schema public
# (auth y storage del nuevo proyecto ya están inicializados por Supabase)
Get-Content D:\tmp\schema-only.sql | `
  Where-Object { $_ -notmatch "^(CREATE SCHEMA auth|CREATE SCHEMA storage|GRANT|REVOKE|ALTER ROLE)" } | `
  Set-Content D:\tmp\schema-only-clean.sql
```

**2.3 Aplicar el schema al proyecto nuevo:**

```powershell
$env:PGPASSWORD = "<PASS-NUEVO>"
psql `
  --host=aws-0-sa-east-1.pooler.supabase.com `
  --port=5432 `
  --username=postgres.<NEW-REF> `
  --dbname=postgres `
  --file=D:\tmp\schema-only-clean.sql 2>&1 | Tee-Object D:\tmp\schema-apply.log
```

**Verificación post-paso 2:**

```powershell
# Listar tablas del schema public del NUEVO proyecto · debe coincidir con el viejo
psql `
  --host=aws-0-sa-east-1.pooler.supabase.com `
  --port=5432 `
  --username=postgres.<NEW-REF> `
  --dbname=postgres `
  --command="SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
```

Esperado: lista de ~20 tablas (`clientes`, `ventas`, `perfume_overrides`, `perfumes_nuevos`, `combos`, `destacados`, `home_top_banner`, `trust_badges`, `votacion_config`, `votos`, `cierres_especiales`, `ajuste_horario`, `puntos_config`, `puntos_log`, `decants_custom`, `favoritos`, `lista_espera`, `opiniones`, `announcements`, `audit_log`, `analytics_events`, `perfume_clicks`, `perfume_views`, `backups`).

Si falta alguna tabla, revisar `D:\tmp\schema-apply.log` por errores y rerun el psql sobre las que fallaron.

**⚠️ IMPORTANTE · RLS policies:**

Las policies de RLS deberían venir con el schema. Verificar:

```powershell
psql --host=... --command="SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;"
```

Esperado: cada tabla con sus 2+ policies (`select_public` para anon, `write_auth` para authenticated). Si falta alguna, **NO continuar al paso 3** · el front público va a fallar al leer.

---

## PASO 3 · MIGRAR DATA · 10 min

**Quién:** Claude Code.

**3.1 Dump SOLO la data del schema public** (auth y storage van en paso aparte):

```powershell
$env:PGPASSWORD = "<PASS-VIEJO>"
pg_dump `
  --host=aws-0-us-west-2.pooler.supabase.com `
  --port=5432 `
  --username=postgres.rtgjzzkjrwbkdhkslxix `
  --dbname=postgres `
  --data-only --no-owner --no-privileges `
  --schema=public `
  --disable-triggers `
  --file=D:\tmp\data-only.sql
```

`--disable-triggers` evita que las foreign keys y triggers del nuevo schema rechacen los inserts. Se vuelve a habilitar al final.

**3.2 Aplicar la data al proyecto nuevo:**

```powershell
$env:PGPASSWORD = "<PASS-NUEVO>"
psql `
  --host=aws-0-sa-east-1.pooler.supabase.com `
  --port=5432 `
  --username=postgres.<NEW-REF> `
  --dbname=postgres `
  --single-transaction `
  --file=D:\tmp\data-only.sql 2>&1 | Tee-Object D:\tmp\data-apply.log
```

`--single-transaction` garantiza atomicidad · si falla algo en el medio, hace rollback automático y la BD queda igual que antes (todavía vacía o con lo del paso 2).

**Verificación post-paso 3 · row counts match:**

```powershell
# Función helper para contar rows en cada tabla
$tables = @("clientes", "perfume_overrides", "perfumes_nuevos", "ventas", "combos", "destacados", "favoritos", "puntos_log", "opiniones", "audit_log", "analytics_events")

foreach ($t in $tables) {
  $oldCount = psql --host=aws-0-us-west-2.pooler.supabase.com --port=5432 --username=postgres.rtgjzzkjrwbkdhkslxix --dbname=postgres -tA -c "SELECT count(*) FROM public.$t;"
  $newCount = psql --host=aws-0-sa-east-1.pooler.supabase.com --port=5432 --username=postgres.<NEW-REF> --dbname=postgres -tA -c "SELECT count(*) FROM public.$t;"
  Write-Host "$t : viejo=$oldCount  nuevo=$newCount  match=$($oldCount -eq $newCount)"
}
```

Esperado: cada tabla con `match=True`. Si alguna no matchea, revisar `data-apply.log`.

**⚠️ ABORT CHECK:** si más de 1 tabla NO matchea → algo serio salió mal → **rollback total** (truncate las tablas del nuevo proyecto y re-correr paso 3 desde cero, NO seguir al paso 4 con data inconsistente).

---

## PASO 4 · MIGRAR USUARIOS (auth.users) · 10 min · **ALTO RIESGO**

**Quién:** Claude Code, con MUCHO cuidado.

**Por qué es el paso más delicado:** la tabla `auth.users` contiene las contraseñas hasheadas con bcrypt. Si la migración rompe el hash o el formato, las chicas tienen que resetear contraseñas (UX terrible · el WhatsApp del jefe explota).

**Estrategia:** dump específico de `auth.users` PRESERVANDO la columna `encrypted_password` exacta. Insert en el nuevo con `ON CONFLICT DO NOTHING` (por si Supabase ya creó algún user default).

**4.1 Dump específico de auth.users:**

```powershell
$env:PGPASSWORD = "<PASS-VIEJO>"
pg_dump `
  --host=aws-0-us-west-2.pooler.supabase.com `
  --port=5432 `
  --username=postgres.rtgjzzkjrwbkdhkslxix `
  --dbname=postgres `
  --data-only --no-owner --no-privileges `
  --table=auth.users `
  --table=auth.identities `
  --disable-triggers `
  --file=D:\tmp\auth-users.sql
```

**4.2 Inspeccionar el dump ANTES de aplicar:**

```powershell
# Confirmar que el dump tiene la columna encrypted_password con datos
Select-String -Path D:\tmp\auth-users.sql -Pattern "encrypted_password" -SimpleMatch | Select-Object -First 3
# Esperado: encontrar referencias a la columna en el COPY o INSERT
```

**4.3 Aplicar auth.users al nuevo proyecto:**

```powershell
$env:PGPASSWORD = "<PASS-NUEVO>"
psql `
  --host=aws-0-sa-east-1.pooler.supabase.com `
  --port=5432 `
  --username=postgres.<NEW-REF> `
  --dbname=postgres `
  --single-transaction `
  --file=D:\tmp\auth-users.sql 2>&1 | Tee-Object D:\tmp\auth-apply.log
```

**Verificación post-paso 4 · CRÍTICA:**

```powershell
# Count match
$oldUsers = psql --host=aws-0-us-west-2.pooler.supabase.com --command="SELECT count(*) FROM auth.users;" -tA
$newUsers = psql --host=aws-0-sa-east-1.pooler.supabase.com --command="SELECT count(*) FROM auth.users;" -tA
Write-Host "auth.users · viejo=$oldUsers  nuevo=$newUsers"

# Que los emails específicos de jefe y empleada existan
psql --host=aws-0-sa-east-1.pooler.supabase.com --command="SELECT email, encrypted_password IS NOT NULL AS has_pass FROM auth.users WHERE email IN ('<JEFE_EMAIL>', '<EMPLEADO_EMAIL>');"
# Esperado: 2 rows con has_pass=t (true · password hash presente)
```

**⚠️ Test funcional del paso 4 (HACER ANTES de continuar):**

Crear un script Node temporal para probar login con el proyecto nuevo:

```javascript
// D:\tmp\test-auth.js
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  'https://<NEW-PROJECT-REF>.supabase.co',
  '<ANON-KEY-NUEVA>'
);

(async () => {
  const { data, error } = await sb.auth.signInWithPassword({
    email: '<JEFE_EMAIL>',
    password: '<PASS-REAL-DEL-JEFE-O-EMPLEADA>'  // pedirle a Alejo
  });
  console.log('Login test:', error ? '❌ FAIL · ' + error.message : '✓ OK');
})();
```

```powershell
cd D:\tmp
npm install @supabase/supabase-js
node test-auth.js
```

**Si el test devuelve "FAIL" con "Invalid login credentials"** → la migración de hashes falló · **NO continuar al paso 5 · investigar** (probablemente el formato `encrypted_password` se corrompió en el dump). Plan B: usar `supabase auth admin-update-user` para resetear el password de cada user manualmente, o pedirle a las chicas que usen el flow de "olvidé contraseña" (a implementar).

**Si el test devuelve "✓ OK"** → seguir al paso 5 con confianza.

---

## PASO 5 · RE-DEPLOY EDGE FUNCTIONS · 10 min

**Quién:** Claude Code.

**Las Edge Functions del proyecto viejo** (probablemente):
- `send_telegram` · usado por admin para alertas (login OK, login fail, etc.)
- `send-push` · push notifications

**5.0 (OPCIONAL pero RECOMENDADO) Versionar las funciones en el repo ANTES**

Si las funciones viven solo en el dashboard de Supabase, perdés código si Supabase se va. Esta es la ocasión de versionarlas.

```powershell
cd D:\workspace\ST_Perfumeria
mkdir -Force supabase\functions
npx supabase functions list --project-ref rtgjzzkjrwbkdhkslxix

# Para cada función listada, descargar el código:
npx supabase functions download send_telegram --project-ref rtgjzzkjrwbkdhkslxix
# El código queda en supabase/functions/send_telegram/index.ts

# Repetir con cada función
```

Después: commit a git.

```powershell
git add supabase/functions/
git commit -m "chore(functions): versionar Edge Functions pre-migración Plan B Supabase SP

Antes de migrar a sa-east-1, descargar el código de las funciones que
hoy viven solo en el dashboard del proyecto viejo. Una vez en el repo,
las funciones se pueden re-deployear desde código (reproducible).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

**5.1 Deploy de cada función al proyecto nuevo:**

```powershell
# Linkear el cli al proyecto nuevo
npx supabase link --project-ref <NEW-PROJECT-REF>

# Deploy cada función
npx supabase functions deploy send_telegram
npx supabase functions deploy send-push
# etc · una por cada función
```

**5.2 Configurar variables de entorno de las funciones** (tokens de Telegram, VAPID keys, etc.):

```powershell
# Listar secrets del proyecto viejo (NO muestra los valores, solo nombres)
npx supabase secrets list --project-ref rtgjzzkjrwbkdhkslxix

# Para cada secret, setearlo en el nuevo · necesitás los valores reales
# (los tenés en algún sitio · TELEGRAM_BOT_TOKEN, VAPID_PUBLIC_KEY, etc.)
npx supabase secrets set TELEGRAM_BOT_TOKEN=<valor> --project-ref <NEW-REF>
npx supabase secrets set VAPID_PRIVATE_KEY=<valor> --project-ref <NEW-REF>
# etc
```

**Verificación post-paso 5:**

Test de `send_telegram` con curl:

```powershell
curl -X POST `
  "https://<NEW-PROJECT-REF>.supabase.co/functions/v1/send_telegram" `
  -H "Authorization: Bearer <ANON-KEY-NUEVA>" `
  -H "Content-Type: application/json" `
  -d '{\"message\": \"Test desde migracion Plan B paso 5\"}'
```

Esperado: respuesta `200 OK` Y un mensaje de Telegram llega a tu chat.

Si no llega: chequear logs con `npx supabase functions logs send_telegram --project-ref <NEW-REF>` y ver el error (probablemente env var faltante).

---

## PASO 6 · MIGRAR BUCKET perfume-fotos · 15 min

**Quién:** Claude Code con script Node.

**Estrategia:** descargar cada archivo del bucket viejo, subirlo al nuevo CON `cacheControl: '604800'` aplicado (sinergia con el fix `[CACHE-CONTROL-1W]` que mergeamos hoy en commit `f4edd3d` · ahora se aplica a TODOS los archivos del bucket, no solo nuevos uploads).

**6.1 Crear el bucket en el proyecto nuevo:**

Desde el Supabase Dashboard del nuevo proyecto:
1. Storage → New bucket
2. Name: `perfume-fotos`
3. Public bucket: **ON** (igual que el viejo · las fotos del catálogo son públicas)
4. Create

**6.2 Script Node de migración:**

Crear `D:\tmp\migrate-storage.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const OLD = createClient(
  'https://rtgjzzkjrwbkdhkslxix.supabase.co',
  '<SERVICE-ROLE-KEY-VIEJA>'  // service role necesaria para listar
);
const NEW = createClient(
  'https://<NEW-PROJECT-REF>.supabase.co',
  '<SERVICE-ROLE-KEY-NUEVA>'
);

(async () => {
  console.log('Listando archivos del bucket viejo...');
  const { data: files, error: listErr } = await OLD.storage
    .from('perfume-fotos')
    .list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

  if (listErr) { console.error('ERR list:', listErr); process.exit(1); }
  console.log(`Total archivos a migrar: ${files.length}`);

  let ok = 0, fail = 0;
  for (const file of files) {
    try {
      // Descargar
      const { data: blob, error: dlErr } = await OLD.storage
        .from('perfume-fotos')
        .download(file.name);
      if (dlErr) throw dlErr;
      const buffer = Buffer.from(await blob.arrayBuffer());

      // Subir al nuevo con cacheControl 1 semana
      const { error: upErr } = await NEW.storage
        .from('perfume-fotos')
        .upload(file.name, buffer, {
          contentType: file.metadata?.mimetype || 'image/webp',
          cacheControl: '604800',  // 1 semana
          upsert: true
        });
      if (upErr) throw upErr;
      ok++;
      if (ok % 10 === 0) console.log(`Progreso: ${ok}/${files.length}`);
    } catch (e) {
      fail++;
      console.error(`FAIL ${file.name}:`, e.message);
    }
  }
  console.log(`\nResultado: ${ok} OK, ${fail} FAIL de ${files.length} totales`);
})();
```

**6.3 Ejecutar:**

```powershell
cd D:\tmp
npm install @supabase/supabase-js
node migrate-storage.js
```

Espera ~10-15 min para ~150 fotos.

**Verificación post-paso 6:**

```javascript
// D:\tmp\verify-storage.js
const { createClient } = require('@supabase/supabase-js');
const OLD = createClient('https://rtgjzzkjrwbkdhkslxix.supabase.co', '<SR-VIEJO>');
const NEW = createClient('https://<NEW-PROJECT-REF>.supabase.co', '<SR-NUEVO>');

(async () => {
  const oldFiles = (await OLD.storage.from('perfume-fotos').list('', { limit: 1000 })).data;
  const newFiles = (await NEW.storage.from('perfume-fotos').list('', { limit: 1000 })).data;
  console.log(`Viejo: ${oldFiles.length} archivos`);
  console.log(`Nuevo: ${newFiles.length} archivos`);
  console.log(`Diff: ${oldFiles.length - newFiles.length} archivos faltan`);

  // Cache-Control headers check
  const sample = newFiles[0];
  if (sample) {
    const url = NEW.storage.from('perfume-fotos').getPublicUrl(sample.name).data.publicUrl;
    const res = await fetch(url);
    console.log(`Cache-Control del sample (${sample.name}): ${res.headers.get('cache-control')}`);
    // Esperado: max-age=604800
  }
})();
```

```powershell
node D:\tmp\verify-storage.js
```

Esperado:
- `Viejo: N archivos`, `Nuevo: N archivos`, `Diff: 0`
- `Cache-Control del sample: public, max-age=604800` (o similar con 604800)

---

## PASO 7 · CAMBIAR ENV VARS EN VERCEL · 2 min

**Quién:** Claude Code via Vercel CLI.

**⚠️ ESTE ES EL "PUNTO DE NO RETORNO" PERCEPTIBLE** · cuando cambies las env vars + redeploy, las chicas van a empezar a hablar con el nuevo proyecto. Si algo no fue migrado bien antes, lo van a notar.

**7.1 Listar env vars actuales en Vercel:**

```powershell
cd D:\workspace\ST_Perfumeria
vercel env ls production
```

Esperado: ver al menos `SUPABASE_URL` y `SUPABASE_ANON_KEY` (o nombres similares). Apuntar los nombres exactos.

**7.2 Actualizar las env vars con los valores del proyecto nuevo:**

```powershell
# Remover los viejos
vercel env rm SUPABASE_URL production
vercel env rm SUPABASE_ANON_KEY production

# Agregar los nuevos (te va a pedir el valor por stdin)
echo "https://<NEW-PROJECT-REF>.supabase.co" | vercel env add SUPABASE_URL production
echo "<ANON-KEY-NUEVA>" | vercel env add SUPABASE_ANON_KEY production
```

**⚠️ Si el cliente JS usa las keys hardcodeadas en HTML (no env vars):**

Mirá `admin.html` y `index.html` por las constantes `SUPABASE_URL` y `SUPABASE_KEY`. Si están hardcodeadas (probable · vi que sí en admin.html durante el LOGIN-RETRY-SP):

```powershell
# Buscar
Select-String -Path index.html, admin.html -Pattern "SUPABASE_URL|SUPABASE_KEY" -SimpleMatch | Select-Object -First 5
```

Si están hardcodeadas, hay que **editarlas a mano** con la URL y anon key nuevas (con `Edit` tool de Claude Code), commitear y push.

**7.3 Trigger redeploy de Vercel:**

```powershell
vercel --prod
# O simplemente: git commit + git push (Vercel auto-deploya)
```

**Verificación post-paso 7:**

```powershell
# Esperar a que Vercel deploye
until [ "$(vercel ls st-perfumeria 2>&1 | grep 'Production' | head -1 | grep -oE '● Ready')" = "● Ready" ]; do sleep 4; done
echo "Production deployed"

# Verificar que el HTML producción usa el nuevo URL
node -e "
const https = require('https');
https.get('https://www.stperfumeria.com/?cb=' + Date.now(), (res) => {
  let body = '';
  res.on('data', (c) => body += c);
  res.on('end', () => {
    const hasNew = body.includes('<NEW-PROJECT-REF>');
    const hasOld = body.includes('rtgjzzkjrwbkdhkslxix');
    console.log('HTML referencia proyecto nuevo:', hasNew);
    console.log('HTML referencia proyecto viejo (debe ser FALSE):', hasOld);
  });
});
"
```

Esperado: `hasNew=true`, `hasOld=false`.

---

## PASO 8 · VERIFICACIÓN E2E POST-DEPLOY · 5-10 min

**Quién:** Alejo (testing manual desde su tablet o computadora).

**8.1 Login admin · NO debe pedir reset password**

1. Abrir `https://www.stperfumeria.com/admin.html`
2. Login con password del jefe (el mismo de siempre)
3. **Esperado:** entra al panel normalmente, sin errores

Si pide reset → el paso 4 (migración de hashes) falló · ver "Rollback" más abajo.

**8.2 Catálogo público lee perfumes (RLS pública OK)**

1. Abrir `https://www.stperfumeria.com/` en incognito (sin cookies)
2. **Esperado:** ver los 150+ perfumes del catálogo
3. Probar filtros (Hombre/Mujer/Unisex), buscador, click en una card

Si el catálogo está vacío → falta alguna policy de `select_public` con `USING (true)` para anon · revisar paso 2 RLS section.

**8.3 Realtime stock entre tablets**

1. Abrir el panel admin en una pestaña/tablet
2. Cambiar el stock de un perfume
3. En otra tablet/pestaña con admin abierto, **verificar que aparece un toast** "Stock actualizado por X" en ~2 segundos

Si NO aparece → habilitar Realtime en el proyecto nuevo: Dashboard → Database → Replication → Source tables → activar `perfume_overrides` y `ventas`.

**8.4 Push notifications**

1. Desde admin tab "Push", mandar un push de prueba
2. Verificar que llega a un dispositivo suscrito

**8.5 Auto-backup cron**

```powershell
# Verificar que el cron de Vercel se ejecuta sin errores
vercel logs st-perfumeria --since=10m | grep -i "backup\|cron"
```

**8.6 [LOGIN-RETRY-SP] sigue funcionando**

Forzar un timeout: temporariamente bajar el timeout del login a 100ms y reintentar. **Esperado:** ver "Reintentando…" y después entrar OK · y recibir el Telegram "Login admin OK pero requirió reintento". Después restaurar el timeout a 10000ms.

---

## PASO 9 · MANTENER PROYECTO VIEJO ACTIVO 1 SEMANA · 0 esfuerzo

**Quién:** Alejo (solo monitoreo).

**NO PAUSAR NI BORRAR EL PROYECTO VIEJO** durante al menos 7 días post-migración. Razones:

1. **Rollback rápido si algo falla:** si en los próximos días aparece un bug raro que no detectamos en E2E (ej. cron de auto-backup que falla solo a las 00:00 ARG), podés rollback en 2 min cambiando env vars de Vercel al proyecto viejo.

2. **Logs históricos:** si una chica reporta "ayer falló algo", podés mirar los logs del viejo proyecto (Supabase guarda 7 días gratis).

3. **Backups históricos:** la tabla `backups` del proyecto viejo tiene los snapshots del cron. Esos pueden ser útiles para auditoría.

**Después de 7 días sin issues:**

1. Hacer un último dump del viejo (por las dudas):
   ```powershell
   pg_dump --host=...us-west-2... --file=D:\backups\st-perfumeria-final-snapshot-27may2026.sql
   ```
2. **Pausar** el proyecto viejo desde el dashboard (paga 0 mientras esté pausado).
3. **NO eliminar** el proyecto · pausado es suficiente para no pagar dos veces. Si en 6 meses todo sigue bien y querés ahorrar el "slot", recién ahí eliminar definitivamente.

---

## 🆘 ROLLBACK · si algo sale mal

**Caso A · Algo falló en pasos 0-6 (antes de cambiar env vars):**

Cero impacto en producción · todo el tráfico sigue yendo al proyecto viejo.
- Diagnosticar el error
- Re-correr el paso fallido o ajustar
- Si querés cancelar la migración entera: eliminar el proyecto nuevo desde Supabase Dashboard. Costo: USD 0 (no se cobra hasta que esté activo > 24h).

**Caso B · Algo falló DESPUÉS del paso 7 (env vars ya cambiadas):**

Producción está con el proyecto nuevo y hay un problema.

```powershell
# Rollback INMEDIATO de env vars · 2 min total
cd D:\workspace\ST_Perfumeria
vercel env rm SUPABASE_URL production
vercel env rm SUPABASE_ANON_KEY production
echo "https://rtgjzzkjrwbkdhkslxix.supabase.co" | vercel env add SUPABASE_URL production
echo "<ANON-KEY-VIEJA>" | vercel env add SUPABASE_ANON_KEY production
vercel --prod
```

En 1-2 min, producción vuelve a hablar con el proyecto viejo. **Las chicas vuelven a poder usar normalmente** (con la latencia de Oregon que ya tenían antes, pero al menos funcional).

**Mientras tanto:** debuggear el problema con la migración. El proyecto nuevo queda ahí esperando con la data que sí migramos · podés volver a intentar el paso 7 una vez resuelto.

**Caso C · Catastrófico · perdimos data**

Si por algún motivo el proyecto nuevo tiene data inconsistente Y el proyecto viejo también se tocó:

1. **NO entrar en pánico** · tenemos backup
2. Restaurar el dump del paso 0:
   ```powershell
   psql --host=aws-0-sa-east-1.pooler.supabase.com --command="DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   psql --host=aws-0-sa-east-1.pooler.supabase.com --file=D:\backups\st-perfumeria-pre-migracion-20may2026.sql
   ```
3. Verificar row counts vs el GitHub release del backup.

---

## 🧹 CLEANUP post-migración (al final del flow exitoso)

```powershell
# Borrar credenciales temporales (CRÍTICO)
Remove-Item D:\tmp\plan-b-credentials.txt -Force

# Borrar dumps temporales (mantener el de D:\backups\)
Remove-Item D:\tmp\schema-only*.sql
Remove-Item D:\tmp\data-only.sql
Remove-Item D:\tmp\auth-users.sql
Remove-Item D:\tmp\migrate-storage.js
Remove-Item D:\tmp\verify-storage.js
Remove-Item D:\tmp\test-auth.js

# El backup de D:\backups\ y el GitHub release se mantienen 6 meses minimum
```

---

## 📋 Resumen final de outputs esperados

Al terminar la migración exitosa, vas a tener:

1. **Producción** corriendo contra Supabase São Paulo (`sa-east-1`)
2. **Backup completo** en `D:\backups\st-perfumeria-pre-migracion-20may2026.sql` (local) y GitHub release `pre-migracion-20may2026`
3. **Edge Functions versionadas** en `supabase/functions/` del repo (que antes solo vivían en dashboard)
4. **Bucket `perfume-fotos`** migrado con `cacheControl: '604800'` aplicado a TODOS los archivos
5. **Env vars de Vercel** apuntando al nuevo proyecto
6. **Proyecto viejo activo** durante 7 días como safety net
7. **Telegram alert** del `[LOGIN-RETRY-SP]` ya **NO** debería disparar tanto (la latencia bajó · menos timeouts)
8. **Una experiencia perceptible más rápida** para las chicas del local

**Latencia esperada después:**
- Login admin: 200-500ms (vs 1-2s pre-migración)
- Carga de catálogo (Supabase queries): 100-200ms (vs 500-800ms pre-migración)
- Realtime updates: <1s (vs 1-3s pre-migración)

---

*Documento técnico v2 · expandido 20-may-2026 por Claude Code en base al v1 de ClaudeChat · cualquier paso que falle, parar y diagnosticar antes de seguir · la regla de oro de migraciones productivas es "no hagas dos cosas a la vez si todavía no sabés que la primera funcionó".*
