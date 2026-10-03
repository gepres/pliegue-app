import { describe, expect, it } from "vitest";

import { protectStorage, readStorageState, type StorageManagerLike } from "./storage-protection";

function fakeStorage(overrides: Partial<StorageManagerLike> = {}): StorageManagerLike {
  return {
    estimate: async () => ({
      quota: 20_000_000_000,
      usage: 250_000_000,
      usageDetails: { caches: 4_000_000, fileSystem: 40_000_000, indexedDB: 200_000_000, serviceWorkerRegistrations: 1_000_000 },
    }),
    persist: async () => true,
    persisted: async () => false,
    ...overrides,
  };
}

describe("datos de Pliegue en el navegador", () => {
  it("lee lo ocupado, lo disponible, el desglose y si están protegidos", async () => {
    expect(await readStorageState(fakeStorage())).toEqual({
      breakdown: { appFiles: 5_000_000, databases: 200_000_000, files: 40_000_000 },
      persisted: false,
      quota: 20_000_000_000,
      supported: true,
      usage: 250_000_000,
    });
  });

  it("sin desglose ni respuesta sobre la protección, lo dice sin fallar", async () => {
    const state = await readStorageState(
      fakeStorage({ estimate: async () => ({ quota: 100, usage: 10 }), persisted: async () => Promise.reject(new Error("no")) }),
    );
    expect(state).toMatchObject({ breakdown: null, persisted: null, quota: 100, usage: 10 });
  });

  it("un navegador sin StorageManager no rompe nada", async () => {
    expect(await readStorageState(undefined)).toMatchObject({ supported: false });
    expect(await protectStorage(undefined)).toBe(false);
  });

  it("pedir la protección devuelve lo que concede el navegador", async () => {
    expect(await protectStorage(fakeStorage({ persist: async () => true }))).toBe(true);
    expect(await protectStorage(fakeStorage({ persist: async () => false }))).toBe(false);
    expect(await protectStorage(fakeStorage({ persist: async () => Promise.reject(new Error("x")) }))).toBe(false);
  });
});
