import { describe, expect, it } from "vitest";

import {
  anchorText,
  annotationQuote,
  annotationsToMarkdown,
  describeTextRange,
  exportQuoteLimit,
  foldForMatch,
  sortAnnotations,
  type ReaderAnnotation,
} from "./annotations";

const text =
  "La isla es desierta. Llega un fugitivo y descubre que la isla no está vacía: hay visitantes que repiten la misma semana.";

function annotation(id: string, target: ReaderAnnotation["target"], note = ""): ReaderAnnotation {
  return {
    color: "amber",
    createdAt: `2026-09-25T10:00:0${id}.000Z`,
    documentId: "doc",
    documentTitle: "La invención de Morel",
    id,
    note,
    target,
    updatedAt: `2026-09-25T10:00:0${id}.000Z`,
  };
}

describe("anclaje de citas", () => {
  it("pliega espacios, guiones blandos y mayúsculas sin perder la posición original", () => {
    const { folded, positions } = foldForMatch("  Conoci­miento   del  MUNDO ");
    expect(folded).toBe("conocimiento del mundo");
    expect(positions[0]).toBe(2);
    expect("  Conoci­miento   del  MUNDO "[positions.at(-1) ?? 0]).toBe("O");
  });

  it("guarda la cita con su contexto a los lados", () => {
    const start = text.indexOf("fugitivo");
    const selector = describeTextRange(text, start, start + "fugitivo".length);
    expect(selector.quote).toBe("fugitivo");
    expect(selector.prefix.endsWith("Llega un ")).toBe(true);
    expect(selector.suffix.startsWith(" y descubre")).toBe(true);
  });

  it("usa la posición guardada si sigue diciendo lo mismo", () => {
    const start = text.indexOf("visitantes");
    const selector = describeTextRange(text, start, start + 10);
    expect(anchorText(text, selector)).toEqual({ end: start + 10, start });
  });

  it("encuentra la cita en otra vista del mismo texto, con otros espacios y saltos", () => {
    const start = text.indexOf("hay visitantes");
    const selector = describeTextRange(text, start, start + "hay visitantes que repiten".length);
    const otherView = `Página 12\n\n${text.replaceAll(" ", "  ").replace("que repiten", "que\nrepiten")}`;
    const anchored = anchorText(otherView, selector);
    expect(anchored).not.toBeNull();
    expect(otherView.slice(anchored?.start, anchored?.end).replaceAll(/\s+/g, " ")).toBe("hay visitantes que repiten");
  });

  it("encuentra una cita de varios renglones entre la capa del PDF, que los junta, y el modo Lectura", () => {
    // En la capa de texto cada renglón acaba en un <br>: el texto del DOM los pega.
    const layer = "la isla no está vacía:hay visitantes que repitenla misma semana.";
    const reading = "Página 12. La isla no está vacía: hay visitantes que repiten la misma semana.";

    const fromLayer = layer.indexOf("vacía:hay");
    const layerSelector = describeTextRange(layer, fromLayer, fromLayer + "vacía:hay visitantes".length);
    const inReading = anchorText(reading, { ...layerSelector, end: -1, start: -1 });
    expect(reading.slice(inReading?.start, inReading?.end)).toBe("vacía: hay visitantes");

    const fromReading = reading.indexOf("repiten la misma");
    const readingSelector = describeTextRange(reading, fromReading, fromReading + "repiten la misma".length);
    const inLayer = anchorText(layer, { ...readingSelector, end: -1, start: -1 });
    expect(layer.slice(inLayer?.start, inLayer?.end)).toBe("repitenla misma");
  });

  it("entre dos apariciones elige la que conserva el contexto", () => {
    const second = text.lastIndexOf("la isla");
    const selector = describeTextRange(text, second, second + "la isla".length);
    // Se desplaza el texto para que la posición guardada ya no sirva.
    const shifted = `Prólogo. ${text}`;
    const anchored = anchorText(shifted, selector);
    expect(anchored?.start).toBe(shifted.lastIndexOf("la isla"));
  });

  it("devuelve null cuando la cita ya no está", () => {
    const selector = describeTextRange(text, 0, 7);
    expect(anchorText("Otro texto que no la contiene", { ...selector, quote: "máquina" })).toBeNull();
  });
});

describe("notas del documento", () => {
  const notes = [
    annotation("2", { kind: "region", page: 9, quote: "", rect: { height: 0.2, width: 0.5, x: 0.1, y: 0.3 } }, "El mapa de la isla"),
    annotation("1", { ...describeTextRange(text, 0, 20), kind: "text", page: 3, scope: "pdf-layer:3" }),
    annotation("3", { ...describeTextRange("x".repeat(400), 0, 400), kind: "text", page: 12, scope: "pdf-layer:12" }),
  ];

  it("muestran la cita tal como se lee, no como la junta la capa del PDF", () => {
    const layer = "la isla no está vacía:hay  visitantes";
    const saved = { ...describeTextRange(layer, 0, layer.length), kind: "text" as const, page: 4, scope: "pdf-layer:4" };
    expect(annotationQuote(annotation("4", { ...saved, display: "la isla no está vacía: hay visitantes" }))).toBe(
      "la isla no está vacía: hay visitantes",
    );
    // Sin la cita legible —marcas anteriores a ella—, se muestra el trozo exacto.
    expect(annotationQuote(annotation("5", saved))).toBe("la isla no está vacía:hay visitantes");
  });

  it("se ordenan por página", () => {
    expect(sortAnnotations(notes).map((item) => item.target.page)).toEqual([3, 9, 12]);
  });

  it("se exportan con cita breve, página y la nota entera", () => {
    const markdown = annotationsToMarkdown(notes, { author: "Adolfo Bioy Casares", title: "La invención de Morel" });
    expect(markdown).toContain("# Notas de «La invención de Morel»");
    expect(markdown).toContain("> La isla es desierta.");
    expect(markdown).toContain("> — página 3");
    expect(markdown).toContain("> [Zona marcada en la página 9]");
    expect(markdown).toContain("El mapa de la isla");
    const longQuote = markdown.split("\n").find((line) => line.startsWith("> xxx")) ?? "";
    expect(longQuote.length).toBeLessThanOrEqual(exportQuoteLimit + 4);
    expect(longQuote.endsWith("…")).toBe(true);
  });
});
