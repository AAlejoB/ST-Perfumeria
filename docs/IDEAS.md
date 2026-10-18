# 💡 Ideas — ST Perfumería

> Fichas capturadas con `/idea`. Una idea acá **no es un pendiente**: pasa a `CLAUDE.md` § Pendientes cuando Alejo la aprueba.
> Estados: 💡 idea · 📐 en diseño · 🧾 en prompt · 🔨 en curso · ✅ hecha (→ HISTORIA.md) · ❌ descartada (con el porqué, una línea).

## [PANEL-ARRIBA-LIVIANO] · ✅ hecha (18-oct, `6ead159` y `b1d60c5`, SW v1.1.291 y v1.1.292 → HISTORIA.md, NO ROMPER #62) · 18-oct-2026

**En palabras de Alejo:** «no ves el panel admin con mucho espacio arriba (pensando en dimensiones tablet y mobile)… como que a lo mejor eso hace como que esté "tosca" o incómodo de usar/ver; incluso el "scroll largo" también».
**Medido (18-oct, copia del QA, cuenta empleada):**

| | Tablet parada (600 × 900) | Celu (390 × 844) |
|---|---|---|
| Encabezado (☰, Inicio, estado, 🌙, Salir, atajos) | 181 px (3 renglones) | 181 px |
| Dónde arranca la lista en Precios & Stock | 728 de 900 | 844 de 844 (ninguna fila a la vista) |
| En Depósito | 869 | 958 |
| Largo de la lista | 152 filas × 63 px = ~9.600 px (~11 pantallas) | igual |

Entre el encabezado y la lista hay 7 bloques: las 3 tarjetas, el buscador, el orden (6 botones, 2 renglones), la vista, «Mostrar ocultos», el tip (`#tipPrecios` / `#tipDeposito`), el aviso de decants, la tira Todos / Árabes / Diseñador / Sets y Lista / Compacta. Cada uno se sumó en una tanda distinta.
**Qué se hace (opción 1, la completa, decidió Alejo):** (A) encabezado de un renglón: ☰ · Inicio · los 4 atajos · un punto de estado; 🌙 y Salir pasan al menú (181 → ~56 px). (B) orden, vista y ocultos van a un botón «Ajustes» con una hoja de abajo (como «Filtros» del catálogo); el tip deja de estar siempre y pasa a un globito de `[PISTAS]` que sale una vez por tablet; el aviso de decants, en una línea. (C) el buscador queda pegado arriba al bajar, y aparece un «↑ arriba». (D) en el celu, «Compacta» de entrada (o «Ver 30 más», como el Doctor). **Meta:** la lista arranca a ~250 px en los dos tamaños (~9 filas en la tablet, ~12 compactas en el celu).
**Descartada por Alejo:** la opción 3 («algo chico»: sólo A + C). Medida en la maqueta, la lista arrancaba a ~720 en el celu: ganaba poco arriba y lo bueno era sólo al bajar.
**Ojo:** choca con `[BUSCAR-ARRIBA]` (NO ROMPER #58: al tacto, buscar ya esconde orden, vista, ocultos, tip y la tira), las tarjetas que filtran (#29) y `[SELECTS-A-CUADRADOS]`. Cambia dónde están botones que las chicas usan de memoria: se sube después de las 21 y con su línea en «Lo nuevo del panel» (#53). El panel tiene fecha de mudanza (~26-oct): además se le deja la nota con estas medidas a CCodeProyectoSaas, para que el panel nuevo nazca así. Se cruza con `[PANEL-CELU-TOSCO]` (abajo).
**Tamaño:** M.
**Le toca primero a:** 🤖 Claude Code (las decisiones ya están).

## [NUBES-CATALOGO] · 📐 aprobada → Pendientes (6 tandas de 5) · 18-oct-2026

**En palabras de Alejo:** «falta muchísimo de esas de los nubes-mensajes que se esfuman y eso en el catálogo. Es como que nunca me puse a pensar que si alguien NO conoce de ningún lado, como que se entera que son perfumes pero falta ese algo…». Después: «quiero hacerlos TODOS… me gustaría hacer de a 5».
**Qué es:** que el catálogo le hable al que llega de cero: quiénes somos, qué es un perfume árabe y un decant, ayudarlo a decidir, mostrar que hay gente del otro lado y vender el regalo en temporada. Hoy le habla bien sólo al que ya sabe qué quiere.

**Las 29, por momento de la visita:**
- **Llegar (el que no conoce):** (1) bienvenida que se esfuma, sólo la primera vez: «Perfumes árabes originales · los probás en el local de Comodoro o te llegan a casa» · (2) «¿Primera vez acá?»: 3 tarjetas que se deslizan (qué es un perfume árabe, qué es un decant, cómo se compra) · (3) saludo según la hora: «Buenas noches · el local abre mañana a las 10, pero tu pedido lo armás ahora» · (4) si llegó por un link (Instagram, un perfume compartido): «Viniste por *Khamrah*. Estos se le parecen →».
- **El que vuelve:** (5) «Hola de nuevo · entraron 4 perfumes nuevos» · (6) «Volvió *Asad*, que tenías en favoritos» · (7) «Tenés 2 perfumes en tu pedido · ¿lo terminamos?».
- **Enseñar sin clase:** (8) glosario al tocar («Oud», «Intenso»…) · (9) «Perfil parecido a *Sauvage*» (cuidar la forma: nunca «réplica») · (10) cuánto dura y cuánto se siente, en dos barritas · (11) el decant explicado la primera vez que aparece · (12) «¿Son originales?» con la respuesta y una foto real.
- **Mientras mira:** (13) abrió 4 fichas sin agregar → «¿No sabés cuál? 4 preguntas» (el test ya existe) · (14) miró 2 parecidos → «¿Los comparás?» · (15) desliza mucho sin tocar → «Probá filtrar por ocasión» · (16) buscó algo que no hay → «Dejanos tu número y lo buscamos» · (17) agregó al pedido → «Sumá el decant de *X* para probarlo» · (18) el ♡ vuela al nav al marcar favorito.
- **Prueba social, sólo con datos reales:** (19) «12 personas miraron este perfume hoy» (las vistas) · (20) «Se vendió hace 2 h en el local» (`ventas`, sin nombres) · (21) cinta «Volvió» (el stock de 0 a algo) · (22) «Quedan 2» (el stock de verdad) · (23) reseñas reales rotando (las opiniones de «Tu sector»).
- **Regalo y temporada:** (24) cuenta regresiva antes del festivo: «Faltan 5 días para el Día del Padre · ideas de regalo» (sale de `FESTIVOS`, NO ROMPER #61) · (25) «¿Es para regalar?»: precio, envoltorio, un mensajito en el pedido · (26) según el mes: «Para el viento de Comodoro: los que más duran».
- **Que se note que hay alguien:** (27) «Hoy te atiende Sofi» en el botón de WhatsApp (la tabla `vendedores` existe; hay que preguntarles a las chicas) · (28) foto o video corto del local · (29) «Respondemos en ~10 min en horario del local».

**Las 6 tandas (orden aceptado por Alejo: «Va ese orden»):**

| Tanda | Tema | Ideas | Qué necesita de Alejo |
|---|---|---|---|
| 1 | El director + llegar | 1 · 3 · 5 · 6 · 7 | OK a los textos |
| 2 | Enseñar | 2 · 8 · 11 · 12 · 29 | Revisar los textos; una foto del local o de las cajas |
| 3 | Mientras mira | 13 · 14 · 15 · 16 · 18 | Nada |
| 4 | Prueba social real | 19 · 20 · 21 · 22 · 23 | OK al SQL (una función por dato, sin abrir `ventas` al público) |
| 5 | Regalo y venta | 4 · 17 · 24 · 25 · 26 | Qué ofrece ST para regalo (¿envoltorio? ¿tarjetita?) |
| 6 | Datos y personas | 9 · 10 · 27 · 28 | Los «parecido a» (le armo la lista para corregir), preguntar a las chicas por la 27, el video |

Si una tanda se demora, la 5 sube al 3.er lugar: la temporada fuerte es noviembre y diciembre.
**Reglas (propuse yo, valen para las 6):** (a) **una nube por visita**, con un «director» que decide cuál toca y con prioridad; se amplía lo de `[PISTAS-CATALOGO]` (NO ROMPER #55: sin `MutationObserver`, sin mover el layout); (b) **nunca un número inventado**; (c) nunca tapa lo que el cliente toca, se va sola, respeta el «menos movimiento» del teléfono y no lleva emojis (sólo los glifos ♡ ⚖); (d) cada nube se mide con Holmes: si no sube los WhatsApp, se saca.
**Pendiente de Alejo:** pasar los links y las fotos de Telegram con referencias (dijo que las tiene); si son muchas, se abre una sesión aparte con el agente que busca referencias.
**Tamaño:** L en total (6 × M).
**Le toca primero a:** 🤖 Claude Code (tanda 1, después de `[PANEL-ARRIBA-LIVIANO]`).
**Tanda 1 ✅ en producción (18-oct, v1.1.293, `05dfccd`, NO ROMPER #63):** el director y las nubes 1, 3, 5, 6 y 7. Cambió la (1), por decisión de Alejo: «Los probás en El Coliseo, en Comodoro · local 8» (sin «te llegan a casa»). Letra recta y en negrita, sin la Playfair («se nota que es IA»). La (7) guarda el pedido 7 días en el aparato. Se miden desde v1.1.294 (`[NUBES-HOLMES]`, con 1 de cada 5 sin nube); falta verlas en un celu (`[HUMO-NUBES-1]`).

**Tanda 2 (enseñar) hecha en la rama `nubes-2` (18-oct, SW v1.1.295, NO ROMPER #63 j), textos revisados por Alejo:** (2) el botón «Contame» de la bienvenida abre «¿Primera vez acá?» con 3 tarjetas (perfume árabe, decant, cómo se compra; la 3.ª menciona los envíos y «avisanos cuándo venís al local», pedido de Alejo); (8) «A qué huele» en la ficha, con el perfil y los acordes que se tocan; (11) el decant explicado arriba del armador, la primera vez; (12) «¿Son originales?» en «Cómo comprar» y plegado en la ficha, **sin foto** (Alejo no tenía una pensada: queda el lugar); (29) «Te responde una persona del local, en el horario del local.» debajo del botón del pedido, **sin número de minutos** (decisión de Alejo). **Tanda 3 (mientras mira) hecha en la rama `nubes-3` (18-oct, SW v1.1.296, NO ROMPER #63 k), decisiones de Alejo: «una al llegar + una mirando» y la (16) por WhatsApp:** (13) «¿No sabés cuál?» con el test después de 4 fichas sin agregar; (14) «¿Los comparás?» con dos parecidos; (15) «¿Para el día o para la noche?» al deslizar mucho sin tocar; (16) «¿Lo buscamos por vos?» adentro del aviso «No encontramos…», con WhatsApp y el mensaje escrito (no anota en la lista de espera: el teléfono no está verificado y es NO ROMPER #25); (18) el ♥ vuela al ♡ del nav. **Sigue la tanda 4** (prueba social real: 19 a 23, con SQL).

## [PANEL-CELU-TOSCO] · 💡 idea · 14-oct-2026

**En palabras de Alejo:** "lo uso en el celu y siento que está medio tosca, toco algo y como que se me hace… cuando seleccionás el numerito, los botones, son medio raros. Capaz no hay tanta interacción con la interfaz del teléfono en sí, no puedo arrastrar archivos y eso." Para después: está con otras cosas.
**Qué es:** que el panel se sienta de celular al tocarlo: botones que respondan al toque, números que se eligen sin pelear con el teclado, y gestos del teléfono (arrastrar, deslizar) donde sirvan.
**Hechos del repo:** (1) `admin.html` tiene 36 campos `type="number"` y sólo 10 `inputmode=`: en el celu casi todos los números se escriben con el teclado del sistema, sin los botones grandes de la hoja de caja. (2) Sólo 9 reglas de toque (`touch-action`, `user-select: none`, `-webkit-tap-highlight-color`). (3) Se cruza con `[CUADRADOS-EDITAR]` (llevar los cuadrados de la hoja a Editar) y `[TAP-44]` tanda 2 (37 controles < 44 px, congelado): puede ser la misma tanda.
**Tamaño:** M: muchas pantallas, sólo CSS/JS.
**Le toca primero a:** 🧑 Alejo: decir qué pantallas se sienten peor (o grabar 30 s del celu usándolo) y si vale la pena antes de la mudanza (~26-oct, `[MUDANZA-REVISAR-PENDIENTES]`).

## [PANEL-SIN-CONEXION] · ✅ hecha (pasos 1 a 3 en producción desde el 14-oct ~05:10, `16dc52d`, SW v1.1.224; humo real de Alejo OK; ver NO ROMPER #34 y `docs/HISTORIA.md` § «Sesión 13/14-oct-2026») · 13-oct-2026

**En palabras de Alejo:** «que los chicos dentro del panel, una vez que no tengan internet, una vez que se corte la luz, que se les guarde y después se le sobreescriba con el que ya tienen cuando vuelva la luz […] que dure lo que tenga que durar […] y que solamente se active cuando tarda sin internet durante no sé, 20 minutos». Cuando vuelve la conexión **gana lo que anotaron las chicas**, y es **para este sistema** (el panel de acá, no el nuevo).
**Qué es:** lo que no se puede guardar por falta de red queda en la tablet (cola) y se sube solo al volver, aunque el corte dure horas. **Lo que agrego yo:** que la cola se use siempre que un guardado falle, y que los ~20 min (regulables) sean sólo para el cartel grande «Modo sin conexión». «Gana lo de las chicas» = se SUMA a lo que hay en la base, no lo pisa.
**Hechos del repo:** (1) hoy no existe: sin red el panel avisa «Sin conexión…» y no guarda; `onOffline`/`onOnline` (`admin.html` ~L11821) sólo apagan y prenden el tiempo real. (2) La hoja de caja inserta renglones (`caja_movimientos.insert`, `admin.html` ~L14295): fácil de encolar. (3) El stock se guarda como número final (`stockMover` ~L7817, SINCRO con `saveStock`/`saveDeposito`, NO ROMPER #30 j-k): sin conexión hay que mandarlo como movimiento (−1 / +N, una función de la base que reste o sume), si no dos tablets se pisan. Datos de Supabase siempre por red (`sw.js`): para abrir el panel sin red, `admin.html` tiene que estar en caché (hoy sólo si ya se abrió).
**Tamaño:** L — cola + SQL nuevo + varias pantallas.
**Le toca primero a:** 🤖 Claude Code (las decisiones ya están; falta el diseño técnico y el SQL).

**Decidió Alejo (13-oct):** (1) **entra:** la hoja de caja, la lista de espera y **todos** los movimientos de stock (escáner, «Llegaron / Vendí», «Llegó mercadería», los modales de stock y depósito: «todo todo»); Editar y precios, no. (2) **El «Cierre del día» sin conexión se deja para cuando vuelva**, como excepción, **y deja escribir por qué** (texto libre): puede no haber sido un corte de luz sino una caída de algún servicio (Supabase, internet), «como para no inventar causas». (3) Es para el panel de acá aunque viva ~2 semanas (mudanza ~26-oct).

## [LEGAL-ANTES-DE-SIPAGO] · 💡 idea · 12-oct-2026

> **Prioridad baja (Alejo, 12-oct):** no darle mucha importancia por ahora. Puede que ni haga falta hacerlo en este repo: el proyecto nuevo armado de cero por Lautaro (plataforma-saas) ya resolvió SiPago y quizá también esto. Antes de arrancar, mirar qué trae ese proyecto. Las páginas legales del sitio de hoy se necesitan igual mientras siga en producción.

**En palabras de Alejo:** pegó el prompt de un video («quiero que me demanden por esta web hecha con IA…»: política de privacidad, términos y cookies, consentimiento en los formularios, política de devoluciones, datos del negocio, alt de las imágenes, contraste, reseñas falsas, copyright de las fotos, leyes locales) y preguntó si conviene mirar eso en una tanda. Dijo que sí a anotarla.
**Qué es:** una tanda para dejar el sitio público en regla **antes de prender SiPago** (noviembre/diciembre): páginas de privacidad, términos y cookies; política de cambios y devoluciones con el botón de arrepentimiento; datos del negocio visibles (razón social, CUIT, domicilio, Defensa del Consumidor); aviso de consentimiento en «Unite a ST», la lista de espera y el registro; revisar «100% Originales» y las opiniones; copyright de las 346 fotos. Los puntos legales de Argentina (Ley 24.240, Ley 25.326, lo que pida SiPago) se **confirman con fuentes, no de memoria**, y no es asesoramiento legal.
**Hechos del repo (12-oct):** (1) el sitio público no tiene ninguna página ni link legal (`index.html` y `js/app.js` no mencionan privacidad, términos, cookies, arrepentimiento ni CUIT; lo único que aparece es el comentario de `js/app.js:319`); (2) no hay trackers de terceros: los scripts son `supabase-js` (jsdelivr), `js/app.js`, `js/dvd-bouncer.js` y `perfumes.js`, las fuentes son propias y el analytics es propio (`analytics_events`); (3) el HTML fijo de `index.html` no tiene `<img>` sin `alt` (las que arma el JS no se revisaron); «100% Originales / Garantía de autenticidad» está en `index.html:759`. NO ROMPER #10: una página pública nueva no puede caer en `.vercelignore` (que excluye todo `*.md`).
**Tamaño:** M — varias pantallas y textos, sin SQL; con acuerdo con terceros (SiPago, quizá un abogado o contador).
**Le toca primero a:** 🧑 Alejo (datos del negocio y reglas de cambio y devolución) y después 🤖 Claude Code (relevamiento con fuentes y páginas; Claude in Chrome para mirar el sitio real).

> **🧑 Para Alejo (decidís vos):** (1) ¿cuáles son los datos del negocio que se muestran (razón social, CUIT, domicilio)?; (2) ¿qué política de cambios y devoluciones querés dar (plazos, perfume abierto o cerrado, decants)?; (3) ¿de dónde salieron las fotos de los frascos?; (4) ¿lo revisa un abogado o contador antes de publicar? Se cruza con `[SIPAGO-VALIDA-STOCK]` y `[STRIX-ANTES-DE-SIPAGO]`: las tres van antes de prender SiPago.

## [REEMPLAZO-DE-HOJA] · 📐 aprobada → Pendientes · 12-oct-2026 (noche)

> **13-oct (Alejo): una «seña» NO es un frasco que no se llevó: se lo llevó y pagó una parte; el resto queda debiendo.** Lo de abajo que dice «la seña va sin frasco» quedó superado: ahora hay «Pendientes de cobro» (`sql/caja_deudas.sql`) y el frasco baja siempre; «apartado» (no se llevó) es otro caso. Ver NO ROMPER #31 (j).

**Reabre `[CAJA-CUADERNO]`** (la de abajo). Alejo, 12-oct noche: «hagámosla bien completa; que se quede 10, 15 o 20 días, ya fue». Eligió la opción C y el nombre «REEMPLAZO DE HOJA». El stock de la tablet coincide con el estante (dicho por él).
**Qué es:** una pestaña que reemplaza la hoja de papel. Un renglón por pago: fecha/hora de Argentina, detalle, **tres montos (Efec. / MP / Posnet)**, perfumes en frasco (elegidos de la lista o por escáner; sets, decants y lo que no tenga slug van como texto), tilde «se lleva el frasco ahora» por perfume (la seña va sin frasco y el resto con frasco, sin vínculo entre ambos), nota. **ANOTAR** = el mismo renglón sin perfumes (texto libre, sin stock, monto en cualquier columna o ninguno). Lista de hoy con totales por medio. **Tachar** (las dos cuentas) y **borrar** (sólo `is_jefe()`).
**Cierre del día (opción C):** al final del día se suma lo que salió y el stock del LOCAL baja una sola vez. Antes se ve la lista («Eclaire 4 → 3…»); baja sólo lo que alcanza; lo que no alcanza o no tiene dato se salta y queda marcado en el reporte; lo tachado no baja; nunca negativo; un perfume pausado baja y sigue pausado; los decants no bajan. Lo hace UNA función `security definer` en la base (`caja_cerrar_dia`) en una transacción, con stock relativo (`stock_qty - n where stock_qty >= n`) y marca idempotente por renglón (no se descuenta dos veces); el estado se deriva como `deriveStockInfo` (SINCRO). Tachar un renglón ya cerrado devuelve el stock en forma relativa (+n) con lo guardado en el renglón (`admin_actions` retiene 60 días: no sirve de fuente). Aviso en Inicio si queda un día sin cerrar.
**Hechos del repo (agente de sólo lectura, 12-oct, `admin.html` del worktree):** `stockMover` `:7604` (núcleo de escritura, valor absoluto desde la memoria de la tablet: ahí está el riesgo de dos tablets; no se toca), `saveStock` `:7114`, `saveDeposito` `:5587`, `accMover` `:7576` («Vendí», con candado `ACC_OCUPADO`), `mercAgregar` `:7807` (patrón de escáner o nombre), `codPintarLista` `:7989` y `mercBuscarInput` `:7743` (selectores sin sets que no excluyen pausados; `esperaBuscar` `:12223` los excluye: no sirve), `normalizarCodigo` `:7236`, `logAdminAction` `:4521` (nunca falla), `logFamilias` `:13456` (una acción `caja_*` caería en «Catálogo» y la empleada sólo ve `stock_update` / `deposito_update`: la hoja del cierre tiene que dejar su propio renglón), `BACKUP_TABLES` `admin.html:~14008` y `api/cron/backup.js:~57` (regla #23: la tabla entra en las dos). Molde de RLS: `sql/perfume_codigos.sql`. **No reutilizar `ventas`.** Pestaña con permisos: NO ROMPER #8 y #21; va un botón más en `#tab-inicio`. Va **dentro de `admin.html`** (no `caja.html`: `stockMover` no se puede reutilizar desde otra página sin un refactor grande).
**Tabla `caja_movimientos`:** `id` generado en la tablet (reintento idempotente), `creado_en`, `dia` en hora de Argentina (NO ROMPER #6), `detalle`, `efectivo` / `mp` / `posnet` (numeric, default 0), `nota`, `items jsonb` (slug, nombre, qty, `descontado`, prev y new), `anulado_*`, `creado_por`. RLS al estilo `perfume_codigos`.
**Afuera (a propósito):** editar renglones, arqueo, reportes, exportar, puntos de clientes, sets, depósito, stock reservado por seña, `caja.html`.
**Riesgos que dijo el agente:** (1) cualquier escritura de stock es absoluta desde la memoria de la tablet (la función en la base lo evita); (2) el stock del panel puede estar desfasado (Alejo dice que hoy coincide); (3) doble descuento con «Vendí»; (4) borrar o tachar un renglón y devolver el stock a un perfume equivocado; (5) sesión vencida a mitad de la carga: el formulario conserva lo escrito.
**Tamaño:** M-L, 2 sesiones: (1) tabla, pestaña, tachar, ANOTAR y totales; (2) cierre del día con su función SQL, prueba en la tablet real, NO ROMPER nuevo en `CLAUDE.md`. Vida útil ~2 semanas.
**Le toca primero a:** 🤖 Claude Code, con SQL que aplica 🧑 Alejo. **Pregunta abierta:** el doble descuento con «Vendí» (tilde por perfume, o una regla).

## [CAJA-CUADERNO] · ❌ descartada (reabierta como [REEMPLAZO-DE-HOJA]) · 12-oct-2026

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

## [WA-EMOJIS-ROTOS] · ✅ hecha (14-oct-2026: `7e7b003` + `dd305e9`, SW v1.1.229 y v1.1.230, en producción; los links con texto van por `api.whatsapp.com/send`, NO ROMPER #35) · 7-oct-2026

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
