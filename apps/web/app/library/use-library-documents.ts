"use client";

import { useMemo } from "react";

import { useDocumentCatalogs } from "../ai/document-catalog-store";
import { applyCopyGroups } from "./book-copies";
import { useCopyGroups } from "./book-copies-store";
import { applyImportedCatalogs } from "./catalog-import";
import { applyDocumentCatalogs } from "./documents";
import { useDriveLibrary } from "./drive-library-store";
import { applyDuplicateMarks, useDuplicateDecisions } from "./duplicate-store";
import { applyFetchedCovers, useFetchedCovers } from "./fetched-cover-store";
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
  const fetchedCovers = useFetchedCovers();
  const copyGroups = useCopyGroups();
  const duplicateDecisions = useDuplicateDecisions();

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
  // dedujo el modelo, que es lo que espera quien acaba de corregirla a mano. Las portadas de
  // Open Library van en medio: llenan lo que falta, pero no pisan la del índice JSON.
  // Las marcas de duplicado que la persona hace en la app van al final: son más recientes que
  // las del índice JSON (03.6).
  const allDocuments = useMemo(
    () =>
      applyDuplicateMarks(
        applyImportedCatalogs(
          applyFetchedCovers(applyDocumentCatalogs(baseDocuments, catalogs.records), fetchedCovers.records),
          importedCatalogs.records,
        ),
        duplicateDecisions.records,
      ),
    [baseDocuments, catalogs.records, duplicateDecisions.records, fetchedCovers.records, importedCatalogs.records],
  );

  return {
    allDocuments,
    baseDocuments,
    catalogs,
    driveLibrary,
    fetchedCovers,
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
