"use client";

import type { LibraryDocument } from "../library/documents";
import { AuthorIndex, authorKey } from "./author-names";
import { providerModel, type AiSettings } from "./ai-settings";
import { checkApiKey } from "./api-key";
import { getSessionApiKey } from "./ai-session-secret-store";
import { requestCatalogFromProvider } from "./catalog-provider-client";
import {
  addCatalogUsage,
  createCatalogDocumentInput,
  createCatalogInputFingerprint,
  emptyCatalogUsage,
  type CatalogUsage,
  type DocumentCatalogRecord,
} from "./document-catalog";
import {
  readDocumentCatalogRecords,
  saveDocumentCatalogRecord,
} from "./document-catalog-store";

/**
 * Documentos por bloque. La cola se recorre en tramos para que entre uno y otro el navegador
 * recupere el hilo, se publique el avance y se pueda detener sin perder lo ya guardado: un
 * corpus de doscientos documentos tarda minutos y dejarlo sin puntos de control convierte la
 * pestaña en una caja negra.
 */
export const catalogBatchSize = 20;

export interface CatalogAnalysisProgress {
  analyzed: number;
  /** Título en curso, para que la interfaz muestre algo que se mueve. */
  current: string | null;
  /** Lo mide el análisis y no la interfaz: el reloj no tiene sitio dentro de un render. */
  elapsedMs: number;
  failed: number;
  needsContent: number;
  processed: number;
  queued: number;
  skipped: number;
  stopped: boolean;
  total: number;
  usage: CatalogUsage;
}

export type CatalogAnalysisSummary = CatalogAnalysisProgress;

interface AnalyzeCatalogOptions {
  batchSize?: number;
  force?: boolean;
  onProgress?: (progress: CatalogAnalysisProgress) => void;
  retryErrors?: boolean;
}

let activeRun: Promise<CatalogAnalysisSummary> | null = null;
let stopRequested = false;

/** Detiene el análisis en curso al terminar el bloque actual. Lo ya guardado se conserva. */
export function stopCatalogAnalysis() {
  stopRequested = true;
}

export function catalogAnalysisRunning() {
  return activeRun !== null;
}

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

/** Cede el hilo entre bloques para que la interfaz pinte el avance. */
function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export interface AuthorReconciliationResult {
  merged: Array<{ from: string; to: string }>;
  reviewed: number;
  updated: number;
}

/**
 * Unifica las grafías de autor en las fichas ya guardadas. Se ejecuta al terminar un análisis
 * y también puede lanzarse sola: arregla un catálogo heredado sin gastar una sola llamada al
 * proveedor, que es justo lo que hacía falta cuando el mismo autor figuraba tres veces.
 */
export async function reconcileStoredAuthors(): Promise<AuthorReconciliationResult> {
  const records = await readDocumentCatalogRecords();
  const index = new AuthorIndex();
  const merged = new Map<string, string>();

  // Primera pasada: fijar la forma canónica de cada autor viendo el catálogo entero.
  for (const record of records) {
    for (const author of record.catalog?.authors ?? []) index.add(author);
  }

  let updated = 0;
  for (const record of records) {
    const authors = record.catalog?.authors;
    if (!record.catalog || !authors?.length) continue;

    const canonical = authors.map((author) => index.resolve(author));
    for (const [position, author] of authors.entries()) {
      const destino = canonical[position] as string;
      if (authorKey(destino) !== authorKey(author)) merged.set(author, destino);
    }
    if (canonical.every((author, position) => author === authors[position])) continue;

    await saveDocumentCatalogRecord({
      ...record,
      catalog: { ...record.catalog, authors: canonical },
    });
    updated += 1;
  }

  return {
    merged: [...merged].map(([from, to]) => ({ from, to })),
    reviewed: records.length,
    updated,
  };
}

async function runCatalogAnalysis(
  documents: readonly LibraryDocument[],
  settings: AiSettings,
  options: AnalyzeCatalogOptions,
) {
  const startedAt = Date.now();
  const progress: CatalogAnalysisProgress = {
    analyzed: 0,
    current: null,
    elapsedMs: 0,
    failed: 0,
    needsContent: 0,
    processed: 0,
    queued: 0,
    skipped: 0,
    stopped: false,
    total: documents.length,
    usage: emptyCatalogUsage,
  };
  const publish = () => {
    progress.elapsedMs = Date.now() - startedAt;
    options.onProgress?.({ ...progress, usage: { ...progress.usage } });
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
  // El índice arranca con lo que el catálogo ya sabe, de modo que el primer documento del lote
  // ya recibe las grafías establecidas y no vuelve a inaugurar una variante.
  const authorIndex = new AuthorIndex(
    storedRecords.flatMap((record) => record.catalog?.authors ?? []),
  );

  const queue = documents.filter((document) => {
    // Una ficha escrita a mano ya es mejor evidencia que la que produciría el modelo, así que
    // analizarla otra vez solo gastaría tokens. Para rehacerla hay que pedirlo con `force`.
    if (!options.force && document.catalogSource === "import" && document.catalog) {
      progress.skipped += 1;
      return false;
    }

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
      progress.skipped += 1;
      return false;
    }
    return true;
  });

  progress.queued = queue.length;
  publish();

  const batchSize = Math.max(1, options.batchSize ?? catalogBatchSize);

  async function analyzeOne(document: LibraryDocument) {
    const fingerprint = createCatalogInputFingerprint(
      document,
      settings.provider,
      model,
      settings.maxExcerptCharacters,
    );
    const input = createCatalogDocumentInput(
      document,
      settings.maxExcerptCharacters,
      authorIndex.names,
    );
    progress.current = document.title;

    if (!input.excerpt) {
      await saveDocumentCatalogRecord(
        createRecord(document, settings, fingerprint, "needs-content", {
          error:
            "Este archivo no tiene texto local: una imagen o un PDF escaneado requiere OCR antes del análisis semántico.",
        }),
      );
      progress.needsContent += 1;
      return;
    }

    await saveDocumentCatalogRecord(
      createRecord(document, settings, fingerprint, "analyzing"),
    );

    try {
      const { catalog, usage } = await requestCatalogFromProvider(input, settings, apiKey);
      // El modelo recibe los autores conocidos, pero no siempre los respeta: la grafía se
      // decide aquí, donde la reconciliación es una regla y no una sugerencia.
      const authors = catalog.authors.map((author) => authorIndex.add(author));
      await saveDocumentCatalogRecord(
        createRecord(document, settings, fingerprint, "analyzed", {
          catalog: { ...catalog, authors },
        }),
      );
      progress.analyzed += 1;
      progress.usage = addCatalogUsage(progress.usage, usage);
    } catch (error) {
      await saveDocumentCatalogRecord(
        createRecord(document, settings, fingerprint, "error", {
          error: errorMessage(error),
        }),
      );
      progress.failed += 1;
    }
  }

  for (let start = 0; start < queue.length; start += batchSize) {
    if (stopRequested) {
      progress.stopped = true;
      break;
    }

    const batch = queue.slice(start, start + batchSize);
    let nextIndex = 0;

    async function analyzeNext() {
      while (nextIndex < batch.length && !stopRequested) {
        const document = batch[nextIndex];
        nextIndex += 1;
        if (!document) continue;
        await analyzeOne(document);
        progress.processed += 1;
        publish();
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(settings.concurrency, batch.length) }, () => analyzeNext()),
    );
    await yieldToBrowser();
  }

  if (stopRequested) progress.stopped = true;
  progress.current = null;

  // Solo merece la pena repasar lo guardado si este lote llegó a escribir algo.
  if (progress.analyzed) await reconcileStoredAuthors();

  publish();
  return progress;
}

export function analyzeDocumentCatalogs(
  documents: readonly LibraryDocument[],
  settings: AiSettings,
  options: AnalyzeCatalogOptions = {},
) {
  if (activeRun) return activeRun;
  stopRequested = false;
  activeRun = runCatalogAnalysis(documents, settings, options).finally(() => {
    activeRun = null;
    stopRequested = false;
  });
  return activeRun;
}
