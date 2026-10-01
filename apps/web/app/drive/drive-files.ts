import type { DocumentFormat } from "../library/documents";
import { getLocalDocumentFormat } from "../library/local-file-metadata";

/**
 * Lo que Pliegue sabe de un archivo de Drive sin descargarlo. Drive devuelve el tamaño como
 * texto y no lo da para los Documentos de Google, que no ocupan cuota.
 */
export interface DriveFileMeta {
  driveId?: string;
  id: string;
  md5Checksum?: string;
  mimeType: string;
  modifiedTime?: string;
  name: string;
  parents?: string[];
  size?: string;
  trashed?: boolean;
}

/** Un archivo encontrado al recorrer una carpeta, con su ruta desde la raíz vinculada. */
export interface DriveListedFile extends DriveFileMeta {
  relativePath: string;
}

export const driveFolderMimeType = "application/vnd.google-apps.folder";
export const googleDocMimeType = "application/vnd.google-apps.document";
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const googleAppsPrefix = "application/vnd.google-apps.";

/** Los campos que se piden de cada archivo: los mismos al elegir, al listar y al revisar. */
export const driveFileFields =
  "id,name,mimeType,size,modifiedTime,md5Checksum,driveId,parents,trashed";

export const driveApiBase = "https://www.googleapis.com/drive/v3";

export function isDriveFolder(file: Pick<DriveFileMeta, "mimeType">) {
  return file.mimeType === driveFolderMimeType;
}

/**
 * Cómo lo leerá Pliegue. Los Documentos de Google se exportan a DOCX; el resto de formatos
 * propios de Google (Hojas, Presentaciones, formularios…) no se leen por ahora.
 */
export function driveDocumentFormat(file: Pick<DriveFileMeta, "mimeType" | "name">): DocumentFormat | null {
  if (file.mimeType === googleDocMimeType) return "docx";
  if (file.mimeType.startsWith(googleAppsPrefix)) return null;
  return getLocalDocumentFormat(file.name);
}

/** El nombre con extensión: un Documento de Google no la tiene y se lee como DOCX. */
export function driveFileName(file: Pick<DriveFileMeta, "mimeType" | "name">) {
  return file.mimeType === googleDocMimeType && !/\.docx$/i.test(file.name) ? `${file.name}.docx` : file.name;
}

export function driveFileSize(file: Pick<DriveFileMeta, "size">) {
  const size = Number(file.size ?? 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

export function driveModifiedMs(file: Pick<DriveFileMeta, "modifiedTime">) {
  const time = file.modifiedTime ? Date.parse(file.modifiedTime) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

/** Si Pliegue puede convertirlo en documento: formato conocido y, salvo los de Google, con contenido. */
export function isReadableDriveFile(file: DriveFileMeta) {
  if (file.trashed || isDriveFolder(file)) return false;
  const format = driveDocumentFormat(file);
  if (!format) return false;
  return file.mimeType === googleDocMimeType || driveFileSize(file) > 0;
}

/** Dónde está el contenido: la descarga directa o, para un Documento de Google, su exportación. */
export function driveContentUrl(file: Pick<DriveFileMeta, "id" | "mimeType">) {
  const id = encodeURIComponent(file.id);
  return file.mimeType === googleDocMimeType
    ? `${driveApiBase}/files/${id}/export?mimeType=${encodeURIComponent(docxMimeType)}`
    : `${driveApiBase}/files/${id}?alt=media&supportsAllDrives=true`;
}
