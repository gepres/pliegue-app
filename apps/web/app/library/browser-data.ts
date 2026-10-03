/**
 * Borrar todo lo que Pliegue guarda en este navegador: las bases de IndexedDB (índices, notas,
 * fichas, traducciones, copias importadas), las preferencias y la sesión de localStorage, los
 * archivos del sistema privado del sitio (OPFS) y las páginas guardadas para abrir sin conexión.
 *
 * No toca tus archivos ni tu carpeta ni Google Drive, ni lo que haya en la cuenta: eso vive
 * fuera del navegador. Después vuelve a mirar y dice qué quedó, en vez de suponer que se borró.
 *
 * El entorno se inyecta: en los tests, dobles; en la app, el del navegador.
 */

/** Las bases que crea Pliegue, por si el navegador no sabe listarlas (`databases()`). */
export const knownDatabases = [
  "pliegue-annotations",
  "pliegue-catalog-import",
  "pliegue-content-hashes",
  "pliegue-document-catalog",
  "pliegue-drive",
  "pliegue-general",
  "pliegue-linked-files",
  "pliegue-linked-folders",
  "pliegue-local-library",
  "pliegue-sync",
  "pliegue-translations",
] as const;

const ours = (name: string) => name.startsWith("pliegue");

interface StorageLike {
  key(index: number): string | null;
  readonly length: number;
  removeItem(key: string): void;
}

interface DirectoryLike {
  keys(): AsyncIterable<string>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface BrowserDataEnv {
  caches?: { delete(name: string): Promise<boolean>; keys(): Promise<string[]> } | undefined;
  /** Borra una base; resuelve al terminar. `blocked` si otra pestaña la tiene abierta. */
  deleteDatabase?: ((name: string) => Promise<"blocked" | "deleted">) | undefined;
  listDatabases?: (() => Promise<string[] | null>) | undefined;
  localStorage?: StorageLike | undefined;
  opfs?: (() => Promise<DirectoryLike>) | undefined;
  sessionStorage?: StorageLike | undefined;
}

export interface BrowserDataInventory {
  caches: string[];
  databases: string[];
  /** `null`: el navegador no dice qué bases hay; se cuentan las conocidas. */
  databasesListed: boolean;
  files: string[];
  keys: string[];
}

export interface WipeResult {
  /** Lo que se borró. */
  removed: BrowserDataInventory;
  /** Lo que sigue ahí al volver a mirar: vacío si todo salió bien. */
  remaining: BrowserDataInventory;
  /** Bases que otra pestaña de Pliegue tenía abiertas: se borran al cerrarla. */
  blocked: string[];
}

function storageKeys(storage: StorageLike | undefined) {
  if (!storage) return [];
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && ours(key)) keys.push(key);
    }
  } catch {
    // Sin acceso al almacenamiento, no hay nada que listar.
  }
  return keys;
}

async function opfsEntries(env: BrowserDataEnv) {
  if (!env.opfs) return [];
  try {
    const root = await env.opfs();
    const names: string[] = [];
    for await (const name of root.keys()) names.push(name);
    return names;
  } catch {
    return [];
  }
}

/** Qué tiene Pliegue en este navegador ahora mismo. */
export async function inventoryBrowserData(env: BrowserDataEnv): Promise<BrowserDataInventory> {
  let listed: string[] | null = null;
  try {
    listed = (await env.listDatabases?.()) ?? null;
  } catch {
    listed = null;
  }
  const cacheNames = await env.caches?.keys().catch(() => []) ?? [];
  return {
    caches: cacheNames.filter(ours).sort(),
    databases: (listed ?? [...knownDatabases]).filter(ours).sort(),
    databasesListed: listed !== null,
    // El sistema privado del sitio es solo de Pliegue: todo lo que hay es suyo.
    files: (await opfsEntries(env)).sort(),
    keys: [...new Set([...storageKeys(env.localStorage), ...storageKeys(env.sessionStorage)])].sort(),
  };
}

/** Cuántas cosas hay en un inventario; las bases conocidas sin listar no cuentan como halladas. */
export function inventorySize(inventory: BrowserDataInventory) {
  return (
    inventory.caches.length +
    (inventory.databasesListed ? inventory.databases.length : 0) +
    inventory.files.length +
    inventory.keys.length
  );
}

export async function wipeBrowserData(env: BrowserDataEnv): Promise<WipeResult> {
  const found = await inventoryBrowserData(env);
  const blocked: string[] = [];

  for (const name of found.databases) {
    try {
      if ((await env.deleteDatabase?.(name)) === "blocked") blocked.push(name);
    } catch {
      // Se ve al volver a mirar.
    }
  }
  for (const storage of [env.localStorage, env.sessionStorage]) {
    for (const key of storageKeys(storage)) {
      try {
        storage?.removeItem(key);
      } catch {
        // Ídem.
      }
    }
  }
  if (found.files.length && env.opfs) {
    try {
      const root = await env.opfs();
      for (const name of found.files) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
    } catch {
      // Ídem.
    }
  }
  for (const name of found.caches) await env.caches?.delete(name).catch(() => false);

  const remaining = await inventoryBrowserData(env);
  // Sin `databases()`, una base conocida que no existe no «queda»: se da por borrada si no
  // quedó bloqueada.
  if (!remaining.databasesListed) remaining.databases = remaining.databases.filter((name) => blocked.includes(name));
  return { blocked, remaining, removed: found };
}

/** El entorno real. Fuera del navegador, vacío. */
export function browserDataEnv(): BrowserDataEnv {
  if (typeof window === "undefined") return {};
  const factory = window.indexedDB;
  return {
    caches: "caches" in window ? window.caches : undefined,
    deleteDatabase: factory
      ? (name) =>
          new Promise((resolve, reject) => {
            const request = factory.deleteDatabase(name);
            // Si otra pestaña la tiene abierta, el navegador la borra al cerrarse esa pestaña:
            // no se espera indefinidamente.
            const timer = window.setTimeout(() => resolve("blocked"), 4000);
            request.addEventListener("success", () => {
              window.clearTimeout(timer);
              resolve("deleted");
            });
            request.addEventListener("error", () => {
              window.clearTimeout(timer);
              reject(request.error);
            });
          })
      : undefined,
    listDatabases:
      factory && typeof factory.databases === "function"
        ? async () => (await factory.databases()).map((database) => database.name ?? "").filter(Boolean)
        : undefined,
    localStorage: (() => {
      try {
        return window.localStorage;
      } catch {
        return undefined;
      }
    })(),
    opfs:
      typeof navigator !== "undefined" && navigator.storage && "getDirectory" in navigator.storage
        ? () => navigator.storage.getDirectory() as unknown as Promise<DirectoryLike>
        : undefined,
    sessionStorage: (() => {
      try {
        return window.sessionStorage;
      } catch {
        return undefined;
      }
    })(),
  };
}
