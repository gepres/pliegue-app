// 06.3 · Traducciones en la cuenta, con dos equipos de verdad (dos perfiles de Chrome) contra
// una cuenta simulada en memoria: `sync_items` y el bucket `translations`. El PC traduce un
// libro con LibreTranslate (simulado) y la traducción sube; el portátil, con el mismo archivo,
// la baja al dar el permiso y la lee sin traducir nada. Nada sale fuera.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/traducciones-nube`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Traducciones en la cuenta, entre dos equipos (${BASE})`);
const email = "lectora.de.prueba@example.com";
const userId = "11111111-2222-3333-4444-555555555555";

// El mismo libro en los dos equipos: mismo nombre y mismo tamaño.
const epub = zipSync({
  mimetype: [strToU8("application/epub+zip"), { level: 0 }],
  "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
  "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Saudade</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">es</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
  "a.xhtml": strToU8(`<html><body><h1>Saudade</h1><p>La palabra saudade es casi intraducible, dicen los poetas.</p><p>Un segundo párrafo para la prueba.</p></body></html>`),
});
writeFileSync(`${work}/Saudade.epub`, epub);

/* ---- La cuenta simulada: `sync_items` y el bucket, en memoria ---------------------------------- */

const rows = new Map();
const objects = new Map();
const log = { downloads: [], libre: { laptop: 0, pc: 0 }, uploads: [], external: [] };
let serverClock = Date.parse("2026-11-06T12:00:00.000Z");
const json = (body) => Buffer.from(JSON.stringify(body)).toString("base64");
const cors = [{ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }, { name: "Access-Control-Allow-Methods", value: "*" }];
const jsonHeaders = [{ name: "Content-Type", value: "application/json" }, ...cors];

function bodyOf(request) {
  if (typeof request.postData === "string") return request.postData;
  return Buffer.concat((request.postDataEntries ?? []).map((part) => Buffer.from(part.bytes ?? "", "base64"))).toString("utf8");
}

function attach(browser, page, label) {
  browser.on((m) => {
    if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
    const { requestId, request } = m.params;
    const reply = (responseCode, body, headers = jsonHeaders) =>
      page.send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: headers, ...(body === undefined ? {} : { body }) }).catch(() => {});
    if (request.method === "OPTIONS") return reply(204);
    const url = new URL(request.url);

    if (url.hostname === "libre.prueba") {
      const q = JSON.parse(bodyOf(request) || "{}").q;
      const texts = Array.isArray(q) ? q : [q];
      log.libre[label] += texts.length;
      return reply(200, json({ translatedText: texts.map((x) => `[Libre] ${x}`) }));
    }
    if (!url.hostname.endsWith("supabase.co")) {
      log.external.push(request.url);
      return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
    }
    if (url.pathname === "/auth/v1/user") return reply(200, json({ email, id: userId }));

    if (url.pathname === "/rest/v1/sync_items") {
      if (request.method === "GET") {
        return reply(200, json([...rows.values()].sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at))));
      }
      for (const row of JSON.parse(bodyOf(request) || "[]")) {
        const id = `${row.collection}/${row.item_key}`;
        const current = rows.get(id);
        if (current && row.updated_at < current.updated_at) continue;
        serverClock += 1000;
        rows.set(id, { ...row, server_updated_at: new Date(serverClock).toISOString() });
      }
      return reply(201, json([]));
    }

    const object = url.pathname.match(/^\/storage\/v1\/object\/translations\/(.+)$/);
    if (object) {
      const path = decodeURIComponent(object[1]);
      if (request.method === "GET") {
        log.downloads.push({ label, path });
        return objects.has(path) ? reply(200, Buffer.from(objects.get(path)).toString("base64")) : reply(404, json({ error: "not_found", message: "Object not found", statusCode: "404" }));
      }
      const text = bodyOf(request);
      objects.set(path, text);
      log.uploads.push({ label, path, size: Buffer.byteLength(text) });
      return reply(200, json({ Id: path, Key: `translations/${path}` }));
    }
    return reply(200, json(url.pathname.includes("/rpc/") ? false : []));
  });
  return page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }, { urlPattern: "http://libre.prueba:5000/*" }] });
}

/* ---- Utilidades de la página ------------------------------------------------------------------- */

const now = Math.floor(Date.now() / 1000);
const session = { access_token: "x", expires_at: now + 3600, expires_in: 3600, refresh_token: "y", token_type: "bearer", user: { app_metadata: { provider: "google" }, aud: "authenticated", email, id: userId, role: "authenticated", user_metadata: {} } };

async function signIn(page, choices) {
  // Desde una página del mismo origen sin la app, para que nada lo reescriba a la vez.
  await page.goto(`${BASE}/manifest.webmanifest`);
  await page.eval(`(localStorage.setItem("pliegue-auth", ${JSON.stringify(JSON.stringify(session))}), localStorage.setItem("pliegue-cloud-sync-v1", ${JSON.stringify(JSON.stringify({ [userId]: choices }))}), true)`);
}

async function importBook(page) {
  await page.goto(`${BASE}/app/biblioteca`);
  await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
  await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Saudade.epub`]);
  await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
  await page.sleep(600);
  await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
  return page.eval(`new URL(document.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")`);
}

const translatedShown = `[...document.querySelectorAll("p")].some((p) => /^\\[Libre\\] La palabra/.test(p.textContent.trim()))`;
const statusLine = (page) => page.eval(`document.querySelector("[class*='translationsStatus'] p")?.textContent ?? null`);
const until = async (check, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

/* ---- El PC: traduce y sube ------------------------------------------------------------------- */

const pcBrowser = await openChrome({ port: 9384, profile: `${PROFILE_ROOT}-traducciones-pc` });
const pc = await pcBrowser.newPage();
await pc.viewport(1366, 900);
await attach(pcBrowser, pc, "pc");
await signIn(pc, { catalogAi: true, enabled: true, translations: true });
const pcId = await importBook(pc);

// LibreTranslate como motor de traducción (los ajustes viajan a la cuenta).
await pc.goto(`${BASE}/app/ajustes#ia`);
await pc.waitFor(`document.querySelector("#ai-translation-provider")`, { timeout: 20000 });
await pc.eval(`(() => { const row = [...document.querySelectorAll("table tbody tr")].find((r) => r.querySelector("th")?.textContent.trim().startsWith("LibreTranslate")); row.querySelector("button").click(); return true; })()`);
await pc.sleep(400);
await pc.eval(`(() => { const i = document.querySelector("#ai-libretranslate-url"); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "http://libre.prueba:5000"); i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); return true; })()`);
await pc.sleep(300);
await pc.eval(`([...document.querySelectorAll("button")].find((b) => /^Guardar/.test(b.textContent.trim())).click(), true)`);
await pc.sleep(600);

await pc.goto(`${BASE}/app/lector?document=${pcId}`);
await pc.waitFor(`[...document.querySelectorAll("p")].some((p) => /intraducible/.test(p.textContent))`, { timeout: 30000 });
await pc.sleep(1200);
await pc.key("t", { code: "KeyT", keyCode: 84, text: "t" });
await pc.waitFor(`[...document.querySelectorAll("button")].some((b) => /Traducir este libro/.test(b.textContent))`, { timeout: 20000 });
await pc.eval(`([...document.querySelectorAll("button")].find((b) => /Traducir este libro/.test(b.textContent.trim())).click(), true)`);
t.check("el PC traduce el libro con LibreTranslate (simulado)", await pc.waitFor(translatedShown, { timeout: 60000 }).then(() => true, () => false), `${log.libre.pc} textos al traductor`);
await pc.screenshot(`${work}/1-pc-traducido.png`);

// Recién traducido no sube: espera a que lleve 2 minutos quieto.
await pc.goto(`${BASE}/app/ajustes?v=1#cuenta`);
await until(async () => Boolean(await statusLine(pc)), 30000);
t.check("recién traducido no sube todavía (espera 2 minutos quieto)", log.uploads.length === 0, (await statusLine(pc)) ?? "sin estado");

// El paso del tiempo, simulado: las páginas traducidas pasan a tener 10 minutos.
await pc.eval(`new Promise((resolve, reject) => {
  const open = indexedDB.open("pliegue-translations");
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction("units", "readwrite");
    const cursor = tx.objectStore("units").openCursor();
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    cursor.onsuccess = () => { const c = cursor.result; if (!c) return; c.update({ ...c.value, translatedAt: old }); c.continue(); };
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
  open.onerror = () => reject(open.error);
})`);
await pc.goto(`${BASE}/app/ajustes?v=2#cuenta`);
const uploaded = await until(() => log.uploads.length > 0 && [...rows.values()].some((row) => row.collection === "translation-files"), 30000);
const upload = log.uploads[0];
t.check("la traducción sube al bucket, en la carpeta de la cuenta", uploaded && new RegExp(`^${userId}/[0-9a-f]{64}/es\\.[a-z0-9]+\\.json$`).test(upload?.path ?? ""), upload?.path ?? "nada subido");
const stored = upload ? JSON.parse(objects.get(upload.path)) : null;
t.check("el archivo lleva el texto traducido y su par", stored?.pairId?.endsWith(">es") && JSON.stringify(stored.units).includes("[Libre] La palabra"), stored ? `${stored.pairId}, ${stored.units.length} unidades` : "—");
const indexRow = [...rows.values()].find((row) => row.collection === "translation-files");
t.check("y queda en el índice de la cuenta con su tamaño", indexRow?.payload?.size === upload?.size && indexRow?.payload?.pairId === stored?.pairId, JSON.stringify(indexRow?.payload ?? null));
await until(async () => /^En tu cuenta: 1 traducción/.test((await statusLine(pc)) ?? ""), 15000);
t.check("Cuenta dice cuánto hay en la nube", /^En tu cuenta: 1 traducción · \d+ KB de 200 MB$/.test((await statusLine(pc)) ?? ""), await statusLine(pc));
await pc.eval(`(document.querySelector("[class*='translationsStatus']")?.scrollIntoView({ block: "center" }), true)`);
await pc.screenshot(`${work}/2-pc-cuenta.png`);
await pcBrowser.close();

/* ---- El portátil: mismo libro; baja la traducción al dar el permiso ---------------------------- */

const lapBrowser = await openChrome({ port: 9385, profile: `${PROFILE_ROOT}-traducciones-portatil` });
const laptop = await lapBrowser.newPage();
await laptop.viewport(1280, 860);
await attach(lapBrowser, laptop, "laptop");
await signIn(laptop, { catalogAi: true, enabled: true, translations: false });
const lapId = await importBook(laptop);
t.check("el libro tiene aquí otro identificador (otro equipo)", lapId !== pcId, `${pcId} · ${lapId}`);

await laptop.goto(`${BASE}/app/ajustes?v=1#cuenta`);
const switchInput = `(() => { const label = [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Traducciones guardadas")); return label?.querySelector("input") ?? document.getElementById(label?.htmlFor); })()`;
await laptop.waitFor(`Boolean(${switchInput})`, { timeout: 30000 });
await laptop.sleep(2500);
t.check("sin permiso, no baja nada", log.downloads.filter((d) => d.label === "laptop").length === 0 && (await laptop.eval(`${switchInput}.checked`)) === false);

await laptop.eval(`(${switchInput}.click(), true)`);
await laptop.waitFor(`document.querySelector("dialog[open][role=alertdialog]")`, { timeout: 10000 });
const dialog = await laptop.eval(`(() => { const d = document.querySelector("dialog[open][role=alertdialog]"); return { title: d.querySelector("h2")?.textContent, text: d.textContent.replace(/\\s+/g, " "), buttons: [...d.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean) }; })()`);
t.check("encenderlo pregunta antes, siempre", dialog.title === "¿Sincronizar también tus traducciones?", dialog.title);
t.check("y avisa de que es el libro entero, con los topes", /el libro entero en otro idioma/.test(dialog.text) && /5 MB por libro e idioma/.test(dialog.text) && /200 MB en total/.test(dialog.text), dialog.text.slice(0, 160));
await laptop.screenshot(`${work}/3-portatil-permiso.png`);
await laptop.eval(`([...document.querySelectorAll("dialog[open][role=alertdialog] button")].find((b) => b.textContent.trim() === "Subir mis traducciones").click(), true)`);
const downloaded = await until(() => log.downloads.some((d) => d.label === "laptop" && d.path === upload?.path), 30000);
t.check("con el permiso, baja la traducción del mismo libro", downloaded, log.downloads.map((d) => `${d.label}:${d.path}`).join(" · ") || "nada bajado");

await laptop.goto(`${BASE}/app/lector?document=${lapId}`);
await laptop.waitFor(`[...document.querySelectorAll("p")].some((p) => /intraducible|\\[Libre\\]/.test(p.textContent))`, { timeout: 30000 });
let shown = await laptop.waitFor(translatedShown, { timeout: 15000 }).then(() => true, () => false);
if (!shown) {
  await laptop.sleep(800);
  await laptop.key("t", { code: "KeyT", keyCode: 84, text: "t" });
  await laptop.waitFor(`[...document.querySelectorAll("button")].some((b) => /Traducir este libro/.test(b.textContent))`, { timeout: 20000 });
  await laptop.eval(`([...document.querySelectorAll("button")].find((b) => /Traducir este libro/.test(b.textContent.trim())).click(), true)`);
  shown = await laptop.waitFor(translatedShown, { timeout: 30000 }).then(() => true, () => false);
}
t.check("el portátil lee la traducción", shown);
t.check("sin llamar al traductor: la trajo de la cuenta", log.libre.laptop === 0, `${log.libre.laptop} textos al traductor desde el portátil`);
await laptop.screenshot(`${work}/4-portatil-lector.png`);
t.check("no vuelve a subir lo que acaba de bajar", log.uploads.filter((u) => u.label === "laptop").length === 0, JSON.stringify(log.uploads.filter((u) => u.label === "laptop")));

t.check("nada sale fuera de la cuenta simulada", log.external.length === 0, log.external.slice(0, 3).join(" · "));
t.check("sin errores en la consola", [...pc.errors, ...laptop.errors].length === 0, [...pc.errors, ...laptop.errors].slice(0, 3).join(" · "));
const { failed } = t.summary();
await lapBrowser.close();
process.exit(failed.length ? 1 : 0);
