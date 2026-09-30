/**
 * Idioma de un documento como código ISO 639-1.
 *
 * El catálogo lo recibía como texto libre y cada fuente lo escribía a su manera: la IA
 * devolvía «español» o «English», el JSON de una persona «es», un EPUB «es-ES». Filtrar por
 * idioma con eso abría cuatro entradas para la misma lengua. Se guarda el código y la
 * etiqueta se compone al mostrarlo.
 */
const aliases: Record<string, string[]> = {
  ca: ["catalan", "catala"],
  de: ["aleman", "german", "deutsch"],
  en: ["ingles", "english", "eng"],
  es: ["espanol", "castellano", "spanish", "spa"],
  fr: ["frances", "french", "francais", "fra", "fre"],
  gl: ["gallego", "galician"],
  it: ["italiano", "italian", "ita"],
  la: ["latin"],
  pt: ["portugues", "portuguese", "por"],
  qu: ["quechua", "runasimi"],
};

const byAlias = new Map<string, string>(
  Object.entries(aliases).flatMap(([code, names]) => [
    [code, code],
    ...names.map((name): [string, string] => [name, code]),
  ]),
);

function fold(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

export function normalizeLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const folded = fold(value);
  if (!folded) return null;

  // «es-ES», «pt_BR»: basta la lengua.
  const tag = /^([a-z]{2,3})(?:[-_][a-z0-9]+)*$/.exec(folded)?.[1];
  if (tag && byAlias.has(tag)) return byAlias.get(tag) ?? null;

  // «español e inglés»: manda la primera lengua nombrada.
  const firstWord = folded.split(/[\s,;/]+/)[0] ?? folded;
  return byAlias.get(firstWord) ?? byAlias.get(folded) ?? folded;
}

/**
 * Palabras vacías frecuentes de cada lengua, ya sin tildes como el texto que se compara. Las
 * compartidas («que», «para») suman a varias a la vez y no desempatan; deciden las propias:
 * «los», «uma», «the», «der».
 */
const stopwords = new Map(
  Object.entries({
    de: "der die und das ist nicht mit den ein eine zu von auf sich auch dem des fur wird werden",
    en: "the and of to is in that it was for with as on are this by be which from have",
    es: "el la los las del y que en una por con para es se lo como mas pero sus su al",
    fr: "le les des et est une dans que pour pas sur au du ce qui sont avec il elle",
    it: "il che di e la per non una sono della del gli anche come piu nel alla degli",
    pt: "o os do da dos das em nao uma e com ao tambem mais que para se por pelo pela",
  }).map(([code, words]) => [code, new Set(words.split(" "))] as const),
);

/** Por debajo, el texto es un título, un índice o una portada: no basta para decidir. */
const minimumWords = 40;

/**
 * Idioma probable de un texto, o `null` si hay poco texto o dos lenguas quedan demasiado
 * cerca. Se calcula al indexar, en el dispositivo, para que el filtro de idioma funcione
 * también en los documentos que aún no tienen ficha.
 */
export function detectTextLanguage(text: string): string | null {
  const words = fold(text.slice(0, 20_000)).match(/\p{L}+/gu) ?? [];
  if (words.length < minimumWords) return null;

  const [best, second] = [...stopwords]
    .map(([code, set]) => ({ code, hits: words.filter((word) => set.has(word)).length }))
    .sort((left, right) => right.hits - left.hits);

  // En un texto corrido, las palabras vacías de su lengua son más de la cuarta parte; con
  // menos del 8 % lo que hay son nombres, cifras o una tabla.
  if (!best || best.hits / words.length < 0.08) return null;
  if (second && best.hits < second.hits * 1.25) return null;
  return best.code;
}

let displayNames: Intl.DisplayNames | null | undefined;

/** «es» → «español». Si el código no es ISO, se devuelve tal cual. */
export function languageLabel(code: string | null | undefined) {
  if (!code) return null;
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["es"], { type: "language" });
    } catch {
      displayNames = null;
    }
  }
  if (/^[a-z]{2,3}$/.test(code)) {
    try {
      return displayNames?.of(code) ?? code;
    } catch {
      return code;
    }
  }
  return code;
}
