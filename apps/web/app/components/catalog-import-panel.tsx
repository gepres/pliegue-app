"use client";

import { useRef, useState } from "react";

import { Button, Card, Tag } from "@pliegue/ui";

import {
  type CatalogImportIssue,
  type CatalogImportParseResult,
  createImportedCatalogRecords,
  type ImportedCatalogRecord,
  matchImportedCatalogs,
  parseCatalogImportFile,
} from "../library/catalog-import";
import {
  catalogTemplateFileName,
  createCatalogTemplate,
  serializeCatalogTemplate,
} from "../library/catalog-template";
import type { LibraryDocument } from "../library/documents";
import {
  removeImportedCatalogRecords,
  saveImportedCatalogRecords,
  useImportedCatalogs,
} from "../library/imported-catalog-store";
import styles from "../(workspace)/app/workspace.module.css";

const dialectLabels: Record<CatalogImportParseResult["dialect"], string> = {
  "csl-json": "CSL-JSON · Zotero",
  "dublin-core": "Dublin Core",
  pliegue: "Plantilla de Pliegue",
  "schema-org": "schema.org · JSON-LD",
};

interface ImportPreview {
  dialect: CatalogImportParseResult["dialect"];
  fileName: string;
  issues: CatalogImportIssue[];
  matched: number;
  pending: number;
  records: ImportedCatalogRecord[];
}

function downloadJson(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function describeParseError(error: unknown) {
  if (error instanceof SyntaxError) {
    return "El archivo no es JSON válido. Revisa que no falte una coma o una llave.";
  }
  return error instanceof Error ? error.message : "No fue posible leer el archivo.";
}

export function CatalogImportPanel({ documents }: { documents: readonly LibraryDocument[] }) {
  const importedCatalogs = useImportedCatalogs();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Descarga la plantilla con tus documentos, complétala y vuelve a subirla para crear el índice sin gastar IA.",
  );

  function handleTemplateDownload() {
    const template = createCatalogTemplate(documents);
    downloadJson(catalogTemplateFileName(template.generatedAt), serializeCatalogTemplate(template));
    setStatus(
      `Plantilla descargada con ${template.entries.length} documento${
        template.entries.length === 1 ? "" : "s"
      }. Conserva «fileName» y «fingerprint» tal como están.`,
    );
  }

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    setBusy(true);

    try {
      const parsed = parseCatalogImportFile(JSON.parse(await file.text()));
      const records = createImportedCatalogRecords(parsed);
      const { byDocumentId, pending } = matchImportedCatalogs(documents, records);

      setPreview({
        dialect: parsed.dialect,
        fileName: file.name,
        issues: parsed.issues,
        matched: byDocumentId.size,
        pending: pending.length,
        records,
      });
      setStatus(
        records.length
          ? "Revisa el resumen y confirma para escribir las fichas en este dispositivo."
          : "El archivo se leyó, pero ninguna entrada trae el nombre del archivo al que pertenece.",
      );
    } catch (error) {
      setPreview(null);
      setStatus(describeParseError(error));
    } finally {
      setBusy(false);
      // Sin esto, volver a elegir el mismo archivo tras corregirlo no dispara el evento.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleApply() {
    if (!preview) return;
    setBusy(true);

    try {
      await saveImportedCatalogRecords(preview.records);
      setStatus(
        `${preview.matched} ficha${preview.matched === 1 ? "" : "s"} aplicada${
          preview.matched === 1 ? "" : "s"
        }${
          preview.pending
            ? ` y ${preview.pending} en espera de su archivo`
            : ""
        }. Las fichas escritas a mano prevalecen sobre las del catálogo IA.`,
      );
      setPreview(null);
    } catch {
      setStatus("No fue posible guardar las fichas en este navegador.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    const confirmed = window.confirm(
      "¿Descartar todas las fichas importadas? Los documentos conservarán la ficha que haya generado la IA.",
    );
    if (!confirmed) return;

    setBusy(true);

    try {
      await removeImportedCatalogRecords(importedCatalogs.records.map((record) => record.matchKey));
      setStatus("Se descartaron las fichas importadas.");
    } catch {
      setStatus("No fue posible descartar las fichas importadas.");
    } finally {
      setBusy(false);
    }
  }

  const storedPending = matchImportedCatalogs(documents, importedCatalogs.records).pending.length;

  return (
    <Card
      aria-labelledby="catalog-import-title"
      as="section"
      className={styles.localImportPanel}
      id="importar-indice"
      tone="subtle"
    >
      <div>
        <Tag>Índice por archivo · sin IA</Tag>
        <h2 id="catalog-import-title">Crea el índice desde un archivo JSON</h2>
        <p>
          Descarga la plantilla con tus documentos, complétala donde falte y vuelve a subirla.
          También se aceptan exportaciones CSL-JSON de Zotero, volcados Dublin Core y JSON-LD de
          schema.org. Una ficha cuyo archivo aún no esté vinculado queda en espera y se aplica
          sola cuando lo vincules.
        </p>
      </div>

      <div className={styles.localImportActions}>
        <Button
          aria-describedby="catalog-import-status"
          disabled={busy || !documents.length}
          onClick={handleTemplateDownload}
          variant="secondary"
        >
          Descargar plantilla
        </Button>
        <Button disabled={busy} onClick={() => fileInputRef.current?.click()} variant="quiet">
          {busy ? "Leyendo archivo…" : "Importar índice JSON"}
        </Button>
        {importedCatalogs.records.length ? (
          <Button disabled={busy} onClick={() => void handleClear()} variant="quiet">
            Descartar importadas
          </Button>
        ) : null}
        <input
          accept="application/json,.json"
          aria-label="Seleccionar archivo JSON de índice"
          className={styles.fileInput}
          onChange={(event) => void handleFile(event.target.files)}
          ref={fileInputRef}
          type="file"
        />
        <span>
          {importedCatalogs.records.length} ficha
          {importedCatalogs.records.length === 1 ? "" : "s"} importada
          {importedCatalogs.records.length === 1 ? "" : "s"}
          {storedPending ? ` · ${storedPending} en espera` : ""}
        </span>
      </div>

      {preview ? (
        <div className={styles.capabilityNote} role="note">
          <strong>
            {preview.fileName} · {dialectLabels[preview.dialect]}
          </strong>
          <p>
            {preview.matched} ficha{preview.matched === 1 ? "" : "s"} se aplicará
            {preview.matched === 1 ? "" : "n"} a documentos de tu biblioteca
            {preview.pending
              ? `, ${preview.pending} quedará${preview.pending === 1 ? "" : "n"} en espera`
              : ""}
            {preview.issues.length
              ? ` y ${preview.issues.length} entrada${
                  preview.issues.length === 1 ? "" : "s"
                } no se puede${preview.issues.length === 1 ? "" : "n"} usar`
              : ""}
            .
          </p>

          {preview.issues.length ? (
            <ul aria-label="Entradas descartadas" className={styles.folderSourceList}>
              {preview.issues.slice(0, 8).map((issue) => (
                <li className={styles.folderSourceItem} key={issue.position}>
                  <div>
                    <div className={styles.folderSourceTitle}>
                      <strong>{issue.title ?? `Entrada ${issue.position}`}</strong>
                      <Tag>Línea {issue.position}</Tag>
                    </div>
                    <span className={styles.folderSourceMeta}>{issue.reason}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <div className={styles.localImportActions}>
            <Button disabled={busy || !preview.records.length} onClick={() => void handleApply()}>
              {busy ? "Guardando…" : `Aplicar ${preview.records.length} ficha${
                preview.records.length === 1 ? "" : "s"
              }`}
            </Button>
            <Button disabled={busy} onClick={() => setPreview(null)} variant="quiet">
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <p
        aria-label="Estado de la importación del índice"
        aria-live="polite"
        id="catalog-import-status"
        role="status"
      >
        {importedCatalogs.error ?? status}
      </p>
    </Card>
  );
}
