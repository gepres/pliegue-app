import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "../library/documents";
import {
  catalogPromptVersion,
  createCatalogDocumentInput,
  createCatalogInputFingerprint,
  createCatalogPrompt,
  documentCatalogJsonSchema,
  emptyCatalogExtras,
  maxSummaryCharacters,
  parseCatalogExtras,
  parseDocumentCatalog,
  selectCatalogExcerpt,
} from "./document-catalog";

const document: LibraryDocument = {
  author: "Carpeta vinculada · Libros",
  availability: "available",
  format: "epub",
  id: "document-1",
  indexedAt: "2026-08-01T00:00:00.000Z",
  indexStatus: "indexed",
  meta: "Ensayos/lectura.epub · 2 MB",
  origin: "local",
  reference: {
    kind: "local-folder",
    relativePath: "Ensayos/lectura.epub",
    sourceId: "source-1",
  },
  searchText: "Portada Autor 2021 ensayo sobre la lectura y sus prácticas.",
  tags: ["ensayos", "lectura"],
  title: "lectura",
};

describe("document catalog", () => {
  it("normaliza el resultado estructurado y elimina duplicados", () => {
    expect(
      parseDocumentCatalog({
        authors: ["  Ana Pérez ", "ana pérez"],
        canonicalTitle: " Prácticas de lectura ",
        confidence: 1.4,
        genres: ["Ensayo", "ensayo"],
        language: "español",
        publicationYear: 2021,
        summary: "  Un estudio sobre prácticas lectoras. ",
        topics: ["Lectura", "Educación"],
        workType: "essay",
      }),
    ).toEqual({
      authors: ["Ana Pérez"],
      canonicalTitle: "Prácticas de lectura",
      confidence: 1,
      genres: ["Ensayo"],
      language: "español",
      publicationYear: 2021,
      summary: "Un estudio sobre prácticas lectoras.",
      topics: ["Lectura", "Educación"],
      workType: "essay",
    });
  });

  it("admite una sinopsis extensa y recorta solo lo que exceda el contrato", () => {
    const sinopsis = `Trata de ${"la vida estoica ".repeat(80)}`;
    const catalog = parseDocumentCatalog({
      authors: [],
      canonicalTitle: null,
      confidence: 0.8,
      genres: [],
      language: null,
      publicationYear: null,
      summary: sinopsis,
      topics: [],
      workType: "book",
    });

    expect(catalog.summary).toHaveLength(maxSummaryCharacters);
    expect(catalog.summary?.startsWith("Trata de")).toBe(true);
  });

  it("cambia el fingerprint al versionar el prompt para forzar el reanálisis", () => {
    const fingerprint = createCatalogInputFingerprint(document, "openai", "gpt-test", 12_000);

    expect(fingerprint.startsWith(`v${catalogPromptVersion}:`)).toBe(true);
    expect(fingerprint).not.toBe("v1:");
  });

  it("pide lo mismo que la plantilla JSON: categoría, subcategoría y los datos de la edición", () => {
    const properties = Object.keys(documentCatalogJsonSchema.properties).sort();
    expect(properties).toEqual(
      expect.arrayContaining([
        "category",
        "edition",
        "editors",
        "isbn",
        "originalTitle",
        "publisher",
        "series",
        "subcategory",
        "translators",
        "volume",
      ]),
    );
    // La salida estricta de OpenAI rechaza un esquema con propiedades no obligatorias.
    expect([...documentCatalogJsonSchema.required].sort()).toEqual(properties);
  });

  it("lee la categoría y los datos de la edición, y descarta lo que no lo es", () => {
    expect(
      parseCatalogExtras({
        category: " Historia ",
        edition: "2.ª",
        editors: ["Ana Ruiz", "ana ruiz"],
        isbn: "978-612-306-361-0",
        originalTitle: null,
        publisher: "Empresa Editora El Comercio",
        series: "Historia de la República del Perú",
        subcategory: "Historia del Perú",
        translators: [],
        volume: 8,
      }),
    ).toEqual({
      category: "Historia",
      edition: "2.ª",
      editors: ["Ana Ruiz"],
      isbn: "9786123063610",
      originalTitle: null,
      publisher: "Empresa Editora El Comercio",
      series: "Historia de la República del Perú",
      subcategory: "Historia del Perú",
      translators: [],
      volume: 8,
    });

    expect(parseCatalogExtras({ category: null, isbn: "sin ISBN", subcategory: "Suelta", volume: 0 })).toEqual(
      emptyCatalogExtras,
    );
    // Una ficha del contrato anterior, sin estos campos, no rompe nada.
    expect(parseCatalogExtras({ authors: ["X"] })).toEqual(emptyCatalogExtras);
  });

  it("ofrece al modelo las categorías que ya usa la biblioteca", () => {
    const input = createCatalogDocumentInput(document, 12_000, [], ["Historia › Historia del Perú", "Filosofía"]);
    expect(input.knownCategories).toEqual(["Historia › Historia del Perú", "Filosofía"]);
    expect(createCatalogPrompt(input)).toContain(
      "Categorías ya usadas en la biblioteca: Historia › Historia del Perú; Filosofía",
    );
    expect(createCatalogPrompt(createCatalogDocumentInput(document, 12_000))).not.toContain("Categorías");
  });

  it("conserva inicio y cierre al acotar el extracto", () => {
    const excerpt = selectCatalogExcerpt(`INICIO ${"x".repeat(100)} FINAL`, 40);
    expect(excerpt).toContain("INICIO");
    expect(excerpt).toContain("FINAL");
    expect(excerpt).toContain("omitido");
  });

  it("incluye la ruta relativa sin exponer una ruta absoluta", () => {
    expect(createCatalogDocumentInput(document, 12_000)).toMatchObject({
      format: "epub",
      path: "Ensayos/lectura.epub",
      title: "lectura",
    });
  });

  it("mantiene fingerprint estable y cambia con proveedor o contenido", () => {
    const first = createCatalogInputFingerprint(document, "openai", "gpt-test", 12_000);
    expect(createCatalogInputFingerprint(document, "openai", "gpt-test", 12_000)).toBe(first);
    expect(createCatalogInputFingerprint(document, "anthropic", "gpt-test", 12_000)).not.toBe(
      first,
    );
    expect(
      createCatalogInputFingerprint(
        { ...document, searchText: `${document.searchText} Cambio` },
        "openai",
        "gpt-test",
        12_000,
      ),
    ).not.toBe(first);
  });
});
