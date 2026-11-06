// /design-system enseña los componentes que faltaban: esqueleto de carga, diálogo de
// confirmación, siguiente paso y piezas de página. Sin desborde en cuatro anchos, claro y oscuro.
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/catalogo-componentes`;
mkdirSync(work, { recursive: true });
const t = checker(`Componentes del catálogo (${BASE})`);
const browser = await openChrome({ port: 9400, profile: `${PROFILE_ROOT}-catalogo` });
const page = await browser.newPage();
await page.viewport(1440, 900);
await page.goto(`${BASE}/design-system`);
await page.waitFor(`[...document.querySelectorAll("h3")].some((h) => h.textContent === "Skeleton")`, { timeout: 20000 });
await page.sleep(1500);
const card = (title) => `[...document.querySelectorAll("h3")].find((h) => h.textContent === ${JSON.stringify(title)}).closest("[class*=componentDemo]")`;
const clickIn = (title, text) => page.eval(`([...(${card(title)}).querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click(), true)`);

for (const title of ["Skeleton", "Diálogo de confirmación", "Siguiente paso", "Cabecera, cifras y tarjetas de documento"]) {
  t.check(`el catálogo tiene «${title}»`, await page.eval(`Boolean(${card(title)})`));
}

// ---- Skeleton: cargando ↔ contenido ---------------------------------------------------------------
let state = await page.eval(`(() => { const c = ${card("Skeleton")}; return { drawings: c.querySelectorAll("[data-skeleton]").length, spoken: [...c.querySelectorAll("[data-skeleton-status]")].map((s) => s.textContent), page: Boolean(c.querySelector("[class*=page]")) }; })()`);
t.check("Skeleton: los esqueletos se ven y se anuncian", state.drawings >= 2 && state.spoken.includes("Comprobando la sesión") && state.page, JSON.stringify(state));
await page.eval(`(${card("Skeleton")}).scrollIntoView({ block: "start" }), true`);
await page.sleep(400);
await page.screenshot(`${work}/1-skeleton.png`);
await clickIn("Skeleton", "Ver con contenido");
await page.sleep(300);
state = await page.eval(`(() => { const c = ${card("Skeleton")}; return { drawings: c.querySelectorAll("[data-skeleton]").length, metric: [...c.querySelectorAll("strong")].map((s) => s.textContent).join(",") }; })()`);
t.check("Skeleton: «Ver con contenido» pone el contenido en su sitio", state.drawings === 0 && /3/.test(state.metric), JSON.stringify(state));

// ---- Diálogos de confirmación -------------------------------------------------------------------
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
await clickIn("Diálogo de confirmación", "Borrar (peligro)");
await page.waitFor(dialog, { timeout: 5000 });
const danger = await page.eval(`(() => { const d = ${dialog}; return { title: d.querySelector("h2").textContent, details: d.querySelectorAll("li").length }; })()`);
t.check("el diálogo de peligro se abre con su título y lo que se pierde", danger.title === "¿Borrar todo en este navegador?" && danger.details === 3, JSON.stringify(danger));
await page.screenshot(`${work}/2-confirmar.png`);
await page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancelar").click(), true)`);
await page.sleep(300);
t.check("Cancelar responde «Cancelado.»", (await page.eval(`(${card("Diálogo de confirmación")}).querySelector("[role=status]").textContent`)) === "Cancelado.");
await clickIn("Diálogo de confirmación", "Con una opción");
await page.waitFor(dialog, { timeout: 5000 });
await page.eval(`(() => { const d = ${dialog}; const input = d.querySelector("input[type=checkbox]"); input.click(); [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Desvincular").click(); return true; })()`);
await page.sleep(300);
t.check("con la opción encendida: «Desvinculado, con sus traducciones.»", (await page.eval(`(${card("Diálogo de confirmación")}).querySelector("[role=status]").textContent`)) === "Desvinculado, con sus traducciones.");

// ---- Siguiente paso -------------------------------------------------------------------------------
await clickIn("Siguiente paso", "Enseñar la sugerencia");
const next = await page.waitFor(`[...document.querySelectorAll("dialog[open]")].find((d) => /Listo\\. ¿Y ahora\\?/.test(d.textContent))`, { timeout: 5000 }).then(() => true, () => false);
const blocked = next ? await page.eval(`/Primero elige un proveedor/.test([...document.querySelectorAll("dialog[open]")].map((d) => d.textContent).join(" "))`) : false;
t.check("la sugerencia se abre, con la acción bloqueada y su motivo", next && blocked);
await page.screenshot(`${work}/3-siguiente.png`);
await page.key("Escape", { keyCode: 27 });
await page.sleep(300);

// ---- Piezas de página -------------------------------------------------------------------------------
const pieces = await page.eval(`(() => { const c = ${card("Cabecera, cifras y tarjetas de documento")}; return { header: c.querySelector("h1")?.textContent ?? "", doc: [...c.querySelectorAll("h3")].map((h) => h.textContent).includes("Ficciones"), skeleton: c.querySelectorAll("[data-skeleton]").length }; })()`);
t.check("cabecera, tarjeta de documento y su esqueleto", pieces.header === "Tu biblioteca de trabajo" && pieces.doc && pieces.skeleton === 1, JSON.stringify(pieces));

// ---- Anchos y temas -------------------------------------------------------------------------------------
for (const [width, theme] of [[1440, "light"], [1024, "dark"], [768, "light"], [390, "dark"]]) {
  await page.viewport(width, 900, { mobile: width < 500, dpr: width < 500 ? 2 : 1 });
  await page.theme(theme);
  await page.sleep(400);
  const overflow = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  t.check(`${width}px (${theme}): sin desborde de lado`, overflow <= 0, `${overflow}px`);
  await page.eval(`(${card("Skeleton")}).scrollIntoView({ block: "start" }), true`);
  await page.sleep(200);
  await page.screenshot(`${work}/4-${width}-${theme}.png`);
}

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
