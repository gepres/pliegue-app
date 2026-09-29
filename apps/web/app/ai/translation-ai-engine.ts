import type { TranslationPair } from "../library/translation";
import type { OpenTranslator, TranslationEngine } from "../library/translation-engine";
import { translationProviderOf, type AiSettings } from "./ai-settings";
import type { TranslationProviderChoice } from "./translation-options";
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
  gemini: "Gemini",
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

type RequestBatch = (passages: readonly string[], signal?: AbortSignal) => Promise<string[]>;

/** El modelo con el que se traduce; Azure Translator y el navegador no eligen modelo. */
function translationModelOf(settings: AiSettings, provider: TranslationProviderChoice) {
  return provider === "azure" || provider === "browser" ? null : settings.translationModels[provider];
}

function hostedRequest(settings: AiSettings, apiKey: string, pair: TranslationPair): RequestBatch {
  const provider = translationProviderOf(settings);
  const model = translationModelOf(settings, provider);
  const extra = provider === "azure" ? { region: settings.azureRegion } : { model };
  return async (passages, signal) => {
    const response = await fetch("/api/ai/translate", {
      body: JSON.stringify({ ...extra, passages, provider, source: pair.source, target: pair.target }),
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

function ollamaRequest(settings: AiSettings, pair: TranslationPair): RequestBatch {
  const model = settings.translationModels.ollama;
  const endpoint = `${settings.ollamaUrl.replace(/\/$/, "")}/api/chat`;
  return async (passages, signal) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        body: JSON.stringify({
          format: translationJsonSchema,
          messages: [
            { content: translationSystemPrompt(pair.source, pair.target), role: "system" },
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
async function requestWithSplit(request: RequestBatch, passages: readonly string[], signal?: AbortSignal): Promise<string[]> {
  try {
    return await request(passages, signal);
  } catch (error) {
    if (!(error instanceof TranslationCountError) || passages.length <= 1) throw error;
    const middle = Math.ceil(passages.length / 2);
    const first = await requestWithSplit(request, passages.slice(0, middle), signal);
    const second = await requestWithSplit(request, passages.slice(middle), signal);
    return [...first, ...second];
  }
}

/** Traduce en lotes que respetan los límites de la ruta, sin cambiar el orden. */
export async function translateInBatches(request: RequestBatch, texts: readonly string[], signal?: AbortSignal) {
  const results = new Array<string>(texts.length);
  for (const batch of batchPassages(texts)) {
    signal?.throwIfAborted();
    const translated = await requestWithSplit(request, batch.map((index) => texts[index] ?? ""), signal);
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
  const hosted = provider !== "ollama";

  return {
    async availability(pair) {
      if (hosted && !apiKey) return "needs-key";
      return pair.source === pair.target ? "unavailable" : "available";
    },
    async create(pair) {
      if (hosted && !apiKey) throw new Error(`Falta la clave de ${translationProviderNames[provider]} en esta sesión.`);
      const request = hosted ? hostedRequest(settings, apiKey, pair) : ollamaRequest(settings, pair);
      const translateMany: OpenTranslator["translateMany"] = (texts, signal) => translateInBatches(request, texts, signal);
      return {
        destroy: () => {},
        translate: async (text, signal) => (await translateInBatches(request, [text], signal))[0] ?? text,
        translateMany,
      };
    },
    // Lo traducido con un modelo no vale para otro: cada uno guarda lo suyo.
    id: model ? `ai:${provider}:${model}` : `ai:${provider}`,
    label: model ? `${translationProviderNames[provider]} · ${model}` : translationProviderNames[provider],
    onDevice: !hosted,
  };
}
