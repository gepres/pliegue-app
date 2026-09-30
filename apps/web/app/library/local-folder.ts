import type { DocumentReference, LibraryDocument } from "./documents";
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
  reference: Extract<DocumentReference, { kind: "local-folder" }>;
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

/** Un archivo de la carpeta que Pliegue no sabe leer. */
export interface SkippedLinkedFile {
  relativePath: string;
  size: number;
}

/** Tope de archivos no compatibles que se guardan por carpeta: basta para explicar qué pasa. */
export const maxSkippedFiles = 200;

/**
 * Los archivos que el escaneo deja fuera. Antes se descartaban en silencio y la biblioteca
 * no podía explicar por qué un libro de la carpeta no aparecía: estaba dentro de un RAR, o
 * el PDF había perdido la extensión.
 */
export function listSkippedFiles(files: readonly LinkedFileDescriptor[]): SkippedLinkedFile[] {
  return files
    .filter((file) => !getLocalDocumentFormat(file.name) || file.size <= 0)
    .slice(0, maxSkippedFiles)
    .map((file) => ({ relativePath: normalizeRelativePath(file.relativePath), size: file.size }));
}

export type SkippedFileKind = "archive" | "audio" | "empty" | "legacy-office" | "no-extension" | "other" | "video";

/** Qué es el archivo y qué hacer para que Pliegue pueda leerlo. */
export function describeSkippedFile(file: SkippedLinkedFile): { advice: string; kind: SkippedFileKind } {
  const name = file.relativePath.split("/").at(-1) ?? file.relativePath;
  const extension = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLocaleLowerCase("en") ?? null;

  if (file.size <= 0) return { advice: "El archivo está vacío.", kind: "empty" };
  if (!extension) {
    return {
      advice: "No tiene extensión. Si es un PDF, añade «.pdf» al final del nombre.",
      kind: "no-extension",
    };
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) {
    return {
      advice:
        "Es un archivo comprimido y Pliegue no ve lo que hay dentro: extráelo en la carpeta y vuelve a buscar cambios. Si ya lo extrajiste, el comprimido sobra.",
      kind: "archive",
    };
  }
  if (["mp3", "m4a", "wav", "ogg", "flac", "aac"].includes(extension)) {
    return { advice: "Es audio: Pliegue todavía no reproduce ni transcribe sonido.", kind: "audio" };
  }
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(extension)) {
    return { advice: "Es vídeo: Pliegue todavía no lo muestra.", kind: "video" };
  }
  if (["doc", "ppt", "xls", "rtf", "odt"].includes(extension)) {
    return {
      advice: "Formato de oficina antiguo: guárdalo como DOCX, PPTX o XLSX para leerlo aquí.",
      kind: "legacy-office",
    };
  }
  return { advice: `El formato .${extension} no es compatible.`, kind: "other" };
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
