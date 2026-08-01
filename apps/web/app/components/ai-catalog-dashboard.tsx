"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { analyzeDocumentCatalogs } from "../ai/catalog-analysis";
import { useAiSettings } from "../ai/ai-settings-store";
import { useAiSessionSecrets } from "../ai/ai-session-secret-store";
import { useDocumentCatalogs } from "../ai/document-catalog-store";
import { applyDocumentCatalogs } from "../library/documents";
import { useLinkedFiles } from "../library/local-file-reference-store";
import { useLinkedFolders } from "../library/local-folder-store";
import { useImportedDocuments } from "../library/local-library-store";
import styles from "../(workspace)/app/workspace.module.css";

const statusLabels = {
  analyzed: "Catalogado",
  analyzing: "Analizando",
  error: "Requiere atención",
  "needs-content": "Requiere PDF/OCR",
} as const;

function describeSummary(summary: Awaited<ReturnType<typeof analyzeDocumentCatalogs>>) {
  return [
    summary.analyzed ? `${summary.analyzed} catalogado${summary.analyzed === 1 ? "" : "s"}` : "",
    summary.needsContent ? `${summary.needsContent} requiere extracción` : "",
    summary.failed ? `${summary.failed} con error` : "",
    summary.skipped ? `${summary.skipped} sin cambios` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AiCatalogDashboard() {
  const settings = useAiSettings();
  const secrets = useAiSessionSecrets();
  const catalogs = useDocumentCatalogs();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const imported = useImportedDocuments();
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState(
    "Inicia el análisis cuando quieras; no se envía nada automáticamente por defecto.",
  );
  const documents = useMemo(
    () =>
      applyDocumentCatalogs(
        [...linkedFiles.documents, ...linkedFolders.documents, ...imported.documents],
        catalogs.records,
      ),
    [catalogs.records, imported.documents, linkedFiles.documents, linkedFolders.documents],
  );
  const analyzed = documents.filter((document) => document.catalogStatus === "analyzed").length;
  const needsContent = documents.filter(
    (document) => document.catalogStatus === "needs-content",
  ).length;
  const errors = documents.filter((document) => document.catalogStatus === "error").length;
  const eligible = documents.filter((document) => Boolean(document.searchText?.trim())).length;
  const ready = settings.provider === "ollama" || Boolean(secrets[settings.provider]);

  async function analyzePending() {
    setAnalyzing(true);
    setStatus("Catalogando versiones nuevas, pendientes o con error…");
    try {
      const summary = await analyzeDocumentCatalogs(documents, settings, { retryErrors: true });
      setStatus(describeSummary(summary) || "El catálogo ya estaba al día.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No fue posible iniciar el análisis.");
    } finally {
      setAnalyzing(false);
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
          <small>{documents.length ? Math.round((analyzed / documents.length) * 100) : 0}% del corpus</small>
        </Card>
        <Card className={styles.catalogMetric}>
          <span>Extracción pendiente</span>
          <strong>{needsContent}</strong>
          <small>PDF e imágenes requieren el siguiente bloque</small>
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
            <Button disabled={analyzing || !documents.length || !ready} onClick={() => void analyzePending()}>
              {analyzing ? "Analizando corpus…" : "Analizar pendientes"}
            </Button>
          </div>
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
                      <Tag>{statusLabels[record.status]}</Tag>
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
