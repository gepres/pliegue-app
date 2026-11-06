"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button, Tag } from "@pliegue/ui";

import {
  differenceHash,
  findDuplicatePairs,
  textSignature,
  type DuplicateItem,
  type DuplicatePair,
} from "../../library/duplicate-detection";
import {
  dismissDuplicatePair,
  markDuplicate,
  pairKey,
  unmarkDuplicate,
  useDuplicateDecisions,
} from "../../library/duplicate-store";
import { documentDisplayTitle, documentLanguage, type LibraryDocument } from "../../library/documents";
import { Sheet } from "../app-ui/overlays";
import styles from "./duplicate-finder.module.css";

/**
 * «Buscar libros repetidos» (03.6): otro escaneo, otra edición, el EPUB y el PDF del mismo
 * libro. Los idénticos byte a byte ya son copias de un mismo libro; estos se proponen y la
 * persona decide cuál conservar o que no son el mismo libro.
 *
 * La hoja vive fuera del popover de «Filtros», donde está el botón que la abre: dentro de él
 * quedaría encerrada en su panel, y su Escape cerraría el popover en vez de la hoja.
 */

/** Las firmas y las huellas de portada ya calculadas, para no rehacerlas en cada búsqueda. */
const signatureCache = new Map<string, Uint32Array>();
const coverCache = new Map<string, string | null>();

/** dHash de una portada: se dibuja a 9 × 8 en grises. `null` si no se puede leer. */
async function coverHashOf(src: string | undefined) {
  if (!src) return null;
  const key = `${src.length}:${src.slice(-64)}`;
  if (coverCache.has(key)) return coverCache.get(key) ?? null;
  let hash: string | null = null;
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.drawImage(image, 0, 0, 9, 8);
      const { data } = context.getImageData(0, 0, 9, 8);
      const gray: number[] = [];
      for (let index = 0; index < data.length; index += 4) gray.push(0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!);
      hash = differenceHash(gray);
    }
  } catch {
    hash = null;
  }
  coverCache.set(key, hash);
  return hash;
}

const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const reasons: Record<DuplicatePair["reason"], (score: number) => string> = {
  cover: () => "La misma portada y un título parecido.",
  text: (score) => `El mismo texto en un ${Math.round(score * 100)} % del principio.`,
  title: () => "El mismo título y autor; uno de los dos no tiene texto (un escaneo).",
};

type SearchState =
  | { status: "idle" }
  | { done: number; status: "working"; total: number }
  | { pairs: DuplicatePair[]; status: "ready" }
  | { message: string; status: "failed" };

export function DuplicateFinder({
  documents,
  extraText,
  onClose,
  open,
}: {
  documents: readonly LibraryDocument[];
  /** Lo leído con OCR de los escaneos, que también cuenta como su texto. */
  extraText?: ReadonlyMap<string, string>;
  onClose: () => void;
  open: boolean;
}) {
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const decisions = useDuplicateDecisions();
  const runRef = useRef(0);
  const byId = new Map(documents.map((document) => [document.id, document]));
  const marks = decisions.records.flatMap((record) => (record.kind === "mark" ? [record] : []));
  const marked = new Set(marks.map((mark) => mark.documentId));

  async function run() {
    const run = (runRef.current += 1);
    // Fuera las copias marcadas en el índice JSON: ya está decidido cuál se conserva. Las
    // marcadas aquí sí se comparan, y sus parejas se esconden al pintar: así «Deshacer» las
    // devuelve sin volver a buscar.
    const candidates = documents.filter((document) => !document.organization?.duplicateOf || marked.has(document.id));
    setSearch({ done: 0, status: "working", total: candidates.length });
    try {
      const items: DuplicateItem[] = [];
      const signatures: Uint32Array[] = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const document = candidates[index]!;
        const text = `${document.searchText ?? ""} ${extraText?.get(document.id) ?? ""}`.trim();
        const key = `${document.id}:${text.length}`;
        let signature = signatureCache.get(key);
        if (!signature) {
          signature = textSignature(text);
          signatureCache.set(key, signature);
        }
        signatures.push(signature);
        items.push({
          authors: document.catalog?.authors?.length ? document.catalog.authors : document.author ? [document.author] : [],
          coverHash: await coverHashOf(document.cover?.src),
          id: document.id,
          language: documentLanguage(document),
          text,
          title: documentDisplayTitle(document),
        });
        // De 25 en 25, cediendo el turno: con cientos de libros, la página no se congela.
        if (index % 25 === 24) {
          if (run !== runRef.current) return;
          setSearch({ done: index + 1, status: "working", total: candidates.length });
          await yieldToBrowser();
        }
      }
      if (run !== runRef.current) return;
      setSearch({ pairs: findDuplicatePairs(items, signatures), status: "ready" });
    } catch (error) {
      if (run === runRef.current) setSearch({ message: error instanceof Error ? error.message : "No se pudo comparar la biblioteca.", status: "failed" });
    }
  }

  // Cada vez que se abre se compara de nuevo: la biblioteca puede haber cambiado.
  const startSearch = useEffectEvent(() => void run());
  useEffect(() => {
    if (open) startSearch();
  }, [open]);

  const dismissed = new Set(decisions.records.flatMap((record) => (record.kind === "dismiss" ? [pairKey(record.ids[0], record.ids[1])] : [])));
  const pairs =
    search.status === "ready"
      ? search.pairs.filter(
          (pair) =>
            !dismissed.has(pairKey(pair.ids[0], pair.ids[1])) &&
            !marked.has(pair.ids[0]) &&
            !marked.has(pair.ids[1]) &&
            byId.has(pair.ids[0]) &&
            byId.has(pair.ids[1]),
        )
      : [];

  return (
    <Sheet
        description="Otro escaneo, otra edición o el mismo libro en EPUB y en PDF. Los archivos idénticos ya se juntan solos; estos los decides tú."
        onClose={() => {
          runRef.current += 1;
          onClose();
        }}
        open={open}
        title="Libros repetidos"
        width={620}
      >
        <div className={styles.finder}>
          {search.status === "working" ? (
            <p className={styles.status} role="status">
              Comparando {search.done} de {search.total} libros: el principio de su texto y su portada…
            </p>
          ) : search.status === "failed" ? (
            <p className={styles.status} role="alert">
              {search.message}
            </p>
          ) : search.status === "ready" ? (
            <p className={styles.status} role="status">
              {pairs.length
                ? `${pairs.length === 1 ? "Una pareja parece" : `${pairs.length} parejas parecen`} el mismo libro. Elige cuál conservar: el otro se marca como copia y «Ocultar duplicados» lo esconde.`
                : "No queda ninguna pareja que parezca el mismo libro."}
            </p>
          ) : null}

          {pairs.length ? (
            <ul className={styles.pairs}>
              {pairs.map((pair) => {
                const left = byId.get(pair.ids[0])!;
                const right = byId.get(pair.ids[1])!;
                // Se recomienda conservar el que tiene más texto: se busca y se cataloga mejor.
                const recommended = (right.searchText?.length ?? 0) > (left.searchText?.length ?? 0) ? right.id : left.id;
                return (
                  <li className={styles.pair} key={pairKey(pair.ids[0], pair.ids[1])}>
                    <p className={styles.reason}>{reasons[pair.reason](pair.score)}</p>
                    <div className={styles.books}>
                      {[left, right].map((book, index) => {
                        const other = index === 0 ? right : left;
                        return (
                          <div className={styles.book} key={book.id}>
                            <div className={styles.cover}>
                              {book.cover?.src ? (
                                // eslint-disable-next-line @next/next/no-img-element -- miniatura local en data URI
                                <img alt="" src={book.cover.src} />
                              ) : null}
                            </div>
                            <div className={styles.bookText}>
                              <strong>{documentDisplayTitle(book)}</strong>
                              <small>
                                {[book.catalog?.authors?.join(", ") || book.author, book.format.toUpperCase(), book.meta].filter(Boolean).join(" · ")}
                              </small>
                              {book.id === recommended ? <Tag>Recomendado</Tag> : null}
                              <Button
                                aria-label={`Conservar «${documentDisplayTitle(book)}» y marcar el otro como copia`}
                                onClick={() => void markDuplicate(other.id, { id: book.id, title: documentDisplayTitle(book) })}
                                size="sm"
                                variant={book.id === recommended ? "primary" : "secondary"}
                              >
                                Conservar este
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Button onClick={() => void dismissDuplicatePair(pair.ids[0], pair.ids[1])} size="sm" variant="quiet">
                      No son el mismo libro
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {marks.length ? (
            <section aria-labelledby="duplicados-marcados" className={styles.marked}>
              <h3 id="duplicados-marcados">Marcados aquí como copia</h3>
              <ul>
                {marks.map((mark) => {
                  const book = byId.get(mark.documentId);
                  return (
                    <li key={mark.key}>
                      <span>
                        {book ? documentDisplayTitle(book) : "Un libro que ya no está"} → copia de «{mark.duplicateOfTitle}»
                      </span>
                      <Button onClick={() => void unmarkDuplicate(mark.documentId)} size="sm" variant="quiet">
                        Deshacer
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
    </Sheet>
  );
}
