import type { ProviderPlace } from "../library/sensitivity";
import { providerPlace } from "../library/sensitivity";
import { adapterFor } from "./adapters";
import { fetchWithRetry, type RetryWait } from "./ai-retry";
import type { AiSettings } from "./ai-settings";
import type { AiProvider, CatalogUsage } from "./document-catalog";

/**
 * Embeddings para la búsqueda por significado (04.4). Se calculan con el proveedor de catalogar,
 * con un modelo de embeddings fijo por proveedor:
 *
 * - OpenAI: `text-embedding-3-small`, recortado a 768 dimensiones.
 * - Gemini: `gemini-embedding-001`, recortado a 768 y distinguiendo fragmento y pregunta.
 * - Ollama: `embeddinggemma` (multilingüe, 768), desde el navegador, en el equipo de la persona.
 * - Anthropic no ofrece embeddings: la búsqueda va solo por palabras.
 *
 * Sale el texto entero del libro, en fragmentos: por eso indexar es un flujo con su propio
 * permiso (sensibilidad) y su propio registro.
 */

export const embeddingDimensions = 768;

export const embeddingModels: Record<AiProvider, string | null> = {
  anthropic: null,
  gemini: "gemini-embedding-001",
  ollama: "embeddinggemma",
  openai: "text-embedding-3-small",
};

export interface EmbeddingConfig {
  dimensions: number | null;
  model: string;
  place: ProviderPlace;
  provider: AiProvider;
}

/** Con qué se calculan los embeddings; null si el proveedor no los ofrece. */
export function embeddingConfigOf(settings: AiSettings): EmbeddingConfig | null {
  const model = embeddingModels[settings.provider];
  if (!model) return null;
  return {
    // Ollama da las del modelo: pedir otras no siempre se respeta.
    dimensions: settings.provider === "ollama" ? null : embeddingDimensions,
    model,
    place: providerPlace(settings.provider, settings),
    provider: settings.provider,
  };
}

/** La firma del modelo con el que se calculó un vector: si cambia, el vector no sirve. */
export function embeddingKey(config: Pick<EmbeddingConfig, "dimensions" | "model" | "provider">) {
  return `${config.provider}:${config.model}:${config.dimensions ?? "nativo"}`;
}

/** Unos 4 caracteres por token: para el presupuesto cuando el proveedor no lo dice. */
export function estimateTokens(characters: number) {
  return Math.ceil(characters / 4);
}

/** Cada petición: como mucho 64 fragmentos y 48.000 caracteres. */
export function embeddingBatches<Item extends { text: string }>(items: readonly Item[], maxItems = 64, maxCharacters = 48_000) {
  const batches: Item[][] = [];
  let current: Item[] = [];
  let characters = 0;
  for (const item of items) {
    if (current.length && (current.length >= maxItems || characters + item.text.length > maxCharacters)) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(item);
    characters += item.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export interface EmbeddingsResponse {
  usage: CatalogUsage;
  vectors: number[][];
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Pide los vectores de unos textos. OpenAI y Gemini, por la ruta de Pliegue con la clave de la
 * sesión (y reintentos ante un límite por minuto); Ollama, desde el navegador.
 */
export async function requestEmbeddings(
  config: EmbeddingConfig,
  settings: Pick<AiSettings, "ollamaUrl">,
  apiKey: string,
  texts: readonly string[],
  purpose: "document" | "query",
  options: { onWait?: (wait: RetryWait) => void; signal?: AbortSignal } = {},
): Promise<EmbeddingsResponse> {
  const dimensions = config.dimensions ?? undefined;
  if (config.provider === "ollama") {
    try {
      const result = await adapterFor({ baseUrl: settings.ollamaUrl, model: config.model, provider: "ollama" }).embed(
        { ...(dimensions ? { dimensions } : {}), purpose, texts },
        options.signal,
      );
      return { usage: result.usage, vectors: result.vectors };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof TypeError) {
        throw new Error(`No se pudo conectar con Ollama. Revisa que esté en marcha y que tenga el modelo «${config.model}» (ollama pull ${config.model}).`);
      }
      throw error;
    }
  }
  const response = await fetchWithRetry(
    "/api/ai/embed",
    {
      body: JSON.stringify({ dimensions, model: config.model, provider: config.provider, purpose, texts }),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST",
    },
    { ...(options.onWait ? { onWait: options.onWait } : {}), ...(options.signal ? { signal: options.signal } : {}) },
  );
  const payload = await readJson(response);
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "El proveedor no pudo calcular los embeddings.");
  const vectors = payload.vectors;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error("El proveedor no devolvió un vector por fragmento.");
  const usage = (payload.usage ?? {}) as Partial<CatalogUsage>;
  return {
    usage: { inputTokens: Number(usage.inputTokens) || 0, outputTokens: Number(usage.outputTokens) || 0 },
    vectors: vectors as number[][],
  };
}
