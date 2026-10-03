"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DriveApiError, downloadDriveFile, walkDriveFolder } from "../drive/drive-api";
import { buildGeneralLibrary, findCatalogFile, type GeneralLibrary } from "./general-library";

/**
 * La biblioteca general en el navegador: se lee la carpeta pública con la clave de API y se
 * guarda lo leído en IndexedDB (`pliegue-general`). La siguiente visita se pinta al momento con
 * lo guardado y se actualiza por detrás.
 */
const databaseName = "pliegue-general";
const storeName = "libraries";

/** Sube cuando cambia la forma de lo guardado: lo de antes se descarta y se vuelve a leer. */
const cacheVersion = 2;

interface CachedLibrary {
  /** El índice JSON tal como se descargó, y de qué archivo y versión: si no cambia, no se baja otra vez. */
  catalog: unknown;
  catalogStamp: string | null;
  folderId: string;
  library: GeneralLibrary;
  loadedAt: string;
  version: typeof cacheVersion;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "folderId" });
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

async function withStore<Result>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<Result> | void) {
  const database = await openDatabase();
  try {
    return await new Promise<Result | undefined>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = work(transaction.objectStore(storeName));
      transaction.addEventListener("complete", () => resolve(request ? request.result : undefined));
      transaction.addEventListener("error", () => reject(transaction.error));
    });
  } finally {
    database.close();
  }
}

export async function readCachedGeneralLibrary(folderId: string) {
  try {
    const cached = (await withStore<CachedLibrary>("readonly", (store) => store.get(folderId) as IDBRequest<CachedLibrary>)) ?? null;
    return cached?.version === cacheVersion ? cached : null;
  } catch {
    return null;
  }
}

async function saveCachedGeneralLibrary(entry: CachedLibrary) {
  try {
    await withStore("readwrite", (store) => {
      store.put(entry);
    });
  } catch {
    // Sin almacenamiento, se vuelve a leer en cada visita.
  }
}

/** Lee la carpeta, su índice JSON si lo trae, y arma la biblioteca. */
export async function loadGeneralLibrary(folderId: string, apiKey: string, onFolder?: (visited: number) => void) {
  const walk = await walkDriveFolder(folderId, { apiKey }, { limit: 5_000, ...(onFolder ? { onFolder } : {}) });
  const catalogFile = findCatalogFile(walk.files);
  // El índice puede pesar varios MB: solo se descarga si es otro archivo o cambió en Drive.
  const catalogStamp = catalogFile ? `${catalogFile.id}@${catalogFile.modifiedTime ?? ""}` : null;
  const previous = await readCachedGeneralLibrary(folderId);
  let catalog: unknown = null;
  if (catalogFile && previous?.catalogStamp === catalogStamp) {
    catalog = previous.catalog;
  } else if (catalogFile) {
    try {
      catalog = JSON.parse(await (await downloadDriveFile(catalogFile, { apiKey })).text());
    } catch {
      catalog = null;
    }
  }
  const loadedAt = new Date().toISOString();
  const library = buildGeneralLibrary(walk.files, catalog, loadedAt);
  await saveCachedGeneralLibrary({ catalog, catalogStamp: catalog ? catalogStamp : null, folderId, library, loadedAt, version: cacheVersion });
  return { library, loadedAt };
}

export function describeGeneralLibraryError(error: unknown) {
  if (error instanceof DriveApiError) {
    if (error.kind === "network") return "No hay conexión con Google Drive. Revisa tu internet y vuelve a intentarlo.";
    if (error.kind === "not-found") return "La carpeta de la biblioteca ya no está disponible.";
    if (error.kind === "scope" || error.kind === "auth") {
      return "Pliegue no tiene permiso para leer la carpeta de la biblioteca. Avisa a quien te dio el código.";
    }
    if (error.kind === "rate") return "Google Drive pide ir más despacio. Vuelve a intentarlo en un momento.";
  }
  return "No pudimos leer la biblioteca general. Inténtalo de nuevo en un momento.";
}

export interface GeneralLibraryState {
  error: string | null;
  library: GeneralLibrary | null;
  loadedAt: string | null;
  /** Carpetas leídas en la actualización en curso. */
  progress: number | null;
  refresh: () => void;
  status: "error" | "loading" | "ready";
}

export function useGeneralLibrary(folderId: string, apiKey: string): GeneralLibraryState {
  const [state, setState] = useState<Omit<GeneralLibraryState, "refresh">>({
    error: null,
    library: null,
    loadedAt: null,
    progress: null,
    status: "loading",
  });
  const running = useRef(false);

  const refresh = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setState((current) => ({ ...current, error: null, progress: 0 }));
    loadGeneralLibrary(folderId, apiKey, (visited) => setState((current) => ({ ...current, progress: visited })))
      .then(({ library, loadedAt }) => setState({ error: null, library, loadedAt, progress: null, status: "ready" }))
      .catch((error: unknown) =>
        setState((current) => ({
          ...current,
          error: describeGeneralLibraryError(error),
          progress: null,
          // Con lo guardado a mano, un fallo al actualizar no vacía la biblioteca.
          status: current.library ? "ready" : "error",
        })),
      )
      .finally(() => {
        running.current = false;
      });
  }, [apiKey, folderId]);

  useEffect(() => {
    let active = true;
    void readCachedGeneralLibrary(folderId).then((cached) => {
      if (!active) return;
      if (cached) setState((current) => ({ ...current, library: cached.library, loadedAt: cached.loadedAt, status: "ready" }));
      refresh();
    });
    return () => {
      active = false;
    };
  }, [folderId, refresh]);

  return { ...state, refresh };
}
