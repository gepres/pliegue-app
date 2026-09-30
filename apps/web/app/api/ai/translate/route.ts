import type { KeyProvider } from "../../../ai/api-key";
import { normalizeAzureRegion } from "../../../ai/ai-settings";
import {
  apiKeyFrom,
  hostedProviders,
  looksLikeApiKey,
  ProviderFailureError,
  providerErrorResponse,
  requestStructuredJson,
} from "../../../ai/hosted-json";
import { classifyProviderFailure } from "../../../ai/provider-error";
import {
  createTranslationPrompt,
  isLanguageCode,
  parseTranslations,
  translationJsonSchema,
  translationMaxOutputTokens,
  translationSystemPrompt,
  validPassages,
} from "../../../ai/translation-prompt";

/**
 * Traduce un lote de pasajes de un libro con el proveedor y la clave del usuario («Tu IA»). La
 * clave viaja en la cabecera y no se guarda; el texto tampoco.
 *
 * Los LLM reciben el lote con instrucciones y devuelven un JSON por esquema; Azure Translator es
 * traducción automática clásica: recibe los textos tal cual y devuelve uno por texto.
 */

interface TranslateRouteRequest {
  model?: string;
  passages?: unknown;
  provider?: KeyProvider;
  region?: unknown;
  source?: unknown;
  target?: unknown;
}

const translateProviders: readonly KeyProvider[] = [...hostedProviders, "azure"];

/** Azure nombra el chino por su escritura: el simplificado es «zh-Hans». */
function azureLanguage(code: string) {
  return code === "zh" ? "zh-Hans" : code;
}

async function callAzure(apiKey: string, region: string, source: string, target: string, passages: readonly string[]) {
  const url = new URL("https://api.cognitive.microsofttranslator.com/translate");
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("from", azureLanguage(source));
  url.searchParams.set("to", azureLanguage(target));
  const response = await fetch(url, {
    body: JSON.stringify(passages.map((text) => ({ text }))),
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "ocp-apim-subscription-key": apiKey,
      // Un recurso regional o multiservicio exige su región; uno global, no.
      ...(region ? { "ocp-apim-subscription-region": region } : {}),
    },
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });
  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new ProviderFailureError(classifyProviderFailure("azure", response.status, payload, ""));
  const results = Array.isArray(payload) ? (payload as { translations?: { text?: unknown }[] }[]) : [];
  return results.map((result) => {
    const text = result.translations?.[0]?.text;
    return typeof text === "string" ? text : "";
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 64_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }

  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });
  if (!looksLikeApiKey(apiKey)) {
    return Response.json({ error: "La credencial recibida no tiene formato de API key." }, { status: 400 });
  }

  let body: TranslateRouteRequest;
  try {
    body = (await request.json()) as TranslateRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }

  const model = body.model?.trim() ?? "";
  if (!body.provider || !translateProviders.includes(body.provider)) {
    return Response.json({ error: "Proveedor no compatible en esta ruta." }, { status: 400 });
  }
  const needsModel = body.provider !== "azure";
  if ((needsModel && (!model || model.length > 120)) || !isLanguageCode(body.source) || !isLanguageCode(body.target)) {
    return Response.json({ error: "Modelo o idiomas no válidos." }, { status: 400 });
  }
  if (!validPassages(body.passages)) {
    return Response.json({ error: "Los pasajes no son válidos o superan el límite del lote." }, { status: 400 });
  }

  const passages = body.passages;
  const characters = passages.reduce((sum, passage) => sum + passage.length, 0);

  if (body.provider === "azure") {
    try {
      const translations = await callAzure(apiKey, normalizeAzureRegion(body.region), body.source, body.target, passages);
      // Azure cobra por caracteres, no por tokens.
      return Response.json({ translations, usage: { characters, inputTokens: 0, outputTokens: 0 } });
    } catch (error) {
      return providerErrorResponse(error);
    }
  }

  try {
    const { json, usage } = await requestStructuredJson({
      apiKey,
      maxOutputTokens: translationMaxOutputTokens(characters),
      model,
      provider: body.provider as Exclude<KeyProvider, "azure">,
      schema: translationJsonSchema,
      schemaName: "pliegue_translation",
      system: translationSystemPrompt(body.source, body.target),
      timeoutMs: 120_000,
      user: createTranslationPrompt(passages),
    });
    // Si el modelo se saltó o juntó algún pasaje se avisa con 422: el navegador parte el lote.
    try {
      return Response.json({ translations: parseTranslations(json, passages.length), usage });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Respuesta no válida.", mismatch: true },
        { status: 422 },
      );
    }
  } catch (error) {
    return providerErrorResponse(error);
  }
}
