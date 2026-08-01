import type { DocumentFormat, DocumentIndexStatus } from "./documents";
import { createLocalDocumentPreview } from "./local-document-preview";

export const maxIndexedTextCharacters = 32_000;

export interface LocalContentIndex {
  indexedAt: string;
  indexStatus: DocumentIndexStatus;
  searchText: string;
}

function normalizeIndexText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, maxIndexedTextCharacters);
}

export async function createLocalContentIndex(
  format: DocumentFormat,
  file: Blob,
  indexedAt = new Date().toISOString(),
): Promise<LocalContentIndex> {
  try {
    const preview = await createLocalDocumentPreview(format, file);

    if (preview.kind === "text") {
      return {
        indexedAt,
        indexStatus: "indexed",
        searchText: normalizeIndexText(preview.content),
      };
    }

    if (preview.kind === "structured") {
      const chunks: string[] = [];

      for (const section of preview.sections) {
        chunks.push(section.label, section.title);
        for (const block of section.blocks) {
          if (block.kind === "table") {
            for (const row of block.rows) chunks.push(row.join(" "));
          } else {
            chunks.push(block.text);
          }
        }
      }

      return {
        indexedAt,
        indexStatus: "indexed",
        searchText: normalizeIndexText(chunks.join(" ")),
      };
    }

    return { indexedAt, indexStatus: "metadata-only", searchText: "" };
  } catch {
    return { indexedAt, indexStatus: "error", searchText: "" };
  }
}
