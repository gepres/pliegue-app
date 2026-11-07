/**
 * Descargar un modelo de Ollama desde Ajustes, sin abrir la terminal (04.2b): `POST /api/pull`
 * con `stream: true` devuelve una línea JSON por paso («pulling manifest», una por capa con
 * `total` y `completed`, «verifying sha256 digest», «success»). Se habla con Ollama desde el
 * navegador, como al catalogar y traducir: necesita que Ollama permita esta web (OLLAMA_ORIGINS).
 */

/** El que se recomienda: gratis, en el equipo, y bueno para catalogar y traducir. */
export const recommendedOllamaModel = { memoryGb: 16, name: "qwen3:8b", sizeGb: 5.2 } as const;

export interface PullProgress {
  /** De 0 a 1, o null mientras no se sabe cuánto pesa. */
  fraction: number | null;
  status: string;
}

const statusNames: Array<[RegExp, string]> = [
  [/^pulling manifest/, "Preparando la descarga…"],
  [/^pulling /, "Descargando…"],
  [/^verifying/, "Comprobando lo descargado…"],
  [/^writing manifest|^removing/, "Terminando…"],
  [/^success/, "Descargado"],
];

export function describePullStatus(status: string) {
  return statusNames.find(([pattern]) => pattern.test(status))?.[1] ?? "Descargando…";
}

/** Lleva la cuenta de las capas: el avance es lo bajado de todas sobre lo que pesan todas. */
export function pullTracker() {
  const totals = new Map<string, number>();
  const done = new Map<string, number>();
  return {
    /** Una línea de la respuesta. Lanza si Ollama dice que hubo un error. */
    line(text: string): PullProgress | null {
      if (!text.trim()) return null;
      let event: { completed?: unknown; digest?: unknown; error?: unknown; status?: unknown; total?: unknown };
      try {
        event = JSON.parse(text);
      } catch {
        return null;
      }
      if (typeof event.error === "string") throw new Error(event.error);
      if (typeof event.digest === "string" && typeof event.total === "number") {
        totals.set(event.digest, event.total);
        if (typeof event.completed === "number") done.set(event.digest, event.completed);
      }
      const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
      const completed = [...done.values()].reduce((sum, value) => sum + value, 0);
      const status = typeof event.status === "string" ? event.status : "";
      return {
        fraction: status === "success" ? 1 : total > 0 ? Math.min(1, completed / total) : null,
        status: describePullStatus(status),
      };
    },
  };
}

const base = (url: string) => url.replace(/\/$/, "");

/** ¿Está ya descargado? `null` si Ollama no responde (apagado, o no permite esta web). */
export async function ollamaHasModel(url: string, model: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    const response = await fetch(`${base(url)}/api/show`, {
      body: JSON.stringify({ model }),
      headers: { "content-type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    if (response.ok) return true;
    return response.status === 404 ? false : null;
  } catch {
    if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
    return null;
  }
}

/** Descarga un modelo, avisando del avance. Se puede cancelar con `signal`. */
export async function pullOllamaModel(url: string, model: string, onProgress: (progress: PullProgress) => void, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${base(url)}/api/pull`, {
      body: JSON.stringify({ model, stream: true }),
      headers: { "content-type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Ollama no responde en ${url}: comprueba que esté abierto y que permita esta web (OLLAMA_ORIGINS).`);
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // Texto tal cual.
    }
    throw new Error(message ? `Ollama no pudo descargar ${model}: ${message}` : `Ollama no pudo descargar ${model}.`);
  }
  const tracker = pullTracker();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = pending.split("\n");
    pending = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const progress = tracker.line(line);
      if (progress) onProgress(progress);
    }
    if (done) break;
  }
}
