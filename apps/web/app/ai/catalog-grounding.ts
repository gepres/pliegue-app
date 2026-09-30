import type { CatalogExtras } from "./document-catalog";

/**
 * Cotejo de los datos de la edición con el extracto que vio el modelo.
 *
 * Categoría y subcategoría son una opinión sobre la obra; la editorial, el ISBN o el traductor
 * son hechos que están en la portada o en los créditos, o no están. Un modelo pequeño los
 * rellena igual: con qwen3:4b, un cuento de Borges salió con ISBN «9788400000000» y editado por
 * «Penguin Books», y Borges figuraba como traductor de «La invención de Morel», que solo
 * prologó. Aquí se conserva lo que el propio texto respalda y se descarta el resto: un campo
 * vacío se completa a mano; uno inventado pasa por bueno y se exporta en la plantilla.
 */

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter((token) => token.length >= 3);
}

/**
 * El valor aparece seguido, palabra por palabra, sin importar mayúsculas, acentos ni signos.
 * Las palabras sueltas no bastan: «obras» y «completas» estaban en el texto de «La invención
 * de Morel» y el modelo inventó la serie «Obras Completas».
 */
function appearsIn(text: string, value: string | null) {
  if (!value) return false;
  const phrase = normalize(value);
  return Boolean(phrase) && text.includes(` ${phrase} `);
}

const translatorCues = ["traduccion", "traducido", "traductor", "traductora", "translated", "translation", "version de", "vertido"];
// Expresiones completas: «editor» a secas casaba con «Emecé Editores», que es la editorial.
const editorCues = [
  "edicion a cargo",
  "edicion y notas",
  "edited by",
  "editado por",
  "editor ",
  "editora ",
  "compilado por",
  "compilacion de",
  "compilador",
  "compiladora",
  "coordinado por",
  "coordinacion de",
  "seleccion de",
  "seleccion y",
];

/**
 * El nombre aparece y, en los 80 caracteres que lo preceden, la expresión que dice su papel:
 * «Traducción de…», «Edición a cargo de…». Sin esa condición, «Prólogo de Jorge Luis Borges»
 * bastaba para hacerlo traductor.
 */
function inRole(text: string, name: string, cues: readonly string[]) {
  const nameTokens = tokens(name);
  const first = nameTokens[0];
  if (!first) return false;
  const surname = nameTokens.at(-1) ?? first;
  let from = text.indexOf(first);
  while (from !== -1) {
    const after = text.slice(from, from + name.length + 40);
    const before = text.slice(Math.max(0, from - 80), from);
    if (after.includes(surname) && cues.some((cue) => before.includes(cue))) return true;
    from = text.indexOf(first, from + first.length);
  }
  return false;
}

export function groundCatalogExtras(
  extras: CatalogExtras,
  excerpt: string,
  canonicalTitle: string | null,
): CatalogExtras {
  const text = ` ${normalize(excerpt)} `;
  // Los ISBN se escriben con guiones o espacios entre grupos: se comparan sin ellos.
  const compact = excerpt.replaceAll(/(\d)[\s-]+(?=[\dXx])/g, "$1").toUpperCase();
  const series = appearsIn(text, extras.series) ? extras.series : null;
  const originalTitle =
    extras.originalTitle &&
    normalize(extras.originalTitle) !== normalize(canonicalTitle ?? "") &&
    appearsIn(text, extras.originalTitle)
      ? extras.originalTitle
      : null;

  return {
    ...extras,
    edition: appearsIn(text, extras.edition) ? extras.edition : null,
    editors: extras.editors.filter((name) => inRole(text, name, editorCues)),
    isbn: extras.isbn && compact.includes(extras.isbn) ? extras.isbn : null,
    originalTitle,
    publisher: appearsIn(text, extras.publisher) ? extras.publisher : null,
    series,
    translators: extras.translators.filter((name) => inRole(text, name, translatorCues)),
    // Un tomo sin su serie no ordena nada, y es justo el número que el modelo pone por defecto.
    volume: series ? extras.volume : null,
  };
}
