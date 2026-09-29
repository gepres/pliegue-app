/**
 * Texto en paralelo: qué frase de la traducción sale de qué frase del original.
 *
 * El motor traduce bloque a bloque —un párrafo, un título, un renglón de índice—, así que el
 * bloque es la pareja segura. Dentro de él se emparejan las frases por su longitud, como en los
 * corpus bilingües (Gale y Church, 1993): una frase larga del original da una frase larga en la
 * traducción. Si el motor juntó dos frases en una, o partió una en dos, la pareja se hace de dos
 * a una. Cuando no hay forma razonable de casarlas, el bloque entero es una sola pareja.
 */

export interface TextSpan {
  end: number;
  start: number;
}

/** Una pareja: el tramo del original y el de la traducción que le corresponde. */
export interface ParallelSegment {
  source: TextSpan;
  target: TextSpan;
}

export type ParallelSide = keyof ParallelSegment;

// ---- Frases -----------------------------------------------------------------------------

const sentenceEnd = /[^.!?…\n]+(?:[.!?…]+["'»”’)\]]*|\n|$)/g;

/** Las frases de un texto, sin los espacios de los bordes. Un salto de renglón también cierra. */
export function sentenceSpans(text: string, language?: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const push = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start] ?? "")) start += 1;
    while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
    if (end > start) spans.push({ end, start });
  };

  if (typeof Intl.Segmenter === "function") {
    for (const part of new Intl.Segmenter(language ?? "und", { granularity: "sentence" }).segment(text)) {
      push(part.index, part.index + part.segment.length);
    }
  } else {
    for (const match of text.matchAll(sentenceEnd)) push(match.index, match.index + match[0].length);
  }

  return spans;
}

// ---- Emparejar por longitud -------------------------------------------------------------

/**
 * Formas de emparejar y lo que cuesta cada una. La de una a una es la esperada; las demás se
 * pagan para que solo ganen cuando las longitudes lo piden (los valores son los logaritmos de
 * las frecuencias que midieron Gale y Church).
 */
const beads = [
  [1, 1, 0],
  [1, 2, 2.3],
  [2, 1, 2.3],
  [2, 2, 4.6],
  [1, 3, 4.6],
  [3, 1, 4.6],
] as const;

/** Por encima de esto no se empareja por frases: un bloque así no es un párrafo de libro. */
const alignmentLimit = 40_000;

function lengthCost(source: number, target: number, ratio: number) {
  const mean = (source + target / ratio) / 2;
  const delta = (target - source * ratio) / Math.sqrt(Math.max(1, mean) * 6.8);
  return (delta * delta) / 2;
}

/**
 * Empareja dos listas de frases por su longitud en caracteres. Devuelve los tramos de cada lado
 * —`[desde, hasta)` en índices de frase— que forman cada pareja, en orden y sin huecos.
 */
export function alignSentences(
  source: readonly number[],
  target: readonly number[],
): { source: [number, number]; target: [number, number] }[] {
  const rows = source.length;
  const columns = target.length;
  if (rows === 0 || columns === 0) return [];
  const whole = [{ source: [0, rows] as [number, number], target: [0, columns] as [number, number] }];
  if (rows * columns > alignmentLimit) return whole;

  const sourceSums = [0];
  for (const length of source) sourceSums.push((sourceSums.at(-1) ?? 0) + length);
  const targetSums = [0];
  for (const length of target) targetSums.push((targetSums.at(-1) ?? 0) + length);
  const ratio = (targetSums[columns] ?? 0) / Math.max(1, sourceSums[rows] ?? 0) || 1;

  const width = columns + 1;
  const cost = new Float64Array((rows + 1) * width).fill(Number.POSITIVE_INFINITY);
  const step = new Int8Array((rows + 1) * width).fill(-1);
  cost[0] = 0;

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const here = cost[row * width + column] ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(here)) continue;
      beads.forEach(([down, across, penalty], bead) => {
        const nextRow = row + down;
        const nextColumn = column + across;
        if (nextRow > rows || nextColumn > columns) return;
        const sourceLength = (sourceSums[nextRow] ?? 0) - (sourceSums[row] ?? 0);
        const targetLength = (targetSums[nextColumn] ?? 0) - (targetSums[column] ?? 0);
        const total = here + penalty + lengthCost(sourceLength, targetLength, ratio);
        const index = nextRow * width + nextColumn;
        if (total < (cost[index] ?? Number.POSITIVE_INFINITY)) {
          cost[index] = total;
          step[index] = bead;
        }
      });
    }
  }

  if (!Number.isFinite(cost[rows * width + columns] ?? Number.POSITIVE_INFINITY)) return whole;

  const pairs: { source: [number, number]; target: [number, number] }[] = [];
  let row = rows;
  let column = columns;
  while (row > 0 || column > 0) {
    const bead = beads[step[row * width + column] ?? -1];
    if (!bead) return whole;
    const [down, across] = bead;
    pairs.push({ source: [row - down, row], target: [column - across, column] });
    row -= down;
    column -= across;
  }
  return pairs.reverse();
}

/**
 * Las parejas de frases de un bloque y su traducción. Vacío si uno de los dos no tiene texto;
 * una sola pareja con el bloque entero si alguno tiene una sola frase.
 */
export function pairSentences(
  source: string,
  target: string,
  languages: { source?: string | undefined; target?: string | undefined } = {},
): ParallelSegment[] {
  const sourceSpans = sentenceSpans(source, languages.source);
  const targetSpans = sentenceSpans(target, languages.target);
  if (sourceSpans.length === 0 || targetSpans.length === 0) return [];

  const cover = (spans: readonly TextSpan[], [from, to]: readonly [number, number]): TextSpan => ({
    end: spans[to - 1]?.end ?? 0,
    start: spans[from]?.start ?? 0,
  });
  const pairs =
    sourceSpans.length === 1 || targetSpans.length === 1
      ? [{ source: [0, sourceSpans.length] as const, target: [0, targetSpans.length] as const }]
      : alignSentences(
          sourceSpans.map((span) => span.end - span.start),
          targetSpans.map((span) => span.end - span.start),
        );

  return pairs.map((pair) => ({ source: cover(sourceSpans, pair.source), target: cover(targetSpans, pair.target) }));
}

/** La pareja que contiene una posición de un lado; entre dos frases, la que acaba de terminar. */
export function segmentAt(segments: readonly ParallelSegment[], side: ParallelSide, offset: number) {
  let previous = -1;
  for (const [index, segment] of segments.entries()) {
    const span = segment[side];
    if (offset >= span.start && offset < span.end) return index;
    if (span.start <= offset) previous = index;
  }
  return previous >= 0 ? previous : segments.length > 0 ? 0 : -1;
}

/** Las parejas que toca un tramo de un lado, como una selección. */
export function segmentsWithin(segments: readonly ParallelSegment[], side: ParallelSide, span: TextSpan) {
  const indices: number[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment[side].start < span.end && segment[side].end > span.start) indices.push(index);
  }
  return indices;
}

// ---- El texto del bloque dentro de la capa de texto del PDF --------------------------------

/**
 * Un texto reducido a sus letras y cifras, en minúscula y sin tildes, con la posición de cada
 * una en el original. Es lo que permite casar el texto de un bloque —con las palabras partidas
 * ya unidas y los renglones hechos párrafo— con la capa de texto de pdf.js, que conserva los
 * guiones de fin de renglón, las ligaduras («ﬁ») y los renglones pegados.
 */
export interface FoldedText {
  /** Dónde termina en el original el carácter del que sale cada letra. */
  ends: number[];
  folded: string;
  /** Dónde empieza. */
  starts: number[];
}

const letterOrDigit = /[\p{L}\p{N}]/u;

export function foldLetters(text: string): FoldedText {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;

  for (const character of text) {
    const next = index + character.length;
    for (const piece of character.normalize("NFKD").toLowerCase()) {
      if (!letterOrDigit.test(piece)) continue;
      folded += piece;
      starts.push(index);
      ends.push(next);
    }
    index = next;
  }

  return { ends, folded, starts };
}

/**
 * Dónde empieza cada bloque dentro de la capa, en letras plegadas; -1 si no está. Se buscan en
 * orden: un bloque se busca primero a partir de donde acabó el anterior, que es lo que desempata
 * un texto repetido en la página, como un número o una palabra suelta.
 */
export function locateBlocks(layer: FoldedText, blocks: readonly FoldedText[]) {
  let cursor = 0;
  return blocks.map((block) => {
    const needle = block.folded;
    if (!needle) return -1;
    let at = layer.folded.indexOf(needle, cursor);
    if (at < 0) at = layer.folded.indexOf(needle);
    if (at >= 0) cursor = at + needle.length;
    return at;
  });
}

/** Primer índice con `values[index] >= value`, o `values.length`. */
function firstAtOrAfter(values: readonly number[], value: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((values[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Un tramo del texto del bloque, llevado a la capa en la que se encontró en `at`. */
export function blockSpanToLayer(block: FoldedText, layer: FoldedText, at: number, span: TextSpan): TextSpan | null {
  const first = firstAtOrAfter(block.starts, span.start);
  const last = firstAtOrAfter(block.starts, span.end) - 1;
  if (at < 0 || first > last || last >= block.folded.length) return null;
  const start = layer.starts[at + first];
  const end = layer.ends[at + last];
  return start === undefined || end === undefined ? null : { end, start };
}

/**
 * Una posición de la capa, llevada al texto del bloque; `null` si cae fuera de él. Sobre un
 * signo cuenta la letra de antes: el punto final es de la frase que cierra.
 */
export function layerOffsetToBlock(block: FoldedText, layer: FoldedText, at: number, offset: number) {
  if (at < 0) return null;
  const index = firstAtOrAfter(layer.starts, offset + 1) - 1 - at;
  if (index < 0 || index >= block.folded.length) return null;
  return block.starts[index] ?? null;
}

/** Lo que un tramo de la capa —una selección— toca del bloque, en el texto del bloque. */
export function layerSpanToBlock(block: FoldedText, layer: FoldedText, at: number, span: TextSpan): TextSpan | null {
  if (at < 0 || block.folded.length === 0) return null;
  const first = Math.max(at, firstAtOrAfter(layer.starts, span.start));
  const last = Math.min(at + block.folded.length, firstAtOrAfter(layer.starts, span.end)) - 1;
  if (first > last) return null;
  const start = block.starts[first - at];
  const end = block.ends[last - at];
  return start === undefined || end === undefined ? null : { end, start };
}
