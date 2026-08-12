"use client";

import { useSyncExternalStore } from "react";

import { createLocalContentIndex, isCurrentContentIndex } from "./local-content-index";
import {
  compareFolderDocuments,
  createLinkedFolderDocument,
  type FolderChangeSummary,
  type LinkedFileDescriptor,
  type LinkedFolderDocument,
  maxLinkedFolderFiles,
} from "./local-folder";

const databaseName = "pliegue-linked-folders";
const databaseVersion = 1;
const documentStoreName = "documents";
const sourceStoreName = "sources";

export type ReadPermissionState = "denied" | "granted" | "prompt";

interface PermissionAwareDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor?: { mode: "read" }) => Promise<ReadPermissionState>;
  requestPermission?: (descriptor?: { mode: "read" }) => Promise<ReadPermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

interface ScannedLinkedFile extends LinkedFileDescriptor {
  handle: FileSystemFileHandle;
}

export interface LinkedFolderSource {
  addedAt: string;
  fileCount: number;
  id: string;
  lastScannedAt: string | null;
  name: string;
  permission: ReadPermissionState;
}

interface StoredLinkedFolderSource extends LinkedFolderSource {
  handle: FileSystemDirectoryHandle;
}

interface StoredLinkedFolderDocument extends LinkedFolderDocument {
  handle: FileSystemFileHandle;
}

interface LinkedFoldersSnapshot {
  documents: LinkedFolderDocument[];
  error: string | null;
  sources: LinkedFolderSource[];
  status: "error" | "idle" | "loading" | "ready";
  supported: boolean | null;
}

/**
 * Avance de la indexación de una carpeta. Vincular un corpus grande obliga a abrir y extraer
 * el texto de cada archivo en el hilo del navegador, y sin este dato la interfaz solo puede
 * ofrecer un botón inmóvil durante varios minutos.
 */
export interface FolderIndexProgress {
  current: string | null;
  /** Lo mide el store y no la interfaz: el reloj no tiene sitio dentro de un render. */
  elapsedMs: number;
  /** Archivos cuyo texto hubo que extraer de nuevo: son los que cuestan tiempo. */
  extracted: number;
  processed: number;
  /** Archivos que conservaron el índice anterior por no haber cambiado. */
  reused: number;
  total: number;
}

export interface FolderSyncResult extends FolderChangeSummary {
  permission: ReadPermissionState;
  relinked: boolean;
  sourceId: string;
  sourceName: string;
}

const initialSnapshot: LinkedFoldersSnapshot = {
  documents: [],
  error: null,
  sources: [],
  status: "idle",
  supported: null,
};

let snapshot = initialSnapshot;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
const sourceHandles = new Map<string, FileSystemDirectoryHandle>();

function emitSnapshot(next: LinkedFoldersSnapshot) {
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

function supportsLinkedFolders() {
  return (
    typeof window !== "undefined" &&
    "indexedDB" in window &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
  );
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.addEventListener(
      "upgradeneeded",
      () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(sourceStoreName)) {
          database.createObjectStore(sourceStoreName, { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains(documentStoreName)) {
          const documents = database.createObjectStore(documentStoreName, { keyPath: "id" });
          documents.createIndex("sourceId", "sourceId");
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
      () => reject(new Error("El almacenamiento de carpetas está abierto en otra pestaña.")),
      { once: true },
    );
  });
}

function permissionHandle(handle: FileSystemDirectoryHandle) {
  return handle as PermissionAwareDirectoryHandle;
}

async function queryReadPermission(handle: FileSystemDirectoryHandle) {
  const queryPermission = permissionHandle(handle).queryPermission;
  if (!queryPermission) return "prompt" as const;

  try {
    return await queryPermission.call(handle, { mode: "read" });
  } catch {
    return "denied" as const;
  }
}

/**
 * Cuánto se espera a que el usuario conteste al diálogo del navegador antes de darlo por no
 * mostrado. Chrome no lo dibuja si la pestaña está oculta y deja la promesa pendiente sin
 * error ni resolución: sin este límite la interfaz se queda en «Solicitando…» para siempre.
 */
export const permissionRequestTimeoutMs = 20_000;

/** «unanswered» no es un permiso: es que no se pudo llegar a preguntar. */
export type PermissionRequestOutcome = ReadPermissionState | "unanswered";

async function requestReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionRequestOutcome> {
  const requestPermission = permissionHandle(handle).requestPermission;
  if (!requestPermission) return queryReadPermission(handle);

  const unanswered = Symbol("unanswered");

  try {
    const outcome = await Promise.race([
      requestPermission.call(handle, { mode: "read" }),
      new Promise<typeof unanswered>((resolve) => {
        window.setTimeout(() => resolve(unanswered), permissionRequestTimeoutMs);
      }),
    ]);
    return outcome === unanswered ? "unanswered" : outcome;
  } catch (error) {
    // Sin activación de usuario el navegador rechaza en vez de preguntar. Tratarlo como una
    // denegación sería mentir: nadie ha dicho que no, simplemente no se llegó a preguntar.
    if (error instanceof DOMException && error.name === "SecurityError") return "unanswered";
    return "denied";
  }
}

function toLinkedDocument({ handle, ...document }: StoredLinkedFolderDocument) {
  void handle;
  return document.reference
    ? document
    : {
        ...document,
        reference: {
          kind: "local-folder" as const,
          relativePath: document.relativePath,
          sourceId: document.sourceId,
        },
      };
}

async function readStoredLibrary(database: IDBDatabase) {
  const transaction = database.transaction(
    [sourceStoreName, documentStoreName],
    "readonly",
  );
  const completed = transactionComplete(transaction);
  const [sources, documents] = await Promise.all([
    requestResult(
      transaction.objectStore(sourceStoreName).getAll() as IDBRequest<
        StoredLinkedFolderSource[]
      >,
    ),
    requestResult(
      transaction.objectStore(documentStoreName).getAll() as IDBRequest<
        StoredLinkedFolderDocument[]
      >,
    ),
  ]);
  await completed;
  return { documents, sources };
}

async function loadLinkedFolders() {
  if (!supportsLinkedFolders()) {
    sourceHandles.clear();
    emitSnapshot({
      documents: [],
      error: null,
      sources: [],
      status: "ready",
      supported: false,
    });
    return;
  }

  emitSnapshot({ ...snapshot, error: null, status: "loading", supported: true });

  try {
    const database = await openDatabase();
    const storedLibrary = await readStoredLibrary(database);
    database.close();
    const permissions = await Promise.all(
      storedLibrary.sources.map((source) => queryReadPermission(source.handle)),
    );
    const permissionBySource = new Map<string, ReadPermissionState>();

    sourceHandles.clear();
    storedLibrary.sources.forEach((source, index) => {
      sourceHandles.set(source.id, source.handle);
      permissionBySource.set(source.id, permissions[index] ?? "prompt");
    });

    emitSnapshot({
      documents: storedLibrary.documents
        .map((storedDocument): LinkedFolderDocument => {
          const document = toLinkedDocument(storedDocument);
          const availability: LinkedFolderDocument["availability"] =
            permissionBySource.get(document.sourceId) === "granted"
              ? "available"
              : "disconnected";

          return { ...document, availability };
        })
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "es")),
      error: null,
      sources: storedLibrary.sources
        .map(({ handle, ...source }, index) => {
          void handle;
          return { ...source, permission: permissions[index] ?? "prompt" };
        })
        .sort((left, right) => left.name.localeCompare(right.name, "es")),
      status: "ready",
      supported: true,
    });
  } catch {
    sourceHandles.clear();
    emitSnapshot({
      documents: [],
      error: "No fue posible recuperar las carpetas vinculadas de este navegador.",
      sources: [],
      status: "error",
      supported: true,
    });
  }
}

function ensureLinkedFoldersLoaded() {
  if (loadingPromise || snapshot.status === "ready") return;
  loadingPromise = loadLinkedFolders().finally(() => {
    loadingPromise = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLinkedFoldersLoaded();
  return () => listeners.delete(listener);
}

export function useLinkedFolders() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

async function scanDirectory(
  directory: FileSystemDirectoryHandle,
  prefix = "",
): Promise<ScannedLinkedFile[]> {
  const entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle> = [];
  for await (const entry of directory.values()) entries.push(entry);

  const nestedFiles = await Promise.all(
    entries.map(async (entry): Promise<ScannedLinkedFile[]> => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.kind === "directory") return scanDirectory(entry, relativePath);

      const file = await entry.getFile();
      return [
        {
          handle: entry,
          lastModified: file.lastModified,
          name: file.name,
          relativePath,
          size: file.size,
          type: file.type,
        },
      ];
    }),
  );
  const files = nestedFiles.flat();

  if (files.length > maxLinkedFolderFiles) {
    throw new Error(`La carpeta supera el límite inicial de ${maxLinkedFolderFiles} archivos.`);
  }

  return files;
}

function buildStoredDocuments(
  files: readonly ScannedLinkedFile[],
  sourceId: string,
  sourceName: string,
) {
  return files.flatMap((file) => {
    const document = createLinkedFolderDocument(file, sourceId, sourceName);
    return document ? [{ ...document, handle: file.handle }] : [];
  });
}

async function readDocumentsForSource(database: IDBDatabase, sourceId: string) {
  const transaction = database.transaction(documentStoreName, "readonly");
  const completed = transactionComplete(transaction);
  const documents = await requestResult(
    transaction.objectStore(documentStoreName).index("sourceId").getAll(sourceId) as IDBRequest<
      StoredLinkedFolderDocument[]
    >,
  );
  await completed;
  return documents;
}

async function saveFolderScan(
  source: StoredLinkedFolderSource,
  documents: readonly StoredLinkedFolderDocument[],
  onProgress?: (progress: FolderIndexProgress) => void,
) {
  const database = await openDatabase();

  try {
    const previous = await readDocumentsForSource(database, source.id);
    const summary = compareFolderDocuments(
      previous.map(toLinkedDocument),
      documents.map(toLinkedDocument),
    );
    const previousById = new Map(previous.map((document) => [document.id, document]));
    const indexedDocuments: StoredLinkedFolderDocument[] = new Array(documents.length);
    const startedAt = Date.now();
    const progress: FolderIndexProgress = {
      current: null,
      elapsedMs: 0,
      extracted: 0,
      processed: 0,
      reused: 0,
      total: documents.length,
    };
    let nextIndex = 0;

    function publish(document: StoredLinkedFolderDocument, reused: boolean) {
      progress.processed += 1;
      progress.current = document.relativePath;
      progress.elapsedMs = Date.now() - startedAt;
      if (reused) progress.reused += 1;
      else progress.extracted += 1;
      onProgress?.({ ...progress });
    }

    async function indexNextDocument() {
      while (nextIndex < documents.length) {
        const index = nextIndex;
        nextIndex += 1;
        const document = documents[index];
        if (!document) continue;
        const priorDocument = previousById.get(document.id);

        // El índice se reutiliza solo si el archivo no cambió Y lo produjo el extractor
        // vigente: al ampliar la extracción, lo indexado con una versión anterior debe
        // rehacerse aunque el archivo siga idéntico.
        if (
          priorDocument?.fingerprint === document.fingerprint &&
          priorDocument.indexStatus &&
          priorDocument.indexedAt &&
          isCurrentContentIndex(priorDocument.indexVersion)
        ) {
          indexedDocuments[index] = {
            ...document,
            indexedAt: priorDocument.indexedAt,
            indexStatus: priorDocument.indexStatus,
            indexVersion: priorDocument.indexVersion,
            searchText: priorDocument.searchText ?? "",
          };
          publish(document, true);
          continue;
        }

        const file = await document.handle.getFile();
        const contentIndex = await createLocalContentIndex(document.format, file);
        indexedDocuments[index] = { ...document, ...contentIndex };
        publish(document, false);
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(4, documents.length) },
        () => indexNextDocument(),
      ),
    );
    const transaction = database.transaction(
      [sourceStoreName, documentStoreName],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    const sourceStore = transaction.objectStore(sourceStoreName);
    const documentStore = transaction.objectStore(documentStoreName);

    sourceStore.put(source);
    previous.forEach((document) => documentStore.delete(document.id));
    indexedDocuments.forEach((document) => documentStore.put(document));
    await completed;
    return summary;
  } finally {
    database.close();
  }
}

async function readStoredSources() {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(sourceStoreName, "readonly");
    const completed = transactionComplete(transaction);
    const sources = await requestResult(
      transaction.objectStore(sourceStoreName).getAll() as IDBRequest<
        StoredLinkedFolderSource[]
      >,
    );
    await completed;
    return sources;
  } finally {
    database.close();
  }
}

function pickerWindow() {
  return window as DirectoryPickerWindow;
}

export async function linkLocalFolder(
  onProgress?: (progress: FolderIndexProgress) => void,
): Promise<FolderSyncResult> {
  const showDirectoryPicker = pickerWindow().showDirectoryPicker;
  if (!showDirectoryPicker) throw new Error("Este navegador no permite vincular carpetas.");

  // The picker must be the first awaited operation so the browser keeps user activation.
  const [handle, existingSources] = await Promise.all([
    showDirectoryPicker.call(window, {
      id: "pliegue-library",
      mode: "read",
    }),
    readStoredSources(),
  ]);
  const [matches, files] = await Promise.all([
    Promise.all(existingSources.map((source) => source.handle.isSameEntry(handle))),
    scanDirectory(handle),
  ]);
  const existingSource = existingSources.find((_, index) => matches[index]);
  const sourceId = existingSource?.id ?? crypto.randomUUID();
  const documents = buildStoredDocuments(files, sourceId, handle.name);
  const scannedAt = new Date().toISOString();
  const source: StoredLinkedFolderSource = {
    addedAt: existingSource?.addedAt ?? scannedAt,
    fileCount: documents.length,
    handle,
    id: sourceId,
    lastScannedAt: scannedAt,
    name: handle.name,
    permission: "granted",
  };
  const summary = await saveFolderScan(source, documents, onProgress);

  sourceHandles.set(sourceId, handle);
  await loadLinkedFolders();
  return {
    ...summary,
    permission: "granted",
    relinked: Boolean(existingSource),
    sourceId,
    sourceName: handle.name,
  };
}

function updatePermissionSnapshot(sourceId: string, permission: ReadPermissionState) {
  emitSnapshot({
    ...snapshot,
    documents: snapshot.documents.map((document) =>
      document.sourceId === sourceId
        ? {
            ...document,
            availability: permission === "granted" ? "available" : "disconnected",
          }
        : document,
    ),
    sources: snapshot.sources.map((source) =>
      source.id === sourceId ? { ...source, permission } : source,
    ),
  });
}

export async function requestLinkedFolderReadPermission(
  sourceId: string,
): Promise<PermissionRequestOutcome> {
  const handle = sourceHandles.get(sourceId);
  if (!handle) throw new Error("La carpeta vinculada ya no está disponible.");

  // Keep this as the first awaited operation so the browser preserves user activation.
  const outcome = await requestReadPermission(handle);
  // Si no se llegó a preguntar, el estado guardado no cambia: seguimos sin saber la respuesta.
  if (outcome !== "unanswered") updatePermissionSnapshot(sourceId, outcome);
  return outcome;
}

export async function readLinkedDocumentFile(documentId: string, sourceId: string) {
  const handle = sourceHandles.get(sourceId);
  if (!handle) return null;

  const permission = await queryReadPermission(handle);
  updatePermissionSnapshot(sourceId, permission);
  if (permission !== "granted") return null;

  const database = await openDatabase();

  try {
    const transaction = database.transaction(documentStoreName, "readonly");
    const record = await requestResult(
      transaction.objectStore(documentStoreName).get(documentId) as IDBRequest<
        StoredLinkedFolderDocument | undefined
      >,
    );
    await transactionComplete(transaction);

    if (!record || record.sourceId !== sourceId) return null;
    return { document: toLinkedDocument(record), file: await record.handle.getFile() };
  } finally {
    database.close();
  }
}

export async function scanLinkedFolder(
  sourceId: string,
  requestAccess = false,
  onProgress?: (progress: FolderIndexProgress) => void,
): Promise<FolderSyncResult> {
  const source = snapshot.sources.find((item) => item.id === sourceId);
  const handle = sourceHandles.get(sourceId);
  if (!source || !handle) throw new Error("La carpeta vinculada ya no está disponible.");

  const outcome = requestAccess
    ? await requestReadPermission(handle)
    : await queryReadPermission(handle);
  // Que no se haya podido preguntar deja el permiso donde estaba: pendiente, no denegado.
  const permission: ReadPermissionState = outcome === "unanswered" ? "prompt" : outcome;
  updatePermissionSnapshot(sourceId, permission);

  if (permission !== "granted") {
    return {
      added: 0,
      changed: 0,
      permission,
      relinked: false,
      removed: 0,
      sourceId,
      sourceName: source.name,
      total: source.fileCount,
      unchanged: source.fileCount,
    };
  }

  const files = await scanDirectory(handle);
  const documents = buildStoredDocuments(files, sourceId, source.name);
  const storedSource: StoredLinkedFolderSource = {
    ...source,
    fileCount: documents.length,
    handle,
    lastScannedAt: new Date().toISOString(),
    permission,
  };
  const summary = await saveFolderScan(storedSource, documents, onProgress);

  await loadLinkedFolders();
  return {
    ...summary,
    permission,
    relinked: false,
    sourceId,
    sourceName: source.name,
  };
}

export async function unlinkLocalFolder(sourceId: string) {
  const database = await openDatabase();

  try {
    const documents = await readDocumentsForSource(database, sourceId);
    const transaction = database.transaction(
      [sourceStoreName, documentStoreName],
      "readwrite",
    );
    const completed = transactionComplete(transaction);

    transaction.objectStore(sourceStoreName).delete(sourceId);
    const documentStore = transaction.objectStore(documentStoreName);
    documents.forEach((document) => documentStore.delete(document.id));
    await completed;
  } finally {
    database.close();
  }

  sourceHandles.delete(sourceId);
  await loadLinkedFolders();
}
