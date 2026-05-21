# Prompt para ClaudeChat — Sesión SECURITY-AUDIT-S1 (ST Perfumería)

> **Para ClaudeChat:** este es el brief inicial para que diseñes el plan de la sesión de seguridad informática. Tu output esperado es un `Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md` que reemplace este archivo con instrucciones EJECUTABLES paso a paso para Claude Code, ordenadas, con verificaciones y rollback. Igual que hiciste con `Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md` (versión 1 corta que después Claude Code expandió a v2 de 848 líneas).
>
> **Para Claude Code (ejecutor):** cuando esta sesión arranque, lee primero `docs/SECURITY.md` (la fuente de verdad de los issues encontrados) + este archivo (que ClaudeChat va a expandir) + los .md generales del proyecto. NO ejecutes nada hasta tener el plan de ClaudeChat aprobado por Alejo.

---

## 1. Contexto del proyecto

**Negocio:** ST Perfumería · perfumería árabe en Comodoro Rivadavia, Argentina. ~150 perfumes, 38 clientes registrados, ~3 empleadas que usan un panel admin desde tablets Samsung Galaxy Tab A9 en horario 10-21 hs ARG. Detalle completo en `CLAUDE.md` y `docs/HISTORIA.md` (este último tiene 1300+ líneas con todo el histórico).

**Stack:**
- Frontend: HTML + JS vanilla + CSS modular en Vercel
- Backend: Supabase **Pro** plan, proyecto **`znmjhproimtprptheumy`** en `sa-east-1` São Paulo (migración del 21-may-2026 desde us-west-2 Oregon, completada con éxito en commit `f532525`)
- Auth: Supabase Auth (post-migración del Plan B) · solo para login admin (jefe + empleada · 3 users en `auth.users` incluyendo cuenta personal de Alejo)
- Auth clientes públicos: custom · tabla `public.clientes` con `password` en PLANO (issue S2 conocido como `[BCRYPT-MIGRATION]`)
- Storage: bucket `perfume-fotos` con 100 archivos · public · policies permisivas (anon CRUD)

**Pattern de trabajo Claude ↔ Claude:**
ClaudeChat (vos) propone diseño y plan · Alejo valida · Claude Code ejecuta con disciplina. Documentado en `memory/preferencias_alejo.md` aprendizaje #42 + #50. Funcionó dos veces ya (`[LOGIN-RETRY-SP]` y Plan B) y queremos repetirlo para esta sesión.

---

## 2. El problema que estamos resolviendo

El **21-may-2026 a las 5 de la mañana** (al final de la sesión de Plan B Supabase), Alejo detectó que en mi mensaje le había dicho *"hacé login con la password del jefe (SANTOMY2026 según el código)"*. Ese "según el código" le hizo ruido y me preguntó:

> *"habrá que planificar una sesión de seguridad informática con claudechat + claudecode?"*

Le confirmé que sí · ese descubrimiento expuso un issue CRÍTICO + abrió la puerta a auditar todo el proyecto.

**El issue crítico que dispara esta sesión:**
- Las passwords del jefe y la empleada están **HARDCODED en `admin.html` línea 2766-2767** como variables JS:
  ```js
  var ADMIN_PASS = 'SANTOMY2026';
  var ADMIN_PASS_EMPLEADO = 'CAFE_MATE_PROHIBIDO';
  ```
- `admin.html` es PÚBLICAMENTE accesible vía `https://www.stperfumeria.com/admin.html` (necesario, las chicas lo usan)
- Cualquier visitor puede hacer Ctrl+U (View Source) y leer las passwords en bandeja
- Es trivialmente explotable

**Issues adicionales** descubiertos durante la sesión del 21-may (todos documentados con detalle exhaustivo en `docs/SECURITY.md` · LEÉLO PRIMERO):

| # | Issue | Severidad |
|---|---|---|
| S1 | Passwords admin HARDCODED en HTML público | 🔴 CRÍTICA |
| S2 | Pass de clientes en plano en tabla `clientes` (pendiente desde antes · `[BCRYPT-MIGRATION]`) | 🔴 CRÍTICA |
| S3 | Bot Telegram token + chat_id visibles en función SQL `public.send_telegram` | 🟡 ALTA |
| S4 | Anon key del proyecto viejo sigue activa (hasta 28-may cuando se baje) | 🟡 ALTA |
| S5 | DB passwords expuestas en chat de Claude Code (necesitan rotación) | 🟡 ALTA |
| S6 | Service role keys manejadas en `D:\tmp\.env` (borrado · riesgo residual mínimo) | 🟡 ALTA |
| S7 | admin.html accesible públicamente (mitigado con lockout + telegram alerts) | 🟢 MEDIA |
| S8 | Bucket Storage `perfume-fotos` con policies muy permisivas (anon CRUD) | 🟢 MEDIA |
| S9 | `notifyTelegram` roto post Plan B (pg_net worker no procesa requests) | 🟢 MEDIA (pero hay relación con S3) |

**Por qué Alejo se preocupa especialmente:**

Alejo lo dijo textualmente al final de la sesión 21-may: *"tocamos cosas sensibles y lo que menos quiero es que se me genere un problemón que ya sabes que sufro mucho por ser buena persona"*. Es un dev de 22 años, único en su empresa, que vive de esto. Un breach acá no es un "oops sprint" · es plata real, clientes reales, reputación.

---

## 3. La estrategia · 2 fases

### **Fase 0 · Acciones manuales de Alejo (5-10 min · SIN sesión Claude)**

ANTES de arrancar la sesión técnica con Claude Code, Alejo va a:

1. **Cambiar passwords del jefe y la empleada** en `auth.users` del proyecto nuevo (via Dashboard)
2. **Avisar a las chicas** por canal privado las nuevas passwords
3. **Revocar bot Telegram** con BotFather + actualizar la función SQL `send_telegram` con el token nuevo
4. **Resetear DB passwords** de ambos proyectos Supabase (Settings → Database → Reset)

Esto **mitiga inmediatamente** los issues S1 (password hardcoded ya no abre el admin · porque cambió en `auth.users`), S3 (bot token rotado) y S5 (DB passwords rotadas). El HTML sigue mostrando passwords inútiles · esas no abren nada.

### **Fase 1 · Sesión técnica con Claude Code (TU TAREA acá, ClaudeChat)**

Diseñar el orden de fix de los issues que QUEDAN después de Fase 0:

- **S1 (limpieza):** Eliminar las constantes `ADMIN_PASS` y `ADMIN_PASS_EMPLEADO` del HTML público. Verificar que el flow de login NO depende de ellas (debe usar solo `sb.auth.signInWithPassword`).
- **S2 (`[BCRYPT-MIGRATION]`):** Implementar lazy migration. Es el fix más complejo (~2-3 horas con verificación).
- **S3 (Vault):** Mover bot_token y chat_id a Vault de Supabase. Cambiar función `send_telegram` para que lea del Vault.
- **S4:** Automático al bajar el viejo el 28-may.
- **S6:** Sin acción (residual mínimo).
- **S7:** Decidir si vale la pena agregar mitigaciones extra (path obfuscation, rate limit más estricto).
- **S8:** Restringir policies del bucket a `TO authenticated` + sanitización de filename.
- **S9 (`[FIX-TELEGRAM-PG-NET]`):** Decidir entre workaround (fetch directo desde frontend · expone token) vs diagnóstico profundo (config Supabase). Puede ir junto con S3 (si movemos token a Vault, el frontend NUNCA debería verlo · entonces forzosamente queda el approach SQL).

---

## 4. TU TAREA ahora (ClaudeChat)

Diseñá el `Prompt_para_ClaudeCode_SECURITY_AUDIT_S1.md` final con esta estructura (similar al Plan B v2 expandido):

1. **Pre-requisitos** que Alejo debe tener listos ANTES de abrir Claude Code (Fase 0 manual completada, ambientes verificados, screenshots disponibles si necesario)
2. **Tabla de pasos** con tiempo estimado y riesgo
3. **Cada paso con:**
   - Comando exacto / código exacto a aplicar
   - Verificación post-paso CONCRETA (SQL query, curl, etc.)
   - "ABORT CHECK" si algo no es esperado · NO continuar
4. **Plan de ROLLBACK** explícito por cada paso
5. **Verificación E2E final** · qué debe seguir funcionando después de todos los fixes
6. **Cleanup** · qué archivos/credenciales borrar al final

**Restricciones importantes:**
- NO romper el login del admin · las chicas tienen que poder seguir trabajando
- NO romper el catálogo público
- NO romper el storage (las fotos tienen que seguir accesibles)
- NO romper realtime (los toasts entre tablets)
- Aplicar SOLO los fixes que sean necesarios para los issues confirmados · NO refactor cosméticos
- Si algún fix tiene impacto en producción (deploy de admin.html, etc.) · hacerlo en horario muerto (post 21:00 ARG / pre 10:00 ARG)
- Mantener bumpear SW en cada cambio a archivos cacheados (`admin.html`, `index.html`, `js/app.js`, `css/styles.css`)

---

## 5. Lo que NO hacer

- **NO crear endpoints o flows nuevos** sin pedido explícito de Alejo. Esta sesión es de LIMPIEZA, no de features.
- **NO aplicar cambios a la BD productiva sin** un dump fresco previo (similar al paso 0 del Plan B)
- **NO cambiar el modelo de auth de los clientes** sin charlar primero con Alejo · `[SUPABASE-AUTH]` es un cambio mayor pendiente que requiere su propia sesión
- **NO tocar el código del admin durante horario operativo** (10-21 ARG) salvo que sea fix de emergencia

---

## 6. Archivos clave que ClaudeChat debe leer (en orden de importancia)

1. `docs/SECURITY.md` ← **fuente de verdad de issues** (creado en sesión 21-may post Plan B)
2. `CLAUDE.md` ← estado actual + pendientes
3. `docs/HISTORIA.md` ← histórico completo (las secciones relevantes son las de "Sesión 20-may" y "Sesión 21-may" arriba)
4. `memory/preferencias_alejo.md` ← cómo trabajar con Alejo (55 aprendizajes)
5. `RECOMENDACIONES_CLAUDECHAT/Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md` ← referencia del formato de playbook expandido (v2 de 848 líneas) que funcionó bien para Plan B

---

## 7. Datos técnicos de referencia (para que ClaudeChat no tenga que adivinar)

**Proyecto Supabase activo (post Plan B):**
- Ref: `znmjhproimtprptheumy`
- URL: `https://znmjhproimtprptheumy.supabase.co`
- Región: `sa-east-1` São Paulo
- Plan: Pro · compute MICRO (1 GB RAM)
- Anon key: formato `sb_publishable_*` (nuevo formato post-2024)

**Proyecto Supabase legacy (rollback hasta 28-may):**
- Ref: `rtgjzzkjrwbkdhkslxix`
- URL: `https://rtgjzzkjrwbkdhkslxix.supabase.co`
- Región: us-west-2 Oregon
- Plan: Pro · será pausado el 28-may

**Tablas críticas:**
- `public.clientes` (38 rows) · custom auth con password plano (issue S2)
- `auth.users` (3 rows) · Supabase Auth con bcrypt (jefe + empleada + Alejo personal)
- `public.perfume_overrides` (167 rows) · stock + status por perfume
- 28 tablas total en `public` schema

**Convenciones del proyecto:**
- Castellano rioplatense en código, commits, UI
- Keywords con corchetes en commits (`[KEYWORD-CORTO]`)
- SW bump SAGRADO al tocar HTML/JS/CSS cacheado (`sw.js` línea 51 · `CACHE_VERSION`)
- Mockups van todos a `mockups.html` (un solo archivo · NO crear sueltos)
- Deploy fuera de horario operativo (10-21 ARG)

---

*Una vez que ClaudeChat genere el plan expandido, este archivo se reemplaza con el plan final. La versión 1 (este brief) queda en historia git para referencia futura.*
