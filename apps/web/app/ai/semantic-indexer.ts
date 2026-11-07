"use client";

import {
  chunkerVersion,
  chunkPdfPages,
  chunkSections,
  type ChunkableBlock,
  type ChunkableSection,
  type TextChunk,
} from "../library/chunking";
import { readDocumentFile } from "../library/document-file";
import type { LibraryDocument } from "../library/documents";
import { extractPdfLayout } from "../library/pdf-text-extractor";
import {
  cosine,
  diversify,
  fuseRankings,
  lexicalScores,
  normalizeVector,
  quantize,
  snippetFor,
} from "../library/semantic-search";
import {
  loadSearchCorpus,
  readDocumentChunks,
  readSemanticDocuments,
  replaceDocumentChunks,
  saveChunkVectors,
  saveSemanticDocument,
  type SemanticChunkRecord,
  type SemanticDocumentRecord,
} from "../library/semantic-index-store";
import { routeFor, sourceKeyOf } from "../library/sensitivity";
import { documentSensitivity, hasConsent } from "../library/sensitivity-store";
import { extractStructuredDocument, type StructuredDocumentFormat } from "../library/structured-document-extractor";
import { assertWithinBudget, BudgetExceededError, recordAiUsage } from "./ai-usage-store";
import type { AiSettings } from "./ai-settings";
import { embeddingBatches, embeddingConfigOf, embeddingKey, estimateTokens, requestEmbeddings, type EmbeddingConfig } from "./embeddings";
import { auditRoute } from "./processing-log";
import { recordProcessing } from "./processing-log-store";

/**
 * Indexar la biblioteca para buscar por significado (04.4) y buscar en ella.
 *
 * Indexar un libro tiene dos pasos:
 * 1. Trocearlo, en el equipo: se lee el archivo, se extrae el texto con su estructura y se
 *    guardan los fragmentos. Con esto ya se busca por palabras. Si el libro no cambió (misma
 *    versión), no se vuelve a leer.
 * 2. Calcular los vectores de los fragmentos que no los tienen, con el proveedor de catalogar.
 *    Aquí sí sale el texto: pasa por el router de sensibilidad (un confidencial se queda solo
 *    con las palabras), el presupuesto y el registro de la IA.
 *
 * Reindexar es incremental: un fragmento con el mismo texto conserva su vector.
 */

const structuredFormats: readonly StructuredDocumentFormat[] = ["docx", "epub", "pptx", "xlsx"];
const textFormats = ["md", "txt"];

export function isIndexable(document: Pick<LibraryDocument, "format">) {
  return document.format === "pdf" || structuredFormats.includes(document.format as StructuredDocumentFormat) || textFormats.includes(document.format);
}

/** La versión del libro: si cambia, se vuelve a trocear. */
export function documentVersion(document: LibraryDocument) {
  const fingerprint = (document as { fingerprint?: unknown }).fingerprint;
  return typeof fingerprint === "string" && fingerprint ? fingerprint : `${document.indexedAt ?? ""}:${document.searchText?.length ?? 0}`;
}

/** Un texto plano o Markdown, en una sola sección; en Markdown, las líneas «# …» son títulos. */
export function plainTextSections(text: string, markdown: boolean): ChunkableSection[] {
  const blocks: ChunkableBlock[] = [];
  for (const raw of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const paragraph = raw.trim();
    if (!paragraph) continue;
    const heading = markdown ? /^(#{1,6})\s+(.+)$/.exec(paragraph) : null;
    if (heading && !paragraph.includes("\n")) blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
    else blocks.push({ kind: "paragraph", text: paragraph.replace(/\s*\n\s*/g, " ") });
  }
  return [{ blocks, id: "texto", title: "" }];
}

async function chunkDocument(document: LibraryDocument, blob: Blob): Promise<{ chunks: TextChunk[]; truncated: boolean }> {
  if (document.format === "pdf") {
    const layout = await extractPdfLayout(blob);
    return { chunks: chunkPdfPages(layout.pages), truncated: layout.truncated };
  }
  if (structuredFormats.includes(document.format as StructuredDocumentFormat)) {
    const extraction = await extractStructuredDocument(document.format as StructuredDocumentFormat, blob);
    return { chunks: chunkSections(extraction.sections), truncated: extraction.truncated };
  }
  const text = await blob.text();
  return { chunks: chunkSections(plainTextSections(text.slice(0, 1_000_000), document.format === "md")), truncated: text.length > 1_000_000 };
}

export interface IndexProgress {
  /** Fragmentos con vector calculados en esta pasada. */
  embedded: number;
  errors: Array<{ documentId: string; message: string }>;
  /** Libros cuyo texto no salió por su sensibilidad: se buscan solo por palabras. */
  keptLocal: { confidential: number; personal: number };
  /** Proveedor en la nube sin clave en esta sesión: se troceó, pero sin vectores. */
  missingKey: boolean;
  noText: number;
  processed: number;
  queued: number;
  stopped: boolean;
  /** El presupuesto paró la pasada: lo que estaba en marcha terminó. */
  budgetStop: string | null;
  current: string | null;
  waiting: string | null;
}

export interface IndexOptions {
  /** Sin vectores: solo trocear (la búsqueda por palabras). */
  embed?: boolean;
  onProgress?: (progress: IndexProgress) => void;
  signal?: AbortSignal;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message.slice(0, 300) : "No se pudo indexar.";
}

/**
 * Lo que falta por hacer en un libro: trocear (cambió o nunca se hizo) o calcular vectores. Un
 * libro que no puede salir del equipo (confidencial con un proveedor en la nube) no espera
 * vectores: se queda con la búsqueda por palabras y no cuenta como pendiente.
 */
export function indexNeeds(document: LibraryDocument, record: SemanticDocumentRecord | undefined, key: string | null, canEmbed = true) {
  // Un libro que falló (sin permiso, sin conexión) se vuelve a intentar.
  const chunk =
    !record || record.status === "error" || record.version !== documentVersion(document) || record.chunkerVersion !== chunkerVersion;
  const embed =
    Boolean(key) && canEmbed && (chunk || (record?.status === "ready" && (record.embeddingKey !== key || record.embeddedCount < record.chunkCount)));
  return { chunk, embed };
}

/** Si el texto de un libro puede salir hacia el proveedor de embeddings (o lo pedirá). */
export function canEmbedDocument(document: LibraryDocument, config: EmbeddingConfig | null) {
  return Boolean(config) && routeFor(documentSensitivity(document), config!.place, hasConsent(document.id, "index")) !== "block";
}

async function embedChunks(
  document: LibraryDocument,
  chunks: readonly SemanticChunkRecord[],
  config: EmbeddingConfig,
  settings: AiSettings,
  apiKey: string,
  progress: IndexProgress,
  publish: () => void,
  signal?: AbortSignal,
) {
  const key = embeddingKey(config);
  const pending = chunks.filter((chunk) => chunk.vector?.key !== key);
  const sensitivity = documentSensitivity(document);
  const audit = {
    documentId: document.id,
    flow: "index" as const,
    model: config.model,
    place: config.place,
    provider: config.provider,
    sensitivity,
  };
  for (const batch of embeddingBatches(pending)) {
    signal?.throwIfAborted();
    // Antes de cada lote, otra vez: si la persona lo marca confidencial a mitad, no sale más.
    if (routeFor(documentSensitivity(document), config.place, hasConsent(document.id, "index")) !== "allow") return;
    // El tope del presupuesto: el lote en curso termina; el siguiente no empieza (04.6).
    assertWithinBudget(config.provider, document.id);
    const characters = batch.reduce((sum, chunk) => sum + chunk.text.length, 0);
    try {
      const { usage, vectors } = await requestEmbeddings(config, settings, apiKey, batch.map((chunk) => chunk.text), "document", {
        onWait: ({ seconds }) => {
          progress.waiting = `El proveedor pide esperar: se reintenta en ${seconds} s.`;
          publish();
        },
        ...(signal ? { signal } : {}),
      });
      progress.waiting = null;
      const expected = config.dimensions ?? vectors[0]?.length ?? 0;
      if (!expected || vectors.some((vector) => vector.length !== expected || vector.some((value) => !Number.isFinite(value)))) {
        throw new Error("El proveedor devolvió vectores vacíos o de otra dimensión.");
      }
      const tokens = usage.inputTokens || estimateTokens(characters);
      recordAiUsage(config.provider, config.model, { inputTokens: tokens, outputTokens: 0 });
      recordProcessing({ ...audit, characters, route: auditRoute("allow", sensitivity, config.place), sent: batch.length, tokens });
      await saveChunkVectors(
        document.id,
        key,
        batch.map((chunk, position) => ({ hash: chunk.hash, id: chunk.id, vector: quantize(vectors[position] ?? []) })),
      );
      progress.embedded += batch.length;
      publish();
    } catch (error) {
      progress.waiting = null;
      if (!signal?.aborted && !(error instanceof BudgetExceededError)) {
        recordProcessing({ ...audit, characters, failed: 1, route: auditRoute("allow", sensitivity, config.place) });
      }
      throw error;
    }
  }
}

/**
 * Indexa estos libros: trocea los que cambiaron y calcula los vectores que faltan. Un libro que
 * falla no para a los demás; el presupuesto y «Detener», sí.
 */
export async function indexDocuments(
  documents: readonly LibraryDocument[],
  settings: AiSettings,
  apiKey: string,
  { embed = true, onProgress, signal }: IndexOptions = {},
): Promise<IndexProgress> {
  const progress: IndexProgress = {
    budgetStop: null,
    current: null,
    embedded: 0,
    errors: [],
    keptLocal: { confidential: 0, personal: 0 },
    missingKey: false,
    noText: 0,
    processed: 0,
    queued: 0,
    stopped: false,
    waiting: null,
  };
  const publish = () => onProgress?.({ ...progress, errors: [...progress.errors], keptLocal: { ...progress.keptLocal } });
  const wanted = embed ? embeddingConfigOf(settings) : null;
  // Sin la clave de la sesión no se intenta libro a libro: se trocea y se dice.
  progress.missingKey = Boolean(wanted && wanted.provider !== "ollama" && !apiKey);
  const config = progress.missingKey ? null : wanted;
  const key = config ? embeddingKey(config) : null;
  const records = new Map((await readSemanticDocuments()).map((record) => [record.documentId, record]));
  const queue = documents.filter((document) => {
    if (!isIndexable(document)) return false;
    const needs = indexNeeds(document, records.get(document.id), key, canEmbedDocument(document, config));
    return needs.chunk || needs.embed;
  });
  progress.queued = queue.length;
  // Los que se pidió indexar y no pueden salir del equipo (confidenciales con un proveedor en la
  // nube): quedan solo con las palabras, y el registro lo dice. Los de la cola, en su turno.
  if (config) {
    const queued = new Set(queue.map((document) => document.id));
    for (const document of documents) {
      if (queued.has(document.id) || !isIndexable(document) || canEmbedDocument(document, config)) continue;
      const sensitivity = documentSensitivity(document);
      progress.keptLocal.confidential += 1;
      recordProcessing({
        documentId: document.id,
        flow: "index",
        model: config.model,
        place: config.place,
        provider: config.provider,
        route: auditRoute("block", sensitivity, config.place),
        sensitivity,
      });
    }
  }
  publish();

  for (const document of queue) {
    if (signal?.aborted) {
      progress.stopped = true;
      break;
    }
    progress.current = document.title;
    publish();
    const previousRecord = records.get(document.id);
    const needs = indexNeeds(document, previousRecord, key, canEmbedDocument(document, config));
    const sourceKey = sourceKeyOf(document);
    // Si falla después de trocear (al calcular vectores), los fragmentos se quedan: se busca por palabras.
    let chunked = false;
    try {
      let chunks = await readDocumentChunks(document.id);
      if (needs.chunk) {
        const blob = await readDocumentFile(document);
        if (!blob) throw new Error("No se pudo abrir el archivo. Ábrelo una vez en el lector (para dar permiso o conectar Drive) y vuelve a indexar.");
        const { chunks: fresh, truncated } = await chunkDocument(document, blob);
        const base = {
          chunkCount: fresh.length,
          chunkerVersion,
          documentId: document.id,
          embeddingKey: key,
          error: null,
          indexedAt: new Date().toISOString(),
          sourceKey,
          truncated,
          version: documentVersion(document),
        };
        if (!fresh.length) {
          await saveSemanticDocument({ ...base, embeddedCount: 0, status: "no-text" });
          progress.noText += 1;
          progress.processed += 1;
          publish();
          continue;
        }
        chunks = await replaceDocumentChunks({ ...base, status: "ready" }, fresh, chunks);
      }
      chunked = true;
      if (config && chunks.length) {
        // Sensibilidad (04.3): el texto entero sale del equipo solo si el router lo deja.
        const sensitivity = documentSensitivity(document);
        const route = routeFor(sensitivity, config.place, hasConsent(document.id, "index"));
        if (route !== "allow") {
          if (route === "block") progress.keptLocal.confidential += 1;
          else progress.keptLocal.personal += 1;
          recordProcessing({
            documentId: document.id,
            flow: "index",
            model: config.model,
            place: config.place,
            provider: config.provider,
            route: auditRoute(route, sensitivity, config.place),
            sensitivity,
          });
        } else {
          await embedChunks(document, chunks, config, settings, apiKey, progress, publish, signal);
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        progress.stopped = true;
        break;
      }
      if (error instanceof BudgetExceededError) {
        progress.budgetStop = error.message;
        progress.stopped = true;
        break;
      }
      const message = errorMessage(error);
      progress.errors.push({ documentId: document.id, message });
      // Si falló al trocear, la ficha dice por qué (y se reintenta la próxima vez); si falló al
      // calcular vectores, los fragmentos se quedan y faltan solo los vectores.
      if (!chunked) {
        await saveSemanticDocument({
          chunkCount: 0,
          chunkerVersion,
          documentId: document.id,
          embeddedCount: 0,
          embeddingKey: key,
          error: message,
          indexedAt: new Date().toISOString(),
          sourceKey,
          status: "error",
          truncated: false,
          version: documentVersion(document),
        }).catch(() => undefined);
      }
    }
    progress.processed += 1;
    publish();
  }
  progress.current = null;
  progress.waiting = null;
  publish();
  return progress;
}

/* ---- Buscar --------------------------------------------------------------------------------------- */

export interface SearchScope {
  /** Solo estos libros (los que se ven en la biblioteca); sin él, no limita; vacío, ninguno. */
  documentIds?: ReadonlySet<string>;
  /** Solo estas fuentes (`sourceKeyOf`); sin él, no limita; vacío, ninguna. */
  sourceKeys?: ReadonlySet<string>;
}

/**
 * Si un fragmento entra en el alcance. Un conjunto vacío es «nada», no «todo»: sin libros
 * visibles (la biblioteca aún cargando, o todo desvinculado) no se busca en ninguno.
 */
export function chunkInScope(chunk: Pick<SemanticChunkRecord, "documentId" | "sourceKey">, scope: SearchScope) {
  return (!scope.sourceKeys || scope.sourceKeys.has(chunk.sourceKey)) && (!scope.documentIds || scope.documentIds.has(chunk.documentId));
}

/** Por significado entran los fragmentos con al menos el 75 % del parecido del mejor. */
export const semanticFloor = 0.75;

export interface SearchHit {
  chunk: SemanticChunkRecord;
  lexicalRank: number | null;
  semanticRank: number | null;
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Por qué no se buscó por significado, si no se hizo. */
  semanticNote: string | null;
  /** Fragmentos dentro del alcance. */
  searched: number;
}

/**
 * Busca en los fragmentos del alcance: por palabras siempre y por significado si hay vectores del
 * modelo de ahora. La pregunta sale al proveedor para calcular su vector (no los libros).
 */
export async function searchLibrary(
  query: string,
  scope: SearchScope,
  settings: AiSettings,
  apiKey: string,
  { limit = 12, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<SearchResult> {
  const corpus = await loadSearchCorpus();
  const allowed = corpus.chunks.map((chunk) => chunkInScope(chunk, scope));
  const searched = allowed.filter(Boolean).length;
  const lexical = lexicalScores(corpus.lexical, query, (index) => allowed[index] === true);

  const semantic = new Map<number, number>();
  let semanticNote: string | null = null;
  const config = embeddingConfigOf(settings);
  if (!config) semanticNote = "Tu proveedor no calcula embeddings: se busca solo por palabras.";
  else {
    const key = embeddingKey(config);
    const candidates = corpus.chunks.flatMap((chunk, index) => (allowed[index] && chunk.vector?.key === key ? [index] : []));
    if (!candidates.length) semanticNote = "Todavía no hay vectores de estos libros: se busca solo por palabras.";
    else if (config.provider !== "ollama" && !apiKey) semanticNote = "Falta la clave de tu proveedor en esta sesión: se busca solo por palabras.";
    else {
      try {
        const asked = query.slice(0, 2_000);
        const { usage, vectors } = await requestEmbeddings(config, settings, apiKey, [asked], "query", signal ? { signal } : {});
        recordAiUsage(config.provider, config.model, { inputTokens: usage.inputTokens || estimateTokens(asked.length), outputTokens: 0 });
        const vector = normalizeVector(vectors[0] ?? []);
        const scores = candidates.map((index) => {
          const chunk = corpus.chunks[index]!;
          return [index, cosine(vector, { data: chunk.vector!.data, scale: chunk.vector!.scale })] as const;
        });
        // Solo lo que se parece de verdad: cerca del mejor. Sin esto, todo fragmento «se parece» algo.
        const best = Math.max(0, ...scores.map(([, score]) => score));
        for (const [index, score] of scores) if (score >= best * semanticFloor) semantic.set(index, score);
      } catch (error) {
        if (signal?.aborted) throw error;
        semanticNote = `No se pudo buscar por significado (${errorMessage(error)}): se busca solo por palabras.`;
      }
    }
  }

  const fused = fuseRankings(lexical, semantic, limit * 4);
  const hits = diversify(fused, (hit) => corpus.chunks[hit.chunk]!.documentId, 3)
    .slice(0, limit)
    .map((hit) => {
      const chunk = corpus.chunks[hit.chunk]!;
      return { chunk, lexicalRank: hit.lexicalRank, semanticRank: hit.semanticRank, snippet: snippetFor(chunk.text, query) };
    });
  return { hits, searched, semanticNote };
}
