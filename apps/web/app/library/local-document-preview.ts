import type { DocumentFormat } from "./documents";

export const maxTextPreviewBytes = 1024 * 1024;

export type LocalDocumentPreview =
  | { content: string; kind: "text"; truncated: boolean }
  | { blob: Blob; kind: "image" | "pdf" }
  | { kind: "unsupported" };

export function classifyLocalDocumentPreview(format: DocumentFormat) {
  if (format === "txt" || format === "md") return "text" as const;
  if (format === "png" || format === "jpg") return "image" as const;
  if (format === "pdf") return "pdf" as const;
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
  return { kind };
}
