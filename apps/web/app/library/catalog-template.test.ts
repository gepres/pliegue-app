import { describe, expect, it } from "vitest";

import {
  applyImportedCatalogs,
  createImportedCatalogRecords,
  parseCatalogImportFile,
} from "./catalog-import";
import {
  catalogTemplateFileName,
  catalogTemplateInstructions,
  createCatalogTemplate,
  serializeCatalogTemplate,
} from "./catalog-template";
import type { LibraryDocument } from "./documents";

const document = {
  author: "Archivo original vinculado",
  availability: "available",
  catalog: {
    authors: ["Marco Aurelio"],
    canonicalTitle: "Meditaciones",
    confidence: 0.8,
    genres: ["Filosofía"],
    language: "español",
    publicationYear: 1998,
    summary: "Anotaciones personales del emperador.",
    topics: ["estoicismo"],
    workType: "book",
  },
  fingerprint: "meditaciones.pdf::2048::1700000000000",
  format: "pdf",
  id: "document-1",
  meta: "2 KB · Referencia local · Sin copia",
  origin: "local",
  originalName: "Meditaciones.pdf",
  reference: { kind: "local-file", referenceId: "document-1" },
  tags: [],
  title: "Meditaciones",
} as unknown as LibraryDocument;

const pendingDocument = {
  author: "Archivo original vinculado",
  availability: "available",
  fingerprint: "sin-ficha.pdf::100::1700000000001",
  format: "pdf",
  id: "document-2",
  meta: "100 B · Referencia local · Sin copia",
  origin: "local",
  originalName: "sin-ficha.pdf",
  reference: { kind: "local-file", referenceId: "document-2" },
  tags: [],
  title: "sin ficha",
} as unknown as LibraryDocument;

describe("plantilla de catálogo", () => {
  it("prellena la entrada con la ficha que el documento ya tiene", () => {
    const [entry] = createCatalogTemplate([document]).entries;

    expect(entry).toMatchObject({
      authors: ["Marco Aurelio"],
      fileName: "Meditaciones.pdf",
      fingerprint: "meditaciones.pdf::2048::1700000000000",
      publicationYear: 1998,
      title: "Meditaciones",
      workType: "book",
    });
  });

  it("deja los campos sin ficha visibles y vacíos en lugar de omitirlos", () => {
    const [entry] = createCatalogTemplate([pendingDocument]).entries;

    expect(entry).toMatchObject({
      authors: [],
      isbn: null,
      publicationYear: null,
      summary: null,
      workType: "other",
    });
    expect(Object.keys(entry ?? {})).toContain("publisher");
  });

  it("lleva dentro el esquema y las instrucciones para rellenarlo", () => {
    const template = createCatalogTemplate([document]);

    expect(template.pliegueCatalog).toBe(1);
    expect(template.instructions).toEqual(catalogTemplateInstructions);
    expect(template.$schema.properties.entries.items.required).toContain("fileName");
  });

  it("vuelve a importarse sin perder lo que ya estaba catalogado", () => {
    const template = createCatalogTemplate([document]);
    const parsed = parseCatalogImportFile(JSON.parse(serializeCatalogTemplate(template)));
    const [applied] = applyImportedCatalogs([document], createImportedCatalogRecords(parsed));

    expect(parsed.dialect).toBe("pliegue");
    expect(parsed.issues).toHaveLength(0);
    expect(applied?.catalog).toMatchObject({
      authors: ["Marco Aurelio"],
      canonicalTitle: "Meditaciones",
      genres: ["Filosofía"],
      language: "español",
      publicationYear: 1998,
      topics: ["estoicismo"],
      workType: "book",
    });
  });

  it("nombra el archivo con la fecha de generación", () => {
    expect(catalogTemplateFileName("2026-08-12T10:00:00.000Z")).toBe(
      "pliegue-catalogo-2026-08-12.json",
    );
  });

  it("termina el archivo con un salto de línea", () => {
    expect(serializeCatalogTemplate(createCatalogTemplate([]))).toMatch(/\}\n$/);
  });
});
