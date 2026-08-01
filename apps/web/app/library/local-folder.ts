import type { LibraryDocument } from "./documents";
import {
  createFileFingerprint,
  formatFileSize,
  getLocalDocumentFormat,
  type LocalFileDescriptor,
} from "./local-file-metadata";

export const maxLinkedFolderFiles = 5_000;

export interface LinkedFileDescriptor extends LocalFileDescriptor {
  relativePath: string;
}

export interface LinkedFolderDocument extends LibraryDocument {
  fingerprint: string;
  lastModified: number;
  linked: true;
  relativePath: string;
  sizeBytes: number;
  sourceId: string;
}

export interface FolderChangeSummary {
  added: number;
  changed: number;
  removed: number;
  total: number;
  unchanged: number;
}

function normalizeRelativePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function createLinkedDocumentId(sourceId: string, relativePath: string) {
  return `linked:${sourceId}:${normalizeRelativePath(relativePath).toLocaleLowerCase("en")}`;
}

export function createLinkedFileFingerprint(file: LinkedFileDescriptor) {
  return `${normalizeRelativePath(file.relativePath).toLocaleLowerCase("en")}::${createFileFingerprint(file)}`;
}

export function createLinkedFolderDocument(
  file: LinkedFileDescriptor,
  sourceId: string,
  sourceName: string,
): LinkedFolderDocument | null {
  const format = getLocalDocumentFormat(file.name);
  if (!format || file.size <= 0) return null;

  const relativePath = normalizeRelativePath(file.relativePath);
  const title = file.name.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").trim();
  const pathTags = relativePath
    .replace(/\.[^.]+$/, "")
    .split(/[\s/_.-]+/)
    .map((tag) => tag.toLocaleLowerCase("es"))
    .filter(Boolean);

  return {
    author: `Carpeta vinculada · ${sourceName}`,
    availability: "available",
    fingerprint: createLinkedFileFingerprint(file),
    format,
    id: createLinkedDocumentId(sourceId, relativePath),
    lastModified: file.lastModified,
    linked: true,
    meta: `${relativePath} · ${formatFileSize(file.size)}`,
    origin: "local",
    reference: { kind: "local-folder", relativePath, sourceId },
    relativePath,
    sizeBytes: file.size,
    sourceId,
    tags: pathTags,
    title: title || file.name,
  };
}

export function compareFolderDocuments(
  previous: readonly LinkedFolderDocument[],
  current: readonly LinkedFolderDocument[],
): FolderChangeSummary {
  const previousById = new Map(previous.map((document) => [document.id, document]));
  const currentIds = new Set(current.map((document) => document.id));
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  for (const document of current) {
    const priorDocument = previousById.get(document.id);
    if (!priorDocument) added += 1;
    else if (priorDocument.fingerprint !== document.fingerprint) changed += 1;
    else unchanged += 1;
  }

  const removed = previous.reduce(
    (count, document) => count + (currentIds.has(document.id) ? 0 : 1),
    0,
  );

  return { added, changed, removed, total: current.length, unchanged };
}
