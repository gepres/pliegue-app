/**
 * Traducción de libros, página a página, como capa derivada: nunca sustituye el original.
 *
 * Una «unidad» es lo que se traduce de una vez y se guarda junto: una página de un PDF o una
 * sección de un EPUB. Cada bloque traducido lleva la huella de su texto original, así que si
 * la extracción cambia —otra versión del archivo, un recompositor mejor— ese bloque se vuelve
 * a traducir en vez de mostrar la traducción de otro texto.
 */

export interface TranslationPair {
  /** Código de idioma BCP 47 corto: «en», «es»… */
  source: string;
  target: string;
}

/** Un bloque ya traducido y la huella del original del que sale. */
export interface TranslatedBlock {
  hash: string;
  text: string;
}

/** Idiomas a los que se ofrece traducir, por orden de uso probable entre quienes leen en español. */
export const translationTargets = ["es", "en", "pt", "fr", "it", "de"] as const;

/** Páginas que se preparan por delante de la actual mientras se lee. */
export const defaultPagesAhead = 5;

/** Identifica un motor y un par de idiomas: lo traducido con uno no vale para otro. */
export function translationPairId(engine: string, pair: TranslationPair) {
  return `${engine}:${pair.source}>${pair.target}`;
}

/** Huella corta y estable de un texto (FNV-1a de 32 bits), para saber si cambió. */
export function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Renglones que terminan casi todos en número —al menos dos y el 60 %—: las entradas de un
 * índice o de una lista de ilustraciones. Unidos en un párrafo, la traducción los fundía en
 * uno solo; se traducen renglón a renglón.
 */
export function isListLike(lines: readonly string[]) {
  const numbered = lines.filter((line) => /\d\s*$/.test(line)).length;
  return lines.length >= 2 && numbered >= Math.max(2, Math.ceil(lines.length * 0.6));
}

/** Un bloque sin palabras —un número de página, una cifra, una raya— se copia tal cual. */
export function isTranslatable(text: string) {
  return /\p{L}{2,}/u.test(text);
}

/**
 * Parte un texto largo por frases para no pasar del máximo que acepta el motor de una vez.
 * Una frase que por sí sola ya es más larga se corta por el último espacio que quepa.
 */
export function chunkBySentence(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const sentences =
    typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter("und", { granularity: "sentence" }).segment(text)].map((part) => part.segment)
      : text.split(/(?<=[.!?…])\s+/);

  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxLength) push();
    if (sentence.length <= maxLength) {
      current += current && !/\s$/.test(current) ? ` ${sentence}` : sentence;
      continue;
    }
    push();
    let rest = sentence;
    while (rest.length > maxLength) {
      const cut = rest.lastIndexOf(" ", maxLength);
      const at = cut > maxLength * 0.5 ? cut : maxLength;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at);
    }
    current = rest;
  }
  push();
  return chunks;
}

/**
 * Qué unidades traducir y en qué orden: la que se está leyendo primero y después las
 * `ahead` siguientes que falten. Las ya traducidas no vuelven a la cola.
 */
export function planTranslationQueue(current: number, total: number, ahead: number, done: ReadonlySet<number>) {
  const queue: number[] = [];
  const last = Math.min(total, current + ahead);
  for (let unit = Math.max(1, current); unit <= last; unit += 1) {
    if (!done.has(unit)) queue.push(unit);
  }
  return queue;
}

/** Porcentaje traducido; el 100 % solo cuando no falta nada. */
export function translationPercent(done: number, total: number) {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.floor((done / total) * 100));
}

/** Nombre del idioma en español y en minúscula: «inglés», «portugués». */
export function languageName(code: string) {
  try {
    const name = new Intl.DisplayNames(["es"], { type: "language" }).of(code);
    return name ? name.toLocaleLowerCase("es") : code;
  } catch {
    return code;
  }
}

export interface PaperColor {
  b: number;
  g: number;
  r: number;
}

/**
 * Color del papel bajo un bloque de texto: el más repetido entre sus píxeles. En una caja de
 * texto casi todo es fondo —las letras ocupan poco—, así que la moda es el papel, sea blanco,
 * amarillento o la tela azul de una portada. Se agrupa por tonos parecidos (32 niveles por
 * canal) y se devuelve la media de ese grupo; `null` si no hay píxeles.
 */
export function dominantColor(pixels: ArrayLike<number>): PaperColor | null {
  const buckets = new Map<number, { b: number; count: number; g: number; r: number }>();
  let best: { b: number; count: number; g: number; r: number } | null = null;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < 128) continue;
    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key) ?? { b: 0, count: 0, g: 0, r: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best) return null;
  return {
    b: Math.round(best.b / best.count),
    g: Math.round(best.g / best.count),
    r: Math.round(best.r / best.count),
  };
}

/** Sobre un papel oscuro, letra clara; sobre uno claro, oscura (luminancia relativa de WCAG). */
export function inkFor(paper: PaperColor) {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(paper.r) + 0.7152 * channel(paper.g) + 0.0722 * channel(paper.b);
  return luminance < 0.18 ? "#f4efe6" : "#1d1b18";
}

/**
 * Cuerpo de letra para que la traducción quepa en la caja del original. Se estima por
 * superficie —una letra ocupa media «eme» de ancho y el renglón 1,2 de alto— y nunca crece por
 * encima del cuerpo original ni baja de la mitad: el español ocupa un 15-25 % más que el
 * inglés, y más allá de eso es mejor recortar que volverlo ilegible.
 */
export function fitFontSize(
  box: { height: number; width: number },
  characters: number,
  original: number,
  lineHeight = 1.2,
) {
  if (characters <= 0 || box.width <= 0 || box.height <= 0) return original;
  const fitting = Math.sqrt((box.width * box.height) / (characters * 0.5 * lineHeight)) * 0.96;
  return Math.max(original * 0.5, Math.min(original, fitting));
}

/**
 * Interlineado del original, en múltiplos del cuerpo: la altura de la caja repartida entre
 * sus renglones. La traducción lo copia para ocupar los mismos renglones que el texto al que
 * tapa; con uno fijo de 1,2, un título de un solo renglón perdía la parte baja de las letras.
 */
export function originalLeading(boxHeight: number, lines: number, fontHeight: number) {
  if (boxHeight <= 0 || lines <= 0 || fontHeight <= 0) return 1.2;
  return Math.min(1.45, Math.max(1, boxHeight / lines / fontHeight));
}
