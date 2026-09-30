import type { HostedAiProvider } from "./api-key";
import { readCatalogUsage, type CatalogUsage } from "./document-catalog";
import { classifyProviderFailure, type ProviderFailure } from "./provider-error";

/**
 * Una petición con salida JSON por esquema a un proveedor alojado, con la clave del usuario.
 * La comparten las rutas de servidor —catalogar, traducir—: cada proveedor pide el esquema a su
 * manera y devuelve el texto en otro sitio, y eso no debe repetirse en cada ruta.
 */

export interface StructuredRequest {
  apiKey: string;
  maxOutputTokens: number;
  model: string;
  provider: HostedAiProvider;
  schema: Record<string, unknown>;
  /** Nombre del esquema: OpenAI lo exige. */
  schemaName: string;
  system: string;
  timeoutMs?: number;
  user: string;
}

export interface StructuredResponse {
  json: unknown;
  usage: CatalogUsage;
}

const providerNames: Record<HostedAiProvider, string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
};

/** Conserva la causa hasta el `catch` de la ruta, que es donde se elige el código de salida. */
export class ProviderFailureError extends Error {
  readonly status: number;

  constructor(failure: ProviderFailure) {
    super(failure.message);
    this.name = "ProviderFailureError";
    this.status = failure.status;
  }
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function callOpenAi(request: StructuredRequest, signal: AbortSignal) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: [
        { content: request.system, role: "system" },
        { content: request.user, role: "user" },
      ],
      max_output_tokens: request.maxOutputTokens,
      model: request.model,
      store: false,
      text: {
        format: { name: request.schemaName, schema: request.schema, strict: true, type: "json_schema" },
      },
    }),
    headers: { authorization: `Bearer ${request.apiKey}`, "content-type": "application/json" },
    method: "POST",
    signal,
  });
  const payload = (await readPayload(response)) as {
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
    output_text?: string;
  };
  if (!response.ok) {
    throw new ProviderFailureError(classifyProviderFailure("openai", response.status, payload, request.model));
  }
  const text =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  return { payload, text };
}

async function callAnthropic(request: StructuredRequest, signal: AbortSignal) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    body: JSON.stringify({
      max_tokens: request.maxOutputTokens,
      messages: [{ content: request.user, role: "user" }],
      model: request.model,
      output_config: { format: { schema: request.schema, type: "json_schema" } },
      system: request.system,
    }),
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": request.apiKey,
    },
    method: "POST",
    signal,
  });
  const payload = (await readPayload(response)) as { content?: Array<{ text?: string; type?: string }> };
  if (!response.ok) {
    throw new ProviderFailureError(classifyProviderFailure("anthropic", response.status, payload, request.model));
  }
  return { payload, text: payload.content?.find((item) => item.type === "text")?.text };
}

/** `generateContent` con `responseJsonSchema`, que admite el JSON Schema completo, anulables incluidos. */
async function callGemini(request: StructuredRequest, signal: AbortSignal) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      contents: [{ parts: [{ text: request.user }], role: "user" }],
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        responseJsonSchema: request.schema,
        responseMimeType: "application/json",
      },
      systemInstruction: { parts: [{ text: request.system }] },
    }),
    headers: { "content-type": "application/json", "x-goog-api-key": request.apiKey },
    method: "POST",
    signal,
  });
  const payload = (await readPayload(response)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  if (!response.ok) {
    throw new ProviderFailureError(classifyProviderFailure("gemini", response.status, payload, request.model));
  }
  // Lo que el modelo piensa llega en partes marcadas con `thought`: no es la respuesta.
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return { payload, text: text || undefined };
}

const callers = { anthropic: callAnthropic, gemini: callGemini, openai: callOpenAi };

export async function requestStructuredJson(request: StructuredRequest): Promise<StructuredResponse> {
  const { payload, text } = await callers[request.provider](
    request,
    AbortSignal.timeout(request.timeoutMs ?? 60_000),
  );
  const name = providerNames[request.provider];
  if (!text) throw new Error(`${name} no devolvió contenido.`);
  try {
    return { json: JSON.parse(text), usage: readCatalogUsage(payload) };
  } catch {
    throw new Error(`${name} no devolvió el JSON esperado.`);
  }
}

/** La respuesta de una ruta cuando falla la llamada: la causa con su código, o 502/504. */
export function providerErrorResponse(error: unknown) {
  if (error instanceof ProviderFailureError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const timeout = error instanceof DOMException && error.name === "TimeoutError";
  const message = error instanceof Error ? error.message : "El proveedor no respondió.";
  return Response.json(
    { error: timeout ? "El proveedor agotó el tiempo de espera." : message },
    { status: timeout ? 504 : 502 },
  );
}

export const hostedProviders: readonly HostedAiProvider[] = ["anthropic", "gemini", "openai"];

/** La clave llega en la cabecera `authorization`; nunca en el cuerpo. */
export function apiKeyFrom(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

/** Segunda barrera: la ruta es la última oportunidad de no reenviar algo que no es una credencial. */
export function looksLikeApiKey(apiKey: string) {
  return !/\s/.test(apiKey) && apiKey.length >= 20 && apiKey.length <= 500;
}
