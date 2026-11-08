// 02.5 · Bóveda de claves. La API key se recuerda como elija la persona: solo la pestaña, hasta
// cerrar sesión, en este navegador o en su cuenta (cifrada con una frase suya). Dos equipos:
// lo guardado en la cuenta se abre en el otro solo con la frase. Nunca se guarda ni se envía en
// claro: ni la clave ni la frase. Supabase simulado por CDP; la clave es de prueba.
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const t = checker(`Bóveda de claves (${BASE})`);
const work = `${WORK}/boveda-claves`;
mkdirSync(work, { recursive: true });
const KEY = "sk-proj-clave-de-prueba-boveda-0123456789abcdefghijklmn";
const PASSPHRASE = "lluvia sobre el jardín de senderos";
const userId = "8b8f0c7e-0000-4000-8000-0000000000aa";
const email = "lectora@prueba.test";

// ---- Supabase de mentira, compartido por los dos equipos -------------------------------------------------------
const table = [];
const sent = [];
function supabase(page) {
  return async (m) => {
    if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
    const { requestId, request } = m.params;
    const url = new URL(request.url);
    if (!/supabase\.co$/.test(url.host)) return page.send("Fetch.continueRequest", { requestId }).catch(() => {});
    sent.push({ body: request.postData ?? "", url: request.url });
    const reply = (code, body) =>
      page
        .send("Fetch.fulfillRequest", {
          requestId,
          responseCode: code,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }, { name: "Access-Control-Allow-Methods", value: "*" }],
          body: Buffer.from(body === null ? "" : JSON.stringify(body)).toString("base64"),
        })
        .catch(() => {});
    if (request.method === "OPTIONS") return reply(204, null);
    if (url.pathname === "/auth/v1/user") return reply(200, { email, id: userId });
    if (url.pathname.startsWith("/auth/v1/logout")) return reply(204, null);
    if (url.pathname === "/rest/v1/user_secrets") {
      const provider = url.searchParams.get("provider")?.replace(/^eq\./, "");
      if (request.method === "GET") return reply(200, table);
      if (request.method === "POST") {
        const rows = [].concat(JSON.parse(request.postData ?? "[]"));
        for (const row of rows) {
          const index = table.findIndex((item) => item.provider === row.provider);
          if (index >= 0) table[index] = row;
          else table.push(row);
        }
        return reply(201, null);
      }
      if (request.method === "DELETE") {
        for (let index = table.length - 1; index >= 0; index -= 1) if (!provider || table[index].provider === provider) table.splice(index, 1);
        return reply(204, null);
      }
    }
    if (url.pathname.includes("/rpc/")) return reply(200, false);
    return reply(200, []);
  };
}

const now = Math.floor(Date.now() / 1000);
const session = { access_token: "x", expires_at: now + 3600, expires_in: 3600, refresh_token: "y", token_type: "bearer", user: { app_metadata: { provider: "email" }, aud: "authenticated", email, id: userId, role: "authenticated", user_metadata: {} } };

async function device(port, name) {
  const browser = await openChrome({ port, profile: `${PROFILE_ROOT}-boveda-${name}` });
  const page = await browser.newPage();
  await page.viewport(1366, 900);
  await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
  browser.on(supabase(page));
  return { browser, page };
}

const field = `document.querySelector("#ai-api-key")`;
const remember = `document.querySelector("#ai-api-key-remember")`;
// Una carga de verdad cada vez: ir a la misma URL cambiando solo el `#` no recarga la página, y
// la clave seguiría en la memoria de la pestaña.
async function openAiSettings(page) {
  await page.goto(`${BASE}/app/ajustes?carga=${Date.now()}#ia`);
  await page.waitFor(`${field} && ${remember}`, { timeout: 20000 });
  await page.sleep(800);
}
const typeKey = (page, value) =>
  page.eval(`(() => { const el = ${field}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const choose = (page, value) =>
  page.eval(`(() => { const el = ${remember}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const fieldValue = (page) => page.eval(`${field}?.value ?? ""`);
const note = (page) => page.eval(`${remember}.parentElement.querySelector("[role=status]")?.textContent ?? ""`);
const signIn = async (page) => {
  await page.goto(`${BASE}/manifest.webmanifest`);
  await page.eval(`(localStorage.setItem("pliegue-auth", ${JSON.stringify(JSON.stringify(session))}), true)`);
};
/** Todo lo que el navegador guarda (localStorage, sessionStorage, cookies, IndexedDB), en texto. */
const storage = (page) =>
  page.eval(`(async () => {
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
const dialog = `document.querySelector("dialog[open]")`;

// ==== Equipo A ==========================================================================================================
const a = await device(9414, "a");

// ---- Sin cuenta: la pestaña (por defecto) y «en este navegador» -----------------------------------------------------------
await openAiSettings(a.page);
const options = await a.page.eval(`[...${remember}.options].map((o) => ({ disabled: o.disabled, text: o.textContent.trim(), value: o.value }))`);
t.check(
  "«Recordar» ofrece las cuatro opciones; sin sesión, las de la cuenta esperan a iniciarla",
  options.map((o) => o.value).join() === "tab,session,browser,account" && options.filter((o) => o.disabled).map((o) => o.value).join() === "session,account" && (await a.page.eval(`${remember}.value`)) === "tab",
  JSON.stringify(options),
);
await typeKey(a.page, KEY);
await a.page.sleep(300);
t.check("por defecto, solo en esta pestaña (y lo dice)", /Solo en esta pestaña/.test(await note(a.page)) && !(await storage(a.page)).includes(KEY));
await openAiSettings(a.page);
t.check("y al recargar ya no está", (await fieldValue(a.page)) === "");

await typeKey(a.page, KEY);
await choose(a.page, "browser");
await a.page.waitFor(`/Cifrada en este navegador/.test(${remember}.parentElement.textContent)`, { timeout: 10000 }).catch(() => {});
await a.page.sleep(800);
t.check("«En este navegador» lo dice", /Cifrada en este navegador hasta que pulses «Borrar»/.test(await note(a.page)), await note(a.page));
const kept = await storage(a.page);
t.check("se guarda cifrada: ni en IndexedDB ni en ningún almacén está en claro", kept.includes("pliegue-clave") === false && !kept.includes(KEY) && /"persistence":"browser"/.test(kept), `${kept.length} caracteres`);
await openAiSettings(a.page);
t.check("al recargar, la clave sigue ahí (enmascarada) y la opción también", (await fieldValue(a.page)) === KEY && (await a.page.eval(`${remember}.value`)) === "browser" && (await a.page.eval(`getComputedStyle(${field}).webkitTextSecurity`)) === "disc");
await a.page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Borrar" && !b.disabled).click(), true)`);
await a.page.sleep(500);
await openAiSettings(a.page);
t.check("«Borrar» la olvida: al recargar ya no está", (await fieldValue(a.page)) === "" && !/"persistence":"browser"/.test(await storage(a.page)));

// ---- Con cuenta: «hasta cerrar sesión» ------------------------------------------------------------------------------------
await signIn(a.page);
await openAiSettings(a.page);
await a.page.waitFor(`![...${remember}.options].find((o) => o.value === "session").disabled`, { timeout: 15000 }).catch(() => {});
await typeKey(a.page, KEY);
await choose(a.page, "session");
await a.page.waitFor(`/hasta que cierres sesión/.test(${remember}.parentElement.textContent)`, { timeout: 10000 }).catch(() => {});
t.check("con sesión, «hasta cerrar sesión» se puede elegir y lo dice", /hasta que cierres sesión/.test(await note(a.page)), await note(a.page));
await a.page.sleep(800);
await openAiSettings(a.page);
t.check("«Hasta cerrar sesión»: sigue al recargar con la sesión abierta", (await fieldValue(a.page)) === KEY && /hasta que cierres sesión/.test(await note(a.page)));
await a.page.goto(`${BASE}/app/ajustes#cuenta`);
await a.page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Cerrar sesión")`, { timeout: 20000 });
await a.page.eval(`([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cerrar sesión").click(), true)`);
await a.page.waitFor(dialog, { timeout: 10000 });
await a.page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Cerrar sesión").click(), true)`);
await a.page.sleep(1200);
await openAiSettings(a.page);
t.check("al cerrar sesión se borra de este navegador", (await fieldValue(a.page)) === "" && !(await storage(a.page)).includes('"persistence":"session"'));

// ---- «En mi cuenta», con la frase ----------------------------------------------------------------------------------------
await signIn(a.page);
await openAiSettings(a.page);
await a.page.waitFor(`![...${remember}.options].find((o) => o.value === "account").disabled`, { timeout: 15000 }).catch(() => {});
await typeKey(a.page, KEY);
await choose(a.page, "account");
const created = await a.page.waitFor(`${dialog}?.textContent.includes("Crea una frase para tus claves")`, { timeout: 10000 }).then(() => true, () => false);
t.check("la primera vez pide crear una frase, y explica que Pliegue no puede leerla", created && (await a.page.eval(`/Ni Pliegue ni Supabase pueden leerlas/.test(${dialog}.textContent)`)));
const fill = (selector, value) => a.page.eval(`(() => { const el = ${dialog}.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const inputs = `[...(${dialog}).querySelectorAll("input[type=password]")]`;
await a.page.eval(`(${inputs}[0].id && true)`);
const [first, second] = await a.page.eval(`${inputs}.map((i) => "#" + CSS.escape(i.id))`);
await fill(first, "corta");
await fill(second, "corta");
await a.page.eval(`(${dialog}.querySelector("button[type=submit]").click(), true)`);
await a.page.sleep(300);
t.check("una frase corta no vale, y lo dice", await a.page.eval(`/al menos 10 caracteres/.test(${dialog}.querySelector("[role=alert]")?.textContent ?? "")`));
await fill(first, PASSPHRASE);
await fill(second, PASSPHRASE);
await a.page.eval(`(${dialog}.querySelector("button[type=submit]").click(), true)`);
await a.page.waitFor(`!document.querySelector("dialog[open]")`, { timeout: 30000 }).catch(() => {});
await a.page.waitFor(`/guardada en tu cuenta/.test(${remember}.parentElement.textContent)`, { timeout: 15000 }).catch(() => {});
t.check("se guarda en la cuenta: una fila con texto cifrado, vector y sal", table.length === 1 && table[0].provider === "openai" && table[0].user_id === userId && table[0].ciphertext && table[0].iv && table[0].kdf?.name === "PBKDF2" && table[0].kdf.iterations === 600000, JSON.stringify(table.map((row) => ({ ...row, ciphertext: `${row.ciphertext?.length} car.` }))));
await openAiSettings(a.page);
t.check("al recargar en este equipo no vuelve a pedir la frase", (await fieldValue(a.page)) === KEY && !(await a.page.eval(`Boolean(${dialog})`)));
await a.page.screenshot(`${work}/1-equipo-a.png`);

// ==== Equipo B: la misma cuenta, sin nada guardado aquí =========================================================================
const b = await device(9415, "b");
await signIn(b.page);
await openAiSettings(b.page);
const notice = await b.page.waitFor(`[...document.querySelectorAll("[role=note]")].some((n) => /Tienes 1 clave guardada en tu cuenta/.test(n.textContent))`, { timeout: 20000 }).then(() => true, () => false);
t.check("en otro equipo avisa de la clave de la cuenta, sin abrirla todavía", notice && (await fieldValue(b.page)) === "");
await b.page.eval(`([...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Abrir mis claves").click(), true)`);
await b.page.waitFor(`${dialog}?.textContent.includes("Escribe tu frase")`, { timeout: 10000 });
const fillB = (value) => b.page.eval(`(() => { const el = ${dialog}.querySelector("input[type=password]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
await fillB("no es mi frase de verdad");
await b.page.eval(`(${dialog}.querySelector("button[type=submit]").click(), true)`);
const wrong = await b.page.waitFor(`/Esa no es la frase/.test(${dialog}?.querySelector("[role=alert]")?.textContent ?? "")`, { timeout: 30000 }).then(() => true, () => false);
t.check("con otra frase no se abre, y se puede volver a probar", wrong && (await fieldValue(b.page)) === "");
await fillB(PASSPHRASE);
await b.page.eval(`(${dialog}.querySelector("button[type=submit]").click(), true)`);
await b.page.waitFor(`!document.querySelector("dialog[open]")`, { timeout: 30000 }).catch(() => {});
await b.page.sleep(500);
t.check("con la frase, la clave llega a este equipo", (await fieldValue(b.page)) === KEY && (await b.page.eval(`${remember}.value`)) === "account");
await b.page.screenshot(`${work}/2-equipo-b.png`);

// ---- Ni la clave ni la frase salieron en claro ------------------------------------------------------------------------------------
const leaked = sent.filter((request) => request.body.includes(KEY) || request.url.includes(KEY) || request.body.includes(PASSPHRASE) || request.url.includes(PASSPHRASE));
t.check("ninguna petición lleva la clave ni la frase en claro", sent.length > 3 && leaked.length === 0, `${sent.length} peticiones a Supabase; ${leaked.map((r) => r.url).join(" ")}`);
const storedB = await storage(b.page);
t.check("en el otro equipo tampoco se guarda en claro", !storedB.includes(KEY) && !storedB.includes(PASSPHRASE));

const errors = [...a.page.errors, ...b.page.errors];
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
// El segundo Chrome tarda en soltar su perfil: se cierra después, con margen.
await a.browser.close();
await b.page.sleep(1500);
await b.browser.close().catch(() => {});
process.exit(failed.length ? 1 : 0);
