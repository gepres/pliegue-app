import { describe, expect, it } from "vitest";

import type { AiProvider } from "./document-catalog";
import fixtures from "./model-capabilities.fixtures.json";
import { fallbackModelCapabilities, parseModelCapabilities, resolveModelCapabilities } from "./model-capabilities";

describe("capacidades de reserva sin red", () => {
  it.each<[AiProvider, string, boolean, boolean, boolean]>([
    ["openai", "gpt-4o", true, true, false],
    ["openai", "gpt-4o-mini-2024-07-18", true, true, false],
    ["openai", "gpt-4o-2024-05-13", false, true, false],
    ["openai", "gpt-4.1", true, true, false],
    ["openai", "gpt-4.1-nano-2025-04-14", true, true, false],
    ["openai", "gpt-5", true, true, false],
    ["openai", "gpt-5.1", true, true, false],
    ["openai", "gpt-5.6-luna", true, true, false],
    ["openai", "o1-preview", false, false, false],
    ["openai", "o1-mini-2024-09-12", false, false, false],
    ["openai", "o1", true, true, false],
    ["openai", "o3-mini", true, false, false],
    ["openai", "o3", true, true, false],
    ["openai", "o4-mini", true, true, false],
    ["openai", "text-embedding-3-small", false, false, true],
    ["anthropic", "claude-sonnet-5", true, true, false],
    ["anthropic", "claude-haiku-4-5-20251001", true, true, false],
    ["anthropic", "claude-opus-4-6", true, true, false],
    ["gemini", "models/gemini-2.5-flash", true, true, false],
    ["gemini", "gemini-3.5-flash-lite", true, true, false],
    ["gemini", "gemini-3.8-flash", true, true, false],
    ["openai", "gpt-6.1-sol", true, true, false],
    ["anthropic", "claude-sonnet-5-5", true, true, false],
    ["gemini", "gemini-embedding-001", false, false, true],
    ["ollama", " QWEN3:8B ", true, false, false],
    ["ollama", "qwen3-vl:8b", true, true, false],
    ["ollama", "biblioteca/qwen3-coder:30b", true, false, false],
    ["ollama", "llama3:8b", true, false, false],
    ["ollama", "llama3.1:70b", true, false, false],
    ["ollama", "llama3.2:3b", true, false, false],
    ["ollama", "llama3.2:11b-instruct-q4_K_M", true, true, false],
    ["ollama", "llama3.2-vision:90b", true, true, false],
    ["ollama", "llama3.3:70b", true, false, false],
    ["ollama", "llava:7b", true, true, false],
    ["ollama", "nomic-embed-text:latest", false, false, true],
    ["ollama", "mxbai-embed-large:latest", false, false, true],
    ["ollama", "qwen3-embedding:8b", false, false, true],
  ])("%s / %s", (provider, model, structuredOutput, vision, embeddings) => {
    expect(fallbackModelCapabilities(provider, model)).toMatchObject({ structuredOutput, vision, embeddings });
  });

  it.each<[AiProvider, string]>([
    ["openai", "modelo-desconocido"], ["openai", "gpt-4o-audio-preview"], ["openai", "gpt-5-pro"],
    ["gemini", "gemini-2.5-flash-preview-tts"], ["ollama", "qwen30:8b"], ["ollama", "qwen3-reranker:8b"],
    ["openai", "claude-sonnet-5"], ["gemini", "gpt-4o"],
  ])("no adivina capacidades de %s / %s", (provider, model) => {
    expect(fallbackModelCapabilities(provider, model)).toEqual({
      structuredOutput: "desconocido", vision: "desconocido", embeddings: "desconocido",
    });
  });

  it("solo fija límites de familias conocidas y devuelve copias independientes", () => {
    const gpt = fallbackModelCapabilities("openai", "gpt-4o");
    expect(gpt.contextTokens).toBe(128_000);
    gpt.vision = false;
    expect(fallbackModelCapabilities("openai", "gpt-4o").vision).toBe(true);
    expect(fallbackModelCapabilities("openai", "gpt-4.1-mini")).toMatchObject({ contextTokens: 1_047_576, maxOutputTokens: 32_768 });
    expect(fallbackModelCapabilities("openai", "gpt-5.6-luna")).not.toHaveProperty("contextTokens");
    expect(fallbackModelCapabilities("ollama", "llama3.2:3b")).not.toHaveProperty("maxOutputTokens");
  });
});

describe("fichas de modelo grabadas (datos sintéticos con la forma de cada API)", () => {
  it("Gemini aporta los límites y los métodos; la tabla aporta visión y JSON", () => {
    expect(resolveModelCapabilities("gemini", fixtures.gemini.name, fixtures.gemini)).toEqual({
      structuredOutput: true, vision: true, embeddings: false, contextTokens: 1_048_576, maxOutputTokens: 65_536,
    });
  });

  it("embedContent detecta embeddings aunque el nombre parezca de generación", () => {
    expect(resolveModelCapabilities("gemini", "gemini-2.5-flash", fixtures.geminiEmbedding)).toMatchObject({
      structuredOutput: false, embeddings: true, contextTokens: 2_048,
    });
    expect(resolveModelCapabilities("gemini", "modelo-nuevo", { supportedGenerationMethods: ["generateContent"] })).toEqual({
      structuredOutput: "desconocido", vision: "desconocido", embeddings: false,
    });
  });

  it("Anthropic lee las capacidades anidadas y los dos límites", () => {
    expect(resolveModelCapabilities("anthropic", fixtures.anthropic.id, fixtures.anthropic)).toEqual({
      structuredOutput: true, vision: true, embeddings: false, contextTokens: 200_000, maxOutputTokens: 64_000,
    });
  });

  it("los false explícitos de Anthropic prevalecen y una ficha antigua conserva la reserva", () => {
    expect(resolveModelCapabilities("anthropic", fixtures.anthropic.id, {
      ...fixtures.anthropic, capabilities: { structured_outputs: { supported: false }, image_input: { supported: false } },
    })).toMatchObject({ structuredOutput: false, vision: false, embeddings: false });
    expect(resolveModelCapabilities("anthropic", fixtures.anthropicLegacy.id, fixtures.anthropicLegacy)).toEqual({
      structuredOutput: true, vision: true, embeddings: false,
    });
  });

  it("Ollama detecta generación con JSON, sin confundir herramientas y visión", () => {
    expect(resolveModelCapabilities("ollama", "modelo-propio", fixtures.ollama)).toEqual({
      structuredOutput: true, vision: false, embeddings: false, contextTokens: 32_768,
    });
    expect(resolveModelCapabilities("ollama", "qwen3:8b", { capabilities: ["tools"] }).structuredOutput).toBe(false);
  });

  it("Ollama detecta visión y embeddings, incluso si contradicen el nombre", () => {
    expect(resolveModelCapabilities("ollama", "llama3.2:11b", fixtures.ollamaVision)).toEqual({
      structuredOutput: true, vision: true, embeddings: false, contextTokens: 131_072,
    });
    expect(resolveModelCapabilities("ollama", "qwen3:8b", fixtures.ollamaEmbedding)).toEqual({
      structuredOutput: false, vision: false, embeddings: true, contextTokens: 8_192,
    });
  });

  it("prefiere el contexto de la arquitectura y admite otros nombres de arquitectura", () => {
    expect(resolveModelCapabilities("ollama", "modelo-propio", {
      model_info: { "otro.context_length": 10, "general.architecture": "nuevo", "nuevo.context_length": 42_000 },
    }).contextTokens).toBe(42_000);
    expect(resolveModelCapabilities("ollama", "modelo-propio", { model_info: { "nuevo.context_length": 8_192 } }).contextTokens).toBe(8_192);
  });

  it("OpenAI ignora metadatos sin contrato de capacidades y usa únicamente la tabla", () => {
    expect(resolveModelCapabilities("openai", "gpt-4o", { capabilities: ["embedding"], inputTokenLimit: 1 })).toEqual(
      fallbackModelCapabilities("openai", "gpt-4o"),
    );
  });

  it.each([null, [], "sin ficha", {}])("una ficha ausente o no válida (%j) no borra la reserva", (payload) => {
    for (const provider of ["openai", "anthropic", "gemini", "ollama"] as const) {
      const model = provider === "ollama" ? "qwen3:8b" : provider === "anthropic" ? "claude-sonnet-5"
        : provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o";
      expect(resolveModelCapabilities(provider, model, payload)).toEqual(fallbackModelCapabilities(provider, model));
    }
  });

  it("descarta límites y capacidades con tipos incorrectos, sin convertir ausencia en false", () => {
    expect(resolveModelCapabilities("gemini", "gemini-2.5-flash", {
      inputTokenLimit: "100", outputTokenLimit: -2, supportedGenerationMethods: [null],
    })).toEqual(fallbackModelCapabilities("gemini", "gemini-2.5-flash"));
    expect(resolveModelCapabilities("anthropic", "claude-sonnet-5", {
      max_input_tokens: 0, max_tokens: 1.5, capabilities: { image_input: { supported: "false" } },
    })).toEqual(fallbackModelCapabilities("anthropic", "claude-sonnet-5"));
    expect(resolveModelCapabilities("ollama", "qwen3:8b", {
      capabilities: "vision", model_info: { "qwen3.context_length": Infinity },
    })).toEqual(fallbackModelCapabilities("ollama", "qwen3:8b"));
  });

  it("valida las capacidades serializadas sin aceptar valores de verdad por coerción", () => {
    expect(parseModelCapabilities({ structuredOutput: false, vision: "desconocido", embeddings: "true", contextTokens: NaN, maxOutputTokens: 4_096 })).toEqual({
      structuredOutput: false, vision: "desconocido", maxOutputTokens: 4_096,
    });
  });
});
