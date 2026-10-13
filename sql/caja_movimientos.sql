-- ============================================================================
-- [REEMPLAZO-DE-HOJA] sesión 1 · la hoja de caja digital  ·  12-oct-2026
-- ============================================================================
-- Qué hace: crea la tabla `caja_movimientos` (un renglón por pago: lo que hoy las chicas anotan a mano en la
-- hoja de papel: fecha, detalle, y el monto en Efectivo / MP / Posnet). SOLO crea una tabla nueva: no toca
-- ninguna tabla que ya anda. Se puede correr cuando quieras, antes o después de subir el panel; sin la tabla,
-- la pestaña «Reemplazo de hoja» dice «Todavía no está la tabla de la hoja» y listo.
-- La sesión 2 (el «Cierre del día», que baja el stock) agrega columnas y una función aparte.
--
-- ⚠️ EXCEPCIÓN A NO ROMPER #5 (RLS pública en cada tabla nueva): esta tabla NO tiene lectura pública. `anon` no
-- tiene ningún permiso ni política: el catálogo de los clientes no la lee (hay plata adentro). La leen y escriben
-- las dos cuentas del panel (jefe y empleado) y el cron de backups (service_role, que se salta la RLS).
--
-- Reglas:
--   · el `id` lo genera la tablet (uuid): un reintento con el mismo id no duplica (23505 = ya estaba)
--   · `dia` es el día de la hoja en hora de Argentina (NO ROMPER #6); la tablet lo manda (se puede anotar un día
--     anterior, nunca uno futuro)
--   · `tipo`: 'venta' (lleva monto) o 'nota' (ANOTAR: texto libre, el monto es opcional)
--   · `items`: los frascos del renglón (slug, nombre, qty, llevar, ya_bajado, descontado); los decants y los sets
--     van como texto en `detalle`
--   · no hay editar: se TACHA (anulado_en / anulado_por), como en el papel; tachan las dos cuentas; BORRA sólo
--     `is_jefe()`
--   · cada renglón se guarda con su propio email en `creado_por`
-- ============================================================================

create table if not exists public.caja_movimientos (
  id          uuid primary key,
  creado_en   timestamptz not null default now(),
  dia         date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  tipo        text not null default 'venta'
              check (tipo in ('venta', 'nota')),
  detalle     text not null
              check (char_length(btrim(detalle)) between 1 and 300),
  efectivo    numeric(12, 2) not null default 0 check (efectivo >= 0 and efectivo <= 99999999),
  mp          numeric(12, 2) not null default 0 check (mp >= 0 and mp <= 99999999),
  posnet      numeric(12, 2) not null default 0 check (posnet >= 0 and posnet <= 99999999),
  items       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 20),
  creado_por  text not null default (auth.jwt() ->> 'email'),
  anulado_en  timestamptz,
  anulado_por text,
  check (tipo = 'nota' or (efectivo + mp + posnet) > 0),
  check ((anulado_en is null) = (anulado_por is null))
);

create index if not exists caja_movimientos_dia_idx on public.caja_movimientos (dia, creado_en);

comment on table public.caja_movimientos is
  '[REEMPLAZO-DE-HOJA] la hoja de caja digital: un renglón por pago (Efec. / MP / Posnet). Sin lectura pública (excepción a NO ROMPER #5). Tachan jefe y empleada; borra solo el jefe.';

alter table public.caja_movimientos enable row level security;

-- Nada para anon ni para PUBLIC. A authenticated se le sacan los permisos que Supabase da por defecto y se le
-- devuelven sólo los que usa el panel: leer, insertar, borrar (la política lo limita al jefe) y actualizar SÓLO las
-- dos columnas del tachado.
revoke all on public.caja_movimientos from anon, public, authenticated;
grant select, insert, delete on public.caja_movimientos to authenticated;
grant update (anulado_en, anulado_por) on public.caja_movimientos to authenticated;

drop policy if exists caja_select_staff on public.caja_movimientos;
create policy caja_select_staff on public.caja_movimientos
  for select to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));

drop policy if exists caja_insert_staff on public.caja_movimientos;
create policy caja_insert_staff on public.caja_movimientos
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])
    and creado_por = (auth.jwt() ->> 'email')
    and anulado_en is null
    and dia <= ((now() at time zone 'America/Argentina/Buenos_Aires')::date)
  );

-- Tachar: sólo un renglón que todavía no está tachado, y con el propio email de quien tacha.
drop policy if exists caja_update_staff on public.caja_movimientos;
create policy caja_update_staff on public.caja_movimientos
  for update to authenticated
  using (
    (auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])
    and anulado_en is null
  )
  with check (
    anulado_en is not null
    and anulado_por = (auth.jwt() ->> 'email')
  );

drop policy if exists caja_delete_jefe on public.caja_movimientos;
create policy caja_delete_jefe on public.caja_movimientos
  for delete to authenticated
  using (public.is_jefe());

-- ============================================================================
-- DESHACER (correr SOLO si hace falta volver atrás; borra la tabla y los renglones que tenga):
--
--   drop table if exists public.caja_movimientos;
--
-- ============================================================================
