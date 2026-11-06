/**
 * Libros repetidos que no son el mismo archivo (03.6): otro escaneo, otra edición, el EPUB y el
 * PDF del mismo libro, una copia en color y otra en grises. Los idénticos byte a byte ya se
 * agrupan solos como copias (`book-copies`); estos no, y hasta ahora solo se marcaban a mano en
 * el índice JSON (`duplicateOf`).
 *
 * Las señales son las que se usaron para marcar los 16 del corpus del dueño (20-oct):
 * - **El texto:** tejas de 5 palabras del principio del libro (lo que guarda el índice) y su
 *   contención, qué parte de las del más corto está en el otro. Dos extracciones del mismo
 *   libro —un EPUB y su PDF— comparten la mayoría aunque cambien saltos y guiones.
 * - **La portada:** su huella dHash, que aguanta el color frente a los grises o un recorte
 *   distinto. Sola engaña —los tomos de una colección comparten diseño—, así que solo cuenta
 *   si además el título se parece.
 * - **El título,** cuando uno de los dos no tiene texto (un escaneo sin OCR): casi idéntico y
 *   del mismo autor.
 * Y tres frenos: dos tomos distintos («Platón I» y «Platón II»), dos idiomas distintos (una
 * traducción) y dos autores distintos no son el mismo libro.
 *
 * Medido contra los 16 marcados a mano del corpus (439 libros): ver la prueba y el avance de
 * 03.6. Son sugerencias: la persona decide cuál conservar o que no son el mismo libro.
 */

export interface DuplicateItem {
  /** Autores, si los hay: dos autores distintos no escriben el mismo libro. */
  authors?: readonly string[];
  /** Huella dHash de la portada, 16 cifras hexadecimales; `null` sin portada. */
  coverHash?: string | null;
  id: string;
  /** Idioma del libro, si se sabe: dos idiomas distintos son una traducción, no una copia. */
  language?: string | null;
  /** Texto del principio del libro (el del índice). */
  text?: string;
  title: string;
}

export interface DuplicatePair {
  /** Los dos libros, por su id, en el orden en que llegaron. */
  ids: [string, string];
  /** Por qué se cree que son el mismo libro. */
  reason: "cover" | "text" | "title";
  /** Parecido de 0 a 1: la contención del texto, lo que se parece la portada o el título. */
  score: number;
}

const shingleSize = 5;
/** Con menos tejas no hay texto para comparar: una portada o un aviso legal. */
const minShingles = 60;
/** Las del principio bastan: el índice guarda unas 5.000 palabras. */
const maxWords = 6_000;
/**
 * Contención mínima del texto. En el corpus, las parejas de verdad están en 0,54 o más; por
 * debajo quedan libros del mismo autor o de la misma colección que comparten citas o prólogo.
 */
const minContainment = 0.45;
/** Bits de la portada que pueden diferir (de 64) sin dejar de ser la misma. */
const maxCoverDistance = 10;
/** Lo que tiene que parecerse el título para fiarse de la portada. */
const minTitleSimilarity = 0.5;
/** Y para fiarse solo del título, si uno de los dos no tiene texto. */
const minTitleOnlySimilarity = 0.9;

/** Sin tildes, sin mayúsculas y sin signos: para comparar palabras, no grafías. */
export function normalizeWords(text: string) {
  // Una pasada para quitar a la vez las marcas (las tildes, ya separadas) y los signos.
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+|[^\p{L}\p{N}]+/gu, (match) => (/^\p{M}+$/u.test(match) ? "" : " "))
    .split(" ")
    .filter(Boolean);
}

/** FNV-1a de 32 bits: rápido y estable entre ejecuciones. */
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * Las tejas de 5 palabras del texto, como huellas ordenadas y sin repetir. Cada palabra se
 * resume una vez y la teja se compone de esas cinco huellas: sin crear una cadena por teja, que
 * era la mitad del tiempo con 400 libros.
 */
export function textSignature(text: string): Uint32Array {
  const words = normalizeWords(text.slice(0, maxWords * 8)).slice(0, maxWords);
  const wordHashes = words.map(hash);
  const hashes = new Set<number>();
  for (let index = 0; index + shingleSize <= wordHashes.length; index += 1) {
    let value = 0x811c9dc5;
    for (let offset = 0; offset < shingleSize; offset += 1) value = Math.imul(value ^ wordHashes[index + offset]!, 0x01000193);
    hashes.add(value >>> 0);
  }
  return Uint32Array.from(hashes).sort();
}

/** Qué parte de las tejas del más corto está en el otro. */
export function containment(left: Uint32Array, right: Uint32Array) {
  if (!left.length || !right.length) return 0;
  let shared = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      shared += 1;
      i += 1;
      j += 1;
    } else if (left[i]! < right[j]!) i += 1;
    else j += 1;
  }
  return shared / Math.min(left.length, right.length);
}

/**
 * dHash de una imagen en grises de 9 × 8: un bit por par de píxeles vecinos (¿más claro el de
 * la izquierda?). 16 cifras hexadecimales.
 */
export function differenceHash(gray: ArrayLike<number>) {
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += gray[row * 9 + column]! > gray[row * 9 + column + 1]! ? "1" : "0";
    }
  }
  let hex = "";
  for (let index = 0; index < 64; index += 4) hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  return hex;
}

/** Bits distintos entre dos huellas dHash. */
export function hammingDistance(left: string, right: string) {
  let distance = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    let xor = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/** Palabras que no dicen de qué libro se trata: formatos, ediciones, artículos. */
const noiseWords = new Set(
  "pdf epub mobi docx version edicion edition spanish espanol libro libros ebook copia el la los las un una de del y en a al por para con the of and an to in on by".split(" "),
);

const romanNumeral = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/;

/** Números de tomo o volumen del título: arábigos y romanos sueltos («Platón I», «Tomo 3»). */
function volumeNumbers(words: readonly string[]) {
  return new Set(words.filter((word) => /^\d{1,3}$/.test(word) || romanNumeral.test(word)));
}

/**
 * Las palabras del título que dicen qué libro es. El autor no se añade —dos obras del mismo
 * autor no son el mismo libro—, pero tampoco se quita: en «Gredos - Hume» el título es el autor.
 */
function titleWords(item: DuplicateItem) {
  return new Set(
    normalizeWords(item.title).filter((word) => word.length >= 3 && !noiseWords.has(word) && !/^\d+$/.test(word) && !romanNumeral.test(word)),
  );
}

/** Sin las palabras de colección; si no queda ninguna («El libro de la filosofía»), todas. */
function distinctiveWords(item: DuplicateItem, frequent: ReadonlySet<string>) {
  const words = titleWords(item);
  const kept = new Set([...words].filter((word) => !frequent.has(word)));
  return kept.size ? kept : words;
}

/**
 * Parecido de dos títulos, de 0 a 1: palabras en común sobre las del más corto. `frequent` son
 * las palabras que salen en muchos títulos de la biblioteca —«Biblioteca Grandes Pensadores
 * Gredos», «Descubrir la filosofía»—: no distinguen un libro de otro y se dejan fuera.
 */
export function titleSimilarity(left: DuplicateItem, right: DuplicateItem, frequent: ReadonlySet<string> = new Set()) {
  const a = distinctiveWords(left, frequent);
  const b = distinctiveWords(right, frequent);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Lo mismo, pero sobre todas las palabras de los dos (Jaccard): un título de una palabra
 * («De la política») no se parece así a cualquiera que la contenga.
 */
export function titleOverlap(left: DuplicateItem, right: DuplicateItem, frequent: ReadonlySet<string> = new Set()) {
  const a = distinctiveWords(left, frequent);
  const b = distinctiveWords(right, frequent);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** ¿Tomos distintos de una misma obra? Solo si los dos títulos llevan número y no coinciden. */
export function differentVolumes(left: DuplicateItem, right: DuplicateItem) {
  const a = volumeNumbers(normalizeWords(left.title));
  const b = volumeNumbers(normalizeWords(right.title));
  if (!a.size || !b.size) return false;
  for (const number of a) if (b.has(number)) return false;
  return true;
}

/** ¿Autores distintos? Solo si los dos tienen y no comparten ni un apellido. */
export function differentAuthors(left: DuplicateItem, right: DuplicateItem) {
  const names = (item: DuplicateItem) => new Set(normalizeWords((item.authors ?? []).join(" ")).filter((word) => word.length >= 3));
  const a = names(left);
  const b = names(right);
  if (!a.size || !b.size) return false;
  for (const name of a) if (b.has(name)) return false;
  return true;
}

const differentLanguages = (left: DuplicateItem, right: DuplicateItem) =>
  Boolean(left.language && right.language && left.language.split("-")[0] !== right.language.split("-")[0]);

/** Las palabras de título que salen en muchos libros: las de colección o serie. */
function frequentTitleWords(items: readonly DuplicateItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) for (const word of titleWords(item)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const limit = Math.max(4, Math.ceil(items.length * 0.01));
  return new Set([...counts].filter(([, count]) => count > limit).map(([word]) => word));
}

/**
 * Las parejas de libros que parecen el mismo. Para no comparar cada libro con todos, el texto
 * se cruza primero por una muestra de sus tejas (una de cada 16): solo las parejas que
 * comparten varias se comparan enteras.
 */
export function findDuplicatePairs(items: readonly DuplicateItem[], precomputed?: readonly Uint32Array[]): DuplicatePair[] {
  // Las firmas son lo caro (unos 2 s con 400 libros): quien llama puede calcularlas por tandas,
  // sin congelar la página, y pasarlas ya hechas.
  const signatures = precomputed ?? items.map((item) => textSignature(item.text ?? ""));
  const withText = signatures.map((signature) => signature.length >= minShingles);
  const frequent = frequentTitleWords(items);
  const pairs = new Map<string, DuplicatePair>();
  const keyOf = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const blocked = (a: number, b: number) => differentVolumes(items[a]!, items[b]!) || differentLanguages(items[a]!, items[b]!);
  const add = (a: number, b: number, reason: DuplicatePair["reason"], score: number) =>
    pairs.set(keyOf(a, b), { ids: [items[a]!.id, items[b]!.id], reason, score: Math.round(score * 100) / 100 });

  // ---- Por el texto -----------------------------------------------------------------------
  const sampled = new Map<number, number[]>();
  signatures.forEach((signature, index) => {
    if (!withText[index]) return;
    for (const value of signature) {
      if (value % 16 !== 0) continue;
      const holders = sampled.get(value);
      if (holders) holders.push(index);
      else sampled.set(value, [index]);
    }
  });
  const sharedSamples = new Map<string, number>();
  for (const holders of sampled.values()) {
    // Una teja que está en muchos libros es un aviso legal o un prólogo de colección.
    if (holders.length > 8) continue;
    for (let i = 0; i < holders.length; i += 1) {
      for (let j = i + 1; j < holders.length; j += 1) {
        const key = keyOf(holders[i]!, holders[j]!);
        sharedSamples.set(key, (sharedSamples.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, shared] of sharedSamples) {
    if (shared < 2) continue;
    const [a, b] = key.split(":").map(Number) as [number, number];
    if (blocked(a, b)) continue;
    const score = containment(signatures[a]!, signatures[b]!);
    if (score >= minContainment) add(a, b, "text", score);
  }

  // ---- Por la portada, o por el título si uno no tiene texto --------------------------------
  // Las dos piden que el título se parezca: solo se miran las parejas que comparten alguna
  // palabra distintiva del título, no todas contra todas.
  const byWord = new Map<string, number[]>();
  items.forEach((item, index) => {
    for (const word of distinctiveWords(item, frequent)) {
      const holders = byWord.get(word);
      if (holders) holders.push(index);
      else byWord.set(word, [index]);
    }
  });
  const titlePairs = new Set<string>();
  for (const holders of byWord.values()) {
    for (let i = 0; i < holders.length; i += 1) for (let j = i + 1; j < holders.length; j += 1) titlePairs.add(keyOf(holders[i]!, holders[j]!));
  }
  for (const key of titlePairs) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    const left = items[a]!;
    const right = items[b]!;
    {
      if (pairs.has(key) || blocked(a, b)) continue;
      const title = titleSimilarity(left, right, frequent);
      if (title < minTitleSimilarity) continue;
      const distance = left.coverHash && right.coverHash ? hammingDistance(left.coverHash, right.coverHash) : 64;
      if (distance <= maxCoverDistance) add(a, b, "cover", 1 - distance / 64);
      // Sin texto en uno de los dos, el texto no puede ni confirmarlo ni desmentirlo: solo el
      // título, entero (sin quitarle las palabras de colección) y del mismo autor. Por la
      // portada no se exige el autor: la ficha de un volumen de Gredos puede llevar a quien
      // firma su estudio introductorio.
      else if ((!withText[a] || !withText[b]) && !differentAuthors(left, right) && titleOverlap(left, right) >= minTitleOnlySimilarity) {
        add(a, b, "title", 0.9);
      }
    }
  }

  return [...pairs.values()].sort((left, right) => right.score - left.score);
}
