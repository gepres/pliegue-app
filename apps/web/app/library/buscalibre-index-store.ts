"use client";

import { useSyncExternalStore } from "react";

import { cloudClient } from "../cloud/supabase-client";
import { findInShard, groupIntoShards, shardOf, toIsbn13, type BuscalibreAvailability } from "./buscalibre-prices";

/**
 * El índice ISBN → producto de Buscalibre y los precios ya consultados (06.2b), **solo en el
 * navegador del admin**. Ni Supabase ni el servidor de Pliegue guardan nada del catálogo.
 * - El índice sale de los sitemaps de Buscalibre (unas 34 partes, ~850.000 libros), pedidos de
 *   uno en uno por `/api/buscalibre/indice`. Se guarda en 100 grupos en IndexedDB
 *   (`pliegue-buscalibre`); si una parte falla, el índice anterior se queda como estaba.
 * - El precio se recuerda 24 horas por país e ISBN, y siempre se enseña con su fecha.
 * «Borrar todo en este navegador» se lleva las dos cosas.
 */

const databaseName = "pliegue-buscalibre";
const databaseVersion = 1;
const shardsStore = "shards";
const metaStore = "meta";
const metaKey = "index";
const pricesKey = "pliegue-buscalibre-prices-v1";
export const priceMaxAgeMs = 24 * 60 * 60 * 1000;
const maxCachedPrices = 200;

export interface BuscalibreIndexMeta {
  /** Cuándo se armó (ISO 8601). */
  builtAt: string;
  /** Libros con ISBN-13 en el índice. */
  entries: number;
  parts: number;
}

export type BuscalibreIndexState =
  | { status: "loading" }
  | { status: "missing" }
  | { meta: BuscalibreIndexMeta; status: "ready" }
  | { done: number; meta: BuscalibreIndexMeta | null; status: "building"; total: number }
  | { message: string; meta: BuscalibreIndexMeta | null; status: "error" };

let state: BuscalibreIndexState = { status: "loading" };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: BuscalibreIndexState) {
  state = next;
  for (const listener of listeners) listener();
}

const metaOf = (current: BuscalibreIndexState) => ("meta" in current ? current.meta : null);

/* ---- IndexedDB ------------------------------------------------------------------------------------------------- */

function requestResult<Result>(request: IDBRequest<Result>) {
  return new Promise<Result>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);
    request.addEventListener(
      "upgradeneeded",
      () => {
        for (const name of [shardsStore, metaStore]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new Error("El índice de Buscalibre está abierto en otra pestaña.")), { once: true });
  });
}

async function withDatabase<Result>(work: (database: IDBDatabase) => Promise<Result>) {
  const database = await openDatabase();
  try {
    return await work(database);
  } finally {
    database.close();
  }
}

async function load() {
  if (typeof window === "undefined" || !("indexedDB" in window)) return emit({ status: "missing" });
  try {
    const meta = await withDatabase(async (database) => {
      const transaction = database.transaction(metaStore, "readonly");
      const value = await requestResult(transaction.objectStore(metaStore).get(metaKey) as IDBRequest<BuscalibreIndexMeta | undefined>);
      await transactionComplete(transaction);
      return value ?? null;
    });
    // Si mientras tanto empezó a armarse, no se pisa el progreso.
    if (state.status === "loading") emit(meta ? { meta, status: "ready" } : { status: "missing" });
  } catch {
    if (state.status === "loading") emit({ status: "missing" });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (state.status === "loading" && !loading) {
    loading = load().finally(() => {
      loading = null;
    });
  }
  return () => listeners.delete(listener);
}

const loadingState: BuscalibreIndexState = { status: "loading" };

/** El estado de ahora, fuera de React (para las pruebas). */
export const currentBuscalibreIndex = () => state;

export function useBuscalibreIndex() {
  return useSyncExternalStore(subscribe, () => state, () => loadingState);
}

/* ---- Hablar con las rutas del servidor ------------------------------------------------------------------------- */

async function accessToken() {
  try {
    return (await cloudClient()?.auth.getSession())?.data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

class RouteError extends Error {}

async function getJson<Result>(path: string, token: string): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new RouteError("Sin conexión con Pliegue. Revisa tu conexión y vuelve a intentarlo.");
  }
  const body = (await response.json().catch(() => null)) as (Result & { error?: string }) | null;
  if (!response.ok || !body) throw new RouteError(body?.error ?? "Pliegue no pudo hablar con Buscalibre ahora.");
  return body;
}

/* ---- Armar el índice ------------------------------------------------------------------------------------------- */

/**
 * Arma (o rehace) el índice con los sitemaps de la tienda del país: son los mismos en todos los
 * países, así que basta uno. Parte a parte, de una en una, con un reintento por parte. Solo al
 * final, con todo en la mano, se cambia lo guardado.
 */
export async function buildBuscalibreIndex(storeId: string) {
  if (state.status === "building") return;
  const previous = metaOf(state);
  const token = await accessToken();
  if (!token) return emit({ message: "Tu sesión caducó. Vuelve a entrar para preparar la lista.", meta: previous, status: "error" });
  emit({ done: 0, meta: previous, status: "building", total: 0 });
  try {
    const country = encodeURIComponent(storeId);
    const { parts } = await getJson<{ parts: number[] }>(`/api/buscalibre/indice?pais=${country}`, token);
    const entries: string[] = [];
    for (const [index, part] of parts.entries()) {
      let chunk: { entries: string } | null = null;
      for (let attempt = 0; attempt < 2 && !chunk; attempt += 1) {
        try {
          chunk = await getJson<{ entries: string }>(`/api/buscalibre/indice?pais=${country}&parte=${part}`, token);
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
      if (chunk?.entries) for (const line of chunk.entries.split("\n")) entries.push(line);
      emit({ done: index + 1, meta: previous, status: "building", total: parts.length });
    }
    const shards = groupIntoShards(entries);
    const meta: BuscalibreIndexMeta = { builtAt: new Date().toISOString(), entries: [...shards.values()].reduce((total, shard) => total + shard.split("\n").length - 2, 0), parts: parts.length };
    if (!meta.entries) throw new RouteError("La lista de Buscalibre llegó vacía. No se cambió nada.");
    await withDatabase(async (database) => {
      const transaction = database.transaction([shardsStore, metaStore], "readwrite");
      const store = transaction.objectStore(shardsStore);
      store.clear();
      for (const [shard, text] of shards) store.put(text, shard);
      transaction.objectStore(metaStore).put(meta, metaKey);
      await transactionComplete(transaction);
    });
    emit({ meta, status: "ready" });
  } catch (error) {
    const message = error instanceof RouteError ? error.message : "No se pudo guardar la lista en este navegador. No se cambió nada.";
    emit({ message, meta: previous, status: "error" });
  }
}

/** El número de producto de un ISBN en el índice guardado, o null. */
export async function findBuscalibreProduct(isbn: string) {
  return withDatabase(async (database) => {
    const transaction = database.transaction(shardsStore, "readonly");
    const shard = await requestResult(transaction.objectStore(shardsStore).get(shardOf(isbn)) as IDBRequest<string | undefined>);
    await transactionComplete(transaction);
    return shard ? findInShard(shard, isbn) : null;
  });
}

/* ---- El precio ------------------------------------------------------------------------------------------------- */

export type BuscalibrePriceResult =
  | { availability: BuscalibreAvailability; currency: string; fetchedAt: string; price: number; status: "found"; title: string; url: string }
  /** Está en el catálogo, pero en ese país no tiene precio (no se vende allí). */
  | { fetchedAt: string; status: "not-sold" }
  /** El ISBN no está en el índice. */
  | { status: "not-in-catalog" }
  | { message: string; status: "error" };

type KnownPrice = Extract<BuscalibrePriceResult, { status: "found" | "not-sold" }>;

interface CachedPrice {
  key: string;
  result: KnownPrice;
}

function readPrices(): CachedPrice[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(pricesKey) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as CachedPrice[]) : [];
  } catch {
    return [];
  }
}

function writePrices(entries: CachedPrice[]) {
  try {
    localStorage.setItem(pricesKey, JSON.stringify(entries.slice(-maxCachedPrices)));
  } catch {
    // Sin almacenamiento, se vuelve a preguntar la próxima vez.
  }
}

/**
 * El precio de un libro en la tienda del país: de lo recordado si tiene menos de un día; si no,
 * busca su número de producto en el índice y pide la ficha por `/api/buscalibre/precio`.
 */
export async function lookupBuscalibrePrice(storeId: string, rawIsbn: string, { now = () => new Date() } = {}): Promise<BuscalibrePriceResult> {
  const isbn = toIsbn13(rawIsbn);
  if (!isbn) return { status: "not-in-catalog" };
  const key = `${storeId}|${isbn}`;
  const cached = readPrices().find((entry) => entry.key === key);
  if (cached?.result && now().getTime() - Date.parse(cached.result.fetchedAt) < priceMaxAgeMs) return cached.result;
  let productId: string | null;
  try {
    productId = await findBuscalibreProduct(isbn);
  } catch {
    return { message: "No se pudo leer la lista de Buscalibre de este navegador.", status: "error" };
  }
  if (!productId) return { status: "not-in-catalog" };
  const token = await accessToken();
  if (!token) return { message: "Tu sesión caducó. Vuelve a entrar para ver el precio.", status: "error" };
  type Answer = { availability: BuscalibreAvailability; currency: string; fetchedAt: string; found: true; price: number; title: string; url: string } | { fetchedAt: string; found: false };
  let answer: Answer;
  try {
    answer = await getJson<Answer>(`/api/buscalibre/precio?pais=${encodeURIComponent(storeId)}&isbn=${isbn}&id=${productId}`, token);
  } catch (error) {
    return { message: error instanceof RouteError ? error.message : "No se pudo consultar el precio.", status: "error" };
  }
  const result: KnownPrice = answer.found
    ? { availability: answer.availability, currency: answer.currency, fetchedAt: answer.fetchedAt, price: answer.price, status: "found", title: answer.title, url: answer.url }
    : { fetchedAt: answer.fetchedAt, status: "not-sold" };
  writePrices([...readPrices().filter((entry) => entry.key !== key), { key, result }]);
  return result;
}
