// 06.5 · Regresión visual: las pantallas principales, en claro y en oscuro (y dos en el móvil),
// comparadas píxel a píxel con sus capturas de referencia. Un cambio de aspecto que nadie pidió
// hace fallar la prueba y deja la captura nueva y un mapa de diferencias (en rojo).
//
// Las referencias son de cada sistema, porque el texto se dibuja distinto en Linux y en Windows:
// `e2e/visual/<plataforma>/`. En el repositorio están las de Linux, las del CI; en local se crean
// solas la primera vez (y no se suben). Sin referencia, la prueba la guarda y pasa avisando; en
// el CI la deja en `<E2E_WORK>/visual-nuevas/` para subirla como artefacto.
// `VISUAL_UPDATE=1` vuelve a hacer las referencias (tras un cambio de aspecto querido).
//
// La comparación se hace en el propio Chrome (canvas): sin dependencias nuevas.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/regresion-visual`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const here = dirname(fileURLToPath(import.meta.url));
const references = join(here, "visual", process.platform);
const ci = Boolean(process.env.CI);
const update = process.env.VISUAL_UPDATE === "1";
// Tolerancia: un canal que cambia más de 24 de 255 cuenta como píxel distinto, y pasa si los
// distintos no llegan al 0,2 % de la pantalla (unos 2.000 píxeles en 1280 × 800).
const channelTolerance = 24;
const maxDifferentRatio = 0.002;

const t = checker(`Regresión visual (${BASE}, ${process.platform})`);
const browser = await openChrome({ port: 9412, profile: `${PROFILE_ROOT}-regresion-visual` });
const page = await browser.newPage();
// La comparación va en otra pestaña; la de la app, siempre al frente: una pestaña de fondo no
// se pinta (ni corre requestAnimationFrame), y la captura saldría vieja.
const compare = await browser.newPage();
await page.send("Page.bringToFront");

// Quieto y sin parpadeos: sin animaciones ni transiciones, sin cursor de texto y sin barras de
// desplazamiento (cambian con el sistema y con el contenido).
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; } html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }";
    document.head.append(style);
  });`,
});

// ---- Un libro fijo, para que la Biblioteca y el lector tengan contenido -----------------------------------------------
await page.viewport(900, 1200);
await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ensayo</title></head><body><h1>Ensayo sobre el tiempo</h1><p style="font:15px/1.5 Georgia">${"La memoria y el lenguaje del tiempo. ".repeat(150)}</p></body></html>`)}`);
writeFileSync(`${work}/Ensayo.pdf`, Buffer.from((await page.send("Page.printToPDF", {})).data, "base64"));
await page.viewport(1280, 800);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Ensayo.pdf`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
const id = await page.eval(`new URL(document.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")`);
await page.sleep(800);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

const screens = [
  { name: "portada", path: "/", themes: ["light", "dark"] },
  { name: "inicio", path: "/app", themes: ["light"] },
  { name: "biblioteca", path: "/app/biblioteca", themes: ["light", "dark"] },
  { name: "lector", path: `/app/lector?document=${id}`, themes: ["light", "dark"], ready: `[...document.querySelectorAll("canvas")].some((c) => c.width > 100)` },
  { name: "ajustes", path: "/app/ajustes", themes: ["light"] },
  { name: "catalogo", path: "/design-system", themes: ["light", "dark"] },
  { name: "biblioteca-movil", path: "/app/biblioteca", themes: ["light"], mobile: true },
  { name: "lector-movil", path: `/app/lector?document=${id}`, themes: ["light"], mobile: true, ready: `[...document.querySelectorAll("canvas")].some((c) => c.width > 100)` },
];

/** Compara dos PNG en el Chrome de la prueba: cuántos píxeles cambian y un mapa con ellos en rojo. */
async function diff(reference, current) {
  return compare.eval(`(async () => {
    const load = (data) => new Promise((ok, ko) => { const image = new Image(); image.onload = () => ok(image); image.onerror = ko; image.src = "data:image/png;base64," + data; });
    const [a, b] = await Promise.all([load(${JSON.stringify(reference.toString("base64"))}), load(${JSON.stringify(current.toString("base64"))})]);
    if (a.width !== b.width || a.height !== b.height) return { size: [a.width, a.height, b.width, b.height] };
    const canvas = (image) => { const c = document.createElement("canvas"); c.width = image.width; c.height = image.height; const ctx = c.getContext("2d"); ctx.drawImage(image, 0, 0); return ctx; };
    const ca = canvas(a), cb = canvas(b);
    const da = ca.getImageData(0, 0, a.width, a.height), db = cb.getImageData(0, 0, b.width, b.height);
    const out = cb.createImageData(b.width, b.height);
    let different = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      const changed = Math.abs(da.data[i] - db.data[i]) > ${channelTolerance} || Math.abs(da.data[i + 1] - db.data[i + 1]) > ${channelTolerance} || Math.abs(da.data[i + 2] - db.data[i + 2]) > ${channelTolerance};
      if (changed) { different += 1; out.data[i] = 230; out.data[i + 1] = 30; out.data[i + 2] = 30; out.data[i + 3] = 255; }
      else { const grey = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 3; out.data[i] = out.data[i + 1] = out.data[i + 2] = 200 + grey / 10; out.data[i + 3] = 255; }
    }
    if (!different) return { different, total: a.width * a.height };
    cb.putImageData(out, 0, 0);
    return { different, map: cb.canvas.toDataURL("image/png").split(",")[1], total: a.width * a.height };
  })()`);
}

let created = 0;
for (const screen of screens) {
  for (const theme of screen.themes) {
    const name = `${screen.name}-${theme === "light" ? "claro" : "oscuro"}`;
    await page.theme(theme, { reducedMotion: true });
    await (screen.mobile ? page.viewport(390, 844, { dpr: 1, mobile: true }) : page.viewport(1280, 800));
    await page.goto(`${BASE}${screen.path}`);
    await page.waitFor(`!document.querySelector("[data-skeleton-status]")`, { timeout: 20000 }).catch(() => {});
    if (screen.ready) await page.waitFor(screen.ready, { timeout: 30000 }).catch(() => {});
    await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
    await page.eval(`(async () => { await document.fonts.ready; window.scrollTo(0, 0); document.activeElement?.blur?.(); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); return true; })()`);
    await page.send("Page.bringToFront");
    await page.sleep(900);
    const shot = Buffer.from((await page.send("Page.captureScreenshot", { format: "png" })).data, "base64");
    const reference = join(references, `${name}.png`);
    if (update || !existsSync(reference)) {
      const target = ci ? join(WORK, "visual-nuevas", process.platform, `${name}.png`) : reference;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, shot);
      created += 1;
      t.check(`${name}: referencia nueva${ci ? " (artefacto del CI)" : ""}`, true, target);
      continue;
    }
    const result = await diff(readFileSync(reference), shot);
    if (result.size) {
      writeFileSync(`${work}/${name}.png`, shot);
      t.check(`${name}: mismo tamaño que la referencia`, false, `referencia ${result.size[0]}×${result.size[1]}, ahora ${result.size[2]}×${result.size[3]}`);
      continue;
    }
    const ratio = result.different / result.total;
    if (ratio > maxDifferentRatio) {
      writeFileSync(`${work}/${name}.png`, shot);
      if (result.map) writeFileSync(`${work}/${name}-diferencias.png`, Buffer.from(result.map, "base64"));
    }
    t.check(`${name}: igual que la referencia`, ratio <= maxDifferentRatio, `${result.different} píxeles distintos (${(ratio * 100).toFixed(3)} %)`);
  }
}
if (created) console.log(`\n${created} referencias nuevas${ci ? `: en ${join(WORK, "visual-nuevas")} (artefacto del CI)` : ` en ${references}`}.`);

const errors = page.errors;
t.check("sin errores en la consola", errors.length === 0, errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
