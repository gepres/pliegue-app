// 04.4 · Buscar en los libros: indexar trocea cada libro en el equipo (con su página o su sección)
// y, antes de mandar nada, dice cuánto saldrá y a quién. Los vectores se calculan con Gemini
// (simulado); un libro confidencial se queda solo con la búsqueda por palabras. La búsqueda es
// híbrida: una pregunta sin palabras en común encuentra el fragmento por su significado.
// Reindexar no repite lo hecho. Nada sale fuera.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/busqueda-semantica`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Buscar en los libros (${BASE})`);
const browser = await openChrome({ port: 9403, profile: `${PROFILE_ROOT}-busqueda-semantica` });
const page = await browser.newPage();
await page.viewport(1366, 900);

// ---- Los libros ----------------------------------------------------------------------------------------
const epub = (title, chapters) => {
  const files = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(
      `<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">es</dc:language></metadata><manifest>${chapters
        .map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml" />`)
        .join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}" />`).join("")}</spine></package>`,
    ),
  };
  chapters.forEach(([heading, text], i) => {
    files[`c${i}.xhtml`] = strToU8(`<html><body><h1>${heading}</h1>${text.map((p) => `<p>${p}</p>`).join("")}</body></html>`);
  });
  return zipSync(files);
};
writeFileSync(
  `${work}/Jardin.epub`,
  epub("Jardin", [
    ["Las flores", ["Las flores del jardín se abren al amanecer.", "Cada mañana regaba las flores con paciencia."]],
    ["El laberinto", ["En el centro había un laberinto de setos altos.", "Quien entraba en el laberinto tardaba horas en salir."]],
  ]),
);
writeFileSync(`${work}/Diario.epub`, epub("Diario", [["Mi diario", ["Este es mi diario secreto: nadie debe leerlo.", "Hoy escribí sobre el río."]]]));

await page.viewport(900, 1200);
await page.goto(
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>Anaqueles</title></head><body style="font:16px/1.5 Georgia">` +
      `<h1>Anaqueles</h1><p>La biblioteca guarda libros en anaqueles infinitos.</p><p>Los bibliotecarios recorren los anaqueles sin descanso.</p>` +
      `<div style="break-before: page"><h2>Reflejos</h2><p>En cada pasillo hay un espejo que duplica las apariencias.</p><p>El espejo hace creer que la biblioteca no termina.</p></div>` +
      `</body></html>`,
  )}`,
);
await page.sleep(200);
const { data: pdf } = await page.send("Page.printToPDF", { printBackground: true });
writeFileSync(`${work}/Anaqueles.pdf`, Buffer.from(pdf, "base64"));
await page.viewport(1366, 900);

// ---- Gemini simulado: vectores por conceptos -------------------------------------------------------------
const concepts = [
  ["laberinto", "bifurcan", "senderos", "caminos"],
  ["jardin", "flores"],
  ["biblioteca", "libros", "anaqueles"],
  ["espejo", "espejos", "reflejo", "reflejos", "duplica"],
  ["rio", "agua"],
  ["diario", "secreto"],
];
const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function fakeVector(text) {
  const words = plain(text).split(/[^a-z0-9]+/);
  const vector = new Array(768).fill(0);
  vector[700] = 0.05;
  concepts.forEach((group, dim) => {
    for (const word of words) if (group.includes(word)) vector[dim] += 1;
  });
  return vector;
}
const embedCalls = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/embed" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const body = JSON.parse(request.postData ?? "{}");
  embedCalls.push(body);
  const vectors = (body.texts ?? []).map(fakeVector);
  const chars = (body.texts ?? []).reduce((sum, text) => sum + text.length, 0);
  page
    .send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify({ dimensions: 768, model: body.model, usage: { inputTokens: Math.ceil(chars / 4), outputTokens: 0 }, vectors })).toString("base64"),
    })
    .catch(() => {});
});

// ---- Importar y marcar el diario como confidencial ---------------------------------------------------------
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini", concurrency: 1 })), true)`);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", ["Jardin.epub", "Diario.epub", "Anaqueles.pdf"].map((name) => `${work}/${name}`));
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 3`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const ids = await page.eval(`Object.fromEntries([...document.querySelectorAll("article[aria-label]")].map((a) => [a.getAttribute("aria-label"), new URL(a.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")]))`);
t.check("se importan los tres libros", ids.Jardin && ids.Diario && ids.Anaqueles, JSON.stringify(Object.keys(ids)));
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-sensitivity-v1", JSON.stringify({ consents: {}, documents: { ${JSON.stringify(ids.Diario)}: "confidencial" }, sources: {} })), true)`);

// La clave de prueba vive solo en memoria: se pega y se navega sin recargar.
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "AIzaSy" + "x".repeat(33)); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`document.querySelector("#semantic-search-title")`, { timeout: 20000 });
const state = () => page.eval(`document.querySelector("[data-testid=semantic-state]")?.textContent ?? ""`);
await page.waitFor(`/de 3/.test(document.querySelector("[data-testid=semantic-state]")?.textContent ?? "")`, { timeout: 20000 });
t.check("al empezar: 0 libros indexados de 3", /^0 libros indexados de 3/.test(await state()), await state());

// ---- Indexar: trocea, dice lo que saldrá, y calcula -----------------------------------------------------------
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(dialog, { timeout: 30000 });
const asked = await page.eval(`(() => { const d = ${dialog}; return { title: d.querySelector("h2")?.textContent, text: d.textContent.replace(/\\s+/g, " ") }; })()`);
t.check(
  "antes de mandar nada, dice cuánto y a quién: 2 libros (no el confidencial), fragmentos, caracteres y tokens",
  asked.title === "¿Calcular la búsqueda por significado?" && /el texto de 2 libros/.test(asked.text) && /fragmentos · \d+ caracteres/.test(asked.text) && /tokens/.test(asked.text) && /gemini-embedding-001/.test(asked.text),
  asked.text.slice(0, 260),
);
t.check("y hasta aceptar, no se ha enviado nada", embedCalls.length === 0);
await page.screenshot(`${work}/1-antes-de-enviar.png`);
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Enviar y calcular").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("[role=status]")].some((p) => /^Listo\\./.test(p.textContent.trim()))`, { timeout: 60000 }).catch(() => {});
const sentTexts = embedCalls.flatMap((call) => call.texts ?? []);
t.check(
  "se pide a Gemini con su modelo, 768 dimensiones y como fragmentos",
  embedCalls.length > 0 && embedCalls.every((call) => call.model === "gemini-embedding-001" && call.dimensions === 768 && call.purpose === "document"),
  JSON.stringify(embedCalls.map((call) => [call.model, call.dimensions, call.purpose, call.texts?.length])),
);
t.check("salen los fragmentos del jardín y de la biblioteca", sentTexts.some((text) => /laberinto/.test(text)) && sentTexts.some((text) => /espejo/.test(text)));
t.check("el diario confidencial no sale", !sentTexts.some((text) => /diario|secreto/i.test(text)));
await page.waitFor(`/^3 libros indexados de 3 · 2 con búsqueda por significado/.test(document.querySelector("[data-testid=semantic-state]")?.textContent ?? "")`, { timeout: 10000 }).catch(() => {});
t.check("estado: 3 indexados, 2 con búsqueda por significado", /^3 libros indexados de 3 · 2 con búsqueda por significado/.test(await state()), await state());

// Las ubicaciones guardadas: el PDF, por página y con rectángulos; el EPUB, por sección.
const stored = await page.eval(`new Promise((ok) => { const r = indexedDB.open("pliegue-semantic-index"); r.onsuccess = () => { const db = r.result; const all = db.transaction("chunks").objectStore("chunks").getAll(); all.onsuccess = () => { ok(all.result.map((c) => ({ documentId: c.documentId, location: c.location, text: c.text, vector: c.vector ? c.vector.data.length : 0 }))); db.close(); }; }; })`);
const pdfChunks = stored.filter((chunk) => chunk.documentId === ids.Anaqueles);
const mirror = pdfChunks.find((chunk) => /espejo/.test(chunk.text));
t.check(
  "PDF: cada fragmento sabe su página y dónde está en ella",
  pdfChunks.length >= 2 && mirror?.location.kind === "page" && mirror.location.page === 2 && mirror.location.rects.length > 0 && mirror.location.rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.001 && r.y + r.h <= 1.001),
  JSON.stringify(mirror?.location).slice(0, 200),
);
const maze = stored.find((chunk) => chunk.documentId === ids.Jardin && /laberinto/.test(chunk.text));
t.check("EPUB: el fragmento sabe su sección, su título y sus bloques", maze?.location.kind === "section" && maze.location.title === "El laberinto" && maze.location.section === 1, JSON.stringify(maze?.location));
t.check("el diario tiene fragmentos (palabras) pero no vectores", stored.filter((c) => c.documentId === ids.Diario).length > 0 && stored.filter((c) => c.documentId === ids.Diario).every((c) => c.vector === 0));
t.check("los vectores se guardan en 8 bits, 768 por fragmento", stored.filter((c) => c.vector).every((c) => c.vector === 768));

// ---- Buscar ------------------------------------------------------------------------------------------------------
async function search(text) {
  await page.eval(`(() => { const el = document.querySelector("#semantic-query"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(200);
  const before = embedCalls.length;
  await page.eval(`(document.querySelector("form[role=search] button[type=submit]").click(), true)`);
  await page.waitFor(`document.querySelector("section[aria-label='Resultados de «${text}»']")`, { timeout: 15000 });
  await page.sleep(200);
  const hits = await page.eval(`[...document.querySelectorAll("section[aria-label^='Resultados'] li")].map((li) => ({ book: li.querySelector("a")?.textContent, href: li.querySelector("a")?.getAttribute("href"), where: li.querySelector("p span")?.textContent, signals: [...li.querySelectorAll("p:last-child span")].map((s) => s.textContent).join("+"), text: li.textContent }))`);
  return { hits, queries: embedCalls.slice(before) };
}
let found = await search("caminos que se bifurcan");
t.check(
  "por significado: «caminos que se bifurcan» encuentra el laberinto sin palabras en común",
  found.hits[0]?.book === "Jardin" && found.hits[0]?.where === "El laberinto" && found.hits[0]?.signals === "Por significado",
  JSON.stringify(found.hits.slice(0, 2)),
);
t.check("y no trae fragmentos lejanos solo por parecerse un poco", found.hits.length === 1, String(found.hits.length));
t.check("la pregunta se manda como pregunta (no los libros)", found.queries.length === 1 && found.queries[0].purpose === "query" && found.queries[0].texts[0] === "caminos que se bifurcan");
t.check(
  "el resultado lleva al libro, a ese fragmento",
  found.hits[0]?.href?.startsWith(`/app/lector?document=${encodeURIComponent(ids.Jardin)}&fragmento=${encodeURIComponent(`${ids.Jardin}#`)}`),
  found.hits[0]?.href,
);
await page.eval(`(document.querySelector("#semantic-search-title").scrollIntoView({ block: "start" }), true)`);
await page.sleep(300);
await page.screenshot(`${work}/2-resultados.png`);

found = await search("espejo");
t.check("por palabras y significado: «espejo» da la página 2 del PDF", found.hits[0]?.book === "Anaqueles" && found.hits[0]?.where === "p. 2" && /Por palabras/.test(found.hits[0]?.signals ?? ""), JSON.stringify(found.hits[0]));

found = await search("secreto");
const secret = found.hits.find((hit) => hit.book === "Diario");
t.check("el confidencial se encuentra por palabras, en el equipo", secret && secret.signals === "Por palabras", JSON.stringify(found.hits));

// ---- Reindexar no repite --------------------------------------------------------------------------------------------
const calls = embedCalls.length;
const button = await page.eval(`[...document.querySelectorAll("button")].find((b) => /^(Indexar|Todo indexado)/.test(b.textContent.trim()))?.textContent.trim()`);
t.check("con todo hecho, no hay nada que indexar", button === "Todo indexado", button);
t.check("y no se ha vuelto a enviar nada", embedCalls.length === calls);

// ---- En el móvil cabe ------------------------------------------------------------------------------------------------
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.sleep(600);
await page.eval(`(document.querySelector("#semantic-search-title").scrollIntoView({ block: "start" }), true)`);
const overflow = await page.eval(`(() => { const s = document.querySelector("#semantic-search-title").closest("section").getBoundingClientRect(); return { right: Math.round(s.right), width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }; })()`);
t.check("en el móvil, el panel cabe sin desplazamiento lateral", overflow.right <= overflow.width && overflow.scroll <= overflow.width, JSON.stringify(overflow));
await page.screenshot(`${work}/3-movil.png`);
await page.viewport(1366, 900);

// ---- Abrir el resultado en su sitio ------------------------------------------------------------------------------------
const inView = (selector) =>
  page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.bottom > 0 && r.top < innerHeight, text: el.textContent.trim().slice(0, 80) }; })()`);
found = await search("espejo");
await page.eval(`([...document.querySelectorAll("section[aria-label^='Resultados'] li a")].find((a) => a.textContent === "Anaqueles").click(), true)`);
const pdfHit = await page.waitFor(`document.querySelector("[data-page-number='2'] [data-search-hit]")`, { timeout: 30000 }).then(() => true, () => false);
await page.sleep(1200);
const pdfHits = await page.eval(`document.querySelectorAll("[data-page-number='2'] [data-search-hit]").length`);
const pdfSpot = await inView("[data-page-number='2'] [data-search-hit]");
t.check("el resultado del PDF abre la página 2 con sus renglones resaltados", pdfHit && pdfHits >= 2 && pdfSpot?.visible, `${pdfHits} renglones · ${JSON.stringify(pdfSpot)}`);
t.check("y no resalta nada en la página 1", (await page.eval(`document.querySelectorAll("[data-page-number='1'] [data-search-hit]").length`)) === 0);
await page.screenshot(`${work}/4-pdf-resaltado.png`);

await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`document.querySelector("#semantic-query")`, { timeout: 20000 });
found = await search("caminos que se bifurcan");
await page.eval(`([...document.querySelectorAll("section[aria-label^='Resultados'] li a")].find((a) => a.textContent === "Jardin").click(), true)`);
const blockHit = await page.waitFor(`document.querySelector("[data-search-hit]")`, { timeout: 30000 }).then(() => true, () => false);
await page.sleep(1200);
const blockSpot = await inView("[data-search-hit]");
const marked = await page.eval(`[...document.querySelectorAll("[data-search-hit]")].map((el) => el.textContent.trim())`);
t.check(
  "el resultado del EPUB abre la sección y resalta sus bloques, a la vista",
  blockHit && blockSpot?.visible && marked.some((text) => /laberinto/.test(text)) && !marked.some((text) => /flores/.test(text)),
  JSON.stringify(marked),
);
await page.screenshot(`${work}/5-epub-resaltado.png`);

// ---- El registro de la IA lo cuenta ------------------------------------------------------------------------------------
await page.eval(`(document.querySelector("a[href^='/app/ajustes']").click(), true)`);
await page.waitFor(`document.querySelector("a[href^='/app/ajustes']")`);
await page.eval(`(location.hash = "ia", true)`);
await page.waitFor(`document.querySelectorAll("ol[aria-label=Registro] li").length >= 3`, { timeout: 20000 }).catch(() => {});
const log = await page.eval(`[...document.querySelectorAll("ol[aria-label=Registro] li")].map((li) => li.textContent.replace(/\\s+/g, " "))`);
t.check("el registro apunta lo indexado con Gemini, en fragmentos", log.some((row) => /^Indexar/.test(row) && /Jardin/.test(row) && /fragmentos?/.test(row) && /Gemini · gemini-embedding-001/.test(row)), log.join(" | ").slice(0, 300));
t.check("y que el diario no salió", log.some((row) => /^Indexar/.test(row) && /Diario/.test(row) && /No salió del equipo: es confidencial/.test(row)));
const local = await page.eval(`localStorage.getItem("pliegue-ai-processing-v1") ?? ""`);
t.check("sin textos de los libros en el registro", !/laberinto|espejo|secreto/.test(local));

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
