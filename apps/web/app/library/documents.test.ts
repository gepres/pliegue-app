import { describe, expect, it } from "vitest";

import {
  applyDocumentCatalogs,
  catalogFacets,
  filterDocuments,
  type LibraryDocument,
} from "./documents";

const testDocuments: LibraryDocument[] = [
  {
    author: "Equipo de investigación",
    availability: "available",
    format: "docx",
    id: "hallazgos-investigacion",
    meta: "Documento de prueba",
    origin: "drive",
    reference: { fileId: "drive-1", kind: "google-drive" },
    tags: ["entrevistas", "hallazgos", "investigación"],
    title: "Hallazgos de investigación",
  },
  {
    author: "Biblioteca local",
    availability: "offline",
    format: "pdf",
    id: "sistemas-aprenden",
    meta: "Documento de prueba",
    origin: "local",
    reference: { kind: "local-file", referenceId: "local-1" },
    tags: ["sistemas", "aprendizaje"],
    title: "Sistemas que aprenden",
  },
  {
    author: "QA Pliegue",
    availability: "available",
    format: "xlsx",
    id: "corpus-validacion",
    meta: "Documento de prueba",
    origin: "drive",
    reference: { fileId: "drive-2", kind: "google-drive" },
    tags: ["corpus", "validación"],
    title: "Corpus de validación",
  },
];

const baseFilters = {
  availability: "all" as const,
  favoriteIds: new Set<string>(),
  favoritesOnly: false,
  format: "all" as const,
  origin: "all" as const,
  query: "",
};

describe("filterDocuments", () => {
  it("busca sin distinguir tildes ni mayúsculas", () => {
    const result = filterDocuments(testDocuments, {
      ...baseFilters,
      query: "INVESTIGACION",
    });

    expect(result.map((document) => document.id)).toContain("hallazgos-investigacion");
  });

  it("combina procedencia, formato y disponibilidad", () => {
    const result = filterDocuments(testDocuments, {
      ...baseFilters,
      availability: "offline",
      format: "pdf",
      origin: "local",
    });

    expect(result.map((document) => document.id)).toEqual(["sistemas-aprenden"]);
  });

  it("limita resultados a favoritos", () => {
    const result = filterDocuments(testDocuments, {
      ...baseFilters,
      favoriteIds: new Set(["corpus-validacion"]),
      favoritesOnly: true,
    });

    expect(result.map((document) => document.id)).toEqual(["corpus-validacion"]);
  });

  it("busca dentro del índice derivado sin necesitar el archivo completo", () => {
    const result = filterDocuments(
      [
        {
          ...testDocuments[1]!,
          searchText: "La observación participante requiere registrar el contexto.",
        },
      ],
      { ...baseFilters, query: "PARTICIPANTE" },
    );

    expect(result.map((document) => document.id)).toEqual(["sistemas-aprenden"]);
  });
});

describe("document catalog layer", () => {
  const record = {
    analyzedAt: "2026-08-01T00:00:00.000Z",
    catalog: {
      authors: ["Ursula K. Le Guin"],
      canonicalTitle: "Contar es escuchar",
      confidence: 0.93,
      genres: ["Ensayo"],
      language: "español",
      publicationYear: 2004,
      summary: "Ensayos sobre narración y oficio.",
      topics: ["Escritura"],
      workType: "essay" as const,
    },
    documentId: testDocuments[0]!.id,
    error: null,
    inputFingerprint: "v1:abc",
    model: "test-model",
    provider: "openai" as const,
    schemaVersion: 1 as const,
    status: "analyzed" as const,
  };

  it("mezcla el catálogo sin alterar la referencia original", () => {
    const [document] = applyDocumentCatalogs(testDocuments.slice(0, 1), [record]);

    expect(document?.catalog?.authors).toEqual(["Ursula K. Le Guin"]);
    expect(document?.reference).toEqual(testDocuments[0]!.reference);
  });

  it("filtra por tipo, género y año y construye facetas", () => {
    const enriched = applyDocumentCatalogs(testDocuments.slice(0, 1), [record]);
    const result = filterDocuments(enriched, {
      ...baseFilters,
      genre: "Ensayo",
      publicationYear: 2004,
      query: "ursula",
      workType: "essay",
    });

    expect(result).toHaveLength(1);
    expect(catalogFacets(enriched)).toEqual({
      genres: ["Ensayo"],
      publicationYears: [2004],
    });
  });
});
