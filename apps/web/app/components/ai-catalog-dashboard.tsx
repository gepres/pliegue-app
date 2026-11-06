"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { providerModel } from "../ai/ai-settings";
import { useAiSettings } from "../ai/ai-settings-store";
import { useAiSessionSecrets } from "../ai/ai-session-secret-store";
import { readDocumentCatalogRecords } from "../ai/document-catalog-store";
import { afterCatalog } from "../guide/next-steps";
import { suggestNextStep } from "./app-ui/next-step-dialog";
import {
  analyzeDocumentCatalogs,
  catalogable,
  catalogBatchSize,
  catalogQueueReason,
  isScannedPdf,
  stopCatalogAnalysis,
  type CatalogAnalysisProgress,
  type CatalogQueueReason,
} from "../ai/catalog-analysis";
import { groupCatalogFailures } from "../ai/catalog-failures";
import type { AiProvider } from "../ai/document-catalog";
import { languageLabel, normalizeLanguage } from "../library/language";
import { hasStaleIndex } from "../library/stale-index";
import { useLibraryDocuments } from "../library/use-library-documents";
import { Icon } from "./app-ui/icons";
import { downloadCatalogTemplate } from "./catalog-template-download";
import { workTypeLabels } from "./library/library-document-tile";
import { StaleIndexNotice } from "./stale-index-notice";
import { UnifyNames } from "./ai/unify-names";
import dash from "./ai-catalog-dashboard.module.css";
import styles from "../(workspace)/app/workspace.module.css";

const providerNames: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
  openai: "OpenAI",
};

const statusLabels = {
  analyzed: "Catalogado",
  analyzing: "Analizando",
  error: "Con error",
  "needs-content": "Sin texto",
} as const;

/** Lo que la IA rellena, tal como lo verá quien abra la plantilla. */
const catalogFields = [
  "Autor y título",
  "Año, idioma y tipo de obra",
  "Géneros, temas y sinopsis",
  "Categoría y subcategoría",
  "Editorial, serie y tomo",
  "ISBN, edición, título original y traductores",
];

const reasonLabels: Record<CatalogQueueReason, (count: number) => string> = {
  changed: (count) => `${count} cambiaron de texto, de proveedor o de modelo`,
  error: (count) => `${count} fallaron la última vez y se reintentan`,
  new: (count) => `${count} sin ficha todavía`,
  outdated: (count) =>
    `${count} con ficha de una versión anterior, sin categoría ni datos de la edición`,
};

/** Títulos que se ven de cada motivo; con un límite de uso pueden ser cientos. */
const failureTitleLimit = 6;

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function describeSummary(summary: Awaited<ReturnType<typeof analyzeDocumentCatalogs>>) {
  return [
    summary.stopped ? "Detenido" : "",
    summary.analyzed ? `${plural(summary.analyzed, "catalogado")}` : "",
    summary.needsContent ? `${summary.needsContent} sin texto que leer` : "",
    summary.failed ? `${summary.failed} con error: el motivo, en «Por qué fallaron»` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatTokens(value: number) {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1).replace(".", ",")} k`;
}

/** Redondea a una unidad legible: nadie necesita «3 min 47 s» para decidir si esperar. */
function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/**
 * Estimación del tiempo restante a partir del ritmo ya observado, no de una constante: la
 * velocidad depende del proveedor, del modelo y de la concurrencia elegida, así que solo se
 * muestra cuando hay medidas propias del lote en curso.
 */
function remainingTime(progress: CatalogAnalysisProgress) {
  if (progress.processed < 2) return null;
  const perDocument = progress.elapsedMs / progress.processed;
  const pending = progress.queued - progress.processed;
  return pending > 0 ? formatDuration(perDocument * pending) : null;
}

export function AiCatalogDashboard() {
  const settings = useAiSettings();
  const secrets = useAiSessionSecrets();
  // Las fichas importadas entran en el recuento igual que las del modelo: si no, el panel
  // presenta como pendiente un corpus ya catalogado a mano e invita a pagar por analizarlo.
  const { allDocuments: documents, catalogs } = useLibraryDocuments();
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<CatalogAnalysisProgress | null>(null);
  const [status, setStatus] = useState("");

  const recordsById = useMemo(
    () => new Map(catalogs.records.map((record) => [record.documentId, record])),
    [catalogs.records],
  );
  // Con texto, o escaneos cuyo principio se lee con OCR al catalogar (03.4).
  const withText = documents.filter(catalogable);
  const scanned = documents.filter(isScannedPdf).length;
  // La misma regla que usa el análisis: el número del botón es lo que de verdad se enviará.
  const queue = useMemo(() => {
    const counts: Record<CatalogQueueReason, number> = { changed: 0, error: 0, new: 0, outdated: 0 };
    for (const document of withText) {
      const reason = catalogQueueReason(document, recordsById.get(document.id), settings, {
        retryErrors: true,
      });
      if (reason) counts[reason] += 1;
    }
    return counts;
  }, [recordsById, settings, withText]);
  const pending = queue.new + queue.outdated + queue.changed + queue.error;

  const catalogued = documents.filter(
    (document) => document.catalogStatus === "analyzed" || document.catalogSource === "import",
  ).length;
  const fromImport = documents.filter((document) => document.catalogSource === "import").length;
  const withCategory = documents.filter((document) => document.organization?.category).length;
  // Un índice de la versión anterior deja el documento sin texto y el análisis lo marca
  // «needs-content», igual que un escaneo. Contarlos juntos presentaba como trabajo de OCR
  // algo que se resuelve reindexando, y costó varias rondas de diagnóstico averiguarlo.
  const staleIndex = documents.filter(hasStaleIndex).length;
  const withoutText = documents.filter(
    (document) => !catalogable(document) && !hasStaleIndex(document),
  ).length;

  const model = providerModel(settings);
  const local = settings.provider === "ollama";
  const ready = settings.provider === "ollama" || Boolean(secrets[settings.provider]);

  const failures = useMemo(() => {
    const titles = new Map(documents.map((document) => [document.id, document.title]));
    return groupCatalogFailures(catalogs.records, (documentId) => titles.get(documentId));
  }, [catalogs.records, documents]);

  const recent = useMemo(
    () =>
      [...catalogs.records]
        .sort((left, right) => right.analyzedAt.localeCompare(left.analyzedAt))
        .slice(0, 8)
        .map((record) => ({
          document: documents.find((item) => item.id === record.documentId),
          record,
        })),
    [catalogs.records, documents],
  );

  async function analyzePending() {
    setAnalyzing(true);
    setProgress(null);
    setStatus("");

    try {
      const summary = await analyzeDocumentCatalogs(documents, settings, {
        onProgress: setProgress,
        retryErrors: true,
      });
      setStatus(describeSummary(summary) || "El catálogo ya estaba al día.");
      if (summary.analyzed && !summary.stopped) {
        // Las categorías, recién escritas: las del estado de este render son de antes.
        const records = await readDocumentCatalogRecords().catch(() => []);
        const categories = [
          ...new Set(records.map((record) => record.extras?.category).filter((value): value is string => Boolean(value))),
        ];
        const step = afterCatalog({ analyzed: summary.analyzed, categories });
        if (step) suggestNextStep(step);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No fue posible iniciar el análisis.");
    } finally {
      setAnalyzing(false);
    }
  }

  function downloadTemplate() {
    const entries = downloadCatalogTemplate(documents);
    setStatus(
      `Plantilla descargada con ${plural(entries, "documento")}. Corrígela y vuelve a importarla en Fuentes.`,
    );
  }

  return (
    <>
      <section aria-label="Estado del catálogo" className={styles.catalogMetricGrid}>
        <Card className={styles.catalogMetric}>
          <span>Documentos</span>
          <strong>{documents.length}</strong>
          <small>
            {withText.length} con texto que la IA puede leer
            {scanned ? ` · ${scanned} escaneados: se lee con OCR su principio` : ""}
          </small>
        </Card>
        <Card className={styles.catalogMetric}>
          <span>Con ficha</span>
          <strong>{catalogued}</strong>
          <small>
            {documents.length ? Math.round((catalogued / documents.length) * 100) : 0}% de la
            biblioteca{fromImport ? ` · ${fromImport} importada${fromImport === 1 ? "" : "s"}` : ""}
          </small>
        </Card>
        <Card className={styles.catalogMetric}>
          <span>Con categoría</span>
          <strong>{withCategory}</strong>
          <small>
            {catalogued > withCategory
              ? `${plural(catalogued - withCategory, "ficha")} sin categoría`
              : catalogued
                ? "Ordenan los filtros de la Biblioteca"
                : "Se rellena al catalogar"}
          </small>
        </Card>
        <Card className={styles.catalogMetric}>
          <span>Sin texto</span>
          <strong>{withoutText}</strong>
          <small>
            Imágenes y archivos sin texto que leer
            {staleIndex ? ` · ${staleIndex} solo necesitan reindexarse` : ""}
          </small>
        </Card>
      </section>

      <div className={dash.layout}>
        <Card aria-labelledby="catalogar-titulo" as="section" className={dash.run}>
          <header className={dash.head}>
            <Tag>
              {providerNames[settings.provider]} · {model}
            </Tag>
            <h2 id="catalogar-titulo">Catalogar con IA</h2>
            <p>
              La IA lee un extracto de cada documento y rellena su ficha, la misma que tiene la
              plantilla JSON. Lo que corrijas a mano e importes prevalece sobre lo que deduzca.
            </p>
          </header>

          <ul aria-label="Qué rellena" className={dash.fields}>
            {catalogFields.map((field) => (
              <li key={field}>
                <Icon name="check" size={14} />
                {field}
              </li>
            ))}
          </ul>

          <div className={dash.queue}>
            <h3>{pending ? `Por catalogar: ${plural(pending, "documento")}` : "Todo está catalogado"}</h3>
            {pending ? (
              <ul>
                {(Object.keys(reasonLabels) as CatalogQueueReason[])
                  .filter((reason) => queue[reason])
                  .map((reason) => (
                    <li key={reason}>{reasonLabels[reason](queue[reason])}</li>
                  ))}
              </ul>
            ) : (
              <p>
                {documents.length
                  ? "Cada documento con texto tiene su ficha al día con este proveedor y modelo."
                  : "Añade documentos en la Biblioteca para catalogarlos."}
              </p>
            )}
          </div>

          {failures.length && !analyzing ? (
            <section aria-labelledby="fallos-titulo" className={dash.failures}>
              <h3 id="fallos-titulo">Por qué fallaron</h3>
              <ul className={dash.failureGroups}>
                {failures.map((group) => {
                  const shown = group.titles.slice(0, failureTitleLimit);
                  const more = group.titles.length - shown.length;
                  return (
                    <li key={`${group.provider}|${group.model}|${group.message}`}>
                      <p className={dash.failureReason}>{group.message}</p>
                      <p className={dash.failureMeta}>
                        {providerNames[group.provider]} · {group.model} ·{" "}
                        {plural(group.titles.length, "documento")}
                      </p>
                      <ul aria-label="Documentos" className={dash.failureTitles}>
                        {shown.map((title, index) => (
                          <li key={`${index}-${title}`}>{title}</li>
                        ))}
                        {more ? <li className={dash.failureMore}>y {plural(more, "más", "más")}</li> : null}
                      </ul>
                    </li>
                  );
                })}
              </ul>
              <p className={dash.failureHint}>
                Se reintentan la próxima vez que pulses «Catalogar». Si el motivo es la clave o el
                modelo, cámbialos antes en Ajustes.
              </p>
            </section>
          ) : null}

          <div className={dash.actions}>
            {analyzing ? (
              <Button onClick={stopCatalogAnalysis} variant="secondary">
                Detener
              </Button>
            ) : (
              <Button disabled={!pending || !ready} onClick={() => void analyzePending()}>
                {pending ? `Catalogar ${plural(pending, "documento")}` : "Nada que catalogar"}
              </Button>
            )}
            <Link className={buttonClassName({ variant: "quiet" })} href="/app/ajustes#ia">
              Cambiar proveedor o modelo
            </Link>
          </div>

          {!ready ? (
            <div className={`${styles.capabilityNote} ${styles.capabilityNoteWarn}`} role="note">
              <strong>Falta la API key de {providerNames[settings.provider]} en esta sesión.</strong>
              <p>
                Pégala en Ajustes → IA: se guarda solo mientras la pestaña esté abierta.{" "}
                <Link href="/app/ajustes#ia">Ir a Ajustes</Link>
              </p>
            </div>
          ) : analyzing && progress ? (
            <div className={styles.capabilityNote} role="note">
              <strong>
                {progress.processed} de {progress.queued}
                {remainingTime(progress) ? ` · quedan unos ${remainingTime(progress)}` : ""}
              </strong>
              <div
                aria-label="Progreso del análisis"
                aria-valuemax={progress.queued}
                aria-valuemin={0}
                aria-valuenow={progress.processed}
                className={styles.progressTrack}
                role="progressbar"
              >
                <span
                  className={styles.progressValue}
                  style={{
                    width: `${progress.queued ? Math.round((progress.processed / progress.queued) * 100) : 0}%`,
                  }}
                />
              </div>
              {progress.waiting ? (
                <p role="status">
                  <strong>{progress.waiting}</strong>
                </p>
              ) : null}
              <p>
                {progress.current ? `Analizando «${progress.current}». ` : ""}
                {local
                  ? "Ollama trabaja en tu equipo: no sale nada."
                  : `Consumo: ${formatTokens(progress.usage.inputTokens)} tokens de entrada y ${formatTokens(progress.usage.outputTokens)} de salida.`}
              </p>
            </div>
          ) : pending ? (
            <p className={dash.hint}>
              {local
                ? "Ollama trabaja en tu equipo: los extractos no salen de él."
                : `Se envía a ${providerNames[settings.provider]} un extracto de hasta ${settings.maxExcerptCharacters.toLocaleString("es")} caracteres de cada documento, y consume tokens de tu cuenta.`}{" "}
              Van en bloques de {catalogBatchSize} y puedes detenerlo: lo catalogado se conserva.
            </p>
          ) : null}

          <StaleIndexNotice documents={documents} />

          <p aria-live="polite" className={dash.status} role="status">
            {status}
          </p>
        </Card>

        <div className={dash.side}>
          <Card aria-labelledby="revisar-titulo" as="section" className={dash.tool} tone="subtle">
            <Icon name="download" size={20} />
            <h2 id="revisar-titulo">Revisar las fichas a mano</h2>
            <p>
              Descarga la plantilla con la ficha de cada documento, corrige lo que la IA no acertó
              y vuelve a importarla en Fuentes. No gasta IA.
            </p>
            <div className={dash.toolActions}>
              <Button disabled={!documents.length} onClick={downloadTemplate} size="sm" variant="secondary">
                Descargar plantilla JSON
              </Button>
              <Link
                className={buttonClassName({ size: "sm", variant: "quiet" })}
                href="/app/biblioteca/fuentes#indice-json"
              >
                Importar en Fuentes
              </Link>
            </div>
          </Card>

          <Card aria-labelledby="unificar-titulo" as="section" className={dash.tool} tone="subtle">
            <Icon name="link" size={20} />
            <h2 id="unificar-titulo">Unificar nombres</h2>
            <p>
              Junta las variantes de un mismo autor («J. L. Borges» y «Jorge Luis Borges») y de
              una misma categoría («Filosofia» y «Filosofía») en todas las fichas, para que el
              filtro no las muestre dos veces. Antes de aplicarse enseña cada unión y en qué
              fichas cae; no envía nada a la IA.
            </p>
            <div className={dash.toolActions}>
              <UnifyNames
                disabled={analyzing || !catalogs.records.length}
                onStatus={setStatus}
                records={catalogs.records}
              />
            </div>
          </Card>
        </div>
      </div>

      <Card aria-labelledby="recientes-titulo" as="section" className={dash.recent}>
        <header className={dash.recentHead}>
          <h2 id="recientes-titulo">Fichas recientes</h2>
          <Link className={buttonClassName({ size: "sm", variant: "quiet" })} href="/app/biblioteca">
            Ver la Biblioteca
          </Link>
        </header>
        {recent.length ? (
          <ul className={dash.records}>
            {recent.map(({ document, record }) => {
              const catalog = record.catalog;
              const category = [record.extras?.category, record.extras?.subcategory]
                .filter(Boolean)
                .join(" › ");
              const facts = [
                catalog?.publicationYear,
                catalog ? workTypeLabels[catalog.workType] : null,
                catalog?.language ? languageLabel(normalizeLanguage(catalog.language)) : null,
                record.extras?.publisher,
              ].filter(Boolean);
              const stale = record.status === "needs-content" && document && hasStaleIndex(document);

              return (
                <li key={record.documentId}>
                  <div className={dash.recordMain}>
                    <strong>{catalog?.canonicalTitle ?? document?.title ?? "Documento quitado"}</strong>
                    <span>{catalog?.authors.join(", ") || "Autor sin identificar"}</span>
                  </div>
                  <div className={dash.recordCategory} data-empty={category ? undefined : ""}>
                    {category || (record.status === "analyzed" ? "Sin categoría" : "—")}
                  </div>
                  <div className={dash.recordFacts}>{facts.join(" · ") || "—"}</div>
                  <Tag>{stale ? "Índice desactualizado" : statusLabels[record.status]}</Tag>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={dash.emptyNote}>Aún no hay fichas hechas con IA en este dispositivo.</p>
        )}
      </Card>
    </>
  );
}
