# Biblioteca general

`/biblioteca/general` es una biblioteca abierta de Pliegue: los libros de una carpeta de Google
Drive compartida como «cualquiera con el enlace», a la que se entra con un **código de acceso**
y sin cuenta (ni de Google ni de Pliegue). Es independiente de la biblioteca personal: no usa su
navegación, su nube ni sus fuentes.

- **Entrar.** `/biblioteca/general/OCT2026AREQUIPA` trae el código puesto; en
  `/biblioteca/general` se escribe a mano. Se pide un nombre para el registro.
- **Volver.** El navegador recuerda las últimas tres entradas (código y nombre) y ofrece
  «Entrar como …» con un clic. Una vuelta —mismo código, mismo equipo y mismo nombre— **no gasta
  otro uso** ni la frena el tope: «Usos máximos» cuenta personas distintas, no veces que se entra.
- **Otro código.** Con un enlace del mismo código con el que ya se está dentro, se entra directo.
  Con el de otro código, hay que entrar con él (código y nombre ya puestos): así se valida y queda
  registrado en ese código, en vez de colarse con la sesión del anterior.
- **Leer.** El mismo lector que la biblioteca personal. El archivo se baja de Drive con la clave
  de API de Pliegue; el avance, las marcas, las notas y las traducciones se guardan **solo en el
  navegador** del visitante, con identificadores `general:…` que la sincronización ignora.
- **Índice.** Si la carpeta trae un `pliegue-catalogo….json` (el índice JSON de Pliegue), se
  aplica: títulos, autores, estantes y portadas, y se ocultan las copias marcadas como repetidas.
- **Administrar.** En Ajustes → Cuenta, quien administra ve el enlace a
  `/app/ajustes/biblioteca-general`: crear códigos (con caducidad y usos máximos), editarlos
  (etiqueta, caducidad y usos máximos), copiar el enlace, desactivar o borrar, y ver quién
  entró, cuándo y desde qué navegador; las vueltas se marcan como «volvió». **Quitar** a quien
  entró borra todas sus entradas con ese código desde ese equipo, libera su uso y la saca en su
  próxima visita; con el código puede volver a entrar (como uso nuevo) salvo que se desactive.

## Cómo funciona la seguridad

1. El navegador manda el código, el nombre y un identificador aleatorio del equipo a
   `POST /api/biblioteca/acceso`.
2. El servidor lo canjea en Supabase con la clave secreta (`redeem_library_code`). La función
   comprueba que el código existe, está activo, no ha caducado y le quedan usos; registra la
   entrada y frena tras 10 fallos en 15 minutos desde la misma conexión (guarda una huella, no
   la IP).
3. Si vale, el servidor firma una sesión (HMAC-SHA256) y la deja en una cookie `httpOnly`, que
   caduca a los 30 días o con el código.
4. Cada página de la biblioteca comprueba la firma, que el código siga activo **y** que la
   persona siga en el registro: desactivar el código o quitarla en el panel la saca en su
   próxima visita.

Nadie lee los códigos ni el registro sin ser administrador (RLS), y canjear solo lo puede hacer
el servidor.

**Límite conocido.** Con la carpeta pública, el código protege la experiencia en Pliegue, no los
archivos: quien obtenga el identificador de la carpeta puede abrirla directamente en Drive. Para
protegerlos de verdad habría que hacer la carpeta privada y servir los archivos con una cuenta de
servicio; el código y la sesión seguirían igual.

## Puesta en marcha

1. **Google Cloud → APIs y servicios → Credenciales**: en la clave de API de Pliegue, en
   «Restricciones de API», añade **Google Drive API** junto a la Picker API. Sin esto, Drive
   responde «Requests to this API drive method … are blocked».
2. **Supabase → SQL Editor**: aplica, en orden,
   `supabase/migrations/20261003120000_biblioteca_general.sql` y
   `supabase/migrations/20261003150000_biblioteca_general_vueltas.sql` (sin esta, una vuelta
   cuenta como un uso nuevo), y regístrate como administradora o administrador con tu correo:

   ```sql
   insert into public.pliegue_admins (user_id)
   select id from auth.users where email = 'tu-correo@ejemplo.com';
   ```

3. **Vercel → Settings → Environment Variables** (Production), sin `NEXT_PUBLIC_`:
   - `SUPABASE_SECRET_KEY`: Supabase → Project Settings → API Keys → *Secret key*
     (`sb_secret_…`), o la antigua `service_role`.
   - `PLIEGUE_GENERAL_FOLDER_ID`: lo que va después de `/folders/` en el enlace de la carpeta.

   Después, **Redeploy**.
4. Opcional: sube a la raíz de la carpeta el índice JSON de la biblioteca
   (`pliegue-catalogo-v2-….json`) para ver títulos, autores y portadas.
5. En Pliegue, con tu cuenta: Ajustes → Cuenta → «biblioteca general» → crea un código y
   comparte su enlace.

## Archivos

- `supabase/migrations/20261003120000_biblioteca_general.sql`: tablas, RLS y canje.
- `supabase/migrations/20261003150000_biblioteca_general_vueltas.sql`: las vueltas no gastan uso.
- `apps/web/app/library-access/`: sesión firmada, canje en el servidor, resumen del panel.
- `apps/web/app/api/biblioteca/acceso/route.ts`: entrar (POST) y salir (DELETE).
- `apps/web/app/biblioteca/general/`: entrada, biblioteca y lector.
- `apps/web/app/library/general-library*.ts`: la carpeta como biblioteca y su caché local
  (IndexedDB `pliegue-general`).
- `apps/web/app/components/general-library/` y `components/admin/`: interfaz.
