import { describe, expect, it } from "vitest";

import { abortableSleep, fetchWithRetry, type RetryWait } from "./ai-retry";

/** Un `fetch` que contesta en orden las respuestas dadas y cuenta las llamadas. */
function scripted(...responses: (() => Response)[]) {
  const calls: RequestInit[] = [];
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {});
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return next();
  }) as typeof fetch;
  return { calls, impl };
}

const json = (status: number, body: object, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json", ...headers }, status });

function recorder() {
  const waits: RetryWait[] = [];
  const slept: number[] = [];
  return {
    onWait: (wait: RetryWait) => waits.push(wait),
    sleep: async (milliseconds: number) => {
      slept.push(milliseconds);
    },
    slept,
    waits,
  };
}

describe("reintentar la IA ante fallos pasajeros (04.2)", () => {
  it("ante el límite por minuto espera lo que pide el proveedor, más un segundo, y vuelve a intentarlo", async () => {
    const { calls, impl } = scripted(json(429, { error: "Gemini limita…", retryAfter: 17, retryable: true }), json(200, { ok: true }));
    const r = recorder();
    const response = await fetchWithRetry("/api/ai/catalog", { method: "POST" }, { fetchImpl: impl, onWait: r.onWait, sleep: r.sleep });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(r.slept).toEqual([18_000]);
    expect(r.waits).toEqual([{ attempt: 2, reason: "rate", seconds: 18 }]);
  });

  it("sin espera pedida, 2, 4 y 8 segundos con algo de azar, y se rinde al cuarto intento", async () => {
    const { calls, impl } = scripted(json(503, { error: "Overloaded", retryable: true }));
    const r = recorder();
    const response = await fetchWithRetry("/x", {}, { fetchImpl: impl, random: () => 0.5, sleep: r.sleep });
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(4);
    expect(r.slept).toEqual([2_500, 4_500, 8_500]);
  });

  it("un límite por minuto sin espera pedida aguarda a que pase el minuto: 15, 30 y 45 segundos", async () => {
    const { calls, impl } = scripted(json(429, { error: "límite", retryable: true }));
    const r = recorder();
    await fetchWithRetry("/x", {}, { fetchImpl: impl, random: () => 0.5, sleep: r.sleep });
    expect(calls).toHaveLength(4);
    expect(r.slept).toEqual([15_500, 30_500, 45_500]);
  });

  it("lee también la cabecera Retry-After de un servicio que no es de Pliegue (LibreTranslate)", async () => {
    const { impl } = scripted(() => new Response("Too many requests", { headers: { "retry-after": "3" }, status: 429 }), json(200, {}));
    const r = recorder();
    await fetchWithRetry("/x", {}, { fetchImpl: impl, sleep: r.sleep });
    expect(r.slept).toEqual([4_000]);
  });

  it("no reintenta lo que esperar no arregla: cupo agotado, clave, modelo o error del navegador", async () => {
    for (const response of [json(429, { error: "cupo agotado", retryable: false }), json(401, { error: "clave" }), json(404, {}), json(400, {})]) {
      const { calls, impl } = scripted(response);
      await fetchWithRetry("/x", {}, { fetchImpl: impl, sleep: async () => undefined });
      expect(calls).toHaveLength(1);
    }
  });

  it("si el proveedor pide más espera de la que tiene sentido, devuelve el fallo sin esperar", async () => {
    const { calls, impl } = scripted(json(429, { retryAfter: 3600, retryable: true }));
    const r = recorder();
    const response = await fetchWithRetry("/x", {}, { fetchImpl: impl, sleep: r.sleep });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(1);
    expect(r.slept).toEqual([]);
  });

  it("detener corta la espera y la petición siguiente no sale", async () => {
    const controller = new AbortController();
    const { calls, impl } = scripted(json(429, { retryAfter: 5, retryable: true }), json(200, {}));
    const waiting = fetchWithRetry("/x", {}, { fetchImpl: impl, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(1);
    // La señal viaja con la petición, para cortarla también a ella.
    expect(calls[0]!.signal).toBe(controller.signal);
  });

  it("la espera sin señal termina sola", async () => {
    await expect(abortableSleep(5)).resolves.toBeUndefined();
  });
});
