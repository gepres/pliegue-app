"use client";

import { useMemo } from "react";

import { useDocumentCatalogs } from "../ai/document-catalog-store";
import { applyImportedCatalogs } from "./catalog-import";
import { applyDocumentCatalogs } from "./documents";
import { useImportedCatalogs } from "./imported-catalog-store";
import { useLinkedFiles } from "./local-file-reference-store";
import { useLinkedFolders } from "./local-folder-store";
import { useImportedDocuments } from "./local-library-store";

/**
 * La biblioteca tal como se muestra: archivos vinculados, carpetas y copias, con la ficha de
 * la IA y encima la importada. Lo comparten la Biblioteca y la vista de Fuentes para que las
 * dos cuenten exactamente los mismos documentos.
 */
export function useLibraryDocuments() {
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const catalogs = useDocumentCatalogs();
  const importedCatalogs = useImportedCatalogs();

  const baseDocuments = useMemo(
    () => [...linkedFiles.documents, ...linkedFolders.documents, ...importedLibrary.documents],
    [importedLibrary.documents, linkedFiles.documents, linkedFolders.documents],
  );

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
    importedCatalogs,
    importedLibrary,
    linkedFiles,
    linkedFolders,
    loading:
      importedLibrary.status !== "ready" ||
      linkedFiles.status !== "ready" ||
      linkedFolders.status !== "ready",
    storageError: importedLibrary.error ?? linkedFiles.error ?? linkedFolders.error,
  };
}
