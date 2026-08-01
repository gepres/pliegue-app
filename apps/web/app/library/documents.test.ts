import { describe, expect, it } from "vitest";

import { filterDocuments, libraryDocuments } from "./documents";

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
    const result = filterDocuments(libraryDocuments, {
      ...baseFilters,
      query: "INVESTIGACION",
    });

    expect(result.map((document) => document.id)).toContain("hallazgos-investigacion");
  });

  it("combina procedencia, formato y disponibilidad", () => {
    const result = filterDocuments(libraryDocuments, {
      ...baseFilters,
      availability: "offline",
      format: "pdf",
      origin: "local",
    });

    expect(result.map((document) => document.id)).toEqual(["sistemas-aprenden"]);
  });

  it("limita resultados a favoritos", () => {
    const result = filterDocuments(libraryDocuments, {
      ...baseFilters,
      favoriteIds: new Set(["corpus-validacion"]),
      favoritesOnly: true,
    });

    expect(result.map((document) => document.id)).toEqual(["corpus-validacion"]);
  });
});
