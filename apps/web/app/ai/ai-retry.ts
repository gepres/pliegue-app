/**
 * Volver a intentar una llamada a la IA cuando el fallo es pasajero (04.2): un límite de
 * solicitudes por minuto (429) o el proveedor saturado o caído un momento (502, 503, 504, 529).
 *
 * Nació de un fallo real: con el plan gratis de Gemini, catalogar varios libros a la vez daba
 * «3 con error» por el límite por minuto, y bastaba con esperar unos segundos. Espera lo que el
 * proveedor pide (`Retry-After`, o `retryAfter` en la respuesta de las rutas de Pliegue) o, si
 * no lo dice, 15, 30 y 45 segundos ante un límite por minuto y 2, 4 y 8 ante un proveedor
 * saturado, con algo de azar para que varias peticiones no vuelvan a la vez. Lo que no tiene arreglo esperando —cupo o saldo agotados, la clave, el modelo— no se
 * reintenta: las rutas lo marcan con `retryable: false`.
 *
 * Reintenta en el navegador y no en el servidor: allí cada espera alargaría la función, que
 * tiene un tiempo máximo. Y se puede detener: la señal corta la petición y también la espera.
 */

export interface RetryWait {
  /** Intento que viene, contando desde 2. */
  attempt: number;
  /** Por qué se espera: el límite por minuto, o el proveedor saturado o caído. */
  reason: "busy" | "rate";
  seconds: number;
}

export interface RetryOptions {
  /** Intentos en total, contando el primero. */
  attempts?: number;
  fetchImpl?: typeof fetch;
  /** Más espera que esta no se hace: se devuelve el fallo, que lo explica. */
  maxWaitSeconds?: number;
  onWait?: (wait: RetryWait) => void;
  random?: () => number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const retryableStatuses = new Set([429, 502, 503, 504, 529]);

/** Espera que se corta con la señal, como un `fetch`: con un `AbortError`. */
export function abortableSleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Se detuvo.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Se detuvo.", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Lo que la respuesta dice de sí misma: si admite reintento y cuánto esperar. */
async function retryHints(response: Response) {
  // Solo si viene: `Number(null)` es 0, y se leería como «sin esperar».
  const raw = response.headers.get("retry-after");
  const header = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  let body: { retryAfter?: unknown; retryable?: unknown } = {};
  try {
    body = (await response.clone().json()) as typeof body;
  } catch {
    body = {};
  }
  const after = typeof body.retryAfter === "number" ? body.retryAfter : Number.isFinite(header) && header >= 0 ? header : null;
  return { retryAfter: after, retryable: typeof body.retryable === "boolean" ? body.retryable : null };
}

/**
 * `fetch` con reintentos ante fallos pasajeros. Devuelve la última respuesta, buena o mala: quien
 * llama sigue leyendo el error como siempre.
 */
export async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const {
    attempts = 4,
    fetchImpl = fetch,
    maxWaitSeconds = 60,
    onWait,
    random = Math.random,
    signal,
    sleep = abortableSleep,
  } = options;

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchImpl(input, signal ? { ...init, signal } : init);
    if (response.ok || attempt >= attempts || !retryableStatuses.has(response.status)) return response;
    const { retryAfter, retryable } = await retryHints(response);
    if (retryable === false) return response;
    // Lo que pide el proveedor, con un segundo de margen. Si no pide nada: un límite por minuto
    // necesita que pase la ventana del minuto (15, 30 y 45 s); un proveedor saturado, poco (2, 4,
    // 8 s). Con algo de azar, para que varias peticiones no vuelvan a la vez.
    const fallback = response.status === 429 ? Math.min(60, 15 * attempt) : Math.min(30, 2 ** attempt);
    const seconds = retryAfter !== null ? retryAfter + 1 : fallback + random();
    if (seconds > maxWaitSeconds) return response;
    onWait?.({ attempt: attempt + 1, reason: response.status === 429 ? "rate" : "busy", seconds: Math.ceil(seconds) });
    await sleep(seconds * 1000, signal);
  }
}
