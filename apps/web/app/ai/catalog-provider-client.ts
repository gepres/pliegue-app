"use client";

import { fetchWithRetry, type RetryWait } from "./ai-retry";
import type { AiSettings } from "./ai-settings";
import {
  catalogSystemPrompt,
  createCatalogPrompt,
  documentCatalogJsonSchema,
  parseCatalogExtras,
  parseDocumentCatalog,
  readCatalogUsage,
  type CatalogDocumentInput,
  type CatalogExtras,
  type CatalogUsage,
  type DocumentCatalogMetadata,
} from "./document-catalog";
import { classifyProviderFailure } from "./provider-error";

interface CatalogApiResponse {
  catalog?: unknown;
  error?: string;
  usage?: unknown;
}

export interface CatalogProviderResult {
  catalog: DocumentCatalogMetadata;
  extras: CatalogExtras;
  usage: CatalogUsage;
}

async function readJson(response: Response): Promise<CatalogApiResponse> {
  try {
    return (await response.json()) as CatalogApiResponse;
  } catch {
    return {};
  }
}

/** Detener el análisis y saber cuándo se espera para reintentar (04.2). */
export interface CatalogRequestOptions {
  onWait?: (wait: RetryWait) => void;
  signal?: AbortSignal;
}

async function requestHostedProvider(
  input: CatalogDocumentInput,
  settings: AiSettings,
  apiKey: string,
  { onWait, signal }: CatalogRequestOptions,
) {
  if (!apiKey) throw new Error("Añade la API key para esta sesión antes de analizar.");

  // Un límite por minuto o un proveedor saturado se reintentan solos, esperando lo que pidan.
  const response = await fetchWithRetry(
    "/api/ai/catalog",
    {
      body: JSON.stringify({
        input,
        model: settings.models[settings.provider],
        provider: settings.provider,
      }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
    { ...(onWait ? { onWait } : {}), ...(signal ? { signal } : {}) },
  );
  const payload = await readJson(response);
  if (!response.ok) throw new Error(payload.error || "El proveedor no pudo analizar el archivo.");
  return {
    catalog: parseDocumentCatalog(payload.catalog),
    extras: parseCatalogExtras(payload.catalog),
    usage: readCatalogUsage(payload),
  };
}

async function requestOllama(input: CatalogDocumentInput, settings: AiSettings, signal?: AbortSignal) {
  const endpoint = `${settings.ollamaUrl.replace(/\/$/, "")}/api/chat`;
  let response: Response;

  try {
    response = await fetch(endpoint, {
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        format: documentCatalogJsonSchema,
        messages: [
          { content: catalogSystemPrompt, role: "system" },
          { content: createCatalogPrompt(input), role: "user" },
        ],
        model: settings.models.ollama,
        options: { temperature: 0 },
        stream: false,
        // Los modelos que razonan (qwen3, deepseek-r1) piensan antes de cada ficha: minutos por
        // documento para rellenar campos que están en la portada. Sin razonamiento, segundos.
        think: false,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch {
    throw new Error(
      "No se pudo conectar con Ollama. Revisa la URL, que el servicio esté activo y permita el origen de esta app.",
    );
  }

  const payload = (await readJson(response)) as CatalogApiResponse & {
    message?: { content?: string };
  };
  // Ollama se consulta desde el navegador, así que aquí no hay ruta de servidor que traduzca
  // el fallo: el modelo sin descargar es el caso frecuente y merece decirse con esas palabras.
  if (!response.ok) {
    throw new Error(
      classifyProviderFailure("ollama", response.status, payload, settings.models.ollama).message,
    );
  }

  try {
    const json: unknown = JSON.parse(payload.message?.content ?? "");
    return {
      catalog: parseDocumentCatalog(json),
      extras: parseCatalogExtras(json),
      // Ollama publica sus contadores en la raíz de la respuesta, no bajo `usage`.
      usage: readCatalogUsage(payload),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("catálogo válido")) throw error;
    throw new Error("Ollama no devolvió el catálogo JSON esperado.");
  }
}

export function requestCatalogFromProvider(
  input: CatalogDocumentInput,
  settings: AiSettings,
  apiKey: string,
  options: CatalogRequestOptions = {},
): Promise<CatalogProviderResult> {
  return settings.provider === "ollama"
    ? requestOllama(input, settings, options.signal)
    : requestHostedProvider(input, settings, apiKey, options);
}
