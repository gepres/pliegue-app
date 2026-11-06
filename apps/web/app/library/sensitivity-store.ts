"use client";

import { useSyncExternalStore } from "react";

import type { LibraryDocument } from "./documents";
import {
  effectiveSensitivity,
  isSensitivity,
  type SensitiveFlow,
  type Sensitivity,
  type SensitivityMarks,
} from "./sensitivity";

/**
 * Lo marcado de sensibilidad (04.3) y los permisos de los libros personales, en este equipo.
 * Las fuentes son de cada equipo (una carpeta, una conexión de Drive) y los libros van por su id
 * de aquí, así que no viaja con la cuenta: cada equipo marca lo suyo.
 */

const storageKey = "pliegue-sensitivity-v1";
const changeEvent = "pliegue-sensitivity-change";

interface StoredSensitivity extends SensitivityMarks {
  /** Libros personales con permiso para salir del equipo, por flujo. */
  consents: Record<string, SensitiveFlow[]>;
}

const empty = (): StoredSensitivity => ({ consents: {}, documents: {}, sources: {} });

let cachedSerialized: string | null | undefined;
let cached: StoredSensitivity = empty();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function levels(value: unknown) {
  const result: Record<string, Sensitivity> = {};
  if (!isRecord(value)) return result;
  for (const [key, level] of Object.entries(value)) if (isSensitivity(level)) result[key] = level;
  return result;
}

function read(): StoredSensitivity {
  if (typeof window === "undefined") return cached;
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cached;
    cachedSerialized = serialized;
    const parsed: unknown = serialized ? JSON.parse(serialized) : null;
    const next = empty();
    if (isRecord(parsed)) {
      next.documents = levels(parsed.documents);
      next.sources = levels(parsed.sources);
      for (const [id, flows] of Object.entries(isRecord(parsed.consents) ? parsed.consents : {})) {
        if (Array.isArray(flows)) next.consents[id] = flows.filter((flow): flow is SensitiveFlow => flow === "catalog" || flow === "translate");
      }
    }
    cached = next;
  } catch {
    cached = empty();
  }
  return cached;
}

function write(next: StoredSensitivity) {
  cached = next;
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
  } catch {
    // Sin almacenamiento, la marca dura lo que la pestaña.
  }
  window.dispatchEvent(new Event(changeEvent));
}

/** La sensibilidad de un libro ahora (fuera de React: el catálogo y el lector la consultan). */
export function documentSensitivity(document: Pick<LibraryDocument, "id" | "reference">) {
  return effectiveSensitivity(document, read());
}

export function sensitivityMarks(): SensitivityMarks {
  return read();
}

/** Marca una fuente; `null` la deja sin marcar (interno). */
export function setSourceSensitivity(sourceKey: string, level: Sensitivity | null) {
  const stored = read();
  const sources = { ...stored.sources };
  if (level) sources[sourceKey] = level;
  else delete sources[sourceKey];
  write({ ...stored, sources });
}

/** Marca un libro; `null` vuelve a la de su fuente. */
export function setDocumentSensitivity(documentId: string, level: Sensitivity | null) {
  const stored = read();
  const documents = { ...stored.documents };
  if (level) documents[documentId] = level;
  else delete documents[documentId];
  write({ ...stored, documents });
}

export function hasConsent(documentId: string, flow: SensitiveFlow) {
  return read().consents[documentId]?.includes(flow) ?? false;
}

/** «Sí, envíalo»: vale para ese libro y ese flujo, y se recuerda. */
export function grantConsent(documentIds: readonly string[], flow: SensitiveFlow) {
  const stored = read();
  const consents = { ...stored.consents };
  for (const id of documentIds) consents[id] = [...new Set([...(consents[id] ?? []), flow])];
  write({ ...stored, consents });
}

function subscribe(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    cachedSerialized = undefined;
    listener();
  }
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

const serverSnapshot = empty();

/** Lo marcado, para la interfaz. En el servidor, nada (todo «interno»). */
export function useSensitivityMarks(): SensitivityMarks {
  return useSyncExternalStore(subscribe, read, () => serverSnapshot);
}

export function useDocumentSensitivity(document: Pick<LibraryDocument, "id" | "reference">) {
  return effectiveSensitivity(document, useSensitivityMarks());
}
