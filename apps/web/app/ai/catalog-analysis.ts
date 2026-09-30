"use client";

import type { LibraryDocument } from "../library/documents";
import { readImportedCatalogRecords } from "../library/imported-catalog-store";
import { AuthorIndex, authorKey } from "./author-names";
import { groundCatalogExtras } from "./catalog-grounding";
import { CategoryIndex, spanishCategory } from "./category-names";
import { providerModel, type AiSettings } from "./ai-settings";
import { checkApiKey } from "./api-key";
import { getSessionApiKey } from "./ai-session-secret-store";
import { requestCatalogFromProvider } from "./catalog-provider-client";
import {
  addCatalogUsage,
  catalogPromptVersion,
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

/**
 * Por qué un documento entra en la cola, o `null` si no entra:
 * - `new`: nunca se analizó;
 * - `error`: el último intento falló (solo con `retryErrors`);
 * - `outdated`: su ficha es de un prompt anterior, sin los campos que se añadieron después
 *   (hoy, la categoría y los datos de la edición);
 * - `changed`: cambió su texto, el proveedor o el modelo.
 *
 * La comparten el análisis y el panel: si el panel contara por su cuenta, anunciaría «0
 * pendientes» y el botón acabaría reanalizando medio corpus.
 */
export type CatalogQueueReason = "changed" | "error" | "new" | "outdated";

export function catalogQueueReason(
  document: LibraryDocument,
  record: DocumentCatalogRecord | undefined,
  settings: AiSettings,
  options: { force?: boolean; retryErrors?: boolean } = {},
): CatalogQueueReason | null {
  // Una ficha escrita a mano ya es mejor evidencia que la que produciría el modelo, así que
  // analizarla otra vez solo gastaría tokens. Para rehacerla hay que pedirlo con `force`.
  if (!options.force && document.catalogSource === "import" && document.catalog) return null;
  if (!record) return "new";
  if (options.force) return "changed";

  const fingerprint = createCatalogInputFingerprint(
    document,
    settings.provider,
    providerModel(settings),
    settings.maxExcerptCharacters,
  );
  if (record.inputFingerprint !== fingerprint) {
    return record.inputFingerprint.startsWith(`v${catalogPromptVersion}:`) ? "changed" : "outdated";
  }
  if (record.status === "error") return options.retryErrors ? "error" : null;
  // Una ficha que se quedó «analizando» es de una pestaña que se cerró a medias.
  if (record.status === "analyzing") return "error";
  return null;
}

/** Cuántos documentos con texto se enviarían ahora: el número del botón «Catalogar N». */
export function countCatalogPending(
  documents: readonly LibraryDocument[],
  records: readonly DocumentCatalogRecord[],
  settings: AiSettings,
) {
  const recordsById = new Map(records.map((record) => [record.documentId, record]));
  return documents.filter(
    (document) =>
      Boolean(document.searchText?.trim()) &&
      catalogQueueReason(document, recordsById.get(document.id), settings, { retryErrors: true }) !== null,
  ).length;
}

/** Cede el hilo entre bloques para que la interfaz pinte el avance. */
function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export interface NameReconciliationResult {
  /** Variantes de autor unidas: «J. Grinberg» → «Jacobo Grinberg». */
  merged: Array<{ from: string; to: string }>;
  /** Variantes de categoría unidas: «Filosofia» → «Filosofía». */
  mergedCategories: Array<{ from: string; to: string }>;
  reviewed: number;
  updated: number;
}

/**
 * Unifica las grafías de autor y de categoría en las fichas ya guardadas. Se ejecuta al
 * terminar un análisis y también puede lanzarse sola: arregla un catálogo heredado sin gastar
 * una sola llamada al proveedor, que es justo lo que hacía falta cuando el mismo autor figuraba
 * tres veces. Las categorías toman la grafía de las fichas importadas, que eligió la persona.
 */
export async function reconcileStoredNames(): Promise<NameReconciliationResult> {
  const records = await readDocumentCatalogRecords();
  const index = new AuthorIndex();
  const categories = new CategoryIndex();
  const merged = new Map<string, string>();
  const mergedCategories = new Map<string, string>();

  // Primera pasada: fijar la forma canónica de cada nombre viendo el catálogo entero.
  for (const record of await readImportedCatalogRecords().catch(() => [])) {
    categories.add(record.organization?.category, record.organization?.subcategory);
  }
  for (const record of records) {
    for (const author of record.catalog?.authors ?? []) index.add(author);
    categories.add(record.extras?.category, record.extras?.subcategory);
  }

  let updated = 0;
  for (const record of records) {
    if (!record.catalog) continue;
    const authors = record.catalog.authors;
    const canonical = authors.map((author) => index.resolve(author));
    for (const [position, author] of authors.entries()) {
      const destino = canonical[position] as string;
      if (authorKey(destino) !== authorKey(author)) merged.set(author, destino);
    }

    const extras = record.extras;
    const organization = categories.add(extras?.category, extras?.subcategory);
    if (extras?.category && organization.category !== extras.category) {
      mergedCategories.set(extras.category, organization.category ?? extras.category);
    }
    if (extras?.subcategory && organization.subcategory !== extras.subcategory) {
      mergedCategories.set(extras.subcategory, organization.subcategory ?? extras.subcategory);
    }

    const authorsChanged = canonical.some((author, position) => author !== authors[position]);
    const categoriesChanged = Boolean(
      extras &&
        (organization.category !== extras.category || organization.subcategory !== extras.subcategory),
    );
    if (!authorsChanged && !categoriesChanged) continue;

    await saveDocumentCatalogRecord({
      ...record,
      catalog: { ...record.catalog, authors: canonical },
      ...(extras ? { extras: { ...extras, ...organization } } : {}),
    });
    updated += 1;
  }

  return {
    merged: [...merged].map(([from, to]) => ({ from, to })),
    mergedCategories: [...mergedCategories].map(([from, to]) => ({ from, to })),
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
  // Lo mismo con las categorías: primero las escritas a mano, que son el vocabulario que la
  // persona eligió, y después las de análisis anteriores.
  const categoryIndex = new CategoryIndex();
  for (const document of documents) {
    categoryIndex.add(document.organization?.category, document.organization?.subcategory);
  }
  const importedRecords = await readImportedCatalogRecords().catch(() => []);
  for (const record of importedRecords) {
    categoryIndex.add(record.organization?.category, record.organization?.subcategory);
  }
  for (const record of storedRecords) {
    categoryIndex.add(record.extras?.category, record.extras?.subcategory);
  }

  const queue = documents.filter((document) => {
    const reason = catalogQueueReason(document, recordsByDocument.get(document.id), settings, options);
    if (!reason) progress.skipped += 1;
    return reason !== null;
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
      categoryIndex.entries,
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
      const { catalog, extras, usage } = await requestCatalogFromProvider(input, settings, apiKey);
      // El modelo recibe los autores y las categorías conocidos, pero no siempre los respeta:
      // la grafía se decide aquí, donde la reconciliación es una regla y no una sugerencia.
      const authors = catalog.authors.map((author) => authorIndex.add(author));
      // Los datos de la edición se cotejan con el extracto que vio el modelo; la materia se
      // pasa al español si llegó en inglés y a la grafía que ya usa la biblioteca.
      const grounded = groundCatalogExtras(extras, input.excerpt, catalog.canonicalTitle);
      const spanish = spanishCategory(grounded);
      const organization = categoryIndex.add(spanish.category, spanish.subcategory);
      await saveDocumentCatalogRecord(
        createRecord(document, settings, fingerprint, "analyzed", {
          catalog: { ...catalog, authors },
          extras: { ...grounded, ...organization },
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
  if (progress.analyzed) await reconcileStoredNames();

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
