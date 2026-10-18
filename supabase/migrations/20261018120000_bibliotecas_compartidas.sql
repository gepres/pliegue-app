-- Bibliotecas compartidas: cada cuenta puede publicar la suya, como la general.
--
-- La biblioteca general sigue igual (`library = 'general'`, su carpeta en una variable del
-- servidor y la administra quien está en `pliegue_admins`). Además, cada cuenta puede tener
-- una biblioteca propia con su carpeta pública de Drive, en /biblioteca/<slug>, con sus
-- códigos y su registro de entradas. Las tablas de códigos y entradas ya llevaban la columna
-- `library`: aquí se añade de quién es cada biblioteca y se reparte el permiso por dueño.
--
-- El alta no se hace desde el navegador: la hace el servidor de Pliegue con la clave secreta,
-- después de comprobar que la carpeta es del usuario y que es pública.

create table if not exists public.shared_libraries (
  id uuid primary key default gen_random_uuid(),
  -- La dirección: /biblioteca/<slug>. No cambia una vez creada.
  slug text not null unique,
  -- Una biblioteca por cuenta.
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  folder_id text not null,
  name text not null,
  -- El dueño la pausa y la reanuda.
  active boolean not null default true,
  -- Cuándo comprobó el servidor por última vez que la carpeta es suya y pública.
  verified_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_libraries_slug_format check (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and char_length(slug) between 2 and 40),
  -- Las mismas que `reservedLibrarySlugs` en apps/web/app/library-access/library-slug.ts.
  constraint shared_libraries_slug_reserved check (
    slug <> all (array['admin', 'ajustes', 'api', 'app', 'biblioteca', 'denuncia', 'general', 'leer', 'moderacion', 'nueva', 'pliegue'])
  ),
  constraint shared_libraries_folder_format check (folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  constraint shared_libraries_name_length check (char_length(trim(name)) between 1 and 80),
  constraint shared_libraries_terms_length check (terms_version is null or char_length(terms_version) <= 40)
);

comment on table public.shared_libraries is
  'Bibliotecas compartidas de cada cuenta: su carpeta pública de Drive en /biblioteca/<slug>. Las crea el servidor.';

create or replace function public.shared_libraries_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shared_libraries_touch on public.shared_libraries;
create trigger shared_libraries_touch
  before update on public.shared_libraries
  for each row execute function public.shared_libraries_touch();

-- Borrar una biblioteca se lleva sus códigos y, con ellos, su registro de entradas.
create or replace function public.shared_libraries_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.library_access_codes where library = old.slug;
  return old;
end;
$$;

drop trigger if exists shared_libraries_cleanup on public.shared_libraries;
create trigger shared_libraries_cleanup
  after delete on public.shared_libraries
  for each row execute function public.shared_libraries_cleanup();

-- ---- Un código es único dentro de su biblioteca, no en toda la base ----------------------
--
-- Así dos bibliotecas pueden tener cada una su OCT26, y crear uno no revela los de otra.

alter table public.library_access_codes drop constraint if exists library_access_codes_code_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'library_access_codes_library_code_key') then
    alter table public.library_access_codes
      add constraint library_access_codes_library_code_key unique (library, code);
  end if;
end;
$$;

-- ---- Permisos ----------------------------------------------------------------------------

-- ¿Puede la sesión actual administrar esta biblioteca? La general, quien está en
-- `pliegue_admins`; una compartida, su dueño. `security definer` para no exponer las tablas.
create or replace function public.can_manage_library(p_library text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_library = 'general' then public.is_pliegue_admin()
    else exists (
      select 1 from public.shared_libraries l
      where l.slug = p_library and l.owner_id = (select auth.uid())
    )
  end;
$$;

revoke all on function public.can_manage_library(text) from public;
grant execute on function public.can_manage_library(text) to authenticated;

alter table public.shared_libraries enable row level security;

drop policy if exists "shared_libraries: ver la propia" on public.shared_libraries;
create policy "shared_libraries: ver la propia" on public.shared_libraries
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "shared_libraries: cambiar la propia" on public.shared_libraries;
create policy "shared_libraries: cambiar la propia" on public.shared_libraries
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "shared_libraries: borrar la propia" on public.shared_libraries;
create policy "shared_libraries: borrar la propia" on public.shared_libraries
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.shared_libraries from anon, authenticated;
grant select, delete on public.shared_libraries to authenticated;
-- El dueño solo cambia el nombre y si está activa: ni la dirección ni la carpeta.
grant update (name, active) on public.shared_libraries to authenticated;

-- Códigos y entradas: cada quien los de su biblioteca. Antes, el administrador veía todos;
-- ahora solo los de la general.
drop policy if exists "library_access_codes: administrar" on public.library_access_codes;
create policy "library_access_codes: administrar" on public.library_access_codes
  for all to authenticated
  using (public.can_manage_library(library))
  with check (public.can_manage_library(library));

drop policy if exists "library_access_events: leer" on public.library_access_events;
create policy "library_access_events: leer" on public.library_access_events
  for select to authenticated
  using (public.can_manage_library(library));

drop policy if exists "library_access_events: borrar" on public.library_access_events;
create policy "library_access_events: borrar" on public.library_access_events
  for delete to authenticated
  using (public.can_manage_library(library));

-- ---- Canjear un código: también en una biblioteca compartida -----------------------------
--
-- Igual que antes (las vueltas no gastan uso), y además: si la biblioteca no es la general,
-- tiene que existir (si no, cuenta como intento fallido) y estar activa (si no, `closed`).

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
  v_library_active boolean;
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
    select l.active into v_library_active from public.shared_libraries l where l.slug = p_library;
    if not found then
      insert into public.library_access_failures (client_hash) values (p_client_hash);
      return query select false, 'invalid'::text, null::uuid, null::timestamptz;
      return;
    end if;
    if not v_library_active then
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
