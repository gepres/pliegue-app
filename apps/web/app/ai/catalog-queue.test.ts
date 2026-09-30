import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "../library/documents";
import { defaultAiSettings, providerModel } from "./ai-settings";
import { catalogQueueReason } from "./catalog-analysis";
import { createCatalogInputFingerprint, type DocumentCatalogRecord } from "./document-catalog";

const document: LibraryDocument = {
  author: "",
  availability: "available",
  format: "pdf",
  id: "doc-1",
  indexedAt: "2026-09-01T00:00:00.000Z",
  indexStatus: "indexed",
  meta: "",
  origin: "local",
  reference: { kind: "local-file", referenceId: "ref-1" },
  searchText: "Historia de la República del Perú. Tomo VIII.",
  tags: [],
  title: "TOMO-VIII-HP-Basadre",
};

const settings = defaultAiSettings;
const current = createCatalogInputFingerprint(
  document,
  settings.provider,
  providerModel(settings),
  settings.maxExcerptCharacters,
);

function record(overrides: Partial<DocumentCatalogRecord>): DocumentCatalogRecord {
  return {
    analyzedAt: "2026-09-02T00:00:00.000Z",
    catalog: null,
    documentId: document.id,
    error: null,
    inputFingerprint: current,
    model: providerModel(settings),
    provider: settings.provider,
    schemaVersion: 1,
    status: "analyzed",
    ...overrides,
  };
}

describe("cola del catálogo con IA", () => {
  it("distingue lo nuevo, lo hecho con un prompt anterior y lo que cambió", () => {
    expect(catalogQueueReason(document, undefined, settings)).toBe("new");
    expect(catalogQueueReason(document, record({}), settings)).toBeNull();
    // Las fichas de la v3 no tienen categoría: se rehacen para completarlas.
    expect(catalogQueueReason(document, record({ inputFingerprint: "v3:abcd1234" }), settings)).toBe("outdated");
    expect(
      catalogQueueReason(document, record({ inputFingerprint: current.replace(/:.*/, ":00000000") }), settings),
    ).toBe("changed");
  });

  it("reintenta los errores solo si se pide, y no toca una ficha importada sin forzar", () => {
    expect(catalogQueueReason(document, record({ status: "error" }), settings)).toBeNull();
    expect(catalogQueueReason(document, record({ status: "error" }), settings, { retryErrors: true })).toBe("error");

    const imported: LibraryDocument = {
      ...document,
      catalog: {
        authors: [],
        canonicalTitle: null,
        confidence: 1,
        genres: [],
        language: null,
        publicationYear: null,
        summary: null,
        topics: [],
        workType: "book",
      },
      catalogSource: "import",
    };
    expect(catalogQueueReason(imported, undefined, settings)).toBeNull();
    expect(catalogQueueReason(imported, undefined, settings, { force: true })).toBe("new");
  });
});
