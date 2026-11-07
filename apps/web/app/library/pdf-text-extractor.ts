import type { ChunkRect, PdfLayoutPage } from "./chunking";
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
  height?: number;
  str?: string;
  transform?: number[];
  width?: number;
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

/* ---- Con posiciones, para trocear y citar (04.4) ------------------------------------------------ */

type Matrix = readonly number[];

const applyMatrix = (m: Matrix, x: number, y: number): [number, number] => [
  (m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
  (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0),
];

/**
 * Arma el texto de una página trozo a trozo, como `normalizePageText`, y apunta qué tramo del
 * texto y qué rectángulo de la página ocupa cada trozo. El rectángulo va de 0 a 1 desde la
 * esquina de arriba a la izquierda, con la página girada como se ve.
 */
export function layoutPageText(
  items: readonly PdfTextItem[],
  viewport: { height: number; transform: Matrix; width: number },
): Omit<PdfLayoutPage, "number"> {
  let text = "";
  const placed: PdfLayoutPage["items"] = [];
  const trimEnd = () => {
    text = text.replace(/ +$/, "");
  };
  for (const item of items) {
    let piece = (item.str ?? "").replaceAll(/\r/g, "").replaceAll(/[\t\f\v ]+/g, " ");
    if (!text || /[ \n]$/.test(text)) piece = piece.replace(/^ /, "");
    if (piece) {
      const start = text.length;
      text += piece;
      const transform = item.transform ?? [];
      const x = transform[4] ?? 0;
      const y = transform[5] ?? 0;
      const height = item.height || Math.hypot(transform[2] ?? 0, transform[3] ?? 0) || 0;
      const [x1, y1] = applyMatrix(viewport.transform, x, y);
      const [x2, y2] = applyMatrix(viewport.transform, x + (item.width ?? 0), y + height);
      const rect: ChunkRect = {
        h: Math.abs(y2 - y1) / viewport.height,
        w: Math.abs(x2 - x1) / viewport.width,
        x: Math.min(x1, x2) / viewport.width,
        y: Math.min(y1, y2) / viewport.height,
      };
      if (Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.w > 0 && rect.h > 0) {
        placed.push({ end: text.replace(/ +$/, "").length, rect, start });
      }
    }
    if (item.hasEOL) {
      trimEnd();
      if (!/\n\n$/.test(text) && text) text += "\n";
    }
  }
  const trimmed = text.trimEnd();
  // Al recortar el final, ningún tramo pasa del texto.
  const leading = trimmed.length - trimmed.trimStart().length;
  const finalText = trimmed.trimStart();
  return {
    items: placed
      .map((item) => ({ ...item, end: Math.min(item.end, trimmed.length) - leading, start: Math.max(0, item.start - leading) }))
      .filter((item) => item.end > item.start),
    text: finalText,
  };
}

/**
 * El texto de cada página con dónde está (04.4). Mismos límites que `extractPdfText`; un PDF
 * escaneado sale sin texto.
 */
export async function extractPdfLayout(
  blob: Blob,
  options: PdfTextExtractionOptions = {},
): Promise<{ pageCount: number; pages: PdfLayoutPage[]; truncated: boolean }> {
  if (blob.size > maxPdfInputBytes) {
    throw new Error("El archivo supera el límite de 50 MB para extracción local.");
  }
  const characterLimit = Math.max(1, options.maxCharacters ?? maxPdfTextCharacters);
  const pageLimit = Math.max(1, options.maxPages ?? maxPdfPages);
  const { close, document } = await openPdfDocument(new Uint8Array(await blob.arrayBuffer()), "text");
  const pages: PdfLayoutPage[] = [];
  const pageCount = document.numPages;
  const readablePages = Math.min(pageCount, pageLimit);
  let truncated = readablePages < pageCount;
  let characters = 0;
  try {
    for (let number = 1; number <= readablePages; number += 1) {
      const page = await document.getPage(number);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const layout = layoutPageText(content.items as PdfTextItem[], viewport);
        if (!layout.text) continue;
        if (characters + layout.text.length > characterLimit) {
          truncated = true;
          break;
        }
        characters += layout.text.length;
        pages.push({ ...layout, number });
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
