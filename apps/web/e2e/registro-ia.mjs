// 04.6 · Registro de la IA: qué libro pasó por qué proveedor, sin textos ni claves; lo que el
// router de sensibilidad no dejó salir, con su razón; borrar lo que devolvió la IA de un libro,
// descargar el registro y borrarlo. Caduca a los 90 días. Gemini simulado y una clave de prueba
// solo en memoria; nada sale fuera.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/registro-ia`;
const downloads = resolve(`${work}/descargas`);
rmSync(work, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });
const t = checker(`Registro de la IA (${BASE})`);
const browser = await openChrome({ port: 9402, profile: `${PROFILE_ROOT}-registro-ia` });
const page = await browser.newPage();
await page.viewport(1366, 900);
await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads }).catch(() =>
  browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads }),
);

const epub = (title, text) =>
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">en</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body><h1>${title}</h1><p>${text}</p></body></html>`),
  });
const books = { Diario: "My private diary entry.", Publico: "A public essay about rivers." };
for (const [title, text] of Object.entries(books)) writeFileSync(`${work}/${title}.epub`, epub(title, text));
const KEY = "AIzaSy" + "x".repeat(33);

// ---- Gemini simulado ---------------------------------------------------------------------------------
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
    return reply({ catalog: { authors: ["Autora"], canonicalTitle: title, confidence: 0.9, genres: [], language: "en", publicationYear: null, summary: "Resumen.", topics: [], workType: "book" }, usage: { inputTokens: 1200, outputTokens: 300 } });
  }
  const passages = JSON.parse(body || "{}").passages ?? [];
  sent.translate.push(...passages);
  return reply({ translations: passages.map((text) => `[ES] ${text}`), usage: { inputTokens: 40, outputTokens: 40 } });
});

// Ajustes de IA, la fuente de las copias confidencial y una entrada de hace meses, que debe caducar.
const old = { characters: 10, day: "2026-01-02", documentId: "libro-de-enero", engine: null, failed: 0, firstAt: "2026-01-02T10:00:00.000Z", flow: "catalog", lastAt: "2026-01-02T10:00:00.000Z", model: "x", place: "cloud", provider: "openai", route: "allowed", sensitivity: "interno", sent: 1, tokens: 5 };
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini", concurrency: 1, translationProvider: "gemini" })),
  localStorage.setItem("pliegue-sensitivity-v1", JSON.stringify({ consents: {}, documents: {}, sources: { copies: "confidencial" } })),
  localStorage.setItem("pliegue-ai-processing-v1", JSON.stringify([${JSON.stringify(old)}])), true)`);

await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", Object.keys(books).map((title) => `${work}/${title}.epub`));
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 2`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const ids = await page.eval(`Object.fromEntries([...document.querySelectorAll("article[aria-label]")].map((a) => [a.getAttribute("aria-label"), new URL(a.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")]))`);
t.check("se importan los dos libros", ids.Publico && ids.Diario, JSON.stringify(ids));

// «Publico» se marca público; «Diario» se queda con la de su fuente (confidencial).
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-sensitivity-v1", JSON.stringify({ consents: {}, documents: { ${JSON.stringify(ids.Publico)}: "publico" }, sources: { copies: "confidencial" } })), true)`);
await page.goto(`${BASE}/app/ajustes#ia`);
// La clave de prueba vive solo en memoria: se pega y se navega sin recargar.
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(KEY)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}

// ---- Catalogar: el público sale, el confidencial no ----------------------------------------------------
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 30000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(`[...document.querySelectorAll("p, [role=status]")].some((p) => /1 catalogado/.test(p.textContent) && /confidencial sin enviar/.test(p.textContent))`, { timeout: 30000 }).catch(() => {});
t.check("al catalogar sale solo el público", JSON.stringify(sent.catalog) === JSON.stringify(["Publico"]), JSON.stringify(sent.catalog));
// Al terminar se sugiere el siguiente paso: «Ahora no», como haría una persona.
await page.waitFor(`document.querySelector("dialog[open][aria-labelledby^='next-step-title']")`, { timeout: 5000 }).catch(() => {});
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.trim() === "Ahora no")?.click(), true)`);

// ---- Traducir: el público con Gemini; el confidencial se bloquea ------------------------------------------
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
await openBook("Publico");
const translated = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /^\\[ES\\] A public essay/.test(p.textContent.trim()))`, { timeout: 30000 }).then(() => true, () => false);
t.check("el público se traduce con Gemini", translated && sent.translate.some((x) => /public essay/.test(x)), `${sent.translate.length} pasajes`);
await page.sleep(800);
await openBook("Diario");
const blocked = await page.waitFor(`[...document.querySelectorAll("[role=alert]")].some((x) => /Este libro es confidencial/.test(x.textContent))`, { timeout: 15000 }).then(() => true, () => false);
t.check("el confidencial no se traduce con una IA en la nube", blocked && !sent.translate.some((x) => /diary/.test(x)));

// ---- El registro, en Ajustes → IA ------------------------------------------------------------------------
await page.eval(`(document.querySelector("a[href^='/app/ajustes']").click(), true)`);
await page.waitFor(`document.querySelector("a[href^='/app/ajustes']")`);
await page.eval(`(location.hash = "ia", true)`);
await page.waitFor(`document.querySelector("#ai-log-title")`, { timeout: 20000 });
await page.waitFor(`document.querySelectorAll("ol[aria-label=Registro] li").length >= 4`, { timeout: 10000 }).catch(() => {});
await page.eval(`(document.querySelector("#ai-log-title").scrollIntoView({ block: "start" }), true)`);
await page.sleep(400);
await page.screenshot(`${work}/1-registro.png`);

const rows = () =>
  page.eval(`[...document.querySelectorAll("ol[aria-label=Registro] li")].map((li) => ({ place: li.dataset.place, route: li.dataset.route, text: li.textContent.replace(/\\s+/g, " ").trim() }))`);
let list = await rows();
const find = (flow, book) => list.find((row) => row.text.startsWith(flow) && row.text.includes(book));
const catalogPublic = find("Catalogar", "Publico");
const translatePublic = find("Traducir", "Publico");
const catalogDiary = find("Catalogar", "Diario");
const translateDiary = find("Traducir", "Diario");
t.check(
  "catalogar «Publico»: Gemini y su modelo, fuera del equipo, 1 ficha, caracteres y tokens",
  catalogPublic && /Gemini · gemini/.test(catalogPublic.text) && /Fuera del equipo/.test(catalogPublic.text) && /1 ficha/.test(catalogPublic.text) && /1\.?500 tokens/.test(catalogPublic.text) && /Sensibilidad: Público/.test(catalogPublic.text),
  catalogPublic?.text,
);
t.check(
  "traducir «Publico»: páginas o secciones y caracteres enviados",
  translatePublic && /Gemini/.test(translatePublic.text) && /p[aá]gina|secci/.test(translatePublic.text) && /caracteres enviados/.test(translatePublic.text),
  translatePublic?.text,
);
t.check(
  "catalogar «Diario»: no salió del equipo, es confidencial, sin nada enviado",
  catalogDiary && catalogDiary.route === "kept-local" && /No salió del equipo: es confidencial/.test(catalogDiary.text) && /No se envió nada/.test(catalogDiary.text) && /Proveedor elegido: Gemini/.test(catalogDiary.text) && /no lo recibió/.test(catalogDiary.text) && !/Fuera del equipo/.test(catalogDiary.text),
  catalogDiary?.text,
);
t.check("traducir «Diario»: también queda apuntado que no salió", translateDiary && translateDiary.route === "kept-local", translateDiary?.text);
const summary = await page.eval(`document.querySelector("#ai-log-title").closest("section").querySelector("dl").textContent.replace(/\\s+/g, " ")`);
t.check("el resumen: 1 libro fuera (Gemini), 1 que no salió", /Salieron del equipo\s*1 libro · Gemini/.test(summary) && /No salieron por su sensibilidad\s*1 libro/.test(summary), summary);

const stored = await page.eval(`localStorage.getItem("pliegue-ai-processing-v1") ?? ""`);
t.check("lo guardado no lleva textos de los libros ni la clave", stored.length > 0 && !/public essay|diary|rivers|Resumen|AIzaSy/.test(stored), `${stored.length} bytes`);
t.check("lo de hace más de 90 días caducó al abrir el panel", !stored.includes("libro-de-enero") && !list.some((row) => /enero/.test(row.text)));

// Filtro «No salieron»: con el ratón, en el botón que se ve.
async function pressSegment(label) {
  const box = await page.eval(`(() => {
    const button = [...document.querySelectorAll("[role=radiogroup][aria-label='Qué enseñar'] [role=radio]")].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    button.scrollIntoView({ block: "center" });
    const r = button.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === button || button.contains(hit) ? "ok" : (hit?.outerHTML ?? "nada").slice(0, 160) };
  })()`);
  await page.clickAt(box.x, box.y);
  await page.sleep(300);
  return box.hit;
}
const hit = await pressSegment("No salieron");
list = await rows();
t.check("el filtro «No salieron» deja solo lo del confidencial", list.length === 2 && list.every((row) => /Diario/.test(row.text)), `${hit} · ${list.map((row) => row.text.slice(0, 40)).join(" | ")}`);
await pressSegment("Todo");
list = await rows();

// ---- Borrar lo que devolvió la IA ------------------------------------------------------------------------
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
const dialogButton = (text) => page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click(), true)`);
const status = () => page.eval(`document.querySelector("#ai-log-title").closest("section").querySelector("[role=status]")?.textContent ?? ""`);
async function rowButton(flow, book, label) {
  await page.eval(`([...document.querySelectorAll("ol[aria-label=Registro] li")].find((li) => li.textContent.trim().startsWith(${JSON.stringify(flow)}) && li.textContent.includes(${JSON.stringify(book)})).querySelector("button").click(), true)`);
  await page.waitFor(dialog, { timeout: 10000 });
  return page.eval(`(${dialog}).querySelector("h2")?.textContent ?? ""`).then((title) => ({ label, title }));
}
const translationsOf = (id) =>
  page.eval(`new Promise((ok) => { const r = indexedDB.open("pliegue-translations"); r.onsuccess = () => { const db = r.result; const all = db.transaction("units").objectStore("units").getAll(); all.onsuccess = () => { ok(all.result.filter((x) => x.documentId === ${JSON.stringify(id)}).length); db.close(); }; }; r.onerror = () => ok(-1); })`);
const before = await translationsOf(ids.Publico);
let asked = await rowButton("Traducir", "Publico", "Borrar lo traducido");
t.check("«Borrar lo traducido» pregunta antes", /¿Borrar lo traducido de «Publico»\?/.test(asked.title), asked.title);
await dialogButton("Borrar lo traducido");
await page.waitFor(`/Se borr/.test(document.querySelector("#ai-log-title").closest("section").querySelector("[role=status]")?.textContent ?? "")`, { timeout: 10000 }).catch(() => {});
const after = await translationsOf(ids.Publico);
t.check("se borra lo traducido de ese libro con ese motor", before > 0 && after === 0, `${before} → ${after} · ${await status()}`);

asked = await rowButton("Catalogar", "Publico", "Borrar la ficha");
t.check("«Borrar la ficha» pregunta antes", /¿Borrar la ficha de la IA de «Publico»\?/.test(asked.title), asked.title);
await dialogButton("Borrar la ficha");
await page.waitFor(`/ficha/.test(document.querySelector("#ai-log-title").closest("section").querySelector("[role=status]")?.textContent ?? "")`, { timeout: 10000 }).catch(() => {});
const catalogLeft = await page.eval(`new Promise((ok) => { const r = indexedDB.open("pliegue-document-catalog"); r.onsuccess = () => { const db = r.result; const names = [...db.objectStoreNames]; if (!names.length) { ok(-1); return; } const all = db.transaction(names[0]).objectStore(names[0]).getAllKeys(); all.onsuccess = () => { ok(all.result.map(String)); db.close(); }; }; r.onerror = () => ok(-1); })`);
t.check("se borra la ficha de la IA del libro", Array.isArray(catalogLeft) ? !catalogLeft.includes(ids.Publico) : false, `${await status()} · ${JSON.stringify(catalogLeft)}`);
list = await rows();
t.check("el registro sigue diciendo qué se envió (borrar derivados no lo borra)", list.length === 4, String(list.length));

// ---- Descargar el registro --------------------------------------------------------------------------------
await page.click("text=Descargar el registro");
let file = null;
for (let attempt = 0; attempt < 30 && !file; attempt += 1) {
  await page.sleep(200);
  file = readdirSync(downloads).find((name) => /^pliegue-registro-ia-\d{4}-\d{2}-\d{2}\.json$/.test(name)) ?? null;
}
const exported = file && existsSync(`${downloads}/${file}`) ? JSON.parse(readFileSync(`${downloads}/${file}`, "utf8")) : null;
t.check(
  "se descarga en JSON, con títulos y sin textos ni claves",
  exported?.entries?.length === 4 && exported.entries.some((entry) => entry.title === "Publico") && !/public essay|diary|AIzaSy/.test(JSON.stringify(exported)),
  file ?? "sin archivo",
);

// ---- En el móvil cabe ----------------------------------------------------------------------------------------
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.sleep(600);
await page.eval(`(document.querySelector("#ai-log-title").scrollIntoView({ block: "start" }), true)`);
await page.sleep(300);
const overflow = await page.eval(`(() => { const s = document.querySelector("#ai-log-title").closest("section").getBoundingClientRect(); return { right: Math.round(s.right), width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }; })()`);
t.check("en el móvil, el panel cabe sin desplazamiento lateral", overflow.right <= overflow.width && overflow.scroll <= overflow.width, JSON.stringify(overflow));
await page.screenshot(`${work}/2-movil.png`);
await page.viewport(1366, 900);
await page.sleep(400);

// ---- Borrar el registro --------------------------------------------------------------------------------------
await page.click("text=Borrar el registro");
await page.waitFor(dialog, { timeout: 10000 });
await dialogButton("Borrar el registro");
await page.waitFor(`/Todavía no ha pasado/.test(document.querySelector("#ai-log-title").closest("section").textContent)`, { timeout: 10000 }).catch(() => {});
t.check(
  "borrar el registro lo vacía, en pantalla y en el almacenamiento",
  (await page.eval(`localStorage.getItem("pliegue-ai-processing-v1")`)) === null && (await rows()).length === 0,
);

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
