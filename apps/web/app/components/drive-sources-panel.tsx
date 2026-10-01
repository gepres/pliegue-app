"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { useCatalogAi } from "../ai/ai-readiness";
import { removeDocumentCatalogRecords } from "../ai/document-catalog-store";
import { DriveApiError } from "../drive/drive-api";
import {
  connectDrive,
  disconnectDrive,
  getDriveToken,
  preloadDriveConnection,
  readDriveConnection,
  useDriveConnection,
  type DriveAccessOutcome,
} from "../drive/drive-connection";
import { openDrivePicker, preloadDrivePicker } from "../drive/drive-picker";
import { afterLibraryGrowth } from "../guide/next-steps";
import {
  addDriveFiles,
  linkDriveFolder,
  pauseDriveIndexing,
  resumeDriveIndexing,
  scanDriveFolder,
  unlinkDriveFiles,
  unlinkDriveFolder,
  useDriveLibrary,
  type DriveFolderResult,
  type DriveFolderSource,
} from "../library/drive-library-store";
import { copyGroupOf, copyReleaseNote, releaseCopies, useCopyGroups } from "../library/book-copies-store";
import { formatFileSize } from "../library/local-file-metadata";
import { clearReadingProgress } from "../library/reading-progress-store";
import { confirmAction } from "./app-ui/confirm-dialog";
import { suggestNextStep } from "./app-ui/next-step-dialog";
import styles from "../(workspace)/app/workspace.module.css";

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatLastScan(value: string | null) {
  if (!value) return "sin recorrer";
  return `revisada ${new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}`;
}

const outcomeMessages: Record<Exclude<DriveAccessOutcome, "granted">, string> = {
  blocked: "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes de este sitio y vuelve a intentarlo.",
  cancelled: "No se concedió el acceso a Google Drive.",
};

function describeFolderResult(result: DriveFolderResult) {
  const parts = [
    result.added ? plural(result.added, "nuevo") : "",
    result.changed ? plural(result.changed, "cambiado") : "",
    result.removed ? plural(result.removed, "quitado") : "",
  ].filter(Boolean);
  return `«${result.sourceName}»: ${plural(result.total, "documento")}${parts.length ? ` (${parts.join(", ")})` : ", sin cambios"}${
    result.skipped ? ` · ${plural(result.skipped, "archivo")} que Pliegue no lee` : ""
  }. El texto y las portadas llegan poco a poco.`;
}

/** Olvida documentos de Drive: la referencia, su índice, su ficha IA y dónde se quedó la lectura. */
async function forgetDriveDocuments(documentIds: readonly string[]) {
  await removeDocumentCatalogRecords(documentIds).catch(() => undefined);
  for (const documentId of documentIds) clearReadingProgress(documentId);
}

/**
 * Google Drive como fuente: archivos elegidos uno a uno (`drive.file`) o carpetas completas
 * (`drive.readonly`, que solo se pide al vincular una). Los originales se quedan en Drive.
 */
export function DriveSourcesPanel() {
  const connection = useDriveConnection();
  const drive = useDriveLibrary();
  const catalogAi = useCatalogAi();
  const copyGroups = useCopyGroups();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  // La ventana de Google y el selector deben abrirse al instante del clic: se cargan antes.
  useEffect(() => {
    if (!connection.configured) return;
    preloadDriveConnection();
    preloadDrivePicker();
  }, [connection.configured]);

  if (!connection.configured) {
    return (
      <Card aria-labelledby="drive-title" as="section" className={styles.linkedFolderPanel} id="drive" tone="subtle">
        <div className={styles.linkedFolderHeader}>
          <div>
            <Tag>No configurado</Tag>
            <h2 id="drive-title">Google Drive</h2>
            <p>
              Esta instalación de Pliegue no tiene las credenciales de Google. Quien la administra
              puede activarlas con tres variables públicas; los pasos están en{" "}
              <code>docs/google-drive.md</code>.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const files = drive.documents.filter((document) => !document.sourceId);
  // Un libro que también está en una carpeta local o importado sale una vez en la Biblioteca.
  const alsoLocal = (documentId: string) =>
    Boolean(copyGroupOf(copyGroups, documentId)?.copyIds.some((id) => id !== documentId && !id.startsWith("drive:")));
  const indexing = drive.indexing;
  const pending = drive.documents.filter((document) => document.indexStatus === "pending").length;

  /** Un token con el alcance que hace falta; pide conectar si no lo hay. Llamar desde un clic. */
  async function ensureAccess(readonly: boolean) {
    const current = getDriveToken();
    if (current && (!readonly || readDriveConnection().readonly)) return current;
    const outcome = await connectDrive({ readonly });
    if (outcome !== "granted") {
      setStatus(outcomeMessages[outcome]);
      return null;
    }
    return getDriveToken();
  }

  function report(error: unknown, fallback: string) {
    setStatus(error instanceof DriveApiError || error instanceof Error ? error.message : fallback);
  }

  async function pickFiles() {
    setBusy("files");
    try {
      const token = await ensureAccess(false);
      if (!token) return;
      const picked = await openDrivePicker("files", token);
      if (!picked.length) {
        setStatus("No se eligió ningún archivo.");
        return;
      }
      setStatus(`Leyendo ${plural(picked.length, "archivo")} de Drive…`);
      const result = await addDriveFiles(picked);
      const step = afterLibraryGrowth({ added: result.added, ai: catalogAi });
      if (step) suggestNextStep(step);
      setStatus(
        [
          result.added ? `${plural(result.added, "archivo")} de Drive en la biblioteca` : "",
          result.updated ? `${plural(result.updated, "actualizado")}` : "",
          result.rejected.length
            ? `${plural(result.rejected.length, "descartado")}: ${result.rejected.map((item) => `«${item.name}» (${item.reason})`).join("; ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ") || "No se añadió ningún archivo.",
      );
    } catch (error) {
      report(error, "No fue posible añadir los archivos de Drive.");
    } finally {
      setBusy(null);
    }
  }

  async function linkFolder() {
    // La primera vez, antes del aviso de Google, se explica por qué pide ver Drive entero.
    if (!readDriveConnection().readonly) {
      const confirmed = await confirmAction({
        confirmLabel: "Continuar con Google",
        description: "Para seguir una carpeta y sus subcarpetas, Google pedirá permiso para:",
        details: [
          "ver los archivos de tu Drive (solo lectura: Pliegue no puede cambiar ni borrar nada)",
          "Pliegue solo recorre la carpeta que elijas después",
        ],
        icon: "cloud",
        note: "Mientras Google no verifique Pliegue verás «Google no ha verificado esta aplicación»: pulsa «Configuración avanzada» y luego «Ir a Pliegue».",
        title: "Vincular una carpeta de Drive",
      });
      if (!confirmed) return;
    }

    setBusy("folder");
    try {
      const token = await ensureAccess(true);
      if (!token) return;
      const [folder] = await openDrivePicker("folder", token);
      if (!folder) {
        setStatus("No se eligió ninguna carpeta.");
        return;
      }
      setStatus(`Recorriendo «${folder.name}»…`);
      const result = await linkDriveFolder(folder, (folders) =>
        setStatus(`Recorriendo «${folder.name}»: ${plural(folders, "carpeta")} revisada${folders === 1 ? "" : "s"}…`),
      );
      const step = afterLibraryGrowth({ added: result.added, ai: catalogAi });
      if (step) suggestNextStep(step);
      setStatus(describeFolderResult(result));
    } catch (error) {
      report(error, "No fue posible vincular la carpeta de Drive.");
    } finally {
      setBusy(null);
    }
  }

  async function rescan(source: DriveFolderSource) {
    setBusy(source.id);
    try {
      if (!(await ensureAccess(true))) return;
      setStatus(`Buscando cambios en «${source.name}»…`);
      const result = await scanDriveFolder(source.id, (folders) =>
        setStatus(`Buscando cambios en «${source.name}»: ${plural(folders, "carpeta")} revisada${folders === 1 ? "" : "s"}…`),
      );
      setStatus(describeFolderResult(result));
    } catch (error) {
      report(error, "No fue posible revisar la carpeta de Drive.");
    } finally {
      setBusy(null);
    }
  }

  async function unlinkFolder(source: DriveFolderSource) {
    const documentIds = drive.documents.filter((document) => document.sourceId === source.id).map((document) => document.id);
    const confirmed = await confirmAction({
      confirmLabel: "Desvincular carpeta",
      description: "Se eliminarán de Pliegue:",
      details: [`el índice de ${plural(documentIds.length, "documento")}`, "sus fichas del catálogo IA", "dónde se quedó la lectura"],
      icon: "cloud",
      note: `${copyReleaseNote(documentIds) ?? ""} Los archivos siguen en tu Drive, sin cambios.`.trim(),
      title: `¿Desvincular «${source.name}»?`,
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(source.id);
    try {
      await releaseCopies(documentIds);
      await unlinkDriveFolder(source.id);
      await forgetDriveDocuments(documentIds);
      setStatus(`«${source.name}» se desvinculó. Los archivos siguen en tu Drive.`);
    } catch {
      setStatus("No fue posible desvincular la carpeta.");
    } finally {
      setBusy(null);
    }
  }

  async function removeFiles(documentIds: readonly string[], label: string) {
    const confirmed = await confirmAction({
      confirmLabel: "Quitar",
      description: "Pliegue olvidará:",
      details: ["la referencia y su índice de texto", "su ficha del catálogo IA", "dónde se quedó la lectura"],
      icon: "cloud",
      note: `${copyReleaseNote(documentIds) ?? ""} El archivo sigue en tu Drive. Puedes volver a elegirlo cuando quieras.`.trim(),
      title: `¿Quitar ${label} de la biblioteca?`,
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy("remove");
    try {
      await releaseCopies(documentIds);
      await unlinkDriveFiles(documentIds);
      await forgetDriveDocuments(documentIds);
      setStatus(`${label[0]?.toLocaleUpperCase("es")}${label.slice(1)} ya no está en la biblioteca. Sigue en tu Drive.`);
    } catch {
      setStatus("No fue posible quitar los archivos.");
    } finally {
      setBusy(null);
    }
  }

  async function reconnect() {
    setBusy("connect");
    try {
      const outcome = await connectDrive();
      setStatus(outcome === "granted" ? "Drive conectado." : outcomeMessages[outcome]);
    } catch (error) {
      report(error, "No fue posible conectar con Google Drive.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    const confirmed = await confirmAction({
      confirmLabel: "Desconectar",
      description: "Pliegue dejará de tener acceso a tu Drive:",
      details: [
        "Google retira el permiso de esta app",
        "los documentos de Drive quedan en la biblioteca, pero no se abren hasta que vuelvas a conectar",
      ],
      icon: "cloud",
      note: "Para quitarlos también, desvincula sus carpetas o quita los archivos.",
      title: "¿Desconectar Google Drive?",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy("disconnect");
    try {
      const { revoked } = await disconnectDrive();
      setStatus(
        revoked
          ? "Google Drive desconectado y permiso retirado."
          : "Google Drive desconectado en este navegador. Si quieres retirar también el permiso en Google, hazlo en myaccount.google.com → Seguridad → Tus conexiones.",
      );
    } finally {
      setBusy(null);
    }
  }

  const isBusy = busy !== null || connection.status === "connecting";

  return (
    <Card aria-labelledby="drive-title" as="section" className={styles.linkedFolderPanel} id="drive" tone="subtle">
      <div className={styles.linkedFolderHeader}>
        <div>
          <Tag>
            {connection.tokenReady ? "Conectado" : connection.authorized ? "Autorizado · sin sesión" : "Solo lectura"}
          </Tag>
          <h2 id="drive-title">Google Drive</h2>
          <p>
            Tus libros se leen donde están: Pliegue guarda la referencia y un índice, nunca una copia,
            y no puede cambiar ni borrar nada de tu Drive.
            {connection.email ? ` Cuenta: ${connection.email}.` : ""}
          </p>
        </div>
        <div className={styles.linkedFolderActions}>
          <Button disabled={isBusy} onClick={() => void pickFiles()}>
            {busy === "files" ? "Abriendo Drive…" : "Elegir archivos"}
          </Button>
          <Button disabled={isBusy} onClick={() => void linkFolder()} variant="secondary">
            {busy === "folder" ? "Abriendo Drive…" : "Vincular carpeta completa"}
          </Button>
          <span>
            {plural(drive.sources.length, "carpeta")} · {plural(drive.documents.length, "documento")}
          </span>
        </div>
      </div>

      {indexing ? (
        <div className={styles.capabilityNote} role="note">
          <strong>
            {indexing.paused === "auth"
              ? `La sesión con Google caducó: quedan ${plural(pending, "documento")} por indexar`
              : indexing.paused === "user"
                ? `Indexación en pausa: quedan ${plural(pending, "documento")}`
                : `Indexando ${indexing.processed} de ${indexing.total}`}
          </strong>
          {indexing.paused ? null : (
            <div
              aria-label="Progreso de la indexación de Drive"
              aria-valuemax={indexing.total}
              aria-valuemin={0}
              aria-valuenow={indexing.processed}
              className={styles.progressTrack}
              role="progressbar"
            >
              <span
                className={styles.progressValue}
                style={{ width: `${indexing.total ? Math.round((indexing.processed / indexing.total) * 100) : 0}%` }}
              />
            </div>
          )}
          <p>
            {indexing.paused === "auth"
              ? "El token de Google dura una hora y no se guarda: reconecta para seguir."
              : indexing.paused === "user"
                ? "Reanúdala cuando quieras; lo ya indexado se conserva."
                : `${indexing.current ? `«${indexing.current}». ` : ""}Cada archivo se descarga a esta pestaña para extraer su texto y su portada; los de más de 50 MB se quedan con los metadatos.${indexing.failed ? ` ${plural(indexing.failed, "archivo")} no se pudo indexar.` : ""}`}
          </p>
          <div className={styles.localImportActions}>
            {indexing.paused === "auth" ? (
              <Button disabled={isBusy} onClick={() => void reconnect()} size="sm">
                {busy === "connect" ? "Conectando…" : "Reconectar Drive"}
              </Button>
            ) : indexing.paused === "user" ? (
              <Button onClick={() => resumeDriveIndexing()} size="sm" variant="secondary">
                Reanudar
              </Button>
            ) : (
              <Button onClick={() => pauseDriveIndexing()} size="sm" variant="quiet">
                Pausar
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {drive.sources.length ? (
        <ul aria-label="Carpetas de Drive vinculadas" className={styles.folderSourceList}>
          {drive.sources.map((source) => (
            <li className={styles.folderSourceItem} key={source.id}>
              <div>
                <div className={styles.folderSourceTitle}>
                  <strong>{source.name}</strong>
                  <Tag>{source.driveId ? "Unidad compartida" : "Mi unidad"}</Tag>
                </div>
                <span className={styles.folderSourceMeta}>
                  {plural(source.fileCount, "documento")} · {formatLastScan(source.lastScannedAt)}
                  {(() => {
                    const shared = drive.documents.filter((document) => document.sourceId === source.id && alsoLocal(document.id)).length;
                    return shared ? ` · ${shared} también en local` : "";
                  })()}
                  {source.skippedFiles.length ? ` · ${plural(source.skippedFiles.length, "archivo")} que Pliegue no lee` : ""}
                </span>
              </div>
              <div className={styles.folderSourceControls}>
                <Button disabled={isBusy} onClick={() => void rescan(source)} size="sm" variant="secondary">
                  {busy === source.id ? "Revisando…" : "Buscar cambios"}
                </Button>
                <Button disabled={isBusy} onClick={() => void unlinkFolder(source)} size="sm" variant="quiet">
                  Desvincular
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {files.length ? (
        <ul aria-label="Archivos de Drive elegidos" className={styles.folderSourceList}>
          {files.map((file) => (
            <li className={styles.folderSourceItem} key={file.id}>
              <div>
                <div className={styles.folderSourceTitle}>
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <Tag>
                    {alsoLocal(file.id)
                      ? "También en local"
                      : file.indexStatus === "pending"
                        ? "Por indexar"
                        : file.format.toUpperCase()}
                  </Tag>
                </div>
                <span className={styles.folderSourceMeta}>
                  {file.sizeBytes ? formatFileSize(file.sizeBytes) : "Documento de Google"}
                </span>
              </div>
              <div className={styles.folderSourceControls}>
                <Link
                  className={buttonClassName({ size: "sm", variant: "quiet" })}
                  href={{ pathname: "/app/lector", query: { document: file.id } }}
                >
                  Abrir
                </Link>
                <Button disabled={isBusy} onClick={() => void removeFiles([file.id], `«${file.originalName}»`)} size="sm" variant="secondary">
                  Quitar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {!drive.documents.length ? (
        <div className={styles.capabilityNote} role="note">
          <strong>Dos formas de traer tus libros de Drive</strong>
          <p>
            <b>Elegir archivos</b>: marcas los libros en el selector de Google (puedes entrar en una
            carpeta y seleccionarlos todos). Pliegue solo ve esos archivos. <b>Vincular carpeta
            completa</b>: Pliegue sigue la carpeta y sus subcarpetas y detecta lo nuevo con «Buscar
            cambios»; para eso Google pide permiso de lectura de Drive.
          </p>
        </div>
      ) : null}

      <div className={styles.localImportActions}>
        {files.length > 1 ? (
          <Button disabled={isBusy} onClick={() => void removeFiles(files.map((file) => file.id), `los ${files.length} archivos elegidos`)} size="sm" variant="quiet">
            Quitar los archivos elegidos
          </Button>
        ) : null}
        {connection.authorized && !connection.tokenReady && !indexing?.paused ? (
          <Button disabled={isBusy} onClick={() => void reconnect()} size="sm" variant="secondary">
            {busy === "connect" ? "Conectando…" : "Reconectar Drive"}
          </Button>
        ) : null}
        {connection.authorized ? (
          <Button disabled={isBusy} onClick={() => void disconnect()} size="sm" variant="quiet">
            Desconectar Google Drive
          </Button>
        ) : null}
      </div>

      <p aria-live="polite" role="status">
        {drive.error ?? connection.error ?? status}
      </p>
    </Card>
  );
}
