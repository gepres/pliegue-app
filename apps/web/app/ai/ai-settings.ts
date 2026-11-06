import { defaultAiBudget, parseAiBudget, type AiBudget } from "./ai-budget";
import { aiProviders, type AiProvider } from "./document-catalog";
import { translationProviderChoices, type TranslationProviderChoice } from "./translation-options";

/** Peticiones simultáneas al proveedor durante un análisis por lotes. */
export const maxCatalogConcurrency = 6;

export interface AiSettings {
  autoAnalyzeAfterLink: boolean;
  /** Límites del mes y tabla de precios (04.6). Viajan con los ajustes a los otros equipos. */
  budget: AiBudget;
  concurrency: number;
  maxExcerptCharacters: number;
  models: Record<AiProvider, string>;
  /**
   * El modelo con el que se traduce un libro con «Tu IA». Aparte del de catalogar: traducir es
   * mucho texto de salida y poca deliberación, así que conviene la gama más barata.
   */
  translationModels: Record<AiProvider, string>;
  /**
   * Con qué se traducen los libros. Por defecto, el traductor del navegador: gratis y sin que
   * el texto salga del equipo. Una IA —o Azure Translator— es opción de cada persona, y puede
   * ser otra que la de catalogar: por ejemplo, Claude para catalogar y Gemini para traducir.
   */
  translationProvider: TranslationProviderChoice;
  /** Región del recurso de Azure Translator («westeurope»); vacía si es global. */
  azureRegion: string;
  /**
   * Dónde está el LibreTranslate con el que se traduce: el de la persona (en su equipo o en su
   * servidor) o libretranslate.com. Se le pregunta desde el navegador, como a Ollama.
   */
  libreTranslateUrl: string;
  ollamaMode: "local" | "remote";
  ollamaUrl: string;
  provider: AiProvider;
  schemaVersion: 1;
}

/**
 * Modelos de partida, los más baratos de cada proveedor para catalogar y traducir (04.2b,
 * decisión del dueño del 6-nov-2026). Precios e índice de calidad verificados ese día en
 * Artificial Analysis (artificialanalysis.ai), en dólares por millón de tokens:
 *
 * - `gpt-6-luna`: 0,10 / 0,50 (índice 28). Sustituye a `gpt-5.6-luna` (0,20 / 1,20, índice 24),
 *   que la propia página da por obsoleto.
 * - `claude-haiku-5-5`: 0,10 / 0,50 (índice 36). Sustituye a `claude-sonnet-5` al catalogar
 *   (2 / 10) y a `claude-haiku-4-5` al traducir (1 / 5): para una ficha de un extracto o para
 *   traducir basta, y cuesta de 10 a 20 veces menos.
 * - `gemini-3.5-flash-lite`: 0,30 / 2,50 (índice 12). El Flash-Lite más reciente; tiene nivel
 *   gratuito en AI Studio.
 * - `qwen3:8b`: en el equipo y gratis. Admite salida estructurada por esquema, que es lo que
 *   exige el contrato de ficha (en la instalación local; Ollama Cloud todavía no). Pesa unos
 *   5 GB: va bien con 16 GB de memoria.
 *
 * Al revisarlos, confirma el identificador en la documentación vigente del proveedor —cambian
 * al publicar generaciones nuevas— y recuerda que un identificador retirado falla en la primera
 * llamada; `provider-error.ts` se encarga de que ese fallo no se confunda con una clave inválida.
 */
export const defaultAiSettings: AiSettings = {
  autoAnalyzeAfterLink: false,
  budget: defaultAiBudget,
  concurrency: 2,
  maxExcerptCharacters: 12_000,
  models: {
    anthropic: "claude-haiku-5-5",
    gemini: "gemini-3.5-flash-lite",
    ollama: "qwen3:8b",
    openai: "gpt-6-luna",
  },
  ollamaMode: "local",
  ollamaUrl: "http://localhost:11434",
  provider: "openai",
  schemaVersion: 1,
  // Los de menor coste de cada proveedor (6-nov-2026): con ellos un libro entero sale por
  // céntimos.
  azureRegion: "",
  libreTranslateUrl: "https://libretranslate.com",
  translationProvider: "browser",
  translationModels: {
    anthropic: "claude-haiku-5-5",
    gemini: "gemini-3.5-flash-lite",
    ollama: "qwen3:8b",
    openai: "gpt-6-luna",
  },
};

/**
 * Modelos de partida anteriores. Quien sigue con uno de ellos no lo eligió: era el que venía.
 * Se cambia por el de partida de ahora; quien eligió otro a mano lo conserva (04.2b).
 */
export const legacyDefaultModels: {
  models: Partial<Record<AiProvider, readonly string[]>>;
  translationModels: Partial<Record<AiProvider, readonly string[]>>;
} = {
  models: { anthropic: ["claude-sonnet-5"], openai: ["gpt-5.6-luna"] },
  translationModels: { anthropic: ["claude-haiku-4-5"] },
};

/** Lo que `parseAiSettings` cambiaría de lo guardado: «antes → ahora», para avisar una vez. */
export function legacyModelChanges(value: unknown) {
  const changes: Array<{ from: string; kind: "models" | "translationModels"; provider: AiProvider; to: string }> = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return changes;
  const candidate = value as Record<string, unknown>;
  for (const kind of ["models", "translationModels"] as const) {
    const stored = candidate[kind];
    if (!stored || typeof stored !== "object") continue;
    for (const provider of aiProviders) {
      const model = (stored as Record<string, unknown>)[provider];
      if (typeof model === "string" && legacyDefaultModels[kind][provider]?.includes(model.trim())) {
        changes.push({ from: model.trim(), kind, provider, to: defaultAiSettings[kind][provider] });
      }
    }
  }
  return changes;
}

function cleanModel(value: unknown, fallback: string, legacy: readonly string[] = []) {
  const model = typeof value === "string" ? value.trim().slice(0, 120) : "";
  // Un modelo de partida antiguo pasa al de ahora (04.2b).
  return model && !legacy.includes(model) ? model : fallback;
}

export function normalizeOllamaUrl(value: unknown, mode: AiSettings["ollamaMode"]) {
  if (mode === "local") return defaultAiSettings.ollamaUrl;
  return normalizeServiceUrl(value, defaultAiSettings.ollamaUrl);
}

/** Una dirección http(s) sin credenciales y sin barra final; si no lo es, la de partida. */
export function normalizeServiceUrl(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;

  try {
    const url = new URL(value.trim());
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) return fallback;
    if (url.username || url.password) return fallback;
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function parseAiSettings(value: unknown): AiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultAiSettings;
  const candidate = value as Record<string, unknown>;
  const recordOf = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const models = recordOf(candidate.models);
  const translationModels = recordOf(candidate.translationModels);
  const provider = aiProviders.includes(candidate.provider as AiProvider)
    ? (candidate.provider as AiProvider)
    : defaultAiSettings.provider;
  const ollamaMode = candidate.ollamaMode === "remote" ? "remote" : "local";

  return {
    autoAnalyzeAfterLink: candidate.autoAnalyzeAfterLink === true,
    budget: parseAiBudget(candidate.budget),
    concurrency:
      typeof candidate.concurrency === "number"
        ? Math.min(maxCatalogConcurrency, Math.max(1, Math.round(candidate.concurrency)))
        : defaultAiSettings.concurrency,
    maxExcerptCharacters:
      typeof candidate.maxExcerptCharacters === "number"
        ? Math.min(24_000, Math.max(4_000, Math.round(candidate.maxExcerptCharacters)))
        : defaultAiSettings.maxExcerptCharacters,
    models: {
      anthropic: cleanModel(models.anthropic, defaultAiSettings.models.anthropic, legacyDefaultModels.models.anthropic),
      gemini: cleanModel(models.gemini, defaultAiSettings.models.gemini, legacyDefaultModels.models.gemini),
      ollama: cleanModel(models.ollama, defaultAiSettings.models.ollama, legacyDefaultModels.models.ollama),
      openai: cleanModel(models.openai, defaultAiSettings.models.openai, legacyDefaultModels.models.openai),
    },
    ollamaMode,
    ollamaUrl: normalizeOllamaUrl(candidate.ollamaUrl, ollamaMode),
    provider,
    schemaVersion: 1,
    azureRegion: normalizeAzureRegion(candidate.azureRegion),
    libreTranslateUrl: normalizeServiceUrl(candidate.libreTranslateUrl, defaultAiSettings.libreTranslateUrl),
    translationProvider: translationProviderChoices.includes(candidate.translationProvider as TranslationProviderChoice)
      ? (candidate.translationProvider as TranslationProviderChoice)
      : "browser",
    translationModels: {
      anthropic: cleanModel(
        translationModels.anthropic,
        defaultAiSettings.translationModels.anthropic,
        legacyDefaultModels.translationModels.anthropic,
      ),
      gemini: cleanModel(
        translationModels.gemini,
        defaultAiSettings.translationModels.gemini,
        legacyDefaultModels.translationModels.gemini,
      ),
      ollama: cleanModel(
        translationModels.ollama,
        defaultAiSettings.translationModels.ollama,
        legacyDefaultModels.translationModels.ollama,
      ),
      openai: cleanModel(
        translationModels.openai,
        defaultAiSettings.translationModels.openai,
        legacyDefaultModels.translationModels.openai,
      ),
    },
  };
}

/** Con qué se traduce: el traductor del navegador o el proveedor que se eligió. */
export function translationProviderOf(settings: AiSettings): TranslationProviderChoice {
  return settings.translationProvider;
}

/** Una región de Azure es una palabra en minúsculas y cifras («westeurope», «eastus2»). */
export function normalizeAzureRegion(value: unknown) {
  if (typeof value !== "string") return "";
  const region = value.trim().toLowerCase();
  return /^[a-z0-9]{1,40}$/.test(region) ? region : "";
}

export function providerModel(settings: AiSettings) {
  return settings.models[settings.provider];
}
