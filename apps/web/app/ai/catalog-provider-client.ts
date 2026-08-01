"use client";

import type { AiSettings } from "./ai-settings";
import {
  catalogSystemPrompt,
  createCatalogPrompt,
  documentCatalogJsonSchema,
  parseDocumentCatalog,
  type CatalogDocumentInput,
} from "./document-catalog";

interface CatalogApiResponse {
  catalog?: unknown;
  error?: string;
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
  return parseDocumentCatalog(payload.catalog);
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
  if (!response.ok) throw new Error(payload.error || "Ollama rechazó el análisis.");

  try {
    return parseDocumentCatalog(JSON.parse(payload.message?.content ?? ""));
  } catch (error) {
    if (error instanceof Error && error.message.includes("catálogo válido")) throw error;
    throw new Error("Ollama no devolvió el catálogo JSON esperado.");
  }
}

export function requestCatalogFromProvider(
  input: CatalogDocumentInput,
  settings: AiSettings,
  apiKey: string,
) {
  return settings.provider === "ollama"
    ? requestOllama(input, settings)
    : requestHostedProvider(input, settings, apiKey);
}
