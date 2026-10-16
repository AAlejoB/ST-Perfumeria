-- ============================================================================
-- [HOLMES] la pestaña «🔎 Holmes» de la cuenta de laboratorio (16-oct-2026, pedido de Alejo)
-- ============================================================================
-- SMELLROCK HOLMES (github.com/AAlejoB/SMELLROCK_HOLMES) es el agente que estudia por qué la gente mira y no compra.
-- Su caso 01 encontró que hoy no se sabe cuántos LLEGAN ni cuántos ABREN una ficha: `view_product` sólo cuenta los saltos
-- a una tarjeta (ranking, similares, vistos hace poco, link directo) y no hay ningún evento de llegada.
--
-- Esto hace dos cosas:
--   1. Deja entrar dos eventos NUEVOS en `analytics_events` (`llegada` y `ficha_abierta`). La tabla tiene un CHECK con la lista
--      de tipos: sin este cambio la base los rechaza. Los cuatro de siempre no cambian y el Laboratorio sigue leyendo sólo esos.
--   2. Crea `holmes_metricas(p_dias)`, el mismo patrón que `lab_metricas` (sql/rol_laboratorio.sql): security definer y sólo
--      responde si `es_dev()`; jefe y empleada reciben «sin permiso». No toca `lab_metricas` ni ninguna política.
--
-- Qué cuenta:
--   · VISITA = `session_id` + día en hora de Argentina (NO ROMPER #6). El `session_id` es por aparato (vive en localStorage):
--     el mismo celu dos veces el mismo día es UNA visita; al otro día, otra.
--   · total: visitas con `llegada`; de esas, cuántas abrieron alguna ficha y cuántas tuvieron un `wa_click` (de cualquier perfume).
--     `wa_sin_llegada` = visitas que escribieron sin que su llegada quedara (antes de que existiera el evento, o se perdió).
--   · por perfume: visitas con `ficha_abierta` de ese perfume; de esas, cuántas tuvieron `wa_click` de ese mismo perfume.
--     `wa_sin_ficha` = visitas que escribieron por ese perfume sin abrir su ficha (desde el botón de la tarjeta).
--   · Contando visitas distintas, «escribieron» nunca supera a «miraron» (es un subconjunto); la librería de Holmes tira un
--     error si pasara.
--   · desde: el primer día con una `llegada` (para decir «datos desde…»).
-- ============================================================================

-- ─── 1. los dos eventos nuevos ───────────────────────────────────────────────
alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
alter table public.analytics_events add constraint analytics_events_event_type_check
  check (event_type = any (array['view_product', 'decant_add', 'wa_click', 'search_empty', 'llegada', 'ficha_abierta']::text[]));

-- ─── 2. las métricas de Holmes ───────────────────────────────────────────────
create or replace function public.holmes_metricas(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dias  int := greatest(1, least(coalesce(p_dias, 30), 365));
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
  r       jsonb;
begin
  if not public.es_dev() then raise exception 'sin permiso' using errcode = '42501'; end if;

  with
  e as (
    select ae.session_id, ae.event_type, ae.slug, (ae.created_at at time zone 'America/Argentina/Buenos_Aires')::date as dia
    from public.analytics_events ae
    where ae.created_at >= v_desde and ae.session_id is not null
      and ae.event_type in ('llegada', 'ficha_abierta', 'wa_click')
  ),
  vis as (            -- una fila por visita
    select session_id, dia,
           bool_or(event_type = 'llegada')       as llego,
           bool_or(event_type = 'ficha_abierta') as ficha,
           bool_or(event_type = 'wa_click')      as wa
    from e group by session_id, dia
  ),
  pp as (             -- una fila por visita y perfume
    select slug, session_id, dia,
           bool_or(event_type = 'ficha_abierta') as ficha,
           bool_or(event_type = 'wa_click')      as wa
    from e where slug is not null and event_type in ('ficha_abierta', 'wa_click')
    group by slug, session_id, dia
  )
  select jsonb_build_object(
    'dias', v_dias,
    'hoy', (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    'desde', (select min((ae.created_at at time zone 'America/Argentina/Buenos_Aires')::date)
              from public.analytics_events ae where ae.event_type = 'llegada'),
    'total', (select jsonb_build_object(
                'llegaron',       count(*) filter (where llego),
                'con_ficha',      count(*) filter (where llego and ficha),
                'escribieron',    count(*) filter (where llego and wa),
                'wa_sin_llegada', count(*) filter (where wa and not llego))
              from vis),
    'por_perfume', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'miraron', m, 'escribieron', w, 'wa_sin_ficha', s)
                                              order by m desc, w desc, slug), '[]'::jsonb)
                    from (select slug,
                                 count(*) filter (where ficha)            as m,
                                 count(*) filter (where ficha and wa)     as w,
                                 count(*) filter (where wa and not ficha) as s
                          from pp group by slug
                          having count(*) filter (where ficha) > 0
                          order by 2 desc, 3 desc, slug limit 40) t)
  ) into r;

  return r;
end $$;
revoke all on function public.holmes_metricas(int) from public, anon;
grant execute on function public.holmes_metricas(int) to authenticated;

-- ============================================================================
-- DESHACER (en este orden):
--   drop function if exists public.holmes_metricas(int);
--   -- volver al CHECK de antes: primero hay que sacar las filas de los eventos nuevos, si no la base no lo deja poner
--   -- (y antes conviene volver atrás el front: con el CHECK viejo, la base rebota `llegada` y `ficha_abierta`; los viejos
--   -- siguen entrando porque viajan en otro pedido).
--   delete from public.analytics_events where event_type in ('llegada', 'ficha_abierta');
--   alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
--   alter table public.analytics_events add constraint analytics_events_event_type_check
--     check (event_type = any (array['view_product', 'decant_add', 'wa_click', 'search_empty']::text[]));
-- ============================================================================
