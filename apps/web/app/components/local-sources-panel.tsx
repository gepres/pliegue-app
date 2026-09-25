"use client";

import { useState } from "react";

import { Button, Card, Tag } from "@pliegue/ui";

import { removeDocumentCatalogRecords } from "../ai/document-catalog-store";
import {
  linkLocalFolder,
  scanLinkedFolder,
  unlinkLocalFolder,
  useLinkedFolders,
  type FolderIndexProgress,
  type FolderSyncResult,
  type LinkedFolderSource,
} from "../library/local-folder-store";
import styles from "../(workspace)/app/workspace.module.css";

const scanDateFormatter = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "medium",
  timeZone: "America/Lima",
  timeStyle: "short",
});

const permissionLabels: Record<LinkedFolderSource["permission"], string> = {
  denied: "Acceso denegado",
  granted: "Permiso activo",
  prompt: "Requiere permiso",
};

function describeScan(result: FolderSyncResult) {
  if (result.permission !== "granted") {
    return `«${result.sourceName}» requiere permiso de lectura para buscar cambios.`;
  }

  const changes = [
    result.added ? `${result.added} nuevo${result.added === 1 ? "" : "s"}` : "",
    result.changed ? `${result.changed} modificado${result.changed === 1 ? "" : "s"}` : "",
    result.removed ? `${result.removed} eliminado${result.removed === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  if (!changes.length) return `«${result.sourceName}» está al día · ${result.total} archivos.`;
  return `«${result.sourceName}» · ${changes.join(" · ")} · ${result.total} archivos.`;
}

function describeFolderError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "No se seleccionó ninguna carpeta.";
  }

  if (error instanceof Error && error.message.includes("supera el límite")) {
    return error.message;
  }

  if (error instanceof Error && error.message === "Este navegador no permite vincular carpetas.") {
    return "Esta ventana no permite conservar carpetas. Abre Pliegue en Chrome o Edge mediante HTTPS o localhost e inténtalo de nuevo.";
  }

  return "No fue posible acceder a esa carpeta. Revisa el permiso del navegador.";
}

function formatLastScan(value: string | null) {
  if (!value) return "Todavía no escaneada";
  return `Último escaneo · ${scanDateFormatter.format(new Date(value))}`;
}

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * El tiempo restante se calcula sobre los archivos que hubo que extraer, no sobre todos: en un
 * reescaneo la mayoría reutiliza su índice y termina al instante, así que promediar el total
 * daría una previsión demasiado optimista justo cuando más importa acertar.
 */
function remainingTime(progress: FolderIndexProgress) {
  if (progress.extracted < 2) return null;
  const perExtraction = progress.elapsedMs / progress.extracted;
  const pending = progress.total - progress.processed;
  return pending > 0 ? formatDuration(perExtraction * pending) : null;
}

export function LocalSourcesPanel() {
  const linkedFolders = useLinkedFolders();
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [progress, setProgress] = useState<FolderIndexProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Los cambios y el índice derivado se actualizan bajo demanda; Pliegue nunca copia ni modifica los originales.",
  );
  const isBusy = busySourceId !== null;

  function endRun() {
    setBusySourceId(null);
    setProgress(null);
  }

  async function linkFolder() {
    setBusySourceId("picker");
    setProgress(null);

    try {
      const result = await linkLocalFolder(setProgress);
      setStatusMessage(
        result.relinked ? `Permiso renovado. ${describeScan(result)}` : describeScan(result),
      );
    } catch (error) {
      setStatusMessage(describeFolderError(error));
    } finally {
      endRun();
    }
  }

  async function scanFolder(source: LinkedFolderSource, requestAccess: boolean) {
    setBusySourceId(source.id);
    setProgress(null);

    try {
      const result = await scanLinkedFolder(source.id, requestAccess, setProgress);
      setStatusMessage(describeScan(result));
    } catch (error) {
      setStatusMessage(describeFolderError(error));
    } finally {
      endRun();
    }
  }

  async function unlinkFolder(source: LinkedFolderSource) {
    const affected = linkedFolders.documents.filter(
      (document) => document.sourceId === source.id,
    ).length;
    // El aviso enumera lo que realmente se pierde. Decir solo «el permiso y sus metadatos»
    // llevó a desvincular una carpeta creyendo que se renovaba el acceso, y con ella se fueron
    // el índice de texto y las fichas que costaron llamadas al proveedor.
    const confirmed = window.confirm(
      `¿Desvincular «${source.name}»?\n\nSe eliminarán de Pliegue el permiso, el índice de texto de ${affected} documento${
        affected === 1 ? "" : "s"
      } y sus fichas del catálogo IA. Volver a vincularla obliga a reextraer el texto y a analizarlo otra vez.\n\nLos archivos originales no cambiarán.\n\nSi solo quieres recuperar el acceso, cancela y usa «Conceder acceso».`,
    );
    if (!confirmed) return;

    setBusySourceId(source.id);

    try {
      const documentIds = linkedFolders.documents
        .filter((document) => document.sourceId === source.id)
        .map((document) => document.id);
      await unlinkLocalFolder(source.id);
      await removeDocumentCatalogRecords(documentIds).catch(() => undefined);
      setStatusMessage(`«${source.name}» se desvinculó. Los originales permanecen intactos.`);
    } catch {
      setStatusMessage("No fue posible desvincular la carpeta.");
    } finally {
      setBusySourceId(null);
    }
  }

  return (
    <Card
      aria-labelledby="linked-folders-title"
      as="section"
      className={styles.linkedFolderPanel}
      id="carpetas-vinculadas"
      tone="subtle"
    >
      <div className={styles.linkedFolderHeader}>
        <div>
          <Tag>Local-only · carpeta viva</Tag>
          <h2 id="linked-folders-title">Vincula una carpeta sin copiarla</h2>
          <p>
            Pliegue conserva el permiso, un manifiesto y hasta 32.000 caracteres de índice
            por documento. “Buscar cambios” vuelve a analizar solo archivos nuevos o modificados.
          </p>
        </div>
        <div className={styles.linkedFolderActions}>
          <Button
            aria-describedby="linked-folders-status"
            disabled={isBusy}
            onClick={() => void linkFolder()}
            variant="secondary"
          >
            {busySourceId === "picker" ? "Abriendo selector…" : "Vincular carpeta"}
          </Button>
          <span>
            {linkedFolders.sources.length} carpeta
            {linkedFolders.sources.length === 1 ? "" : "s"} · {linkedFolders.documents.length}{" "}
            archivos
          </span>
        </div>
      </div>

      {progress ? (
        <div className={styles.capabilityNote} role="note">
          <strong>
            Indexando {progress.processed} de {progress.total}
            {remainingTime(progress)
              ? ` · quedan unos ${remainingTime(progress)}`
              : ""}
          </strong>
          <div
            aria-label="Progreso de la indexación"
            aria-valuemax={progress.total}
            aria-valuemin={0}
            aria-valuenow={progress.processed}
            className={styles.progressTrack}
            role="progressbar"
          >
            <span
              className={styles.progressValue}
              style={{
                width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%`,
              }}
            />
          </div>
          <p>
            {progress.extracted} con texto extraído
            {progress.reused ? ` · ${progress.reused} sin cambios` : ""}. La extracción ocurre en
            esta pestaña: mantenla abierta y no la recargues hasta que termine.
          </p>
        </div>
      ) : null}

      {linkedFolders.supported === false ? (
        <div className={styles.capabilityNote} role="note">
          <strong>La vinculación de carpetas no está disponible en esta ventana.</strong>
          <p>
            Puedes reintentar con el botón. Abre Pliegue mediante HTTPS o localhost en Chrome
            o Edge; la importación de una copia permanece como alternativa explícita.
          </p>
        </div>
      ) : null}

      {linkedFolders.sources.length ? (
        <ul aria-label="Carpetas vinculadas" className={styles.folderSourceList}>
          {linkedFolders.sources.map((source) => {
            const sourceIsBusy = busySourceId === source.id;

            return (
              <li className={styles.folderSourceItem} key={source.id}>
                <div>
                  <div className={styles.folderSourceTitle}>
                    <strong>{source.name}</strong>
                    <Tag>{permissionLabels[source.permission]}</Tag>
                  </div>
                  <span className={styles.folderSourceMeta}>
                    {source.fileCount} archivos · {formatLastScan(source.lastScannedAt)}
                  </span>
                </div>
                <div className={styles.folderSourceControls}>
                  {source.permission === "granted" ? (
                    <Button
                      disabled={isBusy}
                      onClick={() => void scanFolder(source, false)}
                      size="sm"
                      variant="secondary"
                    >
                      {sourceIsBusy ? "Comparando y analizando…" : "Buscar cambios"}
                    </Button>
                  ) : (
                    <Button
                      disabled={isBusy}
                      onClick={() => void scanFolder(source, true)}
                      size="sm"
                      variant="secondary"
                    >
                      {sourceIsBusy ? "Solicitando…" : "Conceder acceso"}
                    </Button>
                  )}
                  <Button
                    disabled={isBusy}
                    onClick={() => void unlinkFolder(source)}
                    size="sm"
                    variant="quiet"
                  >
                    Desvincular
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : linkedFolders.supported ? (
        <div className={styles.capabilityNote} role="note">
          <strong>Aún no hay carpetas vinculadas.</strong>
          <p>
            El navegador pedirá acceso de solo lectura a la carpeta que elijas. Pliegue abrirá
            cada archivo para extraer su texto, así que un corpus de cientos de documentos puede
            tardar varios minutos la primera vez; los escaneos siguientes solo releen lo que haya
            cambiado.
          </p>
        </div>
      ) : null}

      <p
        aria-label="Estado de carpetas vinculadas"
        aria-live="polite"
        id="linked-folders-status"
        role="status"
      >
        {linkedFolders.error ?? statusMessage}
      </p>
    </Card>
  );
}
