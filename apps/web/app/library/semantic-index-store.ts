"use client";

import { useSyncExternalStore } from "react";

import type { ChunkLocation, TextChunk } from "./chunking";
import { buildLexicalIndex, type LexicalIndex, type QuantizedVector } from "./semantic-search";

/**
 * El índice de búsqueda de la biblioteca (04.4), en este navegador: los fragmentos de cada libro
 * (su texto, de dónde salen y, si se calcularon, su vector en 8 bits) y una ficha por libro con la
 * versión que se indexó.
 *
 * Es un derivado del libro, como su ficha o su OCR: se borra al desvincularlo
 * (`forget-derivatives`) y con «Borrar todo en este navegador» (`browser-data`). No se sincroniza.
 */

export interface SemanticChunkRecord {
  documentId: string;
  hash: string;
  /** `documentId#índice`. */
  id: string;
  index: number;
  location: ChunkLocation;
  sourceKey: string;
  text: string;
  /** El vector y con qué modelo se calculó (`embeddingKey`); null si no hay. */
  vector: { data: Int8Array; key: string; scale: number } | null;
}

export type SemanticDocumentStatus = "ready" | "no-text" | "error";

export interface SemanticDocumentRecord {
  chunkCount: number;
  chunkerVersion: number;
  documentId: string;
  /** Fragmentos con vector del modelo de `embeddingKey`. */
  embeddedCount: number;
  embeddingKey: string | null;
  error: string | null;
  indexedAt: string;
  sourceKey: string;
  status: SemanticDocumentStatus;
  truncated: boolean;
  /** La versión del libro que se troceó: si cambia, se vuelve a trocear. */
  version: string;
}

const databaseName = "pliegue-semantic-index";
const databaseVersion = 1;
const chunkStore = "chunks";
const documentStore = "documents";
const byDocument = "byDocument";

export const chunkId = (documentId: string, index: number) => `${documentId}#${index}`;

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
        const database = request.result;
        if (!database.objectStoreNames.contains(chunkStore)) {
          database.createObjectStore(chunkStore, { keyPath: "id" }).createIndex(byDocument, "documentId");
        }
        if (!database.objectStoreNames.contains(documentStore)) database.createObjectStore(documentStore, { keyPath: "documentId" });
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new Error("El índice de búsqueda está abierto en otra pestaña.")), { once: true });
  });
}

const available = () => typeof indexedDB !== "undefined";

/* ---- Avisar a la interfaz -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
let documentsSnapshot: SemanticDocumentRecord[] = [];
let loaded = false;
/** Sube con cada cambio: la búsqueda rehace su índice en memoria si cambió. */
let generation = 0;

function changed(documents?: SemanticDocumentRecord[]) {
  generation += 1;
  if (documents) documentsSnapshot = documents;
  corpusCache = null;
  for (const listener of listeners) listener();
}

export async function readSemanticDocuments(): Promise<SemanticDocumentRecord[]> {
  if (!available()) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(documentStore, "readonly");
    const records = await requestResult(transaction.objectStore(documentStore).getAll() as IDBRequest<SemanticDocumentRecord[]>);
    await transactionComplete(transaction);
    return records;
  } finally {
    database.close();
  }
}

async function refreshDocuments() {
  const documents = await readSemanticDocuments().catch(() => documentsSnapshot);
  loaded = true;
  changed(documents);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) void refreshDocuments();
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot: SemanticDocumentRecord[] = [];

/** Las fichas del índice, para el estado («38 libros indexados»). */
export function useSemanticDocuments() {
  return useSyncExternalStore(subscribe, () => documentsSnapshot, () => serverSnapshot);
}

/* ---- Leer y escribir ------------------------------------------------------------------------------ */

export async function readDocumentChunks(documentId: string): Promise<SemanticChunkRecord[]> {
  if (!available()) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(chunkStore, "readonly");
    const records = await requestResult(
      transaction.objectStore(chunkStore).index(byDocument).getAll(documentId) as IDBRequest<SemanticChunkRecord[]>,
    );
    await transactionComplete(transaction);
    return records.sort((left, right) => left.index - right.index);
  } finally {
    database.close();
  }
}

/**
 * Cambia los fragmentos de un libro por los nuevos y guarda su ficha. Un fragmento que ya existía
 * con el mismo texto conserva su vector (`carry`): solo se recalcula lo que cambió.
 */
export async function replaceDocumentChunks(
  record: Omit<SemanticDocumentRecord, "embeddedCount">,
  chunks: readonly TextChunk[],
  previous: readonly SemanticChunkRecord[],
) {
  const vectors = new Map(previous.filter((chunk) => chunk.vector).map((chunk) => [chunk.hash, chunk.vector]));
  const next: SemanticChunkRecord[] = chunks.map((chunk) => ({
    documentId: record.documentId,
    hash: chunk.hash,
    id: chunkId(record.documentId, chunk.index),
    index: chunk.index,
    location: chunk.location,
    sourceKey: record.sourceKey,
    text: chunk.text,
    vector: vectors.get(chunk.hash) ?? null,
  }));
  const embeddedCount = record.embeddingKey ? next.filter((chunk) => chunk.vector?.key === record.embeddingKey).length : 0;
  const database = await openDatabase();
  try {
    const transaction = database.transaction([chunkStore, documentStore], "readwrite");
    const store = transaction.objectStore(chunkStore);
    const keys = await requestResult(store.index(byDocument).getAllKeys(record.documentId));
    for (const key of keys) store.delete(key);
    for (const chunk of next) store.put(chunk);
    transaction.objectStore(documentStore).put({ ...record, embeddedCount });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await refreshDocuments();
  return next;
}

/**
 * Guarda los vectores recién calculados de unos fragmentos y actualiza la ficha del libro. Si el
 * fragmento cambió mientras tanto (se volvió a trocear), su texto ya no es el del vector: no se
 * guarda.
 */
export async function saveChunkVectors(
  documentId: string,
  key: string,
  vectors: ReadonlyArray<{ hash: string; id: string; vector: QuantizedVector }>,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([chunkStore, documentStore], "readwrite");
    const chunks = transaction.objectStore(chunkStore);
    for (const { hash, id, vector } of vectors) {
      const record = await requestResult(chunks.get(id) as IDBRequest<SemanticChunkRecord | undefined>);
      if (record?.hash === hash) chunks.put({ ...record, vector: { data: vector.data, key, scale: vector.scale } });
    }
    const all = await requestResult(chunks.index(byDocument).getAll(documentId) as IDBRequest<SemanticChunkRecord[]>);
    const documents = transaction.objectStore(documentStore);
    const document = await requestResult(documents.get(documentId) as IDBRequest<SemanticDocumentRecord | undefined>);
    if (document) {
      documents.put({ ...document, embeddedCount: all.filter((chunk) => chunk.vector?.key === key).length, embeddingKey: key });
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await refreshDocuments();
}

/** Guarda solo la ficha (un libro sin texto, o con error). */
export async function saveSemanticDocument(record: SemanticDocumentRecord) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([chunkStore, documentStore], "readwrite");
    if (record.status !== "ready") {
      const store = transaction.objectStore(chunkStore);
      const keys = await requestResult(store.index(byDocument).getAllKeys(record.documentId));
      for (const key of keys) store.delete(key);
    }
    transaction.objectStore(documentStore).put(record);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await refreshDocuments();
}

/** Borra el índice de estos libros y dice cuántos fragmentos había. */
export async function removeSemanticDocuments(documentIds: readonly string[]) {
  if (!documentIds.length || !available()) return 0;
  const database = await openDatabase();
  let removed = 0;
  try {
    const transaction = database.transaction([chunkStore, documentStore], "readwrite");
    const chunks = transaction.objectStore(chunkStore);
    const documents = transaction.objectStore(documentStore);
    for (const documentId of new Set(documentIds)) {
      const keys = await requestResult(chunks.index(byDocument).getAllKeys(documentId));
      for (const key of keys) chunks.delete(key);
      removed += keys.length;
      documents.delete(documentId);
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await refreshDocuments();
  return removed;
}

export async function clearSemanticIndex() {
  if (!available()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction([chunkStore, documentStore], "readwrite");
    transaction.objectStore(chunkStore).clear();
    transaction.objectStore(documentStore).clear();
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
  await refreshDocuments();
}

/* ---- Lo que usa la búsqueda, en memoria --------------------------------------------------------------- */

export interface SearchCorpus {
  chunks: SemanticChunkRecord[];
  generation: number;
  lexical: LexicalIndex;
}

let corpusCache: Promise<SearchCorpus> | null = null;

/**
 * Todos los fragmentos y su índice por palabras, en memoria. Se arma la primera vez que se busca
 * y se rehace solo si el índice cambió.
 */
export function loadSearchCorpus(): Promise<SearchCorpus> {
  if (corpusCache) return corpusCache;
  const at = generation;
  corpusCache = (async () => {
    if (!available()) return { chunks: [], generation: at, lexical: buildLexicalIndex([]) };
    const database = await openDatabase();
    try {
      const transaction = database.transaction(chunkStore, "readonly");
      const chunks = await requestResult(transaction.objectStore(chunkStore).getAll() as IDBRequest<SemanticChunkRecord[]>);
      await transactionComplete(transaction);
      return { chunks, generation: at, lexical: buildLexicalIndex(chunks.map((chunk) => chunk.text)) };
    } finally {
      database.close();
    }
  })();
  corpusCache.catch(() => {
    corpusCache = null;
  });
  return corpusCache;
}
