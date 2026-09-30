import { describe, expect, it } from "vitest";

import {
  documentLanguage,
  filterDocuments,
  organizationFacets,
  sortDocuments,
  type LibraryDocument,
} from "./documents";
import { detectTextLanguage, languageLabel, normalizeLanguage } from "./language";

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

  it("detecta el idioma de un texto corrido por sus palabras más frecuentes", () => {
    const spanish =
      "La biblioteca de la ciudad guarda los libros que la gente dona cada año. Los lectores llegan por la mañana, se sientan junto a las ventanas y leen con calma, porque el silencio es parte del lugar. Algunos toman notas en sus cuadernos, otros buscan un dato para su trabajo y los más jóvenes vienen a estudiar para los exámenes del curso.";
    const english =
      "The library of the city keeps the books that people donate every year. Readers arrive in the morning, sit by the windows and read with calm, because the silence is part of the place. Some of them take notes in their notebooks, others look for a fact for their work, and the youngest come to study for the exams of the course.";
    const portuguese =
      "A biblioteca da cidade guarda os livros que as pessoas doam todos os anos. Os leitores chegam pela manhã, sentam-se junto das janelas e leem com calma, porque o silêncio é parte do lugar. Alguns tomam notas nos seus cadernos, outros procuram um dado para o seu trabalho e os mais jovens vêm estudar para os exames do curso.";

    expect(detectTextLanguage(spanish)).toBe("es");
    expect(detectTextLanguage(english)).toBe("en");
    expect(detectTextLanguage(portuguese)).toBe("pt");
  });

  it("no opina con poco texto ni con listas de nombres y cifras", () => {
    expect(detectTextLanguage("Historia de la República del Perú. Tomo IX")).toBeNull();
    expect(
      detectTextLanguage(Array.from({ length: 60 }, (_, index) => `Basadre ${index} 1939`).join(" ")),
    ).toBeNull();
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

  it("usa el idioma detectado en el texto cuando el documento no tiene ficha", () => {
    const withoutCatalog: LibraryDocument = {
      ...book("sin-ficha", "Documento sin ficha"),
      detectedLanguage: "pt",
    };
    delete withoutCatalog.catalog;

    expect(documentLanguage(withoutCatalog)).toBe("pt");
    expect(organizationFacets([withoutCatalog]).languages).toEqual([{ count: 1, value: "pt" }]);
    expect(filterDocuments([withoutCatalog], { ...baseFilters, language: "pt" })).toHaveLength(1);
    // Lo que dice la ficha manda sobre lo que se dedujo del texto.
    expect(
      documentLanguage({ ...book("con-ficha", "Con ficha", { language: "English" }), detectedLanguage: "es" }),
    ).toBe("en");
  });
});
