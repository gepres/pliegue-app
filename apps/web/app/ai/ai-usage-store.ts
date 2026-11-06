"use client";

import { useSyncExternalStore } from "react";

import {
  addUsage,
  budgetMessage,
  checkBudget,
  monthKey,
  parseMonthUsage,
  spendOf,
  sumUsage,
  type BudgetCheck,
  type MonthUsage,
} from "./ai-budget";
import { currentAiSettings } from "./ai-settings-store";

/**
 * Lo gastado en IA, contado en este equipo (04.6). Cada mes tiene su contador; con la cuenta, la
 * sincronización sube el de este equipo y trae el de los demás (`others`), y el total del mes
 * es la suma. Nunca guarda textos: solo cifras por proveedor y modelo.
 */

const storageKey = "pliegue-ai-usage-v1";
const changeEvent = "pliegue-ai-usage-change";

export interface DeviceMonth {
  month: string;
  updatedAt: string;
  usage: MonthUsage;
}

export interface StoredUsage {
  /** Lo de este equipo, por mes. */
  own: Record<string, { updatedAt: string; usage: MonthUsage }>;
  /** Lo de los otros equipos de la cuenta, por su clave («equipo/mes»). */
  others: Record<string, DeviceMonth>;
  /** Libros con «Seguir con este libro» este mes: pasan del tope a conciencia. */
  overrides: Record<string, string[]>;
}

const empty = (): StoredUsage => ({ others: {}, overrides: {}, own: {} });

let cachedSerialized: string | null | undefined;
let cached: StoredUsage = empty();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function read(): StoredUsage {
  if (typeof window === "undefined") return cached;
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === cachedSerialized) return cached;
    cachedSerialized = serialized;
    const parsed: unknown = serialized ? JSON.parse(serialized) : null;
    const next = empty();
    if (isRecord(parsed)) {
      for (const [month, entry] of Object.entries(isRecord(parsed.own) ? parsed.own : {})) {
        if (isRecord(entry) && typeof entry.updatedAt === "string") next.own[month] = { updatedAt: entry.updatedAt, usage: parseMonthUsage(entry.usage) };
      }
      for (const [key, entry] of Object.entries(isRecord(parsed.others) ? parsed.others : {})) {
        if (isRecord(entry) && typeof entry.month === "string" && typeof entry.updatedAt === "string") {
          next.others[key] = { month: entry.month, updatedAt: entry.updatedAt, usage: parseMonthUsage(entry.usage) };
        }
      }
      for (const [month, ids] of Object.entries(isRecord(parsed.overrides) ? parsed.overrides : {})) {
        if (Array.isArray(ids)) next.overrides[month] = ids.filter((id): id is string => typeof id === "string");
      }
    }
    cached = next;
  } catch {
    cached = empty();
  }
  return cached;
}

function write(next: StoredUsage) {
  cached = next;
  try {
    const serialized = JSON.stringify(next);
    window.localStorage.setItem(storageKey, serialized);
    cachedSerialized = serialized;
  } catch {
    // Sin almacenamiento, la cuenta dura lo que la pestaña.
  }
  window.dispatchEvent(new Event(changeEvent));
}

/** Lo gastado en un mes según un estado guardado: este equipo más los otros de la cuenta. */
export function monthUsageOf(stored: StoredUsage, month: string) {
  const own = stored.own[month]?.usage ?? {};
  const others = Object.values(stored.others).filter((entry) => entry.month === month);
  return { others: others.length, own, total: sumUsage([own, ...others.map((entry) => entry.usage)]) };
}

/** Lo gastado este mes, leído ahora. */
export function monthUsage(month = monthKey()) {
  return monthUsageOf(read(), month);
}

/** Cómo va el presupuesto para un proveedor (o el global, sin proveedor). */
export function budgetCheck(provider?: string): BudgetCheck {
  const { budget } = currentAiSettings();
  return checkBudget(spendOf(monthUsage().total, budget), budget, provider);
}

/* ---- Avisos al cruzar el 80 % y el 100 % ----------------------------------------------------- */

const alertListeners = new Set<(message: string) => void>();

export function onBudgetAlert(listener: (message: string) => void) {
  alertListeners.add(listener);
  return () => {
    alertListeners.delete(listener);
  };
}

/**
 * Apunta lo gastado en una llamada. Si con ella se cruza el 80 % o el 100 % de algún límite, lo
 * avisa una vez.
 */
export function recordAiUsage(
  provider: string,
  model: string | null,
  usage: { characters?: number; inputTokens?: number; outputTokens?: number },
) {
  if (typeof window === "undefined") return;
  const before = budgetCheck(provider);
  const month = monthKey();
  const stored = read();
  const current = stored.own[month]?.usage ?? {};
  write({
    ...stored,
    own: { ...stored.own, [month]: { updatedAt: new Date().toISOString(), usage: addUsage(current, provider, model || "-", usage) } },
  });
  const after = budgetCheck(provider);
  if (after.level !== "ok" && after.level !== before.level) {
    const message = budgetMessage(after, month);
    for (const listener of alertListeners) listener(message);
  }
}

/* ---- El freno -------------------------------------------------------------------------------- */

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * Antes de cada sección que se traduce o documento que se cataloga. Lo que ya está en marcha
 * termina; lo siguiente no empieza si se pasó del tope, salvo en un libro con «Seguir con este
 * libro» este mes.
 */
export function assertWithinBudget(provider: string, documentId?: string) {
  const check = budgetCheck(provider);
  if (check.level !== "over") return;
  const month = monthKey();
  if (documentId && read().overrides[month]?.includes(documentId)) return;
  throw new BudgetExceededError(`${budgetMessage(check, month)} Se paró antes de seguir: puedes subir el límite en Ajustes → IA.`);
}

export function allowOverBudget(documentId: string) {
  const month = monthKey();
  const stored = read();
  const ids = new Set(stored.overrides[month] ?? []);
  ids.add(documentId);
  // Solo el mes en curso: el permiso no se arrastra al siguiente.
  write({ ...stored, overrides: { [month]: [...ids] } });
}

/* ---- Lo que viaja con la cuenta ---------------------------------------------------------------- */

/** Los contadores de este equipo, por mes, para subirlos. */
export function ownMonths() {
  return Object.entries(read().own).map(([month, entry]) => ({ month, ...entry }));
}

export function otherDevices() {
  return read().others;
}

/** Lo que llega de otros equipos (o un borrado). La clave es «equipo/mes». */
export function applyOtherDevices(entries: ReadonlyArray<{ key: string; value: DeviceMonth | null }>) {
  const stored = read();
  const others = { ...stored.others };
  for (const { key, value } of entries) {
    if (value) others[key] = value;
    else delete others[key];
  }
  write({ ...stored, others });
}

/* ---- Para la interfaz -------------------------------------------------------------------------- */

function subscribe(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== storageKey) return;
    cachedSerialized = undefined;
    listener();
  }
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

const serverSnapshot = empty();

/** Se vuelve a pintar con cada gasto apuntado o recibido. En el servidor, vacío. */
export function useAiUsageStore() {
  return useSyncExternalStore(subscribe, read, () => serverSnapshot);
}

const noSubscription = () => () => {};

/** El mes de este equipo; null en el servidor y al hidratar, que puede ir en otro huso. */
export function useMonthKey() {
  return useSyncExternalStore(noSubscription, () => monthKey(), () => null);
}
