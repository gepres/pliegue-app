import type { AiProvider } from "./document-catalog";

export type CapabilitySupport = boolean | "desconocido";

export interface ModelCapabilities {
  structuredOutput: CapabilitySupport;
  vision: CapabilitySupport;
  embeddings: CapabilitySupport;
  contextTokens?: number;
  maxOutputTokens?: number;
}

interface ModelFamily {
  pattern: RegExp;
  capabilities: ModelCapabilities;
}

const unknownCapabilities: ModelCapabilities = {
  structuredOutput: "desconocido",
  vision: "desconocido",
  embeddings: "desconocido",
};

const textModel: ModelCapabilities = { structuredOutput: true, vision: false, embeddings: false };
const visionModel: ModelCapabilities = { ...textModel, vision: true };
const embeddingModel: ModelCapabilities = { structuredOutput: false, vision: false, embeddings: true };

/**
 * Reserva sin red, por proveedor y con las excepciones antes que las familias generales.
 * Salida estructurada significa admitir el esquema JSON que usa Pliegue, no solo poder escribir JSON.
 * Los límites varían entre versiones y tamaños: solo se fijan los que se conocen con seguridad.
 * Referencias para revisar la tabla:
 * https://developers.openai.com/api/docs/models/gpt-4o
 * https://developers.openai.com/api/docs/models/gpt-4.1
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 * https://ai.google.dev/gemini-api/docs/structured-output
 * https://docs.ollama.com/capabilities/structured-outputs
 */
const modelFamilies: Record<AiProvider, readonly ModelFamily[]> = {
  openai: [
    { pattern: /^text-embedding-(?:3-(?:small|large)|ada-002)$/, capabilities: embeddingModel },
    { pattern: /^gpt-4o-2024-05-13$/, capabilities: { ...visionModel, structuredOutput: false, contextTokens: 128_000 } },
    { pattern: /^gpt-4o(?:-mini)?(?:-\d{4}-\d{2}-\d{2})?$/, capabilities: { ...visionModel, contextTokens: 128_000 } },
    {
      pattern: /^gpt-4\.1(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/,
      capabilities: { ...visionModel, contextTokens: 1_047_576, maxOutputTokens: 32_768 },
    },
    { pattern: /^gpt-[56](?:\.\d+)?(?:-mini|-nano|-luna|-sol|-astra)?(?:-\d{4}-\d{2}-\d{2})?$/, capabilities: visionModel },
    { pattern: /^o1-(?:mini|preview)(?:-\d{4}-\d{2}-\d{2})?$/, capabilities: { ...textModel, structuredOutput: false } },
    { pattern: /^o3-mini(?:-\d{4}-\d{2}-\d{2})?$/, capabilities: textModel },
    { pattern: /^(?:o1|o3|o4-mini)(?:-\d{4}-\d{2}-\d{2})?$/, capabilities: visionModel },
  ],
  anthropic: [
    { pattern: /^claude-(?:sonnet|haiku|opus)-[45](?:-|$)/, capabilities: visionModel },
    { pattern: /^claude-3(?:-|$)/, capabilities: { ...visionModel, structuredOutput: "desconocido" } },
    { pattern: /^claude-/, capabilities: { ...unknownCapabilities, embeddings: false } },
  ],
  gemini: [
    { pattern: /^(?:gemini-embedding-001|text-embedding-004|embedding-001)$/, capabilities: embeddingModel },
    { pattern: /^gemini-embedding-/, capabilities: { ...embeddingModel, vision: "desconocido" } },
    {
      pattern: /^gemini-(?:1\.5|2\.0|2\.5|3|3\.1|3\.5)-(?:pro|flash)(?:-lite)?(?:-latest|-\d{3}|-preview(?:-\d{2}-\d{2})?)?$/,
      capabilities: visionModel,
    },
  ],
  ollama: [
    { pattern: /^(?:nomic-embed-text|mxbai-embed-large|qwen3-embedding|embeddinggemma)(?::|$)/, capabilities: embeddingModel },
    { pattern: /^qwen3-vl(?::|$)/, capabilities: visionModel },
    { pattern: /^qwen3(?:-coder|-next)?(?::|$)/, capabilities: textModel },
    { pattern: /^llama3\.2-vision(?::|$)|^llama3\.2:(?:11b|90b)(?:\b|_)/, capabilities: visionModel },
    { pattern: /^llama3(?:\.[123])?(?::|$)/, capabilities: textModel },
    { pattern: /^llava(?:-llama3|:|$)/, capabilities: visionModel },
  ],
};

export function fallbackModelCapabilities(provider: AiProvider, model: string): ModelCapabilities {
  // Gemini devuelve «models/…»; Ollama permite un espacio de nombres antes del nombre.
  const normalized = model.trim().toLowerCase();
  const name = provider === "gemini" ? normalized.replace(/^models\//, "")
    : provider === "ollama" ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
  return { ...(modelFamilies[provider].find((family) => family.pattern.test(name))?.capabilities ?? unknownCapabilities) };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function tokenLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function limits(context: unknown, output?: unknown): Partial<ModelCapabilities> {
  const contextTokens = tokenLimit(context);
  const maxOutputTokens = tokenLimit(output);
  return {
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  };
}

/** Valida también las capacidades serializadas que llegan desde la ruta de Pliegue. */
export function parseModelCapabilities(payload: unknown): Partial<ModelCapabilities> {
  const record = recordOf(payload);
  const result = limits(record.contextTokens, record.maxOutputTokens);
  for (const key of ["structuredOutput", "vision", "embeddings"] as const) {
    const value = record[key];
    if (typeof value === "boolean" || value === "desconocido") result[key] = value;
  }
  return result;
}

function generationMethods(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((method) => typeof method === "string") ? value : undefined;
}

function geminiCapabilities(payload: Record<string, unknown>): Partial<ModelCapabilities> {
  const methods = generationMethods(payload.supportedGenerationMethods);
  return {
    ...limits(payload.inputTokenLimit, payload.outputTokenLimit),
    ...(methods ? {
      embeddings: methods.includes("embedContent") || methods.includes("embedText"),
      // generateContent no garantiza JSON; su ausencia sí impide usarlo para estos flujos.
      ...(!methods.includes("generateContent") ? { structuredOutput: false } : {}),
    } : {}),
  };
}

function anthropicCapabilities(payload: Record<string, unknown>): Partial<ModelCapabilities> {
  const capabilities = recordOf(payload.capabilities);
  const structuredOutput = recordOf(capabilities.structured_outputs).supported;
  const vision = recordOf(capabilities.image_input).supported;
  return {
    ...limits(payload.max_input_tokens, payload.max_tokens),
    ...(typeof structuredOutput === "boolean" ? { structuredOutput } : {}),
    ...(typeof vision === "boolean" ? { vision } : {}),
  };
}

function ollamaCapabilities(payload: Record<string, unknown>): Partial<ModelCapabilities> {
  const capabilities = generationMethods(payload.capabilities);
  const info = recordOf(payload.model_info);
  const architecture = typeof info["general.architecture"] === "string" ? info["general.architecture"] : "";
  const context = tokenLimit(info[`${architecture}.context_length`]) ?? Object.entries(info)
    .filter(([key]) => key.endsWith(".context_length"))
    .map(([, value]) => tokenLimit(value))
    .find((value) => value !== undefined);
  return {
    ...limits(context),
    ...(capabilities ? {
      // Ollama aplica el esquema con `format` a los modelos de generación; no exige herramientas.
      structuredOutput: capabilities.includes("completion"),
      vision: capabilities.includes("vision"),
      embeddings: capabilities.includes("embedding"),
    } : {}),
  };
}

/** La ficha manda sobre la reserva, incluidos los «false» explícitos; OpenAI solo usa la tabla. */
export function resolveModelCapabilities(provider: AiProvider, model: string, payload?: unknown): ModelCapabilities {
  const record = recordOf(payload);
  const detected = provider === "gemini" ? geminiCapabilities(record)
    : provider === "anthropic" ? anthropicCapabilities(record)
    : provider === "ollama" ? ollamaCapabilities(record) : {};
  return { ...fallbackModelCapabilities(provider, model), ...detected };
}
