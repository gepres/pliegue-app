// 04.5 · Resumir un libro entero (opción «b» del dueño). Desde el lector: avisa antes de lo que se
// envía y de lo que cuesta, resume por partes con citas que se comprueban en el libro, junta las
// ideas y deja el resumen como nota. Lo confidencial no sale; si el proveedor falla, no se prueba
// con otro. Gemini simulado; la clave es de prueba y vive solo en memoria.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/resumir-libro`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Resumir un libro (${BASE})`);
const browser = await openChrome({ port: 9410, profile: `${PROFILE_ROOT}-resumir-libro` });
const page = await browser.newPage();
await page.viewport(1366, 900);

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
// Un libro de unos 36.000 caracteres: sale en dos partes.
const paragraph = (chapter, n) =>
  `Capítulo ${chapter}, párrafo ${n}: en el jardín de senderos que se bifurcan, cada decisión abre caminos distintos que conviven en el tiempo. ` +
  "El laberinto no está hecho de setos ni de piedra, sino de días: quien entra en él no recorre un espacio, recorre posibilidades que se ramifican sin cesar. ".repeat(5);
const chapters = ["El jardín", "El laberinto", "El tiempo"].map((heading, c) => [heading, Array.from({ length: 10 }, (_, n) => paragraph(c + 1, n + 1))]);
writeFileSync(`${work}/Jardin.epub`, epub("Jardin", chapters));
writeFileSync(`${work}/Diario.epub`, epub("Diario", [["Mi diario", ["Este es mi diario secreto: nadie debe leerlo.", "Hoy escondí la llave bajo la maceta."]]]));

// ---- Gemini simulado: de cada parte, una idea con cita literal y otra inventada; al juntar, dos puntos y uno sin apoyo --
const calls = { other: [], parts: [], wholes: [] };
let fail = false;
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/*" }, { urlPattern: "http://localhost:11434/*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const reply = (code, json) =>
    page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(json)).toString("base64") }).catch(() => {});
  if (!request.url.includes("/api/ai/summarize")) {
    calls.other.push(request.url);
    return reply(500, { error: "No simulada." });
  }
  const body = JSON.parse(request.postData ?? "{}");
  if (fail) {
    calls.parts.push(body);
    return reply(500, { error: "Gemini no está disponible ahora mismo (500)." });
  }
  const usage = { inputTokens: 1000, outputTokens: 100 };
  if (body.stage === "part") {
    calls.parts.push(body);
    const first = body.fragments[0];
    return reply(200, {
      result: {
        points: [
          { citations: [{ fragment: first.label, quote: first.text.slice(0, 60) }], text: `Idea principal de la parte ${body.part}.` },
          { citations: [{ fragment: "F2", quote: "esto no está en el libro" }], text: "Una idea inventada." },
        ],
      },
      usage,
    });
  }
  calls.wholes.push(body);
  return reply(200, {
    result: {
      points: [
        { sources: ["P1"], text: "El jardín es un laberinto de tiempo." },
        { sources: ["P2", "P1"], text: "Cada decisión abre caminos que conviven." },
        { sources: ["P9"], text: "Un punto sin apoyo." },
      ],
      summary: "Un jardín cuyos senderos se bifurcan en el tiempo.",
    },
    usage,
  });
});

// ---- Preparar: Gemini, la clave, los libros y el diario confidencial (sin indexar: el resumen trocea) ------------------
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini", concurrency: 1, budget: { tokenPrices: { "gemini:gemini-3.5-flash-lite": { input: 0.3, output: 2.5 } } } })), true)`);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", ["Jardin.epub", "Diario.epub"].map((name) => `${work}/${name}`));
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 2`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const ids = await page.eval(`Object.fromEntries([...document.querySelectorAll("article[aria-label]")].map((a) => [a.getAttribute("aria-label"), new URL(a.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")]))`);
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-sensitivity-v1", JSON.stringify({ consents: {}, documents: { ${JSON.stringify(ids.Diario)}: "confidencial" }, sources: {} })), true)`);
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "AIzaSy" + "x".repeat(33)); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}
const summarizeRow = await page.eval(`document.querySelector("section[aria-labelledby=ai-router-title] tr[data-flow=summarize]")?.textContent ?? ""`);
t.check("la tabla del router tiene «Resumir un libro», con el proveedor de preguntar", /Resumir un libro/.test(summarizeRow) && /Gemini/.test(summarizeRow) && /No sale: no se resume/.test(summarizeRow), summarizeRow.slice(0, 160));

// ---- Abrir el libro en el lector (en la misma pestaña: la clave vive en memoria) ---------------------------------------
async function openBook(title, text) {
  await page.eval(`(document.querySelector("a[href='/app/biblioteca']").click(), true)`);
  await page.waitFor(`[...document.querySelectorAll("article[aria-label]")].some((a) => a.getAttribute("aria-label") === ${JSON.stringify(title)})`, { timeout: 20000 });
  await page.eval(`([...document.querySelectorAll("article[aria-label]")].find((a) => a.getAttribute("aria-label") === ${JSON.stringify(title)}).querySelector("a[href*='/app/lector?document=']").click(), true)`);
  await page.waitFor(`[...document.querySelectorAll("p")].some((p) => p.textContent.includes(${JSON.stringify(text)}))`, { timeout: 30000 });
  await page.sleep(800);
}
async function openSummary() {
  await page.eval(`(document.querySelector("button[aria-label='Resumir'], button[aria-label='Resumiendo']").click(), true)`);
  await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^(Resumir este libro|Resumir otra vez)$/.test(b.textContent.trim()))`, { timeout: 10000 });
}
const clickButton = (label) => page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click(), true)`);

await openBook("Jardin", "Capítulo 1, párrafo 1");
await openSummary();
const intro = await page.eval(`[...document.querySelectorAll("p")].find((p) => /Lee el libro entero, por partes/.test(p.textContent))?.textContent ?? ""`);
t.check("el lector ofrece «Resumir este libro» y dice con quién y que se guarda como nota", /Gemini \(gemini-3\.5-flash-lite\)/.test(intro) && /Se guarda como nota/.test(intro), intro);
await clickButton("Resumir este libro");
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
await page.waitFor(dialog, { timeout: 30000 });
const confirm = await page.eval(`(${dialog}).textContent`);
t.check(
  "antes de enviar, dice a quién, cuánto texto, en cuántas partes y lo que costará",
  /¿Resumir el libro entero\?/.test(confirm) && /Gemini \(gemini-3\.5-flash-lite\)/.test(confirm) && /2 partes/.test(confirm) && /caracteres/.test(confirm) && /~US\$|~\$|US\$/.test(confirm),
  confirm.slice(0, 300),
);
t.check("y nada salió todavía", calls.parts.length === 0 && calls.wholes.length === 0);
await page.screenshot(`${work}/1-confirmar.png`);
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Resumir").click(), true)`);
const result = `document.querySelector("section[aria-label='Resumen de «Jardin»']")`;
const done = await page.waitFor(result, { timeout: 30000 }).then(() => true, () => false);
const view = done
  ? await page.eval(`(() => { const s = ${result}; return { status: s.querySelector("[role=status]")?.textContent, points: [...s.querySelectorAll("ol > li")].map((li) => ({ text: li.querySelector("p").textContent, links: [...li.querySelectorAll("a")].map((a) => ({ text: a.textContent, href: a.getAttribute("href") })) })), text: s.textContent }; })()`)
  : { text: await page.eval(`[...document.querySelectorAll("[role=alert]")].map((a) => a.textContent).join(" · ")`) };
t.check("resume por partes (2) y luego junta las ideas, sin mandar el libro al juntar", calls.parts.length === 2 && calls.wholes.length === 1 && !("fragments" in calls.wholes[0]) && calls.wholes[0].ideas.length === 2, JSON.stringify({ parts: calls.parts.length, wholes: calls.wholes.length }));
t.check(
  "cada parte va con sus fragmentos etiquetados, el título y qué parte es",
  calls.parts.every((call, i) => call.stage === "part" && call.title === "Jardin" && call.part === i + 1 && call.total === 2 && call.provider === "gemini" && call.fragments.every((f, j) => f.label === `F${j + 1}` && f.location && f.text)),
  JSON.stringify(calls.parts.map((call) => [call.part, call.fragments.length])),
);
t.check("enseña el resumen y solo los puntos con cita comprobada", done && /Un jardín cuyos senderos se bifurcan en el tiempo/.test(view.text) && view.points.length === 2 && !/Un punto sin apoyo|idea inventada/i.test(view.text), JSON.stringify(view.points?.map((p) => p.text)));
t.check(
  "las citas son trozos del libro que abren el lector en su sitio",
  view.points?.[0]?.links[0]?.text.includes("Capítulo 1, párrafo 1") && view.points[0].links[0].href.startsWith(`/app/lector?document=${encodeURIComponent(ids.Jardin)}&fragmento=`) && view.points[1].links.length === 2,
  JSON.stringify(view.points?.map((p) => p.links)),
);
t.check("dice lo que se quitó: dos citas inventadas y un punto sin apoyo", /Se quitaron 3 citas o ideas que no estaban en el libro/.test(view.text ?? ""), (view.text ?? "").slice(-160));
t.check("y que quedó guardado como nota", /Guardado como nota/.test(view.status ?? ""), view.status);
await page.screenshot(`${work}/2-resumen.png`);

const notes = await page.eval(`new Promise((ok) => { const r = indexedDB.open("pliegue-annotations"); r.onsuccess = () => { const db = r.result; const all = db.transaction("annotations").objectStore("annotations").getAll(); all.onsuccess = () => { ok(all.result); db.close(); }; }; r.onerror = () => ok([]); })`);
const note = notes.find((item) => item.documentId === ids.Jardin);
t.check(
  "la nota: el resumen, los puntos con sus citas y su sitio, anclada a la primera cita",
  note && /^Resumen de «Jardin»/.test(note.note) && /1\. El jardín es un laberinto de tiempo\./.test(note.note) && /«El jardín Capítulo 1, párrafo 1/.test(note.note) && note.target.quote.includes("Capítulo 1, párrafo 1") && /asistente de Pliegue \(gemini-3\.5-flash-lite\)/.test(note.note),
  JSON.stringify({ quote: note?.target.quote, note: note?.note.slice(0, 120) }),
);
const log = JSON.parse((await page.eval(`localStorage.getItem("pliegue-ai-processing-v1")`)) || "[]");
t.check("el registro apunta «Resumir» con lo enviado, sin textos", log.some((e) => e.flow === "summarize" && e.documentId === ids.Jardin && e.sent > 0 && e.provider === "gemini") && !/jardín de senderos/.test(JSON.stringify(log)), JSON.stringify(log.map((e) => [e.flow, e.route, e.sent])));
t.check("el gasto cuenta para el presupuesto", /"gemini"/.test((await page.eval(`localStorage.getItem("pliegue-ai-usage-v1")`)) ?? ""));

// ---- La cita abre el libro en su sitio; cerrar y abrir la ventanita no pierde el resumen ------------------------------
await page.eval(`(${result}.querySelector("ol > li a").click(), true)`);
const jumped = await page.waitFor(`document.querySelector("[data-search-hit]")`, { timeout: 20000 }).then(() => true, () => false);
t.check("pulsar una cita lleva a su sitio en el libro", jumped);
await page.key("Escape", { code: "Escape", keyCode: 27 });
await page.sleep(300);
await openSummary();
t.check("al volver a abrirla, el resumen sigue ahí", await page.eval(`Boolean(${result})`));

// ---- Si Gemini falla, se dice y no se prueba con otro ----------------------------------------------------------------
fail = true;
const before = { other: calls.other.length, parts: calls.parts.length };
await clickButton("Resumir otra vez");
await page.waitFor(dialog, { timeout: 30000 });
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Resumir").click(), true)`);
const failed = await page.waitFor(`[...document.querySelectorAll("[role=alert]")].some((a) => /Gemini no está disponible ahora mismo/.test(a.textContent))`, { timeout: 20000 }).then(() => true, () => false);
t.check("si el proveedor falla, se dice", failed);
t.check("y no se llama a ningún otro (ni Ollama ni otra ruta)", calls.other.length === before.other && calls.parts.length === before.parts + 1, JSON.stringify(calls.other.slice(before.other)));
fail = false;

// ---- El confidencial no sale ------------------------------------------------------------------------------------------------
await page.key("Escape", { code: "Escape", keyCode: 27 });
await openBook("Diario", "Hoy escondí la llave");
const sentBefore = calls.parts.length + calls.wholes.length;
await openSummary();
await clickButton("Resumir este libro");
const blocked = await page.waitFor(`[...document.querySelectorAll("[role=alert]")].some((a) => /Este libro es confidencial/.test(a.textContent))`, { timeout: 15000 }).then(() => true, () => false);
await page.sleep(400);
t.check("resumir un confidencial con Gemini se bloquea, sin enviar nada, y ofrece Ajustes → IA", blocked && calls.parts.length + calls.wholes.length === sentBefore && (await page.eval(`[...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/app/ajustes#ai-buscar")`)));
const log2 = JSON.parse((await page.eval(`localStorage.getItem("pliegue-ai-processing-v1")`)) || "[]");
t.check("y el registro dice que no salió", log2.some((e) => e.flow === "summarize" && e.documentId === ids.Diario && e.route === "kept-local"), JSON.stringify(log2.map((e) => [e.flow, e.route])));
await page.screenshot(`${work}/3-confidencial.png`);

// ---- En el móvil cabe ----------------------------------------------------------------------------------------------------------
await page.key("Escape", { code: "Escape", keyCode: 27 });
await openBook("Jardin", "Capítulo 1, párrafo 1");
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.sleep(600);
await openSummary();
await clickButton("Resumir este libro");
await page.waitFor(dialog, { timeout: 30000 });
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Resumir").click(), true)`);
await page.waitFor(result, { timeout: 30000 }).catch(() => {});
await page.sleep(400);
const fit = await page.eval(`(() => { const s = document.querySelector("section[aria-label='Resumen de «Jardin»']"); const r = (s ?? document.body).getBoundingClientRect(); return { found: Boolean(s), left: Math.round(r.left), right: Math.round(r.right), width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }; })()`);
t.check("en el móvil, el resumen cabe sin desplazamiento lateral", fit.found && fit.left >= 0 && fit.right <= fit.width && fit.scroll <= fit.width, JSON.stringify(fit));
await page.screenshot(`${work}/4-movil.png`);

const errors = page.errors.filter((error) => !/500 \(Internal Server Error\)|no está disponible ahora mismo/.test(error));
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed: failures } = t.summary();
await browser.close();
process.exit(failures.length ? 1 : 0);
