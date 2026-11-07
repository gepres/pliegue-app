// 04.2b · Modelos al día: quien seguía con un modelo de partida antiguo pasa al nuevo y Ajustes lo
// avisa una vez; con Ollama, Ajustes recomienda qwen3:8b y, si no está, lo descarga con su
// avance (Ollama simulado con CDP en localhost:11434; nada se descarga de verdad).
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/modelos-ollama`;
mkdirSync(work, { recursive: true });
const t = checker(`Modelos al día y descarga de Ollama (${BASE})`);
const browser = await openChrome({ port: 9395, profile: `${PROFILE_ROOT}-modelos-ollama` });
const page = await browser.newPage();
await page.viewport(1366, 900);

// ---- Ollama simulado: qwen3:8b no está hasta que se descarga ----------------------------------------
let installed = false;
let ollamaDown = false;
const pulls = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:11434/*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }];
  const reply = (code, text) => page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(text).toString("base64") }).catch(() => {});
  if (ollamaDown) return page.send("Fetch.failRequest", { errorReason: "ConnectionRefused", requestId }).catch(() => {});
  if (request.method === "OPTIONS") return reply(204, "");
  const body = JSON.parse(request.postData ?? "{}");
  if (request.url.endsWith("/api/show")) {
    return body.model === "qwen3:8b" && installed ? reply(200, JSON.stringify({ capabilities: ["completion"], details: { family: "qwen3" } })) : reply(404, JSON.stringify({ error: `model '${body.model}' not found` }));
  }
  if (request.url.endsWith("/api/pull")) {
    pulls.push(body);
    installed = true;
    const lines = [
      { status: "pulling manifest" },
      { completed: 2_600_000_000, digest: "sha256:a1", status: "pulling a1", total: 5_200_000_000 },
      { completed: 5_200_000_000, digest: "sha256:a1", status: "pulling a1", total: 5_200_000_000 },
      { status: "verifying sha256 digest" },
      { status: "writing manifest" },
      { status: "success" },
    ];
    return reply(200, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }
  return reply(200, JSON.stringify({ version: "0.13.0" }));
});

// Ajustes guardados con los modelos de partida de antes (y uno elegido a mano).
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "ollama", models: { openai: "gpt-5.6-luna", anthropic: "claude-sonnet-5", gemini: "gemini-3.8-flash", ollama: "qwen3:8b" }, translationModels: { anthropic: "claude-haiku-4-5" }, translationProvider: "ollama" })), true)`);
await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /Modelos al día/.test(p.textContent))`, { timeout: 20000 });
const notice = await page.eval(`[...document.querySelectorAll("p")].find((p) => /Modelos al día/.test(p.textContent)).textContent`);
t.check("avisa del cambio de los modelos de partida antiguos", /gpt-5\.6-luna → gpt-6-luna/.test(notice) && /claude-sonnet-5 → claude-haiku-5-5/.test(notice) && /claude-haiku-4-5 → claude-haiku-5-5/.test(notice), notice);
t.check("y no toca el que se eligió a mano", !/gemini-3\.8-flash/.test(notice));
await page.screenshot(`${work}/1-aviso.png`);
await page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Entendido").click(), true)`);
await page.sleep(400);
const saved = JSON.parse(await page.eval(`localStorage.getItem("pliegue-ai-settings-v1")`));
t.check("«Entendido» guarda los nuevos y el aviso se va", saved.models.openai === "gpt-6-luna" && saved.models.anthropic === "claude-haiku-5-5" && saved.translationModels.anthropic === "claude-haiku-5-5" && saved.models.gemini === "gemini-3.8-flash" && !(await page.eval(`[...document.querySelectorAll("p")].some((p) => /Modelos al día/.test(p.textContent))`)), JSON.stringify(saved.models));

// ---- Ollama: recomendado, no está, se descarga ------------------------------------------------------
await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /qwen3:8b no está en tu Ollama/.test(p.textContent))`, { timeout: 20000 });
const recommended = await page.eval(`[...document.querySelectorAll("p")].find((p) => /^Recomendado: qwen3:8b/.test(p.textContent.trim()))?.textContent ?? ""`);
t.check("recomienda qwen3:8b, con lo que pesa y la memoria que pide", /Gratis y en tu equipo/.test(recommended) && /5,2\s?GB/.test(recommended) && /16\s?GB de memoria/.test(recommended), recommended);
t.check("dice que el modelo no está y ofrece descargarlo", await page.eval(`[...document.querySelectorAll("button")].some((b) => /^Descargar qwen3:8b \\(≈5,2\\sGB\\)$/.test(b.textContent.trim()))`));
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Descargar qwen3:8b/.test(b.textContent.trim())).scrollIntoView({ block: "center" }), true)`);
await page.screenshot(`${work}/2-sin-modelo.png`);
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Descargar qwen3:8b/.test(b.textContent.trim())).click(), true)`);
const done = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /qwen3:8b ya está descargado en Ollama/.test(p.textContent))`, { timeout: 20000 }).then(() => true, () => false);
t.check("descarga con /api/pull y luego lo da por descargado", done && pulls.length >= 1 && pulls[0].model === "qwen3:8b" && pulls[0].stream === true, JSON.stringify(pulls));
await page.screenshot(`${work}/3-descargado.png`);

// ---- Ollama apagado: lo dice con salida ---------------------------------------------------------------
ollamaDown = true;
await page.goto(`${BASE}/app/ajustes?v=2#ia`);
const unreachable = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /Ollama no responde en/.test(p.textContent))`, { timeout: 20000 }).then(() => true, () => false);
t.check("con Ollama apagado, lo dice y cómo arreglarlo", unreachable && (await page.eval(`[...document.querySelectorAll("p")].find((p) => /Ollama no responde en/.test(p.textContent)).textContent`)).includes("OLLAMA_ORIGINS"));

const errors = page.errors.filter((error) => !/11434|ERR_CONNECTION_REFUSED|Failed to fetch/.test(error));
t.check("sin errores en la consola (salvo el de Ollama apagado, que es el caso)", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
