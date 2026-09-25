import { describe, expect, it } from "vitest";

import { defaultReaderView, parseReaderView, readerMeasureCharacters } from "./reader-view";

describe("vista del lector", () => {
  it("abre con la medida normal", () => {
    expect(defaultReaderView.measure).toBe("normal");
  });

  it("conserva una medida válida", () => {
    expect(parseReaderView({ measure: "wide", version: 1 })).toEqual({
      measure: "wide",
      version: 1,
    });
  });

  it("descarta lo que no reconoce", () => {
    for (const stored of [null, "ancho", [], { measure: "wide", version: 2 }]) {
      expect(parseReaderView(stored)).toEqual(defaultReaderView);
    }
    expect(parseReaderView({ measure: "gigante", version: 1 })).toEqual(defaultReaderView);
  });

  it("mantiene todas las medidas dentro del máximo de WCAG 1.4.8", () => {
    for (const characters of Object.values(readerMeasureCharacters)) {
      expect(characters).toBeLessThanOrEqual(80);
    }
  });
});
