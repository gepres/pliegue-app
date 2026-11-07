"use client";

import { useSyncExternalStore } from "react";

import { emptyLatency, parseLatency, type LatencyState } from "./sync-latency";
import type { SyncConflict } from "./sync-runner";

/**
 * Lo que la sincronización recuerda en este equipo, por cuenta (06.3):
 * - los conflictos recientes, con la versión que perdió, para poder restaurarla;
 * - las medidas de latencia, para ver si se cumple el SLO de 60 s.
 */

const conflictsKey = "pliegue-sync-conflicts-v1";
const latencyKey = "pliegue-sync-latency-v1";
const changeEvent = "pliegue-sync-history-change";
/** Los últimos, y de los últimos 30 días: es para deshacer un choque reciente, no un archivo. */
const maxConflicts = 50;
const maxAgeMs = 30 * 24 * 60 * 60 * 1000;

export interface StoredConflict extends SyncConflict {
  at: string;
  id: string;
  restoredAt: string | null;
}

function readAll<T>(key: string): Record<string, T> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeOne(key: string, userId: string, value: unknown) {
  try {
    // Solo la cuenta con sesión, como el registro de actividad.
    window.localStorage.setItem(key, JSON.stringify({ [userId]: value }));
  } catch {
    // Sin almacenamiento, dura lo que la pestaña.
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function listConflicts(userId: string): StoredConflict[] {
  const list = readAll<StoredConflict[]>(conflictsKey)[userId];
  if (!Array.isArray(list)) return [];
  const oldest = Date.now() - maxAgeMs;
  return list.filter((item) => item && typeof item.id === "string" && Date.parse(item.at) >= oldest);
}

export function addConflicts(userId: string, conflicts: readonly SyncConflict[], at = new Date().toISOString()) {
  if (!conflicts.length) return;
  const added = conflicts.map((conflict, index) => ({
    ...conflict,
    at,
    id: `${at}-${index}-${conflict.collection}-${conflict.key}`.slice(0, 200),
    restoredAt: null,
  }));
  writeOne(conflictsKey, userId, [...added, ...listConflicts(userId)].slice(0, maxConflicts));
}

export function markRestored(userId: string, id: string) {
  const now = new Date().toISOString();
  writeOne(
    conflictsKey,
    userId,
    listConflicts(userId).map((item) => (item.id === id ? { ...item, restoredAt: now } : item)),
  );
}

export function loadLatency(userId: string): LatencyState {
  return parseLatency(readAll<unknown>(latencyKey)[userId] ?? emptyLatency());
}

export function saveLatency(userId: string, state: LatencyState) {
  writeOne(latencyKey, userId, state);
}

/* ---- Para la interfaz ------------------------------------------------------------------------- */

let cachedUser: string | null = null;
let cachedSerialized: string | null = null;
let cachedList: StoredConflict[] = [];
const serverList: StoredConflict[] = [];

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === conflictsKey) listener();
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSyncConflicts(userId: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!userId) return serverList;
      const serialized = window.localStorage.getItem(conflictsKey);
      if (userId !== cachedUser || serialized !== cachedSerialized) {
        cachedUser = userId;
        cachedSerialized = serialized;
        cachedList = listConflicts(userId);
      }
      return cachedList;
    },
    () => serverList,
  );
}
