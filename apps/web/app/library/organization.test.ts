import { describe, expect, it } from "vitest";

import {
  filterDocuments,
  organizationFacets,
  sortDocuments,
  type LibraryDocument,
} from "./documents";
import { languageLabel, normalizeLanguage } from "./language";

function book(
  id: string,
  title: string,
  extra: {
    authors?: string[];
    category?: string;
    duplicateOf?: string;
    language?: string;
    series?: string;
    subcategory?: string;
    volume?: number;
    year?: number;
  } = {},
): LibraryDocument {
  return {
    author: "Carpeta vinculada",
    availability: "available",
    bibliographic: {
      doi: null,
      edition: null,
      editors: [],
      isbn: null,
      originalTitle: null,
      pageCount: null,
      publisher: null,
      rights: null,
      series: extra.series ?? null,
      translators: [],
      url: null,
      volume: extra.volume ?? null,
    },
    catalog: {
      authors: extra.authors ?? [],
      canonicalTitle: title,
      confidence: 1,
      genres: [],
      language: extra.language ?? null,
      publicationYear: extra.year ?? null,
      summary: null,
      topics: [],
      workType: "book",
    },
    format: "pdf",
    id,
    meta: "",
    organization: {
      category: extra.category ?? null,
      duplicateOf: extra.duplicateOf ?? null,
      subcategory: extra.subcategory ?? null,
    },
    origin: "local",
    reference: { kind: "local-folder", relativePath: `${id}.pdf`, sourceId: "libros" },
    tags: [],
    title: id,
  };
}

const basadre = (volume: number) =>
  book(`tomo-${volume}`, `Historia de la República del Perú. Tomo ${volume}`, {
    authors: ["Jorge Basadre Grohmann"],
    category: "Historia",
    language: "es",
    series: "Historia de la República del Perú",
    subcategory: "Historia del Perú",
    volume,
    year: 2014,
  });

const library = [
  basadre(9),
  basadre(5),
  basadre(18),
  book("seneca", "Séneca y el estoicismo", {
    authors: ["Paul Veyne"],
    category: "Filosofía",
    language: "español",
    subcategory: "Estoicismo",
    year: 1995,
  }),
  book("holiday-copia", "Ser justo en un mundo injusto", {
    authors: ["Ryan Holiday"],
    category: "filosofia",
    duplicateOf: "ESTOICISMO/ser-justo.pdf",
    language: "Spanish",
    subcategory: "Estoicismo",
    year: 2024,
  }),
  book("mu", "The Lost Continent of Mu", {
    authors: ["James Churchward"],
    category: "Esoterismo y espiritualidad",
    language: "en",
    year: 1926,
  }),
];

const baseFilters = {
  availability: "all" as const,
  favoriteIds: new Set<string>(),
  favoritesOnly: false,
  format: "all" as const,
  origin: "all" as const,
  query: "",
};

describe("idioma", () => {
  it("reduce nombres, etiquetas y códigos a ISO 639-1", () => {
    expect(normalizeLanguage("español")).toBe("es");
    expect(normalizeLanguage("Español")).toBe("es");
    expect(normalizeLanguage("es-ES")).toBe("es");
    expect(normalizeLanguage("Spanish")).toBe("es");
    expect(normalizeLanguage("English")).toBe("en");
    expect(normalizeLanguage("español e inglés")).toBe("es");
    expect(normalizeLanguage("  ")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });

  it("muestra el código con su nombre en español", () => {
    expect(languageLabel("es")).toBe("español");
    expect(languageLabel("en")).toBe("inglés");
    expect(languageLabel(null)).toBeNull();
  });
});

describe("organización de la biblioteca", () => {
  it("filtra por categoría sin distinguir acentos ni mayúsculas", () => {
    const result = filterDocuments(library, { ...baseFilters, category: "Filosofía" });
    expect(result.map((document) => document.id)).toEqual(["seneca", "holiday-copia"]);
  });

  it("filtra por subcategoría, serie e idioma normalizado", () => {
    expect(
      filterDocuments(library, { ...baseFilters, subcategory: "Historia del Perú" }),
    ).toHaveLength(3);
    expect(
      filterDocuments(library, { ...baseFilters, series: "historia de la republica del peru" }),
    ).toHaveLength(3);
    expect(
      filterDocuments(library, { ...baseFilters, language: "en" }).map((document) => document.id),
    ).toEqual(["mu"]);
  });

  it("oculta las copias duplicadas cuando se pide", () => {
    const result = filterDocuments(library, { ...baseFilters, hideDuplicates: true });
    expect(result.map((document) => document.id)).not.toContain("holiday-copia");
    expect(result).toHaveLength(5);
  });

  it("encuentra por categoría y serie desde la búsqueda", () => {
    expect(filterDocuments(library, { ...baseFilters, query: "estoicismo" })).toHaveLength(2);
    expect(filterDocuments(library, { ...baseFilters, query: "republica del peru" })).toHaveLength(3);
  });

  it("ordena una serie por su número de tomo, no alfabéticamente", () => {
    const ordered = sortDocuments(library, "series").map((document) => document.id);
    expect(ordered.slice(0, 3)).toEqual(["tomo-5", "tomo-9", "tomo-18"]);
  });

  it("ordena por título con números naturales y por año descendente", () => {
    const titles = sortDocuments(library.slice(0, 3), "title").map((document) => document.id);
    expect(titles).toEqual(["tomo-5", "tomo-9", "tomo-18"]);
    expect(sortDocuments(library, "year")[0]?.id).toBe("holiday-copia");
    expect(sortDocuments(library, "recent")).toEqual(library);
  });

  it("cuenta categorías, subcategorías, series e idiomas agrupando grafías", () => {
    const facets = organizationFacets(library);

    expect(facets.categories).toEqual([
      { count: 3, value: "Historia" },
      { count: 2, value: "Filosofía" },
      { count: 1, value: "Esoterismo y espiritualidad" },
    ]);
    expect(facets.subcategoriesOf("filosofia")).toEqual([{ count: 2, value: "Estoicismo" }]);
    expect(facets.series).toEqual([{ count: 3, value: "Historia de la República del Perú" }]);
    expect(facets.languages).toEqual([
      { count: 5, value: "es" },
      { count: 1, value: "en" },
    ]);
  });
});
