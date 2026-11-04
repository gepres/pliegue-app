/**
 * Restos de OCR sobre una ilustración (05.14).
 *
 * En un libro escaneado con capa de texto, el reconocimiento también «lee» los dibujos: dentro
 * del mapa de Mu salen «159 I Tax # 0911 ak», «t 200 leave», «103092E aD2009», «OW» o «置 。».
 * Recompuestos, eran párrafos y títulos sin sentido en el modo Lectura; traducidos, se pintaban
 * con el color del papel encima del dibujo. En un escaneo toda la página es una imagen, así que
 * saber si un bloque cae sobre una imagen no sirve: hay que reconocer el ruido por el texto.
 *
 * El criterio es prudente, porque quitar texto de verdad sería peor que dejar ruido. Solo cuenta
 * un bloque corto con señales claras de basura: fichas que mezclan letras y cifras, un signo
 * suelto que no es de texto, letras sueltas que no son palabra, otra escritura en una página
 * latina. No son basura los números romanos («X CONCLUSIONES»), los ordinales, una cifra pegada a
 * una palabra («1953dos»), las abreviaturas con punto ni los números solos: una nota como
 * «[5] Económico 3, 11-16», un pie como «170 / Cristina Larrea» o «MAP OF MU» se quedan.
 */

const maxTokens = 6;
const maxCharacters = 40;

const letter = /\p{L}/u;
const latinLetter = /\p{Script=Latin}/u;
const digit = /\p{N}/u;

/** Palabras de una o dos letras corrientes en español e inglés: una sola así no es ruido. */
const shortWords = new Set(
  "a e o u y i de la el en lo le se no mi tu su ya un si sí ni al me te ha he va da di ve yo él tú ti ay of to in is it on at as by be we or an if so do my us up go am ok oh ah".split(
    " ",
  ),
);

/** Un número romano en mayúsculas: «X CONCLUSIONES», el capítulo «V». */
const romanNumeral = /^[IVXLCDM]+$/u;

/** Si la mayoría de las letras de la página son latinas: ahí, otra escritura es ruido. */
export function isLatinPage(texts: readonly string[]) {
  let latin = 0;
  let total = 0;
  for (const text of texts) {
    for (const character of text) {
      if (!letter.test(character)) continue;
      total += 1;
      if (latinLetter.test(character)) latin += 1;
    }
  }
  return total > 0 && latin / total >= 0.7;
}

function strip(token: string) {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function isShortWord(bare: string) {
  return shortWords.has(bare.toLocaleLowerCase("es"));
}

function isNumber(token: string) {
  const bare = strip(token);
  return bare !== "" && !letter.test(bare) && digit.test(bare);
}

/** Una abreviatura con su punto, aunque lleve más signos detrás: «p.», «Fig.», «Nr.:». */
const abbreviation = /^\p{L}{1,4}\.[^\p{L}\p{N}]*$/u;

function isWordLike(token: string) {
  if (abbreviation.test(token)) return true;
  const bare = strip(token);
  if (romanNumeral.test(bare) || isShortWord(bare)) return true;
  return /^\p{L}[\p{L}'’-]*\p{L}{2}$/u.test(bare);
}

function isStrongJunk(token: string) {
  const bare = strip(token);
  // Un signo suelto que no es puntuación ni símbolo de texto: «#», «|», «~».
  if (bare === "") return /[#|~^_\\@]/u.test(token);
  if (letter.test(bare) && digit.test(bare)) {
    // Un ordinal («1st», «2º») o una cifra pegada a una palabra («1953dos», «56FARMACIA») son
    // texto, como un nombre de archivo o una versión («static2.c», «v2.0»).
    if (/^\d+(st|nd|rd|th|º|ª|o|a|er|era)$/iu.test(bare)) return false;
    const glued = /^\d+(\p{Ll}{3,}|\p{Lu}{3,})$/u.test(bare) || /^(\p{Ll}{3,}|\p{Lu}{3,})\d+$/u.test(bare);
    // …salvo que las letras sean un número romano: «LXX1» es el OCR de «LXXI».
    if (glued && !romanNumeral.test(bare.replace(/\d+/gu, ""))) return false;
    if (/[\p{L}\p{N}][._/-][\p{L}\p{N}]/u.test(bare)) return false;
    // Letras y cifras mezcladas en una misma ficha: «aD2009», «103092E», «LXX1».
    return true;
  }
  if (romanNumeral.test(bare)) return false;
  // Una o dos letras que no son palabra ni abreviatura: «t», «ak».
  return /^\p{L}{1,2}$/u.test(bare) && !abbreviation.test(token) && !isShortWord(bare);
}

/** Si el texto de un bloque parece un resto de OCR y no texto del libro. */
export function looksLikeOcrNoise(text: string, latinPage: boolean) {
  const compact = text.trim();
  if (!compact) return false;
  const letters = [...compact].filter((character) => letter.test(character));
  // Solo cifras y signos: un folio o un dato; no se toca.
  if (letters.length === 0) return false;
  // Otra escritura en una página latina, sin una sola letra latina: «置 。».
  if (latinPage && !letters.some((character) => latinLetter.test(character))) return true;

  const tokens = compact.split(/\s+/);
  if (tokens.length > maxTokens || compact.length > maxCharacters) return false;

  // Una ficha suelta que no es palabra ni número romano: «OW», «h».
  if (tokens.length === 1) return isStrongJunk(tokens[0]!);

  const junk = tokens.filter(isStrongJunk).length;
  const numbers = tokens.filter(isNumber).length;
  const longWords = tokens.filter((token) => isWordLike(token) && strip(token).length >= 4).length;
  // Dos señales claras, o una con cifras sueltas y casi sin palabras: «159 I Tax # 0911 ak»,
  // «103092E aD2009», «t 200 leave». Una nota («[5] Económico 3, 11-16») no trae ninguna.
  return junk >= 2 || (junk >= 1 && numbers >= 1 && longWords <= 1);
}
