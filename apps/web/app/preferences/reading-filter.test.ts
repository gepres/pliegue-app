import { describe, expect, it } from "vitest";

import {
  defaultReadingFilter,
  dimLayer,
  focusBand,
  parseReadingFilter,
  readingFilterActive,
  toneLayersFor,
} from "./reading-filter";

describe("filtro de lectura", () => {
  it("lee lo guardado con cuidado: valores fuera de rango se ajustan y lo desconocido vuelve al valor de siempre", () => {
    expect(parseReadingFilter(null)).toEqual(defaultReadingFilter);
    expect(parseReadingFilter({ tone: "sepia" })).toEqual(defaultReadingFilter);
    expect(parseReadingFilter({ dim: 99, focus: "enorme", intensity: 3, pdfNight: "dark", tone: "warm", version: 1 })).toEqual({
      dim: 60,
      focus: "off",
      intensity: 10,
      pdfNight: "dark",
      tone: "warm",
      version: 1,
    });
  });

  it("cada tono son capas de color con la opacidad de la intensidad; sin tono, ninguna", () => {
    expect(toneLayersFor({ intensity: 50, tone: "none" })).toEqual([]);
    expect(toneLayersFor({ intensity: 50, tone: "sepia" })).toEqual([{ background: "rgb(240 222 186)", blend: "multiply", opacity: 0.5 }]);
    expect(toneLayersFor({ intensity: 100, tone: "warm" })[0]?.opacity).toBe(1);
    // Gris: primero quita el color, luego apaga el blanco.
    expect(toneLayersFor({ intensity: 60, tone: "gray" }).map((layer) => [layer.blend, layer.opacity])).toEqual([
      ["saturation", 0.6],
      ["multiply", 0.6],
    ]);
    expect(parseReadingFilter({ ...defaultReadingFilter, tone: "gray" }).tone).toBe("gray");
    expect(dimLayer({ dim: 0 })).toBeNull();
    expect(dimLayer({ dim: 30 })).toEqual({ opacity: 0.3 });
  });

  it("la banda del enfoque sigue al puntero sin salirse de la pantalla", () => {
    expect(focusBand(400, 800, "medium")).toEqual({ bottom: 456, height: 112, top: 344 });
    expect(focusBand(10, 800, "medium").top).toBe(0);
    expect(focusBand(795, 800, "wide")).toEqual({ bottom: 800, height: 180, top: 620 });
    expect(focusBand(50, 40, "wide")).toEqual({ bottom: 40, height: 40, top: 0 });
  });

  it("dice si hay algo activo", () => {
    expect(readingFilterActive(defaultReadingFilter)).toBe(false);
    expect(readingFilterActive({ ...defaultReadingFilter, pdfNight: "dark" })).toBe(true);
    expect(readingFilterActive({ ...defaultReadingFilter, focus: "narrow" })).toBe(true);
  });
});
