import type { DriveListedFile } from "../drive/drive-files";
import { applyImportedCatalogs, createImportedCatalogRecords, parseCatalogImportFile } from "./catalog-import";
import { createDriveDocument, type DriveDocument } from "./drive-document";

/**
 * La biblioteca general: los libros de una carpeta pública de Drive, para quien entra con un
 * código y sin cuenta. Independiente de la biblioteca personal: sus documentos llevan el prefijo
 * `general:` y lo que el visitante marque, anote o traduzca se queda en su navegador. Se filtra y
 * se ordena con las mismas funciones que la biblioteca personal (`filterDocuments`,
 * `sortDocuments`), así que se comporta igual.
 */
export const generalLibraryPath = "/biblioteca/general";

export function generalDocumentId(fileId: string) {
  return `general:${fileId}`;
}

/** El archivo de Drive de un documento de la biblioteca general. */
export function generalFileId(documentId: string) {
  return documentId.startsWith("general:") ? documentId.slice("general:".length) : documentId;
}

export function generalReaderHref(fileId: string, resume = false) {
  return `${generalLibraryPath}/leer?libro=${encodeURIComponent(fileId)}${resume ? "&resume=1" : ""}`;
}

/** El índice JSON de Pliegue que acompaña a la carpeta, si lo hay (el más reciente). */
const catalogFilePattern = /^pliegue-catalogo.*\.json$/i;

export function findCatalogFile(files: readonly DriveListedFile[]) {
  return (
    files
      .filter((file) => catalogFilePattern.test(file.name))
      .sort((left, right) => (right.modifiedTime ?? "").localeCompare(left.modifiedTime ?? ""))[0] ?? null
  );
}

export interface GeneralLibrary {
  /** Libros con su ficha del índice. */
  catalogued: number;
  documents: DriveDocument[];
  /** Copias repetidas que el índice marca (se ocultan con «Ocultar duplicados»). */
  duplicates: number;
}

/** Arma la biblioteca con los archivos de la carpeta y, si lo hay, su índice JSON ya leído. */
export function buildGeneralLibrary(files: readonly DriveListedFile[], catalog: unknown, addedAt: string): GeneralLibrary {
  let documents: DriveDocument[] = files
    .filter((file) => !catalogFilePattern.test(file.name))
    .map((file) => createDriveDocument(file, { addedAt, relativePath: file.relativePath, sourceId: "general", sourceName: null }))
    .filter((document): document is DriveDocument => Boolean(document))
    .map((document) => ({ ...document, author: "", id: generalDocumentId(document.reference.fileId) }));

  if (catalog !== null && catalog !== undefined) {
    try {
      documents = applyImportedCatalogs(documents, createImportedCatalogRecords(parseCatalogImportFile(catalog), addedAt)) as DriveDocument[];
    } catch {
      // Un índice roto no deja la biblioteca vacía: se muestra con los nombres de archivo.
    }
  }

  return {
    catalogued: documents.filter((document) => document.catalogSource === "import").length,
    documents,
    duplicates: documents.filter((document) => document.organization?.duplicateOf).length,
  };
}
