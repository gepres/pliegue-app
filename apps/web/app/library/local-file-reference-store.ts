"use client";

import { useSyncExternalStore } from "react";

import { createLocalContentIndex, isCurrentContentIndex } from "./local-content-index";
import {
  createLinkedFileDocument,
  type LinkedFileDocument,
} from "./local-file-reference";
import { validateLocalFile } from "./local-file-metadata";
import type { ReadPermissionState } from "./local-folder-store";

const databaseName = "pliegue-linked-files";
const databaseVersion = 1;
const documentStoreName = "documents";

interface PermissionAwareFileHandle extends FileSystemFileHandle {
  queryPermission?: (descriptor?: { mode: "read" }) => Promise<ReadPermissionState>;
  requestPermission?: (descriptor?: { mode: "read" }) => Promise<ReadPermissionState>;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    id?: string;
    multiple?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
}

interface StoredLinkedFileDocument extends LinkedFileDocument {
  handle: FileSystemFileHandle;
}

interface LinkedFilesSnapshot {
  documents: LinkedFileDocument[];
  error: string | null;
  status: "error" | "idle" | "loading" | "ready";
  supported: boolean | null;
}

export interface LinkLocalFilesResult {
  linked: number;
  rejected: Array<{ name: string; reason: string }>;
  updated: number;
}

const initialSnapshot: LinkedFilesSnapshot = {
  documents: [],
  error: null,
  status: "idle",
  supported: null,
};

let snapshot = initialSnapshot;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
const fileHandles = new Map<string, FileSystemFileHandle>();

function emitSnapshot(next: LinkedFilesSnapshot) {
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

function supportsLinkedFiles() {
  return (
    typeof window !== "undefined" &&
    "indexedDB" in window &&
    typeof (window as FilePickerWindow).showOpenFilePicker === "function"
  );
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.addEventListener(
      "upgradeneeded",
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(documentStoreName)) {
          database.createObjectStore(documentStoreName, { keyPath: "id" });
        }
      },
      { once: true },
    );
    request.addEventListener(
      "success",
      () => {
        const database = request.result;
        database.addEventListener("versionchange", () => database.close());
        resolve(database);
      },
      { once: true },
    );
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener(
      "blocked",
      () => reject(new Error("El almacenamiento de referencias está abierto en otra pestaña.")),
      { once: true },
    );
  });
}

function permissionHandle(handle: FileSystemFileHandle) {
  return handle as PermissionAwareFileHandle;
}

async function queryReadPermission(handle: FileSystemFileHandle) {
  const queryPermission = permissionHandle(handle).queryPermission;
  if (!queryPermission) return "prompt" as const;

  try {
    return await queryPermission.call(handle, { mode: "read" });
  } catch {
    return "denied" as const;
  }
}

async function requestReadPermission(handle: FileSystemFileHandle) {
  const requestPermission = permissionHandle(handle).requestPermission;
  if (!requestPermission) return queryReadPermission(handle);

  try {
    return await requestPermission.call(handle, { mode: "read" });
  } catch {
    return "denied" as const;
  }
}

function toLinkedDocument({ handle, ...document }: StoredLinkedFileDocument) {
  void handle;
  return document;
}

async function readStoredDocuments(database: IDBDatabase) {
  const transaction = database.transaction(documentStoreName, "readonly");
  const completed = transactionComplete(transaction);
  const documents = await requestResult(
    transaction.objectStore(documentStoreName).getAll() as IDBRequest<
      StoredLinkedFileDocument[]
    >,
  );
  await completed;
  return documents;
}

async function loadLinkedFiles() {
  if (!supportsLinkedFiles()) {
    fileHandles.clear();
    emitSnapshot({
      documents: [],
      error: null,
      status: "ready",
      supported: false,
    });
    return;
  }

  emitSnapshot({ ...snapshot, error: null, status: "loading", supported: true });

  try {
    const database = await openDatabase();
    const storedDocuments = await readStoredDocuments(database);
    database.close();
    const permissions = await Promise.all(
      storedDocuments.map((document) => queryReadPermission(document.handle)),
    );

    fileHandles.clear();
    storedDocuments.forEach((document) => fileHandles.set(document.id, document.handle));
    emitSnapshot({
      documents: storedDocuments
        .map((stored, index): LinkedFileDocument => {
          const availability: LinkedFileDocument["availability"] =
            permissions[index] === "granted" ? "available" : "disconnected";
          return { ...toLinkedDocument(stored), availability };
        })
        .sort((left, right) => right.addedAt.localeCompare(left.addedAt)),
      error: null,
      status: "ready",
      supported: true,
    });
  } catch {
    fileHandles.clear();
    emitSnapshot({
      documents: [],
      error: "No fue posible recuperar las referencias a archivos de este navegador.",
      status: "error",
      supported: true,
    });
  }
}

function ensureLinkedFilesLoaded() {
  if (loadingPromise || snapshot.status === "ready") return;
  loadingPromise = loadLinkedFiles().finally(() => {
    loadingPromise = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLinkedFilesLoaded();
  return () => listeners.delete(listener);
}

export function useLinkedFiles() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

function pickerWindow() {
  return window as FilePickerWindow;
}

export async function linkLocalFiles(): Promise<LinkLocalFilesResult> {
  const showOpenFilePicker = pickerWindow().showOpenFilePicker;
  if (!showOpenFilePicker) throw new Error("Este navegador no permite vincular archivos.");

  // The picker must remain the first awaited operation to preserve user activation.
  const handles = await showOpenFilePicker.call(window, {
    id: "pliegue-library-files",
    multiple: true,
  });
  const database = await openDatabase();

  try {
    const previous = await readStoredDocuments(database);
    const result: LinkLocalFilesResult = { linked: 0, rejected: [], updated: 0 };
    const records = await Promise.all(
      handles.map(async (handle): Promise<StoredLinkedFileDocument | null> => {
        const file = await handle.getFile();
        const validation = validateLocalFile(file);
        if (!validation.valid) {
          result.rejected.push({ name: file.name, reason: validation.reason });
          return null;
        }

        const matches = await Promise.all(
          previous.map((stored) => stored.handle.isSameEntry(handle)),
        );
        const existing = previous.find((_, index) => matches[index]);
        const fingerprint = `${file.name.toLocaleLowerCase("en")}::${file.size}::${file.lastModified}`;
        // Mismo criterio que en las carpetas: un índice de una versión anterior del
        // extractor se rehace aunque el archivo no haya cambiado.
        const index =
          existing?.fingerprint === fingerprint &&
          isCurrentContentIndex(existing.indexVersion)
            ? {
                indexedAt: existing.indexedAt ?? new Date().toISOString(),
                indexStatus: existing.indexStatus ?? ("pending" as const),
                indexVersion: existing.indexVersion,
                searchText: existing.searchText ?? "",
              }
            : await createLocalContentIndex(validation.format, file);
        const id = existing?.id ?? crypto.randomUUID();
        const document = createLinkedFileDocument(
          file,
          id,
          existing?.addedAt ?? new Date().toISOString(),
          index,
        );

        if (existing) result.updated += 1;
        else result.linked += 1;
        return { ...document, handle };
      }),
    );
    const transaction = database.transaction(documentStoreName, "readwrite");
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(documentStoreName);
    for (const record of records) {
      if (record) store.put(record);
    }
    await completed;

    await loadLinkedFiles();
    return result;
  } finally {
    database.close();
  }
}

function updatePermissionSnapshot(documentId: string, permission: ReadPermissionState) {
  emitSnapshot({
    ...snapshot,
    documents: snapshot.documents.map((document) =>
      document.id === documentId
        ? {
            ...document,
            availability: permission === "granted" ? "available" : "disconnected",
          }
        : document,
    ),
  });
}

export async function requestLinkedFileReadPermission(documentId: string) {
  const handle = fileHandles.get(documentId);
  if (!handle) throw new Error("La referencia al archivo ya no está disponible.");
  const permission = await requestReadPermission(handle);
  updatePermissionSnapshot(documentId, permission);
  return permission;
}

export async function readLinkedFile(documentId: string) {
  const handle = fileHandles.get(documentId);
  if (!handle) return null;
  const permission = await queryReadPermission(handle);
  updatePermissionSnapshot(documentId, permission);
  if (permission !== "granted") return null;
  const document = snapshot.documents.find((item) => item.id === documentId);
  if (!document) return null;
  return { document, file: await handle.getFile() };
}

export async function unlinkLocalFile(documentId: string) {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(documentStoreName, "readwrite");
    transaction.objectStore(documentStoreName).delete(documentId);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  fileHandles.delete(documentId);
  await loadLinkedFiles();
}
