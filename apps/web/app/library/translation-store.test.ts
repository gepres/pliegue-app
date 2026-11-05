// @vitest-environment node
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAllTranslations,
  countTranslatedUnits,
  listTranslatedUnits,
  translatedUnitKey,
  translationUnitLimit,
  trimTranslations,
  writeTranslatedUnit,
} from "./translation-store";

// El almacén usa `window.indexedDB`; en Node lo da fake-indexeddb sobre `globalThis`.
(globalThis as { window?: unknown }).window = globalThis;

const pair = "browser:en>es";

async function seed(documentId: string, pages: number, from: Date) {
  for (let page = 1; page <= pages; page += 1) {
    await writeTranslatedUnit({
      blocks: [{ hash: `h${page}`, text: `Página ${page} traducida` }],
      documentId,
      key: translatedUnitKey(documentId, pair, `page:${page}`),
      pairId: pair,
      translatedAt: new Date(from.getTime() + page * 1000).toISOString(),
      unitId: `page:${page}`,
    });
  }
}

describe("tope de la caché de traducciones (05.6)", () => {
  beforeEach(async () => {
    await clearAllTranslations();
  });

  it("no toca nada mientras no se pasa del tope", async () => {
    await seed("libro-a", 8, new Date("2026-01-01"));

    expect(await trimTranslations("libro-a", 10)).toBe(0);
    expect(await countTranslatedUnits()).toBe(8);
  });

  it("al pasarlo, borra lo más antiguo hasta el 90 % y conserva lo más reciente", async () => {
    await seed("viejo", 6, new Date("2026-01-01"));
    await seed("reciente", 6, new Date("2026-06-01"));

    // 12 sobre un tope de 10: baja a 9, así que se van las 3 páginas más antiguas.
    expect(await trimTranslations("otro", 10)).toBe(3);
    expect(await countTranslatedUnits()).toBe(9);
    expect([...(await listTranslatedUnits("viejo", pair))].sort()).toEqual(["page:4", "page:5", "page:6"]);
    expect((await listTranslatedUnits("reciente", pair)).size).toBe(6);
  });

  it("nunca borra el libro que se está leyendo, aunque sea lo más antiguo", async () => {
    await seed("leyendo", 6, new Date("2026-01-01"));
    await seed("otro", 6, new Date("2026-06-01"));

    expect(await trimTranslations("leyendo", 10)).toBe(3);
    expect((await listTranslatedUnits("leyendo", pair)).size).toBe(6);
    expect((await listTranslatedUnits("otro", pair)).size).toBe(3);
  });

  it("una base de la versión 1 se actualiza sin perder lo traducido y ya se puede recortar", async () => {
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase("pliegue-translations");
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    });
    // La base tal como la dejaba la versión anterior: sin el índice por fecha.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("pliegue-translations", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("units", { keyPath: "key" });
        store.createIndex("byTranslation", ["documentId", "pairId"], { unique: false });
        for (let page = 1; page <= 4; page += 1) {
          store.put({
            blocks: [],
            documentId: "antiguo",
            key: translatedUnitKey("antiguo", pair, `page:${page}`),
            pairId: pair,
            translatedAt: new Date(Date.UTC(2025, 0, page)).toISOString(),
            unitId: `page:${page}`,
          });
        }
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    expect(await countTranslatedUnits()).toBe(4);
    expect(await trimTranslations("otro", 3)).toBe(2);
    expect([...(await listTranslatedUnits("antiguo", pair))].sort()).toEqual(["page:3", "page:4"]);
  });

  it("el tope por defecto deja sitio para varios libros largos", () => {
    expect(translationUnitLimit).toBe(5000);
  });
});
