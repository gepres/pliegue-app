"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, Input } from "@pliegue/ui";

import { languageName, type TranslationPair } from "../../library/translation";
import {
  detectLanguage,
  translateBlocks,
  type EngineAvailability,
  type TranslationEngine,
} from "../../library/translation-engine";
import { recognizeText, type OcrProgress } from "../../library/ocr";
import { glossaryLimits, type GlossaryEntry } from "../../library/translation-glossary";
import { readGlossary, useBookGlossary } from "../../library/translation-glossary-store";
import { useOutsidePointer } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import { usePlacement } from "./annotation-ui";
import styles from "./annotations.module.css";

/** Lo que más se traduce de una vez desde una selección: unos párrafos, no un capítulo. */
export const snippetLimit = 4_000;

const blocked: Partial<Record<EngineAvailability, string>> = {
  "needs-key": "Falta la clave del traductor en esta sesión: ponla en Ajustes → Inteligencia artificial.",
  "needs-provider": "Elige en Ajustes con qué IA traducir, o cambia a «Navegador» en el panel «Traducir».",
  unavailable: "Este traductor no ofrece ese par de idiomas. Prueba con otro en el panel «Traducir».",
  unsupported: "Este navegador no trae traductor integrado: elige «Tu IA» en el panel «Traducir».",
};

/**
 * Traduce un trozo suelto —una selección, una zona recortada— con el motor y el glosario del
 * libro (05.5). Abre el traductor, traduce y lo cierra: no toca la traducción del libro ni lo
 * que hay guardado.
 */
export async function translateSnippet(
  engine: TranslationEngine,
  pair: TranslationPair,
  text: string,
  glossary: readonly GlossaryEntry[],
  signal?: AbortSignal,
) {
  const availability = await engine.availability(pair);
  const reason = blocked[availability];
  if (reason) throw new Error(reason);
  const translator = await engine.create(pair, undefined, signal);
  try {
    const [block] = await translateBlocks(translator, [text.slice(0, snippetLimit)], signal, glossary);
    return block?.text ?? text;
  } finally {
    translator.destroy();
  }
}

export interface SnippetRequest {
  anchor: DOMRect;
  /**
   * Una zona sin capa de texto —una imagen, un escaneo— se dibuja y se lee con OCR en el equipo
   * (03.5) antes de traducirla.
   */
  image?: (() => Promise<Blob>) | undefined;
  /** Guarda la traducción como nota de una marca sobre ese trozo, con su texto; `null` si no se puede marcar. */
  onSaveNote: ((note: string, quote: string) => void) | null;
  text: string;
}

type SnippetState =
  | { kind: "working" }
  | ({ kind: "reading" } & OcrProgress)
  | { kind: "done"; pair: TranslationPair; text: string }
  | { kind: "error"; message: string };

/** Por debajo de esta confianza, lo leído no es texto: una ilustración, un borrón. */
const minimumConfidence = 30;

/**
 * La tarjeta con la traducción de lo seleccionado: se copia, se guarda como nota o se lleva al
 * glosario del libro. El par de idiomas es el del libro que se traduce; si no hay, el del libro
 * y el español (o el inglés, si el libro ya está en español).
 */
export function SnippetTranslationCard({
  documentId,
  engine,
  engineLabel,
  onClose,
  pair: bookPair,
  request,
  sourceGuess,
}: {
  documentId: string;
  engine: TranslationEngine;
  engineLabel: string;
  onClose: () => void;
  pair: TranslationPair | null;
  request: SnippetRequest;
  sourceGuess: string | null;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const position = usePlacement(cardRef, request.anchor, true);
  const [state, setState] = useState<SnippetState>(() =>
    request.text.trim() || !request.image ? { kind: "working" } : { fraction: 0, kind: "reading", stage: "loading" },
  );
  // El texto que se traduce: el seleccionado o, en una imagen, el que lee el OCR, con su confianza.
  const [source, setSource] = useState<{ confidence: number | null; text: string }>({ confidence: null, text: request.text });
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const target = state.kind === "done" ? state.pair.target : (bookPair?.target ?? null);
  const glossary = useBookGlossary(documentId, target);

  useOutsidePointer(true, [cardRef], onClose);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      let original = request.text;
      try {
        if (!original.trim()) {
          if (!request.image) {
            setState({ kind: "error", message: "Aquí no hay texto que traducir." });
            return;
          }
          setState({ fraction: 0, kind: "reading", stage: "loading" });
          const image = await request.image();
          const read = await recognizeText(image, bookPair?.source ?? sourceGuess, (progress) => {
            if (!abort.signal.aborted) setState({ kind: "reading", ...progress });
          });
          if (abort.signal.aborted) return;
          if (!read.text || read.confidence < minimumConfidence) {
            setState({ kind: "error", message: "No se distingue texto en esta zona: parece solo una imagen." });
            return;
          }
          original = read.text;
          setSource({ confidence: read.confidence, text: read.text });
          setState({ kind: "working" });
        }
        const source = bookPair?.source ?? sourceGuess ?? (await detectLanguage(original)) ?? "en";
        const target = bookPair?.target ?? (source === "es" ? "en" : "es");
        const pair = { source, target };
        if (source === target) {
          setState({ kind: "error", message: `El texto ya está en ${languageName(target)}.` });
          return;
        }
        // El glosario del libro hacia ese idioma también vale para lo suelto.
        const text = await translateSnippet(engine, pair, original, readGlossary(documentId, target), abort.signal);
        if (!abort.signal.aborted) setState({ kind: "done", pair, text });
      } catch (error) {
        if (abort.signal.aborted) return;
        const message = error instanceof Error && error.message && !/^[\x20-\x7e]+$/.test(error.message) ? error.message : "No se pudo traducir. Vuelve a intentarlo.";
        setState({ kind: "error", message });
      }
    })();
    return () => abort.abort();
  }, [bookPair, documentId, engine, request, sourceGuess]);

  const quote = source.text.length > 220 ? `${source.text.slice(0, 220).trimEnd()}…` : source.text;

  return (
    <div
      aria-label="Traducción de la selección"
      className={`${styles.card} ${styles.snippet}`}
      data-placed={position ? "true" : undefined}
      data-reader-chrome-ignore=""
      ref={cardRef}
      role="dialog"
      style={position ?? { left: -9999, top: -9999 }}
    >
      <header className={styles.cardHeader}>
        <Icon name="translate" size={16} />
        <span>
          {state.kind === "done"
            ? `Del ${languageName(state.pair.source)} al ${languageName(state.pair.target)}`
            : "Traducción"}{" "}
          · {engineLabel}
        </span>
      </header>
      {quote ? <blockquote className={styles.cardQuote}>{quote}</blockquote> : null}
      {source.confidence !== null ? (
        <p className={styles.snippetOrigin}>
          <Icon name="image" size={14} />
          Leído de la imagen con OCR, en tu equipo · confianza {source.confidence}&nbsp;%
        </p>
      ) : null}
      {state.kind === "reading" ? (
        <p className={styles.snippetStatus} role="status">
          <span aria-hidden="true" className={styles.snippetSpinner} />
          {state.stage === "loading"
            ? "Preparando el lector de texto (la primera vez descarga el idioma)…"
            : `Leyendo el texto de la imagen… ${Math.round(state.fraction * 100)} %`}
        </p>
      ) : state.kind === "working" ? (
        <p className={styles.snippetStatus} role="status">
          <span aria-hidden="true" className={styles.snippetSpinner} />
          Traduciendo…
        </p>
      ) : state.kind === "error" ? (
        <p className={styles.snippetStatus} role="alert">
          {state.message}
        </p>
      ) : (
        <p className={styles.snippetText} lang={state.pair.target}>
          {state.text}
        </p>
      )}
      {state.kind === "done" && adding ? (
        <GlossaryQuickAdd
          initialSource={source.text.length <= glossaryLimits.term ? source.text : ""}
          initialTarget={state.text.length <= glossaryLimits.term ? state.text : ""}
          language={state.pair.target}
          onCancel={() => setAdding(false)}
          onSave={(entry) => {
            const ok = glossary.save(entry);
            if (ok) setAdding(false);
            return ok;
          }}
        />
      ) : null}
      <footer className={styles.cardActions}>
        {state.kind === "done" ? (
          <>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(state.text).then(() => setCopied(true), () => undefined);
              }}
              size="sm"
              variant="secondary"
            >
              <Icon name={copied ? "check" : "copy"} size={16} />
              {copied ? "Copiada" : "Copiar"}
            </Button>
            {request.onSaveNote ? (
              <Button
                disabled={saved}
                onClick={() => {
                  request.onSaveNote?.(state.text, source.text);
                  setSaved(true);
                }}
                size="sm"
                variant="secondary"
              >
                <Icon name={saved ? "check" : "note"} size={16} />
                {saved ? "Guardada" : "Como nota"}
              </Button>
            ) : null}
            {!adding ? (
              <Button onClick={() => setAdding(true)} size="sm" variant="quiet">
                <Icon name="book" size={16} />
                Al glosario
              </Button>
            ) : null}
          </>
        ) : null}
        <Button onClick={onClose} size="sm">
          Cerrar
        </Button>
      </footer>
    </div>
  );
}

/** Añadir al glosario desde la tarjeta: el término seleccionado y cómo traducirlo siempre. */
function GlossaryQuickAdd({
  initialSource,
  initialTarget,
  language,
  onCancel,
  onSave,
}: {
  initialSource: string;
  initialTarget: string;
  language: string;
  onCancel: () => void;
  onSave: (entry: GlossaryEntry) => boolean;
}) {
  const [source, setSource] = useState(initialSource);
  const [target, setTarget] = useState(initialTarget);
  const [failed, setFailed] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(!onSave({ source, target }));
  }

  return (
    <form aria-label="Añadir al glosario del libro" className={styles.snippetGlossary} onSubmit={submit}>
      <Input aria-label="Término del libro" autoFocus maxLength={glossaryLimits.term} onChange={(event) => setSource(event.target.value)} placeholder="Término" value={source} />
      <Input
        aria-label={`Se traduce siempre como (${languageName(language)})`}
        lang={language}
        maxLength={glossaryLimits.term}
        onChange={(event) => setTarget(event.target.value)}
        placeholder="Traducción"
        value={target}
      />
      {failed ? <p className={styles.snippetStatus} role="alert">No se pudo añadir: revisa el término y su traducción.</p> : null}
      <div className={styles.snippetGlossaryActions}>
        <Button disabled={!source.trim() || !target.trim()} size="sm" type="submit" variant="secondary">
          Añadir
        </Button>
        <Button onClick={onCancel} size="sm" variant="quiet">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
