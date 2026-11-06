// 03.6: juntar este equipo con la cuenta vuelve a pedir permiso (al empezar y al reanudar), y
// encender «Fichas hechas por la IA» con la sincronización en marcha también pregunta.
// Sesión de prueba; Supabase simulado con CDP; nada fuera.
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/consentimiento-sync`;
mkdirSync(work, { recursive: true });
const t = checker(`Consentimiento al juntar este equipo con la cuenta (${BASE})`);
const browser = await openChrome({ port: 9389, profile: `${PROFILE_ROOT}-consentimiento` });
const page = await browser.newPage();
await page.viewport(1366, 900);
const email = "lectora.de.prueba@example.com";
const userId = "11111111-2222-3333-4444-555555555555";

const external = [];
let supabaseCalls = 0;
await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
browser.on((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  if (!/supabase\.co\//.test(request.url)) {
    external.push(request.url);
    return page.send("Fetch.failRequest", { errorReason: "BlockedByClient", requestId }).catch(() => {});
  }
  supabaseCalls += 1;
  const body = request.url.includes("/auth/v1/user") ? { email, id: userId } : request.url.includes("/rpc/") ? false : [];
  return page.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: request.method === "OPTIONS" ? 204 : 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }],
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  }).catch(() => {});
});

// Sesión de prueba, sin sincronizar todavía.
await page.goto(`${BASE}/app`);
const now = Math.floor(Date.now() / 1000);
const session = { access_token: "x", expires_at: now + 3600, expires_in: 3600, refresh_token: "y", token_type: "bearer", user: { app_metadata: { provider: "google" }, aud: "authenticated", email, id: userId, role: "authenticated", user_metadata: {} } };
await page.eval(`(localStorage.setItem("pliegue-auth", ${JSON.stringify(JSON.stringify(session))}), localStorage.removeItem("pliegue-cloud-sync-v1"), true)`);
await page.goto(`${BASE}/app/ajustes?v=1#cuenta`);

const choices = () => page.eval(`JSON.parse(localStorage.getItem("pliegue-cloud-sync-v1") ?? "{}")[${JSON.stringify(userId)}] ?? {}`);
const button = (text) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && b.getClientRects().length)`;
const dialog = `document.querySelector("dialog[open][role=alertdialog]")`;
const readDialog = () =>
  page.eval(`(() => { const d = ${dialog}; if (!d) return null; return { title: d.querySelector("h2")?.textContent, text: d.textContent.replace(/\\s+/g, " "), details: [...d.querySelectorAll("li")].map((li) => li.textContent.trim()), buttons: [...d.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean) }; })()`);
const dialogButton = (text) => page.eval(`([...(${dialog}).querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click(), true)`);
const aiSwitch = `(() => { const label = [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Fichas hechas por la IA")); return label?.querySelector("input") ?? document.getElementById(label?.htmlFor); })()`;
const clickSwitch = () => page.eval(`(${aiSwitch}.click(), true)`);

await page.waitFor(button("Empezar a sincronizar"), { timeout: 30000 });

// ---- Empezar: aviso con lo que se junta; Cancelar no sincroniza ------------------------------
await page.eval(`(${button("Empezar a sincronizar")}.click(), true)`);
await page.waitFor(dialog);
let shown = await readDialog();
console.log("    aviso:", shown.title, "·", shown.details.join(" | "));
t.check("«Empezar a sincronizar» pregunta antes de juntar", shown?.title === "¿Juntar este equipo con tu cuenta?", shown?.title);
t.check("dice qué se junta, renglón a renglón", shown.details.includes("Favoritos y progreso de lectura") && shown.details.includes("Resaltados, notas y recortes"), shown.details.join(" | "));
t.check("con las fichas de la IA, porque están encendidas", shown.details.some((d) => d.startsWith("Fichas hechas por la IA")));
t.check("dice lo que nunca sube y cómo volver a separarlos", /Nunca se suben tus archivos/.test(shown.text) && /pausa la sincronización en este equipo/.test(shown.text));
await page.screenshot(`${work}/1-aviso.png`);
const cancelLabel = shown.buttons.find((b) => b !== "Juntar y sincronizar");
await dialogButton(cancelLabel);
await page.sleep(400);
t.check(`«${cancelLabel}» no empieza a sincronizar`, (await choices()).enabled !== true && Boolean(await page.eval(`Boolean(${button("Empezar a sincronizar")})`)), JSON.stringify(await choices()));

// ---- Apagar la IA antes de empezar: no pregunta; y el aviso ya no la nombra --------------------
await clickSwitch();
await page.sleep(300);
t.check("apagar «Fichas hechas por la IA» no pregunta", !(await page.eval(`Boolean(${dialog})`)) && (await choices()).catalogAi === false);
await page.eval(`(${button("Empezar a sincronizar")}.click(), true)`);
await page.waitFor(dialog);
shown = await readDialog();
t.check("sin la IA, el aviso no la incluye", !shown.details.some((d) => d.startsWith("Fichas hechas por la IA")), shown.details.join(" | "));
await dialogButton("Juntar y sincronizar");
await page.waitFor(button("Pausar la sincronización en este equipo"), { timeout: 10000 });
t.check("«Juntar y sincronizar» la empieza", (await choices()).enabled === true);

// ---- Con la sincronización en marcha, encender la IA pregunta --------------------------------
await clickSwitch();
await page.waitFor(dialog);
shown = await readDialog();
t.check("encender la IA mientras se sincroniza pregunta", shown?.title === "¿Sincronizar también las fichas de la IA?", shown?.title);
await dialogButton(shown.buttons.find((b) => b !== "Subir las fichas de la IA"));
await page.sleep(300);
t.check("cancelar la deja apagada (también el interruptor)", (await choices()).catalogAi === false && (await page.eval(`${aiSwitch}.checked`)) === false);
await clickSwitch();
await page.waitFor(dialog);
await dialogButton("Subir las fichas de la IA");
await page.sleep(300);
t.check("aceptar la enciende", (await choices()).catalogAi === true && (await page.eval(`${aiSwitch}.checked`)) === true);
await clickSwitch();
await page.sleep(300);
t.check("apagarla no pregunta", !(await page.eval(`Boolean(${dialog})`)) && (await choices()).catalogAi === false);

// ---- Pausar y reanudar: el permiso se pide otra vez ------------------------------------------
await page.eval(`(${button("Pausar la sincronización en este equipo")}.click(), true)`);
await page.waitFor(button("Empezar a sincronizar"), { timeout: 10000 });
t.check("pausar separa este equipo de la cuenta", (await choices()).enabled === false);
await page.eval(`(${button("Empezar a sincronizar")}.click(), true)`);
await page.waitFor(dialog);
t.check("reanudar vuelve a pedir permiso", (await readDialog())?.title === "¿Juntar este equipo con tu cuenta?");

// ---- Móvil, oscuro -----------------------------------------------------------------------------
await page.viewport(390, 844, { mobile: true, dpr: 2 });
await page.theme("dark");
await page.sleep(500);
const fits = await page.eval(`(() => { const r = (${dialog}).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: innerWidth }; })()`);
t.check("en el móvil el aviso cabe de lado a lado", fits.left >= 0 && fits.right <= fits.w, JSON.stringify(fits));
await page.screenshot(`${work}/2-movil-oscuro.png`);

t.check("Supabase simulado (ninguna cuenta real)", supabaseCalls > 0, `${supabaseCalls} peticiones simuladas`);
t.check("ninguna otra petición fuera", external.length === 0, external.slice(0, 3).join(" "));
t.check("sin errores en la consola", page.errors.length === 0, page.errors.slice(0, 3).join(" · "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
