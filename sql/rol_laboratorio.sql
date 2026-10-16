-- ============================================================================
-- [LABORATORIO] carta C del DISEÑADOR, rehecha con Alejo el 16-oct-2026: una TERCERA cuenta del login, de SOLO MIRAR.
-- ============================================================================
-- Entra por el mismo login (un tercer intento, sin ningún texto nuevo para jefe ni empleada) y ve UNA pestaña, «Laboratorio»,
-- con las métricas de lo que pasó de verdad (ventas, visitas, consultas, búsquedas). No anota ni cambia nada: por eso NO hay
-- filas «de prueba», ni columnas `prueba`, ni cambios en las funciones de stock o de caja (el md original de la carta C
-- suponía una cuenta que prueba el panel escribiendo; Alejo la quiso de laboratorio de datos).
--
-- Cómo se reconoce: por email, en `usuarios_dev` (sin ninguna política: sólo la lee `es_dev()`, que es security definer).
-- Cómo lee: NO tiene permisos sobre ninguna tabla. Todo sale de UNA función security definer, `lab_metricas(p_dias)`, que
-- sólo responde si `es_dev()`; jefe y empleada reciben «sin permiso». Así ninguna política existente se toca.
--
-- ⚠️ Lo que NO impide (aceptado): la cuenta es `authenticated`, y `is_admin_authenticated()` (= cualquier sesión con rol
-- authenticated) deja escribir perfume_overrides, perfumes_nuevos, destacados… por la API. La pantalla no tiene ningún
-- control de escritura y son cuentas de confianza (Alejo, Luka, Lautaro, que además tienen las llaves de la base). Si algún día
-- hace falta que NO pueda escribir ni por la API: políticas RESTRICTIVE `not es_dev()` en esas tablas.
--
-- ⚠️ ANTES de usarla: crear el usuario en Supabase → Authentication → Users → Add user (email `lab@stperfumeria.local`,
-- una contraseña fuerte, «Auto Confirm User»). El registro está cerrado (disable_signup), no se puede crear desde el login.
-- ============================================================================

create table if not exists public.usuarios_dev (
  email      text primary key,
  nombre     text,
  created_at timestamptz not null default now()
);
alter table public.usuarios_dev enable row level security;
revoke all on public.usuarios_dev from anon, public, authenticated;   -- sin políticas ni permisos: sólo es_dev() la mira

insert into public.usuarios_dev (email, nombre) values ('lab@stperfumeria.local', 'Laboratorio (Alejo, Luka, Lautaro)')
on conflict (email) do nothing;

create or replace function public.es_dev() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios_dev where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.es_dev() from public, anon;
grant execute on function public.es_dev() to authenticated;

-- La vista base para las estadísticas de ventas (las futuras se construyen sobre ella, no sobre `ventas` cruda).
create or replace view public.v_ventas_reales with (security_invoker = on) as
  select * from public.ventas where anulada_en is null;
revoke all on public.v_ventas_reales from anon, public;
grant select on public.v_ventas_reales to authenticated;

-- ─── las métricas ────────────────────────────────────────────────────────────
-- Devuelve un jsonb. Fechas en hora de Argentina (NO ROMPER #6). `monto` de ventas = precio de LISTA por cantidad
-- (lo que guarda `ventas.monto_total`), no lo cobrado con el 10 % de Efec./MP. La ganancia sólo cuenta frascos con costo.
create or replace function public.lab_metricas(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dias  int  := greatest(1, least(coalesce(p_dias, 30), 365));
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
  v_hoy   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  r       jsonb;
begin
  if not public.es_dev() then raise exception 'sin permiso' using errcode = '42501'; end if;

  with
  v as (
    select ve.*, (ve.fecha at time zone 'America/Argentina/Buenos_Aires')::date as dia,
           coalesce(pc.costo, mc.costo) as costo_u
    from public.ventas ve
    left join public.perfumes_costo pc on pc.slug = ve.slug_perfume
    left join public.marcas_costo   mc on lower(btrim(mc.marca)) = lower(btrim(ve.marca))
    where ve.anulada_en is null
  ),
  e as (
    select ae.*, (ae.created_at at time zone 'America/Argentina/Buenos_Aires')::date as dia
    from public.analytics_events ae where ae.created_at >= v_desde
  )
  select jsonb_build_object(
    'dias', v_dias,
    'hoy', v_hoy,
    'ventas', (select jsonb_build_object('filas', count(*), 'unidades', coalesce(sum(cantidad), 0), 'monto', coalesce(sum(monto_total), 0),
                                         'desde', min(dia), 'dias_con_ventas', count(distinct dia)) from v),
    'ventas_ventana', (select jsonb_build_object('unidades', coalesce(sum(cantidad), 0), 'monto', coalesce(sum(monto_total), 0)) from v where fecha >= v_desde),
    'por_semana', (select coalesce(jsonb_agg(jsonb_build_object('semana', s, 'unidades', u, 'monto', m) order by s), '[]'::jsonb)
                   from (select date_trunc('week', dia)::date s, sum(cantidad) u, sum(monto_total) m from v where dia >= v_hoy - 56 group by 1) t),
    'por_origen', (select coalesce(jsonb_agg(jsonb_build_object('clave', origen, 'unidades', u, 'monto', m) order by u desc), '[]'::jsonb)
                   from (select origen, sum(cantidad) u, sum(monto_total) m from v group by 1) t),
    'por_medio', (select coalesce(jsonb_agg(jsonb_build_object('clave', coalesce(medio_pago, 'sin dato'), 'unidades', u, 'monto', m) order by u desc), '[]'::jsonb)
                  from (select medio_pago, sum(cantidad) u, sum(monto_total) m from v group by 1) t),
    'por_tipo', (select coalesce(jsonb_agg(jsonb_build_object('clave', coalesce(tipo, 'otra cosa'), 'unidades', u, 'monto', m) order by u desc), '[]'::jsonb)
                 from (select tipo, sum(cantidad) u, sum(monto_total) m from v group by 1) t),
    'top_perfumes', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug_perfume, 'nombre', n, 'marca', ma, 'unidades', u, 'monto', m) order by u desc, m desc), '[]'::jsonb)
                     from (select slug_perfume, max(perfume_nombre) n, max(marca) ma, sum(cantidad) u, sum(monto_total) m
                           from v where tipo = 'frasco' group by 1 order by 4 desc, 5 desc limit 10) t),
    'ganancia', (select jsonb_build_object('frascos_uds', coalesce(sum(cantidad), 0),
                                           'con_costo_uds', coalesce(sum(cantidad) filter (where costo_u is not null), 0),
                                           'monto_con_costo', coalesce(sum(monto_total) filter (where costo_u is not null), 0),
                                           'costo_total', coalesce(sum(costo_u * cantidad) filter (where costo_u is not null), 0))
                 from v where tipo = 'frasco'),
    'eventos', (select jsonb_build_object('vistas', count(*) filter (where event_type = 'view_product'),
                                          'wa', count(*) filter (where event_type = 'wa_click'),
                                          'decants', count(*) filter (where event_type = 'decant_add'),
                                          'busquedas_vacias', count(*) filter (where event_type = 'search_empty'),
                                          'primer_dia', min(dia)) from e),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'vistas', vi, 'wa', wa, 'decants', de) order by dia), '[]'::jsonb)
                from (select dia, count(*) filter (where event_type = 'view_product') vi, count(*) filter (where event_type = 'wa_click') wa,
                             count(*) filter (where event_type = 'decant_add') de from e group by dia) t),
    'embudo', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'vistas', vi, 'decants', de, 'wa', wa, 'vendidas', vd) order by vi + wa * 5 desc, vi desc), '[]'::jsonb)
               from (select t.slug, t.vi, t.de, t.wa, coalesce(vv.vd, 0) vd
                     from (select slug, count(*) filter (where event_type = 'view_product') vi, count(*) filter (where event_type = 'decant_add') de,
                                  count(*) filter (where event_type = 'wa_click') wa
                           from e where slug is not null group by slug) t
                     left join (select slug_perfume s, sum(cantidad) vd from v where tipo = 'frasco' and fecha >= v_desde group by 1) vv on vv.s = t.slug
                     order by t.vi + t.wa * 5 desc, t.vi desc limit 25) q),
    'referrer', (select coalesce(jsonb_agg(jsonb_build_object('clave', c, 'vistas', vi, 'wa', wa, 'decants', de) order by vi + wa desc), '[]'::jsonb)
                 from (select coalesce(nullif(meta ->> 'referrer', ''), 'sin dato') c, count(*) filter (where event_type = 'view_product') vi,
                              count(*) filter (where event_type = 'wa_click') wa, count(*) filter (where event_type = 'decant_add') de
                       from e where event_type in ('view_product', 'wa_click', 'decant_add') group by 1) t),
    'dispositivo', (select coalesce(jsonb_agg(jsonb_build_object('clave', c, 'vistas', vi, 'wa', wa, 'decants', de) order by vi + wa desc), '[]'::jsonb)
                    from (select coalesce(nullif(meta ->> 'device', ''), 'sin dato') c, count(*) filter (where event_type = 'view_product') vi,
                                 count(*) filter (where event_type = 'wa_click') wa, count(*) filter (where event_type = 'decant_add') de
                          from e where event_type in ('view_product', 'wa_click', 'decant_add') group by 1) t),
    'wa_por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'wa', n) order by h), '[]'::jsonb)
                    from (select (meta ->> 'hour')::int h, count(*) n from e
                          where event_type = 'wa_click' and (meta ->> 'hour') ~ '^[0-9]{1,2}$' group by 1) t),
    'busquedas', (select coalesce(jsonb_agg(jsonb_build_object('q', q, 'n', n) order by n desc), '[]'::jsonb)
                  from (select left(lower(btrim(query)), 60) q, count(*) n from e
                        where event_type = 'search_empty' and query is not null and btrim(query) <> '' group by 1 order by 2 desc limit 20) t)
  ) into r;

  return r;
end $$;
revoke all on function public.lab_metricas(int) from public, anon;
grant execute on function public.lab_metricas(int) to authenticated;

-- ============================================================================
-- DESHACER:
--   drop function if exists public.lab_metricas(int);
--   drop view if exists public.v_ventas_reales;
--   drop function if exists public.es_dev();
--   drop table if exists public.usuarios_dev;
--   (y borrar el usuario lab@stperfumeria.local desde Authentication → Users)
-- ============================================================================
