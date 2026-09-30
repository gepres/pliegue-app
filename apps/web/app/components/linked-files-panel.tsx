"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { removeDocumentCatalogRecords } from "../ai/document-catalog-store";
import { formatFileSize } from "../library/local-file-metadata";
import {
  linkLocalFiles,
  unlinkLocalFiles,
  useLinkedFiles,
} from "../library/local-file-reference-store";
import { clearReadingProgress } from "../library/reading-progress-store";
import { useCatalogAi } from "../ai/ai-readiness";
import { afterLibraryGrowth } from "../guide/next-steps";
import { confirmAction, type ConfirmOptions } from "./app-ui/confirm-dialog";
import { suggestNextStep } from "./app-ui/next-step-dialog";
import styles from "../(workspace)/app/workspace.module.css";

/**
 * Olvida los archivos: la referencia con su índice, su ficha del catálogo IA y dónde se quedó
 * la lectura. Lo comparten la Biblioteca y Fuentes para que desvincular desde un sitio u otro
 * deje lo mismo.
 */
export async function forgetLinkedFiles(documentIds: readonly string[]) {
  await unlinkLocalFiles(documentIds);
  await removeDocumentCatalogRecords(documentIds).catch(() => undefined);
  for (const documentId of documentIds) clearReadingProgress(documentId);
}

/** La misma pregunta desde la Biblioteca y desde Fuentes: dice qué se olvida y qué no. */
export function unlinkFilesConfirmation(label: string): ConfirmOptions {
  return {
    confirmLabel: "Desvincular",
    description: "Pliegue olvidará:",
    details: [
      "la referencia al archivo y su índice de texto",
      "su ficha del catálogo IA",
      "dónde se quedó la lectura",
    ],
    icon: "link",
    note: "El archivo original no cambia. Puedes volver a vincularlo cuando quieras.",
    title: `¿Desvincular ${label}?`,
    tone: "danger",
  };
}

/**
 * Los archivos vinculados uno a uno desde la Biblioteca. Antes solo se veían como tarjetas y
 * desvincularlos pasaba por el menú de cada una: aquí están juntos, con su estado y la forma de
 * quitarlos, al lado de las carpetas.
 */
export function LinkedFilesPanel() {
  const linkedFiles = useLinkedFiles();
  const catalogAi = useCatalogAi();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState(
    "Desvincular quita la referencia, su índice y su ficha; el archivo original no se toca.",
  );
  const files = linkedFiles.documents;
  // Donde no se puede vincular y no hay nada vinculado, el aviso de las carpetas ya lo explica.
  if (linkedFiles.supported === false && !files.length) return null;

  async function link() {
    setBusy("picker");
    try {
      const result = await linkLocalFiles();
      const step = afterLibraryGrowth({ added: result.linked, ai: catalogAi });
      if (step) suggestNextStep(step);
      setStatus(
        result.linked || result.updated
          ? `${result.linked + result.updated} archivo${result.linked + result.updated === 1 ? "" : "s"} vinculado${result.linked + result.updated === 1 ? "" : "s"}.`
          : "No se vinculó ningún archivo.",
      );
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? "No se eligió ningún archivo."
          : "No fue posible vincular los archivos.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function unlink(documentIds: readonly string[], label: string) {
    const confirmed = await confirmAction(unlinkFilesConfirmation(label));
    if (!confirmed) return;

    setBusy(documentIds.length === 1 ? (documentIds[0] ?? "all") : "all");
    try {
      await forgetLinkedFiles(documentIds);
      setStatus(
        documentIds.length === 1
          ? `${label} se desvinculó. El original sigue donde estaba.`
          : `${documentIds.length} archivos desvinculados. Los originales siguen donde estaban.`,
      );
    } catch {
      setStatus("No fue posible desvincular.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      aria-labelledby="linked-files-title"
      as="section"
      className={styles.linkedFolderPanel}
      id="archivos"
      tone="subtle"
    >
      <div className={styles.linkedFolderHeader}>
        <div>
          <Tag>Local-only · archivo suelto</Tag>
          <h2 id="linked-files-title">Archivos vinculados uno a uno</h2>
          <p>
            Los que vinculaste desde la Biblioteca con «Añadir → Vincular archivos». Se leen donde
            están, como las carpetas, pero sin seguir los cambios de la carpeta.
          </p>
        </div>
        <div className={styles.linkedFolderActions}>
          <Button
            disabled={busy !== null || linkedFiles.supported === false}
            onClick={() => void link()}
            variant="secondary"
          >
            {busy === "picker" ? "Abriendo selector…" : "Vincular archivos"}
          </Button>
          <span>
            {files.length} archivo{files.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {files.length ? (
        <ul aria-label="Archivos vinculados" className={styles.folderSourceList}>
          {files.map((file) => (
            <li className={styles.folderSourceItem} key={file.id}>
              <div>
                <div className={styles.folderSourceTitle}>
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <Tag>{file.availability === "available" ? "Disponible" : "Requiere permiso"}</Tag>
                </div>
                <span className={styles.folderSourceMeta}>
                  {file.format.toUpperCase()} · {formatFileSize(file.sizeBytes)}
                </span>
              </div>
              <div className={styles.folderSourceControls}>
                <Link
                  className={buttonClassName({ size: "sm", variant: "quiet" })}
                  href={{ pathname: "/app/lector", query: { document: file.id } }}
                >
                  Abrir
                </Link>
                <Button
                  disabled={busy !== null}
                  onClick={() => void unlink([file.id], `«${file.originalName}»`)}
                  size="sm"
                  variant="secondary"
                >
                  {busy === file.id ? "Desvinculando…" : "Desvincular"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>Aún no hay archivos sueltos vinculados.</p>
      )}

      {files.length > 1 ? (
        <div className={styles.localImportActions}>
          <Button
            disabled={busy !== null}
            onClick={() => void unlink(files.map((file) => file.id), `los ${files.length} archivos`)}
            size="sm"
            variant="danger"
          >
            {busy === "all" ? "Desvinculando…" : "Desvincular todos"}
          </Button>
        </div>
      ) : null}

      <p aria-live="polite" role="status">
        {linkedFiles.error ?? status}
      </p>
    </Card>
  );
}
