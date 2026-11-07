"use client";

import { useSyncExternalStore } from "react";

import { addProcessing, parseProcessingLog, pruneProcessing, type ProcessingEntry, type ProcessingEvent } from "./processing-log";

/**
 * El registro de la IA en este equipo (04.6). En localStorage, como el contador de gasto: es
 * pequeño (1.000 entradas como mucho) y se lee entero al abrir Ajustes. No viaja con la cuenta.
 * «Borrar los datos de este navegador» se lo lleva con lo demás, por su prefijo `pliegue-`.
 */

const storageKey = "pliegue-ai-processing-v1";
const changeEvent = "pliegue-ai-processing-change";

let cachedSerialized: string | null | undefined;
let cached: ProcessingEntry[] = [];

function read(): ProcessingEntry[] {
  if (typeof window === "undefined") return cached;
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cached;
    cachedSerialized = serialized;
    cached = parseProcessingLog(serialized ? JSON.parse(serialized) : []);
  } catch {
    cached = [];
  }
  return cached;
}

function write(next: ProcessingEntry[]) {
  cached = next;
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
  } catch {
    // Sin almacenamiento, el registro dura lo que la pestaña.
  }
  window.dispatchEvent(new Event(changeEvent));
}

/** Apunta un envío (o uno que el router no dejó salir). No falla nunca: el registro no frena nada. */
export function recordProcessing(event: ProcessingEvent) {
  if (typeof window === "undefined") return;
  try {
    const now = new Date();
    write(pruneProcessing(addProcessing(read(), event, now), now));
  } catch {
    // Un registro que no se pudo escribir no para una traducción.
  }
}

/** El registro de ahora, ya sin lo caducado. */
export function readProcessingLog() {
  const entries = read();
  const pruned = pruneProcessing(entries, new Date());
  // Lo caducado se va también al leer: quien no usa la IA en meses no lo arrastra.
  if (typeof window !== "undefined" && pruned.length !== entries.length) write(pruned);
  return pruned;
}

export function clearProcessingLog() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nada que borrar.
  }
  cached = [];
  cachedSerialized = null;
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey && event.key !== null) return;
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

const serverSnapshot: ProcessingEntry[] = [];

/** Se vuelve a pintar con cada envío apuntado o borrado. En el servidor, vacío. */
export function useProcessingLog() {
  return useSyncExternalStore(subscribe, read, () => serverSnapshot);
}
