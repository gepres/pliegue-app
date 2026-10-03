"use client";

import { useSyncExternalStore } from "react";

import type { DocumentSortOrder } from "../../library/documents";

/** Lo que comparten la biblioteca personal y la general al filtrar, ordenar y mostrar. */
export const sortLabels: Record<DocumentSortOrder, string> = {
  author: "Autor",
  recent: "Orden de llegada",
  series: "Serie y tomo",
  title: "Título",
  year: "Año, más reciente primero",
};

/** Cuántas categorías caben como atajo bajo el buscador antes de pedir el panel de filtros. */
export const categoryChipLimit = 8;

/**
 * En el teléfono el buscador deja unos 170 px para escribir y «Buscar por título, autor o
 * concepto» se cortaba a media palabra: ahí va una ayuda que cabe entera.
 */
const phoneWidthQuery = "(max-width: 640px)";

function subscribeToPhoneWidth(onChange: () => void) {
  const query = window.matchMedia(phoneWidthQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePhoneWidth() {
  return useSyncExternalStore(
    subscribeToPhoneWidth,
    () => window.matchMedia(phoneWidthQuery).matches,
    () => false,
  );
}
