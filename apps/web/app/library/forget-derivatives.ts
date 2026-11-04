"use client";

import { removeDocumentCatalogRecords } from "../ai/document-catalog-store";
import { removeFetchedCovers } from "./fetched-cover-store";
import { clearDocumentsTranslations } from "./translation-store";

/**
 * Lo que Pliegue saca de un libro y guarda aparte (03.3): la ficha del catálogo, las páginas
 * traducidas y la portada traída de Open Library. El índice de texto va con el propio documento
 * y se borra con él. Antes, al desvincular una carpeta, unos archivos o Drive, solo se iban el
 * índice y la ficha: las traducciones y las portadas se quedaban huérfanas, sin libro que las
 * leyera, y el aviso no decía qué se había borrado.
 *
 * Lo que es de la persona —notas, favoritos, avance— no es derivado y no se toca aquí. Si el
 * libro tiene otra copia, `releaseCopies` ya le pasó su estado antes de llegar aquí.
 */
export interface ForgottenDerivatives {
  catalogs: number;
  covers: number;
  /** Documentos desvinculados: cada uno se lleva su índice de texto. */
  documents: number;
  translations: number;
}

export async function forgetDocumentDerivatives(documentIds: readonly string[]): Promise<ForgottenDerivatives> {
  const ids = [...new Set(documentIds)];
  const [catalogs, translations, covers] = await Promise.all([
    removeDocumentCatalogRecords(ids).catch(() => 0),
    clearDocumentsTranslations(ids).catch(() => 0),
    removeFetchedCovers(ids).catch(() => 0),
  ]);
  return { catalogs, covers, documents: ids.length, translations };
}

const count = (value: number, one: string, many: string) => `${value.toLocaleString("es")} ${value === 1 ? one : many}`;

/** «Se borraron el índice de 12 documentos, 8 fichas, 340 páginas traducidas y 3 portadas». */
export function describeForgotten({ catalogs, covers, documents, translations }: ForgottenDerivatives) {
  const parts = [
    `el índice de ${count(documents, "documento", "documentos")}`,
    catalogs ? count(catalogs, "ficha del catálogo", "fichas del catálogo") : "",
    translations ? count(translations, "página traducida", "páginas traducidas") : "",
    covers ? count(covers, "portada de Open Library", "portadas de Open Library") : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
  return `${parts.length > 1 ? "Se borraron" : "Se borró"} ${list}.`;
}
