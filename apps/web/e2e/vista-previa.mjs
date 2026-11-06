// 03.6: vista previa antes de los cambios masivos.
// A) «Unificar nombres»: enseña cada unión, deja desmarcar, aplica solo lo aceptado, y catalogar
//    ya no unifica solo (la ruta del catálogo se simula con CDP).
// B) «Importar índice JSON»: libro a libro, qué dato pasa de qué a qué; Cancelar no escribe.
// Chrome sin ventana, perfil temporal, nada fuera (https bloqueado).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/vista-previa`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Vista previa antes de cambios masivos (${BASE})`);
const browser = await openChrome({ port: 9388, profile: `${PROFILE_ROOT}-vista-previa` });
const page = await browser.newPage();

// ---- Libros: PDF con texto ---------------------------------------------------------------------
const vocabulary = "alma cuerpo razón deseo virtud ciudad mundo tiempo verdad bien mal dios hombre naturaleza ley orden libertad juicio memoria lenguaje".split(" ");
const prose = (seed, words) => {
  let state = [...seed].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7) >>> 0;
  return Array.from({ length: words }, () => vocabulary[((state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8) % vocabulary.length]).join(" ");
};
await page.viewport(900, 1200);
async function textPdf(path, title, text) {
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p style="font:15px/1.5 Georgia">${text}</p></body></html>`)}`);
  await page.sleep(150);
  writeFileSync(path, Buffer.from((await page.send("Page.printToPDF", {})).data, "base64"));
}
await textPdf(`${work}/Meditaciones.pdf`, "Meditaciones", prose("meditaciones", 600));
await textPdf(`${work}/Etica.pdf`, "Etica", prose("etica", 600));
await textPdf(`${work}/Laberintos.pdf`, "Laberintos", prose("laberintos", 600));

// ---- Red: nada fuera; la ruta del catálogo, simulada ---------------------------------------------
const external = [];
let catalogCalls = 0;
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/catalog" }, { urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  if (request.url.startsWith("https://")) {
    external.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  catalogCalls += 1;
  // Cada libro con su título; solo «Laberintos» trae autor: «Jorge Luis Borges».
  const title = JSON.parse(request.postData ?? "{}").input?.title ?? "Sin título";
  const reply = { catalog: { authors: /Laberintos/.test(title) ? ["Jorge Luis Borges"] : [], canonicalTitle: title, confidence: 0.9, summary: "Relatos.", workType: "book" }, usage: { inputTokens: 200, outputTokens: 60 } };
  return page.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(reply)).toString("base64") }).catch(() => {});
});

// ---- Importar los tres -------------------------------------------------------------------------
await page.viewport(1366, 900);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", ["Meditaciones.pdf", "Etica.pdf", "Laberintos.pdf"].map((f) => `${work}/${f}`));
await page.waitFor(`[...document.querySelectorAll("article")].filter((a) => a.getAttribute("aria-label")).length >= 3`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

// ---- Fichas ya guardadas, con variantes: dos «J. L. Borges» y una categoría sin tilde ---------
const record = (documentId, title, authors, category) => ({
  analyzedAt: "2026-11-01T00:00:00.000Z",
  catalog: { authors, canonicalTitle: title, confidence: 0.8, genres: [], language: "es", publicationYear: null, summary: "", topics: [], workType: "book" },
  documentId, error: null, extras: { category, subcategory: null }, inputFingerprint: "v1:viejo", model: "m", provider: "gemini", schemaVersion: 1, status: "analyzed",
});
const seeded = [
  record("sembrada-aleph", "El Aleph", ["J. L. Borges"], "Literatura"),
  record("sembrada-hacedor", "El hacedor", ["J. L. Borges"], "Literatura"),
  record("sembrada-etica", "Ética", ["Baruch Spinoza"], "Filosofía"),
  record("sembrada-tratado", "Tratado teológico-político", ["Baruch Spinoza"], "Filosofia"),
];
const idb = (body) => `new Promise((ok, ko) => { const r = indexedDB.open("pliegue-document-catalog", 1); r.onupgradeneeded = () => r.result.createObjectStore("catalogs", { keyPath: "documentId" }); r.onerror = () => ko(r.error); r.onsuccess = () => { const db = r.result; ${body} }; })`;
await page.eval(idb(`const tx = db.transaction("catalogs", "readwrite"); for (const rec of ${JSON.stringify(seeded)}) tx.objectStore("catalogs").put(rec); tx.oncomplete = () => { db.close(); ok(true); }; tx.onerror = () => ko(tx.error);`));
const readRecords = () => page.eval(idb(`const q = db.transaction("catalogs").objectStore("catalogs").getAll(); q.onsuccess = () => { db.close(); ok(Object.fromEntries(q.result.map((r) => [r.catalog?.canonicalTitle ?? r.documentId, { authors: r.catalog?.authors, category: r.extras?.category }]))); };`));

// ---- A1) Catalogar un libro ya no unifica las fichas de antes -----------------------------------
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini", concurrency: 1 })), true)`);
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "AIzaSy" + "x".repeat(33)); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(400);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
const pendingLine = `[...document.querySelectorAll("section[aria-labelledby=unificar-titulo] [role=status]")].map((p) => p.textContent).join("")`;
await page.waitFor(`/variante|Sin variantes/.test(${pendingLine})`, { timeout: 30000 });
t.check("antes de catalogar, el panel propone la variante guardada (la categoría sin tilde)", /1 variante por unificar en 1 ficha/.test(await page.eval(pendingLine)), await page.eval(pendingLine));
const catalogButton = `[...document.querySelectorAll("button")].find((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim()) && !b.disabled)`;
await page.waitFor(catalogButton, { timeout: 30000 });
await page.eval(`(${catalogButton}).click(), true`);
await page.waitFor(`/catalogado/.test(document.querySelector("section [role=status][aria-live=polite]")?.textContent ?? "")`, { timeout: 90000 }).catch(() => {});
await page.sleep(1200);
let stored = await readRecords();
t.check("se catalogaron los tres libros con la ruta simulada", catalogCalls >= 1, `${catalogCalls} llamadas`);
t.check("catalogar NO reescribe las fichas de antes («J. L. Borges» sigue)", stored["El Aleph"]?.authors?.[0] === "J. L. Borges" && stored["El hacedor"]?.authors?.[0] === "J. L. Borges", JSON.stringify([stored["El Aleph"], stored["El hacedor"]]));
t.check("ni la categoría sin tilde", stored["Tratado teológico-político"]?.category === "Filosofia");
await page.waitFor(`/variantes? por unificar/.test(${pendingLine})`, { timeout: 10000 }).catch(() => {});
t.check("el autor nuevo («Jorge Luis Borges») deja la unión propuesta, sin aplicarla", /2 variantes por unificar en 3 fichas/.test(await page.eval(pendingLine)), await page.eval(pendingLine));
// Al terminar de catalogar puede salir el diálogo del siguiente paso.
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => /Ahora no|Cerrar/.test(x.textContent.trim()))?.click(), true)`);
await page.sleep(300);

// ---- A2) La vista previa de «Unificar nombres» -------------------------------------------------
const sheet = `[...document.querySelectorAll("aside[role=dialog]")].find((a) => a.dataset.open === "true" && a.querySelector("h2")?.textContent === "Unificar nombres")`;
const reviewButton = `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Revisar y unificar" && !b.disabled)`;
await page.waitFor(reviewButton, { timeout: 30000 });
console.log("    diálogos abiertos:", await page.eval(`[...document.querySelectorAll("dialog[open]")].map((d) => d.textContent.slice(0, 60)).join(" | ") || "ninguno"`));
await page.click("text=Revisar y unificar");
await page.waitFor(sheet);
await page.waitFor(`Math.round((${sheet}).getBoundingClientRect().right) === document.documentElement.clientWidth`, { timeout: 3000 }).catch(() => {});
await page.sleep(200);
const merges = () => page.eval(`[...(${sheet}).querySelectorAll("li")].map((li) => ({ text: li.querySelector("label").textContent.replace(/\\s+/g, " ").trim(), checked: li.querySelector("input").checked }))`);
let shown = await merges();
for (const merge of shown) console.log("    ·", merge.text);
const borges = shown.find((m) => /J\. L\. Borges → Jorge Luis Borges/.test(m.text));
const filosofia = shown.find((m) => /Filosofia → Filosofía/.test(m.text));
t.check("enseña cada unión con su grafía final", Boolean(borges && filosofia), shown.map((m) => m.text).join(" | "));
t.check("y en qué fichas cae", /2 fichas: El Aleph · El hacedor/.test(borges?.text ?? ""), borges?.text);
t.check("todas marcadas al abrir", shown.every((m) => m.checked));
const applyButton = () => page.eval(`[...(${sheet}).querySelectorAll("footer button")].map((b) => b.textContent.trim())[0]`);
t.check("el botón dice cuántas fichas toca", (await applyButton()) === "Unificar 3 fichas", await applyButton());
const geometry = await page.eval(`(() => { const r = (${sheet}).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: document.documentElement.clientWidth }; })()`);
t.check("la hoja entra entera por la derecha", geometry.right === geometry.w && geometry.left > 0, JSON.stringify(geometry));
await page.screenshot(`${work}/1-unificar.png`);

// Cancelar no escribe nada.
await page.eval(`([...(${sheet}).querySelectorAll("footer button")].find((b) => b.textContent.trim() === "Cancelar").click(), true)`);
await page.sleep(500);
stored = await readRecords();
t.check("Cancelar no cambia ninguna ficha", stored["El Aleph"]?.authors?.[0] === "J. L. Borges" && stored["Tratado teológico-político"]?.category === "Filosofia");

// Desmarcar la categoría y unificar solo el autor.
await page.click("text=Revisar y unificar");
await page.waitFor(sheet);
await page.sleep(300);
await page.eval(`([...(${sheet}).querySelectorAll("li")].find((li) => /Filosofia/.test(li.textContent)).querySelector("input").click(), true)`);
await page.sleep(200);
t.check("al desmarcar una unión, el botón se recalcula", (await applyButton()) === "Unificar 2 fichas", await applyButton());
await page.eval(`([...(${sheet}).querySelectorAll("footer button")][0].click(), true)`);
await page.waitFor(`!(${sheet})`, { timeout: 10000 });
await page.sleep(500);
stored = await readRecords();
t.check("aplica solo lo aceptado: «J. L. Borges» → «Jorge Luis Borges»", stored["El Aleph"]?.authors?.[0] === "Jorge Luis Borges" && stored["El hacedor"]?.authors?.[0] === "Jorge Luis Borges");
t.check("y deja la categoría desmarcada como estaba", stored["Tratado teológico-político"]?.category === "Filosofia");
const dashStatus = await page.eval(`[...document.querySelectorAll("[role=status][aria-live=polite]")].map((p) => p.textContent).join(" ")`);
t.check("el panel dice cuántas fichas cambió", /2 fichas con el nombre unificado/.test(dashStatus), dashStatus.slice(0, 120));
await page.waitFor(`/1 variante por unificar en 1 ficha/.test(${pendingLine})`, { timeout: 8000 }).catch(() => {});
t.check("lo desmarcado sigue propuesto", /1 variante por unificar en 1 ficha/.test(await page.eval(pendingLine)), await page.eval(pendingLine));

// ---- B) Vista previa del índice JSON -----------------------------------------------------------
const index = {
  pliegueCatalog: 1,
  entries: [
    { authors: ["Marco Aurelio"], category: "Filosofía", fileName: "Meditaciones.pdf", publicationYear: 1998, series: "Biblioteca Clásica Gredos", subcategory: "Estoicismo", title: "Meditaciones", volume: 5 },
    { authors: ["Baruch Spinoza"], category: "Filosofía", fileName: "Etica.pdf", title: "Ética" },
    { fileName: "No está en la biblioteca.pdf", title: "Otro" },
  ],
};
writeFileSync(`${work}/indice.json`, JSON.stringify(index, null, 2));
await page.goto(`${BASE}/app/biblioteca/fuentes`);
const jsonInput = "input[aria-label='Seleccionar archivo JSON de índice']";
await page.waitFor(`document.querySelector("${jsonInput}")`, { timeout: 20000 });
// Que la biblioteca haya cargado: sin documentos, «Descargar plantilla» está desactivado.
await page.waitFor(`[...document.querySelectorAll("#importar-indice button")].some((b) => b.textContent.trim() === "Descargar plantilla" && !b.disabled)`, { timeout: 20000 });
await page.setFiles(jsonInput, [`${work}/indice.json`]);
const changes = `document.querySelector("ul[aria-label='Cambios por libro']")`;
await page.waitFor(changes, { timeout: 10000 }).catch(async (error) => {
  console.log("    inputs:", await page.eval(`document.querySelectorAll("${jsonInput}").length`));
  console.log("    panel:", await page.eval(`(document.querySelector("#importar-indice")?.innerText ?? "sin panel").slice(0, 900)`));
  await page.screenshot(`${work}/debug-indice.png`, { full: true });
  throw error;
});
const summary = await page.eval(`${changes}.closest("details").querySelector("summary").textContent.replace(/\\s+/g, " ").trim()`);
t.check("dice cuántos libros cambian", /Qué cambia en tu biblioteca: 2 libros/.test(summary), summary);
const perBook = await page.eval(`Object.fromEntries([...${changes}.querySelectorAll(":scope > li")].map((li) => [li.querySelector("strong").textContent, [...li.querySelectorAll("dl > div")].map((d) => d.querySelector("dt").textContent + ": " + d.querySelector("dd").textContent.replace(/\\s+/g, " ").trim())]))`);
for (const [title, fields] of Object.entries(perBook)) console.log("    ·", title, "→", fields.join(" | "));
const med = perBook["Meditaciones"] ?? [];
t.check("«Meditaciones»: autoría, categoría, serie con tomo y año, de «—» a lo nuevo", med.includes("Autoría: — → Marco Aurelio") && med.includes("Categoría: — → Filosofía › Estoicismo") && med.includes("Serie: — → Biblioteca Clásica Gredos, 5") && med.includes("Año: — → 1998"), med.join(" | "));
t.check("«Etica»: el título y la autoría que trae", (perBook["Etica"] ?? []).includes("Título: Etica → Ética"), (perBook["Etica"] ?? []).join(" | "));
await page.screenshot(`${work}/2-indice.png`, { full: true });

// Cancelar no escribe nada.
await page.eval(`([...document.querySelectorAll("#importar-indice button")].find((b) => b.textContent.trim() === "Cancelar").click(), true)`);
await page.sleep(400);
const importedCount = () => page.eval(`[...document.querySelectorAll("#importar-indice span")].map((s) => s.textContent).find((x) => /importada/.test(x)) ?? ""`);
t.check("Cancelar no importa nada", /^0 fichas importadas/.test(await importedCount()), await importedCount());

// Aplicar, y volver a cargar el mismo archivo: ya no cambia nada.
await page.setFiles(jsonInput, [`${work}/indice.json`]);
await page.waitFor(changes, { timeout: 10000 });
await page.eval(`([...document.querySelectorAll("#importar-indice button")].find((b) => /^Aplicar \\d+ fichas?$/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(`/^3 fichas importadas/.test(${JSON.stringify("")} + ([...document.querySelectorAll("#importar-indice span")].map((s) => s.textContent).find((x) => /importada/.test(x)) ?? ""))`, { timeout: 10000 }).catch(() => {});
t.check("Aplicar escribe las fichas", /^3 fichas importadas/.test(await importedCount()), await importedCount());
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => /Ahora no|Cerrar/.test(x.textContent.trim()))?.click(), true)`);
await page.sleep(400);
await page.setFiles(jsonInput, [`${work}/indice.json`]);
await page.waitFor(`/ya están así/.test(document.querySelector("#importar-indice")?.textContent ?? "")`, { timeout: 10000 }).catch(() => {});
t.check("el mismo archivo otra vez: «no cambia nada»", await page.eval(`/ya están así: no cambia nada/.test(document.querySelector("#importar-indice").textContent)`));

// ---- Móvil y oscuro de la hoja de unificar ------------------------------------------------------
await page.goto(`${BASE}/app/ia`);
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.waitFor(`/variante/.test(${pendingLine})`, { timeout: 20000 });
await page.click("text=Revisar y unificar");
await page.waitFor(sheet);
await page.sleep(700);
const overflow = await page.eval(`(() => { const s = ${sheet}; return { sw: s.scrollWidth, cw: s.clientWidth, w: Math.round(s.getBoundingClientRect().width) }; })()`);
t.check("en el móvil la hoja no desborda de lado", overflow.sw <= overflow.cw + 1 && overflow.w <= 390, JSON.stringify(overflow));
await page.screenshot(`${work}/3-movil.png`);
await page.theme("dark");
await page.sleep(300);
await page.screenshot(`${work}/4-movil-oscuro.png`);

// La página Fuentes carga los scripts de Google Drive (ya lo hacía antes de esta rama): se bloquean
// y no cuentan como datos que salen.
const leaks = external.filter((url) => !/^https:\/\/(accounts\.google\.com\/gsi\/client|apis\.google\.com\/js\/api\.js)/.test(url));
t.check("ninguna petición fuera (aparte de los scripts de Drive de Fuentes)", leaks.length === 0, leaks.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
