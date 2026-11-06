// 04.3 · Sensibilidad: se marca en la fuente (Ajustes → Fuentes) y cada libro puede cambiarla
// en su menú. Confidencial no sale del equipo (ni a catalogar ni a traducir con una IA en la
// nube); personal pregunta una vez por libro y flujo. Gemini simulado y una clave de prueba solo
// en memoria; nada sale fuera.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/sensibilidad`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Sensibilidad de los libros (${BASE})`);
const browser = await openChrome({ port: 9394, profile: `${PROFILE_ROOT}-sensibilidad` });
const page = await browser.newPage();
await page.viewport(1366, 900);

const epub = (title, text) =>
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">en</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body><h1>${title}</h1><p>${text}</p></body></html>`),
  });
const books = { Cartas: "Letters to an old friend.", Diario: "My private diary entry.", Publico: "A public essay about rivers." };
for (const [title, text] of Object.entries(books)) writeFileSync(`${work}/${title}.epub`, epub(title, text));

// ---- Gemini simulado: qué libros le llegan ----------------------------------------------------------
const sent = { catalog: [], translate: [] };
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/catalog" }, { urlPattern: "*/api/ai/translate" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const reply = (body) =>
    page.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
  const body = request.postData ?? "";
  if (request.url.includes("/api/ai/catalog")) {
    const title = /"title":"([^"]+)"/.exec(body)?.[1] ?? "Libro";
    sent.catalog.push(title);
    return reply({ catalog: { authors: ["Autora"], canonicalTitle: title, confidence: 0.9, genres: [], language: "en", publicationYear: null, summary: "Resumen.", topics: [], workType: "book" }, usage: { inputTokens: 10, outputTokens: 5 } });
  }
  const passages = JSON.parse(body || "{}").passages ?? [];
  sent.translate.push(...passages);
  return reply({ translations: passages.map((text) => `[ES] ${text}`), usage: { inputTokens: 10, outputTokens: 10 } });
});

await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini", concurrency: 1, translationProvider: "gemini" })), true)`);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", Object.keys(books).map((title) => `${work}/${title}.epub`));
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 3`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

// ---- La fuente, confidencial (Ajustes → Fuentes) ------------------------------------------------------
await page.goto(`${BASE}/app/ajustes#fuentes`);
await page.waitFor(`document.querySelector("#sensitivity-copies")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#sensitivity-copies"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "confidencial"); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await page.sleep(300);
  if ((await page.eval(`localStorage.getItem("pliegue-sensitivity-v1") ?? ""`)).includes("confidencial")) break;
}
const marks = JSON.parse((await page.eval(`localStorage.getItem("pliegue-sensitivity-v1")`)) ?? "{}");
t.check("«Copias importadas» queda confidencial", marks.sources?.copies === "confidencial", JSON.stringify(marks.sources));
await page.eval(`(document.querySelector("#sensitivity-title").scrollIntoView({ block: "start" }), true)`);
await page.screenshot(`${work}/1-fuentes.png`);

// ---- Cada libro puede cambiarla desde su menú ----------------------------------------------------------
await page.eval(`(document.querySelector("a[href='/app/biblioteca']").click(), true)`);
await page.waitFor(`document.querySelectorAll("article[aria-label]").length >= 3`, { timeout: 20000 });
await page.sleep(500);
const badges = () =>
  page.eval(`Object.fromEntries([...document.querySelectorAll("article[aria-label]")].map((a) => [a.getAttribute("aria-label"), a.querySelector("[data-level]")?.textContent ?? ""]))`);
let shown = await badges();
t.check("las tres tarjetas lo dicen: «Confidencial»", Object.values(shown).every((x) => /confidencial/i.test(x)), JSON.stringify(shown));

async function setBookLevel(title, level) {
  await page.eval(`([...document.querySelectorAll("article[aria-label]")].find((a) => a.getAttribute("aria-label") === ${JSON.stringify(title)}).querySelector("button[aria-label^='Más acciones']").click(), true)`);
  // Los menús de todas las tarjetas están montados: vale el que se ve.
  const item = `[...document.querySelectorAll("[role=menuitem]")].find((x) => /^Sensibilidad:/.test(x.textContent.trim()) && x.getClientRects().length)`;
  await page.waitFor(`Boolean(${item})`, { timeout: 10000 });
  await page.eval(`(${item}.click(), true)`);
  await page.waitFor(`document.querySelector("dialog[open] input[name=sensitivity]")`, { timeout: 10000 });
  await page.eval(`(document.querySelector("dialog[open] input[name=sensitivity][value=${level}]").click(), true)`);
  await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.trim() === "Guardar").click(), true)`);
  await page.waitFor(`!document.querySelector("dialog[open] input[name=sensitivity]")`, { timeout: 10000 });
}
await setBookLevel("Publico", "publico");
await setBookLevel("Cartas", "personal");
await page.sleep(300);
shown = await badges();
t.check("el libro manda sobre su fuente", shown.Publico === "" && /personal/i.test(shown.Cartas) && /confidencial/i.test(shown.Diario), JSON.stringify(shown));
await page.screenshot(`${work}/2-biblioteca.png`);

// La clave de prueba vive solo en memoria: se pega en Ajustes y se navega sin recargar.
await page.eval(`(document.querySelector("a[href^='/app/ajustes']").click(), true)`);
await page.waitFor(`document.querySelector("a[href^='/app/ajustes']")`);
await page.eval(`(location.hash = "ia", true)`);
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "AIzaSy" + "x".repeat(33)); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}

// ---- Catalogar: lo confidencial no sale; lo personal pregunta ----------------------------------------
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
const readDialog = () => page.eval(`(() => { const d = ${dialog}; return d ? { title: d.querySelector("h2")?.textContent, text: d.textContent.replace(/\\s+/g, " ") } : null; })()`);
const dialogButton = (text) => page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click(), true)`);
const catalogStatus = () => page.eval(`[...document.querySelectorAll("p, [role=status]")].map((p) => p.textContent.trim()).find((x) => /sin enviar|\d+ catalogados?/.test(x)) ?? ""`);

await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 30000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(dialog, { timeout: 10000 });
let asked = await readDialog();
t.check("antes de catalogar un libro personal, pregunta", asked?.title === "¿Enviar un libro personal a Gemini?" && /«Cartas» está marcado como personal/.test(asked.text), asked?.title);
await page.screenshot(`${work}/3-pregunta.png`);
await dialogButton("Ahora no");
await page.waitFor(`[...document.querySelectorAll("p, [role=status]")].some((p) => /sin enviar/.test(p.textContent))`, { timeout: 30000 });
let status = await catalogStatus();
t.check("solo sale el público", JSON.stringify(sent.catalog) === JSON.stringify(["Publico"]), JSON.stringify(sent.catalog));
t.check("y dice por qué los otros no", /1 confidencial sin enviar/.test(status) && /1 personal sin enviar: no diste permiso/.test(status), status);

await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(dialog, { timeout: 10000 });
await dialogButton("Enviar");
await page.waitFor(`[...document.querySelectorAll("p, [role=status]")].some((p) => /1 catalogado/.test(p.textContent))`, { timeout: 30000 }).catch(() => {});
await page.sleep(500);
status = await catalogStatus();
t.check("con permiso, el personal sale; el confidencial, nunca", JSON.stringify(sent.catalog) === JSON.stringify(["Publico", "Cartas"]), `${JSON.stringify(sent.catalog)} · ${status}`);

// ---- Traducir: el confidencial se bloquea con «Tu IA» en la nube -------------------------------------------
async function openBook(title) {
  await page.eval(`(document.querySelector("a[href='/app/biblioteca']").click(), true)`);
  await page.waitFor(`[...document.querySelectorAll("article[aria-label]")].some((a) => a.getAttribute("aria-label") === ${JSON.stringify(title)})`, { timeout: 20000 });
  await page.eval(`([...document.querySelectorAll("article[aria-label]")].find((a) => a.getAttribute("aria-label") === ${JSON.stringify(title)}).querySelector("a[href*='/app/lector?document=']").click(), true)`);
  await page.waitFor(`[...document.querySelectorAll("p")].some((p) => ${JSON.stringify(books[title])} === p.textContent.trim())`, { timeout: 30000 });
  await page.sleep(1000);
  await page.key("t", { code: "KeyT", keyCode: 84, text: "t" });
  await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /Traducir este libro/.test(b.textContent))`, { timeout: 20000 });
  await page.eval(`([...document.querySelectorAll("button")].find((b) => /Traducir este libro/.test(b.textContent.trim())).click(), true)`);
}
await openBook("Diario");
const blocked = await page.waitFor(`[...document.querySelectorAll("[role=alert]")].some((x) => /Este libro es confidencial/.test(x.textContent))`, { timeout: 15000 }).then(() => true, () => false);
await page.sleep(500);
t.check("traducir un confidencial con Gemini se bloquea, sin enviar nada", blocked && sent.translate.length === 0, `${sent.translate.length} pasajes enviados`);
t.check("y ofrece hacerlo en el equipo", await page.eval(`[...document.querySelectorAll("a")].some((a) => a.textContent.trim() === "Usar Ollama" && a.getAttribute("href") === "/app/ajustes#ia")`));
await page.screenshot(`${work}/4-confidencial.png`);

// ---- El personal pide su permiso de traducir (aparte del de catalogar) -----------------------------------
await openBook("Cartas");
await page.waitFor(dialog, { timeout: 10000 });
asked = await readDialog();
t.check("traducir un personal pregunta (otro flujo, otro permiso)", asked?.title === "¿Enviar un libro personal a Gemini?" && /Para traducirlo/.test(asked.text), asked?.text?.slice(0, 120));
await dialogButton("Enviar");
const translated = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /^\\[ES\\] Letters/.test(p.textContent.trim()))`, { timeout: 30000 }).then(() => true, () => false);
t.check("y con el permiso, se traduce", translated && sent.translate.some((x) => /Letters/.test(x)), `${sent.translate.length} pasajes`);
t.check("nada del confidencial salió en ningún momento", ![...sent.catalog, ...sent.translate].some((x) => /Diario|diary/.test(x)));

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
