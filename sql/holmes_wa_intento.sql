-- ============================================================================
-- [WA-INTENTO] Holmes cuenta TODOS los caminos a WhatsApp (16-oct-2026, caso 03 de SMELLROCK HOLMES, decisión de Alejo)
-- ============================================================================
-- Va DESPUÉS de sql/holmes.sql (aplicada el 16-oct). Lo que encontró Holmes: `wa_click` sólo lo suma goToWA (la ficha y la tarjeta
-- en la compu). El «Consultar →» de la tarjeta en el celu (seguramente el camino más usado), el pedido, el flotante, los sets, los
-- decants, la consulta de stock, el Desafío y los links del pie abrían WhatsApp sin dejar rastro, así que el «escribieron» de
-- Holmes contaba de menos.
--
-- Esto:
--   1. Deja entrar un evento NUEVO, `wa_intento` (con `meta.origen`: tarjeta_celu, tarjeta_compu, ficha, carrito, flotante, set,
--      stock, decant, decants_pack, decants_banner, desafio, catalogo_wa, mapa, pie). `wa_click` no cambia: el Laboratorio lo sigue
--      leyendo igual.
--   2. Cambia `holmes_metricas` para que «escribieron» sea `wa_intento`. Y cuenta SÓLO las visitas cuya `llegada` lleva
--      `meta.holmes = 2` (la manda el catálogo desde SW v1.1.284): las de antes no medían todos los botones y mezclarlas daría
--      una tasa más baja que la real. «Datos desde» pasa a ser el primer día con esa llegada.
--   3. Suma `origenes`: de las visitas que escribieron, desde qué botón (visitas distintas por origen).
-- Visita = `session_id` + día de Argentina, como antes. «escribieron» sigue siendo un subconjunto de «llegaron» / «miraron».
-- ============================================================================

alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
alter table public.analytics_events add constraint analytics_events_event_type_check
  check (event_type = any (array['view_product', 'decant_add', 'wa_click', 'search_empty', 'llegada', 'ficha_abierta', 'wa_intento']::text[]));

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
    select ae.session_id, ae.event_type, ae.slug, ae.meta, (ae.created_at at time zone 'America/Argentina/Buenos_Aires')::date as dia
    from public.analytics_events ae
    where ae.created_at >= v_desde and ae.session_id is not null
      and ae.event_type in ('llegada', 'ficha_abierta', 'wa_intento')
  ),
  vis as (            -- una fila por visita; `llego` sólo con la llegada nueva (meta.holmes = 2)
    select session_id, dia,
           bool_or(event_type = 'llegada' and meta ->> 'holmes' = '2') as llego,
           bool_or(event_type = 'ficha_abierta')                       as ficha,
           bool_or(event_type = 'wa_intento')                          as wa
    from e group by session_id, dia
  ),
  pp as (             -- una fila por visita y perfume, sólo de las visitas que cuentan
    select e.slug, e.session_id, e.dia,
           bool_or(e.event_type = 'ficha_abierta') as ficha,
           bool_or(e.event_type = 'wa_intento')    as wa
    from e join vis v on v.session_id = e.session_id and v.dia = e.dia
    where v.llego and e.slug is not null and e.event_type in ('ficha_abierta', 'wa_intento')
    group by e.slug, e.session_id, e.dia
  ),
  og as (             -- desde qué botón escribieron (visitas distintas)
    select coalesce(nullif(e.meta ->> 'origen', ''), 'otro') as origen, count(distinct (e.session_id, e.dia)) as n
    from e join vis v on v.session_id = e.session_id and v.dia = e.dia
    where v.llego and e.event_type = 'wa_intento'
    group by 1
  )
  select jsonb_build_object(
    'dias', v_dias,
    'hoy', (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    'desde', (select min((ae.created_at at time zone 'America/Argentina/Buenos_Aires')::date)
              from public.analytics_events ae where ae.event_type = 'llegada' and ae.meta ->> 'holmes' = '2'),
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
                          order by 2 desc, 3 desc, slug limit 40) t),
    'origenes', (select coalesce(jsonb_agg(jsonb_build_object('origen', origen, 'visitas', n) order by n desc, origen), '[]'::jsonb) from og)
  ) into r;

  return r;
end $$;
revoke all on function public.holmes_metricas(int) from public, anon;
grant execute on function public.holmes_metricas(int) to authenticated;

-- ============================================================================
-- DESHACER (en este orden):
--   1. Volver a la holmes_metricas de antes: correr de nuevo la parte 2 de sql/holmes.sql (el create or replace + revoke + grant).
--   2. Volver al CHECK de sql/holmes.sql (antes conviene volver atrás el front: con ese CHECK la base rebota `wa_intento`;
--      los viejos siguen entrando porque viajan en otro pedido):
--      delete from public.analytics_events where event_type = 'wa_intento';
--      alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
--      alter table public.analytics_events add constraint analytics_events_event_type_check
--        check (event_type = any (array['view_product', 'decant_add', 'wa_click', 'search_empty', 'llegada', 'ficha_abierta']::text[]));
-- ============================================================================
