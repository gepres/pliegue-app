"use client";

import { useSyncExternalStore } from "react";

import type { ImportedCatalogRecord } from "./catalog-import";

const databaseName = "pliegue-catalog-import";
const databaseVersion = 1;
const storeName = "records";

interface ImportedCatalogSnapshot {
  error: string | null;
  records: ImportedCatalogRecord[];
  status: "error" | "idle" | "loading" | "ready";
}

const initialSnapshot: ImportedCatalogSnapshot = {
  error: null,
  records: [],
  status: "idle",
};

let snapshot = initialSnapshot;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitSnapshot(next: ImportedCatalogSnapshot) {
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
        // La clave es la de emparejamiento, no el id del documento: una ficha puede llegar
        // antes que su archivo y debe sobrevivir hasta que ese archivo se vincule.
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: "matchKey" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener(
      "blocked",
      () => reject(new Error("El catálogo importado está abierto en otra pestaña.")),
      { once: true },
    );
  });
}

export async function readImportedCatalogRecords() {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(storeName, "readonly");
    const records = await requestResult(
      transaction.objectStore(storeName).getAll() as IDBRequest<ImportedCatalogRecord[]>,
    );
    await transactionComplete(transaction);
    return records;
  } finally {
    database.close();
  }
}

export async function reloadImportedCatalogs() {
  if (!("indexedDB" in window)) {
    emitSnapshot({
      error: "Este navegador no permite guardar fichas importadas.",
      records: [],
      status: "error",
    });
    return;
  }

  emitSnapshot({ ...snapshot, error: null, status: "loading" });

  try {
    emitSnapshot({ error: null, records: await readImportedCatalogRecords(), status: "ready" });
  } catch {
    emitSnapshot({
      error: "No fue posible recuperar las fichas importadas de este navegador.",
      records: [],
      status: "error",
    });
  }
}

function ensureLoaded() {
  if (loadingPromise || snapshot.status === "ready") return;
  loadingPromise = reloadImportedCatalogs().finally(() => {
    loadingPromise = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

export function useImportedCatalogs() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

export async function saveImportedCatalogRecords(records: readonly ImportedCatalogRecord[]) {
  if (!records.length) return;
  const database = await openDatabase();

  try {
    // Una sola transacción para todo el lote: si el navegador la aborta a medias, no queda
    // media importación aplicada que obligue a comparar el JSON con lo guardado.
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const record of records) store.put(record);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  await reloadImportedCatalogs();
}

export async function removeImportedCatalogRecords(matchKeys: readonly string[]) {
  if (!matchKeys.length) return;
  const database = await openDatabase();

  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const matchKey of new Set(matchKeys)) store.delete(matchKey);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  await reloadImportedCatalogs();
}
