# App instalable (PWA)

- Estado: primera versión
- Foundry: `06.6 · Empaquetar Web, Windows y macOS`

## Qué es

Pliegue se instala desde Chrome o Edge como una aplicación de escritorio —o de la pantalla de
inicio del teléfono—: ventana propia sin barra de direcciones, en el menú Inicio, el Dock o la
barra de tareas, y abre sin conexión.

Por dentro sigue siendo Chrome o Edge, y eso es lo que se busca. Así conserva:

- la **Translator API** del navegador, el traductor predeterminado (ADR-0003);
- el **File System Access API**, con el que se vinculan archivos y carpetas sin copiarlos.

Tauri (ADR-0002, gate 1) usa WebView2 en Windows y WKWebView en macOS. El primero no trae el
traductor de Chrome; el segundo, tampoco la vinculación. Por eso la PWA va primero, y Tauri
queda para cuando haga falta algo nativo: vigilar carpetas, SQLite o la bóveda del sistema.

## Piezas

- `app/manifest.ts`: nombre, `start_url` en la Biblioteca y `display: standalone`. Iconos PNG
  de 192 y 512 px, su versión `maskable` y el SVG. `launch_handler` enfoca la ventana ya
  abierta. Sin `window-controls-overlay`: la cabecera no reserva el hueco de los botones de
  la ventana.
- `public/sw.js`, el service worker:
  - **Páginas:** primero la red y, sin conexión, la última copia de esa ruta, ignorando la
    consulta.
  - **`/_next/static`:** primero la caché.
  - **Resto de estáticos:** la copia, renovada por detrás.
  - **Nunca:** `/api/*` ni lo de otros orígenes, como Supabase.
  - **Caché que falla:** se sigue por la red en vez de dejar de instalarse.
- `app/pwa/pwa-bootstrap.tsx`: registra el service worker **solo en producción**. En
  desarrollo da de baja los que haya, para no servir páginas viejas.
- `app/pwa/install-store.ts`: guarda el aviso `beforeinstallprompt`, con un script temprano en
  el layout porque puede llegar antes de hidratar, y distingue si ya está instalada, si se puede
  instalar con un botón o si hay que hacerlo desde el menú (Chrome sin aviso, Safari, iOS).
- **Puntos de instalación:**
  - «Instalar Pliegue» en la barra lateral y «Instalar» en la cabecera de la portada, solo
    cuando el navegador lo ofrece;
  - Ajustes → Espacio de trabajo → «Pliegue como app», con las instrucciones de cada
    navegador.

`next.config.ts` sirve `sw.js` con `no-cache`, para que una versión nueva llegue en la
siguiente visita. Al publicar cambios que afecten a la caché, se sube `VERSION` en `sw.js`.

## Verificación

Se prueba contra el build de producción (`next build` + `next start -p 3100`):

- **Con el servidor encendido:** `Page.getInstallabilityErrors` sale vacío, el manifiesto no
  tiene errores, llega el aviso y el botón aparece.
- **Con el servidor apagado:** Biblioteca, Lector y Ajustes abren desde la caché.

Una trampa de las pruebas: un perfil de Chrome en una ruta muy larga rompe `CacheStorage`
(«Unexpected internal error») por el límite de 260 caracteres de Windows. Hay que usar un
perfil temporal de ruta corta.
