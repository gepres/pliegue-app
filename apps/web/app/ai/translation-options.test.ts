import { describe, expect, it } from "vitest";

import { booksPerMonth, costPerBook, formatBookCost, translationOptions, translationProviderChoices } from "./translation-options";

const option = (id: string) => translationOptions.find((item) => item.id === id)!;

describe("lo que cuesta traducir un libro", () => {
  it("el traductor del navegador y Ollama no cuestan nada", () => {
    expect(costPerBook(option("browser").pricing)).toBe(0);
    expect(costPerBook(option("ollama").pricing)).toBe(0);
    expect(formatBookCost(0)).toBe("Gratis");
  });

  it("Azure cobra por caracteres: 550.000 a 10 $ el millón", () => {
    expect(costPerBook(option("azure").pricing)).toBeCloseTo(5.5, 5);
    // Su cupo gratuito cubre unos tres libros y medio al mes.
    expect(booksPerMonth(2_000_000)).toBe(3.6);
  });

  it("los LLM cobran por tokens de entrada y salida, y la salida es lo que más pesa", () => {
    const openai = costPerBook(option("openai").pricing);
    const gemini = costPerBook(option("gemini").pricing);
    const claude = costPerBook(option("anthropic").pricing);
    expect(openai).toBeCloseTo(0.0942, 3);
    expect(gemini).toBeCloseTo(0.4406, 3);
    expect(claude).toBeCloseTo(0.9419, 3);
    expect(openai).toBeLessThan(gemini);
    expect(gemini).toBeLessThan(claude);
    expect(claude).toBeLessThan(costPerBook(option("azure").pricing));
  });

  it("escribe el coste en dólares con la coma decimal", () => {
    expect(formatBookCost(0.0942)).toMatch(/^≈ 0,09\s?US\$$/);
  });
});

describe("DeepL y LibreTranslate en la comparativa (05.5)", () => {
  it("DeepL cobra por caracteres, a unos 25 $ el millón: un libro, unos 14 $", () => {
    const deepl = translationOptions.find((option) => option.id === "deepl")!;
    expect(costPerBook(deepl.pricing)).toBeCloseTo(13.75, 2);
  });

  it("LibreTranslate alojado por la persona sale gratis", () => {
    const libre = translationOptions.find((option) => option.id === "libretranslate")!;
    expect(costPerBook(libre.pricing)).toBe(0);
  });

  it("cada opción del selector está en la comparativa", () => {
    expect(translationOptions.map((option) => option.id).sort()).toEqual([...translationProviderChoices].sort());
  });
});
