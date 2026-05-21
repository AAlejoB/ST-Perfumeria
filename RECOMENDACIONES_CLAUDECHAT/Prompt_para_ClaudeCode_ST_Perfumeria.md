# Prompt para Claude Code — ST Perfumeria

> Sos el **ejecutor** de esta tarea. El dueño del negocio y otra instancia de Claude ya hicimos el diagnóstico y el diseño de la solución; tu trabajo es ejecutar con prolijidad y verificar. Leé todo este contexto antes de tocar nada, porque hay un orden y cosas que NO hay que hacer todavía.

---

## 1. Contexto del proyecto

- **Negocio:** ST Perfumeria, una perfumería. Tiene una web con dos partes: un **catálogo público** (lo que ve el cliente) y un **panel de admin** (lo que usan los empleados para cargar stock, precios, perfumes, etc.).
- **Frontend:** alojado en **Vercel**.
- **Backend:** **Supabase** (plan pago). Base de datos Postgres, autenticación propia (usuario y contraseña, sin Google/Facebook), Storage para fotos y realtime para actualizaciones en vivo.
- **Datos técnicos de referencia:**
  - Supabase project ref: `rtgjzzkjrwbkdhkslxix`
  - Región actual de la base: `us-west-2` (Oregon, EE.UU.)
  - El negocio opera desde Chubut, Argentina.
  - Bucket de fotos: `perfume-fotos`
  - El login del panel autentica contra Supabase Auth probando primero el email del jefe y luego el del empleado.

---

## 2. El problema que estamos resolviendo

Los empleados (en tablets, celulares y notebooks del local) ven cada tanto el cartelito **"Supabase no respondió. Probá de nuevo en unos segundos."**, **casi siempre al ingresar al panel de admin** (al poner la contraseña). Reintentando, entran.

**Causa raíz:** no es un bug. Es **latencia intermitente** en la autenticación. La base está en Oregon, lejísimo de Argentina, y con el wifi inestable del local, justo cuando el pedido de login titubea, se pasa del tiempo de espera y salta el cartelito. Como el pedido sí funciona al reintentar, confirma que es lentitud puntual, no algo roto.

(Nota: en los logs aparecieron además unos errores 500 raros y aislados en `admin_backups` y `seleccion_st_config`. NO son el problema principal y NO los arregla la migración. Si en algún momento se vuelven frecuentes, son tema aparte.)

---

## 3. La estrategia, en dos tiempos

- **Plan A (YA HECHO, es lo que vas a desplegar):** hacer el login del panel más paciente. Sin corte de servicio, sin tocar la base ni los usuarios, reversible. Es el primer movimiento porque el problema es leve e intermitente.
- **Plan B (CONTINGENCIA, NO ejecutar sin orden):** migrar el proyecto de Supabase a la región **São Paulo (`sa-east-1`)** para eliminar la latencia de raíz. Tiene más trabajo y un corte breve. Solo se activa si, después del Plan A, los empleados siguen renegando.

---

## 4. TU TAREA AHORA — desplegar el Plan A

El archivo `admin.html` que viene adjunto **ya está modificado** y listo. Tu trabajo:

1. Reemplazar el `admin.html` actual del repo por la versión adjunta.
2. Hacer commit y push para que **Vercel redespliegue** automáticamente.
3. Verificar el deploy (ver sección 6).

**El cambio que ya tiene el archivo (para que sepas qué estás desplegando):**
- Cuando el login se pasa de tiempo (timeout), antes mostraba el cartelito rojo de inmediato. Ahora **reintenta una sola vez en silencio** (espera ~1,2 s y prueba de nuevo). El empleado ve un breve "Reintentando…" en lugar del error. Recién si el segundo intento también falla, aparece el rojo.
- El margen de espera (timeout) subió de **8 a 10 segundos**.
- Se introdujo una función `_doAuthOnce()` y un bucle de hasta 2 intentos.
- **Se mantuvo intacto** el comportamiento bueno que ya existía: un timeout **no** cuenta como intento fallido, así nadie queda bloqueado por culpa de la lentitud.

**Importante:** en el archivo está visible la clave `SUPABASE_KEY`. Es la clave **pública (anon)**, está hecha para ir en el frontend y la protegen los permisos (RLS) de la base. **No la toques ni la trates como secreto filtrado.** No la muevas a variables de entorno salvo que el dueño lo pida.

---

## 5. Qué NO hacer todavía

- **No ejecutes el Plan B** (la migración a São Paulo) sin un OK explícito del dueño. Está descrito en el otro archivo solo para que entiendas el plan completo, no para ejecutarlo ahora.
- No cambies la lógica de login más allá de lo ya aplicado.
- No modifiques el catálogo público: ahí no está el problema.

---

## 6. Cómo verificar que el Plan A salió bien

Después del deploy:
- El panel sigue cargando y se puede ingresar normalmente con la contraseña correcta.
- Con contraseña **incorrecta**, sigue mostrando el error de credenciales (no debe reintentar en ese caso; el reintento es solo para timeouts/red).
- Si querés simular un timeout, podés bajar momentáneamente el valor de los `10000` para ver el "Reintentando…", y después dejarlo en `10000`.
- Confirmá que un timeout sigue **sin** sumar al contador de intentos fallidos (no debe bloquear la cuenta).

---

## 7. Los dos archivos adjuntos — qué son, para qué y por qué los necesitás entender

### Archivo 1: `admin.html` (modificado)
- **Qué es:** el archivo del panel de admin, con el login ya parchado (Plan A).
- **Para qué:** es lo que tenés que desplegar a Vercel ahora mismo.
- **Por qué necesitás entenderlo:** porque vas a reemplazar el del repo por este. Necesitás saber que el cambio clave está en la función de login (`_doAuthOnce` + el bucle de 2 intentos + timeout de 10 s) para no pisarlo ni revertirlo sin querer, y para preservar la regla de que el timeout no bloquea la cuenta. Si tocás algo del login, no rompas eso.

### Archivo 2: `Plan_B_Migracion_SaoPaulo_ST_Perfumeria.md`
- **Qué es:** la guía paso a paso para migrar el proyecto de Supabase a São Paulo.
- **Para qué:** es el plan de contingencia. Solo se usa si el Plan A no alcanza.
- **Por qué necesitás entenderlo:** para tener el panorama completo y no proponer ni arrancar la migración antes de tiempo. Si algún día el dueño te da el OK para el Plan B, este archivo es el playbook que vas a seguir, con el orden de los pasos y los puntos delicados marcados (sobre todo la migración de usuarios con sus contraseñas, para que nadie tenga que resetear).

---

## 8. Si en el futuro se activa el Plan B (resumen de delicadezas)

Solo como referencia, NO ahora:
- Supabase no permite cambiar de región en caliente: hay que crear un proyecto nuevo en `sa-east-1` y migrar todo.
- Lo delicado: migrar los usuarios con sus contraseñas **encriptadas** intactas (que no tengan que resetear).
- Copiar también: esquema, datos, funciones (ej. `send_telegram`) y el bucket `perfume-fotos`.
- Al final: cambiar la URL y la clave anon en las variables de entorno de Vercel y redesplegar.
- Hacerlo en horario muerto de la perfumería (corte estimado < 15 min) y **no dar de baja el proyecto viejo** hasta confirmar que el nuevo anda al 100%, incluido el realtime.

---

*Resumen de tu misión: desplegá el Plan A (archivo 1) ahora, verificá, y dejá el Plan B (archivo 2) en la recámara hasta que el dueño lo pida.*
