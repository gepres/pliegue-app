"use client";

import { useState } from "react";

import { Button } from "@pliegue/ui";

import type { LibraryDocument } from "../library/documents";
import { linkLocalFiles } from "../library/local-file-reference-store";
import { scanLinkedFolder } from "../library/local-folder-store";
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
        // extraer el texto, y solaparlos deja la pestaña sin respuesta.
        for (const sourceId of sourceIds) await scanLinkedFolder(sourceId, false);
        setMessage("Carpetas reescaneadas.");
      }
    } catch (error) {
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "No se seleccionó ningún archivo."
          : "No fue posible rehacer el índice. Puedes volver a intentarlo.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.capabilityNote} role="note">
      <strong>
        {report.total} documento{report.total === 1 ? "" : "s"} con el índice de una versión
        anterior del extractor.
      </strong>
      <p>
        No les falta texto porque sean escaneos: su índice se creó antes de que Pliegue supiera
        leer este formato y no se rehace solo. Hasta que lo hagas siguen sin ser buscables por
        contenido y el catálogo IA los cuenta como pendientes de extracción.
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
              ? busyLabels[group.action]
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
