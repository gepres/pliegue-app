// 06.5 · Google Drive de punta a punta, sin cuenta real: Google (identidad, selector y la API de
// Drive) se simula por CDP. Elegir archivos con `drive.file`, leerlos en el lector, vincular una
// carpeta con `drive.readonly` (subcarpetas y un archivo que no se lee), buscar cambios con
// `changes.list`, quitar un archivo y desconectar. El token va solo a Google, en la cabecera, y no
// se guarda en ningún almacén del navegador.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/drive`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Google Drive (${BASE})`);
const browser = await openChrome({ port: 9411, profile: `${PROFILE_ROOT}-drive` });
const page = await browser.newPage();
await page.viewport(1366, 900);

const TOKEN = "ya29.token-de-prueba-e2e";
const epub = (title, text) =>
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(
      `<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`,
    ),
    "a.xhtml": strToU8(`<html><body><h1>${title}</h1><p>${text}</p></body></html>`),
  });

// ---- El Drive de mentira -------------------------------------------------------------------------------------------
const epubMime = "application/epub+zip";
const folderMime = "application/vnd.google-apps.folder";
const files = new Map();
const addFile = (id, name, mimeType, parents, bytes) =>
  files.set(id, { bytes, meta: { id, md5Checksum: `md5-${id}`, mimeType, modifiedTime: "2026-11-01T10:00:00.000Z", name, parents, size: bytes ? String(bytes.length) : undefined, trashed: false } });
addFile("f-ficciones", "Ficciones.epub", epubMime, ["root"], epub("Ficciones", "Un libro elegido en Google Drive."));
addFile("f-notas", "Notas de lectura.txt", "text/plain", ["root"], strToU8("Notas sueltas que viven en Drive."));
addFile("d-biblio", "Biblioteca", folderMime, ["root"], null);
addFile("d-borges", "Borges", folderMime, ["d-biblio"], null);
addFile("f-rayuela", "Rayuela.epub", epubMime, ["d-biblio"], epub("Rayuela", "Encontraría a la Maga."));
addFile("f-aleph", "El Aleph.epub", epubMime, ["d-borges"], epub("El Aleph", "Vi el Aleph desde todos los puntos."));
addFile("f-musica", "lectura en voz alta.mp3", "audio/mpeg", ["d-biblio"], strToU8("no es un libro"));
let changesReady = false;
const requests = [];

const gisScript = `
  window.__gis = [];
  window.__revoked = [];
  window.google = window.google || {};
  window.google.accounts = { oauth2: {
    initTokenClient(config) {
      window.__gis.push({ client: config.client_id, scope: config.scope });
      return { requestAccessToken() { setTimeout(() => config.callback({ access_token: ${JSON.stringify(TOKEN)}, expires_in: 3600, scope: config.scope }), 30); } };
    },
    hasGrantedAllScopes(response, ...scopes) { return scopes.every((scope) => (response.scope || "").split(" ").includes(scope)); },
    revoke(token, done) { window.__revoked.push(token); if (done) done(); },
  } };
`;
const pickerScript = `
  window.__picks = [];
  window.gapi = { load(name, callback) {
    window.google = window.google || {};
    class DocsView {
      constructor(view) { this.view = view; }
      setEnableDrives() { return this; } setIncludeFolders() { return this; }
      setMimeTypes(mime) { this.mime = mime; return this; } setSelectFolderEnabled(on) { this.folders = on; return this; }
    }
    class PickerBuilder {
      constructor() { this.s = { features: [], views: [] }; }
      addView(view) { this.s.views.push({ folders: Boolean(view.folders), mime: view.mime || null, view: view.view }); return this; }
      enableFeature(feature) { this.s.features.push(feature); return this; }
      setAppId(id) { this.s.appId = id; return this; } setCallback(callback) { this.callback = callback; return this; }
      setDeveloperKey(key) { this.s.key = Boolean(key); return this; } setLocale(locale) { this.s.locale = locale; return this; }
      setOAuthToken(token) { this.s.token = token; return this; } setOrigin(origin) { this.s.origin = origin; return this; }
      setTitle(title) { this.s.title = title; return this; }
      build() { const self = this; return { setVisible() {
        window.__picks.push(self.s);
        const docs = window.__pickerNext || [];
        setTimeout(() => self.callback(docs.length ? { action: "picked", docs } : { action: "cancel" }), 30);
      } }; }
    }
    window.google.picker = { Action: { CANCEL: "cancel", PICKED: "picked" }, DocsView, Feature: { MULTISELECT_ENABLED: "multi", SUPPORT_DRIVES: "drives" }, PickerBuilder, ViewId: { DOCS: "docs", FOLDERS: "folders" } };
    (typeof callback === "function" ? callback : callback.callback)();
  } };
`;

await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://accounts.google.com/*" }, { urlPattern: "https://apis.google.com/*" }, { urlPattern: "https://www.googleapis.com/*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const cors = [{ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }, { name: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" }];
  const send = (code, body, type = "application/json") =>
    page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: type }, ...cors], body: Buffer.from(body).toString("base64") }).catch(() => {});
  const url = new URL(request.url);
  if (url.host === "accounts.google.com") return send(200, gisScript, "text/javascript");
  if (url.host === "apis.google.com") return send(200, pickerScript, "text/javascript");
  if (request.method === "OPTIONS") return send(204, "");
  requests.push({ auth: request.headers.Authorization ?? request.headers.authorization ?? "", url: request.url });
  const json = (value) => send(200, JSON.stringify(value));
  const path = url.pathname.replace("/drive/v3", "");
  if (path === "/about") return json({ user: { displayName: "Lectora de prueba", emailAddress: "lectora@prueba.test" } });
  if (path === "/changes/startPageToken") return json({ startPageToken: "10" });
  if (path === "/changes") {
    if (!changesReady) return json({ changes: [], newStartPageToken: url.searchParams.get("pageToken") });
    return json({
      changes: [
        { changeType: "file", file: files.get("f-nuevo").meta, fileId: "f-nuevo", removed: false },
        { changeType: "file", fileId: "f-rayuela", removed: true },
      ],
      newStartPageToken: "11",
    });
  }
  if (path === "/files") {
    const parent = /'([^']+)' in parents/.exec(url.searchParams.get("q") ?? "")?.[1];
    return json({ files: [...files.values()].filter((file) => file.meta.parents.includes(parent) && !file.gone).map((file) => file.meta) });
  }
  const id = decodeURIComponent(/^\/files\/([^/]+)/.exec(path)?.[1] ?? "");
  const file = files.get(id);
  if (!file || file.gone) return send(404, JSON.stringify({ error: { code: 404, message: "File not found" } }));
  if (url.searchParams.get("alt") === "media") return page.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: file.meta.mimeType }, ...cors], body: Buffer.from(file.bytes).toString("base64") }).catch(() => {});
  return json(file.meta);
});

const clickButton = (label) => page.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const panelText = () => page.eval(`document.querySelector("section#drive")?.textContent.replace(/\\s+/g, " ") ?? ""`);
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
const confirm = async (label) => {
  await page.waitFor(dialog, { timeout: 10000 });
  await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click(), true)`);
};

// ---- Elegir archivos (drive.file) ---------------------------------------------------------------------------------------
await page.goto(`${BASE}/app/biblioteca/fuentes#drive`);
const configured = await page.waitFor(`document.querySelector("section#drive") && [...document.querySelectorAll("section#drive button")].some((b) => b.textContent.trim() === "Elegir archivos")`, { timeout: 20000 }).then(() => true, () => false);
t.check("Biblioteca → Fuentes tiene Google Drive configurado", configured, (await panelText()).slice(0, 120));
await page.eval(`(window.__pickerNext = [${["f-ficciones", "f-notas"].map((id) => JSON.stringify({ id, mimeType: files.get(id).meta.mimeType, name: files.get(id).meta.name })).join(",")}], true)`);
await clickButton("Elegir archivos");
await page.waitFor(`[...document.querySelectorAll("ul[aria-label='Archivos de Drive elegidos'] li")].length >= 2`, { timeout: 30000 }).catch(() => {});
const gis = await page.eval(`window.__gis`);
const pick = (await page.eval(`window.__picks`))?.[0];
t.check("para elegir archivos pide solo drive.file", gis?.[0]?.scope === "https://www.googleapis.com/auth/drive.file", JSON.stringify(gis));
t.check(
  "el selector se abre con el token, el origen, el número del proyecto y la selección múltiple",
  pick && pick.token === TOKEN && pick.origin === BASE && /^\d+$/.test(pick.appId ?? "") && pick.key && pick.features.includes("multi") && pick.locale === "es",
  JSON.stringify(pick),
);
const chosen = await page.eval(`[...document.querySelectorAll("ul[aria-label='Archivos de Drive elegidos'] li strong")].map((s) => s.textContent)`);
t.check("los dos archivos quedan en la lista de Drive", JSON.stringify(chosen) === JSON.stringify(["Ficciones.epub", "Notas de lectura.txt"]) || chosen.length === 2, JSON.stringify(chosen));
t.check("y dice la cuenta y que está conectado", /Cuenta: lectora@prueba\.test/.test(await panelText()) && /Conectado/.test(await panelText()));
await page.screenshot(`${work}/1-archivos-elegidos.png`);

// ---- En la Biblioteca y en el lector --------------------------------------------------------------------------------------
await page.eval(`(document.querySelector("a[href='/app/biblioteca']").click(), true)`);
const inLibrary = await page.waitFor(`["Ficciones", "Notas de lectura"].every((t) => [...document.querySelectorAll("article[aria-label]")].some((a) => (a.getAttribute("aria-label") ?? "").startsWith(t)))`, { timeout: 30000 }).then(() => true, () => false);
t.check("los dos aparecen en la Biblioteca", inLibrary, await page.eval(`[...document.querySelectorAll("article[aria-label]")].map((a) => a.getAttribute("aria-label")).join(" · ")`));
await page.eval(`([...document.querySelectorAll("article[aria-label]")].find((a) => (a.getAttribute("aria-label") ?? "").startsWith("Ficciones")).querySelector("a[href*='/app/lector?document=']").click(), true)`);
const read = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /Un libro elegido en Google Drive/.test(p.textContent))`, { timeout: 30000 }).then(() => true, () => false);
t.check("el lector abre el libro bajándolo de Drive", read && requests.some((r) => r.url.includes("/files/f-ficciones") && r.url.includes("alt=media")));
await page.screenshot(`${work}/2-lector.png`);

// ---- Vincular una carpeta (drive.readonly), con subcarpetas ------------------------------------------------------------------
await page.goto(`${BASE}/app/biblioteca/fuentes#drive`);
await page.waitFor(`[...document.querySelectorAll("section#drive button")].some((b) => b.textContent.trim() === "Vincular carpeta completa")`, { timeout: 20000 });
await page.eval(`(window.__pickerNext = [${JSON.stringify({ id: "d-biblio", mimeType: folderMime, name: "Biblioteca" })}], true)`);
// Recargar la página pierde el token (vive en memoria): se vuelve a pedir, ahora con lectura de Drive.
await clickButton("Vincular carpeta completa");
await confirm("Continuar con Google");
await page.waitFor(`[...document.querySelectorAll("ul[aria-label='Carpetas de Drive vinculadas'] li")].length >= 1`, { timeout: 30000 }).catch(() => {});
await page.sleep(800);
const gis2 = await page.eval(`window.__gis`);
const pick2 = (await page.eval(`window.__picks`))?.at(-1);
t.check("para vincular una carpeta pide también drive.readonly, explicándolo antes", (gis2?.at(-1)?.scope ?? "").includes("https://www.googleapis.com/auth/drive.readonly"), JSON.stringify(gis2));
t.check("el selector se abre para elegir carpetas", pick2?.views.every((view) => view.view === "folders" && view.folders && view.mime === folderMime), JSON.stringify(pick2?.views));
const folderRow = await page.eval(`document.querySelector("ul[aria-label='Carpetas de Drive vinculadas'] li")?.textContent.replace(/\\s+/g, " ") ?? ""`);
t.check("la carpeta queda con sus libros de las subcarpetas, y dice lo que no lee", /Biblioteca/.test(folderRow) && /2 documentos/.test(folderRow) && /1 archivo que Pliegue no lee/.test(folderRow), folderRow);
t.check("recorre las subcarpetas", requests.some((r) => (new URL(r.url).searchParams.get("q") ?? "").includes("'d-borges' in parents")));
await page.screenshot(`${work}/3-carpeta.png`);

// ---- Buscar cambios: uno nuevo y uno quitado, solo con changes.list ----------------------------------------------------------
addFile("f-nuevo", "Nuevo.epub", epubMime, ["d-biblio"], epub("Nuevo", "Un libro que llegó después."));
files.get("f-rayuela").gone = true;
changesReady = true;
const listsBefore = requests.filter((r) => r.url.includes("/files?")).length;
await clickButton("Buscar cambios");
await page.waitFor(`/1 nuevo/.test(document.querySelector("section#drive").textContent) || /quitado/.test(document.querySelector("section#drive").textContent)`, { timeout: 30000 }).catch(() => {});
await page.sleep(500);
const after = await panelText();
t.check("buscar cambios encuentra el nuevo y el quitado", /1 nuevo/.test(after) && /1 quitado/.test(after), after.slice(0, 400));
t.check("pidiendo a Drive solo lo que cambió, sin recorrer la carpeta", /Se pidió a Drive solo lo que cambió/.test(after) && requests.filter((r) => r.url.includes("/files?")).length === listsBefore);

// ---- El token: solo a Google, en la cabecera, y en ningún almacén ------------------------------------------------------------
t.check("cada petición a Drive lleva el token en Authorization", requests.length > 5 && requests.every((r) => r.auth === `Bearer ${TOKEN}`), `${requests.length} peticiones`);
t.check("y nunca en la URL", requests.every((r) => !r.url.includes(TOKEN)));
const stored = await page.eval(`(async () => {
  const parts = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
  for (const info of await indexedDB.databases()) {
    const db = await new Promise((ok) => { const r = indexedDB.open(info.name); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
    if (!db) continue;
    for (const name of db.objectStoreNames) {
      const all = await new Promise((ok) => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => ok(q.result); q.onerror = () => ok([]); });
      parts.push(JSON.stringify(all, (k, v) => (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? "[binario]" : v)));
    }
    db.close();
  }
  return parts.join("\\n");
})()`);
t.check("el token no se guarda en localStorage, sessionStorage, cookies ni IndexedDB", stored.length > 100 && !stored.includes(TOKEN), `${stored.length} caracteres revisados`);

// ---- Quitar un archivo y desconectar ---------------------------------------------------------------------------------------
await page.eval(`([...document.querySelectorAll("ul[aria-label='Archivos de Drive elegidos'] li")].find((li) => /Notas de lectura/.test(li.textContent)).querySelector("button").click(), true)`);
await confirm("Quitar");
await page.waitFor(`![...document.querySelectorAll("ul[aria-label='Archivos de Drive elegidos'] li")].some((li) => /Notas de lectura/.test(li.textContent))`, { timeout: 15000 }).catch(() => {});
const remaining = await page.eval(`[...document.querySelectorAll("ul[aria-label='Archivos de Drive elegidos'] li strong")].map((s) => s.textContent)`);
t.check("quitar un archivo lo saca de Pliegue y dice que sigue en Drive", /Sigue en tu Drive/.test(await panelText()) && JSON.stringify(remaining) === JSON.stringify(["Ficciones.epub"]), JSON.stringify(remaining));
await clickButton("Desconectar Google Drive");
await confirm("Desconectar");
await page.waitFor(`/desconectado/.test(document.querySelector("section#drive").textContent)`, { timeout: 15000 }).catch(() => {});
const revoked = await page.eval(`window.__revoked`);
t.check("desconectar retira el permiso en Google con el token de la sesión", Array.isArray(revoked) && revoked.includes(TOKEN) && /permiso retirado/.test(await panelText()), JSON.stringify(revoked));

// Sin conexión con Google, un libro de Drive pide conectar en vez de fallar.
await page.eval(`(document.querySelector("a[href='/app/biblioteca']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("article[aria-label]")].some((a) => (a.getAttribute("aria-label") ?? "").startsWith("El Aleph"))`, { timeout: 20000 }).catch(() => {});
await page.eval(`([...document.querySelectorAll("article[aria-label]")].find((a) => (a.getAttribute("aria-label") ?? "").startsWith("El Aleph")).querySelector("a[href*='/app/lector?document=']").click(), true)`);
const asks = await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /Conectar Google Drive/.test(b.textContent))`, { timeout: 20000 }).then(() => true, () => false);
t.check("sin sesión, abrir un libro de Drive ofrece conectar", asks);
await page.screenshot(`${work}/4-sin-sesion.png`);

const errors = page.errors.filter((error) => !/404|File not found/.test(error));
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
