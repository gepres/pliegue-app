import type { TranslationPair } from "../library/translation";
import type { OpenTranslator, TranslationEngine } from "../library/translation-engine";
import { entriesForTexts, type GlossaryEntry } from "../library/translation-glossary";
import { translationProviderOf, type AiSettings } from "./ai-settings";
import { translationNeedsKey, unreachableServiceMessage, type TranslationProviderChoice } from "./translation-options";
import { classifyProviderFailure } from "./provider-error";
import {
  batchPassages,
  createTranslationPrompt,
  parseTranslations,
  TranslationCountError,
  translationJsonSchema,
  translationSystemPrompt,
} from "./translation-prompt";

/**
 * «Tu IA»: traducir con el proveedor y la clave que la persona ha elegido en Ajustes. OpenAI,
 * Anthropic, Gemini y Azure Translator van por la ruta de servidor de Pliegue; Ollama se
 * consulta desde el navegador, como al catalogar, y entonces el texto no sale del equipo. Si en
 * Ajustes sigue el traductor del navegador —el predeterminado—, «Tu IA» está sin elegir.
 *
 * A diferencia del traductor del navegador, funciona en cualquier navegador —también en el
 * móvil, Firefox y Safari— y con cualquier par de idiomas que entienda el modelo.
 */

export const translationProviderNames: Record<TranslationProviderChoice, string> = {
  anthropic: "Anthropic",
  azure: "Azure Translator",
  browser: "Chrome o Edge",
  deepl: "DeepL",
  gemini: "Gemini",
  libretranslate: "LibreTranslate",
  ollama: "Ollama",
  openai: "OpenAI",
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Los que traducen con un modelo de lenguaje: siguen instrucciones, como las del glosario. */
const languageModels: readonly TranslationProviderChoice[] = ["openai", "anthropic", "gemini", "ollama"];

type RequestBatch = (passages: readonly string[], signal?: AbortSignal, glossary?: readonly GlossaryEntry[]) => Promise<string[]>;

/** Los traductores que no son un LLM: no eligen modelo. */
const translatorServices: readonly TranslationProviderChoice[] = ["azure", "browser", "deepl", "libretranslate"];

/** El modelo con el que se traduce; los traductores (navegador, Azure, DeepL, LibreTranslate) no eligen modelo. */
function translationModelOf(settings: AiSettings, provider: TranslationProviderChoice) {
  return translatorServices.includes(provider) ? null : settings.translationModels[provider as AiSettings["provider"]];
}

function hostedRequest(settings: AiSettings, apiKey: string, pair: TranslationPair): RequestBatch {
  const provider = translationProviderOf(settings);
  const model = translationModelOf(settings, provider);
  const extra = provider === "azure" ? { region: settings.azureRegion } : { model };
  return async (passages, signal, glossary) => {
    const response = await fetch("/api/ai/translate", {
      body: JSON.stringify({
        ...extra,
        ...(glossary?.length ? { glossary } : {}),
        passages,
        provider,
        source: pair.source,
        target: pair.target,
      }),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    const payload = await readJson(response);
    if (response.status === 422 && payload.mismatch) {
      throw new TranslationCountError(passages.length, null);
    }
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "El proveedor no pudo traducir.");
    }
    return parseTranslations(payload, passages.length);
  };
}

/**
 * LibreTranslate se consulta desde el navegador, como Ollama, y no desde el servidor de
 * Pliegue: así sirve un LibreTranslate propio en el equipo o en la red de la persona, y el
 * servidor nunca pide una dirección que escribió alguien (05.5). Acepta un lote entero en `q`
 * y devuelve las traducciones en el mismo orden. La clave es opcional: un servidor propio no
 * suele pedirla; libretranslate.com, sí.
 */
function libreTranslateRequest(settings: AiSettings, apiKey: string, pair: TranslationPair): RequestBatch {
  const endpoint = `${settings.libreTranslateUrl.replace(/\/$/, "")}/translate`;
  return async (passages, signal) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        body: JSON.stringify({
          format: "text",
          q: passages,
          source: pair.source,
          target: pair.target,
          ...(apiKey ? { api_key: apiKey } : {}),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(unreachableServiceMessage("LibreTranslate", settings.libreTranslateUrl));
    }
    const payload = (await readJson(response)) as { error?: unknown; translatedText?: unknown };
    if (!response.ok) {
      throw new Error(classifyProviderFailure("libretranslate", response.status, payload, "").message);
    }
    const translated = Array.isArray(payload.translatedText) ? payload.translatedText : [payload.translatedText];
    if (translated.length !== passages.length || translated.some((text) => typeof text !== "string")) {
      throw new TranslationCountError(passages.length, null);
    }
    return translated as string[];
  };
}

function ollamaRequest(settings: AiSettings, pair: TranslationPair): RequestBatch {
  const model = settings.translationModels.ollama;
  const endpoint = `${settings.ollamaUrl.replace(/\/$/, "")}/api/chat`;
  return async (passages, signal, glossary) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        body: JSON.stringify({
          format: translationJsonSchema,
          messages: [
            { content: translationSystemPrompt(pair.source, pair.target, glossary), role: "system" },
            { content: createTranslationPrompt(passages), role: "user" },
          ],
          model,
          options: { temperature: 0.2 },
          stream: false,
          // Traducir no pide deliberar: con `qwen3:4b` pensando, un lote de tres párrafos pasaba
          // de cinco minutos; sin pensar, 2,8 s. Los modelos que no piensan lo aceptan igual.
          think: false,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "No se pudo conectar con Ollama. Revisa la URL, que el servicio esté activo y permita el origen de esta app.",
      );
    }
    const payload = (await readJson(response)) as { message?: { content?: string } };
    if (!response.ok) throw new Error(classifyProviderFailure("ollama", response.status, payload, model).message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.message?.content ?? "");
    } catch {
      throw new Error("Ollama no devolvió el JSON esperado.");
    }
    return parseTranslations(parsed, passages.length);
  };
}

/**
 * Pide un lote y, si el modelo se saltó o juntó pasajes, lo parte por la mitad y vuelve a
 * pedir cada parte: al final, en el peor caso, pasaje a pasaje.
 */
async function requestWithSplit(
  request: RequestBatch,
  passages: readonly string[],
  signal?: AbortSignal,
  glossary: readonly GlossaryEntry[] = [],
): Promise<string[]> {
  try {
    // A cada lote, solo los términos que aparecen en él: instrucciones cortas y al grano.
    return await request(passages, signal, entriesForTexts(passages, glossary));
  } catch (error) {
    if (!(error instanceof TranslationCountError) || passages.length <= 1) throw error;
    const middle = Math.ceil(passages.length / 2);
    const first = await requestWithSplit(request, passages.slice(0, middle), signal, glossary);
    const second = await requestWithSplit(request, passages.slice(middle), signal, glossary);
    return [...first, ...second];
  }
}

/** Traduce en lotes que respetan los límites de la ruta, sin cambiar el orden. */
export async function translateInBatches(
  request: RequestBatch,
  texts: readonly string[],
  signal?: AbortSignal,
  glossary: readonly GlossaryEntry[] = [],
) {
  const results = new Array<string>(texts.length);
  for (const batch of batchPassages(texts)) {
    signal?.throwIfAborted();
    const translated = await requestWithSplit(request, batch.map((index) => texts[index] ?? ""), signal, glossary);
    batch.forEach((index, position) => {
      results[index] = translated[position] ?? "";
    });
  }
  return results;
}

/** El motor «Tu IA» con los ajustes y la clave de esta sesión del proveedor que traduce. */
export function createAiTranslationEngine(settings: AiSettings, apiKey: string): TranslationEngine {
  const provider = translationProviderOf(settings);
  if (provider === "browser") {
    // Sin elegir: en Ajustes sigue el traductor del navegador. El panel lo dice y enlaza allí.
    return {
      availability: async () => "needs-provider",
      create: async () => {
        throw new Error("Elige en Ajustes con qué IA traducir.");
      },
      id: "ai:none",
      label: "Tu IA",
      onDevice: false,
    };
  }
  const model = translationModelOf(settings, provider);
  // Por el servidor de Pliegue y con clave obligatoria; Ollama y LibreTranslate, desde el navegador.
  const hosted = translationNeedsKey(provider);

  return {
    async availability(pair) {
      if (hosted && !apiKey) return "needs-key";
      return pair.source === pair.target ? "unavailable" : "available";
    },
    async create(pair) {
      if (hosted && !apiKey) throw new Error(`Falta la clave de ${translationProviderNames[provider]} en esta sesión.`);
      const request =
        provider === "ollama"
          ? ollamaRequest(settings, pair)
          : provider === "libretranslate"
            ? libreTranslateRequest(settings, apiKey, pair)
            : hostedRequest(settings, apiKey, pair);
      const translateMany: OpenTranslator["translateMany"] = (texts, signal, glossary) =>
        translateInBatches(request, texts, signal, glossary);
      return {
        destroy: () => {},
        // Las IA siguen instrucciones; DeepL, Azure y LibreTranslate reciben el término ya puesto.
        ...(languageModels.includes(provider) ? { glossary: "instructions" as const } : {}),
        translate: async (text, signal) => (await translateInBatches(request, [text], signal))[0] ?? text,
        translateMany,
      };
    },
    // Lo traducido con un modelo no vale para otro: cada uno guarda lo suyo.
    id: model ? `ai:${provider}:${model}` : `ai:${provider}`,
    label: model ? `${translationProviderNames[provider]} · ${model}` : translationProviderNames[provider],
    // En el equipo solo con Ollama: LibreTranslate puede estar en otro servidor.
    onDevice: provider === "ollama",
  };
}
