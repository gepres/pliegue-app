import type { HostedAiProvider } from "../../../ai/api-key";
import {
  catalogSystemPrompt,
  createCatalogPrompt,
  documentCatalogJsonSchema,
  maxKnownAuthorsInPrompt,
  parseDocumentCatalog,
  type CatalogDocumentInput,
} from "../../../ai/document-catalog";
import {
  apiKeyFrom,
  hostedProviders,
  looksLikeApiKey,
  providerErrorResponse,
  requestStructuredJson,
} from "../../../ai/hosted-json";

interface CatalogRouteRequest {
  input?: CatalogDocumentInput;
  model?: string;
  provider?: HostedAiProvider;
}

/** Holgura suficiente para la ficha completa con la sinopsis extensa del contrato v2. */
const catalogMaxOutputTokens = 1_500;

function validKnownAuthors(authors: CatalogDocumentInput["knownAuthors"]) {
  if (authors === undefined) return true;
  return (
    Array.isArray(authors) &&
    authors.length <= maxKnownAuthorsInPrompt &&
    authors.every((author) => typeof author === "string" && author.length <= 120)
  );
}

function validInput(input: CatalogDocumentInput | undefined) {
  return Boolean(
    input &&
      typeof input.title === "string" &&
      input.title.length <= 240 &&
      typeof input.format === "string" &&
      input.format.length <= 24 &&
      (input.path === null || (typeof input.path === "string" && input.path.length <= 1000)) &&
      validKnownAuthors(input.knownAuthors) &&
      typeof input.excerpt === "string" &&
      input.excerpt.length > 0 &&
      input.excerpt.length <= 24_100,
  );
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 64_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }

  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });

  // Segunda barrera: esta ruta es la que habla con el proveedor, así que es la última
  // oportunidad de no reenviar algo que no es una credencial.
  if (!looksLikeApiKey(apiKey)) {
    return Response.json(
      { error: "La credencial recibida no tiene formato de API key." },
      { status: 400 },
    );
  }

  let body: CatalogRouteRequest;
  try {
    body = (await request.json()) as CatalogRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }

  const model = body.model?.trim() ?? "";
  if (!body.provider || !hostedProviders.includes(body.provider)) {
    return Response.json({ error: "Proveedor no compatible en esta ruta." }, { status: 400 });
  }
  if (!model || model.length > 120 || !validInput(body.input)) {
    return Response.json({ error: "Configuración o extracto no válido." }, { status: 400 });
  }

  try {
    const { json, usage } = await requestStructuredJson({
      apiKey,
      maxOutputTokens: catalogMaxOutputTokens,
      model,
      provider: body.provider,
      schema: documentCatalogJsonSchema,
      schemaName: "pliegue_document_catalog",
      system: catalogSystemPrompt,
      user: createCatalogPrompt(body.input!),
    });
    return Response.json({ catalog: parseDocumentCatalog(json), usage });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
