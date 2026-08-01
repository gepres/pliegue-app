import { describe, expect, it } from "vitest";

import {
  compareFolderDocuments,
  createLinkedFolderDocument,
  createLinkedDocumentId,
} from "./local-folder";

const baseFile = {
  lastModified: 100,
  name: "Notas_de_campo.PDF",
  relativePath: "Investigación\\Notas_de_campo.PDF",
  size: 2048,
  type: "application/pdf",
};

describe("carpetas locales vinculadas", () => {
  it("crea una identidad estable por fuente y ruta relativa", () => {
    expect(createLinkedDocumentId("source-1", "A\\Documento.PDF")).toBe(
      "linked:source-1:a/documento.pdf",
    );
  });

  it("convierte archivos compatibles en documentos sin copiar su contenido", () => {
    const document = createLinkedFolderDocument(baseFile, "source-1", "Corpus");

    expect(document).toMatchObject({
      availability: "available",
      author: "Carpeta vinculada · Corpus",
      format: "pdf",
      linked: true,
      relativePath: "Investigación/Notas_de_campo.PDF",
      sourceId: "source-1",
      title: "Notas de campo",
    });
    expect(createLinkedFolderDocument({ ...baseFile, name: "script.exe" }, "source-1", "Corpus")).toBeNull();
  });

  it("detecta altas, cambios y bajas al comparar manifiestos", () => {
    const unchanged = createLinkedFolderDocument(baseFile, "source-1", "Corpus");
    const changed = createLinkedFolderDocument(
      { ...baseFile, lastModified: 200, name: "Cambio.md", relativePath: "Cambio.md" },
      "source-1",
      "Corpus",
    );
    const previousChanged = createLinkedFolderDocument(
      { ...baseFile, lastModified: 100, name: "Cambio.md", relativePath: "Cambio.md" },
      "source-1",
      "Corpus",
    );
    const removed = createLinkedFolderDocument(
      { ...baseFile, name: "Eliminado.txt", relativePath: "Eliminado.txt" },
      "source-1",
      "Corpus",
    );
    const added = createLinkedFolderDocument(
      { ...baseFile, name: "Nuevo.docx", relativePath: "Nuevo.docx" },
      "source-1",
      "Corpus",
    );

    expect(unchanged && changed && previousChanged && removed && added).toBeTruthy();
    expect(
      compareFolderDocuments(
        [unchanged!, previousChanged!, removed!],
        [unchanged!, changed!, added!],
      ),
    ).toEqual({ added: 1, changed: 1, removed: 1, total: 3, unchanged: 1 });
  });
});
