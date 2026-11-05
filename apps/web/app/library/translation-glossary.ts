import { hashText } from "./translation";

/**
 * El glosario de un libro (05.5): cómo se traduce siempre un término —un nombre, un concepto
 * del autor— para que no cambie de una página a otra («Naacal», «Escrituras Sagradas
 * Inspiradas»). Es de cada libro y de cada idioma de destino.
 *
 * Las IA lo reciben en las instrucciones. Los traductores automáticos —el del navegador, DeepL,
 * Azure, LibreTranslate— no aceptan instrucciones, así que el término se sustituye por su
 * traducción antes de enviarlo; esos motores dejan como está lo que ya viene en otro idioma.
 */

export interface GlossaryEntry {
  source: string;
  target: string;
}

export const glossaryLimits = {
  /** Términos por libro e idioma: los que caben en las instrucciones sin estorbar. */
  entries: 100,
  /** Caracteres de un término o de su traducción. */
  term: 120,
} as const;

const tidy = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/** Un término válido, sin espacios de sobra; `null` si falta algo o es demasiado largo. */
export function cleanEntry(entry: { source?: unknown; target?: unknown } | null | undefined): GlossaryEntry | null {
  const source = tidy(entry?.source);
  const target = tidy(entry?.target);
  if (!source || !target || source.length > glossaryLimits.term || target.length > glossaryLimits.term) return null;
  return { source, target };
}

/** La lista entera, limpia y sin el mismo término dos veces (manda el último). */
export function cleanGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) return [];
  const byTerm = new Map<string, GlossaryEntry>();
  for (const item of value) {
    const entry = cleanEntry(item as { source?: unknown; target?: unknown });
    if (entry) byTerm.set(entry.source.toLocaleLowerCase(), entry);
  }
  return [...byTerm.values()].slice(-glossaryLimits.entries);
}

const special = /[.*+?^${}()|[\]\\]/g;

/** El término como palabra entera, sin distinguir mayúsculas y con cualquier espacio en medio. */
function termPattern(term: string) {
  const body = term.replace(special, "\\$&").replace(/ /g, String.raw`\s+`);
  return new RegExp(String.raw`(?<![\p{L}\p{N}])` + body + String.raw`(?![\p{L}\p{N}])`, "giu");
}

/** Los términos del glosario que aparecen en un texto. */
export function matchingEntries(text: string, entries: readonly GlossaryEntry[]) {
  return entries.filter((entry) => termPattern(entry.source).test(text));
}

/** Los que aparecen en alguno de los textos: lo que se manda con un lote. */
export function entriesForTexts(texts: readonly string[], entries: readonly GlossaryEntry[]) {
  return entries.filter((entry) => texts.some((text) => termPattern(entry.source).test(text)));
}

/** Lo que hay delante de una palabra que empieza frase: nada, o un punto y quizá unas comillas. */
const sentenceStart = /(?:^|[.!?¡¿:\n]["'»”)]*)\s*$/;

/**
 * La traducción tal como se apuntó en el glosario, salvo al empezar una frase, donde va con
 * mayúscula; también si el término se apuntó en minúscula y el texto lo trae con mayúscula. Un
 * nombre propio con traducción en minúscula («Naacal» → «naacal») se respeta en medio de frase.
 */
function matchCase(found: string, entry: GlossaryEntry, before: string) {
  const first = entry.target.charAt(0);
  const upper = first.toLocaleUpperCase();
  const capitalized = /^\p{Lu}/u.test(found) && !/^\p{Lu}/u.test(entry.source);
  return (sentenceStart.test(before) || capitalized) && first !== upper ? upper + entry.target.slice(1) : entry.target;
}

/** Un carácter de uso privado: no aparece en ningún libro y marca dónde va cada término. */
const slotMark = String.fromCharCode(0xe000);
const slotPattern = new RegExp(`${slotMark}(\\d+)${slotMark}`, "g");

/**
 * El texto con cada término ya sustituido por su traducción, para los traductores que no
 * aceptan instrucciones. Primero los términos más largos («Mar Muerto» antes que «Mar»), y lo
 * sustituido no se vuelve a tocar.
 */
export function applyGlossary(text: string, entries: readonly GlossaryEntry[]) {
  if (!entries.length) return text;
  const slots: string[] = [];
  let result = text;
  for (const entry of [...entries].sort((left, right) => right.source.length - left.source.length)) {
    result = result.replace(termPattern(entry.source), (found: string, offset: number, whole: string) => {
      slots.push(matchCase(found, entry, whole.slice(Math.max(0, offset - 8), offset)));
      return `${slotMark}${slots.length - 1}${slotMark}`;
    });
  }
  return result.replace(slotPattern, (_, index: string) => slots[Number(index)] ?? "");
}

const markPattern = /\[\[(\d+)\]\]/g;

/**
 * El texto con cada término cambiado por una marca, `[[1]]`, y cómo poner después su traducción.
 * Es el último recurso con una IA que no respeta el glosario ni con el término ya puesto
 * (qwen3:4b abreviaba «Códice» como «Cód:»): las marcas las deja tal cual, y la traducción del
 * término la pone Pliegue. Si el modelo se come una marca, ese término no se puede poner.
 */
export function protectTerms(text: string, entries: readonly GlossaryEntry[]) {
  const used: GlossaryEntry[] = [];
  let result = text;
  for (const entry of [...entries].sort((left, right) => right.source.length - left.source.length)) {
    result = result.replace(termPattern(entry.source), () => {
      used.push(entry);
      return `[[${used.length}]]`;
    });
  }
  const restore = (translated: string) =>
    translated.replace(markPattern, (found, index: string, offset: number, whole: string) => {
      const entry = used[Number(index) - 1];
      return entry ? matchCase(entry.target, entry, whole.slice(Math.max(0, offset - 8), offset)) : found;
    });
  return { restore, text: result };
}

/**
 * La huella de un bloque traducido con su glosario. Sin términos del glosario es la misma de
 * siempre —lo ya traducido sigue valiendo—; con ellos, cambia si cambia su traducción: al
 * corregir un término se vuelven a traducir solo los bloques donde aparece.
 */
export function glossaryHash(text: string, entries: readonly GlossaryEntry[]) {
  const used = matchingEntries(text, entries);
  if (!used.length) return hashText(text);
  const separator = String.fromCharCode(0xe001);
  return hashText([text, ...used.map((entry) => `${entry.source}=${entry.target}`).sort()].join(separator));
}

/** Las líneas que se añaden a las instrucciones de una IA. */
export function glossaryInstructions(entries: readonly GlossaryEntry[]) {
  if (!entries.length) return "";
  return [
    "Usa siempre estas traducciones para estos términos, también en plural o en mayúscula:",
    ...entries.map((entry) => `- «${entry.source}» → «${entry.target}»`),
  ].join("\n");
}
