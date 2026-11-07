"use client";

import { useSearchParams } from "next/navigation";

import { LocalDocumentReader } from "../local-document-reader";
import { ReaderStart } from "../reader-start";

/**
 * Qué enseña `/app/lector`, leído de la URL en el navegador y no en el servidor (06.5).
 *
 * Así la página es la misma para todos los libros, y el service worker, que la guarda sin la
 * consulta, la puede servir sin conexión para cualquiera. Antes se decidía en el servidor y la
 * copia guardada era la de «¿Qué quieres leer?» o la de otro libro: sin red, el lector no abría.
 */
export function ReaderRoute() {
  const params = useSearchParams();
  const documentId = params.get("document");
  if (!documentId) return <ReaderStart />;
  return (
    <LocalDocumentReader
      documentId={documentId}
      fragmentId={params.get("fragmento") ?? undefined}
      key={documentId}
      resumeRequested={params.get("resume") === "1"}
    />
  );
}
