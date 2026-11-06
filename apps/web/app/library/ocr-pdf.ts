"use client";

import { ocrLanguages, recognizePage, type OcrProgress } from "./ocr";
import { ocrPageLayout, type OcrPageLayout } from "./ocr-layout";
import { readOcrPage, saveOcrPage } from "./ocr-page-store";
import { readPageImages } from "./pdf-figures";
import { loadPdfjs, openPdfDocument } from "./pdf-runtime";

/**
 * Leer con OCR las páginas escaneadas de un PDF (03.5b). Lo comparten el lector —Lectura y
 * traducción— y el catálogo (03.4), que lee así el principio de un escaneo para hacer su ficha.
 */

export type PdfDocument = Awaited<ReturnType<typeof openPdfDocument>>["document"];

/** De qué libro es el PDF y en qué idioma está: lo que hace falta para leer sus escaneos (03.5b). */
export interface PdfOcrSource {
  documentId: string;
  language: string | null;
}

/** Las lecturas en curso, para que la Lectura y la traducción no lean dos veces la misma página. */
const ocrInFlight = new Map<string, Promise<OcrPageLayout | null>>();

/**
 * Lee con OCR una página escaneada —sin capa de texto y con una imagen que la cubre— y la
 * devuelve en bloques con su caja (03.5b). Lo leído se guarda en el navegador: la segunda vez
 * sale de ahí. `null` si la página no es un escaneo. Por decisión del dueño (5-nov), solo se
 * llama al leer en Lectura, al traducir y, para su ficha, al catalogar (6-nov).
 */
export function readScannedPage(
  pdf: PdfDocument,
  pageNumber: number,
  source: PdfOcrSource,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrPageLayout | null> {
  const languages = ocrLanguages(source.language);
  const key = `${source.documentId}:${pageNumber}:${languages}`;
  const running = ocrInFlight.get(key);
  if (running) return running;

  const reading = (async () => {
    const saved = await readOcrPage(source.documentId, pageNumber, languages).catch(() => null);
    if (saved) return saved;
    const page = await pdf.getPage(pageNumber);
    const canvas = window.document.createElement("canvas");
    try {
      const content = await page.getTextContent();
      if ((content.items as { str?: string }[]).some((item) => item.str?.trim())) return null;
      const { OPS } = await loadPdfjs();
      if (!(await readPageImages(page, OPS)).scan) return null;
      // Unos 2400 px de ancho: la letra de un libro queda con el tamaño con que Tesseract lee
      // mejor, sin dibujar de más un escaneo que no tiene más detalle.
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, Math.max(1.5, 2400 / Math.max(1, base.width))) });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const layout = ocrPageLayout(await recognizePage(canvas, source.language, onProgress), canvas.width, canvas.height);
      await saveOcrPage(source.documentId, pageNumber, languages, layout).catch(() => undefined);
      return layout;
    } finally {
      // Suelta la memoria del lienzo enseguida: son unos 20 MB por página.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  })();
  ocrInFlight.set(key, reading);
  void reading.finally(() => ocrInFlight.delete(key)).catch(() => undefined);
  return reading;
}

export interface ScannedExcerptOptions {
  /** Páginas que se miran como mucho: la portada y alguna en blanco no cuentan para nada. */
  maxPages?: number;
  /** Con este texto ya hay para una ficha. */
  minCharacters?: number;
  onPage?: (page: number) => void;
  signal?: AbortSignal;
}

/**
 * El principio de un PDF escaneado, leído con OCR (03.4): lo que necesita el catálogo para
 * hacer la ficha de un libro sin capa de texto. Decisión del dueño (6-nov): solo las primeras
 * páginas, unos segundos por libro; las que ya se leyeron salen de lo guardado. Devuelve el
 * texto de las páginas leídas, o «» si no hay nada legible (o no es un escaneo).
 */
export async function readScannedExcerpt(blob: Blob, source: PdfOcrSource, options: ScannedExcerptOptions = {}) {
  const { maxPages = 4, minCharacters = 1500, onPage, signal } = options;
  const { close, document } = await openPdfDocument(new Uint8Array(await blob.arrayBuffer()), "text");
  try {
    const parts: string[] = [];
    let characters = 0;
    for (let page = 1; page <= Math.min(document.numPages, maxPages) && characters < minCharacters; page += 1) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Se detuvo.", "AbortError");
      onPage?.(page);
      const layout = await readScannedPage(document, page, source);
      const text = (layout?.blocks ?? []).map((block) => block.text).join("\n\n").trim();
      if (!text) continue;
      parts.push(text);
      characters += text.length;
    }
    return parts.join("\n\n");
  } finally {
    await close();
  }
}
