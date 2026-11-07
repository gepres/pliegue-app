import { hashText } from "./translation";

/**
 * Trocear un libro para la búsqueda por significado (04.4): fragmentos de unos 1.200 caracteres
 * que siguen la estructura del libro —un título abre fragmento, un párrafo no se parte salvo que
 * sea enorme— y que saben de dónde salen:
 *
 * - En un PDF, la página, el tramo del texto de esa página (`start`, `end`) y los rectángulos que
 *   ocupa, normalizados de 0 a 1 desde la esquina de arriba a la izquierda. Un fragmento nunca
 *   cruza de página: la página es la unidad de la cita.
 * - En un EPUB o un DOCX, la sección y los bloques (contados como las anclas de lectura, sin las
 *   imágenes). Un fragmento nunca cruza de sección.
 *
 * Cada fragmento lleva la huella de su texto: al volver a indexar un libro que cambió, solo se
 * recalculan los fragmentos nuevos (reindexación incremental).
 */

/** Sube al cambiar cómo se trocea: obliga a rehacer los fragmentos (no los vectores iguales). */
export const chunkerVersion = 1;
export const chunkTargetCharacters = 1200;
export const chunkMaxCharacters = 2000;

export interface ChunkRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export type ChunkLocation =
  | { kind: "page"; page: number; start: number; end: number; rects: ChunkRect[] }
  | { blockEnd: number; blockStart: number; kind: "section"; section: number; sectionId: string; title: string };

export interface TextChunk {
  hash: string;
  index: number;
  location: ChunkLocation;
  text: string;
}

/* ---- Partir lo que no cabe --------------------------------------------------------------------- */

/** Parte un texto largo por frases (y, si una frase no cabe, por palabras) en trozos de hasta `max`. */
export function splitLongText(text: string, max = chunkMaxCharacters, target = chunkTargetCharacters): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["»”’)\]]*|$)\s*/g) ?? [text];
  const pieces: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      // Una «frase» sin puntos de miles de caracteres: por palabras.
      let piece = "";
      for (const word of sentence.split(/(\s+)/)) {
        if (piece.length + word.length > target && piece.trim()) {
          pieces.push(piece.trim());
          piece = "";
        }
        piece += word;
      }
      if (piece.trim()) pieces.push(piece.trim());
      continue;
    }
    if (current.length + sentence.length > target && current.trim()) push();
    current += sentence;
  }
  push();
  return pieces;
}

/* ---- Empaquetar unidades -------------------------------------------------------------------------- */

interface Unit<Meta> {
  /** Un título: cierra el fragmento anterior y va al principio del siguiente. */
  heading?: boolean;
  meta: Meta;
  /**
   * Cuando un párrafo enorme se parte, qué le toca a cada trozo (`from` y `to`, en caracteres
   * dentro de `text`). En PDF, su propio tramo de la página; si no se da, el mismo que el párrafo.
   */
  slice?: (from: number, to: number) => Meta;
  text: string;
}

interface Packed<Meta> {
  metas: Meta[];
  text: string;
}

/** Junta unidades (párrafos, renglones) en fragmentos de ~1.200 caracteres sin pasar de 2.000. */
function pack<Meta>(units: readonly Unit<Meta>[]): Packed<Meta>[] {
  const chunks: Packed<Meta>[] = [];
  let texts: string[] = [];
  let metas: Meta[] = [];
  let length = 0;
  let onlyHeadings = true;
  const flush = () => {
    const text = texts.join("\n").trim();
    if (text) chunks.push({ metas, text });
    texts = [];
    metas = [];
    length = 0;
    onlyHeadings = true;
  };
  for (const unit of units) {
    const text = unit.text.trim();
    if (!text) continue;
    // Un título empieza fragmento, salvo que lo anterior sean solo títulos (capítulo y subtítulo).
    if (unit.heading && !onlyHeadings) flush();
    const pieces = splitLongText(text);
    const leading = unit.text.length - unit.text.trimStart().length;
    let cursor = 0;
    for (const piece of pieces) {
      if (length && length + piece.length + 1 > chunkTargetCharacters && !onlyHeadings) flush();
      let meta = unit.meta;
      if (pieces.length > 1 && unit.slice) {
        const at = text.indexOf(piece, cursor);
        const from = at >= 0 ? at : cursor;
        cursor = from + piece.length;
        meta = unit.slice(leading + from, leading + from + piece.length);
      }
      texts.push(piece);
      metas.push(meta);
      length += piece.length + 1;
      if (!unit.heading) onlyHeadings = false;
    }
  }
  flush();
  return chunks;
}

/* ---- PDF ---------------------------------------------------------------------------------------- */

export interface PdfLayoutItem {
  end: number;
  rect: ChunkRect;
  start: number;
}

export interface PdfLayoutPage {
  /** Lo que ocupa cada trozo de texto en la página, con su tramo dentro de `text`. */
  items: PdfLayoutItem[];
  number: number;
  text: string;
}

const maxRects = 48;
/** Más hueco que esto entre dos trozos a la misma altura (un 3 % del ancho) es otra columna. */
const columnGap = 0.03;

/** Los rectángulos de los trozos que tocan un tramo, juntados por renglón. */
export function rectsForRange(items: readonly PdfLayoutItem[], start: number, end: number): ChunkRect[] {
  const lines: ChunkRect[] = [];
  for (const item of items) {
    if (item.end <= start || item.start >= end) continue;
    const { rect } = item;
    // Mismo renglón: se solapan en vertical más de la mitad del más bajo y están cerca en
    // horizontal. Dos columnas a la misma altura son dos renglones, no uno que cruza el medianil.
    const line = lines.find((other) => {
      const overlap = Math.min(other.y + other.h, rect.y + rect.h) - Math.max(other.y, rect.y);
      const gap = Math.max(rect.x - (other.x + other.w), other.x - (rect.x + rect.w), 0);
      return overlap > Math.min(other.h, rect.h) / 2 && gap < columnGap;
    });
    if (!line) {
      lines.push({ ...rect });
      continue;
    }
    const right = Math.max(line.x + line.w, rect.x + rect.w);
    const bottom = Math.max(line.y + line.h, rect.y + rect.h);
    line.x = Math.min(line.x, rect.x);
    line.y = Math.min(line.y, rect.y);
    line.w = right - line.x;
    line.h = bottom - line.y;
  }
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return lines.slice(0, maxRects).map((rect) => ({ h: round(rect.h), w: round(rect.w), x: round(rect.x), y: round(rect.y) }));
}

/** Trocea un PDF página a página: un fragmento nunca cruza de página. */
export function chunkPdfPages(pages: readonly PdfLayoutPage[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const page of pages) {
    // Unidades: los párrafos (separados por un renglón en blanco) o, si no hay, los renglones.
    const units: Unit<{ end: number; start: number }>[] = [];
    const pattern = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
    for (let match = pattern.exec(page.text); match; match = pattern.exec(page.text)) {
      const start = match.index;
      // Mismo largo que en la página (un salto de renglón pasa a ser un espacio): los tramos cuadran.
      units.push({
        meta: { end: start + match[0].length, start },
        slice: (from, to) => ({ end: start + to, start: start + from }),
        text: match[0].replace(/\n/g, " "),
      });
    }
    for (const packed of pack(units)) {
      const start = Math.min(...packed.metas.map((meta) => meta.start));
      const end = Math.max(...packed.metas.map((meta) => meta.end));
      chunks.push({
        hash: hashText(packed.text),
        index: chunks.length,
        location: { end, kind: "page", page: page.number, rects: rectsForRange(page.items, start, end), start },
        text: packed.text,
      });
    }
  }
  return chunks;
}

/* ---- EPUB y DOCX ---------------------------------------------------------------------------------- */

export type ChunkableBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] }
  | { alt: string; kind: "image" };

export interface ChunkableSection {
  blocks: readonly ChunkableBlock[];
  id: string;
  title: string;
}

/** Trocea un libro por secciones; los bloques se cuentan como las anclas de lectura (sin imágenes). */
export function chunkSections(sections: readonly ChunkableSection[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  sections.forEach((section, sectionIndex) => {
    const units: Unit<number>[] = [];
    let anchor = 0;
    for (const block of section.blocks) {
      if (block.kind === "image") {
        // Sin ancla propia: su descripción va con el bloque que la sigue.
        if (block.alt.trim()) units.push({ meta: anchor, text: `[Imagen: ${block.alt.trim()}]` });
        continue;
      }
      const text =
        block.kind === "table" ? block.rows.map((row) => row.map((cell) => cell.trim()).filter(Boolean).join(" | ")).filter(Boolean).join("\n") : block.text;
      units.push({ heading: block.kind === "heading", meta: anchor, text });
      anchor += 1;
    }
    for (const packed of pack(units)) {
      chunks.push({
        hash: hashText(packed.text),
        index: chunks.length,
        location: {
          blockEnd: Math.max(...packed.metas),
          blockStart: Math.min(...packed.metas),
          kind: "section",
          section: sectionIndex,
          sectionId: section.id,
          title: section.title,
        },
        text: packed.text,
      });
    }
  });
  return chunks;
}

/** Cómo se cita un fragmento: «p. 12» o el título de su sección. */
export function describeLocation(location: ChunkLocation) {
  if (location.kind === "page") return `p. ${location.page}`;
  return location.title.trim() || `Sección ${location.section + 1}`;
}
