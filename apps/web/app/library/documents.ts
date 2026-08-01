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
  format: DocumentFormat;
  id: string;
  imported?: boolean;
  indexedAt?: string;
  indexStatus?: DocumentIndexStatus;
  linked?: boolean;
  meta: string;
  origin: DocumentOrigin;
  reference: DocumentReference;
  searchText?: string;
  tags: string[];
  title: string;
}

export interface DocumentFilters {
  availability: AvailabilityState | "all";
  favoriteIds: ReadonlySet<string>;
  favoritesOnly: boolean;
  format: DocumentFormat | "all";
  origin: DocumentOrigin | "all";
  query: string;
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
    if (filters.favoritesOnly && !filters.favoriteIds.has(document.id)) return false;
    if (!query) return true;

    return normalizeSearchText(
      [document.title, document.author, ...document.tags, document.searchText ?? ""].join(" "),
    ).includes(query);
  });
}
