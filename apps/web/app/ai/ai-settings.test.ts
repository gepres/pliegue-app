import { describe, expect, it } from "vitest";

import {
  defaultAiSettings,
  maxCatalogConcurrency,
  normalizeAzureRegion,
  normalizeOllamaUrl,
  parseAiSettings,
  translationProviderOf,
} from "./ai-settings";

describe("AI settings", () => {
  it("traduce con el navegador mientras no se elija una IA, y la IA puede ser otra que la de catalogar", () => {
    // El predeterminado es el traductor del navegador, aunque se catalogue con una IA.
    expect(defaultAiSettings.translationProvider).toBe("browser");
    expect(translationProviderOf(parseAiSettings({ provider: "anthropic" }))).toBe("browser");
    expect(translationProviderOf(parseAiSettings({ provider: "anthropic", translationProvider: null }))).toBe("browser");
    expect(translationProviderOf(parseAiSettings({ translationProvider: "azure" }))).toBe("azure");
    const separate = parseAiSettings({ provider: "anthropic", translationProvider: "gemini" });
    expect(translationProviderOf(separate)).toBe("gemini");
    expect(separate.provider).toBe("anthropic");
    // Un valor que no es un proveedor vuelve a «el mismo».
    expect(parseAiSettings({ provider: "openai", translationProvider: "babel" }).translationProvider).toBe("browser");
    // La región de Azure: una palabra en minúsculas; lo demás se descarta.
    expect(normalizeAzureRegion("  WestEurope ")).toBe("westeurope");
    expect(normalizeAzureRegion("west europe")).toBe("");
    expect(parseAiSettings({ azureRegion: "eastus2" }).azureRegion).toBe("eastus2");
  });

  it("guarda aparte el modelo para traducir, con los más baratos por defecto", () => {
    expect(defaultAiSettings.translationModels).toEqual({
      anthropic: "claude-haiku-4-5",
      gemini: "gemini-3.5-flash-lite",
      ollama: "qwen3:8b",
      openai: "gpt-6-luna",
    });
    // Ajustes guardados antes de que existiera: toman los de por defecto.
    expect(parseAiSettings({ provider: "gemini" }).translationModels).toEqual(defaultAiSettings.translationModels);
    const parsed = parseAiSettings({ provider: "gemini", translationModels: { gemini: "  gemini-3.8-flash  ", openai: 3 } });
    expect(parsed.provider).toBe("gemini");
    expect(parsed.translationModels.gemini).toBe("gemini-3.8-flash");
    expect(parsed.translationModels.openai).toBe("gpt-6-luna");
    expect(parsed.models.gemini).toBe("gemini-3.5-flash-lite");
  });

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

describe("la dirección de LibreTranslate (05.5)", () => {
  it("parte de libretranslate.com y guarda la de la persona sin barra final", () => {
    expect(parseAiSettings({}).libreTranslateUrl).toBe("https://libretranslate.com");
    expect(parseAiSettings({ libreTranslateUrl: " http://localhost:5000/ " }).libreTranslateUrl).toBe("http://localhost:5000");
  });

  it("descarta lo que no es http(s) o trae credenciales", () => {
    expect(parseAiSettings({ libreTranslateUrl: "javascript:alert(1)" }).libreTranslateUrl).toBe("https://libretranslate.com");
    expect(parseAiSettings({ libreTranslateUrl: "https://yo:clave@servidor" }).libreTranslateUrl).toBe("https://libretranslate.com");
  });

  it("acepta DeepL y LibreTranslate como traductor", () => {
    expect(parseAiSettings({ translationProvider: "deepl" }).translationProvider).toBe("deepl");
    expect(parseAiSettings({ translationProvider: "libretranslate" }).translationProvider).toBe("libretranslate");
  });
});
