// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { buscalibreUserAgent } from "./buscalibre-prices";
import { handleBuscalibreIndex, handleBuscalibrePrice, type BuscalibreServerDeps } from "./buscalibre-server";

const config = { secretKey: "sb_secret_prueba", sessionSecret: "s", supabaseUrl: "https://db.example" };
const adminId = "11111111-2222-3333-4444-555555555555";
const readerId = "66666666-7777-8888-9999-000000000000";

const productHtml = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": ["Product", "Book"],
  isbn: "9788425432026",
  name: "El Hombre En Busca de Sentido",
  offers: { availability: "http://schema.org/InStock", price: "52.00", priceCurrency: "PEN" },
})}</script></head></html>`;

/** Supabase y Buscalibre de mentira. `token`: «admin», «lectora» o cualquier otro (caducado). */
function world({ buscalibre = "ok" as "down" | "missing" | "ok" | "unsold", admins = "ok" as "down" | "ok" } = {}) {
  const calls: { headers: Headers; url: string }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    calls.push({ headers, url });
    if (url === `${config.supabaseUrl}/auth/v1/user`) {
      const token = headers.get("authorization")?.replace("Bearer ", "");
      if (token === "admin") return Response.json({ email: "dueno@example.com", id: adminId });
      if (token === "lectora") return Response.json({ email: "lectora@example.com", id: readerId });
      return Response.json({ msg: "invalid JWT" }, { status: 401 });
    }
    if (url.startsWith(`${config.supabaseUrl}/rest/v1/pliegue_admins`)) {
      if (admins === "down") return new Response("", { status: 500 });
      return Response.json(url.includes(adminId) ? [{ user_id: adminId }] : []);
    }
    if (buscalibre === "down") throw new TypeError("fetch failed");
    if (url.endsWith("/sitemaps/productos.xml")) {
      return new Response(`<sitemapindex><sitemap><loc>https://www.buscalibre.cl/sitemaps/productos_0.xml</loc></sitemap><sitemap><loc>https://www.buscalibre.cl/sitemaps/productos_1.xml</loc></sitemap></sitemapindex>`);
    }
    if (url.endsWith("/sitemaps/productos_1.xml")) {
      return new Response(`<urlset><url><loc>https://www.buscalibre.cl/libro-el-hombre-en-busca-de-sentido/9788425432026/p/47056974</loc></url><url><loc>https://www.buscalibre.cl/batidora_p_1.html</loc></url></urlset>`);
    }
    if (url.includes("/p/47056974")) {
      if (buscalibre === "missing") return new Response("", { status: 404 });
      const response = new Response(buscalibre === "unsold" ? "<html></html>" : productHtml);
      Object.defineProperty(response, "url", { value: "https://www.buscalibre.cl/libro-el-hombre-en-busca-de-sentido/9788425432026/p/47056974" });
      return response;
    }
    return new Response("", { status: 404 });
  });
  const deps: BuscalibreServerDeps = { config, fetcher: fetcher as unknown as typeof fetch, now: () => new Date("2026-11-08T17:00:00Z") };
  const buscalibreCalls = () => calls.filter((call) => call.url.includes("buscalibre"));
  return { buscalibreCalls, calls, deps };
}

const get = (path: string, { origin, token = "admin" }: { origin?: string; token?: string | null } = {}) =>
  new Request(`http://localhost${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) } });

describe("rutas de Buscalibre: solo el admin (06.2b)", () => {
  it("sin sesión, 401; con una sesión que no es admin, 403; y Buscalibre no se entera", async () => {
    const { buscalibreCalls, deps } = world();
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe", { token: null }), deps)).status).toBe(401);
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe", { token: "caducado" }), deps)).status).toBe(401);
    const forbidden = await handleBuscalibrePrice(get("/api/buscalibre/precio?pais=pe&isbn=9788425432026&id=47056974", { token: "lectora" }), deps);
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: string }).error).toMatch(/solo los ve el admin/);
    expect(buscalibreCalls()).toHaveLength(0);
  });

  it("si no se puede comprobar la cuenta, 503; si falta la configuración, también", async () => {
    const { deps } = world({ admins: "down" });
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe"), deps)).status).toBe(503);
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe"), { config: null })).status).toBe(503);
  });

  it("desde otra web, 403; con un país que no es de Buscalibre o datos raros, 400", async () => {
    const { deps } = world();
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe", { origin: "https://otra.example" }), deps)).status).toBe(403);
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=es"), deps)).status).toBe(400);
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe&parte=abc"), deps)).status).toBe(400);
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe&parte=999"), deps)).status).toBe(400);
    expect((await handleBuscalibrePrice(get("/api/buscalibre/precio?pais=pe&isbn=123&id=47056974"), deps)).status).toBe(400);
    expect((await handleBuscalibrePrice(get("/api/buscalibre/precio?pais=pe&isbn=9788425432026&id=../x"), deps)).status).toBe(400);
  });
});

describe("rutas de Buscalibre: lo que se pide y lo que se devuelve", () => {
  it("el índice: las partes del sitemap y, por parte, los pares ISBN-producto", async () => {
    const { buscalibreCalls, deps } = world();
    const index = await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=cl"), deps);
    expect(await index.json()).toEqual({ parts: [0, 1] });
    const part = await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=cl&parte=1"), deps);
    expect(part.headers.get("cache-control")).toBe("private, no-store");
    expect(await part.json()).toEqual({ count: 1, entries: "9788425432026 47056974", part: 1 });
    expect(buscalibreCalls().map((call) => call.url)).toEqual(["https://www.buscalibre.cl/sitemaps/productos.xml", "https://www.buscalibre.cl/sitemaps/productos_1.xml"]);
  });

  it("el precio: de la ficha del país, con la fecha y el enlace a la ficha buena", async () => {
    const { buscalibreCalls, deps } = world();
    const response = await handleBuscalibrePrice(get("/api/buscalibre/precio?pais=cl&isbn=9788425432026&id=47056974"), deps);
    expect(await response.json()).toEqual({
      availability: "in-stock",
      currency: "PEN",
      fetchedAt: "2026-11-08T17:00:00.000Z",
      found: true,
      isbn: "9788425432026",
      price: 52,
      title: "El Hombre En Busca de Sentido",
      url: "https://www.buscalibre.cl/libro-el-hombre-en-busca-de-sentido/9788425432026/p/47056974",
    });
    expect(buscalibreCalls().map((call) => call.url)).toEqual(["https://www.buscalibre.cl/libro-pliegue/9788425432026/p/47056974"]);
  });

  it("a Buscalibre: nunca una URL con «?», con un nombre honesto y sin la sesión de nadie", async () => {
    const { buscalibreCalls, deps } = world();
    await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe"), deps);
    await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe&parte=1"), deps);
    await handleBuscalibrePrice(get("/api/buscalibre/precio?pais=pe&isbn=9788425432026&id=47056974"), deps);
    expect(buscalibreCalls()).toHaveLength(3);
    for (const call of buscalibreCalls()) {
      expect(call.url).not.toContain("?");
      expect(call.headers.get("user-agent")).toBe(buscalibreUserAgent);
      expect(call.headers.get("authorization")).toBeNull();
      expect(call.headers.get("apikey")).toBeNull();
    }
  });

  it("sin ficha o sin precio en ese país: found false; si Buscalibre no responde, 502", async () => {
    for (const buscalibre of ["missing", "unsold"] as const) {
      const { deps } = world({ buscalibre });
      expect(await (await handleBuscalibrePrice(get("/api/buscalibre/precio?pais=mx&isbn=9788425432026&id=47056974"), deps)).json()).toEqual({ fetchedAt: "2026-11-08T17:00:00.000Z", found: false });
    }
    const { deps } = world({ buscalibre: "down" });
    expect((await handleBuscalibrePrice(get("/api/buscalibre/precio?pais=pe&isbn=9788425432026&id=47056974"), deps)).status).toBe(502);
    expect((await handleBuscalibreIndex(get("/api/buscalibre/indice?pais=pe"), deps)).status).toBe(502);
  });
});
