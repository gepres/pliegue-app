import type { HostedAiProvider } from "../../../ai/api-key";
import {
  createSummaryPartPrompt,
  createSummaryWholePrompt,
  maxPointCharacters,
  maxSummaryTitleCharacters,
  summaryPartCharacters,
  summaryPartFragments,
  summaryPartJsonSchema,
  summaryPartMaxOutputTokens,
  summaryPartSystemPrompt,
  summaryReduceSize,
  summaryWholeJsonSchema,
  summaryWholeMaxOutputTokens,
  summaryWholeSystemPrompt,
  type SummaryIdea,
} from "../../../ai/book-summary";
import { apiKeyFrom, hostedProviders, looksLikeApiKey, providerErrorResponse, requestStructuredJson } from "../../../ai/hosted-json";
import type { AnswerFragment } from "../../../ai/library-answer";
import { isRecord, validLocation } from "../../../ai/route-fragments";

/**
 * Resumir un libro (04.5), con la clave de la sesión, en dos pasos que pide el navegador:
 * - `part`: las ideas de una parte del libro (hasta 24 fragmentos seguidos), con sus citas;
 * - `whole`: juntar las ideas de las partes en el resumen.
 * Las citas se comprueban en el navegador, que tiene los fragmentos. No escribe en la consola.
 */

interface SummarizeRouteRequest {
  fragments?: unknown;
  ideas?: unknown;
  model?: unknown;
  part?: unknown;
  provider?: unknown;
  stage?: unknown;
  title?: unknown;
  total?: unknown;
}

const maxFragmentCharacters = 2_200;
// Un poco de holgura sobre el tope de una parte: los fragmentos no se cortan a mitad.
const maxPartCharacters = summaryPartCharacters + 4_000;
const maxIdeasCharacters = summaryReduceSize * (maxPointCharacters + 140);

function validFragments(value: unknown): AnswerFragment[] | null {
  if (!Array.isArray(value) || !value.length || value.length > summaryPartFragments) return null;
  const fragments: AnswerFragment[] = [];
  let total = 0;
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { label, text } = item;
    const location = validLocation(item.location);
    if (typeof label !== "string" || !/^F\d{1,2}$/.test(label)) return null;
    if (typeof text !== "string" || !text.trim() || text.length > maxFragmentCharacters || !location) return null;
    total += text.length;
    fragments.push({ label, location, text, title: "" });
  }
  return total <= maxPartCharacters ? fragments : null;
}

function validIdeas(value: unknown): SummaryIdea[] | null {
  if (!Array.isArray(value) || !value.length || value.length > summaryReduceSize) return null;
  const ideas: SummaryIdea[] = [];
  let total = 0;
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { label, text, where } = item;
    if (typeof label !== "string" || !/^P\d{1,3}$/.test(label)) return null;
    if (typeof text !== "string" || !text.trim() || text.length > maxPointCharacters) return null;
    if (typeof where !== "string" || where.length > 120) return null;
    total += text.length + where.length;
    ideas.push({ label, text, where });
  }
  return total <= maxIdeasCharacters ? ideas : null;
}

const bad = () => Response.json({ error: "Parte del libro o ideas no válidas." }, { status: 400 });

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 160_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }
  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });
  if (!looksLikeApiKey(apiKey)) {
    return Response.json({ error: "La credencial recibida no tiene formato de API key." }, { status: 400 });
  }

  let body: SummarizeRouteRequest;
  try {
    body = (await request.json()) as SummarizeRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }
  if (!hostedProviders.includes(body.provider as HostedAiProvider)) {
    return Response.json({ error: "Proveedor no compatible en esta ruta." }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!model || model.length > 120 || !title || title.length > maxSummaryTitleCharacters) return bad();

  let call: { maxOutputTokens: number; schema: Record<string, unknown>; schemaName: string; system: string; user: string };
  if (body.stage === "part") {
    const fragments = validFragments(body.fragments);
    const part = Number(body.part);
    const total = Number(body.total);
    if (!fragments || !Number.isInteger(part) || !Number.isInteger(total) || part < 1 || total < part || total > 200) return bad();
    call = {
      maxOutputTokens: summaryPartMaxOutputTokens,
      schema: summaryPartJsonSchema,
      schemaName: "pliegue_book_summary_part",
      system: summaryPartSystemPrompt,
      user: createSummaryPartPrompt(title, part, total, fragments),
    };
  } else if (body.stage === "whole") {
    const ideas = validIdeas(body.ideas);
    if (!ideas) return bad();
    call = {
      maxOutputTokens: summaryWholeMaxOutputTokens,
      schema: summaryWholeJsonSchema,
      schemaName: "pliegue_book_summary",
      system: summaryWholeSystemPrompt,
      user: createSummaryWholePrompt(title, ideas),
    };
  } else {
    return bad();
  }

  try {
    const { json, usage } = await requestStructuredJson({ apiKey, model, provider: body.provider as HostedAiProvider, ...call }, request.signal);
    return Response.json({ result: json, usage });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
