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
