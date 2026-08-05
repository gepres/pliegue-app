import { describe, expect, it } from "vitest";

import {
  contentIndexVersion,
  createLocalContentIndex,
  isCurrentContentIndex,
  maxIndexedTextCharacters,
} from "./local-content-index";
import { createTestPdf } from "./pdf-test-fixture";

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
      indexVersion: contentIndexVersion,
      searchText: "Hallazgo principal con contexto",
    });
  });

  it("indexa el texto de un PDF sin conservar el archivo", async () => {
    const result = await createLocalContentIndex(
      "pdf",
      createTestPdf(["Metodo de investigacion", "Conclusiones del informe"]),
      "2026-08-02T00:00:00.000Z",
    );

    expect(result).toEqual({
      indexedAt: "2026-08-02T00:00:00.000Z",
      indexStatus: "indexed",
      indexVersion: contentIndexVersion,
      searchText: "Metodo de investigacion Conclusiones del informe",
    });
  });

  it("invalida los índices de una versión anterior del extractor", () => {
    // Un PDF vinculado antes de que existiera la extracción quedó sin versión guardada:
    // debe volver a indexarse aunque el archivo no haya cambiado.
    expect(isCurrentContentIndex(undefined)).toBe(false);
    expect(isCurrentContentIndex(1)).toBe(false);
    expect(isCurrentContentIndex(contentIndexVersion)).toBe(true);
  });

  it("mantiene un PDF escaneado como índice de metadatos hasta que exista OCR", async () => {
    await expect(
      createLocalContentIndex("pdf", createTestPdf([null, null])),
    ).resolves.toMatchObject({ indexStatus: "metadata-only", searchText: "" });
  });

  it("mantiene las imágenes como índice de metadatos", async () => {
    await expect(
      createLocalContentIndex("png", new Blob(["binario"], { type: "image/png" })),
    ).resolves.toMatchObject({ indexStatus: "metadata-only", searchText: "" });
  });

  it("marca como error un PDF ilegible sin interrumpir la vinculación", async () => {
    await expect(
      createLocalContentIndex("pdf", new Blob(["no es un pdf"])),
    ).resolves.toMatchObject({ indexStatus: "error", searchText: "" });
  });

  it("limita el texto derivado almacenado", async () => {
    const result = await createLocalContentIndex(
      "txt",
      new Blob(["a".repeat(maxIndexedTextCharacters + 100)]),
    );

    expect(result.searchText).toHaveLength(maxIndexedTextCharacters);
  });
});
