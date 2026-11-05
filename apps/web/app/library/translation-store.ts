"use client";

import type { TranslatedBlock } from "./translation";

/**
 * Traducciones guardadas en este dispositivo: una fila por página o sección traducida. Son
 * una capa derivada del libro —se pueden borrar sin tocar el original— y nunca salen del
 * navegador.
 */
const databaseName = "pliegue-translations";
/** 2: el índice por fecha, para borrar primero lo más antiguo cuando se llena (05.6). */
const databaseVersion = 2;
const storeName = "units";
const byTranslation = "byTranslation";
const byTranslatedAt = "byTranslatedAt";

/**
 * Cuántas páginas o secciones traducidas se guardan como mucho. Cada una ocupa 2-3 KB (solo el
 * texto traducido), así que el tope ronda los 12 MB: antes no había ninguno y la caché crecía
 * con cada libro traducido. Al pasarlo se borra lo más antiguo hasta bajar al 90 %, nunca lo del
 * libro que se está leyendo; si se vuelve a una página borrada, se traduce de nuevo.
 */
export const translationUnitLimit = 5000;

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
        const store = request.result.objectStoreNames.contains(storeName)
          ? request.transaction!.objectStore(storeName)
          : request.result.createObjectStore(storeName, { keyPath: "key" });
        if (!store.indexNames.contains(byTranslation)) {
          store.createIndex(byTranslation, ["documentId", "pairId"], { unique: false });
        }
        // Las filas de la versión 1 ya traen `translatedAt`: el índice nuevo las recoge sin migrar.
        if (!store.indexNames.contains(byTranslatedAt)) {
          store.createIndex(byTranslatedAt, "translatedAt", { unique: false });
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

/**
 * Si hay más de `limit` unidades guardadas, borra las más antiguas hasta bajar al 90 %, salvo
 * las del documento `keepDocumentId`. Devuelve cuántas borró. Contar es barato, así que puede
 * llamarse tras cada escritura: solo recorre filas cuando de verdad se ha llenado.
 */
export async function trimTranslations(keepDocumentId: string, limit = translationUnitLimit) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    let removed = 0;
    // Todo dentro de los callbacks de la transacción: un `await` entre medias podría dejarla
    // cerrar antes de terminar de borrar.
    const counting = store.count();
    counting.addEventListener("success", () => {
      const excess = counting.result - Math.floor(limit * 0.9);
      if (counting.result <= limit || excess <= 0) return;
      const cursor = store.index(byTranslatedAt).openCursor();
      cursor.addEventListener("success", () => {
        const current = cursor.result;
        if (!current || removed >= excess) return;
        if ((current.value as TranslatedUnitRecord).documentId !== keepDocumentId) {
          current.delete();
          removed += 1;
        }
        current.continue();
      });
    });
    await transactionComplete(transaction);
    return removed;
  } finally {
    database.close();
  }
}

/** Qué unidades de un documento están ya traducidas con este motor y par de idiomas. */
export async function listTranslatedUnits(documentId: string, pairId: string) {
  const keys = await withStore<IDBValidKey[]>("readonly", (store) =>
    store.index(byTranslation).getAllKeys(IDBKeyRange.only([documentId, pairId])),
  );
  const prefix = `${documentId}|${pairId}|`;
  return new Set(keys.map((key) => String(key).slice(prefix.length)));
}

/** Cuántos fragmentos traducidos hay guardados en este navegador, de todos los libros. */
export async function countTranslatedUnits() {
  return withStore<number>("readonly", (store) => store.count());
}

/**
 * Borra todas las traducciones guardadas (Ajustes → Datos y portabilidad). Los libros quedan
 * como estaban; traducir de nuevo vuelve a llenarla. Devuelve cuántos fragmentos había.
 */
export async function clearAllTranslations() {
  const count = await countTranslatedUnits();
  await withStore("readwrite", (store) => store.clear());
  return count;
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

/** Todas las traducciones de un documento, con cualquier motor y par de idiomas. */
const documentRange = (documentId: string) => IDBKeyRange.bound([documentId, ""], [documentId, "\uffff"]);

/** Cuántas páginas o secciones traducidas tienen estos documentos, con cualquier motor. */
export async function countDocumentsTranslations(documentIds: readonly string[]) {
  if (!documentIds.length) return 0;
  const database = await openDatabase();
  let total = 0;
  try {
    const transaction = database.transaction(storeName, "readonly");
    const index = transaction.objectStore(storeName).index(byTranslation);
    for (const documentId of new Set(documentIds)) {
      const counting = index.count(documentRange(documentId));
      counting.addEventListener("success", () => {
        total += counting.result;
      });
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  return total;
}

/**
 * Borra todas las traducciones de estos documentos, con cualquier motor y par de idiomas, y
 * dice cuántas unidades borró. Solo al desvincular un libro y si la persona lo elige en el
 * aviso (03.3): por defecto se conservan.
 */
export async function clearDocumentsTranslations(documentIds: readonly string[]) {
  if (!documentIds.length) return 0;
  const database = await openDatabase();
  let removed = 0;
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const documentId of new Set(documentIds)) {
      const keys = store.index(byTranslation).getAllKeys(documentRange(documentId));
      keys.addEventListener("success", () => {
        for (const key of keys.result) store.delete(key);
        removed += keys.result.length;
      });
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  return removed;
}

/**
 * Las traducciones de una copia pasan a la que guarda el estado del libro. Una p\u00e1gina que el
 * destino ya ten\u00eda traducida se conserva: no se pisa nada.
 */
export async function transferTranslations(fromId: string, toId: string) {
  if (fromId === toId) return 0;
  const range = documentRange;
  const database = await openDatabase();
  let moved = 0;
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const [records, existing] = await Promise.all([
      requestResult(store.index(byTranslation).getAll(range(fromId)) as IDBRequest<TranslatedUnitRecord[]>),
      requestResult(store.index(byTranslation).getAllKeys(range(toId))),
    ]);
    const taken = new Set(existing.map(String));
    for (const record of records) {
      const key = translatedUnitKey(toId, record.pairId, record.unitId);
      if (!taken.has(key)) {
        store.put({ ...record, documentId: toId, key });
        moved += 1;
      }
      store.delete(record.key);
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  return moved;
}

/** Los documentos con alguna página traducida guardada. Recorre solo el índice, no los textos. */
export async function translatedDocumentIds() {
  const database = await openDatabase();
  const ids = new Set<string>();
  try {
    const transaction = database.transaction(storeName, "readonly");
    await new Promise<void>((resolve, reject) => {
      const request = transaction.objectStore(storeName).index(byTranslation).openKeyCursor(null, "nextunique");
      request.addEventListener("success", () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        const [documentId] = cursor.key as [string, string];
        ids.add(documentId);
        cursor.continue();
      });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  return ids;
}
