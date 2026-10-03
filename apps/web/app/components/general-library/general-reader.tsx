"use client";

import { useCallback, useEffect, useState } from "react";

import { downloadDriveFile, getDriveFile } from "../../drive/drive-api";
import { createDriveDocument, type DriveDocument } from "../../library/drive-document";
import { generalDocumentId, generalLibraryPath } from "../../library/general-library";
import { describeGeneralLibraryError, readCachedGeneralLibrary } from "../../library/general-library-store";
import { ConfirmDialogHost } from "../app-ui/confirm-dialog";
import { LocalReaderShell, ReaderMessage, ReaderPlacementProvider } from "../local-document-reader";

type ReaderState = { document: DriveDocument; status: "ready" } | { message: string; status: "error" } | { status: "loading" };

/**
 * Lee un libro de la biblioteca general con el mismo lector que la biblioteca personal. El
 * archivo se baja de la carpeta pública con la clave de API; el avance, las marcas, las notas y
 * las traducciones se guardan en este navegador con el identificador `general:…`.
 */
export function GeneralReader({
  apiKey,
  fileId,
  folderId,
  resumeRequested,
}: {
  apiKey: string;
  fileId: string;
  folderId: string;
  resumeRequested: boolean;
}) {
  const [state, setState] = useState<ReaderState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    async function resolve() {
      // Lo guardado al ver la biblioteca trae la ficha del índice (título, autores, portada).
      const cached = await readCachedGeneralLibrary(folderId);
      const known = cached?.library.documents.find((document) => document.reference.fileId === fileId);
      if (known) return known;
      const meta = await getDriveFile(fileId, { apiKey });
      const document = createDriveDocument(
        meta,
        { addedAt: new Date().toISOString(), relativePath: meta.name, sourceId: "general", sourceName: null },
      );
      if (!document) throw new Error("Pliegue no sabe leer este archivo.");
      return { ...document, author: "", id: generalDocumentId(fileId) };
    }
    resolve()
      .then((document) => {
        if (active) setState({ document, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          message: error instanceof Error && error.message === "Pliegue no sabe leer este archivo." ? error.message : describeGeneralLibraryError(error),
          status: "error",
        });
      });
    return () => {
      active = false;
    };
  }, [apiKey, fileId, folderId]);

  const mimeType = state.status === "ready" ? state.document.mimeType : null;
  const loadFile = useCallback(
    (onProgress: (loaded: number, total: number | null) => void) =>
      downloadDriveFile({ id: fileId, mimeType: mimeType ?? "application/octet-stream" }, { apiKey }, { onProgress }),
    [apiKey, fileId, mimeType],
  );

  return (
    <ReaderPlacementProvider value={{ backHref: generalLibraryPath, backLabel: "la biblioteca general", backShortLabel: "Biblioteca general", loadFile }}>
      {state.status === "ready" ? (
        <LocalReaderShell document={state.document} key={state.document.id} resumeRequested={resumeRequested} source={state.document} />
      ) : state.status === "error" ? (
        <ReaderMessage description={state.message} eyebrow="Biblioteca general" title="No pudimos abrir este libro" />
      ) : (
        <ReaderMessage description="Buscando el libro en la biblioteca general." eyebrow="Biblioteca general" title="Preparando lector" />
      )}
      <ConfirmDialogHost />
    </ReaderPlacementProvider>
  );
}
