/**
 * Con qué traducir un libro: el traductor del navegador (el predeterminado) o una IA a elección
 * de la persona. Aquí están los datos de la comparativa de Ajustes y lo que cuesta cada opción,
 * calculado a partir de sus precios y no escrito a mano.
 *
 * Precios verificados el 29-sep-2026 en la documentación de cada proveedor. Calidad: WMT25, la
 * evaluación humana de referencia de la traducción automática, puso a los LLM grandes en cabeza
 * —Gemini 2.5 Pro, en el grupo ganador de 14 de 15 pares; las traducciones humanas de referencia,
 * solo en 6—. Los modelos baratos de esas familias no se evaluaron allí: su calidad es una
 * estimación por familia, y así se dice en la tabla.
 */

export type TranslationProviderChoice = "browser" | "azure" | "openai" | "anthropic" | "gemini" | "ollama";

export const translationProviderChoices: readonly TranslationProviderChoice[] = [
  "browser",
  "azure",
  "openai",
  "anthropic",
  "gemini",
  "ollama",
];

/** Un libro de unas 90.000 palabras: la medida con la que se compara. */
export const bookCharacters = 550_000;

/** Unos cuatro caracteres por token en idiomas latinos. */
const charactersPerToken = 4;
/** Instrucciones y formato JSON de cada lote, sobre el texto. */
const promptOverhead = 1.1;
/** Del inglés al español el texto crece en torno a un 15 %. */
const outputGrowth = 1.15;

type Pricing =
  | { kind: "free" }
  | { kind: "characters"; perMillion: number }
  | { input: number; kind: "tokens"; output: number };

export interface TranslationOption {
  free: string;
  id: TranslationProviderChoice;
  label: string;
  /** Modelo con el que se calcula el coste; el de Ajustes puede ser otro. */
  model?: string;
  pricing: Pricing;
  privacy: string;
  quality: "Básica" | "Buena" | "Muy buena";
  speed: string;
}

export const translationOptions: readonly TranslationOption[] = [
  {
    free: "Siempre",
    id: "browser",
    label: "Chrome o Edge",
    pricing: { kind: "free" },
    privacy: "No sale del equipo",
    quality: "Básica",
    speed: "< 1 s por página (medido)",
  },
  {
    free: "2 M caracteres al mes",
    id: "azure",
    label: "Azure Translator",
    pricing: { kind: "characters", perMillion: 10 },
    privacy: "Va a Microsoft",
    quality: "Buena",
    speed: "1-2 s por página",
  },
  {
    free: "No",
    id: "openai",
    label: "OpenAI",
    model: "gpt-6-luna",
    pricing: { input: 0.1, kind: "tokens", output: 0.5 },
    privacy: "Va a OpenAI",
    quality: "Muy buena",
    speed: "2-5 s por página",
  },
  {
    free: "Con límites (AI Studio)",
    id: "gemini",
    label: "Gemini",
    model: "gemini-3.5-flash-lite",
    pricing: { input: 0.3, kind: "tokens", output: 2.5 },
    privacy: "Va a Google",
    quality: "Muy buena",
    speed: "2-5 s por página",
  },
  {
    free: "No",
    id: "anthropic",
    label: "Claude",
    model: "claude-haiku-4-5",
    pricing: { input: 1, kind: "tokens", output: 5 },
    privacy: "Va a Anthropic",
    quality: "Muy buena",
    speed: "2-5 s por página",
  },
  {
    free: "Siempre",
    id: "ollama",
    label: "Ollama",
    model: "qwen3:4b",
    pricing: { kind: "free" },
    privacy: "No sale del equipo",
    quality: "Buena",
    speed: "≈ 60 s por página en CPU (medido)",
  },
];

/** Coste estimado de traducir un libro, en dólares. */
export function costPerBook(pricing: Pricing, characters = bookCharacters) {
  if (pricing.kind === "free") return 0;
  if (pricing.kind === "characters") return (characters / 1_000_000) * pricing.perMillion;
  const inputTokens = (characters / charactersPerToken) * promptOverhead;
  const outputTokens = (characters / charactersPerToken) * outputGrowth;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

const dollars = new Intl.NumberFormat("es", { currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2, style: "currency" });

/** «0,11 US$», o «Gratis». */
export function formatBookCost(cost: number) {
  return cost === 0 ? "Gratis" : `≈ ${dollars.format(cost)}`;
}

/** Libros al mes que cubre un cupo gratuito medido en caracteres. */
export function booksPerMonth(freeCharacters: number, characters = bookCharacters) {
  return Math.floor((freeCharacters / characters) * 10) / 10;
}
