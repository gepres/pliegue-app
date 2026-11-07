// 06.5 · Carga: una biblioteca del tamaño de la de verdad (unos 500 libros; el corpus del dueño
// ronda los 440). Mide cuánto tarda en importarse, en pintarse al recargar, en filtrar, en
// indexarse para buscar por palabras y en buscar. Los límites son holgados: sirven para que una
// regresión salte, no para presumir. En el CI, 120 libros (`CARGA_LIBROS` lo cambia).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const N = Number(process.env.CARGA_LIBROS ?? (process.env.CI ? 120 : 500));
const work = `${WORK}/carga`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Carga con ${N} libros (${BASE})`);
const browser = await openChrome({ port: 9408, profile: `${PROFILE_ROOT}-carga` });
const page = await browser.newPage();
await page.viewport(1366, 900);

// ---- Los libros: tres capítulos de prosa y una palabra propia («claveNNN») -----------------------------------
const vocabulary = "el la de que en los un una por con para como pero sus sobre entre libro casa camino jardín noche mar ciudad tiempo memoria espejo río puerta sombra luz palabra viaje voz carta".split(" ");
function prose(seed, words) {
  let state = seed * 2654435761 >>> 0;
  const out = [];
  for (let i = 0; i < words; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out.push(vocabulary[(state >>> 8) % vocabulary.length]);
  }
  return out.join(" ").replace(/((?:\S+\s){13}\S+)\s?/g, (m, s) => `${s[0].toUpperCase()}${s.slice(1)}. `);
}
const pad = (i) => String(i).padStart(3, "0");
const files = [];
for (let i = 1; i <= N; i += 1) {
  const chapters = [0, 1, 2].map((c) => `<html><body><h1>Capítulo ${c + 1}</h1><p>${prose(i * 10 + c, 220)}</p><p>${c === 1 ? `Aquí aparece la clave${pad(i)}. ` : ""}${prose(i * 10 + c + 5, 180)}</p></body></html>`);
  const zip = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(
      `<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Libro ${pad(i)}</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">es</dc:language></metadata><manifest>${[0, 1, 2]
        .map((c) => `<item id="c${c}" href="c${c}.xhtml" media-type="application/xhtml+xml" />`)
        .join("")}</manifest><spine>${[0, 1, 2].map((c) => `<itemref idref="c${c}" />`).join("")}</spine></package>`,
    ),
  };
  chapters.forEach((html, c) => (zip[`c${c}.xhtml`] = strToU8(html)));
  const path = `${work}/Libro-${pad(i)}.epub`;
  writeFileSync(path, zipSync(zip));
  files.push(path);
}

// Las tareas largas del hilo principal, desde que empieza cada página.
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__longTasks = []; try { new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch {}`,
});
const status = () => page.eval(`document.querySelector("[aria-label='Cantidad de documentos filtrados']")?.textContent ?? ""`);
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

// ---- Importar -----------------------------------------------------------------------------------------------------
await page.goto(`${BASE}/manifest.webmanifest`);
await page.eval(`(localStorage.setItem("pliegue-ai-settings-v1", JSON.stringify({ provider: "anthropic" })), true)`);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
let start = Date.now();
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", files);
const imported = await page.waitFor(`(document.querySelector("[aria-label='Cantidad de documentos filtrados']")?.textContent ?? "") === "${N} de ${N}"`, { interval: 500, timeout: 600_000 }).then(() => true, () => false);
const importMs = Date.now() - start;
t.check(`importar ${N} libros, en menos de ${N >= 400 ? 240 : 90} s`, imported && importMs < (N >= 400 ? 240_000 : 90_000), `${seconds(importMs)} · ${await status()}`);
await page.sleep(1000);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

// ---- Recargar la Biblioteca -------------------------------------------------------------------------------------------
start = Date.now();
await page.goto(`${BASE}/app/biblioteca`, { wait: "domcontentloaded" });
await page.waitFor(`document.querySelector("article[aria-label]")`, { interval: 50, timeout: 30000 });
const firstCardMs = Date.now() - start;
await page.waitFor(`(document.querySelector("[aria-label='Cantidad de documentos filtrados']")?.textContent ?? "") === "${N} de ${N}"`, { interval: 50, timeout: 60000 });
const countedMs = Date.now() - start;
await page.sleep(1500);
const longTasks = await page.eval(`window.__longTasks ?? []`);
const cards = await page.eval(`document.querySelectorAll("article[aria-label]").length`);
const longest = Math.max(0, ...longTasks);
t.check("al recargar, la primera tarjeta en menos de 3 s", firstCardMs < 3000, seconds(firstCardMs));
t.check("y la biblioteca entera contada en menos de 5 s", countedMs < 5000, `${seconds(countedMs)} · ${cards} tarjetas en el DOM`);
t.check("sin bloquear la página más de 1,5 s seguidos", longest < 1500, `tarea más larga ${longest} ms · ${longTasks.length} tareas largas · ${longTasks.reduce((a, b) => a + b, 0)} ms en total`);
const heap = await page.eval(`Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)`);
console.log(`  · memoria de JavaScript: ${heap} MB`);

// ---- Filtrar ---------------------------------------------------------------------------------------------------------
const filter = async (text, expected) => {
  const begin = Date.now();
  await page.eval(`(() => { const el = document.querySelector("#library-search"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.waitFor(`(document.querySelector("[aria-label='Cantidad de documentos filtrados']")?.textContent ?? "").startsWith("${expected} de")`, { interval: 20, timeout: 10000 });
  return Date.now() - begin;
};
const filterMs = await filter(`Libro ${pad(Math.ceil(N / 2))}`, 1);
t.check("filtrar por título responde en menos de 1 s", filterMs < 1000, `${filterMs} ms`);
const clearMs = await filter("", N);
t.check("y volver a todos, también", clearMs < 1500, `${clearMs} ms`);

// ---- Indexar para buscar por palabras y buscar --------------------------------------------------------------------------
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 60000 });
start = Date.now();
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim())).click(), true)`);
const indexed = await page.waitFor(`[...document.querySelectorAll("[role=status]")].some((p) => /se busca por palabras/.test(p.textContent))`, { interval: 500, timeout: 600_000 }).then(() => true, () => false);
const indexMs = Date.now() - start;
const state = await page.eval(`document.querySelector("[data-testid=semantic-state]")?.textContent ?? ""`);
t.check(`indexar ${N} libros (troceado, en el equipo), en menos de ${N >= 400 ? 240 : 90} s`, indexed && indexMs < (N >= 400 ? 240_000 : 90_000) && state.startsWith(`${N} libros indexados de ${N}`), `${seconds(indexMs)} · ${state}`);
const chunks = await page.eval(`new Promise((ok) => { const r = indexedDB.open("pliegue-semantic-index"); r.onsuccess = () => { const db = r.result; const c = db.transaction("chunks").objectStore("chunks").count(); c.onsuccess = () => { ok(c.result); db.close(); }; }; })`);

const search = async (text) => {
  await page.eval(`(() => { const el = document.querySelector("#semantic-query"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await page.sleep(100);
  const begin = Date.now();
  await page.eval(`(document.querySelector("form[role=search] button[type=submit]").click(), true)`);
  await page.waitFor(`document.querySelector("section[aria-label='Resultados de «${text}»']")`, { interval: 20, timeout: 30000 });
  const ms = Date.now() - begin;
  const first = await page.eval(`document.querySelector("section[aria-label^='Resultados'] li a")?.textContent ?? ""`);
  return { first, ms };
};
const target = `clave${pad(Math.ceil(N / 3))}`;
const cold = await search(target);
t.check(`la primera búsqueda (arma el índice de ${chunks} fragmentos en memoria), en menos de 3 s`, cold.ms < 3000 && cold.first === `Libro ${pad(Math.ceil(N / 3))}`, `${cold.ms} ms · ${cold.first}`);
const warm = await search(`clave${pad(N)}`);
t.check("las siguientes, en menos de 0,5 s", warm.ms < 500 && warm.first === `Libro ${pad(N)}`, `${warm.ms} ms · ${warm.first}`);

// ---- Libros grandes: unas 300 páginas cada uno ---------------------------------------------------------------------------
const BIG = Number(process.env.CARGA_GRANDES ?? (process.env.CI ? 3 : 10));
const bigFiles = [];
for (let i = 1; i <= BIG; i += 1) {
  const chapters = Array.from({ length: 30 }, (_, c) => `<html><body><h1>Parte ${c + 1}</h1>${Array.from({ length: 12 }, (_, p) => `<p>${c === 15 && p === 6 ? `Aquí está el tesoro${pad(i)}. ` : ""}${prose(i * 1000 + c * 20 + p, 260)}</p>`).join("")}</body></html>`);
  const zip = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(
      `<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Tomo ${pad(i)}</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">es</dc:language></metadata><manifest>${chapters
        .map((_, c) => `<item id="c${c}" href="c${c}.xhtml" media-type="application/xhtml+xml" />`)
        .join("")}</manifest><spine>${chapters.map((_, c) => `<itemref idref="c${c}" />`).join("")}</spine></package>`,
    ),
  };
  chapters.forEach((html, c) => (zip[`c${c}.xhtml`] = strToU8(html)));
  const path = `${work}/Tomo-${pad(i)}.epub`;
  writeFileSync(path, zipSync(zip));
  bigFiles.push(path);
}
const characters = await import("node:fs").then(({ statSync }) => bigFiles.reduce((sum, path) => sum + statSync(path).size, 0));
await page.eval(`(document.querySelector("a[href='/app/biblioteca']").click(), true)`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`, { timeout: 20000 });
start = Date.now();
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", bigFiles);
const total = N + BIG;
const bigImported = await page.waitFor(`(document.querySelector("[aria-label='Cantidad de documentos filtrados']")?.textContent ?? "") === "${total} de ${total}"`, { interval: 500, timeout: 600_000 }).then(() => true, () => false);
t.check(`importar ${BIG} libros grandes (${Math.round(characters / 1024)} KB comprimidos), en menos de 60 s`, bigImported && Date.now() - start < 60_000, seconds(Date.now() - start));
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
await page.eval(`(document.querySelector("a[href='/app/ia']").click(), true)`);
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim()) && !b.disabled)`, { timeout: 60000 });
start = Date.now();
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Indexar \\d+ libros?$/.test(b.textContent.trim())).click(), true)`);
const bigIndexed = await page.waitFor(`[...document.querySelectorAll("[role=status]")].some((p) => /se busca por palabras/.test(p.textContent))`, { interval: 500, timeout: 600_000 }).then(() => true, () => false);
const bigIndexMs = Date.now() - start;
const allChunks = await page.eval(`new Promise((ok) => { const r = indexedDB.open("pliegue-semantic-index"); r.onsuccess = () => { const db = r.result; const c = db.transaction("chunks").objectStore("chunks").count(); c.onsuccess = () => { ok(c.result); db.close(); }; }; })`);
t.check(`indexar los ${BIG} grandes (solo esos: lo demás no se repite), en menos de 60 s`, bigIndexed && bigIndexMs < 60_000, `${seconds(bigIndexMs)} · ${allChunks - chunks} fragmentos nuevos`);
const deep = await search(`tesoro${pad(BIG)}`);
t.check(`buscar entre ${allChunks} fragmentos encuentra la frase en mitad de un tomo, en menos de 3 s`, deep.ms < 3000 && deep.first === `Tomo ${pad(BIG)}`, `${deep.ms} ms · ${deep.first}`);
const warmBig = await search(`tesoro${pad(1)}`);
t.check("y la siguiente búsqueda, en menos de 0,5 s", warmBig.ms < 500 && warmBig.first === "Tomo 001", `${warmBig.ms} ms · ${warmBig.first}`);
console.log(`  · memoria de JavaScript al final: ${await page.eval(`Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)`)} MB`);

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
rmSync(work, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
