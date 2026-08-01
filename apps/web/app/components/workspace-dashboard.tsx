"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Card, Tag, buttonClassName } from "@pliegue/ui";

import type { LibraryDocument } from "../library/documents";
import { useFavorites } from "../library/favorite-store";
import { useLinkedFiles } from "../library/local-file-reference-store";
import { useLinkedFolders } from "../library/local-folder-store";
import { useImportedDocuments } from "../library/local-library-store";
import { useReadingProgressEntries } from "../library/reading-progress-store";
import styles from "../(workspace)/app/workspace.module.css";
import { DocumentCard, MetricCard, PageHeader } from "./workspace-page";

const readingDateFormatter = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "medium",
  timeStyle: "short",
});

function documentDate(document: LibraryDocument) {
  if ("importedAt" in document && typeof document.importedAt === "string") {
    return Date.parse(document.importedAt);
  }
  if ("lastModified" in document && typeof document.lastModified === "number") {
    return document.lastModified;
  }
  return 0;
}

export function WorkspaceDashboard() {
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const favorites = useFavorites();
  const progressEntries = useReadingProgressEntries();
  const documents = useMemo(
    () => [
      ...linkedFiles.documents,
      ...linkedFolders.documents,
      ...importedLibrary.documents,
    ],
    [importedLibrary.documents, linkedFiles.documents, linkedFolders.documents],
  );
  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );
  const progressById = useMemo(
    () => new Map(progressEntries.map((progress) => [progress.documentId, progress])),
    [progressEntries],
  );
  const resumeProgress = progressEntries.find(
    (progress) =>
      progress.percent > 0 && progress.percent < 100 && documentsById.has(progress.documentId),
  );
  const resumeDocument = resumeProgress
    ? documentsById.get(resumeProgress.documentId)
    : undefined;
  const recentDocuments = [...documents]
    .sort((left, right) => {
      const leftProgress = progressById.get(left.id)?.updatedAt;
      const rightProgress = progressById.get(right.id)?.updatedAt;
      return (
        (rightProgress ? Date.parse(rightProgress) : documentDate(right)) -
        (leftProgress ? Date.parse(leftProgress) : documentDate(left))
      );
    })
    .slice(0, 3);
  const activeFavorites = favorites.filter((id) => documentsById.has(id)).length;
  const activeReadings = progressEntries.filter(
    (progress) =>
      progress.percent > 0 && progress.percent < 100 && documentsById.has(progress.documentId),
  ).length;
  const loading =
    importedLibrary.status === "idle" ||
    importedLibrary.status === "loading" ||
    linkedFiles.status === "idle" ||
    linkedFiles.status === "loading" ||
    linkedFolders.status === "idle" ||
    linkedFolders.status === "loading";
  const storageError = importedLibrary.error ?? linkedFiles.error ?? linkedFolders.error;

  return (
    <>
      <PageHeader
        actions={
          <>
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/design-system"
            >
              Sistema visual
            </Link>
            <Link className={buttonClassName()} href="/app/biblioteca#importar-archivos">
              Añadir documentos
            </Link>
          </>
        }
        description="Vincula archivos o carpetas; Pliegue conserva referencias e índices derivados y abre el original desde su ubicación."
        eyebrow="Área local · Datos reales"
        title="Tu biblioteca de trabajo"
      />

      <section aria-label="Resumen real del área" className={styles.metricGrid}>
        <MetricCard
          detail={`${linkedFiles.documents.length} archivos · ${linkedFolders.documents.length} en carpetas · ${importedLibrary.documents.length} copias heredadas`}
          label="Documentos"
          value={loading ? "—" : String(documents.length)}
        />
        <MetricCard
          detail="Guardados en este dispositivo"
          label="Favoritos"
          value={loading ? "—" : String(activeFavorites)}
        />
        <MetricCard
          detail="Con una posición local para retomar"
          label="En lectura"
          value={loading ? "—" : String(activeReadings)}
        />
      </section>

      {storageError ? (
        <Card className={styles.emptyState} role="alert" tone="subtle">
          <Tag>Almacenamiento no disponible</Tag>
          <h2>No pudimos abrir tu Biblioteca local</h2>
          <p>{storageError}</p>
        </Card>
      ) : loading ? (
        <Card aria-live="polite" className={styles.emptyState} role="status" tone="subtle">
          <Tag>Biblioteca local</Tag>
          <h2>Recuperando tus documentos…</h2>
          <p>Consultamos IndexedDB y los permisos guardados en este navegador.</p>
        </Card>
      ) : resumeDocument && resumeProgress ? (
        <Card as="section" className={styles.continueCard}>
          <div>
            <Tag>Retomar · {resumeProgress.percent} %</Tag>
            <h2>{resumeDocument.title}</h2>
            <p>
              Encontramos una posición guardada el{
              " "}{readingDateFormatter.format(new Date(resumeProgress.updatedAt))}. Puedes
              volver exactamente a ese avance o abrir otro documento desde la Biblioteca.
            </p>
            <Link
              className={buttonClassName()}
              href={{
                pathname: "/app/lector",
                query: { document: resumeDocument.id, resume: "1" },
              }}
            >
              Retomar lectura
            </Link>
          </div>
          <div aria-hidden="true" className={styles.bookCover}>
            {resumeDocument.title}
          </div>
        </Card>
      ) : documents.length ? (
        <Card as="section" className={styles.continueCard}>
          <div>
            <Tag>Todo listo</Tag>
            <h2>Empieza con {recentDocuments[0]?.title}</h2>
            <p>
              Al abrirlo, Pliegue guardará el avance en este dispositivo para que puedas
              cerrar la pestaña y continuar después.
            </p>
            <Link
              className={buttonClassName()}
              href={{ pathname: "/app/lector", query: { document: recentDocuments[0]?.id } }}
            >
              Abrir en el lector
            </Link>
          </div>
          <div aria-hidden="true" className={styles.bookCover}>
            {recentDocuments[0]?.title}
          </div>
        </Card>
      ) : (
        <Card as="section" className={styles.onboardingCard} tone="subtle">
          <Tag>Biblioteca vacía</Tag>
          <h2>Prueba Pliegue con uno de tus archivos</h2>
          <p>
            No cargamos documentos de muestra ni duplicamos tus archivos por defecto.
            Vincula un PDF, EPUB, DOCX, PPTX, XLSX, TXT, Markdown, PNG o JPG y aparecerá
            aquí con su índice derivado.
          </p>
          <Link className={buttonClassName()} href="/app/biblioteca#importar-archivos">
            Vincular mi primer archivo
          </Link>
        </Card>
      )}

      {recentDocuments.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Documentos recientes</h2>
            <Link href="/app/biblioteca">Ver biblioteca</Link>
          </div>
          <div className={styles.documentGrid}>
            {recentDocuments.map((document) => {
              const progress = progressById.get(document.id);

              return (
                <DocumentCard
                  eyebrow={`${document.format.toUpperCase()} · Local`}
                  key={document.id}
                  title={document.title}
                >
                  <p>{document.author}</p>
                  <div className={styles.documentMeta}>
                    <span>{progress ? `${progress.percent} % leído` : document.meta}</span>
                    <Link
                      className={buttonClassName({ size: "sm", variant: "secondary" })}
                      href={{ pathname: "/app/lector", query: { document: document.id } }}
                    >
                      Leer
                    </Link>
                  </div>
                </DocumentCard>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
