import { describe, expect, it } from "vitest";

import { chunkerVersion } from "../library/chunking";
import type { LibraryDocument } from "../library/documents";
import type { SemanticDocumentRecord } from "../library/semantic-index-store";
import { defaultAiSettings } from "./ai-settings";
import { embeddingBatches, embeddingConfigOf, embeddingKey, estimateTokens } from "./embeddings";
import { documentVersion, indexNeeds, isIndexable, plainTextSections } from "./semantic-indexer";

const book = (extra: Partial<LibraryDocument> = {}) =>
  ({ format: "epub", id: "libro", indexedAt: "2026-11-01T00:00:00.000Z", searchText: "texto", title: "Libro", ...extra }) as LibraryDocument;

const record = (extra: Partial<SemanticDocumentRecord> = {}): SemanticDocumentRecord => ({
  chunkCount: 10,
  chunkerVersion,
  documentId: "libro",
  embeddedCount: 10,
  embeddingKey: "gemini:gemini-embedding-001:768",
  error: null,
  indexedAt: "2026-11-02T00:00:00.000Z",
  sourceKey: "copies",
  status: "ready",
  truncated: false,
  version: documentVersion(book()),
  ...extra,
});

describe("indexar la biblioteca (04.4)", () => {
  it("indexa PDF, EPUB, DOCX, PPTX, XLSX, TXT y MD; no las imágenes", () => {
    for (const format of ["pdf", "epub", "docx", "pptx", "xlsx", "txt", "md"] as const) expect(isIndexable({ format })).toBe(true);
    expect(isIndexable({ format: "png" })).toBe(false);
  });

  it("en Markdown, las líneas con # son títulos; en texto plano, no", () => {
    const text = "# Capítulo\n\nPrimer párrafo\npartido en dos renglones.\n\n## Parte\n\nOtro.";
    const [markdown] = plainTextSections(text, true);
    expect(markdown?.blocks).toEqual([
      { kind: "heading", level: 1, text: "Capítulo" },
      { kind: "paragraph", text: "Primer párrafo partido en dos renglones." },
      { kind: "heading", level: 2, text: "Parte" },
      { kind: "paragraph", text: "Otro." },
    ]);
    expect(plainTextSections(text, false)[0]?.blocks.every((block) => block.kind === "paragraph")).toBe(true);
  });

  it("sabe qué le falta a cada libro: trocear si cambió, vectores si faltan o son de otro modelo", () => {
    const key = "gemini:gemini-embedding-001:768";
    expect(indexNeeds(book(), undefined, key)).toEqual({ chunk: true, embed: true });
    expect(indexNeeds(book(), record(), key)).toEqual({ chunk: false, embed: false });
    expect(indexNeeds(book({ indexedAt: "2026-11-05T00:00:00.000Z" }), record(), key)).toEqual({ chunk: true, embed: true });
    expect(indexNeeds(book(), record({ chunkerVersion: chunkerVersion - 1 }), key)).toEqual({ chunk: true, embed: true });
    expect(indexNeeds(book(), record({ embeddedCount: 4 }), key)).toEqual({ chunk: false, embed: true });
    expect(indexNeeds(book(), record(), "openai:text-embedding-3-small:768")).toEqual({ chunk: false, embed: true });
    // Sin vectores (Anthropic, o solo palabras), basta con trocear.
    expect(indexNeeds(book(), record(), null)).toEqual({ chunk: false, embed: false });
    // Un confidencial con un proveedor en la nube no espera vectores: no queda pendiente.
    expect(indexNeeds(book(), record({ embeddedCount: 0, embeddingKey: null }), key, false)).toEqual({ chunk: false, embed: false });
    expect(indexNeeds(book(), undefined, key, false)).toEqual({ chunk: true, embed: false });
    // Un libro sin texto no pide vectores.
    expect(indexNeeds(book(), record({ chunkCount: 0, embeddedCount: 0, status: "no-text" }), key)).toEqual({ chunk: false, embed: false });
  });

  it("la versión del libro es su huella si la tiene", () => {
    expect(documentVersion(book({ fingerprint: "abc" } as Partial<LibraryDocument>))).toBe("abc");
    expect(documentVersion(book())).toBe("2026-11-01T00:00:00.000Z:5");
  });

  it("los embeddings van con el proveedor de catalogar, con su modelo y 768 dimensiones", () => {
    const gemini = embeddingConfigOf({ ...defaultAiSettings, provider: "gemini" });
    expect(gemini).toMatchObject({ dimensions: 768, model: "gemini-embedding-001", place: "cloud", provider: "gemini" });
    expect(embeddingKey(gemini!)).toBe("gemini:gemini-embedding-001:768");
    expect(embeddingConfigOf({ ...defaultAiSettings, provider: "anthropic" })).toBeNull();
    expect(embeddingConfigOf({ ...defaultAiSettings, ollamaMode: "local", provider: "ollama" })).toMatchObject({
      dimensions: null,
      model: "embeddinggemma",
      place: "device",
    });
  });

  it("parte los fragmentos en lotes de 64 y 48.000 caracteres como mucho", () => {
    const items = Array.from({ length: 150 }, () => ({ text: "x".repeat(500) }));
    expect(embeddingBatches(items).map((batch) => batch.length)).toEqual([64, 64, 22]);
    const big = Array.from({ length: 10 }, () => ({ text: "x".repeat(20_000) }));
    expect(embeddingBatches(big).map((batch) => batch.length)).toEqual([2, 2, 2, 2, 2]);
    expect(estimateTokens(10)).toBe(3);
  });
});
