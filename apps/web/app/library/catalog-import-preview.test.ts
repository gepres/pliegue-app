import { describe, expect, it } from "vitest";

import { createImportedCatalogRecords, parseCatalogImportFile } from "./catalog-import";
import { noValue, previewCatalogImport } from "./catalog-import-preview";
import type { LibraryDocument } from "./documents";

const document = (id: string, fileName: string, extra: Partial<LibraryDocument> = {}) =>
  ({
    // Lo que lleva de verdad una copia importada: una etiqueta, no un autor.
    author: "Copia importada",
    availability: "available",
    format: "pdf",
    id,
    meta: "",
    origin: "local",
    originalName: fileName,
    reference: { kind: "local-file", referenceId: id },
    tags: [],
    title: fileName.replace(/\.pdf$/, ""),
    ...extra,
  }) as unknown as LibraryDocument;

const records = (entries: object[]) => createImportedCatalogRecords(parseCatalogImportFile({ entries, pliegueCatalog: 1 }));

describe("vista previa del índice JSON (03.6)", () => {
  const library = [
    document("meditaciones", "Meditaciones.pdf"),
    document("etica", "Etica.pdf", {
      catalog: { authors: ["Baruch Spinoza"], canonicalTitle: "Ética", workType: "book" } as NonNullable<LibraryDocument["catalog"]>,
      organization: { category: "Filosofía", duplicateOf: null, subcategory: "Ética" },
    }),
    document("suelto", "Suelto.pdf"),
  ];

  it("dice, libro a libro, qué dato pasa de qué a qué", () => {
    const preview = previewCatalogImport(
      library,
      records([
        {
          authors: ["Marco Aurelio"],
          category: "Filosofía",
          fileName: "Meditaciones.pdf",
          publicationYear: 1998,
          series: "Biblioteca Clásica Gredos",
          subcategory: "Estoicismo",
          title: "Meditaciones",
          volume: 5,
        },
      ]),
    );
    expect(preview.unchanged).toBe(0);
    expect(preview.changed).toEqual([
      {
        changes: [
          { from: noValue, label: "Autoría", to: "Marco Aurelio" },
          { from: noValue, label: "Categoría", to: "Filosofía › Estoicismo" },
          { from: noValue, label: "Serie", to: "Biblioteca Clásica Gredos, 5" },
          { from: noValue, label: "Año", to: "1998" },
        ],
        documentId: "meditaciones",
        title: "Meditaciones",
      },
    ]);
  });

  it("una ficha que deja el libro igual cuenta como «sin cambios»; sin archivo, no cuenta", () => {
    const preview = previewCatalogImport(
      library,
      records([
        { authors: ["Baruch Spinoza"], category: "Filosofía", fileName: "Etica.pdf", subcategory: "Ética", title: "Ética" },
        { fileName: "No está en la biblioteca.pdf", title: "Otro" },
      ]),
    );
    expect(preview).toEqual({ changed: [], unchanged: 1 });
  });

  it("marcar una copia y cambiar la categoría se ven como cambios", () => {
    const preview = previewCatalogImport(
      library,
      records([{ authors: ["Baruch Spinoza"], category: "Ética", duplicateOf: "Meditaciones.pdf", fileName: "Etica.pdf", title: "Ética" }]),
    );
    expect(preview.changed[0]?.changes).toEqual([
      { from: "Filosofía › Ética", label: "Categoría", to: "Ética" },
      { from: noValue, label: "Copia de", to: "Meditaciones.pdf" },
    ]);
  });
});
