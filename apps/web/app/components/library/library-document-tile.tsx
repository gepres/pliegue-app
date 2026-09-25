"use client";

import Link from "next/link";

import { Tag, cx } from "@pliegue/ui";

import type { DocumentWorkType } from "../../ai/document-catalog";
import type { LibraryDocument } from "../../library/documents";
import { useReadingProgress } from "../../library/reading-progress-store";
import { IconButton } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import { MenuItem, MenuSeparator, Popover } from "../app-ui/overlays";
import styles from "./library.module.css";

export type LibraryView = "grid" | "list";

export const workTypeLabels: Record<DocumentWorkType, string> = {
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

export interface DocumentTileActions {
  analyze?: { disabled: boolean; label: string; onSelect: () => void };
  download?: () => void;
  remove?: { label: string; onSelect: () => void };
}

/** Iniciales para la portada generada: dos letras de las dos primeras palabras con peso. */
function coverInitials(title: string) {
  const words = title
    .replace(/[_\-.]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
  const letters = (words.length ? words : [title]).slice(0, 2).map((word) => word[0] ?? "");
  return letters.join("").toLocaleUpperCase("es");
}

/**
 * Un documento de la Biblioteca como en una app de lectura: portada, título y avance a la
 * vista; las acciones de mantenimiento —analizar, descargar, quitar— en el menú «⋯».
 *
 * Antes cada tarjeta mostraba hasta cinco botones y cuatro etiquetas de estado a la vez.
 * Tocar la portada o el título abre el lector, que es lo que se hace nueve de cada diez veces.
 */
export function LibraryDocumentTile({
  actions,
  availabilityLabel,
  catalogStatusLabel,
  document,
  indexLabel,
  isFavorite,
  onToggleFavorite,
  originLabel,
  view,
}: {
  actions: DocumentTileActions;
  availabilityLabel: string;
  catalogStatusLabel: string | null;
  document: LibraryDocument;
  indexLabel: string | null;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  originLabel: string;
  view: LibraryView;
}) {
  const progress = useReadingProgress(document.id);
  const percent = progress?.percent ?? 0;
  const title = document.catalog?.canonicalTitle ?? document.title;
  const author = document.catalog?.authors.length
    ? document.catalog.authors.join(", ")
    : document.author;
  const readable = document.reference.kind === "local-copy" || Boolean(document.linked);
  const href = {
    pathname: "/app/lector",
    query: percent > 1 ? { document: document.id, resume: "1" } : { document: document.id },
  };
  const unavailable = document.availability !== "available" && document.reference.kind !== "local-copy";

  const cover = (
    <span
      aria-hidden="true"
      className={styles.cover}
      data-format={document.format}
    >
      <span className={styles.coverFormat}>{document.format.toUpperCase()}</span>
      <span className={styles.coverInitials}>{coverInitials(title)}</span>
      {percent > 0 ? (
        <span className={styles.coverProgress}>
          <span style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </span>
  );

  return (
    <article
      aria-label={title}
      className={cx(styles.tile, view === "list" && styles.tileList)}
      data-unavailable={unavailable ? "true" : undefined}
    >
      {readable ? (
        <Link aria-hidden="true" className={styles.coverLink} href={href} tabIndex={-1}>
          {cover}
        </Link>
      ) : (
        <span className={styles.coverLink}>{cover}</span>
      )}

      <div className={styles.tileBody}>
        <h3 className={styles.tileTitle}>
          {readable ? (
            <Link href={href} title={title}>
              {title}
            </Link>
          ) : (
            <span title={title}>{title}</span>
          )}
        </h3>
        <p className={styles.tileAuthor}>{author}</p>
        <p className={styles.tileMeta}>
          {percent > 0 ? (
            <span className={styles.tileProgressText}>{percent} % leído</span>
          ) : (
            <span>{originLabel}</span>
          )}
          {unavailable ? <span className={styles.tileWarning}>{availabilityLabel}</span> : null}
        </p>

        {view === "list" ? (
          <>
            {document.catalog?.summary ? (
              <p className={styles.tileSummary}>{document.catalog.summary}</p>
            ) : null}
            <div className={styles.tileTags}>
              <Tag>{document.meta}</Tag>
              {document.catalog ? <Tag>{workTypeLabels[document.catalog.workType]}</Tag> : null}
              {document.catalog?.publicationYear ? (
                <Tag>{document.catalog.publicationYear}</Tag>
              ) : null}
              {document.catalog?.genres.slice(0, 2).map((genre) => (
                <Tag key={genre}>{genre}</Tag>
              ))}
              {indexLabel ? <Tag>{indexLabel}</Tag> : null}
              {catalogStatusLabel ? <Tag>{catalogStatusLabel}</Tag> : null}
            </div>
          </>
        ) : null}
      </div>

      <div className={styles.tileActions}>
        <IconButton
          aria-pressed={isFavorite}
          className={cx(styles.favorite, isFavorite && styles.favoriteOn)}
          icon="star"
          label={isFavorite ? `Quitar ${document.title} de favoritos` : `Guardar ${document.title} en favoritos`}
          onClick={onToggleFavorite}
          size="sm"
        />
        <Popover
          align="end"
          kind="menu"
          title={`Acciones de ${title}`}
          trigger={(props) => (
            <IconButton {...props} icon="more" label={`Más acciones para ${title}`} size="sm" />
          )}
          width={260}
        >
          {(close) => (
            <>
              <div className={styles.menuHeader}>
                <strong>{title}</strong>
                <span>{document.meta}</span>
              </div>
              {readable ? (
                <Link className={styles.menuLink} data-menu-item="" href={href} role="menuitem">
                  <Icon name="book" size={18} />
                  {percent > 1 ? "Seguir leyendo" : "Leer"}
                </Link>
              ) : null}
              {actions.analyze ? (
                <MenuItem
                  description={
                    actions.analyze.disabled ? "Configura un proveedor en Ajustes" : undefined
                  }
                  disabled={actions.analyze.disabled}
                  icon="sparkles"
                  label={actions.analyze.label}
                  onSelect={() => {
                    close();
                    actions.analyze?.onSelect();
                  }}
                />
              ) : null}
              {actions.download ? (
                <MenuItem
                  icon="download"
                  label="Descargar copia"
                  onSelect={() => {
                    close();
                    actions.download?.();
                  }}
                />
              ) : null}
              {actions.remove ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    description="El archivo original no se modifica"
                    icon="trash"
                    label={actions.remove.label}
                    onSelect={() => {
                      close();
                      actions.remove?.onSelect();
                    }}
                  />
                </>
              ) : null}
            </>
          )}
        </Popover>
      </div>
    </article>
  );
}
