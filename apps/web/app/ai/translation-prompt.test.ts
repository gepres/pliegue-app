import { describe, expect, it } from "vitest";

import {
  batchPassages,
  createTranslationPrompt,
  isLanguageCode,
  parseTranslations,
  TranslationCountError,
  translationMaxOutputTokens,
  translationSystemPrompt,
  validPassages,
} from "./translation-prompt";

describe("lo que se pide a «Tu IA»", () => {
  it("nombra los idiomas y exige una traducción por pasaje, en orden", () => {
    const prompt = translationSystemPrompt("en", "es");
    expect(prompt).toContain("del inglés (en) al español (es)");
    expect(prompt).toContain("exactamente una traducción por pasaje, en el mismo orden");
    expect(JSON.parse(createTranslationPrompt(["Uno.", "Dos."]))).toEqual({ passages: ["Uno.", "Dos."] });
  });

  it("acepta códigos de idioma y rechaza lo demás", () => {
    expect(isLanguageCode("es")).toBe(true);
    expect(isLanguageCode("pt-BR")).toBe(true);
    expect(isLanguageCode("español")).toBe(false);
    expect(isLanguageCode("es; drop")).toBe(false);
  });
});

describe("la respuesta del modelo", () => {
  it("devuelve una traducción por pasaje", () => {
    expect(parseTranslations({ translations: ["Uno.", "Dos."] }, 2)).toEqual(["Uno.", "Dos."]);
  });

  it("avisa aparte cuando el modelo juntó o se saltó pasajes: el lote se parte y se repite", () => {
    expect(() => parseTranslations({ translations: ["Uno y dos."] }, 2)).toThrow(TranslationCountError);
    expect(() => parseTranslations({ translations: [1, 2] }, 2)).toThrow("lista de traducciones");
    expect(() => parseTranslations(null, 1)).toThrow("lista de traducciones");
    expect(new TranslationCountError(3, null).message).toContain("eran 3");
  });
});

describe("lotes", () => {
  it("reparte sin cambiar el orden y sin pasarse de los límites", () => {
    const limits = { characters: 10, passage: 10, passages: 3 };
    const passages = ["aaaa", "bbbb", "cc", "d", "e", "ffffffffff", "g"];
    // 4 + 4 + 2 llena justo el lote; tres pasajes es el máximo; el de 10 va solo.
    expect(batchPassages(passages, limits)).toEqual([[0, 1, 2], [3, 4], [5], [6]]);
    expect(batchPassages([], limits)).toEqual([]);
  });

  it("la ruta solo admite lotes de texto dentro de los límites", () => {
    expect(validPassages(["Uno.", "Dos."])).toBe(true);
    expect(validPassages([])).toBe(false);
    expect(validPassages(["Uno.", 2])).toBe(false);
    expect(validPassages(["x".repeat(4_001)])).toBe(false);
    expect(validPassages(["x".repeat(4_000), "x".repeat(4_000), "x"])).toBe(false);
  });

  it("reserva salida de sobra para el lote, con techo", () => {
    expect(translationMaxOutputTokens(1_000)).toBe(3_148);
    expect(translationMaxOutputTokens(100_000)).toBe(16_000);
  });
});
