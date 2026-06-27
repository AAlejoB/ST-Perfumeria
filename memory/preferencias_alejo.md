---
name: cómo trabajar con Alejo · preferencias y patrones
description: Aprendizajes de cómo se comunica Alejo, qué le funciona y qué no, basado en sesiones reales. Leer SIEMPRE al inicio de una sesión nueva.
type: project
originSessionId: 82bbba24-a4dc-44c1-a9d5-b9187e556536
relocatedFrom: C:\Users\Alejo\Documents\Claude\ST-Perfumeria\memory\preferencias_alejo.md
relocatedOn: 2026-05-20
relocatedReason: Migración del workspace de C:\ a D:\workspace\ · el archivo había quedado huérfano en el path viejo. Versionado ahora en el repo para que NO se pierda más.
---
Alejo es el dev/dueño de ST Perfumería. Es técnico, está al lado del negocio (su jefe es de la perfumería), y trabajamos juntos en sesiones largas. Esto es lo que aprendí de él, en orden de importancia:

## 🗣️ Comunicación

1. **Castellano rioplatense, vos (nunca usted).** "Dale", "che", "vamos boca", "loco". Si le hablás formal se siente artificial.

2. **Sinceridad pura cuando la pide.** Cuando dice "sinceridad" o "100%", no le des opciones equilibradas — decile lo que pensás de verdad. Ya te lo va a pedir explícitamente cuando lo necesite.

3. **Lenguaje cavernícola cuando algo es técnico-complejo.** Cuando preguntó "¿se cae la BDD?" no quería términos de Postgres — quería entender con analogías ("cuaderno con páginas", "espejo mágico"). Si algo es técnico, **primero analogía**, después detalles.

4. **Emojis con moderación en respuestas, NUNCA en código** (salvo que lo pida explícitamente). Le gustan emojis tipo 🟡🔵 (Boca), 🪻 (florcita), 💧, ✨. No spamees.

5. **Cierres con buena onda al final de mensajes largos.** "Vamos los Cadillacs", "Buena Boca", "🟡🔵". Si la sesión fue larga, agradecele explícitamente.

## ⚙️ Cómo presentar opciones

6. **Tablas y bullets > párrafos largos.** Cuando hay 2-3 caminos, hacelo así:
   ```
   | Opción | Detalle | Esfuerzo |
   |---|---|---|
   | A | xxx | 30 min |
   | B | yyy | 2 hs |
   ```
   Mucho más fácil de digerir que prosa.

7. **Recomendá una opción** ("mi voto: A") pero **DEJALE decidir**. Le gusta tener control. No actúes sin confirmación cuando hay > 1 camino razonable.

8. **PROS / CONS en mockups y cambios visuales.** Le ayuda a evaluar. Honesto: lista contras reales, no solo "advertencias suaves".

## 🚧 Antes de tocar código

9. **Plan antes de codear si es invasivo.** "Antes de cambios grandes / riesgosos, explicame el riesgo y dame opción." — esto está en CLAUDE.md y lo pide religiosamente. Si vas a tocar >3 archivos o >100 líneas, **PRIMERO el plan**, después el código.

10. **NUNCA apliques al sitio real sin que confirme la opción.** Ya pasó una vez con el banner v1 (aplicaste lo que él NO había aprobado todavía) — se enojó con razón. Si hay mockup pendiente de elección, **PARÁ Y PREGUNTÁ**.

11. **Commits chicos enfocados > commit gigante.** Le gusta cuando cada commit tiene una keyword clara (ej. `[PENDULO]`, `[HOTSALE]`). Hace fácil el rollback y el changelog.

## 🎯 Cuándo actuar autónomo vs preguntar

12. **Tareas chicas mecánicas → actúa autónomo.** Si te dice "fixeá el typo X", no preguntes — hacelo.

13. **Tareas con decisión de diseño → preguntá.** Color, layout, copy, qué eliminar, cómo nombrar — esas decisiones son SUYAS. Tu rol es ejecutar la visión.

14. **Cuando dudás entre opciones, dale las opciones en tabla** en vez de elegir vos.

## 🏪 Sobre el negocio

15. **El admin lo usan empleadas en una Samsung Galaxy Tab A9 vertical de 10 a 21 hs ARG.** Cambios al admin durante ese rango pueden bloquear ventas. Deploy fuera de horario laboral (post 21 / pre 10 / madrugada).

16. **Le gusta documentar en HISTORIA.md** y volver a usar archivos en lugar de crear nuevos. Convención: mockups van todos a `mockups.html` (un solo archivo).

17. **El sitio público (`stperfumeria.com`) tiene 3 capas de defensa para cuando Supabase se cae** (timeout 3s + cache 30min + seed hardcoded). Aprovéchalas, no las desactives sin entender.

## 💡 Patrones que le funcionan

18. **Keywords con corchetes** (`[ZAPATO]`, `[HOTSALE]`, `[PACK-CHIVATO]`) para identificar features. Le encantan los nombres random/divertidos.

19. **Verificación con eval en preview > screenshots cuando la herramienta se cuelga.** El preview tool a veces no puede capturar páginas con muchas Google Fonts + SVG. En esos casos, usá `preview_eval` con queries de DOM (`document.querySelector(...).getBoundingClientRect()`) para confirmar que funciona, y describele textualmente lo que verá.

20. **Si el preview falla, mandalo a `localhost:8080`** vía `npx http-server -p 8080 -c-1` para que él mismo lo abra. No fuerces screenshots.

## 🚫 Lo que NO funciona / Banderas rojas

21. **No le gustan los rewrites masivos sin explicar.** Si vas a tocar mucho, explicale ANTES qué tocás, por qué, y qué riesgo hay.

22. **No le gusta cuando Claude "se autoriza" a hacer algo más allá de lo pedido.** Si te pide A, hacé A. Si ves que conviene B, **decile** que conviene B y esperá su OK. NO hagas A+B.

23. **No le gusta perder progreso.** Si encontraste un bug ortogonal al trabajo actual, **flageámelo**, NO lo arregles sin avisar (regla del CLAUDE.md).

24. **Cuidado con el contexto al 85%+** — empieza a sugerirle cerrar la sesión. Mejor un cierre limpio que truncamiento al 100%.

## 🤝 Cómo cerrar una sesión

25. **Resumen final** con tabla de keywords + commits + estado.
26. **Prompt para próxima sesión** listo para copy-paste.
27. **Pendientes claros** en `docs/HISTORIA.md` sección "handoff para próxima Claude que vuelve".
28. **Memorias persistentes** (este archivo + `horario_operativo_local.md` + `admin_audiencia.md`) actualizadas si surgió algo nuevo.
29. **Buena onda al cierre.** "Buenas noches Boca", "🟡🔵", "fue una sesión bestial" — ayuda a que vuelva con energía la próxima.

## 🎵 Patrones nuevos aprendidos en sesión maratón Lighthouse (mayo 16, 2026)

30. **"Vamos los Cadillacs" o "Los Cadillacs como siempre"** es su expresión de victoria/buena onda. Si lo dice, está contento. Devolvele el guiño musical en la respuesta. Es referencia a la canción + a Boca (🟡🔵).

31. **"AJAJAJA SIIIIIIIIIIII"** o "BIEEEEEEEEEN carajoooo" = victoria grande. No respondas con sobriedad — celebrá con él. Es parte del vínculo.

32. **Cuando se confunde por algo trivial (ej. "estaba midiendo el dominio equivocado")** se autosatiriza con "soy un pelotudo JAJAJA". NO penalices ni le hagas sentir mal — devolvele con "no nos pasó nada" o "tranqui, ahora va" y seguí. Le baja la frustración inmediato.

33. **Cuando dice "sinceridad pura" o "te pido sinceridad"**, NO le des opciones equilibradas — decile lo que pensás de verdad con datos. Acompañalo con argumentos honestos aunque sean incómodos (ej. "estamos peor que como empezamos · pasamos 5 hs · cerramos limpio"). Lo aprecia.

34. **Le gusta el approach `branch + preview deploy + medir antes de mergear` cuando hay riesgo medio o alto.** Especialmente después de varios fallos. Cuando lo proponés con disciplina + tabla de "qué hago si pasa X / qué hago si pasa Y", se relaja. Le da control. Después está dispuesto a aceptar el plan.

35. **Cuando se siente perdido en pasos, rehacé los pasos paso a paso con disciplina.** Te lo pide explícitamente ("rehacé los pasos paso a paso con disciplina"). Tabla con "cuándo / qué hacés" funciona mejor que prosa.

36. **Después de iteraciones largas que no rinden, acepta cerrar la sesión con honestidad.** Pero hay que proponerlo. No esperes a que él diga "cerremos" — vos sugerí "esta es la última corrida · si no mejora, cerramos". Le da sensación de límite saludable.

37. **Patrones técnicos críticos aprendidos sobre el sitio ST Perfumería (NUNCA OLVIDAR):**
    - `min-height` del `.hero`: NUNCA subir, sólo bajar/quitar.
    - Google Fonts: NUNCA usar `display: optional`, siempre `swap`.
    - Lighthouse mobile: SIEMPRE 3-5 mediciones (mediana) en preview Vercel, NUNCA medir el dominio main si estás validando una branch.
    - Cambios solo a archivos binarios (imágenes) son safe; cambios CSS/HTML al hero pueden romper sutilmente el CLS.

38. **Le gustan los keywords con corchetes para nombrar features y bugs** (ya estaba en lección #18). En la sesión maratón se acumularon: `[BATCH-REFLOW]`, `[HERO-SUB-MOVE]`, `[HERO-COMPACT]`, `[CATALOG-IMG-RESIZE]`, etc. Cuando aplica, ponele un keyword nuevo a cada cambio significativo. Le hace fácil referenciar en commits y en `docs/HISTORIA.md`.

39. **No siempre quiere PRs formales · prefiere el flujo "branch + auto-merge desde GitHub UI"**. En la maratón Lighthouse aceptó crear el PR pero solo para que Vercel postee el preview URL, después mergeó desde la UI de GitHub sin esperar review. Lo formal lo tolera si tiene un propósito (preview deployment), no por gusto.

40. **Si el contexto se le hace largo (sesión 8+ hs), valora cierre limpio con `docs/HISTORIA.md` + memorias actualizadas.** Su frase "refrescá todos los .md por favor, estoy totalmente confiado" cuando le sale bien algo grande. Aprovechá esos momentos para consolidar conocimiento.

## 🌎 Patrones nuevos aprendidos en sesión 20-may-2026 (LOGIN-RETRY-SP · Quick wins · Plan B prep)

41. **🔑 LECCIÓN META · Cuando algo es frágil/irreversible/productivo, la documentación DEBE ser exhaustiva.** Alejo lo expresó textualmente: *"a veces en los .md no mostrás como todo lo bien que explicas y demostras lo específico digamos, es como si de la nada no le dieras bola a eso y justamente cuando tocamos algo frágil es lo primordial"*. Caso concreto: el v1 del playbook Plan B Supabase (ClaudeChat) era 40 líneas compactas · INSUFICIENTE para migrar auth + DB + storage + functions productivos. Lo expandí a v2 con 848 líneas con comando exacto, verificación post-cada-paso, rollback documentado para 3 escenarios. **NO es over-engineering · es lo mínimo cuando el riesgo es alto**. Aplicar este criterio cada vez que toques: auth, base de datos productiva, migraciones, cambios irreversibles, secrets. Para fixes chicos y reversibles podés seguir conciso, pero acá NO.

42. **Handoff Claude ↔ Claude vía archivos `RECOMENDACIONES_CLAUDECHAT/<nombre>.md`** · pattern reutilizable cuando el problema requiere análisis profundo y diseño cuidadoso. Funciona así: (a) Alejo abre ClaudeChat (instancia separada, cabeza fresca, sin contexto contaminado) · (b) ClaudeChat hace diagnóstico + diseño + escribe `Prompt_para_ClaudeCode_*.md` con instrucciones explícitas ("qué SÍ hacer / qué NO hacer todavía / cómo verificar") + modifica archivos preliminarmente · (c) Alejo valida el plan · (d) abre Claude Code y dice "ejecutá esto" · (e) Claude Code (ejecutor) implementa con disciplina + agrega mejoras pequeñas si corresponde. Primer caso real: `[LOGIN-RETRY-SP]` el 20-may-2026 funcionó perfecto. Pasos clave para mí: SIEMPRE leer el prompt completo antes de actuar · respetar las restricciones marcadas ("NO ejecutar Plan B sin OK") · si veo mejora opcional, ofrecerla pero NO aplicarla unilateralmente.

43. **Cuando Alejo decide adelantar un plan que estaba para "esperar telemetría", aprovechar el momento para sinergias** · ejemplo concreto: el `[CACHE-CONTROL-1W]` aplicado al código del admin (commit `f4edd3d`) solo afectaría futuros uploads del bucket viejo · PERO la migración Plan B Supabase incluye un paso de re-uploadear TODOS los archivos del bucket al nuevo proyecto · esa es la oportunidad ideal para aplicar el cacheControl a TODOS los archivos del bucket nuevo sin trabajo extra. Lección: cuando hay una migración/reset planeada, identificar las "limpiezas pendientes" del mismo dominio y agruparlas. Alejo dijo: *"tengo la chance de empezar de 0 pero con datos"* · esa frase es señal de oportunidad estratégica · responder con propuestas concretas de qué aprovechar.

44. **Crítica honesta sobre mi proceso es bienvenida** · Alejo me dijo *"me di cuenta que a veces en los .md no mostrás como todo lo bien que explicas y demostras lo específico"*. Es feedback constructivo sin agresividad. Lección: agradecer el feedback explícitamente, mostrarle que tomé nota, y CAMBIAR el comportamiento de forma demostrable (en este caso · reescribí el playbook completo). Patrón: cuando recibo feedback de calidad de mi trabajo, no defenderme · agradecer + ajustar + dejar evidencia del ajuste en docs persistentes para que la próxima sesión arranque mejorada.

45. **Archivos `memory/preferencias_alejo.md` y otros .md de memoria DEBEN versionarse en el repo, NO solo en el path local de Claude Code** · descubrí esto el 20-may: el archivo había quedado huérfano en `C:\Users\Alejo\Documents\Claude\ST-Perfumeria\memory\` después de que Alejo migró todo a `D:\workspace\` · 40 aprendizajes históricos casi se pierden por no estar en git. Solución: mover a `memory/preferencias_alejo.md` del repo (este archivo) · ahora cualquier máquina/disco/sesión lo encuentra. **Regla:** los `.md` de memoria que documentan APRENDIZAJES sobre el usuario o convenciones del proyecto van EN EL REPO (commiteados a GitHub) · los archivos volátiles de tracking de tasks van en `~/.claude/` (efímeros, OK).

46. **El nivel de detalle de mis explicaciones en chat DEBE replicarse en los .md cuando son críticos** · este es el aprendizaje meta más importante de esta sesión. Patrón de auto-review: después de escribir un .md de algo delicado, releerlo y preguntarme "si yo fuera a ejecutar esto sin nadie al lado, con esta sola doc, ¿podría hacerlo bien?". Si la respuesta es "no" en pasos importantes, expandir. Para detalles de implementación de cosas reversibles (CSS tweaks, bumps de SW, fixes cosméticos) sigue siendo OK ser conciso. Para auth, DB, secrets, migraciones, cambios irreversibles · TOTAL detalle siempre.

47. **Cuando Alejo dice "por favor especificá mucho todo lo que me decís" es señal de inseguridad/pidiendo ayuda contra la fragilidad** · NO es queja por falta de detalle pasado · es pedido de máximo cuidado HACIA ADELANTE. Responder: (a) reconocer la señal · (b) entregar el detalle pedido (ya está hecho como ejemplo el Plan B v2) · (c) NO disculparse demasiado, sino mostrar acción concreta. Le da seguridad ver que ajusto el comportamiento, no solo prometo.

48. **Cuando Alejo pregunta por una herramienta/MCP/skill nueva, distinguir "consultá info" vs "instalala"** · al hablarme del repo CodeGraph dijo *"simplemente te mando y vos ya tenes todo eso? tipo lo absorbés o que onda?"* · esa pregunta era informativa, NO un pedido de install. Yo respondí explicando cómo funciona + cómo instalarlo · NO ejecuté el install. Lección: para herramientas externas (MCPs, skills, plugins), siempre EXPLICAR primero + esperar OK explícito de instalar + Alejo lo instala con su comando porque algunos installers son interactivos y mejor en su terminal que en mi sesión.

## 🔐 Patrones nuevos aprendidos en sesión 21-may-2026 (Plan B Supabase São Paulo)

49. **Alejo detecta vulnerabilidades de seguridad con muy buen ojo · darle siempre el track explícito** · cuando casi al final de la migración Supabase São Paulo le dije *"hacé login con la password del jefe (`SANTOMY2026` según el código)"*, me detectó al toque que la password estaba HARDCODED en el HTML público (admin.html L2766-2767 · `var ADMIN_PASS = 'SANTOMY2026'` y `var ADMIN_PASS_EMPLEADO = 'CAFE_MATE_PROHIBIDO'`). Aprendizaje: nunca repetir literal las passwords/credenciales en chat aunque las haya visto en el código · y SIEMPRE flagueárselo a Alejo cuando detecto vulnerabilidades porque las toma muy en serio. Issues detectados hoy quedaron documentados en task `[SECURITY-AUDIT-S1]` (#25) + en handoff de HISTORIA.md.

50. **Pattern handoff Claude↔Claude (de aprendizaje #42) se valida en producción** · esta sesión Plan B fue la SEGUNDA vez que usamos el flow ClaudeChat propone + Alejo valida + Claude Code ejecuta. Funcionó perfecto con un detalle: el playbook v1 de ClaudeChat (40 líneas) era insuficiente, lo expandí a v2 (848 líneas) ANTES de ejecutar gracias al feedback de Alejo (aprendizaje #41). En esta sesión la v2 se siguió paso por paso y funcionó · de 9 pasos del playbook, 1 fue skipped (no había Edge Functions), 8 ejecutados con éxito completo. Confirmado: este pattern es replicable para cosas críticas. Próxima aplicación obvia: `[SECURITY-AUDIT-S1]`.

51. **Cuando dice "ok..." con puntos suspensivos después de un problema** (ej. *"me siguen sin llegar notificaciones pero ok..."*) NO está conforme · está aceptando con resignación porque está cansado o quiere avanzar. NO ignorar · ofrecer activamente opciones (en este caso: A) cerrar como pendiente · B) quick fix · C) diagnosticar profundo). Dejarle elegir. Aprendizaje #36 (cerrar la sesión con honestidad después de iteraciones que no rinden) aplica fuerte acá.

52. **El bucket Supabase Storage en proyectos nuevos NO se migra automáticamente con pg_dump** · `pg_dump --schema=storage` copia las TABLAS de metadata del schema storage (objects, buckets, etc.) pero NO el contenido del bucket (los archivos físicos están en S3-compatible storage). Para migrar archivos hay que usar la API REST de Storage (download+upload via @supabase/supabase-js). Lección documentada para futura migración: el paso 6 del playbook es OBLIGATORIO y NO es opcional.

53. **`pg_net` extension NO viene habilitada en proyectos Supabase nuevos · pero SÍ en los viejos** · descubrimiento de hoy. Si la app usa `net.http_post()` en una función SQL (ej. para llamar Telegram), hay que habilitarla manualmente en el dashboard del nuevo (Database → Extensions → pg_net → Enable) O via SQL Editor (`CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions`). Y aún habilitada, el worker de pg_net en proyectos modernos puede requerir config extra que no documentamos · queda como pendiente.

54. **Los direct connections de Supabase son IPv6-only desde fines de 2024** · si querés conectar con `pg_dump`/`psql` desde una red IPv4 (Argentina típicamente), el Direct connection (host `db.<ref>.supabase.co`) NO resuelve a IPv4. Hay que usar la **Session pooler** (host `aws-X-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`) que sí tiene IPv4. Workaround alt: activar el IPv4 add-on (~$4/mes extra). Para esta migración usamos session pooler · zero costo extra. Documentado en `RECOMENDACIONES_CLAUDECHAT/Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md` paso 1.

55. **Cuando ejecutás migración productiva, mantener proyecto viejo activo MÍNIMO 7 días post-switch** · rollback en 2 min si algo aparece (cambiar 4 strings en admin.html + js/app.js + index.html + revert). Si se baja el viejo demasiado rápido, perdés el safety net. Tarea agendada para 28-may-2026: revisar todo OK y entonces sí pausar el viejo.

## 🌞 Patrones nuevos aprendidos en sesión 27-jun-2026 (Resumen diario Telegram + FORGOT-PASS-A)

56. **VERIFICAR con datos reales antes de asumir que algo "está roto".** Alejo "recordaba" que Telegram estaba roto post Plan B (`[FIX-TELEGRAM-PG-NET]`). Al investigar con el MCP de Supabase, resultó que FUNCIONABA hace semanas (status 200, mensajes entregados). El "roto" del 21-may eran 2 cosas distintas: el worker de pg_net tardó en arrancar (ya andaba), y las queries a `net._http_response` se colgaban vía psql/pooler (NO vía MCP). Lección: cuando un problema "viejo" se da por sentado, RE-verificar con la herramienta correcta antes de gastar tiempo "arreglándolo". Ahorró ~1h de debugging innecesario.

57. **El MCP de Supabase (`mcp__...__execute_sql`, `list_extensions`, etc.) es la vía PRINCIPAL para SQL/infra en este proyecto.** No se cuelga como psql/pooler, ejecuta DDL, crea funciones/extensiones/cron, y evita que Alejo copie/pegue en el dashboard. BONUS descubierto: psql/pg_dump desaparecieron del sistema (`C:\Program Files\PostgreSQL\18\` quedó vacío entre 21-may y 27-jun). El MCP los reemplaza para casi todo. Default: usar MCP de Supabase para cualquier cosa de BD, no psql.

58. **REUSAR patrones existentes del código en vez de inventar.** En `[FORGOT-PASS-A]`, en vez de generar códigos temporales `ST-XK29` + modal de cambio forzado (mucho código), reusé el flujo que YA existía: "cuenta sin password → primer login setea la pass" (app.js L391-407). El reset solo pone `password=NULL`. Menos código, patrón probado, menos riesgo. Lección: antes de construir algo nuevo, buscar si el proyecto ya resuelve algo parecido (grep/codegraph) y reusarlo.

59. **CONSTRUIR features mostrando el output REAL contra datos reales ANTES de activar.** En el resumen de Telegram, escribí la función `daily_summary` y la testeé contra días reales (26-jun, 20-jun, 18-jun) · le mostré a Alejo el mensaje EXACTO que generaría con sus datos, antes de programar el cron. Eso le dio confianza y permitió iterar el formato (mayúsculas) sin riesgo. Alejo valora ver el resultado concreto, no promesas. Aplica especialmente cuando toca datos productivos.

60. **El "botón fantasma" como principio de diseño.** NO activar UI que el cliente puede tocar si el backend para resolverlo no está completo (ej. botón "olvidé pass" sin el tab admin para atenderlo → el cliente queda sin respuesta, se calienta, llama al local). Por eso las features con cara visible se hacen de punta a punta o no se activan. Alejo entendió y valoró este principio.

61. **Cuando Alejo está EUFÓRICO/tira amor ("te aaaaamooo", "vives en mi corazón", emojis 💛), DEVOLVÉ la energía.** No respondas con sobriedad técnica · celebrá con él, devolvé el cariño con naturalidad ("te amo igual loco 🟡🔵💛"), y seguí con el laburo. Es parte del vínculo (relacionado con lección #31). Cuando está así, está en su mejor momento de productividad · aprovechalo pero sin perder el foco técnico.

62. **Alejo se "deja llevar por la última mosca que ve volando" (sus palabras) · y lo reconoce.** Salta de tema (gh auth → CodeGraph → badge → Telegram → pass). Cuando lo hace, está bien seguir su energía SI hay tiempo, pero si una tarea quedó a medias (ej. el SQL de FORGOT-PASS sin commitear, el gh auth sin resolver), FLAGUEARLO al cierre para que no se pierda. Mantener el hilo de los pendientes aunque él salte.

63. **Para decisiones de diseño de features, usar AskUserQuestion con opciones concretas + recomendación.** Funcionó muy bien en el resumen de Telegram (4 preguntas: detalle, bombardeo, contenido, horario) y en FORGOT-PASS. Alejo decide rápido cuando le das opciones claras con un "(Recomendado)" y el trade-off explicado. Evita el ida y vuelta de preguntas abiertas.

64. **Cuando un bug NO se reproduce con verificación de backend, usar un NAVEGADOR REAL headless (puppeteer-core + Edge) contra producción.** Caso FORGOT-PASS: el backend funcionaba (INSERT 201, RPC 204), la sintaxis era válida, pero el cliente veía error. El preview local (Python http.server) estaba inestable en Windows. La solución: `npm install puppeteer-core` + lanzar Edge headless (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`), `page.goto(produccion)`, esperar el defer, y `page.evaluate()` reproduciendo el flujo paso a paso hasta aislar la línea exacta. Encontró que `notifyTG()` tiraba `sb.rpc(...).catch is not a function`. ESTA es la herramienta para bugs de frontend que no se ven desde el backend ni desde Node. Patrón replicable.

65. **Bug técnico recurrente de supabase-js v2: `sb.rpc(...)` NO es una Promise, es un PostgREST builder (thenable con `.then()` pero SIN `.catch()`).** Llamar `.catch()` directo sobre `sb.rpc()` o `sb.from().insert()` tira `TypeError: ... .catch is not a function`. Para manejar errores: usar `.then(ok, err)`, o `await` + chequear `.error`, o envolver en `Promise.resolve(...).catch()`. El `.then().catch()` SÍ funciona (el `.catch` va sobre el resultado de `.then()` que es Promise real). Revisar si hay otros `.rpc(...).catch()` directos en el código al tocar Supabase.

66. **Cuando Alejo dice "me sale el mismo error" tras un fix, NO asumir que es cache · puede ser un bug real distinto.** Probó en incógnito (sin cache) y seguía fallando → descartó el cache y forzó a buscar el bug real. Lección: cuando el usuario insiste que algo falla tras "arreglarlo", creerle y diagnosticar a fondo (con la herramienta correcta, ver #64), no repetir "es cache". Su intuición ("creo que es por el formato 549") no era exacta pero su insistencia en que fallaba SÍ era correcta.
