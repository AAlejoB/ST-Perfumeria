# PLAN · `[AVISOS-PRIORIDAD]` — ventana de privilegio para clientes marcados

> **Estado:** 📋 diseñado, NO implementado. Acordado con Alejo el 12-ago-2026.
> **Próxima sesión:** ejecutar Etapa 1.
> **Origen:** al arreglar `[WAITLIST-AVISO-REAL]` surgió la idea de darle un beneficio real a quien se anota en "Avisame cuando vuelva".

---

## 1. Por qué

Hoy, cuando vuelve un producto, aparece disponible para todos al mismo tiempo. **Anotarse en la lista de espera no da ningún beneficio concreto** — el que dejó su número compite contra cualquiera que entró de casualidad.

**Dato clave que aportó Alejo:** en el local **ya hacen esto informalmente**. Cuando un cliente es fiel o comprador habitual, le guardan el producto y no lo venden al público hasta que lo pase a buscar. O sea que no estamos inventando una práctica nueva: **estamos sistematizando una que ya existe y que hoy depende del criterio de quién esté atendiendo.**

**Objetivo explícito de Alejo:** *"desligando al empleado y a mí de todo esto"* — que la decisión no se tome en el momento de la venta, y que el jefe no tenga que participar de cada reposición.

**Segundo objetivo:** *"pensemos algo general para usarlo hoy y mañana que le vendamos a otros lugares"* → el módulo se diseña **genérico y configurable**, no atado a perfumes ni a ST Perfumería.

---

## 2. El modelo · dos olas

| Momento | Quién se entera | Estado del producto en la web |
|---|---|---|
| **Hora 0** | **Ola 1** · clientes marcados como prioritarios que estén en la lista de espera de ese producto | Oculto (`stock_status = 'pausado'`) |
| **Hora N** (config, default 24) | **Ola 2** · el resto de la lista de espera | Se libera automáticamente |
| **Hora N+** | Público general | Visible normal |

### Decisión tomada: la prioridad es 100% MANUAL

Alejo eligió explícitamente **"sólo los que vos marques"**: nadie entra automáticamente por tener compras o puntos. El jefe pone la estrella a mano en la ficha del cliente.

**Por qué es una buena decisión:** el criterio real de "cliente fiel" que usan en el local es humano y contextual (conocen a la persona), no se deduce bien de `compro` o `puntos`. Un automatismo mal calibrado daría privilegio a gente que compró una vez hace un año, y se lo negaría a un habitual que paga en efectivo sin sumar puntos.

**Costo:** hay que hacer el trabajo inicial de marcar a los clientes. Con 82 fichas es una tarde.

> 💡 Idea para más adelante (NO ahora): un botón "sugerencias" que liste candidatos según compras/puntos **para que el jefe confirme uno por uno**. Nunca automático.

---

## 3. Cómo se desliga del empleado y del jefe

Esta es la parte central del pedido:

1. **La prioridad es un atributo del cliente, no una decisión de la venta.** Ya está resuelta antes de que llegue la mercadería.
2. **La empleada carga el stock como siempre.** No decide, no evalúa, no puede equivocarse. Sólo tilda "sólo para la lista" si corresponde.
3. **La liberación a las N horas la hace el servidor** (`pg_cron`, el mismo que ya manda el resumen diario a las 23:00 ART). Nadie tiene que acordarse de despausar nada.
4. **El jefe configura una vez** (ventana, textos, quiénes son prioritarios) y no participa de cada reposición.

---

## 4. Diseño genérico (para poder revenderlo)

| Decisión | Motivo |
|---|---|
| La ventana en horas va en **tabla de config**, no en el código | Otro local pone 48h o 6h sin tocar una línea |
| Los **textos de los mensajes** van en config | Cada negocio escribe con su tono |
| Nombres neutros: `producto`, no `perfume` | Una tienda de ropa lo usa igual |
| El criterio de prioridad es **un flag**, no una fórmula hardcodeada | Mañana se puede sumar "por antigüedad" o "por monto" sin romper lo existente |
| La ventana se apoya en el estado `pausado` **que ya existe** | Cero cambios en el catálogo público en la Etapa 1 |

> ⚠️ **Corrección importante (mismo día, después de escribir este plan):** cuando redacté esto asumí que `pausado` ya ocultaba del catálogo público. **Era falso** — los pausados se mostraban con badge "Próximamente" y botón "Reservar por WhatsApp". Se arregló en `[PAUSADO-OCULTO]`: ahora un perfume pausado **no aparece en ningún lado público** (catálogo, buscador, Selección ST, relacionados, armador de decants, contadores de categorías). **Recién ahora la premisa de este plan es cierta.** Semántica acordada con Alejo: *pausado = archivado* (no se trae hasta nuevo aviso), no "próximamente".

---

## 5. Esquema de base de datos (PROPUESTO · sin testear)

> ⚠️ **Este SQL está escrito pero NO ejecutado ni verificado** (el MCP de Supabase estaba caído el 12-ago). Revisar y probar en la próxima sesión antes de aplicar en producción. Ejecutar en el proyecto de **São Paulo** (`znmjhproimtprptheumy`).

```sql
-- ── 1) Marca manual de prioridad en el cliente ──────────────────────
alter table public.clientes
  add column if not exists prioritario boolean not null default false;

create index if not exists clientes_prioritario_idx
  on public.clientes (prioritario) where prioritario;

-- ── 2) Configuración del módulo (una sola fila) ─────────────────────
create table if not exists public.avisos_config (
  id                smallint primary key default 1,
  ventana_horas     integer not null default 24,
  mensaje_prioritario text,
  mensaje_general     text,
  activo            boolean not null default true,
  constraint avisos_config_una_fila check (id = 1)
);
insert into public.avisos_config (id) values (1) on conflict (id) do nothing;

alter table public.avisos_config enable row level security;
create policy "avisos_config_select" on public.avisos_config for select using (true);
create policy "avisos_config_write"  on public.avisos_config for all
  to authenticated using (true) with check (true);

-- ── 3) Ventanas de privilegio abiertas ──────────────────────────────
create table if not exists public.ventanas_privilegio (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  abierta_en  timestamptz not null default now(),
  cierra_en   timestamptz not null,
  cerrada_en  timestamptz,
  unidades    integer,
  creada_por  text
);

-- Una sola ventana abierta por producto
create unique index if not exists ventana_abierta_unica
  on public.ventanas_privilegio (slug) where cerrada_en is null;

alter table public.ventanas_privilegio enable row level security;
create policy "ventanas_select" on public.ventanas_privilegio for select using (true);
create policy "ventanas_write"  on public.ventanas_privilegio for all
  to authenticated using (true) with check (true);
```

### Función de cierre automático

```sql
create or replace function public.cerrar_ventanas_privilegio()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0;
begin
  -- Libera el producto al público, derivando el estado desde la cantidad
  update public.perfume_overrides po
     set stock_status = case
                          when coalesce(po.stock_qty, 0) = 0 then 'out'
                          when po.stock_qty = 1              then 'low'
                          else 'ok'
                        end
    from public.ventanas_privilegio v
   where v.slug = po.slug
     and v.cerrada_en is null
     and v.cierra_en <= now();

  update public.ventanas_privilegio
     set cerrada_en = now()
   where cerrada_en is null
     and cierra_en <= now();

  get diagnostics n = row_count;
  return n;
end $$;
```

⚠️ **Verificar antes de aplicar:** que el `case` coincida con lo que hace `deriveStockInfo()` en `admin.html` (hoy: 0 → `out`, 1 → `low`/"Último", >1 → `ok`). Si no coinciden, el producto se libera con un badge equivocado.

### Job de cron

```sql
select cron.schedule(
  'cerrar-ventanas-privilegio',
  '*/15 * * * *',                      -- cada 15 min
  $$select public.cerrar_ventanas_privilegio();$$
);
```

---

## 6. Cambios de interfaz (Etapa 1)

| Dónde | Qué |
|---|---|
| Tab **Clientes** | Botón ⭐ por ficha para marcar/desmarcar prioritario + filtro "ver sólo prioritarios" + contador |
| Modal de **stock** | Casilla "🔒 Sólo para la lista (ventana de privilegio)". Al tildarla: guarda la cantidad pero deja `stock_status = 'pausado'` y abre la ventana |
| Panel **Precios & Stock** | El banner `#waitlistBanner` (ya existe, de `[WAITLIST-AVISO-REAL]`) separa en **Ola 1 (prioritarios)** y **Ola 2 (resto)**, con la 2 deshabilitada hasta que venza |
| Aviso de ventanas activas | Franja arriba: "2 productos en ventana · el más próximo vence en 4 h" con botón "liberar ya" |
| Tab **Config** | Horas de ventana + textos de los dos mensajes |

**El catálogo público NO se toca en la Etapa 1** — se apoya en `pausado`, que ya lo oculta.

---

## 7. Etapas

| Etapa | Alcance | Sirve sola |
|---|---|---|
| **1** | Todo lo de arriba: marca manual, ventana configurable, dos olas, liberación por cron | ✅ Sí — resuelve el caso real de hoy |
| **2** | Reserva nominal ("1 de las 3 es de Juan"), "quedan 2 de 3", cuenta regresiva visible al cliente | ✅ |
| **3** | Parametrización completa para instalar en otro negocio (textos, nombres, criterios) | Para vender |

---

## 8. Riesgos y cosas a decidir

1. **El local físico manda.** Si las chicas venden igual el producto apartado, el privilegio es mentira y el cliente se quema. **Requiere acuerdo explícito con ellas antes de encender esto.** Alejo confirmó que ya lo hacen con clientes fieles, pero informalmente.
2. **Más gente que unidades.** Si hay 3 unidades y 7 esperando, 4 quedan afuera igual. **El mensaje tiene que ser honesto** ("volvieron 3, el primero que llegue"), o la frustración es peor que no avisar.
3. **Vencimiento de los pedidos viejos.** Hay pedidos de mayo todavía pendientes. Conviene que caduquen a los 3-6 meses (el deseo se enfría y avisar tarde queda mal).
4. **Qué pasa si se vende todo en la Ola 1.** Al llegar la hora N, el producto se libera con stock 0 → queda `out`. La función lo contempla, pero hay que verificar que no mande la Ola 2 al pedo. **Decidir:** ¿se avisa igual a la Ola 2 diciendo "se agotó"? Probablemente no.
5. **Doble notificación.** Un cliente prioritario también está en la lista general: hay que asegurar que no reciba los dos mensajes.

---

## 9. Cómo verificar cuando se implemente

- Marcar 2 clientes de prueba como prioritarios, con un producto que ambos esperen.
- Cargar stock con la casilla tildada → confirmar que el producto **NO** aparece en el catálogo público (incógnito).
- Confirmar que el banner separa correctamente Ola 1 y Ola 2.
- Forzar `cierra_en` en el pasado y correr la función a mano → confirmar que el producto se libera con el badge correcto.
- Recién después, dejar que el cron corra solo y verificar a las 24h reales.

---

*Documento creado el 12-ago-2026 · sesión `[WAITLIST-AVISO-REAL]` · decisiones tomadas con Alejo: prioridad manual + ejecución en la próxima sesión.*
