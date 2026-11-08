"use client";

import { useSyncExternalStore } from "react";

import { publicConfig } from "../config/public-config";
import { bookSearchText, googleBooksUrl, parseGoogleOffers, storeById, storeFromLanguages, type BookLookup, type BookStore, type DigitalOffer } from "./book-stores";

/**
 * El país de la tienda y las ofertas digitales ya consultadas (06.2), en este equipo.
 * - El país sale del idioma del navegador hasta que la persona elige otro.
 * - Las ofertas de Google Play Libros se recuerdan 24 horas: el precio enseña siempre la fecha
 *   en que se consultó, y no se vuelve a preguntar a Google cada vez que se abre.
 */

const countryKey = "pliegue-book-store-v1";
const offersKey = "pliegue-book-offers-v1";
export const offersMaxAgeMs = 24 * 60 * 60 * 1000;
const maxCached = 200;

/* ---- El país ------------------------------------------------------------------------------------------ */

const listeners = new Set<() => void>();
let chosen: string | null | undefined;

function readChosen() {
  if (chosen !== undefined) return chosen;
  try {
    chosen = (JSON.parse(localStorage.getItem(countryKey) ?? "null") as { country?: string } | null)?.country ?? null;
  } catch {
    chosen = null;
  }
  return chosen;
}

/** La tienda elegida o, si no se eligió, la del idioma del navegador (null si no encaja ninguna). */
export function currentBookStore(): BookStore | null {
  return storeById(readChosen()) ?? (typeof navigator === "undefined" ? null : storeFromLanguages(navigator.languages ?? [navigator.language]));
}

export function setBookStore(id: string) {
  if (!storeById(id)) return;
  chosen = id;
  try {
    localStorage.setItem(countryKey, JSON.stringify({ country: id }));
  } catch {
    // Sin almacenamiento, la elección dura lo que la pestaña.
  }
  for (const listener of listeners) listener();
}

export function useBookStore() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentBookStore()?.id ?? null,
    () => null,
  );
}

/* ---- Ofertas digitales ------------------------------------------------------------------------------------ */

export type DigitalOffersResult =
  | { fetchedAt: string; offers: DigitalOffer[]; status: "ok" }
  /** Sin clave de Google o sin la Books API activada en ella: esa parte no se enseña. */
  | { status: "unavailable" };

interface CachedOffers {
  fetchedAt: string;
  key: string;
  offers: DigitalOffer[];
}

function readCache(): CachedOffers[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(offersKey) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as CachedOffers[]) : [];
  } catch {
    return [];
  }
}

function writeCache(entries: CachedOffers[]) {
  try {
    localStorage.setItem(offersKey, JSON.stringify(entries.slice(-maxCached)));
  } catch {
    // Sin almacenamiento, se vuelve a preguntar la próxima vez.
  }
}

/**
 * Las ofertas digitales de un libro en un país: de lo recordado si tiene menos de un día, o de
 * la Books API. Un fallo de la API (sin clave, sin la Books API activada, sin cuota) no es un
 * error para la persona: simplemente no hay precios digitales que enseñar.
 */
export async function lookupDigitalOffers(book: BookLookup, country: string, { fetcher = fetch, now = () => new Date() } = {}): Promise<DigitalOffersResult> {
  const apiKey = publicConfig.drive?.apiKey;
  if (!apiKey) return { status: "unavailable" };
  const key = `${country}|${bookSearchText(book).toLocaleLowerCase("es")}`;
  const cached = readCache().find((entry) => entry.key === key);
  if (cached && now().getTime() - Date.parse(cached.fetchedAt) < offersMaxAgeMs) {
    return { fetchedAt: cached.fetchedAt, offers: cached.offers, status: "ok" };
  }
  let response: Response;
  try {
    response = await fetcher(googleBooksUrl(book, country, apiKey));
  } catch {
    return { status: "unavailable" };
  }
  if (!response.ok) return { status: "unavailable" };
  const fetchedAt = now().toISOString();
  const offers = parseGoogleOffers(await response.json().catch(() => null), fetchedAt);
  writeCache([...readCache().filter((entry) => entry.key !== key), { fetchedAt, key, offers }]);
  return { fetchedAt, offers, status: "ok" };
}
