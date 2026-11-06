// @vitest-environment node
import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { applyNameReconciliation, nameMergeKey, planNameReconciliation } from "./catalog-analysis";
import type { DocumentCatalogRecord } from "./document-catalog";
import { readDocumentCatalogRecords, saveDocumentCatalogRecord } from "./document-catalog-store";

// Los almacenes usan `window.indexedDB`; en Node lo da fake-indexeddb sobre `globalThis`.
(globalThis as { window?: unknown }).window = globalThis;

const record = (documentId: string, title: string, authors: string[], category: string): DocumentCatalogRecord =>
  ({
    analyzedAt: "2026-11-06T00:00:00.000Z",
    catalog: { authors, canonicalTitle: title, workType: "book" },
    documentId,
    error: null,
    extras: { category, subcategory: null },
    inputFingerprint: "v9:x",
    model: "m",
    provider: "ollama",
    schemaVersion: 1,
    status: "analyzed",
  }) as unknown as DocumentCatalogRecord;

const stored = async () => new Map((await readDocumentCatalogRecords()).map((item) => [item.documentId, item]));

describe("«Unificar nombres» con vista previa (03.6)", () => {
  it("planea sin escribir, aplica solo lo aceptado y respeta la ficha que cambió después", async () => {
    await saveDocumentCatalogRecord(record("aleph", "El Aleph", ["J. L. Borges"], "Literatura"));
    await saveDocumentCatalogRecord(record("ficciones", "Ficciones", ["Jorge Luis Borges"], "Literatura"));
    await saveDocumentCatalogRecord(record("hacedor", "El hacedor", ["J. L. Borges"], "Literatura"));
    await saveDocumentCatalogRecord(record("etica", "Ética", ["Baruch Spinoza"], "Filosofía"));
    await saveDocumentCatalogRecord(record("tratado", "Tratado teológico-político", ["Baruch Spinoza"], "Filosofia"));

    const plan = await planNameReconciliation();
    expect(plan.reviewed).toBe(5);
    expect(plan.merges.map(({ documentIds, from, kind, to }) => ({ documentIds, from, kind, to }))).toEqual([
      { documentIds: ["aleph", "hacedor"], from: "J. L. Borges", kind: "author", to: "Jorge Luis Borges" },
      // La grafía que se queda es la primera que se lee (las fichas van por id): «Ética».
      { documentIds: ["tratado"], from: "Filosofia", kind: "category", to: "Filosofía" },
    ]);
    expect(plan.merges[0]!.titles).toEqual(["El Aleph", "El hacedor"]);
    // Planear no escribe nada.
    expect((await stored()).get("aleph")!.catalog!.authors).toEqual(["J. L. Borges"]);

    // «El hacedor» se vuelve a catalogar entre la vista previa y «Unificar».
    await saveDocumentCatalogRecord({ ...record("hacedor", "El hacedor", ["J. L. Borges"], "Literatura"), analyzedAt: "2026-11-07T00:00:00.000Z" });

    // Se acepta la unión de autor, no la de categoría.
    const result = await applyNameReconciliation(plan, new Set([nameMergeKey("author", "J. L. Borges")]));
    expect(result).toEqual({ skipped: 1, updated: 1 });
    const after = await stored();
    expect(after.get("aleph")!.catalog!.authors).toEqual(["Jorge Luis Borges"]);
    expect(after.get("hacedor")!.catalog!.authors).toEqual(["J. L. Borges"]);
    expect(after.get("tratado")!.extras!.category).toBe("Filosofia");

    // Lo que queda sigue propuesto: el autor de «El hacedor» y la categoría.
    const rest = await planNameReconciliation();
    expect(rest.merges.map((merge) => merge.key).sort()).toEqual([nameMergeKey("author", "J. L. Borges"), nameMergeKey("category", "Filosofia")]);
    expect(await applyNameReconciliation(rest)).toEqual({ skipped: 0, updated: 2 });
    expect((await planNameReconciliation()).merges).toEqual([]);
  });
});
