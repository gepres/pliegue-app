import { aiProviders, type AiProvider } from "./document-catalog";
import { translationProviderChoices, type TranslationProviderChoice } from "./translation-options";

/** Peticiones simultáneas al proveedor durante un análisis por lotes. */
export const maxCatalogConcurrency = 6;

export interface AiSettings {
  autoAnalyzeAfterLink: boolean;
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
  ollamaMode: "local" | "remote";
  ollamaUrl: string;
  provider: AiProvider;
  schemaVersion: 1;
}

/**
 * Modelos de partida, verificados contra la documentación de cada proveedor el 14 de agosto
 * de 2026. Catalogar es una tarea de mucha entrada y poca deliberación —un extracto por
 * documento, una ficha de vuelta—, así que en cada proveedor se elige su gama de trabajo
 * y no la más capaz.
 *
 * - `gpt-5.6-luna` es el modelo que OpenAI destina a volumen alto y coste contenido.
 * - `claude-sonnet-5` sustituye a `claude-sonnet-4-6`, que seguía activo pero era de la
 *   generación anterior.
 * - `gemini-3.5-flash-lite` es el que Google recomienda para proyectos nuevos de alto volumen
 *   (29-sep-2026): la gama 2.5 ya solo la usan quienes la tenían. Tiene nivel gratuito.
 * - `qwen3:8b` está en la biblioteca de Ollama y admite salida estructurada por esquema, que
 *   es lo que exige el contrato de ficha. Ojo: eso vale para la instalación local; Ollama
 *   Cloud todavía no la admite.
 *
 * Al revisarlos, confirma el identificador en la documentación vigente del proveedor —cambian
 * al publicar generaciones nuevas— y recuerda que un identificador retirado falla en la primera
 * llamada; `provider-error.ts` se encarga de que ese fallo no se confunda con una clave inválida.
 */
export const defaultAiSettings: AiSettings = {
  autoAnalyzeAfterLink: false,
  concurrency: 2,
  maxExcerptCharacters: 12_000,
  models: {
    anthropic: "claude-sonnet-5",
    gemini: "gemini-3.5-flash-lite",
    ollama: "qwen3:8b",
    openai: "gpt-5.6-luna",
  },
  ollamaMode: "local",
  ollamaUrl: "http://localhost:11434",
  provider: "openai",
  schemaVersion: 1,
  // Los de menor coste de cada proveedor, revisados el 29-sep-2026: con ellos un libro entero
  // sale por céntimos (OpenAI, Gemini) o por un dólar (Claude Haiku).
  azureRegion: "",
  translationProvider: "browser",
  translationModels: {
    anthropic: "claude-haiku-4-5",
    gemini: "gemini-3.5-flash-lite",
    ollama: "qwen3:8b",
    openai: "gpt-6-luna",
  },
};

function cleanModel(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;
}

export function normalizeOllamaUrl(value: unknown, mode: AiSettings["ollamaMode"]) {
  if (mode === "local") return defaultAiSettings.ollamaUrl;
  if (typeof value !== "string") return defaultAiSettings.ollamaUrl;

  try {
    const url = new URL(value.trim());
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
      return defaultAiSettings.ollamaUrl;
    }
    if (url.username || url.password) return defaultAiSettings.ollamaUrl;
    return url.toString().replace(/\/$/, "");
  } catch {
    return defaultAiSettings.ollamaUrl;
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
    concurrency:
      typeof candidate.concurrency === "number"
        ? Math.min(maxCatalogConcurrency, Math.max(1, Math.round(candidate.concurrency)))
        : defaultAiSettings.concurrency,
    maxExcerptCharacters:
      typeof candidate.maxExcerptCharacters === "number"
        ? Math.min(24_000, Math.max(4_000, Math.round(candidate.maxExcerptCharacters)))
        : defaultAiSettings.maxExcerptCharacters,
    models: {
      anthropic: cleanModel(models.anthropic, defaultAiSettings.models.anthropic),
      gemini: cleanModel(models.gemini, defaultAiSettings.models.gemini),
      ollama: cleanModel(models.ollama, defaultAiSettings.models.ollama),
      openai: cleanModel(models.openai, defaultAiSettings.models.openai),
    },
    ollamaMode,
    ollamaUrl: normalizeOllamaUrl(candidate.ollamaUrl, ollamaMode),
    provider,
    schemaVersion: 1,
    azureRegion: normalizeAzureRegion(candidate.azureRegion),
    translationProvider: translationProviderChoices.includes(candidate.translationProvider as TranslationProviderChoice)
      ? (candidate.translationProvider as TranslationProviderChoice)
      : "browser",
    translationModels: {
      anthropic: cleanModel(translationModels.anthropic, defaultAiSettings.translationModels.anthropic),
      gemini: cleanModel(translationModels.gemini, defaultAiSettings.translationModels.gemini),
      ollama: cleanModel(translationModels.ollama, defaultAiSettings.translationModels.ollama),
      openai: cleanModel(translationModels.openai, defaultAiSettings.translationModels.openai),
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
