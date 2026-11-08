// 06.1 · «Para ti»: recomendaciones con su porqué. Primero solo con gustos declarados (sin mirar
// la biblioteca); luego, con permiso, también con la biblioteca, sin los libros confidenciales y
// sin enviar nunca un título. Lo que ya se tiene y lo descartado no se recomiendan. «Afinar con
// IA» solo enseña lo que existe en Open Library. «Desactivar» y «Borrar mis gustos» lo quitan.
// Open Library, Google y la IA simulados por CDP.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/para-ti`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Para ti (${BASE})`);
const browser = await openChrome({ port: 9417, profile: `${PROFILE_ROOT}-para-ti` });
const page = await browser.newPage();
await page.viewport(1366, 900);
const { userAgent } = await browser.send("Browser.getVersion");
await page.send("Emulation.setUserAgentOverride", { acceptLanguage: "es-PE,es", userAgent });

const epub = (title) =>
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body><p>${title}</p></body></html>`),
  });
writeFileSync(`${work}/Rayuela - Julio Cortázar.epub`, epub("Rayuela"));
writeFileSync(`${work}/Diario intimo - Ana Secreta.epub`, epub("Diario intimo"));

// ---- Open Library, Google y la IA simulados ----------------------------------------------------------------------------
const doc = (key, title, author, extra = {}) => ({ author_name: [author], cover_i: 100, first_publish_year: 1980, key, ratings_average: 4.2, ratings_count: 50, title, ...extra });
const bySubject = {
  "magic realism": [
    doc("/works/OL1W", "La casa de los espíritus", "Isabel Allende"),
    doc("/works/OL2W", "Cien años de soledad", "Gabriel García Márquez"),
    doc("/works/OL3W", "Rayuela", "Julio Cortázar"),
    doc("/works/OL4W", "海辺のカフカ", "Haruki Murakami", { editions: { docs: [{ isbn: ["9788483835241"], language: ["spa"], title: "Kafka en la orilla" }] } }),
  ],
};
const byAuthor = {
  "Isabel Allende": [doc("/works/OL1W", "La casa de los espíritus", "Isabel Allende"), doc("/works/OL5W", "Eva Luna", "Isabel Allende")],
  "Julio Cortázar": [doc("/works/OL3W", "Rayuela", "Julio Cortázar"), doc("/works/OL6W", "Bestiario", "Julio Cortázar")],
  "Ana Secreta": [doc("/works/OL9W", "No debería salir", "Ana Secreta")],
};
const byTitle = { "Pedro Páramo": [doc("/works/OL7W", "Pedro Páramo", "Juan Rulfo")] };
const openLibrary = [];
const aiCalls = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://openlibrary.org/*" }, { urlPattern: "https://covers.openlibrary.org/*" }, { urlPattern: "https://www.googleapis.com/*" }, { urlPattern: "*/api/ai/recommend" }] });
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const url = new URL(request.url);
  const json = (body, code = 200) =>
    page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
  if (url.host === "covers.openlibrary.org") return page.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "image/png" }], body: pixel.toString("base64") }).catch(() => {});
  if (url.host === "www.googleapis.com") return json({ items: [] });
  if (url.pathname === "/api/ai/recommend") {
    aiCalls.push(JSON.parse(request.postData ?? "{}"));
    return json({ result: { suggestions: [{ author: "Juan Rulfo", reason: "Un clásico del realismo mágico.", title: "Pedro Páramo" }, { author: "Nadie Nadie", reason: "Inventado.", title: "El libro inventado" }] }, usage: { inputTokens: 80, outputTokens: 60 } });
  }
  openLibrary.push(url);
  const subject = /subject:"([^"]+)"/.exec(url.searchParams.get("q") ?? "")?.[1];
  const docs = subject ? (bySubject[subject] ?? []) : url.searchParams.get("title") ? (byTitle[url.searchParams.get("title")] ?? []) : (byAuthor[url.searchParams.get("author")] ?? []);
  return json({ docs, numFound: docs.length });
});

// ---- Dos libros; el diario, confidencial -------------------------------------------------------------------------------
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Rayuela - Julio Cortázar.epub`, `${work}/Diario intimo - Ana Secreta.epub`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 2`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
// El título del mosaico sale del nombre del archivo («Diario intimo   Ana Secreta»): se busca por patrón.
const diaryId = await page.eval(`(() => { const article = [...document.querySelectorAll("article[aria-label]")].find((a) => /^Diario intimo/.test(a.getAttribute("aria-label"))); return article ? new URL(article.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document") : null; })()`);
t.check("el diario está en la biblioteca, para marcarlo confidencial", Boolean(diaryId));
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-sensitivity-v1", JSON.stringify({ consents: {}, documents: { ${JSON.stringify(diaryId)}: "confidencial" }, sources: {} })), localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini" })), true)`);

// ---- Solo con gustos declarados ---------------------------------------------------------------------------------------------
await page.goto(`${BASE}/app/para-ti`);
await page.waitFor(`document.querySelector("#taste-author")`, { timeout: 20000 });
const button = (label) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
t.check("sin gustos, no se puede pedir nada todavía", await page.eval(`${button("Ver recomendaciones")}.disabled`));
await page.eval(`(${button("Realismo mágico")}.click(), true)`);
const setInput = (selector, value) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
await setInput("#taste-author", "Isabel Allende");
await page.sleep(150);
await page.eval(`(${button("Añadir")}.click(), true)`);
await page.sleep(150);
t.check("los temas se marcan como botones pulsados y el autor queda en la lista", await page.eval(`${button("Realismo mágico")}.getAttribute("aria-pressed") === "true" && /Isabel Allende/.test(document.querySelector("ul[aria-label='Autores elegidos']")?.textContent ?? "")`));
await page.eval(`(${button("Ver recomendaciones")}.click(), true)`);
const cards = `[...document.querySelectorAll("li[data-recommendation]")]`;
await page.waitFor(`${cards}.length > 0`, { timeout: 20000 });
await page.sleep(300);
const list = () => page.eval(`${cards}.map((li) => ({ key: li.dataset.recommendation, title: li.querySelector("h3").textContent, reasons: [...li.querySelectorAll("ul[aria-label] li")].map((r) => r.textContent) }))`);
let shown = await list();
const declaredSearches = openLibrary.map((url) => url.searchParams.get("q") + "|" + (url.searchParams.get("author") ?? ""));
t.check("solo con gustos declarados: busca el tema y el autor elegidos, y nada de la biblioteca", openLibrary.length === 2 && declaredSearches.some((s) => s.includes('subject:"magic realism"')) && declaredSearches.some((s) => s.endsWith("|Isabel Allende")) && !declaredSearches.some((s) => /Cort|Secreta/.test(s)), declaredSearches.join(" ; "));
t.check(
  "la primera reúne dos razones y dice por qué",
  shown[0]?.title === "La casa de los espíritus" && shown[0].reasons.join() === "Porque te interesa: realismo mágico,De Isabel Allende, que te gusta",
  JSON.stringify(shown[0]),
);
t.check("lo que ya tienes no se recomienda (Rayuela)", !shown.some((item) => item.title === "Rayuela"), shown.map((item) => item.title).join(" · "));
t.check("un título en japonés sale con su edición en español", shown.some((item) => item.title === "Kafka en la orilla"));
await page.screenshot(`${work}/1-declarados.png`);

// ---- Dónde conseguirlo y No me interesa ------------------------------------------------------------------------------------
await page.eval(`([...document.querySelectorAll("li[data-recommendation]")].find((li) => li.querySelector("h3").textContent === "Kafka en la orilla").querySelector("button").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("[role=dialog]")].some((d) => /Dónde conseguirlo/.test(d.textContent))`, { timeout: 10000 });
const offer = await page.eval(`[...[...document.querySelectorAll("[role=dialog]")].find((d) => /Dónde conseguirlo/.test(d.textContent)).querySelectorAll("a")].find((a) => /buscalibre/.test(a.href))?.getAttribute("href")`);
t.check("«Dónde conseguirlo» busca en Buscalibre Perú con el ISBN de la edición en español", offer === "https://www.buscalibre.pe/libros/search?q=9788483835241", offer);
await page.key("Escape", { code: "Escape", keyCode: 27 });
await page.sleep(300);
await page.eval(`([...document.querySelectorAll("li[data-recommendation]")].find((li) => li.querySelector("h3").textContent === "Cien años de soledad").querySelectorAll("button")[1].click(), true)`);
await page.sleep(500);
t.check("«No me interesa» la quita", !(await list()).some((item) => item.title === "Cien años de soledad"));
await page.goto(`${BASE}/app/para-ti?carga=1`);
await page.waitFor(`${cards}.length > 0`, { timeout: 20000 });
t.check("y no vuelve al recargar", !(await list()).some((item) => item.title === "Cien años de soledad"));

// ---- Con la biblioteca: sin el confidencial y sin títulos ------------------------------------------------------------------
const before = openLibrary.length;
await page.eval(`(${button("Editar mis gustos")}.click(), true)`);
await page.waitFor(`document.querySelector("#taste-author")`, { timeout: 10000 });
await page.eval(`(() => { const input = [...document.querySelectorAll("input[type=checkbox]")].find((i) => /Usar también mi biblioteca/.test((i.closest("label") ?? document.querySelector("label[for='" + i.id + "']"))?.textContent ?? "")); input?.click(); return Boolean(input); })()`);
await page.sleep(200);
await page.eval(`(${button("Guardar mis gustos")}.click(), true)`);
await page.waitFor(`${cards}.some((li) => /Bestiario/.test(li.textContent))`, { timeout: 20000 }).catch(() => {});
shown = await list();
const librarySearches = openLibrary.slice(before).map((url) => `${url.searchParams.get("q")}|${url.searchParams.get("author") ?? ""}`);
t.check("con la biblioteca, busca también al autor que lees (Cortázar)", librarySearches.some((s) => s.endsWith("|Julio Cortázar")), librarySearches.join(" ; "));
t.check("pero nunca al del libro confidencial", !openLibrary.some((url) => /Secreta/.test(url.href)));
t.check("ni ningún título de la biblioteca", !openLibrary.some((url) => /Rayuela|Diario/i.test(decodeURIComponent(url.search))));
t.check("y dice por qué: «De Julio Cortázar, a quien lees»", shown.some((item) => item.title === "Bestiario" && item.reasons.includes("De Julio Cortázar, a quien lees")), JSON.stringify(shown.find((item) => item.title === "Bestiario")));

// ---- Afinar con IA ---------------------------------------------------------------------------------------------------------
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await setInput("#ai-api-key", "AIzaSy" + "x".repeat(33));
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}
// Sin recargar (la clave vive en la pestaña): a Inicio y a «Ver recomendaciones».
await page.eval(`(document.querySelector("a[href='/app']").click(), true)`);
await page.waitFor(`document.querySelector("a[href='/app/para-ti']")`, { timeout: 20000 });
await page.eval(`(document.querySelector("a[href='/app/para-ti']").click(), true)`);
await page.waitFor(`${cards}.length > 0 && !${button("Afinar con IA")}?.disabled`, { timeout: 20000 });
await page.eval(`(${button("Afinar con IA")}.click(), true)`);
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
await page.waitFor(dialog, { timeout: 10000 });
const asked = await page.eval(`(${dialog}).textContent`);
t.check("antes de enviar, dice qué temas y autores van a la IA (no títulos)", /Temas: Realismo mágico/.test(asked) && /Autores: Isabel Allende, Julio Cortázar/.test(asked) && !/Rayuela|Secreta/.test(asked), asked.slice(0, 260));
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Afinar").click(), true)`);
await page.waitFor(`/Tu IA propuso/.test(document.body.textContent)`, { timeout: 20000 }).catch(() => {});
shown = await list();
t.check("solo enseña lo que existe en Open Library, y primero", shown[0]?.title === "Pedro Páramo" && /Sugerido por tu IA: Un clásico del realismo mágico/.test(shown[0].reasons.join()) && !shown.some((item) => item.title === "El libro inventado"), JSON.stringify(shown[0]));
t.check("y lo dice: propuso 2, existe 1", /Tu IA propuso 2 libros; 1 existe en Open Library/.test(await page.eval(`document.body.textContent`)));
t.check("a la IA solo le llegaron gustos, sin títulos de la biblioteca", aiCalls.length === 1 && !/Rayuela|Diario|Secreta/.test(JSON.stringify(aiCalls[0])) && aiCalls[0].provider === "gemini", JSON.stringify(aiCalls[0]));
await page.screenshot(`${work}/2-con-ia.png`);

// ---- En el móvil cabe ----------------------------------------------------------------------------------------------------------
await page.viewport(390, 844, { dpr: 2, mobile: true });
await page.sleep(500);
const fit = await page.eval(`({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })`);
t.check("en el móvil, sin desplazamiento lateral", fit.scroll <= fit.width, JSON.stringify(fit));
await page.viewport(1366, 900);
await page.sleep(300);

// ---- Desactivar y borrar --------------------------------------------------------------------------------------------------------
await page.eval(`(${button("Desactivar recomendaciones")}.click(), true)`);
await page.waitFor(dialog, { timeout: 10000 });
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Desactivar").click(), true)`);
await page.waitFor(`document.querySelector("#taste-author")`, { timeout: 10000 }).catch(() => {});
const afterDisable = await page.eval(`({ taste: JSON.parse(localStorage.getItem("pliegue-taste-v1") ?? "null"), cache: localStorage.getItem("pliegue-recommendations-v1") })`);
t.check("«Desactivar» deja de recomendar y olvida lo recomendado (los gustos quedan)", afterDisable.taste?.enabled === false && afterDisable.cache === null && afterDisable.taste.subjects.includes("realismo-magico"));
await page.eval(`(${button("Ver recomendaciones")}.click(), true)`);
await page.waitFor(`${button("Borrar mis gustos")}`, { timeout: 15000 });
await page.eval(`(${button("Borrar mis gustos")}.click(), true)`);
await page.waitFor(dialog, { timeout: 10000 });
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Borrar mis gustos").click(), true)`);
await page.sleep(500);
const afterClear = await page.eval(`({ taste: localStorage.getItem("pliegue-taste-v1"), cache: localStorage.getItem("pliegue-recommendations-v1"), form: Boolean(document.querySelector("#taste-author")), pressed: document.querySelectorAll("[aria-pressed=true]").length })`);
t.check("«Borrar mis gustos» lo borra todo y vuelve a empezar", afterClear.taste === null && afterClear.cache === null && afterClear.form && afterClear.pressed === 0, JSON.stringify(afterClear));

const errors = page.errors;
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
