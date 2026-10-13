# 💡 Ideas — ST Perfumería

> Fichas capturadas con `/idea`. Una idea acá **no es un pendiente**: pasa a `CLAUDE.md` § Pendientes cuando Alejo la aprueba.
> Estados: 💡 idea · 📐 en diseño · 🧾 en prompt · 🔨 en curso · ✅ hecha (→ HISTORIA.md) · ❌ descartada (con el porqué, una línea).

## [LEGAL-ANTES-DE-SIPAGO] · 💡 idea · 12-oct-2026

> **Prioridad baja (Alejo, 12-oct):** no darle mucha importancia por ahora. Puede que ni haga falta hacerlo en este repo: el proyecto nuevo armado de cero por Lautaro (plataforma-saas) ya resolvió SiPago y quizá también esto. Antes de arrancar, mirar qué trae ese proyecto. Las páginas legales del sitio de hoy se necesitan igual mientras siga en producción.

**En palabras de Alejo:** pegó el prompt de un video («quiero que me demanden por esta web hecha con IA…»: política de privacidad, términos y cookies, consentimiento en los formularios, política de devoluciones, datos del negocio, alt de las imágenes, contraste, reseñas falsas, copyright de las fotos, leyes locales) y preguntó si conviene mirar eso en una tanda. Dijo que sí a anotarla.
**Qué es:** una tanda para dejar el sitio público en regla **antes de prender SiPago** (noviembre/diciembre): páginas de privacidad, términos y cookies; política de cambios y devoluciones con el botón de arrepentimiento; datos del negocio visibles (razón social, CUIT, domicilio, Defensa del Consumidor); aviso de consentimiento en «Unite a ST», la lista de espera y el registro; revisar «100% Originales» y las opiniones; copyright de las 346 fotos. Los puntos legales de Argentina (Ley 24.240, Ley 25.326, lo que pida SiPago) se **confirman con fuentes, no de memoria**, y no es asesoramiento legal.
**Hechos del repo (12-oct):** (1) el sitio público no tiene ninguna página ni link legal (`index.html` y `js/app.js` no mencionan privacidad, términos, cookies, arrepentimiento ni CUIT; lo único que aparece es el comentario de `js/app.js:319`); (2) no hay trackers de terceros: los scripts son `supabase-js` (jsdelivr), `js/app.js`, `js/dvd-bouncer.js` y `perfumes.js`, las fuentes son propias y el analytics es propio (`analytics_events`); (3) el HTML fijo de `index.html` no tiene `<img>` sin `alt` (las que arma el JS no se revisaron); «100% Originales / Garantía de autenticidad» está en `index.html:759`. NO ROMPER #10: una página pública nueva no puede caer en `.vercelignore` (que excluye todo `*.md`).
**Tamaño:** M — varias pantallas y textos, sin SQL; con acuerdo con terceros (SiPago, quizá un abogado o contador).
**Le toca primero a:** 🧑 Alejo (datos del negocio y reglas de cambio y devolución) y después 🤖 Claude Code (relevamiento con fuentes y páginas; Claude in Chrome para mirar el sitio real).

> **🧑 Para Alejo (decidís vos):** (1) ¿cuáles son los datos del negocio que se muestran (razón social, CUIT, domicilio)?; (2) ¿qué política de cambios y devoluciones querés dar (plazos, perfume abierto o cerrado, decants)?; (3) ¿de dónde salieron las fotos de los frascos?; (4) ¿lo revisa un abogado o contador antes de publicar? Se cruza con `[SIPAGO-VALIDA-STOCK]` y `[STRIX-ANTES-DE-SIPAGO]`: las tres van antes de prender SiPago.

## [CAJA-CUADERNO] · ❌ descartada · 12-oct-2026

> **❌ Descartada el 12-oct (Alejo, ya anotada la ficha):** no hace falta. En unos días ST se muda al sistema de admin nuevo (plataforma-saas, la caja nueva) que **ya trae punto de venta para cobrar ahí mismo**. Esta ficha queda como registro de cómo anotan hoy las chicas en papel (para cuando se cargue el POS nuevo: un pago puede cubrir varios perfumes, la seña es un renglón aparte, los decants van como «N decants», el precio casi no se anota).

**En palabras de Alejo:** «El punto de venta, pero más resumido: los chicos usan un papel donde anotan fecha, detalle del producto, precio, efectivo, MP y Posnet (el precio no lo suelen anotar). Es un resumen diario, paso a paso, para tenerlo en el momento. Si lo ves piola, lo codificamos después de lo de arriba. Que sea ágil para ellos: no sé si se puede un apartado, incluso sin necesidad de que estén con la pantalla del admin empleado ahí abierta todo el tiempo.» (foto de la hoja: `1d1cd7eb-77af-4d49-91a7-ec98d68f9af3.jpg`, en la raíz del repo, sin commitear).
**Qué es:** un cuaderno de caja digital que copia la hoja: **un renglón por movimiento de plata** (fecha y hora de Argentina automáticas, detalle en texto libre, monto y medio de pago: Efectivo / MP (transferencia) / Posnet). El total del día por medio sale solo. **No toca el stock** en la primera versión.
**Lo que se ve en la hoja (12-oct):** (1) la fecha se escribe sólo en el primer renglón del día; (2) a veces **un pago cubre varios perfumes** (una llave que junta «Eclaire» y «Azzaro» en un solo monto de 291.150): el renglón es del pago, el detalle puede llevar varios productos; (3) los decants van como «2 decants», sin decir cuáles; (4) la **seña** es un renglón más («9 PM (20k seña)» y después otro con el resto); (5) hay renglones que no son una venta («EDU your touch APAGAR», tachado); (6) un número va en una sola de las tres columnas; en la hoja no hay pago mezclado, pero puede haberlo; (7) la columna Precio casi no se usa.
**Cómo lo haría:** (a) una tabla nueva `caja_movimientos` (id, creado_en, detalle, monto, medio, nota, creado_por; sin tocar `ventas`, cuya pestaña se eliminó a propósito); RLS: leen e insertan las dos cuentas del panel, borra sólo `is_jefe()` (o las dos, con renglón en el Log: a decidir); entra en las dos listas de backups (NO ROMPER #23); cada alta o baja deja renglón en el Log. (b) **Un apartado propio, liviano, que no es el panel**: una página aparte (`caja.html`, mismo login de las cuentas del panel) que se instala como su propio ícono en la tablet o el celu y abre directo en «+ Venta»: detalle, monto, tres botones grandes de medio y «Guardar» (2 o 3 toques), y abajo los renglones de hoy con el total por medio. La alternativa es una pestaña más dentro de `admin.html`, que obliga a abrir y cargar todo el panel. Hecho como página aparte no pesa en el panel que hoy anda rapidísimo.
**Hechos del repo:** el panel recorta con `overflow-x: clip` (NO ROMPER #19); lo interno no se sirve por `.vercelignore` (#10): una página nueva pública tiene que salir de ahí a propósito; el SW cachea sólo lo que se le dice. La tabla vieja `ventas` está documentada como «NO escribir desde el front por ahora» (`CLAUDE.md` § Base de datos).
**Tamaño:** M-L — tabla con RLS, una pantalla chica, backups y Log. Va **primero diseño** (con 2 o 3 días de hojas reales para ver los casos raros) y recién después código.
**Le toca primero a:** 🧑 Alejo (traer más hojas y decidir quién puede borrar un renglón) y después 🤖 Claude Code (el diseño, quizás con un modelo más fuerte; la ejecución, con Sonnet).

> **🧑 Para Alejo (decidís vos), cuando la charlemos:** (1) ¿página aparte instalable (mi recomendación) o pestaña del panel?; (2) ¿una chica puede corregir o borrar un renglón (queda en el Log) o sólo el jefe?; (3) ¿el pago mezclado (parte efectivo, parte MP) se anota en dos renglones como la seña, o querés un renglón con las tres columnas?; (4) ¿el total del día lo ven las dos cuentas o sólo el jefe?; (5) ¿el «Vendí» del escáner podría ofrecer anotar el renglón de caja más adelante?

## [STOCK-CUADRICULA] · 💡 idea · 12-oct-2026

> **Estado 12-oct (noche):** la mitad de esta idea se hizo como `[STOCK-FOTO]` (rama `foto-en-listas`, commit `cd1c7d1`, SW v1.1.209; sin pushear): un interruptor «📷 Con foto» en Precios & Stock y Depósito que pone la **miniatura al lado del nombre en la fila**, prendido por defecto (Alejo: «más canchero»). Lo que queda de esta ficha es la **cuadrícula** (cuadraditos de 2 o 3 por fila) y la foto grande al tocar: sólo si la fila con foto no alcanza.

**En palabras de Alejo:** «Que en Precios & Stock y en Depósito, además de la lista, esté la opción de verlo en cuadrículas: cuadraditos de perfumes, tres así o dos en la tablet (capaz más largo el scroll). Para atender a un cliente: "ese justo no lo tenemos, pero te muestro el frasco"; toco o mantengo apretado y aparece la foto. Hay matices, como que no suba la foto o lo que sea. Idea de un amigo; después de lo ya planificado, la charlamos.»
**Qué es:** un interruptor ▦ / ☰ en esas dos pestañas, como el del catálogo (`[VISTA-LISTA]`). En cuadrícula, cada perfume es un cuadradito con su foto y su stock/depósito; al tocar o mantener apretado se ve la foto grande, sin salir de la pestaña.
**Hechos del repo:** las dos pantallas se pintan en `renderPrecios` (`admin.html:5784`) y `renderDeposito` (`admin.html:5399`); la foto ya viene en `p.foto` (`admin.html:5228`) y el Doctor y Editar ya la muestran (`admin.html:8407`, `11495`). El interruptor del catálogo (`data-vista` + `localStorage`) es un patrón que se puede copiar. Las tarjetas que filtran (`[STAT-FILTRO]`, NO ROMPER #29) y el escáner (`ESCANEO_SLUG`) tienen que seguir andando en las dos vistas. Las fotos del panel no se medían: no revisé cuánto pesan.
**Tamaño:** M — dos pantallas, mucho CSS.
**Le toca primero a:** 🧑 Alejo (charlar los matices) y después 🤖 Claude Code (cuando se cierre lo planificado).

> **🧑 Para Alejo (decidís vos), cuando la charlemos:** (1) ¿tocar abre la foto grande o mantener apretado la muestra mientras la tenés?; (2) ¿la foto carga sólo al tocar (liviano, sin gastar datos en la tablet) o se ven todas las miniaturas en la cuadrícula?; (3) ¿qué número va en cada cuadradito: sólo el stock, o local + depósito?; (4) ¿las dos pestañas o primero una?

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
