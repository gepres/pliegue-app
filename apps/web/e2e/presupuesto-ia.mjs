// 04.6 · Presupuesto de IA: el límite del mes se pone en Ajustes → IA; catalogar avisa al 80 %
// y para la cola al 100 % (termina la ficha en curso); traducir con «Tu IA» para antes de la
// sección siguiente y ofrece «Seguir con este libro». Gemini simulado (catálogo y traducción) y
// una clave de prueba solo en memoria; nada sale fuera.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/presupuesto-ia`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Presupuesto de IA (${BASE})`);
const browser = await openChrome({ port: 9387, profile: `${PROFILE_ROOT}-presupuesto` });
const page = await browser.newPage();
await page.viewport(1366, 900);

const epub = (title, chapters) =>
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">en</dc:language></metadata><manifest>${chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml" />`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}" />`).join("")}</spine></package>`),
    ...Object.fromEntries(chapters.map((text, i) => [`c${i}.xhtml`, strToU8(`<html><body><h1>Chapter ${i + 1}</h1><p>${text}</p></body></html>`)])),
  });
const titles = ["Uno", "Dos", "Tres", "Cuatro", "Cinco"];
for (const title of titles) writeFileSync(`${work}/${title}.epub`, epub(title, [`The story of ${title}. `.repeat(40)]));
writeFileSync(`${work}/Viaje.epub`, epub("Viaje", ["The journey starts at dawn.", "The road turns north.", "They reach the sea."]));

// ---- Gemini simulado: cada ficha gasta 100 k tokens de entrada y 20 k de salida (0,08 $) -------
const calls = { catalog: 0, translate: 0 };
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/catalog" }, { urlPattern: "*/api/ai/translate" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const reply = (body) =>
    page.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
  const body = JSON.parse(request.postData ?? "{}");
  if (request.url.includes("/api/ai/catalog")) {
    calls.catalog += 1;
    const title = /"title":"([^"]+)"/.exec(request.postData ?? "")?.[1] ?? "Libro";
    const answer = () => reply({ catalog: { authors: ["Autora de Prueba"], canonicalTitle: title, confidence: 0.9, genres: [], language: "en", publicationYear: null, summary: "Un resumen.", topics: [], workType: "book" }, usage: { inputTokens: 100_000, outputTokens: 20_000 } });
    // La tercera ficha tarda: el aviso del 88 % se pinta antes de que llegue el del tope, que lo
    // sustituiría en el mismo fotograma (en el CI se perdía).
    if (calls.catalog === 3) return void setTimeout(answer, 1500);
    return answer();
  }
  calls.translate += 1;
  return reply({ translations: (body.passages ?? []).map((text) => `[ES] ${text}`), usage: { inputTokens: 1000, outputTokens: 1000 } });
});

// Gemini para catalogar y traducir, de uno en uno.
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "gemini", concurrency: 1, translationProvider: "gemini" })), true)`);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [...titles, "Viaje"].map((title) => `${work}/${title}.epub`));
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 6`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

// ---- El límite, desde el panel nuevo ---------------------------------------------------------------
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#budget-usd")`, { timeout: 20000 });
const setInput = (selector, value) =>
  page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return el.value; })()`);
for (let attempt = 0; attempt < 20 && (await setInput("#budget-usd", "0.18")) !== "0.18"; attempt += 1) await page.sleep(300);
await page.sleep(300);
const empty = await page.eval(`document.querySelector("section[aria-labelledby='ai-budget-month'] p")?.textContent ?? ""`);
t.check("sin gasto todavía, el panel lo dice", /Todavía no has usado ninguna IA este mes/.test(empty), empty);
await page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Guardar presupuesto").click(), true)`);
await page.sleep(400);
const savedBudget = await page.eval(`JSON.parse(localStorage.getItem("pliegue-ai-settings-v1")).budget`);
t.check("el límite se guarda con los ajustes de IA", savedBudget?.monthlyUsd === 0.18, JSON.stringify(savedBudget?.monthlyUsd));
// Al volver a la página, el formulario enseña lo guardado (no los valores de fábrica).
await page.goto(`${BASE}/app/ajustes?v=2#ia`);
await page.waitFor(`document.querySelector("#budget-usd")?.value === "0.18"`, { timeout: 20000 }).catch(() => {});
t.check("al volver, el límite guardado sigue en el formulario", (await page.eval(`document.querySelector("#budget-usd")?.value`)) === "0.18", await page.eval(`document.querySelector("#budget-usd")?.value`));
await page.eval(`(document.querySelector("#ai-budget-title").scrollIntoView(), true)`);
await page.screenshot(`${work}/1-panel.png`);

// La clave de prueba vive solo en memoria: se pega y se navega sin recargar.
await page.eval(`(document.querySelector("#ai-api-key").scrollIntoView({ block: "center" }), true)`);
for (let attempt = 0; attempt < 20; attempt += 1) {
  await setInput("#ai-api-key", "AIzaSy" + "x".repeat(33));
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}

// ---- Catalogar: avisa al 80 % y para la cola al llegar al tope -------------------------------------
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 30000 });
// Los avisos se apuntan en la página según aparecen: el de 80 % dura poco, llega el de 100 %.
await page.eval(`(() => {
  window.__avisos = [];
  const mirar = () => {
    for (const region of document.querySelectorAll("[role=status]")) {
      const text = region.textContent.trim();
      if (/presupuesto/.test(text) && /^En /.test(text) && !window.__avisos.includes(text)) window.__avisos.push(text);
    }
  };
  new MutationObserver(mirar).observe(document.body, { characterData: true, childList: true, subtree: true });
  return true;
})()`);
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim())).click(), true)`);
const finished = await page.waitFor(`[...document.querySelectorAll("p, [role=status]")].some((p) => /se alcanzó el presupuesto del mes en dólares/.test(p.textContent) && /catalogad/.test(p.textContent))`, { timeout: 60000 }).then(() => true, () => false);
await page.sleep(600);
const toasts = await page.eval(`window.__avisos ?? []`);
const status = await page.eval(`[...document.querySelectorAll("p, [role=status]")].map((p) => p.textContent.trim()).find((x) => /se alcanzó el presupuesto/.test(x) && /catalogad/.test(x)) ?? ""`);
t.check("la cola se para con el presupuesto agotado, y lo dice", finished, status);
t.check("termina la ficha en curso y no empieza la siguiente (3 de 5)", calls.catalog === 3 && /3 catalogados/.test(status), `${calls.catalog} fichas pedidas · ${status}`);
t.check("avisa al cruzar el 80 %", toasts.some((x) => /llevas el 88 % del presupuesto del mes en dólares/.test(x)), toasts.join(" | ") || "sin aviso");
t.check("y al llegar al tope", toasts.some((x) => /se alcanzó el presupuesto del mes en dólares/.test(x)), toasts.join(" | ") || "sin aviso");
await page.screenshot(`${work}/2-catalogo-parado.png`);

// ---- Ajustes dice lo gastado y el estado ----------------------------------------------------------
await page.eval(`(document.querySelector("a[href^='/app/ajustes']").click(), true)`);
await page.waitFor(`document.querySelector("a[href='/app/ajustes#ia'], [href$='#ia']")`, { timeout: 20000 }).catch(() => {});
await page.eval(`(location.hash = "ia", true)`);
await page.waitFor(`document.querySelector("#ai-budget-title")`, { timeout: 20000 });
await page.sleep(400);
const panel = await page.eval(`(() => {
  const rows = [...document.querySelectorAll("section[aria-labelledby='ai-budget-month'] tbody tr")].map((r) => [...r.children].map((c) => c.textContent.trim()).join(" | "));
  const total = [...document.querySelectorAll("section[aria-labelledby='ai-budget-month'] tfoot tr")].map((r) => [...r.children].map((c) => c.textContent.trim()).join(" | "))[0] ?? "";
  const alert = document.querySelector("section[aria-labelledby='ai-budget-month'] [data-level]:not(tr)")?.textContent ?? "";
  return { alert, rows, total };
})()`);
t.check("cuenta los tokens de Gemini", panel.rows.some((row) => /^Gemini \| 360\.000 tokens \| 0,24\s?US\$$/.test(row)), panel.rows.join(" · "));
t.check("y el total con el estado", /0,24/.test(panel.total) && /se alcanzó el presupuesto del mes en dólares/.test(panel.alert), `${panel.total} · ${panel.alert}`);
await page.eval(`(document.querySelector("#ai-budget-title").scrollIntoView(), true)`);
await page.screenshot(`${work}/3-panel-gastado.png`);

// ---- Traducir: para en la primera sección; «Seguir con este libro» la deja seguir --------------------
await page.eval(`(document.querySelector("a[href='/app/biblioteca']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("article")].some((a) => /Viaje/.test(a.getAttribute("aria-label") ?? ""))`, { timeout: 20000 });
await page.eval(`([...document.querySelectorAll("article")].find((a) => /Viaje/.test(a.getAttribute("aria-label") ?? "")).querySelector("a[href*='/app/lector?document=']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /journey starts/.test(p.textContent))`, { timeout: 30000 });
await page.sleep(1200);
await page.key("t", { code: "KeyT", keyCode: 84, text: "t" });
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /Traducir este libro/.test(b.textContent))`, { timeout: 20000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /Traducir este libro/.test(b.textContent.trim())).click(), true)`);
const blocked = await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Seguir con este libro")`, { timeout: 30000 }).then(() => true, () => false);
const stopped = await page.eval(`[...document.querySelectorAll("p")].map((p) => p.textContent.trim()).find((x) => /^Se detuvo:/.test(x)) ?? ""`);
t.check("traducir con «Tu IA» se para antes de la primera sección", blocked && calls.translate === 0 && /se alcanzó el presupuesto/.test(stopped), `${calls.translate} peticiones · ${stopped}`);
t.check("parada, ninguna sección dice que se está traduciendo", !(await page.eval(`[...document.querySelectorAll("p")].some((p) => /Traduciendo esta sección/.test(p.textContent))`)));
t.check("y ofrece cambiar el límite", await page.eval(`Boolean(document.querySelector("a[href='/app/ajustes#ia']"))`));
await page.screenshot(`${work}/4-traduccion-parada.png`);
await page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Seguir con este libro").click(), true)`);
const continued = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /^\\[ES\\] The journey/.test(p.textContent.trim()))`, { timeout: 30000 }).then(() => true, () => false);
t.check("«Seguir con este libro» traduce a conciencia", continued && calls.translate > 0, `${calls.translate} peticiones`);
const usage = JSON.parse((await page.eval(`localStorage.getItem("pliegue-ai-usage-v1")`)) ?? "{}");
const month = Object.keys(usage?.own ?? {})[0];
const geminiTranslate = usage?.own?.[month]?.usage?.gemini;
t.check("lo gastado al traducir también se apunta", Object.values(geminiTranslate ?? {}).reduce((sum, c) => sum + c.requests, 0) > 3, JSON.stringify(geminiTranslate));
t.check("el permiso es solo para este libro y este mes", Array.isArray(usage?.overrides?.[month]) && usage.overrides[month].length === 1, JSON.stringify(usage?.overrides));
const stored = JSON.stringify(usage);
t.check("el contador no guarda textos, solo cifras", !/journey|story|Uno|Viaje/.test(stored), stored.slice(0, 120));
await page.screenshot(`${work}/5-traduccion-sigue.png`);

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
