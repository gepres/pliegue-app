/**
 * Con qué traducir un libro: el traductor del navegador (el predeterminado) o una IA a elección
 * de la persona. Aquí están los datos de la comparativa de Ajustes y lo que cuesta cada opción,
 * calculado a partir de sus precios y no escrito a mano.
 *
 * Precios verificados el 29-sep-2026 en la documentación de cada proveedor y, los de las IA, de
 * nuevo el 6-nov-2026 en Artificial Analysis (artificialanalysis.ai). Calidad: WMT25, la
 * evaluación humana de referencia de la traducción automática, puso a los LLM grandes en cabeza
 * —Gemini 2.5 Pro, en el grupo ganador de 14 de 15 pares; las traducciones humanas de referencia,
 * solo en 6—. Los modelos baratos de esas familias no se evaluaron allí: su calidad es una
 * estimación por familia, y así se dice en la tabla.
 *
 * DeepL y LibreTranslate, añadidos el 4-nov-2026 a petición del dueño (05.5): DeepL API Free da
 * 500.000 caracteres al mes y la Pro cobra unos 25 $ por millón (más una cuota fija), según la
 * ayuda de DeepL y comparativas de 2026. LibreTranslate es software libre (AGPL): gratis si lo
 * aloja la persona; libretranslate.com cobra una suscripción mensual, no por caracteres. Su
 * calidad, por familia de motor: DeepL a la altura de Azure, LibreTranslate por debajo.
 */

export type TranslationProviderChoice =
  | "browser"
  | "azure"
  | "deepl"
  | "libretranslate"
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama";

export const translationProviderChoices: readonly TranslationProviderChoice[] = [
  "browser",
  "azure",
  "deepl",
  "libretranslate",
  "openai",
  "anthropic",
  "gemini",
  "ollama",
];

/**
 * Los traductores que no pueden empezar sin clave en esta sesión. El del navegador y Ollama no
 * usan; en LibreTranslate es opcional, porque un servidor propio no la suele pedir.
 */
export function translationNeedsKey(provider: TranslationProviderChoice) {
  return provider !== "browser" && provider !== "ollama" && provider !== "libretranslate";
}

/**
 * Por qué el navegador no llegó a un servicio. Desde una web segura (https), el navegador
 * bloquea las peticiones a una dirección http que no sea el propio equipo (contenido mixto): un
 * LibreTranslate en la red de casa por http:// nunca responde, y conviene decirlo así.
 */
export function unreachableServiceMessage(service: string, endpoint: string, pageProtocol = globalThis.location?.protocol) {
  let url: URL | null = null;
  try {
    url = new URL(endpoint);
  } catch {
    url = null;
  }
  const loopback =
    url !== null && (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost"));
  if (pageProtocol === "https:" && url?.protocol === "http:" && !loopback) {
    return `El navegador no deja que esta web, que va por https, llame a ${service} en ${endpoint}. Ponlo tras https:// o en este mismo equipo (http://localhost).`;
  }
  return `No se pudo conectar con ${service} en ${endpoint}. Revisa la dirección, que el servidor esté en marcha y que permita esta web.`;
}

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
    free: "500.000 caracteres al mes",
    id: "deepl",
    label: "DeepL",
    pricing: { kind: "characters", perMillion: 25 },
    privacy: "Va a DeepL",
    quality: "Buena",
    speed: "1-2 s por página",
  },
  {
    free: "Si lo alojas tú",
    id: "libretranslate",
    label: "LibreTranslate",
    pricing: { kind: "free" },
    privacy: "Va a tu servidor",
    quality: "Básica",
    speed: "Según el servidor",
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
    model: "claude-haiku-5-5",
    pricing: { input: 0.1, kind: "tokens", output: 0.5 },
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

/** Coste estimado de traducir tantos caracteres con un traductor, en dólares; 0 si es gratis. */
export function translationCost(provider: TranslationProviderChoice, characters: number) {
  const option = translationOptions.find((item) => item.id === provider);
  return option ? costPerBook(option.pricing, characters) : 0;
}

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
