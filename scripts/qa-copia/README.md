# QA sobre una COPIA del panel (sin tocar la tienda real)

Sirve para recorrer el panel de admin entero con datos de mentira. **La página nunca habla con Supabase**: `qa-server.js`
cambia, al servir `admin.html`, el `<script>` de la librería de Supabase por `fake-supabase.js` (una base en memoria que
se reinicia al recargar). No va a producción: `scripts/` está en `.vercelignore`.

## Cómo se usa

```bash
node scripts/qa-copia/qa-server.js . 8777
```

Abrí `http://localhost:8777/admin.html`. Desde el 16-oct también el catálogo (`http://localhost:8777/`) usa la base de mentira y no manda analíticas a la tienda real. Contraseñas de la copia (sólo existen acá): jefe `qa-jefe`, empleada `qa-empleada`,
laboratorio `qa-lab`. Los clientes y teléfonos son inventados.

Desde la consola del navegador existe `window.__QA`:

| | |
|---|---|
| `__QA.db` | las tablas en memoria (se pueden mirar y cambiar) |
| `__QA.latency = 400` | milisegundos de demora por pedido (para medir la espera real) |
| `__QA.offline = true` | todo falla como sin internet (para probar la cola de la tablet) |
| `__QA.calls` | cada pedido que hizo el panel |
| `__QA.reset()` | vuelve a sembrar los datos |

## Qué copia de la base real (a mano, el 16-oct-2026)

Columnas y tipos, límites (`pg_constraint`), índices únicos, permisos por cuenta de las tablas principales y las funciones
`stock_mover`, `caja_cerrar_dia`, `caja_tachar`, `caja_destachar`, `caja_cobrar`, `ajustar_puntos`, `resumen_dia`,
`wa_consultas_hoy`, `lab_metricas` (esta última, un molde). **Si cambia una de esas reglas en la base, hay que cambiarla acá**: es
una copia, no la base. Sirve para encontrar problemas de PANTALLA; lo que parezca de la base se confirma aparte (con
transacciones que se deshacen).

## Una pasada completa

El informe del 16-oct está en `docs/QA-ADMIN-2026-10-16.md`. Para repetirlo: entrar como jefe y como empleada, recorrer las
24 pestañas, probar cada campo con vacío / 0 / negativo / decimal / enorme / texto raro, tocar dos veces los botones que
escriben, cortar la conexión (`__QA.offline`), medir con `__QA.latency`, mirar en 375 y 768 px, y **comparar antes y después una huella
de la base real** (un `md5` de las tablas de stock, precios, clientes, hoja…) para demostrar que nada real se tocó.
