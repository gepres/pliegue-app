import { describe, expect, it } from "vitest";

import { isLatinPage, looksLikeOcrNoise } from "./ocr-noise";

describe("restos de OCR sobre una ilustración (05.14)", () => {
  it("reconoce lo que el OCR leyó dentro del mapa de Mu", () => {
    for (const text of ["159 I Tax # 0911 ak", "OW", "t 200 leave", "103092E aD2009"]) {
      expect(looksLikeOcrNoise(text, true), text).toBe(true);
    }
  });

  it("reconoce otra escritura en una página latina, pero no en la suya", () => {
    expect(looksLikeOcrNoise("置 。", true)).toBe(true);
    expect(looksLikeOcrNoise("置 。", false)).toBe(false);
  });

  it("reconoce letras sueltas y fichas de letras y cifras mezcladas", () => {
    for (const text of ["h", "k", "LXX1 I1"]) {
      expect(looksLikeOcrNoise(text, true), text).toBe(true);
    }
  });

  it("deja el texto de verdad aunque sea corto, con cifras o en mayúsculas", () => {
    // Todos salieron de libros reales de la biblioteca de pruebas.
    for (const text of [
      "MAP OF MU",
      "THE LOST CONTINENT OF MU",
      "X CONCLUSIONES",
      "V",
      "I",
      "Capítulo 3",
      "Fig. 12",
      "Ibid., p. 23",
      "[5] Económico 3, 11-16. <<",
      "170 / Cristina Larrea",
      "1953dos americanos",
      "56FARMACIA",
      "Genio Nr.: 16",
      "static2.c",
      "1st Edition",
      "de",
      "a",
      "OR",
      "m itología",
      "char *buffer = (char *) malloc(160);",
    ]) {
      expect(looksLikeOcrNoise(text, true), text).toBe(false);
    }
  });

  it("no toca los números solos: un folio o un dato", () => {
    expect(looksLikeOcrNoise("38", true)).toBe(false);
    expect(looksLikeOcrNoise("1926 2,345 12 %", true)).toBe(false);
  });

  it("no mira los bloques largos: ahí el ruido se diluye en texto", () => {
    expect(
      looksLikeOcrNoise("“ There are great monuments, graven objects, hiero 38 with t # k", true),
    ).toBe(false);
  });

  it("decide si la página es latina por la mayoría de sus letras", () => {
    expect(isLatinPage(["The particles of atmosphere", "置 。"])).toBe(true);
    expect(isLatinPage(["置 。 東京 日本語の本"])).toBe(false);
    expect(isLatinPage(["38", "—"])).toBe(false);
  });
});
