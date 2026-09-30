import { describe, expect, it } from "vitest";

import {
  addCatalogUsage,
  createCatalogPrompt,
  emptyCatalogUsage,
  maxKnownAuthorsInPrompt,
  readCatalogUsage,
} from "./document-catalog";

const input = {
  excerpt: "Portada y créditos del documento.",
  format: "pdf",
  path: "Filosofía/obra.pdf",
  title: "obra",
};

describe("lectura del consumo", () => {
  it("lee el par de OpenAI y Anthropic bajo «usage»", () => {
    expect(readCatalogUsage({ usage: { input_tokens: 1200, output_tokens: 340 } })).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
    });
  });

  it("lee los contadores que Ollama deja en la raíz de la respuesta", () => {
    expect(readCatalogUsage({ eval_count: 210, prompt_eval_count: 900 })).toEqual({
      inputTokens: 900,
      outputTokens: 210,
    });
  });

  it("acepta la nomenclatura de las APIs de completions", () => {
    expect(readCatalogUsage({ usage: { completion_tokens: 12, prompt_tokens: 34 } })).toEqual({
      inputTokens: 34,
      outputTokens: 12,
    });
  });

  it("devuelve cero en vez de inventar una cifra cuando el proveedor no informa", () => {
    expect(readCatalogUsage({})).toEqual(emptyCatalogUsage);
    expect(readCatalogUsage(null)).toEqual(emptyCatalogUsage);
    expect(readCatalogUsage({ usage: { input_tokens: "muchos" } })).toEqual(emptyCatalogUsage);
  });

  it("suma el consumo de varias llamadas", () => {
    expect(
      addCatalogUsage({ inputTokens: 100, outputTokens: 20 }, { inputTokens: 5, outputTokens: 1 }),
    ).toEqual({ inputTokens: 105, outputTokens: 21 });
  });
});

describe("autores conocidos en el prompt", () => {
  it("los incluye para que el modelo reutilice la grafía establecida", () => {
    const prompt = createCatalogPrompt({
      ...input,
      knownAuthors: ["Jacobo Grinberg-Zylberbaum", "Marco Aurelio"],
    });

    expect(prompt).toContain("Autores ya presentes en el catálogo:");
    expect(prompt).toContain("Jacobo Grinberg-Zylberbaum; Marco Aurelio");
  });

  it("no menciona la lista cuando el catálogo todavía está vacío", () => {
    expect(createCatalogPrompt(input)).not.toContain("Autores ya presentes");
  });

  it("conserva el extracto y la ruta", () => {
    const prompt = createCatalogPrompt({ ...input, knownAuthors: ["Marco Aurelio"] });
    expect(prompt).toContain("Ruta relativa: Filosofía/obra.pdf");
    expect(prompt).toContain("Portada y créditos del documento.");
  });

  it("acota cuántos autores viajan para no encarecer cada llamada", () => {
    expect(maxKnownAuthorsInPrompt).toBeLessThanOrEqual(60);
  });
});
