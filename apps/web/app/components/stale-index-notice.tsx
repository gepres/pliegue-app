"use client";

import { useState } from "react";

import { Button } from "@pliegue/ui";

import type { LibraryDocument } from "../library/documents";
import { linkLocalFiles } from "../library/local-file-reference-store";
import { scanLinkedFolder, type FolderIndexProgress } from "../library/local-folder-store";
import { reindexImportedDocuments } from "../library/local-library-store";
import { findStaleIndexes, type StaleIndexAction } from "../library/stale-index";
import styles from "../(workspace)/app/workspace.module.css";

const actionLabels: Record<StaleIndexAction, string> = {
  "reindex-copy": "Actualizar índice local",
  "relink-file": "Volver a vincular",
  "rescan-folder": "Buscar cambios",
};

const busyLabels: Record<StaleIndexAction, string> = {
  "reindex-copy": "Rehaciendo índice…",
  "relink-file": "Abriendo selector…",
  "rescan-folder": "Comparando y analizando…",
};

function describeGroup(action: StaleIndexAction, count: number) {
  const documents = `${count} documento${count === 1 ? "" : "s"}`;

  switch (action) {
    case "reindex-copy":
      return `${documents} en copias importadas. El binario ya está guardado, así que no se pedirá nada.`;
    case "relink-file":
      return `${documents} vinculados de uno en uno. El navegador pedirá seleccionarlos otra vez para leerlos.`;
    default:
      return `${documents} en carpetas vinculadas.`;
  }
}

export function StaleIndexNotice({ documents }: { documents: readonly LibraryDocument[] }) {
  const report = findStaleIndexes(documents);
  const [busy, setBusy] = useState<StaleIndexAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<FolderIndexProgress | null>(null);

  // El aviso solo existe mientras haya algo desactualizado. Los almacenes que ejecutan cada
  // acción vuelven a publicar sus documentos al terminar, así que desaparece sin recargar.
  if (!report.total) return null;

  async function run(action: StaleIndexAction, sourceIds: readonly string[]) {
    setBusy(action);
    setMessage(null);

    try {
      if (action === "reindex-copy") {
        const result = await reindexImportedDocuments();
        setMessage(`${result.indexed} de ${result.reviewed} copias con texto disponible.`);
      } else if (action === "relink-file") {
        const result = await linkLocalFiles();
        setMessage(`${result.updated} referencia${result.updated === 1 ? "" : "s"} actualizada${result.updated === 1 ? "" : "s"}.`);
      } else {
        // En secuencia y no en paralelo: cada escaneo abre los archivos de su carpeta para
        // extraer el texto, y solaparlos deja la pestaña sin respuesta. El clic sirve de gesto
        // para pedir el permiso de lectura: sin pedirlo, una carpeta sin acceso concedido se
        // quedaba igual y el aviso decía de todos modos que se había reescaneado.
        let scanned = 0;
        let withoutAccess = 0;
        for (const sourceId of sourceIds) {
          const result = await scanLinkedFolder(sourceId, true, setProgress);
          if (result.permission === "granted") scanned += 1;
          else withoutAccess += 1;
        }
        setMessage(
          withoutAccess
            ? `${scanned} carpeta${scanned === 1 ? "" : "s"} al día y ${withoutAccess} sin permiso de lectura: concédelo cuando el navegador lo pida o desde Fuentes.`
            : "Carpetas al día: portadas, idioma y texto rehechos.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "No se seleccionó ningún archivo."
          : "No fue posible rehacer el índice. Puedes volver a intentarlo.",
      );
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  return (
    <div className={styles.capabilityNote} role="note">
      <strong>
        {report.total} documento{report.total === 1 ? "" : "s"} con el índice de una versión
        anterior del extractor.
      </strong>
      <p>
        Al rehacerlo, cada documento recibe lo que Pliegue aprendió después: la portada sacada
        del propio archivo, el idioma detectado en su texto y, en los formatos que antes no sabía
        leer, el texto para buscar por contenido. No se rehace solo porque hay que abrir cada
        archivo otra vez.
      </p>
      <div className={styles.localImportActions}>
        {report.groups.map((group) => (
          <Button
            disabled={busy !== null}
            key={group.action}
            onClick={() => void run(group.action, group.sourceIds)}
            size="sm"
            variant="secondary"
          >
            {busy === group.action
              ? group.action === "rescan-folder" && progress
                ? `Rehaciendo ${progress.processed} de ${progress.total}…`
                : busyLabels[group.action]
              : `${actionLabels[group.action]} · ${group.count}`}
          </Button>
        ))}
      </div>
      <ul>
        {report.groups.map((group) => (
          <li key={group.action}>{describeGroup(group.action, group.count)}</li>
        ))}
      </ul>
      <p aria-live="polite" role="status">
        {message}
      </p>
    </div>
  );
}
