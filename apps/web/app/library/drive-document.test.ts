import { describe, expect, it } from "vitest";

import { catalogMatchKeys, documentMatchKeys } from "./catalog-import";
import { createDriveDocument, listSkippedDriveFiles, sameDriveContent } from "./drive-document";
import { createLinkedFileFingerprint } from "./local-folder";

const placement = { addedAt: "2026-09-30T12:00:00.000Z", sourceId: "carpeta-1", sourceName: "Libros" };
const pdf = {
  id: "abc",
  md5Checksum: "m1",
  mimeType: "application/pdf",
  modifiedTime: "2026-09-24T10:11:12.345Z",
  name: "Kant.pdf",
  size: "2048",
};

describe("documentos de Google Drive", () => {
  it("crea la referencia de Drive con la huella de las carpetas locales", () => {
    const document = createDriveDocument(pdf, { ...placement, relativePath: "FILOSOFÍA/Kant.pdf" });
    expect(document).toMatchObject({
      format: "pdf",
      id: "drive:carpeta-1:abc",
      indexStatus: "pending",
      origin: "drive",
      originalName: "Kant.pdf",
      reference: { fileId: "abc", kind: "google-drive" },
      relativePath: "FILOSOFÍA/Kant.pdf",
      sizeBytes: 2048,
      sourceId: "carpeta-1",
      title: "Kant",
    });
    // La misma huella que tendría el archivo en una carpeta local con esa fecha.
    expect(document?.fingerprint).toBe(
      createLinkedFileFingerprint({
        lastModified: Date.parse(pdf.modifiedTime),
        name: "Kant.pdf",
        relativePath: "FILOSOFÍA/Kant.pdf",
        size: 2048,
        type: "",
      }),
    );
  });

  it("encaja con una ficha del índice JSON por ruta y por huella", () => {
    const document = createDriveDocument(pdf, { ...placement, relativePath: "FILOSOFÍA/Kant.pdf" });
    if (!document) throw new Error("sin documento");
    const keys = documentMatchKeys(document);
    const entry = catalogMatchKeys({
      fileName: "Kant.pdf",
      fingerprint: null,
      lastModified: Date.parse(pdf.modifiedTime),
      relativePath: "FILOSOFÍA/Kant.pdf",
      sizeBytes: 2048,
    });
    expect(keys.some((key) => key.startsWith("path:") && entry.includes(key))).toBe(true);
    // Un archivo elegido suelto no tiene ruta de carpeta: encaja solo por nombre o huella.
    const loose = createDriveDocument(pdf, { ...placement, sourceId: null, sourceName: null });
    if (!loose) throw new Error("sin documento");
    expect(loose.id).toBe("drive:archivos:abc");
    expect(documentMatchKeys(loose).some((key) => key.startsWith("path:"))).toBe(false);
  });

  it("lee un Documento de Google como DOCX y descarta lo que no sabe leer", () => {
    const googleDoc = createDriveDocument(
      { id: "g", mimeType: "application/vnd.google-apps.document", name: "Notas" },
      { ...placement, relativePath: "Apuntes/Notas" },
    );
    expect(googleDoc).toMatchObject({ format: "docx", originalName: "Notas.docx", relativePath: "Apuntes/Notas.docx" });
    expect(createDriveDocument({ ...pdf, name: "Grinberg.rar" }, placement)).toBeNull();
    expect(
      listSkippedDriveFiles([
        { ...pdf, name: "Grinberg.rar", relativePath: "Grinberg.rar" },
        { ...pdf, relativePath: "Kant.pdf" },
        { ...pdf, name: "Borrado.rar", relativePath: "Borrado.rar", trashed: true },
      ]),
    ).toEqual([{ relativePath: "Grinberg.rar", size: 2048 }]);
  });

  it("solo reutiliza el índice si el contenido no cambió", () => {
    const before = createDriveDocument(pdf, placement);
    const same = createDriveDocument(pdf, placement);
    const edited = createDriveDocument({ ...pdf, md5Checksum: "m2" }, placement);
    if (!before || !same || !edited) throw new Error("sin documento");
    expect(sameDriveContent(before, same)).toBe(true);
    expect(sameDriveContent(before, edited)).toBe(false);
  });
});
