-- ============================================================================
-- [ESCANER] 163 · códigos de barras de los frascos  ·  12-oct-2026
-- ============================================================================
-- Qué hace: crea la tabla `perfume_codigos` (código de barras -> perfume). SOLO crea una tabla
-- nueva: no toca ninguna tabla que ya anda. Se puede correr cuando quieras, antes o después de
-- subir el panel; sin la tabla, el panel muestra «Todavía no está la tabla de códigos» y listo.
--
-- ⚠️ EXCEPCIÓN A NO ROMPER #5 (RLS pública en cada tabla nueva): esta tabla NO tiene lectura
-- pública. `anon` no tiene ningún permiso ni política: el catálogo de los clientes no la lee.
-- La leen y escriben las dos cuentas del panel (jefe y empleado) y el cron de backups
-- (service_role, que se salta la RLS).
--
-- Reglas:
--   · un código es de UN solo perfume (primary key); un perfume puede tener varios códigos
--   · el código se guarda SOLO con dígitos: 13 (EAN-13; el UPC-A de 12 pasa con un 0 adelante) u 8
--   · sin FK a propósito: los slugs viven en perfumes.js y en perfumes_nuevos; el panel valida
--     que el slug exista antes de guardar
--   · insertan el jefe y la empleada (con su propio email en creado_por); borra SOLO el jefe (cambiado el 12-oct noche: ver sql/perfume_codigos_borrar_staff.sql, ahora borran las dos cuentas);
--     no hay update (para cambiar un código de perfume: el jefe lo quita y se vuelve a escanear)
-- ============================================================================

create table if not exists public.perfume_codigos (
  codigo     text primary key
             check (codigo ~ '^[0-9]{8}$' or codigo ~ '^[0-9]{13}$'),
  slug       text not null
             check (char_length(slug) between 1 and 120),
  creado_por text not null default (auth.jwt() ->> 'email'),
  creado_en  timestamptz not null default now()
);

create index if not exists perfume_codigos_slug_idx on public.perfume_codigos (slug);

comment on table public.perfume_codigos is
  '[ESCANER] 163 · código de barras -> perfume (slug). Sin lectura pública (excepción a NO ROMPER #5). Insertan jefe y empleada; borra solo el jefe.';

alter table public.perfume_codigos enable row level security;

-- Nada para anon ni para PUBLIC: ni siquiera permisos de tabla. A authenticated se le sacan los que Supabase da por defecto
-- (update, truncate, references, trigger) y se le devuelven sólo los tres que usa el panel.
revoke all on public.perfume_codigos from anon, public, authenticated;
grant select, insert, delete on public.perfume_codigos to authenticated;

drop policy if exists perfume_codigos_select_staff on public.perfume_codigos;
create policy perfume_codigos_select_staff on public.perfume_codigos
  for select to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));

drop policy if exists perfume_codigos_insert_staff on public.perfume_codigos;
create policy perfume_codigos_insert_staff on public.perfume_codigos
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local'])
    and creado_por = (auth.jwt() ->> 'email')
  );

drop policy if exists perfume_codigos_delete_jefe on public.perfume_codigos;
create policy perfume_codigos_delete_jefe on public.perfume_codigos
  for delete to authenticated
  using (public.is_jefe());

-- ============================================================================
-- DESHACER (correr SOLO si hace falta volver atrás; borra la tabla y los códigos que tenga):
--
--   drop table if exists public.perfume_codigos;
--
-- ============================================================================
