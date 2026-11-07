"use client";

import { removeDocumentCatalogRecords } from "../ai/document-catalog-store";
import { removeDuplicateDecisions } from "./duplicate-store";
import { removeFetchedCovers } from "./fetched-cover-store";
import { removeSemanticDocuments } from "./semantic-index-store";
import { removeDocumentsOcr } from "./ocr-page-store";
import { clearDocumentsTranslations, countDocumentsTranslations } from "./translation-store";

/**
 * Lo que Pliegue saca de un libro y guarda aparte (03.3): la ficha del catálogo, las páginas
 * traducidas, la portada traída de Open Library y las páginas escaneadas leídas con OCR (03.5b,
 * que se vuelven a leer si hace falta). El índice de texto va con el propio documento
 * y se borra con él. Antes, al desvincular una carpeta, unos archivos o Drive, solo se iban el
 * índice y la ficha: las portadas se quedaban huérfanas, sin libro que las enseñara, y el aviso
 * no decía qué se había borrado.
 *
 * Las traducciones son otra cosa: costaron tiempo o dinero y la persona puede querer
 * conservarlas. Por decisión del dueño (4-nov), solo se borran si lo elige en el aviso, con un
 * interruptor que empieza apagado. Lo que es de la persona —notas, favoritos, avance— no es
 * derivado y no se toca aquí. Si el libro tiene otra copia, `releaseCopies` ya le pasó su
 * estado antes de llegar aquí.
 */
export interface ForgottenDerivatives {
  catalogs: number;
  covers: number;
  /** Documentos desvinculados: cada uno se lleva su índice de texto. */
  documents: number;
  /** Páginas escaneadas leídas con OCR. */
  ocrPages: number;
  /** Fragmentos del índice de búsqueda (04.4), con sus vectores. */
  searchChunks?: number;
  /** Páginas traducidas borradas; 0 si se eligió conservarlas. */
  translations: number;
  /** Páginas traducidas que se conservan porque no se eligió borrarlas. */
  translationsKept: number;
}

export async function forgetDocumentDerivatives(
  documentIds: readonly string[],
  { translations: removeTranslations = false }: { translations?: boolean } = {},
): Promise<ForgottenDerivatives> {
  const ids = [...new Set(documentIds)];
  const [catalogs, translations, translationsKept, covers, ocrPages, searchChunks] = await Promise.all([
    removeDocumentCatalogRecords(ids).catch(() => 0),
    removeTranslations ? clearDocumentsTranslations(ids).catch(() => 0) : Promise.resolve(0),
    removeTranslations ? Promise.resolve(0) : countDocumentsTranslations(ids).catch(() => 0),
    removeFetchedCovers(ids).catch(() => 0),
    removeDocumentsOcr(ids).catch(() => 0),
    removeSemanticDocuments(ids).catch(() => 0),
    // Lo decidido sobre sus duplicados (03.6): sin el libro, la marca no tiene a quién ocultar.
    removeDuplicateDecisions(ids).catch(() => 0),
  ]);
  return { catalogs, covers, documents: ids.length, ocrPages, searchChunks, translations, translationsKept };
}

const count = (value: number, one: string, many: string) => `${value.toLocaleString("es")} ${value === 1 ? one : many}`;

/**
 * El interruptor del aviso para borrar también las traducciones, si estos libros tienen alguna.
 * Sin traducciones no hay nada que elegir y el aviso no lo enseña.
 */
export async function translationsChoice(documentIds: readonly string[]) {
  const pages = await countDocumentsTranslations(documentIds).catch(() => 0);
  if (!pages) return null;
  return {
    description: `${count(pages, "página traducida", "páginas traducidas")}. Si lo dejas apagado, se quedan guardadas en este navegador.`,
    label: "Borrar también sus traducciones",
  };
}

/**
 * «Se borraron el índice de 12 documentos, 8 fichas, 340 páginas traducidas y 3 portadas», y,
 * si se conservaron, «Se conservan 340 páginas traducidas».
 */
export function describeForgotten({ catalogs, covers, documents, ocrPages, searchChunks = 0, translations, translationsKept }: ForgottenDerivatives) {
  const parts = [
    `el índice de ${count(documents, "documento", "documentos")}`,
    catalogs ? count(catalogs, "ficha del catálogo", "fichas del catálogo") : "",
    translations ? count(translations, "página traducida", "páginas traducidas") : "",
    ocrPages ? count(ocrPages, "página leída con OCR", "páginas leídas con OCR") : "",
    searchChunks ? count(searchChunks, "fragmento del índice de búsqueda", "fragmentos del índice de búsqueda") : "",
    covers ? count(covers, "portada de Open Library", "portadas de Open Library") : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
  const removed = `${parts.length > 1 ? "Se borraron" : "Se borró"} ${list}.`;
  if (!translationsKept) return removed;
  return `${removed} ${translationsKept === 1 ? "Se conserva" : "Se conservan"} ${count(translationsKept, "página traducida", "páginas traducidas")}.`;
}
