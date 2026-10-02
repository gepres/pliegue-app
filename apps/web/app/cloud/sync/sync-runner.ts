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
  /**
   * Qué documento de este equipo tenía cada libro (por su clave) en la última vuelta. Si un
   * libro pasa a ser otro documento —se movió de carpeta o se volvió a vincular—, lo que tenía
   * guardado sigue con el documento viejo: sin este recuerdo, su ausencia parecería un borrado.
   * Ausente en estados guardados antes de que existiera.
   */
  docIds?: Record<string, string>;
  pending: Record<string, EntryMap>;
}

export interface SyncStateStore {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

/** Cómo queda una colección tras una vuelta: lo que la persona ve en Ajustes → Cuenta. */
export interface CollectionCounts {
  /** Lo recibido de otros equipos y aplicado aquí en esta vuelta. */
  applied: number;
  /** Elementos vivos en la cuenta (sin los borrados), tal como quedan tras esta vuelta. */
  cloud: number;
  /** Sin consentimiento: ni se sube ni se aplica (las fichas de la IA). */
  disabled: boolean;
  /** Elementos de este equipo. */
  local: number;
  /** Lo subido en esta vuelta, borrados incluidos. */
  pushed: number;
  /** De la cuenta, los que esperan su libro: aquí aún no está. */
  waiting: number;
}

export interface SyncSummary {
  applied: number;
  /** Libros de este equipo que tienen algo guardado en la cuenta. */
  booksWithState: number;
  collections: Record<string, CollectionCounts>;
  pulled: number;
  pushed: number;
}

/** Elementos vivos de una colección en la nube: lo pendiente manda sobre lo que recuerda la base. */
function liveEntries(base: Record<string, SyncEntry>, pending: Record<string, SyncEntry>) {
  const merged = new Map(Object.entries(base));
  for (const [key, entry] of Object.entries(pending)) merged.set(key, entry);
  return [...merged.values()].filter((entry) => !entry.deleted);
}

/**
 * Margen al descargar. El cursor es la hora del servidor, pero una escritura que empezó antes
 * puede confirmarse después de que otro dispositivo haya leído: se vuelve a pedir un poco hacia
 * atrás, y la fusión, que es idempotente, ignora lo repetido.
 */
export const pullOverlapMs = 2 * 60 * 1000;

export const emptySyncState: SyncState = { base: {}, cursor: null, docIds: {}, pending: {} };

/**
 * Cuántos borrados puede subir una vuelta sin preguntar. Quitar a mano diez notas o favoritos
 * de una vez es raro; que desaparezcan cientos suele ser un fallo —una carpeta reorganizada, un
 * almacén que no cargó— y en la nube un borrado viaja a todos los equipos.
 */
export const maxSilentDeletions = 10;

/** Una vuelta que iba a borrar demasiado de golpe: no sube nada hasta que la persona lo confirme. */
export class MassDeletionError extends Error {
  readonly deletions: number;

  constructor(deletions: number) {
    super(
      `Esta sincronización iba a borrar ${deletions} elementos de tu cuenta de golpe y se ha detenido por seguridad. Si de verdad los quitaste, confírmalo; si no, revisa tu biblioteca antes de seguir.`,
    );
    this.name = "MassDeletionError";
    this.deletions = deletions;
  }
}

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
  allowMassDeletion = false,
  collections,
  context,
  enabled,
  onPlanned,
  remote,
  stateStore,
}: {
  /** La persona confirmó que los borrados son suyos: se suben aunque sean muchos. */
  allowMassDeletion?: boolean;
  collections: readonly SyncCollection[];
  context: SyncContext;
  /** Las colecciones con consentimiento que la persona aceptó. */
  enabled: (collection: SyncCollection) => boolean;
  /**
   * Antes de subir: cómo quedaría todo si la subida sale bien. Si falla, quien llama sabe
   * cuántos cambios de este equipo quedaron sin subir.
   */
  onPlanned?: (summary: SyncSummary) => void;
  remote: RemoteStore;
  stateStore: SyncStateStore;
}): Promise<SyncSummary> {
  const state = await stateStore.load();
  const since = state.cursor ? new Date(Date.parse(state.cursor) - pullOverlapMs).toISOString() : null;
  const rows = await remote.pull(since);
  const summary: SyncSummary = { applied: 0, booksWithState: 0, collections: {}, pulled: rows.length, pushed: 0 };

  let cursor = state.cursor;
  for (const row of rows) {
    const at = toIso(row.server_updated_at);
    if (!cursor || at > cursor) cursor = at;
  }

  // Libros que en este equipo son ahora otro documento: lo que la base recuerda de ellos no
  // vale como «estaba y ya no está». Se olvida, y lo de la nube se aplica al documento nuevo.
  const docIds = new Map(Object.entries(state.docIds ?? {}));
  const moved = new Set<string>();
  for (const [key, document] of context.keys.documentByKey) {
    const before = docIds.get(key);
    if (before && before !== document.id) moved.add(key);
    docIds.set(key, document.id);
  }

  const next: SyncState = { base: {}, cursor, docIds: Object.fromEntries(docIds), pending: {} };
  const outgoing: OutgoingRow[] = [];
  const booksWithState = new Set<string>();

  for (const collection of collections) {
    const remoteEntries = toMap(state.pending[collection.name]);
    for (const row of rows) {
      if (row.collection === collection.name) remoteEntries.set(row.item_key, rowToEntry(row, collection));
    }

    const local = collection.snapshot(context);

    if (!enabled(collection)) {
      // Sin consentimiento no se toca nada, pero lo que llega se guarda para cuando lo haya.
      next.base[collection.name] = state.base[collection.name] ?? {};
      next.pending[collection.name] = Object.fromEntries(remoteEntries);
    } else {
      const base = toMap(state.base[collection.name]);
      if (moved.size) {
        for (const [key, entry] of base) if (entry.docKey && moved.has(entry.docKey)) base.delete(key);
      }

      const merged = mergeCollection(base, local, remoteEntries, {
        hasDocument: (docKey) => context.keys.documentByKey.has(docKey),
        now: context.now,
        ...(collection.resolve ? { resolve: collection.resolve } : {}),
      });

      if (merged.apply.length) await collection.apply(merged.apply, context);
      summary.applied += merged.apply.length;
      outgoing.push(...merged.push.map((entry) => entryToRow(collection.name, entry)));
      next.base[collection.name] = Object.fromEntries(merged.base);
      next.pending[collection.name] = Object.fromEntries(merged.pending);
      summary.collections[collection.name] = {
        applied: merged.apply.length,
        cloud: 0,
        disabled: false,
        local: local.size,
        pushed: merged.push.length,
        waiting: 0,
      };
    }

    const live = liveEntries(next.base[collection.name] ?? {}, next.pending[collection.name] ?? {});
    const waiting = Object.values(next.pending[collection.name] ?? {}).filter((entry) => !entry.deleted).length;
    summary.collections[collection.name] = {
      ...(summary.collections[collection.name] ?? { applied: 0, disabled: true, local: local.size, pushed: 0 }),
      cloud: live.length,
      waiting,
    };
    for (const entry of live) {
      if (entry.docKey && context.keys.documentByKey.has(entry.docKey)) booksWithState.add(entry.docKey);
    }
  }

  summary.booksWithState = booksWithState.size;
  summary.pushed = outgoing.length;
  onPlanned?.(summary);

  const deletions = outgoing.filter((row) => row.deleted).length;
  if (deletions > maxSilentDeletions && !allowMassDeletion) throw new MassDeletionError(deletions);

  if (outgoing.length) await remote.push(outgoing);
  await stateStore.save(next);
  return summary;
}
