-- Biblioteca general de Pliegue: acceso por código, sin cuenta.
--
-- El dueño genera códigos (p. ej. OCT2026AREQUIPA) y los comparte. Quien entra en
-- /biblioteca/general escribe el código y su nombre; el servidor de Pliegue lo valida aquí con
-- la clave de servicio y le da una sesión firmada. Cada entrada queda registrada para el panel
-- de administración.
--
-- Nada de esto es legible ni escribible desde el navegador sin sesión: los códigos y las
-- entradas solo los ve un administrador, y canjear un código solo lo puede hacer el servidor.

create table if not exists public.pliegue_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.pliegue_admins is
  'Cuentas que administran la biblioteca general. Se añaden a mano desde el SQL Editor.';

-- ¿La sesión actual es de un administrador? `security definer` para no exponer la tabla.
create or replace function public.is_pliegue_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pliegue_admins where user_id = (select auth.uid()));
$$;

revoke all on function public.is_pliegue_admin() from public;
grant execute on function public.is_pliegue_admin() to authenticated;

create table if not exists public.library_access_codes (
  id uuid primary key default gen_random_uuid(),
  library text not null default 'general',
  -- Siempre en mayúsculas: el canje compara con `upper(trim(…))`.
  code text not null unique,
  label text not null default '',
  active boolean not null default true,
  expires_at timestamptz,
  max_uses integer,
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint library_access_codes_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{3,39}$'),
  constraint library_access_codes_library_format check (library ~ '^[a-z][a-z0-9-]{1,39}$'),
  constraint library_access_codes_label_length check (char_length(label) <= 120),
  constraint library_access_codes_max_uses check (max_uses is null or max_uses > 0)
);

comment on table public.library_access_codes is
  'Códigos de acceso a la biblioteca general, generados por un administrador.';

create table if not exists public.library_access_events (
  id bigint generated always as identity primary key,
  code_id uuid not null references public.library_access_codes (id) on delete cascade,
  library text not null,
  visitor_name text not null,
  -- Un identificador aleatorio que el navegador del visitante guarda: distingue equipos sin
  -- saber quién es nadie.
  device_id text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  constraint library_access_events_name_length check (char_length(visitor_name) between 1 and 60),
  constraint library_access_events_device_length check (char_length(device_id) between 1 and 64),
  constraint library_access_events_agent_length check (char_length(user_agent) <= 300)
);

comment on table public.library_access_events is
  'Cada entrada a la biblioteca general con un código: quién dijo ser, desde qué equipo y cuándo.';

create index if not exists library_access_events_code_idx on public.library_access_events (code_id, created_at desc);
create index if not exists library_access_events_recent_idx on public.library_access_events (created_at desc);

-- Intentos fallidos, para frenar a quien prueba códigos a ciegas. El servidor manda una huella
-- de la conexión (no la IP).
create table if not exists public.library_access_failures (
  id bigint generated always as identity primary key,
  client_hash text not null,
  created_at timestamptz not null default now(),
  constraint library_access_failures_hash_length check (char_length(client_hash) between 1 and 128)
);

create index if not exists library_access_failures_client_idx on public.library_access_failures (client_hash, created_at);

-- ---- Permisos --------------------------------------------------------------------------

alter table public.pliegue_admins enable row level security;
alter table public.library_access_codes enable row level security;
alter table public.library_access_events enable row level security;
alter table public.library_access_failures enable row level security;

-- Cada cuenta puede saber si ella misma es administradora (la app lo usa para mostrar el panel).
drop policy if exists "pliegue_admins: verse a sí mismo" on public.pliegue_admins;
create policy "pliegue_admins: verse a sí mismo" on public.pliegue_admins
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "library_access_codes: administrar" on public.library_access_codes;
create policy "library_access_codes: administrar" on public.library_access_codes
  for all to authenticated
  using ((select public.is_pliegue_admin()))
  with check ((select public.is_pliegue_admin()));

drop policy if exists "library_access_events: leer" on public.library_access_events;
create policy "library_access_events: leer" on public.library_access_events
  for select to authenticated
  using ((select public.is_pliegue_admin()));

drop policy if exists "library_access_events: borrar" on public.library_access_events;
create policy "library_access_events: borrar" on public.library_access_events
  for delete to authenticated
  using ((select public.is_pliegue_admin()));

revoke all on public.pliegue_admins, public.library_access_codes, public.library_access_events, public.library_access_failures from anon;
revoke all on public.library_access_failures from authenticated;
grant select on public.pliegue_admins to authenticated;
grant select, insert, update, delete on public.library_access_codes to authenticated;
grant select, delete on public.library_access_events to authenticated;

-- ---- Canjear un código (solo el servidor, con la clave de servicio) ---------------------

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
  if v_code.max_uses is not null and v_code.uses >= v_code.max_uses then
    return query select false, 'exhausted'::text, null::uuid, null::timestamptz;
    return;
  end if;

  update public.library_access_codes set uses = uses + 1 where id = v_code.id;
  insert into public.library_access_events (code_id, library, visitor_name, device_id, user_agent)
  values (v_code.id, p_library, left(trim(p_visitor_name), 60), left(p_device_id, 64), left(coalesce(p_user_agent, ''), 300));

  return query select true, 'ok'::text, v_code.id, v_code.expires_at;
end;
$$;

revoke all on function public.redeem_library_code(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_library_code(text, text, text, text, text, text) to service_role;

-- Para registrarte como administrador, en el SQL Editor y con tu correo:
--   insert into public.pliegue_admins (user_id)
--   select id from auth.users where email = 'tu-correo@ejemplo.com';
