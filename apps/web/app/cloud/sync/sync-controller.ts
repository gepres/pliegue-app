"use client";

import { useSyncExternalStore } from "react";

import type { LibraryDocument } from "../../library/documents";
import { currentAccount } from "../account-store";
import { cloudClient } from "../supabase-client";
import { syncCollections, type LocalSnapshot } from "./collections";
import { indexLibraryKeys } from "./document-key";
import { isSyncHeld, onSyncReleased } from "./sync-hold";
import { MassDeletionError, runSync } from "./sync-runner";
import { indexedDbSyncState } from "./sync-state-idb";
import { supabaseRemote } from "./supabase-remote";

/* ---- Qué se sincroniza, por cuenta y en este equipo ------------------------------------ */

export interface SyncChoices {
  /** Fichas generadas por la IA: derivados, solo con consentimiento (ADR-0002, gate 4). */
  catalogAi: boolean;
  /** La persona pulsó «Empezar a sincronizar» con esta cuenta en este equipo. */
  enabled: boolean;
}

const choicesKey = "pliegue-cloud-sync-v1";
const defaultChoices: SyncChoices = { catalogAi: true, enabled: false };
const choicesListeners = new Set<() => void>();
let cachedChoicesSerialized: string | null | undefined;
let cachedChoices: Record<string, SyncChoices> = {};

function readAllChoices(): Record<string, SyncChoices> {
  try {
    const serialized = window.localStorage.getItem(choicesKey);
    if (serialized === cachedChoicesSerialized) return cachedChoices;
    cachedChoicesSerialized = serialized;
    cachedChoices = serialized ? (JSON.parse(serialized) as Record<string, SyncChoices>) : {};
  } catch {
    cachedChoices = {};
  }
  return cachedChoices;
}

export function syncChoicesFor(userId: string | null): SyncChoices {
  if (!userId) return defaultChoices;
  return { ...defaultChoices, ...readAllChoices()[userId] };
}

export function setSyncChoices(userId: string, choices: Partial<SyncChoices>) {
  const next = { ...readAllChoices(), [userId]: { ...syncChoicesFor(userId), ...choices } };
  try {
    window.localStorage.setItem(choicesKey, JSON.stringify(next));
  } catch {
    // Sin almacenamiento, la elección dura lo que la pestaña.
  }
  cachedChoicesSerialized = undefined;
  for (const listener of choicesListeners) listener();
}

export function useSyncChoices(userId: string | null) {
  useSyncExternalStore(
    (listener) => {
      choicesListeners.add(listener);
      return () => choicesListeners.delete(listener);
    },
    () => readAllChoices(),
    () => cachedChoices,
  );
  return syncChoicesFor(userId);
}

/* ---- Estado visible ------------------------------------------------------------------- */

export interface SyncStatus {
  /** Borrados que la red de seguridad retuvo a la espera de que la persona los confirme. */
  blockedDeletions: number | null;
  error: string | null;
  lastSyncedAt: string | null;
  state: "error" | "idle" | "offline" | "syncing";
}

let status: SyncStatus = { blockedDeletions: null, error: null, lastSyncedAt: null, state: "idle" };
const statusListeners = new Set<() => void>();

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  for (const listener of statusListeners) listener();
}

export function useSyncStatus() {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => status,
    () => status,
  );
}

/* ---- De dónde sale lo local ------------------------------------------------------------ */

export interface LocalSource {
  documents: readonly LibraryDocument[];
  /** Todos los almacenes cargados. Antes, un almacén vacío parecería un borrado. */
  ready: boolean;
  snapshot: LocalSnapshot;
}

let readLocal: (() => LocalSource | null) | null = null;

/** El componente que lee los almacenes con sus hooks se registra aquí. */
export function registerLocalSource(reader: (() => LocalSource | null) | null) {
  readLocal = reader;
}

function deviceId() {
  const key = "pliegue-device-id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return "sin-almacenamiento";
  }
}

/* ---- Ejecutar ------------------------------------------------------------------------- */

let running: Promise<void> | null = null;
let again = false;
/** La persona confirmó los borrados retenidos: la próxima vuelta puede subirlos. */
let confirmDeletions = false;

async function syncOnce(allowMassDeletion: boolean) {
  // Alguien está dejando el estado a medias (un escaneo de carpeta): se sincroniza al soltar.
  if (isSyncHeld()) return;
  const account = currentAccount();
  const client = cloudClient();
  const local = readLocal?.();
  if (account.status !== "signed-in" || !account.userId || !client || !local?.ready) return;
  const choices = syncChoicesFor(account.userId);
  if (!choices.enabled) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStatus({ state: "offline" });
    return;
  }

  setStatus({ error: null, state: "syncing" });
  try {
    await runSync({
      allowMassDeletion,
      collections: syncCollections,
      context: {
        keys: await indexLibraryKeys(local.documents),
        local: local.snapshot,
        now: new Date().toISOString(),
      },
      enabled: (collection) => collection.consent !== "catalogAi" || choices.catalogAi,
      remote: supabaseRemote(client, account.userId, deviceId()),
      stateStore: indexedDbSyncState(account.userId),
    });
    setStatus({ blockedDeletions: null, error: null, lastSyncedAt: new Date().toISOString(), state: "idle" });
  } catch (error) {
    if (error instanceof MassDeletionError) {
      setStatus({ blockedDeletions: error.deletions, error: error.message, state: "error" });
      return;
    }
    setStatus({
      blockedDeletions: null,
      error:
        error instanceof Error && /relation .*sync_items|does not exist|schema cache/i.test(error.message)
          ? "La base de datos aún no tiene la tabla de sincronización: falta aplicar la migración."
          : error instanceof Error
            ? error.message
            : "No fue posible sincronizar.",
      state: "error",
    });
  }
}

/**
 * Pide una sincronización. Si ya hay una en marcha, se hace otra al terminar —con lo que haya
 * cambiado mientras— en vez de lanzar dos a la vez sobre la misma base.
 */
export function requestSync({ allowMassDeletion = false }: { allowMassDeletion?: boolean } = {}) {
  if (allowMassDeletion) confirmDeletions = true;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      // El permiso para borrar vale para la vuelta que lo pidió, no para las siguientes.
      const allow = confirmDeletions;
      confirmDeletions = false;
      await syncOnce(allow);
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

// Al soltar la última retención (fin de un escaneo), se sincroniza con el estado ya completo.
onSyncReleased(() => void requestSync());
