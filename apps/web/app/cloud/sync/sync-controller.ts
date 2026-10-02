"use client";

import { useSyncExternalStore } from "react";

import type { LibraryDocument } from "../../library/documents";
import { currentAccount } from "../account-store";
import { cloudClient } from "../supabase-client";
import { syncCollections, type LocalSnapshot } from "./collections";
import { indexLibraryKeys } from "./document-key";
import {
  activityFromSummary,
  activityLimit,
  countBooks,
  recordActivity,
  type SyncActivity,
  type SyncBooks,
} from "./sync-activity";
import { isSyncHeld, onSyncReleased } from "./sync-hold";
import { MassDeletionError, runSync, type SyncSummary } from "./sync-runner";
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

export type { SyncBooks } from "./sync-activity";

export interface SyncStatus {
  /** Las últimas vueltas, la más reciente primero. */
  activity: SyncActivity[];
  /** Borrados que la red de seguridad retuvo a la espera de que la persona los confirme. */
  blockedDeletions: number | null;
  books: SyncBooks | null;
  /** Una comprobación en segundo plano en marcha: no cambia el texto, solo el icono. */
  checking: boolean;
  error: string | null;
  /** Última vuelta terminada sin errores, hubiera cambios o no. */
  lastSyncedAt: string | null;
  state: "error" | "idle" | "offline" | "syncing";
  /** Cómo quedó la cuenta en la última vuelta buena. */
  summary: SyncSummary | null;
  /** Cambios de este equipo que la última vuelta no pudo subir. */
  unsynced: number;
}

let status: SyncStatus = {
  activity: [],
  blockedDeletions: null,
  books: null,
  checking: false,
  error: null,
  lastSyncedAt: null,
  state: "idle",
  summary: null,
  unsynced: 0,
};
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

/* ---- Registro de las últimas vueltas, por cuenta ----------------------------------------- */

const activityKey = "pliegue-sync-activity-v1";
let activityUser: string | null = null;

function readActivity(userId: string): SyncActivity[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(activityKey) ?? "{}") as Record<string, SyncActivity[]>;
    return Array.isArray(stored[userId]) ? stored[userId].slice(0, activityLimit) : [];
  } catch {
    return [];
  }
}

function saveActivity(userId: string, activity: SyncActivity[]) {
  try {
    // Solo la cuenta con la que se está: el registro de otra no tiene por qué quedarse aquí.
    window.localStorage.setItem(activityKey, JSON.stringify({ [userId]: activity }));
  } catch {
    // Sin almacenamiento, el registro dura lo que la pestaña.
  }
}

function addActivity(userId: string, entry: SyncActivity) {
  const activity = recordActivity(status.activity, entry);
  saveActivity(userId, activity);
  return activity;
}


/* ---- Ejecutar ------------------------------------------------------------------------- */

/**
 * Por qué se pide una vuelta. Una comprobación periódica no cambia el texto del estado: en una
 * vuelta cada 45 s, «Sincronizando…» parpadeaba sin decir nada.
 */
export type SyncReason = "change" | "manual" | "poll";

const reasonWeight: Record<SyncReason, number> = { change: 1, manual: 2, poll: 0 };

let running: Promise<void> | null = null;
let again = false;
/** El motivo más visible de lo pedido mientras otra vuelta estaba en marcha. */
let queuedReason: SyncReason | null = null;
/** La persona confirmó los borrados retenidos: la próxima vuelta puede subirlos. */
let confirmDeletions = false;

function describeError(error: unknown) {
  if (error instanceof Error && /relation .*sync_items|does not exist|schema cache/i.test(error.message)) {
    return "La base de datos aún no tiene la tabla de sincronización: falta aplicar la migración.";
  }
  return error instanceof Error ? error.message : "No fue posible sincronizar.";
}

async function syncOnce(allowMassDeletion: boolean, reason: SyncReason) {
  // Alguien está dejando el estado a medias (un escaneo de carpeta): se sincroniza al soltar.
  if (isSyncHeld()) return;
  const account = currentAccount();
  const client = cloudClient();
  const local = readLocal?.();
  if (account.status !== "signed-in" || !account.userId || !client || !local?.ready) return;
  const userId = account.userId;
  const choices = syncChoicesFor(userId);
  if (!choices.enabled) return;
  if (activityUser !== userId) {
    activityUser = userId;
    setStatus({ activity: readActivity(userId) });
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStatus({ checking: false, state: "offline" });
    return;
  }

  // Una comprobación periódica solo mueve el icono; lo pedido por la persona o por un cambio
  // de este equipo se anuncia.
  setStatus(reason === "poll" ? { checking: true } : { checking: true, error: null, state: "syncing" });
  let planned: SyncSummary | null = null;
  const keys = await indexLibraryKeys(local.documents);
  const books = countBooks(local.documents, keys.documentByKey.size);
  try {
    const summary = await runSync({
      allowMassDeletion,
      collections: syncCollections,
      context: { keys, local: local.snapshot, now: new Date().toISOString() },
      enabled: (collection) => collection.consent !== "catalogAi" || choices.catalogAi,
      onPlanned: (plan) => {
        planned = plan;
      },
      remote: supabaseRemote(client, userId, deviceId()),
      stateStore: indexedDbSyncState(userId),
    });
    const at = new Date().toISOString();
    setStatus({
      activity: addActivity(userId, activityFromSummary(summary, at)),
      blockedDeletions: null,
      books,
      checking: false,
      error: null,
      lastSyncedAt: at,
      state: "idle",
      summary,
      unsynced: 0,
    });
  } catch (error) {
    const at = new Date().toISOString();
    const pending = (planned as SyncSummary | null)?.pushed ?? 0;
    if (error instanceof MassDeletionError) {
      setStatus({
        activity: addActivity(userId, { applied: {}, at, kind: "error", message: `Detenida: iba a borrar ${error.deletions} elementos`, pushed: {} }),
        blockedDeletions: error.deletions,
        books,
        checking: false,
        error: error.message,
        state: "error",
        unsynced: pending,
      });
      return;
    }
    const message = describeError(error);
    setStatus({
      activity: addActivity(userId, { applied: {}, at, kind: "error", message, pushed: {} }),
      blockedDeletions: null,
      books,
      checking: false,
      error: message,
      state: "error",
      unsynced: pending,
    });
  }
}

/**
 * Pide una sincronización. Si ya hay una en marcha, se hace otra al terminar —con lo que haya
 * cambiado mientras— en vez de lanzar dos a la vez sobre la misma base.
 */
export function requestSync({
  allowMassDeletion = false,
  reason = "change",
}: { allowMassDeletion?: boolean; reason?: SyncReason } = {}) {
  if (allowMassDeletion) confirmDeletions = true;
  if (!queuedReason || reasonWeight[reason] > reasonWeight[queuedReason]) queuedReason = reason;
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
      const next = queuedReason ?? "change";
      queuedReason = null;
      await syncOnce(allow, next);
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

// Al soltar la última retención (fin de un escaneo), se sincroniza con el estado ya completo.
onSyncReleased(() => void requestSync());
