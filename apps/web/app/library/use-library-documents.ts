"use client";

import { useMemo } from "react";

import { useDocumentCatalogs } from "../ai/document-catalog-store";
import { applyCopyGroups } from "./book-copies";
import { useCopyGroups } from "./book-copies-store";
import { applyImportedCatalogs } from "./catalog-import";
import { applyDocumentCatalogs } from "./documents";
import { useDriveLibrary } from "./drive-library-store";
import { useImportedCatalogs } from "./imported-catalog-store";
import { useLinkedFiles } from "./local-file-reference-store";
import { useLinkedFolders } from "./local-folder-store";
import { useImportedDocuments } from "./local-library-store";

/**
 * La biblioteca tal como se muestra: archivos vinculados, carpetas, Google Drive y copias, con la ficha de
 * la IA y encima la importada. Lo comparten la Biblioteca y la vista de Fuentes para que las
 * dos cuenten exactamente los mismos documentos.
 *
 * Un libro con varias copias idénticas (en local y en Drive, por ejemplo) sale una sola vez: la
 * copia que guarda su estado, con la lista de las demás (`book-copies.ts`). `rawDocuments`
 * conserva todas las copias, para quien necesita cada archivo.
 */
export function useLibraryDocuments() {
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const driveLibrary = useDriveLibrary();
  const catalogs = useDocumentCatalogs();
  const importedCatalogs = useImportedCatalogs();
  const copyGroups = useCopyGroups();

  const rawDocuments = useMemo(
    () => [
      ...linkedFiles.documents,
      ...linkedFolders.documents,
      ...driveLibrary.documents,
      ...importedLibrary.documents,
    ],
    [driveLibrary.documents, importedLibrary.documents, linkedFiles.documents, linkedFolders.documents],
  );
  const baseDocuments = useMemo(() => applyCopyGroups(rawDocuments, copyGroups), [copyGroups, rawDocuments]);

  // El orden importa: la ficha importada se aplica después para que prevalezca sobre la que
  // dedujo el modelo, que es lo que espera quien acaba de corregirla a mano.
  const allDocuments = useMemo(
    () =>
      applyImportedCatalogs(
        applyDocumentCatalogs(baseDocuments, catalogs.records),
        importedCatalogs.records,
      ),
    [baseDocuments, catalogs.records, importedCatalogs.records],
  );

  return {
    allDocuments,
    baseDocuments,
    catalogs,
    driveLibrary,
    importedCatalogs,
    importedLibrary,
    linkedFiles,
    linkedFolders,
    rawDocuments,
    loading:
      importedLibrary.status !== "ready" ||
      linkedFiles.status !== "ready" ||
      linkedFolders.status !== "ready" ||
      driveLibrary.status !== "ready",
    storageError: importedLibrary.error ?? linkedFiles.error ?? linkedFolders.error ?? driveLibrary.error,
  };
}
