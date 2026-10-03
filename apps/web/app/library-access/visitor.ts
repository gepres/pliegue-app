/**
 * Quién es el visitante de la biblioteca general, en su propio navegador: un identificador
 * aleatorio del equipo —para distinguir equipos en el registro sin saber quién es nadie— y con
 * qué nombre y código entró las últimas veces, para ofrecerle volver a entrar igual. Volver así
 * no gasta un uso del código: el servidor lo reconoce por el código, el equipo y el nombre.
 */
const deviceKey = "pliegue-general-equipo";
const entriesKey = "pliegue-general-entradas";
/** Versión anterior: solo el nombre. Se lee para no perderlo. */
const legacyNameKey = "pliegue-general-nombre";
export const maxSavedEntries = 3;

export interface SavedEntry {
  /** Cuándo entró, en ISO. */
  at: string;
  code: string;
  name: string;
}

export function visitorDeviceId() {
  try {
    const existing = window.localStorage.getItem(deviceKey);
    if (existing && /^[\w-]{8,64}$/.test(existing)) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(deviceKey, created);
    return created;
  } catch {
    // Sin almacenamiento, uno por visita.
    return crypto.randomUUID();
  }
}

const sameEntry = (left: Pick<SavedEntry, "code" | "name">, right: Pick<SavedEntry, "code" | "name">) =>
  left.code === right.code && left.name.trim().toLocaleLowerCase("es") === right.name.trim().toLocaleLowerCase("es");

/** La entrada nueva va primero; se quita la repetida y se guardan como mucho tres. */
export function rememberEntry(entries: readonly SavedEntry[], entry: SavedEntry): SavedEntry[] {
  return [entry, ...entries.filter((item) => !sameEntry(item, entry))].slice(0, maxSavedEntries);
}

/** Lo guardado, leído con cuidado: un valor roto o de otra forma no rompe la entrada. */
export function parseSavedEntries(serialized: string | null): SavedEntry[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is SavedEntry =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as SavedEntry).code === "string" &&
          typeof (item as SavedEntry).name === "string" &&
          typeof (item as SavedEntry).at === "string",
      )
      .slice(0, maxSavedEntries);
  } catch {
    return [];
  }
}

/** Para `useSyncExternalStore`: el texto guardado, que es estable mientras no cambie. */
export function savedEntriesSnapshot() {
  try {
    return window.localStorage.getItem(entriesKey) ?? "";
  } catch {
    return "";
  }
}

export function saveEntry(entry: SavedEntry) {
  try {
    const next = rememberEntry(parseSavedEntries(window.localStorage.getItem(entriesKey)), entry);
    window.localStorage.setItem(entriesKey, JSON.stringify(next));
    window.localStorage.removeItem(legacyNameKey);
  } catch {
    // Se pedirá otra vez.
  }
}

/** El nombre de la versión anterior, si quedó: rellena el campo aunque no haya entradas. */
export function legacyVisitorName() {
  try {
    return window.localStorage.getItem(legacyNameKey) ?? "";
  } catch {
    return "";
  }
}
