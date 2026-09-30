import type { SyncCollection, SyncContext } from "./collections";
import { hashPayload } from "./stable-hash";
import { deletedHash, mergeCollection, type SyncEntry } from "./sync-merge";

/** Una fila de `public.sync_items` tal como viaja. */
export interface RemoteRow {
  collection: string;
  deleted: boolean;
  item_key: string;
  payload: unknown;
  server_updated_at: string;
  updated_at: string;
}

export type OutgoingRow = Omit<RemoteRow, "server_updated_at">;

/** La nube, reducida a lo que el motor necesita. Supabase en la app; memoria en los tests. */
export interface RemoteStore {
  pull(since: string | null): Promise<RemoteRow[]>;
  push(rows: readonly OutgoingRow[]): Promise<void>;
}

type EntryMap = Record<string, SyncEntry>;

/** Lo que este equipo recuerda de la última sincronización con una cuenta. */
export interface SyncState {
  base: Record<string, EntryMap>;
  cursor: string | null;
  pending: Record<string, EntryMap>;
}

export interface SyncStateStore {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

export interface SyncSummary {
  applied: number;
  pulled: number;
  pushed: number;
}

/**
 * Margen al descargar. El cursor es la hora del servidor, pero una escritura que empezó antes
 * puede confirmarse después de que otro dispositivo haya leído: se vuelve a pedir un poco hacia
 * atrás, y la fusión, que es idempotente, ignora lo repetido.
 */
export const pullOverlapMs = 2 * 60 * 1000;

export const emptySyncState: SyncState = { base: {}, cursor: null, pending: {} };

function toIso(value: string) {
  return new Date(value).toISOString();
}

function rowToEntry(row: RemoteRow, collection: SyncCollection): SyncEntry {
  return {
    deleted: row.deleted,
    docKey: collection.docKeyOf(row.item_key, row.payload),
    hash: row.deleted ? deletedHash : hashPayload(row.payload),
    key: row.item_key,
    payload: row.payload,
    // Postgres devuelve microsegundos y «+00:00»; aquí todo se compara como texto ISO.
    updatedAt: toIso(row.updated_at),
  };
}

function entryToRow(collection: string, entry: SyncEntry): OutgoingRow {
  return {
    collection,
    deleted: entry.deleted,
    item_key: entry.key,
    // Un borrado conserva solo a qué documento pertenecía, para que otro equipo sepa si le toca.
    payload: entry.deleted ? (entry.docKey ? { docKey: entry.docKey } : null) : entry.payload,
    updated_at: entry.updatedAt,
  };
}

function toMap(record: EntryMap | undefined) {
  return new Map(Object.entries(record ?? {}));
}

/**
 * Una sincronización: descargar lo nuevo, fusionar cada colección con lo local, aplicar aquí lo
 * que ganó fuera y subir lo que ganó aquí. El estado solo se guarda si todo salió bien; si la
 * subida falla, la siguiente vuelta rehace la fusión y llega al mismo sitio.
 */
export async function runSync({
  collections,
  context,
  enabled,
  remote,
  stateStore,
}: {
  collections: readonly SyncCollection[];
  context: SyncContext;
  /** Las colecciones con consentimiento que la persona aceptó. */
  enabled: (collection: SyncCollection) => boolean;
  remote: RemoteStore;
  stateStore: SyncStateStore;
}): Promise<SyncSummary> {
  const state = await stateStore.load();
  const since = state.cursor ? new Date(Date.parse(state.cursor) - pullOverlapMs).toISOString() : null;
  const rows = await remote.pull(since);
  const summary: SyncSummary = { applied: 0, pulled: rows.length, pushed: 0 };

  let cursor = state.cursor;
  for (const row of rows) {
    const at = toIso(row.server_updated_at);
    if (!cursor || at > cursor) cursor = at;
  }

  const next: SyncState = { base: {}, cursor, pending: {} };
  const outgoing: OutgoingRow[] = [];

  for (const collection of collections) {
    const remoteEntries = toMap(state.pending[collection.name]);
    for (const row of rows) {
      if (row.collection === collection.name) remoteEntries.set(row.item_key, rowToEntry(row, collection));
    }

    if (!enabled(collection)) {
      // Sin consentimiento no se toca nada, pero lo que llega se guarda para cuando lo haya.
      next.base[collection.name] = state.base[collection.name] ?? {};
      next.pending[collection.name] = Object.fromEntries(remoteEntries);
      continue;
    }

    const merged = mergeCollection(toMap(state.base[collection.name]), collection.snapshot(context), remoteEntries, {
      hasDocument: (docKey) => context.keys.documentByKey.has(docKey),
      now: context.now,
      ...(collection.resolve ? { resolve: collection.resolve } : {}),
    });

    if (merged.apply.length) await collection.apply(merged.apply, context);
    summary.applied += merged.apply.length;
    outgoing.push(...merged.push.map((entry) => entryToRow(collection.name, entry)));
    next.base[collection.name] = Object.fromEntries(merged.base);
    next.pending[collection.name] = Object.fromEntries(merged.pending);
  }

  if (outgoing.length) await remote.push(outgoing);
  summary.pushed = outgoing.length;
  await stateStore.save(next);
  return summary;
}
