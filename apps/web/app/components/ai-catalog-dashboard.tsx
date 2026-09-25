"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import {
  analyzeDocumentCatalogs,
  catalogBatchSize,
  reconcileStoredAuthors,
  stopCatalogAnalysis,
  type CatalogAnalysisProgress,
} from "../ai/catalog-analysis";
import { useAiSettings } from "../ai/ai-settings-store";
import { useAiSessionSecrets } from "../ai/ai-session-secret-store";
import { useDocumentCatalogs } from "../ai/document-catalog-store";
import { applyImportedCatalogs } from "../library/catalog-import";
import { applyDocumentCatalogs } from "../library/documents";
import { useImportedCatalogs } from "../library/imported-catalog-store";
import { useLinkedFiles } from "../library/local-file-reference-store";
import { useLinkedFolders } from "../library/local-folder-store";
import { useImportedDocuments } from "../library/local-library-store";
import { hasStaleIndex } from "../library/stale-index";
import { StaleIndexNotice } from "./stale-index-notice";
import styles from "../(workspace)/app/workspace.module.css";

const statusLabels = {
  analyzed: "Catalogado",
  analyzing: "Analizando",
  error: "Requiere atención",
  "needs-content": "Requiere OCR",
} as const;

function describeSummary(summary: Awaited<ReturnType<typeof analyzeDocumentCatalogs>>) {
  return [
    summary.stopped ? "Detenido" : "",
    summary.analyzed ? `${summary.analyzed} catalogado${summary.analyzed === 1 ? "" : "s"}` : "",
    summary.needsContent ? `${summary.needsContent} requiere extracción` : "",
    summary.failed ? `${summary.failed} con error` : "",
    summary.skipped ? `${summary.skipped} sin cambios` : "",
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
  const catalogs = useDocumentCatalogs();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const imported = useImportedDocuments();
  const importedCatalogs = useImportedCatalogs();
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<CatalogAnalysisProgress | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [status, setStatus] = useState(
    "Inicia el análisis cuando quieras; no se envía nada automáticamente por defecto.",
  );
  // Las fichas importadas entran en el recuento igual que las del modelo: si no, el panel
  // presenta como pendiente un corpus ya catalogado a mano e invita a pagar por analizarlo.
  const documents = useMemo(
    () =>
      applyImportedCatalogs(
        applyDocumentCatalogs(
          [...linkedFiles.documents, ...linkedFolders.documents, ...imported.documents],
          catalogs.records,
        ),
        importedCatalogs.records,
      ),
    [
      catalogs.records,
      imported.documents,
      importedCatalogs.records,
      linkedFiles.documents,
      linkedFolders.documents,
    ],
  );
  const analyzed = documents.filter((document) => document.catalogStatus === "analyzed").length;
  const fromImport = documents.filter((document) => document.catalogSource === "import").length;
  // Un índice de la versión anterior deja el documento sin texto y el análisis lo marca
  // «needs-content», igual que un escaneo. Contarlos juntos presentaba como trabajo de OCR
  // algo que se resuelve reindexando, y costó varias rondas de diagnóstico averiguarlo.
  const staleIndex = documents.filter(hasStaleIndex).length;
  const needsContent = documents.filter(
    (document) => document.catalogStatus === "needs-content" && !hasStaleIndex(document),
  ).length;
  const errors = documents.filter((document) => document.catalogStatus === "error").length;
  const eligible = documents.filter((document) => Boolean(document.searchText?.trim())).length;
  // Lo que costaría el próximo análisis: documentos con texto que aún no tienen ficha buena.
  const pending = documents.filter(
    (document) =>
      Boolean(document.searchText?.trim()) &&
      document.catalogSource !== "import" &&
      document.catalogStatus !== "analyzed" &&
      document.catalogStatus !== "analyzing",
  ).length;
  const ready = settings.provider === "ollama" || Boolean(secrets[settings.provider]);

  async function analyzePending() {
    setAnalyzing(true);
    setProgress(null);
    setStatus("Catalogando versiones nuevas, pendientes o con error…");

    try {
      const summary = await analyzeDocumentCatalogs(documents, settings, {
        onProgress: setProgress,
        retryErrors: true,
      });
      setStatus(describeSummary(summary) || "El catálogo ya estaba al día.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No fue posible iniciar el análisis.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function unifyAuthors() {
    setReconciling(true);

    try {
      const result = await reconcileStoredAuthors();
      setStatus(
        result.updated
          ? `${result.updated} ficha${result.updated === 1 ? "" : "s"} con la grafía unificada: ${result.merged
              .slice(0, 3)
              .map(({ from, to }) => `«${from}» → «${to}»`)
              .join(", ")}${result.merged.length > 3 ? " y otras" : ""}.`
          : `Sin variantes que unificar en ${result.reviewed} ficha${result.reviewed === 1 ? "" : "s"}.`,
      );
    } catch {
      setStatus("No fue posible revisar las grafías de autor.");
    } finally {
      setReconciling(false);
    }
  }

  return (
    <>
      <section aria-label="Estado del catálogo inteligente" className={styles.catalogMetricGrid}>
        <Card className={styles.catalogMetric}>
          <span>Documentos detectados</span>
          <strong>{documents.length}</strong>
          <small>{eligible} con texto listo</small>
        </Card>
        <Card className={styles.catalogMetric}>
          <span>Catálogo enriquecido</span>
          <strong>{analyzed}</strong>
          <small>
            {documents.length ? Math.round((analyzed / documents.length) * 100) : 0}% del corpus
            {fromImport ? ` · ${fromImport} importada${fromImport === 1 ? "" : "s"}` : ""}
          </small>
        </Card>
        <Card className={styles.catalogMetric}>
          <span>Extracción pendiente</span>
          <strong>{needsContent}</strong>
          <small>
            Imágenes y PDF escaneados esperan al OCR
            {staleIndex ? ` · ${staleIndex} solo necesitan reindexarse` : ""}
          </small>
        </Card>
        <Card className={styles.catalogMetric}>
          <span>Requiere atención</span>
          <strong>{errors}</strong>
          <small>Se puede reintentar sin duplicar versiones</small>
        </Card>
      </section>

      <div className={styles.aiCatalogLayout}>
        <Card className={styles.aiCatalogQueue}>
          <div className={styles.aiCatalogHeader}>
            <div>
              <Tag>{settings.provider} · {settings.models[settings.provider]}</Tag>
              <h2>Catálogo inteligente del espacio</h2>
              <p>
                Autor, título canónico, año, género, tipo de obra, idioma, temas y resumen se
                guardan como una capa derivada local para búsqueda y filtros.
              </p>
            </div>
            <div className={styles.localImportActions}>
              <Button
                disabled={analyzing || !documents.length || !ready}
                onClick={() => void analyzePending()}
              >
                {analyzing ? "Analizando corpus…" : "Analizar pendientes"}
              </Button>
              {analyzing ? (
                <Button onClick={stopCatalogAnalysis} variant="quiet">
                  Detener
                </Button>
              ) : (
                <Button
                  disabled={reconciling || !catalogs.records.length}
                  onClick={() => void unifyAuthors()}
                  variant="quiet"
                >
                  {reconciling ? "Revisando…" : "Unificar autores"}
                </Button>
              )}
              <span>
                {pending} pendiente{pending === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {!analyzing && pending > 0 && ready ? (
            <div className={styles.capabilityNote} role="note">
              <strong>
                Se enviará un extracto de {pending} documento{pending === 1 ? "" : "s"} a{" "}
                {settings.provider}.
              </strong>
              <p>
                Se procesan en bloques de {catalogBatchSize} y puedes detenerlo cuando quieras: lo
                catalogado hasta ese momento se conserva. Un corpus grande tarda varios minutos y
                consume tokens de tu cuenta.
              </p>
            </div>
          ) : null}

          {analyzing && progress ? (
            <div className={styles.capabilityNote} role="note">
              <strong>
                {progress.processed} de {progress.queued}
                {remainingTime(progress)
                  ? ` · quedan unos ${remainingTime(progress)}`
                  : ""}
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
              <p>
                {progress.current ? `Analizando «${progress.current}». ` : ""}
                Consumo del lote: {formatTokens(progress.usage.inputTokens)} tokens de entrada y{" "}
                {formatTokens(progress.usage.outputTokens)} de salida.
              </p>
            </div>
          ) : null}

          <StaleIndexNotice documents={documents} />

          {!ready ? (
            <div className={styles.capabilityNote} role="note">
              <strong>Falta la credencial de esta sesión.</strong>
              <p>Configura el proveedor o pega su API key en Ajustes antes de continuar.</p>
            </div>
          ) : null}
          <p aria-live="polite" className={styles.aiCatalogStatus} role="status">
            {status}
          </p>
        </Card>

        <Card className={styles.aiCatalogRecent}>
          <Tag>Actividad reciente</Tag>
          <h2>Últimos documentos</h2>
          {catalogs.records.length ? (
            <ul>
              {[...catalogs.records]
                .sort((left, right) => right.analyzedAt.localeCompare(left.analyzedAt))
                .slice(0, 6)
                .map((record) => {
                  const document = documents.find((item) => item.id === record.documentId);
                  return (
                    <li key={record.documentId}>
                      <div>
                        <strong>{record.catalog?.canonicalTitle ?? document?.title ?? "Documento desvinculado"}</strong>
                        <span>{record.provider} · {record.model}</span>
                      </div>
                      <Tag>
                        {record.status === "needs-content" && document && hasStaleIndex(document)
                          ? "Índice desactualizado"
                          : statusLabels[record.status]}
                      </Tag>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p>Aún no hay análisis registrados en este dispositivo.</p>
          )}
          <Link className={buttonClassName({ size: "sm", variant: "quiet" })} href="/app/ajustes">
            Configurar IA
          </Link>
        </Card>
      </div>
    </>
  );
}
