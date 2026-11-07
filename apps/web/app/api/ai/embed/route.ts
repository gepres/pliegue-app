import { adapterFor, UnsupportedOperationError } from "../../../ai/adapters";
import { apiKeyFrom, looksLikeApiKey, providerErrorResponse } from "../../../ai/hosted-json";

/**
 * Embeddings de fragmentos o de una pregunta (04.4), con la clave de la sesión. Solo OpenAI y
 * Gemini: Anthropic no los ofrece y Ollama se consulta desde el navegador. No escribe en la
 * consola: recibe textos de libros y claves.
 */

const embeddingProviders = ["gemini", "openai"] as const;
type EmbeddingProvider = (typeof embeddingProviders)[number];

export const maxEmbedTexts = 64;
export const maxEmbedTextCharacters = 8_000;
export const maxEmbedCharacters = 60_000;

interface EmbedRouteRequest {
  dimensions?: unknown;
  model?: unknown;
  provider?: unknown;
  purpose?: unknown;
  texts?: unknown;
}

function validTexts(texts: unknown): texts is string[] {
  if (!Array.isArray(texts) || !texts.length || texts.length > maxEmbedTexts) return false;
  let total = 0;
  for (const text of texts) {
    if (typeof text !== "string" || !text.trim() || text.length > maxEmbedTextCharacters) return false;
    total += text.length;
  }
  return total <= maxEmbedCharacters;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 256_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }

  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });
  if (!looksLikeApiKey(apiKey)) {
    return Response.json({ error: "La credencial recibida no tiene formato de API key." }, { status: 400 });
  }

  let body: EmbedRouteRequest;
  try {
    body = (await request.json()) as EmbedRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }

  if (!embeddingProviders.includes(body.provider as EmbeddingProvider)) {
    return Response.json({ error: "Este proveedor no calcula embeddings en esta ruta." }, { status: 400 });
  }
  const provider = body.provider as EmbeddingProvider;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const dimensions = body.dimensions === undefined || body.dimensions === null ? undefined : Number(body.dimensions);
  const purpose = body.purpose === "query" ? "query" : body.purpose === "document" || body.purpose === undefined ? "document" : null;
  const texts = body.texts;
  if (
    !model ||
    model.length > 120 ||
    !validTexts(texts) ||
    purpose === null ||
    (dimensions !== undefined && (!Number.isInteger(dimensions) || dimensions < 64 || dimensions > 3072))
  ) {
    return Response.json({ error: "Configuración o fragmentos no válidos." }, { status: 400 });
  }

  try {
    const result = await adapterFor({ apiKey, model, provider }).embed(
      { ...(dimensions ? { dimensions } : {}), purpose, texts },
      request.signal,
    );
    return Response.json({ dimensions: result.dimensions, model: result.model, usage: result.usage, vectors: result.vectors });
  } catch (error) {
    if (error instanceof UnsupportedOperationError) return Response.json({ error: error.message }, { status: 400 });
    return providerErrorResponse(error);
  }
}
