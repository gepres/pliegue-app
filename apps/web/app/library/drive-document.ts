import {
  driveDocumentFormat,
  driveFileName,
  driveFileSize,
  driveModifiedMs,
  googleDocMimeType,
  isReadableDriveFile,
  type DriveFileMeta,
} from "../drive/drive-files";
import type { DocumentReference, LibraryDocument } from "./documents";
import { formatFileSize } from "./local-file-metadata";
import { createLinkedFileFingerprint, maxSkippedFiles, type SkippedLinkedFile } from "./local-folder";

/**
 * Un documento que vive en Google Drive. Pliegue guarda la referencia y el índice, nunca una
 * copia: al abrirlo se descarga de Drive a la memoria de la pestaña.
 */
export interface DriveDocument extends LibraryDocument {
  addedAt: string;
  /**
   * El SHA-256 que da Drive: con él se reconoce la misma copia en una carpeta local sin
   * descargar nada (ver `book-copies.ts`). `null` en los Documentos de Google; ausente en
   * los documentos guardados antes de pedirlo, que se completan solos.
   */
  contentSha256?: string | null;
  driveId: string | null;
  fingerprint: string;
  lastModified: number;
  linked: true;
  md5Checksum: string | null;
  mimeType: string;
  originalName: string;
  reference: Extract<DocumentReference, { kind: "google-drive" }>;
  /** Ruta desde la carpeta vinculada; para un archivo elegido suelto, su nombre. */
  relativePath: string;
  sizeBytes: number;
  /** La carpeta de Drive vinculada, o `null` si se eligió suelto en el selector. */
  sourceId: string | null;
}

export function createDriveDocumentId(sourceId: string | null, fileId: string) {
  return `drive:${sourceId ?? "archivos"}:${fileId}`;
}

export function createDriveDocument(
  file: DriveFileMeta,
  placement: { addedAt: string; relativePath?: string; sourceId: string | null; sourceName: string | null },
): DriveDocument | null {
  const format = driveDocumentFormat(file);
  if (!format || !isReadableDriveFile(file)) return null;

  const name = driveFileName(file);
  const relativePath = placement.relativePath
    ? placement.relativePath.replace(/[^/]+$/, () => name)
    : name;
  const sizeBytes = driveFileSize(file);
  const lastModified = driveModifiedMs(file);
  const title = name.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").trim();
  const tags = relativePath
    .replace(/\.[^.]+$/, "")
    .split(/[\s/_.-]+/)
    .map((tag) => tag.toLocaleLowerCase("es"))
    .filter(Boolean);

  return {
    addedAt: placement.addedAt,
    author: placement.sourceName ? `Google Drive · ${placement.sourceName}` : "Google Drive",
    availability: "available",
    contentSha256: file.sha256Checksum?.toLowerCase() ?? null,
    driveId: file.driveId ?? null,
    // La misma forma que la huella de las carpetas locales: si Drive conserva la fecha del
    // archivo, un índice JSON de la biblioteca en disco también encaja aquí.
    fingerprint: createLinkedFileFingerprint({ lastModified, name, relativePath, size: sizeBytes, type: file.mimeType }),
    format,
    id: createDriveDocumentId(placement.sourceId, file.id),
    indexStatus: "pending",
    lastModified,
    linked: true,
    md5Checksum: file.md5Checksum ?? null,
    meta: `${relativePath} · ${file.mimeType === googleDocMimeType ? "Documento de Google" : formatFileSize(sizeBytes)}`,
    mimeType: file.mimeType,
    origin: "drive",
    originalName: name,
    reference: { kind: "google-drive", ...(file.driveId ? { driveId: file.driveId } : {}), fileId: file.id },
    relativePath,
    searchText: "",
    sizeBytes,
    sourceId: placement.sourceId,
    tags,
    title: title || name,
  };
}

/** El contenido no cambió: misma huella y, si Drive la da, misma suma MD5. */
export function sameDriveContent(previous: DriveDocument, next: DriveDocument) {
  return previous.fingerprint === next.fingerprint && previous.md5Checksum === next.md5Checksum;
}

/** Lo que el recorrido encontró pero Pliegue no lee, en el mismo formato que las carpetas locales. */
export function listSkippedDriveFiles(files: readonly (DriveFileMeta & { relativePath: string })[]): SkippedLinkedFile[] {
  return files
    .filter((file) => !file.trashed && !isReadableDriveFile(file))
    .slice(0, maxSkippedFiles)
    .map((file) => ({ relativePath: file.relativePath, size: driveFileSize(file) }));
}
