// @vitest-environment node
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { describeForgotten, forgetDocumentDerivatives, translationsChoice } from "./forget-derivatives";

// Los almacenes usan `window.indexedDB`; en Node lo da fake-indexeddb sobre `globalThis`.
(globalThis as { window?: unknown }).window = globalThis;

/** Siembra una base con su almacén, tal como la crean los módulos de la app. */
function seed(name: string, version: number, store: string, keyPath: string, records: object[], indexes: [string, string | string[]][] = []) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const objectStore = request.result.createObjectStore(store, { keyPath });
      for (const [indexName, path] of indexes) objectStore.createIndex(indexName, path, { unique: false });
      for (const record of records) objectStore.put(record);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function countAll(name: string, store: string) {
  return new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const counting = request.result.transaction(store).objectStore(store).count();
      counting.onsuccess = () => {
        request.result.close();
        resolve(counting.result);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

const pair = "browser:en>es";
const translation = (documentId: string, page: number) => ({
  blocks: [],
  documentId,
  key: `${documentId}|${pair}|page:${page}`,
  pairId: pair,
  translatedAt: new Date(Date.UTC(2026, 0, page)).toISOString(),
  unitId: `page:${page}`,
});

describe("olvidar lo derivado de un libro al desvincularlo (03.3)", () => {
  it("borra la ficha, las traducciones y la portada traída, y solo de esos libros", async () => {
    await seed("pliegue-document-catalog", 1, "catalogs", "documentId", [
      { documentId: "carpeta-1" },
      { documentId: "carpeta-2" },
      { documentId: "otro" },
    ]);
    await seed(
      "pliegue-translations",
      1,
      "units",
      "key",
      [translation("carpeta-1", 1), translation("carpeta-1", 2), translation("carpeta-2", 1), translation("otro", 1)],
      [["byTranslation", ["documentId", "pairId"]]],
    );
    await seed("pliegue-covers", 1, "covers", "documentId", [
      { cover: { src: "data:" }, documentId: "carpeta-1", status: "found" },
      { documentId: "carpeta-2", status: "not-found" },
      { cover: { src: "data:" }, documentId: "otro", status: "found" },
    ]);

    const ids = ["carpeta-1", "carpeta-2", "sin-nada"];
    // El interruptor del aviso sale porque hay traducciones, con cuántas son.
    expect(await translationsChoice(ids)).toEqual({
      description: "3 páginas traducidas. Si lo dejas apagado, se quedan guardadas en este navegador.",
      label: "Borrar también sus traducciones",
    });

    // Por defecto, las traducciones se conservan (decisión del dueño, 4-nov).
    const kept = await forgetDocumentDerivatives(ids);
    expect(kept).toEqual({ catalogs: 2, covers: 1, documents: 3, translations: 0, translationsKept: 3 });
    expect(await countAll("pliegue-document-catalog", "catalogs")).toBe(1);
    expect(await countAll("pliegue-translations", "units")).toBe(4);
    expect(await countAll("pliegue-covers", "covers")).toBe(1);

    // Con el interruptor encendido, se van también, y solo las de esos libros.
    const removed = await forgetDocumentDerivatives(ids, { translations: true });
    expect(removed).toEqual({ catalogs: 0, covers: 0, documents: 3, translations: 3, translationsKept: 0 });
    expect(await countAll("pliegue-translations", "units")).toBe(1);
    expect(await translationsChoice(ids)).toBeNull();
  });

  it("dice en una frase qué se borró y qué se conserva, sin mencionar lo que no había", () => {
    expect(describeForgotten({ catalogs: 8, covers: 3, documents: 12, translations: 340, translationsKept: 0 })).toBe(
      "Se borraron el índice de 12 documentos, 8 fichas del catálogo, 340 páginas traducidas y 3 portadas de Open Library.",
    );
    expect(describeForgotten({ catalogs: 0, covers: 0, documents: 1, translations: 0, translationsKept: 0 })).toBe(
      "Se borró el índice de 1 documento.",
    );
    expect(describeForgotten({ catalogs: 1, covers: 0, documents: 1, translations: 0, translationsKept: 25 })).toBe(
      "Se borraron el índice de 1 documento y 1 ficha del catálogo. Se conservan 25 páginas traducidas.",
    );
  });
});
