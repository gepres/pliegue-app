import { describe, expect, it } from "vitest";

import {
  booksPerMonth,
  costPerBook,
  formatBookCost,
  translationNeedsKey,
  translationOptions,
  translationProviderChoices,
  unreachableServiceMessage,
} from "./translation-options";

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
    // Precios del 6-nov-2026: gpt-6-luna y Claude Haiku 5.5 cuestan lo mismo (0,10 / 0,50).
    expect(openai).toBeCloseTo(0.0942, 3);
    expect(claude).toBeCloseTo(0.0942, 3);
    expect(gemini).toBeCloseTo(0.4406, 3);
    expect(claude).toBeLessThan(gemini);
    expect(gemini).toBeLessThan(costPerBook(option("azure").pricing));
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

describe("LibreTranslate sin clave y desde la web segura (05.5)", () => {
  it("solo piden clave los que van por el servidor de Pliegue: LibreTranslate no", () => {
    const needing = translationProviderChoices.filter(translationNeedsKey);
    expect(needing).toEqual(["azure", "deepl", "openai", "anthropic", "gemini"]);
  });

  it("desde https, un LibreTranslate en http de la red se explica como bloqueo del navegador", () => {
    expect(unreachableServiceMessage("LibreTranslate", "http://192.168.1.20:5000", "https:")).toBe(
      "El navegador no deja que esta web, que va por https, llame a LibreTranslate en http://192.168.1.20:5000. Ponlo tras https:// o en este mismo equipo (http://localhost).",
    );
    // En el propio equipo sí se puede, y desde http (en local) no hay bloqueo: el aviso de siempre.
    for (const [endpoint, protocol] of [
      ["http://localhost:5000", "https:"],
      ["http://127.0.0.1:5000", "https:"],
      ["http://192.168.1.20:5000", "http:"],
      ["https://libre.example.org", "https:"],
    ] as const) {
      expect(unreachableServiceMessage("LibreTranslate", endpoint, protocol)).toMatch(/^No se pudo conectar con LibreTranslate en /);
    }
  });
});
