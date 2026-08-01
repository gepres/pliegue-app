import type { DocumentReference, LibraryDocument } from "./documents";
import type { LocalContentIndex } from "./local-content-index";
import {
  createFileFingerprint,
  formatFileSize,
  type LocalFileDescriptor,
  validateLocalFile,
} from "./local-file-metadata";

export interface LinkedFileDocument extends LibraryDocument {
  addedAt: string;
  fingerprint: string;
  lastModified: number;
  linked: true;
  originalName: string;
  reference: Extract<DocumentReference, { kind: "local-file" }>;
  sizeBytes: number;
}

export function createLinkedFileDocument(
  file: LocalFileDescriptor,
  id: string,
  addedAt: string,
  index: LocalContentIndex,
): LinkedFileDocument {
  const validation = validateLocalFile(file);
  if (!validation.valid) throw new Error(validation.reason);
  const title = file.name.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").trim();

  return {
    ...index,
    addedAt,
    author: "Archivo original vinculado",
    availability: "available",
    fingerprint: createFileFingerprint(file),
    format: validation.format,
    id,
    lastModified: file.lastModified,
    linked: true,
    meta: `${formatFileSize(file.size)} · Referencia local · Sin copia`,
    origin: "local",
    originalName: file.name,
    reference: { kind: "local-file", referenceId: id },
    sizeBytes: file.size,
    tags: title.toLocaleLowerCase("es").split(/\s+/).filter(Boolean),
    title: title || file.name,
  };
}
