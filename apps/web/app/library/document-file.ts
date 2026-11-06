"use client";

import type { LibraryDocument } from "./documents";
import { readDriveDocumentFile } from "./drive-library-store";
import { readLinkedFile } from "./local-file-reference-store";
import { readLinkedDocumentFile } from "./local-folder-store";
import { readImportedDocumentFile } from "./local-library-store";

/**
 * El archivo de un documento, venga de donde venga: una carpeta vinculada, un archivo suelto,
 * Google Drive o una copia importada. Lo mismo que hace el lector al abrirlo, para quien
 * necesita el archivo fuera de él: el catálogo, que lee con OCR el principio de un escaneo
 * (03.4). `null` si ya no está o falta el permiso de lectura (una carpeta o un archivo
 * vinculados lo piden al abrirlos con un gesto: se concede abriendo el libro una vez).
 */
export async function readDocumentFile(document: Pick<LibraryDocument, "id" | "reference">): Promise<Blob | null> {
  const reference = document.reference;
  const record =
    reference.kind === "local-folder"
      ? await readLinkedDocumentFile(document.id, reference.sourceId)
      : reference.kind === "local-file"
        ? await readLinkedFile(document.id)
        : reference.kind === "google-drive"
          ? await readDriveDocumentFile(document.id)
          : await readImportedDocumentFile(document.id);
  if (!record) return null;
  return "file" in record ? record.file : record.blob;
}
