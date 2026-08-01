"use client";

import Link from "next/link";

import { Card, Tag, buttonClassName } from "@pliegue/ui";

import { useLinkedFiles } from "../library/local-file-reference-store";
import { useLinkedFolders } from "../library/local-folder-store";
import { useImportedDocuments } from "../library/local-library-store";
import styles from "../(workspace)/app/workspace.module.css";
import { DocumentCard, PageHeader } from "./workspace-page";

export function ReaderStart() {
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const documents = [
    ...linkedFiles.documents,
    ...linkedFolders.documents,
    ...importedLibrary.documents,
  ];
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
        description="Elige un archivo real de tu Biblioteca. La lectura y el progreso permanecen en este dispositivo."
        eyebrow="Lector local"
        title="¿Qué quieres leer?"
      />

      {storageError ? (
        <Card className={styles.emptyState} role="alert" tone="subtle">
          <Tag>Almacenamiento no disponible</Tag>
          <h2>No pudimos abrir tu Biblioteca local</h2>
          <p>{storageError}</p>
        </Card>
      ) : loading ? (
        <Card aria-live="polite" className={styles.emptyState} role="status" tone="subtle">
          <Tag>Preparando</Tag>
          <h2>Recuperando tu Biblioteca…</h2>
        </Card>
      ) : documents.length ? (
        <section aria-label="Documentos disponibles" className={styles.documentGrid}>
          {documents.slice(0, 6).map((document) => (
            <DocumentCard
              eyebrow={`${document.format.toUpperCase()} · Local`}
              key={document.id}
              title={document.title}
            >
              <p>{document.meta}</p>
              <div className={styles.documentMeta}>
                <Tag>
                  {document.availability === "available" ? "Disponible" : "En este dispositivo"}
                </Tag>
                <Link
                  className={buttonClassName({ size: "sm", variant: "secondary" })}
                  href={{ pathname: "/app/lector", query: { document: document.id } }}
                >
                  Abrir
                </Link>
              </div>
            </DocumentCard>
          ))}
        </section>
      ) : (
        <Card as="section" className={styles.onboardingCard} tone="subtle">
          <Tag>Sin documentos</Tag>
          <h2>Primero añade un archivo a tu Biblioteca</h2>
          <p>
            El lector ya no muestra contenido de demostración. Vincula un archivo o carpeta
            para analizarlo sin duplicar el binario y abrirlo desde su ubicación original.
          </p>
          <Link className={buttonClassName()} href="/app/biblioteca#importar-archivos">
            Ir a vincular archivos
          </Link>
        </Card>
      )}
    </>
  );
}
