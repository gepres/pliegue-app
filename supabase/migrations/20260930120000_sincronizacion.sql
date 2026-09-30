-- Sincronización de Pliegue entre dispositivos.
--
-- Un almacén por usuario de «elementos» agrupados por colección: favoritos, progreso de lectura,
-- marcas y notas, fichas del catálogo (IA e importadas), preferencias y ajustes. Cada elemento
-- es el estado actual de algo que la app ya guarda en el navegador, como JSON.
--
-- Es deliberadamente genérico: el modelo de dominio de `docs/data-model.md` sigue en borrador
-- (retención, Áreas, anclas) y esta tabla no lo prejuzga. Cuando ese modelo se cierre, sus
-- tablas se llenan desde aquí.
--
-- Nunca llegan aquí: los archivos, su texto extraído, las claves de IA ni los permisos de acceso
-- a archivos y carpetas del dispositivo.

create table if not exists public.sync_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null,
  item_key text not null,
  -- En un borrado, solo lo necesario para saber a qué documento pertenecía (o null).
  payload jsonb,
  deleted boolean not null default false,
  -- Hora del cambio en el dispositivo: decide qué escritura gana.
  updated_at timestamptz not null,
  device_id text not null,
  -- Hora del servidor: el cursor con el que cada dispositivo descarga lo nuevo, sin depender
  -- del reloj de ninguno.
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, collection, item_key),
  constraint sync_items_collection_format check (collection ~ '^[a-z][a-z0-9-]{1,39}$'),
  constraint sync_items_key_length check (char_length(item_key) between 1 and 512),
  constraint sync_items_device_length check (char_length(device_id) between 1 and 64),
  -- Una ficha importada con su portada ronda los 400 KB; 1 MB deja margen sin permitir abusos.
  constraint sync_items_payload_size check (payload is null or pg_column_size(payload) <= 1048576)
);

comment on table public.sync_items is
  'Estado de Pliegue sincronizado entre dispositivos: un elemento por usuario, colección y clave.';

create index if not exists sync_items_pull_idx on public.sync_items (user_id, server_updated_at);

-- La última escritura gana. Un cambio más antiguo que el guardado —un dispositivo que estuvo
-- sin conexión y sube tarde— se descarta en lugar de pisar uno más reciente. El servidor pone
-- su propia hora en cada escritura.
create or replace function public.sync_items_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists sync_items_before_write on public.sync_items;
create trigger sync_items_before_write
  before insert or update on public.sync_items
  for each row execute function public.sync_items_before_write();

-- Cada cuenta ve y cambia solo lo suyo.
alter table public.sync_items enable row level security;

drop policy if exists "sync_items: leer lo propio" on public.sync_items;
create policy "sync_items: leer lo propio" on public.sync_items
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "sync_items: crear lo propio" on public.sync_items;
create policy "sync_items: crear lo propio" on public.sync_items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "sync_items: cambiar lo propio" on public.sync_items;
create policy "sync_items: cambiar lo propio" on public.sync_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "sync_items: borrar lo propio" on public.sync_items;
create policy "sync_items: borrar lo propio" on public.sync_items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.sync_items from anon;
grant select, insert, update, delete on public.sync_items to authenticated;
