"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import {
  createLocalDocumentPreview,
  type LocalDocumentPreview,
} from "../library/local-document-preview";
import type { StructuredDocumentBlock } from "../library/structured-document-extractor";
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
import { PageHeader } from "./workspace-page";
import styles from "./local-document-reader.module.css";

type LocalDocument = LocalReaderDocument;

const readerIndexLabels = {
  error: "No disponible",
  indexed: "Contenido indexado",
  "metadata-only": "Solo metadatos",
  pending: "Pendiente",
} as const;

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

function ExtractedBlock({
  block,
  sectionTitle,
}: {
  block: StructuredDocumentBlock;
  sectionTitle: string;
}) {
  if (block.kind === "heading") {
    return block.level <= 2 ? <h3>{block.text}</h3> : <h4>{block.text}</h4>;
  }

  if (block.kind === "paragraph") return <p>{block.text}</p>;

  return (
    <div
      aria-label={`Tabla extraída de ${sectionTitle}`}
      className={styles.extractedTableViewport}
      role="region"
      tabIndex={0}
    >
      <table>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`}>{cell || "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BinaryPreview({
  document,
  preview,
}: {
  document: LocalDocument;
  preview: Extract<LocalDocumentPreview, { blob: Blob }>;
}) {
  const objectRef = useRef<HTMLObjectElement>(null);
  const openLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(preview.blob);
    const objectElement = objectRef.current;
    const openLink = openLinkRef.current;
    if (objectElement) objectElement.data = objectUrl;
    if (openLink) openLink.href = objectUrl;

    return () => {
      objectElement?.removeAttribute("data");
      openLink?.removeAttribute("href");
      URL.revokeObjectURL(objectUrl);
    };
  }, [preview.blob]);

  if (preview.kind === "image") {
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

  return (
    <div className={styles.pdfPreview}>
      <div className={styles.previewCaption}>
        <span>PDF original</span>
        <a ref={openLinkRef} rel="noreferrer" target="_blank">
          Abrir en otra pestaña
        </a>
      </div>
      <object
        aria-label={`Documento PDF: ${document.title}`}
        ref={objectRef}
        type="application/pdf"
      >
        <p>El navegador no pudo mostrar el PDF. Usa “Abrir en otra pestaña”.</p>
      </object>
    </div>
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
          {preview.sections.length} sección{preview.sections.length === 1 ? "" : "es"}
        </span>
      </div>
      {preview.truncated ? (
        <p className={styles.truncationNote} role="status">
          Esta vista alcanzó un límite de seguridad o extensión. Mostramos el contenido
          disponible sin modificar el archivo original.
        </p>
      ) : null}
      <div className={styles.structuredSections}>
        {preview.sections.map((section) => {
          const headingId = `extracted-${section.id}`;

          return (
            <section
              aria-labelledby={headingId}
              className={styles.structuredSection}
              key={section.id}
            >
              <header>
                <span>{section.label}</span>
                <h2 id={headingId}>{section.title}</h2>
              </header>
              <div className={styles.extractedBlocks}>
                {section.blocks.map((block, index) => (
                  <ExtractedBlock
                    block={block}
                    key={`${section.id}-${block.kind}-${index}`}
                    sectionTitle={section.title}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

function PreviewCanvas({
  document,
  onReady,
}: {
  document: LocalDocument;
  onReady: () => void;
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
        <pre>{preview.content}</pre>
      </article>
    );
  }

  if (preview.kind === "image" || preview.kind === "pdf") {
    return <BinaryPreview document={document} preview={preview} />;
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

function ReaderDetails({
  document,
  onRestart,
  progressPercent,
}: {
  document: LocalDocument;
  onRestart: () => void;
  progressPercent: number;
}) {
  const sourceLabel =
    document.reference.kind === "local-file"
      ? "Archivo original"
      : document.reference.kind === "local-folder"
        ? "Carpeta vinculada"
        : "Copia de compatibilidad";
  const storageLabel =
    document.reference.kind === "local-copy"
      ? "Blob en IndexedDB"
      : "Handle seguro en IndexedDB";

  return (
    <aside className={styles.documentDetails}>
      <Card>
        <Tag>Progreso local</Tag>
        <h2>{progressPercent} % leído</h2>
        <div
          aria-label={`Progreso de lectura: ${progressPercent} por ciento`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progressPercent}
          className={styles.readingProgressBar}
          role="progressbar"
        >
          <div
            className={styles.readingProgressValue}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p>Se actualiza al desplazarte y se comparte entre pestañas de este navegador.</p>
        {progressPercent > 0 ? (
          <Button onClick={onRestart} size="sm" variant="quiet">
            Empezar desde el inicio
          </Button>
        ) : null}
      </Card>
      <Card>
        <Tag>{sourceLabel}</Tag>
        <h2>Sobre este archivo</h2>
        <dl>
          <div>
            <dt>Formato</dt>
            <dd>{document.format.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Origen</dt>
            <dd>{storageLabel}</dd>
          </div>
          <div>
            <dt>Disponibilidad</dt>
            <dd>
              {document.reference.kind === "local-copy"
                ? "Copia disponible offline"
                : document.availability === "available"
                  ? "Disponible"
                  : "Permiso requerido"}
            </dd>
          </div>
          <div>
            <dt>Índice local</dt>
            <dd>
              {document.indexStatus
                ? readerIndexLabels[document.indexStatus]
                : "Estado desconocido"}
            </dd>
          </div>
        </dl>
      </Card>
      <Card>
        <h2>Privacidad por diseño</h2>
        <p>
          Esta vista se prepara dentro del navegador. El documento no sale de tu dispositivo.
        </p>
      </Card>
    </aside>
  );
}

function scrollToReadingPosition(root: HTMLElement, percent: number, behavior: ScrollBehavior) {
  const rootTop = window.scrollY + root.getBoundingClientRect().top;
  const readableDistance = Math.max(root.offsetHeight - window.innerHeight * 0.35, 0);
  const target = rootTop + readableDistance * (percent / 100) - window.innerHeight * 0.2;
  window.scrollTo({ behavior, top: Math.max(0, target) });
}

function useDocumentProgress(
  document: LocalDocument,
  contentReady: boolean,
  resumeRequested: boolean,
  rootRef: React.RefObject<HTMLElement | null>,
) {
  const { format, id, origin, title } = document;
  const progress = useReadingProgress(document.id);
  const lastPersistedRef = useRef(progress?.percent ?? 0);
  const hasResumedRef = useRef(false);

  useEffect(() => {
    lastPersistedRef.current = progress?.percent ?? 0;
  }, [progress?.percent]);

  useEffect(() => {
    saveReadingProgress({ format, id, origin, title }, 0);
  }, [format, id, origin, title]);

  useEffect(() => {
    if (!contentReady) return;
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
  }, [contentReady, document, rootRef]);

  useEffect(() => {
    if (
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
  }, [contentReady, progress, resumeRequested, rootRef]);

  const restart = useCallback(() => {
    const root = rootRef.current;
    saveReadingProgress(document, 0, { allowRegression: true });
    lastPersistedRef.current = 0;
    hasResumedRef.current = false;
    if (root) scrollToReadingPosition(root, 0, "smooth");
  }, [document, rootRef]);

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
  const previewRef = useRef<HTMLElement>(null);
  const markContentReady = useCallback(() => setContentReady(true), []);
  const { progressPercent, restart } = useDocumentProgress(
    document,
    contentReady,
    resumeRequested,
    previewRef,
  );

  return (
    <>
      <PageHeader
        actions={
          <Link
            className={buttonClassName({ size: "md", variant: "secondary" })}
            href="/app/biblioteca"
          >
            ← Biblioteca
          </Link>
        }
        description={document.meta}
        eyebrow={`${document.format.toUpperCase()} · Local-only`}
        title={document.title}
      />
      <div className={styles.localReaderLayout}>
        <main className={styles.previewArea} ref={previewRef}>
          {permissionRequired && requestPermission ? (
            <PermissionPanel
              onRequestPermission={requestPermission}
              sourceName={sourceName ?? "el origen"}
            />
          ) : (
            <PreviewCanvas document={document} onReady={markContentReady} />
          )}
        </main>
        <ReaderDetails
          document={document}
          onRestart={restart}
          progressPercent={progressPercent}
        />
      </div>
    </>
  );
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
