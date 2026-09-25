"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, Field, Select, Tag, buttonClassName, cx } from "@pliegue/ui";

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
import { applyImportedCatalogs } from "../library/catalog-import";
import { useImportedCatalogs } from "../library/imported-catalog-store";
import {
  applyDocumentCatalogs,
  availabilityStates,
  catalogFacets,
  documentFormats,
  filterDocuments,
  type AvailabilityState,
  type DocumentFormat,
  type DocumentOrigin,
  type LibraryDocument,
} from "../library/documents";
import { hasStaleIndex } from "../library/stale-index";
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
import { CatalogImportPanel } from "./catalog-import-panel";
import { Disclosure, Segmented, Toast } from "./app-ui/controls";
import { Icon } from "./app-ui/icons";
import { MenuItem, MenuSeparator, Popover, Sheet } from "./app-ui/overlays";
import {
  LibraryDocumentTile,
  workTypeLabels,
  type LibraryView,
} from "./library/library-document-tile";
import libraryStyles from "./library/library.module.css";
import { LocalSourcesPanel } from "./local-sources-panel";
import { StaleIndexNotice } from "./stale-index-notice";
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

/**
 * «Requiere OCR» y «Índice desactualizado» se veían igual y llevan a sitios distintos: el
 * primero espera al OCR de 03.5 y el segundo se arregla reindexando en un minuto.
 */
function describeCatalogStatus(document: LibraryDocument) {
  if (document.catalogStatus === "needs-content" && hasStaleIndex(document)) {
    return "Índice desactualizado";
  }
  return document.catalogStatus ? catalogStatusLabels[document.catalogStatus] : null;
}


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
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [view, setViewState] = useState<LibraryView>("grid");
  const [toast, setToast] = useState<{ nonce: number; text: string } | null>(null);
  const [importStatus, setImportStatusState] = useState(
    "Vincula un archivo: guardaremos su referencia, metadatos e índice; no el original.",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const favorites = useFavorites();
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const catalogs = useDocumentCatalogs();
  const importedCatalogs = useImportedCatalogs();
  const aiSettings = useAiSettings();
  const aiSecrets = useAiSessionSecrets();
  const [catalogMessage, setCatalogMessageState] = useState(
    "El catálogo IA es opcional. Actívalo en Ajustes o analiza un documento bajo demanda.",
  );

  // El resultado de cada acción se anuncia como aviso efímero, y además queda escrito en la
  // hoja de Fuentes para quien quiera volver a leerlo.
  const notify = (text: string) =>
    setToast((current) => ({ nonce: (current?.nonce ?? 0) + 1, text }));
  const setImportStatus = (text: string) => {
    setImportStatusState(text);
    notify(text);
  };
  const setCatalogMessage = (text: string) => {
    setCatalogMessageState(text);
    notify(text);
  };

  // La vista elegida se recuerda en este navegador; se lee tras montar para que el HTML del
  // servidor y el primer render del cliente coincidan.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem("pliegue-library-view");
        if (stored === "list" || stored === "grid") setViewState(stored);
      } catch {
        // Sin almacenamiento, la vista vuelve a cuadrícula en cada visita.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function setView(next: LibraryView) {
    setViewState(next);
    try {
      window.localStorage.setItem("pliegue-library-view", next);
    } catch {
      // Ídem: la elección dura lo que la página.
    }
  }
  const baseDocuments = useMemo(
    () => [
      ...linkedFiles.documents,
      ...linkedFolders.documents,
      ...importedLibrary.documents,
    ],
    [importedLibrary.documents, linkedFiles.documents, linkedFolders.documents],
  );
  // El orden importa: la ficha importada se aplica después para que prevalezca sobre la que
  // dedujo el modelo, que es lo que espera quien acaba de corregirla a mano.
  const allDocuments = useMemo(
    () =>
      applyImportedCatalogs(
        applyDocumentCatalogs(baseDocuments, catalogs.records),
        importedCatalogs.records,
      ),
    [baseDocuments, catalogs.records, importedCatalogs.records],
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
        if (active) {
          setCatalogMessageState(describeCatalogSummary(summary) || "El catálogo está al día.");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCatalogMessageState(
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

  const activeFilters = [
    origin !== "all" ? { key: "origin", label: `Origen: ${originLabels[origin]}`, clear: () => setOrigin("all") } : null,
    format !== "all" ? { key: "format", label: `Formato: ${format.toUpperCase()}`, clear: () => setFormat("all") } : null,
    availability !== "all"
      ? { key: "availability", label: availabilityLabels[availability], clear: () => setAvailability("all") }
      : null,
    workType !== "all" ? { key: "workType", label: workTypeLabels[workType], clear: () => setWorkType("all") } : null,
    author !== "all" ? { key: "author", label: author, clear: () => setAuthor("all") } : null,
    genre !== "all" ? { key: "genre", label: genre, clear: () => setGenre("all") } : null,
    publicationYear !== "all"
      ? { key: "year", label: String(publicationYear), clear: () => setPublicationYear("all") }
      : null,
  ].filter((item): item is { clear: () => void; key: string; label: string } => item !== null);

  function clearFilters() {
    setOrigin("all");
    setFormat("all");
    setAvailability("all");
    setWorkType("all");
    setAuthor("all");
    setGenre("all");
    setPublicationYear("all");
    setFavoritesOnly(false);
  }

  const libraryLoading =
    importedLibrary.status !== "ready" ||
    linkedFiles.status !== "ready" ||
    linkedFolders.status !== "ready";

  return (
    <>
      {/* ---- Cabecera: título grande de app y las dos acciones que cuentan ---- */}
      <header className={libraryStyles.header}>
        <div>
          <h1>Biblioteca</h1>
          <p>
            {allDocuments.length} documento{allDocuments.length === 1 ? "" : "s"} ·{" "}
            {linkedFiles.documents.length + linkedFolders.documents.length} vinculados ·{" "}
            {importedLibrary.documents.length} copias
          </p>
        </div>
        <div className={libraryStyles.headerActions}>
          <button
            aria-label="Fuentes"
            className={cx(buttonClassName({ variant: "secondary" }), libraryStyles.sourcesButton)}
            onClick={() => setSourcesOpen(true)}
            type="button"
          >
            <Icon name="folder" size={18} />
            <span>Fuentes</span>
          </button>
          <Popover
            kind="menu"
            title="Añadir a la Biblioteca"
            trigger={(props) => (
              <button {...props} className={buttonClassName()} type="button">
                <Icon name="plus" size={18} />
                <span>Añadir</span>
              </button>
            )}
            width={300}
          >
            {(close) => (
              <>
                <MenuItem
                  description="Guarda la referencia; el original se queda en su carpeta"
                  disabled={linkingFiles}
                  icon="link"
                  label={linkingFiles ? "Vinculando…" : "Vincular archivos"}
                  onSelect={() => {
                    close();
                    void handleLinkedFiles();
                  }}
                />
                <MenuItem
                  description="Sigue una carpeta y detecta cambios"
                  icon="folder"
                  label="Vincular carpeta…"
                  onSelect={() => {
                    close();
                    setSourcesOpen(true);
                  }}
                />
                <MenuItem
                  description="Copia dentro del navegador, para navegadores sin vínculo"
                  disabled={importing || importedLibrary.status === "error"}
                  icon="download"
                  label={importing ? "Importando…" : "Importar copia"}
                  onSelect={() => {
                    close();
                    fileInputRef.current?.click();
                  }}
                />
                <MenuSeparator />
                <MenuItem
                  description="Fichas desde una plantilla, Zotero o Dublin Core"
                  icon="database"
                  label="Importar índice JSON…"
                  onSelect={() => {
                    close();
                    setSourcesOpen(true);
                  }}
                />
                <MenuItem
                  disabled={reindexing || !importedLibrary.documents.length}
                  icon="refresh"
                  label={reindexing ? "Rehaciendo índice…" : "Actualizar índice local"}
                  onSelect={() => {
                    close();
                    void handleReindex();
                  }}
                />
              </>
            )}
          </Popover>
          <input
            accept=".pdf,.epub,.docx,.pptx,.xlsx,.txt,.md,.png,.jpg,.jpeg"
            aria-label="Seleccionar archivos para importar"
            className={styles.fileInput}
            multiple
            onChange={(event) => void handleFiles(event.target.files)}
            ref={fileInputRef}
            type="file"
          />
        </div>
      </header>

      <StaleIndexNotice documents={allDocuments} />

      {linkedFiles.supported === false ? (
        <div className={styles.capabilityNote} role="note">
          <strong>La vinculación persistente no está disponible en esta ventana.</strong>
          <p>
            Abre Pliegue mediante HTTPS o localhost en Chrome o Edge; nunca crearemos una copia
            automáticamente.
          </p>
        </div>
      ) : null}

      {/* ---- Barra de búsqueda: buscar, filtrar y cambiar de vista ------------ */}
      <form
        className={libraryStyles.commandBar}
        onSubmit={(event) => event.preventDefault()}
        role="search"
      >
        <label className={libraryStyles.search}>
          <Icon name="search" size={18} />
          <span className={libraryStyles.visuallyHidden}>Buscar en la biblioteca</span>
          <input
            id="library-search"
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por título, autor o concepto"
            type="search"
            value={query}
          />
        </label>

        <Popover
          align="end"
          title="Filtros"
          trigger={(props) => (
            <button
              {...props}
              aria-label={
                activeFilters.length ? `Filtros, ${activeFilters.length} activos` : "Filtros"
              }
              className={cx(buttonClassName({ variant: "secondary" }), libraryStyles.filterButton)}
              type="button"
            >
              <Icon name="filter" size={18} />
              <span>Filtros</span>
              {activeFilters.length ? (
                <span className={libraryStyles.filterCount}>{activeFilters.length}</span>
              ) : null}
            </button>
          )}
          width={520}
        >
          <div className={libraryStyles.filterPanel}>
            <div className={libraryStyles.filterGroup}>
              <span className={libraryStyles.filterGroupLabel}>Archivo</span>
              <div className={libraryStyles.filterGrid}>
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
              </div>
            </div>

            <div className={libraryStyles.filterGroup}>
              <span className={libraryStyles.filterGroupLabel}>
                Catálogo inteligente · {catalogedCount}/{allDocuments.length} con ficha
              </span>
              <div className={libraryStyles.filterGrid}>
                <Field label="Tipo de obra" labelFor="library-work-type">
                  <Select
                    id="library-work-type"
                    onChange={(event) =>
                      setWorkType(event.target.value as DocumentWorkType | "all")
                    }
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
                <Field label="Año" labelFor="library-year">
                  <Select
                    id="library-year"
                    onChange={(event) =>
                      setPublicationYear(
                        event.target.value === "all" ? "all" : Number(event.target.value),
                      )
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
              </div>
            </div>

            <div className={libraryStyles.filterFooter}>
              <button
                className={libraryStyles.textButton}
                disabled={!activeFilters.length && !favoritesOnly}
                onClick={clearFilters}
                type="button"
              >
                Limpiar filtros
              </button>
              <Link className={libraryStyles.textButton} href="/app/ajustes#ia">
                Configurar proveedor IA
              </Link>
            </div>
          </div>
        </Popover>

        <Segmented<LibraryView>
          label="Vista"
          onChange={setView}
          options={[
            { label: "Cuadrícula", preview: <Icon name="grid" size={18} />, value: "grid" },
            { label: "Lista", preview: <Icon name="list" size={18} />, value: "list" },
          ]}
          value={view}
        />
      </form>

      {/* ---- Atajos de filtro y filtros activos ----------------------------- */}
      <div className={libraryStyles.chips}>
        <button
          aria-pressed={!favoritesOnly}
          className={libraryStyles.chip}
          onClick={() => setFavoritesOnly(false)}
          type="button"
        >
          Todo
        </button>
        <button
          aria-pressed={favoritesOnly}
          className={libraryStyles.chip}
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          type="button"
        >
          <Icon name="star" size={14} /> Favoritos
        </button>
        {activeFilters.map((filter) => (
          <button
            aria-label={`Quitar filtro ${filter.label}`}
            className={cx(libraryStyles.chip, libraryStyles.chipActive)}
            key={filter.key}
            onClick={filter.clear}
            type="button"
          >
            {filter.label}
            <Icon name="close" size={13} />
          </button>
        ))}
        <span
          aria-label="Cantidad de documentos filtrados"
          aria-live="polite"
          className={libraryStyles.resultCount}
          role="status"
        >
          {filteredDocuments.length} de {allDocuments.length}
        </span>
      </div>

      {storageError ? (
        <Card as="section" className={styles.emptyState} role="alert" tone="subtle">
          <Tag>Almacenamiento no disponible</Tag>
          <h2>No pudimos abrir la Biblioteca local</h2>
          <p>{storageError}</p>
        </Card>
      ) : libraryLoading ? (
        <section aria-busy="true" aria-label="Cargando documentos" className={libraryStyles.grid}>
          {Array.from({ length: 6 }, (_, index) => (
            <div className={libraryStyles.skeleton} key={index} />
          ))}
        </section>
      ) : filteredDocuments.length ? (
        <section
          aria-label="Documentos de la biblioteca"
          className={view === "grid" ? libraryStyles.grid : libraryStyles.list}
        >
          {filteredDocuments.map((document) => {
            const isCopy = document.reference.kind === "local-copy";
            const isFileReference = document.reference.kind === "local-file";

            return (
              <LibraryDocumentTile
                actions={{
                  ...(document.indexStatus === "indexed"
                    ? {
                        analyze: {
                          disabled: !providerReady || document.catalogStatus === "analyzing",
                          label:
                            document.catalogStatus === "analyzing"
                              ? "Analizando…"
                              : document.catalogStatus === "analyzed"
                                ? "Actualizar catálogo IA"
                                : "Analizar con IA",
                          onSelect: () => void analyzeOneDocument(document.id),
                        },
                      }
                    : {}),
                  ...(isCopy ? { download: () => void downloadCopy(document.id) } : {}),
                  ...(isCopy
                    ? {
                        remove: {
                          label: "Eliminar copia",
                          onSelect: () => void removeCopy(document.id, document.title),
                        },
                      }
                    : isFileReference
                      ? {
                          remove: {
                            label: "Quitar referencia",
                            onSelect: () => void removeFileReference(document.id, document.title),
                          },
                        }
                      : {}),
                }}
                availabilityLabel={availabilityLabels[document.availability]}
                catalogStatusLabel={describeCatalogStatus(document)}
                document={document}
                indexLabel={document.indexStatus ? indexLabels[document.indexStatus] : null}
                isFavorite={favoriteIds.has(document.id)}
                key={document.id}
                onToggleFavorite={() => toggleFavorite(document.id)}
                originLabel={originLabels[document.origin]}
                view={view}
              />
            );
          })}
        </section>
      ) : allDocuments.length ? (
        <div className={libraryStyles.empty}>
          <Icon name="search" size={28} />
          <h2>Nada coincide con esa búsqueda</h2>
          <p>Prueba otro término o quita alguno de los filtros activos.</p>
          <button className={libraryStyles.textButton} onClick={clearFilters} type="button">
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className={libraryStyles.empty}>
          <Icon name="library" size={32} />
          <h2>Tu biblioteca está vacía</h2>
          <p>
            Vincula un archivo o una carpeta: los originales se quedan donde están y Pliegue
            solo guarda la referencia y un índice para buscar.
          </p>
          <div className={libraryStyles.emptyActions}>
            <Button disabled={linkingFiles} onClick={() => void handleLinkedFiles()}>
              {linkingFiles ? "Vinculando…" : "Vincular archivos"}
            </Button>
            <Button onClick={() => setSourcesOpen(true)} variant="secondary">
              Vincular carpeta
            </Button>
          </div>
        </div>
      )}

      {/* ---- Hoja de fuentes: todo lo que es gestionar y no leer -------------- */}
      <Sheet
        description="De dónde salen tus documentos y cómo se indexan. Nada se sube a ningún servidor."
        onClose={() => setSourcesOpen(false)}
        open={sourcesOpen}
        title="Fuentes"
        width={520}
      >
        <div className={cx(libraryStyles.sourcesBody, styles.sourcesBody)}>
          <Disclosure
            defaultOpen
            icon="link"
            meta={`${linkedFiles.documents.length} ref. · ${importedLibrary.documents.length} copias`}
            summary="Referencias a archivos sueltos y copias de compatibilidad"
            title="Archivos"
          >
            <p className={libraryStyles.sourceText}>
              Pliegue guarda un permiso seguro, metadatos y un índice textual limitado. El archivo
              completo permanece en su ubicación y se vuelve a leer solo cuando lo abres.
            </p>
            <div className={libraryStyles.sourceActions}>
              <Button
                aria-describedby="linked-files-status"
                disabled={linkingFiles}
                onClick={() => void handleLinkedFiles()}
                size="sm"
              >
                {linkingFiles ? "Vinculando y analizando…" : "Vincular archivos"}
              </Button>
              <Button
                disabled={importing || importedLibrary.status === "error"}
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                variant="secondary"
              >
                {importing ? "Importando copia…" : "Importar copia"}
              </Button>
              <Button
                disabled={reindexing || !importedLibrary.documents.length}
                onClick={() => void handleReindex()}
                size="sm"
                variant="quiet"
              >
                {reindexing ? "Rehaciendo índice…" : "Actualizar índice"}
              </Button>
            </div>
            <p
              aria-label="Estado de vinculación o importación"
              aria-live="polite"
              className={libraryStyles.sourceStatus}
              id="linked-files-status"
              role="status"
            >
              {importedLibrary.error ?? importStatus}
            </p>
          </Disclosure>

          <Disclosure
            icon="folder"
            meta={`${linkedFolders.sources.length} carpeta${linkedFolders.sources.length === 1 ? "" : "s"}`}
            summary="Carpetas vivas: detecta archivos nuevos o modificados"
            title="Carpetas"
          >
            <LocalSourcesPanel />
          </Disclosure>

          <Disclosure
            icon="database"
            meta={`${importedCatalogs.records.length} fichas`}
            summary="Crea o corrige fichas sin gastar IA"
            title="Índice desde JSON"
          >
            <CatalogImportPanel documents={allDocuments} />
          </Disclosure>

          <Disclosure
            icon="sparkles"
            meta={`${catalogedCount}/${allDocuments.length}`}
            summary="Fichas generadas por el proveedor que elijas"
            title="Catálogo IA"
          >
            <p aria-live="polite" className={libraryStyles.sourceText} role="status">
              {catalogs.error ?? catalogMessage}
            </p>
            <div className={libraryStyles.sourceActions}>
              <Link
                className={buttonClassName({ size: "sm", variant: "secondary" })}
                href="/app/ajustes#ia"
              >
                Configurar proveedor
              </Link>
            </div>
          </Disclosure>

          <Disclosure
            icon="cloud"
            meta="Pendiente"
            summary="Referencia remota, sin duplicar archivos"
            title="Google Drive"
          >
            <p className={libraryStyles.sourceText}>
              La capa documental ya contempla <code>fileId</code> y <code>driveId</code>. La
              autorización OAuth y la renovación segura del acceso siguen pendientes antes de
              habilitar esta fuente.
            </p>
            <div className={libraryStyles.sourceActions}>
              <Button disabled size="sm" variant="secondary">
                Conectar Google Drive
              </Button>
            </div>
          </Disclosure>
        </div>
      </Sheet>

      <Toast message={toast?.text ?? null} nonce={toast?.nonce ?? 0} />
    </>
  );
}
