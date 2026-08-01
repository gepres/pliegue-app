"use client";

import { useSyncExternalStore } from "react";

import type { DocumentCatalogRecord } from "./document-catalog";

const databaseName = "pliegue-document-catalog";
const databaseVersion = 1;
const storeName = "catalogs";

interface CatalogSnapshot {
  error: string | null;
  records: DocumentCatalogRecord[];
  status: "error" | "idle" | "loading" | "ready";
}

const initialSnapshot: CatalogSnapshot = {
  error: null,
  records: [],
  status: "idle",
};

let snapshot = initialSnapshot;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitSnapshot(next: CatalogSnapshot) {
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
    request.addEventListener(
      "blocked",
      () => reject(new Error("El catálogo está abierto en otra pestaña.")),
      { once: true },
    );
  });
}

export async function readDocumentCatalogRecords() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const records = await requestResult(
      transaction.objectStore(storeName).getAll() as IDBRequest<DocumentCatalogRecord[]>,
    );
    await transactionComplete(transaction);
    return records;
  } finally {
    database.close();
  }
}

export async function reloadDocumentCatalogs() {
  if (!("indexedDB" in window)) {
    emitSnapshot({
      error: "Este navegador no permite guardar el catálogo documental.",
      records: [],
      status: "error",
    });
    return;
  }

  emitSnapshot({ ...snapshot, error: null, status: "loading" });
  try {
    const records = await readDocumentCatalogRecords();
    emitSnapshot({ error: null, records, status: "ready" });
  } catch {
    emitSnapshot({
      error: "No fue posible recuperar el catálogo documental de este navegador.",
      records: [],
      status: "error",
    });
  }
}

function ensureLoaded() {
  if (loadingPromise || snapshot.status === "ready") return;
  loadingPromise = reloadDocumentCatalogs().finally(() => {
    loadingPromise = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

export function useDocumentCatalogs() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

export async function saveDocumentCatalogRecord(record: DocumentCatalogRecord) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(record);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  const existingIndex = snapshot.records.findIndex(
    (candidate) => candidate.documentId === record.documentId,
  );
  const records = [...snapshot.records];
  if (existingIndex === -1) records.push(record);
  else records[existingIndex] = record;
  emitSnapshot({ error: null, records, status: "ready" });
}

export async function removeDocumentCatalogRecord(documentId: string) {
  return removeDocumentCatalogRecords([documentId]);
}

export async function removeDocumentCatalogRecords(documentIds: readonly string[]) {
  if (!documentIds.length) return;
  const ids = new Set(documentIds);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const documentId of ids) store.delete(documentId);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  emitSnapshot({
    ...snapshot,
    records: snapshot.records.filter((record) => !ids.has(record.documentId)),
  });
}
