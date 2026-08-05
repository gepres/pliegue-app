import { describe, expect, it } from "vitest";

import {
  defaultAiSettings,
  maxCatalogConcurrency,
  normalizeOllamaUrl,
  parseAiSettings,
} from "./ai-settings";

describe("AI settings", () => {
  it("mantiene valores seguros por defecto", () => {
    expect(parseAiSettings(null)).toEqual(defaultAiSettings);
    expect(defaultAiSettings.autoAnalyzeAfterLink).toBe(false);
    expect(defaultAiSettings.ollamaUrl).toBe("http://localhost:11434");
  });

  it("limita concurrencia y tamaño de extracto", () => {
    expect(
      parseAiSettings({
        concurrency: 99,
        maxExcerptCharacters: 99_000,
        models: {},
        provider: "anthropic",
      }),
    ).toMatchObject({
      concurrency: maxCatalogConcurrency,
      maxExcerptCharacters: 24_000,
      provider: "anthropic",
    });
  });

  it("rechaza protocolos no HTTP para un Ollama remoto", () => {
    expect(normalizeOllamaUrl("file:///tmp/ollama", "remote")).toBe(
      defaultAiSettings.ollamaUrl,
    );
    expect(normalizeOllamaUrl("https://ollama.example.test/", "remote")).toBe(
      "https://ollama.example.test",
    );
    expect(normalizeOllamaUrl("https://user:secret@ollama.example.test", "remote")).toBe(
      defaultAiSettings.ollamaUrl,
    );
  });
});
