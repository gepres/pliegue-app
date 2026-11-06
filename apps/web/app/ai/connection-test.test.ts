import { describe, expect, it, vi } from "vitest";

import { connectionSignature, testConnection } from "./connection-test";
import fixtures from "./model-capabilities.fixtures.json";

const openAiKey = "sk-test-000000000000000000000000";

describe("«Probar conexión» en el navegador", () => {
  it("con Ollama dice si responde y si tiene el modelo descargado", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(Response.json(fixtures.ollama)));
    const ok = await testConnection(
      { model: "qwen3:4b", ollamaMode: "local", ollamaUrl: "", provider: "ollama" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("http://localhost:11434/api/show", expect.objectContaining({
      body: JSON.stringify({ model: "qwen3:4b" }), headers: { "content-type": "application/json" }, method: "POST",
    }));
    expect(ok).toEqual({
      capabilities: { structuredOutput: true, vision: false, embeddings: false, contextTokens: 32_768 },
      message: "Ollama responde en http://localhost:11434 y tiene «qwen3:4b» descargado.", ok: true,
    });

    fetchImpl.mockImplementationOnce(() => Promise.resolve(Response.json({ error: 'model "qwen3:8b" not found' }, { status: 404 })));
    const falta = await testConnection(
      { model: "qwen3:8b", ollamaMode: "local", ollamaUrl: "", provider: "ollama" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(falta.ok).toBe(false);
    expect(falta.message).toContain("ollama pull qwen3:8b");

    const caido = await testConnection(
      { model: "qwen3:4b", ollamaMode: "remote", ollamaUrl: "https://ollama.example.com/", provider: "ollama" },
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch,
    );
    expect(caido).toEqual({
      message:
        "No se pudo conectar con Ollama en https://ollama.example.com. Revisa que el servicio esté activo y que permita el origen de esta app.",
      ok: false,
    });
  });

  it("Ollama muestra las capacidades de embeddings o recurre a la tabla con una ficha antigua", async () => {
    const target = { model: "nomic-embed-text", ollamaMode: "remote", ollamaUrl: "https://ollama.example.com/", provider: "ollama" } as const;
    const show = vi.fn().mockResolvedValue(Response.json(fixtures.ollamaEmbedding));
    const result = await testConnection(target, show);
    expect(result.capabilities).toEqual({ structuredOutput: false, vision: false, embeddings: true, contextTokens: 8_192 });
    expect(show.mock.calls[0]?.[0]).toBe("https://ollama.example.com/api/show");
    expect((await testConnection(target, vi.fn().mockResolvedValue(Response.json({ details: { family: "nomic-bert" } })))).capabilities).toEqual({
      structuredOutput: false, vision: false, embeddings: true,
    });
  });

  it("una ficha rechazada de Ollama no presenta capacidades como si la prueba hubiera pasado", async () => {
    const result = await testConnection(
      { model: "qwen3:8b", ollamaMode: "local", ollamaUrl: "", provider: "ollama" },
      vi.fn().mockResolvedValue(Response.json({ error: "error interno" }, { status: 500 })),
    );
    expect(result.ok).toBe(false);
    expect(result.capabilities).toBeUndefined();
  });

  it("no prueba contra el Ollama local una URL remota a medio escribir", async () => {
    const fetchImpl = vi.fn();
    const result = await testConnection(
      { model: "qwen3:4b", ollamaMode: "remote", ollamaUrl: "ollama.example", provider: "ollama" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/URL de Ollama válida/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no envía nada sin clave, con una clave que no lo parece o sin modelo", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    expect((await testConnection({ apiKey: "", model: "gpt-x", provider: "openai" }, fetchImpl)).message).toBe(
      "Pega la clave de OpenAI antes de probar la conexión.",
    );
    expect((await testConnection({ apiKey: "esto es un texto pegado", model: "gpt-x", provider: "openai" }, fetchImpl)).ok).toBe(false);
    expect((await testConnection({ apiKey: openAiKey, model: " ", provider: "openai" }, fetchImpl)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("con un proveedor alojado pasa por la ruta de servidor y da el nombre del modelo si lo hay", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ modelName: "Claude Haiku 4.5", ok: true }));
    const result = await testConnection(
      { apiKey: "sk-ant-test-0000000000000000000000", model: "claude-haiku-4-5", provider: "anthropic" },
      fetchImpl as unknown as typeof fetch,
    );
    const [url, options] = fetchImpl.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("/api/ai/check");
    expect(JSON.parse(options.body as string)).toEqual({ model: "claude-haiku-4-5", provider: "anthropic" });
    expect(options.body).not.toContain("sk-ant");
    expect(result).toEqual({
      capabilities: { structuredOutput: true, vision: true, embeddings: false },
      message: "Anthropic acepta la clave y el modelo «claude-haiku-4-5» (Claude Haiku 4.5) está disponible.",
      ok: true,
    });
  });

  it("conserva las capacidades detectadas por la ruta, incluidos los false frente a la tabla", async () => {
    const capabilities = { structuredOutput: false, vision: false, embeddings: true, contextTokens: 12_000, maxOutputTokens: 1_000 };
    const result = await testConnection(
      { apiKey: openAiKey, model: "gpt-4o", provider: "openai" },
      vi.fn().mockResolvedValue(Response.json({ capabilities, modelName: null, ok: true })),
    );
    expect(result.capabilities).toEqual(capabilities);
  });

  it("muestra la causa que nombra la ruta cuando el proveedor rechaza", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ error: "OpenAI no aceptó la API key. No es un problema del modelo." }, { status: 401 }));
    const result = await testConnection({ apiKey: openAiKey, model: "gpt-x", provider: "openai" }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ message: "OpenAI no aceptó la API key. No es un problema del modelo.", ok: false });
  });

  it("el resultado caduca al cambiar la clave, el modelo o la región", () => {
    const base = connectionSignature({ apiKey: openAiKey, model: "gpt-x", provider: "openai" });
    expect(connectionSignature({ apiKey: openAiKey, model: "gpt-y", provider: "openai" })).not.toBe(base);
    expect(connectionSignature({ apiKey: `${openAiKey}1`, model: "gpt-x", provider: "openai" })).not.toBe(base);
    expect(connectionSignature({ apiKey: openAiKey, provider: "azure", region: "eastus" })).not.toBe(
      connectionSignature({ apiKey: openAiKey, provider: "azure", region: "westeurope" }),
    );
    const ollama = { model: "qwen3:8b", ollamaMode: "local", ollamaUrl: "", provider: "ollama" } as const;
    expect(connectionSignature(ollama)).not.toBe(connectionSignature({ ...ollama, model: "nomic-embed-text" }));
    expect(connectionSignature(ollama)).not.toBe(connectionSignature({ ...ollama, ollamaMode: "remote" }));
    expect(connectionSignature(ollama)).not.toBe(connectionSignature({ ...ollama, ollamaUrl: "https://ollama.example.com" }));
  });
});

describe("«Probar conexión» con LibreTranslate y DeepL (05.5)", () => {
  it("LibreTranslate traduce «Hola» desde el navegador y lo enseña", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ translatedText: "Hello" }));

    const result = await testConnection({ apiKey: "", provider: "libretranslate", url: "http://localhost:5000/" }, fetchImpl);

    expect(result).toEqual({ message: "LibreTranslate traduce en http://localhost:5000: «Hola» → «Hello».", ok: true });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:5000/translate");
  });

  it("LibreTranslate enseña el motivo que da el servidor, como el de pedir clave", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ error: "Visit https://portal.libretranslate.com to get an API key" }, { status: 400 }));

    const result = await testConnection({ apiKey: "", provider: "libretranslate", url: "https://libretranslate.com" }, fetchImpl);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("LibreTranslate respondió: «Visit https://portal.libretranslate.com");
  });

  it("una dirección que no es http(s) no sale del navegador", async () => {
    const fetchImpl = vi.fn();
    const result = await testConnection({ apiKey: "", provider: "libretranslate", url: "ftp://servidor" }, fetchImpl);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DeepL dice el plan y lo que lleva del cupo del mes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ characterCount: 1200, characterLimit: 500000, ok: true, plan: "Free" }));

    const result = await testConnection({ apiKey: "12345678-1234-1234-1234-123456789abc:fx", provider: "deepl" }, fetchImpl);

    expect(result).toEqual({ message: "DeepL acepta la clave (API Free): este mes lleva 1200 de 500.000 caracteres.", ok: true });
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ provider: "deepl" });
  });

  it("cambiar la dirección o la clave caduca el resultado", () => {
    const base = { apiKey: "", provider: "libretranslate", url: "http://localhost:5000" } as const;
    expect(connectionSignature(base)).not.toBe(connectionSignature({ ...base, url: "https://libretranslate.com" }));
    expect(connectionSignature({ apiKey: "a", provider: "deepl" })).not.toBe(connectionSignature({ apiKey: "b", provider: "deepl" }));
  });
});
