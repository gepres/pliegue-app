import {
  catalogSystemPrompt,
  createCatalogPrompt,
  documentCatalogJsonSchema,
  parseDocumentCatalog,
  type CatalogDocumentInput,
} from "../../../ai/document-catalog";

interface CatalogRouteRequest {
  input?: CatalogDocumentInput;
  model?: string;
  provider?: "anthropic" | "openai";
}

function apiKeyFrom(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function validInput(input: CatalogDocumentInput | undefined) {
  return Boolean(
    input &&
      typeof input.title === "string" &&
      input.title.length <= 240 &&
      typeof input.format === "string" &&
      input.format.length <= 24 &&
      (input.path === null || (typeof input.path === "string" && input.path.length <= 1000)) &&
      typeof input.excerpt === "string" &&
      input.excerpt.length > 0 &&
      input.excerpt.length <= 24_100,
  );
}

function providerMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "El proveedor rechazó la solicitud.";
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string"
    ? error.message.slice(0, 280)
    : "El proveedor rechazó la solicitud.";
}

async function callOpenAi(apiKey: string, model: string, input: CatalogDocumentInput) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: [
        { content: catalogSystemPrompt, role: "system" },
        { content: createCatalogPrompt(input), role: "user" },
      ],
      max_output_tokens: 800,
      model,
      store: false,
      text: {
        format: {
          name: "pliegue_document_catalog",
          schema: documentCatalogJsonSchema,
          strict: true,
          type: "json_schema",
        },
      },
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
    output_text?: string;
  };
  if (!response.ok) throw new Error(providerMessage(payload));
  const text =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI no devolvió contenido catalogable.");
  return parseDocumentCatalog(JSON.parse(text));
}

async function callAnthropic(apiKey: string, model: string, input: CatalogDocumentInput) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    body: JSON.stringify({
      max_tokens: 800,
      messages: [{ content: createCatalogPrompt(input), role: "user" }],
      model,
      output_config: {
        format: { schema: documentCatalogJsonSchema, type: "json_schema" },
      },
      system: catalogSystemPrompt,
    }),
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json()) as {
    content?: Array<{ text?: string; type?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(providerMessage(payload));
  const text = payload.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Anthropic no devolvió contenido catalogable.");
  return parseDocumentCatalog(JSON.parse(text));
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 64_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }

  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });

  let body: CatalogRouteRequest;
  try {
    body = (await request.json()) as CatalogRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }

  const model = body.model?.trim() ?? "";
  if (!body.provider || !(["anthropic", "openai"] as string[]).includes(body.provider)) {
    return Response.json({ error: "Proveedor no compatible en esta ruta." }, { status: 400 });
  }
  if (!model || model.length > 120 || !validInput(body.input)) {
    return Response.json({ error: "Configuración o extracto no válido." }, { status: 400 });
  }

  try {
    const catalog =
      body.provider === "openai"
        ? await callOpenAi(apiKey, model, body.input!)
        : await callAnthropic(apiKey, model, body.input!);
    return Response.json({ catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : "El proveedor no respondió.";
    const timeout = error instanceof DOMException && error.name === "TimeoutError";
    return Response.json({ error: timeout ? "El proveedor agotó el tiempo de espera." : message }, {
      status: timeout ? 504 : 502,
    });
  }
}
