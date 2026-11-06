// 02.2b: los tokens nuevos resuelven a los mismos valores que los literales que sustituyen
// (estilos calculados), y la sección «Controles de la app» del catálogo funciona: menú, panel,
// hojas, aviso, iconos. Claro y oscuro, móvil, sin desborde ni errores.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/tokens-catalogo`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Tokens y app-ui en el catálogo (${BASE})`);
const browser = await openChrome({ port: 9392, profile: `${PROFILE_ROOT}-tokens` });
const page = await browser.newPage();
await page.viewport(1366, 900);

// ---- Los tokens resuelven ------------------------------------------------------------------------
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
const expected = {
  "--pliegue-color-scrim": "rgb(15 14 12 / 38%)",
  "--pliegue-color-scrim-strong": "rgb(15 14 12 / 42%)",
  "--pliegue-elevation-sheet": "-24px 0 60px rgb(0 0 0 / 14%)",
  "--pliegue-elevation-toast": "0 12px 32px rgb(0 0 0 / 22%)",
  "--pliegue-elevation-dialog": "0 24px 64px rgb(15 14 12 / 28%)",
  "--pliegue-elevation-cover": "0 1px 2px rgb(0 0 0 / 12%), 0 10px 24px -12px rgb(0 0 0 / 40%)",
  "--pliegue-cover-plain-text": "#9a6f22",
  "--pliegue-page-ink": "#1d1b18",
};
for (const theme of ["light", "dark"]) {
  await page.theme(theme);
  await page.sleep(200);
  // El minificador reescribe los colores (rgb(15 14 12 / 38%) → #0f0e0c61): se compara lo que
  // calcula el navegador al aplicar el token y el literal de antes al mismo elemento.
  const wrong = await page.eval(`(() => {
    const probe = document.createElement("div");
    document.body.append(probe);
    const computed = (value, shadow) => { probe.style.boxShadow = shadow ? value : ""; probe.style.backgroundColor = shadow ? "" : value; const c = getComputedStyle(probe); return shadow ? c.boxShadow : c.backgroundColor; };
    const out = [];
    for (const [name, literal] of Object.entries(${JSON.stringify(expected)})) {
      const shadow = name.includes("elevation");
      const viaToken = computed("var(" + name + ")", shadow);
      const viaLiteral = computed(literal, shadow);
      if (viaToken !== viaLiteral || viaToken === "none" || viaToken === "rgba(0, 0, 0, 0)") out.push(name + ": " + viaToken + " ≠ " + viaLiteral);
    }
    probe.remove();
    return out;
  })()`);
  t.check(`(${theme}) los tokens nuevos valen lo mismo que los literales de antes`, wrong.length === 0, wrong.join(" · ") || `${Object.keys(expected).length} tokens`);
}
await page.theme("light");

// Una portada generada (un .txt) toma su color y su sombra de los tokens.
writeFileSync(`${work}/Notas.txt`, "Unas notas de prueba para la portada generada.\n".repeat(20));
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Notas.txt`]);
await page.waitFor(`document.querySelector("[data-format='txt']")`, { timeout: 30000 });
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
const cover = await page.eval(`(() => { const c = getComputedStyle(document.querySelector("[data-format='txt']")); return { bg: c.backgroundColor, shadow: c.boxShadow, color: c.color }; })()`);
t.check("la portada de un .txt sale con su color ocre (#9a6f22)", cover.bg === "rgb(154, 111, 34)", cover.bg);
t.check("y con su sombra (no «none»)", cover.shadow !== "none" && /rgba\(0, 0, 0, 0\.4\)/.test(cover.shadow), cover.shadow);
t.check("y el texto encima, blanco al 92 %", cover.color === "rgba(255, 255, 255, 0.92)", cover.color);

// ---- El catálogo -----------------------------------------------------------------------------------
await page.goto(`${BASE}/design-system`);
await page.waitFor(`document.querySelector("#app-ui-title")`, { timeout: 20000 });
t.check("el catálogo tiene la sección «Controles de la app»", await page.eval(`/app-ui/.test(document.querySelector("#app-ui-title").textContent)`));
const icons = await page.eval(`document.querySelectorAll("ul[aria-label='Iconos de la app'] li").length`);
t.check("enseña todos los iconos", icons >= 50, `${icons} iconos`);
const elevations = await page.eval(`[...document.querySelectorAll("code")].map((c) => c.textContent).filter((x) => x.startsWith("elevation/"))`);
t.check("las elevaciones nuevas están en su muestra", ["elevation/sheet", "elevation/dialog", "elevation/cover"].every((name) => elevations.includes(name)), elevations.join(", "));

// Menú: se abre, se elige, se cierra.
await page.eval(`document.querySelector("#app-ui-title").scrollIntoView(), true`);
await page.click("text=Menú");
await page.waitFor(`[...document.querySelectorAll("[role=menu]")].some((m) => !m.hidden)`);
await page.screenshot(`${work}/1-menu.png`);
await page.eval(`([...document.querySelectorAll("[role=menuitem]")].find((b) => b.textContent.includes("Marcar como favorito")).click(), true)`);
await page.sleep(300);
t.check("el menú elige y se cierra", (await page.eval(`[...document.querySelectorAll("[role=status]")].some((s) => s.textContent === "Marcar como favorito")`)) && (await page.eval(`[...document.querySelectorAll("[role=menu]")].every((m) => m.hidden)`)));

// Hoja modal: entra con su sombra de token y su velo.
await page.click("text=Abrir hoja modal");
await page.waitFor(`[...document.querySelectorAll("aside[role=dialog]")].some((a) => a.dataset.open === "true")`);
await page.sleep(700);
const sheet = await page.eval(`(() => { const a = [...document.querySelectorAll("aside[role=dialog]")].find((x) => x.dataset.open === "true"); const s = getComputedStyle(a); const scrim = getComputedStyle(a.previousElementSibling); return { shadow: s.boxShadow, scrim: scrim.backgroundColor }; })()`);
t.check("la hoja sale con su sombra y su velo de token", /rgba\(0, 0, 0, 0\.14\) -24px 0px 60px/.test(sheet.shadow) && sheet.scrim === "rgba(15, 14, 12, 0.38)", JSON.stringify(sheet));
await page.screenshot(`${work}/2-hoja.png`);
await page.key("Escape", { keyCode: 27 });
await page.sleep(400);
t.check("Escape cierra la hoja", await page.eval(`![...document.querySelectorAll("aside[role=dialog]")].some((a) => a.dataset.open === "true")`));

// Aviso.
await page.click("text=Enseñar un aviso");
await page.waitFor(`[...document.querySelectorAll("[role=status]")].some((s) => /3 importados/.test(s.textContent))`, { timeout: 5000 }).catch(() => {});
const toast = await page.eval(`(() => { const s = [...document.querySelectorAll("*")].find((x) => x.children.length <= 2 && /^3 importados\\./.test(x.textContent.trim()) && getComputedStyle(x).boxShadow !== "none"); return s ? getComputedStyle(s).boxShadow : "sin aviso"; })()`);
t.check("el aviso sale con su sombra de token", /rgba\(0, 0, 0, 0\.22\) 0px 12px 32px/.test(toast), toast);

// Claro, oscuro y móvil, sin desborde.
for (const [theme, width] of [["light", 1366], ["dark", 1366], ["dark", 390]]) {
  await page.theme(theme);
  await page.viewport(width, width === 390 ? 844 : 900, { mobile: width === 390, dpr: width === 390 ? 2 : 1 });
  await page.sleep(400);
  const overflow = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  t.check(`catálogo (${theme}, ${width}px): sin desborde de lado`, overflow <= 0, `${overflow}px`);
  await page.eval(`document.querySelector("#app-ui-title").scrollIntoView(), true`);
  await page.sleep(200);
  await page.screenshot(`${work}/3-${theme}-${width}.png`);
}

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
