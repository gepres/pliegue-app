"use client";

import type { OcrPageLayout } from "./ocr-layout";

/**
 * Las páginas escaneadas ya leídas con OCR (03.5b), por documento y página, en este navegador.
 * Leer una página cuesta de 2 a 5 segundos de procesador: se guarda para no repetirlo al volver
 * al libro, al traducirlo después o al cambiar entre Lectura y la traducción.
 *
 * Es un derivado del libro, como su ficha o su portada traída: se borra al desvincularlo
 * (`forget-derivatives`) y con «Borrar todo en este navegador» (`browser-data`).
 */

export interface OcrPageRecord {
  documentId: string;
  /** `documentId:página`. */
  id: string;
  /** Con qué idiomas se leyó (`eng`, `spa`, `eng+spa`…): otro idioma se lee de nuevo. */
  languages: string;
  layout: OcrPageLayout;
  page: number;
  readAt: string;
  /** Sube cuando cambia cómo se lee o se maqueta: lo de antes se vuelve a leer. */
  version: number;
}

export const ocrLayoutVersion = 1;

const databaseName = "pliegue-ocr";
const databaseVersion = 1;
const storeName = "pages";
const byDocument = "byDocument";

const recordId = (documentId: string, page: number) => `${documentId}:${page}`;

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
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: "id" }).createIndex(byDocument, "documentId");
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new Error("El OCR guardado está abierto en otra pestaña.")), { once: true });
  });
}

const available = () => typeof indexedDB !== "undefined";

async function withStore<Result>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<Result>) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const result = await work(transaction.objectStore(storeName));
    await transactionComplete(transaction);
    return result;
  } finally {
    database.close();
  }
}

/** Lo leído de esa página con esos idiomas, o `null` si hay que leerla. */
export async function readOcrPage(documentId: string, page: number, languages: string): Promise<OcrPageLayout | null> {
  if (!available()) return null;
  const record = await withStore("readonly", (store) => requestResult(store.get(recordId(documentId, page)) as IDBRequest<OcrPageRecord | undefined>));
  return record && record.languages === languages && record.version === ocrLayoutVersion ? record.layout : null;
}

export async function saveOcrPage(documentId: string, page: number, languages: string, layout: OcrPageLayout) {
  if (!available()) return;
  const record: OcrPageRecord = {
    documentId,
    id: recordId(documentId, page),
    languages,
    layout,
    page,
    readAt: new Date().toISOString(),
    version: ocrLayoutVersion,
  };
  await withStore("readwrite", async (store) => {
    store.put(record);
  });
}

async function keysOf(store: IDBObjectStore, documentIds: readonly string[]) {
  const index = store.index(byDocument);
  const keys = await Promise.all(documentIds.map((id) => requestResult(index.getAllKeys(IDBKeyRange.only(id)))));
  return keys.flat();
}

/** Cuántas páginas leídas con OCR guardan esos documentos. */
export async function countDocumentsOcr(documentIds: readonly string[]) {
  if (!available() || !documentIds.length) return 0;
  return withStore("readonly", async (store) => (await keysOf(store, documentIds)).length);
}

/** Borra lo leído de esos documentos y dice cuántas páginas eran. */
export async function removeDocumentsOcr(documentIds: readonly string[]) {
  if (!available() || !documentIds.length) return 0;
  return withStore("readwrite", async (store) => {
    const keys = await keysOf(store, documentIds);
    for (const key of keys) store.delete(key);
    return keys.length;
  });
}
