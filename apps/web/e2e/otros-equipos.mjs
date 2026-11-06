// 06.3 · Ajustes → Cuenta nombra los libros que están en otros equipos y no en este: por su ficha
// sincronizada, en orden alfabético; los que no tienen ficha solo se cuentan. Sin permiso para
// las fichas en este equipo, solo el recuento. Sesión de prueba; Supabase simulado con CDP.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/otros-equipos`;
mkdirSync(work, { recursive: true });
const t = checker(`Libros en tus otros equipos (${BASE})`);
const browser = await openChrome({ port: 9383, profile: `${PROFILE_ROOT}-otros-equipos` });
const page = await browser.newPage();
await page.viewport(1280, 900);
const email = "lectora.de.prueba@example.com";
const userId = "11111111-2222-3333-4444-555555555555";

// Cuatro libros de otro equipo, por la huella de su archivo; tres con ficha.
const key = (name) => createHash("sha256").update(`file:${name}:1000`).digest("hex");
const at = "2026-11-06T12:00:00.000Z";
const row = (collection, item_key, payload) => ({ collection, deleted: false, item_key, payload, server_updated_at: at, updated_at: at });
const ficha = (title, authors) => ({ analyzedAt: at, catalog: { authors, canonicalTitle: title, confidence: 0.9, genres: [], language: "es", publicationYear: null, summary: null, topics: [], workType: "book" }, error: null, model: "m", provider: "ollama", schemaVersion: 1, status: "ready" });
const rows = [
  row("favorites", key("ficciones.pdf"), { favorite: true }),
  row("catalog-ai", key("ficciones.pdf"), ficha("Ficciones", ["Jorge Luis Borges"])),
  row("catalog-ai", key("pedro paramo.pdf"), ficha("Pedro Páramo", ["Juan Rulfo"])),
  row("catalog-ai", key("aura.epub"), ficha("Aura", ["Carlos Fuentes"])),
  row("favorites", key("sin ficha.pdf"), { favorite: true }),
];

const external = [];
let pulls = 0;
await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  if (!/supabase\.co\//.test(request.url)) {
    external.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  const pull = request.method === "GET" && request.url.includes("/rest/v1/sync_items");
  if (pull) pulls += 1;
  const body = request.url.includes("/auth/v1/user") ? { email, id: userId } : request.url.includes("/rpc/") ? false : pull ? rows : [];
  return page.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: request.method === "OPTIONS" ? 204 : 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }],
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  }).catch(() => {});
});

const now = Math.floor(Date.now() / 1000);
const session = { access_token: "x", expires_at: now + 3600, expires_in: 3600, refresh_token: "y", token_type: "bearer", user: { app_metadata: { provider: "google" }, aud: "authenticated", email, id: userId, role: "authenticated", user_metadata: {} } };
// Se escribe desde una página del mismo origen sin la app (el manifiesto): con la app abierta,
// su propio estado podría volver a escribir las elecciones justo después.
const signIn = async (catalogAi) => {
  await page.goto(`${BASE}/manifest.webmanifest`);
  await page.eval(`(localStorage.setItem("pliegue-auth", ${JSON.stringify(JSON.stringify(session))}), localStorage.setItem("pliegue-cloud-sync-v1", ${JSON.stringify(JSON.stringify({ [userId]: { catalogAi, enabled: true } }))}), true)`);
};
const block = () =>
  page.eval(`(() => {
    const section = document.querySelector("section[aria-labelledby='sync-elsewhere-title']");
    if (!section) return null;
    return {
      heading: section.querySelector("h3")?.textContent,
      line: section.querySelector("p")?.textContent.replace(/\\s+/g, " ").trim(),
      books: [...section.querySelectorAll("li")].map((li) => ({ title: li.querySelector("cite")?.textContent, authors: li.querySelector("small")?.textContent ?? "" })),
      notes: [...section.querySelectorAll("p")].slice(1).map((p) => p.textContent.replace(/\\s+/g, " ").trim()),
    };
  })()`);

// ---- Con las fichas aceptadas: tres por su título y uno contado -------------------------------
await signIn(true);
await page.goto(`${BASE}/app/ajustes?v=1#cuenta`);
await page.waitFor(`document.querySelector("section[aria-labelledby='sync-elsewhere-title']")`, { timeout: 30000 });
let shown = await block();
console.log("    bloque:", JSON.stringify(shown));
t.check("aparece «En tus otros equipos»", shown?.heading === "En tus otros equipos", shown?.heading);
t.check("cuenta los cuatro libros que no están aquí", /^4 libros tienen avance, notas, favorito o ficha en tu cuenta y no están en este equipo\.$/.test(shown.line), shown.line);
t.check("nombra los tres con ficha, en orden alfabético", shown.books.map((b) => b.title).join(" · ") === "Aura · Ficciones · Pedro Páramo", shown.books.map((b) => b.title).join(" · "));
t.check("con sus autores debajo", shown.books.map((b) => b.authors).join(" · ") === "Carlos Fuentes · Jorge Luis Borges · Juan Rulfo", shown.books.map((b) => b.authors).join(" · "));
t.check("el que no tiene ficha se cuenta, sin inventarle título", shown.notes[0] === "Y 1 más. 1 sin título: no tiene ficha en tu cuenta.", shown.notes[0]);
t.check("explica cómo recuperar lo suyo aquí", /mismo archivo \(mismo nombre y tamaño\)/.test(shown.notes.at(-1)), shown.notes.at(-1));
t.check("se calculó con lo descargado de la cuenta (simulada)", pulls > 0, `${pulls} descargas`);
await page.eval(`(document.querySelector("section[aria-labelledby='sync-elsewhere-title']").scrollIntoView({ block: "center" }), true)`);
await page.screenshot(`${work}/1-con-fichas.png`);

// ---- Sin permiso para las fichas en este equipo: solo el recuento ------------------------------
await signIn(false);
await page.goto(`${BASE}/app/ajustes?v=2#cuenta`);
await page.waitFor(`document.querySelector("section[aria-labelledby='sync-elsewhere-title']")`, { timeout: 30000 });
shown = await block();
t.check("sin fichas aceptadas aquí, no nombra ninguno", shown.books.length === 0, JSON.stringify(shown.books));
t.check("pero sigue contando los cuatro", /^4 libros tienen/.test(shown.line), shown.line);
t.check("y dice por qué no hay títulos", /no aceptaste las fichas hechas por la IA/.test(shown.notes[0] ?? ""), shown.notes[0]);
await page.screenshot(`${work}/2-sin-fichas.png`);

// ---- Oscuro y móvil: sin desborde --------------------------------------------------------------
await signIn(true);
await page.theme("dark");
await page.viewport(390, 844, { mobile: true });
await page.goto(`${BASE}/app/ajustes?v=3#cuenta`);
await page.waitFor(`document.querySelector("section[aria-labelledby='sync-elsewhere-title'] li")`, { timeout: 30000 });
const overflow = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
t.check("en el móvil, sin desborde de lado", overflow <= 0, `${overflow}px`);
await page.eval(`(document.querySelector("section[aria-labelledby='sync-elsewhere-title']").scrollIntoView({ block: "center" }), true)`);
await page.screenshot(`${work}/3-movil-oscuro.png`);

t.check("nada sale fuera de Supabase simulado", external.length === 0, external.slice(0, 3).join(" · "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
