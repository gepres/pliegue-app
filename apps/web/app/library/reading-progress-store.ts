"use client";

import { useSyncExternalStore } from "react";

import {
  documentFormats,
  type DocumentFormat,
  type DocumentOrigin,
  type LibraryDocument,
} from "./documents";

const storageKey = "pliegue-reading-progress-v1";
const changeEvent = "pliegue-reading-progress-change";
const emptyProgress: ReadingProgressRecord[] = [];
const supportedFormats = new Set<string>(documentFormats);

/**
 * La versión 2 corrige un avance que nunca fue cierto.
 *
 * Hasta ella el PDF se mostraba con el visor del navegador, que se desplaza por dentro y no
 * dice por dónde va. El avance se calculaba entonces con el desplazamiento de la página de
 * la aplicación, así que bastaba bajar hasta el pie para que un documento de cuarenta y nueve
 * páginas quedara marcado como leído entero sin haber pasado de la primera.
 *
 * Esas cifras no se pueden reinterpretar —no guardan relación con el documento—, y como el
 * avance no admite retrocesos se quedarían ahí para siempre. Se descartan una vez: los PDF
 * vuelven a cero y se recuentan solos, ahora en páginas. El resto de formatos se medía sobre
 * contenido que Pliegue compone él mismo, donde la medición sí era correcta, y se conserva.
 */
const currentVersion = 2;

export interface ReadingProgressRecord {
  documentId: string;
  format: DocumentFormat;
  origin: DocumentOrigin;
  percent: number;
  title: string;
  updatedAt: string;
}

interface StoredProgress {
  entries: ReadingProgressRecord[];
  version: number;
}

/** Descarta el avance de los PDF medido antes de que el visor contara páginas. */
export function migrateProgressEntries(
  entries: readonly ReadingProgressRecord[],
  storedVersion: number,
) {
  if (storedVersion >= currentVersion) return [...entries];
  return entries.map((entry) =>
    entry.format === "pdf" ? { ...entry, percent: 0 } : { ...entry },
  );
}

let cachedSerialized: string | null | undefined;
let cachedProgress = emptyProgress;

function normalizePercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProgressRecord(value: unknown): value is ReadingProgressRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ReadingProgressRecord>;

  return (
    typeof record.documentId === "string" &&
    record.documentId.length > 0 &&
    typeof record.title === "string" &&
    typeof record.percent === "number" &&
    typeof record.updatedAt === "string" &&
    (record.origin === "drive" || record.origin === "local") &&
    typeof record.format === "string" &&
    supportedFormats.has(record.format) &&
    timestamp(record.updatedAt) > 0
  );
}

export function reconcileReadingProgress(
  current: ReadingProgressRecord | undefined,
  incoming: ReadingProgressRecord,
  allowRegression = false,
) {
  const normalizedIncoming = {
    ...incoming,
    percent: normalizePercent(incoming.percent),
  };
  if (!current) return normalizedIncoming;

  const currentTimestamp = timestamp(current.updatedAt);
  const incomingTimestamp = timestamp(normalizedIncoming.updatedAt);
  if (incomingTimestamp < currentTimestamp) return current;

  if (!allowRegression && normalizedIncoming.percent < current.percent) {
    return {
      ...normalizedIncoming,
      percent: current.percent,
    };
  }

  if (
    incomingTimestamp === currentTimestamp &&
    normalizedIncoming.percent === current.percent
  ) {
    return current;
  }

  return normalizedIncoming;
}

function parseProgress(serialized: string | null) {
  if (!serialized) return emptyProgress;

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object") return emptyProgress;
    const stored = parsed as Partial<StoredProgress>;
    const version = typeof stored.version === "number" ? stored.version : 0;
    if (version < 1 || version > currentVersion || !Array.isArray(stored.entries)) {
      return emptyProgress;
    }

    const entries = stored.entries
      .filter(isProgressRecord)
      .map((entry) => ({ ...entry, percent: normalizePercent(entry.percent) }));

    return migrateProgressEntries(entries, version).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  } catch {
    return emptyProgress;
  }
}

function readProgress() {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cachedProgress;
    cachedSerialized = serialized;
    cachedProgress = parseProgress(serialized);
  } catch {
    cachedProgress = emptyProgress;
  }

  return cachedProgress;
}

function writeProgress(entries: ReadingProgressRecord[]) {
  const next = [...entries].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const serialized = JSON.stringify({
    entries: next,
    version: currentVersion,
  } satisfies StoredProgress);

  try {
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
    cachedProgress = next;
    window.dispatchEvent(new Event(changeEvent));
  } catch {
    // Reading remains available when storage is disabled or its quota is exhausted.
  }
}

function subscribe(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    cachedSerialized = undefined;
    onStoreChange();
  }

  window.addEventListener(changeEvent, onStoreChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(changeEvent, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function saveReadingProgress(
  document: Pick<LibraryDocument, "format" | "id" | "origin" | "title">,
  percent: number,
  options: { allowRegression?: boolean; updatedAt?: string } = {},
) {
  const entries = readProgress();
  const current = entries.find((entry) => entry.documentId === document.id);
  const incoming: ReadingProgressRecord = {
    documentId: document.id,
    format: document.format,
    origin: document.origin,
    percent,
    title: document.title,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  };
  const nextRecord = reconcileReadingProgress(
    current,
    incoming,
    options.allowRegression,
  );
  const nextEntries = [nextRecord, ...entries.filter((entry) => entry.documentId !== document.id)];
  writeProgress(nextEntries);
  return nextRecord;
}

export function clearReadingProgress(documentId: string) {
  writeProgress(readProgress().filter((entry) => entry.documentId !== documentId));
}

export function useReadingProgressEntries() {
  return useSyncExternalStore(subscribe, readProgress, () => emptyProgress);
}

export function useReadingProgress(documentId: string) {
  return useReadingProgressEntries().find((entry) => entry.documentId === documentId);
}
