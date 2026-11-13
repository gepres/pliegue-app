// 03.6c: el mismo libro en PDF y en EPUB es otra versión, no un repetido. Sin ficha, «Libros
// repetidos» los propone como pareja; con el índice que declara «Versión PDF» y «Versión EPUB»,
// la tarjeta dice qué versión es cada uno y la pareja deja de proponerse. Nada sale fuera.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/versiones`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Versiones de un libro (${BASE})`);
const browser = await openChrome({ port: 9419, profile: `${PROFILE_ROOT}-versiones` });
const page = await browser.newPage();

// ---- El libro, en PDF y en EPUB, con el mismo texto ------------------------------------------
const vocabulary = (
  "hierba trenza raíz semilla río bosque lluvia tierra madre fresa arce agua luz canto regalo cesta " +
  "musgo lago otoño maíz frijol calabaza abeja nido piedra viento hoja flor fruto camino orilla"
).split(" ");
function prose(seed, words) {
  let state = [...seed].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7) >>> 0;
  const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0);
  const out = [];
  for (let i = 0; i < words; i += 1) out.push(vocabulary[(next() >>> 8) % vocabulary.length]);
  return out.join(" ").replace(/((?:\S+\s){13}\S+)\s?/g, (m, s) => `${s[0].toUpperCase()}${s.slice(1)}. `);
}
const text = prose("trenza", 1600);
const paragraphs = text.match(/(?:[^.]+\.){1,6}/g).map((p) => `<p>${p.trim()}</p>`).join("");
const title = "Una trenza de hierba sagrada";

await page.viewport(900, 1200);
await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>p{font:15px/1.5 Georgia}</style></head><body><h1>${title}</h1>${paragraphs}</body></html>`)}`);
await page.sleep(200);
writeFileSync(`${work}/Trenza.pdf`, Buffer.from((await page.send("Page.printToPDF", { printBackground: true })).data, "base64"));
writeFileSync(
  `${work}/Trenza.epub`,
  zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:language>es</dc:language></metadata><manifest><item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`),
    "OEBPS/text/ch1.xhtml": strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${title}</h1>${paragraphs}</body></html>`),
  }),
);
const index = {
  pliegueCatalog: 2,
  entries: ["pdf", "epub"].map((format) => ({
    authors: ["Robin Wall Kimmerer"],
    category: "Ciencia y naturaleza",
    edition: `Versión ${format.toUpperCase()}`,
    fileName: `Trenza.${format}`,
    language: "es",
    title,
  })),
};
writeFileSync(`${work}/indice.json`, JSON.stringify(index, null, 1));

// ---- Nada sale fuera ---------------------------------------------------------------------------
const external = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  external.push(m.params.request.url);
  page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId: m.params.requestId }).catch(() => {});
});

// ---- Importar los dos y esperar a que su texto esté indexado ------------------------------------
await page.viewport(1366, 900);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Trenza.pdf`, `${work}/Trenza.epub`]);
// El formato sale de la portada (`data-format`): los dos llevan el mismo título.
const tiles = () => page.eval(`[...document.querySelectorAll("article")].filter((a) => a.getAttribute("aria-label")).map((a) => ({ format: a.querySelector("[data-format]")?.dataset.format ?? "", label: a.getAttribute("aria-label"), meta: a.querySelector("[class*=tileMeta]")?.textContent ?? "" }))`);
await page.waitFor(`[...document.querySelectorAll("article")].filter((a) => a.getAttribute("aria-label")).length >= 2`, { timeout: 90000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
t.check("se importan los dos", (await tiles()).length === 2, JSON.stringify(await tiles()));
t.check("sin ficha, ninguna tarjeta dice su versión", !(await tiles()).some((tile) => /Versión/i.test(tile.meta)));

const search = async (value) => {
  await page.eval(`(() => {
    const input = document.querySelector("input[type=search]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await page.sleep(600);
  return tiles();
};
const phrase = text.split(" ").slice(300, 306).join(" ").replace(/\./g, "");
let found = [];
for (let i = 0; i < 30 && found.length < 2; i += 1) {
  found = await search(phrase);
  if (found.length < 2) await page.sleep(1000);
}
t.check("el texto de los dos está indexado", found.length === 2, `${found.length} encontrados`);
await search("");

// ---- «Libros repetidos» ----------------------------------------------------------------------
const sheetOpen = `[...document.querySelectorAll("aside[role=dialog]")].find((a) => a.dataset.open === "true" && a.querySelector("h2")?.textContent === "Libros repetidos")`;
const finderStatus = () => page.eval(`(${sheetOpen})?.querySelector("[role=status]")?.textContent ?? ""`);
async function openFinder() {
  await page.click("button[aria-label^='Filtros']");
  await page.waitFor(`[...document.querySelectorAll("[role=dialog][aria-label='Filtros']")].some((p) => !p.hidden)`);
  await page.click("text=Buscar libros repetidos");
  await page.waitFor(sheetOpen);
  await page.waitFor(`/parece|No queda/.test((${sheetOpen})?.querySelector("[role=status]")?.textContent ?? "")`, { timeout: 60000 });
  return finderStatus();
}
async function closeFinder() {
  await page.eval(`((${sheetOpen}).querySelector("[data-sheet-close]").click(), true)`);
  await page.sleep(400);
}
let status = await openFinder();
t.check("control: sin ficha, el PDF y el EPUB se proponen como pareja", /^Una pareja parece/.test(status), status);
await closeFinder();

// ---- El índice declara las dos versiones --------------------------------------------------------
await page.goto(`${BASE}/app/biblioteca/fuentes`);
const jsonInput = "input[aria-label='Seleccionar archivo JSON de índice']";
await page.waitFor(`document.querySelector("${jsonInput}")`, { timeout: 20000 });
await page.waitFor(`[...document.querySelectorAll("#importar-indice button")].some((b) => b.textContent.trim() === "Descargar plantilla" && !b.disabled)`, { timeout: 20000 });
await page.setFiles(jsonInput, [`${work}/indice.json`]);
await page.waitFor(`[...document.querySelectorAll("#importar-indice button")].some((b) => /^Aplicar \\d+ fichas?$/.test(b.textContent.trim()))`, { timeout: 10000 });
await page.eval(`([...document.querySelectorAll("#importar-indice button")].find((b) => /^Aplicar \\d+ fichas?$/.test(b.textContent.trim())).click(), true)`);
const importedCount = () => page.eval(`[...document.querySelectorAll("#importar-indice span")].map((s) => s.textContent).find((x) => /importada/.test(x)) ?? ""`);
await page.waitFor(`/^2 fichas importadas/.test([...document.querySelectorAll("#importar-indice span")].map((s) => s.textContent).find((x) => /importada/.test(x)) ?? "")`, { timeout: 10000 }).catch(() => {});
t.check("se aplican las dos fichas", /^2 fichas importadas/.test(await importedCount()), await importedCount());
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => /Ahora no|Cerrar/.test(x.textContent.trim()))?.click(), true)`);

// ---- La Biblioteca: cada tarjeta dice su versión ------------------------------------------------
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`[...document.querySelectorAll("article")].filter((a) => /Versión/i.test(a.textContent)).length >= 2`, { timeout: 30000 }).catch(() => {});
const withVersion = await tiles();
for (const tile of withVersion) console.log("    ·", tile.label, `(${tile.format})`, "→", tile.meta);
const matches = withVersion.filter((tile) => tile.meta.match(/Versión (PDF|EPUB)/i)?.[1]?.toLowerCase() === tile.format);
t.check("la tarjeta del PDF dice «Versión PDF» y la del EPUB «Versión EPUB»", withVersion.length === 2 && matches.length === 2, JSON.stringify(withVersion));
t.check("y ninguna dice «Duplicado»", !withVersion.some((tile) => /Duplicado/i.test(tile.meta)));
await page.screenshot(`${work}/1-cuadricula.png`);

status = await openFinder();
t.check("con las versiones declaradas, «Libros repetidos» ya no los propone", /No queda ninguna pareja/.test(status), status);
await closeFinder();

// ---- En lista, en el móvil y en oscuro ----------------------------------------------------------
await page.eval(`([...document.querySelectorAll("[role=radiogroup][aria-label='Vista'] [role=radio]")].find((b) => b.getAttribute("aria-label") === "Lista").click(), true)`);
await page.sleep(400);
t.check("en la lista también", (await tiles()).filter((tile) => /Versión/i.test(tile.meta)).length === 2, JSON.stringify(await tiles()));
await page.screenshot(`${work}/2-lista.png`);
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.sleep(600);
const overflow = await page.eval(`[...document.querySelectorAll("article")].filter((a) => a.getAttribute("aria-label")).map((a) => { const m = a.querySelector("[class*=tileMeta]"); return m.scrollWidth - m.clientWidth; })`);
t.check("en el móvil la pastilla no desborda la tarjeta", overflow.every((extra) => extra <= 1), JSON.stringify(overflow));
await page.screenshot(`${work}/3-movil.png`);
await page.theme("dark");
await page.sleep(300);
await page.screenshot(`${work}/4-movil-oscuro.png`);
await page.theme("light");

// La página Fuentes carga los scripts de Google Drive: se bloquean y no cuentan como datos que salen.
const leaks = external.filter((url) => !/^https:\/\/(accounts\.google\.com\/gsi\/client|apis\.google\.com\/js\/api\.js)/.test(url));
t.check("ninguna petición fuera (aparte de los scripts de Drive de Fuentes)", leaks.length === 0, leaks.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
