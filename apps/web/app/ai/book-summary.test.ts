import { describe, expect, it } from "vitest";

import type { ChunkLocation } from "../library/chunking";
import {
  assembleSummary,
  createSummaryPartPrompt,
  createSummaryWholePrompt,
  estimateSummaryTokens,
  summaryIdeas,
  summaryNoteText,
  summaryParts,
  verifySummaryPart,
} from "./book-summary";
import type { AnswerFragment } from "./library-answer";

const page = (number: number): ChunkLocation => ({ end: 10, kind: "page", page: number, rects: [], start: 0 });
const fragment = (label: string, text: string, number = 1): AnswerFragment => ({ label, location: page(number), text, title: "Ficciones" });

describe("resumir un libro (04.5)", () => {
  it("parte el libro en tandas seguidas, sin pasar de los caracteres ni de los fragmentos", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ id: index, text: "x".repeat(1_000) }));
    expect(summaryParts(items, 3_500, 24).map((part) => part.map((item) => item.id))).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
    expect(summaryParts(items, 100_000, 4).map((part) => part.length)).toEqual([4, 4, 2]);
    expect(summaryParts([], 1_000, 4)).toEqual([]);
  });

  it("cada parte va con sus fragmentos etiquetados y su sitio, y dice qué parte es", () => {
    const prompt = createSummaryPartPrompt("Ficciones", 2, 5, [fragment("F1", "El jardín de senderos.", 12)]);
    expect(prompt).toContain("Libro: «Ficciones». Parte 2 de 5.");
    expect(prompt).toContain("[F1] p. 12\n<<<\nEl jardín de senderos.\n>>>");
  });

  it("de cada parte se queda con las ideas con cita comprobada; las inventadas se cuentan", () => {
    const fragments = [fragment("F1", "Ts'ui Pên construyó un laberinto infinito.", 3), fragment("F2", "Yu Tsun es un espía al servicio de Alemania.", 4)];
    const { dropped, points } = verifySummaryPart(
      {
        points: [
          { citations: [{ fragment: "F1", quote: "«construyó un LABERINTO infinito»" }, { fragment: "F9", quote: "no existe" }], text: "Un antepasado construyó un laberinto." },
          { citations: [{ fragment: "F2", quote: "un dragón lo vigila" }], text: "Un dragón lo vigila." },
          { citations: [{ fragment: "F2", quote: "es un espía" }], text: "  Yu Tsun   es espía. " },
        ],
      },
      fragments,
    );
    expect(points.map((point) => point.text)).toEqual(["Un antepasado construyó un laberinto.", "Yu Tsun es espía."]);
    // La cita que se enseña es la del libro, no la que escribió el modelo.
    expect(points[0]!.citations[0]!.quote).toBe("construyó un laberinto infinito");
    expect(dropped).toBe(2);
    expect(verifySummaryPart("nada", fragments)).toEqual({ dropped: 0, points: [] });
  });

  it("al juntar, cada punto lleva las citas comprobadas de sus ideas, sin repetir; sin ideas que existan, se descarta", () => {
    const f1 = fragment("F1", "Ts'ui Pên construyó un laberinto infinito.", 3);
    const f2 = fragment("F2", "Yu Tsun es un espía.", 40);
    const sources = [
      { citations: [{ fragment: f1, quote: "un laberinto infinito" }], text: "Laberinto." },
      { citations: [{ fragment: f2, quote: "es un espía" }], text: "Espía." },
    ];
    const ideas = summaryIdeas(sources);
    expect(ideas).toEqual([
      { label: "P1", text: "Laberinto.", where: "p. 3" },
      { label: "P2", text: "Espía.", where: "p. 40" },
    ]);
    expect(createSummaryWholePrompt("Ficciones", ideas)).toContain("[P2] (p. 40) Espía.");
    const assembled = assembleSummary(
      {
        points: [
          { sources: ["P1", "P2", "P1"], text: "Un espía y un laberinto." },
          { sources: ["P7"], text: "Algo que no se apoya en nada." },
          { sources: [], text: "Tampoco." },
        ],
        summary: "  Un espía   descubre un laberinto. ",
      },
      sources,
    );
    expect(assembled.summary).toBe("Un espía descubre un laberinto.");
    expect(assembled.points).toHaveLength(1);
    expect(assembled.points[0]!.citations.map((citation) => citation.quote)).toEqual(["un laberinto infinito", "es un espía"]);
    expect(assembled.unsupported).toBe(2);
  });

  it("la nota trae el resumen, los puntos con sus citas y su sitio, y de dónde sale", () => {
    const f1 = fragment("F1", "Ts'ui Pên construyó un laberinto infinito.", 3);
    const text = summaryNoteText(
      "Ficciones",
      { dropped: 0, points: [{ citations: [{ fragment: f1, quote: "un laberinto\ninfinito" }], text: "Hay un laberinto." }], summary: "Cuentos." },
      "claude-haiku-5-5",
    );
    expect(text).toBe(
      "Resumen de «Ficciones»\n\nCuentos.\n\n1. Hay un laberinto.\n   «un laberinto infinito» (p. 3)\n\n— Resumen del asistente de Pliegue (claude-haiku-5-5). Cada cita se comprobó en el libro.",
    );
  });

  it("avisa de lo que costará: crece con el libro, sobre todo en lo que se envía", () => {
    const small = estimateSummaryTokens(40_000, 2);
    const big = estimateSummaryTokens(1_000_000, 42);
    expect(small.inputTokens).toBeGreaterThan(10_000);
    expect(big.inputTokens).toBeGreaterThan(250_000);
    expect(big.outputTokens).toBeGreaterThan(small.outputTokens);
  });
});
