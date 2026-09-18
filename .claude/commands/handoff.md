---
description: Cierra la sesión limpia · HISTORIA.md + reconciliar CLAUDE.md § Pendientes + memoria · commit docs + push a main
---

Cerrá esta sesión con disciplina. Aplicá los aprendizajes #25-#29, #41/#46 y #88 de `memory/preferencias_alejo.md` (cierre con tabla de keywords/commits/estado · documentación EXHAUSTIVA cuando es crítico · separar "decidió Alejo" de "recomendó el cowork" de "propongo yo").

## Pasos

### 1. Identificá los commits de esta sesión

No uses ventanas de tiempo (`--since`): se rompen con sesiones que cruzan medianoche y con huecos largos entre sesiones (jun→ago fueron 6,5 semanas). El límite es **el último commit de cierre**:

```bash
ULT=$(git log --grep="^docs: cierre sesión" -1 --format=%H)
git log --oneline -1 "$ULT"        # confirmá cuál es el último cierre
git log --oneline "$ULT"..HEAD     # esto es la sesión
```

Agrupá los commits por keyword (los que tienen `[XYZ]` en el mensaje). Si `$ULT` viene vacío (nunca hubo cierre), avisá y usá `git log --oneline -30`.

### 2. Generá la sección nueva en `docs/HISTORIA.md`

Insertala **ANTES** del `---` que precede a la línea "**Última actualización:**" (cerca del final del archivo; ojo que cada sesión tiene su propio "#### 💬 Mensajes meta" — anclá siempre después del encabezado de TU sesión).

Formato esperado:

```markdown
### Sesión <DD-MMM-AAAA> · **<KEYWORD principal o tema central>**

<1-2 frases de qué se trabajó · qué decisión disparó esta sesión · contexto>

#### Qué se hizo

<lista de cosas concretas · con commit hashes cuando corresponda>

#### Decisiones / bugs encontrados / workarounds

<si aplica · documentá lo que aprendimos · NO solo lo que hicimos>

#### Keywords cerrados

| Keyword | Qué hace |
|---|---|

#### Keywords abiertos para próxima sesión

| Keyword | Qué falta |
|---|---|

#### 💬 Mensajes meta (opcional)

<si descubrí algo sobre cómo trabaja Alejo · va acá O en memory/preferencias_alejo.md>
```

En "Decisiones", marcá quién decidió cada cosa: **decidió Alejo** / **recomendó el cowork** / **propuse yo**. Una recomendación no es una decisión hasta que Alejo la diga con sus palabras.

### 3. Actualizá la sección "Última actualización" al final de HISTORIA.md

Reescribila con:
- Fecha de hoy
- Resumen de 2-3 líneas del estado actual
- SW version actual (si cambió)
- Pendientes priorizados con marcador 🔴/🟠/🟡/🟢

Y la línea "Próxima revisión cuando:" con la lista de pendientes en orden. Agregá una línea "**Estado del repo al cierre (<fecha>):**" con `origin/main`, rama, árbol, SW en producción.

### 3-bis. Reconciliá `CLAUDE.md` § "📌 Pendientes conocidos"

Es lo que lee la próxima sesión al arrancar: si no coincide con HISTORIA, la lista no sirve para decidir.

- **Sólo abiertos.** Los ✅ resueltos en esta sesión (o los que ya estaban tachados) se **MUEVEN** a `docs/HISTORIA.md` § "✅ Resueltos (movidos desde CLAUDE.md)", con su texto completo — no se pierde nada, pero en Pendientes quedan sólo los que faltan.
- **ID estable = el keyword entre corchetes** (`[VERCEL-ENV-VARS]`, `[RESET-EXPIRES]`), nunca el número de posición: los números se reordenan y se repiten. Si un pendiente no tiene keyword, inventale uno corto y usalo en HISTORIA también. Agrupá por prioridad (🔴 → 🟠 → 🟡 → 🟢); dentro de cada grupo el orden es el de importancia.
- **Sumá los pendientes nuevos** que salieron en la sesión (los de la tabla "Keywords abiertos" de HISTORIA) y **sacá** los que se cerraron.
- **Reescribí el pie de CLAUDE.md** ("**Última actualización:**"): fecha de hoy, 2-4 líneas de estado, y los pendientes reales en el mismo orden que arriba. El párrafo anterior se demota a un `<details>` "Contexto previo". Si el pie y el cuerpo no coinciden, la lista no sirve.
- Si en la sesión cambió algo estructural (un archivo que se movió, una tabla nueva, una regla NO ROMPER), actualizá también esa sección de CLAUDE.md.

### 4. Si descubrí aprendizajes meta sobre Alejo

Agregá numerado al final de `memory/preferencias_alejo.md` (el número siguiente al último que exista — verificá con `grep -o '^[0-9]*\.' | tail -1`, no de memoria):

```markdown
NN. **<Patrón descubierto>** · <descripción concreta con ejemplo de la sesión>
```

### 5. Commit + push

```bash
git add docs/HISTORIA.md CLAUDE.md memory/preferencias_alejo.md
# + docs/SECURITY.md, docs/DATABASE.md, etc. si los tocaste en el cierre
git commit -m "docs: cierre sesión <DD-MMM-AAAA> · <breve resumen>"
git push origin <branch-actual>:main
```

El mensaje **tiene que empezar con `docs: cierre sesión`**: es lo que el paso 1 de la próxima sesión busca. ⚠️ Si la branch es `claude/*` de worktree, usar `git push origin <branch>:main` (fast-forward; nunca `--force`). Antes del push: `git fetch origin main` y confirmar que `origin/main` es ancestro de HEAD.

Antes del commit, pasada por credenciales en lo que vas a commitear (tokens `nnn:xxx`, `eyJ…`, `sb_secret_`, `postgres://…:…@`, contraseñas conocidas). Si aparece una, **no se commitea**: se enmascara y se avisa mostrando el valor tapado (regla en `docs/SECURITY.md` § 📏).

### 6. Reporte de cierre

Al final, mostrame:
- ✅ Commits de la sesión (lista corta)
- ✅ Keywords cerrados
- ✅ Pendientes para próxima sesión (priorizados, por keyword)
- ✅ Buen cierre con onda 🟡🔵

### 6-bis. El reporte se parte en dos bloques

Después de lo anterior, dos bloques separados y **listos para copiar** (Alejo los pega en ClaudeChat para que quede del otro lado también):

**Mío (código)** — lo que puede hacer Claude Code solo: patches a aplicar, verificaciones, docs, mediciones, scripts.

**De Alejo** — lo que **sólo puede hacer él**: decisiones pendientes, permisos, acuerdos con las chicas, credenciales y env vars (Supabase, Vercel, BotFather), cosas que se hacen desde el panel o desde Windows (`git worktree prune`, borrar clientes de prueba), y cualquier "¿esto lo decidiste vos o lo estás reenviando?" que haya quedado abierto.

Cada ítem con su keyword y una línea de qué hace falta. Sin valores de credenciales.

## Restricciones

- NO hagas commits adicionales si NO hay cambios en HISTORIA.md, CLAUDE.md ni preferencias_alejo.md (ya están al día)
- NO toques código del proyecto (admin.html, app.js, etc.) · ESTE comando es solo de docs
- NO bumpees SW
- Si encontrás algo INESPERADO durante el cierre (un commit que no entendés, un archivo modificado sin commit, un `.patch` untracked), AVISAME antes de continuar
- Los `.md` del repo son CRLF en el árbol de trabajo: editá byte a byte (Node con `\r\n`) o con la herramienta Edit; nunca `sed -i` (se come el `\r`)

## Convenciones recordatorias

- Castellano rioplatense en commit + docs
- Keywords con corchetes (`[KEYWORD-CORTO]`) · son el ID estable de cada pendiente
- Cierre con buena onda (#5 de preferencias_alejo.md): "Vamos los Cadillacs", "🟡🔵", agradecimiento explícito si la sesión fue larga
