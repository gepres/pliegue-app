/**
 * Lo que Pliegue guarda en este navegador —índices, notas, traducciones, portadas, copias
 * importadas— vive en el almacenamiento del sitio. Sin protección, el navegador puede vaciarlo
 * si se queda sin espacio, sin preguntar. `persist()` pide que no lo haga.
 *
 * Chrome no muestra ningún diálogo: concede o niega según el uso del sitio (instalado como app,
 * en marcadores, con permisos concedidos). Firefox sí pregunta.
 */

/** Lo que Pliegue necesita del StorageManager; en los tests, un doble. */
export interface StorageManagerLike {
  estimate(): Promise<StorageEstimate & { usageDetails?: Record<string, number> }>;
  persist(): Promise<boolean>;
  persisted(): Promise<boolean>;
}

/** Desglose de lo ocupado, si el navegador lo da (Chrome). */
export interface StorageBreakdown {
  /** Archivos de la app guardados para abrir sin conexión (Cache Storage). */
  appFiles: number;
  /** Índices, notas, fichas, traducciones y portadas (IndexedDB). */
  databases: number;
  /** Copias importadas y archivos del sistema privado del sitio (OPFS). */
  files: number;
}

export interface StorageState {
  breakdown: StorageBreakdown | null;
  /** `null`: este navegador no permite saberlo. */
  persisted: boolean | null;
  quota: number | null;
  supported: boolean;
  usage: number | null;
}

export const unsupportedStorage: StorageState = {
  breakdown: null,
  persisted: null,
  quota: null,
  supported: false,
  usage: null,
};

function browserStorage(): StorageManagerLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  const storage = navigator.storage as StorageManagerLike | undefined;
  return storage && typeof storage.estimate === "function" ? storage : undefined;
}

function breakdownOf(details: Record<string, number> | undefined): StorageBreakdown | null {
  if (!details) return null;
  return {
    appFiles: (details.caches ?? 0) + (details.serviceWorkerRegistrations ?? 0),
    databases: details.indexedDB ?? 0,
    files: details.fileSystem ?? 0,
  };
}

export async function readStorageState(storage: StorageManagerLike | undefined = browserStorage()): Promise<StorageState> {
  if (!storage) return unsupportedStorage;
  const [estimate, persisted] = await Promise.all([
    storage.estimate().catch(() => null),
    typeof storage.persisted === "function" ? storage.persisted().catch(() => null) : Promise.resolve(null),
  ]);
  return {
    breakdown: breakdownOf(estimate?.usageDetails),
    persisted,
    quota: estimate?.quota ?? null,
    supported: true,
    usage: estimate?.usage ?? null,
  };
}

/** Pide que el navegador no borre los datos de Pliegue. Devuelve si quedaron protegidos. */
export async function protectStorage(storage: StorageManagerLike | undefined = browserStorage()) {
  if (!storage || typeof storage.persist !== "function") return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
