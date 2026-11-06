// 04.2: «Probar conexión» enseña las capacidades del modelo y avisa si no sirve para catalogar
// y traducir. Ollama simulado por CDP (POST /api/show); la ruta /api/ai/check, también, para
// un proveedor con clave. Ninguna llamada real.
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/capacidades-modelo`;
mkdirSync(work, { recursive: true });
const t = checker(`Capacidades por modelo (${BASE})`);
const browser = await openChrome({ port: 9393, profile: `${PROFILE_ROOT}-capacidades` });
const page = await browser.newPage();
await page.viewport(1366, 900);

const ollamaShow = {
  "qwen3:4b": { capabilities: ["completion", "tools", "thinking"], model_info: { "general.architecture": "qwen3", "qwen3.context_length": 40960 } },
  "nomic-embed-text": { capabilities: ["embedding"], model_info: { "general.architecture": "nomic-bert", "nomic-bert.context_length": 2048 } },
};
const shown = [];
const external = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*:11434/*" }, { urlPattern: "*/api/ai/check" }, { urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }];
  const reply = (code, body) => page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
  if (request.url.startsWith("https://")) {
    external.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  if (request.method === "OPTIONS") return page.send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: headers }).catch(() => {});
  if (request.url.includes("/api/ai/check")) {
    // Lo que contestaría la ruta con la ficha de Gemini ya leída en el servidor.
    return reply(200, { capabilities: { contextTokens: 1048576, embeddings: false, maxOutputTokens: 65536, structuredOutput: true, vision: true }, modelName: "Gemini 2.5 Flash", ok: true });
  }
  const body = JSON.parse(request.postData ?? "{}");
  shown.push(`${request.method} ${new URL(request.url).pathname} ${body.model ?? ""}`);
  const info = ollamaShow[body.model];
  return info ? reply(200, info) : reply(404, { error: `model '${body.model}' not found` });
});

async function openSettings(settings) {
  await page.goto(`${BASE}/app`);
  await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", ${JSON.stringify(JSON.stringify(settings))}), true)`);
  await page.goto(`${BASE}/app/ajustes?v=${Date.now()}#ia`);
  await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Probar conexión" && !b.disabled)`, { timeout: 30000 });
}
const probe = async () => {
  // El texto de ayuda del servidor es el de los ajustes por defecto; tras hidratar cambia al del
  // proveedor guardado. Se espera a eso antes de leerlo, y el clic se repite hasta que arranca.
  await page.sleep(3000);
  const hint = await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Probar conexión").parentElement.querySelector("p")?.textContent ?? ""`);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Probar conexión")?.click(), true)`);
    await page.sleep(700);
    const now = await page.eval(`[...document.querySelectorAll("button")].find((b) => /^(Probar conexión|Probando…)$/.test(b.textContent.trim()))?.parentElement.querySelector("p")?.textContent ?? ""`);
    if (now && now !== hint) break;
  }
  await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Probar conexión")`, { timeout: 20000 });
  await page.sleep(400);
  return page.eval(`(() => { const g = document.querySelector("[aria-label='Capacidades del modelo']"); return { tags: g ? [...g.querySelectorAll(".pliegue-tag, [class*=tag]")].map((x) => x.textContent.trim()).filter(Boolean) : [], alert: g?.querySelector("[role=alert]")?.textContent.trim() ?? "" }; })()`);
};
const models = (ollama) => ({ anthropic: "claude-haiku-4-5", gemini: "gemini-2.5-flash", ollama, openai: "gpt-5.6-luna" });

// ---- Ollama con un modelo de chat ----------------------------------------------------------------
await openSettings({ models: models("qwen3:4b"), ollamaMode: "local", ollamaUrl: "", provider: "ollama" });
let result = await probe();
console.log("    qwen3:4b →", result.tags.join(" | "));
t.check("Ollama se prueba con /api/show y el modelo elegido", shown.some((x) => x === "POST /api/show qwen3:4b"), shown.join(" · "));
t.check("qwen3:4b: salida JSON sí, imágenes no, embeddings no", result.tags.includes("Salida JSON") && result.tags.includes("Imágenes: no") && result.tags.includes("Embeddings: no"), result.tags.join(" | "));
t.check("y su contexto, leído de la ficha (40 960 → «40,9 k»)", result.tags.some((x) => /^Contexto 41 k$|^Contexto 40,9 k$/.test(x)), result.tags.join(" | "));
t.check("sin aviso: sirve para catalogar y traducir", result.alert === "");
await page.screenshot(`${work}/1-ollama-qwen.png`);

// ---- Ollama con un modelo de embeddings: aviso -------------------------------------------------
await openSettings({ models: models("nomic-embed-text"), ollamaMode: "local", ollamaUrl: "", provider: "ollama" });
result = await probe();
console.log("    nomic-embed-text →", result.tags.join(" | "));
t.check("un modelo de embeddings: avisa de que no catalogará ni traducirá", /no admite salida JSON estructurada/.test(result.alert) && result.tags.includes("Embeddings"), result.alert);
t.check("el aviso no impide guardar", await page.eval(`[...document.querySelectorAll("button")].some((b) => /^Guardar/.test(b.textContent.trim()) && !b.disabled)`));
await page.screenshot(`${work}/2-ollama-embed.png`);

// ---- Un modelo que no está: el mismo error de siempre ------------------------------------------
await openSettings({ models: models("llama9:1b"), ollamaMode: "local", ollamaUrl: "", provider: "ollama" });
result = await probe();
const message = await page.eval(`[...document.querySelectorAll("p")].map((p) => p.textContent).find((x) => /llama9/.test(x)) ?? ""`);
t.check("un modelo que no está: dice que falta y no enseña capacidades", result.tags.length === 0 && /llama9:1b/.test(message), message.slice(0, 120));

// ---- Gemini (con clave): las capacidades que devuelve la ruta ----------------------------------
await openSettings({ models: models("qwen3:4b"), ollamaMode: "local", ollamaUrl: "", provider: "gemini" });
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "AIzaSy" + "x".repeat(33)); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(400);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}
result = await probe();
console.log("    gemini-2.5-flash →", result.tags.join(" | "), "·", await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Probar conexión")?.parentElement.querySelector("p")?.textContent ?? "sin p"`), "· clave:", await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? -1`));
t.check("Gemini: salida JSON, imágenes, contexto 1 M y salida máxima", result.tags.includes("Salida JSON") && result.tags.includes("Imágenes") && result.tags.some((x) => /^Contexto 1 M$|^Contexto 1 M/.test(x)) && result.tags.some((x) => /^Salida máxima/.test(x)), result.tags.join(" | "));
await page.screenshot(`${work}/3-gemini.png`);

// ---- Móvil y oscuro -------------------------------------------------------------------------------
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.theme("dark");
// El panel de Ajustes entra deslizándose al pasar al móvil: se mide ya quieto (hasta 4 s), no a
// medio camino. Un desborde de verdad sigue ahí y la prueba falla igual.
await page.waitFor(`document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0`, { timeout: 4000 }).catch(() => {});
const overflow = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
t.check("en el móvil las etiquetas no desbordan", overflow <= 0, `${overflow}px`);
await page.eval(`document.querySelector("[aria-label='Capacidades del modelo']")?.scrollIntoView({ block: "center" }), true`);
await page.sleep(300);
await page.screenshot(`${work}/4-movil-oscuro.png`);

t.check("nada sale fuera", external.length === 0, external.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
