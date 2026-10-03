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

/** Marca o desmarca sin alternar: lo que llega de otro equipo dice el estado, no el gesto. */
export function setFavorite(documentId: string, favorite: boolean) {
  const favorites = readFavorites();
  if (favorites.includes(documentId) === favorite) return;
  const next = favorite ? [...favorites, documentId] : favorites.filter((id) => id !== documentId);
  const serialized = JSON.stringify(next);

  cachedSerialized = serialized;
  cachedFavorites = next;
  window.localStorage.setItem(storageKey, serialized);
  window.dispatchEvent(new Event(changeEvent));
}

export function useFavorites() {
  return useSyncExternalStore(subscribe, readFavorites, () => emptyFavorites);
}

/**
 * Una copia del libro pasa su favorito a la que guarda el estado: el libro es favorito si lo
 * era cualquiera de las dos. Ver `book-copies.ts`.
 */
export function transferFavorite(fromId: string, toId: string) {
  if (fromId === toId || !readFavorites().includes(fromId)) return false;
  setFavorite(toId, true);
  setFavorite(fromId, false);
  return true;
}

/** Los favoritos de ahora, fuera de React. */
export function readFavoriteIds() {
  return readFavorites();
}
