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
  readonly retryable: boolean;
  readonly retryAfter: number | null;
  readonly status: number;

  constructor(failure: ProviderFailure) {
    super(failure.message);
    this.name = "ProviderFailureError";
    this.retryable = failure.retryable;
    this.retryAfter = failure.retryAfter;
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

async function callOpenAi(request: StructuredRequest, signal: AbortSignal, fetchImpl: typeof fetch) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
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
    throw new ProviderFailureError(classifyProviderFailure("openai", response.status, payload, request.model, response.headers));
  }
  const text =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  return { payload, text };
}

async function callAnthropic(request: StructuredRequest, signal: AbortSignal, fetchImpl: typeof fetch) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
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
    throw new ProviderFailureError(classifyProviderFailure("anthropic", response.status, payload, request.model, response.headers));
  }
  return { payload, text: payload.content?.find((item) => item.type === "text")?.text };
}

/** `generateContent` con `responseJsonSchema`, que admite el JSON Schema completo, anulables incluidos. */
async function callGemini(request: StructuredRequest, signal: AbortSignal, fetchImpl: typeof fetch) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
  const response = await fetchImpl(endpoint, {
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
    throw new ProviderFailureError(classifyProviderFailure("gemini", response.status, payload, request.model, response.headers));
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

/**
 * El tiempo de espera, y además la señal de la petición del navegador si se pasa (04.2): si la
 * persona detiene el análisis o la traducción, se corta también la llamada al proveedor y no
 * se gastan tokens en una respuesta que ya nadie espera.
 */
export function providerSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function requestStructuredJson(request: StructuredRequest, signal?: AbortSignal): Promise<StructuredResponse> {
  return requestStructuredJsonWith(fetch, request, signal);
}

/** Lo mismo con un `fetch` inyectado: lo usa la interfaz común (`adapters.ts`) y sus pruebas. */
export async function requestStructuredJsonWith(
  fetchImpl: typeof fetch,
  request: StructuredRequest,
  signal?: AbortSignal,
): Promise<StructuredResponse> {
  const { payload, text } = await callers[request.provider](request, providerSignal(request.timeoutMs ?? 60_000, signal), fetchImpl);
  const name = providerNames[request.provider];
  if (!text) throw new Error(`${name} no devolvió contenido.`);
  try {
    return { json: JSON.parse(text), usage: readCatalogUsage(payload) };
  } catch {
    throw new Error(`${name} no devolvió el JSON esperado.`);
  }
}

/**
 * La respuesta de una ruta cuando falla la llamada: la causa con su código, o 502/504. Lo que
 * admite reintento lo dice (`retryable`) y, si el proveedor pidió esperar, con `Retry-After`:
 * es el navegador quien espera y reintenta, no la función del servidor.
 */
export function providerErrorResponse(error: unknown) {
  if (error instanceof ProviderFailureError) {
    return Response.json(
      { error: error.message, retryable: error.retryable, ...(error.retryAfter !== null ? { retryAfter: error.retryAfter } : {}) },
      { ...(error.retryAfter !== null ? { headers: { "retry-after": String(error.retryAfter) } } : {}), status: error.status },
    );
  }
  // El navegador se fue (se detuvo el análisis o la traducción): no hay a quién contestar.
  if (error instanceof DOMException && error.name === "AbortError") {
    return Response.json({ error: "Se canceló la solicitud." }, { status: 499 });
  }
  // «fetch failed»: la conexión del servidor con el proveedor se cortó (lo vio el dueño, 6-nov).
  // Suele ser pasajero, y la petición no llegó a responder: se dice la causa y se reintenta.
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    const cause = (error as { cause?: { code?: unknown } }).cause;
    const code = typeof cause?.code === "string" ? ` (${cause.code})` : "";
    return Response.json(
      { error: `Se cortó la conexión del servidor de Pliegue con el proveedor${code}. Suele ser pasajero: Pliegue lo reintenta.`, retryable: true },
      { status: 502 },
    );
  }
  const timeout = error instanceof DOMException && error.name === "TimeoutError";
  const message = error instanceof Error ? error.message : "El proveedor no respondió.";
  // Un tiempo agotado no se reintenta solo: ya costó uno o dos minutos, y quizá tokens.
  return Response.json(
    { error: timeout ? "El proveedor agotó el tiempo de espera." : message, retryable: false },
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
