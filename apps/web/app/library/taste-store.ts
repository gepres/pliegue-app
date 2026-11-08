"use client";

import { useSyncExternalStore } from "react";

import type { LibraryDocument } from "./documents";
import { readFavoriteIds } from "./favorite-store";
import { coverQueryFor, normalizeTitle } from "./open-library-covers";
import {
  emptyTasteProfile,
  librarySignals,
  openLibraryUrl,
  parseCandidates,
  parseTasteProfile,
  rankRecommendations,
  recommendationQueries,
  type LibraryBookSignal,
  type Recommendation,
  type TasteProfile,
} from "./recommendations";
import { documentSensitivity } from "./sensitivity-store";

/**
 * Los gustos y las recomendaciones (06.1), solo en este equipo: no se sincronizan.
 * «Borrar mis gustos» y «Desactivar» los quitan, con lo recomendado.
 */

const profileKey = "pliegue-taste-v1";
const cacheKey = "pliegue-recommendations-v1";
export const recommendationsMaxAgeMs = 24 * 60 * 60 * 1000;

const listeners = new Set<() => void>();
let profile: TasteProfile | null = null;

function readProfile() {
  if (profile) return profile;
  try {
    profile = parseTasteProfile(JSON.parse(localStorage.getItem(profileKey) ?? "null"));
  } catch {
    profile = emptyTasteProfile;
  }
  return profile;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTasteProfile() {
  return useSyncExternalStore(subscribe, readProfile, () => emptyTasteProfile);
}

function readCachedRaw() {
  try {
    return localStorage.getItem(cacheKey);
  } catch {
    return null;
  }
}

/**
 * Lo último que se recomendó, sin preguntar a nadie: el adelanto de Inicio. Lo descartado no
 * sale; con las recomendaciones desactivadas, nada.
 */
export function useCachedRecommendations(current: TasteProfile): Recommendation[] {
  const raw = useSyncExternalStore(subscribe, readCachedRaw, () => null);
  if (!current.enabled || !raw) return [];
  try {
    const cached = JSON.parse(raw) as CachedRecommendations | null;
    return (cached?.items ?? []).filter((item) => !current.dismissed.includes(item.key));
  } catch {
    return [];
  }
}

export function saveTasteProfile(next: Omit<TasteProfile, "updatedAt">) {
  profile = parseTasteProfile({ ...next, updatedAt: new Date().toISOString() });
  try {
    localStorage.setItem(profileKey, JSON.stringify(profile));
  } catch {
    // Sin almacenamiento, duran lo que la pestaña.
  }
  emit();
}

export function dismissRecommendation(key: string) {
  const current = readProfile();
  saveTasteProfile({ ...current, dismissed: [...current.dismissed, key] });
}

/** «Borrar mis gustos»: fuera los gustos, los descartes y lo recomendado. */
export function clearTaste() {
  profile = emptyTasteProfile;
  try {
    localStorage.removeItem(profileKey);
    localStorage.removeItem(cacheKey);
  } catch {
    // Nada que borrar.
  }
  emit();
}

/** «Desactivar»: deja de recomendar y olvida lo recomendado; los gustos se quedan por si vuelve. */
export function disableRecommendations() {
  saveTasteProfile({ ...readProfile(), enabled: false });
  try {
    localStorage.removeItem(cacheKey);
  } catch {
    // Nada que borrar.
  }
  emit();
}

/**
 * Lo que la biblioteca dice de los gustos, sin los libros confidenciales ni los personales:
 * autores y géneros de las fichas (o el autor del nombre «Título - Autor»), y los favoritos.
 */
export function librarySignalsFor(documents: readonly LibraryDocument[]) {
  const favorites = new Set(readFavoriteIds());
  const books: LibraryBookSignal[] = [];
  for (const document of documents) {
    const level = documentSensitivity(document);
    if (level === "confidencial" || level === "personal") continue;
    const query = coverQueryFor(document);
    if (!query) continue;
    books.push({
      authors: query.authors,
      favorite: favorites.has(document.id),
      genres: [...(document.catalog?.genres ?? []), ...(document.catalog?.topics ?? [])],
      title: query.title,
    });
  }
  return librarySignals(books);
}

interface CachedRecommendations {
  fetchedAt: string;
  items: Recommendation[];
  signature: string;
}

export interface RecommendationsResult {
  fetchedAt: string;
  items: Recommendation[];
  /** Búsquedas que no respondieron (sin conexión, Open Library caída). */
  failed: number;
  searched: number;
}

/**
 * Busca en Open Library con los gustos (y, con permiso, la biblioteca), quita lo que ya se tiene
 * y ordena. Lo recomendado se recuerda un día para los mismos gustos.
 */
export async function loadRecommendations(
  current: TasteProfile,
  documents: readonly LibraryDocument[],
  { fetcher = fetch, force = false, now = () => new Date() }: { fetcher?: typeof fetch; force?: boolean; now?: () => Date } = {},
): Promise<RecommendationsResult> {
  const signals = current.useLibrary ? librarySignalsFor(documents) : null;
  const queries = recommendationQueries(current, signals);
  const signature = JSON.stringify(queries.map((query) => [query.kind, query.value, query.source]));
  const owned = documents.map((document) => coverQueryFor(document) ?? { authors: [], title: document.title });
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as CachedRecommendations | null;
      if (cached?.signature === signature && now().getTime() - Date.parse(cached.fetchedAt) < recommendationsMaxAgeMs) {
        // Lo recordado, sin lo descartado ni lo que se añadió a la biblioteca desde entonces.
        const ownedTitles = new Set(owned.map((book) => normalizeTitle(book.title)));
        const items = cached.items.filter((item) => !current.dismissed.includes(item.key) && !ownedTitles.has(normalizeTitle(item.title)));
        return { failed: 0, fetchedAt: cached.fetchedAt, items, searched: queries.length };
      }
    } catch {
      // Lo recordado no se puede leer: se vuelve a buscar.
    }
  }
  let failed = 0;
  const results = await Promise.all(
    queries.map(async (query) => {
      try {
        const response = await fetcher(openLibraryUrl(query));
        if (!response.ok) throw new Error(String(response.status));
        return { candidates: parseCandidates(await response.json()), query };
      } catch {
        failed += 1;
        return { candidates: [], query };
      }
    }),
  );
  const items = rankRecommendations(results, { dismissed: current.dismissed, owned });
  const fetchedAt = now().toISOString();
  if (!failed) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt, items, signature } satisfies CachedRecommendations));
      emit();
    } catch {
      // Sin almacenamiento, se busca de nuevo la próxima vez.
    }
  }
  return { failed, fetchedAt, items, searched: queries.length };
}
