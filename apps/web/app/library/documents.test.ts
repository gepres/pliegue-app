import { describe, expect, it } from "vitest";

import { filterDocuments, type LibraryDocument } from "./documents";

const testDocuments: LibraryDocument[] = [
  {
    author: "Equipo de investigación",
    availability: "available",
    format: "docx",
    id: "hallazgos-investigacion",
    meta: "Documento de prueba",
    origin: "drive",
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
});
