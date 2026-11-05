"use client";

import { useCallback, useSyncExternalStore } from "react";

import { cleanEntry, cleanGlossary, glossaryLimits, type GlossaryEntry } from "./translation-glossary";

/**
 * Los glosarios de los libros, en este navegador: por libro y por idioma de destino. Son de la
 * persona, como sus notas: no se borran al desvincular un libro.
 */
const storageKey = "pliegue-translation-glossary-v1";

type StoredGlossaries = Record<string, Record<string, GlossaryEntry[]>>;

const empty: readonly GlossaryEntry[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: StoredGlossaries } | null = null;

function readAll(): StoredGlossaries {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return cache?.value ?? {};
  }
  if (cache && cache.raw === raw) return cache.value;
  const value: StoredGlossaries = {};
  try {
    const parsed = JSON.parse(raw ?? "{}") as Record<string, Record<string, unknown>>;
    for (const [documentId, byLanguage] of Object.entries(parsed ?? {})) {
      if (!byLanguage || typeof byLanguage !== "object") continue;
      for (const [language, entries] of Object.entries(byLanguage)) {
        const clean = cleanGlossary(entries);
        if (clean.length) (value[documentId] ??= {})[language] = clean;
      }
    }
  } catch {
    // Un valor roto no tumba la lectura: se empieza de cero.
  }
  cache = { raw, value };
  return value;
}

function writeAll(next: StoredGlossaries) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Sin almacenamiento, el glosario vale mientras la pestaña siga abierta.
    cache = { raw: null, value: next };
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Otra pestaña con el mismo libro también ve el término nuevo.
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readGlossary(documentId: string, language: string | null): readonly GlossaryEntry[] {
  if (!language) return empty;
  return readAll()[documentId]?.[language] ?? empty;
}

/** Añade o corrige un término. Devuelve `false` si no es válido o ya no caben más. */
export function saveGlossaryEntry(documentId: string, language: string, entry: GlossaryEntry) {
  const clean = cleanEntry(entry);
  if (!clean) return false;
  const all = readAll();
  const current = all[documentId]?.[language] ?? [];
  const others = current.filter((item) => item.source.toLocaleLowerCase() !== clean.source.toLocaleLowerCase());
  if (others.length >= glossaryLimits.entries) return false;
  writeAll({ ...all, [documentId]: { ...all[documentId], [language]: [...others, clean] } });
  return true;
}

export function removeGlossaryEntry(documentId: string, language: string, source: string) {
  const all = readAll();
  const current = all[documentId]?.[language] ?? [];
  const next = current.filter((item) => item.source !== source);
  if (next.length === current.length) return;
  const byLanguage = { ...all[documentId], [language]: next };
  if (!next.length) delete byLanguage[language];
  writeAll({ ...all, [documentId]: byLanguage });
}

/** El glosario de un libro hacia un idioma, y cómo cambiarlo. */
export function useBookGlossary(documentId: string, language: string | null) {
  const entries = useSyncExternalStore(
    subscribe,
    () => readGlossary(documentId, language),
    () => empty,
  );
  const save = useCallback(
    (entry: GlossaryEntry) => (language ? saveGlossaryEntry(documentId, language, entry) : false),
    [documentId, language],
  );
  const remove = useCallback(
    (source: string) => {
      if (language) removeGlossaryEntry(documentId, language, source);
    },
    [documentId, language],
  );
  return { entries, remove, save };
}
