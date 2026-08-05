import type { DocumentFormat, DocumentIndexStatus } from "./documents";
import { createLocalDocumentPreview } from "./local-document-preview";

export const maxIndexedTextCharacters = 32_000;

/**
 * Versión del pipeline de extracción. Se guarda junto al índice para que un documento
 * indexado con una versión anterior vuelva a analizarse aunque el archivo no haya cambiado.
 * Sin esto, ampliar el extractor no alcanza nunca a lo ya vinculado.
 *
 * 1 · TXT, Markdown, EPUB y Office.
 * 2 · añade la extracción de texto de PDF.
 */
export const contentIndexVersion = 2;

export interface LocalContentIndex {
  indexedAt: string;
  indexStatus: DocumentIndexStatus;
  indexVersion: number;
  searchText: string;
}

/** Un índice sirve solo si lo produjo el extractor vigente. */
export function isCurrentContentIndex(indexVersion: number | undefined) {
  return indexVersion === contentIndexVersion;
}

function normalizeIndexText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, maxIndexedTextCharacters);
}

function index(
  indexedAt: string,
  indexStatus: DocumentIndexStatus,
  searchText: string,
): LocalContentIndex {
  return { indexedAt, indexStatus, indexVersion: contentIndexVersion, searchText };
}

/**
 * El PDF no pasa por la previsualización porque el lector conserva el visor nativo con el
 * archivo original. Un PDF sin capa de texto —escaneado— queda `metadata-only` a la espera
 * del OCR de 03.5, no como error.
 */
async function indexPdf(file: Blob, indexedAt: string): Promise<LocalContentIndex> {
  const { extractPdfText, joinPdfPages } = await import("./pdf-text-extractor");
  // Se pide el doble del texto que se guarda: normalizar colapsa espacios y saltos, así que
  // recortar antes de normalizar dejaría el índice corto. Extraer el millón de caracteres del
  // lector sería tirar el 97 % en un documento largo.
  const extraction = await extractPdfText(file, {
    maxCharacters: maxIndexedTextCharacters * 2,
  });
  const searchText = normalizeIndexText(joinPdfPages(extraction.pages));

  return index(indexedAt, searchText ? "indexed" : "metadata-only", searchText);
}

export async function createLocalContentIndex(
  format: DocumentFormat,
  file: Blob,
  indexedAt = new Date().toISOString(),
): Promise<LocalContentIndex> {
  try {
    if (format === "pdf") return await indexPdf(file, indexedAt);

    const preview = await createLocalDocumentPreview(format, file);

    if (preview.kind === "text") {
      return index(indexedAt, "indexed", normalizeIndexText(preview.content));
    }

    if (preview.kind === "structured") {
      const chunks: string[] = [];

      for (const section of preview.sections) {
        chunks.push(section.label, section.title);
        for (const block of section.blocks) {
          if (block.kind === "table") {
            for (const row of block.rows) chunks.push(row.join(" "));
          } else {
            chunks.push(block.text);
          }
        }
      }

      return index(indexedAt, "indexed", normalizeIndexText(chunks.join(" ")));
    }

    return index(indexedAt, "metadata-only", "");
  } catch {
    return index(indexedAt, "error", "");
  }
}
