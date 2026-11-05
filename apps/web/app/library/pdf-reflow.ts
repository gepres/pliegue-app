/**
 * Recompone el texto de una página de PDF para poder leerlo a cualquier anchura.
 *
 * Un PDF no guarda párrafos: guarda fragmentos de texto con su posición sobre la página.
 * Mostrarlo tal cual obliga a leer a la anchura con que se maquetó, que en una pantalla
 * estrecha significa ampliar y desplazarse en dos direcciones. Aquí se reconstruye la
 * estructura a partir de la geometría —qué fragmentos comparten renglón, qué renglones
 * forman un bloque, cuál de ellos es un título— y el resultado se entrega en el mismo
 * modelo de bloques que ya usan DOCX y EPUB, de modo que lo pinta el frame editorial del
 * producto y no una vista aparte.
 *
 * Es geometría, no comprensión: ningún modelo interviene y nada sale del dispositivo.
 * Sostiene bien un documento de texto corrido y falla en maquetaciones decorativas, así que
 * el modo original tiene que seguir estando y ser el que mande cuando esto no convenza.
 *
 * Ojo con el eje vertical: en el sistema de coordenadas del PDF la `y` crece hacia arriba,
 * al revés que en la pantalla.
 */

import { isLatinPage, looksLikeOcrNoise } from "./ocr-noise";
import type { StructuredDocumentBlock } from "./structured-document-extractor";

/** Fragmento de texto tal como lo entrega pdf.js, ya normalizado. */
export interface ReflowTextItem {
  /** Alto nominal de la fuente, en unidades del PDF. */
  fontHeight: number;
  fontName: string;
  text: string;
  /** Ancho del fragmento sobre la página. */
  width: number;
  /** Borde izquierdo. */
  x: number;
  /** Línea base. Crece hacia arriba. */
  y: number;
}

export interface ReflowLine {
  fontHeight: number;
  fontNames: string[];
  left: number;
  right: number;
  text: string;
  y: number;
}

export interface ReflowBlock {
  fontHeight: number;
  kind: "heading" | "paragraph";
  /** Cuánto sobresale del tamaño del cuerpo; ordena los niveles de título. */
  lines: ReflowLine[];
  text: string;
}

/** Dos fragmentos comparten renglón si sus líneas base distan menos de esta parte del alto. */
const lineTolerance = 0.5;

/** Separación vertical máxima, en alturas de línea, para seguir en el mismo bloque. */
const blockGapRatio = 1.2;

/** Un título supera al cuerpo en al menos este número de puntos. */
const headingMargin = 1;

function roundSize(value: number) {
  return Math.round(value * 2) / 2;
}

function looksBold(fontName: string) {
  return /bold|black|heavy|semib|demi/i.test(fontName);
}

function looksMonospaced(fontName: string) {
  return /mono|courier|consol/i.test(fontName);
}

/**
 * Tamaño del texto corrido: la moda de los altos de fuente, pesada por cuántos caracteres
 * se escriben con cada uno. Pesar por caracteres y no por fragmentos evita que veinte
 * números de página sueltos definan lo que es «normal» en el documento.
 */
export function bodyFontSize(items: readonly ReflowTextItem[]) {
  const weights = new Map<number, number>();

  for (const item of items) {
    const characters = item.text.trim().length;
    if (characters === 0 || item.fontHeight <= 0) continue;
    const size = roundSize(item.fontHeight);
    weights.set(size, (weights.get(size) ?? 0) + characters);
  }

  let best = 0;
  let bestWeight = -1;

  for (const [size, weight] of weights) {
    // Ante el mismo peso gana el tamaño menor: el cuerpo es lo más pequeño de lo frecuente.
    if (weight > bestWeight || (weight === bestWeight && size < best)) {
      best = size;
      bestWeight = weight;
    }
  }

  return best;
}

/**
 * A partir de qué hueco entre dos fragmentos hay que escribir un espacio.
 *
 * Un PDF no guarda palabras: guarda fragmentos con su posición, y decidir dónde acaba una
 * palabra es mirar cuánto se separan. Con un hueco fijo bastaría si todos los textos se
 * compusieran igual, pero una portada suele llevar las letras separadas a propósito —cada
 * letra es entonces un fragmento— y el mismo umbral que junta bien un párrafo convierte el
 * título en «U N A P E Q U E Ñ A H I S T O R I A».
 *
 * Cuando la línea viene así, el hueco entre letras es regular y el de palabra destaca sobre
 * él: la referencia deja de ser el tamaño de la letra y pasa a ser la mediana de los huecos
 * de esa misma línea.
 */
function spaceThreshold(ordered: readonly ReflowTextItem[]) {
  const fontHeight = Math.max(...ordered.map((item) => item.fontHeight), 1);
  // Los fragmentos de espacio ya dicen dónde separar, así que no cuentan para decidir si
  // el renglón está deletreado: incluirlos haría pasar por deletreado cualquier texto
  // normal, donde la mitad de los fragmentos son precisamente esos espacios.
  const written = ordered.filter((item) => item.text.trim().length > 0);

  // La referencia corriente es una fracción del cuerpo, pero el alto que da la matriz no
  // siempre es el de la letra: en un escaneo con capa de texto (OCR) cada renglón trae el
  // alto de su caja, inflado y distinto en cada uno, y con él un espacio de 3 pt quedaba
  // por debajo del umbral («ofatmosphereon», 05.13). El ancho medio de un carácter del
  // propio renglón no se infla: un espacio de palabra pasa de un tercio de él, y las
  // letras de una misma palabra partida en fragmentos quedan pegadas o casi.
  const characters = written.reduce((sum, item) => sum + [...item.text.trim()].length, 0);
  const characterWidth = characters ? written.reduce((sum, item) => sum + item.width, 0) / characters : 0;
  const plain = characterWidth > 0 ? Math.min(fontHeight * 0.25, characterWidth * 0.35) : fontHeight * 0.25;
  if (written.length < 6) return plain;

  const short = written.filter((item) => item.text.trim().length <= 2).length;
  if (short < written.length * 0.6) return plain;

  const gaps: number[] = [];
  for (let index = 1; index < written.length; index += 1) {
    const previous = written[index - 1]!;
    const gap = written[index]!.x - (previous.x + previous.width);
    if (gap > 0) gaps.push(gap);
  }

  if (gaps.length === 0) return plain;
  gaps.sort((left, right) => left - right);
  const median = gaps[Math.floor(gaps.length / 2)]!;

  // Con el espaciado de diseño, un espacio de palabra lo arrastra también: sale mayor que
  // el hueco corriente, y ahí es donde se corta.
  return Math.max(median * 1.5, fontHeight * 0.08);
}

/** Marca dónde había un espacio de palabra, para no confundirlo con la separación entre letras. */
const wordBreak = "\u001F";

/** Signos que van pegados a la palabra de delante (cierre) o a la de detrás (apertura). */
const closingPunctuation = /^[.,;:!?)\]}»”’…%]/u;
const openingPunctuation = /[(\[{«“‘¿¡]$/u;

/**
 * Recompone las palabras de un texto compuesto con las letras separadas.
 *
 * Hay portadas y titulares que se maquetan escribiendo «U N A  P E Q U E Ñ A»: la
 * separación es tipográfica, no ortográfica, y el archivo la guarda como espacios de
 * verdad. Extraído tal cual, el título del libro llega deletreado.
 *
 * Distinguir un caso del otro no se puede hacer con el texto ya montado —los dos espacios
 * son el mismo carácter—, así que el de palabra viaja marcado desde que se leyó el
 * fragmento: si el renglón resulta estar deletreado, los simples se quitan y la marca se
 * convierte en el único espacio que queda.
 */
export function compactSpacedLetters(text: string) {
  const restore = () => text.replaceAll(wordBreak, " ").replace(/\s+/g, " ").trim();
  const tokens = text.split(new RegExp(`[ ${wordBreak}]`)).filter(Boolean);
  if (tokens.length < 5) return restore();

  const singles = tokens.filter((token) => [...token].length === 1).length;
  if (singles < tokens.length * 0.7) return restore();

  return text
    .split(wordBreak)
    .map((word) => word.replaceAll(" ", ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Reúne en un renglón los fragmentos que comparten línea base y los ordena de izquierda a derecha. */
export function groupIntoLines(items: readonly ReflowTextItem[]): ReflowLine[] {
  // Un fragmento que solo contiene un espacio no es basura que descartar: es el documento
  // diciendo dónde termina una palabra, y es más fiable que deducirlo del hueco. Se van
  // únicamente los que no traen ningún carácter.
  const usable = items.filter((item) => item.text.length > 0);
  if (usable.every((item) => item.text.trim().length === 0)) return [];

  // De arriba abajo: en el PDF eso es `y` descendente.
  const sorted = [...usable].sort((left, right) => right.y - left.y || left.x - right.x);
  const groups: ReflowTextItem[][] = [];

  for (const item of sorted) {
    const current = groups.at(-1);
    const reference = current?.[0];
    const tolerance = Math.max(reference?.fontHeight ?? item.fontHeight, 1) * lineTolerance;

    if (current && reference && Math.abs(reference.y - item.y) <= tolerance) {
      current.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group) => {
    const ordered = [...group].sort((left, right) => left.x - right.x);
    const threshold = spaceThreshold(ordered);
    let text = "";
    let previousRight: number | null = null;

    for (const item of ordered) {
      const fragment = item.text;
      // Un fragmento que solo contiene espacios separa palabras: viaja marcado para que
      // luego se pueda distinguir de la separación entre letras.
      const isWordGap = /^\s+$/.test(fragment);

      if (previousRight !== null) {
        const gap = item.x - previousRight;
        // Ante un signo de cierre o tras uno de apertura no va espacio aunque haya hueco: un
        // escaneo con OCR coloca cada signo suelto, y con el umbral fino salía «animated .».
        const hugsPunctuation = closingPunctuation.test(fragment) || openingPunctuation.test(text);
        const needsSpace =
          gap > threshold && !hugsPunctuation && !/[\s\u001F]$/.test(text) && !/^\s/.test(fragment);
        if (needsSpace) text += isWordGap ? "" : wordBreak;
      }

      text += isWordGap ? wordBreak : fragment;
      previousRight = item.x + item.width;
    }

    return {
      fontHeight: Math.max(...ordered.map((item) => item.fontHeight)),
      fontNames: [...new Set(ordered.map((item) => item.fontName))],
      left: ordered[0]!.x,
      right: previousRight ?? ordered[0]!.x,
      text: compactSpacedLetters(text),
      y: ordered[0]!.y,
    };
  });
}

/**
 * Une los renglones de un mismo párrafo en un texto seguido.
 *
 * Es el paso que más se nota al leer: sin él cada renglón de la maquetación original queda
 * como una frase suelta. Un guion al final de renglón seguido de minúscula es una palabra
 * partida por el maquetador, no un guion del texto, y desaparece al unir.
 */
export function joinLineText(lines: readonly ReflowLine[]) {
  let text = "";

  for (const line of lines) {
    if (text === "") {
      text = line.text;
      continue;
    }

    if (/[-­]$/.test(text) && /^[\p{Ll}]/u.test(line.text)) {
      text = `${text.slice(0, -1)}${line.text}`;
    } else {
      text += ` ${line.text}`;
    }
  }

  return text.replace(/\s+/g, " ").trim();
}

/** El interlineado de un bloque, la mediana de sus saltos; `null` si aún tiene un renglón. */
function blockLeading(lines: readonly ReflowLine[]) {
  if (lines.length < 2) return null;
  const gaps = lines
    .slice(1)
    .map((line, index) => lines[index]!.y - line.y)
    .sort((left, right) => left - right);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/** Agrupa renglones contiguos de tamaño parecido y sin un salto vertical entre medias. */
export function groupIntoBlocks(lines: readonly ReflowLine[]): ReflowLine[][] {
  const blocks: ReflowLine[][] = [];

  for (const line of lines) {
    const current = blocks.at(-1);
    const previous = current?.at(-1);

    if (current && previous) {
      const gap = previous.y - line.y;
      const reference = Math.max(previous.fontHeight, line.fontHeight, 1);
      const sameSize = Math.abs(previous.fontHeight - line.fontHeight) <= 0.6;
      const closeEnough = gap >= 0 && gap <= reference * (1 + blockGapRatio);
      // En un escaneo con OCR cada renglón trae su propio alto (14, 13, 12…) aunque sea el
      // mismo párrafo, y con el tamaño exacto salía un bloque por renglón (05.13). Si el alto
      // se parece, el renglón de arriba llega al margen derecho del bloque (párrafo lleno o
      // justificado) y el salto es el del interlineado, sigue el mismo párrafo. Un título
      // no cumple las tres: es corto, o lleva más aire encima y debajo, o es mucho mayor.
      const similarSize = Math.abs(previous.fontHeight - line.fontHeight) <= reference * 0.25;
      const margin = Math.max(line.right, ...current.map((candidate) => candidate.right));
      const previousReachesMargin = previous.right >= margin - reference * 1.5;
      const leading = blockLeading(current);
      const regularGap = leading === null ? gap <= reference * 1.5 : gap <= leading * 1.4;
      // Tras un renglón corto, uno que entra con sangría abre párrafo aunque el tamaño sea el
      // mismo: es la marca más clara de párrafo nuevo en un libro, y sin ella dos párrafos
      // seguidos y sin blanco entre medias se leían como uno.
      const opensParagraph = !previousReachesMargin && line.left - previous.left >= reference * 0.8;
      const sameParagraph = sameSize || (similarSize && previousReachesMargin && regularGap);

      if (sameParagraph && closeEnough && !opensParagraph) {
        current.push(line);
        continue;
      }
    }

    blocks.push([line]);
  }

  return blocks;
}

/**
 * El cuerpo que domina en un bloque, pesado por caracteres. Con el más alto, un párrafo de
 * escaneo con un renglón de caja algo mayor pasaba por título (05.13).
 */
function dominantSize(lines: readonly ReflowLine[]) {
  const buckets = new Map<number, { height: number; weight: number }>();
  for (const line of lines) {
    const size = roundSize(line.fontHeight);
    const bucket = buckets.get(size) ?? { height: 0, weight: 0 };
    bucket.weight += Math.max(line.text.length, 1);
    bucket.height = Math.max(bucket.height, line.fontHeight);
    buckets.set(size, bucket);
  }
  let best = { height: 0, weight: -1 };
  for (const bucket of buckets.values()) {
    if (bucket.weight > best.weight || (bucket.weight === best.weight && bucket.height > best.height)) best = bucket;
  }
  // El alto real del grupo ganador, sin redondear: un renglón suelto se mide igual que antes.
  return best.height;
}

function classify(lines: readonly ReflowLine[], body: number): "heading" | "paragraph" {
  const size = dominantSize(lines);
  // Tres renglones o más de un cuerpo apenas mayor son un párrafo, no un título: en un
  // escaneo, el alto de cada caja varía un punto arriba o abajo del cuerpo de la página.
  if (lines.length >= 3 && size < body * 1.25) return "paragraph";
  const bold = lines.every((line) => line.fontNames.some(looksBold));
  const short = lines.length <= 2;

  if (body <= 0) return "paragraph";
  if (size >= body + headingMargin) return "heading";
  // Del mismo tamaño que el cuerpo pero en negrita y en una o dos líneas: un subtítulo.
  if (bold && short && size >= body) return "heading";
  return "paragraph";
}

/**
 * Busca el canal que separa dos columnas de texto.
 *
 * Se decide sobre los fragmentos sueltos y **antes** de formar renglones, que es el orden
 * que importa: en una página a dos columnas el primer renglón de la izquierda y el primero
 * de la derecha comparten línea base, así que agrupar primero los fundiría en uno solo y
 * dejaría el texto intercalado frase a frase.
 *
 * El canal no cae siempre en el centro exacto, así que se prueban cortes por la banda
 * central y gana el que menos fragmentos parta. Se acepta solo si casi ninguno lo cruza
 * —un encabezado a todo lo ancho sí puede— y si a ambos lados hay material suficiente.
 */
export function detectColumnSplit(items: readonly ReflowTextItem[], pageWidth: number) {
  const usable = items.filter((item) => item.text.trim().length > 0);
  if (pageWidth <= 0 || usable.length < 8) return null;

  let bestSplit: number | null = null;
  let fewestCrossings = Number.POSITIVE_INFINITY;

  // Entre el 35 % y el 65 % del ancho: fuera de ahí no es un canal entre columnas sino un
  // margen.
  for (let ratio = 0.35; ratio <= 0.65; ratio += 0.01) {
    const split = pageWidth * ratio;
    let left = 0;
    let right = 0;
    let crossing = 0;

    for (const item of usable) {
      if (item.x + item.width <= split) left += 1;
      else if (item.x >= split) right += 1;
      else crossing += 1;
    }

    if (left < 3 || right < 3) continue;
    if (crossing > usable.length * 0.1) continue;

    if (crossing < fewestCrossings) {
      fewestCrossings = crossing;
      bestSplit = split;
    }
  }

  return bestSplit;
}

export interface ReflowResult {
  blocks: StructuredDocumentBlock[];
  /** La página venía a dos columnas y se leyó una después de la otra. */
  columns: number;
}

/** Caja de un bloque sobre la página, en unidades del PDF y con la `y` hacia arriba. */
export interface LayoutBox {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/** Un bloque recompuesto que además sabe dónde estaba: lo que hace falta para taparlo. */
export interface LayoutBlock {
  box: LayoutBox;
  /** Compuesto al centro, como un título, una dedicatoria o un poema. */
  centered: boolean;
  /** El cuerpo más grande del bloque, en unidades del PDF. */
  fontHeight: number;
  kind: "heading" | "paragraph";
  /** Nivel de título (1 a 6); 0 en un párrafo. */
  level: number;
  lines: number;
  /** El texto de cada renglón, por si hay que traducirlos por separado (un índice, un poema). */
  lineTexts: string[];
  text: string;
}

export interface LayoutResult {
  blocks: LayoutBlock[];
  columns: number;
}

/** Sobre la línea base, las letras suben unos tres cuartos del cuerpo y bajan un cuarto. */
const ascent = 0.8;
const descent = 0.25;

/** Centrado en la página: su eje cae a un 4 % del centro. */
function onPageAxis(left: number, right: number, pageWidth: number) {
  return pageWidth > 0 && Math.abs((left + right) / 2 - pageWidth / 2) <= pageWidth * 0.04;
}

/**
 * Compuesto al centro. En un libro la caja de texto suele estar centrada en la página, así que
 * un párrafo justificado también cae en su eje: lo que lo distingue es que sus renglones
 * arrancan todos en el mismo margen. Uno al centro tiene los bordes a distintas alturas y los
 * centros alineados. Un título, o un renglón suelto, basta con que caiga en el eje sin ocupar
 * todo el ancho.
 */
function isCentered(lines: readonly ReflowLine[], heading: boolean, pageWidth: number) {
  if (lines.length === 0) return false;
  const left = Math.min(...lines.map((line) => line.left));
  const right = Math.max(...lines.map((line) => line.right));
  if (!onPageAxis(left, right, pageWidth)) return false;
  if (heading || lines.length === 1) return right - left < pageWidth * 0.8;
  const size = Math.max(...lines.map((line) => line.fontHeight));
  const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
  return (
    spread(lines.map((line) => line.left)) > size &&
    spread(lines.map((line) => (line.left + line.right) / 2)) <= size * 0.75
  );
}

function boxOf(lines: readonly ReflowLine[]): LayoutBox {
  return {
    bottom: Math.min(...lines.map((line) => line.y - line.fontHeight * descent)),
    left: Math.min(...lines.map((line) => line.left)),
    right: Math.max(...lines.map((line) => line.right)),
    top: Math.max(...lines.map((line) => line.y + line.fontHeight * ascent)),
  };
}

/**
 * Recompone una página entera. `pageWidth` viene del viewport de pdf.js a escala 1, en las
 * mismas unidades que las posiciones de los fragmentos.
 */
export function reflowPage(
  items: readonly ReflowTextItem[],
  pageWidth: number,
): ReflowResult {
  const { blocks, columns } = layoutPage(items, pageWidth);
  return {
    blocks: blocks.map<StructuredDocumentBlock>((block) =>
      block.kind === "heading" ? { kind: "heading", level: block.level, text: block.text } : { kind: "paragraph", text: block.text },
    ),
    columns,
  };
}

/**
 * Los mismos bloques que `reflowPage`, en el mismo orden, con su caja y su cuerpo: la
 * traducción los pinta encima de la página sin tocar imágenes ni gráficos.
 */
export function layoutPage(
  items: readonly ReflowTextItem[],
  pageWidth: number,
): LayoutResult {
  const split = detectColumnSplit(items, pageWidth);

  // Cada columna se agrupa en renglones por separado y se lee entera antes de pasar a la
  // siguiente. Lo que cruza el canal —un titular, un pie— se lee primero, como en la página.
  const lines = split
    ? [
        ...groupIntoLines(items.filter((item) => item.x < split && item.x + item.width > split)),
        ...groupIntoLines(items.filter((item) => item.x + item.width <= split)),
        ...groupIntoLines(items.filter((item) => item.x >= split)),
      ]
    : groupIntoLines(items);

  if (lines.length === 0) return { blocks: [], columns: 1 };

  const body = bodyFontSize(items);
  const grouped = groupIntoBlocks(lines);
  const headingSizes = new Set<number>();

  for (const group of grouped) {
    if (classify(group, body) === "heading") {
      headingSizes.add(roundSize(Math.max(...group.map((line) => line.fontHeight))));
    }
  }

  // El título más grande de la página es el de nivel 1, el siguiente el 2, y así.
  const levels = [...headingSizes].sort((left, right) => right - left);

  const blocks = grouped.flatMap<LayoutBlock>((group) => {
    const text = joinLineText(group);
    if (!text) return [];
    const fontHeight = Math.max(...group.map((line) => line.fontHeight));
    const heading = classify(group, body) === "heading";

    return [
      {
        box: boxOf(group),
        centered: isCentered(group, heading, pageWidth),
        fontHeight,
        kind: heading ? "heading" : "paragraph",
        level: heading ? Math.min(6, levels.indexOf(roundSize(fontHeight)) + 1) : 0,
        lineTexts: group.map((line) => line.text),
        lines: group.length,
        text,
      },
    ];
  });

  // Los restos de OCR de una ilustración ni se leen ni se traducen (05.14): con ellos fuera,
  // la vista traducida no pinta nada encima del dibujo.
  const latinPage = isLatinPage(blocks.map((block) => block.text));
  const legible = blocks.filter((block) => !looksLikeOcrNoise(block.text, latinPage));

  return { blocks: mergeStackedTitles(legible, pageWidth), columns: split ? 2 : 1 };
}

/**
 * Un título de portada suele componerse en renglones de tamaños distintos —«THE» / «LOST
 * CONTINENT» / «OF MU»— y cada tamaño salía como un bloque aparte. Leídos o traducidos por
 * separado pierden el sentido («Los / los Continente / de miu»). Si están centrados en la
 * página y uno justo debajo del otro, son el mismo título.
 */
function mergeStackedTitles(blocks: readonly LayoutBlock[], pageWidth: number) {
  const centered = (box: LayoutBox) => onPageAxis(box.left, box.right, pageWidth);
  const merged: LayoutBlock[] = [];

  for (const block of blocks) {
    const previous = merged.at(-1);
    if (previous?.kind === "heading" && block.kind === "heading" && centered(previous.box) && centered(block.box)) {
      // Con la `y` hacia arriba, el de encima termina por encima de donde empieza el siguiente.
      const gap = previous.box.bottom - block.box.top;
      const reference = Math.max(previous.fontHeight, block.fontHeight);
      if (gap >= -reference * 0.2 && gap <= reference * 1.6) {
        merged[merged.length - 1] = {
          box: {
            bottom: Math.min(previous.box.bottom, block.box.bottom),
            left: Math.min(previous.box.left, block.box.left),
            right: Math.max(previous.box.right, block.box.right),
            top: Math.max(previous.box.top, block.box.top),
          },
          centered: true,
          fontHeight: reference,
          kind: "heading",
          level: Math.min(previous.level, block.level),
          lineTexts: [...previous.lineTexts, ...block.lineTexts],
          lines: previous.lines + block.lines,
          text: `${previous.text} ${block.text}`,
        };
        continue;
      }
    }
    merged.push(block);
  }

  return merged;
}

/** Convierte los fragmentos crudos de pdf.js a la forma que espera `reflowPage`. */
export function toReflowItems(
  items: readonly {
    fontName?: string;
    str?: string;
    transform?: number[];
    width?: number;
  }[],
): ReflowTextItem[] {
  const result: ReflowTextItem[] = [];

  for (const item of items) {
    const transform = item.transform;
    if (!transform || transform.length < 6 || typeof item.str !== "string") continue;

    const [, skewY = 0, , scaleY = 0, x = 0, y = 0] = transform;
    // El alto real sale de la matriz, no del tamaño declarado: un texto escalado o
    // ligeramente inclinado tiene un cuerpo distinto del que dice su fuente.
    const fontHeight = Math.hypot(skewY, scaleY);

    result.push({
      fontHeight: fontHeight > 0 ? fontHeight : 1,
      fontName: item.fontName ?? "",
      text: item.str,
      width: item.width ?? 0,
      x,
      y,
    });
  }

  return result;
}

export { looksMonospaced };
