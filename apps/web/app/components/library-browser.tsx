"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, Field, Input, Select, Tag, buttonClassName } from "@pliegue/ui";

import { analyzeDocumentCatalogs } from "../ai/catalog-analysis";
import { useAiSettings } from "../ai/ai-settings-store";
import { useAiSessionSecrets } from "../ai/ai-session-secret-store";
import {
  documentWorkTypes,
  type DocumentWorkType,
} from "../ai/document-catalog";
import {
  removeDocumentCatalogRecord,
  useDocumentCatalogs,
} from "../ai/document-catalog-store";
import {
  applyDocumentCatalogs,
  availabilityStates,
  catalogFacets,
  documentFormats,
  filterDocuments,
  type AvailabilityState,
  type DocumentFormat,
  type DocumentOrigin,
} from "../library/documents";
import { toggleFavorite, useFavorites } from "../library/favorite-store";
import {
  linkLocalFiles,
  unlinkLocalFile,
  useLinkedFiles,
} from "../library/local-file-reference-store";
import {
  downloadImportedCopy,
  importLocalFiles,
  reindexImportedDocuments,
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

const indexLabels = {
  error: "Índice no disponible",
  indexed: "Contenido indexado",
  "metadata-only": "Solo metadatos",
  pending: "Análisis pendiente",
} as const;

const catalogStatusLabels = {
  analyzed: "Catálogo IA listo",
  analyzing: "IA analizando",
  error: "Error de catálogo",
  "needs-content": "Requiere OCR",
} as const;

const workTypeLabels: Record<DocumentWorkType, string> = {
  article: "Artículo",
  book: "Libro",
  essay: "Ensayo",
  image: "Imagen",
  notes: "Notas",
  other: "Otro",
  presentation: "Presentación",
  report: "Informe",
  spreadsheet: "Hoja de cálculo",
  thesis: "Tesis",
};

function describeCatalogSummary(summary: Awaited<ReturnType<typeof analyzeDocumentCatalogs>>) {
  return [
    summary.analyzed ? `${summary.analyzed} catalogado${summary.analyzed === 1 ? "" : "s"}` : "",
    summary.needsContent ? `${summary.needsContent} requiere extracción` : "",
    summary.failed ? `${summary.failed} con error` : "",
    summary.skipped ? `${summary.skipped} ya estaba al día` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function describeFileLinkError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "No se seleccionó ningún archivo.";
  }

  if (error instanceof Error && error.message === "Este navegador no permite vincular archivos.") {
    return "Esta ventana no permite conservar referencias. Abre Pliegue en Chrome o Edge mediante HTTPS o localhost e inténtalo de nuevo.";
  }

  return "No fue posible guardar la referencia al archivo. Puedes volver a intentarlo.";
}

export function LibraryBrowser() {
  const [availability, setAvailability] = useState<AvailabilityState | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [format, setFormat] = useState<DocumentFormat | "all">("all");
  const [author, setAuthor] = useState<string | "all">("all");
  const [genre, setGenre] = useState<string | "all">("all");
  const [origin, setOrigin] = useState<DocumentOrigin | "all">("all");
  const [publicationYear, setPublicationYear] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [workType, setWorkType] = useState<DocumentWorkType | "all">("all");
  const [importing, setImporting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [linkingFiles, setLinkingFiles] = useState(false);
  const [importStatus, setImportStatus] = useState(
    "Vincula un archivo: guardaremos su referencia, metadatos e índice; no el original.",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const favorites = useFavorites();
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const catalogs = useDocumentCatalogs();
  const aiSettings = useAiSettings();
  const aiSecrets = useAiSessionSecrets();
  const [catalogMessage, setCatalogMessage] = useState(
    "El catálogo IA es opcional. Actívalo en Ajustes o analiza un documento bajo demanda.",
  );
  const baseDocuments = useMemo(
    () => [
      ...linkedFiles.documents,
      ...linkedFolders.documents,
      ...importedLibrary.documents,
    ],
    [importedLibrary.documents, linkedFiles.documents, linkedFolders.documents],
  );
  const allDocuments = useMemo(
    () => applyDocumentCatalogs(baseDocuments, catalogs.records),
    [baseDocuments, catalogs.records],
  );
  const favoriteIds = new Set(favorites);
  const facets = catalogFacets(allDocuments);
  const filteredDocuments = filterDocuments(allDocuments, {
    author,
    availability,
    favoriteIds,
    favoritesOnly,
    format,
    genre,
    origin,
    publicationYear,
    query,
    workType,
  });
  const storageError = importedLibrary.error ?? linkedFiles.error ?? linkedFolders.error;
  const providerReady =
    aiSettings.provider === "ollama" || Boolean(aiSecrets[aiSettings.provider]);
  const catalogedCount = allDocuments.filter(
    (document) => document.catalogStatus === "analyzed",
  ).length;

  useEffect(() => {
    if (
      !aiSettings.autoAnalyzeAfterLink ||
      !providerReady ||
      catalogs.status !== "ready" ||
      linkedFiles.status !== "ready" ||
      linkedFolders.status !== "ready" ||
      importedLibrary.status !== "ready" ||
      !baseDocuments.length
    ) {
      return;
    }

    let active = true;
    void analyzeDocumentCatalogs(baseDocuments, aiSettings)
      .then((summary) => {
        if (active) setCatalogMessage(describeCatalogSummary(summary) || "El catálogo está al día.");
      })
      .catch((error: unknown) => {
        if (active) {
          setCatalogMessage(
            error instanceof Error ? error.message : "No fue posible iniciar el catálogo automático.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [
    aiSettings,
    baseDocuments,
    catalogs.status,
    importedLibrary.status,
    linkedFiles.status,
    linkedFolders.status,
    providerReady,
  ]);

  async function handleLinkedFiles() {
    setLinkingFiles(true);
    setImportStatus("Leyendo metadatos y creando el índice derivado…");

    try {
      const result = await linkLocalFiles();
      const parts = [
        result.linked ? `${result.linked} vinculado${result.linked === 1 ? "" : "s"}` : "",
        result.updated ? `${result.updated} actualizado${result.updated === 1 ? "" : "s"}` : "",
        result.rejected.length
          ? `${result.rejected.length} rechazado${result.rejected.length === 1 ? "" : "s"}`
          : "",
      ].filter(Boolean);
      setImportStatus(parts.length ? `${parts.join(" · ")}.` : "No se vinculó ningún archivo.");
    } catch (error) {
      setImportStatus(describeFileLinkError(error));
    } finally {
      setLinkingFiles(false);
    }
  }

  async function handleReindex() {
    setReindexing(true);
    setImportStatus("Rehaciendo el índice local de las copias importadas…");

    try {
      const result = await reindexImportedDocuments();

      if (!result.reviewed) {
        setImportStatus("El índice local de las copias ya está al día.");
        return;
      }

      const failed = result.failed ? ` · ${result.failed} con error` : "";
      setImportStatus(
        `${result.indexed} de ${result.reviewed} copia${result.reviewed === 1 ? "" : "s"} con texto disponible${failed}. Ya puedes catalogarlas con IA.`,
      );
    } catch {
      setImportStatus("No fue posible rehacer el índice local.");
    } finally {
      setReindexing(false);
    }
  }

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
      await removeDocumentCatalogRecord(documentId).catch(() => undefined);
      clearReadingProgress(documentId);
      setImportStatus("La copia local se eliminó. El archivo original no fue modificado.");
    } catch {
      setImportStatus("No fue posible eliminar la copia local.");
    }
  }

  async function removeFileReference(documentId: string, title: string) {
    const confirmed = window.confirm(
      `¿Quitar la referencia a «${title}»? El archivo original no se eliminará ni modificará.`,
    );
    if (!confirmed) return;

    try {
      await unlinkLocalFile(documentId);
      await removeDocumentCatalogRecord(documentId).catch(() => undefined);
      clearReadingProgress(documentId);
      setImportStatus("La referencia se eliminó. El archivo original permanece intacto.");
    } catch {
      setImportStatus("No fue posible eliminar la referencia local.");
    }
  }

  async function analyzeOneDocument(documentId: string) {
    const document = baseDocuments.find((candidate) => candidate.id === documentId);
    if (!document) return;
    setCatalogMessage(`Analizando «${document.title}»…`);

    try {
      const summary = await analyzeDocumentCatalogs([document], aiSettings, {
        force: true,
        retryErrors: true,
      });
      setCatalogMessage(describeCatalogSummary(summary) || "El documento ya estaba al día.");
    } catch (error) {
      setCatalogMessage(
        error instanceof Error ? error.message : "No fue posible analizar el documento.",
      );
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
          <Tag>Referencia local · sin copia</Tag>
          <h2 id="local-import-title">Vincula archivos y conserva el original en su carpeta</h2>
          <p>
            Pliegue guarda un permiso seguro, metadatos y un índice textual limitado. El
            archivo completo permanece en su ubicación y se vuelve a leer solo cuando lo
            abres.
          </p>
        </div>
        <div className={styles.localImportActions}>
          <Button
            aria-describedby="linked-files-status"
            disabled={linkingFiles}
            onClick={() => void handleLinkedFiles()}
          >
            {linkingFiles ? "Vinculando y analizando…" : "Vincular archivos"}
          </Button>
          <Button
            disabled={importing || importedLibrary.status === "error"}
            onClick={() => fileInputRef.current?.click()}
            variant="quiet"
          >
            {importing ? "Importando copia…" : "Importar copia · compatibilidad"}
          </Button>
          <Button
            disabled={reindexing || !importedLibrary.documents.length}
            onClick={() => void handleReindex()}
            variant="quiet"
          >
            {reindexing ? "Rehaciendo índice…" : "Actualizar índice local"}
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
          <span>
            {linkedFiles.documents.length} referencias · {importedLibrary.documents.length} copias
          </span>
        </div>
        {linkedFiles.supported === false ? (
          <div className={styles.capabilityNote} role="note">
            <strong>La vinculación persistente no está disponible en esta ventana.</strong>
            <p>
              El botón sigue activo para que puedas reintentar. Abre Pliegue mediante HTTPS
              o localhost en Chrome o Edge; nunca crearemos una copia automáticamente.
            </p>
          </div>
        ) : null}
        <p
          aria-label="Estado de vinculación o importación"
          aria-live="polite"
          id="linked-files-status"
          role="status"
        >
          {importedLibrary.error ?? importStatus}
        </p>
      </Card>

      <LocalSourcesPanel />

      <Card
        aria-labelledby="drive-reference-title"
        as="section"
        className={styles.driveReferencePanel}
        tone="subtle"
      >
        <div>
          <Tag>Google Drive · referencia remota</Tag>
          <h2 id="drive-reference-title">Conecta Drive sin duplicar sus archivos</h2>
          <p>
            La capa documental ya contempla <code>fileId</code> y <code>driveId</code>. La
            autorización OAuth y la renovación segura del acceso siguen pendientes antes de
            habilitar esta fuente.
          </p>
        </div>
        <div className={styles.driveReferenceActions}>
          <Button disabled variant="quiet">
            Conectar Google Drive
          </Button>
          <span>OAuth pendiente · Foundry 03.1</span>
        </div>
      </Card>

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

      <fieldset className={styles.catalogFilters}>
        <legend>Filtros del catálogo inteligente</legend>
        <Field label="Tipo de obra" labelFor="library-work-type">
          <Select
            id="library-work-type"
            onChange={(event) => setWorkType(event.target.value as DocumentWorkType | "all")}
            value={workType}
          >
            <option value="all">Todos los tipos</option>
            {documentWorkTypes.map((item) => (
              <option key={item} value={item}>
                {workTypeLabels[item]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Autor" labelFor="library-author">
          <Select
            id="library-author"
            onChange={(event) => setAuthor(event.target.value)}
            value={author}
          >
            <option value="all">Todos los autores</option>
            {facets.authors.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Género" labelFor="library-genre">
          <Select
            id="library-genre"
            onChange={(event) => setGenre(event.target.value)}
            value={genre}
          >
            <option value="all">Todos los géneros</option>
            {facets.genres.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Año de publicación" labelFor="library-year">
          <Select
            id="library-year"
            onChange={(event) =>
              setPublicationYear(event.target.value === "all" ? "all" : Number(event.target.value))
            }
            value={publicationYear}
          >
            <option value="all">Cualquier año</option>
            {facets.publicationYears.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.catalogFilterStatus}>
          <Tag>IA · {catalogedCount}/{allDocuments.length}</Tag>
          <Link href="/app/ajustes">Configurar proveedor</Link>
        </div>
      </fieldset>

      <p aria-live="polite" className={styles.catalogMessage} role="status">
        {catalogs.error ?? catalogMessage}
      </p>

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
      ) : importedLibrary.status !== "ready" ||
        linkedFiles.status !== "ready" ||
        linkedFolders.status !== "ready" ? (
        <Card as="section" className={styles.emptyState} tone="subtle">
          <Tag>Preparando</Tag>
          <h2>Recuperando la Biblioteca local…</h2>
          <p>Leemos las copias y permisos guardados en este navegador.</p>
        </Card>
      ) : filteredDocuments.length ? (
        <section aria-label="Documentos de la biblioteca" className={styles.documentGrid}>
          {filteredDocuments.map((document) => {
            const isFavorite = favoriteIds.has(document.id);
            const isCopy = document.reference.kind === "local-copy";
            const isFileReference = document.reference.kind === "local-file";

            return (
              <DocumentCard
                eyebrow={`${document.format.toUpperCase()} · ${originLabels[document.origin]}`}
                key={document.id}
                title={document.catalog?.canonicalTitle ?? document.title}
              >
                <p>
                  {document.catalog?.authors.length
                    ? document.catalog.authors.join(", ")
                    : document.author}
                </p>
                <p>{document.meta}</p>
                {document.catalog?.summary ? (
                  <p className={styles.catalogSummary}>{document.catalog.summary}</p>
                ) : null}
                {document.catalog ? (
                  <div className={styles.catalogMetadata}>
                    <Tag>{workTypeLabels[document.catalog.workType]}</Tag>
                    {document.catalog.publicationYear ? (
                      <Tag>{document.catalog.publicationYear}</Tag>
                    ) : null}
                    {document.catalog.genres.slice(0, 2).map((item) => (
                      <Tag key={item}>{item}</Tag>
                    ))}
                    {document.catalog.language ? <Tag>{document.catalog.language}</Tag> : null}
                  </div>
                ) : null}
                <div className={styles.documentMeta}>
                  <Tag>{availabilityLabels[document.availability]}</Tag>
                  {document.indexStatus ? <Tag>{indexLabels[document.indexStatus]}</Tag> : null}
                  {document.catalogStatus ? (
                    <Tag>{catalogStatusLabels[document.catalogStatus]}</Tag>
                  ) : null}
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
                    {document.indexStatus === "indexed" ? (
                      <Button
                        disabled={!providerReady || document.catalogStatus === "analyzing"}
                        onClick={() => void analyzeOneDocument(document.id)}
                        size="sm"
                        variant="quiet"
                      >
                        {document.catalogStatus === "analyzing"
                          ? "Analizando…"
                          : document.catalogStatus === "analyzed"
                            ? "Actualizar catálogo"
                            : "Analizar con IA"}
                      </Button>
                    ) : null}
                    {isCopy ? (
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
                      <>
                        <Link
                          className={buttonClassName({ size: "sm", variant: "secondary" })}
                          href={{ pathname: "/app/lector", query: { document: document.id } }}
                        >
                          Ver en lector
                        </Link>
                        {isFileReference ? (
                          <Button
                            onClick={() => void removeFileReference(document.id, document.title)}
                            size="sm"
                            variant="quiet"
                          >
                            Quitar referencia
                          </Button>
                        ) : null}
                      </>
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
            No hay datos de demostración. Vincula un archivo o una carpeta compatible para
            conservar los originales en su ubicación. La copia queda disponible solo como
            alternativa de compatibilidad.
          </p>
          <Button
            aria-describedby="linked-files-status"
            disabled={linkingFiles}
            onClick={() => void handleLinkedFiles()}
          >
            {linkingFiles ? "Vinculando y analizando…" : "Vincular un archivo"}
          </Button>
        </Card>
      )}
    </>
  );
}
