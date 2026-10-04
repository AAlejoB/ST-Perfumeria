-- [PUNTOS-JSONB-FUERA] · paso A · v2 (2-oct-2026, Claude Code, `_bm`) · pedido del PREPARADOR en su `_bp`
-- resumen_dia() y daily_summary() leen de public.puntos_log en vez del JSONB clientes.puntos_log.
-- El v1 (`propuesta_jsonb_fuera_A.sql`) no se toca. Cambios de este v2:
--   · NO se normalizan los fines de línea: el bloque viejo se busca y se reemplaza sobre el texto ORIGINAL de cada función, con el
--     mismo fin de línea que trae (resumen_dia(): `\r\n` en el cuerpo; daily_summary(): `\n`). El bloque nuevo respeta el de cada una.
--     Medido en la base el 2-oct: resumen_dia() tiene 195 `\r` y 201 `\n`; daily_summary(), 0 `\r` y 98 `\n`. Después del reemplazo
--     tienen que quedar los mismos números (el bloque nuevo tiene las mismas 2 líneas que el viejo): el DO lo verifica y frena si no.
--   · daily_summary() es SECURITY DEFINER sin search_path fijo: se le fija `public, pg_temp` en la misma transacción. Medido: todas
--     las tablas que nombra ya llevan `public.` (admin_actions, clientes, perfume_overrides, y puntos_log desde este cambio); las
--     funciones que llama sin esquema (abs, coalesce, count, extract, first_value, now, regexp_replace, replace, string_agg, sum, upper;
--     jsonb_array_elements desaparece con este cambio) son todas de pg_catalog; no nombra nada de otro esquema.
--   · puntos_log.created_at es timestamptz (default now()) y puntos_log.delta es integer NOT NULL (medido): la comparación por día
--     `(l.created_at at time zone tz)::date = p_dia` es la misma que ya usan las dos funciones con el `ts` del JSONB.
-- Decisión del PREPARADOR: `join` (paridad con hoy: los movimientos de un cliente borrado no se ven). Se aplica recién después de las
-- 23:05 ART del 2-oct (después del Telegram de las 23:00), con el «aplicá A» de Alejo.
-- Una sola transacción: o cambian las dos funciones y el search_path o no cambia nada.

begin;

do $a$
declare
  d0 text; d text;
  v_viejo text; v_nuevo text;
  cr0 int; lf0 int; cr1 int; lf1 int;
begin
  -- ── resumen_dia(date): el cuerpo trae \r\n; se busca con \r\n entre las dos líneas ──
  v_viejo := $o$    select c.nombre, c.telefono, (e->>'delta')::int as delta, (e->>'ts')::timestamptz as ts$o$ || E'\r\n'
          || $o$    from clientes c, jsonb_array_elements(coalesce(c.puntos_log, '[]'::jsonb)) e$o$;
  v_nuevo := $n$    select c.nombre, c.telefono, l.delta, l.created_at as ts$n$ || E'\r\n'
          || $n$    from puntos_log l join clientes c on c.id = l.cliente_id$n$;

  d0 := pg_get_functiondef('public.resumen_dia(date)'::regprocedure);
  if position(v_viejo in d0) = 0 then
    raise exception 'resumen_dia: no encontré el bloque viejo del CTE movs, con sus fines de línea (¿ya se cambió o la función es otra?)';
  end if;
  d := replace(d0, v_viejo, v_nuevo);
  cr0 := length(d0) - length(replace(d0, E'\r', '')); lf0 := length(d0) - length(replace(d0, E'\n', ''));
  cr1 := length(d)  - length(replace(d,  E'\r', '')); lf1 := length(d)  - length(replace(d,  E'\n', ''));
  if d = d0 or position('puntos_log l join clientes' in d) = 0 or d ~ '\mc\.puntos_log' or cr0 <> cr1 or lf0 <> lf1 then
    raise exception 'resumen_dia: el reemplazo no quedó como se esperaba (cr % -> %, lf % -> %)', cr0, cr1, lf0, lf1;
  end if;
  execute d;

  -- ── daily_summary(date): el cuerpo trae \n ──
  v_viejo := $o$    SELECT c.nombre, c.telefono, (e->>'delta')::int AS delta, (e->>'ts')::timestamptz AS ts$o$ || E'\n'
          || $o$    FROM public.clientes c, jsonb_array_elements(COALESCE(c.puntos_log,'[]'::jsonb)) e$o$;
  v_nuevo := $n$    SELECT c.nombre, c.telefono, l.delta, l.created_at AS ts$n$ || E'\n'
          || $n$    FROM public.puntos_log l JOIN public.clientes c ON c.id = l.cliente_id$n$;

  d0 := pg_get_functiondef('public.daily_summary(date)'::regprocedure);
  if position(v_viejo in d0) = 0 then
    raise exception 'daily_summary: no encontré el bloque viejo del CTE movs, con sus fines de línea (¿ya se cambió o la función es otra?)';
  end if;
  d := replace(d0, v_viejo, v_nuevo);
  cr0 := length(d0) - length(replace(d0, E'\r', '')); lf0 := length(d0) - length(replace(d0, E'\n', ''));
  cr1 := length(d)  - length(replace(d,  E'\r', '')); lf1 := length(d)  - length(replace(d,  E'\n', ''));
  if d = d0 or position('public.puntos_log l JOIN' in d) = 0 or d ~ '\mc\.puntos_log' or cr0 <> cr1 or lf0 <> lf1 then
    raise exception 'daily_summary: el reemplazo no quedó como se esperaba (cr % -> %, lf % -> %)', cr0, cr1, lf0, lf1;
  end if;
  execute d;
end
$a$;

-- CREATE OR REPLACE deja la función sin SET: se fija el search_path DESPUÉS de recrearla (resumen_dia() ya conserva el suyo: `SET search_path TO 'public'`, viene en su definición).
alter function public.daily_summary(date) set search_path = public, pg_temp;

-- Comprobación (sólo lectura, dentro de la misma transacción). Ojo: `\mc\.puntos_log` (c. como alias, con límite de palabra) y no el texto suelto «c.puntos_log», que también está adentro de «publi[c.puntos_log]» de la versión nueva (lo mostró la prueba en seco).
select p.proname,
       pg_get_functiondef(p.oid) ~ '\mc\.puntos_log'  as sigue_leyendo_el_jsonb,   -- tiene que dar false
       pg_get_functiondef(p.oid) ~ 'puntos_log l'    as lee_la_tabla,             -- tiene que dar true
       (select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r
         where r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid, p.oid, 'execute')) as ejecutan,  -- authenticated,service_role
       p.proconfig                                                                  -- resumen_dia: {search_path=public} · daily_summary: {"search_path=public, pg_temp"}
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('resumen_dia', 'daily_summary')
order by 1;

commit;

-- ── Volver atrás: repetir el bloque DO con v_viejo y v_nuevo intercambiados (y, para daily_summary, `alter function public.daily_summary(date) reset search_path;`). ──
