/**
 * Reconciliación de grafías de un mismo autor.
 *
 * El catálogo se construye documento a documento, así que el modelo escribe cada nombre sin
 * ver los que ya existen. Un corpus real acaba con «Jacobo Grinberg», «Jacobo Grinberg
 * Zylberbaum» y «Jacobo Grinberg-Zylberbaum» como tres autores distintos, y el filtro por autor
 * deja de servir. Aquí se decide cuándo dos grafías son la misma persona.
 *
 * El criterio es deliberadamente conservador: fusionar de más es peor que fusionar de menos,
 * porque atribuye una obra a quien no la escribió. Por eso no hay comparación difusa: dos
 * nombres solo se unen si uno puede leerse como versión abreviada del otro.
 */

/** Un token de una letra es una inicial: «J.» frente a «José». */
function isInitial(token: string) {
  return token.length === 1;
}

function normalizeAuthorText(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es")
    .replaceAll(/[.,]/g, " ")
    // El guion de los apellidos compuestos se trata como espacio: «Grinberg-Zylberbaum» y
    // «Grinberg Zylberbaum» son la misma persona escrita de dos maneras.
    .replaceAll(/[-–—_]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function authorTokens(value: string) {
  return normalizeAuthorText(value).split(" ").filter(Boolean);
}

/** Clave de igualdad exacta, insensible a acentos, mayúsculas, guiones y puntuación. */
export function authorKey(value: string) {
  return normalizeAuthorText(value);
}

function tokensMatch(short: string, long: string) {
  if (short === long) return true;
  // Una inicial casa con el nombre que empieza por ella, en ese orden y no al revés.
  if (isInitial(short) && long.startsWith(short)) return true;
  return isInitial(long) && short.startsWith(long);
}

/**
 * Dos nombres son la misma persona si el más corto se alinea en orden con el más largo y
 * comparten algo más que el nombre de pila. Esa segunda condición es la que impide unir a
 * «Carlos Castaneda» con «Carlos Fernández Liria» o a «Isra García» con «Pepe García».
 */
export function isSameAuthor(left: string, right: string) {
  const a = authorTokens(left);
  const b = authorTokens(right);
  if (!a.length || !b.length) return false;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // Un nombre de una sola palabra —«Anónimo», «Kashi»— solo casa consigo mismo: no hay
  // apellido con el que confirmar que se trata de la misma persona.
  if (short.length < 2) return short.join(" ") === long.join(" ");

  let sharedSurname = false;
  for (const [index, token] of short.entries()) {
    const counterpart = long[index];
    if (counterpart === undefined || !tokensMatch(token, counterpart)) return false;
    if (index > 0 && token === counterpart && token.length > 2) sharedSurname = true;
  }

  return sharedSurname;
}

/**
 * Entre dos grafías equivalentes gana la que más identifica: primero la que desarrolla las
 * iniciales, después la que añade apellidos. El desempate alfabético solo existe para que el
 * resultado no dependa del orden en que se procesaron los documentos.
 */
export function preferAuthorName(left: string, right: string) {
  const a = authorTokens(left);
  const b = authorTokens(right);
  const spelled = (tokens: string[]) => tokens.filter((token) => !isInitial(token)).length;

  if (spelled(a) !== spelled(b)) return spelled(a) > spelled(b) ? left : right;
  if (a.length !== b.length) return a.length > b.length ? left : right;
  if (left.length !== right.length) return left.length > right.length ? left : right;
  return left.localeCompare(right, "es") <= 0 ? left : right;
}

/**
 * Índice de formas canónicas construido a partir de los autores ya presentes en el catálogo.
 * Se consulta con `canonicalAuthorName` para que cada ficha nueva adopte la grafía establecida
 * en lugar de abrir una entrada paralela.
 */
export class AuthorIndex {
  private readonly canonical: string[] = [];

  constructor(names: Iterable<string> = []) {
    for (const name of names) this.add(name);
  }

  /** Registra el nombre y devuelve la forma canónica que le corresponde. */
  add(name: string) {
    const cleaned = name.trim();
    if (!cleaned) return cleaned;

    const index = this.canonical.findIndex((known) => isSameAuthor(known, cleaned));
    if (index === -1) {
      this.canonical.push(cleaned);
      return cleaned;
    }

    const preferred = preferAuthorName(this.canonical[index] as string, cleaned);
    this.canonical[index] = preferred;
    return preferred;
  }

  /** Devuelve la forma canónica ya fijada, sin registrar el nombre si no lo conocía. */
  resolve(name: string) {
    const cleaned = name.trim();
    return this.canonical.find((candidate) => isSameAuthor(candidate, cleaned)) ?? cleaned;
  }

  get names(): readonly string[] {
    return this.canonical;
  }
}

/**
 * Unifica una lista de autores contra los ya conocidos y entre sí, conservando el orden de
 * aparición y descartando los que se repiten tras la reconciliación.
 */
export function reconcileAuthors(
  authors: readonly string[],
  known: Iterable<string> = [],
): string[] {
  const index = new AuthorIndex(known);
  // Se registran todos antes de resolver ninguno: así dos grafías nuevas del mismo autor que
  // llegan en la misma ficha también se unifican entre sí, y no solo contra las ya conocidas.
  for (const author of authors) index.add(author);

  const result: string[] = [];
  const seen = new Set<string>();

  for (const author of authors) {
    const canonical = index.resolve(author);
    const key = authorKey(canonical);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }

  return result;
}
