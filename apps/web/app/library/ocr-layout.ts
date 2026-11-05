/**
 * Una página escaneada leída con OCR, en bloques con su caja (03.5b). Es lo mismo que sale de
 * la capa de texto de un PDF: con esto, la Lectura la recompone, la traducción la pinta encima
 * de la imagen y la vista en paralelo la enfrenta, sin saber que vino de un escaneo.
 *
 * Tesseract devuelve párrafos con su caja en píxeles de la imagen leída y en orden de lectura.
 * Aquí se pasan a la página (de 0 a 1), se limpian, se descarta lo que es ruido y se decide si
 * la página es prosa o, como una historieta o una lámina, poca letra suelta: decisión del dueño
 * (5-nov), «decide Pliegue», con la imagen para lo segundo.
 */

import { cleanOcrText } from "./ocr-text";
import { isLatinPage, looksLikeOcrNoise } from "./ocr-noise";

export interface OcrBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Un párrafo tal como lo da Tesseract, con lo que aquí se usa. */
export interface OcrParagraph {
  bbox: OcrBox;
  /** De 0 a 100. */
  confidence: number;
  lines: readonly { bbox: OcrBox }[];
  text: string;
}

/** Una zona de la página, de 0 a 1 desde arriba a la izquierda. */
export interface OcrRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface OcrPageBlock {
  box: OcrRect;
  centered: boolean;
  /** De 0 a 100. */
  confidence: number;
  kind: "heading" | "paragraph";
  /** Alto de un renglón, en proporción del alto de la página: el cuerpo de la letra. */
  lineHeight: number;
  lines: number;
  text: string;
}

export interface OcrPageLayout {
  blocks: OcrPageBlock[];
  /** Confianza media, pesada por el texto de cada bloque; 0 si no hay texto. */
  confidence: number;
  /** Prosa que se lee recompuesta; si no, la página se enseña como imagen. */
  prose: boolean;
  words: number;
}

/** Por debajo, Tesseract está adivinando: un dibujo, una mancha o una letra ilegible. */
const minimumConfidence = 45;

const median = (values: readonly number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const wordCount = (text: string) => text.split(/\s+/).filter((token) => /\p{L}{2,}/u.test(token)).length;

/**
 * Prosa: bastantes palabras, casi todas en párrafos de varios renglones y bien leídas. Una
 * historieta tiene bocadillos de uno o dos renglones repartidos por la página, y su letra
 * dibujada se lee con poca confianza; una lámina, un rótulo y poco más.
 */
export function isProsePage(blocks: readonly Pick<OcrPageBlock, "confidence" | "lines" | "text">[]) {
  const words = blocks.reduce((sum, block) => sum + wordCount(block.text), 0);
  if (words < 60) return false;
  const characters = blocks.reduce((sum, block) => sum + block.text.length, 0);
  const inParagraphs = blocks.filter((block) => block.lines >= 3).reduce((sum, block) => sum + block.text.length, 0);
  const confidence = blocks.reduce((sum, block) => sum + block.confidence * block.text.length, 0) / Math.max(1, characters);
  return inParagraphs / Math.max(1, characters) >= 0.6 && confidence >= 60;
}

/** Los párrafos de Tesseract, de una imagen de `width` × `height` píxeles, como bloques de la página. */
export function ocrPageLayout(paragraphs: readonly OcrParagraph[], width: number, height: number): OcrPageLayout {
  const read = paragraphs
    .map((paragraph) => ({ paragraph, text: cleanOcrText(paragraph.text) }))
    .filter(({ paragraph, text }) => text.length > 0 && paragraph.confidence >= minimumConfidence);
  const latin = isLatinPage(read.map(({ text }) => text));
  const kept = read.filter(({ text }) => !looksLikeOcrNoise(text, latin));

  const lineHeights = (paragraph: OcrParagraph) =>
    paragraph.lines.map((line) => Math.max(0, line.bbox.y1 - line.bbox.y0) / Math.max(1, height)).filter((value) => value > 0);
  const lineHeightOf = (paragraph: OcrParagraph) => median(lineHeights(paragraph));
  // El cuerpo es el renglón más común de la página, no el del párrafo típico: con pocos
  // párrafos, un título los arrastraría.
  const bodyLine = median(kept.flatMap(({ paragraph }) => lineHeights(paragraph)));

  const blocks = kept.map<OcrPageBlock>(({ paragraph, text }) => {
    const { x0, x1, y0, y1 } = paragraph.bbox;
    const box = {
      height: Math.max(0, y1 - y0) / Math.max(1, height),
      width: Math.max(0, x1 - x0) / Math.max(1, width),
      x: Math.max(0, x0) / Math.max(1, width),
      y: Math.max(0, y0) / Math.max(1, height),
    };
    const lineHeight = lineHeightOf(paragraph) || box.height;
    const lines = Math.max(1, paragraph.lines.length);
    return {
      box,
      // Centrado en la página y más estrecho que la caja de texto: un título o una dedicatoria.
      centered: box.width < 0.7 && Math.abs(box.x + box.width / 2 - 0.5) < 0.04,
      confidence: Math.round(paragraph.confidence),
      // Un renglón suelto, corto y de letra claramente mayor que la del cuerpo: un título.
      kind: lines <= 2 && text.length <= 90 && bodyLine > 0 && lineHeight >= bodyLine * 1.35 ? "heading" : "paragraph",
      lineHeight,
      lines,
      text,
    };
  });

  const characters = blocks.reduce((sum, block) => sum + block.text.length, 0);
  return {
    blocks,
    confidence: characters ? Math.round(blocks.reduce((sum, block) => sum + block.confidence * block.text.length, 0) / characters) : 0,
    prose: isProsePage(blocks),
    words: blocks.reduce((sum, block) => sum + wordCount(block.text), 0),
  };
}
