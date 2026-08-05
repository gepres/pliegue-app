import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "../library/documents";
import {
  catalogPromptVersion,
  createCatalogDocumentInput,
  createCatalogInputFingerprint,
  maxSummaryCharacters,
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
