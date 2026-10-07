# 💡 Ideas — ST Perfumería

> Fichas capturadas con `/idea`. Una idea acá **no es un pendiente**: pasa a `CLAUDE.md` § Pendientes cuando Alejo la aprueba.
> Estados: 💡 idea · 📐 en diseño · 🧾 en prompt · 🔨 en curso · ✅ hecha (→ HISTORIA.md) · ❌ descartada (con el porqué, una línea).

## [WA-EMOJIS-ROTOS] · 💡 idea · 7-oct-2026

**En palabras de Alejo:** "anotá lo de los emojis" (hallazgo de Claude Code, 7-oct, probando `[STOCK-OCULTO]` en el Chrome de Alejo).
**Qué es:** los emojis del mensaje de WhatsApp (👋 💰 📦 💳 💵 🙏) llegan como «�» al abrir desde la compu. Los rompe `wa.me` al redirigir a `api.whatsapp.com`: con un link mínimo (`wa.me/…?text=Hola!%20%F0%9F%91%8B…`) el 👋 llega como `%EF%BF%BD` y el «¿» llega bien. No es del código de la web: el `href` lleva el emoji bien codificado.
**Hechos del repo:** 15 links `wa.me/` (`js/app.js` 10, `index.html` 4, `js/extras.js` 1): «Consultar →», el pedido (`sendCartToWA`), el armador, «Consultá disponibilidad». El texto sale de `buildWaMessage` (`js/app.js`). `admin.html` también usa `wa.me` (no revisé si con emojis). En el celu no se probó.
**Tamaño:** S — cambiar el dominio, probar en celu.
**Le toca primero a:** 🤖 Claude Code (probar `api.whatsapp.com/send` en compu y celu, sin enviar, antes de tocar nada).

> **🧾 Para el PREPARADOR — mandale esto tal cual:** `[WA-EMOJIS-ROTOS]`: los emojis de todos los WhatsApp de stperfumeria.com llegan como «�» desde la compu (lo rompe la redirección de `wa.me`; medido el 7-oct). Arreglo probable: `https://api.whatsapp.com/send?phone=…&text=…` en los 15 links. Antes: probar en un celu Android y un iPhone que abra la app con el mensaje entero. Viene de antes, no de `[STOCK-OCULTO]`.

## [STOCK-OCULTO] · 💡 idea · 7-oct-2026

**En palabras de Alejo:** "Interruptor «stock oculto» para la noche del domingo 25/10 (día del cambio de ST a la caja nueva). Prendido, esconde en toda la web «Sin stock», «Próximamente», «Último», «Solo quedan N» y el botón «Avisame cuando vuelva», y muestra «Consultá disponibilidad por WhatsApp». Se sube apagado (la web igual que hoy), se prueba en una vista previa y el domingo sólo se prende. Con su CACHE_VERSION. Si hay vuelta atrás, se apaga."
**Qué es:** un flag global que, prendido, hace que el catálogo no muestre ningún estado de stock (badges, urgencia, botón de lista de espera) y ponga en su lugar un «Consultá disponibilidad por WhatsApp». Apagado = idéntico a hoy. Pensado para la noche de la migración, cuando los números de stock no son confiables.
**Hechos del repo:** los textos salen de `js/app.js` L2125-2126 (badges «Sin stock» / «Próximamente»), L2163 («Solo quedan N»), L2169-2183 («Avisame cuando vuelva») y L3042 (modal de nota de stock); también la ficha, Comparar y los sets. No revisé dónde vivir el interruptor (¿tabla de config en Supabase, para prenderlo sin deploy?, ¿o constante + bump?). Cruza con `sePuedePedir` (NO ROMPER #28): esconder el estado no debería volver a dejar agregar un sin stock al pedido.
**Tamaño:** M — varias pantallas, flag a decidir.
**Le toca primero a:** 🧑 Alejo (¿el flag se prende desde el panel/base o con deploy?) y después 📐 DISEÑADOR (cómo se ve el «Consultá…» en card y ficha).

> **🧾 Para el PREPARADOR — mandale esto tal cual:** Idea `[STOCK-OCULTO]` (en `docs/IDEAS.md`, commit sin push). Fecha tope: domingo 25-oct, noche. Preguntas de diseño: (1) Para el DISEÑADOR, adentro de este bloque: dónde y cómo se ve «Consultá disponibilidad por WhatsApp» en la card, la ficha y Comparar; qué pasa con la card atenuada de un pausado. (2) Para vos: ¿el flag vive en una tabla de Supabase (se prende sin deploy, con RLS pública de lectura, NO ROMPER #5) o como constante en `app.js` con su bump de SW (NO ROMPER #4)? Si es tabla, el prompt lleva SQL y va con la ventana del panel. (3) Que el prompt pida verificar que con el flag prendido `sePuedePedir` sigue frenando el sin stock (#28) y que apagado la web da 0 diferencias contra `main`.
> **🧑 Para Alejo (decidís vos):** ¿Querés poder prenderlo desde el panel/base sin deploy (más seguro para la noche), o te sirve con push + bump de SW?

## [COMPARE-V2-GRAFICO] · 💡 idea · 23-sep-2026

**En palabras de Alejo (vía el DISEÑADOR):** el gráfico de notas del comparador va a Ideas, *"junto con que sepan a qué huele"*.
**Qué es:** la mitad de `[COMPARE-V2]` que nunca se hizo. Las diferencias destacadas ya existen (`renderUniqueNotes`, "Elegir este"); el comparador sigue mostrando las notas como texto en filas Salida/Corazón/Base, sin gráfico. La idea hermana: que el cliente entienda **a qué huele** un perfume sin conocer los nombres de las notas.
**Hechos del repo:** `js/app.js` ~L5973-6104 (compare); ningún SVG, barra ni pirámide en el render del compare.
**Tamaño:** M — UI nueva, sin base de datos.
**Le toca primero a:** 📐 DISEÑADOR.
