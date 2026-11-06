// Esqueletos de carga: con la apertura de IndexedDB retrasada 2,5 s (así se ven), cada pantalla
// enseña su esqueleto, que se anuncia con role="status", y luego lo cambia por el contenido.
// Sin desborde de lado, en claro y en oscuro, sin errores de consola.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/esqueletos`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const t = checker(`Esqueletos de carga (${BASE})`);
const browser = await openChrome({ port: 9390, profile: `${PROFILE_ROOT}-esqueletos` });
const page = await browser.newPage();

// Un libro, para que haya biblioteca que recuperar.
await page.viewport(900, 1200);
await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>Ensayo</title></head><body><h1>Ensayo</h1><p style="font:15px/1.5 Georgia">${"El tiempo y la memoria del lenguaje. ".repeat(200)}</p></body></html>`)}`);
writeFileSync(`${work}/Ensayo.pdf`, Buffer.from((await page.send("Page.printToPDF", {})).data, "base64"));
await page.viewport(1366, 900);
await page.goto(`${BASE}/app/biblioteca`);
await page.waitFor(`document.querySelector("input[aria-label='Seleccionar archivos para importar']")`);
await page.setFiles("input[aria-label='Seleccionar archivos para importar']", [`${work}/Ensayo.pdf`]);
await page.waitFor(`document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1`, { timeout: 60000 });
const documentId = await page.eval(`new URL(document.querySelector("a[href*='/app/lector?document=']").href).searchParams.get("document")`);
await page.sleep(600);
await page.eval(`([...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Ahora no")?.click(), true)`);

// Desde aquí, cada apertura de IndexedDB tarda 2,5 s en responder.
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const DELAY = 2500;
    const proto = IDBOpenDBRequest.prototype;
    const add = EventTarget.prototype.addEventListener;
    proto.addEventListener = function (type, listener, options) {
      if (type === "success" && typeof listener === "function") {
        const request = this, original = listener;
        listener = (event) => setTimeout(() => original.call(request, event), DELAY);
      }
      return add.call(this, type, listener, options);
    };
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess");
    Object.defineProperty(proto, "onsuccess", {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(fn) { const request = this; descriptor.set.call(this, typeof fn === "function" ? (event) => setTimeout(() => fn.call(request, event), DELAY) : fn); },
    });
  })();`,
});

// Lo que oye el lector de pantalla: el aviso con su texto, aparte del dibujo (que va oculto).
const busy = () => page.eval(`[...document.querySelectorAll("[data-skeleton-status][role=status]")].map((el) => el.textContent)`);
const overflow = () => page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const screens = [
  { path: "/app", name: "inicio", expect: "Recuperando tus documentos", content: `[...document.querySelectorAll("strong")].some((s) => s.closest("[class*=metricCard]") && s.textContent.trim() === "1")` },
  { path: "/app/biblioteca", name: "biblioteca", expect: "Cargando documentos", content: `document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1 && /1 documento ·/.test(document.querySelector("header h1 + p")?.textContent ?? "")` },
  { path: "/app/lector", name: "lector", expect: "Recuperando tu Biblioteca", content: `document.querySelectorAll("a[href*='/app/lector?document=']").length >= 1` },
  { path: "/app/ia", name: "ia", expect: "Cargando las fichas", content: `![...document.querySelectorAll("[data-skeleton-status]")].some((el) => el.textContent === "Cargando las fichas") && [...document.querySelectorAll("section[aria-label='Estado del catálogo'] strong")].some((s) => s.textContent.trim() === "1")` },
  { path: `/app/lector?document=${documentId}`, name: "abrir", expect: /Preparando el (lector|documento)/, content: `!document.querySelector("[data-skeleton-status]") && document.querySelector("[role=document]")` },
];

for (const theme of ["light", "dark"]) {
  await page.theme(theme);
  for (const screen of screens) {
    await page.goto(`${BASE}${screen.path}${screen.path.includes("?") ? "&" : "?"}t=${theme}`, { wait: "domcontent" });
    await page.sleep(900);
    const labels = await busy();
    if (screen.name === "biblioteca" && theme === "light") {
      const header = await page.eval(`document.querySelector("header h1 + p")?.textContent ?? ""`);
      t.check("biblioteca: la cabecera no dice «0 documentos» mientras carga", !/0 documentos/.test(header), header);
    }
    const shown = labels.some((label) => (screen.expect instanceof RegExp ? screen.expect.test(label ?? "") : label === screen.expect));
    if (theme === "light") t.check(`${screen.name}: enseña su esqueleto mientras carga`, shown, labels.join(" | ") || "ninguno");
    if (theme === "light") t.check(`${screen.name}: el dibujo del esqueleto va oculto al lector de pantalla`, await page.eval(`[...document.querySelectorAll("[data-skeleton]")].every((el) => el.getAttribute("aria-hidden") === "true")`));
    await page.screenshot(`${work}/${screen.name}-${theme}.png`);
    const settled = await page.waitFor(screen.content, { timeout: 15000 }).then(() => true, () => false);
    const left = await busy();
    if (theme === "light") t.check(`${screen.name}: luego llega el contenido y el esqueleto se va`, settled && !left.some((label) => label === screen.expect), left.join(" | ") || "sin esqueletos");
    const extra = await overflow();
    t.check(`${screen.name} (${theme}): sin desborde de lado`, extra <= 0, `${extra}px`);
  }
}

// En el móvil, la Biblioteca y el lector.
await page.theme("light");
await page.viewport(390, 844, { mobile: true, dpr: 2 });
for (const screen of [screens[1], screens[4]]) {
  await page.goto(`${BASE}${screen.path}${screen.path.includes("?") ? "&" : "?"}m=1`, { wait: "domcontent" });
  await page.sleep(900);
  t.check(`móvil · ${screen.name}: sin desborde mientras carga`, (await overflow()) <= 0, `${await overflow()}px`);
  await page.screenshot(`${work}/movil-${screen.name}.png`);
}

t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
