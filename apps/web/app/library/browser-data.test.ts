import { describe, expect, it } from "vitest";

import { inventoryBrowserData, inventorySize, knownDatabases, wipeBrowserData, type BrowserDataEnv } from "./browser-data";

function storage(initial: Record<string, string>) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
    removeItem: (key: string) => void items.delete(key),
  };
}

/** Un navegador con lo de Pliegue y lo de otra app en el mismo origen. */
function browser({ listable = true, stuck = [] as string[] } = {}) {
  const databases = new Set(["pliegue-annotations", "pliegue-translations", "otra-app"]);
  const cacheNames = new Set(["pliegue-paginas-2026-09-30", "workbox-otra"]);
  const files = new Set(["copia-1.pdf", "copia-2.epub"]);
  const local = storage({ "pliegue-auth": "sesión", "pliegue-preferences-v1": "{}", "tema-de-otra-app": "oscuro" });
  const session = storage({ "pliegue-aviso": "1" });
  const env: BrowserDataEnv = {
    caches: {
      delete: async (name) => cacheNames.delete(name),
      keys: async () => [...cacheNames],
    },
    deleteDatabase: async (name) => {
      if (stuck.includes(name)) return "blocked";
      databases.delete(name);
      return "deleted";
    },
    listDatabases: listable ? async () => [...databases] : undefined,
    localStorage: local,
    opfs: async () => ({
      async *keys() {
        yield* [...files];
      },
      removeEntry: async (name) => void files.delete(name),
    }),
    sessionStorage: session,
  };
  return { cacheNames, databases, env, files, local, session };
}

describe("borrar lo de Pliegue en este navegador", () => {
  it("lista solo lo de Pliegue", async () => {
    const { env } = browser();
    const inventory = await inventoryBrowserData(env);
    expect(inventory).toEqual({
      caches: ["pliegue-paginas-2026-09-30"],
      databases: ["pliegue-annotations", "pliegue-translations"],
      databasesListed: true,
      files: ["copia-1.pdf", "copia-2.epub"],
      keys: ["pliegue-auth", "pliegue-aviso", "pliegue-preferences-v1"],
    });
    expect(inventorySize(inventory)).toBe(8);
  });

  it("lo borra todo, deja lo ajeno y lo comprueba al volver a mirar", async () => {
    const world = browser();
    const result = await wipeBrowserData(world.env);
    expect(inventorySize(result.removed)).toBe(8);
    expect(inventorySize(result.remaining)).toBe(0);
    expect(result.blocked).toEqual([]);
    expect([...world.databases]).toEqual(["otra-app"]);
    expect([...world.cacheNames]).toEqual(["workbox-otra"]);
    expect([...world.local.items.keys()]).toEqual(["tema-de-otra-app"]);
    expect(world.session.items.size).toBe(0);
    expect(world.files.size).toBe(0);
  });

  it("si otra pestaña tiene una base abierta, lo dice", async () => {
    const result = await wipeBrowserData(browser({ stuck: ["pliegue-annotations"] }).env);
    expect(result.blocked).toEqual(["pliegue-annotations"]);
    expect(result.remaining.databases).toEqual(["pliegue-annotations"]);
  });

  it("sin `databases()`, borra las conocidas y no inventa restos", async () => {
    const world = browser({ listable: false });
    const result = await wipeBrowserData(world.env);
    expect(result.removed.databases).toEqual([...knownDatabases]);
    expect(result.remaining.databases).toEqual([]);
    expect([...world.databases]).toEqual(["otra-app"]);
  });

  it("fuera del navegador no falla", async () => {
    expect(inventorySize((await wipeBrowserData({})).remaining)).toBe(0);
  });
});
