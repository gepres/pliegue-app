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

  if (kind === "image" || kind === "pdf") return { blob, kind };
  if (kind === "structured" && isStructuredDocumentFormat(format)) {
    const { extractStructuredDocument } = await import("./structured-document-extractor");
    const extraction = await extractStructuredDocument(format, blob);
    return { format, kind, ...extraction };
  }
  return { kind: "unsupported" };
}
