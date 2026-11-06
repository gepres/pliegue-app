// 03.6: «Buscar libros repetidos». Libros importados que son el mismo sin ser el mismo archivo:
// el mismo texto con otra maquetación y una página de créditos delante, y un escaneo sin texto
// con el mismo título que un PDF con texto. Se decide cuál conservar, se descarta una pareja,
// persiste al recargar y se deshace. Nada sale fuera: https bloqueado.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/duplicados`;
rmSync(work, { recursive: true, force: true });
mkdirSync(`${work}/escaneo`, { recursive: true });
mkdirSync(`${work}/texto`, { recursive: true });
const t = checker(`Libros repetidos (${BASE})`);
const browser = await openChrome({ port: 9386, profile: `${PROFILE_ROOT}-duplicados` });
const page = await browser.newPage();

// ---- Los libros ------------------------------------------------------------------------------
const vocabulary = (
  "alma cuerpo razón deseo virtud ciudad mundo tiempo verdad bien mal dios hombre naturaleza ley orden libertad juicio " +
  "memoria lenguaje espejo laberinto biblioteca sueño tigre río noche jardín sendero espada rostro sombra puerta libro " +
  "infinito eterno secreto mapa ciego rey palabra arena moneda puñal muerte destino olvido número patio casa"
).split(" ");
function prose(seed, words) {
  let state = [...seed].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7) >>> 0;
  const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0);
  const out = [];
  for (let i = 0; i < words; i += 1) out.push(vocabulary[(next() >>> 8) % vocabulary.length]);
  // Frases de 14 palabras, con mayúscula y punto: texto de libro, no una lista.
  return out.join(" ").replace(/((?:\S+\s){13}\S+)\s?/g, (m, s) => `${s[0].toUpperCase()}${s.slice(1)}. `);
}
const ficciones = prose("ficciones", 1600);
await page.viewport(900, 1200);
async function textPdf(path, title, html) {
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`)}`);
  await page.sleep(200);
  const { data } = await page.send("Page.printToPDF", { printBackground: true });
  writeFileSync(path, Buffer.from(data, "base64"));
}
const paragraphs = (text, style) => text.match(/(?:[^.]+\.){1,6}/g).map((p) => `<p style="${style}">${p.trim()}</p>`).join("");
await textPdf(`${work}/Ficciones.pdf`, "Ficciones", `<h1>Ficciones</h1>${paragraphs(ficciones, "font:15px/1.5 Georgia")}`);
await textPdf(
  `${work}/Ficciones bolsillo.pdf`,
  "Ficciones bolsillo",
  `<div style="page-break-after:always;font:13px/1.6 sans-serif"><h1>Ficciones</h1><p>Edición de bolsillo. Primera edición en esta colección. Diseño de la cubierta del departamento de arte. Impreso en papel ecológico. Queda prohibida la reproducción total o parcial de esta obra por cualquier medio sin autorización escrita de los titulares del copyright.</p></div>${paragraphs(ficciones, "font:11px/1.35 'Times New Roman'")}`,
);
await textPdf(`${work}/Otro libro.pdf`, "Tratado de la arena", `<h1>Tratado de la arena</h1>${paragraphs(prose("arena", 1600), "font:15px/1.5 Georgia")}`);
await textPdf(`${work}/texto/El Aleph.pdf`, "El Aleph", `<h1>El Aleph</h1>${paragraphs(prose("aleph", 1600), "font:15px/1.5 Georgia")}`);
// El escaneo: una página en JPEG, sin capa de texto.
await page.viewport(1224, 1584);
await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:#2b2118"><div style="padding:260px 140px;font:72px/1.3 Georgia;color:#f2e6c9;text-align:center">EL ALEPH<br><span style="font-size:40px">Jorge Luis Borges</span></div></body></html>`)}`);
await page.sleep(200);
const jpeg = Buffer.from((await page.send("Page.captureScreenshot", { format: "jpeg", quality: 85 })).data, "base64");
writeFileSync(`${work}/escaneo/El Aleph.pdf`, scannedPdf([jpeg], 1224, 1584));

// ---- Nada sale fuera ---------------------------------------------------------------------------
const external = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  external.push(m.params.request.url);
  page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId: m.params.requestId }).catch(() => {});
});

// ---- Importar -----------------------------------------------------------------------------------
await page.viewport(1366, 900);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
const files = ["Ficciones.pdf", "Ficciones bolsillo.pdf", "Otro libro.pdf", "texto/El Aleph.pdf", "escaneo/El Aleph.pdf"].map((f) => `${work}/${f}`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", files);
const tiles = () => page.eval(`[...document.querySelectorAll("article")].map((a) => a.getAttribute("aria-label")).filter(Boolean)`);
await page.waitFor(`[...document.querySelectorAll("article")].filter((a) => a.getAttribute("aria-label")).length >= 5`, { timeout: 90000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
t.check("se importan los cinco libros", (await tiles()).length === 5, (await tiles()).join(" | "));

// El texto se indexa al importar: se espera a que buscar una frase del libro encuentre los dos.
const search = async (text) => {
  await page.eval(`(() => {
    const input = document.querySelector("input[type=search]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await page.sleep(600);
  return tiles();
};
const phrase = ficciones.split(" ").slice(300, 306).join(" ").replace(/\./g, "");
let found = [];
const bothFound = () => found.filter((label) => label.includes("Ficciones")).length === 2;
for (let i = 0; i < 30 && !bothFound(); i += 1) {
  found = await search(phrase);
  if (!bothFound()) await page.sleep(1000);
}
t.check("el texto de los dos «Ficciones» está indexado", bothFound(), found.join(" | "));
await search("");

// ---- Abrir desde «Filtros» ----------------------------------------------------------------------
const sheetOpen = `[...document.querySelectorAll("aside[role=dialog]")].find((a) => a.dataset.open === "true" && a.querySelector("h2")?.textContent === "Libros repetidos")`;
async function openFinder() {
  await page.click("button[aria-label^='Filtros']");
  await page.waitFor(`[...document.querySelectorAll("[role=dialog][aria-label='Filtros']")].some((p) => !p.hidden)`);
  await page.click("text=Buscar libros repetidos");
  await page.waitFor(sheetOpen);
  await page.waitFor(`(() => { const s = ${sheetOpen}; const st = s?.querySelector("[role=status]")?.textContent ?? ""; return /parece|No queda/.test(st) && st; })()`, { timeout: 60000 });
  // Que termine de entrar: la hoja se desliza desde la derecha.
  await page.waitFor(`Math.round((${sheetOpen}).getBoundingClientRect().right) === innerWidth`, { timeout: 3000 }).catch(() => {});
  await page.sleep(200);
}
await openFinder();
t.check("al abrir la hoja, el popover de Filtros se cierra", await page.eval(`[...document.querySelectorAll("[role=dialog][aria-label='Filtros']")].every((p) => p.hidden)`));
const geometry = await page.eval(`(() => { const r = (${sheetOpen}).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: innerWidth, h: innerHeight }; })()`);
t.check("la hoja ocupa su sitio en la ventana (pegada a la derecha, entera)", geometry.right === geometry.w && geometry.left > 0 && geometry.top >= 0 && geometry.bottom <= geometry.h, JSON.stringify(geometry));

const readPairs = () =>
  page.eval(`[...(${sheetOpen}).querySelectorAll("li")].filter((li) => li.querySelector("p")).map((li) => ({
    reason: li.querySelector("p").textContent,
    titles: [...li.querySelectorAll("strong")].map((s) => s.textContent),
    recommended: [...li.querySelectorAll("strong")].filter((s) => s.parentElement.textContent.includes("Recomendado")).map((s) => s.textContent),
  }))`);
let pairs = await readPairs();
const status = () => page.eval(`(${sheetOpen}).querySelector("[role=status]")?.textContent ?? ""`);
console.log("   ", await status());
for (const pair of pairs) console.log("    ·", pair.reason, "→", pair.titles.join(" / "), pair.recommended.length ? `(recomendado: ${pair.recommended})` : "");
const textPair = pairs.find((p) => p.titles.includes("Ficciones") && p.titles.includes("Ficciones bolsillo"));
const alephPair = pairs.find((p) => p.titles.filter((x) => x === "El Aleph").length === 2);
t.check("propone las dos parejas, y solo esas", pairs.length === 2 && textPair && alephPair, `${pairs.length} parejas`);
t.check("«Ficciones»: por el mismo texto, pese a los créditos y la otra maquetación", /El mismo texto en un \d+ %/.test(textPair?.reason ?? ""), textPair?.reason);
t.check("se recomienda conservar el que tiene más texto (el de bolsillo, con créditos)", textPair?.recommended.join() === "Ficciones bolsillo", textPair?.recommended.join());
t.check("«El Aleph»: el escaneo sin texto se empareja por el título (o la portada)", /mismo título|misma portada/.test(alephPair?.reason ?? ""), alephPair?.reason);
t.check("«Tratado de la arena» no se empareja con nada", !pairs.some((p) => p.titles.includes("Tratado de la arena")));
await page.screenshot(`${work}/1-hoja.png`);

// Escape cierra la hoja (no el popover, que ya no la contiene).
await page.key("Escape", { keyCode: 27 });
await page.sleep(400);
t.check("Escape cierra la hoja", !(await page.eval(`Boolean(${sheetOpen})`)));
await openFinder();

// ---- Conservar uno y descartar la otra pareja --------------------------------------------------
await page.click("button[aria-label='Conservar «Ficciones bolsillo» y marcar el otro como copia']");
await page.waitFor(`/Una pareja parece/.test((${sheetOpen}).querySelector("[role=status]")?.textContent ?? "")`);
const marked = () => page.eval(`[...((${sheetOpen}).querySelector("section[aria-labelledby=duplicados-marcados]")?.querySelectorAll("li") ?? [])].map((li) => li.querySelector("span").textContent)`);
t.check("conservar el de bolsillo marca el otro como copia", (await marked()).join() === "Ficciones → copia de «Ficciones bolsillo»", (await marked()).join());
await page.eval(`([...(${sheetOpen}).querySelectorAll("button")].find((b) => b.textContent.trim() === "No son el mismo libro").click(), true)`);
await page.waitFor(`/No queda ninguna pareja/.test((${sheetOpen}).querySelector("[role=status]")?.textContent ?? "")`);
t.check("«No son el mismo libro» quita la pareja", true);
await page.eval(`((${sheetOpen}).querySelector("[data-sheet-close]").click(), true)`);
await page.sleep(400);

// ---- La Biblioteca: aviso en la tarjeta y «Ocultar duplicados» --------------------------------
const badge = await page.eval(`[...document.querySelectorAll("article")].filter((a) => a.textContent.includes("Duplicado")).map((a) => a.getAttribute("aria-label"))`);
t.check("la tarjeta de la copia lleva «Duplicado»", badge.length === 1 && /^Ficciones(?! bolsillo)/.test(badge[0] ?? ""), badge.join(" | "));
await page.click("button[aria-label^='Filtros']");
await page.waitFor(`[...document.querySelectorAll("[role=dialog][aria-label='Filtros']")].some((p) => !p.hidden)`);
const hideSwitch = `[...document.querySelectorAll("label")].find((l) => l.textContent.includes("Ocultar duplicados"))`;
const switchText = await page.eval(`${hideSwitch}?.closest("div")?.parentElement?.textContent ?? ""`);
t.check("el interruptor cuenta la copia marcada", /1 copia marcada/.test(switchText), switchText.slice(0, 120));
await page.eval(`(${hideSwitch}.querySelector("input") ?? document.getElementById(${hideSwitch}.htmlFor)).click(), true`);
await page.sleep(500);
await page.key("Escape", { keyCode: 27 });
await page.sleep(300);
t.check("«Ocultar duplicados» esconde la copia", (await tiles()).length === 4, (await tiles()).join(" | "));

// ---- Persiste al recargar; «Deshacer» la devuelve -----------------------------------------------
await page.goto(`${BASE}/app/biblioteca?r=1`);
await page.waitFor(`[...document.querySelectorAll("article")].filter((a) => a.getAttribute("aria-label")).length >= 5`, { timeout: 30000 });
await openFinder();
t.check("al recargar, lo decidido sigue: ninguna pareja pendiente", /No queda ninguna pareja/.test(await status()), await status());
t.check("y la copia sigue en «Marcados aquí como copia»", (await marked()).length === 1);
await page.eval(`([...(${sheetOpen}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Deshacer").click(), true)`);
await page.waitFor(`/Una pareja parece/.test((${sheetOpen}).querySelector("[role=status]")?.textContent ?? "")`);
pairs = await readPairs();
t.check("«Deshacer» devuelve la pareja de «Ficciones» (la descartada no vuelve)", pairs.length === 1 && pairs[0].titles.includes("Ficciones"), pairs.map((p) => p.titles.join(" / ")).join(" | "));

// ---- En el móvil y en oscuro ----------------------------------------------------------------------
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.sleep(600);
const overflow = await page.eval(`(() => { const s = ${sheetOpen}; const body = s.querySelector("[class*=sheetBody]") ?? s; return { sw: body.scrollWidth, cw: body.clientWidth, w: Math.round(s.getBoundingClientRect().width) }; })()`);
t.check("en el móvil la hoja no desborda de lado", overflow.sw <= overflow.cw + 1 && overflow.w <= 390, JSON.stringify(overflow));
await page.screenshot(`${work}/2-movil.png`);
await page.theme("dark");
await page.sleep(300);
await page.screenshot(`${work}/3-movil-oscuro.png`);
await page.theme("light");

t.check("ninguna petición fuera", external.length === 0, external.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);

function scannedPdf(images, width, height) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk;
    parts.push(buffer);
    length += buffer.length;
  };
  push("%PDF-1.7\n");
  const object = (number, body, stream) => {
    offsets[number] = length;
    push(`${number} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };
  const pageIds = images.map((_, index) => 3 + index * 3);
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`);
  images.forEach((jpeg, index) => {
    const id = pageIds[index];
    const content = "q 612 0 0 792 0 0 cm /Im1 Do Q";
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    object(id + 2, `<< /Length ${content.length} >>`, Buffer.from(content, "latin1"));
  });
  const count = 3 + images.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
