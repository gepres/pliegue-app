-- Moderación de las bibliotecas compartidas.
--
-- El administrador de Pliegue ve quién creó cada biblioteca, recibe las denuncias de los
-- visitantes, avisa al dueño de un incumplimiento y, si hace falta, suspende su biblioteca. La
-- cuenta nunca se suspende: el dueño sigue entrando, con su biblioteca personal y sus alertas.
-- Las alertas viven solo dentro de Pliegue (`user_notices`); no se manda correo.

-- ---- Suspender una biblioteca ----------------------------------------------------------------

alter table public.shared_libraries
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_by uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shared_libraries_suspended_reason_length') then
    alter table public.shared_libraries
      add constraint shared_libraries_suspended_reason_length check (suspended_reason is null or char_length(suspended_reason) <= 1000);
  end if;
end;
$$;

-- Suspendida, su dueño no la borra (para abrir otra y esquivar la suspensión). El permiso de
-- update ya era solo sobre `name` y `active`: la suspensión no la puede tocar.
drop policy if exists "shared_libraries: borrar la propia" on public.shared_libraries;
create policy "shared_libraries: borrar la propia" on public.shared_libraries
  for delete to authenticated
  using ((select auth.uid()) = owner_id and suspended_at is null);

-- ---- Alertas dentro de Pliegue ---------------------------------------------------------------

create table if not exists public.user_notices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  library text,
  kind text not null,
  title text not null,
  body text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint user_notices_kind check (kind in ('aviso', 'incumplimiento', 'suspension', 'reactivacion', 'denuncia')),
  constraint user_notices_title_length check (char_length(title) between 1 and 160),
  constraint user_notices_body_length check (char_length(body) <= 2000)
);

comment on table public.user_notices is
  'Alertas para una cuenta: avisos y suspensiones de su biblioteca compartida o, al administrador, denuncias.';

create index if not exists user_notices_user_idx on public.user_notices (user_id, created_at desc);

alter table public.user_notices enable row level security;

drop policy if exists "user_notices: ver las propias" on public.user_notices;
create policy "user_notices: ver las propias" on public.user_notices
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_notices: marcar las propias" on public.user_notices;
create policy "user_notices: marcar las propias" on public.user_notices
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_notices from anon, authenticated;
grant select on public.user_notices to authenticated;
-- Solo marcarlas como leídas: ni el texto ni a quién van.
grant update (read_at) on public.user_notices to authenticated;

-- ---- Denuncias de los visitantes ---------------------------------------------------------------

create table if not exists public.library_reports (
  id bigint generated always as identity primary key,
  library text not null,
  file_id text,
  reason text not null,
  details text not null default '',
  code_id uuid references public.library_access_codes (id) on delete set null,
  -- Quién denunció, para el administrador: el dueño de la biblioteca no lo ve nunca.
  visitor_name text not null,
  device_id text not null,
  client_hash text not null,
  created_at timestamptz not null default now(),
  status text not null default 'nueva',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '',
  constraint library_reports_reason check (reason in ('derechos', 'inapropiado', 'engano', 'otro')),
  constraint library_reports_status check (status in ('nueva', 'revisada', 'descartada')),
  constraint library_reports_details_length check (char_length(details) <= 1000),
  constraint library_reports_note_length check (char_length(review_note) <= 1000),
  constraint library_reports_file_format check (file_id is null or file_id ~ '^[A-Za-z0-9_-]{10,200}$')
);

comment on table public.library_reports is
  'Denuncias de visitantes contra una biblioteca compartida o uno de sus libros. Solo las ve el administrador.';

create index if not exists library_reports_recent_idx on public.library_reports (created_at desc);
create index if not exists library_reports_device_idx on public.library_reports (library, device_id, created_at);

alter table public.library_reports enable row level security;

drop policy if exists "library_reports: administrar" on public.library_reports;
create policy "library_reports: administrar" on public.library_reports
  for select to authenticated
  using ((select public.is_pliegue_admin()));

revoke all on public.library_reports from anon, authenticated;
grant select on public.library_reports to authenticated;

-- ---- El administrador ----------------------------------------------------------------------------

-- Las bibliotecas compartidas con su dueño y sus totales. Los nombres de los visitantes no salen:
-- son del dueño.
create or replace function public.admin_shared_libraries()
returns table (
  slug text,
  name text,
  folder_id text,
  active boolean,
  suspended_at timestamptz,
  suspended_reason text,
  created_at timestamptz,
  owner_id uuid,
  owner_email text,
  owner_name text,
  owner_last_sign_in timestamptz,
  active_codes integer,
  entries integer,
  visitors integer,
  new_reports integer,
  reports integer,
  last_report_at timestamptz,
  notices integer,
  last_notice_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_pliegue_admin() then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  return query
  select
    l.slug,
    l.name,
    l.folder_id,
    l.active,
    l.suspended_at,
    l.suspended_reason,
    l.created_at,
    l.owner_id,
    u.email::text,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')::text,
    u.last_sign_in_at,
    (select count(*)::integer from public.library_access_codes c where c.library = l.slug and c.active),
    (select count(*)::integer from public.library_access_events e where e.library = l.slug),
    (select count(distinct e.device_id || '|' || lower(e.visitor_name))::integer from public.library_access_events e where e.library = l.slug),
    (select count(*)::integer from public.library_reports r where r.library = l.slug and r.status = 'nueva'),
    (select count(*)::integer from public.library_reports r where r.library = l.slug),
    (select max(r.created_at) from public.library_reports r where r.library = l.slug),
    (select count(*)::integer from public.user_notices n where n.library = l.slug and n.user_id = l.owner_id),
    (select max(n.created_at) from public.user_notices n where n.library = l.slug and n.user_id = l.owner_id)
  from public.shared_libraries l
  left join auth.users u on u.id = l.owner_id
  order by l.created_at desc;
end;
$$;

-- Avisar al dueño: le llega una alerta dentro de Pliegue.
create or replace function public.admin_notify_library(p_slug text, p_kind text, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not public.is_pliegue_admin() then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  if p_kind not in ('aviso', 'incumplimiento') then
    raise exception 'Tipo de aviso no válido.' using errcode = '22023';
  end if;
  select l.owner_id into v_owner from public.shared_libraries l where l.slug = p_slug;
  if v_owner is null then
    raise exception 'Esa biblioteca no existe.' using errcode = 'P0002';
  end if;
  insert into public.user_notices (user_id, library, kind, title, body, created_by)
  values (v_owner, p_slug, p_kind, left(trim(p_title), 160), left(trim(coalesce(p_body, '')), 2000), (select auth.uid()));
end;
$$;

-- Suspender: los visitantes quedan fuera y el dueño recibe el motivo. Reactivar lo deshace.
create or replace function public.admin_suspend_library(p_slug text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_reason text := left(trim(coalesce(p_reason, '')), 1000);
begin
  if not public.is_pliegue_admin() then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Hace falta el motivo.' using errcode = '22023';
  end if;
  update public.shared_libraries
  set suspended_at = now(), suspended_reason = v_reason, suspended_by = (select auth.uid())
  where slug = p_slug
  returning owner_id into v_owner;
  if v_owner is null then
    raise exception 'Esa biblioteca no existe.' using errcode = 'P0002';
  end if;
  insert into public.user_notices (user_id, library, kind, title, body, created_by)
  values (v_owner, p_slug, 'suspension', 'Tu biblioteca compartida está suspendida', v_reason, (select auth.uid()));
end;
$$;

create or replace function public.admin_reactivate_library(p_slug text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not public.is_pliegue_admin() then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  update public.shared_libraries
  set suspended_at = null, suspended_reason = null, suspended_by = null
  where slug = p_slug
  returning owner_id into v_owner;
  if v_owner is null then
    raise exception 'Esa biblioteca no existe.' using errcode = 'P0002';
  end if;
  insert into public.user_notices (user_id, library, kind, title, body, created_by)
  values (v_owner, p_slug, 'reactivacion', 'Tu biblioteca compartida vuelve a estar abierta', left(trim(coalesce(p_note, '')), 2000), (select auth.uid()));
end;
$$;

-- Revisar una denuncia: revisada o descartada, con una nota.
create or replace function public.admin_review_report(p_id bigint, p_status text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_pliegue_admin() then
    raise exception 'Solo para administradores.' using errcode = '42501';
  end if;
  if p_status not in ('nueva', 'revisada', 'descartada') then
    raise exception 'Estado no válido.' using errcode = '22023';
  end if;
  update public.library_reports
  set status = p_status,
      review_note = left(trim(coalesce(p_note, '')), 1000),
      reviewed_by = case when p_status = 'nueva' then null else (select auth.uid()) end,
      reviewed_at = case when p_status = 'nueva' then null else now() end
  where id = p_id;
end;
$$;

revoke all on function public.admin_shared_libraries() from public, anon;
revoke all on function public.admin_notify_library(text, text, text, text) from public, anon;
revoke all on function public.admin_suspend_library(text, text) from public, anon;
revoke all on function public.admin_reactivate_library(text, text) from public, anon;
revoke all on function public.admin_review_report(bigint, text, text) from public, anon;
grant execute on function public.admin_shared_libraries() to authenticated;
grant execute on function public.admin_notify_library(text, text, text, text) to authenticated;
grant execute on function public.admin_suspend_library(text, text) to authenticated;
grant execute on function public.admin_reactivate_library(text, text) to authenticated;
grant execute on function public.admin_review_report(bigint, text, text) to authenticated;

-- ---- Denunciar (solo el servidor, con la sesión del visitante ya comprobada) -----------------------

create or replace function public.submit_library_report(
  p_library text,
  p_file_id text,
  p_reason text,
  p_details text,
  p_code_id uuid,
  p_visitor_name text,
  p_device_id text,
  p_client_hash text
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_by_device integer;
  v_by_connection integer;
begin
  if not exists (select 1 from public.shared_libraries l where l.slug = p_library) then
    return query select false, 'invalid'::text;
    return;
  end if;
  -- Tres por equipo y biblioteca al día; diez por conexión al día, en todas.
  select count(*) into v_by_device from public.library_reports r
  where r.library = p_library and r.device_id = left(p_device_id, 64) and r.created_at > now() - interval '1 day';
  select count(*) into v_by_connection from public.library_reports r
  where r.client_hash = p_client_hash and r.created_at > now() - interval '1 day';
  if v_by_device >= 3 or v_by_connection >= 10 then
    return query select false, 'too-many'::text;
    return;
  end if;

  insert into public.library_reports (library, file_id, reason, details, code_id, visitor_name, device_id, client_hash)
  values (p_library, nullif(p_file_id, ''), p_reason, left(trim(coalesce(p_details, '')), 1000), p_code_id, left(trim(p_visitor_name), 60), left(p_device_id, 64), p_client_hash);

  -- A cada administrador, una alerta.
  insert into public.user_notices (user_id, library, kind, title, body)
  select a.user_id, p_library, 'denuncia', left('Nueva denuncia en /biblioteca/' || p_library, 160), left(trim(coalesce(p_details, '')), 2000)
  from public.pliegue_admins a;

  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.submit_library_report(text, text, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_library_report(text, text, text, text, uuid, text, text, text) to service_role;

-- ---- Canjear: una biblioteca suspendida está cerrada ------------------------------------------------

create or replace function public.redeem_library_code(
  p_code text,
  p_library text,
  p_visitor_name text,
  p_device_id text,
  p_user_agent text,
  p_client_hash text
)
returns table (ok boolean, reason text, code_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code public.library_access_codes;
  v_failures integer;
  v_name text := left(trim(p_visitor_name), 60);
  v_returning boolean;
  v_library_open boolean;
begin
  -- Lo viejo no sirve para nada: se limpia aquí mismo.
  delete from public.library_access_failures where created_at < now() - interval '1 day';

  select count(*) into v_failures
  from public.library_access_failures f
  where f.client_hash = p_client_hash and f.created_at > now() - interval '15 minutes';
  if v_failures >= 10 then
    return query select false, 'too-many'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if p_library <> 'general' then
    select l.active and l.suspended_at is null into v_library_open from public.shared_libraries l where l.slug = p_library;
    if not found then
      insert into public.library_access_failures (client_hash) values (p_client_hash);
      return query select false, 'invalid'::text, null::uuid, null::timestamptz;
      return;
    end if;
    if not v_library_open then
      return query select false, 'closed'::text, null::uuid, null::timestamptz;
      return;
    end if;
  end if;

  select * into v_code
  from public.library_access_codes c
  where c.code = upper(trim(p_code)) and c.library = p_library
  for update;

  if not found or not v_code.active then
    insert into public.library_access_failures (client_hash) values (p_client_hash);
    return query select false, 'invalid'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return query select false, 'expired'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- ¿Ya entró con este código, desde este equipo y con este nombre?
  select exists (
    select 1
    from public.library_access_events e
    where e.code_id = v_code.id
      and e.device_id = left(p_device_id, 64)
      and lower(e.visitor_name) = lower(v_name)
  ) into v_returning;

  if not v_returning then
    if v_code.max_uses is not null and v_code.uses >= v_code.max_uses then
      return query select false, 'exhausted'::text, null::uuid, null::timestamptz;
      return;
    end if;
    update public.library_access_codes set uses = uses + 1 where id = v_code.id;
  end if;

  insert into public.library_access_events (code_id, library, visitor_name, device_id, user_agent)
  values (v_code.id, p_library, v_name, left(p_device_id, 64), left(coalesce(p_user_agent, ''), 300));

  return query select true, 'ok'::text, v_code.id, v_code.expires_at;
end;
$$;

revoke all on function public.redeem_library_code(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_library_code(text, text, text, text, text, text) to service_role;
