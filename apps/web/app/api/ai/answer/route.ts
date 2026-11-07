import type { HostedAiProvider } from "../../../ai/api-key";
import { apiKeyFrom, hostedProviders, looksLikeApiKey, providerErrorResponse, requestStructuredJson } from "../../../ai/hosted-json";
import {
  answerJsonSchema,
  answerMaxOutputTokens,
  answerSystemPrompt,
  createAnswerPrompt,
  maxAnswerFragments,
  maxQuestionCharacters,
  type AnswerFragment,
} from "../../../ai/library-answer";
import type { ChunkLocation } from "../../../library/chunking";

/**
 * Responder a una pregunta con fragmentos de los libros (04.5), con la clave de la sesión. Solo
 * recibe la pregunta y los fragmentos que la búsqueda eligió (nunca un libro entero), y devuelve
 * el JSON del modelo: las citas se comprueban en el navegador, que tiene los fragmentos. No
 * escribe en la consola.
 */

interface AnswerRouteRequest {
  fragments?: unknown;
  model?: unknown;
  provider?: unknown;
  question?: unknown;
}

const maxFragmentCharacters = 2_200;
const maxTotalCharacters = 18_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Solo lo que hace falta para citar: página, o sección con su título. */
function validLocation(value: unknown): ChunkLocation | null {
  if (!isRecord(value)) return null;
  if (value.kind === "page" && Number.isInteger(value.page) && (value.page as number) > 0) {
    return { end: 0, kind: "page", page: value.page as number, rects: [], start: 0 };
  }
  if (value.kind === "section" && Number.isInteger(value.section) && (value.section as number) >= 0) {
    const title = typeof value.title === "string" ? value.title.slice(0, 200) : "";
    return { blockEnd: 0, blockStart: 0, kind: "section", section: value.section as number, sectionId: "", title };
  }
  return null;
}

function validFragments(value: unknown): AnswerFragment[] | null {
  if (!Array.isArray(value) || !value.length || value.length > maxAnswerFragments) return null;
  const fragments: AnswerFragment[] = [];
  let total = 0;
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { label, text, title } = item;
    const location = validLocation(item.location);
    if (typeof label !== "string" || !/^F\d{1,2}$/.test(label)) return null;
    if (typeof text !== "string" || !text.trim() || text.length > maxFragmentCharacters) return null;
    if (typeof title !== "string" || title.length > 240 || !location) return null;
    total += text.length;
    fragments.push({ label, location, text, title });
  }
  return total <= maxTotalCharacters ? fragments : null;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 64_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }
  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });
  if (!looksLikeApiKey(apiKey)) {
    return Response.json({ error: "La credencial recibida no tiene formato de API key." }, { status: 400 });
  }

  let body: AnswerRouteRequest;
  try {
    body = (await request.json()) as AnswerRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }
  if (!hostedProviders.includes(body.provider as HostedAiProvider)) {
    return Response.json({ error: "Proveedor no compatible en esta ruta." }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const fragments = validFragments(body.fragments);
  if (!model || model.length > 120 || !question || question.length > maxQuestionCharacters || !fragments) {
    return Response.json({ error: "Pregunta o fragmentos no válidos." }, { status: 400 });
  }

  try {
    const { json, usage } = await requestStructuredJson(
      {
        apiKey,
        maxOutputTokens: answerMaxOutputTokens,
        model,
        provider: body.provider as HostedAiProvider,
        schema: answerJsonSchema,
        schemaName: "pliegue_library_answer",
        system: answerSystemPrompt,
        user: createAnswerPrompt(question, fragments),
      },
      request.signal,
    );
    return Response.json({ answer: json, usage });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
