"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { useAiSessionSecrets } from "../ai/ai-session-secret-store";
import { translationProviderOf } from "../ai/ai-settings";
import { useAiSettings } from "../ai/ai-settings-store";
import { useDocumentCatalogs } from "../ai/document-catalog-store";
import { createAiTranslationEngine, translationProviderNames } from "../ai/translation-ai-engine";
import {
  clearDocumentAnnotations,
  currentAnnotation,
  deleteAnnotation,
  saveAnnotation,
  useDocumentAnnotations,
} from "../library/annotation-store";
import {
  annotationQuote,
  annotationsToMarkdown,
  type AnnotationTarget,
  type HighlightColor,
  type NormalizedRect,
  type ReaderAnnotation,
} from "../library/annotations";
import { beforeFilePermission } from "../guide/file-permission-primer";
import { applyImportedCatalogs } from "../library/catalog-import";
import { applyDocumentCatalogs } from "../library/documents";
import { normalizeLanguage } from "../library/language";
import { defaultPagesAhead } from "../library/translation";
import { browserEngine, hasBuiltInTranslator } from "../library/translation-engine";
import { useImportedCatalogs } from "../library/imported-catalog-store";
import { useImmersiveMode, useReaderScroll } from "../mode/immersive";
import { annotationAtPoint, useAnnotationHighlights, type SelectionCapture } from "./reader/annotation-highlights";
import {
  AnnotationCard,
  RegionToolbar,
  SelectionToolbar,
  type RegionAction,
  type SelectionAction,
} from "./reader/annotation-ui";
import { PostcardEditor } from "./postcard/postcard-editor";
import type { PostcardContent } from "./postcard/postcard-model";
import { IconButton } from "./app-ui/controls";
import { Icon } from "./app-ui/icons";
import { Popover, Sheet } from "./app-ui/overlays";
import type { OutlineItem } from "./reader/outline";
import { ReaderAppearance } from "./reader/reader-appearance";
import { ReaderPanel } from "./reader/reader-panel";
import { isTypingTarget, useFullscreen, useReaderChrome } from "./reader/use-reader-chrome";

import {
  createLocalDocumentPreview,
  readerCountsItsOwnPages,
  type LocalDocumentPreview,
} from "../library/local-document-preview";
import { ExtractedBlocks } from "./extracted-blocks";
import type { LinkedFileDocument } from "../library/local-file-reference";
import { connectDrive, preloadDriveConnection, useDriveConnection } from "../drive/drive-connection";
import type { DriveDocument } from "../library/drive-document";
import { readDriveDocumentFile, useDriveLibrary } from "../library/drive-library-store";
import { compareCopyPreference } from "../library/book-copies";
import { copyGroupOf, useCopyGroups } from "../library/book-copies-store";
import {
  readLinkedFile,
  requestLinkedFileReadPermission,
  useLinkedFiles,
} from "../library/local-file-reference-store";
import type { LinkedFolderDocument } from "../library/local-folder";
import {
  readLinkedDocumentFile,
  requestLinkedFolderReadPermission,
  useLinkedFolders,
  type PermissionRequestOutcome,
} from "../library/local-folder-store";
import { formatFileSize } from "../library/local-file-metadata";
import {
  readImportedDocumentFile,
  useImportedDocuments,
} from "../library/local-library-store";
import {
  saveReadingProgress,
  useReadingProgress,
} from "../library/reading-progress-store";
import {
  resolveLocalReaderDocument,
  type LocalReaderDocument,
} from "../library/local-reader-state";
import { PdfReader, type PdfLayoutBlock, type PdfPageTranslationView, type PdfReaderProps } from "./pdf-reader";
import type { StructuredDocumentBlock, StructuredDocumentSection } from "../library/structured-document-extractor";
import { ParallelBlocks } from "./reader/parallel-blocks";
import { useParallelLink } from "./reader/parallel-link";
import { useReadingPlace } from "./reader/reading-place";
import { TranslationPanel } from "./reader/translation-panel";
import {
  readTranslationLayout,
  useParallelWidth,
  writeTranslationLayout,
  type TranslationLayout,
  type TranslationView,
} from "./reader/translation-view";
import { useBookTranslation } from "./reader/use-book-translation";
import { PageHeader } from "./workspace-page";
import styles from "./local-document-reader.module.css";

type LocalDocument = LocalReaderDocument;

/**
 * Dónde está el lector: adónde se vuelve y, si el libro no es de la biblioteca personal, de
 * dónde se carga su archivo. La biblioteca general lo usa para leer de su carpeta pública de
 * Drive y volver a ella; en la personal vale lo de siempre.
 */
export interface ReaderPlacement {
  backHref: string;
  /** «la Biblioteca», «la biblioteca general»: completa «Volver a…». */
  backLabel: string;
  /** Lo que se lee junto a la flecha de la barra: «Biblioteca», «Biblioteca general». */
  backShortLabel: string;
  loadFile?: ((onProgress: (loaded: number, total: number | null) => void) => Promise<Blob>) | undefined;
}

const ReaderPlacementContext = createContext<ReaderPlacement>({
  backHref: "/app/biblioteca",
  backLabel: "la Biblioteca",
  backShortLabel: "Biblioteca",
});
export const ReaderPlacementProvider = ReaderPlacementContext.Provider;


type PreviewState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { preview: LocalDocumentPreview; status: "ready" };

/** Para `useSyncExternalStore` con valores que no cambian mientras la página vive. */
function subscribeToNothing() {
  return () => {};
}

function isFolderDocument(document: LocalDocument): document is LinkedFolderDocument {
  return document.reference.kind === "local-folder";
}

function isLinkedFileDocument(document: LocalDocument): document is LinkedFileDocument {
  return document.reference.kind === "local-file";
}

function isDriveDocument(document: LocalDocument): document is DriveDocument {
  return document.reference.kind === "google-drive";
}

function ImagePreview({
  document,
  preview,
}: {
  document: LocalDocument;
  preview: Extract<LocalDocumentPreview, { kind: "image" }>;
}) {
  const objectRef = useRef<HTMLObjectElement>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(preview.blob);
    const objectElement = objectRef.current;
    if (objectElement) objectElement.data = objectUrl;

    return () => {
      objectElement?.removeAttribute("data");
      URL.revokeObjectURL(objectUrl);
    };
  }, [preview.blob]);

  return (
    <figure className={styles.imagePreview}>
      <div className={styles.imageFrame}>
        <object
          aria-label={`Vista previa de ${document.title}`}
          ref={objectRef}
          type={preview.blob.type || `image/${document.format}`}
        >
          La imagen no pudo mostrarse en este navegador.
        </object>
      </div>
      <figcaption>Imagen original · Ajustada al área de lectura</figcaption>
    </figure>
  );
}

/** La traducción de una sección: un texto por bloque, en el mismo orden, o que aún se traduce. */
export interface SectionTranslationView {
  language: string;
  pending: boolean;
  texts: readonly string[] | null;
}

function StructuredPreview({
  onSectionChange,
  parallel = false,
  preview,
  translation,
}: {
  onSectionChange?: ((section: number) => void) | undefined;
  /** Original y traducción en dos columnas, en lugar de la traducción sola. */
  parallel?: boolean | undefined;
  preview: Extract<LocalDocumentPreview, { kind: "structured" }>;
  /** Por número de sección (desde 1); `null` muestra el original. */
  translation?: ReadonlyMap<number, SectionTranslationView> | null | undefined;
}) {
  const sideBySide = parallel && Boolean(translation);
  const sectionsRef = useRef<HTMLDivElement>(null);
  // Al pasar a la traducción, al original o a las dos, se sigue en el mismo párrafo.
  useReadingPlace(sectionsRef, sideBySide ? "parallel" : translation ? "translated" : "original");

  // Qué sección se está leyendo: la que más pantalla ocupa, como las páginas de la vista
  // Lectura del PDF. La traducción la usa para ir primero por ella y después por las siguientes.
  useEffect(() => {
    const container = sectionsRef.current;
    if (!container || !onSectionChange) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const index = Number(best?.target.getAttribute("data-section-index"));
        if (Number.isFinite(index) && index > 0) onSectionChange(index);
      },
      { threshold: [0, 0.1, 0.25, 0.5] },
    );
    for (const element of container.querySelectorAll("[data-section-index]")) observer.observe(element);
    return () => observer.disconnect();
  }, [onSectionChange, preview.sections.length]);

  const formatLabel =
    preview.format === "docx"
      ? "Word"
      : preview.format === "pptx"
        ? "PowerPoint"
        : preview.format === "xlsx"
          ? "Excel"
          : "EPUB";

  return (
    <article className={styles.structuredPreview}>
      <div className={styles.previewCaption}>
        <span>{formatLabel} · Extracción local</span>
        <span>
          {preview.sections.length} {preview.sections.length === 1 ? "sección" : "secciones"}
        </span>
      </div>
      {preview.truncated ? (
        <p className={styles.truncationNote} role="status">
          Esta vista alcanzó un límite de seguridad o extensión. Mostramos el contenido
          disponible sin modificar el archivo original.
        </p>
      ) : null}
      {/* Con la traducción en lugar del original no se resalta: una marca guardaría un texto
          que no es el del libro y ya no se encontraría al volver al original. En paralelo el
          original sigue a la vista y se marca; la columna traducida lo impide por su cuenta. */}
      <div
        className={styles.structuredSections}
        data-annotation-scope={translation && !sideBySide ? undefined : "document"}
        ref={sectionsRef}
      >
        {preview.sections.map((section, sectionIndex) => {
          const headingId = `extracted-${section.id}`;
          const view = translation?.get(sectionIndex + 1);
          const texts = view && !view.pending && view.texts?.length === section.blocks.length ? view.texts : null;
          const blocks = texts
            ? section.blocks.map<StructuredDocumentBlock>((block, index) =>
                block.kind === "table" ? block : { ...block, text: texts[index] || block.text },
              )
            : section.blocks;
          // Sin título propio, la sección se nombra solo por su número: «Sección 3» dos veces
          // no dice más. Y el bloque que ya es el título no se vuelve a pintar debajo.
          const untitled = section.title === section.label;
          const titleIndex = section.blocks.findIndex(
            (block) => (block.kind === "heading" || block.kind === "paragraph") && block.text.trim() === section.title.trim(),
          );
          const translatedTitle = texts && titleIndex >= 0 ? texts[titleIndex] || null : null;
          const title = translatedTitle ?? section.title;
          const [, ...rest] = blocks;

          if (sideBySide) {
            // El título del original manda; su traducción va debajo, enlazada como un bloque más.
            const titleKey = `sec:${section.id}:title`;
            return (
              <section
                aria-labelledby={headingId}
                className={styles.structuredSection}
                data-section-index={sectionIndex + 1}
                key={section.id}
              >
                <header>
                  <span id={untitled ? headingId : undefined}>{section.label}</span>
                  {untitled ? null : (
                    <h2 data-parallel-key={titleKey} data-parallel-side="source" id={headingId}>
                      {section.title}
                    </h2>
                  )}
                  {!untitled && translatedTitle ? (
                    <p
                      className={styles.sectionTranslatedTitle}
                      data-annotation-scope=""
                      data-parallel-key={titleKey}
                      data-parallel-side="target"
                      lang={view?.language}
                    >
                      {translatedTitle}
                    </p>
                  ) : null}
                </header>
                <ParallelBlocks
                  anchorOffset={titleIndex === 0 ? 1 : 0}
                  anchorPrefix={`s${sectionIndex + 1}`}
                  blocks={titleIndex === 0 ? section.blocks.slice(1) : section.blocks}
                  keyPrefix={`sec:${section.id}`}
                  language={view?.language}
                  pending={Boolean(view?.pending)}
                  sectionTitle={section.title}
                  translations={texts ? (titleIndex === 0 ? rest : blocks) : null}
                />
              </section>
            );
          }

          return (
            <section
              aria-labelledby={headingId}
              className={styles.structuredSection}
              data-section-index={sectionIndex + 1}
              key={section.id}
              lang={texts ? view?.language : undefined}
            >
              <header>
                <span id={untitled ? headingId : undefined}>{section.label}</span>
                {untitled ? null : <h2 id={headingId}>{title}</h2>}
              </header>
              {view?.pending ? (
                <p className={styles.sectionTranslating} role="status">
                  Traduciendo esta sección…
                </p>
              ) : null}
              <ExtractedBlocks
                anchorOffset={titleIndex === 0 ? 1 : 0}
                anchorPrefix={`s${sectionIndex + 1}`}
                blocks={titleIndex === 0 ? rest : blocks}
                sectionTitle={section.title}
              />
            </section>
          );
        })}
      </div>
    </article>
  );
}

/** Lo que el visor de PDF necesita para marcar y recortar zonas. */
type PdfAnnotationProps = Pick<
  PdfReaderProps,
  | "cropMode"
  | "onCropModeChange"
  | "onRegionClick"
  | "onRegionSelected"
  | "onRegionTools"
  | "parallel"
  | "pendingRegion"
  | "regions"
  | "translation"
>;

/** Lo que la vista de EPUB y DOCX necesita para traducirse sección a sección. */
interface StructuredTranslationProps {
  onSectionChange: (section: number) => void;
  onSections: (sections: readonly StructuredDocumentSection[] | null) => void;
  parallel: boolean;
  translation: ReadonlyMap<number, SectionTranslationView> | null;
}

function PreviewCanvas({
  document,
  source,
  initialPercent,
  pdf,
  structured,
  onKindChange,
  onOutline,
  onPageChange,
  onProgressChange,
  onReady,
  pageRequest,
  restartSignal,
  resumeRequested,
}: {
  document: LocalDocument;
  /** La copia del libro de la que se lee el archivo; el estado va con `document`. */
  source: LocalDocument;
  initialPercent: number;
  onKindChange: (kind: LocalDocumentPreview["kind"] | null) => void;
  onOutline: (items: OutlineItem[]) => void;
  onPageChange: (page: number, pageCount: number) => void;
  onProgressChange: (percent: number) => void;
  onReady: () => void;
  pageRequest: { nonce: number; page: number } | null;
  pdf: PdfAnnotationProps;
  restartSignal: number;
  resumeRequested: boolean;
  structured: StructuredTranslationProps;
}) {
  const placement = useContext(ReaderPlacementContext);
  const loadFileRef = useRef(placement.loadFile);
  // El archivo sale de la copia elegida; las copias de un libro tienen el mismo contenido.
  const documentId = source.id;
  const format = source.format;
  const sourceId = isFolderDocument(source) ? source.sourceId : null;
  const referenceKind = source.reference.kind;
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Solo los documentos de Drive se descargan: lo demás ya está en el equipo.
  const [download, setDownload] = useState<{ loaded: number; total: number | null } | null>(null);
  const [showIndexedFallback, setShowIndexedFallback] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadPreview() {
      try {
        const loadFile = loadFileRef.current;
        const record = loadFile
          ? {
              blob: await loadFile((loaded, total) => {
                if (active) setDownload({ loaded, total });
              }),
            }
          : sourceId
          ? await readLinkedDocumentFile(documentId, sourceId)
          : referenceKind === "local-file"
            ? await readLinkedFile(documentId)
            : referenceKind === "google-drive"
              ? await readDriveDocumentFile(documentId, (loaded, total) => {
                  if (active) setDownload({ loaded, total });
                })
              : await readImportedDocumentFile(documentId);

        if (!record) {
          throw new Error(
            referenceKind === "google-drive"
              ? "El documento ya no está entre tus archivos de Google Drive en Pliegue."
              : "El archivo ya no está disponible en su origen local.",
          );
        }

        const blob = "file" in record ? record.file : record.blob;
        const preview = await createLocalDocumentPreview(format, blob);
        if (active) {
          setState({ preview, status: "ready" });
          onReady();
        }
      } catch (error) {
        if (!active) return;
        setState({
          message:
            error instanceof Error
              ? error.message
              : "No fue posible preparar la previsualización.",
          status: "error",
        });
      }
    }

    void loadPreview();
    return () => {
      active = false;
    };
  }, [attempt, documentId, format, onReady, referenceKind, sourceId]);

  // El índice de los formatos que Pliegue compone sale de sus propias secciones; el del PDF
  // lo aporta el visor al leer los marcadores del archivo.
  const readyPreview = state.status === "ready" ? state.preview : null;
  const { onSections } = structured;
  useEffect(() => {
    onSections(readyPreview?.kind === "structured" ? readyPreview.sections : null);
  }, [onSections, readyPreview]);
  useEffect(() => {
    onKindChange(readyPreview?.kind ?? null);
    if (readyPreview?.kind === "structured") {
      onOutline(
        readyPreview.sections.map((section) => ({
          id: section.id,
          label: section.title,
          level: 0,
          // Una sección sin título propio ya se llama «Sección 3»: no se repite al lado.
          ...(section.title === section.label ? {} : { meta: section.label }),
          target: { id: `extracted-${section.id}`, kind: "anchor" as const },
        })),
      );
    } else if (readyPreview && readyPreview.kind !== "pdf") {
      onOutline([]);
    }
  }, [onKindChange, onOutline, readyPreview]);

  function retryOpening() {
    setShowIndexedFallback(false);
    setDownload(null);
    setState({ status: "loading" });
    setAttempt((currentAttempt) => currentAttempt + 1);
  }

  function openIndexedFallback() {
    setShowIndexedFallback(true);
    onReady();
  }

  if (state.status === "loading") {
    return (
      <Card aria-live="polite" className={styles.readerStatus} role="status" tone="subtle">
        <Tag>{referenceKind === "google-drive" ? "Google Drive" : "Preparando"}</Tag>
        <h2>
          {referenceKind === "google-drive"
            ? "Descargando de Google Drive…"
            : "Abriendo el documento en este dispositivo…"}
        </h2>
        <p>
          {referenceKind === "google-drive"
            ? `${download ? `${formatFileSize(download.loaded)}${download.total ? ` de ${formatFileSize(download.total)}` : ""}. ` : ""}Llega directamente de Google a esta pestaña: no pasa por ningún servidor de Pliegue.`
            : "El contenido no se está enviando a ningún servidor."}
        </p>
      </Card>
    );
  }

  if (state.status === "error") {
    if (showIndexedFallback && document.searchText) {
      return (
        <article className={styles.textPreview}>
          <div className={styles.previewCaption}>
            <span>Índice local · Vista de recuperación</span>
            <Button onClick={retryOpening} size="sm" variant="quiet">
              Reintentar original
            </Button>
          </div>
          <p className={styles.truncationNote} role="status">
            No pudimos abrir el original: {state.message} Mostramos únicamente el texto que
            Pliegue indexó al vincular la carpeta.
          </p>
          <pre>{document.searchText}</pre>
        </article>
      );
    }

    return (
      <Card className={styles.readerStatus} role="alert" tone="subtle">
        <Tag>No disponible</Tag>
        <h2>No pudimos abrir el archivo</h2>
        <p>{state.message}</p>
        <div className={styles.readerRecoveryActions}>
          <Button onClick={retryOpening}>Reintentar apertura</Button>
          {document.searchText ? (
            <Button onClick={openIndexedFallback} variant="secondary">
              Leer el índice disponible
            </Button>
          ) : null}
          <Link
            className={buttonClassName({ size: "md", variant: "quiet" })}
            href={placement.backHref}
          >
            Volver a {placement.backLabel}
          </Link>
        </div>
      </Card>
    );
  }

  const { preview } = state;

  if (preview.kind === "text") {
    return (
      <article className={styles.textPreview}>
        <div className={styles.previewCaption}>
          <span>Texto plano · UTF-8</span>
          <span>{preview.truncated ? "Vista parcial" : "Documento completo"}</span>
        </div>
        {preview.truncated ? (
          <p className={styles.truncationNote} role="status">
            Mostramos el primer 1 MB para mantener el lector fluido. El archivo original no
            fue modificado.
          </p>
        ) : null}
        <pre data-annotation-scope="document">{preview.content}</pre>
      </article>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <PdfReader
        {...pdf}
        blob={preview.blob}
        initialPercent={initialPercent}
        onOutline={onOutline}
        onPageChange={onPageChange}
        onProgressChange={onProgressChange}
        pageRequest={pageRequest}
        restartSignal={restartSignal}
        resumeRequested={resumeRequested}
        title={document.title}
      />
    );
  }

  if (preview.kind === "image") {
    return <ImagePreview document={document} preview={preview} />;
  }

  if (preview.kind === "structured") {
    return (
      <StructuredPreview
        onSectionChange={structured.onSectionChange}
        parallel={structured.parallel}
        preview={preview}
        translation={structured.translation}
      />
    );
  }

  return (
    <Card className={styles.unsupportedPreview} tone="subtle">
      <Tag>Extracción pendiente</Tag>
      <h2>{document.format.toUpperCase()} necesita el conversor multiformato</h2>
      <p>
        Pliegue conserva el archivo y sus metadatos, pero todavía no interpreta su estructura.
        Puedes volver a la Biblioteca y descargar la copia importada cuando corresponda.
      </p>
      <dl>
        <div>
          <dt>Formato</dt>
          <dd>{document.format.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>Original preservado</dd>
        </div>
      </dl>
    </Card>
  );
}

function PermissionPanel({
  alternate,
  onRequestPermission,
  sourceName,
  variant = "local",
}: {
  /** Otra copia del mismo libro que se puede abrir en su lugar. */
  alternate?: { label: string; onSelect: () => void } | undefined;
  onRequestPermission: () => Promise<PermissionRequestOutcome>;
  sourceName: string;
  /** `drive`: no es un permiso del navegador sino conectar la cuenta de Google. */
  variant?: "drive" | "local";
}) {
  const placement = useContext(ReaderPlacementContext);
  const [requestState, setRequestState] = useState<
    "denied" | "error" | "idle" | "requesting" | "unanswered"
  >("idle");

  useEffect(() => {
    if (variant === "drive") preloadDriveConnection();
  }, [variant]);

  async function requestAccess() {
    if (variant === "local" && !(await beforeFilePermission("regrant"))) return;
    setRequestState("requesting");

    try {
      const outcome = await onRequestPermission();
      // El botón vuelve siempre a su estado normal: quedarse en «Solicitando…» sin decir nada
      // es lo que hacía parecer que el lector estaba colgado.
      if (outcome === "granted") setRequestState("idle");
      else setRequestState(outcome === "unanswered" ? "unanswered" : "denied");
    } catch {
      setRequestState("error");
    }
  }

  return (
    <Card className={styles.permissionPanel} tone="subtle">
      <Tag>{variant === "drive" ? "Google Drive" : "Permiso local"}</Tag>
      <h2>
        {variant === "drive"
          ? `Conecta Google Drive para abrir «${sourceName}»`
          : `Vuelve a autorizar «${sourceName}»`}
      </h2>
      <p>
        {variant === "drive"
          ? "El documento está en tu Drive. Pliegue lo descarga a esta pestaña para leerlo; no lo copia ni lo modifica."
          : "El navegador recuerda el vínculo, pero requiere tu permiso para leer el archivo. Pliegue no copiará ni subirá el contenido."}
      </p>
      <div className={styles.permissionActions}>
        <Button disabled={requestState === "requesting"} onClick={() => void requestAccess()}>
          {requestState === "requesting"
            ? "Solicitando…"
            : variant === "drive"
              ? "Conectar Google Drive"
              : "Permitir lectura"}
        </Button>
        {alternate ? (
          <Button onClick={alternate.onSelect} variant="secondary">
            {alternate.label}
          </Button>
        ) : null}
        <Link
          className={buttonClassName({ size: "md", variant: "quiet" })}
          href={placement.backHref}
        >
          Volver a {placement.backLabel}
        </Link>
      </div>
      <p aria-live="polite" className={styles.permissionStatus} role="status">
        {variant === "drive"
          ? requestState === "denied"
            ? "No se concedió el acceso. Puedes intentarlo de nuevo cuando quieras."
            : requestState === "unanswered"
              ? "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes de este sitio y vuelve a intentarlo."
              : requestState === "error"
                ? "No fue posible conectar con Google Drive."
                : "Google abrirá una ventana para confirmar tu cuenta."
          : requestState === "denied"
          ? "El permiso no fue concedido. Puedes intentarlo de nuevo cuando quieras."
          : requestState === "unanswered"
            ? "El navegador no llegó a mostrar la ventana de permiso. Ocurre cuando esta pestaña no está en primer plano o cuando otra ventana de Pliegue tiene la petición abierta: déjala visible, cierra las demás y vuelve a intentarlo."
            : requestState === "error"
              ? "No fue posible recuperar el acceso a esta carpeta."
              : "El permiso solo se usa para leer los archivos que elegiste."}
      </p>
    </Card>
  );
}

function scrollToReadingPosition(root: HTMLElement, percent: number, behavior: ScrollBehavior) {
  const rootTop = window.scrollY + root.getBoundingClientRect().top;
  const readableDistance = Math.max(root.offsetHeight - window.innerHeight * 0.35, 0);
  const target = rootTop + readableDistance * (percent / 100) - window.innerHeight * 0.2;
  window.scrollTo({ behavior, top: Math.max(0, target) });
}

/**
 * Avance de lectura del documento abierto.
 *
 * Hay dos formas de medirlo y no son intercambiables. Para el texto y los formatos que
 * Pliegue compone —donde el documento *es* el alto de la página— basta con seguir el
 * desplazamiento de la ventana. Un visor que se desplaza por dentro, como el de PDF, queda
 * fuera de esa cuenta: por eso reporta él su posición en `reportedPercent`, y aquí solo se
 * guarda. Medir su scroll desde fuera era lo que producía «78 % leído» en la página 1 de 49.
 */
function useDocumentProgress(
  document: LocalDocument,
  contentReady: boolean,
  resumeRequested: boolean,
  rootRef: React.RefObject<HTMLElement | null>,
  reportedPercent: number | null,
) {
  const { format, id, origin, title } = document;
  const progress = useReadingProgress(document.id);
  const lastPersistedRef = useRef(progress?.percent ?? 0);
  const hasResumedRef = useRef(false);
  const selfReported = readerCountsItsOwnPages(format);

  useEffect(() => {
    lastPersistedRef.current = progress?.percent ?? 0;
  }, [progress?.percent]);

  useEffect(() => {
    saveReadingProgress({ format, id, origin, title }, 0);
  }, [format, id, origin, title]);

  useEffect(() => {
    if (reportedPercent === null) return;
    if (reportedPercent <= lastPersistedRef.current) return;
    lastPersistedRef.current = reportedPercent;
    saveReadingProgress({ format, id, origin, title }, reportedPercent);
  }, [format, id, origin, reportedPercent, title]);

  useEffect(() => {
    if (!contentReady || selfReported) return;
    let animationFrame = 0;

    function measureProgress() {
      animationFrame = 0;
      const root = rootRef.current;
      if (!root) return;

      const rootTop = window.scrollY + root.getBoundingClientRect().top;
      const viewportCursor = window.scrollY + window.innerHeight * 0.65;
      const readableDistance = Math.max(root.offsetHeight - window.innerHeight * 0.35, 1);
      const rootBottomIsVisible =
        rootTop + root.offsetHeight <= window.scrollY + window.innerHeight + 4;
      const measured = rootBottomIsVisible
        ? 100
        : Math.min(
            99,
            Math.max(0, Math.round(((viewportCursor - rootTop) / readableDistance) * 100)),
          );

      if (measured <= lastPersistedRef.current) return;
      lastPersistedRef.current = measured;
      saveReadingProgress(document, measured);
    }

    function scheduleMeasurement() {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(measureProgress);
    }

    scheduleMeasurement();
    window.addEventListener("scroll", scheduleMeasurement, { passive: true });
    window.addEventListener("resize", scheduleMeasurement);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", scheduleMeasurement);
      window.removeEventListener("resize", scheduleMeasurement);
    };
  }, [contentReady, document, rootRef, selfReported]);

  useEffect(() => {
    // Un visor que se desplaza por dentro retoma su propia posición: mover la ventana desde
    // fuera solo desplazaría la página de la aplicación, dejando el documento en la primera.
    if (
      selfReported ||
      !contentReady ||
      !resumeRequested ||
      hasResumedRef.current ||
      !progress ||
      progress.percent < 2
    ) {
      return;
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        hasResumedRef.current = true;
        scrollToReadingPosition(root, progress.percent, "smooth");
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [contentReady, progress, resumeRequested, rootRef, selfReported]);

  const restart = useCallback(() => {
    const root = rootRef.current;
    saveReadingProgress(document, 0, { allowRegression: true });
    lastPersistedRef.current = 0;
    hasResumedRef.current = false;
    if (!selfReported && root) scrollToReadingPosition(root, 0, "smooth");
  }, [document, rootRef, selfReported]);

  return { progressPercent: progress?.percent ?? 0, restart };
}

/**
 * La traducción de las páginas de alrededor —las que se ven o están a punto de verse—: las ya
 * traducidas con su texto y las que están en cola, marcadas para enseñar que se traducen.
 */
/** Lo que se traduce: los bloques de una página de PDF, con su caja, o el texto de un bloque de EPUB. */
type TranslationSourceBlock = PdfLayoutBlock | { text: string };

function isLayoutBlock(block: TranslationSourceBlock): block is PdfLayoutBlock {
  return "box" in block;
}

type TranslatedUnitOf = (
  unit: number,
) => { source: TranslationSourceBlock[]; translated: { text: string }[] } | undefined;

function pdfTranslationViews(
  pages: { current: number; total: number },
  ahead: number,
  language: string,
  unitOf: TranslatedUnitOf,
  snapshot: { pending: readonly number[]; working: number | null },
) {
  const views = new Map<number, PdfPageTranslationView>();
  const last = Math.min(pages.total, pages.current + ahead + 1);
  for (let number = Math.max(1, pages.current - 2); number <= last; number += 1) {
    const done = unitOf(number);
    const layout = done?.source.filter(isLayoutBlock) ?? [];
    if (done && layout.length === done.source.length) {
      views.set(number, {
        blocks: layout.map((block, index) => ({ ...block, translated: done.translated[index]?.text ?? "" })),
        language,
        pending: false,
      });
    } else if (snapshot.working === number || snapshot.pending.includes(number)) {
      views.set(number, { blocks: [], language, pending: true });
    }
  }
  return views;
}

/** Lo mismo para las secciones de un EPUB o un DOCX: un texto por bloque, en su orden. */
function sectionTranslationViews(
  total: number,
  current: number,
  ahead: number,
  language: string,
  unitOf: TranslatedUnitOf,
  snapshot: { pending: readonly number[]; working: number | null },
) {
  const views = new Map<number, SectionTranslationView>();
  const last = Math.min(total, current + ahead + 1);
  for (let number = Math.max(1, current - 2); number <= last; number += 1) {
    const done = unitOf(number);
    if (done) {
      views.set(number, { language, pending: false, texts: done.translated.map((block) => block.text) });
    } else if (snapshot.working === number || snapshot.pending.includes(number)) {
      views.set(number, { language, pending: true, texts: null });
    }
  }
  return views;
}

/** En un PDF, lo que se traduce de una vez es una página. */
function pageUnitId(unit: number) {
  return `page:${unit}`;
}

export function LocalReaderShell({
  alternateCopy,
  document,
  permissionRequired = false,
  permissionVariant = "local",
  requestPermission,
  resumeRequested,
  source,
  sourceName,
}: {
  alternateCopy?: { label: string; onSelect: () => void } | undefined;
  document: LocalDocument;
  /** La copia de la que se lee; si no se indica, el propio documento. */
  source?: LocalDocument | undefined;
  permissionRequired?: boolean;
  permissionVariant?: "drive" | "local";
  requestPermission?: (() => Promise<PermissionRequestOutcome>) | undefined;
  resumeRequested: boolean;
  sourceName?: string | undefined;
}) {
  const placement = useContext(ReaderPlacementContext);
  const [contentReady, setContentReady] = useState(false);
  // El visor de PDF cuenta las páginas él mismo; el resto de formatos se miden por
  // desplazamiento. `null` es lo que distingue un caso del otro.
  const [reportedPercent, setReportedPercent] = useState<number | null>(null);
  const [restartSignal, setRestartSignal] = useState(0);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [pages, setPages] = useState<{ current: number; total: number } | null>(null);
  const [pageRequest, setPageRequest] = useState<{ nonce: number; page: number } | null>(null);
  const [previewKind, setPreviewKind] = useState<LocalDocumentPreview["kind"] | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  // Con la traducción en marcha, «Original» la esconde sin detenerla: sigue preparando páginas.
  const [translationVisible, setTranslationVisible] = useState(true);
  // Encima del original o a su lado. A su lado solo en pantallas anchas: en el teléfono la
  // preferencia se guarda, pero se lee como siempre.
  const [translationLayout, setTranslationLayout] = useState<TranslationLayout>(readTranslationLayout);
  const parallelFits = useParallelWidth();
  const previewRef = useRef<HTMLElement>(null);
  const markContentReady = useCallback(() => setContentReady(true), []);
  const reportPage = useCallback(
    (current: number, total: number) => setPages({ current, total }),
    [],
  );
  const { progressPercent, restart } = useDocumentProgress(
    document,
    contentReady,
    resumeRequested,
    previewRef,
    reportedPercent,
  );
  const selfScrolling = readerCountsItsOwnPages(document.format);
  const position = useScrollPosition(previewRef, contentReady && !selfScrolling);
  const [cropMode, setCropMode] = useState(false);
  const [pendingRegion, setPendingRegion] = useState<{ anchor: DOMRect; page: number; rect: NormalizedRect } | null>(null);
  const [openCard, setOpenCard] = useState<{ anchor: DOMRect; focusNote: boolean; id: string } | null>(null);
  const [postcard, setPostcard] = useState<PostcardContent | null>(null);
  const regionToolsRef = useRef<Parameters<NonNullable<PdfReaderProps["onRegionTools"]>>[0]>(null);
  // Mientras se recorta, las barras se quedan: el dock tiene el botón para salir.
  const chrome = useReaderChrome(appearanceOpen || cropMode || translationOpen);
  const fullscreen = useFullscreen();

  // La ficha del documento, si la tiene: título y autor de verdad para la postal y para la
  // procedencia de cada nota, en lugar de los que se deducen del nombre del archivo.
  const aiCatalogs = useDocumentCatalogs();
  const importedCatalogs = useImportedCatalogs();
  const catalog = useMemo(
    () => applyImportedCatalogs(applyDocumentCatalogs([document], aiCatalogs.records), importedCatalogs.records)[0]?.catalog,
    [aiCatalogs.records, document, importedCatalogs.records],
  );

  // ---- Traducción ----------------------------------------------------------------------
  // En el dispositivo, página a página en un PDF y sección a sección en un EPUB o un DOCX:
  // primero la que se lee, luego las siguientes. Lo traducido se guarda; en el PDF se pinta
  // encima del original sin taparle las imágenes.
  const isPdf = previewKind === "pdf";
  const [structuredSections, setStructuredSections] = useState<readonly StructuredDocumentSection[] | null>(null);
  const [currentSection, setCurrentSection] = useState(1);
  const translatable = isPdf || (previewKind === "structured" && Boolean(structuredSections?.length));
  // Por delante se preparan cinco páginas, pero solo dos secciones: en un EPUB cada una es un
  // capítulo entero.
  const translationAhead = isPdf ? defaultPagesAhead : 2;
  // Dos motores: el traductor del navegador —el predeterminado— y «Tu IA», con el proveedor y la
  // clave que la persona elija en Ajustes. Si eligió una IA, se empieza por ella.
  const browserSupported = useSyncExternalStore(subscribeToNothing, hasBuiltInTranslator, () => true);
  const aiSettings = useAiSettings();
  const aiSecrets = useAiSessionSecrets();
  const aiProvider = translationProviderOf(aiSettings);
  const aiApiKey = aiProvider === "ollama" || aiProvider === "browser" ? "" : aiSecrets[aiProvider];
  const translationEngines = useMemo(
    () => ({ ai: createAiTranslationEngine(aiSettings, aiApiKey), browser: browserEngine }),
    [aiApiKey, aiSettings],
  );
  const aiEngineSummary = useMemo(
    () => ({
      configured: aiProvider !== "browser",
      label: translationEngines.ai.label,
      needsKey: aiProvider !== "ollama" && aiProvider !== "browser" && !aiApiKey,
      onDevice: translationEngines.ai.onDevice,
      provider: translationProviderNames[aiProvider],
    }),
    [aiApiKey, aiProvider, translationEngines.ai],
  );
  const translation = useBookTranslation<TranslationSourceBlock>({
    currentUnit: isPdf ? (pages?.current ?? 1) : currentSection,
    defaultEngine: aiProvider === "browser" ? "browser" : "ai",
    documentId: document.id,
    engines: translationEngines,
    loadUnit: async (unit) => {
      if (!isPdf) {
        const section = structuredSections?.[unit - 1];
        if (!section) throw new Error("Esa sección ya no está en el documento.");
        // Las tablas se dejan como están: sus cifras y celdas no se tocan.
        return { blocks: section.blocks.map((block) => ({ text: block.kind === "table" ? "" : block.text })) };
      }
      const tools = regionToolsRef.current;
      if (!tools) throw new Error("El visor del PDF aún no está listo.");
      return { blocks: await tools.readLayout(unit) };
    },
    pagesAhead: translationAhead,
    unitCount: isPdf ? (pages?.total ?? 0) : (structuredSections?.length ?? 0),
    unitId: isPdf ? pageUnitId : (unit) => `section:${structuredSections?.[unit - 1]?.id ?? unit}`,
  });
  const translationActive = translation.phase.kind === "ready";
  const sourceLanguageGuess =
    normalizeLanguage(catalog?.language) ??
    ("detectedLanguage" in document && typeof document.detectedLanguage === "string" ? document.detectedLanguage : null);
  const { pair: translationPair, snapshot: translationSnapshot, unit: translatedUnit } = translation;
  const showTranslation = translatable && translationActive && translationVisible;
  const parallel = showTranslation && parallelFits && translationLayout === "parallel";
  const translationView: TranslationView = !translationVisible
    ? "original"
    : parallelFits && translationLayout === "parallel"
      ? "parallel"
      : "translated";
  const changeTranslationView = useCallback((view: TranslationView) => {
    setTranslationVisible(view !== "original");
    if (view === "original") return;
    const layout: TranslationLayout = view === "parallel" ? "parallel" : "overlay";
    setTranslationLayout(layout);
    writeTranslationLayout(layout);
  }, []);
  useParallelLink(previewRef, parallel ? translationPair : null);
  const pdfTranslation = useMemo(
    () =>
      showTranslation && isPdf && translationPair && pages
        ? pdfTranslationViews(pages, translationAhead, translationPair.target, translatedUnit, translationSnapshot)
        : null,
    [isPdf, pages, showTranslation, translatedUnit, translationAhead, translationPair, translationSnapshot],
  );
  const sectionTranslation = useMemo(
    () =>
      showTranslation && !isPdf && translationPair && structuredSections
        ? sectionTranslationViews(
            structuredSections.length,
            currentSection,
            translationAhead,
            translationPair.target,
            translatedUnit,
            translationSnapshot,
          )
        : null,
    [
      currentSection,
      isPdf,
      showTranslation,
      structuredSections,
      translatedUnit,
      translationAhead,
      translationPair,
      translationSnapshot,
    ],
  );
  const displayTitle = catalog?.canonicalTitle ?? document.title;
  const displayAuthor = catalog?.authors.length ? catalog.authors.join(", ") : null;

  const { annotations } = useDocumentAnnotations(document.id);
  const rangesRef = useAnnotationHighlights(previewRef, annotations);
  const regionMarks = useMemo(
    () =>
      annotations.flatMap((annotation) =>
        annotation.target.kind === "region"
          ? [
              {
                color: annotation.color,
                hasNote: Boolean(annotation.note.trim()),
                id: annotation.id,
                page: annotation.target.page,
                rect: annotation.target.rect,
              },
            ]
          : [],
      ),
    [annotations],
  );

  useImmersiveMode(true);
  useReaderScroll(selfScrolling ? "self" : "page");

  const restartReading = useCallback(() => {
    restart();
    setReportedPercent(null);
    setRestartSignal((signal) => signal + 1);
  }, [restart]);

  const goToOutlineItem = useCallback((item: OutlineItem) => {
    if (item.target.kind === "page") {
      const page = item.target.page;
      setPageRequest((current) => ({ nonce: (current?.nonce ?? 0) + 1, page }));
    } else {
      window.document
        .getElementById(item.target.id)
        ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
    // En pantallas estrechas el panel tapa el texto: se cierra al elegir un destino.
    if (window.matchMedia("(max-width: 1100px)").matches) setPanelOpen(false);
  }, []);

  // ---- Atajos de teclado ---------------------------------------------------
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "r" && selfScrolling) {
        event.preventDefault();
        setCropMode((active) => !active);
      } else if (key === "i") {
        event.preventDefault();
        setPanelOpen((open) => !open);
      } else if (key === "a") {
        event.preventDefault();
        setAppearanceOpen((open) => !open);
      } else if (key === "t" && translatable) {
        event.preventDefault();
        // En marcha, alterna traducción y original; si no, abre el panel para empezar.
        if (translationActive) setTranslationVisible((visible) => !visible);
        else setTranslationOpen((open) => !open);
      } else if (key === "p" && translatable && translationActive && parallelFits) {
        // En pantallas anchas, la traducción al lado del original o en su lugar.
        event.preventDefault();
        changeTranslationView(translationView === "parallel" ? "translated" : "parallel");
      } else if (key === "f" && fullscreen.supported) {
        event.preventDefault();
        fullscreen.toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    changeTranslationView,
    fullscreen,
    parallelFits,
    selfScrolling,
    translatable,
    translationActive,
    translationView,
  ]);

  // ---- Marcas ------------------------------------------------------------------------
  function createAnnotation(target: AnnotationTarget, color: HighlightColor, note = "") {
    const now = new Date().toISOString();
    const annotation: ReaderAnnotation = {
      color,
      createdAt: now,
      documentId: document.id,
      documentTitle: displayTitle,
      id: crypto.randomUUID(),
      note,
      target,
      updatedAt: now,
    };
    void saveAnnotation(annotation);
    return annotation;
  }

  function updateAnnotation(id: string, change: Partial<Pick<ReaderAnnotation, "color" | "note">>) {
    // Del almacén y no del render: cambiar el color y pulsar «Listo» al instante guardaba la
    // nota sobre la versión anterior y el color se perdía.
    const current = currentAnnotation(id);
    if (current) void saveAnnotation({ ...current, ...change, updatedAt: new Date().toISOString() });
  }

  function postcardFrom(quote: string, page: number | null, image: Blob | null = null): PostcardContent {
    return { author: displayAuthor, image, page, quote, title: displayTitle };
  }

  async function openRegionPostcard(page: number, rect: NormalizedRect, fallbackQuote = "") {
    const tools = regionToolsRef.current;
    if (!tools) return;
    // En un PDF con texto, la postal nace con la cita escrita; en un escaneo, solo la imagen.
    const [image, text] = await Promise.all([tools.render(page, rect), tools.readText(page, rect).catch(() => "")]);
    setPostcard(postcardFrom(text || fallbackQuote, page, image));
  }

  function openAnnotationPostcard(annotation: ReaderAnnotation) {
    if (annotation.target.kind === "region") {
      void openRegionPostcard(annotation.target.page, annotation.target.rect, annotation.target.quote);
    } else {
      setPostcard(postcardFrom(annotationQuote(annotation), annotation.target.page));
    }
  }

  function handleSelectionAction(action: SelectionAction, capture: SelectionCapture) {
    if (action.kind === "copy") {
      void navigator.clipboard?.writeText(capture.quote).catch(() => undefined);
      return;
    }
    if (action.kind === "postcard") {
      setPostcard(postcardFrom(capture.quote, capture.page));
      return;
    }
    if (!capture.target) return;
    if (action.kind === "highlight") {
      createAnnotation(capture.target, action.color);
      return;
    }
    const annotation = createAnnotation(capture.target, "amber");
    setOpenCard({ anchor: capture.rect, focusNote: true, id: annotation.id });
  }

  function handleRegionAction(action: RegionAction) {
    const region = pendingRegion;
    setPendingRegion(null);
    // Descartar deja seguir recortando; cualquier otra acción termina el recorte.
    if (!region || action.kind === "cancel") return;
    setCropMode(false);
    if (action.kind === "postcard") {
      void openRegionPostcard(region.page, region.rect);
      return;
    }
    void (async () => {
      const quote = (await regionToolsRef.current?.readText(region.page, region.rect).catch(() => "")) ?? "";
      const annotation = createAnnotation(
        { kind: "region", page: region.page, quote, rect: region.rect },
        action.kind === "highlight" ? action.color : "amber",
      );
      if (action.kind === "note") setOpenCard({ anchor: region.anchor, focusNote: true, id: annotation.id });
    })();
  }

  function goToAnnotation(annotation: ReaderAnnotation) {
    const page = annotation.target.page;
    if (page !== null) {
      setPageRequest((current) => ({ nonce: (current?.nonce ?? 0) + 1, page }));
    } else {
      rangesRef.current
        .get(annotation.id)
        ?.startContainer.parentElement?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    }
    if (window.matchMedia("(max-width: 1100px)").matches) setPanelOpen(false);
  }

  /** Un toque o un clic sobre un resaltado abre su tarjeta; si no, alterna las barras. */
  function handleStagePointerUp(event: React.PointerEvent<HTMLElement>) {
    if (!cropMode && window.getSelection()?.isCollapsed !== false) {
      const id = annotationAtPoint(rangesRef.current, event.clientX, event.clientY);
      if (id) {
        const range = rangesRef.current.get(id);
        setOpenCard({
          anchor: range?.getBoundingClientRect() ?? new DOMRect(event.clientX, event.clientY, 0, 0),
          focusNote: false,
          id,
        });
        return;
      }
    }
    chrome.onStagePointerUp(event);
  }

  const cardAnnotation = openCard ? annotations.find((annotation) => annotation.id === openCard.id) ?? null : null;

  const pageLabel = pages ? `Página ${pages.current} de ${pages.total}` : null;
  // La cápsula dice dónde se está: la página en un PDF, el punto del texto en lo demás.
  const peekPosition = selfScrolling
    ? pages
      ? `${pages.current} / ${pages.total}`
      : null
    : `${position} %`;

  return (
    <div
      className={styles.readerApp}
      data-chrome={chrome.hidden ? "hidden" : "visible"}
      data-panel={panelOpen ? "open" : "closed"}
      data-parallel={parallel ? "true" : undefined}
      data-self-scrolling={selfScrolling ? "true" : "false"}
    >
      <div aria-hidden="true" className={styles.progressLine}>
        <span style={{ transform: `scaleX(${(selfScrolling ? progressPercent : position) / 100})` }} />
      </div>

      <header className={styles.appBar} onFocus={chrome.show}>
        <Link
          aria-label={`Volver a ${placement.backLabel}`}
          className={styles.appBarBack}
          href={placement.backHref}
        >
          <Icon name="back" />
          <span>{placement.backShortLabel}</span>
        </Link>

        <div className={styles.appBarTitle}>
          <h1 title={displayTitle}>{displayTitle}</h1>
          <p>
            <span className={styles.hideOnSmall}>{document.format.toUpperCase()}</span>
            {pageLabel ? <span>{pageLabel}</span> : null}
            <span className={styles.hideOnNarrow}>{progressPercent} % leído</span>
            {/* En el teléfono no cabe: el avance está en el panel y el botón queda resaltado. */}
            {translationActive ? <span className={styles.hideOnSmall}>{translationSnapshot.percent} % traducido</span> : null}
          </p>
        </div>

        <div className={styles.appBarActions}>
          {translatable ? (
            <Popover
              onOpenChange={setTranslationOpen}
              open={translationOpen}
              title="Traducir el libro"
              trigger={(props) => (
                <IconButton
                  {...props}
                  icon="translate"
                  label={translationActive ? "Traducción" : "Traducir"}
                  shortcut="T"
                  tone={translationActive ? "active" : "plain"}
                />
              )}
              width={360}
            >
              {() => (
                <TranslationPanel
                  ahead={translationAhead}
                  aiEngine={aiEngineSummary}
                  browserSupported={browserSupported}
                  engineKind={translation.engineKind}
                  onClear={translation.clear}
                  onEngineChange={translation.chooseEngine}
                  onRetry={translation.retry}
                  onStart={(next, engine) => {
                    setTranslationVisible(true);
                    void translation.start(next, engine);
                  }}
                  onStop={translation.stop}
                  onViewChange={changeTranslationView}
                  pair={translationPair}
                  parallelAvailable={parallelFits}
                  phase={translation.phase}
                  snapshot={translationSnapshot}
                  sourceGuess={sourceLanguageGuess}
                  unitCount={isPdf ? (pages?.total ?? 0) : (structuredSections?.length ?? 0)}
                  unitNoun={isPdf ? { plural: "páginas", singular: "página" } : { plural: "secciones", singular: "sección" }}
                  view={translationView}
                />
              )}
            </Popover>
          ) : null}
          <Popover
            onOpenChange={setAppearanceOpen}
            open={appearanceOpen}
            title="Apariencia de lectura"
            trigger={(props) => (
              <IconButton {...props} icon="typography" label="Apariencia" shortcut="A" />
            )}
            width={340}
          >
            {(close) => <ReaderAppearance onDone={close} />}
          </Popover>
          <IconButton
            aria-controls="reader-panel"
            aria-pressed={panelOpen}
            icon="panel"
            label="Índice y detalles"
            onClick={() => setPanelOpen((open) => !open)}
            shortcut="I"
          />
          {fullscreen.supported ? (
            <IconButton
              aria-pressed={fullscreen.active}
              className={styles.hideOnSmall}
              icon={fullscreen.active ? "shrink" : "expand"}
              label={fullscreen.active ? "Salir de pantalla completa" : "Pantalla completa"}
              onClick={fullscreen.toggle}
              shortcut="F"
            />
          ) : null}
        </div>
      </header>

      {/* Mientras se lee, la cabecera se recoge en una cápsula con el título y la posición,
          como la barra compacta de los navegadores móviles. Tocarla o hacer clic la
          despliega: no hace falta desplazarse hacia atrás ni perder el sitio. */}
      <button
        aria-label={`Mostrar los controles de lectura. ${displayTitle}${pageLabel ? `, ${pageLabel}` : ""}`}
        className={styles.peek}
        data-reader-peek=""
        inert={!chrome.hidden}
        onClick={chrome.show}
        type="button"
      >
        <span className={styles.peekTitle}>{displayTitle}</span>
        {peekPosition ? <span className={styles.peekPosition}>{peekPosition}</span> : null}
      </button>

      <main
        className={styles.stage}
        id="reader-stage"
        onPointerUp={handleStagePointerUp}
        ref={previewRef}
      >
        {permissionRequired && requestPermission ? (
          <PermissionPanel
            alternate={alternateCopy}
            onRequestPermission={requestPermission}
            sourceName={sourceName ?? "el origen"}
            variant={permissionVariant}
          />
        ) : (
          <PreviewCanvas
            document={document}
            source={source ?? document}
            initialPercent={progressPercent}
            onKindChange={setPreviewKind}
            onOutline={setOutline}
            onPageChange={reportPage}
            onProgressChange={setReportedPercent}
            onReady={markContentReady}
            pageRequest={pageRequest}
            pdf={{
              cropMode,
              onCropModeChange: (active) => {
                setCropMode(active);
                if (!active) setPendingRegion(null);
              },
              onRegionClick: (id, rect) => setOpenCard({ anchor: rect, focusNote: false, id }),
              onRegionSelected: (region, rect) => setPendingRegion({ ...region, anchor: rect }),
              onRegionTools: (tools) => {
                regionToolsRef.current = tools;
              },
              parallel,
              pendingRegion,
              regions: regionMarks,
              translation: pdfTranslation,
            }}
            restartSignal={restartSignal}
            resumeRequested={resumeRequested}
            structured={{
              onSectionChange: setCurrentSection,
              onSections: setStructuredSections,
              parallel,
              translation: sectionTranslation,
            }}
          />
        )}
      </main>

      <SelectionToolbar disabled={cropMode || postcard !== null} onAction={handleSelectionAction} rootRef={previewRef} />
      {pendingRegion ? <RegionToolbar anchor={pendingRegion.anchor} onAction={handleRegionAction} /> : null}
      {cardAnnotation && openCard ? (
        <AnnotationCard
          anchor={openCard.anchor}
          annotation={cardAnnotation}
          autoFocusNote={openCard.focusNote}
          key={cardAnnotation.id}
          onClose={() => setOpenCard(null)}
          onColor={(color) => updateAnnotation(cardAnnotation.id, { color })}
          onDelete={() => {
            void deleteAnnotation(cardAnnotation.id);
            setOpenCard(null);
          }}
          onNote={(note) => updateAnnotation(cardAnnotation.id, { note })}
          onPostcard={() => {
            setOpenCard(null);
            openAnnotationPostcard(cardAnnotation);
          }}
        />
      ) : null}
      {postcard ? <PostcardEditor content={postcard} onClose={() => setPostcard(null)} /> : null}

      {!selfScrolling && contentReady ? (
        <div aria-label="Avance del documento" className={styles.textDock} role="toolbar">
          <input
            aria-label="Posición en el documento"
            aria-valuetext={`${position} %`}
            className={styles.textScrubber}
            max={100}
            min={0}
            onChange={(event) => {
              const root = previewRef.current;
              if (root) scrollToReadingPosition(root, Number(event.target.value), "auto");
            }}
            style={{ "--scrub": position / 100 } as React.CSSProperties}
            type="range"
            value={position}
          />
          <span className={styles.textDockValue}>{position} %</span>
        </div>
      ) : null}

      <div data-reader-chrome-ignore="" id="reader-panel">
        <Sheet
          description={document.meta}
          modal={false}
          onClose={() => setPanelOpen(false)}
          open={panelOpen}
          title={document.title}
          width={360}
        >
          <ReaderPanel
            document={document}
            notes={{
              annotations,
              onClear: () => void clearDocumentAnnotations(document.id),
              onDelete: (id) => void deleteAnnotation(id),
              onExport: () =>
                navigator.clipboard.writeText(annotationsToMarkdown(annotations, { author: displayAuthor, title: displayTitle })),
              onOpen: goToAnnotation,
              onPostcard: openAnnotationPostcard,
            }}
            onNavigate={goToOutlineItem}
            onRestart={restartReading}
            outline={outline}
            pages={pages}
            previewKind={previewKind}
            progressPercent={progressPercent}
          />
        </Sheet>
      </div>
    </div>
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Posición actual —no el máximo alcanzado— para la barra de avance y la línea superior.
 * El progreso que se guarda solo crece; la posición sube y baja con la lectura.
 */
function useScrollPosition(rootRef: React.RefObject<HTMLElement | null>, active: boolean) {
  const [position, setPosition] = useState(0);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    function measure() {
      frame = 0;
      const root = rootRef.current;
      if (!root) return;
      const rootTop = window.scrollY + root.getBoundingClientRect().top;
      const readable = Math.max(root.offsetHeight - window.innerHeight * 0.35, 1);
      const cursor = window.scrollY + window.innerHeight * 0.65;
      setPosition(Math.min(100, Math.max(0, Math.round(((cursor - rootTop) / readable) * 100))));
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [active, rootRef]);

  return position;
}

export function ReaderMessage({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  const placement = useContext(ReaderPlacementContext);
  return (
    <>
      <PageHeader description={description} eyebrow={eyebrow} title={title} />
      <Card className={styles.readerStatus} tone="subtle">
        <h2>Regresa a {placement.backLabel}</h2>
        <p>{description}</p>
        <div>
          <Link
            className={buttonClassName({ size: "md", variant: "primary" })}
            href={placement.backHref}
          >
            Explorar documentos
          </Link>
        </div>
      </Card>
    </>
  );
}

type PermissionProps = {
  permissionRequired: boolean;
  permissionVariant: "drive" | "local";
  requestPermission?: () => Promise<PermissionRequestOutcome>;
  sourceName?: string | undefined;
};

/**
 * Abre un libro. Si tiene varias copias idénticas (`book-copies.ts`), el estado —progreso,
 * notas, traducciones, ficha— va siempre con la principal, y el archivo se lee de la mejor
 * copia disponible: la local con permiso, la importada o, con sesión, la de Drive. Si la copia
 * preferida necesita permiso, el panel ofrece abrir la otra.
 */
export function LocalDocumentReader({
  documentId,
  resumeRequested = false,
}: {
  documentId: string;
  resumeRequested?: boolean;
}) {
  const importedLibrary = useImportedDocuments();
  const linkedFiles = useLinkedFiles();
  const linkedFolders = useLinkedFolders();
  const driveLibrary = useDriveLibrary();
  const connection = useDriveConnection();
  const groups = useCopyGroups();
  const [chosenCopyId, setChosenCopyId] = useState<string | null>(null);
  const stores = [importedLibrary, linkedFiles, linkedFolders, driveLibrary];
  const group = copyGroupOf(groups, documentId);
  let resolution = resolveLocalReaderDocument(group?.canonicalId ?? documentId, stores);
  // Si la principal acaba de desaparecer, se abre la pedida mientras su estado se traslada.
  if (group && resolution.status === "missing") resolution = resolveLocalReaderDocument(documentId, stores);

  if (resolution.status === "loading") {
    return (
      <ReaderMessage
        description="Recuperando los metadatos guardados en este navegador."
        eyebrow="Biblioteca local"
        title="Preparando lector"
      />
    );
  }

  if (resolution.status === "error") {
    return (
      <ReaderMessage
        description={resolution.message}
        eyebrow="Almacenamiento no disponible"
        title="No pudimos abrir la Biblioteca local"
      />
    );
  }

  if (resolution.status === "missing") {
    return (
      <ReaderMessage
        description="El documento pudo eliminarse, cambiar de carpeta o pertenecer a otra sesión local."
        eyebrow="Documento no encontrado"
        title="Este archivo ya no está en la Biblioteca"
      />
    );
  }

  const document = resolution.document;
  const copies = (group?.copyIds ?? [document.id])
    .map((id) => resolveLocalReaderDocument(id, stores))
    .flatMap((found) => (found.status === "found" ? [found.document] : []))
    .sort((left, right) =>
      // La copia que se pidió expresamente (desde Drive, por ejemplo) va primero.
      left.id === documentId ? -1 : right.id === documentId ? 1 : compareCopyPreference(left, right),
    );

  function canOpen(copy: LocalDocument) {
    if (isFolderDocument(copy)) {
      return linkedFolders.sources.find((item) => item.id === copy.sourceId)?.permission === "granted";
    }
    if (isLinkedFileDocument(copy)) return copy.availability === "available";
    if (isDriveDocument(copy)) return connection.tokenReady;
    return true;
  }

  function access(copy: LocalDocument): PermissionProps {
    if (isFolderDocument(copy)) {
      const folder = linkedFolders.sources.find((item) => item.id === copy.sourceId);
      return {
        permissionRequired: folder?.permission !== "granted",
        permissionVariant: "local",
        requestPermission: () => requestLinkedFolderReadPermission(copy.sourceId),
        sourceName: folder?.name,
      };
    }
    if (isLinkedFileDocument(copy)) {
      return {
        permissionRequired: copy.availability !== "available",
        permissionVariant: "local",
        requestPermission: () => requestLinkedFileReadPermission(copy.id),
        sourceName: copy.originalName,
      };
    }
    if (isDriveDocument(copy)) {
      return {
        permissionRequired: !connection.tokenReady,
        permissionVariant: "drive",
        requestPermission: async () => {
          const outcome = await connectDrive();
          return outcome === "granted" ? "granted" : outcome === "blocked" ? "unanswered" : "denied";
        },
        sourceName: copy.originalName,
      };
    }
    return { permissionRequired: false, permissionVariant: "local" };
  }

  const source =
    copies.find((copy) => copy.id === chosenCopyId) ?? copies.find(canOpen) ?? copies[0] ?? document;
  const sourceAccess = access(source);
  const other = sourceAccess.permissionRequired
    ? copies.find((copy) => copy.id !== source.id && copy.reference.kind !== source.reference.kind)
    : undefined;

  return (
    <LocalReaderShell
      alternateCopy={
        other
          ? {
              label: isDriveDocument(other) ? "Abrir la copia de Google Drive" : "Abrir la copia local",
              onSelect: () => setChosenCopyId(other.id),
            }
          : undefined
      }
      document={document}
      key={document.id}
      {...sourceAccess}
      resumeRequested={resumeRequested}
      source={source}
    />
  );
}
