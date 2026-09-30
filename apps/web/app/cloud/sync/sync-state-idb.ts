"use client";

import { emptySyncState, type SyncState, type SyncStateStore } from "./sync-runner";

const databaseName = "pliegue-sync";
const databaseVersion = 1;
const storeName = "state";

interface StoredState extends SyncState {
  userId: string;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: "userId" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

/**
 * Lo que este equipo recuerda de su última sincronización, por cuenta: entrar con otra cuenta
 * empieza de cero en vez de tomar por borrado todo lo de la anterior.
 */
export function indexedDbSyncState(userId: string): SyncStateStore {
  return {
    async load() {
      const database = await openDatabase();
      try {
        const stored = await new Promise<StoredState | undefined>((resolve, reject) => {
          const request = database.transaction(storeName).objectStore(storeName).get(userId);
          request.addEventListener("success", () => resolve(request.result as StoredState | undefined));
          request.addEventListener("error", () => reject(request.error));
        });
        return stored ? { base: stored.base, cursor: stored.cursor, pending: stored.pending } : emptySyncState;
      } finally {
        database.close();
      }
    },
    async save(state) {
      const database = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(storeName, "readwrite");
          transaction.objectStore(storeName).put({ ...state, userId } satisfies StoredState);
          transaction.addEventListener("complete", () => resolve());
          transaction.addEventListener("error", () => reject(transaction.error));
          transaction.addEventListener("abort", () => reject(transaction.error));
        });
      } finally {
        database.close();
      }
    },
  };
}
