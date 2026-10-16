-- ============================================================================
-- [HOJA-MONTO-CERO] · 16-oct-2026 · la hoja de caja acepta ventas de $0
-- ============================================================================
-- Qué hace: saca de `caja_movimientos` la regla «una venta tiene que sumar más de $0 entre Efec. + MP + Posnet»
-- (la que creó sql/caja_movimientos.sql: `check (tipo = 'nota' or (efectivo + mp + posnet) > 0)`).
-- Por qué: Alejo pidió poder anotar una muestra, un regalo o una cortesía a $0 (y cualquier monto). El panel ya
-- no lo frena (hay que tocar un cuadrado y escribir 0); si esta migración no se corrió, el panel lo dice:
-- «La base todavía no acepta ventas de $0 (falta correr sql/caja_monto_cero.sql en Supabase)».
-- Qué NO toca: los límites de máximo (99999999), `debe`, el tachado ni los permisos. No cambia ningún dato.
-- Cómo se corre: pegarlo en el SQL Editor de Supabase. Se puede correr más de una vez (si ya no está, no hace nada).
-- Cómo se vuelve atrás: re-crear la regla con
--   alter table public.caja_movimientos add constraint caja_venta_con_monto check (tipo = 'nota' or (efectivo + mp + posnet) > 0);
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.caja_movimientos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%posnet%'
      and pg_get_constraintdef(oid) ilike '%nota%'      -- la regla «tipo = 'nota' or … > 0»
      and pg_get_constraintdef(oid) not ilike '%debe%'  -- (ninguna otra regla nombra a la vez posnet y nota)
  loop
    execute format('alter table public.caja_movimientos drop constraint %I', r.conname);
    raise notice 'Se sacó la regla % (monto mayor a 0)', r.conname;
  end loop;
end $$;
