"use client";

import { parseAiSettings, type AiSettings } from "../../ai/ai-settings";
import { saveAiSettings } from "../../ai/ai-settings-store";
import {
  createCatalogInputFingerprint,
  type DocumentCatalogRecord,
} from "../../ai/document-catalog";
import {
  removeDocumentCatalogRecord,
  saveDocumentCatalogRecord,
} from "../../ai/document-catalog-store";
import type { ReaderAnnotation } from "../../library/annotations";
import { deleteAnnotation, saveAnnotation } from "../../library/annotation-store";
import type { ImportedCatalogRecord } from "../../library/catalog-import";
import { setFavorite } from "../../library/favorite-store";
import {
  removeImportedCatalogRecords,
  saveImportedCatalogRecords,
} from "../../library/imported-catalog-store";
import {
  clearReadingProgress,
  saveReadingProgress,
  type ReadingProgressRecord,
} from "../../library/reading-progress-store";
import type { LibraryKeys } from "./document-key";
import { hashPayload } from "./stable-hash";
import { deletedHash, lastWriteWins, type MergeOptions, type SyncEntry } from "./sync-merge";

/** Lo que la app tiene ahora en este equipo, leído de sus almacenes ya cargados. */
export interface LocalSnapshot {
  aiSettings: AiSettings;
  annotations: readonly ReaderAnnotation[];
  catalogRecords: readonly DocumentCatalogRecord[];
  favorites: readonly string[];
  importedCatalogs: readonly ImportedCatalogRecord[];
  progress: readonly ReadingProgressRecord[];
}

export interface SyncContext {
  keys: LibraryKeys;
  local: LocalSnapshot;
  now: string;
}

/**
 * Una colección sincronizada: cómo se lee de este equipo y cómo se escribe en él lo que llega.
 * `consent` marca las que solo se suben si la persona lo aceptó (ADR-0002, gate 4: los
 * derivados, como las fichas de la IA, no salen del dispositivo sin consentimiento).
 */
export interface SyncCollection {
  apply(entries: readonly SyncEntry[], context: SyncContext): Promise<void>;
  consent?: "catalogAi";
  /** El documento de un elemento remoto, para saber si aquí se puede aplicar. */
  docKeyOf(key: string, payload: unknown): string | null;
  name: string;
  resolve?: MergeOptions["resolve"];
  snapshot(context: SyncContext): Map<string, SyncEntry>;
}

export function entry(key: string, payload: unknown, updatedAt: string, docKey: string | null): SyncEntry {
  return { deleted: false, docKey, hash: hashPayload(payload), key, payload, updatedAt };
}

export function tombstone(key: string, updatedAt: string, docKey: string | null): SyncEntry {
  return { deleted: true, docKey, hash: deletedHash, key, payload: null, updatedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function documentOf(context: SyncContext, docKey: string | null | undefined) {
  return docKey ? context.keys.documentByKey.get(docKey) : undefined;
}

/* ---- Favoritos: un conjunto; cada libro marcado es un elemento --------------------------- */

const favorites: SyncCollection = {
  async apply(entries, context) {
    for (const item of entries) {
      const document = documentOf(context, item.key);
      if (document) setFavorite(document.id, !item.deleted);
    }
  },
  docKeyOf: (key) => key,
  name: "favorites",
  snapshot(context) {
    const items = new Map<string, SyncEntry>();
    for (const documentId of context.local.favorites) {
      const key = context.keys.keyById.get(documentId);
      if (key) items.set(key, entry(key, { favorite: true }, context.now, key));
    }
    return items;
  },
};

/* ---- Progreso de lectura: gana el avance mayor (ADR-0002) -------------------------------- */

function percentOf(item: SyncEntry) {
  return isRecord(item.payload) && typeof item.payload.percent === "number" ? item.payload.percent : -1;
}

const readingProgress: SyncCollection = {
  async apply(entries, context) {
    for (const item of entries) {
      const document = documentOf(context, item.key);
      if (!document) continue;
      if (item.deleted) clearReadingProgress(document.id);
      else saveReadingProgress(document, percentOf(item), { allowRegression: true, updatedAt: item.updatedAt });
    }
  },
  docKeyOf: (key) => key,
  name: "reading-progress",
  resolve(local, remote) {
    if (local.deleted || remote.deleted) return lastWriteWins(local, remote);
    const difference = percentOf(local) - percentOf(remote);
    return difference === 0 ? lastWriteWins(local, remote) : difference > 0 ? "local" : "remote";
  },
  snapshot(context) {
    const items = new Map<string, SyncEntry>();
    for (const record of context.local.progress) {
      const key = context.keys.keyById.get(record.documentId);
      if (key) items.set(key, entry(key, { percent: record.percent }, record.updatedAt, key));
    }
    return items;
  },
};

/* ---- Marcas y notas: una por identificador, atada a su documento ------------------------- */

const annotations: SyncCollection = {
  async apply(entries, context) {
    for (const item of entries) {
      if (item.deleted) {
        await deleteAnnotation(item.key);
        continue;
      }
      const document = documentOf(context, item.docKey);
      if (!document || !isRecord(item.payload)) continue;
      const { docKey, ...annotation } = item.payload;
      void docKey;
      await saveAnnotation({ ...(annotation as Omit<ReaderAnnotation, "documentId">), documentId: document.id, id: item.key });
    }
  },
  docKeyOf: (_key, payload) => (isRecord(payload) && typeof payload.docKey === "string" ? payload.docKey : null),
  name: "annotations",
  snapshot(context) {
    const items = new Map<string, SyncEntry>();
    for (const annotation of context.local.annotations) {
      const docKey = context.keys.keyById.get(annotation.documentId);
      if (!docKey) continue;
      const { documentId, ...rest } = annotation;
      void documentId;
      items.set(annotation.id, entry(annotation.id, { ...rest, docKey }, annotation.updatedAt, docKey));
    }
    return items;
  },
};

/* ---- Fichas de la IA: con consentimiento; la huella de entrada es de cada equipo ---------- */

const catalogAi: SyncCollection = {
  async apply(entries, context) {
    for (const item of entries) {
      const document = documentOf(context, item.key);
      if (!document) continue;
      if (item.deleted) {
        await removeDocumentCatalogRecord(document.id);
        continue;
      }
      if (!isRecord(item.payload)) continue;
      const record = item.payload as Omit<DocumentCatalogRecord, "documentId" | "inputFingerprint">;
      // La huella depende de cómo ve este equipo el archivo (fecha, índice). Se calcula aquí
      // para que la ficha cuente como al día y el panel no ofrezca rehacerla.
      await saveDocumentCatalogRecord({
        ...record,
        documentId: document.id,
        inputFingerprint: createCatalogInputFingerprint(
          document,
          record.provider,
          record.model,
          context.local.aiSettings.maxExcerptCharacters,
        ),
      });
    }
  },
  consent: "catalogAi",
  docKeyOf: (key) => key,
  name: "catalog-ai",
  snapshot(context) {
    const items = new Map<string, SyncEntry>();
    for (const record of context.local.catalogRecords) {
      // Una ficha a medias es de una pestaña que se cerró analizando: no es un estado.
      if (record.status === "analyzing") continue;
      const key = context.keys.keyById.get(record.documentId);
      if (!key) continue;
      const { documentId, inputFingerprint, ...rest } = record;
      void documentId;
      void inputFingerprint;
      items.set(key, entry(key, rest, record.analyzedAt, key));
    }
    return items;
  },
};

/* ---- Fichas importadas: ya se emparejan por nombre y huella, valen en cualquier equipo ---- */

const maxKeyLength = 500;

const catalogImport: SyncCollection = {
  async apply(entries) {
    const saved = entries.filter((item) => !item.deleted && isRecord(item.payload));
    const removed = entries.filter((item) => item.deleted).map((item) => item.key);
    if (saved.length) await saveImportedCatalogRecords(saved.map((item) => item.payload as ImportedCatalogRecord));
    if (removed.length) await removeImportedCatalogRecords(removed);
  },
  docKeyOf: () => null,
  name: "catalog-import",
  snapshot(context) {
    const items = new Map<string, SyncEntry>();
    for (const record of context.local.importedCatalogs) {
      if (record.matchKey.length > maxKeyLength) continue;
      items.set(record.matchKey, entry(record.matchKey, record, record.importedAt, null));
    }
    return items;
  },
};

/* ---- Ajustes: los de la cuenta, no los de este equipo ------------------------------------ */

interface StoredSetting {
  key: string;
  /** Lo que se sube, sin lo que es de este equipo. */
  read(context: SyncContext): unknown;
  write(payload: unknown, context: SyncContext): void;
}

function readJson(storageKey: string): unknown {
  try {
    const serialized = window.localStorage.getItem(storageKey);
    return serialized ? (JSON.parse(serialized) as unknown) : null;
  } catch {
    return null;
  }
}

/** Escribe y avisa a los almacenes de esta pestaña, que escuchan el evento `storage`. */
function writeJson(storageKey: string, value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    window.localStorage.setItem(storageKey, serialized);
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: serialized }));
  } catch {
    // Sin almacenamiento, el ajuste llegará en la próxima sincronización.
  }
}

const settingsItems: StoredSetting[] = [
  {
    key: "ai",
    // La dirección de Ollama es de cada equipo: casi siempre, su propio localhost.
    read: (context) => {
      const { ollamaUrl, ...rest } = context.local.aiSettings;
      void ollamaUrl;
      return rest;
    },
    write: (payload, context) => {
      if (!isRecord(payload)) return;
      saveAiSettings(parseAiSettings({ ...payload, ollamaUrl: context.local.aiSettings.ollamaUrl }));
    },
  },
  {
    key: "preferences",
    // El ámbito «dispositivo» se queda aquí; cuenta, Área y documento viajan.
    read: () => {
      const stored = readJson("pliegue-preferences-v1");
      if (!isRecord(stored) || !isRecord(stored.scopes)) return null;
      const { device, ...scopes } = stored.scopes;
      void device;
      return { ...stored, scopes };
    },
    write: (payload) => {
      if (!isRecord(payload) || !isRecord(payload.scopes)) return;
      const stored = readJson("pliegue-preferences-v1");
      const device = isRecord(stored) && isRecord(stored.scopes) ? stored.scopes.device : undefined;
      writeJson("pliegue-preferences-v1", { ...payload, scopes: { ...payload.scopes, ...(device ? { device } : {}) } });
    },
  },
  {
    key: "reader-view",
    read: () => readJson("pliegue-reader-view-v1"),
    write: (payload) => writeJson("pliegue-reader-view-v1", payload),
  },
  {
    key: "postcard-design",
    read: () => readJson("pliegue-postcard-design"),
    write: (payload) => writeJson("pliegue-postcard-design", payload),
  },
];

const settings: SyncCollection = {
  async apply(entries, context) {
    for (const item of entries) {
      if (item.deleted) continue;
      settingsItems.find((setting) => setting.key === item.key)?.write(item.payload, context);
    }
  },
  docKeyOf: () => null,
  name: "settings",
  // Un equipo nuevo, sin base, adopta los ajustes de la cuenta en vez de pisarlos con los suyos
  // por defecto. Después, gana el último cambio.
  resolve: (local, remote, base) => (base ? lastWriteWins(local, remote) : "remote"),
  snapshot(context) {
    const items = new Map<string, SyncEntry>();
    for (const setting of settingsItems) {
      const value = setting.read(context);
      if (value !== null && value !== undefined) items.set(setting.key, entry(setting.key, value, context.now, null));
    }
    return items;
  },
};

/* ---- Idiomas y motor con que se traduce cada libro ---------------------------------------- */

const bookTranslationKey = "pliegue-book-translation";

const bookTranslation: SyncCollection = {
  async apply(entries, context) {
    const stored = readJson(bookTranslationKey);
    const saved: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
    for (const item of entries) {
      const document = documentOf(context, item.key);
      if (!document) continue;
      if (item.deleted) delete saved[document.id];
      else saved[document.id] = item.payload;
    }
    try {
      window.localStorage.setItem(bookTranslationKey, JSON.stringify(saved));
    } catch {
      // Se recordará en la próxima sincronización.
    }
  },
  docKeyOf: (key) => key,
  name: "book-translation",
  snapshot(context) {
    const items = new Map<string, SyncEntry>();
    const stored = readJson(bookTranslationKey);
    if (!isRecord(stored)) return items;
    for (const [documentId, pair] of Object.entries(stored)) {
      const key = context.keys.keyById.get(documentId);
      if (key && isRecord(pair)) items.set(key, entry(key, pair, context.now, key));
    }
    return items;
  },
};

export const syncCollections: readonly SyncCollection[] = [
  favorites,
  readingProgress,
  annotations,
  catalogAi,
  catalogImport,
  settings,
  bookTranslation,
];

