"use client";

import { saveAnnotation } from "../library/annotation-store";
import type { ReaderAnnotation } from "../library/annotations";
import type { LibraryDocument } from "../library/documents";
import { readDocumentChunks, readSemanticDocuments, type SemanticChunkRecord } from "../library/semantic-index-store";
import { providerPlace, routeFor, type ProviderPlace, type Sensitivity } from "../library/sensitivity";
import { documentSensitivity, hasConsent } from "../library/sensitivity-store";
import { adapterFor } from "./adapters";
import { fetchWithRetry, type RetryWait } from "./ai-retry";
import { askModelOf, askProviderOf, type AiSettings } from "./ai-settings";
import { assertWithinBudget, BudgetExceededError, recordAiUsage } from "./ai-usage-store";
import {
  assembleSummary,
  createSummaryPartPrompt,
  createSummaryWholePrompt,
  estimateSummaryTokens,
  maxSummaryCharacters,
  summaryIdeas,
  summaryNoteText,
  summaryPartJsonSchema,
  summaryPartMaxOutputTokens,
  summaryPartSystemPrompt,
  summaryParts,
  summaryReduceSize,
  summaryWholeJsonSchema,
  summaryWholeMaxOutputTokens,
  summaryWholeSystemPrompt,
  verifySummaryPart,
  type BookSummary,
  type SummaryIdea,
  type SummaryPoint,
} from "./book-summary";
import type { AiProvider, CatalogUsage } from "./document-catalog";
import { quoteContext } from "./library-answer";
import type { AssistantFragment } from "./library-assistant";
import { auditRoute } from "./processing-log";
import { recordProcessing } from "./processing-log-store";
import { indexDocuments, indexNeeds, isIndexable } from "./semantic-indexer";

/**
 * Resumir un libro entero en el navegador (04.5): con el proveedor y el modelo de «Preguntar»,
 * por partes y juntando (`book-summary.ts`). Pasa por el router de sensibilidad (flujo
 * «resumir»: lo confidencial no sale; lo personal, con permiso), por el presupuesto antes de
 * cada parte y queda en el registro de la IA. Lo que se queda es una nota del libro.
 */

export interface SummaryPlan {
  characters: number;
  chunks: SemanticChunkRecord[];
  estimate: { inputTokens: number; outputTokens: number };
  model: string;
  parts: number;
  place: ProviderPlace;
  provider: AiProvider;
  /** Qué dice el router: seguir, preguntar (personal sin permiso) o no (confidencial fuera). */
  route: "allow" | "ask" | "block";
  sensitivity: Sensitivity;
  /** El índice solo tiene el principio del libro (el texto pasaba del tope al trocearlo). */
  truncated: boolean;
}

export type SummaryPlanResult = { plan: SummaryPlan } | { reason: "no-text" | "too-long" | "not-indexable"; characters?: number };

export interface SummaryProgress {
  done: number;
  stage: "parts" | "joining";
  total: number;
  waiting: string | null;
}

/**
 * Los fragmentos del libro, en orden. Si no está indexado, o el índice es de otra versión del
 * archivo o falló, se trocea ahora: si no, se resumiría (y se citaría) un texto que ya no es el
 * del libro. Trocear es local: no sale nada y deja el libro listo también para buscar.
 */
async function bookChunks(document: LibraryDocument, settings: AiSettings) {
  const recordOf = async () => (await readSemanticDocuments()).find((record) => record.documentId === document.id);
  let record = await recordOf();
  if (indexNeeds(document, record, null, false).chunk) {
    await indexDocuments([document], settings, "", { embed: false });
    record = await recordOf();
  }
  const chunks = record?.status === "ready" ? await readDocumentChunks(document.id) : [];
  return { chunks: [...chunks].sort((left, right) => left.index - right.index), truncated: Boolean(record?.truncated) };
}

/** Antes de enviar nada: cuánto texto, cuántas partes, cuánto costará y qué dice el router. */
export async function planBookSummary(document: LibraryDocument, settings: AiSettings): Promise<SummaryPlanResult> {
  if (!isIndexable(document)) return { reason: "not-indexable" };
  const { chunks, truncated } = await bookChunks(document, settings);
  const characters = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  if (!chunks.length || !characters) return { reason: "no-text" };
  if (characters > maxSummaryCharacters) return { characters, reason: "too-long" };
  const provider = askProviderOf(settings);
  const place = providerPlace(provider, settings);
  const sensitivity = documentSensitivity(document);
  const parts = summaryParts(chunks).length;
  return {
    plan: {
      characters,
      chunks,
      estimate: estimateSummaryTokens(characters, parts),
      model: askModelOf(settings),
      parts,
      place,
      provider,
      route: routeFor(sensitivity, place, hasConsent(document.id, "summarize")),
      sensitivity,
      truncated,
    },
  };
}

/** Si la sensibilidad de este libro deja enviarlo ahora a ese proveedor. */
function stillAllowed(document: LibraryDocument, plan: SummaryPlan) {
  return routeFor(documentSensitivity(document), plan.place, hasConsent(document.id, "summarize")) === "allow";
}

/** Se paró a mitad porque el libro dejó de poder salir (se marcó confidencial, por ejemplo). */
export class SummaryRouteError extends Error {}

/** Lo que el router no dejó salir, al registro de la IA (sin texto). */
export function recordSummaryKeptLocal(document: Pick<LibraryDocument, "id">, plan: SummaryPlan) {
  recordProcessing({
    documentId: document.id,
    flow: "summarize",
    model: plan.model,
    place: plan.place,
    provider: plan.provider,
    route: auditRoute(plan.route, plan.sensitivity, plan.place),
    sensitivity: plan.sensitivity,
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface CallOptions {
  onWait?: (wait: RetryWait) => void;
  signal?: AbortSignal;
}

/** Una llamada: Ollama desde el navegador; los demás, por la ruta de Pliegue con la clave. */
async function callModel(
  plan: SummaryPlan,
  settings: AiSettings,
  apiKey: string,
  hosted: Record<string, unknown>,
  local: { maxOutputTokens: number; schema: Record<string, unknown>; schemaName: string; system: string; user: string },
  { onWait, signal }: CallOptions,
): Promise<{ json: unknown; usage: CatalogUsage }> {
  if (plan.provider === "ollama") {
    const result = await adapterFor({ baseUrl: settings.ollamaUrl, model: plan.model, provider: "ollama" }).generateJson(local, signal);
    return { json: result.json, usage: result.usage };
  }
  const response = await fetchWithRetry(
    "/api/ai/summarize",
    {
      body: JSON.stringify({ ...hosted, model: plan.model, provider: plan.provider }),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST",
    },
    { ...(onWait ? { onWait } : {}), ...(signal ? { signal } : {}) },
  );
  const body = await readJson(response);
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "El proveedor no pudo resumir.");
  const reported = (body.usage ?? {}) as Partial<CatalogUsage>;
  return { json: body.result, usage: { inputTokens: Number(reported.inputTokens) || 0, outputTokens: Number(reported.outputTokens) || 0 } };
}

/**
 * Resume el libro: cada parte, con el presupuesto mirado antes; luego junta (por grupos si son
 * muchas ideas). Si el proveedor falla, se para y se dice: no se prueba con otro (decisión
 * `f8c90d3b`).
 */
export async function summarizeBook(
  document: LibraryDocument,
  plan: SummaryPlan,
  settings: AiSettings,
  apiKey: string,
  { onProgress, signal }: { onProgress?: (progress: SummaryProgress) => void; signal?: AbortSignal } = {},
): Promise<BookSummary<AssistantFragment>> {
  // Otra vez justo antes, y antes de cada envío: la persona pudo marcarlo confidencial mientras.
  const checkRoute = () => {
    if (!stillAllowed(document, plan)) throw new SummaryRouteError("La sensibilidad de este libro ya no deja enviarlo a ese proveedor: se paró.");
  };
  checkRoute();
  const title = document.title;
  const groups = summaryParts(plan.chunks);
  const progress: SummaryProgress = { done: 0, stage: "parts", total: groups.length, waiting: null };
  const publish = () => onProgress?.({ ...progress });
  const onWait = ({ seconds }: RetryWait) => {
    progress.waiting = `El proveedor pide esperar: se reintenta en ${seconds} s.`;
    publish();
  };
  const totals = { characters: 0, sent: 0, tokens: 0 };
  const audit = {
    documentId: document.id,
    flow: "summarize" as const,
    model: plan.model,
    place: plan.place,
    provider: plan.provider,
    route: auditRoute("allow", plan.sensitivity, plan.place),
    sensitivity: plan.sensitivity,
  };
  const count = (usage: CatalogUsage) => {
    recordAiUsage(plan.provider, plan.model, usage);
    totals.tokens += usage.inputTokens + usage.outputTokens;
  };
  // Una sola entrada en el registro por resumen, con lo que salió de verdad.
  let recorded = false;
  const record = (failed: boolean) => {
    if (recorded) return;
    recorded = true;
    recordProcessing({ ...audit, characters: totals.characters, ...(failed ? { failed: 1 } : {}), sent: totals.sent, tokens: totals.tokens });
  };

  publish();
  try {
    // 1. Las ideas de cada parte, con sus citas comprobadas.
    let ideas: SummaryPoint<AssistantFragment>[] = [];
    let dropped = 0;
    for (const [position, group] of groups.entries()) {
      signal?.throwIfAborted();
      checkRoute();
      assertWithinBudget(plan.provider, document.id);
      const fragments: AssistantFragment[] = group.map((chunk, index) => ({ chunk, label: `F${index + 1}`, location: chunk.location, text: chunk.text, title }));
      const payload = fragments.map(({ label, location, text }) => ({ label, location, text }));
      const { json, usage } = await callModel(
        plan,
        settings,
        apiKey,
        { fragments: payload, part: position + 1, stage: "part", title, total: groups.length },
        {
          maxOutputTokens: summaryPartMaxOutputTokens,
          schema: summaryPartJsonSchema,
          schemaName: "pliegue_book_summary_part",
          system: summaryPartSystemPrompt,
          user: createSummaryPartPrompt(title, position + 1, groups.length, fragments),
        },
        { onWait, ...(signal ? { signal } : {}) },
      );
      count(usage);
      totals.characters += fragments.reduce((sum, fragment) => sum + fragment.text.length, 0);
      totals.sent += fragments.length;
      const verified = verifySummaryPart(json, fragments);
      ideas.push(...verified.points);
      dropped += verified.dropped;
      progress.done = position + 1;
      progress.waiting = null;
      publish();
    }
    if (!ideas.length) throw new Error("No salió ninguna idea con una cita comprobable: no hay resumen que enseñar.");

    // 2. Juntar. Con muchas ideas, primero por grupos (cada grupo, sus mejores ideas).
    progress.stage = "joining";
    publish();
    const join = async (points: SummaryPoint<AssistantFragment>[]) => {
      signal?.throwIfAborted();
      checkRoute();
      assertWithinBudget(plan.provider, document.id);
      const labeled: SummaryIdea[] = summaryIdeas(points);
      const { json, usage } = await callModel(
        plan,
        settings,
        apiKey,
        { ideas: labeled, stage: "whole", title },
        {
          maxOutputTokens: summaryWholeMaxOutputTokens,
          schema: summaryWholeJsonSchema,
          schemaName: "pliegue_book_summary",
          system: summaryWholeSystemPrompt,
          user: createSummaryWholePrompt(title, labeled),
        },
        { onWait, ...(signal ? { signal } : {}) },
      );
      count(usage);
      return assembleSummary(json, points);
    };
    while (ideas.length > summaryReduceSize) {
      const next: SummaryPoint<AssistantFragment>[] = [];
      for (let start = 0; start < ideas.length; start += summaryReduceSize) {
        next.push(...(await join(ideas.slice(start, start + summaryReduceSize))).points);
      }
      // Si juntar no reduce (el modelo devolvió lo mismo), se corta para no dar vueltas.
      if (next.length >= ideas.length) break;
      ideas = next;
    }
    const whole = await join(ideas.slice(0, summaryReduceSize));
    if (!whole.points.length && !whole.summary) throw new Error("El proveedor no devolvió un resumen.");
    record(false);
    return { dropped: dropped + whole.unsupported, partial: plan.truncated, points: whole.points, summary: whole.summary };
  } catch (error) {
    progress.waiting = null;
    // «Detener», el presupuesto o la sensibilidad no son fallos del proveedor, pero lo que ya
    // salió se apunta igual: el registro dice qué texto dejó el equipo.
    const stopped = signal?.aborted || error instanceof BudgetExceededError || error instanceof SummaryRouteError;
    if (!stopped) record(true);
    else if (totals.sent) record(false);
    throw error;
  }
}

/**
 * El resumen como nota del libro: anclada a la primera cita (allí se ve resaltada) y con el
 * resumen entero y sus citas como texto. El original no se toca; la nota es de la persona y se
 * sincroniza como cualquier otra.
 */
export async function saveBookSummaryNote(document: Pick<LibraryDocument, "id" | "title">, summary: BookSummary<AssistantFragment>, model: string) {
  const first = summary.points[0]?.citations[0];
  if (!first) throw new Error("El resumen no tiene ninguna cita a la que anclar la nota.");
  const { chunk } = first.fragment;
  const location = chunk.location;
  const { prefix, suffix } = quoteContext(chunk.text, first.quote);
  const now = new Date().toISOString();
  const annotation: ReaderAnnotation = {
    color: "blue",
    createdAt: now,
    documentId: chunk.documentId,
    documentTitle: document.title,
    id: crypto.randomUUID(),
    note: summaryNoteText(document.title, summary, model),
    target: {
      end: -1,
      kind: "text",
      page: location.kind === "page" ? location.page : null,
      prefix,
      quote: first.quote,
      scope: location.kind === "page" ? `pdf-layer:${location.page}` : "document",
      start: -1,
      suffix,
    },
    updatedAt: now,
  };
  await saveAnnotation(annotation);
  return annotation;
}
