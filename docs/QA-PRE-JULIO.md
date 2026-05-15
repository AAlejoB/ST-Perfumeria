# 🔍 QA Pre-Julio · ST Perfumería

> Checklist exhaustivo para validar TODO el flujo antes de que Alejo se vaya
> a Buenos Aires en julio. Mejor 3hs de QA ahora que un error en venta
> crítica con Alejo lejos y sin poder reaccionar rápido.

## 📋 Cómo usar este doc

### Setup (1 vez · 5 min)

1. Abrir `stperfumeria.com` y `stperfumeria.com/admin.html` en pestañas separadas.
2. Tener este archivo abierto al costado (preferentemente impreso o en otra
   pantalla).
3. F12 (DevTools) → click en el ícono de mobile/tablet arriba a la izquierda
   → Device Toolbar → seleccionar **"Custom"** con dimensiones **800 × 1280**
   (Samsung Galaxy Tab A9 vertical).
4. También probar en **375 × 812** (iPhone X) para mobile real.
5. Marcar cada ítem con ✅ (anda) o ❌ (problema · escribir qué pasó).

### Limitaciones del F12 emulado

- **Touch vs mouse**: el click del mouse es preciso, el dedo de una chica
  con uñas largas no tanto. Algunos botones pueden ser "demasiado chicos"
  en tablet real aunque en F12 no se note.
- **Performance**: la Tab A9 es más lenta que tu PC. Animaciones que en F12
  van fluidas pueden trabarse en tablet real.
- **Service Worker**: el comportamiento al cerrar/abrir tabs difiere.
- **Cuando tengas la tablet real**, repetir SOLO los ítems marcados con 🪨
  (estos son los que cambian entre emulado y real).

---

## A · ADMIN · Login y navegación general

Viewport recomendado: **800×1280 (tablet vertical)**

- [ ] Abrir `/admin.html` · aparece login con campo de contraseña
- [ ] Pass correcta → entra al panel · ve la sidebar lateral con tabs
- [ ] Pass incorrecta 3 veces → muestra lockout (espera unos segundos)
- [ ] Reload página · admin recuerda login (no pide pass de nuevo)
- [ ] Logout · vuelve al login (admin debería tener botón logout en sidebar)
- [ ] Sidebar colapsable funciona: tap "☰" → expande/colapsa
- [ ] 🪨 **Tablet real**: los iconos del sidebar son tappables con dedo
- [ ] Cambiar entre tabs es fluido (sin freeze >1 seg)
- [ ] Tab "📊 Métricas" carga datos
- [ ] Tab "🛒 Ventas" carga (aunque la sección está medio descontinuada)

---

## B · ADMIN · Precios & Stock (tab más usada)

- [ ] Tab "💰 Precios & Stock" → carga lista de ~150 perfumes
- [ ] Búsqueda por nombre funciona · resultados aparecen al instante
- [ ] Editar precio de UN perfume: tap → modal abre → cambiar precio →
      Guardar → mensaje "✓ Guardado" verde
- [ ] Cambiar stock_qty: editable inline, guarda al hacer blur o Enter
- [ ] Cambiar stock_status (sin stock / próximamente / pausado / OK):
      dropdown funciona
- [ ] Si pausás un perfume → ¿se ve "pausado" en la lista?
- [ ] Si lo marcás "sin stock" → ¿aparece el campo de "nota_sin_stock"?
- [ ] **CRITICO**: cargar 2 tabs admin a la vez en distintas PCs (o
      ventanas) · cambiar stock en una → en la otra el dato debería
      actualizarse SOLO (realtime). Si no, ver indicador #syncIndicator.

---

## C · ADMIN · Decants de diseñador (CRÍTICO para julio)

- [ ] Tab "Decants Custom" / "💎 Decants de diseñador" → carga lista
- [ ] **Verificar que se ve el campo PRECIO** (caja amarilla destacada
      con label "💰 PRECIO")
- [ ] Crear un decant de prueba: tap "+ Agregar perfume" → aparece fila
- [ ] **CRITICO**: editar el campo Precio · cargar 29000 (sin comas)
- [ ] Click "💾 Guardar" → mensaje verde "✓ Guardado"
- [ ] Recargar la página → el precio guardado sigue ahí
- [ ] **Borrar el precio** (dejar vacío) y refrescar la web pública
      → en el armador el decant debe verse atenuado con "⏳ Precio
      pendiente" y el "+" deshabilitado
- [ ] Volver a cargar precio en admin · refrescar web → ahora el "+"
      se habilita y el precio se ve correcto
- [ ] **CRITICO**: subir una foto (botón cámara sobre el placeholder
      amarillo) → la foto aparece como preview en la fila
- [ ] Eliminar un decant de prueba: 🗑️ → confirma → desaparece
- [ ] 🪨 **Tablet real**: el dedo gordo puede tappear el botón Guardar
      sin equivocarse con Eliminar

---

## D · ADMIN · Destacados (Selección ST)

- [ ] Tab "⭐ Destacados" → carga
- [ ] **Verificar campo nuevo**: "🏷️ Texto del banner amarillo (badge)"
      con default "TOP VENTAS"
- [ ] Cambiar a "OFERTA 50%" · Guardar → mensaje verde "✅ Badge guardado"
- [ ] Ir a la web pública (sección Selección ST · home) → ver que las
      cards ahora muestran "OFERTA 50%" en lugar de "TOP VENTAS"
- [ ] Volver al admin · cambiar de nuevo a "TOP VENTAS" · Guardar → web
      vuelve a "TOP VENTAS"
- [ ] Buscador de perfumes para agregar a destacados: tipear "ave" →
      sugiere "Aventus" → tap → se agrega a la lista de destacados
      actuales
- [ ] La lista muestra ranking (#1, #2, #3...) con drag/drop o flechas
      para reordenar
- [ ] Eliminar uno (🗑️) → desaparece
- [ ] No permite agregar más de 7

---

## E · ADMIN · Horario · Cierres · Beneficios · Home Banner

- [ ] Tab "📅 Horario" → ver horarios actuales
- [ ] Cambiar hora de apertura · Guardar → cambio se refleja en web pública
- [ ] Tab "🚫 Cierres especiales" → agregar 1 cierre · Guardar → web pública
      muestra el aviso ese día
- [ ] Tab "✨ Beneficios (TrustBadges)" → editar texto de uno de los 4
      cuadros · Guardar → cambio visible en web
- [ ] Tab "🏠 Home" → banner B/N rotativo: agregar 1 mensaje · Guardar
- [ ] Web pública → mensaje aparece en el banner superior B/N

---

## F · ADMIN · Sistema de Puntos

- [ ] Tab "🎯 Puntos" → carga la lista de clientes con sus puntos
- [ ] Buscar cliente por nombre/teléfono · aparece
- [ ] Ajustar puntos (botón +/−) → modal abre con opciones (sumar/restar
      + dropdown motivo + nota)
- [ ] Confirmar ajuste → puntos cambian · entrada en puntos_log
- [ ] Tab "Configuración de puntos" → ver puntos_por_perfume, threshold, etc.
- [ ] Cambiar mensaje promocional · Guardar → web pública muestra nuevo
      mensaje en el banner contextual

---

## G · ADMIN · Notificaciones Push

- [ ] Tab "📲 Push" → carga
- [ ] Suscribir tu propio celular (botón "Activar notificaciones") → permitir
- [ ] Mandar push de prueba con asunto + cuerpo → tu celular recibe la
      notificación dentro de ~5 seg
- [ ] La push también aparece como banner público en el catálogo (tabla
      announcements)
- [ ] Cerrar el banner público → silenciado 24h en localStorage

---

## H · WEB PÚBLICA · Navegación principal

Viewport: probar tanto **375×812 (mobile)** como **800×1280 (tablet)** como
**1280×900 (desktop)**.

- [ ] Cargar `stperfumeria.com` · banner top B/N rotativo carga
- [ ] Nav superior: hamburguesa abre drawer · logo · iconos (login,
      carrito, favoritos)
- [ ] Drawer: cada link te lleva a la sección correcta (Catálogo,
      Categorías, Selección ST, Decants, Juegos ST, Nosotros, Blog,
      Contacto, Dónde encontrarnos)
- [ ] Toggle light/dark mode funciona (sol/luna)
- [ ] **CRITICO mobile**: el wa-float y cart-float (círculos abajo a la
      derecha) no tapan contenido importante
- [ ] Banner amarillo "EXPLORÁ NUESTRO CATÁLOGO" carga · CTA scrollea
      al catálogo

---

## I · WEB PÚBLICA · Catálogo + filtros (CRÍTICO)

- [ ] Carga 162 perfumes (skeleton aparece mientras carga · después grid)
- [ ] Cards muestran: foto, nombre, marca, precio, "3 cuotas $X sin
      interés", efectivo con 10% off
- [ ] Tap en una card → modal/reveal con info completa (notas, similares,
      foto grande, agregar al carrito)
- [ ] **Filter deck mobile** (mazo de chips de categoría): tap abre,
      tap fuera cierra · filter activo siempre visible cuando deck cerrado
- [ ] Filtro **Todos / Unisex / Hombre / Mujer / 🔥 Nuevos / ❤** funcionan
- [ ] **CRÍTICO** Filtro ❤ Favoritos: con 0 favs → mensaje "no tenés
      favoritos aún"
- [ ] **CRÍTICO** Filtro ❤ Favoritos con 1 fav: la card del fav NO se
      estira (no debe haber "cuadrado rojo gigante" como antes)
- [ ] Filtro Nota: dropdown abre · seleccionar "Almizcle" · filtra
- [ ] Aplicar 2+ filtros simultáneos (Favoritos + Almizcle) → muestra
      intersección
- [ ] Chips "CATEGORÍA Favoritos x" "NOTA Almizcle x" aparecen abajo del
      filter-bar · botón "Limpiar todo" funciona
- [ ] **CRITICO** Tap "Ordenar" tras toggle de filtro favoritos → menú
      desplegable NO debe quedar tapado (era el bug [SORTMENU-Z]
      fixeado, pero verificar)
- [ ] Sort: A→Z, Z→A, Precio↑, Precio↓, Más visitados, Menos visitados
      → cada opción reordena las cards correctamente
- [ ] Filtro Precio: deslizador funciona · chip "Precio $X — $Y" aparece
- [ ] Filtro Ocasión Día/Noche → cambia cards visibles

---

## J · WEB PÚBLICA · Card de perfume (modal/reveal)

- [ ] Tap en una card → reveal lateral con info completa
- [ ] Foto carga · si no tiene → placeholder dorado con inicial grande
- [ ] Precio · cuotas · efectivo con 10% off visibles claros
- [ ] Si está sin stock: badge "AGOTADO" · botón "Avisame cuando vuelva"
      funciona (form aparece, envía email/whatsapp)
- [ ] Si está pausado: badge "Pausado" · nota del admin visible
- [ ] Si es nuevo: badge "🆕 NUEVO"
- [ ] Si tiene Hot Sale: badge "🔥 HOT SALE EFECTIVO" + % off
- [ ] Botón ❤ favorito · click → cambia a rojo · re-click → vuelve
      gris (heart pop animation)
- [ ] Botón "⚖ COMPARAR" → suma al compare-bar flotante
- [ ] Botón "AGREGAR" → se agrega al carrito · cart-float badge sube

### J.1 · Modal "Ver similares" (NUEVO premium)

- [ ] Tap "⬥ Ver similares" → modal abre con título "Similares a [X]"
- [ ] Nota del equipo ST (caja amarilla) aparece si el admin la cargó
- [ ] Sección "⭐ Recomendados por ST" muestra los manuales (si hay)
- [ ] Sección "🔬 Similitud por notas" muestra algoritmo por notas
- [ ] **CRITICO** Cada item tiene **ring dorado** con %
- [ ] **CRITICO** Cada item tiene **chips de notas en común** ("Coincidencia:
      vainilla, ámbar, oud")
- [ ] **CRITICO** Cada item tiene **botón "⚖ Comparar"**
- [ ] **CRITICO** Items pueden tener badges: 🏆 Mejor match · 💎 Misma
      casa · 🎯 Mismo perfil · 🔥 El más elegido (max 2 por item)
- [ ] Tap "⚖ Comparar" en un similar → agrega ese + el original al
      compare-bar flotante · cierra modal de similares
- [ ] Si el perfume NO tiene similares cargados ni similitud >45% →
      mensaje "🔮 Este perfume es único"
- [ ] 🪨 **Tablet real**: el ring se ve bien (no pixelado) y el botón
      "⚖ Comparar" es tappable sin equivocarse

---

## K · WEB PÚBLICA · Compare modal

- [ ] Agregar 2-3 perfumes al compare (botón "⚖" en cada card)
- [ ] Tap el botón grande "COMPARAR" en la compare-bar flotante → modal
      abre
- [ ] Cada perfume muestra: foto, nombre, marca, precio, categoría,
      perfil, notas (salida/corazón/base)
- [ ] **CRITICO** Sección "✨ Notas en común" (caja amarilla) lista las
      notas que comparten
- [ ] **CRITICO** Sección "🔥 Diferencias destacadas" (caja rosa) muestra
      por perfume las notas únicas
- [ ] **CRITICO** Botón "💕 Elegir este" pill dorada en cada perfume ·
      tap → agrega al carrito + cierra modal de compare
- [ ] Mobile (375px): cards apiladas vertical · diferencias también
      apiladas · todo legible y no se rompe el layout
- [ ] Cerrar modal (X o tap fondo) → vuelve al catálogo

---

## L · WEB PÚBLICA · Armador de decants

- [ ] Banner Decants (centro de la home) carga: layout violeta-magenta
      con frascos SVG + podiums + flor 🪻
- [ ] Tap CTA "💧 Armá tu pack →" → modal full-screen abre
- [ ] Header: título · subtítulo "Decants de 5ml · Máx 10"
- [ ] **CRITICO** Tabs "Catálogo (151)" / "Mis decants (0)" aparecen ·
      "Mis decants" disabled cuando pack vacío
- [ ] Counter "0/10 decants · $0" arriba
- [ ] Empty hero "¿No sabés por dónde empezar?" con quick-picks (si
      pack está vacío)
- [ ] Search funciona: tipear "yara" → filtra
- [ ] Sección "💎 Decants de diseñador" (custom decants) aparece PRIMERO
      en la lista
- [ ] **CRITICO** Decants de diseñador SIN precio cargado se ven
      atenuados con "⏳ Precio pendiente" + "+" deshabilitado
- [ ] Decants de diseñador CON precio cargado se ven con su precio
      inline ($25.000 c/u) y "+" habilitado
- [ ] Tap "+" en un decant regular → agrega al pack · counter sube ·
      precio total sube (escalera: 1-2 c/u $X, 3-4 c/u $Y, 5+ c/u $Z)
- [ ] **CRITICO** Cuando pack ≥1 decant: aparece pill sticky abajo
      "💡 Combinás bien con: X" con botón "+ Sumar"
- [ ] Tap "+ Sumar" del combo sticky → ese perfume se suma al pack ·
      la sugerencia se recalcula con otro
- [ ] Cambiar a tab "Mis decants" → ve solo los seleccionados
- [ ] Eliminar el último decant del pack → auto-switch a tab Catálogo
      (no queda en "Mis decants vacío")
- [ ] Botón − global junto al total quita el último agregado (LIFO)
- [ ] Botón "Vaciar" → confirma → limpia todo
- [ ] Botón "📲 Consultar por WhatsApp" → abre wa.me con mensaje
      formateado · header dice cantidad correcta · cuerpo lista
      perfumes con cantidades · total correcto

---

## M · WEB PÚBLICA · Carrito

- [ ] Agregar 2-3 perfumes al carrito desde cards del catálogo
- [ ] Cart-float (círculo abajo derecha) muestra badge con count
- [ ] Tap cart-float → panel lateral abre con lista de items
- [ ] Cada item: foto, nombre, marca, precio, botón X para quitar
- [ ] Total · 3 cuotas · efectivo con descuento visibles
- [ ] Textarea "¿Algún comentario?" funciona
- [ ] Botón "📲 Enviar pedido por WhatsApp" abre wa.me con mensaje
      [GATO] formateado (lista numerada + precio + cuotas + efectivo)
- [ ] Botón "❤️ Agregar mis favoritos al pedido" suma los favs al carrito
- [ ] Botón "Vaciar pedido" funciona
- [ ] Cerrar carrito (X o tap fondo) → vuelve al catálogo · badge sigue

---

## N · WEB PÚBLICA · Selección ST (sección destacados)

- [ ] Scrollear a Selección ST (después del banner amarillo "EXPLORÁ")
- [ ] **CRITICO** Las primeras 3 cards tienen badge de podio:
      #1 oro · #2 plata · #3 bronce
- [ ] Cada card tiene el badge configurado en admin (default "TOP VENTAS"
      o lo que hayas guardado)
- [ ] Si un perfume tiene `nota_jefe` cargada en Supabase → aparece quote
      italic debajo del nombre (Cormorant Garamond)
- [ ] Tap en una card → scrolleas a esa card en el catálogo · highlight
      dorado por 3 seg

---

## O · WEB PÚBLICA · Juegos ST (Quiz)

- [ ] Scrollear a sección Juegos ST · debe estar ANTES de Nosotros (no
      escondido al final post-FAQ como antes)
- [ ] Banner CTA "¿No sabés cuál perfume comprar? · 4 preguntas, 3
      recomendaciones, gratis →"
- [ ] Tap CTA o botón "JUGAR" → quiz arranca
- [ ] 4 preguntas: ¿Para quién? · ¿Qué perfil? · ¿Día o noche? · ¿Algo
      más?
- [ ] Al final → muestra 3 perfumes recomendados con scoring
- [ ] Tap en uno → te lleva a la card del catálogo

---

## P · WEB PÚBLICA · Login cliente / Favoritos / Lista de espera

- [ ] Tap icono de login en nav → modal de login (teléfono + pass)
- [ ] Cliente nuevo: tap "Crear cuenta" → form con teléfono + nombre
      → crear · queda logueado
- [ ] Cliente existente: ingreso con tel + pass → entra
- [ ] Favoritos: ya logueado, marcás algunas como ❤ → quedan guardados
      en `favoritos` table (sobreviven al logout/login)
- [ ] Banner contextual de puntos arriba del catálogo (cuando logueado
      y tiene puntos)
- [ ] "Tu sector" tiene 2 cards: Opiniones (textarea) + Votación del mes
- [ ] Logout funciona · favoritos quedan en localStorage para anon

---

## Q · WEB PÚBLICA · Light mode

- [ ] Toggle a light mode (sol)
- [ ] Cards del catálogo legibles · texto carbón sobre crema
- [ ] Trust badges quedan oscuros (decisión del jefe · NO cambiar)
- [ ] Banner "EXPLORÁ NUESTRO CATÁLOGO" queda oscuro (decisión del jefe)
- [ ] Banner contextual "Tenés X puntos" queda oscuro (decisión del jefe)
- [ ] Cards de Categorías quedan oscuras (decisión del jefe)
- [ ] El resto está legible · dorado-marrón en lugar de amarillo brillante
- [ ] Volver a dark mode (luna) · todo vuelve a la normalidad

---

## R · PERFORMANCE

- [ ] **CRITICO** Cargar `stperfumeria.com` por primera vez (DevTools
      Network · Disable cache · throttling "Fast 3G") · medir:
   - First Contentful Paint debe ser < 2s
   - Largest Contentful Paint debe ser < 4s
   - El catálogo aparece visible en < 5s
- [ ] Scrollear por el catálogo · no debe trabarse · 60fps deseable
- [ ] Cambiar de filtro · transición suave (no flash blanco brusco)
- [ ] Abrir modal Compare con 3 cards · animación fluida
- [ ] Abrir armador de decants · grid de 150+ cards · scroll suave

---

## S · PWA

- [ ] DevTools → Application → Manifest · verifica name, short_name,
      icon, theme_color
- [ ] Application → Service Workers · verifica `sw.js` esté "activated
      and running" · versión = `v1.1.37` (o la última deployada)
- [ ] Chrome → más opciones → "Instalar ST Perfumería" → instala como
      PWA · abre desde escritorio sin browser
- [ ] PWA-AUTO-RELOAD: con la PWA abierta, pushear una versión nueva
      desde otro lado (o pedir a Claude) · la PWA debería recargar sola
      en ~5-10 seg sin tocar nada
- [ ] [SW-UPDATE-BANNER] en admin: similar, debe aparecer la pill
      amarilla arriba diciendo "Hay una versión nueva"

---

## T · SEO / Sharing

- [ ] Compartir un perfume por WhatsApp/Telegram desde tu cel · debería
      mostrar la imagen OG correcta · título correcto
- [ ] Abrir Lighthouse en F12 · audit SEO · score debe ser >85
- [ ] Inspeccionar la metadata: `<title>` `<meta description>`
      Open Graph tags

---

## 🔴 Cosas que SÍ son críticas reportar

Si algo de esto falla, **es prioridad de fix antes de julio**:
- Cualquier ítem marcado **CRITICO**
- Cualquier cosa que ROMPA una venta (carrito que pierde items,
  WhatsApp que abre mensaje vacío, precio mal calculado)
- Cualquier cosa visual que sea ILEGIBLE (texto invisible, botón
  cortado, modal trabado)
- Cualquier error de Supabase visible al cliente (no debería ver
  "Error 500", debe haber fallback)

## 🟢 Cosas menores OK aceptables

- Pequeños desalineamientos visuales que no rompen la venta
- Animaciones un poco lentas (la Tab A9 es vieja)
- Detalles cosméticos que pueden iterarse después

---

## 📝 Cómo reportarme los resultados

Cuando termines el QA, pegame en el chat:

```
QA Pre-Julio · resultados:

✅ Lo que anda: A, B, C, D-E1...
❌ Bugs encontrados:
  - C7 (cargar decant diseñador): el botón Guardar quedó tapado por X
  - J.1 (modal similares): el ring no se ve en light mode
  - K3 (compare): el botón Elegir este se ve muy chico en mobile

🪨 Pendiente probar en tablet real:
  - C12 · F1 · I9 · L8 · etc
```

Yo arreglo todo de una pasada y volvemos a iterar.

---

**Fecha de creación**: 15-may-2026 (sesión maratónica)
**Versión SW al crear**: v1.1.37
**Recomendado correr antes de**: julio 2026 (viaje Alejo a BA)
