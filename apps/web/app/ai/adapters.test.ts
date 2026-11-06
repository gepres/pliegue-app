import { describe, expect, it, vi } from "vitest";

import { adapterFor, toBase64, UnsupportedOperationError } from "./adapters";
import { ProviderFailureError } from "./hosted-json";

/** Un `fetch` que guarda cada petición y contesta lo que se le diga, en orden. */
function fakeFetch(...replies: Array<{ body: unknown; headers?: Record<string, string>; status?: number }>) {
  const calls: Array<{ body: Record<string, unknown>; headers: Record<string, string>; url: string }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: (init?.headers ?? {}) as Record<string, string>,
      url: String(url),
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)] ?? { body: {} };
    return Response.json(reply.body, { headers: reply.headers ?? {}, status: reply.status ?? 200 });
  });
  return { calls, fetch: impl as unknown as typeof fetch };
}

const image = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), mimeType: "image/png" };
const imageBase64 = toBase64(image.bytes);
const schema = { properties: { caption: { type: "string" } }, required: ["caption"], type: "object" };

describe("interfaz común de IA (04.2)", () => {
  it("toBase64 da lo mismo que Buffer, sin necesitarlo", () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 251);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("generateJson con clave reutiliza la llamada de catalogar y traducir (OpenAI)", async () => {
    const { calls, fetch } = fakeFetch({ body: { output_text: '{"caption":"Un mapa"}', usage: { input_tokens: 12, output_tokens: 5 } } });
    const result = await adapterFor({ apiKey: "sk-test", fetch, model: "gpt-5", provider: "openai" }).generateJson({
      maxOutputTokens: 200,
      schema,
      schemaName: "pie",
      system: "Eres preciso.",
      user: "Describe.",
    });
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]!.headers.authorization).toBe("Bearer sk-test");
    expect(calls[0]!.body.text).toEqual({ format: { name: "pie", schema, strict: true, type: "json_schema" } });
    expect(result).toEqual({ json: { caption: "Un mapa" }, usage: { inputTokens: 12, outputTokens: 5 } });
  });

  it("generateJson con Ollama: /api/chat con el esquema en `format`, sin clave", async () => {
    const { calls, fetch } = fakeFetch({ body: { eval_count: 7, message: { content: '{"caption":"Hola"}' }, prompt_eval_count: 30 } });
    const result = await adapterFor({ baseUrl: "http://localhost:11434/", fetch, model: "qwen3:4b", provider: "ollama" }).generateJson({
      maxOutputTokens: 100,
      schema,
      schemaName: "pie",
      system: "S",
      user: "U",
    });
    expect(calls[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(calls[0]!.body).toMatchObject({ format: schema, model: "qwen3:4b", options: { num_predict: 100 }, stream: false });
    expect(result).toEqual({ json: { caption: "Hola" }, usage: { inputTokens: 30, outputTokens: 7 } });
  });

  it("describeImage: cada proveedor recibe la imagen en base64 a su manera", async () => {
    const instruction = "¿Qué se ve?";
    const openai = fakeFetch({ body: { output: [{ content: [{ text: "Un mapa", type: "output_text" }] }] } });
    expect((await adapterFor({ apiKey: "k", fetch: openai.fetch, model: "gpt-4o", provider: "openai" }).describeImage({ image, instruction, maxOutputTokens: 50 })).text).toBe("Un mapa");
    expect(openai.calls[0]!.body.input).toEqual([
      { content: [{ text: instruction, type: "input_text" }, { image_url: `data:image/png;base64,${imageBase64}`, type: "input_image" }], role: "user" },
    ]);

    const anthropic = fakeFetch({ body: { content: [{ text: '{"caption":"Un mapa"}', type: "text" }], usage: { input_tokens: 900, output_tokens: 9 } } });
    const described = await adapterFor({ apiKey: "k", fetch: anthropic.fetch, model: "claude-haiku-4-5", provider: "anthropic" }).describeImage({
      image,
      instruction,
      maxOutputTokens: 50,
      schema,
    });
    expect(described).toEqual({ json: { caption: "Un mapa" }, text: '{"caption":"Un mapa"}', usage: { inputTokens: 900, outputTokens: 9 } });
    expect(anthropic.calls[0]!.headers["x-api-key"]).toBe("k");
    expect((anthropic.calls[0]!.body.messages as Array<{ content: unknown[] }>)[0]!.content[0]).toEqual({
      source: { data: imageBase64, media_type: "image/png", type: "base64" },
      type: "image",
    });

    const gemini = fakeFetch({ body: { candidates: [{ content: { parts: [{ text: "pensando", thought: true }, { text: "Un mapa" }] } }] } });
    expect((await adapterFor({ apiKey: "k", fetch: gemini.fetch, model: "gemini-2.5-flash", provider: "gemini" }).describeImage({ image, instruction, maxOutputTokens: 50 })).text).toBe("Un mapa");
    expect(gemini.calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect((gemini.calls[0]!.body.contents as Array<{ parts: unknown[] }>)[0]!.parts[0]).toEqual({ inlineData: { data: imageBase64, mimeType: "image/png" } });

    const ollama = fakeFetch({ body: { message: { content: "Un mapa" } } });
    expect((await adapterFor({ fetch: ollama.fetch, model: "llava:7b", provider: "ollama" }).describeImage({ image, instruction, maxOutputTokens: 50 })).text).toBe("Un mapa");
    expect(ollama.calls[0]!.body.messages).toEqual([{ content: instruction, images: [imageBase64], role: "user" }]);
  });

  it("embed: un vector por texto y en orden, con OpenAI, Gemini y Ollama", async () => {
    const openai = fakeFetch({ body: { data: [{ embedding: [0.3, 0.4], index: 1 }, { embedding: [0.1, 0.2], index: 0 }], usage: { prompt_tokens: 6 } } });
    expect(await adapterFor({ apiKey: "k", fetch: openai.fetch, model: "text-embedding-3-small", provider: "openai" }).embed({ texts: ["uno", "dos"] })).toEqual({
      dimensions: 2,
      model: "text-embedding-3-small",
      usage: { inputTokens: 6, outputTokens: 0 },
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });
    expect(openai.calls[0]!.url).toBe("https://api.openai.com/v1/embeddings");

    const gemini = fakeFetch({ body: { embeddings: [{ values: [1, 2, 3] }, { values: [4, 5, 6] }] } });
    const geminiResult = await adapterFor({ apiKey: "k", fetch: gemini.fetch, model: "gemini-embedding-001", provider: "gemini" }).embed({ texts: ["a", "b"] });
    expect(geminiResult.vectors).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(gemini.calls[0]!.url).toContain("gemini-embedding-001:batchEmbedContents");
    expect(gemini.calls[0]!.body.requests).toEqual([
      { content: { parts: [{ text: "a" }] }, model: "models/gemini-embedding-001" },
      { content: { parts: [{ text: "b" }] }, model: "models/gemini-embedding-001" },
    ]);

    const ollama = fakeFetch({ body: { embeddings: [[0.5, 0.5]], prompt_eval_count: 3 } });
    expect((await adapterFor({ fetch: ollama.fetch, model: "nomic-embed-text", provider: "ollama" }).embed({ texts: ["hola"] })).vectors).toEqual([[0.5, 0.5]]);
    expect(ollama.calls[0]!.url).toBe("http://localhost:11434/api/embed");

    // Sin textos no se llama a nadie.
    const none = fakeFetch({ body: {} });
    expect((await adapterFor({ fetch: none.fetch, model: "nomic-embed-text", provider: "ollama" }).embed({ texts: [] })).vectors).toEqual([]);
    expect(none.calls).toHaveLength(0);
  });

  it("lo que el modelo no puede hacer falla sin llamar a la red", async () => {
    const { calls, fetch } = fakeFetch({ body: {} });
    await expect(adapterFor({ apiKey: "k", fetch, model: "claude-haiku-4-5", provider: "anthropic" }).embed({ texts: ["a"] })).rejects.toThrow(/Anthropic no ofrece embeddings/);
    await expect(
      adapterFor({ apiKey: "k", fetch, model: "text-embedding-3-small", provider: "openai" }).generateJson({ maxOutputTokens: 1, schema, schemaName: "x", system: "", user: "" }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapterFor({ fetch, model: "nomic-embed-text", provider: "ollama" }).describeImage({ image, instruction: "?", maxOutputTokens: 1 })).rejects.toThrow(/no puede describir imágenes/);
    await expect(adapterFor({ fetch, model: "qwen3:4b", provider: "ollama" }).embed({ texts: ["a"] })).rejects.toThrow(/no puede calcular embeddings/);
    expect(calls).toHaveLength(0);
  });

  it("los fallos del proveedor llegan como siempre: un 429 con Retry-After se puede reintentar", async () => {
    const { fetch } = fakeFetch({ body: { error: { message: "Rate limit reached" } }, headers: { "retry-after": "12" }, status: 429 });
    const failure = await adapterFor({ apiKey: "k", fetch, model: "text-embedding-3-small", provider: "openai" })
      .embed({ texts: ["a"] })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderFailureError);
    expect(failure).toMatchObject({ retryAfter: 12, retryable: true, status: 429 });
  });

  it("una petición cancelada se corta", async () => {
    const controller = new AbortController();
    controller.abort();
    const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return Response.json({});
    });
    await expect(
      adapterFor({ fetch: impl as unknown as typeof fetch, model: "nomic-embed-text", provider: "ollama" }).embed({ texts: ["a"] }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
