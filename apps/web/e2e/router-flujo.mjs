// 04.3 · Router proveedor × flujo × sensibilidad. Cada tarea puede ir con su proveedor: aquí se
// cataloga y se pregunta con Claude (con un modelo propio para preguntar) y se busca por
// significado con Ollama en este equipo, que Claude no hace. La tabla «Quién hace cada tarea»
// dice qué pasa con cada nivel; si el proveedor falla, no se prueba con otro por su cuenta; y
// «solo por palabras» no manda nada. Claude y Ollama simulados; la clave es de prueba.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/router-flujo`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Router por flujo (${BASE})`);
const browser = await openChrome({ port: 9409, profile: `${PROFILE_ROOT}-router-flujo` });
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
writeFileSync(`${work}/Jardin.epub`, epub("Jardin", [["El laberinto", ["En el centro del jardín había un laberinto de setos altos.", "Quien entraba tardaba horas en salir."]]]));
writeFileSync(`${work}/Diario.epub`, epub("Diario", [["Mi diario", ["Este es mi diario secreto: nadie debe leerlo.", "Hoy escondí la llave bajo la maceta."]]]));

// ---- Claude (por la ruta de Pliegue) y Ollama (en el equipo), simulados ----------------------------------------------
const concepts = [["laberinto", "centro", "setos"], ["jardin"], ["diario", "secreto", "llave"]];
const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const fakeVector = (text) => {
  const words = plain(text).split(/[^a-z0-9]+/);
  const vector = new Array(768).fill(0);
  vector[700] = 0.05;
  concepts.forEach((group, dim) => words.forEach((word) => group.includes(word) && (vector[dim] += 1)));
  return vector;
};
const calls = { answer: [], hostedEmbed: 0, ollamaChat: 0, ollamaEmbed: [], other: [] };
let answerFails = false;
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/*" }, { urlPattern: "http://localhost:11434/*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }];
  const reply = (code, json) =>
    page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(json === null ? "" : JSON.stringify(json)).toString("base64") }).catch(() => {});
  if (request.method === "OPTIONS") return reply(204, null);
  const body = JSON.parse(request.postData ?? "{}");
  if (request.url.startsWith("http://localhost:11434/")) {
    if (request.url.endsWith("/api/embed")) {
      calls.ollamaEmbed.push(body);
      return reply(200, { embeddings: body.input.map(fakeVector), model: body.model, prompt_eval_count: 12 });
    }
    if (request.url.endsWith("/api/show")) return reply(200, { capabilities: ["embedding"], details: { family: "gemma3" } });
    if (request.url.endsWith("/api/chat")) calls.ollamaChat += 1;
    return reply(200, { version: "0.13.0" });
  }
  if (request.url.includes("/api/ai/embed")) {
    calls.hostedEmbed += 1;
    return reply(500, { error: "No debería pedirse." });
  }
  if (request.url.includes("/api/ai/answer")) {
    calls.answer.push({ auth: request.headers.Authorization ?? request.headers.authorization ?? "", body });
    if (answerFails) return reply(500, { error: "Anthropic no está disponible ahora mismo (500)." });
    const maze = body.fragments.find((fragment) => /laberinto de setos/.test(fragment.text));
    return reply(200, {
      answer: maze
        ? { findings: [{ citations: [{ fragment: maze.label, quote: "un laberinto de setos altos" }], confidence: "high", kind: "source", text: "Hay un laberinto de setos." }], missing: null, status: "answered", summary: "Un laberinto de setos ocupa el centro." }
        : { findings: [], missing: "No aparece.", status: "no-evidence", summary: null },
      usage: { inputTokens: 300, outputTokens: 40 },
    });
  }
  calls.other.push(request.url);
  return reply(404, { error: "Ruta no simulada." });
});

const setValue = (selector, value, kind = "HTMLSelectElement") =>
  page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(${kind}.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(${JSON.stringify(kind === "HTMLSelectElement" ? "change" : "input")}, { bubbles: true })); return true; })()`);
const matrixRow = (flow) =>
  page.eval(`(() => {
    const row = document.querySelector("section[aria-labelledby=ai-router-title] tr[data-flow=${flow}]");
    if (!row) return null;
    return {
      engine: row.querySelector("td").textContent.replace(/\\s+/g, " ").trim(),
      outcomes: Object.fromEntries([...row.querySelectorAll("td[data-outcome]")].map((td) => [td.querySelector("span").textContent, td.dataset.outcome + " · " + td.querySelectorAll("span")[1].textContent])),
    };
  })()`);

// ---- Preparar: Claude para catalogar, importar y marcar el diario confidencial ---------------------------------------
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "anthropic", concurrency: 1 })), true)`);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", ["Jardin.epub", "Diario.epub"].map((name) => `${work}/${name}`));
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 2`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const ids = await page.eval(`Object.fromEntries([...document.querySelectorAll("article[aria-label]")].map((a) => [a.getAttribute("aria-label"), new URL(a.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")]))`);
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-sensitivity-v1", JSON.stringify({ consents: {}, documents: { ${JSON.stringify(ids.Diario)}: "confidencial" }, sources: {} })), true)`);

// ---- Ajustes → IA: la tabla de partida y elegir proveedor para buscar y para preguntar ----------------------------------
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#ai-index-provider") && document.querySelector("section[aria-labelledby=ai-router-title] tr[data-flow=ask]")`, { timeout: 20000 });
await page.sleep(500);
let index = await matrixRow("index");
t.check("de partida, buscar va con el de catalogar: Claude no calcula embeddings, así que solo por palabras", /Nadie/.test(index?.engine ?? "") && Object.values(index.outcomes).every((o) => o.startsWith("off · Solo por palabras")), JSON.stringify(index));
const indexOptions = await page.eval(`[...document.querySelectorAll("#ai-index-provider option")].map((o) => o.textContent)`);
t.check("el selector de buscar no ofrece Claude y avisa de que el de catalogar no los calcula", !indexOptions.some((o) => /^Anthropic/.test(o)) && /El de catalogar · Anthropic · Claude: no calcula embeddings/.test(indexOptions[0] ?? ""), JSON.stringify(indexOptions));

await setValue("#ai-index-provider", "ollama");
await page.waitFor(`document.querySelector("#ollama-mode")`, { timeout: 5000 }).catch(() => {});
t.check("con Ollama para buscar aparece dónde está Ollama (no estaba arriba)", await page.eval(`Boolean(document.querySelector("#ollama-mode"))`));
await setValue("#ai-ask-model", "claude-opus-5-5", "HTMLInputElement");
for (let attempt = 0; attempt < 20; attempt += 1) {
  await setValue("#ai-api-key", "sk-ant-api03-" + "x".repeat(80), "HTMLInputElement");
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}
t.check("preguntar con el de catalogar no pide otra clave: usa la de arriba", await page.eval(`[...document.querySelectorAll("p")].some((p) => /Usa la misma clave de Anthropic · Claude que has puesto arriba/.test(p.textContent)) && !document.querySelector("[id^=ai-search-api-key]")`));
await page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Guardar ajustes de IA").click(), true)`);
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const saved = JSON.parse(await page.eval(`localStorage.getItem("pliegue-ai-settings-v1")`));
t.check("se guarda: buscar con Ollama, preguntar con el de catalogar y su modelo propio", saved.indexProvider === "ollama" && saved.askProvider === "catalog" && saved.askModels.anthropic === "claude-opus-5-5" && saved.models.anthropic === "claude-haiku-5-5", JSON.stringify({ askModels: saved.askModels, askProvider: saved.askProvider, indexProvider: saved.indexProvider }));

await page.sleep(300);
index = await matrixRow("index");
const ask = await matrixRow("ask");
const catalog = await matrixRow("catalog");
t.check("la tabla: buscar con Ollama (embeddinggemma) en este equipo, cualquier nivel", /Ollama/.test(index.engine) && /embeddinggemma/.test(index.engine) && /En este equipo/.test(index.engine) && Object.values(index.outcomes).every((o) => o.startsWith("local")), JSON.stringify(index));
t.check(
  "preguntar con Claude (claude-opus-5-5) en la nube: lo personal pregunta, lo confidencial no sale",
  /Claude/.test(ask.engine) && /claude-opus-5-5/.test(ask.engine) && /En la nube de Claude/.test(ask.engine) && ask.outcomes["Público"]?.startsWith("allow") && ask.outcomes.Personal === "ask · Pregunta una vez" && ask.outcomes.Confidencial === "block · No sale: se enseña aparte",
  JSON.stringify(ask),
);
t.check("catalogar sigue con su modelo, claude-haiku-5-5", /claude-haiku-5-5/.test(catalog.engine) && catalog.outcomes.Confidencial === "block · No sale: sin ficha", JSON.stringify(catalog));
t.check("la tabla dice que no hay respaldo automático", await page.eval(`/Sin respaldo automático/.test(document.querySelector("section[aria-labelledby=ai-router-title]").textContent)`));
await page.eval(`(document.querySelector("section[aria-labelledby=ai-router-title]").scrollIntoView({ block: "start" }), true)`);
await page.sleep(300);
await page.screenshot(`${work}/1-quien-hace-cada-tarea.png`);

// ---- Indexar: los vectores los calcula Ollama, sin pasar por la nube ------------------------------------------------------
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 30000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(`[...document.querySelectorAll("[role=status]")].some((p) => /^Listo\\./.test(p.textContent.trim()))`, { timeout: 60000 });
const state = await page.eval(`document.querySelector("[data-testid=semantic-state]").textContent`);
t.check("indexa con Ollama sin pedir confirmación de envío (no sale del equipo)", calls.ollamaEmbed.length > 0 && calls.ollamaEmbed.every((call) => call.model === "embeddinggemma") && calls.hostedEmbed === 0, `ollama ${calls.ollamaEmbed.length} · nube ${calls.hostedEmbed}`);
t.check("y el diario confidencial también se busca por significado: Ollama está en este equipo", /2 libros indexados de 2 · 2 con búsqueda por significado/.test(state), state);

// ---- Preguntar: la pregunta se vectoriza en Ollama; responde Claude con su modelo y su clave --------------------------
await page.eval(`([...document.querySelectorAll("[role=radiogroup][aria-label='Buscar o preguntar'] [role=radio]")].find((b) => b.textContent.trim() === "Preguntar").click(), true)`);
await page.waitFor(`document.querySelector("label[for=semantic-query]")?.textContent === "Qué quieres saber"`, { timeout: 5000 });
const askNote = await page.eval(`[...document.querySelectorAll("p")].find((p) => /Responde solo con lo que dicen tus libros/.test(p.textContent))?.textContent ?? ""`);
t.check("el panel dice a quién se pregunta: Claude (claude-opus-5-5)", /Claude \(claude-opus-5-5\)/.test(askNote), askNote);
async function askQuestion(question) {
  await setValue("#semantic-query", question, "HTMLInputElement");
  await page.sleep(200);
  await page.eval(`(document.querySelector("form[role=search] button[type=submit]").click(), true)`);
  await page.waitFor(`document.querySelector("section[aria-label='Respuesta a «${question}»']") || [...document.querySelectorAll("[role=alert]")].some((a) => a.textContent.trim())`, { timeout: 20000 });
  await page.sleep(300);
}
const embedsBefore = calls.ollamaEmbed.length;
// La pregunta toca también el diario: así se ve que su fragmento se queda en el equipo.
await askQuestion("¿Qué hay en el centro del jardín y dónde está la llave?");
const sent = calls.answer.at(-1);
t.check("la pregunta se vectoriza en Ollama, no en la nube", calls.ollamaEmbed.length === embedsBefore + 1 && calls.hostedEmbed === 0, `${calls.ollamaEmbed.length - embedsBefore}`);
t.check("responde Claude con claude-opus-5-5 y la clave de Claude", sent?.body.provider === "anthropic" && sent.body.model === "claude-opus-5-5" && /^Bearer sk-ant-/.test(sent.auth), JSON.stringify({ model: sent?.body.model, provider: sent?.body.provider }));
t.check("al proveedor en la nube no le llega el diario confidencial", sent && !sent.body.fragments.some((f) => /diario|llave/i.test(f.text)), JSON.stringify(sent?.body.fragments.map((f) => f.title)));
const answerText = await page.eval(`document.querySelector("section[aria-label^='Respuesta a']")?.textContent ?? ""`);
t.check("y se enseña la respuesta con su cita", /Un laberinto de setos ocupa el centro/.test(answerText), answerText.slice(0, 200));
t.check("el diario se ofrece para leerlo en el equipo: no se envió a Claude", /no se envió a Claude|no se enviaron a Claude/.test(answerText) && answerText.includes("Diario"), answerText.slice(-200));

// ---- Si Claude falla, no se prueba con otro --------------------------------------------------------------------------------
answerFails = true;
const before = { answer: calls.answer.length, chat: calls.ollamaChat, other: calls.other.length };
await askQuestion("¿Quién entraba en el laberinto?");
const alert = await page.eval(`[...document.querySelectorAll("[role=alert]")].map((a) => a.textContent.trim()).filter(Boolean).join(" · ")`);
t.check("si Claude falla, se dice", /Anthropic no está disponible ahora mismo/.test(alert), alert);
t.check(
  "y no se prueba con otro proveedor por su cuenta (ni Ollama ni otra ruta)",
  calls.answer.slice(before.answer).every((call) => call.body.provider === "anthropic") && calls.ollamaChat === before.chat && calls.other.length === before.other,
  JSON.stringify({ answer: calls.answer.length - before.answer, chat: calls.ollamaChat - before.chat, other: calls.other.slice(before.other) }),
);
answerFails = false;

// ---- Solo por palabras: no sale nada para buscar ------------------------------------------------------------------------------
await page.eval(`(document.querySelector("a[href='/app/ajustes']")?.click(), true)`);
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#ai-index-provider")`, { timeout: 20000 });
await page.sleep(500);
await setValue("#ai-index-provider", "off");
await page.sleep(200);
await page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Guardar ajustes de IA").click(), true)`);
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
index = await matrixRow("index");
t.check("la tabla: buscar «solo por palabras», sin nadie que lo haga", /Nadie/.test(index.engine) && /Nada sale del equipo/.test(index.engine) && Object.values(index.outcomes).every((o) => o === "off · Solo por palabras"), JSON.stringify(index));
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`document.querySelector("#semantic-query")`, { timeout: 20000 });
const embedsOff = calls.ollamaEmbed.length;
await setValue("#semantic-query", "laberinto", "HTMLInputElement");
await page.sleep(200);
await page.eval(`(document.querySelector("form[role=search] button[type=submit]").click(), true)`);
await page.waitFor(`document.querySelector("section[aria-label='Resultados de «laberinto»']")`, { timeout: 20000 });
const results = await page.eval(`document.querySelector("section[aria-label='Resultados de «laberinto»']").textContent`);
t.check("busca por palabras, dice por qué y no pide ningún vector", /Se busca solo por palabras, como elegiste en Ajustes → IA/.test(results) && /Jardin/.test(results) && calls.ollamaEmbed.length === embedsOff && calls.hostedEmbed === 0, results.slice(0, 200));

// ---- El registro: quién hizo qué ------------------------------------------------------------------------------------------------
const entries = JSON.parse((await page.eval(`localStorage.getItem("pliegue-ai-processing-v1")`)) || "[]");
t.check(
  "el registro: indexar con Ollama en el equipo y consultar con Claude (claude-opus-5-5) en la nube",
  entries.some((e) => e.flow === "index" && e.provider === "ollama" && e.place === "device" && e.documentId === ids.Diario) &&
    entries.some((e) => e.flow === "ask" && e.provider === "anthropic" && e.model === "claude-opus-5-5" && e.place === "cloud" && e.sent > 0) &&
    entries.some((e) => e.flow === "ask" && e.documentId === ids.Diario && e.route === "kept-local"),
  JSON.stringify(entries.map((e) => [e.flow, e.provider, e.model, e.place, e.route])),
);

// ---- En el móvil, la tabla se apila y cabe --------------------------------------------------------------------------------------
await page.goto(`${BASE}/app/ajustes#ia`);
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.waitFor(`document.querySelector("section[aria-labelledby=ai-router-title] tr[data-flow=ask]")`, { timeout: 20000 });
await page.sleep(600);
await page.eval(`(document.querySelector("section[aria-labelledby=ai-router-title]").scrollIntoView({ block: "start" }), true)`);
await page.sleep(300);
const fit = await page.eval(`(() => {
  const s = document.querySelector("section[aria-labelledby=ai-router-title]").getBoundingClientRect();
  const level = document.querySelector("section[aria-labelledby=ai-router-title] td[data-outcome] span");
  return { right: Math.round(s.right), width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, level: getComputedStyle(level).display };
})()`);
t.check("en el móvil, la tabla cabe sin desplazamiento lateral y cada celda dice su nivel", fit.right <= fit.width && fit.scroll <= fit.width && fit.level === "block", JSON.stringify(fit));
await page.screenshot(`${work}/2-movil.png`);

const errors = page.errors.filter((error) => !/500 \(Internal Server Error\)|Anthropic no está disponible/.test(error));
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
