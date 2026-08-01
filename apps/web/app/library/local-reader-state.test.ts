import { describe, expect, it } from "vitest";

import type { LinkedFolderDocument } from "./local-folder";
import { resolveLocalReaderDocument } from "./local-reader-state";

const document: LinkedFolderDocument = {
  author: "Carpeta vinculada",
  availability: "available",
  fingerprint: "nota.txt::12::1",
  format: "txt",
  id: "linked:source:nota.txt",
  lastModified: 1,
  linked: true,
  meta: "nota.txt · 12 B",
  origin: "local",
  reference: { kind: "local-folder", relativePath: "nota.txt", sourceId: "source" },
  relativePath: "nota.txt",
  sizeBytes: 12,
  sourceId: "source",
  tags: ["nota"],
  title: "Nota",
};

describe("resolución del documento del lector", () => {
  it("abre un documento encontrado aunque otra fuente tenga error", () => {
    const resolution = resolveLocalReaderDocument(document.id, [
      { documents: [], error: "Copias no disponibles", status: "error" },
      { documents: [document], error: null, status: "ready" },
    ]);

    expect(resolution).toEqual({ document, status: "found" });
  });

  it("espera una fuente pendiente antes de declarar un error ajeno", () => {
    const resolution = resolveLocalReaderDocument(document.id, [
      { documents: [], error: "Referencias no disponibles", status: "error" },
      { documents: [], error: null, status: "loading" },
    ]);

    expect(resolution).toEqual({ status: "loading" });
  });

  it("propaga el error cuando todas las fuentes terminaron y no hay documento", () => {
    const resolution = resolveLocalReaderDocument(document.id, [
      { documents: [], error: "Carpeta desconectada", status: "error" },
      { documents: [], error: null, status: "ready" },
    ]);

    expect(resolution).toEqual({ message: "Carpeta desconectada", status: "error" });
  });

  it("distingue un documento ausente de un almacén fallido", () => {
    const resolution = resolveLocalReaderDocument(document.id, [
      { documents: [], error: null, status: "ready" },
    ]);

    expect(resolution).toEqual({ status: "missing" });
  });
});
