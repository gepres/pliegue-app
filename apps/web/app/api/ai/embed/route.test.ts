import { afterEach, describe, expect, it, vi } from "vitest";

import { maxEmbedTexts, POST } from "./route";

const testKey = "sk-test-000000000000000000000000";

function request(body: Record<string, unknown>, apiKey = testKey) {
  return new Request("http://localhost/api/ai/embed", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    method: "POST",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ruta de embeddings (04.4)", () => {
  it("pide a OpenAI 768 dimensiones y devuelve un vector por texto con el uso", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ data: [{ embedding: [0.1, 0.2], index: 1 }, { embedding: [0.3, 0.4], index: 0 }], usage: { prompt_tokens: 12 } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ dimensions: 768, model: "text-embedding-3-small", provider: "openai", texts: ["uno", "dos"] }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { usage: { inputTokens: number }; vectors: number[][] };
    expect(payload.vectors).toEqual([[0.3, 0.4], [0.1, 0.2]]);
    expect(payload.usage.inputTokens).toBe(12);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ dimensions: 768, input: ["uno", "dos"], model: "text-embedding-3-small" });
  });

  it("a Gemini le dice si es un fragmento o una pregunta, y las dimensiones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ embeddings: [{ values: [1, 0] }] }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ dimensions: 768, model: "gemini-embedding-001", provider: "gemini", purpose: "query", texts: ["¿qué es?"] }));
    expect(response.status).toBe(200);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { requests: Array<Record<string, unknown>> };
    expect(sent.requests[0]).toMatchObject({ outputDimensionality: 768, taskType: "RETRIEVAL_QUERY" });
  });

  it("rechaza lo que no toca, sin llamar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cases = [
      request({ model: "x", provider: "anthropic", texts: ["a"] }),
      request({ model: "x", provider: "ollama", texts: ["a"] }),
      request({ model: "text-embedding-3-small", provider: "openai", texts: [] }),
      request({ model: "text-embedding-3-small", provider: "openai", texts: Array.from({ length: maxEmbedTexts + 1 }, () => "a") }),
      request({ model: "text-embedding-3-small", provider: "openai", texts: ["x".repeat(8_001)] }),
      request({ dimensions: 10, model: "text-embedding-3-small", provider: "openai", texts: ["a"] }),
      request({ model: "text-embedding-3-small", provider: "openai", purpose: "otra", texts: ["a"] }),
      request({ model: "text-embedding-3-small", provider: "openai", texts: ["a"] }, "no es una clave"),
    ];
    for (const item of cases) expect((await POST(item)).status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un modelo que no hace embeddings falla sin gastar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ model: "gpt-6-luna", provider: "openai", texts: ["a"] }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un límite del proveedor sale como en las demás rutas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "Rate limit" } }, { headers: { "retry-after": "7" }, status: 429 })));
    const response = await POST(request({ model: "text-embedding-3-small", provider: "openai", texts: ["a"] }));
    expect(response.status).toBe(429);
  });
});
