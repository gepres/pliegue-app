import { describe, expect, it } from "vitest";

import { createLinkedFileDocument } from "./local-file-reference";

const index = {
  indexedAt: "2026-08-01T00:00:00.000Z",
  indexStatus: "indexed" as const,
  searchText: "contenido derivado",
};

describe("createLinkedFileDocument", () => {
  it("crea una referencia sin Blob ni ruta absoluta", () => {
    const document = createLinkedFileDocument(
      {
        lastModified: 1_700_000_000_000,
        name: "Informe_final.docx",
        size: 1_024,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      "reference-1",
      "2026-08-01T00:00:00.000Z",
      index,
    );

    expect(document).toMatchObject({
      id: "reference-1",
      linked: true,
      reference: { kind: "local-file", referenceId: "reference-1" },
      searchText: "contenido derivado",
      title: "Informe final",
    });
    expect(document).not.toHaveProperty("blob");
    expect(document).not.toHaveProperty("path");
  });
});
