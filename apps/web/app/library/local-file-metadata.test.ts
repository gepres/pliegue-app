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
