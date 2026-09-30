import { languageName } from "../library/translation";

/**
 * Traducir con la IA del usuario («Tu IA»): lo que se le pide y cómo se comprueba lo que
 * devuelve. Lo usan la ruta de servidor —OpenAI, Anthropic, Gemini— y el navegador, que habla
 * directamente con Ollama.
 *
 * Se traduce por lotes de pasajes —los bloques de una página— y la respuesta es un JSON con una
 * traducción por pasaje, en el mismo orden. Así una página es una sola petición y cada bloque
 * vuelve a su sitio; si el modelo se salta o junta alguno, se nota al contar y el lote se parte.
 */

/** Límites de un lote: caben en la salida de cualquier modelo pequeño y en la ruta (64 KB). */
export const translationBatchLimits = {
  /** Caracteres de todo el lote. */
  characters: 8_000,
  /** Caracteres de un pasaje; uno más largo se parte por frases antes de enviarlo. */
  passage: 4_000,
  /** Pasajes por lote. */
  passages: 48,
} as const;

export const translationJsonSchema = {
  additionalProperties: false,
  properties: {
    translations: { items: { type: "string" }, type: "array" },
  },
  required: ["translations"],
  type: "object",
} as const;

const languageCode = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

export function isLanguageCode(value: unknown): value is string {
  return typeof value === "string" && languageCode.test(value);
}

function named(code: string) {
  const name = languageName(code);
  return name === code ? code : `${name} (${code})`;
}

export function translationSystemPrompt(source: string, target: string) {
  return [
    `Eres un traductor literario. Traduces un libro del ${named(source)} al ${named(target)}, unos pasajes cada vez.`,
    "Recibes un JSON con `passages`: devuelve en `translations` exactamente una traducción por pasaje, en el mismo orden. Nunca juntes, partas ni omitas pasajes.",
    "Conserva el sentido, el tono y el registro del original: la prosa literaria sigue siendo literaria y un texto técnico sigue siendo preciso.",
    "No resumas, no expliques, no añadas notas ni comentarios: solo la traducción.",
    "Respeta los saltos de línea de cada pasaje (listas, poemas, entradas de índice) y deja igual los números, las referencias de página, las siglas y los nombres propios, salvo que tengan una traducción establecida.",
    "Si un pasaje ya está en el idioma de destino o no tiene nada que traducir, devuélvelo tal cual.",
  ].join("\n");
}

export function createTranslationPrompt(passages: readonly string[]) {
  return JSON.stringify({ passages });
}

/**
 * Las traducciones de la respuesta, comprobadas: una cadena por pasaje. Si el número no casa,
 * falla con `TranslationCountError`, y quien pidió el lote lo parte y lo vuelve a pedir.
 */
export class TranslationCountError extends Error {
  /** `received` a `null` cuando lo contó la ruta y solo se sabe que no casa. */
  constructor(expected: number, received: number | null) {
    super(
      received === null
        ? `El modelo no devolvió una traducción por pasaje (eran ${expected}).`
        : `El modelo devolvió ${received} traducciones para ${expected} pasajes.`,
    );
    this.name = "TranslationCountError";
  }
}

export function parseTranslations(value: unknown, expected: number): string[] {
  const translations = (value as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(translations) || !translations.every((item) => typeof item === "string")) {
    throw new Error("El modelo no devolvió la lista de traducciones esperada.");
  }
  if (translations.length !== expected) throw new TranslationCountError(expected, translations.length);
  return translations;
}

/** Salida que se reserva para un lote: holgada para idiomas que gastan más fichas por letra. */
export function translationMaxOutputTokens(characters: number) {
  return Math.min(16_000, 2_048 + Math.ceil(characters * 1.1));
}

/**
 * Reparte pasajes en lotes que respetan los límites, sin cambiar su orden. Devuelve los índices
 * de cada lote.
 */
export function batchPassages(
  passages: readonly string[],
  limits: { characters: number; passages: number } = translationBatchLimits,
) {
  const batches: number[][] = [];
  let current: number[] = [];
  let characters = 0;

  passages.forEach((passage, index) => {
    const full = current.length >= limits.passages || characters + passage.length > limits.characters;
    if (current.length > 0 && full) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(index);
    characters += passage.length;
  });
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Comprueba lo que llega a la ruta: pasajes de texto dentro de los límites. */
export function validPassages(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > translationBatchLimits.passages) return false;
  let total = 0;
  for (const passage of value) {
    if (typeof passage !== "string" || passage.length > translationBatchLimits.passage) return false;
    total += passage.length;
  }
  return total <= translationBatchLimits.characters;
}
