# Cuenta y sincronización

- Estado: primera versión (web)
- Foundry: `02.4 · Cuenta, recuperación y modo local-only` y `06.3 · Sincronización offline y conflictos`
- Base: ADR-0002 (Supabase en `sa-east-1`, gates 3, 4 y 5)

## Contrato visible

La cuenta es **opcional**. Sin ella, Pliegue funciona como siempre: todo en este dispositivo.
Con ella, lo que la persona acepta viaja entre sus equipos:

| Colección | Qué es | Política si cambian dos equipos |
| --- | --- | --- |
| `favorites` | libros marcados | último cambio |
| `reading-progress` | porcentaje leído | gana el avance mayor |
| `annotations` | resaltados, notas y recortes | último cambio por marca |
| `catalog-ai` | fichas de la IA (**solo con consentimiento**) | último análisis |
| `catalog-import` | fichas importadas desde JSON | última importación |
| `book-translation` | idiomas y motor de cada libro | último cambio |
| `translation-files` | índice de las traducciones guardadas en Storage (**solo con consentimiento**) | último cambio; el texto se junta (ver abajo) |
| `settings` | IA (sin la URL de Ollama), preferencias salvo las del dispositivo, vista del lector, postales | un equipo nuevo adopta los de la cuenta; después, último cambio |

**Nunca se suben:** los archivos, su texto extraído, las claves de IA (ADR-0002, gate 3), los
permisos de acceso a archivos y carpetas ni lo que es de cada equipo (vista de la Biblioteca,
barra lateral, forma de la vista de traducción). Las traducciones guardadas van aparte, a
Storage, y solo con su permiso (abajo).

## Traducciones guardadas (Storage)

Una traducción es el libro entero en otro idioma, así que va con **permiso propio, apagado de
entrada** («Traducciones guardadas» en Ajustes → Cuenta). Encenderlo siempre pregunta, se esté
sincronizando o no. Decisión del 6-nov en Foundry (06.3).

- **Dónde:** bucket privado `translations`, un JSON por libro y traducción:
  `{user_id}/{clave del libro}/{idioma}.{par}.json`. La clave es la huella de `sync_items`;
  `{par}` es una huella corta de motor y par de idiomas, para que dos motores no se pisen.
  RLS: cada cuenta solo lee y escribe su carpeta (`supabase/migrations/20261106120000_traducciones.sql`).
- **Índice:** la colección `translation-files` de `sync_items` dice qué archivos hay (tamaño,
  huella y par). Viaja con la misma fusión que el resto; no va ligada a un documento, así que
  llega entera aunque el libro no esté en el equipo.
- **Topes:** 5 MB por archivo (también en el bucket) y 200 MB por cuenta, que la app suma con
  el índice. Lo que no cabe no sube, y Cuenta lo dice.
- **Cuándo sube:** cuando la traducción lleva 2 minutos sin cambiar (no mientras se traduce).
  En la primera vuelta de la sesión se revisan todas; después, solo las escritas aquí.
- **Cuándo baja:** en cada vuelta, lo que el índice tiene más nuevo de los libros que hay aquí.
- **Cómo se junta:** una página que este equipo ya tiene traducida se conserva; las que faltan se
  añaden. Se vuelve a subir solo si aquí hay páginas que la nube no tiene o algo traducido
  después de la última subida; si no, dos equipos con una página distinta se pisarían en cada
  vuelta.
- **Borrar:** borrar las traducciones de este navegador no toca la nube. «Borrar mi cuenta»
  vacía antes la carpeta del bucket (`account-server.ts`); si no puede, no borra la cuenta.
- **Código:** `app/cloud/sync/translation-files.ts` (con sus pruebas) y
  `supabaseTranslationStorage` en `supabase-remote.ts`. e2e: `apps/web/e2e/traducciones-nube.mjs`,
  con dos equipos.

## Identidad de un documento entre equipos

Cada equipo da a sus documentos un identificador al azar. Lo que coincide entre equipos es el
archivo: `nombre + tamaño en bytes` (no la fecha, que cambia al copiar). A la nube va el
SHA-256 de esa identidad, no el nombre. Un favorito, una nota o una ficha de un libro que otro
equipo no tiene se guarda aparte y se aplica cuando ese libro aparezca; su ausencia nunca se
toma por un borrado.

## Libros que están en otro equipo

Ajustes → Cuenta, en «En tus otros equipos», cuenta los libros con avance, notas, favorito o
ficha en la cuenta que no están en este equipo. No se sube nada nuevo para eso:

- Se **nombran** (título y autores, en orden alfabético) los que tienen ficha de la IA
  sincronizada, y solo si en este equipo se aceptaron las fichas. Hasta 12; el resto se cuenta.
- Los demás solo se **cuentan**: de ellos la nube guarda la huella del archivo, no su nombre.
- Sale de la última vuelta (`SyncSummary.elsewhere`, en `sync-runner.ts`): lo pendiente de cada
  colección cuyo libro no está aquí. La ficha la lee `describe` de la colección `catalog-ai`.

## Cómo sincroniza

Cada almacén guarda su estado actual, no un registro de cambios, así que el motor hace una
**fusión a tres vías** por colección (`app/cloud/sync/sync-merge.ts`):

1. **Base:** lo que había tras la última sincronización con esa cuenta, en IndexedDB
   (`pliegue-sync`), sin cargas; solo las huellas.
2. **Local:** lo que hay ahora en los almacenes de este equipo, ya cargados.
3. **Remoto:** lo descargado desde el último cursor, más lo pendiente.

Lo que cambió solo aquí se sube, lo que cambió solo fuera se aplica, y si cambiaron los dos
decide la política de la tabla. Lo que gana aquí sube con una hora posterior a la remota,
aunque el reloj de este equipo vaya atrasado.

**Cuándo:** al activar la sincronización, 3 s después de cada cambio, cada 45 s con la ventana
a la vista, al volver a ella y al recuperar la conexión. Cumple el SLO de 60 s del gate 5.

## Base de datos

Una tabla, `public.sync_items` (`supabase/migrations/20260930120000_sincronizacion.sql`):
`(user_id, collection, item_key)` como clave, `payload jsonb`, `deleted`, `updated_at` (hora
del cambio en el dispositivo) y `server_updated_at` (hora del servidor, que es el cursor).

- Es genérica a propósito. El modelo de dominio de `data-model.md` sigue en borrador y esta
  tabla no lo prejuzga; cuando se cierre, sus tablas se llenan desde aquí.
- Un disparador descarta una escritura más antigua que la guardada y pone la hora del servidor.
- RLS: cada cuenta ve y cambia solo lo suyo. `anon` no tiene acceso.
- La descarga pide 2 minutos de margen hacia atrás del cursor: una escritura puede confirmarse
  después de que otro equipo haya leído. La fusión ignora lo repetido.

## Entrar

- **Código por correo** (`signInWithOtp` + `verifyOtp`). Se usa el código y no solo el enlace,
  porque una app instalada abre los enlaces en el navegador, fuera de su ventana.
- **Google** (`signInWithOAuth`, flujo PKCE). Antes de salir se comprueba en
  `/auth/v1/settings` que el proveedor esté activo, para no acabar en una página de error.
- «Cerrar sesión» cierra solo este equipo (`scope: "local"`) y deja los datos locales.
- Si Supabase devuelve a otra página (la Site URL), `cloud/auth-return.tsx` lleva a Ajustes →
  Cuenta con sus parámetros. Un enlace caducado o abierto en otro navegador se explica allí.

## Configurar un proyecto de Supabase

1. **Variables** en `apps/web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (la `sb_publishable_…`; la `service_role` nunca).
2. **Migración:** SQL Editor → pegar cada archivo de `supabase/migrations/`, en orden → Run.
   El de traducciones (`20261106120000_traducciones.sql`) crea o ajusta el bucket
   `translations` y sus políticas.
3. **Correo.** El servidor de correo incluido en Supabase solo envía a direcciones del equipo de
   la organización y 2 mensajes por hora: sirve para probar. Su plantilla trae un **enlace**,
   que la app también acepta: hay que abrirlo en el mismo navegador donde se pidió, porque el
   flujo PKCE guarda allí su verificador. Para usuarios reales, SMTP propio (paso 6) y, en
   «Magic Link» y «Confirm signup», el código: `Tu código de Pliegue: {{ .Token }}`.
4. **URLs** (Authentication → URL Configuration): Site URL con la dirección de la app y, en
   Redirect URLs, `http://localhost:3000/**` y la de producción.
5. **Google** (Authentication → Providers → Google): crear en Google Cloud un cliente OAuth
   de tipo «Aplicación web» con la URI de redirección
   `https://<proyecto>.supabase.co/auth/v1/callback` y pegar su Client ID y su secreto.
6. **SMTP propio** (Authentication → Emails → SMTP Settings). Sin dominio: Gmail con una
   contraseña de aplicación (`smtp.gmail.com`, puerto 465). Con dominio: Resend
   (`smtp.resend.com`, 465, usuario `resend`, contraseña la API key) o Brevo
   (`smtp-relay.brevo.com`, 587).

## Pruebas

- `app/cloud/sync/sync-merge.test.ts`: la fusión, caso a caso.
- `app/cloud/sync/sync-runner.test.ts`: dos equipos contra una nube en memoria. Un favorito
  viaja por el archivo aunque cambie el identificador, y un equipo sin el libro no lo borra.
- La migración se validó en Postgres (PGlite) con un esquema `auth` simulado: se aplica dos
  veces, gana la última escritura, el cursor avanza y RLS aísla por usuario.
