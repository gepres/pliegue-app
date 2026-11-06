import { describe, expect, it } from "vitest";

import {
  createFileFingerprint,
  createImportedDocument,
  formatFileSize,
  maxImportedFileBytes,
  validateLocalFile,
} from "./local-file-metadata";

const file = {
  lastModified: 123,
  name: "Notas_de_campo.PDF",
  size: 2048,
  type: "application/pdf",
};

describe("archivos locales", () => {
  it("acepta formatos soportados sin distinguir mayúsculas", () => {
    expect(validateLocalFile(file)).toEqual({ format: "pdf", valid: true });
  });

  it("rechaza archivos vacíos, grandes o desconocidos", () => {
    expect(validateLocalFile({ ...file, size: 0 }).valid).toBe(false);
    expect(validateLocalFile({ ...file, size: maxImportedFileBytes + 1 }).valid).toBe(false);
    expect(validateLocalFile({ ...file, name: "archivo.exe" }).valid).toBe(false);
  });

  it("un EPUB o un DOCX puede pesar hasta 150 MB (un libro ilustrado); lo demás, 50 MB", () => {
    const megabytes = (size: number) => size * 1024 * 1024;
    expect(validateLocalFile({ ...file, name: "Paisajes peruanos.epub", size: megabytes(91.6) })).toEqual({ format: "epub", valid: true });
    expect(validateLocalFile({ ...file, name: "Informe.docx", size: megabytes(120) }).valid).toBe(true);
    expect(validateLocalFile({ ...file, name: "Atlas.epub", size: megabytes(151) })).toEqual({
      reason: "El archivo supera el límite local de 150 MB.",
      valid: false,
    });
    expect(validateLocalFile({ ...file, size: megabytes(60) })).toEqual({ reason: "El archivo supera el límite local de 50 MB.", valid: false });
  });

  it("crea metadatos con procedencia local y fingerprint estable", () => {
    const document = createImportedDocument(file, "doc-1", "2026-08-01T00:00:00.000Z");

    expect(document).toMatchObject({
      availability: "offline",
      format: "pdf",
      id: "doc-1",
      imported: true,
      origin: "local",
      title: "Notas de campo",
    });
    expect(document.fingerprint).toBe(createFileFingerprint(file));
    expect(formatFileSize(file.size)).toBe("2 KB");
  });
});
