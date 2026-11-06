import type { AiProvider } from "./document-catalog";

/**
 * Causas que la interfaz debe poder nombrar por separado. La distinción que importa es la
 * primera contra la segunda: un identificador de modelo caducado y una credencial mal pegada
 * fallan igual de pronto y, contados como «el proveedor rechazó la solicitud», llevan a revisar
 * la clave durante un rato antes de mirar el modelo.
 */
export type ProviderFailureKind = "credential" | "model" | "permission" | "provider" | "quota" | "rate";

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** Texto ya redactado para la persona: nombra la causa con sus palabras. */
  message: string;
  /**
   * Volver a intentarlo puede salir bien (04.2): un límite por minuto («rate») o el proveedor
   * saturado o caído un momento (500, 502, 503, 504, 529). Un cupo o saldo agotado, una clave o
   * un modelo, no.
   */
  retryable: boolean;
  /** Los segundos que el proveedor pide esperar, si lo dice; `null` si no. */
  retryAfter: number | null;
  /** Código con el que responder al navegador, para no aplanar toda causa en un 502. */
  status: number;
}

/** Quien responde: un proveedor de IA o un traductor (Azure, DeepL, LibreTranslate). */
export type FailingProvider = AiProvider | "azure" | "deepl" | "libretranslate";

const providerName: Record<FailingProvider, string> = {
  anthropic: "Anthropic",
  azure: "Azure Translator",
  deepl: "DeepL",
  gemini: "Gemini",
  libretranslate: "LibreTranslate",
  ollama: "Ollama",
  openai: "OpenAI",
};

const statusByKind: Record<ProviderFailureKind, number> = {
  credential: 401,
  model: 404,
  permission: 403,
  provider: 502,
  quota: 429,
  rate: 429,
};

/** Un fallo pasajero del proveedor: saturado (Anthropic responde 529) o caído un momento. */
const transientStatuses = new Set([500, 502, 503, 504, 529]);

/**
 * Cuánto pide esperar el proveedor, en segundos: la cabecera `retry-after` (segundos o fecha),
 * `retry-after-ms` de OpenAI, o el `RetryInfo` que Gemini mete en los detalles («17s»).
 */
export function readRetryAfter(headers: Pick<Headers, "get"> | null | undefined, payload: unknown, now = Date.now()): number | null {
  const milliseconds = Number(headers?.get("retry-after-ms"));
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.ceil(milliseconds / 1000);
  const header = headers?.get("retry-after")?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  }
  const delay = geminiDetails(payload)
    .map((detail) => (detail as { retryDelay?: unknown }).retryDelay)
    .find((value): value is string => typeof value === "string");
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  // Gemini a veces solo lo dice en el texto: «Please retry in 17.37s.»
  const said = /retry in ([\d.]+)\s*s/i.exec(readDetail(payload).message)?.[1];
  const fromText = said ? Number.parseFloat(said) : Number.NaN;
  return Number.isFinite(fromText) && fromText >= 0 ? Math.ceil(fromText) : null;
}

/**
 * Lo que dice el proveedor de la cuota que se agotó, para enseñarlo tal cual: «Quota exceeded
 * for metric: …free_tier_requests, limit: 15, model: …». Sin esto, «Por qué fallaron» no
 * distinguía un límite por minuto de un modelo sin cupo gratis (lo vio el dueño, 6-nov).
 */
function quotaDetail(raw: string) {
  const metric = /quota exceeded for metric:\s*([^\n]+)/i.exec(raw)?.[1];
  const text = (metric ?? raw.split("\n")[0] ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return text ? ` Detalle del proveedor: «${text}».` : "";
}

/** Gemini sin cupo gratis para el modelo: «limit: 0». Esperar no sirve, ni hoy ni mañana. */
const zeroLimit = (message: string) => /\blimit:\s*0\b/i.test(message);

/**
 * Sin saldo: «Your prepayment credits are depleted» (Gemini con facturación de prepago y el
 * crédito a cero), «insufficient balance», «billing»… Esperar no sirve: hay que recargar.
 */
const outOfCredit = (message: string) =>
  /prepayment credits? (are|is) depleted|credits? (are|is) depleted|insufficient (balance|credit|funds)|credit balance is too low|billing (account|details)? ?(is |are )?(disabled|required|not active)/i.test(
    message,
  );

function geminiDetails(payload: unknown): unknown[] {
  const details = (payload as { error?: { details?: unknown } } | null)?.error?.details;
  return Array.isArray(details) ? details : [];
}

/** Gemini dice en los detalles qué cuota se agotó: la del día o del mes no se arregla esperando un minuto. */
function geminiDailyQuota(payload: unknown) {
  return geminiDetails(payload).some((detail) => {
    const violations = (detail as { violations?: unknown }).violations;
    return (
      Array.isArray(violations) &&
      violations.some((violation) => /per(day|month)/i.test(String((violation as { quotaId?: unknown }).quotaId ?? "")))
    );
  });
}

/** El detalle del fallo llega con forma distinta en cada proveedor; aquí se reduce a lo común. */
function readDetail(payload: unknown) {
  if (typeof payload === "string") return { code: "", message: payload };
  if (!payload || typeof payload !== "object") return { code: "", message: "" };

  const error = (payload as { error?: unknown }).error;
  // Ollama contesta con `error` como texto plano; OpenAI y Anthropic con un objeto.
  if (typeof error === "string") return { code: "", message: error };
  if (!error || typeof error !== "object") return { code: "", message: "" };

  // Gemini trae el código numérico en `code` y el nombre en `status` («RESOURCE_EXHAUSTED»).
  const detail = error as { code?: unknown; message?: unknown; status?: unknown; type?: unknown };
  const code = [detail.code, detail.type, detail.status].find((value) => typeof value === "string");
  return {
    code: typeof code === "string" ? code : "",
    message: typeof detail.message === "string" ? detail.message : "",
  };
}

function kindOf(status: number, code: string, message: string, payload: unknown): ProviderFailureKind {
  // El código del proveedor manda sobre el estado: OpenAI ha devuelto «model_not_found»
  // acompañado tanto de 404 como de 400 según la ruta.
  if (code === "model_not_found" || code === "not_found_error") return "model";
  if (code === "invalid_api_key" || code === "authentication_error") return "credential";
  // Sin saldo o sin cupo: OpenAI «insufficient_quota»; Anthropic, 402 «billing_error».
  if (code === "insufficient_quota" || code === "billing_error") return "quota";
  // El texto manda sobre el código cuando habla de dinero: Gemini responde 429
  // RESOURCE_EXHAUSTED con «Your prepayment credits are depleted» (lo vio el dueño, 6-nov), y
  // reintentar no lo arregla.
  if (outOfCredit(message)) return "quota";
  // Demasiadas solicitudes por minuto: se arregla esperando (04.2).
  if (code === "rate_limit_error" || code === "rate_limit_exceeded") return "rate";
  if (code === "permission_error") return "permission";
  // Gemini: nombres de gRPC. Una clave mal puesta llega como 400 «API key not valid».
  if (code === "UNAUTHENTICATED" || /api key not valid/i.test(message)) return "credential";
  // Gemini usa el mismo nombre para el límite por minuto y para la cuota del día: la distinguen
  // los detalles. «limit: 0» es un modelo sin cupo gratis: tampoco se arregla esperando. Sin
  // nada de eso, se toma por límite por minuto, que es lo frecuente en el plan gratis.
  if (code === "RESOURCE_EXHAUSTED") return geminiDailyQuota(payload) || zeroLimit(message) ? "quota" : "rate";
  if (code === "PERMISSION_DENIED") return "permission";
  if (code === "NOT_FOUND") return "model";

  // Ollama no envía código: nombra el modelo que le falta dentro del texto.
  if (/\bmodel\b.*\b(not found|does not exist)\b/i.test(message)) return "model";

  if (status === 401) return "credential";
  if (status === 403) return "permission";
  if (status === 404) return "model";
  if (status === 429) return "rate";
  return "provider";
}

function describe(kind: ProviderFailureKind, provider: FailingProvider, model: string, raw: string, daily = false) {
  const name = providerName[provider];
  const quoted = model ? `«${model}»` : "seleccionado";

  switch (kind) {
    case "credential":
      return provider === "azure"
        ? `${name} no aceptó la clave. Comprueba la clave y la región del recurso en Ajustes: con una región que no es la suya, Azure también la rechaza.`
        : provider === "deepl" || provider === "libretranslate"
          ? `${name} no aceptó la clave. Vuelve a pegarla en Ajustes → IA.`
          : `${name} no aceptó la API key. No es un problema del modelo: vuelve a pegar la clave en el Panel IA.`;
    case "model":
      return provider === "ollama"
        ? `El modelo ${quoted} no está descargado en Ollama. Ejecuta «ollama pull ${model}» o elige otro en el Panel IA.`
        : `El modelo ${quoted} no existe en ${name}. No es un problema de la credencial: revisa el identificador en el Panel IA, porque cambia cuando el proveedor publica modelos nuevos.`;
    case "permission":
      return `Tu cuenta de ${name} no tiene acceso al modelo ${quoted}.`;
    case "quota":
      if (provider === "gemini" && zeroLimit(raw)) {
        return `Tu proyecto de Gemini no tiene cupo gratis para el modelo ${quoted} (límite 0): esperar no lo arregla. Elige otro modelo en Ajustes → IA o activa la facturación en Google AI Studio.${quotaDetail(raw)}`;
      }
      if (daily) {
        return `Se agotó el cupo diario de Gemini para el modelo ${quoted}: se renueva a medianoche, hora del Pacífico. Hasta entonces, elige otro modelo en Ajustes → IA.${quotaDetail(raw)}`;
      }
      if (provider === "gemini" && outOfCredit(raw)) {
        return `Tu proyecto de Gemini se quedó sin crédito prepagado: esperar no lo arregla. Recárgalo en Google AI Studio (Facturación) o usa una clave de un proyecto sin facturación, con el plan gratis.${quotaDetail(raw)}`;
      }
      return `${name} rechazó la solicitud por cupo o saldo agotado. Esperar unos segundos no lo arregla: revisa tu plan, o vuelve cuando se renueve el cupo.${quotaDetail(raw)}`;
    case "rate":
      return `${name} rechazó la solicitud por su límite de solicitudes por minuto.${quotaDetail(raw)}`;
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
  provider: FailingProvider,
  status: number,
  payload: unknown,
  model: string,
  headers?: Pick<Headers, "get"> | null,
): ProviderFailure {
  const { code, message } = readDetail(payload);
  // Azure responde 403 cuando se acabó el cupo gratuito del mes: es cupo, no permiso. DeepL usa
  // su propio 456 para el cupo agotado y 403 para la clave.
  const kind =
    provider === "azure" && status === 403
      ? "quota"
      : provider === "deepl" && status === 456
        ? "quota"
        : provider === "deepl" && status === 403
          ? "credential"
          : code === "overloaded_error"
            ? "provider"
            : kindOf(status, code, message, payload);
  const transient = kind === "provider" && (transientStatuses.has(status) || code === "overloaded_error");
  return {
    kind,
    message: describe(kind, provider, model, message, provider === "gemini" && geminiDailyQuota(payload)),
    retryable: kind === "rate" || transient,
    retryAfter: kind === "rate" || transient ? readRetryAfter(headers, payload) : null,
    // Un fallo pasajero responde 503: el navegador lo reintenta, igual que un límite por minuto.
    status: transient ? 503 : statusByKind[kind],
  };
}
