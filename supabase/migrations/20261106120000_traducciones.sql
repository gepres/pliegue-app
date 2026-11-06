-- Traducciones guardadas en la nube (06.3).
--
-- Un bucket privado de Storage, «translations», con una carpeta por cuenta:
--   {user_id}/{clave del libro}/{idioma}.json
-- La clave del libro es la misma huella de `sync_items` (SHA-256 de nombre y tamaño del archivo):
-- el nombre del libro no aparece en la ruta.
--
-- Qué hay en la nube lo dice la colección «translation-files» de `sync_items` (tamaño, huella y
-- par de idiomas de cada archivo). Con eso la app comprueba el cupo de 200 MB por cuenta sin
-- listar el bucket. El tope de 5 MB por archivo lo pone también el bucket.
--
-- Solo viajan si la persona lo acepta en Ajustes → Cuenta: una traducción contiene el texto
-- entero del libro en otro idioma.
--
-- Se puede aplicar varias veces. Si el bucket ya existe (creado desde el panel), lo deja privado
-- y con los límites de aquí.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('translations', 'translations', false, 5242880, array['application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cada cuenta, solo su carpeta: el primer tramo de la ruta es su id. `anon` no tiene acceso.
-- Subir con «upsert» necesita leer, crear y cambiar; borrar queda para liberar cupo.

drop policy if exists "translations: leer lo propio" on storage.objects;
create policy "translations: leer lo propio" on storage.objects
  for select to authenticated
  using (bucket_id = 'translations' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "translations: crear lo propio" on storage.objects;
create policy "translations: crear lo propio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'translations' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "translations: cambiar lo propio" on storage.objects;
create policy "translations: cambiar lo propio" on storage.objects
  for update to authenticated
  using (bucket_id = 'translations' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'translations' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "translations: borrar lo propio" on storage.objects;
create policy "translations: borrar lo propio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'translations' and (storage.foldername(name))[1] = (select auth.uid())::text);
