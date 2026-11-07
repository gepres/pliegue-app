// 04.5 · Preguntar a la biblioteca: responde solo con fragmentos de los libros indexados, cada
// hallazgo con citas que se comprueban antes de enseñarlas (las inventadas se quitan y un «del
// texto» sin cita comprobable se marca), dice cuando no hay evidencia, no manda lo confidencial y
// guarda un hallazgo como nota anclada a su cita, sin tocar el libro. Gemini simulado.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/asistente-citas`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Asistente con citas (${BASE})`);
const browser = await openChrome({ port: 9404, profile: `${PROFILE_ROOT}-asistente-citas` });
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
writeFileSync(
  `${work}/Jardin.epub`,
  epub("Jardin", [
    ["Las flores", ["Las flores del jardín se abren al amanecer.", "Cada mañana regaba las flores con paciencia."]],
    ["El laberinto", ["En el centro del jardín había un laberinto de setos altos.", "Quien entraba en el laberinto tardaba horas en salir."]],
  ]),
);
writeFileSync(`${work}/Diario.epub`, epub("Diario", [["Mi diario", ["Este es mi diario secreto: nadie debe leerlo.", "Hoy escondí la llave bajo la maceta."]]]));

// ---- Gemini simulado: vectores por conceptos y un «modelo» que responde con lo que recibe -------------------
const concepts = [["laberinto", "centro", "setos"], ["jardin", "flores"], ["diario", "secreto", "llave"]];
const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const fakeVector = (text) => {
  const words = plain(text).split(/[^a-z0-9]+/);
  const vector = new Array(768).fill(0);
  vector[700] = 0.05;
  concepts.forEach((group, dim) => words.forEach((word) => group.includes(word) && (vector[dim] += 1)));
  return vector;
};
const answerCalls = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/embed" }, { urlPattern: "*/api/ai/answer" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const body = JSON.parse(request.postData ?? "{}");
  const reply = (json) =>
    page
      .send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(json)).toString("base64") })
      .catch(() => {});
  if (request.url.includes("/api/ai/embed")) return reply({ dimensions: 768, model: body.model, usage: { inputTokens: 10, outputTokens: 0 }, vectors: body.texts.map(fakeVector) });
  answerCalls.push(body);
  const maze = body.fragments.find((fragment) => /laberinto de setos/.test(fragment.text));
  if (!maze) return reply({ answer: { findings: [], missing: "Los fragmentos no hablan de eso.", status: "no-evidence", summary: null }, usage: { inputTokens: 200, outputTokens: 20 } });
  return reply({
    answer: {
      findings: [
        {
          citations: [
            { fragment: maze.label, quote: "«un laberinto de setos altos»" },
            { fragment: "F9", quote: "una cita que no existe" },
          ],
          confidence: "high",
          kind: "source",
          text: "En el centro del jardín hay un laberinto de setos.",
        },
        { citations: [{ fragment: maze.label, quote: "tardaba horas en salir" }], confidence: "medium", kind: "inference", text: "Es difícil orientarse en él." },
        { citations: [{ fragment: maze.label, quote: "un dragón vigila la entrada" }], confidence: "high", kind: "source", text: "Un dragón lo vigila." },
      ],
      missing: "No dice quién lo plantó.",
      status: "answered",
      summary: "Un laberinto de setos altos ocupa el centro del jardín.",
    },
    usage: { inputTokens: 400, outputTokens: 120 },
  });
});

// ---- Preparar: importar, marcar el diario confidencial, la clave e indexar ---------------------------------------
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini", concurrency: 1 })), true)`);
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
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 30000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim())).click(), true)`);
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
await page.waitFor(dialog, { timeout: 30000 });
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Enviar y calcular").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("[role=status]")].some((p) => /^Listo\\./.test(p.textContent.trim()))`, { timeout: 60000 });
t.check("la biblioteca queda indexada", true);

// ---- Preguntar ----------------------------------------------------------------------------------------------------
await page.eval(`([...document.querySelectorAll("[role=radiogroup][aria-label='Buscar o preguntar'] [role=radio]")].find((b) => b.textContent.trim() === "Preguntar").click(), true)`);
await page.waitFor(`document.querySelector("label[for=semantic-query]")?.textContent === "Qué quieres saber"`, { timeout: 5000 });
async function ask(question) {
  await page.eval(`(() => { const el = document.querySelector("#semantic-query"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(question)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(200);
  const before = answerCalls.length;
  await page.eval(`(document.querySelector("form[role=search] button[type=submit]").click(), true)`);
  await page.waitFor(`document.querySelector("section[aria-label='Respuesta a «${question}»']") || document.querySelector("form[role=search] ~ [role=alert]")`, { timeout: 20000 });
  await page.sleep(300);
  const view = await page.eval(`(() => {
    const section = document.querySelector("section[aria-label='Respuesta a «${question}»']");
    if (!section) return { error: document.querySelector("[role=alert]")?.textContent };
    return {
      status: section.dataset.status,
      state: section.querySelector("[role=status]")?.textContent,
      summary: section.querySelector("p:nth-of-type(2)")?.textContent,
      findings: [...section.querySelectorAll("ol > li")].map((li) => ({ kind: li.dataset.kind, head: li.querySelector("p")?.textContent, text: li.textContent.replace(/\\s+/g, " "), links: [...li.querySelectorAll("a")].map((a) => ({ text: a.textContent, href: a.getAttribute("href") })) })),
      text: section.textContent.replace(/\\s+/g, " "),
    };
  })()`);
  return { calls: answerCalls.slice(before), view };
}

let { calls, view } = await ask("¿Qué hay en el centro del jardín?");
t.check("responde: estado, resumen y hallazgos", view.status === "answered" && /Con \d+ fragmentos? de tus libros; cita 1 libro/.test(view.state ?? "") && /Un laberinto de setos altos ocupa el centro/.test(view.text), JSON.stringify(view).slice(0, 300));
const sent = calls[0];
t.check(
  "manda la pregunta y solo fragmentos (etiquetados F1…, con su libro y su sitio), nunca el confidencial",
  sent && sent.question === "¿Qué hay en el centro del jardín?" && sent.fragments.length <= 8 && sent.fragments.every((f, i) => f.label === `F${i + 1}` && f.title && f.location) && !sent.fragments.some((f) => /diario|llave/i.test(f.text)),
  JSON.stringify(sent?.fragments.map((f) => [f.label, f.title])),
);
const [source, inference, unverified] = view.findings;
t.check(
  "«del texto» con su cita comprobada, que abre el libro en su sitio",
  source?.kind === "source" && source.links[0]?.text === "«un laberinto de setos altos»" && source.links[0]?.href.startsWith(`/app/lector?document=${encodeURIComponent(ids.Jardin)}&fragmento=`) && /Jardin, El laberinto/.test(source.text),
  JSON.stringify(source),
);
t.check("la cita inventada se quita, se dice, y la confianza baja a media", /Se quitó 1 cita que no estaba en el texto/.test(source?.text ?? "") && /confianza media/.test(source?.head ?? ""), source?.head);
t.check("lo deducido va como «Inferencia»", inference?.kind === "inference" && /Inferencia/.test(inference.head ?? ""), inference?.head);
t.check("un «del texto» sin cita comprobable se marca y no se presenta como dato", unverified?.kind === "unverified" && /Sin cita verificable/.test(unverified.head ?? "") && /confianza baja/.test(unverified.head ?? "") && unverified.links.length === 0, JSON.stringify(unverified));
t.check("dice lo que no aparece", /Lo que no aparece: No dice quién lo plantó/.test(view.text));
await page.eval(`(document.querySelector("section[aria-label^='Respuesta a']").scrollIntoView({ block: "start" }), true)`);
await page.sleep(300);
await page.screenshot(`${work}/1-respuesta.png`);

// ---- Sin evidencia, y lo confidencial no sale ---------------------------------------------------------------------
({ calls, view } = await ask("¿Dónde escondí la llave?"));
t.check("sin evidencia: lo dice y no inventa un resumen", view.status === "no-evidence" && /No encontré en tus libros nada que responda a esto|No hay fragmentos que se puedan enviar/.test(view.state ?? "") && !view.findings.length, view.state);
t.check("el fragmento del diario confidencial no se envió", !calls.some((call) => call.fragments.some((f) => /llave|diario/i.test(f.text))), JSON.stringify(calls.map((c) => c.fragments.map((f) => f.title))));
t.check("y se ofrece leerlo en el equipo", /no se envió a Gemini|no se enviaron a Gemini/.test(view.text) && view.text.includes("Diario"), view.text.slice(-200));

// ---- Guardar un hallazgo como nota --------------------------------------------------------------------------------
({ view } = await ask("¿Qué hay en el centro del jardín?"));
const firstFinding = `[...document.querySelectorAll("section[aria-label^='Respuesta a'] ol > li")][0]`;
await page.eval(`(${firstFinding}.querySelector("button").focus(), ${firstFinding}.querySelector("button").click(), true)`);
const savedFeedback = await page
  .waitFor(`(() => { const li = ${firstFinding}; return /Nota guardada/.test(li.querySelector("button").textContent) && /En «Jardin», El laberinto, resaltada sobre la cita/.test(li.querySelector("[role=status]")?.textContent ?? ""); })()`, { timeout: 10000 })
  .then(() => true, () => false);
const feedback = await page.eval(`(() => {
  const li = ${firstFinding};
  const button = li.querySelector("button").getBoundingClientRect();
  const status = li.querySelector("[role=status]");
  const box = status.getBoundingClientRect();
  return { gap: Math.round(box.top - button.bottom), focus: document.activeElement === li.querySelector("button"), link: status.querySelector("a")?.getAttribute("href") ?? "", text: status.textContent };
})()`);
t.check(
  "al guardar, el aviso sale junto a su botón («Nota guardada», dónde está y un enlace al lector) y el foco no se pierde",
  savedFeedback && feedback.gap < 40 && feedback.focus && feedback.link.startsWith(`/app/lector?document=${encodeURIComponent(ids.Jardin)}&fragmento=`),
  JSON.stringify(feedback),
);
await page.eval(`(${firstFinding}.scrollIntoView({ block: "center" }), true)`);
await page.screenshot(`${work}/1b-nota-guardada.png`);
await page.eval(`(${firstFinding}.querySelector("button").click(), true)`);
await page.sleep(500);
const notes = await page.eval(`new Promise((ok) => { const r = indexedDB.open("pliegue-annotations"); r.onsuccess = () => { const db = r.result; const all = db.transaction("annotations").objectStore("annotations").getAll(); all.onsuccess = () => { ok(all.result); db.close(); }; }; r.onerror = () => ok([]); })`);
t.check("pulsar otra vez no la duplica", notes.filter((item) => item.documentId === ids.Jardin).length === 1, String(notes.length));
const note = notes.find((item) => item.documentId === ids.Jardin);
t.check(
  "la nota se guarda en el libro de la cita, con el hallazgo y la cita del libro",
  note && note.target.quote === "un laberinto de setos altos" && /En el centro del jardín hay un laberinto de setos/.test(note.note) && /asistente de Pliegue/.test(note.note) && note.documentTitle === "Jardin",
  JSON.stringify(note?.target),
);
await page.eval(`([...document.querySelectorAll("section[aria-label^='Respuesta a'] ol > li")][0].querySelector("a").click(), true)`);
await page.waitFor(`document.querySelector("[data-search-hit]")`, { timeout: 30000 });
await page.sleep(1500);
const highlight = await page.eval(`(() => { const h = CSS.highlights?.get("pliegue-blue"); if (!h) return null; return [...h].map((range) => range.toString()); })()`);
t.check("en el lector, la nota aparece resaltada sobre la cita (el texto del libro no cambia)", Array.isArray(highlight) && highlight.some((text) => /un laberinto de setos altos/.test(text)), JSON.stringify(highlight));
t.check("el texto del libro sigue igual", await page.eval(`[...document.querySelectorAll("p")].some((p) => p.textContent.trim() === "En el centro del jardín había un laberinto de setos altos.")`));
await page.screenshot(`${work}/2-nota-en-el-lector.png`);

// ---- En el móvil cabe ------------------------------------------------------------------------------------------------
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`document.querySelector("#semantic-query")`, { timeout: 20000 });
await page.eval(`([...document.querySelectorAll("[role=radiogroup][aria-label='Buscar o preguntar'] [role=radio]")].find((b) => b.textContent.trim() === "Preguntar").click(), true)`);
await ask("¿Qué hay en el centro del jardín?");
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.sleep(600);
await page.eval(`(document.querySelector("section[aria-label^='Respuesta a']").scrollIntoView({ block: "start" }), true)`);
const overflow = await page.eval(`(() => { const s = document.querySelector("section[aria-label^='Respuesta a']").getBoundingClientRect(); return { right: Math.round(s.right), width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }; })()`);
t.check("en el móvil, la respuesta cabe sin desplazamiento lateral", overflow.right <= overflow.width && overflow.scroll <= overflow.width, JSON.stringify(overflow));
await page.screenshot(`${work}/3-movil.png`);

// ---- El registro lo cuenta ---------------------------------------------------------------------------------------------
const log = await page.eval(`(localStorage.getItem("pliegue-ai-processing-v1") ?? "")`);
const entries = JSON.parse(log || "[]");
t.check(
  "el registro apunta «Consultar»: lo enviado del jardín y que el diario no salió",
  entries.some((e) => e.flow === "ask" && e.documentId === ids.Jardin && e.sent > 0) && entries.some((e) => e.flow === "ask" && e.documentId === ids.Diario && e.route === "kept-local"),
  JSON.stringify(entries.filter((e) => e.flow === "ask").map((e) => [e.documentId === ids.Jardin ? "Jardin" : "Diario", e.route, e.sent])),
);
t.check("sin textos en el registro", !/laberinto|llave|secreto/.test(log));

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
