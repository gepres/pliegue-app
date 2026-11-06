"use client";

import { useSyncExternalStore } from "react";

import type { LibraryDocument } from "./documents";

/**
 * Lo que la persona decidió sobre los libros repetidos (03.6), en este navegador:
 * - **marca:** este libro es una copia de aquel, que es el que se conserva; la Biblioteca puede
 *   ocultar las copias, como con las marcadas en el índice JSON (`duplicateOf`);
 * - **descarte:** estos dos no son el mismo libro; la búsqueda no vuelve a proponerlos.
 */

export interface DuplicateMark {
  decidedAt: string;
  documentId: string;
  /** El libro que se conserva. */
  duplicateOf: string;
  /** Su título, para enseñarlo aunque el libro deje de estar. */
  duplicateOfTitle: string;
  key: string;
  kind: "mark";
}

export interface DuplicateDismissal {
  decidedAt: string;
  ids: [string, string];
  key: string;
  kind: "dismiss";
}

export type DuplicateDecision = DuplicateDismissal | DuplicateMark;

interface Snapshot {
  records: DuplicateDecision[];
  status: "error" | "idle" | "loading" | "ready";
}

const databaseName = "pliegue-duplicates";
const storeName = "decisions";
const initial: Snapshot = { records: [], status: "idle" };
let snapshot = initial;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const markKey = (documentId: string) => `mark:${documentId}`;
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const dismissKey = (a: string, b: string) => `dismiss:${pairKey(a, b)}`;

function emit(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function requestResult<Result>(request: IDBRequest<Result>) {
  return new Promise<Result>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "key" });
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

async function write(work: (store: IDBObjectStore) => void) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    work(transaction.objectStore(storeName));
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    });
  } finally {
    database.close();
  }
  await load();
}

async function load() {
  if (typeof indexedDB === "undefined") {
    emit({ records: [], status: "ready" });
    return;
  }
  try {
    const database = await openDatabase();
    try {
      const records = await requestResult(database.transaction(storeName).objectStore(storeName).getAll() as IDBRequest<DuplicateDecision[]>);
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
  if (!loading && snapshot.status === "idle") {
    emit({ ...snapshot, status: "loading" });
    loading = load().finally(() => {
      loading = null;
    });
  }
  return () => listeners.delete(listener);
}

export function useDuplicateDecisions() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initial);
}

/** Lo decidido, leído de la base: para quien no está en un componente. */
export async function readDuplicateDecisions() {
  await load();
  return snapshot.records;
}

/** Marca `documentId` como copia de `main`, que es el que se conserva. */
export function markDuplicate(documentId: string, main: { id: string; title: string }) {
  const record: DuplicateMark = {
    decidedAt: new Date().toISOString(),
    documentId,
    duplicateOf: main.id,
    duplicateOfTitle: main.title,
    key: markKey(documentId),
    kind: "mark",
  };
  return write((store) => {
    store.put(record);
    // El que se conserva no puede ser a la vez copia de otro: las marcas no encadenan.
    store.delete(markKey(main.id));
  });
}

export function unmarkDuplicate(documentId: string) {
  return write((store) => store.delete(markKey(documentId)));
}

/** Estos dos no son el mismo libro: la búsqueda no vuelve a proponerlos. */
export function dismissDuplicatePair(a: string, b: string) {
  const record: DuplicateDismissal = { decidedAt: new Date().toISOString(), ids: [a, b], key: dismissKey(a, b), kind: "dismiss" };
  return write((store) => store.put(record));
}

/** Lo decidido sobre esos documentos, al desvincularlos. Dice cuántas decisiones eran. */
export async function removeDuplicateDecisions(documentIds: readonly string[]) {
  if (typeof indexedDB === "undefined" || !documentIds.length) return 0;
  const ids = new Set(documentIds);
  const doomed = snapshot.status === "ready" ? snapshot.records : await (async () => {
    await load();
    return snapshot.records;
  })();
  const keys = doomed
    .filter((record) => (record.kind === "mark" ? ids.has(record.documentId) || ids.has(record.duplicateOf) : record.ids.some((id) => ids.has(id))))
    .map((record) => record.key);
  if (keys.length) await write((store) => keys.forEach((key) => store.delete(key)));
  return keys.length;
}

/**
 * Las marcas de la persona sobre los documentos de la Biblioteca: `organization.duplicateOf`
 * con el título del que se conserva, para que «Ocultar duplicados» y el aviso de la tarjeta
 * funcionen igual que con las del índice JSON. Una marca hecha aquí manda sobre la del índice.
 */
export function applyDuplicateMarks(documents: readonly LibraryDocument[], records: readonly DuplicateDecision[]) {
  const marks = new Map(records.flatMap((record) => (record.kind === "mark" ? [[record.documentId, record] as const] : [])));
  if (!marks.size) return documents as LibraryDocument[];
  return documents.map((document) => {
    const mark = marks.get(document.id);
    if (!mark) return document;
    return {
      ...document,
      organization: {
        category: document.organization?.category ?? null,
        subcategory: document.organization?.subcategory ?? null,
        ...document.organization,
        duplicateOf: mark.duplicateOfTitle,
      },
    };
  });
}
