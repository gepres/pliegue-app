"use client";

import type { LibraryDocument } from "../library/documents";
import { providerModel, type AiSettings } from "./ai-settings";
import { checkApiKey } from "./api-key";
import { getSessionApiKey } from "./ai-session-secret-store";
import { requestCatalogFromProvider } from "./catalog-provider-client";
import {
  createCatalogDocumentInput,
  createCatalogInputFingerprint,
  type DocumentCatalogRecord,
} from "./document-catalog";
import {
  readDocumentCatalogRecords,
  saveDocumentCatalogRecord,
} from "./document-catalog-store";

export interface CatalogAnalysisSummary {
  analyzed: number;
  failed: number;
  needsContent: number;
  skipped: number;
  total: number;
}

interface AnalyzeCatalogOptions {
  force?: boolean;
  retryErrors?: boolean;
}

let activeRun: Promise<CatalogAnalysisSummary> | null = null;

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 280);
  return "No fue posible completar el análisis con IA.";
}

function createRecord(
  document: LibraryDocument,
  settings: AiSettings,
  fingerprint: string,
  status: DocumentCatalogRecord["status"],
  overrides: Partial<DocumentCatalogRecord> = {},
): DocumentCatalogRecord {
  return {
    analyzedAt: new Date().toISOString(),
    catalog: null,
    documentId: document.id,
    error: null,
    inputFingerprint: fingerprint,
    model: providerModel(settings),
    provider: settings.provider,
    schemaVersion: 1,
    status,
    ...overrides,
  };
}

async function runCatalogAnalysis(
  documents: readonly LibraryDocument[],
  settings: AiSettings,
  options: AnalyzeCatalogOptions,
) {
  const summary: CatalogAnalysisSummary = {
    analyzed: 0,
    failed: 0,
    needsContent: 0,
    skipped: 0,
    total: documents.length,
  };
  const model = providerModel(settings);
  if (!model) throw new Error("Configura un modelo antes de iniciar el análisis.");

  const apiKey = getSessionApiKey(settings.provider);
  if (settings.provider !== "ollama") {
    if (!apiKey) {
      throw new Error("Añade la API key de esta sesión en Ajustes antes de analizar.");
    }
    // Se comprueba antes del lote: enviar un valor que no es una credencial expone su
    // contenido al proveedor y gasta una llamada por documento para nada.
    const check = checkApiKey(settings.provider, apiKey);
    if (check.error) throw new Error(`${check.error} Revísala en Ajustes.`);
  }

  const storedRecords = await readDocumentCatalogRecords();
  const recordsByDocument = new Map(
    storedRecords.map((record) => [record.documentId, record]),
  );
  const queue = documents.filter((document) => {
    const fingerprint = createCatalogInputFingerprint(
      document,
      settings.provider,
      model,
      settings.maxExcerptCharacters,
    );
    const record = recordsByDocument.get(document.id);
    const current = record?.inputFingerprint === fingerprint;
    const reusable =
      record?.status === "analyzed" ||
      record?.status === "needs-content" ||
      (record?.status === "error" && !options.retryErrors);
    if (!options.force && current && reusable) {
      summary.skipped += 1;
      return false;
    }
    return true;
  });
  let nextIndex = 0;

  async function analyzeNext() {
    while (nextIndex < queue.length) {
      const document = queue[nextIndex];
      nextIndex += 1;
      if (!document) continue;
      const fingerprint = createCatalogInputFingerprint(
        document,
        settings.provider,
        model,
        settings.maxExcerptCharacters,
      );
      const input = createCatalogDocumentInput(document, settings.maxExcerptCharacters);

      if (!input.excerpt) {
        await saveDocumentCatalogRecord(
          createRecord(document, settings, fingerprint, "needs-content", {
            error:
              "Este archivo no tiene texto local: una imagen o un PDF escaneado requiere OCR antes del análisis semántico.",
          }),
        );
        summary.needsContent += 1;
        continue;
      }

      await saveDocumentCatalogRecord(
        createRecord(document, settings, fingerprint, "analyzing"),
      );
      try {
        const catalog = await requestCatalogFromProvider(input, settings, apiKey);
        await saveDocumentCatalogRecord(
          createRecord(document, settings, fingerprint, "analyzed", { catalog }),
        );
        summary.analyzed += 1;
      } catch (error) {
        await saveDocumentCatalogRecord(
          createRecord(document, settings, fingerprint, "error", {
            error: errorMessage(error),
          }),
        );
        summary.failed += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(settings.concurrency, queue.length) }, () => analyzeNext()),
  );
  return summary;
}

export function analyzeDocumentCatalogs(
  documents: readonly LibraryDocument[],
  settings: AiSettings,
  options: AnalyzeCatalogOptions = {},
) {
  if (activeRun) return activeRun;
  activeRun = runCatalogAnalysis(documents, settings, options).finally(() => {
    activeRun = null;
  });
  return activeRun;
}
