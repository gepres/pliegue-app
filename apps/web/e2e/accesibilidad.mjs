// 06.5 · Accesibilidad (WCAG 2.2 AA) con axe-core en las pantallas principales, en claro y en
// oscuro. Falla con problemas graves o críticos; los moderados y menores salen como aviso.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/accesibilidad`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const t = checker(`Accesibilidad con axe-core (${BASE})`);
const browser = await openChrome({ port: 9401, profile: `${PROFILE_ROOT}-accesibilidad` });
const page = await browser.newPage();

// Un libro, para que la Biblioteca y el lector tengan contenido.
await page.viewport(900, 1200);
await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ensayo</title></head><body><h1>Ensayo</h1><p style="font:15px/1.5 Georgia">${"La memoria y el lenguaje del tiempo. ".repeat(150)}</p></body></html>`)}`);
writeFileSync(`${work}/Ensayo.pdf`, Buffer.from((await page.send("Page.printToPDF", {})).data, "base64"));
await page.viewport(1366, 900);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Ensayo.pdf`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
const id = await page.eval(`new URL(document.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")`);
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

const screens = [
  ["Portada", "/"],
  ["Inicio", "/app"],
  ["Biblioteca", "/app/biblioteca"],
  ["Lector (inicio)", "/app/lector"],
  ["Lector (libro)", `/app/lector?document=${id}`],
  ["IA", "/app/ia"],
  ["Ajustes", "/app/ajustes"],
  ["Fuentes", "/app/biblioteca/fuentes"],
  ["Catálogo", "/design-system"],
];
const warnings = new Map();

for (const theme of ["light", "dark"]) {
  // Con «menos movimiento», cada pantalla está en reposo. Si no, lo que entra al desplazarse (los
  // capítulos y la tarjeta de la portada, al 15 % de opacidad hasta llegar a ellos) se mediría a
  // medio aparecer, y ese contraste no es el que se lee.
  await page.theme(theme, { reducedMotion: true });
  for (const [name, path] of screens) {
    await page.goto(`${BASE}${path}${path.includes("?") ? "&" : "?"}a11y=${theme}`);
    // Que acaben de cargar (esqueletos fuera) y se apaguen las animaciones de entrada.
    await page.waitFor(`!document.querySelector("[data-skeleton-status]")`, { timeout: 20000 }).catch(() => {});
    await page.sleep(1200);
    await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
    const result = await page.eval(`(async () => {
      if (!window.axe) { ${axeSource}\n }
      const { violations } = await window.axe.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }));
    })()`);
    const serious = result.filter((v) => v.impact === "serious" || v.impact === "critical");
    const label = `${name} (${theme === "light" ? "claro" : "oscuro"})`;
    t.check(`${label}: sin problemas graves`, serious.length === 0, serious.map((v) => `${v.id} ×${v.nodes} [${v.target}]`).join(" · ") || "0 graves");
    for (const v of result.filter((x) => !serious.includes(x))) warnings.set(`${v.id} · ${label}`, `${v.impact} ×${v.nodes} [${v.target}]`);
  }
}

if (warnings.size) {
  console.log("\nAvisos (moderados o menores, no hacen fallar):");
  for (const [key, value] of warnings) console.log(`  · ${key}: ${value}`);
}
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
