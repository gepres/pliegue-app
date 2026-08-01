import type { ImportedDocument } from "./local-file-metadata";
import type { LinkedFileDocument } from "./local-file-reference";
import type { LinkedFolderDocument } from "./local-folder";

export type LocalReaderDocument = ImportedDocument | LinkedFileDocument | LinkedFolderDocument;

type ReaderStoreStatus = "error" | "idle" | "loading" | "ready";

interface ReaderDocumentStore {
  documents: readonly LocalReaderDocument[];
  error: string | null;
  status: ReaderStoreStatus;
}

export type LocalReaderResolution =
  | { document: LocalReaderDocument; status: "found" }
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "missing" };

export function resolveLocalReaderDocument(
  documentId: string,
  stores: readonly ReaderDocumentStore[],
): LocalReaderResolution {
  for (const store of stores) {
    const document = store.documents.find((item) => item.id === documentId);
    if (document) return { document, status: "found" };
  }

  if (stores.some((store) => store.status === "idle" || store.status === "loading")) {
    return { status: "loading" };
  }

  const error = stores.find((store) => store.status === "error")?.error;
  if (error) return { message: error, status: "error" };

  return { status: "missing" };
}
