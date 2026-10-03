"use client";

import { useSyncExternalStore } from "react";

import { defaultReadingFilter, parseReadingFilter, type ReadingFilterState } from "./reading-filter";

/** En este equipo, como el ancho de línea: depende de la pantalla y de la luz, no de la cuenta. */
const storageKey = "pliegue-reading-filter-v1";
const changeEvent = "pliegue-reading-filter-change";

let cachedSerialized: string | null | undefined;
let cachedState = defaultReadingFilter;

function readReadingFilter(): ReadingFilterState {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cachedState;
    cachedSerialized = serialized;
    cachedState = parseReadingFilter(serialized ? JSON.parse(serialized) : null);
  } catch {
    cachedState = defaultReadingFilter;
  }
  return cachedState;
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

export function updateReadingFilter(change: Partial<Omit<ReadingFilterState, "version">>) {
  const state = parseReadingFilter({ ...readReadingFilter(), ...change });
  const serialized = JSON.stringify(state);
  try {
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
  } catch {
    // Sin almacenamiento, el filtro dura lo que la pestaña.
    cachedSerialized = undefined;
  }
  cachedState = state;
  window.dispatchEvent(new Event(changeEvent));
}

export function useReadingFilter() {
  return useSyncExternalStore(subscribe, readReadingFilter, () => defaultReadingFilter);
}
