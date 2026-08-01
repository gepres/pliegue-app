"use client";

import { useSyncExternalStore } from "react";

const storageKey = "pliegue-library-favorites-v1";
const changeEvent = "pliegue-library-favorites-change";
const emptyFavorites: string[] = [];

let cachedSerialized: string | null | undefined;
let cachedFavorites = emptyFavorites;

function readFavorites() {
  const serialized = window.localStorage.getItem(storageKey);
  if (serialized === cachedSerialized) return cachedFavorites;

  cachedSerialized = serialized;

  try {
    const parsed: unknown = serialized ? JSON.parse(serialized) : [];
    cachedFavorites = Array.isArray(parsed)
      ? [...new Set(parsed.filter((value): value is string => typeof value === "string"))]
      : emptyFavorites;
  } catch {
    cachedFavorites = emptyFavorites;
  }

  return cachedFavorites;
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

export function toggleFavorite(documentId: string) {
  const favorites = readFavorites();
  const next = favorites.includes(documentId)
    ? favorites.filter((id) => id !== documentId)
    : [...favorites, documentId];
  const serialized = JSON.stringify(next);

  cachedSerialized = serialized;
  cachedFavorites = next;
  window.localStorage.setItem(storageKey, serialized);
  window.dispatchEvent(new Event(changeEvent));
}

export function useFavorites() {
  return useSyncExternalStore(subscribe, readFavorites, () => emptyFavorites);
}
