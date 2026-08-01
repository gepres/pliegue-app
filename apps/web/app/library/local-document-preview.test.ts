import { describe, expect, it } from "vitest";

import {
  classifyLocalDocumentPreview,
  createLocalDocumentPreview,
  maxTextPreviewBytes,
} from "./local-document-preview";

describe("previsualización de documentos locales", () => {
  it("clasifica formatos que el navegador puede mostrar de forma segura", () => {
    expect(classifyLocalDocumentPreview("txt")).toBe("text");
    expect(classifyLocalDocumentPreview("md")).toBe("text");
    expect(classifyLocalDocumentPreview("png")).toBe("image");
    expect(classifyLocalDocumentPreview("jpg")).toBe("image");
    expect(classifyLocalDocumentPreview("pdf")).toBe("pdf");
  });

  it("expone un fallback para formatos que requieren extracción", () => {
    expect(classifyLocalDocumentPreview("epub")).toBe("unsupported");
    expect(classifyLocalDocumentPreview("docx")).toBe("unsupported");
    expect(classifyLocalDocumentPreview("pptx")).toBe("unsupported");
    expect(classifyLocalDocumentPreview("xlsx")).toBe("unsupported");
  });

  it("lee TXT y Markdown como texto plano sin interpretar HTML", async () => {
    const preview = await createLocalDocumentPreview(
      "md",
      new Blob(["# Nota\n<script>alert('no')</script>"], { type: "text/markdown" }),
    );

    expect(preview).toEqual({
      content: "# Nota\n<script>alert('no')</script>",
      kind: "text",
      truncated: false,
    });
  });

  it("limita la lectura de texto para proteger la interfaz", async () => {
    const preview = await createLocalDocumentPreview(
      "txt",
      new Blob(["a".repeat(maxTextPreviewBytes + 24)]),
    );

    expect(preview.kind).toBe("text");
    if (preview.kind !== "text") throw new Error("Se esperaba texto");
    expect(preview.content).toHaveLength(maxTextPreviewBytes);
    expect(preview.truncated).toBe(true);
  });
});
