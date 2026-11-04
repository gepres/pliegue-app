import type { HostedAiProvider } from "./api-key";
import { deeplEndpoint, deeplHeaders, deeplPlan } from "./deepl";
import { ProviderFailureError } from "./hosted-json";
import { classifyProviderFailure, type FailingProvider } from "./provider-error";

/**
 * «Probar conexión» (04.1): confirma que la clave sirve y que el modelo existe antes del primer
 * análisis, que es donde hasta ahora se descubría. Con los proveedores de IA no se envía texto ni
 * se gastan tokens: se pide la ficha del modelo, que exige la clave y responde 404 si el
 * identificador no existe. Azure Translator no tiene nada equivalente con su clave, así que
 * traduce una palabra.
 */

export interface ConnectionCheckResult {
  /** Nombre legible del modelo, si el proveedor lo da («Claude Haiku 4.5»). */
  modelName: string | null;
}

/** Lo que Azure traduce para probar la clave: 4 caracteres de su cupo. */
export const azureProbeText = "Hola";

const checkTimeoutMs = 15_000;

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function failIfNotOk(response: Response, provider: FailingProvider, model: string) {
  if (response.ok) return readPayload(response);
  throw new ProviderFailureError(classifyProviderFailure(provider, response.status, await readPayload(response), model));
}

function stringField(payload: unknown, field: string) {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[field] : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Gemini acepta «gemini-x» y también «models/gemini-x», que es como lo lista su consola. */
function geminiModelPath(model: string) {
  return model.replace(/^models\//, "");
}

function modelRequest(provider: HostedAiProvider, apiKey: string, model: string): [string, RequestInit] {
  const id = encodeURIComponent(provider === "gemini" ? geminiModelPath(model) : model);
  switch (provider) {
    case "openai":
      return [`https://api.openai.com/v1/models/${id}`, { headers: { authorization: `Bearer ${apiKey}` } }];
    case "anthropic":
      return [
        `https://api.anthropic.com/v1/models/${id}`,
        { headers: { "anthropic-version": "2023-06-01", "x-api-key": apiKey } },
      ];
    case "gemini":
      return [
        `https://generativelanguage.googleapis.com/v1beta/models/${id}`,
        { headers: { "x-goog-api-key": apiKey } },
      ];
  }
}

/** La ficha del modelo con la clave del usuario: valida las dos cosas sin generar nada. */
export async function checkHostedConnection(
  provider: HostedAiProvider,
  apiKey: string,
  model: string,
): Promise<ConnectionCheckResult> {
  const [url, init] = modelRequest(provider, apiKey, model);
  const response = await fetch(url, { ...init, method: "GET", signal: AbortSignal.timeout(checkTimeoutMs) });
  const payload = await failIfNotOk(response, provider, model);
  // Anthropic lo llama `display_name`; Gemini, `displayName`. OpenAI no da nombre.
  return { modelName: stringField(payload, "display_name") ?? stringField(payload, "displayName") };
}

/** Azure: una palabra traducida prueba a la vez la clave y la región del recurso. */
export async function checkAzureConnection(apiKey: string, region: string): Promise<ConnectionCheckResult> {
  const url = new URL("https://api.cognitive.microsofttranslator.com/translate");
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("to", "en");
  const response = await fetch(url, {
    body: JSON.stringify([{ text: azureProbeText }]),
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "ocp-apim-subscription-key": apiKey,
      ...(region ? { "ocp-apim-subscription-region": region } : {}),
    },
    method: "POST",
    signal: AbortSignal.timeout(checkTimeoutMs),
  });
  await failIfNotOk(response, "azure", "");
  return { modelName: null };
}

export interface DeepLUsage extends ConnectionCheckResult {
  characterCount: number | null;
  characterLimit: number | null;
  plan: "Free" | "Pro";
}

/**
 * DeepL: pregunta lo gastado del mes (`/v2/usage`). No traduce nada ni gasta caracteres, y la
 * respuesta confirma la clave y dice cuánto queda del cupo.
 */
export async function checkDeepLConnection(apiKey: string): Promise<DeepLUsage> {
  const response = await fetch(`${deeplEndpoint(apiKey)}/v2/usage`, {
    headers: deeplHeaders(apiKey),
    method: "GET",
    signal: AbortSignal.timeout(checkTimeoutMs),
  });
  const payload = (await failIfNotOk(response, "deepl", "")) as { character_count?: unknown; character_limit?: unknown };
  const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    characterCount: numberOf(payload.character_count),
    characterLimit: numberOf(payload.character_limit),
    modelName: null,
    plan: deeplPlan(apiKey),
  };
}
