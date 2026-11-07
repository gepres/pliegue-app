// 06.5 · Sin conexión (PWA). Tras una visita con red, sin ella la app abre: el service worker
// sirve las páginas y los recursos, y la biblioteca y los libros salen del navegador (IndexedDB).
// Se corta la red a la página y al propio service worker, como en un avión.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/sin-conexion`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Sin conexión (${BASE})`);
const browser = await openChrome({ port: 9407, profile: `${PROFILE_ROOT}-sin-conexion` });
const page = await browser.newPage();
await page.viewport(1366, 900);

writeFileSync(
  `${work}/Ficciones.epub`,
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Ficciones</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body><h1>Ficciones</h1><p>Un libro que se lee también en un avión.</p></body></html>`),
  }),
);

// ---- Con red: importar, que el service worker tome la página y pasar una vez por cada sitio -----------------------
await page.goto(`${BASE}/app/biblioteca`);
const controlled = await page.waitFor(`navigator.serviceWorker?.controller ? true : (navigator.serviceWorker?.ready.then(() => false), false)`, { timeout: 20000 }).then(() => true, () => false);
if (!controlled) {
  // La primera visita instala; desde la siguiente, el service worker sirve la página.
  await page.goto(`${BASE}/app/biblioteca`);
}
const active = await page.waitFor(`Boolean(navigator.serviceWorker?.controller)`, { timeout: 20000 }).then(() => true, () => false);
t.check("el service worker toma la página", active);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Ficciones.epub`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const href = await page.eval(`document.querySelector("a[href*='/app/lector?document=']").getAttribute("href")`);
for (const path of ["/app", "/app/ia", "/app/ajustes", href, "/app/biblioteca"]) {
  await page.goto(`${BASE}${path}`);
  await page.sleep(path === href ? 2500 : 1200);
}
const cached = await page.eval(`(async () => { let n = 0; for (const name of await caches.keys()) n += (await (await caches.open(name)).keys()).length; return n; })()`);
t.check("la caché del service worker guarda páginas y recursos", cached >= 10, `${cached} entradas`);

// ---- Sin red ----------------------------------------------------------------------------------------------------------
const offline = { downloadThroughput: 0, latency: 0, offline: true, uploadThroughput: 0 };
await page.send("Network.enable");
await page.send("Network.emulateNetworkConditions", offline);
const { targetInfos } = await browser.send("Target.getTargets");
const worker = targetInfos.find((target) => target.type === "service_worker" && target.url.startsWith(BASE));
if (worker) {
  const { sessionId } = await browser.send("Target.attachToTarget", { flatten: true, targetId: worker.targetId });
  await browser.send("Network.enable", {}, sessionId);
  await browser.send("Network.emulateNetworkConditions", offline, sessionId);
}
t.check("se corta la red también al service worker", Boolean(worker));
const reachable = await page.eval(`fetch("/api/no-existe?" + Date.now()).then(() => true, () => false)`);
t.check("de verdad no hay red (una petición a la API falla)", reachable === false);

await page.goto(`${BASE}/app/biblioteca`);
const library = await page.waitFor(`[...document.querySelectorAll("article[aria-label]")].some((a) => a.getAttribute("aria-label") === "Ficciones")`, { timeout: 20000 }).then(() => true, () => false);
t.check("sin red, la Biblioteca abre y enseña el libro", library);
await page.screenshot(`${work}/1-biblioteca-sin-red.png`);

await page.eval(`([...document.querySelectorAll("article[aria-label]")].find((a) => a.getAttribute("aria-label") === "Ficciones").querySelector("a[href*='/app/lector?document=']").click(), true)`);
const read = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /se lee también en un avión/.test(p.textContent))`, { timeout: 30000 }).then(() => true, () => false);
t.check("y el libro se abre y se lee en el lector", read);
await page.screenshot(`${work}/2-lector-sin-red.png`);

await page.goto(`${BASE}/app/ajustes`);
const settings = await page.waitFor(`document.querySelector("h1, h2")`, { timeout: 20000 }).then(() => true, () => false);
t.check("Ajustes también abre sin red", settings);

await page.goto(`${BASE}/app/lector?document=${encodeURIComponent(new URLSearchParams(href.split("?")[1]).get("document"))}&resume=1`);
const direct = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /se lee también en un avión/.test(p.textContent))`, { timeout: 30000 }).then(() => true, () => false);
t.check("entrar directamente al lector (otra consulta en la URL) también funciona sin red", direct);

// Los errores de red que se esperan sin conexión (scripts de Google, la API) no cuentan.
const errors = page.errors.filter((error) => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED|Load failed|net::/i.test(error));
t.check("sin errores de la app en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
