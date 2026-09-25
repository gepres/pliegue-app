"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { useDocumentCatalogs } from "../ai/document-catalog-store";
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
import { applyImportedCatalogs } from "../library/catalog-import";
import { applyDocumentCatalogs } from "../library/documents";
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
import type { ImportedDocument } from "../library/local-file-metadata";
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
import { PdfReader, type PdfReaderProps } from "./pdf-reader";
import { PageHeader } from "./workspace-page";
import styles from "./local-document-reader.module.css";

type LocalDocument = LocalReaderDocument;


type PreviewState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { preview: LocalDocumentPreview; status: "ready" };

function isFolderDocument(document: LocalDocument): document is LinkedFolderDocument {
  return document.reference.kind === "local-folder";
}

function isLinkedFileDocument(document: LocalDocument): document is LinkedFileDocument {
  return document.reference.kind === "local-file";
}

function isImportedDocument(document: LocalDocument): document is ImportedDocument {
  return document.reference.kind === "local-copy";
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

function StructuredPreview({
  preview,
}: {
  preview: Extract<LocalDocumentPreview, { kind: "structured" }>;
}) {
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
      <div className={styles.structuredSections} data-annotation-scope="document">
        {preview.sections.map((section) => {
          const headingId = `extracted-${section.id}`;
          // Sin título propio, la sección se nombra solo por su número: «Sección 3» dos veces
          // no dice más. Y el bloque que ya es el título no se vuelve a pintar debajo.
          const untitled = section.title === section.label;
          const [lead, ...rest] = section.blocks;
          const leadIsTitle =
            (lead?.kind === "heading" || lead?.kind === "paragraph") && lead.text.trim() === section.title.trim();

          return (
            <section
              aria-labelledby={headingId}
              className={styles.structuredSection}
              key={section.id}
            >
              <header>
                <span id={untitled ? headingId : undefined}>{section.label}</span>
                {untitled ? null : <h2 id={headingId}>{section.title}</h2>}
              </header>
              <ExtractedBlocks blocks={leadIsTitle ? rest : section.blocks} sectionTitle={section.title} />
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
  "cropMode" | "onCropModeChange" | "onRegionClick" | "onRegionSelected" | "onRegionTools" | "pendingRegion" | "regions"
>;

function PreviewCanvas({
  document,
  initialPercent,
  pdf,
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
}) {
  const documentId = document.id;
  const format = document.format;
  const sourceId = isFolderDocument(document) ? document.sourceId : null;
  const referenceKind = document.reference.kind;
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showIndexedFallback, setShowIndexedFallback] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadPreview() {
      try {
        const record = sourceId
          ? await readLinkedDocumentFile(documentId, sourceId)
          : referenceKind === "local-file"
            ? await readLinkedFile(documentId)
            : await readImportedDocumentFile(documentId);

        if (!record) throw new Error("El archivo ya no está disponible en su origen local.");

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
        <Tag>Preparando</Tag>
        <h2>Abriendo el documento en este dispositivo…</h2>
        <p>El contenido no se está enviando a ningún servidor.</p>
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
            href="/app/biblioteca"
          >
            Volver a Biblioteca
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

  if (preview.kind === "structured") return <StructuredPreview preview={preview} />;

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
  onRequestPermission,
  sourceName,
}: {
  onRequestPermission: () => Promise<PermissionRequestOutcome>;
  sourceName: string;
}) {
  const [requestState, setRequestState] = useState<
    "denied" | "error" | "idle" | "requesting" | "unanswered"
  >("idle");

  async function requestAccess() {
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
      <Tag>Permiso local</Tag>
      <h2>Vuelve a autorizar «{sourceName}»</h2>
      <p>
        El navegador recuerda el vínculo, pero requiere tu permiso para leer el archivo. Pliegue
        no copiará ni subirá el contenido.
      </p>
      <div className={styles.permissionActions}>
        <Button disabled={requestState === "requesting"} onClick={() => void requestAccess()}>
          {requestState === "requesting" ? "Solicitando…" : "Permitir lectura"}
        </Button>
        <Link
          className={buttonClassName({ size: "md", variant: "quiet" })}
          href="/app/biblioteca"
        >
          Volver a Biblioteca
        </Link>
      </div>
      <p aria-live="polite" className={styles.permissionStatus} role="status">
        {requestState === "denied"
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

function LocalReaderShell({
  document,
  permissionRequired = false,
  requestPermission,
  resumeRequested,
  sourceName,
}: {
  document: LocalDocument;
  permissionRequired?: boolean;
  requestPermission?: (() => Promise<PermissionRequestOutcome>) | undefined;
  resumeRequested: boolean;
  sourceName?: string | undefined;
}) {
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
  const chrome = useReaderChrome(appearanceOpen || cropMode);
  const fullscreen = useFullscreen();

  // La ficha del documento, si la tiene: título y autor de verdad para la postal y para la
  // procedencia de cada nota, en lugar de los que se deducen del nombre del archivo.
  const aiCatalogs = useDocumentCatalogs();
  const importedCatalogs = useImportedCatalogs();
  const catalog = useMemo(
    () => applyImportedCatalogs(applyDocumentCatalogs([document], aiCatalogs.records), importedCatalogs.records)[0]?.catalog,
    [aiCatalogs.records, document, importedCatalogs.records],
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
      } else if (key === "f" && fullscreen.supported) {
        event.preventDefault();
        fullscreen.toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, selfScrolling]);

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
      data-self-scrolling={selfScrolling ? "true" : "false"}
    >
      <div aria-hidden="true" className={styles.progressLine}>
        <span style={{ transform: `scaleX(${(selfScrolling ? progressPercent : position) / 100})` }} />
      </div>

      <header className={styles.appBar} onFocus={chrome.show}>
        <Link
          aria-label="Volver a la Biblioteca"
          className={styles.appBarBack}
          href="/app/biblioteca"
        >
          <Icon name="back" />
          <span>Biblioteca</span>
        </Link>

        <div className={styles.appBarTitle}>
          <h1 title={displayTitle}>{displayTitle}</h1>
          <p>
            <span>{document.format.toUpperCase()}</span>
            {pageLabel ? <span>{pageLabel}</span> : null}
            <span>{progressPercent} % leído</span>
          </p>
        </div>

        <div className={styles.appBarActions}>
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
            onRequestPermission={requestPermission}
            sourceName={sourceName ?? "el origen"}
          />
        ) : (
          <PreviewCanvas
            document={document}
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
              pendingRegion,
              regions: regionMarks,
            }}
            restartSignal={restartSignal}
            resumeRequested={resumeRequested}
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

function ReaderMessage({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <>
      <PageHeader description={description} eyebrow={eyebrow} title={title} />
      <Card className={styles.readerStatus} tone="subtle">
        <h2>Regresa a la Biblioteca</h2>
        <p>{description}</p>
        <div>
          <Link
            className={buttonClassName({ size: "md", variant: "primary" })}
            href="/app/biblioteca"
          >
            Explorar documentos
          </Link>
        </div>
      </Card>
    </>
  );
}

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
  const resolution = resolveLocalReaderDocument(documentId, [
    importedLibrary,
    linkedFiles,
    linkedFolders,
  ]);

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

  if (isImportedDocument(document)) {
    return (
      <LocalReaderShell
        document={document}
        key={document.id}
        resumeRequested={resumeRequested}
      />
    );
  }

  if (isLinkedFileDocument(document)) {
    return (
      <LocalReaderShell
        document={document}
        key={document.id}
        permissionRequired={document.availability !== "available"}
        requestPermission={() => requestLinkedFileReadPermission(document.id)}
        resumeRequested={resumeRequested}
        sourceName={document.originalName}
      />
    );
  }

  if (isFolderDocument(document)) {
    const source = linkedFolders.sources.find((item) => item.id === document.sourceId);

    return (
      <LocalReaderShell
        document={document}
        key={document.id}
        permissionRequired={source?.permission !== "granted"}
        requestPermission={() => requestLinkedFolderReadPermission(document.sourceId)}
        resumeRequested={resumeRequested}
        sourceName={source?.name}
      />
    );
  }
}
