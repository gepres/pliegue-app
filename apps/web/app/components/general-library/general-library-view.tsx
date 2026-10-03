"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { Button, Field, Select, Switch, buttonClassName, cx } from "@pliegue/ui";

import { documentWorkTypes, type DocumentWorkType } from "../../ai/document-catalog";
import {
  catalogFacets,
  documentFormats,
  filterDocuments,
  organizationFacets,
  sortDocuments,
  type DocumentFormat,
  type DocumentSortOrder,
} from "../../library/documents";
import { toggleFavorite, useFavorites } from "../../library/favorite-store";
import { generalFileId, generalReaderHref } from "../../library/general-library";
import { useGeneralLibrary } from "../../library/general-library-store";
import { languageLabel } from "../../library/language";
import { IconButton, Segmented } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import { Popover } from "../app-ui/overlays";
import { LibraryDocumentTile, workTypeLabels, type LibraryView } from "../library/library-document-tile";
import { categoryChipLimit, sortLabels, usePhoneWidth } from "../library/library-view-options";
import libraryStyles from "../library/library.module.css";
import styles from "./general-library.module.css";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("es")} ${count === 1 ? one : many}`;

/** La vista, el orden y los detalles se recuerdan aparte de los de la biblioteca personal. */
const viewKey = "pliegue-general-vista";
const sortKey = "pliegue-general-orden";
const detailsKey = "pliegue-general-detalles";

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // La elección dura lo que la página.
  }
}

function updatedAgo(iso: string | null) {
  if (!iso) return null;
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "actualizada ahora mismo";
  if (minutes < 60) return `actualizada hace ${minutes} min`;
  return `actualizada el ${new Date(iso).toLocaleString("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" })}`;
}

/**
 * La biblioteca general con los mismos filtros, orden, vistas y tarjetas que la personal. Lo que
 * no tiene sentido aquí —origen, disponibilidad, analizar con IA, importar— no aparece. Los
 * favoritos y el avance se guardan en el navegador del visitante.
 */
export function GeneralLibraryView({ apiKey, folderId }: { apiKey: string; folderId: string }) {
  const state = useGeneralLibrary(folderId, apiKey);
  const favorites = useFavorites();
  const phoneWidth = usePhoneWidth();
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [format, setFormat] = useState<DocumentFormat | "all">("all");
  const [author, setAuthor] = useState<string | "all">("all");
  const [genre, setGenre] = useState<string | "all">("all");
  const [publicationYear, setPublicationYear] = useState<number | "all">("all");
  const [workType, setWorkType] = useState<DocumentWorkType | "all">("all");
  const [category, setCategoryState] = useState<string | "all">("all");
  const [subcategory, setSubcategory] = useState<string | "all">("all");
  const [series, setSeries] = useState<string | "all">("all");
  const [language, setLanguage] = useState<string | "all">("all");
  // En una biblioteca para otros, la copia repetida estorba: se oculta de entrada.
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [sort, setSortState] = useState<DocumentSortOrder>("title");
  const [view, setViewState] = useState<LibraryView>("grid");
  const [gridDetails, setGridDetailsState] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    // Tras montar, para que el HTML del servidor y el primer render coincidan.
    const frame = window.requestAnimationFrame(() => {
      try {
        const storedView = window.localStorage.getItem(viewKey);
        if (storedView === "list" || storedView === "grid") setViewState(storedView);
        if (window.localStorage.getItem(detailsKey) === "true") setGridDetailsState(true);
        const storedSort = window.localStorage.getItem(sortKey);
        if (storedSort && storedSort in sortLabels) setSortState(storedSort as DocumentSortOrder);
      } catch {
        // Sin almacenamiento, los valores de siempre.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function setSort(next: DocumentSortOrder) {
    setSortState(next);
    remember(sortKey, next);
  }
  function setView(next: LibraryView) {
    setViewState(next);
    remember(viewKey, next);
  }
  function setGridDetails(next: boolean) {
    setGridDetailsState(next);
    remember(detailsKey, String(next));
  }
  /** La subcategoría depende de la categoría: al cambiar de materia deja de tener sentido. */
  function setCategory(next: string | "all") {
    setCategoryState(next);
    setSubcategory("all");
  }

  const allDocuments = useMemo(() => state.library?.documents ?? [], [state.library]);
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
  const facets = useMemo(() => catalogFacets(allDocuments), [allDocuments]);
  const organization = useMemo(() => organizationFacets(allDocuments), [allDocuments]);
  const subcategoryOptions = category === "all" ? [] : organization.subcategoriesOf(category);
  const filteredDocuments = useMemo(
    () =>
      sortDocuments(
        filterDocuments(allDocuments, {
          author,
          availability: "all",
          category,
          favoriteIds,
          favoritesOnly,
          format,
          genre,
          hideDuplicates,
          language,
          origin: "all",
          publicationYear,
          query: deferredQuery,
          series,
          subcategory,
          workType,
        }),
        sort,
      ),
    [allDocuments, author, category, deferredQuery, favoriteIds, favoritesOnly, format, genre, hideDuplicates, language, publicationYear, series, sort, subcategory, workType],
  );
  const duplicateCount = state.library?.duplicates ?? 0;
  const visibleTotal = hideDuplicates ? allDocuments.length - duplicateCount : allDocuments.length;

  const activeFilters = [
    format !== "all" ? { clear: () => setFormat("all"), key: "format", label: `Formato: ${format.toUpperCase()}` } : null,
    workType !== "all" ? { clear: () => setWorkType("all"), key: "workType", label: workTypeLabels[workType] } : null,
    author !== "all" ? { clear: () => setAuthor("all"), key: "author", label: author } : null,
    genre !== "all" ? { clear: () => setGenre("all"), key: "genre", label: genre } : null,
    publicationYear !== "all" ? { clear: () => setPublicationYear("all"), key: "year", label: String(publicationYear) } : null,
    subcategory !== "all" ? { clear: () => setSubcategory("all"), key: "subcategory", label: subcategory } : null,
    series !== "all" ? { clear: () => setSeries("all"), key: "series", label: `Serie: ${series}` } : null,
    language !== "all" ? { clear: () => setLanguage("all"), key: "language", label: languageLabel(language) ?? language } : null,
  ].filter((item): item is { clear: () => void; key: string; label: string } => item !== null);

  function clearFilters() {
    setFormat("all");
    setWorkType("all");
    setAuthor("all");
    setGenre("all");
    setPublicationYear("all");
    setCategory("all");
    setSeries("all");
    setLanguage("all");
    setFavoritesOnly(false);
  }

  const categoryChips = organization.categories.slice(0, categoryChipLimit);
  const selectedCategoryHidden =
    category !== "all" &&
    !categoryChips.some((item) => item.value.localeCompare(category, "es", { sensitivity: "base" }) === 0);
  const updated = state.progress !== null ? "actualizando…" : updatedAgo(state.loadedAt);

  if (state.status === "loading" || (state.status === "error" && !state.library)) {
    return (
      <section className={styles.state}>
        {state.status === "loading" ? (
          <p role="status">
            Leyendo la biblioteca…{state.progress ? ` ${plural(state.progress, "carpeta", "carpetas")}` : ""}
          </p>
        ) : (
          <>
            <p role="alert">{state.error}</p>
            <Button onClick={state.refresh} size="sm" variant="secondary">
              Reintentar
            </Button>
          </>
        )}
      </section>
    );
  }

  return (
    <>
      <header className={libraryStyles.header}>
        <div>
          <h1>Biblioteca general</h1>
          <p>
            {plural(visibleTotal, "libro", "libros")}
            {organization.categories.length ? ` · ${plural(organization.categories.length, "categoría", "categorías")}` : ""}
            {updated ? ` · ${updated}` : ""}
          </p>
        </div>
      </header>

      {state.error ? (
        <p className={styles.error} role="status">
          {state.error}
        </p>
      ) : null}

      <form className={libraryStyles.commandBar} onSubmit={(event) => event.preventDefault()} role="search">
        <label className={libraryStyles.search}>
          <Icon name="search" size={18} />
          <span className={libraryStyles.visuallyHidden}>Buscar en la biblioteca general</span>
          <input
            id="general-search"
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={phoneWidth ? "Buscar título o autor" : "Buscar por título, autor o tema"}
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
              aria-label={activeFilters.length ? `Filtros, ${activeFilters.length} activos` : "Filtros"}
              className={cx(buttonClassName({ variant: "secondary" }), libraryStyles.filterButton)}
              type="button"
            >
              <Icon name="filter" size={18} />
              <span>Filtros</span>
              {activeFilters.length ? <span className={libraryStyles.filterCount}>{activeFilters.length}</span> : null}
            </button>
          )}
          width={520}
        >
          <div className={libraryStyles.filterPanel}>
            <div className={libraryStyles.filterGroup}>
              <span className={libraryStyles.filterGroupLabel}>Organización</span>
              <div className={libraryStyles.filterGrid}>
                <Field label="Categoría" labelFor="general-category">
                  <Select disabled={!organization.categories.length} id="general-category" onChange={(event) => setCategory(event.target.value)} value={category}>
                    <option value="all">Todas</option>
                    {organization.categories.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.value} ({item.count})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Subcategoría" labelFor="general-subcategory">
                  <Select disabled={!subcategoryOptions.length} id="general-subcategory" onChange={(event) => setSubcategory(event.target.value)} value={subcategory}>
                    <option value="all">{category === "all" ? "Elige una categoría" : "Todas"}</option>
                    {subcategoryOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.value} ({item.count})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Serie" labelFor="general-series">
                  <Select
                    disabled={!organization.series.length}
                    id="general-series"
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
                <Field label="Idioma" labelFor="general-language">
                  <Select disabled={!organization.languages.length} id="general-language" onChange={(event) => setLanguage(event.target.value)} value={language}>
                    <option value="all">Todos</option>
                    {organization.languages.map((item) => (
                      <option key={item.value} value={item.value}>
                        {languageLabel(item.value)} ({item.count})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {!organization.categories.length ? (
                <p className={libraryStyles.filterHint}>Categoría, subcategoría y serie llegan con el índice JSON de la carpeta.</p>
              ) : null}
            </div>

            <div className={libraryStyles.filterGroup}>
              <span className={libraryStyles.filterGroupLabel}>Orden</span>
              <div className={libraryStyles.filterGrid}>
                <Field label="Ordenar por" labelFor="general-sort">
                  <Select id="general-sort" onChange={(event) => setSort(event.target.value as DocumentSortOrder)} value={sort}>
                    {Object.entries(sortLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Formato" labelFor="general-format">
                  <Select id="general-format" onChange={(event) => setFormat(event.target.value as DocumentFormat | "all")} value={format}>
                    <option value="all">Todos</option>
                    {documentFormats
                      .filter((item) => allDocuments.some((document) => document.format === item))
                      .map((item) => (
                        <option key={item} value={item}>
                          {item.toUpperCase()}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
              <Switch
                checked={hideDuplicates}
                description={
                  duplicateCount
                    ? `${plural(duplicateCount, "copia marcada", "copias marcadas")} como ${duplicateCount === 1 ? "duplicada" : "duplicadas"}; se muestra el ejemplar principal.`
                    : "Ninguna copia marcada como duplicada."
                }
                disabled={!duplicateCount}
                label="Ocultar duplicados"
                onChange={(event) => setHideDuplicates(event.target.checked)}
              />
            </div>

            <div className={libraryStyles.filterGroup}>
              <span className={libraryStyles.filterGroupLabel}>Catálogo</span>
              <div className={libraryStyles.filterGrid}>
                <Field label="Tipo de obra" labelFor="general-work-type">
                  <Select id="general-work-type" onChange={(event) => setWorkType(event.target.value as DocumentWorkType | "all")} value={workType}>
                    <option value="all">Todos los tipos</option>
                    {documentWorkTypes.map((item) => (
                      <option key={item} value={item}>
                        {workTypeLabels[item]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Autor" labelFor="general-author">
                  <Select id="general-author" onChange={(event) => setAuthor(event.target.value)} value={author}>
                    <option value="all">Todos los autores</option>
                    {facets.authors.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Género" labelFor="general-genre">
                  <Select id="general-genre" onChange={(event) => setGenre(event.target.value)} value={genre}>
                    <option value="all">Todos los géneros</option>
                    {facets.genres.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Año" labelFor="general-year">
                  <Select
                    id="general-year"
                    onChange={(event) => setPublicationYear(event.target.value === "all" ? "all" : Number(event.target.value))}
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
              <button className={libraryStyles.textButton} disabled={!activeFilters.length && !favoritesOnly && category === "all"} onClick={clearFilters} type="button">
                Limpiar filtros
              </button>
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
        <button aria-pressed={favoritesOnly} className={libraryStyles.chip} onClick={() => setFavoritesOnly(!favoritesOnly)} type="button">
          <Icon name="star" size={14} /> Favoritos
        </button>
        {categoryChips.length ? <span aria-hidden="true" className={libraryStyles.chipDivider} /> : null}
        {categoryChips.map((item) => {
          const selected = category !== "all" && item.value.localeCompare(category, "es", { sensitivity: "base" }) === 0;
          return (
            <button aria-pressed={selected} className={libraryStyles.chip} key={item.value} onClick={() => setCategory(selected ? "all" : item.value)} type="button">
              {item.value}
              <span className={libraryStyles.chipCount}>{item.count}</span>
            </button>
          );
        })}
        {selectedCategoryHidden ? (
          <button aria-label={`Quitar filtro ${category}`} className={cx(libraryStyles.chip, libraryStyles.chipActive)} onClick={() => setCategory("all")} type="button">
            {category}
            <Icon name="close" size={13} />
          </button>
        ) : null}
        {activeFilters.map((filter) => (
          <button aria-label={`Quitar filtro ${filter.label}`} className={cx(libraryStyles.chip, libraryStyles.chipActive)} key={filter.key} onClick={filter.clear} type="button">
            {filter.label}
            <Icon name="close" size={13} />
          </button>
        ))}
        <span aria-label="Cantidad de libros filtrados" aria-live="polite" className={libraryStyles.resultCount} role="status">
          {filteredDocuments.length} de {visibleTotal}
        </span>
      </div>

      {filteredDocuments.length ? (
        <section
          aria-label="Libros de la biblioteca general"
          className={view === "grid" ? cx(libraryStyles.grid, gridDetails && libraryStyles.gridDetailed) : libraryStyles.list}
        >
          {filteredDocuments.map((document) => (
            <LibraryDocumentTile
              actions={{}}
              availabilityLabel="Disponible"
              catalogStatusLabel={null}
              document={document}
              indexLabel={null}
              isFavorite={favoriteIds.has(document.id)}
              key={document.id}
              onToggleFavorite={() => toggleFavorite(document.id)}
              originLabel="Biblioteca general"
              readerHref={(resume) => generalReaderHref(generalFileId(document.id), resume)}
              showDetails={gridDetails}
              view={view}
            />
          ))}
        </section>
      ) : (
        <div className={libraryStyles.empty}>
          <Icon name="search" size={28} />
          <h2>Nada coincide con esa búsqueda</h2>
          <p>Prueba otro término o quita alguno de los filtros activos.</p>
          <button className={libraryStyles.textButton} onClick={clearFilters} type="button">
            Limpiar filtros
          </button>
        </div>
      )}

      <p className={styles.note}>
        Lo que marques, anotes, traduzcas o guardes en favoritos se queda solo en este navegador: no se comparte con nadie ni
        se mezcla con tu biblioteca personal.
      </p>
    </>
  );
}
