import type { DocumentFormat } from "./documents";
import type {
  StructuredDocumentFormat,
  StructuredDocumentSection,
} from "./structured-document-extractor";

export const maxTextPreviewBytes = 1024 * 1024;

export type LocalDocumentPreview =
  | { content: string; kind: "text"; truncated: boolean }
  | { blob: Blob; kind: "image" | "pdf" }
  | {
      format: StructuredDocumentFormat;
      kind: "structured";
      sections: StructuredDocumentSection[];
      truncated: boolean;
    }
  | { kind: "unsupported" };

function isStructuredDocumentFormat(
  format: DocumentFormat,
): format is StructuredDocumentFormat {
  return format === "docx" || format === "epub" || format === "pptx" || format === "xlsx";
}

/**
 * Tipo con el que debe servirse cada formato que se entrega tal cual al navegador.
 *
 * Un `blob:` se sirve con el tipo que declara el propio Blob, no con el que pida la etiqueta
 * que lo muestra. `getFile()` puede devolverlo vacío —depende de lo que el sistema asocie a la
 * extensión—, y entonces el navegador entrega el PDF como texto plano: el lector acaba
 * enseñando «%PDF-1.4» y los objetos internos del archivo en lugar de sus páginas.
 */
const previewMimeTypes: Partial<Record<DocumentFormat, string>> = {
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
};

/** Devuelve el mismo blob si ya está bien tipado; si no, uno equivalente con su tipo real. */
export function withPreviewMimeType(blob: Blob, format: DocumentFormat) {
  const expected = previewMimeTypes[format];
  if (!expected || blob.type === expected) return blob;
  return new Blob([blob], { type: expected });
}

export function classifyLocalDocumentPreview(format: DocumentFormat) {
  if (format === "txt" || format === "md") return "text" as const;
  if (format === "png" || format === "jpg") return "image" as const;
  if (format === "pdf") return "pdf" as const;
  if (isStructuredDocumentFormat(format)) return "structured" as const;
  return "unsupported" as const;
}

export async function createLocalDocumentPreview(
  format: DocumentFormat,
  blob: Blob,
): Promise<LocalDocumentPreview> {
  const kind = classifyLocalDocumentPreview(format);

  if (kind === "text") {
    const truncated = blob.size > maxTextPreviewBytes;
    const content = await blob.slice(0, maxTextPreviewBytes).text();
    return { content, kind, truncated };
  }

  if (kind === "image" || kind === "pdf") {
    return { blob: withPreviewMimeType(blob, format), kind };
  }
  if (kind === "structured" && isStructuredDocumentFormat(format)) {
    const { extractStructuredDocument } = await import("./structured-document-extractor");
    const extraction = await extractStructuredDocument(format, blob);
    return { format, kind, ...extraction };
  }
  return { kind: "unsupported" };
}
