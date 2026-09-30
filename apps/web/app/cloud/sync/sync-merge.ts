/**
 * Fusión a tres vías de una colección sincronizada.
 *
 * Cada almacén de la app guarda su estado actual, no un registro de cambios. Para saber si un
 * elemento que falta aquí se borró en este equipo o simplemente aún no ha llegado, hace falta
 * recordar cómo estaba todo tras la última sincronización: la «base». Con base, local y remoto:
 *
 * - cambió solo lo local → se sube;
 * - cambió solo lo remoto → se aplica aquí;
 * - cambiaron los dos → decide la política de la colección (por defecto, la escritura más
 *   reciente; el progreso de lectura, el avance mayor);
 * - lo que este equipo no puede aplicar —la nota de un libro que aquí no está— se guarda aparte
 *   y se aplica cuando el libro aparezca. Tampoco se toma su ausencia por un borrado: si no,
 *   abrir la cuenta en un equipo sin ese libro borraría la nota en todos.
 */

export interface SyncEntry {
  deleted: boolean;
  /** Documento al que pertenece, si pertenece a uno: decide si este equipo puede aplicarlo. */
  docKey?: string | null;
  hash: string;
  key: string;
  /** `null` en los borrados y en la base guardada, que solo necesita la huella. */
  payload: unknown;
  /** ISO 8601. Hora del cambio en el dispositivo que lo hizo. */
  updatedAt: string;
}

export type ConflictWinner = "local" | "remote";

export interface MergeOptions {
  /** ¿Está aquí el documento de este elemento? Sin documento, siempre. */
  hasDocument: (docKey: string) => boolean;
  /** Ahora, en ISO. Se usa para fechar borrados y cambios sin hora propia. */
  now: string;
  resolve?: (local: SyncEntry, remote: SyncEntry, base: SyncEntry | undefined) => ConflictWinner;
}

export interface MergeResult {
  /** Lo remoto que hay que escribir en este equipo (los borrados incluidos). */
  apply: SyncEntry[];
  /** La base tras esta sincronización, sin cargas: solo huellas. */
  base: Map<string, SyncEntry>;
  /** Lo remoto que aún no se puede aplicar aquí, con su carga, para otra vez. */
  pending: Map<string, SyncEntry>;
  /** Lo local que hay que subir. */
  push: SyncEntry[];
}

export const deletedHash = "∅";

export function lastWriteWins(local: SyncEntry, remote: SyncEntry): ConflictWinner {
  return local.updatedAt > remote.updatedAt ? "local" : "remote";
}

function covered(entry: SyncEntry | undefined, options: MergeOptions) {
  return !entry?.docKey || options.hasDocument(entry.docKey);
}

function laterThan(value: string, ...others: Array<string | undefined>) {
  return others.every((other) => !other || value > other);
}

/** Un milisegundo después de `iso`: lo justo para ganarle en el servidor. */
function justAfter(iso: string) {
  return new Date(Date.parse(iso) + 1).toISOString();
}

/**
 * La hora con que se sube un cambio. El servidor descarta lo que sea más antiguo que lo que
 * tiene, así que un cambio que gana aquí tiene que llegar con una hora posterior a la de la base
 * y a la remota, aunque el reloj de este equipo vaya atrasado.
 */
function stamp(entry: SyncEntry, base: SyncEntry | undefined, remote: SyncEntry | undefined, now: string) {
  let updatedAt = entry.updatedAt;
  if (!laterThan(updatedAt, base?.updatedAt, remote?.updatedAt)) updatedAt = now;
  for (const other of [base?.updatedAt, remote?.updatedAt]) {
    if (other && updatedAt <= other) updatedAt = justAfter(other);
  }
  return { ...entry, updatedAt };
}

function withoutPayload(entry: SyncEntry): SyncEntry {
  return { ...entry, payload: null };
}

function same(left: SyncEntry, right: SyncEntry) {
  return left.deleted === right.deleted && left.hash === right.hash;
}

export function mergeCollection(
  base: ReadonlyMap<string, SyncEntry>,
  local: ReadonlyMap<string, SyncEntry>,
  remote: ReadonlyMap<string, SyncEntry>,
  options: MergeOptions,
): MergeResult {
  const result: MergeResult = { apply: [], base: new Map(), pending: new Map(), push: [] };
  const resolve = options.resolve ?? lastWriteWins;
  const keys = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);

  for (const key of keys) {
    const b = base.get(key);
    const l = local.get(key);
    const r = remote.get(key);

    if (!covered(l ?? r ?? b, options)) {
      // Aquí no está su documento: ni se aplica ni su ausencia significa nada.
      if (r) result.pending.set(key, r);
      if (b) result.base.set(key, b);
      continue;
    }

    // ¿Qué cambió aquí desde la última vez? Si ya no está y estaba, se borró en este equipo.
    let localChange: SyncEntry | undefined;
    if (l && (!b || !same(l, b))) localChange = l;
    else if (!l && b && !b.deleted) {
      localChange = {
        deleted: true,
        docKey: b.docKey ?? null,
        hash: deletedHash,
        key,
        payload: null,
        updatedAt: options.now,
      };
    }
    const remoteChange = r && (!b || !same(r, b)) ? r : undefined;

    if (localChange && remoteChange) {
      if (same(localChange, remoteChange)) {
        result.base.set(key, withoutPayload(remoteChange));
        continue;
      }
      if (resolve(localChange, remoteChange, b) === "local") {
        const pushed = stamp(localChange, b, remoteChange, options.now);
        result.push.push(pushed);
        result.base.set(key, withoutPayload(pushed));
      } else {
        result.apply.push(remoteChange);
        result.base.set(key, withoutPayload(remoteChange));
      }
    } else if (localChange) {
      const pushed = stamp(localChange, b, undefined, options.now);
      result.push.push(pushed);
      result.base.set(key, withoutPayload(pushed));
    } else if (remoteChange) {
      // Un borrado remoto de algo que aquí no existe no hay que aplicarlo.
      if (!remoteChange.deleted || l) result.apply.push(remoteChange);
      result.base.set(key, withoutPayload(remoteChange));
    } else if (b) {
      result.base.set(key, b);
    }
  }

  return result;
}
