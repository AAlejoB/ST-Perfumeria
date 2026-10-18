-- ============================================================================
-- [NUBES-CATALOGO] tanda 3 · el grupo de control con dos nubes por visita (18-oct-2026)
-- ============================================================================
-- Va DESPUÉS de sql/holmes_nubes.sql. Decisión de Alejo (18-oct, tanda 3): en una visita puede salir la nube de llegada Y una de
-- «mientras mira» ('comparar', 'indeciso', 'filtrar', 'busqueda'; js/app.js). Hasta acá una visita contaba en el grupo de control de
-- una nube sólo si ese día no había visto NINGUNA nube: con dos por visita, el control de las de «mientras mira» quedaba sólo con
-- las visitas sin nube de llegada (los que vuelven de día) y las que sí la vieron quedaban sólo del lado «con la nube». Comparación
-- torcida.
-- Lo único que cambia: una visita cuenta en el control de una nube si le tocaba ESA nube y no la vio (`control and not vio`, por
-- nube). Una nube de otra clase, vista o no, cae igual de los dos lados. Los ids nuevos no necesitan nada: `meta.nube` es texto libre.
-- Medido el 18-oct antes de escribirla: la función de la base es la de sql/holmes_nubes.sql (huella md5 de pg_get_functiondef
-- 87afac2727b253c38b0399de417396ee); ésta es esa misma con las 4 apariciones de `not vio_nube` cambiadas por `not vio`.
-- ============================================================================

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
      and ae.event_type in ('llegada', 'ficha_abierta', 'wa_intento', 'nube_vista', 'nube_tocada')
  ),
  vis0 as (           -- una fila por visita; `llego` sólo con la llegada nueva (meta.holmes = 2)
    select session_id, dia,
           bool_or(event_type = 'llegada' and meta ->> 'holmes' = '2') as llego,
           bool_or(event_type = 'ficha_abierta')                       as ficha,
           bool_or(event_type = 'wa_intento')                          as wa,
           bool_or(event_type = 'nube_vista' and coalesce(meta ->> 'control', '') <> 'true') as vio_nube,
           count(*)                                                    as n_ev,
           count(distinct slug) filter (where event_type = 'ficha_abierta') as n_fichas,
           count(distinct slug) filter (where event_type = 'wa_intento'
                                          and coalesce(meta ->> 'origen', '') not in ('carrito', 'decants_pack')) as n_wa
    from e group by session_id, dia
  ),
  vis as (            -- `cuenta` = llegó con la marca nueva y no es rara
    select *, (n_ev > 300 or n_fichas > 80 or n_wa > 8) as rara, (llego and not (n_ev > 300 or n_fichas > 80 or n_wa > 8)) as cuenta
    from vis0
  ),
  pp as (             -- una fila por visita y perfume, sólo de las visitas que cuentan
    select e.slug, e.session_id, e.dia,
           bool_or(e.event_type = 'ficha_abierta') as ficha,
           bool_or(e.event_type = 'wa_intento')    as wa
    from e join vis v on v.session_id = e.session_id and v.dia = e.dia
    where v.cuenta and e.slug is not null and e.event_type in ('ficha_abierta', 'wa_intento')
    group by e.slug, e.session_id, e.dia
  ),
  og as (             -- desde qué botón escribieron (visitas distintas)
    select coalesce(nullif(e.meta ->> 'origen', ''), 'otro') as origen, count(distinct (e.session_id, e.dia)) as n
    from e join vis v on v.session_id = e.session_id and v.dia = e.dia
    where v.cuenta and e.event_type = 'wa_intento'
    group by 1
  ),
  nb as (             -- [NUBES-HOLMES] una fila por visita y nube
    select left(e.meta ->> 'nube', 20) as nube, e.session_id, e.dia, v.wa, v.vio_nube,
           bool_or(e.event_type = 'nube_vista' and coalesce(e.meta ->> 'control', '') <> 'true') as vio,
           bool_or(e.event_type = 'nube_vista' and e.meta ->> 'control' = 'true')                as control,
           bool_or(e.event_type = 'nube_tocada')                                                 as toco
    from e join vis v on v.session_id = e.session_id and v.dia = e.dia
    where v.cuenta and e.event_type in ('nube_vista', 'nube_tocada') and coalesce(e.meta ->> 'nube', '') <> ''
    group by 1, e.session_id, e.dia, v.wa, v.vio_nube
  )
  select jsonb_build_object(
    'dias', v_dias,
    'hoy', (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    'desde', (select min((ae.created_at at time zone 'America/Argentina/Buenos_Aires')::date)
              from public.analytics_events ae where ae.event_type = 'llegada' and ae.meta ->> 'holmes' = '2'),
    'total', (select jsonb_build_object(
                'llegaron',       count(*) filter (where cuenta),
                'con_ficha',      count(*) filter (where cuenta and ficha),
                'escribieron',    count(*) filter (where cuenta and wa),
                'wa_sin_llegada', count(*) filter (where wa and not llego),
                'descartadas',    count(*) filter (where llego and rara))
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
    'origenes', (select coalesce(jsonb_agg(jsonb_build_object('origen', origen, 'visitas', n) order by n desc, origen), '[]'::jsonb) from og),
    'nubes', (select coalesce(jsonb_agg(jsonb_build_object('nube', nube, 'vieron', vi, 'tocaron', tc, 'escribieron', es,
                                                           'control', co, 'control_escribieron', ce)
                                        order by vi + co desc, nube), '[]'::jsonb)
              from (select nube,
                           count(*) filter (where vio)                              as vi,
                           count(*) filter (where vio and toco)                     as tc,
                           count(*) filter (where vio and wa)                       as es,
                           count(*) filter (where control and not vio)         as co,
                           count(*) filter (where control and not vio and wa)  as ce
                    from nb group by nube
                    having count(*) filter (where vio) + count(*) filter (where control and not vio) > 0
                    order by count(*) filter (where vio) + count(*) filter (where control and not vio) desc, nube limit 20) t)
  ) into r;

  return r;
end $$;
revoke all on function public.holmes_metricas(int) from public, anon;
grant execute on function public.holmes_metricas(int) to authenticated;

-- ============================================================================
-- DESHACER: correr de nuevo la función de sql/holmes_nubes.sql (sin el alter del CHECK, que no cambió).
-- ============================================================================
