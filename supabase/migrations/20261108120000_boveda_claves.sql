-- Bóveda de claves de IA en la cuenta (02.5).
--
-- Solo si la persona elige «En mi cuenta» para una clave. La clave se cifra EN EL NAVEGADOR con
-- una llave derivada de una frase que solo sabe ella (PBKDF2-SHA256 + AES-GCM): aquí llegan el
-- texto cifrado, su vector y los parámetros de la derivación (con la sal), nunca la clave ni la
-- frase. Ni Pliegue ni Supabase pueden descifrarla.
--
-- Es una tabla aparte, fuera de `sync_items`: los secretos no entran en la sincronización de
-- libros, notas y ajustes. Al borrar la cuenta, sus filas se borran con ella.

create table if not exists public.user_secrets (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- De quién es la clave: un proveedor de IA o un traductor con clave.
  provider text not null,
  -- AES-GCM, en base64: el texto cifrado con su etiqueta, y el vector de 12 bytes.
  ciphertext text not null,
  iv text not null,
  -- Cómo se deriva la llave de la frase: { name: "PBKDF2", hash: "SHA-256", iterations, salt }.
  kdf jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  constraint user_secrets_provider check (provider in ('anthropic', 'azure', 'deepl', 'gemini', 'libretranslate', 'openai')),
  -- Una clave cifrada ocupa unos cientos de caracteres: 4 KB dejan margen sin permitir abusos.
  constraint user_secrets_ciphertext_size check (char_length(ciphertext) between 16 and 4096),
  constraint user_secrets_iv_size check (char_length(iv) between 12 and 32),
  constraint user_secrets_kdf_size check (pg_column_size(kdf) <= 512)
);

comment on table public.user_secrets is
  'Claves de IA cifradas en el navegador con una frase de su dueño (02.5). Nunca en claro.';

-- Cada cuenta ve y cambia solo lo suyo.
alter table public.user_secrets enable row level security;

drop policy if exists "user_secrets: leer lo propio" on public.user_secrets;
create policy "user_secrets: leer lo propio" on public.user_secrets
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_secrets: crear lo propio" on public.user_secrets;
create policy "user_secrets: crear lo propio" on public.user_secrets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_secrets: cambiar lo propio" on public.user_secrets;
create policy "user_secrets: cambiar lo propio" on public.user_secrets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_secrets: borrar lo propio" on public.user_secrets;
create policy "user_secrets: borrar lo propio" on public.user_secrets
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.user_secrets from anon;
grant select, insert, update, delete on public.user_secrets to authenticated;
