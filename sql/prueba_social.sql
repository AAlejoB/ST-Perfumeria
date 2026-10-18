-- ============================================================
-- [PRUEBA-SOCIAL] · [NUBES-CATALOGO] tanda 4 · 18-oct-2026 (Alejo: «hacé TODAS»)
--
-- La prueba social del catálogo, SÓLO con datos reales (regla b de las nubes: nunca un número inventado).
--
-- 1. prueba_social(p_session) — una sola lectura por carga del catálogo, para anon. Devuelve:
--    · vistas    (19) {slug: n} personas distintas (session_id) que abrieron la ficha HOY (día de Argentina), sin contar la
--                     sesión que pregunta (p_session) ni las visitas raras (más de 80 fichas en el día, como holmes_metricas).
--                     Sólo los perfumes con 3 o más.
--    · volvieron (21) [slug] los que volvieron a tener stock en el local en los últimos 7 días después de estar 3 días o más
--                     en 0, y no volvieron a 0 después. Sale del Log del panel (admin_actions, stock_update con old / new):
--                     un perfume sin un «quedó en 0» anotado en el último año no cuenta (no se sabe desde cuándo no había).
--                     Como mucho 8, los más recientes primero.
--    · salidas   (20) {slug: minutos} la última baja del local de las últimas 48 h que parece una venta. Resguardos (decisión
--                     de Alejo: «a veces hacemos pruebas o bajan sin querer»):
--                       - baja de 1 o 2 (una corrección de inventario baja más);
--                       - pasaron 20 minutos o más (tiempo de arrepentirse);
--                       - nadie la deshizo: no hubo una SUBIDA del local 30 min antes ni 30 min después
--                         («bajé 1 y lo volví a subir» y «subí 1 sin querer y lo bajé» no cuentan);
--                       - no fue un pase al depósito: no subió el depósito 5 min antes ni después.
--    La función no devuelve nombres, montos, quién ni el stock: sólo slugs y números.
--
-- 2. resenas (23) — las reseñas que cargan el jefe y las chicas desde el panel (de WhatsApp, Instagram, TikTok, Google o del
--    local), con la FECHA del comentario original editable (pedido de Alejo: «entre a videos/reels con comentarios buena onda»).
--    · anon lee sólo las prendidas (activa) y sin creado_por.
--    · las dos cuentas del panel leen, cargan, editan y prenden / apagan; borra sólo el jefe.
--    · Va en las dos listas de backups (NO ROMPER #23).
--
-- Aplicada el 18-oct-2026 por Claude Code con el MCP de Supabase (OK de Alejo: «hacé TODAS»).
-- ============================================================

create or replace function public.prueba_social(p_session text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with hoy as (
    select (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires') as desde
  ),
  fichas as (
    select a.session_id, a.slug
      from public.analytics_events a, hoy
     where a.event_type = 'ficha_abierta'
       and a.created_at >= hoy.desde
       and a.slug is not null
       and a.session_id::text is distinct from p_session
  ),
  raras as (
    select session_id from fichas group by session_id having count(distinct slug) > 80
  ),
  vistas as (
    select slug, count(distinct session_id)::int as n
      from fichas
     where session_id not in (select session_id from raras)
     group by slug
    having count(distinct session_id) >= 3
  ),
  ev as (
    select target_slug as slug, created_at as t,
           case when (changes -> 'stock_qty' ->> 'old') ~ '^-?\d+$' then (changes -> 'stock_qty' ->> 'old')::int end as o,
           (changes -> 'stock_qty' ->> 'new')::int as n
      from public.admin_actions
     where action = 'stock_update'
       and created_at > now() - interval '365 days'
       and target_slug is not null
       and (changes -> 'stock_qty' ->> 'new') ~ '^-?\d+$'
  ),
  dep as (
    select target_slug as slug, created_at as t
      from public.admin_actions
     where action = 'deposito_update'
       and created_at > now() - interval '3 days'
       and (changes -> 'stock_deposito' ->> 'new') ~ '^-?\d+$'
       and (changes -> 'stock_deposito' ->> 'old') ~ '^-?\d+$'
       and (changes -> 'stock_deposito' ->> 'new')::int > (changes -> 'stock_deposito' ->> 'old')::int
  ),
  subida as (
    select distinct on (slug) slug, t
      from ev
     where coalesce(o, 0) = 0 and n > 0 and t > now() - interval '7 days'
     order by slug, t desc
  ),
  volvieron as (
    select s.slug, s.t
      from subida s
     where not exists (select 1 from ev e where e.slug = s.slug and e.t > s.t and e.n = 0)
       and (select max(z.t) from ev z where z.slug = s.slug and z.t < s.t and z.n = 0) <= s.t - interval '3 days'
     order by s.t desc
     limit 8
  ),
  bajas as (
    select distinct on (b.slug) b.slug, b.t
      from ev b
     where b.o is not null
       and b.o - b.n between 1 and 2
       and b.t > now() - interval '48 hours'
       and b.t <= now() - interval '20 minutes'
       and not exists (select 1 from ev u where u.slug = b.slug and u.o is not null and u.n > u.o
                         and u.t between b.t - interval '30 minutes' and b.t + interval '30 minutes')
       and not exists (select 1 from dep d where d.slug = b.slug and d.t between b.t - interval '5 minutes' and b.t + interval '5 minutes')
     order by b.slug, b.t desc
  )
  select jsonb_build_object(
    'vistas',    coalesce((select jsonb_object_agg(slug, n) from vistas), '{}'::jsonb),
    'volvieron', coalesce((select jsonb_agg(slug order by t desc) from volvieron), '[]'::jsonb),
    'salidas',   coalesce((select jsonb_object_agg(slug, floor(extract(epoch from now() - t) / 60)::int) from bajas), '{}'::jsonb)
  );
$$;
revoke all on function public.prueba_social(text) from public;
grant execute on function public.prueba_social(text) to anon, authenticated;

create table if not exists public.resenas (
  id         uuid primary key default gen_random_uuid(),
  texto      text not null check (char_length(btrim(texto)) between 5 and 280),
  nombre     text check (nombre is null or char_length(btrim(nombre)) between 1 and 40),
  fuente     text not null default 'otra' check (fuente in ('whatsapp', 'instagram', 'tiktok', 'google', 'local', 'otra')),
  slug       text check (slug is null or char_length(slug) between 1 and 120),
  fecha      date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  activa     boolean not null default true,
  creado_por text not null default coalesce(auth.jwt() ->> 'email', 'alejo'),
  creado_en  timestamptz not null default now()
);
alter table public.resenas enable row level security;
revoke all on public.resenas from anon, authenticated;
grant select (id, texto, nombre, fuente, slug, fecha, activa) on public.resenas to anon;
grant select on public.resenas to authenticated;
grant insert (texto, nombre, fuente, slug, fecha, activa) on public.resenas to authenticated;
grant update (texto, nombre, fuente, slug, fecha, activa) on public.resenas to authenticated;
grant delete on public.resenas to authenticated;

drop policy if exists resenas_select_anon on public.resenas;
create policy resenas_select_anon on public.resenas for select to anon using (activa);
drop policy if exists resenas_select_staff on public.resenas;
create policy resenas_select_staff on public.resenas for select to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));
drop policy if exists resenas_insert_staff on public.resenas;
create policy resenas_insert_staff on public.resenas for insert to authenticated
  with check ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));
drop policy if exists resenas_update_staff on public.resenas;
create policy resenas_update_staff on public.resenas for update to authenticated
  using ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']))
  with check ((auth.jwt() ->> 'email') = any (array['jefe@stperfumeria.local', 'empleado@stperfumeria.local']));
drop policy if exists resenas_delete_jefe on public.resenas;
create policy resenas_delete_jefe on public.resenas for delete to authenticated using (public.is_jefe());
