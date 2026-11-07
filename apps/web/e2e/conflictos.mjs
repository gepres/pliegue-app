// 06.3 · Conflictos y rapidez de la sincronización. Este equipo y «otro» (simulado en la cuenta)
// cambian el mismo ajuste antes de sincronizarse: gana el último y la versión de aquí queda en
// «Conflictos recientes», de donde se restaura. Cuenta dice además cuánto tarda un cambio en
// llegar a otro equipo frente al objetivo de 60 s. Supabase simulado en memoria; nada sale fuera.
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/conflictos`;
mkdirSync(work, { recursive: true });
const t = checker(`Conflictos y rapidez de la sincronización (${BASE})`);
const browser = await openChrome({ port: 9396, profile: `${PROFILE_ROOT}-conflictos` });
const page = await browser.newPage();
await page.viewport(1280, 900);
const email = "lectora.de.prueba@example.com";
const userId = "11111111-2222-3333-4444-555555555555";

// ---- La cuenta simulada: `sync_items` en memoria, con la hora del servidor de verdad -------------
const rows = new Map();
const json = (body) => Buffer.from(JSON.stringify(body)).toString("base64");
const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }, { name: "Access-Control-Allow-Methods", value: "*" }];
const serverNow = () => new Date().toISOString();

await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  if (request.url.startsWith(BASE)) return page.send("Fetch.continueRequest", { requestId }).catch(() => {});
  const reply = (code, body) => page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: headers, ...(body === undefined ? {} : { body: json(body) }) }).catch(() => {});
  if (request.method === "OPTIONS") return reply(204);
  const url = new URL(request.url);
  if (!url.hostname.endsWith("supabase.co")) return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  if (url.pathname === "/auth/v1/user") return reply(200, { email, id: userId });
  if (url.pathname === "/rest/v1/sync_items") {
    if (request.method === "GET") return reply(200, [...rows.values()].sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)));
    const written = [];
    for (const row of JSON.parse(request.postData || "[]")) {
      const id = `${row.collection}/${row.item_key}`;
      const current = rows.get(id);
      if (current && row.updated_at < current.updated_at) continue;
      const stored = { ...row, server_updated_at: serverNow() };
      rows.set(id, stored);
      written.push({ server_updated_at: stored.server_updated_at });
    }
    return reply(201, written);
  }
  return reply(200, url.pathname.includes("/rpc/") ? false : []);
});

const now = Math.floor(Date.now() / 1000);
const session = { access_token: "x", expires_at: now + 3600, expires_in: 3600, refresh_token: "y", token_type: "bearer", user: { app_metadata: { provider: "google" }, aud: "authenticated", email, id: userId, role: "authenticated", user_metadata: {} } };
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-auth", ${JSON.stringify(JSON.stringify(session))}), localStorage.setItem("pliegue-cloud-sync-v1", ${JSON.stringify(JSON.stringify({ [userId]: { catalogAi: true, enabled: true } }))}), true)`);

// ---- Primera vuelta: los ajustes de IA quedan en la cuenta (la versión común) ---------------------
await page.goto(`${BASE}/app/ajustes#ia`);
const until = async (check, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};
t.check("la primera vuelta sube los ajustes de IA", await until(() => rows.has("settings/ai")), [...rows.keys()].join(", "));
const common = rows.get("settings/ai");

// ---- «Otro equipo» cambia los análisis simultáneos a 4, con una hora posterior -----------------------
const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
rows.set("settings/ai", { ...common, device_id: "portatil", payload: { ...common.payload, concurrency: 4 }, server_updated_at: serverNow(), updated_at: later });

// ---- Y este, antes de recibirlo, los pone a 3 ------------------------------------------------------
await page.waitFor(`document.querySelector("#ai-concurrency")`, { timeout: 20000 });
await page.eval(`(() => { const el = document.querySelector("#ai-concurrency"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "3"); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await page.sleep(300);
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Guardar/.test(b.textContent.trim())).click(), true)`);
const won = await until(async () => (await page.eval(`JSON.parse(localStorage.getItem("pliegue-ai-settings-v1") ?? "{}").concurrency`)) === 4, 20000);
t.check("gana el último cambio (el del otro equipo): aquí queda 4", won, String(await page.eval(`JSON.parse(localStorage.getItem("pliegue-ai-settings-v1") ?? "{}").concurrency`)));

// ---- Cuenta: el conflicto, con la versión de aquí para restaurarla -----------------------------------
await page.eval(`(location.hash = "cuenta", true)`);
await page.waitFor(`document.querySelector("#sync-conflicts-title")`, { timeout: 20000 });
const item = await page.eval(`(() => { const li = document.querySelector("section[aria-labelledby='sync-conflicts-title'] li"); return li ? li.textContent.replace(/\\s+/g, " ").trim() : ""; })()`);
t.check("«Conflictos recientes» lo dice: qué, quién ganó y la otra versión", /^Ajustes de IA/.test(item) && /Se quedó la de otro equipo/.test(item) && /La otra versión/.test(item) && /Restaurar esta versión/.test(item), item);
await page.eval(`(document.querySelector("#sync-conflicts-title").scrollIntoView({ block: "start" }), true)`);
await page.screenshot(`${work}/1-conflicto.png`);

await page.eval(`([...document.querySelectorAll("section[aria-labelledby='sync-conflicts-title'] button")].find((b) => b.textContent.trim() === "Restaurar esta versión").click(), true)`);
const restored = await until(async () => rows.get("settings/ai")?.payload?.concurrency === 3, 20000);
t.check("«Restaurar» vuelve a la versión de aquí y la sube a la cuenta (gana a la del otro)", restored && rows.get("settings/ai").updated_at > later, JSON.stringify({ concurrency: rows.get("settings/ai")?.payload?.concurrency, updated_at: rows.get("settings/ai")?.updated_at }));
t.check("y aquí vuelve a ser 3", (await page.eval(`JSON.parse(localStorage.getItem("pliegue-ai-settings-v1") ?? "{}").concurrency`)) === 3);
await page.waitFor(`[...document.querySelectorAll("section[aria-labelledby='sync-conflicts-title'] small")].some((s) => s.textContent.trim() === "Restaurada")`, { timeout: 10000 }).catch(() => {});
t.check("el conflicto queda como «Restaurada»", await page.eval(`[...document.querySelectorAll("section[aria-labelledby='sync-conflicts-title'] small")].some((s) => s.textContent.trim() === "Restaurada")`));

// ---- Rapidez: con lo subido y lo recibido, el p95 frente al objetivo de 60 s ----------------------------
const speed = await page.eval(`document.querySelector("section[aria-labelledby='sync-speed-title']")?.textContent.replace(/\\s+/g, " ").trim() ?? ""`);
console.log("    rapidez:", speed);
t.check("Cuenta mide cuánto tarda un cambio en llegar y lo compara con 60 s", /Un cambio llega a tus otros equipos en unos [\d,]+\s?s/.test(speed) && /Objetivo: 60\s?s, cumplido\./.test(speed), speed);
await page.eval(`(document.querySelector("#sync-speed-title").scrollIntoView({ block: "start" }), true)`);
await page.screenshot(`${work}/2-rapidez.png`);

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
