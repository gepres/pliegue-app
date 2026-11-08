// 06.5 · Lector de pantalla: lo que oye quien usa NVDA, JAWS o VoiceOver sale del árbol de
// accesibilidad del navegador. Esta prueba lo lee con CDP (Accessibility.getFullAXTree) en las
// pantallas principales y comprueba:
// - el idioma (para que lo pronuncie en español), el título de la página y una sola región principal;
// - un solo encabezado de nivel 1 y sin saltos de nivel (de 2 a 4 sin 3);
// - que cada control (botón, enlace, campo, casilla, deslizador, pestaña, opción de menú) tiene
//   nombre, y que ninguna imagen se anuncia sin texto;
// - y lo que cambia: el aviso al importar llega a una región que se anuncia, el menú dice si está
//   abierto, el diálogo es modal y tiene nombre, y el avance del lector dice cuánto se ha leído.
//
// No sustituye a probarlo con un lector de pantalla de verdad (docs/lector-de-pantalla.md):
// comprueba que lo que el lector recibe está bien.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/lector-pantalla`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Lector de pantalla: árbol de accesibilidad (${BASE})`);
const browser = await openChrome({ port: 9413, profile: `${PROFILE_ROOT}-lector-pantalla` });
const page = await browser.newPage();
await page.viewport(1366, 900);
await page.send("Accessibility.enable");

writeFileSync(
  `${work}/Ficciones.epub`,
  zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf" /></rootfiles></container>`),
    "c.opf": strToU8(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Ficciones</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">es</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="a" /></spine></package>`),
    "a.xhtml": strToU8(`<html><body><h1>El jardín de senderos que se bifurcan</h1>${"<p>En la página 22 de la Historia de la Guerra Europea se lee que una ofensiva fue postergada.</p>".repeat(20)}</body></html>`),
  }),
);

const interactiveRoles = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "spinbutton", "listbox", "option"]);
const landmarkRoles = new Set(["main", "navigation", "banner", "contentinfo", "complementary", "search", "region", "form"]);

/** El árbol que recibe el lector de pantalla: sin los nodos que ignora. */
async function axTree() {
  const { nodes } = await page.send("Accessibility.getFullAXTree", {});
  return nodes
    .filter((node) => !node.ignored)
    .map((node) => ({
      name: String(node.name?.value ?? "").replace(/\s+/g, " ").trim(),
      props: Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value?.value])),
      role: node.role?.value ?? "",
    }));
}

async function settle(path) {
  await page.goto(`${BASE}${path}`);
  await page.waitFor(`!document.querySelector("[data-skeleton-status]")`, { timeout: 20000 }).catch(() => {});
  await page.sleep(1000);
  await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);
  await page.sleep(200);
}

// ---- Un libro en la Biblioteca: el aviso de la importación se anuncia ------------------------------------------------
await settle("/app/biblioteca");
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Ficciones.epub`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
const announced = await page.waitFor(
  `[...document.querySelectorAll("[role=status], [role=alert], [aria-live=polite], [aria-live=assertive], output")].some((region) => /importad/i.test(region.textContent))`,
  { timeout: 15000 },
).then(() => true, () => false);
t.check("el resultado de importar llega a una región que el lector anuncia", announced);
const id = await page.eval(`new URL(document.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")`);
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

// ---- Cada pantalla, como la recibe un lector de pantalla --------------------------------------------------------------
const screens = [
  ["Inicio", "/app"],
  ["Biblioteca", "/app/biblioteca"],
  ["Lector", `/app/lector?document=${id}`],
  ["IA", "/app/ia"],
  ["Ajustes", "/app/ajustes"],
  ["Fuentes", "/app/biblioteca/fuentes"],
];
const titles = new Set();
for (const [label, path] of screens) {
  await settle(path);
  if (label === "Lector") await page.waitFor(`[...document.querySelectorAll("p")].some((p) => /ofensiva fue postergada/.test(p.textContent))`, { timeout: 30000 }).catch(() => {});
  const nodes = await axTree();
  const lang = await page.eval(`document.documentElement.lang`);
  const title = await page.eval(`document.title`);
  titles.add(title);
  t.check(`${label}: en español y con título («${title}»)`, lang === "es" && title.trim().length > 3, `lang=${lang}`);

  const landmarks = nodes.filter((node) => landmarkRoles.has(node.role));
  const mains = landmarks.filter((node) => node.role === "main");
  // El lector es la pantalla de leer, sin el menú lateral: allí basta con poder volver.
  const navigable =
    label === "Lector"
      ? nodes.some((node) => node.role === "link" && /^Volver a /.test(node.name))
      : landmarks.some((node) => node.role === "navigation");
  t.check(
    `${label}: una región principal y ${label === "Lector" ? "un enlace para volver" : "navegación"}`,
    mains.length === 1 && navigable,
    landmarks.map((node) => `${node.role}${node.name ? `«${node.name}»` : ""}`).join(", "),
  );

  // En el orden del documento (el del árbol de CDP no lo es), y solo los que llegan al lector:
  // fuera los ocultos con display:none o aria-hidden (los «solo para lectores» sí cuentan).
  const headings = await page.eval(`[...document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")]
    .filter((h) => h.checkVisibility() && !h.closest("[aria-hidden=true], [inert]"))
    .map((h) => ({ level: Number(h.getAttribute("aria-level") ?? h.tagName.slice(1)), name: h.textContent.replace(/\\s+/g, " ").trim() }))`);
  const skips = headings.filter((heading, index) => index > 0 && heading.level > headings[index - 1].level + 1);
  t.check(
    `${label}: un solo nivel 1 y sin saltos de nivel`,
    headings.filter((heading) => heading.level === 1).length === 1 && skips.length === 0,
    headings.map((heading) => `h${heading.level} ${heading.name.slice(0, 28)}`).join(" · "),
  );

  const unnamed = nodes.filter((node) => interactiveRoles.has(node.role) && !node.name);
  t.check(`${label}: cada control tiene nombre (${nodes.filter((node) => interactiveRoles.has(node.role)).length})`, unnamed.length === 0, unnamed.map((node) => node.role).join(", "));
  const silentImages = nodes.filter((node) => (node.role === "image" || node.role === "img") && !node.name);
  t.check(`${label}: ninguna imagen sin texto`, silentImages.length === 0, `${silentImages.length} sin texto`);

  if (label === "Lector") {
    const sliders = nodes.filter((node) => node.role === "slider");
    t.check(
      "Lector: el avance de lectura dice qué es y cuánto va",
      sliders.length > 0 && sliders.every((node) => node.name && (node.props.valuetext || node.props.valuenow !== undefined)),
      sliders.map((node) => `«${node.name}» ${node.props.valuetext ?? node.props.valuenow}`).join(" · "),
    );
    t.check("Lector: el texto del libro llega al árbol", nodes.some((node) => node.role === "StaticText" && /ofensiva fue postergada/.test(node.name)) || nodes.some((node) => /ofensiva fue postergada/.test(node.name)));
  }
}
t.check("cada pantalla tiene su propio título", titles.size === screens.length, [...titles].join(" · "));

// ---- El menú de un libro y un diálogo ------------------------------------------------------------------------------------
await settle("/app/biblioteca");
const trigger = `document.querySelector("article[aria-label] button[aria-label^='Más acciones']")`;
await page.waitFor(trigger, { timeout: 20000 });
const menuButton = async () => (await axTree()).find((node) => node.role === "button" && node.name.startsWith("Más acciones"));
const closed = await menuButton();
t.check("el botón del menú dice que abre un menú y que está cerrado", Boolean(closed?.props.hasPopup) && closed.props.expanded === false, JSON.stringify(closed?.props));
await page.eval(`(${trigger}.click(), true)`);
await page.sleep(400);
const opened = await menuButton();
const items = (await axTree()).filter((node) => node.role === "menuitem");
t.check("al abrirlo dice que está abierto, y sus opciones se anuncian con nombre", opened?.props.expanded === true && items.length >= 3 && items.every((node) => node.name), `${items.length} opciones: ${items.map((node) => node.name).slice(0, 4).join(", ")}`);
await page.eval(`([...document.querySelectorAll("[role=menuitem]")].find((item) => item.getClientRects().length && /^Sensibilidad:/.test(item.textContent.trim())).click(), true)`);
await page.waitFor(`document.querySelector("dialog[open]")`, { timeout: 10000 }).catch(() => {});
await page.sleep(400);
const dialogs = (await axTree()).filter((node) => node.role === "dialog" || node.role === "alertdialog");
t.check("el diálogo se anuncia como diálogo modal y con nombre", dialogs.length === 1 && dialogs[0].name.length > 3 && dialogs[0].props.modal === true, dialogs.map((node) => `${node.role} «${node.name}» modal=${node.props.modal}`).join(" · "));
const radios = (await axTree()).filter((node) => node.role === "radio");
t.check("sus opciones son botones de opción con nombre, y una está marcada", radios.length >= 4 && radios.every((node) => node.name) && radios.filter((node) => node.props.checked === "true" || node.props.checked === true).length === 1, radios.map((node) => `${node.name}:${node.props.checked}`).join(" · "));
await page.screenshot(`${work}/1-dialogo.png`);

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
