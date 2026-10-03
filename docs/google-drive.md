# Google Drive

Pliegue lee libros que están en Google Drive sin copiarlos: guarda la referencia (`fileId`) y un
índice derivado, y descarga el original a la pestaña solo para indexarlo o para abrirlo. Nunca
escribe en Drive.

## Dos formas de traer libros

| Flujo | Permiso de Google | Qué ve Pliegue | Verificación de Google |
| --- | --- | --- | --- |
| **Elegir archivos** | `drive.file` | Solo los archivos marcados en el selector | No hace falta |
| **Vincular carpeta completa** | `drive.readonly` (solo lectura) | La carpeta elegida y sus subcarpetas; «Buscar cambios» detecta lo nuevo | Sí, para abrirlo al público |

`drive.file` no basta para una carpeta: elegir una carpeta en el selector no da acceso a los
archivos que ya contiene. Por eso «Vincular carpeta completa» pide `drive.readonly`, y solo en
ese flujo (decisión 4 de `docs/product/17-open-decisions.md`). Google clasifica `drive.readonly`
como alcance **restringido**:

- En modo *Testing* de la pantalla de consentimiento funciona para los usuarios de prueba
  (hasta 100), que ven el aviso «Google no ha verificado esta aplicación».
- Para cualquier persona hace falta la verificación de alcances restringidos de Google. Pliegue
  procesa los archivos en el navegador y no los guarda ni los reenvía desde un servidor, lo que
  es relevante para la evaluación de seguridad que Google pide cuando sí se hace.

## Configurar Google Cloud (una vez)

En el mismo proyecto de Google Cloud que ya da el inicio de sesión con Google:

1. **APIs y servicios → Biblioteca:** habilita **Google Drive API** y **Google Picker API**.
2. **Credenciales → Crear credenciales → Clave de API.** En «Restricciones de la clave»:
   - aplicación: **Sitios web**, con `http://localhost:3000/*`, `https://pliegue.genaropretill.com/*`
     y `https://pliegue-app.vercel.app/*`;
   - API: solo **Google Picker API**.
3. **Credenciales → el cliente OAuth «Aplicación web» existente → Orígenes autorizados de
   JavaScript:** `http://localhost:3000`, `https://pliegue.genaropretill.com` y
   `https://pliegue-app.vercel.app`. No hacen falta URIs de redirección nuevos: el token llega
   por la ventana emergente de Google Identity Services.
4. **Pantalla de consentimiento → Acceso a datos → Agregar o quitar permisos:** añade
   `.../auth/drive.file` y `.../auth/drive.readonly`. Mientras esté en *Testing*, añade las
   cuentas que lo usarán en **Público → Usuarios de prueba**.
5. **Número del proyecto:** en el panel principal del proyecto (Información del proyecto).

Después, las tres variables en `apps/web/.env.local` y en Vercel (Settings → Environment
Variables, entornos Production y Preview), y un nuevo despliegue:

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_API_KEY=<clave de API del paso 2>
NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER=<número del proyecto>
```

## Cómo funciona

- **Identidad:** Google Identity Services, modelo de token (`app/drive/drive-connection.ts`).
  El token de acceso dura una hora y vive solo en memoria (gate 3 de ADR-0002): al recargar, un
  clic en «Conectar Google Drive» lo renueva. `localStorage` (`pliegue-drive-v1`) recuerda solo
  que se autorizó, con qué cuenta y si se concedió la lectura de carpetas.
- **Selector:** Google Picker (`app/drive/drive-picker.ts`). `setAppId` con el número del
  proyecto es lo que autoriza los archivos elegidos para la app con `drive.file`.
- **API:** REST v3 con `fetch` (`app/drive/drive-api.ts`), con Mi unidad y unidades compartidas
  (`supportsAllDrives`), reintentos ante cuota y errores 5xx, y errores tipados (`auth`, `scope`,
  `not-found`…).
- **Biblioteca:** `app/library/drive-library-store.ts` (IndexedDB `pliegue-drive`). Los
  documentos aparecen al momento y se indexan por detrás, de dos en dos. Por encima de 50 MB no
  se descargan para indexar (quedan como «solo metadatos»). La indexación se pausa si el token
  caduca y sigue al reconectar.
- **Huella:** la misma forma que en las carpetas locales (`ruta::nombre::tamaño::fecha`). Si la
  carpeta de Drive es la misma biblioteca sincronizada desde el disco, un índice JSON encaja por
  ruta y, si Drive conserva la fecha, también por huella.
- **Lector:** descarga el original a la pestaña con su avance; sin token muestra «Conectar
  Google Drive» en lugar de fallar.
- **Formatos:** los mismos que las carpetas locales, más los Documentos de Google (se exportan a
  DOCX). Hojas y Presentaciones de Google aún no se leen.

## Pendiente

- Cambios incrementales con `changes.list` en vez de recorrer la carpeta al buscar cambios.
- Renovar el acceso sin clic (token de actualización guardado en servidor), si se decide.
- Abrir libros de más de 50 MB sin descargarlos enteros (peticiones por rangos).
