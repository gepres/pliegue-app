"use client";

import { useMemo, useSyncExternalStore } from "react";

import type { ReaderAnnotation } from "./annotations";

/**
 * Resaltados y notas, guardados en este dispositivo.
 *
 * Una sola base para todos los documentos: se cuentan por decenas o cientos, y tenerlas
 * juntas permite listarlas sin abrir cada libro. Nada sale del navegador.
 */
const databaseName = "pliegue-annotations";
const databaseVersion = 1;
const storeName = "annotations";

interface AnnotationSnapshot {
  annotations: ReaderAnnotation[];
  error: string | null;
  status: "error" | "idle" | "loading" | "ready";
}

const initialSnapshot: AnnotationSnapshot = { annotations: [], error: null, status: "idle" };

let snapshot = initialSnapshot;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: AnnotationSnapshot) {
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
          const store = request.result.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex("documentId", "documentId", { unique: false });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener(
      "blocked",
      () => reject(new Error("Las notas están abiertas en otra pestaña con una versión anterior.")),
      { once: true },
    );
  });
}

async function readAll() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const records = await requestResult(
      transaction.objectStore(storeName).getAll() as IDBRequest<ReaderAnnotation[]>,
    );
    await transactionComplete(transaction);
    return records;
  } finally {
    database.close();
  }
}

async function reload() {
  if (!("indexedDB" in window)) {
    emit({ annotations: [], error: "Este navegador no permite guardar notas.", status: "error" });
    return;
  }
  emit({ ...snapshot, error: null, status: snapshot.status === "ready" ? "ready" : "loading" });
  try {
    emit({ annotations: await readAll(), error: null, status: "ready" });
  } catch {
    emit({ annotations: [], error: "No fue posible recuperar las notas de este navegador.", status: "error" });
  }
}

function ensureLoaded() {
  if (loadingPromise || snapshot.status === "ready") return;
  loadingPromise = reload().finally(() => {
    loadingPromise = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

async function write(change: (store: IDBObjectStore) => void) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    change(transaction.objectStore(storeName));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await reload();
}

/** La versión vigente de una marca, sin esperar a que React vuelva a pintar. */
export function currentAnnotation(id: string) {
  return snapshot.annotations.find((annotation) => annotation.id === id) ?? null;
}

export function saveAnnotation(annotation: ReaderAnnotation) {
  // Se publica antes de escribir: la marca aparece al instante y la escritura la confirma.
  emit({
    ...snapshot,
    annotations: [...snapshot.annotations.filter((item) => item.id !== annotation.id), annotation],
  });
  return write((store) => store.put(annotation));
}

export function deleteAnnotation(id: string) {
  emit({ ...snapshot, annotations: snapshot.annotations.filter((item) => item.id !== id) });
  return write((store) => store.delete(id));
}

export function clearDocumentAnnotations(documentId: string) {
  const ids = snapshot.annotations.filter((item) => item.documentId === documentId).map((item) => item.id);
  emit({ ...snapshot, annotations: snapshot.annotations.filter((item) => item.documentId !== documentId) });
  return write((store) => {
    for (const id of ids) store.delete(id);
  });
}

export function useAnnotationStore() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

/** Las marcas de un documento, en una lista estable mientras no cambien. */
export function useDocumentAnnotations(documentId: string) {
  const store = useAnnotationStore();
  const annotations = useMemo(
    () => store.annotations.filter((annotation) => annotation.documentId === documentId),
    [documentId, store.annotations],
  );
  return { annotations, error: store.error, status: store.status };
}
