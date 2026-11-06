// Arnés de las e2e (06.5): Chrome sin ventana por CDP, con un perfil temporal que se borra al
// terminar. Sin Playwright ni Puppeteer: el WebSocket de Node basta. Nada toca cuentas reales:
// cada prueba simula con CDP lo que saldría fuera (Supabase, proveedores de IA, traductores).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Chrome: `CHROME_PATH`, o donde suele estar en Windows, macOS y Linux (el de GitHub Actions). */
const CHROME =
  process.env.CHROME_PATH ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ].find((path) => existsSync(path)) ??
  "google-chrome";

/** Donde cada prueba deja sus archivos (libros generados, capturas): fuera del repositorio. */
export const WORK = process.env.E2E_WORK ?? join(tmpdir(), "pliegue-e2e");
/** Raíz de los perfiles temporales de Chrome; cada prueba usa el suyo y lo borra. */
export const PROFILE_ROOT = join(tmpdir(), "pl-e2e");

export async function openChrome({ port = 9344, profile, windowSize = "1440,900" } = {}) {
  if (!profile || !profile.includes("pl-e2e")) throw new Error("perfil temporal obligatorio (debe contener pl-e2e)");
  if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new",
    // En CI (Linux, sin usuario con sandbox) Chrome necesita esto para arrancar.
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    `--window-size=${windowSize}`,
    "about:blank",
  ], { stdio: "ignore" });
  // Hasta 30 s: el primer Chrome de un runner de CI en frío tarda más que los 15 s de antes.
  let version;
  let exited = null;
  proc.once("exit", (code) => { exited = code; });
  for (let i = 0; i < 120 && exited === null; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); }
  }
  if (!version) throw new Error(exited === null ? "Chrome no arrancó en 30 s" : `Chrome se cerró al arrancar (código ${exited})`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, ko } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) ko(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
      else ok(msg.result);
    } else if (msg.method) for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, ko) => {
    const msgId = ++id;
    pending.set(msgId, { ok, ko });
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  });
  const browser = {
    send,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    async newPage() {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      return makePage(browser, sessionId, targetId);
    },
    async close() {
      try { await send("Browser.close"); } catch {}
      ws.close();
      await sleep(800);
      try { proc.kill(); } catch {}
      await sleep(400);
      rmSync(profile, { recursive: true, force: true });
    },
  };
  return browser;
}

async function makePage(browser, sessionId, targetId) {
  const s = (method, params) => browser.send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  const errors = [];
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const page = {
    targetId, sessionId, send: s, errors,
    async eval(expression) {
      const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url, { wait = "load", timeout = 30000 } = {}) {
      const loaded = new Promise((ok) => {
        const off = browser.on((msg) => { if (msg.sessionId === sessionId && msg.method === (wait === "load" ? "Page.loadEventFired" : "Page.domContentEventFired")) { off(); ok(); } });
        setTimeout(() => { off(); ok(); }, timeout);
      });
      await s("Page.navigate", { url });
      await loaded;
    },
    async waitFor(expression, { timeout = 15000, interval = 150 } = {}) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { const v = await page.eval(`(() => { const v = (${expression}); return v instanceof Node ? true : v; })()`); if (v) return v; } catch {}
        await sleep(interval);
      }
      throw new Error(`timeout esperando: ${expression.slice(0, 120)}`);
    },
    async viewport(width, height, { mobile = false, dpr = 1, touch = mobile } = {}) {
      await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
      await s("Emulation.setTouchEmulationEnabled", touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    },
    /** Tema del sistema; `reducedMotion` pide además «menos movimiento» (las animaciones, quietas). */
    async theme(scheme, { reducedMotion = false } = {}) {
      const features = [{ name: "prefers-color-scheme", value: scheme }];
      if (reducedMotion) features.push({ name: "prefers-reduced-motion", value: "reduce" });
      await s("Emulation.setEmulatedMedia", { features });
    },
    async screenshot(path, { full = false } = {}) {
      const r = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    async setFiles(selector, files) {
      const { root } = await s("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await s("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`no hay ${selector}`);
      // La ruta con los separadores del sistema: «\\» en Windows, «/» en Linux (el CI).
      await s("DOM.setFileInputFiles", { files: files.map((file) => resolve(file)), nodeId });
    },
    async clickAt(x, y) {
      for (const type of ["mousePressed", "mouseReleased"]) await s("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    },
    async click(selectorOrText) {
      const box = await page.eval(`(() => {
        const q = ${JSON.stringify(selectorOrText)};
        let el = q.startsWith("text=") ? [...document.querySelectorAll("button,a,[role=menuitem],[role=tab],[role=option],label,summary")].find((e) => e.textContent.trim().replace(/\\s+/g, " ").includes(q.slice(5)) && e.getClientRects().length) : document.querySelector(q);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!box) throw new Error(`no encuentro ${selectorOrText}`);
      await page.clickAt(box.x, box.y);
    },
    async key(key, { code = key, keyCode, text } = {}) {
      await s("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, text });
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },
    sleep,
  };
  return page;
}

export function checker(title) {
  const results = [];
  return {
    check(name, ok, detail = "") { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); },
    summary() {
      const passed = results.filter((r) => r.ok).length;
      console.log(`\n${title}: ${passed} de ${results.length}`);
      return { passed, total: results.length, failed: results.filter((r) => !r.ok) };
    },
  };
}

