---
description: Aplica un fix UI quirúrgico (CSS o HTML cosmético) + bump SW + commit + push · NO toca lógica JS ni DB
---

Aplicá un fix UI quirúrgico en base a esto: **$ARGUMENTS**

## Reglas críticas (NO romper)

1. **Solo CSS o HTML cosmético** · NO tocar lógica JS · NO tocar Supabase · NO tocar auth
2. **NO crear archivos nuevos** · NO refactors · NO renames
3. **Si necesitás tocar más de 1 archivo** (más allá de `sw.js` para el bump) · PARÁ y preguntame antes
4. **Si dudás de qué hace el CSS** que tocás · preguntame antes de aplicar
5. **NO eliminar comentarios** del código (especialmente los que tienen `[KEYWORDS]` históricos · esos documentan decisiones)

## Pasos

### 1. Entender el fix

Releé `$ARGUMENTS` y entendé:
- Qué archivo tocar
- Qué selector/sección
- Qué cambio exacto

Si el pedido es ambiguo (ej. "fixear el botón mal") · preguntame qué botón / qué problema visual antes de tocar nada.

### 2. Hacer el cambio mínimo necesario

Usá `Edit` (NO `Write` masivo). Tocá lo MENOS posible. Si el fix requiere 5 líneas, NO toques 50.

Si tenés que tocar light mode + dark mode, hacé los 2 cambios pero en commits CONCEPTUALMENTE atómicos.

### 3. Bumpear SW (regla sagrada)

```bash
# Leer versión actual
grep "CACHE_VERSION" sw.js

# Bumpear +1 (ej. v1.1.72 → v1.1.73)
# Usar Edit con el reemplazo exacto del literal
```

NO te olvides este paso · si no bumpeás, las tablets de las chicas siguen viendo el archivo viejo cacheado por 24h+.

### 4. Generar mensaje de commit

Formato:
```
<tipo>(<scope>): [<KEYWORD>] <descripción corta en castellano>

<si aplica · 1-2 líneas de detalle>

SW v1.1.XX → v1.1.YY

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Tipos válidos: `style`, `fix`, `perf`, `feat`, `chore`.

Generá el keyword corto entre corchetes en base al fix. Ejemplos:
- `[CONTRAST-FIX]` · si fue contraste de colores
- `[PADDING-FIX]` · si fue espaciado
- `[LIGHT-XXX]` · si fue específico de light mode
- `[DARK-XXX]` · si fue específico de dark mode
- `[BANNER-XXX]` · si fue un banner

Si NO se te ocurre keyword claro · usá `[QUICK-FIX-<adjetivo>]` tipo `[QUICK-FIX-MOBILE]`.

### 5. Push y verificar deploy

```bash
git add <archivos modificados>
git commit -m "..."
git push origin <branch-actual>:main  # si es worktree branch
# O: git push  # si es main directo
```

Esperar Vercel deploy:
```bash
# Polling hasta Ready
until [ "$(vercel ls st-perfumeria 2>&1 | grep 'Production' | head -1 | grep -oE '● Ready')" = "● Ready" ]; do sleep 4; done
```

Verificar producción tiene la nueva versión:
```bash
node -e "const https=require('https');https.get('https://www.stperfumeria.com/sw.js?cb='+Date.now(),(res)=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{const m=b.match(/v1\.1\.\d+/);console.log('SW version en prod:',m?m[0]:'?')})})"
```

### 6. Reporte final

Mostrame:
- Archivo(s) modificado(s) + líneas que cambiaron (diff conciso)
- Commit hash + mensaje
- SW version vieja → nueva
- HTTP status de producción post-deploy

## Convenciones del proyecto

- Castellano rioplatense en código + commits + UI
- 2 espacios indent
- En `js/app.js` usar `var` (archivo viejo, consistente)
- En código nuevo (admin.html, etc.) usar `let`/`const`
- Strings con comilla simple `'` salvo cuando contienen `'`
- NO usar emojis en código salvo que se pida explícito
