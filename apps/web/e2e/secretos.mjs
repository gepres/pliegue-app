// 06.5 · Secretos. Dos frentes:
// 1. El código que llega al navegador no lleva claves privadas: ni de IA (sk-…, AIza… que no
//    sea la clave pública de Google del navegador), ni de servicio de Supabase, ni claves privadas.
// 2. La clave de IA que pega la persona vive solo en la memoria de la pestaña: no se guarda en
//    localStorage, sessionStorage, IndexedDB, cookies ni Cache Storage; solo viaja en la cabecera
//    Authorization de las rutas /api/ai/*, nunca en una URL ni en un cuerpo, ni a otro sitio; y
//    al recargar ya no está.
import { openChrome, checker, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const t = checker(`Secretos (${BASE})`);
const browser = await openChrome({ port: 9405, profile: `${PROFILE_ROOT}-secretos` });
const page = await browser.newPage();
await page.viewport(1366, 900);

// ---- 1. El código del navegador -------------------------------------------------------------------------------
const scripts = new Set();
for (const path of ["/", "/app", "/app/biblioteca", "/app/biblioteca/fuentes", "/app/lector", "/app/ia", "/app/ajustes"]) {
  await page.goto(`${BASE}${path}`);
  await page.sleep(800);
  const found = await page.eval(`[...new Set([...document.querySelectorAll("script[src]")].map((s) => s.src).concat(performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\.js(\\?|$)/.test(n))))]`);
  for (const url of found) if (url.startsWith(BASE)) scripts.add(url);
}
const patterns = [
  { name: "clave de OpenAI o Anthropic", re: /sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g },
  { name: "clave de Google", re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "clave secreta de Supabase", re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: "service_role de Supabase", re: /service_role/g },
  { name: "clave privada", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];
const leaks = [];
const publicGoogleKeys = new Set();
let bytes = 0;
for (const url of scripts) {
  const text = await fetch(url).then((r) => r.text(), () => "");
  bytes += text.length;
  for (const { name, re } of patterns) {
    for (const match of text.matchAll(re)) {
      const around = text.slice(Math.max(0, match.index - 40), match.index);
      // La clave de Google del navegador es pública por diseño (Picker, Drive en el navegador).
      if (name === "clave de Google" && /NEXT_PUBLIC_GOOGLE_API_KEY\s*:\s*"$/.test(around)) {
        publicGoogleKeys.add(match[0].slice(0, 8));
        continue;
      }
      leaks.push(`${name} en ${url.replace(BASE, "")}: …${around.slice(-24)}${match[0].slice(0, 10)}…`);
    }
  }
}
t.check(`el código del navegador no lleva claves privadas (${scripts.size} scripts, ${Math.round(bytes / 1024)} KB)`, scripts.size > 5 && leaks.length === 0, leaks.slice(0, 3).join(" | "));
if (publicGoogleKeys.size) console.log(`  · aviso: va la clave pública de Google del navegador (${[...publicGoogleKeys].join(", ")}…): debe estar restringida por dominio en Google Cloud.`);

// ---- 2. La clave de la sesión -------------------------------------------------------------------------------------
const KEY = `sk-proj-PRUEBASECRETA${"7".repeat(30)}`;
const requests = [];
await page.send("Network.enable");
browser.on((m) => {
  if (m.sessionId !== page.sessionId) return;
  if (m.method === "Network.requestWillBeSent") {
    const { request } = m.params;
    requests.push({ body: request.postData ?? "", headers: request.headers ?? {}, id: m.params.requestId, url: request.url });
  }
  if (m.method === "Network.requestWillBeSentExtraInfo") {
    const entry = requests.find((r) => r.id === m.params.requestId);
    if (entry) entry.headers = { ...entry.headers, ...m.params.headers };
  }
});
// La IA, simulada: ninguna clave sale de verdad.
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai/*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const title = /"title":"([^"]+)"/.exec(m.params.request.postData ?? "")?.[1] ?? "Libro";
  const body = { catalog: { authors: ["Autora"], canonicalTitle: title, confidence: 0.9, genres: [], language: "es", publicationYear: null, summary: "Resumen.", topics: [], workType: "book" }, usage: { inputTokens: 10, outputTokens: 5 } };
  page.send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
});

await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "openai", concurrency: 1 })), true)`);
// Un libro que catalogar, para que la clave se use de verdad.
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
const { writeFileSync, mkdirSync } = await import("node:fs");
const { WORK } = await import("./lib/cdp.mjs");
mkdirSync(`${WORK}/secretos`, { recursive: true });
writeFileSync(`${WORK}/secretos/Notas.txt`, "Unas notas de prueba para catalogar con una clave que no debe quedarse en ningún sitio.");
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${WORK}/secretos/Notas.txt`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

await page.eval(`(document.querySelector("a[href^='/app/ajustes']").click(), true)`);
await page.waitFor(`document.querySelector("a[href^='/app/ajustes']")`);
await page.eval(`(location.hash = "ia", true)`);
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(KEY)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(300);
  if ((await page.eval(`document.querySelector("#ai-api-key")?.value?.length ?? 0`)) > 0) break;
}
// Enmascarada: `password`, o texto con `-webkit-text-security` (así el gestor de contraseñas no
// ofrece guardarla). Y sin autocompletar.
const field = await page.eval(`(() => { const el = document.querySelector("#ai-api-key"); const style = getComputedStyle(el); return { type: el.type, security: style.webkitTextSecurity ?? style.getPropertyValue("-webkit-text-security"), autocomplete: el.autocomplete }; })()`);
t.check(
  "el campo de la clave la enseña enmascarada y sin autocompletar",
  (field.type === "password" || field.security === "disc") && ["off", "new-password"].includes(field.autocomplete),
  JSON.stringify(field),
);
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 30000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Catalogar \\d+ documentos?$/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(`[...document.querySelectorAll("p, [role=status]")].some((p) => /1 catalogado/.test(p.textContent))`, { timeout: 30000 }).catch(() => {});
await page.sleep(800);

const aiCalls = requests.filter((r) => /\/api\/ai\//.test(r.url));
const authorization = (r) => r.headers.Authorization ?? r.headers.authorization ?? "";
t.check("la clave se usó: el catálogo llamó a /api/ai con ella", aiCalls.length > 0 && aiCalls.every((r) => authorization(r) === `Bearer ${KEY}`), `${aiCalls.length} llamadas`);
const exposed = requests.filter((r) => r.url.includes(KEY) || r.body.includes(KEY) || (Object.entries(r.headers).some(([name, value]) => String(value).includes(KEY)) && !(/\/api\/ai\//.test(r.url) && authorization(r) === `Bearer ${KEY}`)));
t.check("la clave no va en ninguna URL ni cuerpo, ni a otro sitio que /api/ai en Authorization", exposed.length === 0, exposed.map((r) => r.url).slice(0, 3).join(" | "));

const dump = () =>
  page.eval(`(async () => {
    const out = [];
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i += 1) out.push(store.key(i) + "=" + store.getItem(store.key(i)));
    out.push(document.cookie);
    const safe = (value) => { try { return JSON.stringify(value, (k, v) => (v instanceof Blob ? "[blob]" : ArrayBuffer.isView(v) ? "[bytes]" : v)); } catch { return ""; } };
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise((ok) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
      if (!db) continue;
      for (const store of db.objectStoreNames) {
        const all = await new Promise((ok) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });
        out.push(name + "/" + store + ":" + safe(all));
      }
      db.close();
    }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        out.push(request.url);
        const response = await cache.match(request);
        if (/text|json|javascript/.test(response?.headers.get("content-type") ?? "")) out.push(await response.text());
      }
    }
    return out.join("\\n");
  })()`);
let stored = await dump();
t.check(`la clave no está en localStorage, sessionStorage, cookies, IndexedDB ni la caché (${Math.round(stored.length / 1024)} KB revisados)`, stored.length > 0 && !stored.includes(KEY) && !stored.includes(KEY.slice(8, 30)));

await page.goto(`${BASE}/app/ajustes#ia`);
await page.waitFor(`document.querySelector("#ai-api-key")`, { timeout: 20000 });
await page.sleep(800);
t.check("al recargar, la clave ya no está: hay que volver a ponerla", (await page.eval(`document.querySelector("#ai-api-key").value`)) === "");
stored = await dump();
t.check("y sigue sin estar guardada en ningún sitio", !stored.includes(KEY));

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
