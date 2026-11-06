// El pie del menú lateral con la sesión iniciada: un correo largo no se mete debajo del botón
// de plegar; se corta con «…» y entero va en el title. Sesión de prueba; Supabase simulado.
import { mkdirSync } from "node:fs";
import { openChrome, checker, WORK, PROFILE_ROOT } from "./lib/cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const work = `${WORK}/nav-correo`;
mkdirSync(work, { recursive: true });
const t = checker(`Pie del menú con un correo largo (${BASE})`);
const browser = await openChrome({ port: 9382, profile: `${PROFILE_ROOT}-nav-correo` });
const page = await browser.newPage();
await page.viewport(1366, 820);
const email = "una.direccion.de.correo.muy.larga.de.verdad@gmail.com";
const userId = "11111111-2222-3333-4444-555555555555";

await page.send("Fetch.enable", { patterns: [{ urlPattern: "*supabase.co/*" }] });
browser.on(async (m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
  const { requestId, request } = m.params;
  const body = request.url.includes("/auth/v1/user") ? { email, id: userId } : request.url.includes("/rpc/") ? false : [];
  return page.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: request.method === "OPTIONS" ? 204 : 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "*" }],
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  }).catch(() => {});
});

const footer = () =>
  page.eval(`(() => {
    const link = document.querySelector("a[href='/app/ajustes#cuenta'][title]");
    const toggle = document.querySelector("button[aria-controls='workspace-navigation']");
    if (!link || !toggle) return null;
    const smalls = [...link.querySelectorAll("small")];
    const l = link.getBoundingClientRect();
    const b = toggle.getBoundingClientRect();
    return {
      texts: smalls.map((s) => s.textContent),
      title: link.getAttribute("title"),
      overlap: Math.round(l.right - b.left),
      clipped: smalls.map((s) => s.scrollWidth > s.clientWidth),
      ellipsis: smalls.map((s) => getComputedStyle(s).textOverflow),
      rightEdges: smalls.map((s) => Math.round(s.getBoundingClientRect().right)),
      toggleLeft: Math.round(b.left),
    };
  })()`);

// Sin sesión: «Local · este dispositivo», como antes.
await page.goto(`${BASE}/app`);
await page.waitFor(`document.querySelector("a[href='/app/ajustes#cuenta'][title]")`, { timeout: 30000 });
await page.sleep(500);
const local = await footer();
t.check("sin sesión: «Local · este dispositivo», sin cortes", local.texts.join("|") === "Local · este dispositivo" && !local.clipped.some(Boolean), JSON.stringify(local));

// Con sesión y un correo largo.
const now = Math.floor(Date.now() / 1000);
const session = { access_token: "x", expires_at: now + 3600, expires_in: 3600, refresh_token: "y", token_type: "bearer", user: { app_metadata: { provider: "google" }, aud: "authenticated", email, id: userId, role: "authenticated", user_metadata: {} } };
await page.eval(`(localStorage.setItem("pliegue-auth", ${JSON.stringify(JSON.stringify(session))}), localStorage.setItem("pliegue-cloud-sync-v1", ${JSON.stringify(JSON.stringify({ [userId]: { catalogAi: true, enabled: true } }))}), true)`);
await page.goto(`${BASE}/app?v=1`);
await page.waitFor(`[...document.querySelectorAll("a[href='/app/ajustes#cuenta'][title] small")].some((s) => s.textContent === "Sincronizada")`, { timeout: 30000 });
await page.sleep(500);
const synced = await footer();
t.check("con sesión: «Sincronizada» y el correo en su propio renglón", synced.texts[0] === "Sincronizada" && synced.texts[1] === email, JSON.stringify(synced.texts));
t.check("el correo no se mete debajo del botón de plegar", synced.overlap <= 0 && synced.rightEdges.every((right) => right <= synced.toggleLeft), JSON.stringify({ overlap: synced.overlap, rightEdges: synced.rightEdges, toggleLeft: synced.toggleLeft }));
t.check("lo que no cabe se corta con «…»", synced.clipped[1] === true && synced.ellipsis[1] === "ellipsis", JSON.stringify(synced));
t.check("y el correo entero está en el title del enlace", synced.title === `Sincronizada con ${email}`, synced.title);
await page.eval(`(document.querySelector("a[href='/app/ajustes#cuenta'][title]").scrollIntoView({ block: "end" }), true)`);
await page.screenshot(`${work}/claro.png`);
await page.theme("dark");
await page.sleep(400);
await page.screenshot(`${work}/oscuro.png`);
t.check("sin errores de consola", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
const { failed } = t.summary();
await browser.close();
process.exit(failed.length ? 1 : 0);
