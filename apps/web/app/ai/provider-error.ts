import type { AiProvider } from "./document-catalog";

/**
 * Causas que la interfaz debe poder nombrar por separado. La distinción que importa es la
 * primera contra la segunda: un identificador de modelo caducado y una credencial mal pegada
 * fallan igual de pronto y, contados como «el proveedor rechazó la solicitud», llevan a revisar
 * la clave durante un rato antes de mirar el modelo.
 */
export type ProviderFailureKind = "credential" | "model" | "permission" | "provider" | "quota";

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** Texto ya redactado para la persona: nombra la causa con sus palabras. */
  message: string;
  /** Código con el que responder al navegador, para no aplanar toda causa en un 502. */
  status: number;
}

const providerName: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  ollama: "Ollama",
  openai: "OpenAI",
};

const statusByKind: Record<ProviderFailureKind, number> = {
  credential: 401,
  model: 404,
  permission: 403,
  provider: 502,
  quota: 429,
};

/** El detalle del fallo llega con forma distinta en cada proveedor; aquí se reduce a lo común. */
function readDetail(payload: unknown) {
  if (typeof payload === "string") return { code: "", message: payload };
  if (!payload || typeof payload !== "object") return { code: "", message: "" };

  const error = (payload as { error?: unknown }).error;
  // Ollama contesta con `error` como texto plano; OpenAI y Anthropic con un objeto.
  if (typeof error === "string") return { code: "", message: error };
  if (!error || typeof error !== "object") return { code: "", message: "" };

  const detail = error as { code?: unknown; message?: unknown; type?: unknown };
  const code = [detail.code, detail.type].find((value) => typeof value === "string");
  return {
    code: typeof code === "string" ? code : "",
    message: typeof detail.message === "string" ? detail.message : "",
  };
}

function kindOf(status: number, code: string, message: string): ProviderFailureKind {
  // El código del proveedor manda sobre el estado: OpenAI ha devuelto «model_not_found»
  // acompañado tanto de 404 como de 400 según la ruta.
  if (code === "model_not_found" || code === "not_found_error") return "model";
  if (code === "invalid_api_key" || code === "authentication_error") return "credential";
  if (code === "insufficient_quota" || code === "rate_limit_error") return "quota";
  if (code === "permission_error") return "permission";

  // Ollama no envía código: nombra el modelo que le falta dentro del texto.
  if (/\bmodel\b.*\b(not found|does not exist)\b/i.test(message)) return "model";

  if (status === 401) return "credential";
  if (status === 403) return "permission";
  if (status === 404) return "model";
  if (status === 429) return "quota";
  return "provider";
}

function describe(kind: ProviderFailureKind, provider: AiProvider, model: string, raw: string) {
  const name = providerName[provider];
  const quoted = model ? `«${model}»` : "seleccionado";

  switch (kind) {
    case "credential":
      return `${name} no aceptó la API key. No es un problema del modelo: vuelve a pegar la clave en el Panel IA.`;
    case "model":
      return provider === "ollama"
        ? `El modelo ${quoted} no está descargado en Ollama. Ejecuta «ollama pull ${model}» o elige otro en el Panel IA.`
        : `El modelo ${quoted} no existe en ${name}. No es un problema de la credencial: revisa el identificador en el Panel IA, porque cambia cuando el proveedor publica modelos nuevos.`;
    case "permission":
      return `Tu cuenta de ${name} no tiene acceso al modelo ${quoted}.`;
    case "quota":
      return `${name} rechazó la solicitud por límite de uso o saldo agotado. Inténtalo más tarde.`;
    default:
      return raw.slice(0, 280) || `${name} rechazó la solicitud.`;
  }
}

/**
 * Traduce la respuesta de error de un proveedor a una causa con nombre.
 *
 * Nació de un coste real: el identificador de modelo por defecto no se había revisado desde que
 * se escribió, y un modelo retirado habría producido un fallo indistinguible a simple vista de
 * una clave inválida —ambos rechazan la primera llamada, ambos se leían como «el proveedor
 * rechazó la solicitud»—.
 */
export function classifyProviderFailure(
  provider: AiProvider,
  status: number,
  payload: unknown,
  model: string,
): ProviderFailure {
  const { code, message } = readDetail(payload);
  const kind = kindOf(status, code, message);
  return { kind, message: describe(kind, provider, model, message), status: statusByKind[kind] };
}
