"use client";

import { useSyncExternalStore } from "react";

import { readDocumentCatalogRecords, transferDocumentCatalogRecord } from "../ai/document-catalog-store";
import { annotatedDocumentIds, transferAnnotations } from "./annotation-store";
import {
  contentKeyOf,
  planCopyGroups,
  planCopyRelease,
  type CopyGroup,
  type CopyGroupPlan,
} from "./book-copies";
import { transferTranslationPreference } from "./book-translation-preference";
import type { LibraryDocument } from "./documents";
import type { DriveDocument } from "./drive-document";
import {
  adoptDriveIndex,
  backfillDriveChecksums,
  releaseDriveIndexGate,
  setDriveIndexGate,
} from "./drive-library-store";
import { readFavoriteIds, transferFavorite } from "./favorite-store";
import { carriedIndexFields, isCurrentContentIndex } from "./local-content-index";
import { readLinkedFile } from "./local-file-reference-store";
import { readLinkedDocumentFile } from "./local-folder-store";
import { readImportedDocumentFile } from "./local-library-store";
import { readReadingProgressEntries, transferReadingProgress } from "./reading-progress-store";
import { transferTranslations, translatedDocumentIds } from "./translation-store";

// ---- Grupos guardados --------------------------------------------------------------------------

const groupsKey = "pliegue-copias-v1";
const changeEvent = "pliegue-copias-change";
const emptyGroups: CopyGroup[] = [];
let cachedSerialized: string | null | undefined;
let cachedGroups = emptyGroups;

function readGroups(): CopyGroup[] {
  let serialized: string | null = null;
  try {
    serialized = window.localStorage.getItem(groupsKey);
  } catch {
    return emptyGroups;
  }
  if (serialized === cachedSerialized) return cachedGroups;
  cachedSerialized = serialized;
  try {
    const parsed = JSON.parse(serialized ?? "null") as { groups?: unknown; version?: number } | null;
    cachedGroups = Array.isArray(parsed?.groups)
      ? parsed.groups.filter(
          (group): group is CopyGroup =>
            typeof group === "object" &&
            group !== null &&
            typeof (group as CopyGroup).canonicalId === "string" &&
            typeof (group as CopyGroup).contentKey === "string" &&
            Array.isArray((group as CopyGroup).copyIds),
        )
      : emptyGroups;
  } catch {
    cachedGroups = emptyGroups;
  }
  return cachedGroups;
}

function writeGroups(groups: readonly CopyGroup[]) {
  const serialized = JSON.stringify({ groups, version: 1 });
  if (serialized === cachedSerialized) return;
  try {
    window.localStorage.setItem(groupsKey, serialized);
  } catch {
    return;
  }
  cachedSerialized = serialized;
  cachedGroups = [...groups];
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== groupsKey) return;
    cachedSerialized = undefined;
    listener();
  }
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useCopyGroups() {
  return useSyncExternalStore(subscribe, readGroups, () => emptyGroups);
}

export function readCopyGroups() {
  return readGroups();
}

/** El grupo de un documento, si es una de las copias de un libro. */
export function copyGroupOf(groups: readonly CopyGroup[], documentId: string) {
  return groups.find((group) => group.copyIds.includes(documentId)) ?? null;
}

// ---- SHA-256 de los archivos locales ----------------------------------------------------------

const hashDatabaseName = "pliegue-content-hashes";
const hashStoreName = "hashes";
/** Por encima de esto no se calcula: `crypto.subtle` necesita el archivo entero en memoria. */
export const maxHashedBytes = 512 * 1024 * 1024;

function openHashDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(hashDatabaseName, 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(hashStoreName)) {
          request.result.createObjectStore(hashStoreName, { keyPath: "fingerprint" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

async function readHashes() {
  const database = await openHashDatabase();
  try {
    const records = await new Promise<Array<{ fingerprint: string; sha256: string }>>((resolve, reject) => {
      const request = database.transaction(hashStoreName, "readonly").objectStore(hashStoreName).getAll();
      request.addEventListener("success", () => resolve(request.result as Array<{ fingerprint: string; sha256: string }>), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
    return new Map(records.map((record) => [record.fingerprint, record.sha256]));
  } finally {
    database.close();
  }
}

async function saveHash(fingerprint: string, sha256: string) {
  const database = await openHashDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(hashStoreName, "readwrite");
      transaction.objectStore(hashStoreName).put({ fingerprint, sha256 });
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    });
  } finally {
    database.close();
  }
}

export async function sha256OfBlob(blob: Blob) {
  if (blob.size > maxHashedBytes) return null;
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type LocalCopy = LibraryDocument & { fingerprint?: string; sizeBytes?: number; sourceId?: string };

function isLocal(document: LibraryDocument): document is LocalCopy {
  return document.reference.kind !== "google-drive";
}

/** Lee la copia local sin pedir permiso: si el navegador no lo tiene concedido, no se calcula. */
async function readLocalBlob(document: LocalCopy) {
  try {
    if (document.reference.kind === "local-folder") {
      return (await readLinkedDocumentFile(document.id, document.reference.sourceId))?.file ?? null;
    }
    if (document.reference.kind === "local-file") return (await readLinkedFile(document.id))?.file ?? null;
    if (document.reference.kind === "local-copy") return (await readImportedDocumentFile(document.id))?.blob ?? null;
  } catch {
    return null;
  }
  return null;
}

// ---- Estado de cada copia y su traslado ---------------------------------------------------------

/** Qué copias tienen algo que la persona hizo: notas, avance, favorito, traducción o ficha. */
async function documentsWithState() {
  const ids = new Set<string>(readFavoriteIds());
  for (const entry of readReadingProgressEntries()) if (entry.percent > 0) ids.add(entry.documentId);
  const [annotated, translated, catalogs] = await Promise.all([
    annotatedDocumentIds().catch(() => new Set<string>()),
    translatedDocumentIds().catch(() => new Set<string>()),
    readDocumentCatalogRecords().catch(() => []),
  ]);
  for (const id of annotated) ids.add(id);
  for (const id of translated) ids.add(id);
  for (const record of catalogs) if (record.catalog) ids.add(record.documentId);
  try {
    const preferences = JSON.parse(window.localStorage.getItem("pliegue-book-translation") ?? "{}") as Record<string, unknown>;
    for (const id of Object.keys(preferences)) ids.add(id);
  } catch {
    // Sin preferencias guardadas.
  }
  return ids;
}

/**
 * Pasa todo lo que la persona hizo con una copia a otra del mismo libro, juntándolo con lo que
 * ya tuviera: nada se pisa y nada se pierde. Las notas siguen valiendo porque solo se juntan
 * copias idénticas byte a byte.
 */
export async function transferDocumentState(fromId: string, toId: string) {
  if (fromId === toId) return;
  transferFavorite(fromId, toId);
  transferReadingProgress(fromId, toId);
  transferTranslationPreference(fromId, toId);
  await transferAnnotations(fromId, toId);
  await transferTranslations(fromId, toId);
  await transferDocumentCatalogRecord(fromId, toId);
}

async function applyTransfers(plan: CopyGroupPlan) {
  for (const transfer of plan.transfers) await transferDocumentState(transfer.from, transfer.to);
}

// ---- Conciliación ----------------------------------------------------------------------------

/** Los documentos de este equipo, todas las copias. Los registra quien concilia. */
let knownDocuments = new Map<string, LibraryDocument>();

/** Tamaños de las copias locales: un archivo de Drive de uno de esos tamaños podría ser su copia. */
let localSizes = new Set<number>();
/** Archivos de Drive que el conciliador ya comparó: no esperan más para indexarse. */
const comparedDriveIds = new Set<string>();

/**
 * Para que quitar una copia sepa al instante qué otras tiene el libro, sin esperar a conciliar,
 * y para que la indexación de Drive no descargue lo que podría estar ya en local.
 */
export function registerLibraryDocuments(documents: readonly LibraryDocument[]) {
  knownDocuments = new Map(documents.map((document) => [document.id, document]));
  localSizes = new Set(
    documents
      .filter((document) => document.reference.kind !== "google-drive")
      .map((document) => (document as { sizeBytes?: number }).sizeBytes ?? 0)
      .filter((size) => size > 0),
  );
  setDriveIndexGate((document) => !comparedDriveIds.has(document.id) && localSizes.has(document.sizeBytes));
}

/**
 * Antes de quitar copias a mano: si alguna guardaba el estado de un libro que sigue teniendo
 * otras copias, ese estado pasa a una de ellas. Llamar ANTES de borrar nada.
 */
export async function releaseCopies(documentIds: readonly string[]) {
  const plan = planCopyRelease(readGroups(), documentIds, knownDocuments);
  await applyTransfers(plan);
  writeGroups(plan.groups);
  return plan.transfers;
}

/**
 * Para el aviso antes de quitar documentos: cuántos libros siguen en la biblioteca con otra
 * copia, que se queda con sus notas, avance, favoritos y traducciones. `null` si ninguno.
 */
export function copyReleaseNote(documentIds: readonly string[]) {
  const removing = new Set(documentIds);
  const kept = readGroups().filter(
    (group) =>
      group.copyIds.some((id) => removing.has(id)) &&
      group.copyIds.some((id) => !removing.has(id) && knownDocuments.has(id)),
  );
  if (!kept.length) return null;
  const onDrive = kept.every((group) =>
    group.copyIds.some((id) => !removing.has(id) && knownDocuments.get(id)?.reference.kind === "google-drive"),
  );
  const where = onDrive ? "su copia de Google Drive" : "su otra copia";
  return kept.length === 1 && documentIds.length === 1
    ? `El libro sigue en la biblioteca con ${where}: sus notas, avance, favoritos y traducciones pasan a esa copia.`
    : `${kept.length} libro${kept.length === 1 ? "" : "s"} siguen en la biblioteca con ${where}: sus notas, avance, favoritos y traducciones pasan a esa copia.`;
}

let running: Promise<void> | null = null;
let rerun = false;

/**
 * Reconoce las copias del mismo libro y deja el estado en una sola. Llamar solo con todos los
 * almacenes cargados y sin errores: un almacén vacío por estar cargando parecería una copia
 * borrada, y su estado se trasladaría sin motivo.
 */
export function reconcileBookCopies(documents: readonly LibraryDocument[]) {
  registerLibraryDocuments(documents);
  if (running) {
    rerun = true;
    return running;
  }
  running = reconcile(documents)
    .catch(() => undefined)
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        void reconcileBookCopies([...knownDocuments.values()]);
      }
    });
  return running;
}

async function reconcile(documents: readonly LibraryDocument[]) {
  await backfillDriveChecksums().catch(() => 0);

  const drive = documents.filter((document): document is DriveDocument => document.reference.kind === "google-drive");
  const local = documents.filter(isLocal);
  const sizeOf = (document: LibraryDocument) => (document as { sizeBytes?: number }).sizeBytes ?? 0;

  // Solo se calcula el SHA-256 de una copia local si otra copia tiene su mismo tamaño.
  const sizes = new Map<number, number>();
  for (const document of documents) {
    const size = sizeOf(document);
    if (size > 0) sizes.set(size, (sizes.get(size) ?? 0) + 1);
  }
  const hashes = await readHashes().catch(() => new Map<string, string>());
  const pending = local.filter(
    (document) => (sizes.get(sizeOf(document)) ?? 0) > 1 && document.fingerprint && !hashes.has(document.fingerprint),
  );

  // Mientras se compara, la indexación de Drive espera (ver `registerLibraryDocuments`).
  try {
    for (const document of pending) {
      const blob = await readLocalBlob(document);
      const sha256 = blob && blob.size === sizeOf(document) ? await sha256OfBlob(blob) : null;
      if (sha256 && document.fingerprint) {
        hashes.set(document.fingerprint, sha256);
        await saveHash(document.fingerprint, sha256).catch(() => undefined);
      }
    }

    const entries = documents.map((document) => ({
      contentKey:
        document.reference.kind === "google-drive"
          ? contentKeyOf((document as DriveDocument).contentSha256, sizeOf(document))
          : contentKeyOf(hashes.get((document as LocalCopy).fingerprint ?? ""), sizeOf(document)),
      document,
    }));
    const previous = readGroups();
    const stateIds = await documentsWithState();
    const plan = planCopyGroups(entries, previous, (id) => stateIds.has(id));
    await applyTransfers(plan);
    writeGroups(plan.groups);

    // Una copia de Drive de un libro ya indexado toma su índice en vez de descargarse.
    const byId = new Map(documents.map((document) => [document.id, document]));
    for (const group of plan.groups) {
      const members = group.copyIds.map((id) => byId.get(id)).filter((document): document is LibraryDocument => Boolean(document));
      const donor = members.find(
        (document) => document.reference.kind !== "google-drive" && document.indexStatus && document.indexStatus !== "pending" && isCurrentContentIndex(document.indexVersion),
      );
      if (!donor?.indexStatus || donor.indexVersion === undefined) continue;
      for (const member of members) {
        if (member.reference.kind !== "google-drive") continue;
        await adoptDriveIndex(member.id, {
          ...carriedIndexFields(donor),
          indexStatus: donor.indexStatus,
          indexVersion: donor.indexVersion,
          indexedAt: donor.indexedAt ?? new Date().toISOString(),
          searchText: donor.searchText ?? "",
        }).catch(() => false);
      }
    }
  } finally {
    for (const document of drive) comparedDriveIds.add(document.id);
    releaseDriveIndexGate();
  }
}
