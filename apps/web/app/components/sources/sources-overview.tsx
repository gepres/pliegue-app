"use client";

import Link from "next/link";

import { buttonClassName, cx } from "@pliegue/ui";

import type { LibraryDocument } from "../../library/documents";
import { organizationFacets } from "../../library/documents";
import { formatFileSize } from "../../library/local-file-metadata";
import { describeSkippedFile, type SkippedFileKind } from "../../library/local-folder";
import { useLibraryDocuments } from "../../library/use-library-documents";
import { Icon, type IconName } from "../app-ui/icons";
import { CatalogImportPanel } from "../catalog-import-panel";
import { LocalSourcesPanel } from "../local-sources-panel";
import styles from "./sources.module.css";

type FolderDocument = LibraryDocument & { relativePath?: string; sizeBytes?: number };

const skippedIcons: Record<SkippedFileKind, IconName> = {
  archive: "download",
  audio: "info",
  empty: "info",
  "legacy-office": "file",
  "no-extension": "file",
  other: "info",
  video: "info",
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Carpeta de primer nivel de un documento vinculado; la raíz se agrupa aparte. */
function topFolder(document: FolderDocument) {
  const path = document.relativePath;
  if (!path || !path.includes("/")) return null;
  return path.split("/")[0] ?? null;
}

/**
 * La vista de Fuentes: de dónde salen los documentos, cómo están organizados y qué falta para
 * que la biblioteca esté completa. Antes todo esto vivía en una hoja lateral estrecha que solo
 * permitía gestionar; aquí se ve el conjunto y se entiende en qué estado está.
 */
export function SourcesOverview() {
  const { allDocuments, importedCatalogs, importedLibrary, linkedFiles, linkedFolders, loading } =
    useLibraryDocuments();
  const documents = allDocuments as FolderDocument[];
  const organization = organizationFacets(allDocuments);

  const withCatalog = documents.filter(
    (document) => document.catalogStatus === "analyzed" || document.catalogSource === "import",
  ).length;
  const withCover = documents.filter((document) => document.cover).length;
  const withoutText = documents.filter((document) => document.indexStatus === "metadata-only").length;
  const duplicates = documents.filter((document) => document.organization?.duplicateOf).length;
  const withoutCategory = documents.filter((document) => !document.organization?.category).length;
  const skippedFiles = linkedFolders.sources.flatMap((source) =>
    (source.skippedFiles ?? []).map((file) => ({ ...file, source: source.name })),
  );
  const sourcesWithoutSkippedInfo = linkedFolders.sources.filter((source) => !source.skippedFiles);

  // Desglose por carpeta de primer nivel: cuántos documentos hay en cada una y cuánto ocupan.
  const folders = new Map<string, { count: number; formats: Set<string>; size: number }>();
  for (const document of documents) {
    if (document.reference.kind !== "local-folder") continue;
    const key = topFolder(document) ?? "(raíz)";
    const current = folders.get(key) ?? { count: 0, formats: new Set<string>(), size: 0 };
    current.count += 1;
    current.formats.add(document.format.toUpperCase());
    current.size += document.sizeBytes ?? 0;
    folders.set(key, current);
  }
  const folderRows = [...folders.entries()].sort((left, right) => right[1].count - left[1].count);
  const largestCategory = organization.categories[0]?.count ?? 1;

  const stats = [
    { hint: `${plural(linkedFiles.documents.length + linkedFolders.documents.length, "vinculado")} · ${plural(importedLibrary.documents.length, "copia")}`, label: "Documentos", value: allDocuments.length },
    { hint: `${allDocuments.length ? Math.round((withCatalog / allDocuments.length) * 100) : 0} % de la biblioteca`, label: "Con ficha", value: withCatalog },
    { hint: "Incrustadas en la ficha", label: "Con portada", value: withCover },
    { hint: "Esperan al OCR para buscarse por contenido", label: "Sin capa de texto", value: withoutText },
    { hint: duplicates ? "Se pueden ocultar desde Filtros" : "Ninguno marcado", label: "Duplicados", value: duplicates },
    { hint: skippedFiles.length ? "Ver qué hacer con ellos más abajo" : "Todo lo que hay se puede leer", label: "No legibles", value: skippedFiles.length },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.back} href="/app/biblioteca">
          <Icon name="back" size={18} />
          Biblioteca
        </Link>
        <h1>Fuentes</h1>
        <p>
          De dónde salen tus documentos, cómo están organizados y qué falta para completarlos.
          Nada se sube a ningún servidor.
        </p>
      </header>

      {/* ---- Resumen ------------------------------------------------------------ */}
      <section aria-labelledby="fuentes-resumen" className={styles.section}>
        <h2 className={styles.visuallyHidden} id="fuentes-resumen">
          Resumen
        </h2>
        <dl className={styles.stats} aria-busy={loading}>
          {stats.map((stat) => (
            <div className={styles.stat} key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>
                <strong>{loading ? "—" : stat.value}</strong>
                <span>{stat.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- Organización ------------------------------------------------------ */}
      <section aria-labelledby="fuentes-organizacion" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="fuentes-organizacion">Organización</h2>
          <p>
            Cómo se reparte la biblioteca por materia y colección. Pulsa una para verla en la
            Biblioteca.
          </p>
        </div>

        {organization.categories.length ? (
          <div className={styles.organization}>
            <div className={styles.panel}>
              <h3>Categorías</h3>
              <ul className={styles.bars}>
                {organization.categories.map((category) => {
                  const subcategories = organization.subcategoriesOf(category.value);
                  return (
                    <li key={category.value}>
                      <Link
                        className={styles.barLink}
                        href={{ pathname: "/app/biblioteca", query: { categoria: category.value } }}
                      >
                        <span className={styles.barLabel}>
                          <strong>{category.value}</strong>
                          {subcategories.length ? (
                            <small>
                              {subcategories
                                .slice(0, 4)
                                .map((item) => `${item.value} ${item.count}`)
                                .join(" · ")}
                              {subcategories.length > 4 ? " · …" : ""}
                            </small>
                          ) : null}
                        </span>
                        <span className={styles.barValue}>{category.count}</span>
                        <span aria-hidden="true" className={styles.barTrack}>
                          <span style={{ width: `${(category.count / largestCategory) * 100}%` }} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {withoutCategory ? (
                <p className={styles.note}>
                  {plural(withoutCategory, "documento")} sin categoría. Impórtales una ficha desde
                  JSON para clasificarlos.
                </p>
              ) : null}
            </div>

            <div className={styles.panel}>
              <h3>Series y colecciones</h3>
              {organization.series.length ? (
                <ul className={styles.seriesList}>
                  {organization.series.map((series) => (
                    <li key={series.value}>
                      <Link
                        className={styles.seriesLink}
                        href={{ pathname: "/app/biblioteca", query: { serie: series.value } }}
                      >
                        <span>{series.value}</span>
                        <span className={styles.seriesCount}>
                          {plural(series.count, "volumen", "volúmenes")}
                        </span>
                        <Icon name="chevronRight" size={16} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.note}>Ningún documento tiene serie todavía.</p>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.emptyPanel}>
            <Icon name="database" size={26} />
            <p>
              La biblioteca aún no tiene categorías. Importa un índice JSON con «category» y
              «subcategory» para ordenarla por materias, o descarga el ejemplo para ver cómo.
            </p>
            <a className={buttonClassName({ size: "sm", variant: "secondary" })} href="#indice-json">
              Ir al índice JSON
            </a>
          </div>
        )}
      </section>

      {/* ---- Carpetas ------------------------------------------------------------ */}
      <section aria-labelledby="fuentes-carpetas" className={styles.section} id="carpetas">
        <div className={styles.sectionHeader}>
          <h2 id="fuentes-carpetas">Carpetas y archivos</h2>
          <p>Las carpetas vinculadas se leen donde están: Pliegue guarda la referencia y un índice.</p>
        </div>

        <LocalSourcesPanel />

        {folderRows.length ? (
          <div className={styles.panel}>
            <h3>Contenido por carpeta</h3>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Carpeta</th>
                    <th scope="col">Documentos</th>
                    <th scope="col">Formatos</th>
                    <th scope="col">Tamaño</th>
                  </tr>
                </thead>
                <tbody>
                  {folderRows.map(([name, row]) => (
                    <tr key={name}>
                      <th scope="row">
                        <Icon name="folder" size={16} />
                        {name}
                      </th>
                      <td>{row.count}</td>
                      <td>{[...row.formats].sort().join(" · ")}</td>
                      <td>{formatFileSize(row.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {skippedFiles.length ? (
          <div className={styles.panel}>
            <h3>Archivos que Pliegue no puede leer</h3>
            <p className={styles.panelIntro}>
              Están en tus carpetas pero no se convierten en documentos. Así se arreglan:
            </p>
            <ul className={styles.skippedList}>
              {skippedFiles.map((file) => {
                const { advice, kind } = describeSkippedFile(file);
                return (
                  <li className={cx(styles.skipped)} data-kind={kind} key={`${file.source}/${file.relativePath}`}>
                    <Icon name={skippedIcons[kind]} size={18} />
                    <span>
                      <strong title={file.relativePath}>{file.relativePath}</strong>
                      <small>
                        {advice} · {formatFileSize(file.size)} · {file.source}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {sourcesWithoutSkippedInfo.length ? (
          <p className={styles.note}>
            Pulsa «Buscar cambios» en{" "}
            {sourcesWithoutSkippedInfo.map((source) => `«${source.name}»`).join(", ")} para ver
            también los archivos que no se pueden leer: esa lista se guarda desde el próximo
            escaneo.
          </p>
        ) : null}
      </section>

      {/* ---- Índice JSON ---------------------------------------------------------- */}
      <section aria-labelledby="fuentes-indice" className={styles.section} id="indice-json">
        <div className={styles.sectionHeader}>
          <h2 id="fuentes-indice">Índice desde JSON</h2>
          <p>
            Crea o corrige fichas sin gastar IA: título, autores, categoría, serie y tomo,
            portada… {plural(importedCatalogs.records.length, "ficha importada", "fichas importadas")}.
          </p>
        </div>
        <CatalogImportPanel documents={allDocuments} />
      </section>

      {/* ---- IA y Drive --------------------------------------------------------- */}
      <section aria-labelledby="fuentes-otras" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="fuentes-otras">Otras fuentes de fichas</h2>
        </div>
        <div className={styles.organization}>
          <div className={styles.panel}>
            <h3>
              <Icon name="sparkles" size={18} /> Catálogo IA
            </h3>
            <p className={styles.panelIntro}>
              Un proveedor que elijas lee un extracto local y propone la ficha. Una ficha importada
              desde JSON siempre prevalece sobre la de la IA.
            </p>
            <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href="/app/ajustes#ia">
              Configurar proveedor
            </Link>
          </div>
          <div className={styles.panel}>
            <h3>
              <Icon name="cloud" size={18} /> Google Drive
            </h3>
            <p className={styles.panelIntro}>
              Referencia remota sin duplicar archivos. La autorización OAuth y la renovación segura
              del acceso siguen pendientes antes de habilitar esta fuente.
            </p>
            <span className={styles.pending}>Pendiente</span>
          </div>
        </div>
      </section>
    </div>
  );
}
