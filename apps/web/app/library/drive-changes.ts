import type { DriveChange } from "../drive/drive-api";
import {
  driveFileSize,
  isDriveFolder,
  isReadableDriveFile,
  type DriveFileMeta,
  type DriveListedFile,
} from "../drive/drive-files";
import { createDriveDocument, sameDriveContent, type DriveDocument } from "./drive-document";
import { carriedIndexFields, isCurrentContentIndex } from "./local-content-index";
import { compareFolderDocuments, maxSkippedFiles, type FolderChangeSummary, type SkippedLinkedFile } from "./local-folder";

/**
 * «Buscar cambios» en una carpeta de Drive con `changes.list` (03.1): en lugar de recorrer
 * otra vez cada subcarpeta (una petición por carpeta), se pide solo lo que cambió desde la
 * última vez. Lo que no se sabe resolver con seguridad —una subcarpeta renombrada, movida o
 * que entra en el árbol con contenido— vuelve al recorrido completo: es más lento, pero exacto.
 */

/** Por encima de tantos cambios sale más claro recorrer la carpeta de nuevo. */
export const maxIncrementalChanges = 5_000;

/** Un archivo omitido de Drive recuerda su id para poder quitarlo de la lista si cambia. */
export interface SkippedDriveFile extends SkippedLinkedFile {
  fileId?: string;
}

export type DriveChangePlan =
  | { kind: "full"; reason: string }
  | {
      kind: "apply";
      /** Las carpetas del árbol después de los cambios (la raíz, con ruta vacía). */
      folders: Record<string, string>;
      /** Archivos que siguen o entran en el árbol, con su ruta nueva. */
      upserts: DriveListedFile[];
      /** Archivos que salieron del árbol o se borraron. */
      removals: string[];
    };

function joinPath(prefix: string, name: string) {
  return prefix ? `${prefix}/${name}` : name;
}

function parentPrefix(file: DriveFileMeta, folders: Record<string, string>) {
  const parent = file.parents?.find((id) => id in folders);
  return parent === undefined ? null : folders[parent]!;
}

/**
 * Decide qué hacer con una lista de cambios. `knownFileIds` son los archivos que la carpeta
 * tenía (documentos y omitidos); los cambios llegan en orden y el último de cada archivo manda.
 */
export function planDriveChanges(
  changes: readonly DriveChange[],
  tree: { folders: Record<string, string>; rootId: string },
  knownFileIds: ReadonlySet<string>,
): DriveChangePlan {
  if (changes.length > maxIncrementalChanges) return { kind: "full", reason: "demasiados cambios" };
  const folders = { ...tree.folders };
  const upserts = new Map<string, DriveListedFile>();
  const removals = new Set<string>();

  for (const change of changes) {
    // Los cambios de una unidad compartida (su nombre, sus permisos) no tocan archivos.
    if (change.changeType === "drive") continue;
    const fileId = change.fileId ?? change.file?.id;
    if (!fileId) continue;
    const file = change.file;
    const gone = Boolean(change.removed || !file || file.trashed);

    if (fileId === tree.rootId) {
      if (gone) return { kind: "full", reason: "la carpeta vinculada cambió" };
      continue; // Renombrar la raíz no cambia ninguna ruta relativa.
    }

    if (fileId in folders) {
      // Una subcarpeta conocida que se borra, se mueve o se renombra cambia las rutas de todo
      // lo que tiene dentro, y `changes.list` no las manda: se recorre de nuevo.
      if (gone || !file) return { kind: "full", reason: "una subcarpeta se borró" };
      const prefix = parentPrefix(file, folders);
      if (prefix === null || joinPath(prefix, file.name) !== folders[fileId]) {
        return { kind: "full", reason: "una subcarpeta se movió o cambió de nombre" };
      }
      continue;
    }

    if (file && isDriveFolder(file)) {
      if (gone || parentPrefix(file, folders) === null) continue;
      // Una carpeta que entra en el árbol puede traer contenido que no aparece en los cambios.
      return { kind: "full", reason: "una carpeta nueva entró en la biblioteca" };
    }

    const prefix = file && !gone ? parentPrefix(file, folders) : null;
    if (file && prefix !== null) {
      upserts.set(fileId, { ...file, relativePath: joinPath(prefix, file.name) });
      removals.delete(fileId);
    } else {
      upserts.delete(fileId);
      if (knownFileIds.has(fileId)) removals.add(fileId);
    }
  }

  return { folders, kind: "apply", removals: [...removals], upserts: [...upserts.values()] };
}

/** Conserva el índice de un documento cuyo contenido no cambió; si cambió, queda pendiente. */
export function carryIndex(previous: DriveDocument | undefined, next: DriveDocument): DriveDocument {
  if (!previous) return next;
  const { indexStatus, indexVersion } = previous;
  const reusable =
    sameDriveContent(previous, next) &&
    (indexStatus === "indexed" || indexStatus === "metadata-only") &&
    indexVersion !== undefined &&
    isCurrentContentIndex(indexVersion);
  if (!reusable) return { ...next, addedAt: previous.addedAt };
  return {
    ...next,
    ...carriedIndexFields(previous),
    addedAt: previous.addedAt,
    indexedAt: previous.indexedAt ?? previous.addedAt,
    indexStatus,
    indexVersion,
    searchText: previous.searchText ?? "",
  };
}

export interface AppliedDriveChanges {
  /** Lo que hay que escribir: documentos nuevos o cambiados. */
  put: DriveDocument[];
  /** Ids de documento que hay que borrar. */
  deleteIds: string[];
  /** Todos los documentos de la carpeta después de los cambios. */
  documents: DriveDocument[];
  skippedFiles: SkippedDriveFile[];
  summary: FolderChangeSummary;
}

/** Aplica un plan a los documentos que la carpeta tenía. Puro: el almacén solo escribe el resultado. */
export function applyDriveChangePlan(input: {
  now: string;
  plan: Extract<DriveChangePlan, { kind: "apply" }>;
  previous: readonly DriveDocument[];
  skippedFiles: readonly SkippedDriveFile[];
  sourceId: string;
  sourceName: string;
}): AppliedDriveChanges {
  const byFileId = new Map(input.previous.map((document) => [document.reference.fileId, document]));
  const next = new Map(byFileId);
  const touched = new Set([...input.plan.removals, ...input.plan.upserts.map((file) => file.id)]);
  const skipped = input.skippedFiles.filter((file) => !file.fileId || !touched.has(file.fileId));
  const put: DriveDocument[] = [];

  for (const fileId of input.plan.removals) next.delete(fileId);
  for (const file of input.plan.upserts) {
    const document = createDriveDocument(file, {
      addedAt: input.now,
      relativePath: file.relativePath,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
    });
    if (!document) {
      next.delete(file.id);
      if (!isReadableDriveFile(file) && skipped.length < maxSkippedFiles) {
        skipped.push({ fileId: file.id, relativePath: file.relativePath, size: driveFileSize(file) });
      }
      continue;
    }
    const carried = carryIndex(byFileId.get(file.id), document);
    next.set(file.id, carried);
    put.push(carried);
  }

  const documents = [...next.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "es"));
  const keptIds = new Set(documents.map((document) => document.id));
  return {
    deleteIds: input.previous.filter((document) => !keptIds.has(document.id)).map((document) => document.id),
    documents,
    put,
    skippedFiles: skipped,
    summary: compareFolderDocuments(input.previous, documents),
  };
}
