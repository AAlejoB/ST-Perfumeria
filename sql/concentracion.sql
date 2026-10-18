-- [CONCENTRACION] · 18-oct-2026 · pedido de Alejo: la concentración de aceites de cada perfume (EDP, EDT, Parfum…), como ayuda de
-- memoria en la ficha y para la «duración estimada» (scripts/duracion_estimada.js, js/app.js entre DURACION:INICIO/FIN).
--
-- · Una columna más en perfume_overrides, opcional: null = sin dato (el catálogo la lee del nombre si el nombre la dice, «… EDT»).
-- · La escriben las dos cuentas desde Editar, con las mismas políticas de siempre de perfume_overrides (no se tocan).
-- · anon la lee con el resto de la fila (select *): es un dato público del perfume, como el perfil o las notas.
-- · La tabla ya está en las dos listas de backups (NO ROMPER #23): no hay que sumar nada.
-- · Aditiva: si el panel viejo guarda sin la columna, no pasa nada; si el panel nuevo guarda sin la columna corrida, reintenta sin ella.

alter table public.perfume_overrides
  add column if not exists concentracion text;

alter table public.perfume_overrides
  drop constraint if exists perfume_overrides_concentracion_check;

alter table public.perfume_overrides
  add constraint perfume_overrides_concentracion_check
  check (concentracion is null or concentracion in ('Extrait', 'Parfum', 'Elixir', 'EDP', 'EDT', 'Cologne'));

comment on column public.perfume_overrides.concentracion is
  '[CONCENTRACION] Extrait | Parfum | Elixir | EDP | EDT | Cologne · null = sin dato (el catálogo la toma del nombre si la dice)';
