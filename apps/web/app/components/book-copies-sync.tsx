"use client";

import { useEffect } from "react";

import { useDriveConnection } from "../drive/drive-connection";
import { reconcileBookCopies, registerLibraryDocuments } from "../library/book-copies-store";
import { useLibraryDocuments } from "../library/use-library-documents";

/** Una ráfaga de cambios (vincular una carpeta, indexar) se concilia de una vez. */
const settleMs = 1_500;

/**
 * Sin interfaz: reconoce las copias del mismo libro (en local, en Drive, importadas) y deja su
 * estado en una sola (`book-copies.ts`). Solo actúa con todos los almacenes cargados y sin
 * errores: un almacén que aún carga parecería una copia borrada.
 */
export function BookCopiesSync() {
  const library = useLibraryDocuments();
  const connection = useDriveConnection();
  const ready = !library.loading && !library.storageError && library.catalogs.status === "ready";

  useEffect(() => {
    if (!ready) return;
    registerLibraryDocuments(library.rawDocuments);
    const timer = window.setTimeout(() => void reconcileBookCopies(library.rawDocuments), settleMs);
    return () => window.clearTimeout(timer);
    // Con un token nuevo se completan los SHA-256 de Drive que faltaban.
  }, [connection.tokenReady, library.rawDocuments, ready]);

  return null;
}
