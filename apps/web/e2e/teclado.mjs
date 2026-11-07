// 06.5 · Teclado: la app se usa sin ratón.
// - «Saltar al contenido» es lo primero que se alcanza y lleva al contenido.
// - Cada parada del tabulador se ve: con el foco puesto tiene contorno o sombra, y está a la vista.
// - El menú de un libro se abre con Intro, se recorre con las flechas y Escape lo cierra
//   devolviendo el foco al botón.
// - Un diálogo retiene el foco mientras está abierto y, al cerrarse con Escape, lo devuelve.
// - Al lector se entra con Intro.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/teclado`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Teclado (${BASE})`);
const browser = await openChrome({ port: 9406, profile: `${PROFILE_ROOT}-teclado` });
const page = await browser.newPage();
await page.viewport(1366, 900);

writeFileSync(
  `${work}/Ficciones.epub`,
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Ficciones</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body><h1>Ficciones</h1><p>El jardín de senderos que se bifurcan.</p></body></html>`),
  }),
);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Ficciones.epub`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

const tab = (shift = false) =>
  page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }).then(() =>
    page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }),
  );
// Intro lleva su carácter («\r»): sin él, Chrome no activa un <button> (un enlace, sí).
const press = (key, code = key, keyCode) => page.key(key, { code, keyCode, ...(key === "Enter" ? { text: "\r" } : {}) });
const active = () =>
  page.eval(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
    const rect = el.getBoundingClientRect();
    const ring = (s) => (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
    // El anillo puede estar en quien lo envuelve (\`:focus-within\`): contorno o sombra exterior,
    // no la sombra interior que el contenedor lleva siempre.
    const outerRing = (node) => {
      if (!node) return false;
      const s = getComputedStyle(node);
      return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && !s.boxShadow.includes("inset"));
    };
    return {
      label: (el.getAttribute("aria-label") || el.labels?.[0]?.textContent || el.textContent || el.getAttribute("placeholder") || el.getAttribute("title") || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 50),
      type: el.getAttribute("type"),
      styles: { outline: style.outlineStyle + " " + style.outlineWidth, shadow: style.boxShadow, border: style.borderColor },
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      ring: Boolean(ring(style) || ring(after) || (el.parentElement?.matches(":focus-within") && (outerRing(el.parentElement) || outerRing(el.parentElement.parentElement)))),
      visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
      inMain: Boolean(el.closest("#workspace-content")),
      inDialog: Boolean(el.closest("dialog[open]")),
    };
  })()`);

// ---- Saltar al contenido ---------------------------------------------------------------------------------------
await page.goto(`${BASE}/app`);
await page.waitFor(`document.querySelector(".skip-link")`, { timeout: 20000 });
await page.sleep(800);
await tab();
let focus = await active();
t.check("lo primero que alcanza el tabulador es «Saltar al contenido», y se ve", focus?.label === "Saltar al contenido" && focus.visible, JSON.stringify(focus));
await press("Enter", "Enter", 13);
await page.sleep(300);
await tab();
focus = await active();
t.check("con Intro, el siguiente Tab ya está en el contenido", focus?.inMain === true, JSON.stringify(focus));

// ---- Cada parada del tabulador se ve -------------------------------------------------------------------------------
const audit = async (path, stops) => {
  await page.goto(`${BASE}${path}`);
  await page.sleep(1200);
  const seen = [];
  for (let index = 0; index < stops; index += 1) {
    await tab();
    await page.sleep(60);
    const current = await active();
    if (!current) continue;
    seen.push(current);
  }
  return seen;
};
for (const [path, stops] of [["/app/biblioteca", 30], ["/app/ia", 25], ["/app/ajustes", 25]]) {
  const seen = await audit(path, stops);
  const hidden = seen.filter((stop) => !stop.visible);
  const noRing = seen.filter((stop) => !stop.ring);
  t.check(`${path}: ${seen.length} paradas, todas a la vista`, seen.length >= 8 && hidden.length === 0, hidden.map((s) => `${s.tag}:${s.label}`).slice(0, 4).join(" | "));
  t.check(`${path}: todas con indicador de foco`, noRing.length === 0, noRing.map((s) => `${s.tag}[${s.type}]:${s.label} ${JSON.stringify(s.styles)}`).slice(0, 4).join(" | "));
}

// ---- El menú de un libro ---------------------------------------------------------------------------------------------
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("article[aria-label] button[aria-label^='Más acciones']")`, { timeout: 20000 });
await page.sleep(600);
const trigger = `document.querySelector("article[aria-label] button[aria-label^='Más acciones']")`;
await page.eval(`(${trigger}.focus(), true)`);
await press("Enter", "Enter", 13);
await page.sleep(300);
focus = await active();
t.check("Intro abre el menú y el foco va a su primera opción", focus?.role === "menuitem", JSON.stringify(focus));
const first = focus?.label;
await press("ArrowDown", "ArrowDown", 40);
await page.sleep(100);
focus = await active();
t.check("la flecha abajo pasa a la siguiente opción", focus?.role === "menuitem" && focus.label !== first, `${first} → ${focus?.label}`);
await press("Escape", "Escape", 27);
await page.sleep(300);
t.check("Escape cierra el menú y devuelve el foco al botón", await page.eval(`document.activeElement === ${trigger}`), JSON.stringify(await active()));

// ---- Un diálogo: retiene el foco y lo devuelve -------------------------------------------------------------------------
await press("Enter", "Enter", 13);
await page.sleep(300);
for (let index = 0; index < 12; index += 1) {
  focus = await active();
  if (/^Sensibilidad:/.test(focus?.label ?? "")) break;
  await press("ArrowDown", "ArrowDown", 40);
  await page.sleep(60);
}
t.check("con las flechas se llega a «Sensibilidad: …»", /^Sensibilidad:/.test(focus?.label ?? ""), focus?.label);
await press("Enter", "Enter", 13);
await page.waitFor(`document.querySelector("dialog[open] input[name=sensitivity]")`, { timeout: 10000 }).catch(() => {});
await page.sleep(300);
focus = await active();
t.check("se abre el diálogo con el foco dentro", focus?.inDialog === true, JSON.stringify(focus));
// El resto de la página queda inerte: el foco recorre el diálogo y, como mucho, pasa por la
// interfaz del navegador (activeElement vacío). Nunca a algo de la página que está detrás.
let escaped = 0;
let inside = 0;
for (let index = 0; index < 14; index += 1) {
  await tab();
  await page.sleep(40);
  const current = await active();
  if (current?.inDialog) inside += 1;
  else if (current) escaped += 1;
}
t.check("el Tab no sale del diálogo a la página de detrás", escaped === 0 && inside >= 6, `${inside} dentro, ${escaped} fuera`);
await page.screenshot(`${work}/1-dialogo.png`);
await press("Escape", "Escape", 27);
await page.sleep(400);
t.check("Escape lo cierra", !(await page.eval(`Boolean(document.querySelector("dialog[open] input[name=sensitivity]"))`)));
focus = await active();
t.check("y el foco vuelve al botón del libro, no se pierde", await page.eval(`document.activeElement === ${trigger}`), JSON.stringify(focus));

// ---- Al lector, con Intro ----------------------------------------------------------------------------------------------
await page.eval(`(document.querySelector("article[aria-label] a[href*='/app/lector?document=']").focus(), true)`);
await press("Enter", "Enter", 13);
const opened = await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /senderos que se bifurcan/.test(p.textContent))`, { timeout: 30000 }).then(() => true, () => false);
t.check("Intro sobre el libro lo abre en el lector", opened);
const readerStops = [];
for (let index = 0; index < 10; index += 1) {
  await tab();
  await page.sleep(60);
  const current = await active();
  if (current) readerStops.push(current);
}
t.check("en el lector, el tabulador recorre sus botones, a la vista y con indicador", readerStops.length >= 4 && readerStops.every((s) => s.visible && s.ring), readerStops.filter((s) => !s.visible || !s.ring).map((s) => `${s.tag}:${s.label}`).join(" | "));

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
