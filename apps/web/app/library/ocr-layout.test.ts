import { describe, expect, it } from "vitest";

import { isProsePage, ocrPageLayout, type OcrParagraph } from "./ocr-layout";

/** Un párrafo de Tesseract: `lines` renglones de `lineHeight` px desde `top`, entre `left` y `right`. */
function paragraph(text: string, { confidence = 90, left = 100, lineHeight = 20, lines = 1, right = 900, top = 100 } = {}): OcrParagraph {
  return {
    bbox: { x0: left, x1: right, y0: top, y1: top + lines * lineHeight * 1.4 },
    confidence,
    lines: Array.from({ length: lines }, (_, index) => ({
      bbox: { x0: left, x1: right, y0: top + index * lineHeight * 1.4, y1: top + index * lineHeight * 1.4 + lineHeight },
    })),
    text,
  };
}

const prose =
  "El hombre que mira hacia dentro descubre que el pensamiento no es una voz aislada sino un campo que se extiende más allá del cerebro y se encuentra con el de los demás en cada encuentro.";

describe("una página escaneada leída con OCR, en bloques de la página (03.5b)", () => {
  it("pasa las cajas a la página, une los renglones y repara las palabras cortadas", () => {
    const layout = ocrPageLayout([paragraph("Capítulo uno\n", { left: 350, lineHeight: 40, right: 650, top: 80 }), paragraph(`Una pala-\nbra cortada y ${prose}`, { lines: 5, top: 200 })], 1000, 1400);
    expect(layout.blocks).toHaveLength(2);
    const [title, body] = layout.blocks;
    expect(title).toMatchObject({ centered: true, kind: "heading", lines: 1, text: "Capítulo uno" });
    expect(title!.box).toEqual({ height: 56 / 1400, width: 0.3, x: 0.35, y: 80 / 1400 });
    expect(body).toMatchObject({ centered: false, kind: "paragraph", lines: 5 });
    expect(body!.text.startsWith("Una palabra cortada y El hombre")).toBe(true);
    // El cuerpo es el alto de un renglón respecto de la página.
    expect(body!.lineHeight).toBeCloseTo(20 / 1400, 6);
  });

  it("deja fuera lo que Tesseract adivina y los restos de OCR", () => {
    const layout = ocrPageLayout(
      [
        paragraph(prose, { lines: 4, top: 100 }),
        paragraph("Wh 4 ~", { confidence: 30, top: 400 }), // una mancha del dibujo
        paragraph("h", { confidence: 80, top: 500 }), // una letra suelta
        paragraph("   ", { top: 600 }),
      ],
      1000,
      1400,
    );
    expect(layout.blocks.map((block) => block.text)).toEqual([prose]);
  });

  it("la confianza de la página pesa cada bloque por su texto", () => {
    const layout = ocrPageLayout([paragraph("a".repeat(30) + " bb", { confidence: 90 }), paragraph("c".repeat(10) + " dd", { confidence: 60, top: 300 })], 1000, 1400);
    expect(layout.confidence).toBe(Math.round((90 * 33 + 60 * 13) / 46));
    expect(ocrPageLayout([], 1000, 1400)).toEqual({ blocks: [], confidence: 0, prose: false, words: 0 });
  });

  it("un libro escaneado es prosa; una historieta o una lámina, no", () => {
    const book = ocrPageLayout(
      [paragraph(prose, { lines: 5, top: 100 }), paragraph(prose, { lines: 5, top: 300 }), paragraph(prose, { lines: 5, top: 500 })],
      1000,
      1400,
    );
    expect(book.words).toBeGreaterThanOrEqual(60);
    expect(book.prose).toBe(true);

    // Bocadillos: uno o dos renglones repartidos por la página, con letra dibujada.
    const bubbles = ["¿DÓNDE ESTÁ EL TEMPLO PERDIDO?", "MÁS ALLÁ DEL MAR, AL OESTE.", "¡VAMOS ALLÁ, AMIGOS!", "NO TENGO MIEDO DE NADA.", "LAS TABLILLAS HABLAN DE MU."];
    const comic = ocrPageLayout(
      bubbles.map((text, index) => paragraph(text, { confidence: 75, left: 80 + index * 60, lines: 2, right: 380 + index * 60, top: 100 + index * 250 })),
      1000,
      1400,
    );
    expect(comic.blocks).toHaveLength(5);
    expect(comic.prose).toBe(false);

    // Muchas palabras, pero mal leídas: mejor la imagen.
    expect(isProsePage([{ confidence: 50, lines: 6, text: prose.repeat(3) }])).toBe(false);
    // Bien leídas, pero sueltas: un índice o una lista de rótulos.
    expect(isProsePage(Array.from({ length: 30 }, () => ({ confidence: 92, lines: 1, text: "Rótulo con tres palabras" })))).toBe(false);
  });
});
