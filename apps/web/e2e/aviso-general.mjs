// 03.13d: el aviso de la biblioteca general, en su demo de /design-system (la general exige un
// código de acceso de verdad). Sale la novedad más reciente con su fecha; «Ocultar» deja ver la
// invitación a usar Pliegue, que lleva a /app y a la portada; lo ocultado se recuerda al recargar
// y solo con los ids de muestra. En el móvil no desborda; claro y oscuro.
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/aviso-general`;
mkdirSync(work, { recursive: true });
const t = checker(`Aviso de la biblioteca general (${BASE})`);
const browser = await openChrome({ port: 9420, profile: `${PROFILE_ROOT}-aviso-general` });
const page = await browser.newPage();

const external = [];
await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  external.push(m.params.request.url);
  page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId: m.params.requestId }).catch(() => {});
});

const demo = `[...document.querySelectorAll("h3")].find((h) => h.textContent === "Aviso de la biblioteca general")?.closest("[class*=componentDemo]")`;
const aside = `(${demo})?.querySelector("aside")`;
const read = () =>
  page.eval(`(() => {
    const a = ${aside};
    if (!a) return null;
    return {
      kind: a.dataset.kind,
      labelled: document.getElementById(a.getAttribute("aria-labelledby"))?.textContent ?? "",
      links: [...a.querySelectorAll("a")].map((l) => [l.textContent.trim(), l.getAttribute("href")]),
      time: a.querySelector("time")?.textContent ?? null,
      title: a.querySelector("h2")?.textContent ?? "",
    };
  })()`);
async function open() {
  await page.goto(`${BASE}/design-system`);
  await page.waitFor(`Boolean(${demo})`, { timeout: 20000 });
  await page.sleep(600);
  await page.eval(`(${demo}).scrollIntoView({ block: "center" }), true`);
  await page.sleep(300);
}
const hideIt = () => page.click(`[class*=componentDemo] aside button[aria-label='Ocultar este aviso']`);

await page.viewport(1280, 900);
await open();
let notice = await read();
console.log("   ", JSON.stringify(notice));
t.check("sale la novedad más reciente, con su fecha", notice?.kind === "novedad" && notice.title === "Tres libros nuevos en la biblioteca" && notice.time === "12 de noviembre", JSON.stringify(notice));
t.check("la tarjeta se nombra por su título (aside con aria-labelledby)", notice?.labelled === notice?.title);
await page.screenshot(`${work}/1-novedad.png`);

await hideIt();
await page.sleep(300);
notice = await read();
t.check("«Ocultar» deja ver la invitación a usar Pliegue", notice?.kind === "pliegue" && notice.title === "Haz lo mismo con tus libros" && notice.time === null, JSON.stringify(notice));
t.check(
  "la invitación lleva a la app y a la portada",
  JSON.stringify(notice?.links) === JSON.stringify([["Empezar con mis libros", "/app"], ["Qué es Pliegue", "/"]]),
  JSON.stringify(notice?.links),
);
await page.screenshot(`${work}/2-invitacion.png`);

await open();
notice = await read();
t.check("al recargar, la novedad oculta sigue oculta", notice?.kind === "pliegue", JSON.stringify(notice));
await hideIt();
await page.sleep(300);
t.check("ocultas las dos, no queda tarjeta", (await read()) === null);
const stored = await page.eval(`localStorage.getItem("pliegue-general-avisos-ocultos")`);
t.check("se recuerdan solo los ids de muestra: la invitación de verdad no se toca", JSON.stringify(JSON.parse(stored ?? "[]").sort()) === JSON.stringify(["muestra-libros-nuevos", "muestra-pliegue-con-tus-libros"]), stored);

await page.eval(`([...(${demo}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Volver a mostrar los avisos").click(), true)`);
await page.sleep(300);
t.check("«Volver a mostrar» la devuelve", (await read())?.kind === "novedad");

// ---- Móvil, oscuro ---------------------------------------------------------------------------------
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.sleep(500);
await page.eval(`(${demo}).scrollIntoView({ block: "center" }), true`);
await page.sleep(300);
const fit = await page.eval(`(() => { const a = ${aside}; const r = a.getBoundingClientRect(); return { sw: a.scrollWidth, cw: a.clientWidth, right: Math.round(r.right), w: innerWidth }; })()`);
t.check("en el móvil la tarjeta no desborda", fit.sw <= fit.cw + 1 && fit.right <= fit.w, JSON.stringify(fit));
await page.screenshot(`${work}/3-movil.png`);
await page.theme("dark");
await page.sleep(300);
await page.screenshot(`${work}/4-movil-oscuro.png`);
await page.viewport(1280, 900);
await page.sleep(400);
await page.eval(`(${demo}).scrollIntoView({ block: "center" }), true`);
await page.sleep(300);
await page.screenshot(`${work}/5-oscuro.png`);
await page.theme("light");

t.check("ninguna petición fuera", external.length === 0, external.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
