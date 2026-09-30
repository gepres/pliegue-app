"use client";

import type { TranslatedBlock } from "./translation";

/**
 * Traducciones guardadas en este dispositivo: una fila por página o sección traducida. Son
 * una capa derivada del libro —se pueden borrar sin tocar el original— y nunca salen del
 * navegador.
 */
const databaseName = "pliegue-translations";
const databaseVersion = 1;
const storeName = "units";
const byTranslation = "byTranslation";

export interface TranslatedUnitRecord {
  blocks: TranslatedBlock[];
  documentId: string;
  /** `documento|motor:origen>destino|unidad`. */
  key: string;
  /** Motor y par de idiomas, de `translationPairId`. */
  pairId: string;
  translatedAt: string;
  /** «page:12» en un PDF, «section:chapter-3» en un EPUB. */
  unitId: string;
}

export function translatedUnitKey(documentId: string, pairId: string, unitId: string) {
  return `${documentId}|${pairId}|${unitId}`;
}

function requestResult<Result>(request: IDBRequest<Result>) {
  return new Promise<Result>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          const store = request.result.createObjectStore(storeName, { keyPath: "key" });
          store.createIndex(byTranslation, ["documentId", "pairId"], { unique: false });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener(
      "blocked",
      () => reject(new Error("Las traducciones están abiertas en otra pestaña con una versión anterior.")),
      { once: true },
    );
  });
}

async function withStore<Result>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<Result> | null) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const request = work(transaction.objectStore(storeName));
    const result = request ? await requestResult(request) : (undefined as Result);
    await transactionComplete(transaction);
    return result;
  } finally {
    database.close();
  }
}

export async function readTranslatedUnit(documentId: string, pairId: string, unitId: string) {
  const record = await withStore<TranslatedUnitRecord | undefined>("readonly", (store) =>
    store.get(translatedUnitKey(documentId, pairId, unitId)) as IDBRequest<TranslatedUnitRecord | undefined>,
  );
  return record ?? null;
}

export async function writeTranslatedUnit(record: TranslatedUnitRecord) {
  await withStore("readwrite", (store) => store.put(record));
}

/** Qué unidades de un documento están ya traducidas con este motor y par de idiomas. */
export async function listTranslatedUnits(documentId: string, pairId: string) {
  const keys = await withStore<IDBValidKey[]>("readonly", (store) =>
    store.index(byTranslation).getAllKeys(IDBKeyRange.only([documentId, pairId])),
  );
  const prefix = `${documentId}|${pairId}|`;
  return new Set(keys.map((key) => String(key).slice(prefix.length)));
}

/** Borra la traducción de un documento a un idioma; el libro queda como estaba. */
export async function clearTranslation(documentId: string, pairId: string) {
  const units = await listTranslatedUnits(documentId, pairId);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const unitId of units) store.delete(translatedUnitKey(documentId, pairId, unitId));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  return units.size;
}
