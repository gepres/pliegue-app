import { describe, expect, it } from "vitest";

import { askModelOf, askProviderOf, defaultAiSettings, indexProviderOf, parseAiSettings, type AiSettings } from "./ai-settings";
import { embeddingConfigOf } from "./embeddings";
import { flowEngine, outcomeLabel, routerMatrix } from "./flow-router";

const settings = (patch: Partial<AiSettings>): AiSettings => ({ ...defaultAiSettings, ...patch });

describe("proveedor por flujo (04.3)", () => {
  it("buscar y preguntar siguen al de catalogar mientras no se elija otro", () => {
    const value = settings({ provider: "gemini" });
    expect(indexProviderOf(value)).toBe("gemini");
    expect(askProviderOf(value)).toBe("gemini");
    expect(embeddingConfigOf(value)).toMatchObject({ model: "gemini-embedding-001", provider: "gemini" });
  });

  it("con Claude para catalogar, se puede buscar con Ollama y preguntar con Claude", () => {
    const value = settings({ askProvider: "catalog", indexProvider: "ollama", provider: "anthropic" });
    expect(embeddingConfigOf(value)).toMatchObject({ model: "embeddinggemma", place: "device", provider: "ollama" });
    expect(askProviderOf(value)).toBe("anthropic");
    expect(askModelOf(value)).toBe(defaultAiSettings.askModels.anthropic);
  });

  it("«solo por palabras» no calcula embeddings con nadie; Claude, tampoco", () => {
    expect(embeddingConfigOf(settings({ indexProvider: "off", provider: "openai" }))).toBeNull();
    expect(indexProviderOf(settings({ indexProvider: "off" }))).toBeNull();
    expect(embeddingConfigOf(settings({ indexProvider: "catalog", provider: "anthropic" }))).toBeNull();
  });

  it("preguntar con otro proveedor usa su modelo de preguntar, no el de catalogar", () => {
    const value = settings({
      askModels: { ...defaultAiSettings.askModels, openai: "gpt-6" },
      askProvider: "openai",
      models: { ...defaultAiSettings.models, openai: "gpt-6-luna" },
      provider: "gemini",
    });
    expect(askProviderOf(value)).toBe("openai");
    expect(askModelOf(value)).toBe("gpt-6");
  });

  it("los ajustes de antes (sin modelos de preguntar) siguen preguntando con el modelo de catalogar", () => {
    const parsed = parseAiSettings({ models: { openai: "gpt-6" }, provider: "openai" });
    expect(parsed.askModels.openai).toBe("gpt-6");
    expect(parsed.askProvider).toBe("catalog");
    expect(parsed.indexProvider).toBe("catalog");
  });

  it("un modelo elegido para preguntar se respeta, aunque antes fuera uno de partida", () => {
    // Revisión de Codex: `claude-sonnet-5` es de partida antiguo para catalogar, no para preguntar.
    const chosen = parseAiSettings({ askModels: { anthropic: "claude-sonnet-5" }, askProvider: "anthropic" });
    expect(chosen.askModels.anthropic).toBe("claude-sonnet-5");
    // Heredado de los ajustes de antes, sí pasa al de ahora, como el de catalogar.
    const inherited = parseAiSettings({ models: { anthropic: "claude-sonnet-5" }, provider: "anthropic" });
    expect(inherited.askModels.anthropic).toBe("claude-haiku-5-5");
    expect(inherited.models.anthropic).toBe("claude-haiku-5-5");
  });

  it("descarta elecciones que no existen: Claude no busca por significado", () => {
    const parsed = parseAiSettings({ askProvider: "deepl", indexProvider: "anthropic" });
    expect(parsed.indexProvider).toBe("catalog");
    expect(parsed.askProvider).toBe("catalog");
    expect(parseAiSettings({ askProvider: "ollama", indexProvider: "off" })).toMatchObject({ askProvider: "ollama", indexProvider: "off" });
  });
});

describe("la tabla del router (04.3)", () => {
  it("por defecto: cada flujo en la nube del de catalogar, salvo traducir, que va en el equipo", () => {
    const rows = routerMatrix(defaultAiSettings);
    expect(rows.map((row) => row.flow)).toEqual(["catalog", "translate", "index", "ask"]);
    const translate = rows.find((row) => row.flow === "translate")!;
    expect(translate).toMatchObject({ engine: "browser", place: "device", where: "En este equipo" });
    expect(Object.values(translate.outcomes)).toEqual(["local", "local", "local", "local"]);
    const catalog = rows.find((row) => row.flow === "catalog")!;
    expect(catalog).toMatchObject({ engine: "openai", model: "gpt-6-luna", place: "cloud", where: "En la nube de OpenAI" });
    expect(catalog.outcomes).toEqual({ confidencial: "block", interno: "allow", personal: "ask", publico: "allow" });
  });

  it("con Ollama en este equipo, nada se bloquea; en un servidor, es la nube", () => {
    const local = routerMatrix(settings({ ollamaMode: "local", provider: "ollama" })).find((row) => row.flow === "ask")!;
    expect(local.outcomes.confidencial).toBe("local");
    const remote = routerMatrix(
      settings({ ollamaMode: "remote", ollamaUrl: "https://ollama.ejemplo.com", provider: "ollama" }),
    ).find((row) => row.flow === "ask")!;
    expect(remote).toMatchObject({ place: "cloud", where: "En tu servidor de Ollama" });
    expect(remote.outcomes.confidencial).toBe("block");
  });

  it("buscar solo por palabras no lo hace nadie y no sale nada", () => {
    const index = routerMatrix(settings({ indexProvider: "off" })).find((row) => row.flow === "index")!;
    expect(index).toMatchObject({ engine: null, place: null });
    expect(new Set(Object.values(index.outcomes))).toEqual(new Set(["off"]));
    expect(outcomeLabel("index", "off")).toBe("Solo por palabras");
  });

  it("Azure dice su región; LibreTranslate, su dirección", () => {
    const azure = routerMatrix(settings({ azureRegion: "westeurope", translationProvider: "azure" })).find((row) => row.flow === "translate")!;
    expect(azure.where).toBe("En la nube de Azure (westeurope)");
    expect(flowEngine(settings({ translationProvider: "azure" }), "translate").model).toBeNull();
    const libre = routerMatrix(settings({ translationProvider: "libretranslate" })).find((row) => row.flow === "translate")!;
    expect(libre.where).toBe("En libretranslate.com");
  });

  it("lo bloqueado se explica con lo que hace cada flujo", () => {
    expect(outcomeLabel("catalog", "block")).toBe("No sale: sin ficha");
    expect(outcomeLabel("index", "block")).toBe("No sale: solo por palabras");
    expect(outcomeLabel("ask", "ask")).toBe("Pregunta una vez");
  });
});
