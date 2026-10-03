import type { SyncCollection, SyncContext } from "../cloud/sync/collections";
import { documentIdentity } from "../cloud/sync/document-key";
import { hashPayload } from "../cloud/sync/stable-hash";
import { lastWriteWins, mergeCollection, type MergeOptions, type SyncEntry } from "../cloud/sync/sync-merge";

/**
 * Copia de seguridad de lo que la persona hizo con sus libros: favoritos, avance, notas,
 * fichas, idiomas de traducción y ajustes. Es lo mismo que viaja con la cuenta, guardado en un
 * archivo: se arma con las colecciones de la sincronización y se restaura fusionando con sus
 * mismas reglas, así que no hay una segunda lógica que pueda divergir.
 *
 * Cada libro va por su identidad entre equipos (nombre y tamaño del archivo): la copia de un
 * equipo se restaura en otro aunque sus identificadores no coincidan. No lleva los archivos ni
 * su texto, ni las claves de IA ni los permisos de las carpetas.
 */
export const backupVersion = 1;

export interface BackupEntry {
  docKey: string | null;
  key: string;
  payload: unknown;
  updatedAt: string;
}

export interface PliegueBackup {
  /** Los libros a los que pertenece algo de la copia, para leerla a mano. */
  books: Array<{ docKey: string; file: string; title: string }>;
  collections: Record<string, BackupEntry[]>;
  createdAt: string;
  pliegueBackup: typeof backupVersion;
}

export function createBackup(collections: readonly SyncCollection[], context: SyncContext): PliegueBackup {
  const used = new Set<string>();
  const result: PliegueBackup["collections"] = {};
  for (const collection of collections) {
    const entries = [...collection.snapshot(context).values()].filter((entry) => !entry.deleted);
    result[collection.name] = entries.map((entry) => ({
      docKey: entry.docKey ?? null,
      key: entry.key,
      payload: entry.payload,
      updatedAt: entry.updatedAt,
    }));
    for (const entry of entries) if (entry.docKey) used.add(entry.docKey);
  }
  const books = [...used]
    .map((docKey) => {
      const document = context.keys.documentByKey.get(docKey);
      return document ? { docKey, file: (documentIdentity(document) ?? "").replace(/^file:/, ""), title: document.title } : null;
    })
    .filter((book): book is PliegueBackup["books"][number] => Boolean(book))
    .sort((left, right) => left.title.localeCompare(right.title, "es"));
  return { books, collections: result, createdAt: context.now, pliegueBackup: backupVersion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Lee un archivo de copia. Si no lo es, lo dice para una persona. */
export function parseBackup(value: unknown): PliegueBackup {
  if (!isRecord(value) || value.pliegueBackup === undefined) {
    throw new Error("Este archivo no es una copia de seguridad de Pliegue.");
  }
  if (value.pliegueBackup !== backupVersion) {
    throw new Error("Esta copia la hizo una versión de Pliegue más nueva: actualiza la app y vuelve a intentarlo.");
  }
  if (!isRecord(value.collections)) throw new Error("La copia está incompleta: le faltan los datos.");
  const collections: PliegueBackup["collections"] = {};
  for (const [name, entries] of Object.entries(value.collections)) {
    if (!Array.isArray(entries)) continue;
    collections[name] = entries.filter(
      (entry): entry is BackupEntry =>
        isRecord(entry) && typeof entry.key === "string" && typeof entry.updatedAt === "string" && entry.payload !== undefined,
    );
  }
  return {
    books: Array.isArray(value.books) ? (value.books as PliegueBackup["books"]) : [],
    collections,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    pliegueBackup: backupVersion,
  };
}

/** Colecciones cuya fecha es la de la vuelta, no la del cambio: al restaurar, manda la copia. */
const stampedWhenRead = new Set(["book-translation", "favorites", "settings"]);

function restoreResolve(collection: SyncCollection): NonNullable<MergeOptions["resolve"]> {
  if (collection.resolve) return collection.resolve;
  if (stampedWhenRead.has(collection.name)) return () => "remote";
  return lastWriteWins;
}

export interface RestoreCounts {
  /** Lo que se escribirá en este equipo. */
  apply: number;
  /** Lo que trae la copia. */
  incoming: number;
  /** Ya estaba igual aquí, o lo de aquí es más reciente. */
  kept: number;
  /** Su libro no está en este equipo: no se puede aplicar. */
  waiting: number;
}

export interface RestorePlan {
  collections: Record<string, RestoreCounts & { entries: SyncEntry[] }>;
  createdAt: string;
}

/**
 * Qué haría restaurar: nada de lo que hay aquí se borra; lo que trae la copia se suma y, si
 * choca, deciden las reglas de cada colección (el avance mayor, la nota más reciente).
 */
export function planRestore(backup: PliegueBackup, collections: readonly SyncCollection[], context: SyncContext): RestorePlan {
  const plan: RestorePlan = { collections: {}, createdAt: backup.createdAt };
  for (const collection of collections) {
    const incoming = backup.collections[collection.name] ?? [];
    const remote = new Map<string, SyncEntry>(
      incoming.map((entry) => [
        entry.key,
        {
          deleted: false,
          docKey: collection.docKeyOf(entry.key, entry.payload),
          hash: hashPayload(entry.payload),
          key: entry.key,
          payload: entry.payload,
          updatedAt: entry.updatedAt,
        },
      ]),
    );
    const merged = mergeCollection(new Map(), collection.snapshot(context), remote, {
      hasDocument: (docKey) => context.keys.documentByKey.has(docKey),
      now: context.now,
      resolve: restoreResolve(collection),
    });
    const waiting = [...merged.pending.values()].filter((entry) => !entry.deleted).length;
    plan.collections[collection.name] = {
      apply: merged.apply.length,
      entries: merged.apply,
      incoming: remote.size,
      kept: remote.size - merged.apply.length - waiting,
      waiting,
    };
  }
  return plan;
}

/** Escribe en este equipo lo que decidió `planRestore`. Devuelve cuántos elementos aplicó. */
export async function applyRestore(plan: RestorePlan, collections: readonly SyncCollection[], context: SyncContext) {
  let applied = 0;
  for (const collection of collections) {
    const entries = plan.collections[collection.name]?.entries ?? [];
    if (!entries.length) continue;
    await collection.apply(entries, context);
    applied += entries.length;
  }
  return applied;
}

/** «pliegue-copia-2026-10-02.json». */
export function backupFileName(iso: string) {
  return `pliegue-copia-${iso.slice(0, 10)}.json`;
}
