"use client";

import { useState } from "react";

import { Tag } from "@pliegue/ui";

import type { LocalDocumentPreview } from "../../library/local-document-preview";
import { readerCountsItsOwnPages } from "../../library/local-document-preview";
import type { LocalReaderDocument } from "../../library/local-reader-state";
import { Segmented } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import type { OutlineItem } from "./outline";
import styles from "./reader.module.css";

type PanelTab = "outline" | "progress" | "details";

const indexLabels = {
  error: "No disponible",
  indexed: "Contenido indexado",
  "metadata-only": "Solo metadatos",
  pending: "Pendiente",
} as const;

const shortcuts = [
  { keys: ["←", "→"], label: "Página anterior o siguiente (PDF)" },
  { keys: ["Inicio", "Fin"], label: "Primera o última página (PDF)" },
  { keys: ["A"], label: "Apariencia de lectura" },
  { keys: ["I"], label: "Índice y detalles" },
  { keys: ["F"], label: "Pantalla completa" },
  { keys: ["Esc"], label: "Cerrar menús y paneles" },
];

/**
 * Panel del documento: índice, progreso y ficha, en pestañas.
 *
 * Antes era una columna fija de 244 px a la derecha del texto: siempre a la vista, siempre
 * restando ancho a la página. Ahora se abre cuando se busca algo en él y, en escritorio,
 * convive con la lectura sin velo.
 */
export function ReaderPanel({
  document,
  onNavigate,
  onRestart,
  outline,
  pages,
  previewKind,
  progressPercent,
}: {
  document: LocalReaderDocument;
  onNavigate: (item: OutlineItem) => void;
  onRestart: () => void;
  outline: readonly OutlineItem[];
  pages: { current: number; total: number } | null;
  previewKind: LocalDocumentPreview["kind"] | null;
  progressPercent: number;
}) {
  // Mientras nadie elija, la pestaña inicial sigue al documento: el índice si lo hay.
  const [chosenTab, setTab] = useState<PanelTab | null>(null);
  const tab = chosenTab ?? (outline.length || previewKind === "pdf" ? "outline" : "progress");

  return (
    <div className={styles.panel}>
      <Segmented<PanelTab>
        label="Secciones del panel"
        onChange={setTab}
        options={[
          { icon: "toc", label: "Índice", value: "outline" },
          { icon: "book", label: "Progreso", value: "progress" },
          { icon: "info", label: "Ficha", value: "details" },
        ]}
        size="sm"
        value={tab}
      />

      {tab === "outline" ? (
        <OutlineList
          currentPage={pages?.current ?? null}
          items={outline}
          onNavigate={onNavigate}
          pageCount={pages?.total ?? 0}
          previewKind={previewKind}
        />
      ) : tab === "progress" ? (
        <ProgressView
          document={document}
          onRestart={onRestart}
          pages={pages}
          progressPercent={progressPercent}
        />
      ) : (
        <DetailsView document={document} />
      )}
    </div>
  );
}

function OutlineList({
  currentPage,
  items,
  onNavigate,
  pageCount,
  previewKind,
}: {
  currentPage: number | null;
  items: readonly OutlineItem[];
  onNavigate: (item: OutlineItem) => void;
  pageCount: number;
  previewKind: LocalDocumentPreview["kind"] | null;
}) {
  // Sin marcadores, un PDF todavía se puede recorrer por páginas: es el índice que siempre
  // existe. Se limita para no pintar miles de filas en un documento enorme.
  const fallback: OutlineItem[] =
    items.length === 0 && previewKind === "pdf" && pageCount > 0
      ? Array.from({ length: Math.min(pageCount, 500) }, (_, index) => ({
          id: `page-${index + 1}`,
          label: `Página ${index + 1}`,
          level: 0,
          target: { kind: "page" as const, page: index + 1 },
        }))
      : [];
  const entries = items.length ? items : fallback;

  // La entrada activa es la última que empieza en o antes de la página en curso.
  let activeId: string | null = null;
  if (currentPage !== null) {
    for (const entry of entries) {
      if (entry.target.kind === "page" && entry.target.page <= currentPage) activeId = entry.id;
    }
  }

  if (!entries.length) {
    return (
      <p className={styles.panelEmpty}>
        {previewKind === null
          ? "El índice aparecerá cuando el documento termine de abrirse."
          : "Este documento no trae secciones ni marcadores que listar."}
      </p>
    );
  }

  return (
    <nav aria-label="Índice del documento">
      <ol className={styles.outline}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              aria-current={entry.id === activeId ? "location" : undefined}
              className={styles.outlineItem}
              onClick={() => onNavigate(entry)}
              style={{ "--level": entry.level } as React.CSSProperties}
              type="button"
            >
              <span>{entry.label}</span>
              {entry.meta ? <small>{entry.meta}</small> : null}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ProgressView({
  document,
  onRestart,
  pages,
  progressPercent,
}: {
  document: LocalReaderDocument;
  onRestart: () => void;
  pages: { current: number; total: number } | null;
  progressPercent: number;
}) {
  const countsPages = readerCountsItsOwnPages(document.format);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className={styles.progressView}>
      <div className={styles.progressRing}>
        <svg aria-hidden="true" height="112" viewBox="0 0 112 112" width="112">
          <circle cx="56" cy="56" r={radius} />
          <circle
            cx="56"
            cy="56"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progressPercent / 100)}
          />
        </svg>
        <div
          aria-label={`Progreso de lectura: ${progressPercent} por ciento`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progressPercent}
          role="progressbar"
        >
          <strong>{progressPercent}</strong>
          <span>% leído</span>
        </div>
      </div>

      <dl className={styles.statList}>
        {pages ? (
          <div>
            <dt>Página</dt>
            <dd>
              {pages.current} de {pages.total}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Cómo se mide</dt>
          <dd>{countsPages ? "Páginas que dejas atrás" : "Desplazamiento del texto"}</dd>
        </div>
      </dl>

      {progressPercent > 0 ? (
        <button className={styles.panelAction} onClick={onRestart} type="button">
          <Icon name="restart" size={18} />
          Volver al inicio
        </button>
      ) : null}

      <div className={styles.shortcuts}>
        <span className={styles.panelLabel}>
          <Icon name="keyboard" size={14} /> Atajos
        </span>
        <ul>
          {shortcuts.map((shortcut) => (
            <li key={shortcut.label}>
              <span>{shortcut.label}</span>
              <span>
                {shortcut.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DetailsView({ document }: { document: LocalReaderDocument }) {
  const sourceLabel =
    document.reference.kind === "local-file"
      ? "Archivo original"
      : document.reference.kind === "local-folder"
        ? "Carpeta vinculada"
        : "Copia de compatibilidad";
  const storageLabel =
    document.reference.kind === "local-copy" ? "Blob en IndexedDB" : "Handle seguro en IndexedDB";
  const availabilityLabel =
    document.reference.kind === "local-copy"
      ? "Copia offline"
      : document.availability === "available"
        ? "Disponible"
        : "Permiso requerido";

  return (
    <div className={styles.detailsView}>
      <dl className={styles.statList}>
        <div>
          <dt>Tipo de fuente</dt>
          <dd>{sourceLabel}</dd>
        </div>
        <div>
          <dt>Formato</dt>
          <dd>{document.format.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Disponibilidad</dt>
          <dd>{availabilityLabel}</dd>
        </div>
        <div>
          <dt>Índice</dt>
          <dd>{document.indexStatus ? indexLabels[document.indexStatus] : "Desconocido"}</dd>
        </div>
        <div>
          <dt>Origen</dt>
          <dd>{storageLabel}</dd>
        </div>
      </dl>

      <p className={styles.privacyNote}>
        <Tag>Local-only</Tag>
        El documento se abre dentro del navegador y no sale de tu dispositivo.
      </p>
    </div>
  );
}
