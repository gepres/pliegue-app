"use client";

import type { AiSettings } from "./ai-settings";
import {
  catalogSystemPrompt,
  createCatalogPrompt,
  documentCatalogJsonSchema,
  parseDocumentCatalog,
  readCatalogUsage,
  type CatalogDocumentInput,
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
  usage: CatalogUsage;
}

async function readJson(response: Response): Promise<CatalogApiResponse> {
  try {
    return (await response.json()) as CatalogApiResponse;
  } catch {
    return {};
  }
}

async function requestHostedProvider(
  input: CatalogDocumentInput,
  settings: AiSettings,
  apiKey: string,
) {
  if (!apiKey) throw new Error("Añade la API key para esta sesión antes de analizar.");

  const response = await fetch("/api/ai/catalog", {
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
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(payload.error || "El proveedor no pudo analizar el archivo.");
  return { catalog: parseDocumentCatalog(payload.catalog), usage: readCatalogUsage(payload) };
}

async function requestOllama(input: CatalogDocumentInput, settings: AiSettings) {
  const endpoint = `${settings.ollamaUrl.replace(/\/$/, "")}/api/chat`;
  let response: Response;

  try {
    response = await fetch(endpoint, {
      body: JSON.stringify({
        format: documentCatalogJsonSchema,
        messages: [
          { content: catalogSystemPrompt, role: "system" },
          { content: createCatalogPrompt(input), role: "user" },
        ],
        model: settings.models.ollama,
        options: { temperature: 0 },
        stream: false,
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
    return {
      catalog: parseDocumentCatalog(JSON.parse(payload.message?.content ?? "")),
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
): Promise<CatalogProviderResult> {
  return settings.provider === "ollama"
    ? requestOllama(input, settings)
    : requestHostedProvider(input, settings, apiKey);
}
