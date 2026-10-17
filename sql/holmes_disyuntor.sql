-- ============================================================================
-- [DISYUNTOR-EVENTOS] que nadie pueda ensuciar los números ni engordar la tabla (17-oct-2026, Alejo eligió A + B y estirar los 60 días)
-- ============================================================================
-- Va DESPUÉS de sql/holmes.sql y sql/holmes_wa_intento.sql. La pregunta de Alejo: «¿qué pasa si me tocan Consultar 20 veces por
-- perfume o me hacen un ataque?». La página no se cae (los eventos van aparte, sin esperar respuesta, y nada de la tienda lee esta
-- tabla), pero con la clave pública cualquiera podía mandar eventos falsos y ensuciar Holmes y el Laboratorio.
--
-- A · El disyuntor en la puerta (trigger `analytics_events_disyuntor`, BEFORE INSERT). Una fila que no pasa se DESCARTA EN SILENCIO
--     (el trigger devuelve NULL): sin error, así un lote con eventos buenos no rebota entero y el que ataca no se entera.
--     · más de 60 eventos en el último minuto desde el mismo aparato (`session_id`): una persona real no llega ni cerca;
--     · más de 1500 eventos en el último minuto entre todos (hoy entran ~300 por DÍA): frena un ataque repartido en miles de
--       aparatos inventados; si pasara, se pierden analíticas de ese minuto, nunca la tienda;
--     · filas gordas: `meta` de más de 2 KB, `query` de más de 200 letras o `slug` de más de 120.
--     La función es security definer: tiene que contar filas que `anon` no puede leer.
-- B · Holmes descarta las visitas que no parecen de una persona (`holmes_metricas`): más de 300 eventos en el día, fichas de más de
--     80 perfumes distintos, o WhatsApp de más de 8 perfumes distintos fuera del pedido y del pack de decants (esos mandan uno por
--     perfume). No entran en ninguna cuenta y se muestran aparte: `total.descartadas`.
-- C · El borrado automático (`analytics_events_cleanup`, lo corre el panel una vez por sesión) pasa de 60 a 400 días: con 60, el
--     «1 año» del Laboratorio y de Holmes mostraba 60 días como máximo. Medido el 17-oct: 7.733 filas pesan 2,4 MB.
-- ============================================================================

-- ─── A. el disyuntor ─────────────────────────────────────────────────────────
create index if not exists analytics_events_sesion_idx on public.analytics_events (session_id, created_at desc);

create or replace function public.analytics_events_disyuntor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_column_size(new.meta) > 2048
     or char_length(coalesce(new.query, '')) > 200
     or char_length(coalesce(new.slug, '')) > 120 then
    return null;
  end if;
  if new.session_id is not null and (
       select count(*) from public.analytics_events
       where session_id = new.session_id and created_at > now() - interval '1 minute') >= 60 then
    return null;
  end if;
  if (select count(*) from public.analytics_events where created_at > now() - interval '1 minute') >= 1500 then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.analytics_events_disyuntor() from public, anon, authenticated;

drop trigger if exists analytics_events_disyuntor on public.analytics_events;
create trigger analytics_events_disyuntor before insert on public.analytics_events
  for each row execute function public.analytics_events_disyuntor();

-- ─── C. guardar 400 días ─────────────────────────────────────────────────────
create or replace function public.analytics_events_cleanup() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.analytics_events where created_at < now() - interval '400 days';
end;
$$;

-- ─── B. Holmes descarta lo raro ──────────────────────────────────────────────
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
  vis0 as (           -- una fila por visita; `llego` sólo con la llegada nueva (meta.holmes = 2)
    select session_id, dia,
           bool_or(event_type = 'llegada' and meta ->> 'holmes' = '2') as llego,
           bool_or(event_type = 'ficha_abierta')                       as ficha,
           bool_or(event_type = 'wa_intento')                          as wa,
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
    'origenes', (select coalesce(jsonb_agg(jsonb_build_object('origen', origen, 'visitas', n) order by n desc, origen), '[]'::jsonb) from og)
  ) into r;

  return r;
end $$;
revoke all on function public.holmes_metricas(int) from public, anon;
grant execute on function public.holmes_metricas(int) to authenticated;

-- ============================================================================
-- DESHACER (en este orden):
--   drop trigger if exists analytics_events_disyuntor on public.analytics_events;
--   drop function if exists public.analytics_events_disyuntor();
--   drop index if exists public.analytics_events_sesion_idx;
--   -- el borrado de antes (60 días):
--   create or replace function public.analytics_events_cleanup() returns void
--   language plpgsql security definer set search_path = public as $$
--   begin delete from public.analytics_events where created_at < now() - interval '60 days'; end; $$;
--   -- holmes_metricas sin descartar: correr de nuevo la función de sql/holmes_wa_intento.sql
-- ============================================================================
