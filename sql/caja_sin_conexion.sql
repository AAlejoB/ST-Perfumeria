-- ============================================================================
-- [SIN-CONEXION-HOJA] · 16-oct-2026 · carta B · la marca «sin red» en la hoja de caja
-- ============================================================================
-- Qué hace: agrega a `caja_movimientos` la columna `sin_conexion` (true = el renglón se anotó en una tablet SIN internet y subió después).
-- El panel la manda sola al subir lo que esperó en la tablet y el Resumen del día muestra la marca «sin red» junto a la hora real.
-- Qué NO toca: ningún dato existente (todos quedan en false), ni permisos (la tabla ya deja insertar y leer a las dos cuentas del panel).
-- Si no se corre: el panel anda igual (sube sin la marca y el Resumen no la muestra).
-- Cómo se corre: pegarlo en el SQL Editor de Supabase. Se puede correr más de una vez.
-- Cómo se vuelve atrás: alter table public.caja_movimientos drop column sin_conexion;
-- ============================================================================
alter table public.caja_movimientos add column if not exists sin_conexion boolean not null default false;
comment on column public.caja_movimientos.sin_conexion is '[SIN-CONEXION-HOJA] true = se anotó sin internet en una tablet y subió después (la hora real es creado_en).';
