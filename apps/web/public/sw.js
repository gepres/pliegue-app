/*
 * Pliegue · service worker.
 *
 * Lo justo para que la app instalada abra sin conexión: la biblioteca, el lector y las notas
 * viven en el navegador (IndexedDB), así que basta con tener a mano las páginas y sus recursos.
 *
 * - Páginas: primero la red —siempre la versión nueva si hay conexión— y, sin ella, la última
 *   copia de esa ruta. Se ignora la consulta: `/app/lector?document=…` sirve para todo libro.
 * - `/_next/static`: primero la caché. Llevan hash en el nombre y no cambian nunca.
 * - Otros estáticos del mismo origen (pdf.js, marca, iconos): se sirve la copia y se renueva
 *   por detrás.
 * - Nunca: `/api/*` (la IA con la clave de la sesión), peticiones que no sean GET ni nada de
 *   otro origen, como Supabase.
 */

const VERSION = "2026-09-30";
const PAGES = `pliegue-paginas-${VERSION}`;
const ASSETS = `pliegue-recursos-${VERSION}`;

/** Lo mínimo para arrancar sin conexión la primera vez que se instala. */
const SHELL = [
  "/app",
  "/app/biblioteca",
  "/app/biblioteca/fuentes",
  "/app/lector",
  "/app/ia",
  "/app/ajustes",
  "/manifest.webmanifest",
  "/brand/pliegue-mark.svg",
  "/icons/pliegue-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      // Una a una: si falla una ruta, las demás se guardan igual.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      // Ni siquiera una caché rota impide instalarse: sin ella, todo va por la red.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("pliegue-") && key !== PAGES && key !== ASSETS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** La caché, o `null` si el navegador no la da (sin espacio, perfil dañado…): entonces, red. */
async function openCache(name) {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function networkFirst(request) {
  const cache = await openCache(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) cache?.put(request, response.clone()).catch(() => undefined);
    return response;
  } catch {
    const cached =
      (await cache?.match(request, { ignoreSearch: true })) ??
      (await cache?.match("/app/biblioteca"));
    return cached ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await openCache(ASSETS);
  const cached = await cache?.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache?.put(request, response.clone()).catch(() => undefined);
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await openCache(ASSETS);
  if (!cache) return fetch(request);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => cached ?? Response.error());
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Las cargas de React Server Components de una navegación interna: si fallan sin conexión,
  // Next hace una navegación completa, que sí se sirve desde la caché de páginas.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (/\.(?:js|mjs|css|svg|png|jpg|webp|woff2?|bcmap|pfb|ttf|wasm|json|webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
