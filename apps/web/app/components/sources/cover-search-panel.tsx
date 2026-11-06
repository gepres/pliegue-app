"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Button, Card, Tag, buttonClassName } from "@pliegue/ui";

import { coverFromImage } from "../../library/document-cover";
import type { LibraryDocument } from "../../library/documents";
import {
  clearFetchedCovers,
  saveFetchedCovers,
  useFetchedCovers,
  type FetchedCoverRecord,
} from "../../library/fetched-cover-store";
import { coverQueryFor, findOpenLibraryCover, needsCover, type CoverQuery } from "../../library/open-library-covers";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Skeleton } from "../app-ui/skeleton";
import styles from "../../(workspace)/app/workspace.module.css";
import panel from "./cover-search-panel.module.css";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("es")} ${count === 1 ? one : many}`;

/** De dos en dos: Open Library es un servicio público y gratuito, y no hay prisa. */
const concurrency = 2;

/** Cuántas portadas y títulos se enseñan antes de «y N más»: con cientos, no cabe todo. */
const shownCovers = 12;
const shownMisses = 8;

/**
 * «Portadas de Open Library» en Fuentes (03.11, criterio 6). Lo lanza la persona y, antes de
 * enviar nada, se le dice qué sale del dispositivo. Lo que vuelve se guarda como miniatura.
 */
export function CoverSearchPanel({ documents }: { documents: readonly LibraryDocument[] }) {
  const fetched = useFetchedCovers();
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const notFound = new Set(fetched.records.filter((record) => record.status === "not-found").map((record) => record.documentId));
  const foundCount = fetched.records.filter((record) => record.status === "found").length;
  const missing = documents.filter((document) => needsCover(document));
  const queries = (retry: boolean) =>
    missing
      .filter((document) => retry || !notFound.has(document.id))
      .map((document) => coverQueryFor(document))
      .filter((query): query is CoverQuery => query !== null);
  const pending = queries(false);
  const misses = missing.filter((document) => notFound.has(document.id));
  const retryable = misses.length;

  // Qué trajo Open Library y para qué libro. Antes el panel solo daba la cuenta («2 portadas
  // encontradas de 3») y no había forma de saber cuáles ni dónde mirarlas. Lo último, primero.
  const byId = new Map(documents.map((document) => [document.id, document]));
  const foundCovers = fetched.records
    .filter((record) => record.status === "found" && record.cover)
    .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))
    .flatMap((record) => {
      const document = byId.get(record.documentId);
      return document && record.cover ? [{ cover: record.cover, document }] : [];
    });

  async function search(retry: boolean) {
    const list = queries(retry);
    if (!list.length) return;
    const confirmed = await confirmAction({
      confirmLabel: "Buscar portadas",
      description: `Para buscar su portada, se envía a Open Library (openlibrary.org) el título, el autor y el ISBN de ${plural(list.length, "libro", "libros")}.`,
      details: [
        "Nunca se envía el archivo ni su texto",
        "Cada portada se guarda como miniatura en este navegador: mostrarla no vuelve a salir del equipo",
        "La portada del índice JSON sigue mandando sobre la de Open Library",
      ],
      icon: "cloud",
      note: "Open Library es un catálogo público de Internet Archive. Solo se acepta una portada si el título coincide; si no, el libro conserva la suya.",
      title: "¿Buscar portadas en Open Library?",
    });
    if (!confirmed) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    let done = 0;
    let found = 0;
    let failed = 0;
    let next = 0;
    let batch: FetchedCoverRecord[] = [];
    const flush = async () => {
      const records = batch;
      batch = [];
      await saveFetchedCovers(records);
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length) }, async () => {
          while (next < list.length && !controller.signal.aborted) {
            const query = list[next]!;
            next += 1;
            setStatus(`Buscando ${done + 1} de ${list.length}: «${query.title}»…`);
            try {
              const result = await findOpenLibraryCover(query, {
                signal: controller.signal,
                toCover: (image) => coverFromImage(image, "openlibrary"),
              });
              const fetchedAt = new Date().toISOString();
              if (result.kind === "found") {
                found += 1;
                batch.push({ cover: result.cover, documentId: query.documentId, fetchedAt, status: "found", via: result.via });
              } else {
                batch.push({ documentId: query.documentId, fetchedAt, status: "not-found" });
              }
            } catch {
              // Un fallo de red no es «no tiene portada»: no se recuerda y se puede reintentar.
              if (!controller.signal.aborted) failed += 1;
            }
            done += 1;
            if (batch.length >= 5) await flush();
          }
        }),
      );
      await flush();
      const parts = [
        `${plural(found, "portada encontrada", "portadas encontradas")} de ${list.length}`,
        done - found - failed ? `${plural(done - found - failed, "libro sin portada", "libros sin portada")} en Open Library` : "",
        failed ? `${plural(failed, "búsqueda falló", "búsquedas fallaron")}: vuelve a intentarlo más tarde` : "",
      ].filter(Boolean);
      setStatus(
        `${controller.signal.aborted ? "Búsqueda detenida. " : ""}${parts.join(" · ")}.${
          found ? " Ya se ven en su tarjeta de la Biblioteca; abajo tienes cuáles." : ""
        }`,
      );
    } catch {
      setStatus("No se pudieron guardar las portadas en este navegador.");
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  async function clear() {
    const confirmed = await confirmAction({
      confirmLabel: "Quitar portadas",
      description: `Se quitan ${plural(foundCount, "portada traída", "portadas traídas")} de Open Library. Cada libro vuelve a la portada que tenía.`,
      title: "¿Quitar las portadas de Open Library?",
      tone: "danger",
    });
    if (!confirmed) return;
    await clearFetchedCovers();
    setStatus("Portadas de Open Library quitadas.");
  }

  return (
    <Card aria-labelledby="cover-search-title" as="section" className={styles.localImportPanel} tone="subtle">
      <div>
        <Tag>Opcional · sale del dispositivo</Tag>
        <h2 id="cover-search-title">Portadas de Open Library</h2>
        <p>
          Para los libros sin portada, o con solo la primera página del PDF, Pliegue puede buscarla en Open Library por
          ISBN o por título y autor. Solo se busca cuando lo pides, y antes se te dice qué se envía.{" "}
          {fetched.status !== "ready"
            ? <Skeleton label="Cargando…" shape="inline" width="16ch" />
            : `${plural(missing.length, "libro necesita", "libros necesitan")} portada${
                foundCount ? ` · ${plural(foundCount, "traída", "traídas")} de Open Library` : ""
              }.`}
        </p>
      </div>
      <div className={styles.localImportActions}>
        {running ? (
          <Button onClick={() => abortRef.current?.abort()} variant="secondary">
            Detener
          </Button>
        ) : (
          <Button disabled={!pending.length || fetched.status !== "ready"} onClick={() => void search(false)}>
            {pending.length ? `Buscar portadas (${pending.length.toLocaleString("es")})…` : "Buscar portadas…"}
          </Button>
        )}
        {retryable && !running ? (
          <Button onClick={() => void search(true)} variant="quiet">
            Volver a buscar las no encontradas ({retryable.toLocaleString("es")})
          </Button>
        ) : null}
        {foundCount && !running ? (
          <Button onClick={() => void clear()} variant="danger">
            Quitar las de Open Library
          </Button>
        ) : null}
      </div>
      {status ? (
        <p aria-live="polite" role="status">
          {status}
        </p>
      ) : null}
      {(foundCovers.length || misses.length) && !running ? (
        <div className={panel.results}>
          {foundCovers.length ? (
            <section aria-labelledby="covers-found-title">
              <h3 id="covers-found-title">Traídas de Open Library · {foundCovers.length.toLocaleString("es")}</h3>
              <ul className={panel.coverGrid}>
                {foundCovers.slice(0, shownCovers).map(({ cover, document }) => (
                  <li key={document.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URI local: no hay nada que optimizar */}
                    <img alt="" className={panel.coverImage} decoding="async" loading="lazy" src={cover.src} />
                    <span className={panel.coverTitle}>{document.title}</span>
                    {/* La del índice JSON o la del propio libro mandan: la traída se guarda, pero no se ve. */}
                    {document.cover?.source !== "openlibrary" ? (
                      <small className={panel.coverNote}>La tarjeta usa la de tu índice o la del propio libro</small>
                    ) : null}
                  </li>
                ))}
              </ul>
              {foundCovers.length > shownCovers ? (
                <p className={panel.more}>y {plural(foundCovers.length - shownCovers, "más", "más")}</p>
              ) : null}
            </section>
          ) : null}
          {misses.length ? (
            <section aria-labelledby="covers-missed-title">
              <h3 id="covers-missed-title">Sin portada en Open Library · {misses.length.toLocaleString("es")}</h3>
              <ul className={panel.missList}>
                {misses.slice(0, shownMisses).map((document) => (
                  <li key={document.id}>{document.title}</li>
                ))}
              </ul>
              {misses.length > shownMisses ? (
                <p className={panel.more}>y {plural(misses.length - shownMisses, "más", "más")}</p>
              ) : null}
              <p className={panel.more}>
                Conservan su portada. Open Library no tenía uno con el mismo título; puedes volver a buscarlos más
                adelante.
              </p>
            </section>
          ) : null}
          {foundCovers.length ? (
            <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href="/app/biblioteca">
              Verlas en la Biblioteca
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
