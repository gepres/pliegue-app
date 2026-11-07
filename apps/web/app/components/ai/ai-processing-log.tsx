"use client";

import { useEffect, useMemo, useState } from "react";

import { Button, Card } from "@pliegue/ui";

import { budgetProviderNames } from "../../ai/ai-budget";
import { removeDocumentCatalogRecords } from "../../ai/document-catalog-store";
import {
  dayKey,
  matchesFilter,
  processingExport,
  processingFlowNames,
  processingRetentionDays,
  processingRouteNames,
  routeSent,
  summarizeProcessing,
  type ProcessingEntry,
  type ProcessingFilter,
} from "../../ai/processing-log";
import { clearProcessingLog, readProcessingLog, useProcessingLog } from "../../ai/processing-log-store";
import { removeSemanticDocuments } from "../../library/semantic-index-store";
import { sensitivityNames } from "../../library/sensitivity";
import { clearEngineTranslations } from "../../library/translation-store";
import { useLibraryDocuments } from "../../library/use-library-documents";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Segmented } from "../app-ui/controls";
import { downloadJson } from "../catalog-template-download";
import styles from "./ai-processing-log.module.css";

const pageSize = 30;

const providerNames: Record<string, string> = { ...budgetProviderNames, browser: "Traductor del navegador" };

const when = new Intl.DateTimeFormat("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
const number = (value: number) => value.toLocaleString("es");
const count = (value: number, one: string, many: string) => `${number(value)} ${value === 1 ? one : many}`;

const filters: ReadonlyArray<{ label: string; value: ProcessingFilter }> = [
  { label: "Todo", value: "all" },
  { label: "Fuera del equipo", value: "cloud" },
  { label: "En tu equipo", value: "device" },
  { label: "No salieron", value: "kept" },
];

function providerLabel(entry: ProcessingEntry) {
  const name = providerNames[entry.provider] ?? entry.provider;
  return entry.model ? `${name} · ${entry.model}` : name;
}

function amounts(entry: ProcessingEntry) {
  if (!routeSent(entry.route)) return "No se envió nada.";
  const parts = [
    entry.sent ? sentLabel[entry.flow](entry.sent) : "",
    entry.characters ? count(entry.characters, "carácter enviado", "caracteres enviados") : "",
    entry.tokens ? count(entry.tokens, "token", "tokens") : "",
    entry.failed ? count(entry.failed, "fallo", "fallos") : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

const sentLabel: Record<ProcessingEntry["flow"], (value: number) => string> = {
  ask: (value) => count(value, "fragmento", "fragmentos"),
  catalog: (value) => count(value, "ficha", "fichas"),
  index: (value) => count(value, "fragmento", "fragmentos"),
  translate: (value) => count(value, "página o sección", "páginas o secciones"),
};

const derivativeLabel: Record<ProcessingEntry["flow"], string> = {
  ask: "",
  catalog: "Borrar la ficha",
  index: "Borrar el índice",
  translate: "Borrar lo traducido",
};

/** Dónde se procesó; si no salió, dónde habría ido. */
function placeLabel(entry: ProcessingEntry) {
  if (entry.place === "device") return "En tu equipo";
  return routeSent(entry.route) ? "Fuera del equipo" : "en la nube, no lo recibió";
}

/** Hay algo que la IA devolvió y se puede borrar: la ficha o lo traducido con ese motor. */
function hasDerivative(entry: ProcessingEntry) {
  // Consultar no guarda nada que borrar: la respuesta no se queda (las notas son de la persona).
  if (entry.flow === "ask") return false;
  return routeSent(entry.route) && entry.sent > 0 && (entry.flow !== "translate" || Boolean(entry.engine));
}

/**
 * Ajustes → IA: el registro de la IA (04.6). Qué libro pasó por qué proveedor, sin textos, con
 * lo que el router de sensibilidad no dejó salir; desde aquí se borra lo que devolvió la IA de un
 * libro, el registro entero o se descarga.
 */
export function AiProcessingLog() {
  const stored = useProcessingLog();
  const { rawDocuments } = useLibraryDocuments();
  const [filter, setFilter] = useState<ProcessingFilter>("all");
  const [shown, setShown] = useState(pageSize);
  const [status, setStatus] = useState<string | null>(null);

  // Lo que pasó de los 90 días se va al abrir el panel.
  useEffect(() => {
    readProcessingLog();
  }, []);

  const titles = useMemo(() => new Map(rawDocuments.map((document) => [document.id, document.title])), [rawDocuments]);
  const titleOf = (documentId: string) => titles.get(documentId) ?? null;

  const entries = useMemo(() => [...stored].sort((left, right) => right.lastAt.localeCompare(left.lastAt)), [stored]);
  const summary = summarizeProcessing(entries);
  const visible = entries.filter((entry) => matchesFilter(entry, filter));

  async function removeDerivative(entry: ProcessingEntry) {
    const title = titleOf(entry.documentId);
    const book = title ? `«${title}»` : "este libro";
    if (entry.flow === "catalog") {
      const confirmed = await confirmAction({
        confirmLabel: "Borrar la ficha",
        description: `Se borra lo que dedujo ${providerLabel(entry)}: título, autores, materia y resumen.`,
        details: [
          "El libro se queda en la biblioteca, con lo que diga su archivo.",
          "Vuelve a la cola de catalogar: si catalogas otra vez, se envía de nuevo.",
        ],
        icon: "trash",
        title: `¿Borrar la ficha de la IA de ${book}?`,
        tone: "danger",
      });
      if (!confirmed) return;
      const removed = await removeDocumentCatalogRecords([entry.documentId]).catch(() => 0);
      setStatus(removed ? `Se borró la ficha de ${book}.` : `${book[0]?.toUpperCase()}${book.slice(1)} ya no tenía ficha de la IA.`);
      return;
    }
    if (entry.flow === "index") {
      const confirmed = await confirmAction({
        confirmLabel: "Borrar el índice",
        description: `Se borran los fragmentos de ${book} y sus vectores: deja de salir en la búsqueda hasta que lo vuelvas a indexar.`,
        details: ["El libro y su ficha se quedan.", "Si vuelves a indexarlo, su texto se envía de nuevo."],
        icon: "trash",
        title: `¿Borrar el índice de búsqueda de ${book}?`,
        tone: "danger",
      });
      if (!confirmed) return;
      const removed = await removeSemanticDocuments([entry.documentId]).catch(() => 0);
      setStatus(removed ? `Se ${removed === 1 ? "borró" : "borraron"} ${count(removed, "fragmento", "fragmentos")} de ${book}.` : `${book[0]?.toUpperCase()}${book.slice(1)} ya no estaba en el índice.`);
      return;
    }
    if (!entry.engine) return;
    const confirmed = await confirmAction({
      confirmLabel: "Borrar lo traducido",
      description: `Se borran las páginas de ${book} traducidas con ${providerLabel(entry)}, a cualquier idioma.`,
      details: ["El original no se toca y lo traducido con otros motores se queda.", "Si vuelves a traducir, se envía de nuevo."],
      icon: "trash",
      title: `¿Borrar lo traducido de ${book}?`,
      tone: "danger",
    });
    if (!confirmed) return;
    const removed = await clearEngineTranslations(entry.documentId, entry.engine).catch(() => 0);
    setStatus(removed ? `Se ${removed === 1 ? "borró" : "borraron"} ${count(removed, "página traducida", "páginas traducidas")} de ${book}.` : "No quedaba nada traducido con ese motor.");
  }

  async function clearAll() {
    const confirmed = await confirmAction({
      confirmLabel: "Borrar el registro",
      description: "Se borra la lista de lo que pasó por cada proveedor en este equipo.",
      details: ["No borra fichas ni traducciones: solo el registro.", "Desde ahora se vuelve a apuntar lo que se envíe."],
      icon: "trash",
      title: "¿Borrar el registro de la IA?",
      tone: "danger",
    });
    if (!confirmed) return;
    clearProcessingLog();
    setShown(pageSize);
    setStatus("Registro borrado.");
  }

  function download() {
    const now = new Date();
    downloadJson(`pliegue-registro-ia-${dayKey(now)}.json`, JSON.stringify(processingExport(entries, titleOf, now), null, 2));
    setStatus(`Registro descargado: ${count(entries.length, "entrada", "entradas")}.`);
  }

  return (
    <Card aria-labelledby="ai-log-title" as="section" className={styles.panel}>
      <div className={styles.intro}>
        <h2 id="ai-log-title">Registro de la IA</h2>
        <p>
          Qué libros pasaron por qué proveedor, para qué y si salieron de este equipo. No guarda textos ni claves: el
          libro, el proveedor, el modelo y cuánto se envió. Se guarda {processingRetentionDays} días en este equipo y no viaja
          con la cuenta.
        </p>
        <p>
          Pliegue no cambia de proveedor por su cuenta: si uno falla o un libro no puede salir por su sensibilidad, se para
          y queda apuntado aquí con su razón.
        </p>
      </div>

      {entries.length ? (
        <>
          <dl className={styles.summary}>
            <div>
              <dt>Salieron del equipo</dt>
              <dd>
                {count(summary.cloudBooks, "libro", "libros")}
                {summary.cloudProviders.length ? (
                  <span className={styles.muted}> · {summary.cloudProviders.map((provider) => providerNames[provider] ?? provider).join(", ")}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>En tu equipo</dt>
              <dd>{count(summary.deviceBooks, "libro", "libros")}</dd>
            </div>
            <div>
              <dt>No salieron por su sensibilidad</dt>
              <dd>{count(summary.keptBooks, "libro", "libros")}</dd>
            </div>
          </dl>

          <Segmented
            label="Qué enseñar"
            onChange={(value) => {
              setFilter(value);
              setShown(pageSize);
            }}
            options={filters}
            size="sm"
            value={filter}
          />

          {visible.length ? (
            <ol aria-label="Registro" className={styles.list}>
              {visible.slice(0, shown).map((entry) => {
                const title = titleOf(entry.documentId);
                return (
                  <li className={styles.entry} data-place={entry.place} data-route={entry.route} key={entry.key}>
                    <div className={styles.head}>
                      <span className={styles.flow}>{processingFlowNames[entry.flow]}</span>
                      <time dateTime={entry.lastAt}>{when.format(new Date(entry.lastAt))}</time>
                    </div>
                    <p className={styles.book}>{title ?? <span className={styles.muted}>Un libro que ya no está en tu biblioteca</span>}</p>
                    <p className={styles.line}>
                      {routeSent(entry.route) ? null : "Proveedor elegido: "}
                      {providerLabel(entry)}
                      <span className={styles.place}>{placeLabel(entry)}</span>
                    </p>
                    <p className={styles.route}>
                      {processingRouteNames[entry.route]}
                      <span className={styles.muted}> · Sensibilidad: {sensitivityNames[entry.sensitivity]}</span>
                    </p>
                    <p className={styles.line}>{amounts(entry)}</p>
                    {hasDerivative(entry) ? (
                      <div>
                        <Button onClick={() => void removeDerivative(entry)} size="sm" variant="quiet">
                          {derivativeLabel[entry.flow]}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={styles.note}>Nada con este filtro.</p>
          )}
          {visible.length > shown ? (
            <div>
              <Button onClick={() => setShown((current) => current + pageSize)} size="sm" variant="secondary">
                Ver {Math.min(pageSize, visible.length - shown)} más
              </Button>
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button onClick={download} variant="secondary">
              Descargar el registro
            </Button>
            <Button onClick={() => void clearAll()} variant="quiet">
              Borrar el registro
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.note}>Todavía no ha pasado ningún libro por la IA en este equipo.</p>
      )}
      <p aria-live="polite" className={styles.note} role="status">
        {status}
      </p>
    </Card>
  );
}
