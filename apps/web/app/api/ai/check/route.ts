import type { KeyProvider } from "../../../ai/api-key";
import { normalizeAzureRegion } from "../../../ai/ai-settings";
import { checkAzureConnection, checkHostedConnection } from "../../../ai/connection-check";
import { apiKeyFrom, hostedProviders, looksLikeApiKey, providerErrorResponse } from "../../../ai/hosted-json";

/**
 * «Probar conexión» del Panel IA: comprueba con el proveedor que la clave de la sesión sirve y
 * que el modelo existe. La clave viaja en la cabecera, como en las demás rutas, y no se guarda.
 */

interface CheckRouteRequest {
  model?: unknown;
  provider?: KeyProvider;
  region?: unknown;
}

const checkProviders: readonly KeyProvider[] = [...hostedProviders, "azure"];

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4_000) {
    return Response.json({ error: "La solicitud supera el límite permitido." }, { status: 413 });
  }

  const apiKey = apiKeyFrom(request);
  if (!apiKey) return Response.json({ error: "Falta la API key de la sesión." }, { status: 401 });
  if (!looksLikeApiKey(apiKey)) {
    return Response.json({ error: "La credencial recibida no tiene formato de API key." }, { status: 400 });
  }

  let body: CheckRouteRequest;
  try {
    body = (await request.json()) as CheckRouteRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON no válida." }, { status: 400 });
  }

  if (!body.provider || !checkProviders.includes(body.provider)) {
    return Response.json({ error: "Proveedor no compatible en esta ruta." }, { status: 400 });
  }

  try {
    if (body.provider === "azure") {
      return Response.json({ ok: true, ...(await checkAzureConnection(apiKey, normalizeAzureRegion(body.region))) });
    }
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model || model.length > 120) {
      return Response.json({ error: "Falta el identificador del modelo." }, { status: 400 });
    }
    return Response.json({ ok: true, ...(await checkHostedConnection(body.provider, apiKey, model)) });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
