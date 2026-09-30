import type { CatalogCover } from "./catalog-import";
import { createDocumentCover } from "./document-cover";
import type { DocumentFormat, DocumentIndexStatus } from "./documents";
import { detectTextLanguage } from "./language";
import { createLocalDocumentPreview } from "./local-document-preview";

export const maxIndexedTextCharacters = 32_000;

/**
 * Versión del pipeline de extracción. Se guarda junto al índice para que un documento
 * indexado con una versión anterior vuelva a analizarse aunque el archivo no haya cambiado.
 * Sin esto, ampliar el extractor no alcanza nunca a lo ya vinculado.
 *
 * 1 · TXT, Markdown, EPUB y Office.
 * 2 · añade la extracción de texto de PDF.
 * 3 · añade la portada sacada del archivo y el idioma detectado en el texto.
 */
export const contentIndexVersion = 3;

export interface LocalContentIndex {
  /** Primera página del PDF, portada del EPUB o la imagen misma; `null` si no hay. */
  cover: CatalogCover | null;
  /** Idioma deducido del texto indexado; `null` sin texto suficiente. */
  detectedLanguage: string | null;
  indexedAt: string;
  indexStatus: DocumentIndexStatus;
  indexVersion: number;
  searchText: string;
}

/** Campos del índice que no son texto, para conservarlos al reutilizar un índice vigente. */
export function carriedIndexFields(document: { cover?: CatalogCover | null; detectedLanguage?: string | null }) {
  return { cover: document.cover ?? null, detectedLanguage: document.detectedLanguage ?? null };
}

/** Un índice sirve solo si lo produjo el extractor vigente. */
export function isCurrentContentIndex(indexVersion: number | undefined) {
  return indexVersion === contentIndexVersion;
}

function normalizeIndexText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, maxIndexedTextCharacters);
}

type TextIndex = Pick<LocalContentIndex, "indexStatus" | "searchText">;

function textIndex(indexStatus: DocumentIndexStatus, searchText: string): TextIndex {
  return { indexStatus, searchText };
}

/**
 * El PDF no pasa por la previsualización porque el lector conserva el visor nativo con el
 * archivo original. Un PDF sin capa de texto —escaneado— queda `metadata-only` a la espera
 * del OCR de 03.5, no como error.
 */
async function indexPdfText(file: Blob): Promise<TextIndex> {
  const { extractPdfText, joinPdfPages } = await import("./pdf-text-extractor");
  // Se pide el doble del texto que se guarda: normalizar colapsa espacios y saltos, así que
  // recortar antes de normalizar dejaría el índice corto. Extraer el millón de caracteres del
  // lector sería tirar el 97 % en un documento largo.
  const extraction = await extractPdfText(file, {
    maxCharacters: maxIndexedTextCharacters * 2,
  });
  const searchText = normalizeIndexText(joinPdfPages(extraction.pages));

  return textIndex(searchText ? "indexed" : "metadata-only", searchText);
}

async function indexText(format: DocumentFormat, file: Blob): Promise<TextIndex> {
  try {
    if (format === "pdf") return await indexPdfText(file);

    const preview = await createLocalDocumentPreview(format, file);

    if (preview.kind === "text") {
      return textIndex("indexed", normalizeIndexText(preview.content));
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

      return textIndex("indexed", normalizeIndexText(chunks.join(" ")));
    }

    return textIndex("metadata-only", "");
  } catch {
    return textIndex("error", "");
  }
}

export async function createLocalContentIndex(
  format: DocumentFormat,
  file: Blob,
  indexedAt = new Date().toISOString(),
): Promise<LocalContentIndex> {
  const text = await indexText(format, file);
  // Después del texto y no a la vez: las dos lecturas cargan el archivo entero en memoria.
  // La portada se intenta aunque el texto haya fallado; un PDF de más de 50 MB no tiene
  // índice de texto, pero sí primera página.
  const cover = await createDocumentCover(format, file);

  return {
    ...text,
    cover,
    detectedLanguage: detectTextLanguage(text.searchText),
    indexedAt,
    indexVersion: contentIndexVersion,
  };
}
