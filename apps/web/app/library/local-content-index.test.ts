import { describe, expect, it } from "vitest";

import {
  createLocalContentIndex,
  maxIndexedTextCharacters,
} from "./local-content-index";

describe("createLocalContentIndex", () => {
  it("crea un índice derivado para texto sin conservar el archivo", async () => {
    const result = await createLocalContentIndex(
      "txt",
      new Blob(["Hallazgo principal\n\ncon contexto"], { type: "text/plain" }),
      "2026-08-01T00:00:00.000Z",
    );

    expect(result).toEqual({
      indexedAt: "2026-08-01T00:00:00.000Z",
      indexStatus: "indexed",
      searchText: "Hallazgo principal con contexto",
    });
  });

  it("mantiene PDF e imágenes como índice de metadatos", async () => {
    await expect(createLocalContentIndex("pdf", new Blob(["pdf"]))).resolves.toMatchObject({
      indexStatus: "metadata-only",
      searchText: "",
    });
  });

  it("limita el texto derivado almacenado", async () => {
    const result = await createLocalContentIndex(
      "txt",
      new Blob(["a".repeat(maxIndexedTextCharacters + 100)]),
    );

    expect(result.searchText).toHaveLength(maxIndexedTextCharacters);
  });
});
