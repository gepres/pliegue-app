// 05.1: la cursiva y la negrita de un EPUB se ven en el original y no en la traducción
// (LibreTranslate simulado); un EPUB de más de 50 MB abre, con aviso. Nada sale fuera.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/formato-tope`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Formato y tope de EPUB (${BASE})`);
const browser = await openChrome({ port: 9398, profile: `${PROFILE_ROOT}-formato` });
const page = await browser.newPage();

const epub = (title, body, extra = {}) =>
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">es</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body>${body}</body></html>`),
    ...extra,
  });
writeFileSync(`${work}/Saudade.epub`, epub("Saudade", `<h1>Saudade</h1><p>La palabra <em>saudade</em> es <strong>casi intraducible</strong>, dicen los poetas.</p><p>Un párrafo sin formato para comparar.</p>`));
// Un libro grande: 60 MB de «imagen» sin comprimir (bytes al azar no se comprimen).
writeFileSync(`${work}/Atlas grande.epub`, epub("Atlas grande", `<h1>Atlas</h1><p>Un libro con muchas fotos.</p><p><img src="foto.png" alt="Foto" /></p>`, { "foto.png": [randomBytes(60 * 1024 * 1024), { level: 0 }] }));

const sent = [];
const external = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "http://libre.prueba:5000/*" }, { urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  if (request.url.startsWith("https://")) {
    external.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "content-type" }];
  if (request.method === "OPTIONS") return page.send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: headers }).catch(() => {});
  const body = JSON.parse(request.postData ?? "{}");
  const q = Array.isArray(body.q) ? body.q : [body.q];
  sent.push(...q);
  return page.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(JSON.stringify({ translatedText: q.map((x) => `[Libre] ${x}`) })).toString("base64") }).catch(() => {});
});

await page.viewport(1366, 900);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Saudade.epub`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const id = await page.eval(`new URL(document.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")`);

// ---- El original, con su formato ---------------------------------------------------------------
await page.goto(`${BASE}/app/lector?document=${id}`);
await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /intraducible/.test(p.textContent))`, { timeout: 30000 });
const original = await page.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => /intraducible/.test(x.textContent)); return { em: p.querySelector("em")?.textContent ?? "", strong: p.querySelector("strong")?.textContent ?? "", text: p.textContent }; })()`);
t.check("el original pinta la cursiva («saudade»)", original.em === "saudade", JSON.stringify(original));
t.check("y la negrita («casi intraducible»)", original.strong === "casi intraducible");
t.check("y el texto del párrafo es el de siempre", original.text === "La palabra saudade es casi intraducible, dicen los poetas.", original.text);
await page.screenshot(`${work}/1-original.png`);

// ---- La traducción, en texto normal ------------------------------------------------------------
await page.eval(`([...document.querySelectorAll("a[href^='/app/ajustes']")][0].click(), true)`);
await page.waitFor(`document.querySelector("#ai-translation-provider")`, { timeout: 20000 }).catch(async () => {
  await page.eval(`(location.hash = "ia", true)`);
  await page.waitFor(`document.querySelector("#ai-translation-provider")`, { timeout: 20000 });
});
await page.eval(`(() => { const row = [...document.querySelectorAll("table tbody tr")].find((r) => r.querySelector("th")?.textContent.trim().startsWith("LibreTranslate")); row.querySelector("button").click(); return true; })()`);
await page.sleep(400);
await page.eval(`(() => { const i = document.querySelector("#ai-libretranslate-url"); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "http://libre.prueba:5000"); i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); return true; })()`);
await page.sleep(300);
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Guardar/.test(b.textContent.trim())).click(), true)`);
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("a[href='/app/biblioteca']")][0].click(), true)`);
await page.waitFor(`document.querySelector("a[href*='/app/lector?document=${id}']")`, { timeout: 20000 });
await page.eval(`(document.querySelector("a[href*='/app/lector?document=${id}']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /intraducible/.test(p.textContent))`, { timeout: 30000 });
await page.sleep(1200);
await page.key("t", { code: "KeyT", keyCode: 84, text: "t" });
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /Traducir este libro/.test(b.textContent))`, { timeout: 20000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /Traducir este libro/.test(b.textContent.trim())).click(), true)`);
await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /^\\[Libre\\] La palabra/.test(p.textContent.trim()))`, { timeout: 60000 }).catch(() => {});
const translated = await page.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => /^\\[Libre\\] La palabra/.test(x.textContent.trim())); return p ? { em: p.querySelectorAll("em").length, strong: p.querySelectorAll("strong").length, text: p.textContent } : null; })()`);
t.check("se tradujo el párrafo, con su texto plano (sin marcas raras)", Boolean(translated) && sent.some((q) => q === "La palabra saudade es casi intraducible, dicen los poetas."), sent.slice(0, 3).join(" | "));
t.check("la traducción sale en texto normal, sin cursiva ni negrita", translated?.em === 0 && translated?.strong === 0, JSON.stringify(translated));
await page.screenshot(`${work}/2-traducido.png`);

// ---- Un EPUB de más de 50 MB abre, con aviso ---------------------------------------------------
await page.goto(`${BASE}/app/biblioteca?g=1`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
// Que la Biblioteca haya cargado (la tarjeta de «Saudade») antes de añadir el libro grande.
await page.waitFor(`[...document.querySelectorAll("article")].some((a) => /Saudade/.test(a.getAttribute("aria-label") ?? ""))`, { timeout: 30000 });
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Atlas grande.epub`]);
const imported = await page.waitFor(`[...document.querySelectorAll("article")].some((a) => /Atlas/.test(a.getAttribute("aria-label") ?? ""))`, { timeout: 90000 }).then(() => true, () => false);
const importMessage = await page.eval(`[...document.querySelectorAll("[role=status], [role=alert]")].map((el) => el.textContent.trim()).filter(Boolean).join(" | ").slice(0, 200)`);
if (!imported) console.log("    importación:", importMessage);
const bigId = imported ? await page.eval(`[...document.querySelectorAll("article")].filter((a) => /Atlas/.test(a.getAttribute("aria-label") ?? "")).map((a) => new URL(a.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document"))[0]`) : null;
if (bigId) {
  await page.goto(`${BASE}/app/lector?document=${bigId}`);
  const opened = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /muchas fotos/.test(p.textContent))`, { timeout: 90000 }).then(() => true, () => false);
  const note = await page.eval(`[...document.querySelectorAll("p[role=note]")].map((p) => p.textContent.replace(/\\s+/g, " ").trim()).join(" | ")`);
  t.check("un EPUB de unos 60 MB abre en el lector", opened, note);
  t.check("con el aviso de libro grande", /^Libro grande \(6\d(,\d)? MB\): en un móvil con poca memoria puede ir lento\.$/.test(note), note);
} else {
  t.check("un EPUB de unos 60 MB se puede añadir a la Biblioteca", false, importMessage);
}

t.check("nada sale fuera", external.length === 0, external.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
