import { normalizeOllamaUrl, normalizeServiceUrl, type AiSettings } from "./ai-settings";
import { checkApiKey, type HostedAiProvider } from "./api-key";
import { classifyProviderFailure } from "./provider-error";

/**
 * «Probar conexión» desde el Panel IA (04.1). Prueba lo que se ve en el formulario, aunque aún
 * no esté guardado: es lo que la persona acaba de escribir y quiere comprobar.
 *
 * - OpenAI, Anthropic y Gemini, por la ruta de servidor, como el resto de llamadas con clave.
 * - Azure Translator, por la misma ruta: traduce una palabra.
 * - DeepL, por la misma ruta: pregunta lo gastado del mes, sin traducir nada (05.5).
 * - Ollama, desde el navegador, como cuando cataloga: lista los modelos descargados.
 * - LibreTranslate, desde el navegador, como cuando traduce: traduce «Hola» (05.5).
 */

export type ConnectionTarget =
  | { apiKey: string; model: string; provider: HostedAiProvider }
  | { apiKey: string; provider: "azure"; region: string }
  | { apiKey: string; provider: "deepl" }
  | { apiKey: string; provider: "libretranslate"; url: string }
  | { model: string; ollamaMode: AiSettings["ollamaMode"]; ollamaUrl: string; provider: "ollama" };

export interface ConnectionTestResult {
  message: string;
  ok: boolean;
}

const providerNames: Record<ConnectionTarget["provider"], string> = {
  anthropic: "Anthropic",
  azure: "Azure Translator",
  deepl: "DeepL",
  gemini: "Gemini",
  libretranslate: "LibreTranslate",
  ollama: "Ollama",
  openai: "OpenAI",
};

/** Lo que identifica una prueba: si cambia la clave, el modelo o la región, el resultado caduca. */
export function connectionSignature(target: ConnectionTarget) {
  switch (target.provider) {
    case "azure":
      return `azure|${target.apiKey}|${target.region}`;
    case "deepl":
      return `deepl|${target.apiKey}`;
    case "libretranslate":
      return `libretranslate|${target.url}|${target.apiKey}`;
    case "ollama":
      return `ollama|${target.ollamaMode}|${target.ollamaUrl}|${target.model}`;
    default:
      return `${target.provider}|${target.apiKey}|${target.model}`;
  }
}

interface OllamaTag {
  model?: unknown;
  name?: unknown;
}

/**
 * ¿Tiene Ollama descargado el modelo? Un nombre sin etiqueta («qwen3») es el «:latest», como lo
 * resuelve el propio Ollama al pedirlo.
 */
export function ollamaHasModel(payload: unknown, model: string) {
  const wanted = model.trim().toLowerCase();
  if (!wanted) return false;
  const candidates = new Set([wanted, wanted.includes(":") ? wanted : `${wanted}:latest`]);
  const models = payload && typeof payload === "object" ? (payload as { models?: unknown }).models : null;
  if (!Array.isArray(models)) return false;
  return (models as OllamaTag[]).some((entry) =>
    [entry.name, entry.model].some((name) => typeof name === "string" && candidates.has(name.toLowerCase())),
  );
}

/** Una URL remota a medio escribir no debe probarse contra el Ollama local por descuido. */
function ollamaEndpoint(target: Extract<ConnectionTarget, { provider: "ollama" }>) {
  if (target.ollamaMode === "local") return normalizeOllamaUrl("", "local");
  try {
    const url = new URL(target.ollamaUrl.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  } catch {
    return null;
  }
  return normalizeOllamaUrl(target.ollamaUrl, "remote");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function testOllama(
  target: Extract<ConnectionTarget, { provider: "ollama" }>,
  fetchImpl: typeof fetch,
): Promise<ConnectionTestResult> {
  const model = target.model.trim();
  if (!model) return { message: "Escribe el modelo de Ollama antes de probar la conexión.", ok: false };
  const endpoint = ollamaEndpoint(target);
  if (!endpoint) return { message: "Escribe una URL de Ollama válida, que empiece por http:// o https://.", ok: false };

  let response: Response;
  try {
    response = await fetchImpl(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return {
      message: `No se pudo conectar con Ollama en ${endpoint}. Revisa que el servicio esté activo y que permita el origen de esta app.`,
      ok: false,
    };
  }
  const payload = await readJson(response);
  if (!response.ok) return { message: classifyProviderFailure("ollama", response.status, payload, model).message, ok: false };
  if (!ollamaHasModel(payload, model)) {
    // El mismo aviso que daría al catalogar, con la orden para descargarlo.
    return { message: classifyProviderFailure("ollama", 404, { error: `model "${model}" not found` }, model).message, ok: false };
  }
  return { message: `Ollama responde en ${endpoint} y tiene «${model}» descargado.`, ok: true };
}

/**
 * LibreTranslate, desde el navegador: traduce «Hola» del español al inglés. Comprueba a la vez
 * que la dirección responde, que permite esta web y, si hay clave, que la acepta.
 */
async function testLibreTranslate(
  target: Extract<ConnectionTarget, { provider: "libretranslate" }>,
  fetchImpl: typeof fetch,
): Promise<ConnectionTestResult> {
  const endpoint = normalizeServiceUrl(target.url, "");
  if (!endpoint) return { message: "Escribe una dirección de LibreTranslate válida, que empiece por http:// o https://.", ok: false };
  const apiKey = target.apiKey.trim();
  if (apiKey) {
    const keyError = checkApiKey("libretranslate", apiKey).error;
    if (keyError) return { message: keyError, ok: false };
  }

  let response: Response;
  try {
    response = await fetchImpl(`${endpoint}/translate`, {
      body: JSON.stringify({ format: "text", q: "Hola", source: "es", target: "en", ...(apiKey ? { api_key: apiKey } : {}) }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      message: `No se pudo conectar con LibreTranslate en ${endpoint}. Revisa la dirección, que el servidor esté en marcha y que permita esta web.`,
      ok: false,
    };
  }
  const payload = await readJson(response);
  if (!response.ok) {
    // libretranslate.com sin clave responde 400 con el motivo: se enseña tal cual.
    const reason = typeof payload.error === "string" ? payload.error : "";
    return {
      message: reason
        ? `LibreTranslate respondió: «${reason.slice(0, 200)}».`
        : classifyProviderFailure("libretranslate", response.status, payload, "").message,
      ok: false,
    };
  }
  const translated = typeof payload.translatedText === "string" ? payload.translatedText : "";
  return {
    message: `LibreTranslate traduce en ${endpoint}${apiKey ? " con tu clave" : ""}: «Hola» → «${translated.slice(0, 40)}».`,
    ok: true,
  };
}

export async function testConnection(
  target: ConnectionTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTestResult> {
  if (target.provider === "ollama") return testOllama(target, fetchImpl);
  if (target.provider === "libretranslate") return testLibreTranslate(target, fetchImpl);

  const name = providerNames[target.provider];
  if (!target.apiKey) return { message: `Pega la clave de ${name} antes de probar la conexión.`, ok: false };
  // La misma barrera que al analizar: un texto pegado por error no sale hacia el proveedor.
  const keyError = checkApiKey(target.provider, target.apiKey).error;
  if (keyError) return { message: keyError, ok: false };
  const model = target.provider === "azure" || target.provider === "deepl" ? "" : target.model.trim();
  if (target.provider !== "azure" && target.provider !== "deepl" && !model) {
    return { message: "Escribe el identificador del modelo antes de probar la conexión.", ok: false };
  }

  let response: Response;
  try {
    response = await fetchImpl("/api/ai/check", {
      body: JSON.stringify(
        target.provider === "azure"
          ? { provider: "azure", region: target.region }
          : target.provider === "deepl"
            ? { provider: "deepl" }
            : { model, provider: target.provider },
      ),
      headers: { authorization: `Bearer ${target.apiKey}`, "content-type": "application/json" },
      method: "POST",
    });
  } catch {
    return { message: "No se pudo comprobar: no hay conexión con Pliegue.", ok: false };
  }
  const payload = await readJson(response);
  if (!response.ok || payload.ok !== true) {
    return { message: typeof payload.error === "string" ? payload.error : `${name} no respondió.`, ok: false };
  }

  if (target.provider === "azure") {
    return {
      message: target.region
        ? `Azure Translator acepta la clave con la región «${target.region}».`
        : "Azure Translator acepta la clave (recurso global, sin región).",
      ok: true,
    };
  }
  if (target.provider === "deepl") {
    const used = typeof payload.characterCount === "number" ? payload.characterCount : null;
    const limit = typeof payload.characterLimit === "number" ? payload.characterLimit : null;
    const plan = payload.plan === "Free" ? "Free" : "Pro";
    const quota =
      used !== null && limit !== null
        ? `: este mes lleva ${used.toLocaleString("es")} de ${limit.toLocaleString("es")} caracteres`
        : "";
    return { message: `DeepL acepta la clave (API ${plan})${quota}.`, ok: true };
  }
  const modelName = typeof payload.modelName === "string" && payload.modelName ? ` (${payload.modelName})` : "";
  return { message: `${name} acepta la clave y el modelo «${model}»${modelName} está disponible.`, ok: true };
}
