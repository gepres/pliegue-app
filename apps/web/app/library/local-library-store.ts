"use client";

import { useSyncExternalStore } from "react";

import {
  createImportedDocument,
  type ImportedDocument,
  validateLocalFile,
} from "./local-file-metadata";

const databaseName = "pliegue-local-library";
const databaseVersion = 1;
const documentStoreName = "documents";

interface StoredImportedDocument extends ImportedDocument {
  blob: Blob;
}

interface LocalLibrarySnapshot {
  documents: ImportedDocument[];
  error: string | null;
  status: "idle" | "loading" | "ready" | "error";
}

export interface ImportResult {
  duplicates: number;
  imported: number;
  rejected: Array<{ name: string; reason: string }>;
}

const initialSnapshot: LocalLibrarySnapshot = {
  documents: [],
  error: null,
  status: "idle",
};

let snapshot = initialSnapshot;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitSnapshot(next: LocalLibrarySnapshot) {
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
        const database = request.result;
        if (database.objectStoreNames.contains(documentStoreName)) return;

        const store = database.createObjectStore(documentStoreName, { keyPath: "id" });
        store.createIndex("fingerprint", "fingerprint", { unique: true });
        store.createIndex("importedAt", "importedAt");
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener(
      "blocked",
      () => reject(new Error("El almacenamiento local está ocupado por otra pestaña.")),
      { once: true },
    );
  });
}

function toDocument({ blob, ...document }: StoredImportedDocument) {
  void blob;
  return document;
}

async function loadDocuments() {
  emitSnapshot({ ...snapshot, error: null, status: "loading" });

  try {
    const database = await openDatabase();
    const transaction = database.transaction(documentStoreName, "readonly");
    const records = await requestResult(
      transaction.objectStore(documentStoreName).getAll() as IDBRequest<StoredImportedDocument[]>,
    );
    await transactionComplete(transaction);
    database.close();

    emitSnapshot({
      documents: records
        .map(toDocument)
        .sort((left, right) => right.importedAt.localeCompare(left.importedAt)),
      error: null,
      status: "ready",
    });
  } catch {
    emitSnapshot({
      documents: [],
      error: "No fue posible abrir la biblioteca local de este navegador.",
      status: "error",
    });
  }
}

function ensureDocumentsLoaded() {
  if (loadingPromise || snapshot.status === "ready") return;
  loadingPromise = loadDocuments().finally(() => {
    loadingPromise = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureDocumentsLoaded();

  return () => listeners.delete(listener);
}

export function useImportedDocuments() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

async function findByFingerprint(database: IDBDatabase, fingerprint: string) {
  const transaction = database.transaction(documentStoreName, "readonly");
  const request = transaction
    .objectStore(documentStoreName)
    .index("fingerprint")
    .getKey(fingerprint);
  const key = await requestResult(request);
  await transactionComplete(transaction);
  return key;
}

async function saveImportedDocument(database: IDBDatabase, record: StoredImportedDocument) {
  const transaction = database.transaction(documentStoreName, "readwrite");
  transaction.objectStore(documentStoreName).add(record);
  await transactionComplete(transaction);
}

type FileImportOutcome =
  | { kind: "duplicate" }
  | { kind: "imported" }
  | { kind: "rejected"; name: string; reason: string };

async function importLocalFile(database: IDBDatabase, file: File): Promise<FileImportOutcome> {
  const validation = validateLocalFile(file);

  if (!validation.valid) {
    return { kind: "rejected", name: file.name, reason: validation.reason };
  }

  const importedAt = new Date().toISOString();
  const document = createImportedDocument(file, crypto.randomUUID(), importedAt);
  const duplicateKey = await findByFingerprint(database, document.fingerprint);

  if (duplicateKey !== undefined) return { kind: "duplicate" };

  try {
    await saveImportedDocument(database, { ...document, blob: file });
    return { kind: "imported" };
  } catch (error) {
    // The unique fingerprint index also protects against two equal files in one batch.
    if (error instanceof DOMException && error.name === "ConstraintError") {
      return { kind: "duplicate" };
    }

    throw error;
  }
}

export async function importLocalFiles(files: readonly File[]): Promise<ImportResult> {
  const result: ImportResult = { duplicates: 0, imported: 0, rejected: [] };
  const database = await openDatabase();

  try {
    const outcomes = await Promise.all(files.map((file) => importLocalFile(database, file)));

    for (const outcome of outcomes) {
      if (outcome.kind === "imported") result.imported += 1;
      if (outcome.kind === "duplicate") result.duplicates += 1;
      if (outcome.kind === "rejected") {
        result.rejected.push({ name: outcome.name, reason: outcome.reason });
      }
    }
  } finally {
    database.close();
  }

  await loadDocuments();
  return result;
}

export async function downloadImportedCopy(documentId: string) {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(documentStoreName, "readonly");
    const record = await requestResult(
      transaction.objectStore(documentStoreName).get(documentId) as IDBRequest<
        StoredImportedDocument | undefined
      >,
    );
    await transactionComplete(transaction);

    if (!record) throw new Error("La copia local ya no está disponible.");

    const url = URL.createObjectURL(record.blob);
    const anchor = document.createElement("a");
    anchor.download = record.originalName;
    anchor.href = url;
    document.body.append(anchor);
    anchor.click();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    anchor.remove();
    URL.revokeObjectURL(url);
  } finally {
    database.close();
  }
}

export async function removeImportedCopy(documentId: string) {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(documentStoreName, "readwrite");
    transaction.objectStore(documentStoreName).delete(documentId);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  await loadDocuments();
}
