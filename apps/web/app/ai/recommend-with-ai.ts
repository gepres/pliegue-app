"use client";

import type { LibraryDocument } from "../library/documents";
import { coverQueryFor, normalizeTitle } from "../library/open-library-covers";
import { openLibraryBookUrl, parseCandidates, subjectById, type Recommendation, type TasteProfile } from "../library/recommendations";
import { librarySignalsFor } from "../library/taste-store";
import { adapterFor } from "./adapters";
import { fetchWithRetry } from "./ai-retry";
import { askModelOf, askProviderOf, type AiSettings } from "./ai-settings";
import { assertWithinBudget, recordAiUsage } from "./ai-usage-store";
import {
  createSuggestionsPrompt,
  parseSuggestions,
  sameBook,
  suggestionsJsonSchema,
  suggestionsMaxOutputTokens,
  suggestionsSystemPrompt,
  type SuggestionTastes,
} from "./book-suggestions";

/**
 * «Afinar con IA» (06.1): con el proveedor y el modelo de «Preguntar». Al modelo le llegan los
 * temas y los nombres de autores (los de la biblioteca solo con permiso, y nunca de libros
 * confidenciales o personales); jamás un título. Cada sugerencia se busca en Open Library y solo
 * se enseña si existe con ese título y ese autor.
 */

/** Lo que se le enviaría: para enseñarlo antes de enviarlo. */
export function tastesForAi(profile: TasteProfile, documents: readonly LibraryDocument[]): SuggestionTastes {
  const signals = profile.useLibrary ? librarySignalsFor(documents) : null;
  const subjects = [...profile.subjects, ...(signals?.subjects.map((item) => item.id) ?? [])]
    .map((id) => subjectById(id)?.label)
    .filter((label): label is string => Boolean(label));
  const authors = [...profile.authors, ...(signals?.authors.slice(0, 6).map((item) => item.name) ?? [])];
  return { authors: [...new Set(authors)].slice(0, 12), subjects: [...new Set(subjects)].slice(0, 12) };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface AiRefinement {
  items: Recommendation[];
  /** Cuántas propuso el modelo y cuántas se encontraron de verdad. */
  proposed: number;
  verified: number;
}

export async function refineWithAi(
  profile: TasteProfile,
  documents: readonly LibraryDocument[],
  settings: AiSettings,
  apiKey: string,
  { fetcher = fetch }: { fetcher?: typeof fetch } = {},
): Promise<AiRefinement> {
  const tastes = tastesForAi(profile, documents);
  if (!tastes.authors.length && !tastes.subjects.length) throw new Error("Elige algún tema o autor para afinar con IA.");
  const provider = askProviderOf(settings);
  const model = askModelOf(settings);
  assertWithinBudget(provider);

  let json: unknown;
  let usage = { inputTokens: 0, outputTokens: 0 };
  if (provider === "ollama") {
    const result = await adapterFor({ baseUrl: settings.ollamaUrl, model, provider: "ollama" }).generateJson({
      maxOutputTokens: suggestionsMaxOutputTokens,
      schema: suggestionsJsonSchema,
      schemaName: "pliegue_book_suggestions",
      system: suggestionsSystemPrompt,
      user: createSuggestionsPrompt(tastes),
    });
    json = result.json;
    usage = result.usage;
  } else {
    const response = await fetchWithRetry("/api/ai/recommend", {
      body: JSON.stringify({ authors: tastes.authors, model, provider, subjects: tastes.subjects }),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST",
    });
    const body = await readJson(response);
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "El proveedor no pudo recomendar.");
    json = body.result;
    const reported = (body.usage ?? {}) as Partial<typeof usage>;
    usage = { inputTokens: Number(reported.inputTokens) || 0, outputTokens: Number(reported.outputTokens) || 0 };
  }
  recordAiUsage(provider, model, usage);

  const suggestions = parseSuggestions(json);
  const owned = new Set(documents.map((document) => normalizeTitle(coverQueryFor(document)?.title ?? document.title)));
  const found = await Promise.all(
    suggestions.map(async (suggestion) => {
      try {
        const response = await fetcher(openLibraryBookUrl(suggestion.title, suggestion.author));
        if (!response.ok) return null;
        const match = parseCandidates(await response.json()).find((candidate) => sameBook(suggestion, candidate));
        if (!match || profile.dismissed.includes(match.key) || owned.has(normalizeTitle(match.title))) return null;
        const recommendation: Recommendation = {
          ...match,
          reasons: [{ kind: "ai", source: "ai", text: suggestion.reason ? `Sugerido por tu IA: ${suggestion.reason}` : "Sugerido por tu IA" }],
          score: 100,
        };
        return recommendation;
      } catch {
        return null;
      }
    }),
  );
  const items = found.filter((item): item is Recommendation => item !== null);
  return { items, proposed: suggestions.length, verified: items.length };
}
