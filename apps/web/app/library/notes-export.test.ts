import { describe, expect, it } from "vitest";

import type { ReaderAnnotation } from "./annotations";
import { notesFileName, notesToMarkdown } from "./notes-export";

function mark(partial: Partial<ReaderAnnotation> & Pick<ReaderAnnotation, "target">): ReaderAnnotation {
  return {
    color: "amber",
    createdAt: "2026-10-01T10:00:00.000Z",
    documentId: "doc",
    documentTitle: "La invención de Morel",
    id: Math.random().toString(36),
    note: "",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...partial,
  };
}

const text = (quote: string, page: number | null) =>
  ({ end: 0, kind: "text", page, prefix: "", quote, scope: "document", start: 0, suffix: "" }) as const;

describe("notas en Markdown", () => {
  it("agrupa por libro, ordena por página y lleva la cita, la página y la nota", () => {
    const markdown = notesToMarkdown(
      [
        mark({ note: "La isla y la máquina.", target: text("Hoy, en esta isla, ha sucedido un milagro.", 12) }),
        mark({ target: text("El verano se adelantó.", 3) }),
        mark({ documentTitle: "Ficciones", note: "Primera línea\nSegunda línea", target: { kind: "region", page: 40, quote: "", rect: { height: 1, width: 1, x: 0, y: 0 } } }),
      ],
      "2026-10-02T12:00:00.000Z",
    );
    expect(markdown).toBe(
      [
        "# Notas y resaltados de Pliegue",
        "",
        "Exportado el 2 de octubre de 2026 · 3 marcas en 2 libros.",
        "",
        "## Ficciones",
        "",
        "> (zona de la página 40)",
        ">",
        "> — p. 40",
        "",
        "Primera línea",
        "Segunda línea",
        "",
        "## La invención de Morel",
        "",
        "> El verano se adelantó.",
        ">",
        "> — p. 3",
        "",
        "> Hoy, en esta isla, ha sucedido un milagro.",
        ">",
        "> — p. 12",
        "",
        "La isla y la máquina.",
        "",
      ].join("\n"),
    );
    expect(notesFileName("2026-10-02T12:00:00.000Z")).toBe("pliegue-notas-2026-10-02.md");
  });

  it("sin página (EPUB, DOCX) no la inventa", () => {
    expect(notesToMarkdown([mark({ target: text("Una cita", null) })], "2026-10-02T12:00:00.000Z")).toContain("> Una cita\n");
    expect(notesToMarkdown([mark({ target: text("Una cita", null) })], "2026-10-02T12:00:00.000Z")).not.toContain("p. ");
  });
});
