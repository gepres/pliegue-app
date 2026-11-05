"use client";

import { useSyncExternalStore } from "react";

import type { CatalogCover } from "./catalog-import";
import type { LibraryDocument } from "./documents";
import { needsCover } from "./open-library-covers";

/**
 * Las portadas traídas de Open Library (03.11), por documento, en este navegador. También se
 * recuerda lo que no se encontró, para no volver a preguntar por ello en cada búsqueda.
 */

export interface FetchedCoverRecord {
  cover?: CatalogCover;
  documentId: string;
  fetchedAt: string;
  status: "found" | "not-found";
  via?: "isbn" | "search";
}

interface FetchedCoverSnapshot {
  records: FetchedCoverRecord[];
  status: "error" | "idle" | "loading" | "ready";
}

const databaseName = "pliegue-covers";
const databaseVersion = 1;
const storeName = "covers";
const initialSnapshot: FetchedCoverSnapshot = { records: [], status: "idle" };

let snapshot = initialSnapshot;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: FetchedCoverSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
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
          request.result.createObjectStore(storeName, { keyPath: "documentId" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new Error("Las portadas están abiertas en otra pestaña.")), {
      once: true,
    });
  });
}

async function load() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    emit({ records: [], status: "ready" });
    return;
  }
  emit({ ...snapshot, status: "loading" });
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readonly");
      const records = await requestResult(transaction.objectStore(storeName).getAll() as IDBRequest<FetchedCoverRecord[]>);
      await transactionComplete(transaction);
      emit({ records, status: "ready" });
    } finally {
      database.close();
    }
  } catch {
    emit({ records: [], status: "error" });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loadingPromise && snapshot.status === "idle") {
    loadingPromise = load().finally(() => {
      loadingPromise = null;
    });
  }
  return () => listeners.delete(listener);
}

export function useFetchedCovers() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

export async function saveFetchedCovers(records: readonly FetchedCoverRecord[]) {
  if (!records.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const record of records) store.put(record);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await load();
}

/**
 * Olvida lo que se buscó en Open Library para estos documentos —la portada traída o el «no
 * encontrado»— y dice cuántas portadas había (03.3: al desvincular un libro).
 */
export async function removeFetchedCovers(documentIds: readonly string[]) {
  if (!documentIds.length) return 0;
  const ids = new Set(documentIds);
  const database = await openDatabase();
  let covers = 0;
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const all = store.getAll() as IDBRequest<FetchedCoverRecord[]>;
    all.addEventListener("success", () => {
      for (const record of all.result) {
        if (!ids.has(record.documentId)) continue;
        store.delete(record.documentId);
        if (record.status === "found") covers += 1;
      }
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await load();
  return covers;
}

/** Quita las portadas traídas (y el recuerdo de lo no encontrado): vuelve lo de antes. */
export async function clearFetchedCovers() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await load();
}

/**
 * Pone la portada traída a los documentos que la necesitan. Va antes de la ficha importada:
 * la portada del índice JSON, la que genera la IA, sigue mandando.
 */
export function applyFetchedCovers(documents: readonly LibraryDocument[], records: readonly FetchedCoverRecord[]) {
  if (!records.length) return [...documents];
  const covers = new Map(records.flatMap((record) => (record.status === "found" && record.cover ? [[record.documentId, record.cover]] : [])));
  return documents.map((document) => {
    const cover = covers.get(document.id);
    return cover && needsCover(document) ? { ...document, cover } : document;
  });
}
