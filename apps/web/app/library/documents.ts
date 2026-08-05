import type {
  CatalogAnalysisStatus,
  DocumentCatalogMetadata,
  DocumentCatalogRecord,
  DocumentWorkType,
} from "../ai/document-catalog";

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

export type DocumentReference =
  | { kind: "google-drive"; driveId?: string; fileId: string }
  | { kind: "local-copy"; storageId: string }
  | { kind: "local-file"; referenceId: string }
  | { kind: "local-folder"; relativePath: string; sourceId: string };

export interface LibraryDocument {
  author: string;
  availability: AvailabilityState;
  catalog?: DocumentCatalogMetadata;
  catalogError?: string;
  catalogStatus?: CatalogAnalysisStatus;
  format: DocumentFormat;
  id: string;
  imported?: boolean;
  indexedAt?: string;
  indexStatus?: DocumentIndexStatus;
  /** Versión del extractor que produjo el índice; ausente en documentos anteriores a v2. */
  indexVersion?: number;
  linked?: boolean;
  meta: string;
  origin: DocumentOrigin;
  reference: DocumentReference;
  searchText?: string;
  tags: string[];
  title: string;
}

export interface DocumentFilters {
  author?: string | "all";
  availability: AvailabilityState | "all";
  favoriteIds: ReadonlySet<string>;
  favoritesOnly: boolean;
  format: DocumentFormat | "all";
  genre?: string | "all";
  origin: DocumentOrigin | "all";
  publicationYear?: number | "all";
  query: string;
  workType?: DocumentWorkType | "all";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
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
      ].join(" "),
    ).includes(query);
  });
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
