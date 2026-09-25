import type {
  CatalogAnalysisStatus,
  DocumentCatalogMetadata,
  DocumentCatalogRecord,
  DocumentWorkType,
} from "../ai/document-catalog";
import type {
  CatalogBibliographicData,
  CatalogCover,
  CatalogOrganization,
} from "./catalog-import";
import { normalizeLanguage } from "./language";

export const documentFormats = [
  "pdf",
  "epub",
  "docx",
  "pptx",
  "xlsx",
  "txt",
  "md",
  "png",
  "jpg",
] as const;
export const availabilityStates = ["available", "offline", "disconnected"] as const;

export type DocumentOrigin = "drive" | "local";
export type DocumentFormat = (typeof documentFormats)[number];
export type AvailabilityState = (typeof availabilityStates)[number];
export type DocumentIndexStatus = "error" | "indexed" | "metadata-only" | "pending";
/** Quién produjo la ficha: el análisis de un proveedor o un archivo importado a mano. */
export type CatalogSource = "ai" | "import";

export type DocumentReference =
  | { kind: "google-drive"; driveId?: string; fileId: string }
  | { kind: "local-copy"; storageId: string }
  | { kind: "local-file"; referenceId: string }
  | { kind: "local-folder"; relativePath: string; sourceId: string };

export interface LibraryDocument {
  author: string;
  availability: AvailabilityState;
  /** Editorial, serie, tomo, ISBN…: solo los aporta una ficha importada. */
  bibliographic?: CatalogBibliographicData;
  catalog?: DocumentCatalogMetadata;
  catalogError?: string;
  catalogSource?: CatalogSource;
  catalogStatus?: CatalogAnalysisStatus;
  cover?: CatalogCover;
  format: DocumentFormat;
  id: string;
  imported?: boolean;
  indexedAt?: string;
  indexStatus?: DocumentIndexStatus;
  /** Versión del extractor que produjo el índice; ausente en documentos anteriores a v2. */
  indexVersion?: number;
  linked?: boolean;
  meta: string;
  /** Categoría, subcategoría y ejemplar duplicado: la organización de la biblioteca. */
  organization?: CatalogOrganization;
  origin: DocumentOrigin;
  reference: DocumentReference;
  searchText?: string;
  tags: string[];
  title: string;
}

export interface DocumentFilters {
  author?: string | "all";
  availability: AvailabilityState | "all";
  category?: string | "all";
  favoriteIds: ReadonlySet<string>;
  favoritesOnly: boolean;
  format: DocumentFormat | "all";
  genre?: string | "all";
  /** Oculta las copias repetidas marcadas con `duplicateOf` y deja el ejemplar principal. */
  hideDuplicates?: boolean;
  language?: string | "all";
  origin: DocumentOrigin | "all";
  publicationYear?: number | "all";
  query: string;
  series?: string | "all";
  subcategory?: string | "all";
  workType?: DocumentWorkType | "all";
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

/** Igualdad para filtrar sin que importen mayúsculas, acentos ni espacios dobles. */
function sameLabel(left: string | null | undefined, right: string) {
  return left ? normalizeSearchText(left.trim()) === normalizeSearchText(right.trim()) : false;
}

/** Título con el que se muestra el documento: el de la ficha si existe. */
export function documentDisplayTitle(document: LibraryDocument) {
  return document.catalog?.canonicalTitle ?? document.title;
}

export function filterDocuments(
  documents: readonly LibraryDocument[],
  filters: DocumentFilters,
) {
  const query = normalizeSearchText(filters.query.trim());

  return documents.filter((document) => {
    if (filters.origin !== "all" && document.origin !== filters.origin) return false;
    if (filters.format !== "all" && document.format !== filters.format) return false;
    if (filters.availability !== "all" && document.availability !== filters.availability) {
      return false;
    }
    if (filters.hideDuplicates && document.organization?.duplicateOf) return false;
    if (
      filters.category &&
      filters.category !== "all" &&
      !sameLabel(document.organization?.category, filters.category)
    ) {
      return false;
    }
    if (
      filters.subcategory &&
      filters.subcategory !== "all" &&
      !sameLabel(document.organization?.subcategory, filters.subcategory)
    ) {
      return false;
    }
    if (
      filters.series &&
      filters.series !== "all" &&
      !sameLabel(document.bibliographic?.series, filters.series)
    ) {
      return false;
    }
    if (
      filters.language &&
      filters.language !== "all" &&
      normalizeLanguage(document.catalog?.language) !== filters.language
    ) {
      return false;
    }
    if (
      filters.workType &&
      filters.workType !== "all" &&
      document.catalog?.workType !== filters.workType
    ) {
      return false;
    }
    if (
      filters.genre &&
      filters.genre !== "all" &&
      !document.catalog?.genres.some(
        (genre) => normalizeSearchText(genre) === normalizeSearchText(filters.genre as string),
      )
    ) {
      return false;
    }
    if (
      filters.publicationYear &&
      filters.publicationYear !== "all" &&
      document.catalog?.publicationYear !== filters.publicationYear
    ) {
      return false;
    }
    if (
      filters.author &&
      filters.author !== "all" &&
      !document.catalog?.authors.some(
        (author) => normalizeSearchText(author) === normalizeSearchText(filters.author as string),
      )
    ) {
      return false;
    }
    if (filters.favoritesOnly && !filters.favoriteIds.has(document.id)) return false;
    if (!query) return true;

    return normalizeSearchText(
      [
        document.title,
        document.author,
        ...document.tags,
        document.searchText ?? "",
        document.catalog?.canonicalTitle ?? "",
        ...(document.catalog?.authors ?? []),
        ...(document.catalog?.genres ?? []),
        ...(document.catalog?.topics ?? []),
        document.catalog?.language ?? "",
        document.catalog?.summary ?? "",
        document.catalog?.publicationYear?.toString() ?? "",
        document.organization?.category ?? "",
        document.organization?.subcategory ?? "",
        document.bibliographic?.series ?? "",
        document.bibliographic?.publisher ?? "",
        document.bibliographic?.originalTitle ?? "",
        document.bibliographic?.isbn ?? "",
        ...(document.bibliographic?.translators ?? []),
      ].join(" "),
    ).includes(query);
  });
}

export const documentSortOrders = ["title", "author", "year", "series", "recent"] as const;
export type DocumentSortOrder = (typeof documentSortOrders)[number];

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * Orden de la estantería. «Por serie» agrupa cada colección y la recorre por su número de
 * tomo, que es lo único que pone los 18 tomos de una obra en su sitio: alfabéticamente, el
 * IX iría antes que el V. «Recientes» conserva el orden en que llegaron los documentos.
 */
export function sortDocuments(documents: readonly LibraryDocument[], order: DocumentSortOrder) {
  if (order === "recent") return [...documents];

  const byTitle = (left: LibraryDocument, right: LibraryDocument) =>
    collator.compare(documentDisplayTitle(left), documentDisplayTitle(right));
  const firstAuthor = (document: LibraryDocument) =>
    document.catalog?.authors[0] ?? (document.author || null);

  return [...documents].sort((left, right) => {
    if (order === "author") {
      const a = firstAuthor(left);
      const b = firstAuthor(right);
      if (a && b) return collator.compare(a, b) || byTitle(left, right);
      if (a || b) return a ? -1 : 1;
      return byTitle(left, right);
    }
    if (order === "year") {
      const a = left.catalog?.publicationYear ?? null;
      const b = right.catalog?.publicationYear ?? null;
      if (a !== null && b !== null && a !== b) return b - a;
      if ((a === null) !== (b === null)) return a === null ? 1 : -1;
      return byTitle(left, right);
    }
    if (order === "series") {
      const a = left.bibliographic?.series ?? null;
      const b = right.bibliographic?.series ?? null;
      if (a && b && !sameLabel(a, b)) return collator.compare(a, b);
      if ((a === null) !== (b === null)) return a === null ? 1 : -1;
      const volumeA = left.bibliographic?.volume ?? Number.POSITIVE_INFINITY;
      const volumeB = right.bibliographic?.volume ?? Number.POSITIVE_INFINITY;
      if (volumeA !== volumeB) return volumeA - volumeB;
      return byTitle(left, right);
    }
    return byTitle(left, right);
  });
}

export interface FacetValue {
  count: number;
  value: string;
}

/**
 * Cuenta por etiqueta normalizada y ofrece la primera grafía vista. Así «Filosofía» y
 * «filosofia» son una sola opción y el recuento no se parte en dos.
 */
function countLabels(values: Iterable<string | null | undefined>): FacetValue[] {
  const byKey = new Map<string, FacetValue>();
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned) continue;
    const key = normalizeSearchText(cleaned);
    const current = byKey.get(key);
    if (current) current.count += 1;
    else byKey.set(key, { count: 1, value: cleaned });
  }
  return [...byKey.values()].sort(
    (left, right) => right.count - left.count || collator.compare(left.value, right.value),
  );
}

/** Categorías con su recuento y, dentro de cada una, sus subcategorías. */
export function organizationFacets(documents: readonly LibraryDocument[]) {
  const categories = countLabels(documents.map((document) => document.organization?.category));
  const subcategoriesByCategory = new Map<string, FacetValue[]>();
  for (const category of categories) {
    subcategoriesByCategory.set(
      normalizeSearchText(category.value),
      countLabels(
        documents
          .filter((document) => sameLabel(document.organization?.category, category.value))
          .map((document) => document.organization?.subcategory),
      ),
    );
  }

  return {
    categories,
    languages: countLabels(documents.map((document) => normalizeLanguage(document.catalog?.language))),
    series: countLabels(documents.map((document) => document.bibliographic?.series)),
    subcategoriesOf(category: string) {
      return subcategoriesByCategory.get(normalizeSearchText(category)) ?? [];
    },
  };
}

export function applyDocumentCatalogs(
  documents: readonly LibraryDocument[],
  records: readonly DocumentCatalogRecord[],
) {
  const recordsByDocument = new Map(records.map((record) => [record.documentId, record]));
  return documents.map((document): LibraryDocument => {
    const record = recordsByDocument.get(document.id);
    if (!record) return document;
    return {
      ...document,
      ...(record.catalog ? { catalog: record.catalog } : {}),
      ...(record.error ? { catalogError: record.error } : {}),
      catalogSource: "ai",
      catalogStatus: record.status,
    };
  });
}

export function catalogFacets(documents: readonly LibraryDocument[]) {
  const genres = new Set<string>();
  const publicationYears = new Set<number>();
  // Se agrupa por forma normalizada para que «Séneca» y «Seneca» no abran dos entradas,
  // pero se ofrece la grafía tal como la devolvió el catálogo.
  const authorsByKey = new Map<string, string>();

  for (const document of documents) {
    document.catalog?.genres.forEach((genre) => genres.add(genre));
    document.catalog?.authors.forEach((author) => {
      const key = normalizeSearchText(author);
      if (key && !authorsByKey.has(key)) authorsByKey.set(key, author);
    });
    if (document.catalog?.publicationYear) publicationYears.add(document.catalog.publicationYear);
  }

  return {
    authors: [...authorsByKey.values()].sort((left, right) => left.localeCompare(right, "es")),
    genres: [...genres].sort((left, right) => left.localeCompare(right, "es")),
    publicationYears: [...publicationYears].sort((left, right) => right - left),
  };
}
