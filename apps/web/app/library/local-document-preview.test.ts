import { describe, expect, it } from "vitest";

import {
  classifyLocalDocumentPreview,
  createLocalDocumentPreview,
  maxTextPreviewBytes,
  withPreviewMimeType,
} from "./local-document-preview";

describe("tipo con el que se sirve la previsualización", () => {
  it("declara el PDF cuando el archivo llega sin tipo", async () => {
    // El navegador sirve un blob: con el tipo del blob, no con el que pida la etiqueta que lo
    // muestra. Sin esto, el visor enseña «%PDF-1.4» y los objetos internos como texto.
    const preview = await createLocalDocumentPreview("pdf", new Blob(["%PDF-1.4"]));

    expect(preview.kind).toBe("pdf");
    expect((preview as { blob: Blob }).blob.type).toBe("application/pdf");
  });

  it("declara el tipo de cada imagen admitida", () => {
    expect(withPreviewMimeType(new Blob(["x"]), "png").type).toBe("image/png");
    expect(withPreviewMimeType(new Blob(["x"]), "jpg").type).toBe("image/jpeg");
  });

  it("conserva el blob intacto cuando ya viene bien tipado", () => {
    const original = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    expect(withPreviewMimeType(original, "pdf")).toBe(original);
  });

  it("no toca los formatos que no se entregan directamente al navegador", () => {
    const original = new Blob(["x"]);
    expect(withPreviewMimeType(original, "epub")).toBe(original);
    expect(withPreviewMimeType(original, "txt")).toBe(original);
  });

  it("corrige un tipo equivocado en lugar de confiar en él", () => {
    const mal = new Blob(["%PDF-1.4"], { type: "text/plain" });
    expect(withPreviewMimeType(mal, "pdf").type).toBe("application/pdf");
  });
});

describe("previsualización de documentos locales", () => {
  it("clasifica formatos que el navegador puede mostrar de forma segura", () => {
    expect(classifyLocalDocumentPreview("txt")).toBe("text");
    expect(classifyLocalDocumentPreview("md")).toBe("text");
    expect(classifyLocalDocumentPreview("png")).toBe("image");
    expect(classifyLocalDocumentPreview("jpg")).toBe("image");
    expect(classifyLocalDocumentPreview("pdf")).toBe("pdf");
  });

  it("deriva formatos comprimidos al extractor estructurado", () => {
    expect(classifyLocalDocumentPreview("epub")).toBe("structured");
    expect(classifyLocalDocumentPreview("docx")).toBe("structured");
    expect(classifyLocalDocumentPreview("pptx")).toBe("structured");
    expect(classifyLocalDocumentPreview("xlsx")).toBe("structured");
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
