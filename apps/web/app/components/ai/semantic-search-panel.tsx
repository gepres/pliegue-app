"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { Button, Card, Field, Input, Select } from "@pliegue/ui";

import { budgetProviderNames, priceKey } from "../../ai/ai-budget";
import { getSessionApiKey } from "../../ai/ai-session-secret-store";
import { useAiSettings } from "../../ai/ai-settings-store";
import { embeddingConfigOf, embeddingKey, estimateTokens } from "../../ai/embeddings";
import {
  canEmbedDocument,
  indexDocuments,
  indexNeeds,
  isIndexable,
  searchLibrary,
  type IndexProgress,
  type SearchResult,
} from "../../ai/semantic-indexer";
import { answerPrepared, prepareQuestion, type AssistantResult } from "../../ai/library-assistant";
import { describeLocation } from "../../library/chunking";
import type { LibraryDocument } from "../../library/documents";
import { loadSearchCorpus, useSemanticDocuments } from "../../library/semantic-index-store";
import { routeFor } from "../../library/sensitivity";
import { documentSensitivity, hasConsent } from "../../library/sensitivity-store";
import { useLibraryDocuments } from "../../library/use-library-documents";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Segmented } from "../app-ui/controls";
import { LibraryAssistantAnswer } from "./library-assistant-answer";
import { confirmPersonalSend } from "./sensitive-consent";
import styles from "./semantic-search-panel.module.css";

const number = (value: number) => value.toLocaleString("es");
const count = (value: number, one: string, many: string) => `${number(value)} ${value === 1 ? one : many}`;
const dollars = new Intl.NumberFormat("es", { currency: "USD", maximumFractionDigits: 4, minimumFractionDigits: 2, style: "currency" });

interface SourceOption {
  key: string;
  label: string;
}

function describeProgress(progress: IndexProgress) {
  const parts = [`${number(progress.processed)} de ${count(progress.queued, "libro", "libros")}`];
  if (progress.embedded) parts.push(count(progress.embedded, "fragmento con vector", "fragmentos con vector"));
  if (progress.noText) parts.push(`${count(progress.noText, "sin texto", "sin texto")} (escaneados: se indexarán con su OCR más adelante)`);
  if (progress.keptLocal.confidential) parts.push(`${count(progress.keptLocal.confidential, "confidencial", "confidenciales")} solo por palabras`);
  if (progress.keptLocal.personal) parts.push(`${count(progress.keptLocal.personal, "personal", "personales")} sin tu permiso: solo por palabras`);
  if (progress.errors.length) parts.push(count(progress.errors.length, "con error", "con error"));
  return parts.join(" · ");
}

/**
 * /app/ia: buscar en el texto de los libros (04.4). Indexar trocea cada libro en el equipo y, si
 * el proveedor calcula embeddings, manda los fragmentos para buscar también por significado.
 * Antes de mandar nada, se trocea y se dice cuánto saldrá y a quién.
 */
export function SemanticSearchPanel() {
  const settings = useAiSettings();
  const library = useLibraryDocuments();
  const indexed = useSemanticDocuments();
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [result, setResult] = useState<(SearchResult & { query: string }) | null>(null);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"search" | "ask">("search");
  const [asked, setAsked] = useState<{ question: string; result: AssistantResult | null; error: string | null } | null>(null);
  const controller = useRef<AbortController | null>(null);

  const config = embeddingConfigOf(settings);
  const key = config ? embeddingKey(config) : null;
  const providerName = budgetProviderNames[settings.provider] ?? settings.provider;
  const documents = library.allDocuments;
  const indexable = useMemo(() => documents.filter(isIndexable), [documents]);
  const records = useMemo(() => new Map(indexed.map((record) => [record.documentId, record])), [indexed]);
  const pending = indexable.filter((document) => {
    const needs = indexNeeds(document, records.get(document.id), key, canEmbedDocument(document, config));
    return needs.chunk || needs.embed;
  });
  const ready = indexed.filter((record) => record.status === "ready" && indexable.some((document) => document.id === record.documentId));
  const withVectors = ready.filter((record) => key && record.embeddingKey === key && record.embeddedCount >= record.chunkCount).length;
  const wordsOnly = ready.length - withVectors;
  const titles = useMemo(() => new Map(library.rawDocuments.map((document) => [document.id, document.title])), [library.rawDocuments]);

  // Las fuentes con algo indexado, para elegir dónde buscar.
  const usedSources = new Set(ready.map((record) => record.sourceKey));
  const sources: SourceOption[] = [
    ...library.linkedFolders.sources.map((source) => ({ key: `folder:${source.id}`, label: `Carpeta · ${source.name}` })),
    ...library.driveLibrary.sources.map((source) => ({ key: `drive:${source.id}`, label: `Drive · ${source.name}` })),
    { key: "files", label: "Archivos sueltos" },
    { key: "copies", label: "Copias importadas" },
    { key: "drive-files", label: "Archivos de Google Drive" },
  ].filter((option) => usedSources.has(option.key));

  async function run(list: readonly LibraryDocument[]) {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setStatus(null);
    const apiKey = getSessionApiKey(settings.provider);
    try {
      // 1. Trocear, en el equipo. Con esto ya se busca por palabras.
      let last = await indexDocuments(list, settings, apiKey, { embed: false, onProgress: setProgress, signal: abort.signal });
      if (last.stopped || !config) {
        setStatus(last.stopped ? "Se detuvo." : `Listo: se busca por palabras. ${providerName} no calcula embeddings; para buscar por significado, cataloga con OpenAI, Gemini u Ollama.`);
        return;
      }
      if (config.provider !== "ollama" && !apiKey) {
        setStatus(`Troceados: ya se busca por palabras. Para buscar por significado, pon la clave de ${providerName} en Ajustes → IA y vuelve a indexar.`);
        return;
      }
      // 2. Lo que saldría, antes de mandarlo.
      const corpus = await loadSearchCorpus();
      const listed = new Set(list.map((document) => document.id));
      const byId = new Map(list.map((document) => [document.id, document]));
      const route = (document: LibraryDocument) => routeFor(documentSensitivity(document), config.place, hasConsent(document.id, "index"));
      const personal = list.filter((document) => route(document) === "ask");
      if (personal.length && config.place === "cloud") await confirmPersonalSend(personal, "index", providerName);
      const outgoing = corpus.chunks.filter((chunk) => {
        const document = byId.get(chunk.documentId);
        return listed.has(chunk.documentId) && document && chunk.vector?.key !== key && route(document) === "allow";
      });
      const characters = outgoing.reduce((sum, chunk) => sum + chunk.text.length, 0);
      if (outgoing.length && config.place === "cloud") {
        const tokens = estimateTokens(characters);
        const price = settings.budget.tokenPrices[priceKey(config.provider, config.model)]?.input;
        const books = new Set(outgoing.map((chunk) => chunk.documentId)).size;
        const confirmed = await confirmAction({
          confirmLabel: "Enviar y calcular",
          description: `Para buscar por significado se envía a ${providerName} (${config.model}) el texto de ${count(books, "libro", "libros")}, en fragmentos.`,
          details: [
            `${count(outgoing.length, "fragmento", "fragmentos")} · ${count(characters, "carácter", "caracteres")}`,
            price !== undefined ? `Unos ${number(tokens)} tokens: ~${dollars.format((tokens / 1_000_000) * price)}` : `Unos ${number(tokens)} tokens (sin precio en la tabla de Ajustes → IA)`,
          ],
          icon: "cloud",
          note: "Los confidenciales no salen: se buscan solo por palabras. Queda en el registro de la IA.",
          title: "¿Calcular la búsqueda por significado?",
        });
        if (!confirmed) {
          setStatus("Troceados: ya se busca por palabras. Sin vectores, la búsqueda por significado espera.");
          return;
        }
      }
      last = await indexDocuments(list, settings, apiKey, { embed: true, onProgress: setProgress, signal: abort.signal });
      setStatus(last.budgetStop ?? (last.stopped ? "Se detuvo." : `Listo. ${describeProgress(last)}.`));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo indexar.");
    } finally {
      controller.current = null;
      setRunning(false);
    }
  }

  const searchScope = () => ({
    documentIds: new Set(documents.map((document) => document.id)),
    ...(scope === "all" ? {} : { sourceKeys: new Set([scope]) }),
  });

  /** Preguntar (04.5): buscar los fragmentos, pedir permiso por los personales y responder. */
  async function ask(text: string) {
    setSearching(true);
    setAsked({ error: null, question: text, result: null });
    const apiKey = getSessionApiKey(settings.provider);
    const byId = new Map(documents.map((document) => [document.id, document]));
    try {
      if (settings.provider !== "ollama" && !apiKey) throw new Error(`Pon la clave de ${providerName} en Ajustes → IA para preguntar.`);
      const prepared = await prepareQuestion(text, searchScope(), byId, settings, apiKey);
      if (prepared.needsConsent.length) await confirmPersonalSend(prepared.needsConsent, "ask", providerName);
      const result = await answerPrepared(prepared, byId, settings, apiKey);
      setAsked({ error: null, question: text, result });
    } catch (error) {
      setAsked({ error: error instanceof Error ? error.message : "No se pudo responder.", question: text, result: null });
    } finally {
      setSearching(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (mode === "ask") return ask(text);
    setSearching(true);
    try {
      const found = await searchLibrary(text, searchScope(), settings, getSessionApiKey(settings.provider));
      setResult({ ...found, query: text });
    } catch (error) {
      setResult({ hits: [], query: text, searched: 0, semanticNote: error instanceof Error ? error.message : "No se pudo buscar." });
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card aria-labelledby="semantic-search-title" as="section" className={styles.panel}>
      <div className={styles.intro}>
        <h2 id="semantic-search-title">Buscar en tus libros</h2>
        <p>
          Busca por palabras y por significado dentro del texto de tus libros, con la página o la sección donde está.
          Indexar trocea cada libro en este equipo; para buscar por significado, los fragmentos se envían a{" "}
          {config ? `${providerName} (${config.model})` : "un proveedor que calcule embeddings"} y se guardan sus vectores aquí.
          Los confidenciales se buscan solo por palabras.
        </p>
      </div>

      <p className={styles.state} data-testid="semantic-state">
        {count(ready.length, "libro indexado", "libros indexados")} de {number(indexable.length)}
        {config ? ` · ${count(withVectors, "con búsqueda por significado", "con búsqueda por significado")}` : " · solo por palabras"}
        {config && wordsOnly && !pending.length ? ` · ${count(wordsOnly, "solo por palabras", "solo por palabras")} (confidenciales o sin permiso)` : ""}
      </p>

      <div className={styles.actions}>
        <Button disabled={running || !pending.length} onClick={() => void run(pending)}>
          {pending.length ? `Indexar ${count(pending.length, "libro", "libros")}` : "Todo indexado"}
        </Button>
        {running ? (
          <Button onClick={() => controller.current?.abort()} variant="secondary">
            Detener
          </Button>
        ) : null}
      </div>
      {running && progress ? (
        <p aria-live="polite" className={styles.note} role="status">
          {progress.current ? `Indexando «${progress.current}»… ` : ""}
          {describeProgress(progress)}
          {progress.waiting ? ` · ${progress.waiting}` : ""}
        </p>
      ) : null}
      {!running && status ? (
        <p aria-live="polite" className={styles.note} role="status">
          {status}
        </p>
      ) : null}

      <Segmented
        label="Buscar o preguntar"
        onChange={setMode}
        options={[
          { label: "Buscar", value: "search" },
          { label: "Preguntar", value: "ask" },
        ]}
        size="sm"
        value={mode}
      />
      {mode === "ask" ? (
        <p className={styles.note}>
          Responde solo con lo que dicen tus libros indexados, con citas que abren el libro en su sitio. Se envían a{" "}
          {providerName} los fragmentos que mejor responden (hasta 8); los confidenciales no salen.
        </p>
      ) : null}
      <form className={styles.form} onSubmit={search} role="search">
        <Field label={mode === "ask" ? "Qué quieres saber" : "Qué buscas"} labelFor="semantic-query">
          <Input
            id="semantic-query"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "ask" ? "¿Qué dicen mis libros sobre…?" : "Una idea, un personaje, una cita…"}
            type="search"
            value={query}
          />
        </Field>
        {sources.length > 1 ? (
          <Field label="Dónde" labelFor="semantic-scope">
            <Select id="semantic-scope" onChange={(event) => setScope(event.target.value)} value={scope}>
              <option value="all">Toda la biblioteca</option>
              {sources.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className={styles.submit}>
          <Button disabled={searching || !query.trim() || !ready.length} type="submit">
            {searching ? (mode === "ask" ? "Pensando…" : "Buscando…") : mode === "ask" ? "Preguntar" : "Buscar"}
          </Button>
        </div>
      </form>

      {mode === "ask" && asked ? (
        asked.result ? (
          <LibraryAssistantAnswer providerName={providerName} question={asked.question} result={asked.result} />
        ) : asked.error ? (
          <p className={styles.note} role="alert">
            {asked.error}
          </p>
        ) : null
      ) : null}

      {mode === "search" && result ? (
        <section aria-label={`Resultados de «${result.query}»`} className={styles.results}>
          <p className={styles.note}>
            {result.hits.length
              ? `${count(result.hits.length, "fragmento", "fragmentos")} entre ${count(result.searched, "fragmento", "fragmentos")} indexados.`
              : "Nada que se parezca en los libros indexados."}
            {result.semanticNote ? ` ${result.semanticNote}` : ""}
          </p>
          {result.hits.length ? (
            <ol className={styles.hits}>
              {result.hits.map((hit) => (
                <li className={styles.hit} key={hit.chunk.id}>
                  <p className={styles.hitHead}>
                    <Link
                      href={`/app/lector?document=${encodeURIComponent(hit.chunk.documentId)}&fragmento=${encodeURIComponent(hit.chunk.id)}`}
                    >
                      {titles.get(hit.chunk.documentId) ?? "Un libro que ya no está"}
                    </Link>
                    <span className={styles.where}>{describeLocation(hit.chunk.location)}</span>
                  </p>
                  <p className={styles.snippet}>{hit.snippet}</p>
                  <p className={styles.signals}>
                    {hit.lexicalRank ? <span>Por palabras</span> : null}
                    {hit.semanticRank ? <span>Por significado</span> : null}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </Card>
  );
}
