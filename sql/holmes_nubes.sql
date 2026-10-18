-- ============================================================================
-- [NUBES-HOLMES] medir cada nube del catálogo (18-oct-2026, regla (d) de [NUBES-CATALOGO]: «cada una medida con Holmes»)
-- ============================================================================
-- Va DESPUÉS de sql/holmes_disyuntor.sql (es su holmes_metricas con una cuenta más). Medido el 18-oct antes de escribirla: el CHECK
-- y la función de la base son los de ese archivo (la función, sin los comentarios de adentro).
--
-- Dos eventos nuevos del catálogo (js/app.js, `nubeEvento`), uno por visita y por nube, aparte de los viejos y con keepalive:
--   · `nube_vista`  · meta.nube = el id de la nube ('pedido', 'favorito', 'nuevos', 'bienvenida', 'cerrado', 'festivo'),
--                     meta.control = true si le tocaba esa nube y NO se la mostramos (el grupo de control).
--   · `nube_tocada` · tocó el botón de la nube (meta.nube); las nubes sin botón no lo mandan.
-- El grupo de control (decisión de Alejo, 18-oct, «1 de cada 5 sin nube»): a 1 de cada 5 visitas que les tocaba una nube del director
-- no se la mostramos. Es la única forma de saber si una nube SUBE los WhatsApp y no sólo si la miran (el que vuelve ya escribe más
-- que el nuevo: sin control se mezcla). El saludo del festivo no tiene control (sale un día y no es del director).
--
-- Cuenta nueva en holmes_metricas, `nubes`: por nube, sobre las visitas que cuentan (las mismas de `total`):
--   vieron · de ésas, tocaron el botón · de ésas, escribieron por WhatsApp (cualquier botón, ese día)
--   control · de ésas, escribieron. Una visita es de control sólo si ese día no vio NINGUNA nube (un aparato que abre dos pestañas
--   puede tener dos visitas del director en el mismo día).
-- Nada más cambia: total, por_perfume y origenes cuentan lo mismo (los eventos de nube suman 1 o 2 a `n_ev`, que corta en 300).
-- ============================================================================

alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
alter table public.analytics_events add constraint analytics_events_event_type_check
  check (event_type = any (array['view_product', 'decant_add', 'wa_click', 'search_empty', 'llegada', 'ficha_abierta', 'wa_intento',
                                 'nube_vista', 'nube_tocada']::text[]));

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
                           count(*) filter (where control and not vio_nube)         as co,
                           count(*) filter (where control and not vio_nube and wa)  as ce
                    from nb group by nube
                    having count(*) filter (where vio) + count(*) filter (where control and not vio_nube) > 0
                    order by count(*) filter (where vio) + count(*) filter (where control and not vio_nube) desc, nube limit 20) t)
  ) into r;

  return r;
end $$;
revoke all on function public.holmes_metricas(int) from public, anon;
grant execute on function public.holmes_metricas(int) to authenticated;

-- ============================================================================
-- DESHACER (en este orden; antes conviene volver atrás el front: con el CHECK viejo la base rebota los eventos de nube, sin romper
-- nada porque van en un pedido aparte):
--   alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
--   alter table public.analytics_events add constraint analytics_events_event_type_check
--     check (event_type = any (array['view_product', 'decant_add', 'wa_click', 'search_empty', 'llegada', 'ficha_abierta', 'wa_intento']::text[]));
--   -- holmes_metricas sin las nubes: correr de nuevo la función de sql/holmes_disyuntor.sql
-- ============================================================================
