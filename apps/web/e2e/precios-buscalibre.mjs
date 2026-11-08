// 06.2b · El precio de Buscalibre, solo para el admin. Quien no es admin ve «Dónde conseguirlo» como
// siempre (el enlace por país, sin precio) y nunca llama a las rutas de Buscalibre. El admin prepara
// una vez la lista ISBN → producto, que se guarda en su navegador, y ve el precio de la ficha del
// país con su fecha y el enlace directo; lo consultado se recuerda un día.
// Supabase, Open Library, Google y las rutas `/api/buscalibre/*` simulados por CDP: el navegador
// nunca habla con Buscalibre (lo hace el servidor, que se prueba con vitest).
import { mkdirSync, rmSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/precios-buscalibre`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Precios de Buscalibre para el admin (${BASE})`);
const browser = await openChrome({ port: 9418, profile: `${PROFILE_ROOT}-precios-buscalibre` });
const page = await browser.newPage();
await page.viewport(1366, 900);
const { userAgent } = await browser.send("Browser.getVersion");
await page.send("Emulation.setUserAgentOverride", { acceptLanguage: "es-PE,es", userAgent });
await page.send("Emulation.setLocaleOverride", { locale: "es-PE" });

const ISBN = "9788483835241";
const userId = "8b8f0c7e-0000-4000-8000-0000000000bb";
const email = "dueno@prueba.test";
const now = Math.floor(Date.now() / 1000);
const session = { access_token: "x", expires_at: now + 3600, expires_in: 3600, refresh_token: "y", token_type: "bearer", user: { app_metadata: { provider: "google" }, aud: "authenticated", email, id: userId, role: "authenticated", user_metadata: {} } };

// ---- Todo lo de fuera, simulado --------------------------------------------------------------------------------------------
let admin = false;
const routes = [];
const buscalibreDirect = [];
const parts = { 0: [`9788425432026 47056974`, `9786287638662 62893033`], 1: [`${ISBN} 51234567`], 2: [`9788408285298 55892993`] };
const prices = { cl: { currency: "CLP", price: 12990 }, pe: { currency: "PEN", price: 52 } };
const doc = { author_name: ["Haruki Murakami"], cover_i: 100, editions: { docs: [{ isbn: [ISBN], language: ["spa"], title: "Kafka en la orilla" }] }, first_publish_year: 2002, key: "/works/OL4W", ratings_average: 4.2, ratings_count: 50, title: "海辺のカフカ" };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
await page.send("Fetch.enable", {
  patterns: [{ urlPattern: "https://*.supabase.co/*" }, { urlPattern: "https://openlibrary.org/*" }, { urlPattern: "https://covers.openlibrary.org/*" }, { urlPattern: "https://www.googleapis.com/*" }, { urlPattern: "*/api/buscalibre/*" }, { urlPattern: "https://*.buscalibre.*/*" }],
});
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const url = new URL(request.url);
  const reply = (body, code = 200, type = "application/json") =>
    page
      .send("Fetch.fulfillRequest", {
        requestId,
        responseCode: code,
        responseHeaders: [{ name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }, { name: "Access-Control-Allow-Methods", value: "*" }],
        body: (Buffer.isBuffer(body) ? body : Buffer.from(body === null ? "" : JSON.stringify(body))).toString("base64"),
      })
      .catch(() => {});
  if (/buscalibre\./.test(url.host)) {
    buscalibreDirect.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  if (url.pathname.startsWith("/api/buscalibre/")) {
    routes.push({ authorization: request.headers.Authorization ?? request.headers.authorization ?? null, url });
    if (!admin) return reply({ error: "Los precios de Buscalibre solo los ve el admin de Pliegue." }, 403);
    if (url.pathname === "/api/buscalibre/indice") {
      const part = url.searchParams.get("parte");
      if (part === null) return reply({ parts: [0, 1, 2] });
      const entries = parts[part] ?? [];
      return reply({ count: entries.length, entries: entries.join("\n"), part: Number(part) });
    }
    const country = url.searchParams.get("pais");
    const offer = prices[country];
    return reply(
      offer && url.searchParams.get("isbn") === ISBN && url.searchParams.get("id") === "51234567"
        ? { ...offer, availability: "in-stock", fetchedAt: new Date().toISOString(), found: true, isbn: ISBN, title: "Kafka en la orilla", url: `https://www.buscalibre.${country}/libro-kafka-en-la-orilla/${ISBN}/p/51234567` }
        : { fetchedAt: new Date().toISOString(), found: false },
    );
  }
  if (url.host === "covers.openlibrary.org") return reply(pixel, 200, "image/png");
  if (url.host === "openlibrary.org") return reply({ docs: [doc], numFound: 1 });
  if (url.host === "www.googleapis.com") return reply({ items: [] });
  // Supabase: la sesión, «¿es admin?» y nada más.
  if (request.method === "OPTIONS") return reply(null, 204);
  if (url.pathname === "/auth/v1/user") return reply({ email, id: userId });
  if (url.pathname === "/rest/v1/rpc/is_pliegue_admin") return reply(admin);
  if (url.pathname.includes("/rpc/")) return reply(false);
  return reply([]);
});

// ---- Una sesión y unos gustos con un libro que tiene ISBN --------------------------------------------------------------------
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-auth", ${JSON.stringify(JSON.stringify(session))}), true)`);
const button = (label) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
const card = `[...document.querySelectorAll("li[data-recommendation]")].find((li) => li.querySelector("h3")?.textContent === "Kafka en la orilla")`;
await page.goto(`${BASE}/app/para-ti`);
await page.waitFor(`${button("Realismo mágico")}`, { timeout: 20000 });
await page.eval(`(${button("Realismo mágico")}.click(), true)`);
await page.sleep(150);
await page.eval(`(${button("Ver recomendaciones")}.click(), true)`);
await page.waitFor(card, { timeout: 20000 });

const sheet = `[...document.querySelectorAll("[role=dialog]")].find((d) => /Dónde conseguirlo/.test(d.textContent))`;
const adminBlock = `(${sheet})?.querySelector("[role=group][aria-labelledby='offers-admin-price']")`;
async function openOffers() {
  await page.waitFor(card, { timeout: 20000 });
  await page.eval(`([...(${card}).querySelectorAll("button")].find((b) => /Dónde conseguirlo/.test(b.textContent)).click(), true)`);
  await page.waitFor(sheet, { timeout: 10000 });
  await page.sleep(600);
}
const closeSheet = async () => {
  await page.key("Escape", { code: "Escape", keyCode: 27 });
  await page.sleep(300);
};
const text = (selector) => page.eval(`(${selector})?.textContent.replace(/\\s+/g, " ").trim() ?? null`);

// ---- Quien no es admin: como siempre ---------------------------------------------------------------------------------------------
await openOffers();
t.check("quien no es admin ve el enlace a Buscalibre como siempre", /Buscalibre Perú/.test((await text(sheet)) ?? ""));
t.check("y no ve ningún precio de Buscalibre ni el bloque del admin", (await page.eval(`!${adminBlock}`)) && !/solo lo ves tú/.test((await text(sheet)) ?? ""));
t.check("ni se llama a las rutas de Buscalibre", routes.length === 0, routes.map((r) => r.url.pathname).join(" "));
await closeSheet();

// ---- El admin: prepara la lista una vez y ve el precio -----------------------------------------------------------------------
admin = true;
await page.goto(`${BASE}/app/para-ti?carga=${Date.now()}`);
await openOffers();
await page.waitFor(`${adminBlock}`, { timeout: 15000 });
let block = await text(adminBlock);
t.check("el admin ve el bloque «solo lo ves tú, como admin»", /solo lo ves tú, como admin/i.test(block ?? ""), block);
t.check("sin lista todavía: explica qué se descarga y dónde se guarda", /unos 850\.000 ISBN/.test(block ?? "") && /solo en este navegador/.test(block ?? "") && (await page.eval(`Boolean([...(${adminBlock}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Preparar la lista de Buscalibre"))`)), block);
t.check("dice por qué nadie más lo ve", /Buscalibre no autoriza reutilizar los datos de su catálogo/.test(block ?? ""));
t.check("y al admin no le dice que el precio solo se ve en Buscalibre", !/los ves allí/.test((await text(sheet)) ?? ""));
await page.eval(`([...(${adminBlock}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Preparar la lista de Buscalibre").click(), true)`);
await page.waitFor(`/S\\/\\s?52[.,]00/.test((${adminBlock})?.textContent ?? "")`, { timeout: 20000 }).catch(() => {});
block = await text(adminBlock);
const indexCalls = routes.filter((r) => r.url.pathname === "/api/buscalibre/indice").map((r) => r.url.search);
t.check("la lista se pide parte a parte (índice + 3 partes) con la sesión del admin", indexCalls.join(" ") === "?pais=pe ?pais=pe&parte=0 ?pais=pe&parte=1 ?pais=pe&parte=2" && routes.every((r) => r.authorization === "Bearer x"), `${indexCalls.join(" ")} · ${routes.map((r) => r.authorization).join(",")}`);
t.check("el precio de la ficha en Perú, disponible, con la fecha de la consulta", /S\/\s?52[.,]00/.test(block ?? "") && /Disponible/.test(block ?? "") && /Buscalibre Perú · precio consultado el/.test(block ?? ""), block);
const link = await page.eval(`(() => { const a = (${adminBlock}).querySelector("a"); return a ? { href: a.getAttribute("href"), rel: a.rel, target: a.target } : null; })()`);
t.check("el precio enlaza a la ficha del libro, en otra pestaña y sin datos de quién viene", link?.href === `https://www.buscalibre.pe/libro-kafka-en-la-orilla/${ISBN}/p/51234567` && link.target === "_blank" && /noopener/.test(link.rel) && /noreferrer/.test(link.rel), JSON.stringify(link));
t.check("dice de cuándo es la lista y cuántos libros tiene, y deja actualizarla", /Lista del .+ · 4 libros/.test(block ?? "") && /Actualizar la lista/.test(block ?? ""), block);
const priceCalls = () => routes.filter((r) => r.url.pathname === "/api/buscalibre/precio").map((r) => r.url.search);
t.check("el precio se pidió por ISBN y número de producto, en Perú", priceCalls().join(" ") === `?pais=pe&isbn=${ISBN}&id=51234567`, priceCalls().join(" "));
await page.screenshot(`${work}/1-admin-peru.png`);

// ---- Otro país, y lo consultado se recuerda ----------------------------------------------------------------------------------
await page.eval(`(() => { const el = (${sheet}).querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "cl"); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await page.waitFor(`/12\\.990/.test((${adminBlock})?.textContent ?? "")`, { timeout: 15000 }).catch(() => {});
block = await text(adminBlock);
t.check("en Chile: el precio de la ficha chilena, en pesos chilenos", /12\.990/.test(block ?? "") && /Buscalibre Chile/.test(block ?? ""), block);
t.check("con la misma lista: cambiar de país no la vuelve a descargar", routes.filter((r) => r.url.pathname === "/api/buscalibre/indice").length === 4);
await closeSheet();
const before = priceCalls().length;
await page.goto(`${BASE}/app/para-ti?carga=${Date.now()}`);
await openOffers();
await page.waitFor(`/12\\.990/.test((${adminBlock})?.textContent ?? "")`, { timeout: 15000 }).catch(() => {});
t.check("al volver, la lista sigue en el navegador y el precio de hoy no se vuelve a pedir", /12\.990/.test((await text(adminBlock)) ?? "") && priceCalls().length === before, `${priceCalls().length - before} peticiones nuevas`);

// ---- En el móvil cabe ---------------------------------------------------------------------------------------------------------
await closeSheet();
await page.viewport(390, 844, { dpr: 2, mobile: true });
await page.sleep(500);
await openOffers();
await page.waitFor(`/12\\.990/.test((${adminBlock})?.textContent ?? "")`, { timeout: 15000 }).catch(() => {});
const fit = await page.eval(`(() => { const r = (${adminBlock}).getBoundingClientRect(); const s = (${sheet}).getBoundingClientRect(); return { block: [Math.round(r.left), Math.round(r.right)], sheet: [Math.round(s.left), Math.round(s.right)], width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }; })()`);
t.check("en el móvil, el bloque del admin cabe en el panel, sin desplazamiento lateral", fit.block[0] >= fit.sheet[0] && fit.block[1] <= fit.sheet[1] && fit.sheet[1] <= fit.width && fit.scroll <= fit.width, JSON.stringify(fit));
await page.screenshot(`${work}/2-movil.png`);

t.check("el navegador nunca habló con Buscalibre", buscalibreDirect.length === 0, buscalibreDirect.join(" "));
const errors = page.errors.filter((error) => !/403|Failed to load resource/.test(error));
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
