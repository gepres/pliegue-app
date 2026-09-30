import { describe, expect, it } from "vitest";

import {
  chunkBySentence,
  dominantColor,
  fitFontSize,
  hashText,
  inkFor,
  isListLike,
  isTranslatable,
  languageName,
  originalLeading,
  planTranslationQueue,
  translationPairId,
  translationPercent,
} from "./translation";

describe("unidades y bloques", () => {
  it("da la misma huella al mismo texto y otra distinta si cambia una letra", () => {
    expect(hashText("The island was empty.")).toBe(hashText("The island was empty."));
    expect(hashText("The island was empty.")).not.toBe(hashText("The island was empty!"));
  });

  it("reconoce las entradas de un índice, que se traducen renglón a renglón", () => {
    expect(isListLike(["The river valley 12", "A map of the coast 14"])).toBe(true);
    expect(isListLike(["Plates 3", "Figures 9", "and a note on the maps", "Index 30"])).toBe(true);
    // Prosa: acabar un renglón en una cifra de vez en cuando no la convierte en índice.
    expect(isListLike(["It happened in 1926", "and nobody noticed at the time."])).toBe(false);
    expect(isListLike(["Only one line 5"])).toBe(false);
  });

  it("no traduce lo que no tiene palabras", () => {
    expect(isTranslatable("12")).toBe(false);
    expect(isTranslatable("— 3 —")).toBe(false);
    expect(isTranslatable("Chapter 3")).toBe(true);
  });

  it("separa lo traducido por motor y par de idiomas", () => {
    expect(translationPairId("chrome", { source: "en", target: "es" })).toBe("chrome:en>es");
    expect(translationPairId("chrome", { source: "fr", target: "es" })).not.toBe("chrome:en>es");
  });
});

describe("troceado por frases", () => {
  const text = "The first sentence is short. The second one is a little longer than the first. A third closes the paragraph.";

  it("no parte lo que ya cabe", () => {
    expect(chunkBySentence(text, 500)).toEqual([text]);
  });

  it("junta frases enteras sin pasar del máximo", () => {
    const chunks = chunkBySentence(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 60)).toBe(true);
    expect(chunks.join(" ").replaceAll(/\s+/g, " ")).toBe(text);
  });

  it("corta por un espacio una frase que sola ya no cabe", () => {
    const long = `${"word ".repeat(40).trim()}.`;
    const chunks = chunkBySentence(long, 50);
    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });
});

describe("cola y avance", () => {
  it("prepara la página actual y las siguientes que falten", () => {
    expect(planTranslationQueue(10, 200, 5, new Set([11, 13]))).toEqual([10, 12, 14, 15]);
  });

  it("no se sale del libro", () => {
    expect(planTranslationQueue(198, 200, 5, new Set())).toEqual([198, 199, 200]);
  });

  it("solo marca el 100 % cuando no falta nada", () => {
    expect(translationPercent(0, 0)).toBe(0);
    expect(translationPercent(199, 200)).toBe(99);
    expect(translationPercent(200, 200)).toBe(100);
    expect(translationPercent(13, 200)).toBe(6);
  });
});

describe("color del papel", () => {
  /** Píxeles RGBA: `count` de cada color. */
  const pixels = (...colors: [number, number, number, number][]) =>
    colors.flatMap(([r, g, b, count]) => Array.from({ length: count }, () => [r, g, b, 255]).flat());

  it("toma el fondo y no la tinta: las letras ocupan poco de la caja", () => {
    // Papel amarillento con un 15 % de letra oscura.
    expect(dominantColor(pixels([242, 232, 205, 85], [30, 28, 25, 15]))).toEqual({ b: 205, g: 232, r: 242 });
  });

  it("sirve también para una portada oscura con letra clara", () => {
    const paper = dominantColor(pixels([24, 38, 66, 80], [214, 170, 80, 20]));
    expect(paper).toEqual({ b: 66, g: 38, r: 24 });
    expect(inkFor(paper!)).toBe("#f4efe6");
  });

  it("elige letra oscura sobre papel claro y no inventa un color sin píxeles", () => {
    expect(inkFor({ b: 250, g: 250, r: 250 })).toBe("#1d1b18");
    expect(dominantColor([])).toBeNull();
  });
});

describe("presentación", () => {
  it("nombra los idiomas en español", () => {
    expect(languageName("en")).toBe("inglés");
    expect(languageName("pt")).toBe("portugués");
  });

  it("copia el interlineado del original, dentro de límites razonables", () => {
    // Tres renglones de cuerpo 10 en una caja de 36: interlineado 1,2.
    expect(originalLeading(36, 3, 10)).toBeCloseTo(1.2);
    // Un solo renglón: la caja mide poco más que el cuerpo, y no baja de 1.
    expect(originalLeading(10.5, 1, 10)).toBeCloseTo(1.05);
    expect(originalLeading(8, 1, 10)).toBe(1);
    expect(originalLeading(80, 2, 10)).toBe(1.45);
  });

  it("encoge la letra para que la traducción quepa, sin crecer ni volverse ilegible", () => {
    const box = { height: 60, width: 300 };
    // Poco texto: se queda con el cuerpo original.
    expect(fitFontSize(box, 20, 12)).toBe(12);
    // Mucho texto: baja, pero nunca de la mitad.
    const tight = fitFontSize(box, 400, 12);
    expect(tight).toBeLessThan(12);
    expect(tight).toBeGreaterThanOrEqual(6);
    expect(fitFontSize(box, 100_000, 12)).toBe(6);
  });
});
