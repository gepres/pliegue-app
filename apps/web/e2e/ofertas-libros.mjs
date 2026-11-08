// 06.2 · «Dónde conseguirlo». Desde el menú de un libro: Buscalibre en la tienda del país del
// navegador (y en la que se elija, que se recuerda), y los libros digitales de Google Play con
// precio, moneda, país, rebaja y la fecha de la consulta. Si la Books API no responde, no hay
// precios digitales y no pasa nada. Google simulado por CDP; Buscalibre no se toca.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/ofertas-libros`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Dónde conseguirlo (${BASE})`);
const browser = await openChrome({ port: 9416, profile: `${PROFILE_ROOT}-ofertas-libros` });
const page = await browser.newPage();
await page.viewport(1366, 900);
// Un navegador en español de Perú.
const { userAgent } = await browser.send("Browser.getVersion");
await page.send("Emulation.setUserAgentOverride", { acceptLanguage: "es-PE,es", userAgent });
await page.send("Emulation.setLocaleOverride", { locale: "es-PE" });

writeFileSync(
  `${work}/Ficciones - Jorge Luis Borges.epub`,
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Ficciones</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body><h1>Ficciones</h1><p>Tlön, Uqbar, Orbis Tertius.</p></body></html>`),
  }),
);

// ---- Google Books simulado -------------------------------------------------------------------------------------------
const books = [];
let blocked = false;
const external = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://www.googleapis.com/*" }, { urlPattern: "https://*.buscalibre.*/*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/books/")) {
    external.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  books.push(url);
  const country = url.searchParams.get("country");
  const body = blocked
    ? { error: { code: 403, message: "Books API has not been used in project" } }
    : { items: [{ saleInfo: { buyLink: "https://play.google.com/store/books/details?id=ficciones", country, listPrice: { amount: 45, currencyCode: country === "CL" ? "CLP" : "PEN" }, retailPrice: { amount: country === "CL" ? 8900 : 35.9, currencyCode: country === "CL" ? "CLP" : "PEN" }, saleability: "FOR_SALE" }, volumeInfo: { title: "Ficciones" } }] };
  return page.send("Fetch.fulfillRequest", { requestId, responseCode: blocked ? 403 : 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
});

// ---- Un libro en la Biblioteca y su menú --------------------------------------------------------------------------------
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Ficciones - Jorge Luis Borges.epub`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

const sheet = `document.querySelector("[role=dialog][aria-labelledby]") && [...document.querySelectorAll("[role=dialog]")].find((d) => /Dónde conseguirlo/.test(d.textContent))`;
async function openOffers() {
  await page.eval(`(document.querySelector("article[aria-label] button[aria-label^='Más acciones']").click(), true)`);
  await page.sleep(300);
  await page.eval(`([...document.querySelectorAll("[role=menuitem]")].find((item) => item.getClientRects().length && /Dónde conseguirlo/.test(item.textContent)).click(), true)`);
  await page.waitFor(`${sheet}`, { timeout: 10000 });
  await page.waitFor(`!/Consultando precios/.test((${sheet}).textContent)`, { timeout: 15000 }).catch(() => {});
  await page.sleep(300);
}
const view = () =>
  page.eval(`(() => {
    const panel = ${sheet};
    const select = panel.querySelector("select");
    const store = [...panel.querySelectorAll("a")].find((a) => /buscalibre/.test(a.href));
    return {
      country: select?.value,
      link: store ? { href: store.getAttribute("href"), rel: store.rel, target: store.target, text: store.textContent.replace(/\\s+/g, " ").trim() } : null,
      offers: [...panel.querySelectorAll("li")].map((li) => li.textContent.replace(/\\s+/g, " ").trim()),
      text: panel.textContent.replace(/\\s+/g, " "),
    };
  })()`);
const closeSheet = () => page.key("Escape", { code: "Escape", keyCode: 27 });

await openOffers();
let shown = await view();
t.check("el menú del libro abre «Dónde conseguirlo» con el libro y su autor", /Ficciones, de Jorge Luis Borges/.test(shown.text), shown.text.slice(0, 120));
t.check("elige Buscalibre Perú por el idioma del navegador (es-PE)", shown.country === "pe" && /Buscalibre Perú/.test(shown.link?.text ?? ""), JSON.stringify(shown.link));
t.check(
  "el enlace busca el libro por título y autor en buscalibre.pe, en otra pestaña y sin datos de quién viene",
  shown.link?.href === "https://www.buscalibre.pe/libros/search?q=Ficciones%20Jorge%20Luis%20Borges" && shown.link.target === "_blank" && /noopener/.test(shown.link.rel) && /noreferrer/.test(shown.link.rel),
  shown.link?.href,
);
t.check("dice que el precio, el envío y las promociones se ven en Buscalibre", /el precio, el envío y las promociones los ves allí/.test(shown.text));
t.check(
  "el precio digital: moneda del país, rebaja, formato y fecha de la consulta",
  shown.offers.length === 1 && /S\/\s?35[.,]90/.test(shown.offers[0]) && /45[.,]00/.test(shown.offers[0]) && /eBook/.test(shown.offers[0]) && /Perú · digital, sin envío · precio consultado el/.test(shown.offers[0]),
  shown.offers[0],
);
t.check("preguntó a Google por título y autor, en Perú", books.length === 1 && books[0].searchParams.get("country") === "PE" && /intitle:"Ficciones" inauthor:"Jorge Luis Borges"/.test(books[0].searchParams.get("q") ?? ""), `${books[0]?.searchParams.get("q")} · ${books[0]?.searchParams.get("country")}`);
t.check("dice que Pliegue no gana nada y qué sale del equipo", /Pliegue no gana nada con estos enlaces/.test(shown.text) && /nunca el archivo/.test(shown.text));
await page.screenshot(`${work}/1-peru.png`);

// ---- Otro país: se recuerda, y lo consultado no se vuelve a pedir en el día -----------------------------------------------
await page.eval(`(() => { const el = (${sheet}).querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "cl"); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await page.waitFor(`/buscalibre\\.cl/.test([...(${sheet}).querySelectorAll("a")].map((a) => a.href).join(" "))`, { timeout: 10000 }).catch(() => {});
await page.waitFor(`/8\\.900/.test((${sheet}).textContent)`, { timeout: 15000 }).catch(() => {});
shown = await view();
t.check("al elegir Chile: buscalibre.cl y el precio en pesos chilenos", shown.link?.href.startsWith("https://www.buscalibre.cl/") && shown.offers.some((offer) => /8\.900/.test(offer)), JSON.stringify(shown));
await closeSheet();
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("article[aria-label] button[aria-label^='Más acciones']")`, { timeout: 20000 });
await page.sleep(500);
const before = books.length;
await openOffers();
shown = await view();
t.check("el país elegido se recuerda al volver", shown.country === "cl");
t.check("y el precio de hoy no se vuelve a pedir a Google", books.length === before, `${books.length - before} peticiones nuevas`);
await closeSheet();

// ---- Sin la Books API: sin precios digitales, sin errores ------------------------------------------------------------------
blocked = true;
await openOffers();
await page.eval(`(() => { const el = (${sheet}).querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "co"); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await page.waitFor(`/no están disponibles ahora/.test((${sheet}).textContent)`, { timeout: 15000 }).catch(() => {});
shown = await view();
t.check("si Google no da precios (sin la Books API), lo dice y Buscalibre sigue", /Los precios de libros digitales no están disponibles ahora/.test(shown.text) && shown.link?.href.startsWith("https://www.buscalibre.com.co/"), shown.text.slice(-260));
t.check("nunca se pidió nada a Buscalibre desde Pliegue", external.length === 0, external.join(" "));

// ---- En el móvil cabe ------------------------------------------------------------------------------------------------------
await closeSheet();
await page.viewport(390, 844, { dpr: 2, mobile: true });
await page.sleep(500);
await openOffers();
const fit = await page.eval(`(() => { const r = (${sheet}).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }; })()`);
t.check("en el móvil, el panel cabe sin desplazamiento lateral", fit.left >= 0 && fit.right <= fit.width && fit.scroll <= fit.width, JSON.stringify(fit));
await page.screenshot(`${work}/2-movil.png`);

const errors = page.errors.filter((error) => !/403|Failed to load resource/.test(error));
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
