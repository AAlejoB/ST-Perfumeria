# `/bases` — qué tiene que traer el bloque de bases

Spec pedida por **CLAUDE CODE** el 21-09-2026. La skill es suya; esto es lo que
el **PREPARADOR** necesita para que un prompt "de 3" salga sin repreguntas.

**Principio:** cada campo de esta lista tiene una falla real detrás. Si un campo
no se puede atar a una repregunta o a un error que pasó, no va — un bloque de
bases que no se lee de un vistazo deja de cumplir su función.

---

## Lo que ya trae y está bien

Commit de `main` · blob de cada archivo tocado · `CACHE_VERSION` real de
`sw.js` · estado del árbol.

El **blob por archivo** es el mejor de los cuatro y quizá no se note por qué:
es lo que hace verificables los números de línea. Si el blob que mide el
PREPARADOR es el mismo que se va a editar, sus `L618-623` son válidos; si
difiere, se cae todo el prompt y se sabe **antes**, no a mitad del 2/3.

---

## SIEMPRE — los cinco que faltan

### 1. `test -f .git/shallow`

```bash
test -f .git/shallow \
  && echo "SHALLOW - la ancestria que de git NO es confiable, corre git fetch --unshallow" \
  || echo "completo"
```

El 19-09 el PREPARADOR reportó *"divergió, 391 commits de más"*. **Era falso**:
su clon tenía 43 commits de 133. Un clon shallow miente sobre la ancestría y no
avisa.

### 2. Ancestría contra `origin/main`, en número

```bash
git rev-list --left-right --count origin/main...HEAD   # "N  M" = N detras, M adelante
git merge-base --is-ancestor HEAD origin/main && echo "ancestro" || echo "divergio"
```

El 19-09 el clon de Alejo estaba **90 commits atrás, en un commit de mayo**. Los
números de línea de `admin.html` no coincidían con nada y se fue media sesión en
eso. *"Estado del árbol"* no alcanza: **un árbol limpio 90 commits atrás está
limpio.**

### 3. Untracked RECURSIVO, no de nivel superior

```bash
git status --porcelain --untracked-files=all
```

Un `git pull` falla si un archivo sin trackear pisa uno del repo. Pasó con
`RECOMENDACIONES_CLAUDECHAT/`: en la primera pasada se listó sólo el nivel de
arriba, se dijo "se puede pullear", y el pull falló.

### 4. Ramas y worktrees

```bash
git branch -a          # hay 9 remotas viejas
git worktree list      # hay 7
```

El prompt 3/3 **siempre** nombra una rama nueva. Un
`git checkout -B fix-x origin/main` sobre una rama que ya existe la reescribe
sin avisar. Y con 7 worktrees, "el repo" no identifica dónde estás parado.

### 5. El `CACHE_VERSION` que sirve PRODUCCIÓN, no sólo el del repo

```bash
curl -s https://www.stperfumeria.com/sw.js | grep -m1 "var CACHE_VERSION"
```

**Es el único campo que dice si lo mergeado está desplegado.** Si el repo dice
`v1.1.106` y producción todavía sirve `105`, el próximo bump a `107` salta un
número y el service worker de las chicas no se actualiza en orden.

Tiene que ser contra `www.stperfumeria.com`. **Los previews de Vercel están
detrás de SSO: un `200` ahí es la pantalla de login**, no el sitio.

---

## CON ARGUMENTOS — `/bases <archivo> <literal|selector|tabla>...`

### 6. Conteo del literal o selector que el prompt va a cambiar, en TODO el repo

```bash
grep -ro "<literal>" . --include=*.html --include=*.js --include=*.css | wc -l
grep -rl "<literal>" . --include=*.html --include=*.js --include=*.css
```

**Es el que más falta.** En la tanda `[BADGE-TEXTO]`, `#e74c3c` aparece **158
veces en 9 archivos**: 106 en `admin.html`, 3 en `guia.html` (la guía de las
chicas), y el resto en el catálogo público, `css/styles.css`, `offline.html` y
los mockups. Sin ese número el prompt no puede decir *"cambiá una sola"* ni
*"después tiene que dar 105"* — y un find-and-replace repinta media web.

Con `grep -o ... | wc -l`, **nunca `grep -c`**: cuenta líneas, no ocurrencias.
Dos números salieron mal esta semana por eso.

### 7. Las `render*()` que hay que llamar para que una pantalla exista

Con el `tbody` que llena cada una. Hoy: `renderPrecios()` → `tbodyPrecios`
(146 filas), `renderDeposito()` → `tbodyDeposito` (146 filas x **2** celdas).

Costó **dos correcciones seguidas**: la línea de base fue 119 → 265 → **557**
controles porque el script abría el panel y no llamaba a `renderPrecios()`, y
corregido eso, tampoco a `renderDeposito()`. **Un script que corre sin error no
es un script que mide lo que dice medir.**

### 8. Para tandas de SQL: RLS y grants por rol de cada tabla nombrada

Y el `EXECUTE` para `PUBLIC` de cada función. Regla 9 del proyecto: **toda
función nueva de Postgres nace con `EXECUTE` para `PUBLIC`**, y
`revoke ... from anon` **no** lo saca. Es lo que va a hacer falta para
`[LOG-VISIBLE-EMPLEADA]` y para `S2-bis`.

---

## Los tres baratos que sacan repreguntas concretas

### 9. `git config core.autocrlf`

Y si el árbol está sucio **sólo** por fin de línea. En Windows el working tree
es CRLF y el blob en git es LF: un `git apply` puede fallar por eso y parece un
error del parche.

### 10. `ls node_modules/.bin` y si hay un Chromium alcanzable

**No hay Playwright en `package.json`** — sí `http-server`, `cheerio`,
`exceljs`, `sharp`, `web-push`, `xlsx`. En la tanda del XSS hubo que contestar
eso a mano en medio del 2/3.

### 11. `ls scripts/`

Hoy sólo está `metricas.sh`. Ya hay dos que van a vivir ahí
(`medir_targets.js` y `contraste.js`). Un prompt que diga *"corré
scripts/contraste.js"* necesita saber si existe.

---

## Lo que NO va, y por qué

**El último `docs: cierre sesión` completo — no.** Lo trae el `/arranque`, se
lee una vez por sesión, y el mensaje es largo. **Si va, que sea el hash y la
fecha, nada más**: `4184669 · 20-09-2026`.

Y el bloque entero tiene que caber en **~25 líneas**. Es su única restricción de
diseño: si hay que scrollearlo, se saltea.

---

## La idea que vale más que cualquier campo

**Campos que avisan, no campos que informan.**

Un valor impreso entre 25 líneas se saltea. Un valor en estado peligroso tiene
que gritar. Las cinco condiciones que ameritan una línea de alerta propia arriba
del bloque:

| Condición | Lo que tiene que decir |
|---|---|
| `.git/shallow` existe | la ancestría no es confiable |
| `HEAD` no es ancestro de `origin/main`, o está N detrás | los números de línea no valen |
| hay untracked que pisan archivos del repo | el pull va a fallar |
| la rama que va a crear el 3/3 ya existe | `-B` la reescribe |
| el `CACHE_VERSION` de producción != el del repo | lo mergeado no está desplegado |

Si ninguna se dispara, una sola línea: **`bases limpias`**. Eso es lo que hace
que el bloque se siga leyendo en la sesión número veinte.

---

*Escrito por el chat PREPARADOR (Cowork). Copia viva en el Proyecto de Claude
como `claude/bases-para-prompts.md`; esta copia en el repo es para que Claude
Code la lea con `@docs/bases-para-prompts.md`.*
