// 05.1: las imágenes de un EPUB y de un DOCX se ven en el lector, en su sitio, con su alt y su
// pie; al traducir (LibreTranslate simulado con CDP) no se mandan ni se pierden; la URL blob:
// se suelta al salir del lector. Nada de fuera: https bloqueado.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/imagenes-epub-docx`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Imágenes de EPUB y DOCX en el lector (${BASE})`);
const browser = await openChrome({ port: 9391, profile: `${PROFILE_ROOT}-imagenes` });
const page = await browser.newPage();

// ---- Imágenes de verdad, hechas con Chrome ----------------------------------------------------
async function shot(html, width, height, format) {
  await page.viewport(width, height);
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0">${html}</body></html>`)}`);
  await page.sleep(150);
  return new Uint8Array(Buffer.from((await page.send("Page.captureScreenshot", { format, quality: format === "jpeg" ? 85 : undefined })).data, "base64"));
}
const map = await shot(`<div style="width:640px;height:400px;background:linear-gradient(135deg,#2f6b4f,#d9c27a);display:grid;place-items:center;font:700 48px Georgia;color:#fff">MAPA DEL JARDÍN</div>`, 640, 400, "png");
const cover = await shot(`<div style="width:600px;height:900px;background:#2b2118;display:grid;place-items:center;font:72px Georgia;color:#f2e6c9">EL JARDÍN</div>`, 600, 900, "jpeg");
const chart = await shot(`<div style="width:500px;height:300px;background:#fff;display:flex;align-items:flex-end;gap:20px;padding:20px">${[40, 120, 200, 160, 260].map((h) => `<div style="width:60px;height:${h}px;background:#3a6ea5"></div>`).join("")}</div>`, 540, 340, "png");

const prose = (n) => Array.from({ length: n }, (_, i) => `Frase número ${i + 1} sobre el jardín y sus senderos.`).join(" ");
const epub = zipSync({
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  "OEBPS/content.opf": strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>El jardín</dc:title><dc:language>es</dc:language></metadata><manifest>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/><item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="images/mapa.png" media-type="image/png"/><item id="img2" href="images/cover.jpg" media-type="image/jpeg"/></manifest>
    <spine><itemref idref="cover"/><itemref idref="ch1"/></spine></package>`),
  "OEBPS/text/cover.xhtml": strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 900"><image width="600" height="900" xlink:href="../images/cover.jpg"/></svg></body></html>`),
  "OEBPS/text/ch1.xhtml": strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>El jardín</h1><p>${prose(6)}</p>
    <figure><img src="../images/mapa.png" alt="Mapa del jardín"/><figcaption>Figura 1. El jardín visto desde arriba.</figcaption></figure><p>${prose(4)}</p></body></html>`),
  "OEBPS/images/mapa.png": map,
  "OEBPS/images/cover.jpg": cover,
});
writeFileSync(`${work}/El jardin.epub`, epub);
const docx = zipSync({
  "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
  "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="wp" xmlns:a="a" xmlns:pic="pic" xmlns:r="r"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Informe de ventas</w:t></w:r></w:p>
    <w:p><w:r><w:t>${prose(3)}</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Imagen 1" descr="Gráfico de ventas por mes"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>Las ventas crecieron cada mes.</w:t></w:r></w:p></w:body></w:document>`),
  "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`),
  "word/media/image1.png": chart,
});
writeFileSync(`${work}/Informe.docx`, docx);

// ---- Red: LibreTranslate simulado; nada de https --------------------------------------------
const sentToTranslate = [];
const external = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "http://libre.prueba:5000/*" }, { urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  if (request.url.startsWith("https://")) {
    external.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  const json = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "content-type" }];
  const reply = (code, body) => page.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: json, body: Buffer.from(body).toString("base64") }).catch(() => {});
  if (request.method === "OPTIONS") return reply(204, "");
  const body = JSON.parse(request.postData ?? "{}");
  const q = Array.isArray(body.q) ? body.q : [body.q];
  sentToTranslate.push(...q);
  return reply(200, JSON.stringify({ translatedText: q.map((x) => `[Libre] ${x}`) }));
});

// ---- Importar los dos ---------------------------------------------------------------------------
await page.viewport(1366, 900);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", ["El jardin.epub", "Informe.docx"].map((f) => `${work}/${f}`));
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 2`, { timeout: 60000 });
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const ids = await page.eval(`Object.fromEntries([...document.querySelectorAll("article")].filter((a) => a.getAttribute("aria-label")).map((a) => [a.getAttribute("aria-label"), new URL(a.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")]))`);
console.log("    documentos:", Object.keys(ids).join(" | "));
const epubId = Object.entries(ids).find(([title]) => /jard/i.test(title))?.[1];
const docxId = Object.entries(ids).find(([title]) => /Informe/i.test(title))?.[1];

const images = () =>
  page.eval(`[...document.querySelectorAll("figure img")].map((img) => ({ alt: img.alt, blob: img.src.startsWith("blob:"), loaded: img.complete && img.naturalWidth > 0, width: Math.round(img.getBoundingClientRect().width), box: Math.round(img.closest("figure").getBoundingClientRect().width), src: img.src }))`);

// ---- EPUB --------------------------------------------------------------------------------------
await page.goto(`${BASE}/app/lector?document=${epubId}`);
await page.waitFor(`document.querySelectorAll("figure img").length >= 2 && [...document.querySelectorAll("figure img")].every((img) => img.complete && img.naturalWidth > 0)`, { timeout: 30000 }).catch(() => {});
let shown = await images();
console.log("    EPUB:", JSON.stringify(shown.map(({ alt, blob, box, loaded, width }) => ({ alt, blob, box, loaded, width }))));
t.check("EPUB: se ven la portada (del <svg>) y la ilustración", shown.length === 2 && shown.every((img) => img.loaded && img.blob), `${shown.length} imágenes`);
t.check("EPUB: la ilustración lleva su alt", shown.some((img) => img.alt === "Mapa del jardín"));
t.check("EPUB: ninguna imagen se sale de su columna", shown.every((img) => img.width <= img.box));
const caption = await page.eval(`[...document.querySelectorAll("p")].find((p) => /^Figura 1\\./.test(p.textContent))?.className ?? ""`);
t.check("EPUB: el <figcaption> se pinta como pie", /caption/.test(caption), caption);
t.check("EPUB: la ilustración va entre sus párrafos, después del primero", await page.eval(`(() => { const fig = [...document.querySelectorAll("figure")].find((f) => f.querySelector("img[alt='Mapa del jardín']")); const prev = fig?.previousElementSibling?.textContent ?? ""; const next = fig?.nextElementSibling?.textContent ?? ""; return /Frase número 6/.test(prev) && /^Figura 1/.test(next); })()`));
// Las anclas del punto de lectura cuentan solo el texto: el párrafo de después de la imagen
// conserva el número que tenía antes de que se vieran las imágenes (título 0, párrafo 1,
// pie 2, párrafo 3).
const anchors = await page.eval(`[...document.querySelectorAll("[data-section-index='2'] [data-reading-anchor]")].map((el) => el.tagName + ":" + el.getAttribute("data-reading-anchor"))`);
console.log("    anclas:", anchors.join(" "));
t.check("EPUB: las anclas no cuentan la imagen", anchors.join(" ") === "P:s2:1 P:s2:2 P:s2:3", anchors.join(" "));
t.check("EPUB: sin desborde de lado", (await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
await page.eval(`([...document.querySelectorAll("figure img")].find((i) => i.alt === "Mapa del jardín")?.scrollIntoView({ block: "center" }), true)`);
await page.sleep(400);
await page.screenshot(`${work}/1-epub.png`);
const mapUrl = shown.find((img) => img.alt === "Mapa del jardín")?.src;

// ---- Traducir con LibreTranslate (gratis): las imágenes ni se mandan ni se pierden ------------
await page.eval(`([...document.querySelectorAll("a[href^='/app/ajustes']")][0].click(), true)`);
await page.waitFor(`document.querySelector("#ai-translation-provider")`, { timeout: 20000 }).catch(async () => {
  await page.eval(`(location.hash = "ia", true)`);
  await page.waitFor(`document.querySelector("#ai-translation-provider")`, { timeout: 20000 });
});
const leftReader = mapUrl ? await page.eval(`fetch(${JSON.stringify(mapUrl)}).then(() => "viva", () => "liberada")`) : "sin url";
t.check("al salir del lector, la URL blob: de la imagen se suelta", leftReader === "liberada", leftReader);
await page.eval(`(() => { const row = [...document.querySelectorAll("table tbody tr")].find((r) => r.querySelector("th")?.textContent.trim().startsWith("LibreTranslate")); row.querySelector("button").click(); return true; })()`);
await page.sleep(400);
await page.eval(`(() => { const i = document.querySelector("#ai-libretranslate-url"); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "http://libre.prueba:5000"); i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); return true; })()`);
await page.sleep(300);
await page.eval(`([...document.querySelectorAll("button")].find((b) => /^Guardar/.test(b.textContent.trim())).click(), true)`);
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("a[href='/app/biblioteca']")][0].click(), true)`);
await page.waitFor(`document.querySelector("a[href*='/app/lector?document=${epubId}']")`, { timeout: 20000 });
await page.eval(`(document.querySelector("a[href*='/app/lector?document=${epubId}']").click(), true)`);
await page.waitFor(`document.querySelectorAll("figure img").length >= 2`, { timeout: 30000 });
await page.sleep(1200);
await page.key("t", { code: "KeyT", keyCode: 84, text: "t" });
await page.waitFor(`[...document.querySelectorAll("button")].some((b) => /Traducir este libro/.test(b.textContent))`, { timeout: 20000 });
await page.eval(`([...document.querySelectorAll("button")].find((b) => /Traducir este libro/.test(b.textContent.trim())).click(), true)`);
await page.sleep(800);
const whole = `[...document.querySelectorAll("button")].find((b) => /^Traducir el libro entero$/.test(b.textContent.trim()))`;
if (await page.eval(`Boolean(${whole})`)) await page.eval(`(${whole}.click(), true)`);
await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /^\\[Libre\\] Figura 1/.test(p.textContent.trim()))`, { timeout: 60000 }).catch(() => {});
await page.sleep(800);
console.log("    pasajes enviados:", sentToTranslate.length);
t.check("se tradujo el texto del capítulo (también el pie)", await page.eval(`[...document.querySelectorAll("p")].some((p) => /^\\[Libre\\] Figura 1/.test(p.textContent.trim()))`), `${sentToTranslate.length} pasajes`);
t.check("no se mandó a traducir ni la imagen ni su alt, ni pasajes vacíos", sentToTranslate.length > 0 && !sentToTranslate.some((q) => /Mapa del jardín/.test(q) || !q.trim()), sentToTranslate.filter((q) => /Mapa/.test(q) || !q.trim()).slice(0, 2).join(" | "));
shown = await images();
t.check("con la traducción, las dos imágenes siguen en su sitio", shown.length >= 2 && shown.every((img) => img.loaded), `${shown.length} imágenes`);
await page.screenshot(`${work}/2-epub-traducido.png`);

// ---- DOCX --------------------------------------------------------------------------------------
await page.goto(`${BASE}/app/lector?document=${docxId}`);
await page.waitFor(`document.querySelectorAll("figure img").length >= 1 && [...document.querySelectorAll("figure img")].every((img) => img.complete && img.naturalWidth > 0)`, { timeout: 30000 }).catch(() => {});
shown = await images();
t.check("DOCX: la imagen del párrafo se ve, con su descripción como alt", shown.length === 1 && shown[0].loaded && shown[0].alt === "Gráfico de ventas por mes", JSON.stringify(shown.map(({ alt, blob, box, loaded, width }) => ({ alt, blob, box, loaded, width }))));
await page.screenshot(`${work}/3-docx.png`);

// ---- Móvil y oscuro -------------------------------------------------------------------------------
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.theme("dark");
await page.goto(`${BASE}/app/lector?document=${epubId}&m=1`);
await page.waitFor(`document.querySelectorAll("figure img").length >= 2`, { timeout: 30000 }).catch(() => {});
await page.sleep(800);
shown = await images();
t.check("en el móvil, ninguna imagen se sale de la pantalla", shown.length >= 2 && shown.every((img) => img.width <= 390) && (await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
await page.eval(`([...document.querySelectorAll("figure img")].find((i) => i.alt === "Mapa del jardín")?.scrollIntoView({ block: "center" }), true)`);
await page.sleep(300);
await page.screenshot(`${work}/4-movil-oscuro.png`);

t.check("nada sale fuera", external.length === 0, external.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
