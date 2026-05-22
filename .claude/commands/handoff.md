---
description: Cierra la sesión limpia · genera resumen en docs/HISTORIA.md + commit docs + push a main
---

Cerrá esta sesión con disciplina. Aplicá los aprendizajes #25-#29 y #41/#46 de `memory/preferencias_alejo.md` (cierre con tabla de keywords/commits/estado + documentación EXHAUSTIVA cuando es crítico).

## Pasos

### 1. Identificá los commits de esta sesión

```bash
# Buscá desde el último cierre de sesión (commit que empiece con "docs: cierre sesión" o "docs: resumen sesión")
git log --oneline --since="36 hours ago" | head -30
```

Agrupá los commits por keyword (los que tienen `[XYZ]` en el mensaje).

### 2. Generá la sección nueva en `docs/HISTORIA.md`

Insertala **ANTES** de la sección "Última actualización" (que está cerca del final del archivo).

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

### 3. Actualizá la sección "Última actualización" al final de HISTORIA.md

Reescribila con:
- Fecha de hoy
- Resumen de 2-3 líneas del estado actual
- SW version actual (si cambió)
- Pendientes priorizados con marcador 🔴/🟡/🟢

Y la línea "Próxima revisión cuando:" con la lista de pendientes en orden.

### 4. Si descubrí aprendizajes meta sobre Alejo

Agregá numerado al final de `memory/preferencias_alejo.md`:

```markdown
56. **<Patrón descubierto>** · <descripción concreta con ejemplo de la sesión>
```

### 5. Commit + push

```bash
git add docs/HISTORIA.md memory/preferencias_alejo.md
git commit -m "docs: cierre sesión <DD-MMM-AAAA> · <breve resumen>"
git push origin <branch-actual>:main
```

⚠️ Si la branch es `claude/peaceful-*` o similar de worktree, usar `git push origin <branch>:main`.

### 6. Reporte de cierre

Al final, mostrame:
- ✅ Commits de la sesión (lista corta)
- ✅ Keywords cerrados
- ✅ Pendientes para próxima sesión (priorizados)
- ✅ Buen cierre con onda 🟡🔵

## Restricciones

- NO hagas commits adicionales si NO hay cambios en HISTORIA.md ni preferencias_alejo.md (ya están al día)
- NO toques código del proyecto (admin.html, app.js, etc.) · ESTE comando es solo de docs
- NO bumpees SW
- Si encontrás algo INESPERADO durante el cierre (un commit que no entendés, un archivo modificado sin commit), AVISAME antes de continuar

## Convenciones recordatorias

- Castellano rioplatense en commit + docs
- Keywords con corchetes (`[KEYWORD-CORTO]`)
- Cierre con buena onda (#5 de preferencias_alejo.md): "Vamos los Cadillacs", "🟡🔵", agradecimiento explícito si la sesión fue larga
