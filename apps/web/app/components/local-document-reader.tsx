"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import {
  createLocalDocumentPreview,
  type LocalDocumentPreview,
} from "../library/local-document-preview";
import type { StructuredDocumentBlock } from "../library/structured-document-extractor";
import type { LinkedFolderDocument } from "../library/local-folder";
import {
  readLinkedDocumentFile,
  requestLinkedFolderReadPermission,
  useLinkedFolders,
} from "../library/local-folder-store";
import type { ImportedDocument } from "../library/local-file-metadata";
import {
  readImportedDocumentFile,
  useImportedDocuments,
} from "../library/local-library-store";
import { PageHeader } from "./workspace-page";
import styles from "./local-document-reader.module.css";

type LocalDocument = ImportedDocument | LinkedFolderDocument;

type PreviewState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { preview: LocalDocumentPreview; status: "ready" };

function isLinkedDocument(document: LocalDocument): document is LinkedFolderDocument {
  return "sourceId" in document;
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

function PreviewCanvas({ document }: { document: LocalDocument }) {
  const documentId = document.id;
  const format = document.format;
  const sourceId = isLinkedDocument(document) ? document.sourceId : null;
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    async function loadPreview() {
      try {
        const record = sourceId
          ? await readLinkedDocumentFile(documentId, sourceId)
          : await readImportedDocumentFile(documentId);

        if (!record) throw new Error("El archivo ya no está disponible en su origen local.");

        const blob = "file" in record ? record.file : record.blob;
        const preview = await createLocalDocumentPreview(format, blob);
        if (active) setState({ preview, status: "ready" });
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
  }, [documentId, format, sourceId]);

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
    return (
      <Card className={styles.readerStatus} role="alert" tone="subtle">
        <Tag>No disponible</Tag>
        <h2>No pudimos abrir el archivo</h2>
        <p>{state.message}</p>
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
  document,
  sourceName,
}: {
  document: LinkedFolderDocument;
  sourceName: string;
}) {
  const [requestState, setRequestState] = useState<"idle" | "requesting" | "denied" | "error">(
    "idle",
  );

  async function requestAccess() {
    setRequestState("requesting");

    try {
      const permission = await requestLinkedFolderReadPermission(document.sourceId);
      if (permission !== "granted") setRequestState("denied");
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
          : requestState === "error"
            ? "No fue posible recuperar el acceso a esta carpeta."
            : "El permiso solo se usa para leer los archivos que elegiste."}
      </p>
    </Card>
  );
}

function ReaderDetails({ document }: { document: LocalDocument }) {
  return (
    <aside className={styles.documentDetails}>
      <Card>
        <Tag>{document.imported ? "Copia privada" : "Carpeta vinculada"}</Tag>
        <h2>Sobre este archivo</h2>
        <dl>
          <div>
            <dt>Formato</dt>
            <dd>{document.format.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Origen</dt>
            <dd>{document.imported ? "IndexedDB local" : "Archivo original"}</dd>
          </div>
          <div>
            <dt>Disponibilidad</dt>
            <dd>
              {document.imported
                ? "Disponible offline"
                : document.availability === "available"
                  ? "Disponible"
                  : "Permiso requerido"}
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

function LocalReaderShell({ document, children }: { document: LocalDocument; children: ReactNode }) {
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
        <main className={styles.previewArea}>{children}</main>
        <ReaderDetails document={document} />
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

export function LocalDocumentReader({ documentId }: { documentId: string }) {
  const importedLibrary = useImportedDocuments();
  const linkedFolders = useLinkedFolders();
  const importedDocument = importedLibrary.documents.find((item) => item.id === documentId);
  const linkedDocument = linkedFolders.documents.find((item) => item.id === documentId);

  if (importedLibrary.status === "error" || linkedFolders.status === "error") {
    return (
      <ReaderMessage
        description={
          importedLibrary.error ??
          linkedFolders.error ??
          "No fue posible recuperar la biblioteca de este navegador."
        }
        eyebrow="Almacenamiento no disponible"
        title="No pudimos abrir la Biblioteca local"
      />
    );
  }

  if (importedLibrary.status !== "ready" || linkedFolders.status !== "ready") {
    return (
      <ReaderMessage
        description="Recuperando los metadatos guardados en este navegador."
        eyebrow="Biblioteca local"
        title="Preparando lector"
      />
    );
  }

  if (importedDocument) {
    return (
      <LocalReaderShell document={importedDocument}>
        <PreviewCanvas document={importedDocument} key={importedDocument.id} />
      </LocalReaderShell>
    );
  }

  if (linkedDocument) {
    const source = linkedFolders.sources.find((item) => item.id === linkedDocument.sourceId);

    return (
      <LocalReaderShell document={linkedDocument}>
        {source?.permission === "granted" ? (
          <PreviewCanvas document={linkedDocument} key={linkedDocument.id} />
        ) : (
          <PermissionPanel document={linkedDocument} sourceName={source?.name ?? "la carpeta"} />
        )}
      </LocalReaderShell>
    );
  }

  return (
    <ReaderMessage
      description="El documento pudo eliminarse, cambiar de carpeta o pertenecer a otra sesión local."
      eyebrow="Documento no encontrado"
      title="Este archivo ya no está en la Biblioteca"
    />
  );
}
