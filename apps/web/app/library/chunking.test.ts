import { describe, expect, it } from "vitest";

import {
  chunkMaxCharacters,
  chunkPdfPages,
  chunkSections,
  chunkTargetCharacters,
  describeLocation,
  rectsForRange,
  splitLongText,
  type PdfLayoutPage,
} from "./chunking";
import { layoutPageText } from "./pdf-text-extractor";

const sentence = (n: number) => `Esta es la frase número ${n} del libro, con algo de texto para llenar.`;
const paragraph = (from: number, count: number) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

describe("trocear un libro (04.4)", () => {
  it("parte un párrafo enorme por frases sin pasarse del máximo", () => {
    const pieces = splitLongText(paragraph(1, 80));
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.every((piece) => piece.length <= chunkMaxCharacters)).toBe(true);
    expect(pieces.join(" ")).toBe(paragraph(1, 80));
  });

  it("una frase sin puntos de miles de caracteres se parte por palabras", () => {
    const pieces = splitLongText("palabra ".repeat(800).trim());
    expect(pieces.every((piece) => piece.length <= chunkTargetCharacters + 10)).toBe(true);
  });

  it("en EPUB y DOCX: un título abre fragmento, no se cruza de sección y los bloques se cuentan sin imágenes", () => {
    const chunks = chunkSections([
      {
        blocks: [
          { kind: "heading", level: 1, text: "Capítulo 1" },
          { kind: "heading", level: 2, text: "El jardín" },
          { kind: "paragraph", text: paragraph(1, 6) },
          { alt: "Mapa del jardín", kind: "image" },
          { kind: "paragraph", text: paragraph(7, 6) },
          { kind: "heading", level: 2, text: "La biblioteca" },
          { kind: "paragraph", text: paragraph(20, 3) },
          { kind: "table", rows: [["Año", "Obra"], ["1944", "Ficciones"]] },
        ],
        id: "c1",
        title: "Capítulo 1",
      },
      { blocks: [{ kind: "paragraph", text: "Otra sección." }], id: "c2", title: "" },
    ]);
    // Capítulo + subtítulo van juntos con su texto; «La biblioteca» abre otro.
    expect(chunks[0]?.text.startsWith("Capítulo 1\nEl jardín\n")).toBe(true);
    const library = chunks.find((chunk) => chunk.text.startsWith("La biblioteca"));
    expect(library?.text).toContain("1944 | Ficciones");
    expect(library?.location).toMatchObject({ blockEnd: 6, blockStart: 4, kind: "section", section: 0 });
    expect(chunks.some((chunk) => chunk.text.includes("[Imagen: Mapa del jardín]"))).toBe(true);
    const last = chunks.at(-1)!;
    expect(last.location).toMatchObject({ kind: "section", section: 1, sectionId: "c2" });
    expect(describeLocation(last.location)).toBe("Sección 2");
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => chunk.text.length <= chunkMaxCharacters)).toBe(true);
  });

  it("la misma sección da los mismos fragmentos y huellas (para reindexar solo lo que cambió)", () => {
    const sections = [{ blocks: [{ kind: "paragraph" as const, text: paragraph(1, 40) }], id: "a", title: "A" }];
    const first = chunkSections(sections);
    const again = chunkSections(sections);
    expect(again.map((chunk) => chunk.hash)).toEqual(first.map((chunk) => chunk.hash));
    const changed = chunkSections([{ ...sections[0]!, blocks: [{ kind: "paragraph", text: paragraph(1, 40).replace("número 39", "número treinta y nueve") }] }]);
    const kept = changed.filter((chunk) => first.some((old) => old.hash === chunk.hash));
    expect(kept.length).toBe(first.length - 1);
  });

  it("en PDF: no cruza de página y sabe su página, su tramo y sus rectángulos", () => {
    const pageText = (n: number) => `${paragraph(n, 10)}\n\n${paragraph(n + 10, 10)}`;
    const pages: PdfLayoutPage[] = [1, 2].map((number) => {
      const text = pageText(number * 100);
      const middle = text.indexOf("\n\n");
      return {
        items: [
          { end: middle, rect: { h: 0.02, w: 0.8, x: 0.1, y: 0.1 }, start: 0 },
          { end: text.length, rect: { h: 0.02, w: 0.8, x: 0.1, y: 0.5 }, start: middle + 2 },
        ],
        number,
        text,
      };
    });
    const chunks = chunkPdfPages(pages);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.location.kind).toBe("page");
      if (chunk.location.kind !== "page") continue;
      const page = pages.find((p) => p.number === (chunk.location as { page: number }).page)!;
      // El tramo apunta al texto del fragmento dentro de su página.
      expect(page.text.slice(chunk.location.start, chunk.location.end).replace(/\n/g, " ")).toContain(chunk.text.slice(0, 40));
      expect(chunk.location.rects.length).toBeGreaterThan(0);
    }
    expect(new Set(chunks.map((chunk) => (chunk.location as { page: number }).page))).toEqual(new Set([1, 2]));
    expect(describeLocation(chunks[0]!.location)).toBe("p. 1");
  });

  it("un párrafo enorme de un PDF se parte y cada trozo lleva su propio tramo y sus renglones", () => {
    const text = paragraph(1, 60);
    // Un trozo por frase, cada uno en su renglón.
    const items: PdfLayoutPage["items"] = [];
    let at = 0;
    let line = 0;
    for (const match of text.matchAll(/[^.]+\.\s*/g)) {
      items.push({ end: at + match[0].trimEnd().length, rect: { h: 0.01, w: 0.8, x: 0.1, y: 0.05 + line * 0.012 }, start: at });
      at += match[0].length;
      line += 1;
    }
    const chunks = chunkPdfPages([{ items, number: 1, text }]);
    expect(chunks.length).toBeGreaterThan(1);
    const ranges = chunks.map((chunk) => chunk.location as { end: number; rects: unknown[]; start: number });
    for (const [index, chunk] of chunks.entries()) {
      const range = ranges[index]!;
      expect(text.slice(range.start, range.end)).toBe(chunk.text);
      // Solo sus renglones, no los del párrafo entero.
      expect(range.rects.length).toBeLessThan(items.length);
    }
    for (let index = 1; index < ranges.length; index += 1) expect(ranges[index]!.start).toBeGreaterThanOrEqual(ranges[index - 1]!.end);
  });

  it("dos columnas a la misma altura no se juntan en un renglón", () => {
    const rects = rectsForRange(
      [
        { end: 5, rect: { h: 0.02, w: 0.4, x: 0.05, y: 0.1 }, start: 0 },
        { end: 10, rect: { h: 0.02, w: 0.4, x: 0.55, y: 0.1 }, start: 5 },
      ],
      0,
      10,
    );
    expect(rects).toHaveLength(2);
  });

  it("junta en un rectángulo los trozos del mismo renglón", () => {
    const rects = rectsForRange(
      [
        { end: 5, rect: { h: 0.02, w: 0.1, x: 0.1, y: 0.1 }, start: 0 },
        { end: 10, rect: { h: 0.02, w: 0.1, x: 0.21, y: 0.101 }, start: 5 },
        { end: 15, rect: { h: 0.02, w: 0.3, x: 0.1, y: 0.2 }, start: 10 },
        { end: 25, rect: { h: 0.02, w: 0.3, x: 0.1, y: 0.3 }, start: 20 },
      ],
      0,
      15,
    );
    expect(rects).toEqual([
      { h: 0.021, w: 0.21, x: 0.1, y: 0.1 },
      { h: 0.02, w: 0.3, x: 0.1, y: 0.2 },
    ]);
  });

  it("la maqueta de una página de pdf.js: texto como el de siempre y cada trozo en su sitio", () => {
    // Una página de 600 × 800 sin girar: pdf.js da y desde abajo; el visor, desde arriba.
    const viewport = { height: 800, transform: [1, 0, 0, -1, 0, 800], width: 600 };
    const layout = layoutPageText(
      [
        { height: 12, hasEOL: false, str: "Hola  ", transform: [12, 0, 0, 12, 60, 700], width: 40 },
        { height: 12, hasEOL: true, str: " mundo", transform: [12, 0, 0, 12, 100, 700], width: 50 },
        { hasEOL: true, str: "" },
        { height: 12, hasEOL: false, str: "Segundo\tpárrafo", transform: [12, 0, 0, 12, 60, 650], width: 120 },
      ],
      viewport,
    );
    expect(layout.text).toBe("Hola mundo\n\nSegundo párrafo");
    expect(layout.items).toHaveLength(3);
    const [first, second, third] = layout.items;
    expect(layout.text.slice(first!.start, first!.end)).toBe("Hola");
    expect(layout.text.slice(second!.start, second!.end)).toBe("mundo");
    expect(layout.text.slice(third!.start, third!.end)).toBe("Segundo párrafo");
    expect(first!.rect.x).toBeCloseTo(0.1);
    expect(first!.rect.y).toBeCloseTo((800 - 712) / 800);
    expect(first!.rect.h).toBeCloseTo(12 / 800);
  });
});
