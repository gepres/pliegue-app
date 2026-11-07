import type { AiProvider, CatalogUsage } from "./document-catalog";
import { readCatalogUsage } from "./document-catalog";
import { ProviderFailureError, providerSignal, requestStructuredJsonWith } from "./hosted-json";
import { fallbackModelCapabilities, type ModelCapabilities } from "./model-capabilities";
import { classifyProviderFailure } from "./provider-error";

/**
 * La interfaz común de IA (04.2, decisión del dueño del 6-nov): un mismo contrato para los cuatro
 * proveedores y tres operaciones —JSON por esquema, describir una imagen y embeddings—, para que
 * la búsqueda semántica (04.4) o «describir figura» no tengan que saber con quién hablan.
 *
 * - Es isomorfa: recibe el `fetch`. Con clave (OpenAI, Anthropic, Gemini) se usa en las rutas de
 *   servidor, como catalogar y traducir; Ollama, desde el navegador, contra el equipo de la persona.
 * - Antes de llamar mira las capacidades del modelo (`model-capabilities.ts`): si consta que no
 *   puede, falla sin gastar nada; si no se sabe, lo intenta.
 * - Falla con los mismos errores que el resto (`ProviderFailureError`), así que los reintentos y
 *   los mensajes de «Por qué fallaron» funcionan igual.
 */

export type AiOperation = "embed" | "generateJson" | "describeImage";

export interface AdapterConfig {
  /** La clave del usuario: hace falta salvo con Ollama. */
  apiKey?: string;
  /** Dónde responde Ollama (`http://localhost:11434`). */
  baseUrl?: string;
  fetch?: typeof fetch;
  model: string;
  provider: AiProvider;
}

export interface JsonRequest {
  maxOutputTokens: number;
  schema: Record<string, unknown>;
  /** Nombre del esquema: OpenAI lo exige. */
  schemaName: string;
  system: string;
  timeoutMs?: number;
  user: string;
}

export interface ImageRequest {
  image: { bytes: Uint8Array; mimeType: string };
  instruction: string;
  maxOutputTokens: number;
  /** Con esquema, la respuesta es JSON (`json`); sin él, texto libre. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  timeoutMs?: number;
}

export interface EmbedRequest {
  /**
   * Dimensiones pedidas (04.4): OpenAI (`text-embedding-3-*`) y Gemini recortan el vector sin
   * perder mucho. Ollama devuelve las del modelo.
   */
  dimensions?: number;
  /** Para qué es el texto: Gemini calcula distinto un fragmento que se guarda y una pregunta. */
  purpose?: "document" | "query";
  texts: readonly string[];
  timeoutMs?: number;
}

export interface JsonResult {
  json: unknown;
  usage: CatalogUsage;
}

export interface ImageResult {
  json?: unknown;
  text: string;
  usage: CatalogUsage;
}

export interface EmbedResult {
  dimensions: number;
  model: string;
  usage: CatalogUsage;
  /** Un vector por texto, en el mismo orden. */
  vectors: number[][];
}

export interface AiAdapter {
  readonly model: string;
  readonly provider: AiProvider;
  describeImage(request: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
  embed(request: EmbedRequest, signal?: AbortSignal): Promise<EmbedResult>;
  generateJson(request: JsonRequest, signal?: AbortSignal): Promise<JsonResult>;
}

const providerNames: Record<AiProvider, string> = { anthropic: "Anthropic", gemini: "Gemini", ollama: "Ollama", openai: "OpenAI" };
const operationNames: Record<AiOperation, string> = {
  describeImage: "describir imágenes",
  embed: "calcular embeddings",
  generateJson: "devolver JSON por esquema",
};
const capabilityOf: Record<AiOperation, keyof Pick<ModelCapabilities, "embeddings" | "structuredOutput" | "vision">> = {
  describeImage: "vision",
  embed: "embeddings",
  generateJson: "structuredOutput",
};

/** El modelo (o el proveedor) no hace esa operación: se dice sin llamar a la red. */
export class UnsupportedOperationError extends Error {
  readonly operation: AiOperation;
  readonly provider: AiProvider;

  constructor(provider: AiProvider, model: string, operation: AiOperation, reason?: string) {
    super(reason ?? `El modelo «${model}» de ${providerNames[provider]} no puede ${operationNames[operation]}.`);
    this.name = "UnsupportedOperationError";
    this.operation = operation;
    this.provider = provider;
  }
}

/** Base64 sin `Buffer`, para que funcione igual en el navegador y en el servidor. */
export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function failIfNotOk(provider: AiProvider, model: string, response: Response, payload: unknown) {
  if (!response.ok) throw new ProviderFailureError(classifyProviderFailure(provider, response.status, payload, model, response.headers));
}

function parseJson(provider: AiProvider, text: string | undefined) {
  if (!text) throw new Error(`${providerNames[provider]} no devolvió contenido.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${providerNames[provider]} no devolvió el JSON esperado.`);
  }
}

function vectorsOf(value: unknown): number[][] | null {
  if (!Array.isArray(value)) return null;
  const vectors = value.filter((vector): vector is number[] => Array.isArray(vector) && vector.every((item) => typeof item === "number"));
  return vectors.length === value.length ? vectors : null;
}

export function adapterFor(config: AdapterConfig): AiAdapter {
  const { model, provider } = config;
  const fetchImpl = config.fetch ?? fetch;
  const apiKey = config.apiKey ?? "";
  const ollamaBase = (config.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");

  function ensure(operation: AiOperation) {
    if (operation === "embed" && provider === "anthropic") {
      throw new UnsupportedOperationError(provider, model, operation, "Anthropic no ofrece embeddings: usa OpenAI, Gemini u Ollama para la búsqueda semántica.");
    }
    if (fallbackModelCapabilities(provider, model)[capabilityOf[operation]] === false) {
      throw new UnsupportedOperationError(provider, model, operation);
    }
  }

  async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal) {
    const response = await fetchImpl(url, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
      signal: providerSignal(timeoutMs, signal),
    });
    const payload = await readPayload(response);
    failIfNotOk(provider, model, response, payload);
    return payload as Record<string, unknown>;
  }

  const anthropicHeaders = { "anthropic-version": "2023-06-01", "x-api-key": apiKey };
  const geminiHeaders = { "x-goog-api-key": apiKey };
  const openAiHeaders = { authorization: `Bearer ${apiKey}` };
  const geminiUrl = (method: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`;

  return {
    model,
    provider,

    async generateJson(request, signal) {
      ensure("generateJson");
      if (provider !== "ollama") {
        return requestStructuredJsonWith(fetchImpl, { ...request, apiKey, model, provider }, signal);
      }
      const payload = await post(
        `${ollamaBase}/api/chat`,
        {
          format: request.schema,
          messages: [
            { content: request.system, role: "system" },
            { content: request.user, role: "user" },
          ],
          model,
          options: { num_predict: request.maxOutputTokens },
          stream: false,
        },
        {},
        request.timeoutMs ?? 120_000,
        signal,
      );
      const message = payload.message as { content?: string } | undefined;
      return { json: parseJson(provider, message?.content), usage: readCatalogUsage(payload) };
    },

    async describeImage(request, signal) {
      ensure("describeImage");
      const data = toBase64(request.image.bytes);
      const timeoutMs = request.timeoutMs ?? 90_000;
      let text: string | undefined;
      let payload: Record<string, unknown>;

      if (provider === "openai") {
        payload = await post(
          "https://api.openai.com/v1/responses",
          {
            input: [
              {
                content: [
                  { text: request.instruction, type: "input_text" },
                  { image_url: `data:${request.image.mimeType};base64,${data}`, type: "input_image" },
                ],
                role: "user",
              },
            ],
            max_output_tokens: request.maxOutputTokens,
            model,
            store: false,
            ...(request.schema
              ? { text: { format: { name: request.schemaName ?? "respuesta", schema: request.schema, strict: true, type: "json_schema" } } }
              : {}),
          },
          openAiHeaders,
          timeoutMs,
          signal,
        );
        const output = payload.output as Array<{ content?: Array<{ text?: string; type?: string }> }> | undefined;
        text = (payload.output_text as string | undefined) ?? output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
      } else if (provider === "anthropic") {
        payload = await post(
          "https://api.anthropic.com/v1/messages",
          {
            max_tokens: request.maxOutputTokens,
            messages: [
              {
                content: [
                  { source: { data, media_type: request.image.mimeType, type: "base64" }, type: "image" },
                  { text: request.instruction, type: "text" },
                ],
                role: "user",
              },
            ],
            model,
            ...(request.schema ? { output_config: { format: { schema: request.schema, type: "json_schema" } } } : {}),
          },
          anthropicHeaders,
          timeoutMs,
          signal,
        );
        text = (payload.content as Array<{ text?: string; type?: string }> | undefined)?.find((item) => item.type === "text")?.text;
      } else if (provider === "gemini") {
        payload = await post(
          geminiUrl("generateContent"),
          {
            contents: [{ parts: [{ inlineData: { data, mimeType: request.image.mimeType } }, { text: request.instruction }], role: "user" }],
            generationConfig: {
              maxOutputTokens: request.maxOutputTokens,
              ...(request.schema ? { responseJsonSchema: request.schema, responseMimeType: "application/json" } : {}),
            },
          },
          geminiHeaders,
          timeoutMs,
          signal,
        );
        const candidates = payload.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> | undefined;
        text = (candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("") || undefined;
      } else {
        payload = await post(
          `${ollamaBase}/api/chat`,
          {
            ...(request.schema ? { format: request.schema } : {}),
            messages: [{ content: request.instruction, images: [data], role: "user" }],
            model,
            options: { num_predict: request.maxOutputTokens },
            stream: false,
          },
          {},
          request.timeoutMs ?? 180_000,
          signal,
        );
        text = (payload.message as { content?: string } | undefined)?.content;
      }

      if (!text) throw new Error(`${providerNames[provider]} no devolvió contenido.`);
      return { ...(request.schema ? { json: parseJson(provider, text) } : {}), text, usage: readCatalogUsage(payload) };
    },

    async embed(request, signal) {
      ensure("embed");
      const texts = [...request.texts];
      if (!texts.length) return { dimensions: 0, model, usage: { inputTokens: 0, outputTokens: 0 }, vectors: [] };
      const timeoutMs = request.timeoutMs ?? 60_000;
      let vectors: number[][] | null = null;
      let payload: Record<string, unknown>;

      if (provider === "openai") {
        const dimensions = request.dimensions && /^text-embedding-3-/.test(model) ? { dimensions: request.dimensions } : {};
        payload = await post("https://api.openai.com/v1/embeddings", { input: texts, model, ...dimensions }, openAiHeaders, timeoutMs, signal);
        const data = payload.data as Array<{ embedding?: unknown; index?: number }> | undefined;
        const ordered = [...(data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
        vectors = vectorsOf(ordered.map((item) => item.embedding));
      } else if (provider === "gemini") {
        payload = await post(
          geminiUrl("batchEmbedContents"),
          {
            requests: texts.map((text) => ({
              content: { parts: [{ text }] },
              model: `models/${model}`,
              ...(request.dimensions ? { outputDimensionality: request.dimensions } : {}),
              ...(request.purpose ? { taskType: request.purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" } : {}),
            })),
          },
          geminiHeaders,
          timeoutMs,
          signal,
        );
        vectors = vectorsOf((payload.embeddings as Array<{ values?: unknown }> | undefined)?.map((item) => item.values));
      } else {
        payload = await post(`${ollamaBase}/api/embed`, { input: texts, model }, {}, request.timeoutMs ?? 120_000, signal);
        vectors = vectorsOf(payload.embeddings);
      }

      if (!vectors || vectors.length !== texts.length) throw new Error(`${providerNames[provider]} no devolvió un vector por texto.`);
      return { dimensions: vectors[0]?.length ?? 0, model, usage: readCatalogUsage(payload), vectors };
    },
  };
}
