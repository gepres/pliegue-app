"use client";

import { saveAnnotation } from "../library/annotation-store";
import type { ReaderAnnotation } from "../library/annotations";
import type { LibraryDocument } from "../library/documents";
import type { SemanticChunkRecord } from "../library/semantic-index-store";
import { providerPlace, routeFor } from "../library/sensitivity";
import { documentSensitivity, hasConsent } from "../library/sensitivity-store";
import { adapterFor } from "./adapters";
import { fetchWithRetry } from "./ai-retry";
import { askModelOf, askProviderOf, type AiSettings } from "./ai-settings";
import { assertWithinBudget, recordAiUsage } from "./ai-usage-store";
import {
  answerJsonSchema,
  answerMaxOutputTokens,
  answerSystemPrompt,
  createAnswerPrompt,
  maxAnswerFragments,
  quoteContext,
  verifyAnswer,
  type AnswerFragment,
  type VerifiedAnswer,
  type VerifiedCitation,
  type VerifiedFinding,
} from "./library-answer";
import { auditRoute } from "./processing-log";
import { recordProcessing } from "./processing-log-store";
import { searchLibrary, type SearchScope } from "./semantic-indexer";

/**
 * Preguntar a la biblioteca (04.5), en el navegador:
 * 1. La búsqueda (04.4) elige hasta 8 fragmentos del alcance.
 * 2. Cada fragmento pasa por el router de sensibilidad del flujo «consultar»: lo confidencial no
 *    sale hacia un proveedor en la nube; lo personal, con permiso.
 * 3. Se pregunta al proveedor de «Preguntar» con su modelo (04.3; por defecto, el de catalogar),
 *    con el presupuesto y el registro de la IA, y se comprueban las citas antes de enseñar nada.
 *
 * Si el proveedor falla, no se prueba otro por su cuenta: se dice y la persona decide.
 */

export interface AssistantFragment extends AnswerFragment {
  chunk: SemanticChunkRecord;
}

export interface PreparedQuestion {
  /** Fragmentos que pueden salir ya. */
  allowed: AssistantFragment[];
  /** Libros personales cuyos fragmentos esperan permiso para «consultar». */
  needsConsent: Array<Pick<LibraryDocument, "id" | "title">>;
  /** Fragmentos de libros que no pueden salir del equipo con este proveedor. */
  keptLocal: AssistantFragment[];
  question: string;
  semanticNote: string | null;
}

export interface AssistantResult {
  answer: VerifiedAnswer<AssistantFragment>;
  /** Fragmentos que se enviaron. */
  sent: number;
  /** Fragmentos que no salieron del equipo (confidenciales o personales sin permiso). */
  keptLocal: AssistantFragment[];
}

function route(document: Pick<LibraryDocument, "id" | "reference">, settings: AiSettings) {
  return routeFor(documentSensitivity(document), providerPlace(askProviderOf(settings), settings), hasConsent(document.id, "ask"));
}

/**
 * Busca los fragmentos de la pregunta y los separa según puedan salir o no. `searchKey` es la
 * clave del proveedor de buscar, que puede ser otro que el de responder.
 */
export async function prepareQuestion(
  question: string,
  scope: SearchScope,
  documents: ReadonlyMap<string, LibraryDocument>,
  settings: AiSettings,
  searchKey: string,
): Promise<PreparedQuestion> {
  const found = await searchLibrary(question, scope, settings, searchKey, { limit: maxAnswerFragments });
  const prepared: PreparedQuestion = { allowed: [], keptLocal: [], needsConsent: [], question, semanticNote: found.semanticNote };
  const asking = new Map<string, Pick<LibraryDocument, "id" | "title">>();
  found.hits.forEach((hit, index) => {
    const document = documents.get(hit.chunk.documentId);
    if (!document) return;
    const fragment: AssistantFragment = {
      chunk: hit.chunk,
      label: `F${index + 1}`,
      location: hit.chunk.location,
      text: hit.chunk.text,
      title: document.title,
    };
    const decision = route(document, settings);
    if (decision === "allow") prepared.allowed.push(fragment);
    else {
      prepared.keptLocal.push(fragment);
      if (decision === "ask") asking.set(document.id, { id: document.id, title: document.title });
    }
  });
  prepared.needsConsent = [...asking.values()];
  return prepared;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Pregunta con los fragmentos que pueden salir (se vuelve a mirar el permiso: la persona pudo
 * darlo entre medias) y comprueba las citas. Sin fragmentos, no se llama a nadie. `apiKey` es la
 * del proveedor de «Preguntar».
 */
export async function answerPrepared(
  prepared: PreparedQuestion,
  documents: ReadonlyMap<string, LibraryDocument>,
  settings: AiSettings,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AssistantResult> {
  const all = [...prepared.allowed, ...prepared.keptLocal].sort((left, right) => Number(left.label.slice(1)) - Number(right.label.slice(1)));
  const outgoing: AssistantFragment[] = [];
  const keptLocal: AssistantFragment[] = [];
  for (const fragment of all) {
    const document = documents.get(fragment.chunk.documentId);
    if (document && route(document, settings) === "allow") outgoing.push(fragment);
    else keptLocal.push(fragment);
  }
  const provider = askProviderOf(settings);
  const model = askModelOf(settings);
  const place = providerPlace(provider, settings);
  for (const fragment of keptLocal) {
    const document = documents.get(fragment.chunk.documentId);
    if (!document) continue;
    const sensitivity = documentSensitivity(document);
    recordProcessing({
      documentId: document.id,
      flow: "ask",
      model,
      place,
      provider,
      route: auditRoute(route(document, settings), sensitivity, place),
      sensitivity,
    });
  }
  if (!outgoing.length) {
    return { answer: { findings: [], missing: null, status: "no-evidence", summary: null }, keptLocal, sent: 0 };
  }

  assertWithinBudget(provider);
  // Las etiquetas, seguidas en lo que se manda: F1, F2…
  const labeled = outgoing.map((fragment, index) => ({ ...fragment, label: `F${index + 1}` }));
  const payload = labeled.map(({ label, location, text, title }) => ({ label, location, text, title }));
  let json: unknown;
  let usage = { inputTokens: 0, outputTokens: 0 };
  if (provider === "ollama") {
    const result = await adapterFor({ baseUrl: settings.ollamaUrl, model, provider: "ollama" }).generateJson(
      {
        maxOutputTokens: answerMaxOutputTokens,
        schema: answerJsonSchema,
        schemaName: "pliegue_library_answer",
        system: answerSystemPrompt,
        user: createAnswerPrompt(prepared.question, labeled),
      },
      signal,
    );
    json = result.json;
    usage = result.usage;
  } else {
    const response = await fetchWithRetry(
      "/api/ai/answer",
      {
        body: JSON.stringify({ fragments: payload, model, provider, question: prepared.question }),
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        method: "POST",
      },
      signal ? { signal } : {},
    );
    const body = await readJson(response);
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "El proveedor no pudo responder.");
    json = body.answer;
    const reported = (body.usage ?? {}) as Partial<typeof usage>;
    usage = { inputTokens: Number(reported.inputTokens) || 0, outputTokens: Number(reported.outputTokens) || 0 };
  }
  recordAiUsage(provider, model, usage);
  const perDocument = new Map<string, { characters: number; count: number }>();
  for (const fragment of labeled) {
    const entry = perDocument.get(fragment.chunk.documentId) ?? { characters: 0, count: 0 };
    perDocument.set(fragment.chunk.documentId, { characters: entry.characters + fragment.text.length, count: entry.count + 1 });
  }
  for (const [documentId, entry] of perDocument) {
    const document = documents.get(documentId);
    if (!document) continue;
    const sensitivity = documentSensitivity(document);
    recordProcessing({
      characters: entry.characters,
      documentId,
      flow: "ask",
      model,
      place,
      provider,
      route: auditRoute("allow", sensitivity, place),
      sent: entry.count,
      sensitivity,
    });
  }
  return { answer: verifyAnswer(json, labeled), keptLocal, sent: labeled.length };
}

/**
 * Un hallazgo como nota del libro de su cita (04.5): un resaltado anclado por la cita y su
 * contexto, con el hallazgo de texto. El original no se toca; la nota es de la persona.
 */
export async function saveFindingAsNote(finding: VerifiedFinding<AssistantFragment>, citation: VerifiedCitation<AssistantFragment>) {
  const { chunk, title } = citation.fragment;
  const location = chunk.location;
  const { prefix, suffix } = quoteContext(chunk.text, citation.quote);
  const now = new Date().toISOString();
  const annotation: ReaderAnnotation = {
    color: "blue",
    createdAt: now,
    documentId: chunk.documentId,
    documentTitle: title,
    id: crypto.randomUUID(),
    note: `${finding.text}\n\n— Hallazgo del asistente de Pliegue${finding.kind === "inference" ? " (inferencia)" : ""}.`,
    target: {
      end: -1,
      kind: "text",
      page: location.kind === "page" ? location.page : null,
      prefix,
      quote: citation.quote,
      // Se ancla por la cita: el lector la busca en la capa de texto de la página o en el libro.
      scope: location.kind === "page" ? `pdf-layer:${location.page}` : "document",
      start: -1,
      suffix,
    },
    updatedAt: now,
  };
  await saveAnnotation(annotation);
  return annotation;
}
