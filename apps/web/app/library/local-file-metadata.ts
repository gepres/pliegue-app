import type { DocumentFormat, DocumentReference, LibraryDocument } from "./documents";

export const maxImportedFileBytes = 50 * 1024 * 1024;

const extensionToFormat: Record<string, DocumentFormat> = {
  docx: "docx",
  epub: "epub",
  jpeg: "jpg",
  jpg: "jpg",
  md: "md",
  pdf: "pdf",
  png: "png",
  pptx: "pptx",
  txt: "txt",
  xlsx: "xlsx",
};

export interface LocalFileDescriptor {
  lastModified: number;
  name: string;
  size: number;
  type: string;
}

export interface ImportedDocument extends LibraryDocument {
  fingerprint: string;
  imported: true;
  importedAt: string;
  lastModified: number;
  mimeType: string;
  originalName: string;
  reference: Extract<DocumentReference, { kind: "local-copy" }>;
  sizeBytes: number;
}

export type FileValidation =
  | { format: DocumentFormat; valid: true }
  | { reason: string; valid: false };

function fileExtension(name: string) {
  return name.split(".").at(-1)?.toLocaleLowerCase("en") ?? "";
}

export function getLocalDocumentFormat(name: string) {
  return extensionToFormat[fileExtension(name)] ?? null;
}

export function validateLocalFile(file: LocalFileDescriptor): FileValidation {
  const format = getLocalDocumentFormat(file.name);

  if (!format) {
    return {
      reason: "Formato no compatible. Usa PDF, EPUB, DOCX, PPTX, XLSX, TXT, Markdown, PNG o JPG.",
      valid: false,
    };
  }

  if (file.size <= 0) {
    return { reason: "El archivo está vacío.", valid: false };
  }

  if (file.size > maxImportedFileBytes) {
    return { reason: "El archivo supera el límite local de 50 MB.", valid: false };
  }

  return { format, valid: true };
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function createFileFingerprint(file: LocalFileDescriptor) {
  return `${file.name.toLocaleLowerCase("en")}::${file.size}::${file.lastModified}`;
}

export function createImportedDocument(
  file: LocalFileDescriptor,
  id: string,
  importedAt: string,
): ImportedDocument {
  const validation = validateLocalFile(file);
  if (!validation.valid) throw new Error(validation.reason);

  const title = file.name.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").trim();

  return {
    author: "Copia importada",
    availability: "offline",
    fingerprint: createFileFingerprint(file),
    format: validation.format,
    id,
    imported: true,
    importedAt,
    lastModified: file.lastModified,
    meta: `${formatFileSize(file.size)} · Guardado en este dispositivo`,
    mimeType: file.type || "application/octet-stream",
    origin: "local",
    originalName: file.name,
    reference: { kind: "local-copy", storageId: id },
    sizeBytes: file.size,
    tags: title.toLocaleLowerCase("es").split(/\s+/).filter(Boolean),
    title: title || file.name,
  };
}
