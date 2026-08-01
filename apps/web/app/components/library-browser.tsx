"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Button, Card, Field, Input, Select, Tag, buttonClassName } from "@pliegue/ui";

import {
  availabilityStates,
  documentFormats,
  filterDocuments,
  type AvailabilityState,
  type DocumentFormat,
  type DocumentOrigin,
} from "../library/documents";
import { toggleFavorite, useFavorites } from "../library/favorite-store";
import {
  downloadImportedCopy,
  importLocalFiles,
  removeImportedCopy,
  useImportedDocuments,
} from "../library/local-library-store";
import { useLinkedFolders } from "../library/local-folder-store";
import { clearReadingProgress } from "../library/reading-progress-store";
import { DocumentCard } from "./workspace-page";
import { LocalSourcesPanel } from "./local-sources-panel";
import styles from "../(workspace)/app/workspace.module.css";

const availabilityLabels: Record<AvailabilityState, string> = {
  available: "Disponible",
  disconnected: "Desconectado",
  offline: "Sin conexión",
};

const originLabels: Record<DocumentOrigin, string> = {
  drive: "Drive",
  local: "Local",
};

export function LibraryBrowser() {
  const [availability, setAvailability] = useState<AvailabilityState | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [format, setFormat] = useState<DocumentFormat | "all">("all");
  const [origin, setOrigin] = useState<DocumentOrigin | "all">("all");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState(
    "Selecciona copias de hasta 50 MB; no se enviarán fuera de este dispositivo.",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const favorites = useFavorites();
  const importedLibrary = useImportedDocuments();
  const linkedFolders = useLinkedFolders();
  const allDocuments = [...importedLibrary.documents, ...linkedFolders.documents];
  const favoriteIds = new Set(favorites);
  const filteredDocuments = filterDocuments(allDocuments, {
    availability,
    favoriteIds,
    favoritesOnly,
    format,
    origin,
    query,
  });
  const storageError = importedLibrary.error ?? linkedFolders.error;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;

    setImporting(true);

    try {
      const result = await importLocalFiles(Array.from(files));
      const parts = [
        result.imported ? `${result.imported} importado${result.imported === 1 ? "" : "s"}` : "",
        result.duplicates
          ? `${result.duplicates} duplicado${result.duplicates === 1 ? "" : "s"}`
          : "",
        result.rejected.length
          ? `${result.rejected.length} rechazado${result.rejected.length === 1 ? "" : "s"}`
          : "",
      ].filter(Boolean);

      setImportStatus(
        parts.length ? `${parts.join(" · ")}.` : "No se seleccionaron archivos compatibles.",
      );
    } catch {
      setImportStatus("No fue posible guardar las copias en este navegador.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadCopy(documentId: string) {
    try {
      await downloadImportedCopy(documentId);
      setImportStatus("La copia local se preparó para descargar.");
    } catch {
      setImportStatus("La copia local ya no está disponible.");
    }
  }

  async function removeCopy(documentId: string, title: string) {
    const confirmed = window.confirm(
      `¿Eliminar la copia local de «${title}»? Esta acción no afecta al archivo original.`,
    );
    if (!confirmed) return;

    try {
      await removeImportedCopy(documentId);
      clearReadingProgress(documentId);
      setImportStatus("La copia local se eliminó. El archivo original no fue modificado.");
    } catch {
      setImportStatus("No fue posible eliminar la copia local.");
    }
  }

  return (
    <>
      <Card
        aria-labelledby="local-import-title"
        as="section"
        className={styles.localImportPanel}
        id="importar-archivos"
        tone="subtle"
      >
        <div>
          <Tag>Local-only · importar copia</Tag>
          <h2 id="local-import-title">Añade documentos sin crear una cuenta</h2>
          <p>
            “Importar” guarda una copia privada en IndexedDB. Si prefieres conservar el
            original fuera de Pliegue, vincula una carpeta compatible en el siguiente bloque.
          </p>
        </div>
        <div className={styles.localImportActions}>
          <Button
            disabled={importing || importedLibrary.status === "error"}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? "Importando…" : "Importar archivos"}
          </Button>
          <input
            accept=".pdf,.epub,.docx,.pptx,.xlsx,.txt,.md,.png,.jpg,.jpeg"
            aria-label="Seleccionar archivos para importar"
            className={styles.fileInput}
            multiple
            onChange={(event) => void handleFiles(event.target.files)}
            ref={fileInputRef}
            type="file"
          />
          <span>{importedLibrary.documents.length} copias locales</span>
        </div>
        <p aria-label="Estado de importación" aria-live="polite" role="status">
          {importedLibrary.error ?? importStatus}
        </p>
      </Card>

      <LocalSourcesPanel />

      <form className={styles.toolbar} onSubmit={(event) => event.preventDefault()} role="search">
        <Field
          className={styles.librarySearch}
          label="Buscar en la biblioteca"
          labelFor="library-search"
        >
          <Input
            id="library-search"
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Título, autor o concepto…"
            type="search"
            value={query}
          />
        </Field>
        <Field label="Origen" labelFor="library-origin">
          <Select
            id="library-origin"
            onChange={(event) => setOrigin(event.target.value as DocumentOrigin | "all")}
            value={origin}
          >
            <option value="all">Todo el espacio</option>
            <option disabled value="drive">
              Google Drive · aún no conectado
            </option>
            <option value="local">Archivos locales</option>
          </Select>
        </Field>
        <Field label="Formato" labelFor="library-format">
          <Select
            id="library-format"
            onChange={(event) => setFormat(event.target.value as DocumentFormat | "all")}
            value={format}
          >
            <option value="all">Todos</option>
            {documentFormats.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Disponibilidad" labelFor="library-availability">
          <Select
            id="library-availability"
            onChange={(event) =>
              setAvailability(event.target.value as AvailabilityState | "all")
            }
            value={availability}
          >
            <option value="all">Cualquier estado</option>
            {availabilityStates.map((item) => (
              <option key={item} value={item}>
                {availabilityLabels[item]}
              </option>
            ))}
          </Select>
        </Field>
        <label className={styles.favoriteFilter}>
          <input
            checked={favoritesOnly}
            onChange={(event) => setFavoritesOnly(event.target.checked)}
            type="checkbox"
          />
          Solo favoritos
        </label>
      </form>

      <div
        aria-label="Cantidad de documentos filtrados"
        aria-live="polite"
        className={styles.filterSummary}
        role="status"
      >
        {filteredDocuments.length} de {allDocuments.length} documentos
      </div>

      {storageError ? (
        <Card as="section" className={styles.emptyState} role="alert" tone="subtle">
          <Tag>Almacenamiento no disponible</Tag>
          <h2>No pudimos abrir la Biblioteca local</h2>
          <p>{storageError}</p>
        </Card>
      ) : importedLibrary.status !== "ready" || linkedFolders.status !== "ready" ? (
        <Card as="section" className={styles.emptyState} tone="subtle">
          <Tag>Preparando</Tag>
          <h2>Recuperando la Biblioteca local…</h2>
          <p>Leemos las copias y permisos guardados en este navegador.</p>
        </Card>
      ) : filteredDocuments.length ? (
        <section aria-label="Documentos de la biblioteca" className={styles.documentGrid}>
          {filteredDocuments.map((document) => {
            const isFavorite = favoriteIds.has(document.id);

            return (
              <DocumentCard
                eyebrow={`${document.format.toUpperCase()} · ${originLabels[document.origin]}`}
                key={document.id}
                title={document.title}
              >
                <p>{document.author}</p>
                <p>{document.meta}</p>
                <div className={styles.documentMeta}>
                  <Tag>{availabilityLabels[document.availability]}</Tag>
                  <div className={styles.documentActions}>
                    <Button
                      aria-label={
                        isFavorite
                          ? `Quitar ${document.title} de favoritos`
                          : `Guardar ${document.title} en favoritos`
                      }
                      aria-pressed={isFavorite}
                      onClick={() => toggleFavorite(document.id)}
                      size="sm"
                      variant="quiet"
                    >
                      {isFavorite ? "★ Favorito" : "☆ Guardar"}
                    </Button>
                    {document.imported ? (
                      <>
                        <Link
                          className={buttonClassName({ size: "sm", variant: "secondary" })}
                          href={{ pathname: "/app/lector", query: { document: document.id } }}
                        >
                          Leer
                        </Link>
                        <Button
                          onClick={() => void downloadCopy(document.id)}
                          size="sm"
                          variant="secondary"
                        >
                          Descargar copia
                        </Button>
                        <Button
                          onClick={() => void removeCopy(document.id, document.title)}
                          size="sm"
                          variant="quiet"
                        >
                          Eliminar copia
                        </Button>
                      </>
                    ) : document.linked ? (
                      <Link
                        className={buttonClassName({ size: "sm", variant: "secondary" })}
                        href={{ pathname: "/app/lector", query: { document: document.id } }}
                      >
                        Ver en lector
                      </Link>
                    ) : null}
                  </div>
                </div>
              </DocumentCard>
            );
          })}
        </section>
      ) : allDocuments.length ? (
        <Card as="section" className={styles.emptyState} tone="subtle">
          <Tag>Sin resultados</Tag>
          <h2>No encontramos documentos con esos filtros</h2>
          <p>Prueba otro término o amplía el origen, formato y disponibilidad.</p>
        </Card>
      ) : (
        <Card as="section" className={styles.onboardingCard} tone="subtle">
          <Tag>Biblioteca vacía</Tag>
          <h2>Añade tu primer documento real</h2>
          <p>
            No hay datos de demostración. Importa una copia para probar todos los
            navegadores o vincula una carpeta compatible para mantener los archivos en su
            ubicación original.
          </p>
          <Button onClick={() => fileInputRef.current?.click()}>Importar un archivo</Button>
        </Card>
      )}
    </>
  );
}
