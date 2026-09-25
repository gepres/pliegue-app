"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button, Card, Field, Select, Switch, Tag, buttonClassName, cx } from "@pliegue/ui";

import { analyzeDocumentCatalogs } from "../ai/catalog-analysis";
import { useAiSettings } from "../ai/ai-settings-store";
import { useAiSessionSecrets } from "../ai/ai-session-secret-store";
import {
  documentWorkTypes,
  type DocumentWorkType,
} from "../ai/document-catalog";
import { removeDocumentCatalogRecord } from "../ai/document-catalog-store";
import {
  availabilityStates,
  catalogFacets,
  documentFormats,
  filterDocuments,
  organizationFacets,
  sortDocuments,
  type AvailabilityState,
  type DocumentFormat,
  type DocumentOrigin,
  type DocumentSortOrder,
  type LibraryDocument,
} from "../library/documents";
import { hasStaleIndex } from "../library/stale-index";
import { toggleFavorite, useFavorites } from "../library/favorite-store";
import { languageLabel } from "../library/language";
import { linkLocalFiles, unlinkLocalFile } from "../library/local-file-reference-store";
import {
  downloadImportedCopy,
  importLocalFiles,
  reindexImportedDocuments,
  removeImportedCopy,
} from "../library/local-library-store";
import { clearReadingProgress } from "../library/reading-progress-store";
import { useLibraryDocuments } from "../library/use-library-documents";
import { IconButton, Segmented, Toast } from "./app-ui/controls";
import { Icon } from "./app-ui/icons";
import { MenuItem, MenuSeparator, Popover } from "./app-ui/overlays";
import {
  LibraryDocumentTile,
  workTypeLabels,
  type LibraryView,
} from "./library/library-document-tile";
import libraryStyles from "./library/library.module.css";
import { StaleIndexNotice } from "./stale-index-notice";
import styles from "../(workspace)/app/workspace.module.css";

const sortLabels: Record<DocumentSortOrder, string> = {
  author: "Autor",
  recent: "Orden de llegada",
  series: "Serie y tomo",
  title: "Título",
  year: "Año, más reciente primero",
};

/** Cuántas categorías caben como atajo bajo el buscador antes de pedir el panel de filtros. */
const categoryChipLimit = 8;

/**
 * En el teléfono el buscador deja unos 170 px para escribir y «Buscar por título, autor o
 * concepto» se cortaba a media palabra: ahí va una ayuda que cabe entera.
 */
const phoneWidthQuery = "(max-width: 640px)";

function subscribeToPhoneWidth(onChange: () => void) {
  const query = window.matchMedia(phoneWidthQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePhoneWidth() {
  return useSyncExternalStore(
    subscribeToPhoneWidth,
    () => window.matchMedia(phoneWidthQuery).matches,
    () => false,
  );
}

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
  // Una ficha escrita a mano no es obra de la IA: decirlo evita que parezca una deducción.
  if (document.catalogSource === "import") return "Ficha importada";
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
  const router = useRouter();
  const phoneWidth = usePhoneWidth();
  const [availability, setAvailability] = useState<AvailabilityState | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [format, setFormat] = useState<DocumentFormat | "all">("all");
  const [author, setAuthor] = useState<string | "all">("all");
  const [genre, setGenre] = useState<string | "all">("all");
  const [origin, setOrigin] = useState<DocumentOrigin | "all">("all");
  const [publicationYear, setPublicationYear] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [workType, setWorkType] = useState<DocumentWorkType | "all">("all");
  const [category, setCategoryState] = useState<string | "all">("all");
  const [subcategory, setSubcategory] = useState<string | "all">("all");
  const [series, setSeries] = useState<string | "all">("all");
  const [language, setLanguage] = useState<string | "all">("all");
  const [hideDuplicates, setHideDuplicates] = useState(false);
  const [sort, setSortState] = useState<DocumentSortOrder>("title");
  const [importing, setImporting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [linkingFiles, setLinkingFiles] = useState(false);
  const [view, setViewState] = useState<LibraryView>("grid");
  // La cuadrícula enseña portadas; con detalles, además la ficha: sinopsis, categoría, serie…
  const [gridDetails, setGridDetailsState] = useState(false);
  const [toast, setToast] = useState<{ nonce: number; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const favorites = useFavorites();
  const {
    allDocuments,
    baseDocuments,
    catalogs,
    importedLibrary,
    linkedFiles,
    linkedFolders,
    loading: libraryLoading,
    storageError,
  } = useLibraryDocuments();
  const aiSettings = useAiSettings();
  const aiSecrets = useAiSessionSecrets();

  // El resultado de cada acción se anuncia como aviso efímero.
  const notify = (text: string) =>
    setToast((current) => ({ nonce: (current?.nonce ?? 0) + 1, text }));
  const setImportStatus = notify;
  const setCatalogMessage = notify;

  /** La subcategoría depende de la categoría: al cambiar de materia deja de tener sentido. */
  function setCategory(next: string | "all") {
    setCategoryState(next);
    setSubcategory("all");
  }

  // La vista y el orden elegidos se recuerdan en este navegador; se leen tras montar para que
  // el HTML del servidor y el primer render del cliente coincidan. La vista de Fuentes enlaza
  // aquí con `?categoria=…` o `?serie=…` para abrir la Biblioteca ya filtrada.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem("pliegue-library-view");
        if (stored === "list" || stored === "grid") setViewState(stored);
        if (window.localStorage.getItem("pliegue-library-grid-details") === "true") {
          setGridDetailsState(true);
        }
        const storedSort = window.localStorage.getItem("pliegue-library-sort");
        if (storedSort && storedSort in sortLabels) setSortState(storedSort as DocumentSortOrder);
      } catch {
        // Sin almacenamiento, la vista vuelve a cuadrícula en cada visita.
      }
      const params = new URLSearchParams(window.location.search);
      const requestedCategory = params.get("categoria");
      const requestedSeries = params.get("serie");
      if (requestedCategory) setCategoryState(requestedCategory);
      if (requestedSeries) {
        setSeries(requestedSeries);
        setSortState("series");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function setSort(next: DocumentSortOrder) {
    setSortState(next);
    try {
      window.localStorage.setItem("pliegue-library-sort", next);
    } catch {
      // La elección dura lo que la página.
    }
  }

  function setGridDetails(next: boolean) {
    setGridDetailsState(next);
    try {
      window.localStorage.setItem("pliegue-library-grid-details", String(next));
    } catch {
      // La elección dura lo que la página.
    }
  }

  function setView(next: LibraryView) {
    setViewState(next);
    try {
      window.localStorage.setItem("pliegue-library-view", next);
    } catch {
      // Ídem: la elección dura lo que la página.
    }
  }
  const favoriteIds = new Set(favorites);
  const facets = catalogFacets(allDocuments);
  const organization = organizationFacets(allDocuments);
  const subcategoryOptions = category === "all" ? [] : organization.subcategoriesOf(category);
  const filteredDocuments = sortDocuments(
    filterDocuments(allDocuments, {
      author,
      availability,
      category,
      favoriteIds,
      favoritesOnly,
      format,
      genre,
      hideDuplicates,
      language,
      origin,
      publicationYear,
      query,
      series,
      subcategory,
      workType,
    }),
    sort,
  );
  const duplicateCount = allDocuments.filter((document) => document.organization?.duplicateOf).length;
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
    // El análisis automático trabaja en silencio: solo avisa si algo falla, porque un aviso
    // de «catálogo al día» en cada visita sería ruido.
    void analyzeDocumentCatalogs(baseDocuments, aiSettings).catch((error: unknown) => {
      if (active) {
        setToast((current) => ({
          nonce: (current?.nonce ?? 0) + 1,
          text: error instanceof Error ? error.message : "No fue posible iniciar el catálogo automático.",
        }));
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
    subcategory !== "all"
      ? { key: "subcategory", label: subcategory, clear: () => setSubcategory("all") }
      : null,
    series !== "all" ? { key: "series", label: `Serie: ${series}`, clear: () => setSeries("all") } : null,
    language !== "all"
      ? { key: "language", label: languageLabel(language) ?? language, clear: () => setLanguage("all") }
      : null,
    hideDuplicates
      ? { key: "duplicates", label: "Sin duplicados", clear: () => setHideDuplicates(false) }
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
    setCategory("all");
    setSeries("all");
    setLanguage("all");
    setHideDuplicates(false);
    setFavoritesOnly(false);
  }

  const categoryChips = organization.categories.slice(0, categoryChipLimit);
  const selectedCategoryHidden =
    category !== "all" &&
    !categoryChips.some((item) => item.value.localeCompare(category, "es", { sensitivity: "base" }) === 0);

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
          <Link
            aria-label="Fuentes"
            className={cx(buttonClassName({ variant: "secondary" }), libraryStyles.sourcesButton)}
            href="/app/biblioteca/fuentes"
          >
            <Icon name="folder" size={18} />
            <span>Fuentes</span>
          </Link>
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
                    router.push("/app/biblioteca/fuentes#carpetas");
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
                    router.push("/app/biblioteca/fuentes#indice-json");
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
            placeholder={phoneWidth ? "Buscar título o autor" : "Buscar por título, autor o concepto"}
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
              <span className={libraryStyles.filterGroupLabel}>Organización</span>
              <div className={libraryStyles.filterGrid}>
                <Field label="Categoría" labelFor="library-category">
                  <Select
                    disabled={!organization.categories.length}
                    id="library-category"
                    onChange={(event) => setCategory(event.target.value)}
                    value={category}
                  >
                    <option value="all">Todas</option>
                    {organization.categories.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.value} ({item.count})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Subcategoría" labelFor="library-subcategory">
                  <Select
                    disabled={!subcategoryOptions.length}
                    id="library-subcategory"
                    onChange={(event) => setSubcategory(event.target.value)}
                    value={subcategory}
                  >
                    <option value="all">{category === "all" ? "Elige una categoría" : "Todas"}</option>
                    {subcategoryOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.value} ({item.count})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Serie" labelFor="library-series">
                  <Select
                    disabled={!organization.series.length}
                    id="library-series"
                    onChange={(event) => {
                      setSeries(event.target.value);
                      // Una serie se lee en orden: se ordena por tomo al elegirla.
                      if (event.target.value !== "all") setSort("series");
                    }}
                    value={series}
                  >
                    <option value="all">Todas</option>
                    {organization.series.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.value} ({item.count})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Idioma" labelFor="library-language">
                  <Select
                    disabled={!organization.languages.length}
                    id="library-language"
                    onChange={(event) => setLanguage(event.target.value)}
                    value={language}
                  >
                    <option value="all">Todos</option>
                    {organization.languages.map((item) => (
                      <option key={item.value} value={item.value}>
                        {languageLabel(item.value)} ({item.count})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {/* Sin esta nota, los selectores vacíos parecen averiados: dicen de dónde salen. */}
              {!organization.categories.length || !organization.languages.length ? (
                <p className={libraryStyles.filterHint}>
                  {organization.categories.length
                    ? null
                    : "Categoría, subcategoría y serie llegan con el índice JSON. "}
                  {organization.languages.length
                    ? null
                    : "El idioma sale de las fichas o se detecta al actualizar el índice. "}
                  <Link className={libraryStyles.textButton} href="/app/biblioteca/fuentes#indice-json">
                    Importar índice JSON
                  </Link>
                </p>
              ) : null}
            </div>

            <div className={libraryStyles.filterGroup}>
              <span className={libraryStyles.filterGroupLabel}>Orden</span>
              <div className={libraryStyles.filterGrid}>
                <Field label="Ordenar por" labelFor="library-sort">
                  <Select
                    id="library-sort"
                    onChange={(event) => setSort(event.target.value as DocumentSortOrder)}
                    value={sort}
                  >
                    {Object.entries(sortLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Switch
                checked={hideDuplicates}
                description={
                  duplicateCount
                    ? `${duplicateCount} copia${duplicateCount === 1 ? "" : "s"} marcada${
                        duplicateCount === 1 ? "" : "s"
                      } como duplicada${duplicateCount === 1 ? "" : "s"}; se muestra el ejemplar principal.`
                    : "Ninguna copia marcada como duplicada todavía."
                }
                disabled={!duplicateCount}
                label="Ocultar duplicados"
                onChange={(event) => setHideDuplicates(event.target.checked)}
              />
            </div>

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
        {view === "grid" ? (
          <IconButton
            aria-pressed={gridDetails}
            className={libraryStyles.detailsToggle}
            icon="info"
            label="Detalles en la cuadrícula"
            onClick={() => setGridDetails(!gridDetails)}
            tone={gridDetails ? "active" : "plain"}
          />
        ) : null}
      </form>

      {/* ---- Atajos de filtro y filtros activos ----------------------------- */}
      <div aria-label="Atajos de filtro" className={libraryStyles.chips} role="group">
        <button
          aria-pressed={!favoritesOnly && category === "all"}
          className={libraryStyles.chip}
          onClick={() => {
            setFavoritesOnly(false);
            setCategory("all");
          }}
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
        {categoryChips.length ? <span aria-hidden="true" className={libraryStyles.chipDivider} /> : null}
        {categoryChips.map((item) => {
          const selected =
            category !== "all" && item.value.localeCompare(category, "es", { sensitivity: "base" }) === 0;
          return (
            <button
              aria-pressed={selected}
              className={libraryStyles.chip}
              key={item.value}
              onClick={() => setCategory(selected ? "all" : item.value)}
              type="button"
            >
              {item.value}
              <span className={libraryStyles.chipCount}>{item.count}</span>
            </button>
          );
        })}
        {selectedCategoryHidden ? (
          <button
            aria-label={`Quitar filtro ${category}`}
            className={cx(libraryStyles.chip, libraryStyles.chipActive)}
            onClick={() => setCategory("all")}
            type="button"
          >
            {category}
            <Icon name="close" size={13} />
          </button>
        ) : null}
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
          className={
            view === "grid"
              ? cx(libraryStyles.grid, gridDetails && libraryStyles.gridDetailed)
              : libraryStyles.list
          }
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
                showDetails={gridDetails}
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
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/app/biblioteca/fuentes#carpetas"
            >
              Vincular carpeta
            </Link>
          </div>
        </div>
      )}

      <Toast message={toast?.text ?? null} nonce={toast?.nonce ?? 0} />
    </>
  );
}
