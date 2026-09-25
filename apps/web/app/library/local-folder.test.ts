import { describe, expect, it } from "vitest";

import {
  compareFolderDocuments,
  createLinkedFolderDocument,
  createLinkedDocumentId,
  describeSkippedFile,
  listSkippedFiles,
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

describe("archivos que la carpeta no puede leer", () => {
  const file = (relativePath: string, size = 1024) => ({
    lastModified: 1,
    name: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    size,
    type: "",
  });

  it("lista solo lo que no se convierte en documento", () => {
    const skipped = listSkippedFiles([
      file("libro.pdf"),
      file("Antropologia del cuerpo.rar"),
      file("Grinberg/charla.mp3"),
      file("Larrea - La cultura de los olores"),
      file("vacio.pdf", 0),
    ]);

    expect(skipped.map((item) => item.relativePath)).toEqual([
      "Antropologia del cuerpo.rar",
      "Grinberg/charla.mp3",
      "Larrea - La cultura de los olores",
      "vacio.pdf",
    ]);
  });

  it("explica qué hacer con cada tipo", () => {
    expect(describeSkippedFile({ relativePath: "a.rar", size: 10 }).kind).toBe("archive");
    // Un ZIP ya extraído no se vuelve a extraer: duplicaría la carpeta.
    expect(describeSkippedFile({ relativePath: "a.zip", size: 10 }).advice).toMatch(/extráelo.*ya lo extrajiste.*sobra/s);
    expect(describeSkippedFile({ relativePath: "x/charla.mp3", size: 10 }).kind).toBe("audio");
    expect(describeSkippedFile({ relativePath: "La cultura de los olores", size: 10 })).toEqual({
      advice: "No tiene extensión. Si es un PDF, añade «.pdf» al final del nombre.",
      kind: "no-extension",
    });
    expect(describeSkippedFile({ relativePath: "viejo.doc", size: 10 }).kind).toBe("legacy-office");
    expect(describeSkippedFile({ relativePath: "vacio.pdf", size: 0 }).kind).toBe("empty");
  });
});
