"use client";

import { useState } from "react";

import { Button, Card, Tag } from "@pliegue/ui";

import {
  linkLocalFolder,
  scanLinkedFolder,
  unlinkLocalFolder,
  useLinkedFolders,
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

  return "No fue posible acceder a esa carpeta. Revisa el permiso del navegador.";
}

function formatLastScan(value: string | null) {
  if (!value) return "Todavía no escaneada";
  return `Último escaneo · ${scanDateFormatter.format(new Date(value))}`;
}

export function LocalSourcesPanel() {
  const linkedFolders = useLinkedFolders();
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Los cambios y el índice derivado se actualizan bajo demanda; Pliegue nunca copia ni modifica los originales.",
  );
  const isBusy = busySourceId !== null;

  async function linkFolder() {
    setBusySourceId("picker");

    try {
      const result = await linkLocalFolder();
      setStatusMessage(
        result.relinked ? `Permiso renovado. ${describeScan(result)}` : describeScan(result),
      );
    } catch (error) {
      setStatusMessage(describeFolderError(error));
    } finally {
      setBusySourceId(null);
    }
  }

  async function scanFolder(source: LinkedFolderSource, requestAccess: boolean) {
    setBusySourceId(source.id);

    try {
      const result = await scanLinkedFolder(source.id, requestAccess);
      setStatusMessage(describeScan(result));
    } catch (error) {
      setStatusMessage(describeFolderError(error));
    } finally {
      setBusySourceId(null);
    }
  }

  async function unlinkFolder(source: LinkedFolderSource) {
    const confirmed = window.confirm(
      `¿Desvincular «${source.name}»? Solo se eliminarán el permiso y sus metadatos en Pliegue; los archivos originales no cambiarán.`,
    );
    if (!confirmed) return;

    setBusySourceId(source.id);

    try {
      await unlinkLocalFolder(source.id);
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
            disabled={isBusy || linkedFolders.status !== "ready" || !linkedFolders.supported}
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

      {linkedFolders.supported === false ? (
        <div className={styles.capabilityNote} role="note">
          <strong>Carpetas persistentes no disponibles en este navegador.</strong>
          <p>Puedes seguir usando “Importar copia”; no perderás ninguna función existente.</p>
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
          <p>El navegador pedirá acceso de solo lectura a la carpeta que elijas.</p>
        </div>
      ) : null}

      <p aria-label="Estado de carpetas vinculadas" aria-live="polite" role="status">
        {linkedFolders.error ?? statusMessage}
      </p>
    </Card>
  );
}
