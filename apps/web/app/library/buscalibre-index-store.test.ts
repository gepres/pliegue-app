// @vitest-environment node
import "fake-indexeddb/auto";

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../cloud/supabase-client", () => ({
  cloudClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "sesion-admin" } } }) } }),
}));

const { buildBuscalibreIndex, currentBuscalibreIndex, lookupBuscalibrePrice } = await import("./buscalibre-index-store");

const memory = new Map<string, string>();
const calls: { authorization: string | null; url: string }[] = [];
/** Lo que responde el servidor de Pliegue a cada ruta; se cambia en cada prueba. */
let routes: Record<string, () => Response> = {};

beforeAll(() => {
  vi.stubGlobal("window", { indexedDB: globalThis.indexedDB });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    removeItem: (key: string) => memory.delete(key),
    setItem: (key: string, value: string) => memory.set(key, value),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ authorization: new Headers(init.headers).get("authorization"), url });
      const route = routes[url];
      return route ? route() : Response.json({ error: "No existe." }, { status: 404 });
    }),
  );
});

const part = (entries: string[]) => () => Response.json({ count: entries.length, entries: entries.join("\n"), part: 0 });

describe("el índice de Buscalibre del admin, en su navegador (06.2b)", () => {
  it("se arma parte a parte con la sesión, reintenta una parte que falla y queda listo", async () => {
    let failures = 1;
    routes = {
      "/api/buscalibre/indice?pais=pe": () => Response.json({ parts: [0, 1] }),
      "/api/buscalibre/indice?pais=pe&parte=0": () => (failures-- > 0 ? Response.json({ error: "Buscalibre no respondió." }, { status: 502 }) : part(["9788425432026 47056974", "9786287638662 62893033"])()),
      "/api/buscalibre/indice?pais=pe&parte=1": part(["9788408285298 55892993"]),
    };
    await buildBuscalibreIndex("pe");
    const state = currentBuscalibreIndex();
    expect(state).toMatchObject({ meta: { entries: 3, parts: 2 }, status: "ready" });
    expect(calls.map((call) => call.url)).toEqual([
      "/api/buscalibre/indice?pais=pe",
      "/api/buscalibre/indice?pais=pe&parte=0",
      "/api/buscalibre/indice?pais=pe&parte=0",
      "/api/buscalibre/indice?pais=pe&parte=1",
    ]);
    expect(calls.every((call) => call.authorization === "Bearer sesion-admin")).toBe(true);
  });

  it("el precio: busca el producto en el índice, lo pide una vez y lo recuerda 24 horas", async () => {
    calls.length = 0;
    let asked = 0;
    routes = {
      "/api/buscalibre/precio?pais=pe&isbn=9788425432026&id=47056974": () => {
        asked += 1;
        return Response.json({ availability: "in-stock", currency: "PEN", fetchedAt: "2026-11-08T17:00:00.000Z", found: true, price: 52, title: "El Hombre En Busca de Sentido", url: "https://www.buscalibre.pe/libro-el-hombre-en-busca-de-sentido/9788425432026/p/47056974" });
      },
    };
    const now = () => new Date("2026-11-08T18:00:00Z");
    // Con el ISBN-10 de la ficha: se pasa a ISBN-13.
    const first = await lookupBuscalibrePrice("pe", "84-254-3202-6", { now });
    expect(first).toMatchObject({ price: 52, status: "found", url: expect.stringContaining("/p/47056974") });
    expect(await lookupBuscalibrePrice("pe", "9788425432026", { now })).toEqual(first);
    expect(asked).toBe(1);
    await lookupBuscalibrePrice("pe", "9788425432026", { now: () => new Date("2026-11-09T18:00:01Z") });
    expect(asked).toBe(2);
  });

  it("un ISBN que no está en la lista no se pregunta a nadie; sin precio en el país, «no se vende»", async () => {
    calls.length = 0;
    expect(await lookupBuscalibrePrice("pe", "9780306406157")).toEqual({ status: "not-in-catalog" });
    expect(calls).toHaveLength(0);
    routes = { "/api/buscalibre/precio?pais=mx&isbn=9786287638662&id=62893033": () => Response.json({ fetchedAt: "2026-11-08T17:00:00.000Z", found: false }) };
    expect(await lookupBuscalibrePrice("mx", "9786287638662")).toEqual({ fetchedAt: "2026-11-08T17:00:00.000Z", status: "not-sold" });
  });

  it("si una parte falla dos veces, lo dice y la lista anterior sigue sirviendo", async () => {
    routes = {
      "/api/buscalibre/indice?pais=pe": () => Response.json({ parts: [0, 1] }),
      "/api/buscalibre/indice?pais=pe&parte=0": part(["9780306406157 1"]),
      "/api/buscalibre/indice?pais=pe&parte=1": () => Response.json({ error: "Buscalibre no respondió. Inténtalo dentro de un rato." }, { status: 502 }),
    };
    await buildBuscalibreIndex("pe");
    expect(currentBuscalibreIndex()).toMatchObject({ message: "Buscalibre no respondió. Inténtalo dentro de un rato.", meta: { entries: 3 }, status: "error" });
    // La lista nueva no se guardó: el ISBN de la parte 0 nueva no está, y el de antes sí.
    expect(await lookupBuscalibrePrice("pe", "9780306406157")).toEqual({ status: "not-in-catalog" });
    routes = { "/api/buscalibre/precio?pais=co&isbn=9788408285298&id=55892993": () => Response.json({ fetchedAt: "2026-11-08T17:00:00.000Z", found: false }) };
    expect(await lookupBuscalibrePrice("co", "9788408285298")).toMatchObject({ status: "not-sold" });
  });
});
