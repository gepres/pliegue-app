import { describePdfFailure, openPdfDocument } from "./pdf-runtime";

export const maxPdfInputBytes = 50 * 1024 * 1024;
export const maxPdfPages = 300;
export const maxPdfTextCharacters = 1_000_000;

export interface PdfTextPage {
  number: number;
  text: string;
}

export interface PdfTextExtraction {
  pageCount: number;
  pages: PdfTextPage[];
  truncated: boolean;
}

export interface PdfTextExtractionOptions {
  /** Corta la extracción al alcanzar este número de caracteres. */
  maxCharacters?: number;
  /** Deja de recorrer páginas al llegar a este número. */
  maxPages?: number;
}

interface PdfTextItem {
  hasEOL?: boolean;
  str?: string;
}

export { releasePdfWorker } from "./pdf-runtime";

function normalizePageText(value: string) {
  return value
    .replaceAll(/\r/g, "")
    .replaceAll(/[\t\f\v ]+/g, " ")
    .replaceAll(/ *\n */g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extrae el texto de un PDF dentro del navegador, sin subirlo a ningún servidor.
 * pdf.js se carga bajo demanda igual que fflate en el extractor estructurado, para
 * que ningún otro formato pague su coste.
 */
export async function extractPdfText(
  blob: Blob,
  options: PdfTextExtractionOptions = {},
): Promise<PdfTextExtraction> {
  if (blob.size > maxPdfInputBytes) {
    throw new Error("El archivo supera el límite de 50 MB para extracción local.");
  }

  const characterLimit = Math.max(1, options.maxCharacters ?? maxPdfTextCharacters);
  const pageLimit = Math.max(1, options.maxPages ?? maxPdfPages);
  const buffer = await blob.arrayBuffer();
  // El intento `text` desactiva fuentes, WASM y descargas auxiliares: no hacen falta para
  // leer el texto y evitarlas mantiene la extracción sin una sola petición de red.
  const { close, document } = await openPdfDocument(new Uint8Array(buffer), "text");

  const pages: PdfTextPage[] = [];
  const pageCount = document.numPages;
  const readablePages = Math.min(pageCount, pageLimit);
  let truncated = readablePages < pageCount;
  let characters = 0;

  try {
    for (let number = 1; number <= readablePages; number += 1) {
      const page = await document.getPage(number);

      try {
        const content = await page.getTextContent();
        const text = normalizePageText(
          (content.items as PdfTextItem[])
            .map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : ""}`)
            .join(""),
        );

        if (text) {
          if (characters + text.length > characterLimit) {
            const remaining = characterLimit - characters;
            if (remaining > 0) pages.push({ number, text: text.slice(0, remaining) });
            truncated = true;
            break;
          }

          characters += text.length;
          pages.push({ number, text });
        }
      } finally {
        page.cleanup();
      }
    }
  } catch (error) {
    throw new Error(describePdfFailure(error));
  } finally {
    await close();
  }

  return { pageCount, pages, truncated };
}

export function joinPdfPages(pages: readonly PdfTextPage[]) {
  return pages.map((page) => page.text).join("\n\n");
}
