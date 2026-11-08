import type { HostedAiProvider } from "../../../ai/api-key";
import { cleanTasteList, createSuggestionsPrompt, suggestionsJsonSchema, suggestionsMaxOutputTokens, suggestionsSystemPrompt } from "../../../ai/book-suggestions";
import { apiKeyFrom, hostedProviders, looksLikeApiKey, providerErrorResponse, requestStructuredJson } from "../../../ai/hosted-json";

/**
 * «Afinar con IA» (06.1), con la clave de la sesión: recibe solo temas y nombres de autores (nunca
 * títulos de la biblioteca) y devuelve las sugerencias del modelo. Se comprueban en el navegador,
 * contra Open Library. No escribe en la consola.
 */

interface RecommendRouteRequest {
  authors?: unknown;
  model?: unknown;
  provider?: unknown;
  subjects?: unknown;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }
  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });
  if (!looksLikeApiKey(apiKey)) {
    return Response.json({ error: "La credencial recibida no tiene formato de API key." }, { status: 400 });
  }

  let body: RecommendRouteRequest;
  try {
    body = (await request.json()) as RecommendRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }
  if (!hostedProviders.includes(body.provider as HostedAiProvider)) {
    return Response.json({ error: "Proveedor no compatible en esta ruta." }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const subjects = cleanTasteList(body.subjects ?? [], 60);
  const authors = cleanTasteList(body.authors ?? [], 80);
  if (!model || model.length > 120 || !subjects || !authors || (!subjects.length && !authors.length)) {
    return Response.json({ error: "Gustos no válidos." }, { status: 400 });
  }

  try {
    const { json, usage } = await requestStructuredJson(
      {
        apiKey,
        maxOutputTokens: suggestionsMaxOutputTokens,
        model,
        provider: body.provider as HostedAiProvider,
        schema: suggestionsJsonSchema,
        schemaName: "pliegue_book_suggestions",
        system: suggestionsSystemPrompt,
        user: createSuggestionsPrompt({ authors, subjects }),
      },
      request.signal,
    );
    return Response.json({ result: json, usage });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
