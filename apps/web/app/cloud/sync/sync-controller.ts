"use client";

import { useSyncExternalStore } from "react";

import type { LibraryDocument } from "../../library/documents";
import {
  mergeTranslatedUnits,
  onTranslationWritten,
  readTranslation,
  translationPairs,
  trimTranslations,
} from "../../library/translation-store";
import { currentAccount } from "../account-store";
import { deviceId } from "../device-id";
import { cloudClient } from "../supabase-client";
import { aiUsageCollection } from "./ai-usage-collection";
import { syncCollections, type LocalSnapshot, type SyncCollection } from "./collections";
import { indexLibraryKeys, type LibraryKeys } from "./document-key";
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
import { addConflicts, listConflicts, loadLatency, markRestored, saveLatency } from "./sync-history";
import { afterPull, afterPush, summarizeLatency, type LatencySummary } from "./sync-latency";
import {
  localTranslationState,
  pairRef,
  transferTranslations,
  translationFilesCollection,
  type SkippedTranslation,
  type TranslationUnits,
} from "./translation-files";
import { indexedDbSyncState } from "./sync-state-idb";
import { supabaseRemote, supabaseTranslationStorage } from "./supabase-remote";

/* ---- Qué se sincroniza, por cuenta y en este equipo ------------------------------------ */

export interface SyncChoices {
  /** Fichas generadas por la IA: derivados, solo con consentimiento (ADR-0002, gate 4). */
  catalogAi: boolean;
  /** La persona pulsó «Empezar a sincronizar» con esta cuenta en este equipo. */
  enabled: boolean;
  /**
   * Traducciones guardadas (06.3): el libro entero en otro idioma, así que van con permiso
   * propio y empiezan apagadas.
   */
  translations: boolean;
}

const choicesKey = "pliegue-cloud-sync-v1";
const defaultChoices: SyncChoices = { catalogAi: true, enabled: false, translations: false };
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
  // Al dar el permiso de las traducciones, la próxima vuelta las revisa todas.
  if (choices.translations && !syncChoicesFor(userId).translations) pendingTranslations = null;
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
  /** Las traducciones en la cuenta, tras la última vuelta que las tocó (con su permiso). */
  translations: TranslationsStatus | null;
  /** Cuánto tarda un cambio en llegar a otro equipo, medido en este (06.3). */
  latency: LatencySummary | null;
}

export interface TranslationsStatus {
  /** Lo que ocupa todo lo de la cuenta. */
  cloudBytes: number;
  cloudFiles: number;
  error: string | null;
  /** Lo que no se subió: pasa de 5 MB o no cabe en el cupo. */
  skipped: SkippedTranslation[];
}

let status: SyncStatus = {
  activity: [],
  blockedDeletions: null,
  books: null,
  checking: false,
  error: null,
  lastSyncedAt: null,
  state: "idle",
  latency: null,
  summary: null,
  translations: null,
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

/** Lo de este equipo tal como lo ve la sincronización; también lo usa la copia de seguridad. */
export function readLocalSource() {
  return readLocal?.() ?? null;
}


/* ---- Traducciones en la cuenta (06.3) ------------------------------------------------------- */

/** El índice de lo que hay en la nube, como una colección más de `sync_items`. */
const translationFiles: SyncCollection = translationFilesCollection();
const collections: readonly SyncCollection[] = [...syncCollections, translationFiles, aiUsageCollection(deviceId)];

/**
 * Traducciones escritas aquí desde la última vuelta. `null`: hay que revisarlas todas (la
 * primera vuelta de la sesión, otra cuenta o el permiso recién dado).
 */
let pendingTranslations: Set<string> | null = null;
let translationsUser: string | null = null;
/** Tras un error de Storage, no se reintenta en cada vuelta de 45 s. */
let translationsRetryAt = 0;
const translationsRetryMs = 5 * 60 * 1000;

if (typeof window !== "undefined") {
  onTranslationWritten((documentId, pairId) => pendingTranslations?.add(pairRef(documentId, pairId)));
}

const indexedDbTranslations: TranslationUnits = {
  async merge(records) {
    const written = await mergeTranslatedUnits(records);
    // Lo que llega cuenta para el tope de lo guardado, como lo traducido aquí.
    const [first] = records;
    if (first) await trimTranslations(first.documentId);
    return written;
  },
  pairs: translationPairs,
  read: readTranslation,
};

function describeTranslationsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/bucket not found/i.test(message)) return "Falta el bucket «translations» en Supabase.";
  if (/row-level security|unauthorized|forbidden|not allowed|403/i.test(message)) {
    return "Supabase no deja guardar las traducciones: faltan las políticas del bucket «translations».";
  }
  return `No se pudieron sincronizar las traducciones: ${message}`;
}

async function syncTranslations(client: NonNullable<ReturnType<typeof cloudClient>>, userId: string, keys: LibraryKeys, reason: SyncReason) {
  if (translationsUser !== userId) {
    translationsUser = userId;
    pendingTranslations = null;
  }
  if (reason !== "manual" && Date.now() < translationsRetryAt) return { uploaded: 0 };
  const dirty = pendingTranslations;
  pendingTranslations = new Set();
  try {
    const result = await transferTranslations({
      dirty,
      keys,
      now: new Date(),
      state: localTranslationState(userId),
      storage: supabaseTranslationStorage(client),
      units: indexedDbTranslations,
      userId,
    });
    for (const ref of result.later) pendingTranslations?.add(ref);
    translationsRetryAt = 0;
    setStatus({ translations: { cloudBytes: result.cloudBytes, cloudFiles: result.cloudFiles, error: null, skipped: result.skipped } });
    return result;
  } catch (error) {
    // Lo que quedaba por mirar se mira en el próximo intento.
    pendingTranslations = dirty === null ? null : new Set([...dirty, ...(pendingTranslations ?? [])]);
    translationsRetryAt = Date.now() + translationsRetryMs;
    setStatus({
      translations: {
        cloudBytes: status.translations?.cloudBytes ?? 0,
        cloudFiles: status.translations?.cloudFiles ?? 0,
        error: describeTranslationsError(error),
        skipped: status.translations?.skipped ?? [],
      },
    });
    return { uploaded: 0 };
  }
}

/* ---- Latencia y conflictos (06.3) --------------------------------------------------------- */

/** Cuándo cambió algo aquí por primera vez desde la última subida: el principio de «subir». */
let pendingChangeAt: number | null = null;

/** Lo llama el componente que vigila los almacenes cuando la persona cambia algo. */
export function markLocalChange() {
  pendingChangeAt ??= Date.now();
}

/**
 * Restaura la versión que perdió en un conflicto: se escribe aquí como un cambio nuevo y la
 * vuelta siguiente la sube, así que llega también a los demás equipos.
 */
export async function restoreConflict(userId: string, id: string) {
  const conflict = listConflicts(userId).find((item) => item.id === id);
  const collection = collections.find((item) => item.name === conflict?.collection);
  const local = readLocal?.();
  if (!conflict || !collection || !local?.ready) return false;
  const now = new Date().toISOString();
  const keys = await indexLibraryKeys(local.documents);
  await collection.apply([{ ...conflict.loser, updatedAt: now }], { keys, local: local.snapshot, now, userId });
  markRestored(userId, id);
  markLocalChange();
  void requestSync({ reason: "manual" });
  return true;
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
  // La vuelta anterior: si fue hace poco, este equipo estaba al tanto y lo que llegue mide latencia.
  const previousSyncAt = status.lastSyncedAt ? Date.parse(status.lastSyncedAt) : null;
  const keys = await indexLibraryKeys(local.documents);
  const books = countBooks(local.documents, keys.documentByKey.size);
  try {
    const summary = await runSync({
      allowMassDeletion,
      collections,
      context: { keys, local: local.snapshot, now: new Date().toISOString(), userId },
      deviceId: deviceId(),
      enabled: (collection) =>
        collection.consent === "catalogAi"
          ? choices.catalogAi
          : collection.consent === "translations"
            ? choices.translations
            : true,
      onPlanned: (plan) => {
        planned = plan;
      },
      remote: supabaseRemote(client, userId, deviceId()),
      stateStore: indexedDbSyncState(userId),
    });
    // Las traducciones, después: el índice de la nube ya está al día. Lo que se suba entra en
    // el índice y viaja en la vuelta siguiente, que se pide aquí mismo.
    if (choices.translations) {
      const transfer = await syncTranslations(client, userId, keys, reason);
      if (transfer.uploaded) again = true;
    }
    const at = new Date().toISOString();
    // Latencia (06.3): la subida corrige el reloj y mide «subir»; lo recibido mide «bajar».
    let latency = loadLatency(userId);
    if (summary.push) latency = afterPush(latency, summary.push, pendingChangeAt);
    pendingChangeAt = null;
    latency = afterPull(latency, summary.fresh, Date.now(), previousSyncAt);
    saveLatency(userId, latency);
    addConflicts(userId, summary.conflicts, at);
    setStatus({
      activity: addActivity(userId, activityFromSummary(summary, at)),
      blockedDeletions: null,
      latency: summarizeLatency(latency),
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
