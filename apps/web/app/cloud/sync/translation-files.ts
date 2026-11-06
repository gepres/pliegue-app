"use client";

import { hashText, type TranslatedBlock } from "../../library/translation";
import { translatedUnitKey, type TranslatedUnitRecord } from "../../library/translation-store";
import { entry, type SyncCollection } from "./collections";
import type { LibraryKeys } from "./document-key";
import { hashPayload } from "./stable-hash";

/**
 * Traducciones guardadas en la cuenta (06.3, decisión del 6-nov).
 *
 * El texto va a Storage, al bucket privado `translations`, un archivo JSON por libro y
 * traducción: `{cuenta}/{clave del libro}/{idioma}.{par}.json`. Qué hay allí lo dice la
 * colección `translation-files` de `sync_items` (tamaño, huella y par de cada archivo), que
 * viaja con la misma fusión que el resto. Así cada equipo sabe qué bajar y cuánto cupo queda
 * sin listar el bucket.
 *
 * Solo con permiso propio, apagado de entrada: una traducción es el libro entero en otro idioma.
 */

/** Tope por archivo: el mismo que pone el bucket. */
export const translationFileMaxBytes = 5 * 1024 * 1024;
/** Cupo por cuenta. Lo comprueba la app con lo que dice `translation-files`. */
export const translationQuotaBytes = 200 * 1024 * 1024;
/** Una traducción no sube mientras se está haciendo: espera a que lleve este rato quieta. */
export const translationQuietMs = 2 * 60 * 1000;
export const translationsBucket = "translations";

/** Lo que la cuenta sabe de un archivo de traducción. */
export interface CloudTranslation {
  hash: string;
  pairId: string;
  size: number;
  updatedAt: string;
}

/** Lo que este equipo recuerda, por cuenta: lo que hay en la nube y con qué versión está al día. */
export interface TranslationCloudState {
  cloud: Record<string, CloudTranslation>;
  /** Por archivo, la huella de la versión de la nube que este equipo ya tiene. */
  held: Record<string, string>;
}

export interface TranslationFile {
  pairId: string;
  schemaVersion: 1;
  units: Array<{ blocks: TranslatedBlock[]; translatedAt: string; unitId: string }>;
}

/** `ai:openai:gpt-4.1-mini:en>es` → el idioma de destino, para que se lea en la ruta. */
function targetOf(pairId: string) {
  return (pairId.split(">").at(-1) ?? "").replace(/[^A-Za-z0-9-]/g, "_") || "x";
}

/**
 * Un archivo por libro, idioma y par: dos equipos que traducen el mismo libro al español con
 * motores distintos guardan dos archivos, en vez de pisarse el uno al otro en cada vuelta.
 */
export function translationItemKey(docKey: string, pairId: string) {
  return `${docKey}/${targetOf(pairId)}.${hashText(pairId)}`;
}

export function translationObjectPath(userId: string, itemKey: string) {
  return `${userId}/${itemKey}.json`;
}

const encoder = new TextEncoder();

/** El archivo de una traducción, su huella (solo del texto traducido) y lo que ocupa. */
export function buildTranslationFile(pairId: string, records: readonly TranslatedUnitRecord[]) {
  const units = [...records]
    .sort((left, right) => (left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0))
    .map(({ blocks, translatedAt, unitId }) => ({ blocks, translatedAt, unitId }));
  const file: TranslationFile = { pairId, schemaVersion: 1, units };
  const json = JSON.stringify(file);
  // La fecha de cada página no cuenta: la misma traducción hecha en dos equipos es la misma.
  const hash = hashPayload({ pairId, units: units.map(({ blocks, unitId }) => ({ blocks, unitId })) });
  return { hash, json, size: encoder.encode(json).length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Lee un archivo bajado de la cuenta. Lo que no tenga la forma esperada se descarta entero. */
export function parseTranslationFile(text: string): TranslationFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.pairId !== "string" || !Array.isArray(parsed.units)) {
    return null;
  }
  const units: TranslationFile["units"] = [];
  for (const unit of parsed.units) {
    if (!isRecord(unit) || typeof unit.unitId !== "string" || typeof unit.translatedAt !== "string" || !Array.isArray(unit.blocks)) {
      return null;
    }
    const blocks = unit.blocks.filter(
      (block): block is TranslatedBlock => isRecord(block) && typeof block.hash === "string" && typeof block.text === "string",
    );
    if (blocks.length !== unit.blocks.length) return null;
    units.push({ blocks, translatedAt: unit.translatedAt, unitId: unit.unitId });
  }
  return { pairId: parsed.pairId, schemaVersion: 1, units };
}

/* ---- Lo que este equipo recuerda, por cuenta ---------------------------------------------- */

const stateKey = "pliegue-translation-cloud-v1";
const emptyState = (): TranslationCloudState => ({ cloud: {}, held: {} });

export interface TranslationStateStore {
  load(): TranslationCloudState;
  save(state: TranslationCloudState): void;
}

export function localTranslationState(userId: string): TranslationStateStore {
  return {
    load() {
      try {
        const all = JSON.parse(window.localStorage.getItem(stateKey) ?? "{}") as Record<string, TranslationCloudState>;
        const mine = all[userId];
        return mine && isRecord(mine.cloud) && isRecord(mine.held) ? { cloud: { ...mine.cloud }, held: { ...mine.held } } : emptyState();
      } catch {
        return emptyState();
      }
    },
    save(state) {
      try {
        // Solo la cuenta con sesión: entrar con otra empieza de cero, como la sincronización.
        window.localStorage.setItem(stateKey, JSON.stringify({ [userId]: state }));
      } catch {
        // Sin almacenamiento, la próxima vuelta vuelve a comparar con la nube.
      }
    },
  };
}

/* ---- La colección: el índice de lo que hay en la nube ------------------------------------- */

/**
 * `translation-files` en `sync_items`. Su estado local es lo que este equipo sabe de la nube,
 * no las traducciones que tiene: borrar las de aquí no borra nada fuera. No va ligada a un
 * documento (`docKeyOf` da null), así que llega entera aunque el libro no esté en este equipo:
 * el cupo se cuenta con todo.
 */
export function translationFilesCollection(state: (userId: string) => TranslationStateStore = localTranslationState): SyncCollection {
  return {
    async apply(entries, context) {
      if (!context.userId) return;
      const store = state(context.userId);
      const current = store.load();
      for (const item of entries) {
        if (item.deleted) delete current.cloud[item.key];
        else if (isCloudTranslation(item.payload)) current.cloud[item.key] = item.payload;
      }
      store.save(current);
    },
    consent: "translations",
    docKeyOf: () => null,
    name: "translation-files",
    snapshot(context) {
      const items = new Map<string, ReturnType<typeof entry>>();
      if (!context.userId) return items;
      for (const [key, file] of Object.entries(state(context.userId).load().cloud)) {
        items.set(key, entry(key, file, file.updatedAt, null));
      }
      return items;
    },
  };
}

function isCloudTranslation(value: unknown): value is CloudTranslation {
  return (
    isRecord(value) &&
    typeof value.hash === "string" &&
    typeof value.pairId === "string" &&
    typeof value.size === "number" &&
    typeof value.updatedAt === "string"
  );
}

/* ---- Subir y bajar ------------------------------------------------------------------------- */

export interface TranslationStorage {
  download(path: string): Promise<string>;
  upload(path: string, json: string): Promise<void>;
}

/** Las traducciones de este equipo (IndexedDB en la app; en memoria en las pruebas). */
export interface TranslationUnits {
  merge(records: readonly TranslatedUnitRecord[]): Promise<number>;
  pairs(): Promise<Array<{ documentId: string; pairId: string }>>;
  read(documentId: string, pairId: string): Promise<TranslatedUnitRecord[]>;
}

export interface SkippedTranslation {
  itemKey: string;
  reason: "quota" | "size";
  size: number;
}

export interface TranslationTransfer {
  /** Lo que ocupa todo lo de la cuenta tras esta vuelta. */
  cloudBytes: number;
  cloudFiles: number;
  downloaded: number;
  /** Lo que aún no tocaba subir (se sigue traduciendo): se mira en la próxima vuelta. */
  later: Set<string>;
  skipped: SkippedTranslation[];
  uploaded: number;
}

/** Una traducción de este equipo como texto, para guardarla en un conjunto. */
export const pairRef = (documentId: string, pairId: string) => JSON.stringify([documentId, pairId]);

function parsePairRef(ref: string) {
  const [documentId = "", pairId = ""] = JSON.parse(ref) as [string, string];
  return { documentId, pairId };
}

/**
 * Una vuelta de traducciones, después de la de `sync_items`:
 * 1. Baja lo que la nube tiene más nuevo de los libros que hay aquí y lo junta con lo de aquí
 *    (una página ya traducida aquí se conserva).
 * 2. Sube lo que aquí es distinto de la nube, si cabe: 5 MB por archivo y 200 MB por cuenta.
 *
 * `dirty` son las traducciones escritas aquí desde la última vuelta; `null`, revisarlas todas
 * (la primera vuelta de la sesión o al dar el permiso).
 */
export async function transferTranslations({
  dirty,
  keys,
  now,
  state,
  storage,
  units,
  userId,
}: {
  dirty: ReadonlySet<string> | null;
  keys: LibraryKeys;
  now: Date;
  state: TranslationStateStore;
  storage: TranslationStorage;
  units: TranslationUnits;
  userId: string;
}): Promise<TranslationTransfer> {
  const current = state.load();
  const result: TranslationTransfer = { cloudBytes: 0, cloudFiles: 0, downloaded: 0, later: new Set(), skipped: [], uploaded: 0 };
  const toCheck = new Set<string>(dirty ?? []);
  /** Traducciones que tienen páginas que la nube no tiene: se suben aunque sean antiguas. */
  const ahead = new Set<string>();

  // ---- 1. Bajar ----
  for (const [itemKey, file] of Object.entries(current.cloud)) {
    if (current.held[itemKey] === file.hash) continue;
    const document = keys.documentByKey.get(itemKey.split("/")[0] ?? "");
    if (!document) continue;
    const local = await units.read(document.id, file.pairId);
    if (local.length && buildTranslationFile(file.pairId, local).hash === file.hash) {
      current.held[itemKey] = file.hash;
      continue;
    }
    const parsed = parseTranslationFile(await storage.download(translationObjectPath(userId, itemKey)));
    if (!parsed || parsed.pairId !== file.pairId) continue;
    await units.merge(
      parsed.units.map((unit) => ({
        blocks: unit.blocks,
        documentId: document.id,
        key: translatedUnitKey(document.id, parsed.pairId, unit.unitId),
        pairId: parsed.pairId,
        translatedAt: unit.translatedAt,
        unitId: unit.unitId,
      })),
    );
    current.held[itemKey] = file.hash;
    state.save(current);
    result.downloaded += 1;
    // Si aquí había páginas que la nube no tenía, lo juntado es más: se sube. Una página que
    // los dos tienen con otro texto no cuenta: cada equipo se queda la suya y no se pisan.
    const inCloud = new Set(parsed.units.map((unit) => unit.unitId));
    if (local.some((record) => !inCloud.has(record.unitId))) {
      const ref = pairRef(document.id, parsed.pairId);
      ahead.add(ref);
      toCheck.add(ref);
    }
  }

  // ---- 2. Subir ----
  const candidates = dirty === null ? (await units.pairs()).map(({ documentId, pairId }) => pairRef(documentId, pairId)) : [];
  for (const ref of candidates) toCheck.add(ref);
  for (const ref of toCheck) {
    const { documentId, pairId } = parsePairRef(ref);
    const docKey = keys.keyById.get(documentId);
    if (!docKey) continue;
    const records = await units.read(documentId, pairId);
    if (!records.length) continue;
    const latest = records.reduce((max, record) => (record.translatedAt > max ? record.translatedAt : max), "");
    if (now.getTime() - Date.parse(latest) < translationQuietMs) {
      result.later.add(ref);
      continue;
    }
    const itemKey = translationItemKey(docKey, pairId);
    const file = buildTranslationFile(pairId, records);
    const cloud = current.cloud[itemKey];
    if (cloud?.hash === file.hash) {
      current.held[itemKey] = file.hash;
      continue;
    }
    // Distinto de la nube, pero nada nuevo: lo de la nube es posterior y lo de aquí solo difiere
    // en páginas que los dos tienen. Subirlo haría que dos equipos se pisaran en cada vuelta.
    if (cloud && !ahead.has(ref) && latest <= cloud.updatedAt) continue;
    if (file.size > translationFileMaxBytes) {
      result.skipped.push({ itemKey, reason: "size", size: file.size });
      continue;
    }
    const used = Object.values(current.cloud).reduce((sum, item) => sum + item.size, 0);
    if (used - (current.cloud[itemKey]?.size ?? 0) + file.size > translationQuotaBytes) {
      result.skipped.push({ itemKey, reason: "quota", size: file.size });
      continue;
    }
    await storage.upload(translationObjectPath(userId, itemKey), file.json);
    current.cloud[itemKey] = { hash: file.hash, pairId, size: file.size, updatedAt: now.toISOString() };
    current.held[itemKey] = file.hash;
    // Se guarda en cada paso: si la siguiente subida falla, esta ya consta como hecha.
    state.save(current);
    result.uploaded += 1;
  }

  state.save(current);
  result.cloudFiles = Object.keys(current.cloud).length;
  result.cloudBytes = Object.values(current.cloud).reduce((sum, item) => sum + item.size, 0);
  return result;
}
