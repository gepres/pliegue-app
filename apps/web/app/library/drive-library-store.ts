"use client";

import { useSyncExternalStore } from "react";

import { DriveApiError, downloadDriveFile, getDriveFile, walkDriveFolder } from "../drive/drive-api";
import { getDriveToken, readDriveConnection, subscribeDriveConnection } from "../drive/drive-connection";
import { isDriveFolder } from "../drive/drive-files";
import type { PickerDocument } from "../drive/google-scripts";
import { createDriveDocument, listSkippedDriveFiles, sameDriveContent, type DriveDocument } from "./drive-document";
import {
  carriedIndexFields,
  contentIndexVersion,
  createLocalContentIndex,
  isCurrentContentIndex,
} from "./local-content-index";
import { maxImportedFileBytes } from "./local-file-metadata";
import { compareFolderDocuments, type FolderChangeSummary, type SkippedLinkedFile } from "./local-folder";

const databaseName = "pliegue-drive";
const databaseVersion = 1;
const sourceStoreName = "sources";
const documentStoreName = "documents";

/**
 * Por encima de esto no se descarga un archivo solo para indexarlo: el mismo tope de 50 MB que
 * las copias. Queda como «solo metadatos» y se abre igual; su ficha y su portada pueden venir
 * de un índice JSON.
 */
export const maxDriveIndexBytes = maxImportedFileBytes;

/** Una carpeta de Drive vinculada entera (con `drive.readonly`). */
export interface DriveFolderSource {
  addedAt: string;
  driveId: string | null;
  fileCount: number;
  folderId: string;
  id: string;
  lastScannedAt: string | null;
  name: string;
  skippedFiles: SkippedLinkedFile[];
}

/**
 * La indexación va por detrás: los documentos aparecen en la biblioteca al momento y su texto
 * y portada llegan después. Se detiene sola si el token caduca (`auth`) y sigue al reconectar.
 */
export interface DriveIndexingState {
  current: string | null;
  failed: number;
  paused: "auth" | "user" | null;
  processed: number;
  total: number;
}

interface DriveLibrarySnapshot {
  documents: DriveDocument[];
  error: string | null;
  indexing: DriveIndexingState | null;
  sources: DriveFolderSource[];
  status: "error" | "idle" | "loading" | "ready";
}

export interface DriveFolderResult extends FolderChangeSummary {
  relinked: boolean;
  skipped: number;
  sourceId: string;
  sourceName: string;
}

export interface DriveFilesResult {
  added: number;
  rejected: Array<{ name: string; reason: string }>;
  updated: number;
}

const initialSnapshot: DriveLibrarySnapshot = {
  documents: [],
  error: null,
  indexing: null,
  sources: [],
  status: "idle",
};

let snapshot = initialSnapshot;
let stored: { documents: DriveDocument[]; sources: DriveFolderSource[] } = { documents: [], sources: [] };
let loadingPromise: Promise<void> | null = null;
let indexingRun: Promise<void> | null = null;
let pausedByUser = false;
let stopConnection: (() => void) | null = null;
const listeners = new Set<() => void>();

function supportsDriveLibrary() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

/** Sin la autorización de Drive los documentos siguen en la biblioteca, pero desconectados. */
function withAvailability(documents: readonly DriveDocument[]) {
  const availability: DriveDocument["availability"] = readDriveConnection().authorized ? "available" : "disconnected";
  return documents.map((document) => (document.availability === availability ? document : { ...document, availability }));
}

function emit(patch: Partial<DriveLibrarySnapshot> = {}) {
  snapshot = {
    ...snapshot,
    ...patch,
    documents: withAvailability(stored.documents),
    sources: stored.sources,
  };
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
        if (!database.objectStoreNames.contains(sourceStoreName)) {
          database.createObjectStore(sourceStoreName, { keyPath: "id" });
        }
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
      () => reject(new Error("El almacenamiento de Google Drive está abierto en otra pestaña.")),
      { once: true },
    );
  });
}

async function readAll() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([sourceStoreName, documentStoreName], "readonly");
    const completed = transactionComplete(transaction);
    const [sources, documents] = await Promise.all([
      requestResult(transaction.objectStore(sourceStoreName).getAll() as IDBRequest<DriveFolderSource[]>),
      requestResult(transaction.objectStore(documentStoreName).getAll() as IDBRequest<DriveDocument[]>),
    ]);
    await completed;
    return { documents, sources };
  } finally {
    database.close();
  }
}

/** Escribe y borra en una sola transacción: o queda todo o no queda nada. */
async function write(changes: {
  deleteDocuments?: readonly string[];
  deleteSources?: readonly string[];
  putDocuments?: readonly DriveDocument[];
  putSources?: readonly DriveFolderSource[];
}) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([sourceStoreName, documentStoreName], "readwrite");
    const completed = transactionComplete(transaction);
    const sources = transaction.objectStore(sourceStoreName);
    const documents = transaction.objectStore(documentStoreName);
    for (const id of changes.deleteSources ?? []) sources.delete(id);
    for (const id of changes.deleteDocuments ?? []) documents.delete(id);
    for (const source of changes.putSources ?? []) sources.put(source);
    // Lo que se guarda no lleva la disponibilidad calculada: depende de la conexión de ahora.
    for (const document of changes.putDocuments ?? []) documents.put({ ...document, availability: "available" });
    await completed;
  } finally {
    database.close();
  }
}

function sortDocuments(documents: DriveDocument[]) {
  return documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "es"));
}

async function loadDriveLibrary() {
  if (!supportsDriveLibrary()) {
    stored = { documents: [], sources: [] };
    emit({ error: null, status: "ready" });
    return;
  }
  emit({ error: null, status: "loading" });
  try {
    const library = await readAll();
    stored = {
      documents: sortDocuments(library.documents),
      sources: library.sources.sort((left, right) => left.name.localeCompare(right.name, "es")),
    };
    emit({ error: null, status: "ready" });
    kickIndexing();
  } catch {
    stored = { documents: [], sources: [] };
    emit({ error: "No fue posible recuperar los documentos de Google Drive de este navegador.", status: "error" });
  }
}

function ensureLoaded() {
  if (loadingPromise || snapshot.status === "ready") return;
  loadingPromise = loadDriveLibrary().finally(() => {
    loadingPromise = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Conectar o desconectar cambia la disponibilidad y, con token, reanuda la indexación.
  stopConnection ??= subscribeDriveConnection(() => {
    emit();
    kickIndexing();
  });
  ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

export function useDriveLibrary() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initialSnapshot);
}

function requireToken() {
  const token = getDriveToken();
  if (!token) throw new DriveApiError("auth", 401, "Conecta Google Drive para continuar.");
  return token;
}

/** Conserva el índice de un documento cuyo contenido no cambió; si cambió, queda pendiente. */
function carryIndex(previous: DriveDocument | undefined, next: DriveDocument): DriveDocument {
  if (!previous) return next;
  const { indexStatus, indexVersion } = previous;
  const reusable =
    sameDriveContent(previous, next) &&
    (indexStatus === "indexed" || indexStatus === "metadata-only") &&
    indexVersion !== undefined &&
    isCurrentContentIndex(indexVersion);
  if (!reusable) return { ...next, addedAt: previous.addedAt };
  return {
    ...next,
    ...carriedIndexFields(previous),
    addedAt: previous.addedAt,
    indexedAt: previous.indexedAt ?? previous.addedAt,
    indexStatus,
    indexVersion,
    searchText: previous.searchText ?? "",
  };
}

async function runLimited<Item>(items: readonly Item[], limit: number, task: (item: Item) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        if (item !== undefined) await task(item);
      }
    }),
  );
}

/** Añade los archivos elegidos en el selector (con `drive.file`). */
export async function addDriveFiles(picked: readonly PickerDocument[]): Promise<DriveFilesResult> {
  const token = requireToken();
  const result: DriveFilesResult = { added: 0, rejected: [], updated: 0 };
  const addedAt = new Date().toISOString();
  const byId = new Map(stored.documents.map((document) => [document.id, document]));
  const documents: DriveDocument[] = [];

  await runLimited(picked, 4, async (item) => {
    try {
      const meta = await getDriveFile(item.id, token);
      if (isDriveFolder(meta)) {
        result.rejected.push({ name: meta.name, reason: "Es una carpeta: usa «Vincular carpeta completa»." });
        return;
      }
      const document = createDriveDocument(meta, { addedAt, sourceId: null, sourceName: null });
      if (!document) {
        result.rejected.push({
          name: meta.name,
          reason: "Formato no compatible. Usa PDF, EPUB, DOCX, PPTX, XLSX, TXT, Markdown, PNG, JPG o un Documento de Google.",
        });
        return;
      }
      const previous = byId.get(document.id);
      if (previous) result.updated += 1;
      else result.added += 1;
      documents.push(carryIndex(previous, document));
    } catch (error) {
      if (error instanceof DriveApiError && error.kind === "auth") throw error;
      result.rejected.push({ name: item.name, reason: error instanceof Error ? error.message : "No se pudo leer." });
    }
  });

  if (documents.length) await write({ putDocuments: documents });
  await loadDriveLibrary();
  return result;
}

async function saveFolder(folder: { driveId: string | null; folderId: string; name: string }, onProgress?: (folders: number) => void) {
  const token = requireToken();
  if (!readDriveConnection().readonly) {
    throw new DriveApiError("scope", 403, "Vincular una carpeta completa necesita el permiso de solo lectura de Drive.");
  }
  const walk = await walkDriveFolder(folder.folderId, token, onProgress ? { onFolder: onProgress } : {});
  const existing = stored.sources.find((source) => source.folderId === folder.folderId);
  const sourceId = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const previous = stored.documents.filter((document) => document.sourceId === sourceId);
  const previousById = new Map(previous.map((document) => [document.id, document]));
  const documents = walk.files.flatMap((file) => {
    const document = createDriveDocument(file, {
      addedAt: now,
      relativePath: file.relativePath,
      sourceId,
      sourceName: folder.name,
    });
    return document ? [carryIndex(previousById.get(document.id), document)] : [];
  });
  const skippedFiles = listSkippedDriveFiles(walk.files);
  const source: DriveFolderSource = {
    addedAt: existing?.addedAt ?? now,
    driveId: folder.driveId,
    fileCount: documents.length,
    folderId: folder.folderId,
    id: sourceId,
    lastScannedAt: now,
    name: folder.name,
    skippedFiles,
  };
  const currentIds = new Set(documents.map((document) => document.id));
  const summary = compareFolderDocuments(previous, documents);

  await write({
    deleteDocuments: previous.filter((document) => !currentIds.has(document.id)).map((document) => document.id),
    putDocuments: documents,
    putSources: [source],
  });
  await loadDriveLibrary();
  return { ...summary, relinked: Boolean(existing), skipped: skippedFiles.length, sourceId, sourceName: folder.name };
}

/** Vincula una carpeta completa elegida en el selector (con `drive.readonly`). */
export function linkDriveFolder(folder: PickerDocument, onProgress?: (folders: number) => void): Promise<DriveFolderResult> {
  return saveFolder({ driveId: folder.driveId ?? null, folderId: folder.id, name: folder.name }, onProgress);
}

/** Vuelve a recorrer una carpeta vinculada: añade lo nuevo, reindexa lo cambiado y quita lo borrado. */
export function scanDriveFolder(sourceId: string, onProgress?: (folders: number) => void): Promise<DriveFolderResult> {
  const source = stored.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("La carpeta de Drive ya no está vinculada.");
  return saveFolder(source, onProgress);
}

export async function unlinkDriveFolder(sourceId: string) {
  await write({
    deleteDocuments: stored.documents.filter((document) => document.sourceId === sourceId).map((document) => document.id),
    deleteSources: [sourceId],
  });
  await loadDriveLibrary();
}

export async function unlinkDriveFiles(documentIds: readonly string[]) {
  if (!documentIds.length) return;
  await write({ deleteDocuments: documentIds });
  await loadDriveLibrary();
}

/**
 * Descarga el original para el lector. No se guarda: el archivo vive en Drive y aquí solo
 * existe mientras está abierto.
 */
export async function readDriveDocumentFile(
  documentId: string,
  onProgress?: (loaded: number, total: number | null) => void,
) {
  const document = stored.documents.find((item) => item.id === documentId);
  if (!document) return null;
  const token = requireToken();
  const blob = await downloadDriveFile({ id: document.reference.fileId, mimeType: document.mimeType }, token, onProgress ? { onProgress } : {});
  return {
    document,
    file: new File([blob], document.originalName, { lastModified: document.lastModified, type: blob.type }),
  };
}

// ---- Indexación en segundo plano -------------------------------------------------------------

function needsIndex(document: DriveDocument) {
  return document.indexStatus === "pending" || !isCurrentContentIndex(document.indexVersion);
}

export function pauseDriveIndexing() {
  pausedByUser = true;
}

export function resumeDriveIndexing() {
  pausedByUser = false;
  kickIndexing();
}

function kickIndexing() {
  if (indexingRun || snapshot.status !== "ready") return;
  const queue = stored.documents.filter(needsIndex);
  if (!queue.length) {
    if (snapshot.indexing) emit({ indexing: null });
    return;
  }
  const waiting = pausedByUser ? "user" : getDriveToken() ? null : "auth";
  if (waiting) {
    emit({ indexing: { current: null, failed: 0, paused: waiting, processed: 0, total: queue.length } });
    return;
  }
  indexingRun = indexQueue(queue)
    .then((stopped) => {
      indexingRun = null;
      // Lo que entró mientras tanto (otra carpeta, un archivo más) se indexa a continuación.
      if (!stopped) kickIndexing();
    })
    .catch(() => {
      // Un fallo del almacenamiento no se reintenta en bucle: queda a la vista y se para.
      indexingRun = null;
      emit({ error: "No fue posible guardar el índice de Google Drive en este navegador.", indexing: null });
    });
}

async function saveIndexedDocument(document: DriveDocument) {
  // Si se desvinculó mientras se descargaba, no se resucita.
  if (!stored.documents.some((item) => item.id === document.id)) return;
  await write({ putDocuments: [document] });
  stored = {
    ...stored,
    documents: stored.documents.map((item) => (item.id === document.id ? document : item)),
  };
}

/** Indexa la cola y devuelve por qué se detuvo, o `null` si la terminó. */
async function indexQueue(queue: readonly DriveDocument[]): Promise<DriveIndexingState["paused"]> {
  const state: DriveIndexingState = { current: null, failed: 0, paused: null, processed: 0, total: queue.length };
  let stop: DriveIndexingState["paused"] = null;
  emit({ indexing: { ...state } });

  await runLimited(queue, 2, async (queued) => {
    if (stop) return;
    if (pausedByUser) {
      stop = "user";
      return;
    }
    const token = getDriveToken();
    if (!token) {
      stop = "auth";
      return;
    }
    const document = stored.documents.find((item) => item.id === queued.id);
    if (!document || !needsIndex(document)) return;

    state.current = document.relativePath;
    emit({ indexing: { ...state } });
    const indexedAt = new Date().toISOString();
    try {
      const index =
        document.sizeBytes > maxDriveIndexBytes
          ? {
              cover: null,
              detectedLanguage: null,
              indexStatus: "metadata-only" as const,
              indexVersion: contentIndexVersion,
              indexedAt,
              searchText: "",
            }
          : await createLocalContentIndex(
              document.format,
              await downloadDriveFile({ id: document.reference.fileId, mimeType: document.mimeType }, token),
              indexedAt,
            );
      await saveIndexedDocument({ ...document, ...index });
    } catch (error) {
      if (error instanceof DriveApiError && error.kind === "auth") {
        stop = "auth";
        return;
      }
      state.failed += 1;
      await saveIndexedDocument({
        ...document,
        indexStatus: "error",
        indexVersion: contentIndexVersion,
        indexedAt,
        searchText: "",
      });
    }
    state.processed += 1;
    emit({ indexing: { ...state } });
  });

  emit({ indexing: stop ? { ...state, current: null, paused: stop } : null });
  return stop;
}
