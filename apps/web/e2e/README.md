# Pruebas de extremo a extremo

Cada archivo `*.mjs` de esta carpeta es una prueba independiente: abre un Chrome sin ventana
con un perfil temporal, recorre la app como lo haría una persona y comprueba lo que ve. No hay
Playwright ni Puppeteer; el arnés (`lib/cdp.mjs`) habla con Chrome por el protocolo de
depuración (CDP) con el WebSocket de Node.

## Cómo se corren

Contra la app **compilada**, no contra `pnpm dev` (el modo desarrollo tarda en compilar cada
ruta y las pruebas esperan tiempos de producción):

```bash
pnpm build
pnpm --filter @pliegue/web exec next start -p 3300
# en otra terminal
pnpm --filter @pliegue/web e2e                          # todas, una tras otra
pnpm --filter @pliegue/web e2e accesibilidad duplicados # solo esas
node apps/web/e2e/esqueletos.mjs                        # una sola, con su salida completa
```

Variables:

| Variable | Para qué | Por defecto |
|---|---|---|
| `BASE` | Dónde está la app | `http://localhost:3300` |
| `CHROME_PATH` | El ejecutable de Chrome | El de Windows, macOS o Linux, si existe |
| `E2E_WORK` | Dónde deja cada prueba sus archivos (libros generados, capturas) | `<tmp>/pliegue-e2e` |
| `CI` | Con cualquier valor, Chrome arranca con `--no-sandbox` (Linux sin usuario con sandbox) | — |

Las pruebas de cuenta (`consentimiento-sync`, `nav-correo`) necesitan una app compilada con
`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Pueden ser de mentira,
como en el CI (`.github/workflows/ci.yml`): Supabase se simula entero.

## Reglas de la casa

- **Nada sale fuera.** Supabase, los proveedores de IA y los traductores se simulan con
  `Fetch.enable` y `Fetch.fulfillRequest`. Ninguna prueba toca una cuenta real ni usa claves.
- **Los libros se generan** en la propia prueba (un PDF con `Page.printToPDF`, un EPUB o un DOCX
  con `fflate`): no dependen de archivos de este equipo.
- **Cada prueba tiene su puerto de depuración** (9382–9401) y su perfil (`<tmp>/pl-e2e-<nombre>`),
  que se borra al terminar. Una prueba nueva toma el siguiente puerto libre.
- **Sin errores de consola.** Casi todas terminan comprobándolo.
- `run.mjs` corre todas las que haya en la carpeta (menos ella misma) y sale con 1 si alguna falla.

## Accesibilidad

`accesibilidad.mjs` importa un libro y pasa [axe-core](https://github.com/dequelabs/axe-core) por
la portada, Inicio, la Biblioteca, el lector (vacío y con el libro), IA, Ajustes, Fuentes y el
catálogo, en claro y en oscuro, con las reglas de WCAG 2.0, 2.1 y 2.2 AA:

- un problema **grave** o **crítico** hace fallar la prueba;
- los **moderados** y **menores** salen como aviso al final, sin hacerla fallar.

Corre con «menos movimiento» emulado: las secciones que entran al desplazarse están al 15 % de
opacidad hasta llegar a ellas, y axe mediría ese contraste a medio aparecer.

## Secretos, teclado y sin conexión (06.5)

- `secretos.mjs`: el código que llega al navegador no lleva claves privadas (la de Google del
  navegador es pública por diseño y solo se avisa), y la clave de IA de la sesión solo viaja en
  `Authorization` hacia `/api/ai/*`: ni en URLs ni en cuerpos, ni guardada en localStorage,
  sessionStorage, cookies, IndexedDB o la caché. Al recargar, ya no está.
- `teclado.mjs`: «Saltar al contenido», indicador de foco en cada parada del tabulador
  (también el que pinta el contenedor con `:focus-within`), el menú de un libro con flechas y
  Escape, y un diálogo que retiene el foco y lo devuelve. Intro se manda con su carácter
  (`\r`): sin él, Chrome no activa un `<button>`.
- `sin-conexion.mjs`: corta la red a la página **y al service worker** (CDP, sesión del
  `service_worker`) y abre la Biblioteca, el lector y Ajustes desde la caché.
- `carga.mjs`: una biblioteca de 500 libros (120 en el CI; `CARGA_LIBROS`) más 10 tomos de unas
  300 páginas (3 en el CI; `CARGA_GRANDES`). Mide importar, recargar la Biblioteca (y las tareas
  largas del hilo principal), filtrar, indexar para buscar por palabras y buscar. Los límites son
  holgados: sirven para que salte una regresión. Medido el 7-nov-2026 en local: 500 libros se
  importan en 4 s; la Biblioteca recarga en 0,8 s; filtrar tarda 70 ms; indexarlos, 5,5 s.
  Buscar entre 6.600 fragmentos tarda 0,9 s la primera vez y 4 ms después.

## Lector de pantalla (06.5)

`lector-pantalla.mjs` lee con CDP (`Accessibility.getFullAXTree`) lo que recibe un lector de
pantalla en Inicio, Biblioteca, lector, IA, Ajustes y Fuentes. En cada pantalla comprueba:
- el idioma y su propio título;
- una sola región principal, y navegación (en el lector, un enlace para volver);
- un solo nivel 1 y ningún salto de nivel, leídos en el orden del documento, porque el del
  árbol de CDP no lo es;
- que cada control tiene nombre y que ninguna imagen se anuncia sin texto.

También comprueba que el resultado de importar llega a una región que se anuncia, que el menú de
un libro dice si está abierto, que el diálogo es modal y tiene nombre, y que el avance del lector
dice cuánto va.

La prueba a mano, con NVDA o VoiceOver, está en `docs/lector-de-pantalla.md`.
