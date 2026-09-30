"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@pliegue/ui";

import {
  annotationQuote,
  highlightColorLabels,
  highlightColors,
  type HighlightColor,
  type ReaderAnnotation,
} from "../../library/annotations";
import { useOutsidePointer } from "../app-ui/controls";
import { Icon } from "../app-ui/icons";
import { captureSelection, type SelectionCapture } from "./annotation-highlights";
import styles from "./annotations.module.css";

export type SelectionAction =
  | { color: HighlightColor; kind: "highlight" }
  | { kind: "copy" }
  | { kind: "note" }
  | { kind: "postcard" };

/**
 * Coloca un elemento flotante junto a un rectángulo de la pantalla: encima si cabe; debajo
 * si no, o si la pantalla es táctil, porque ahí el menú nativo de la selección sale arriba.
 */
function usePlacement(elementRef: RefObject<HTMLElement | null>, anchor: DOMRect | null, preferBelow = false) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!anchor || !element) {
      setPosition(null);
      return;
    }
    const { height, width } = element.getBoundingClientRect();
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const gap = 10;
    const above = anchor.top - height - gap;
    const below = preferBelow || coarse || above < 72;
    const top = below
      ? Math.min(window.innerHeight - height - 12, anchor.bottom + gap + (coarse ? 20 : 0))
      : above;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, anchor.left + anchor.width / 2 - width / 2));
    setPosition({ left, top: Math.max(8, top) });
  }, [anchor, elementRef, preferBelow]);

  return position;
}

function Swatches({
  current,
  label,
  onPick,
}: {
  current?: HighlightColor;
  label: (color: HighlightColor) => string;
  onPick: (color: HighlightColor) => void;
}) {
  return (
    <>
      {highlightColors.map((color) => (
        <button
          aria-label={label(color)}
          aria-pressed={current === undefined ? undefined : current === color}
          className={styles.swatch}
          data-color={color}
          key={color}
          onClick={() => onPick(color)}
          title={highlightColorLabels[color]}
          type="button"
        />
      ))}
    </>
  );
}

// ---- Barra de la selección ------------------------------------------------------------

/**
 * Aparece al terminar de seleccionar texto dentro del lector. Se espera a soltar el ratón o
 * a que las asas de la selección táctil se queden quietas: si no, parpadearía a cada letra.
 */
export function SelectionToolbar({
  disabled,
  onAction,
  rootRef,
}: {
  disabled: boolean;
  onAction: (action: SelectionAction, capture: SelectionCapture) => void;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const [capture, setCapture] = useState<SelectionCapture | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const position = usePlacement(toolbarRef, capture?.rect ?? null);

  useEffect(() => {
    // Desactivada (recortando, con la postal abierta) no escucha; al volver, relee la selección
    // actual en lugar de reaparecer con la de antes.
    if (disabled) return;
    let timer = 0;
    let frame = 0;
    let pointerDown = false;

    const evaluate = () => {
      const root = rootRef.current;
      if (!root || pointerDown) return;
      setCapture(captureSelection(root));
    };
    const later = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, delay);
    };
    const onSelectionChange = () => later(240);
    const onPointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      pointerDown = true;
    };
    const onPointerUp = () => {
      pointerDown = false;
      later(40);
    };
    // Al desplazarse, la barra sigue a la selección en lugar de quedarse flotando sola.
    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          evaluate();
        });
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCapture(null);
    };

    later(0);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    // En Android, cuando el sistema toma la selección el toque termina en «cancel».
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [disabled, rootRef]);

  if (!capture || disabled) return null;

  function act(action: SelectionAction) {
    if (!capture) return;
    onAction(action, capture);
    window.getSelection()?.removeAllRanges();
    setCapture(null);
  }

  return (
    <div
      aria-label="Marcar la selección"
      className={styles.toolbar}
      data-placed={position ? "true" : undefined}
      data-reader-chrome-ignore=""
      // Pulsar un botón no debe deshacer la selección antes de leerla.
      onPointerDown={(event) => event.preventDefault()}
      ref={toolbarRef}
      role="toolbar"
      style={position ?? { left: -9999, top: -9999 }}
    >
      {capture.target ? (
        <>
          <Swatches
            label={(color) => `Resaltar en ${highlightColorLabels[color].toLocaleLowerCase("es")}`}
            onPick={(color) => act({ color, kind: "highlight" })}
          />
          <span aria-hidden="true" className={styles.divider} />
          <button className={styles.toolbarButton} onClick={() => act({ kind: "note" })} type="button">
            <Icon name="note" size={18} />
            <span>Nota</span>
          </button>
        </>
      ) : (
        <span className={styles.toolbarHint}>Para resaltar, elige dentro de una página</span>
      )}
      <button aria-label="Copiar" className={styles.toolbarButton} onClick={() => act({ kind: "copy" })} title="Copiar" type="button">
        <Icon name="copy" size={18} />
      </button>
      <button className={styles.toolbarButton} onClick={() => act({ kind: "postcard" })} type="button">
        <Icon name="share" size={18} />
        <span>Postal</span>
      </button>
    </div>
  );
}

// ---- Tarjeta de una marca ---------------------------------------------------------------

/**
 * Lo que se hace con una marca ya creada: cambiarle el color, escribir su nota, llevarla a una
 * postal o quitarla. La nota se guarda al cerrar, sin un botón que haya que acordarse de pulsar.
 */
export function AnnotationCard({
  anchor,
  annotation,
  autoFocusNote,
  onClose,
  onColor,
  onDelete,
  onNote,
  onPostcard,
}: {
  anchor: DOMRect;
  annotation: ReaderAnnotation;
  autoFocusNote: boolean;
  onClose: () => void;
  onColor: (color: HighlightColor) => void;
  onDelete: () => void;
  onNote: (note: string) => void;
  onPostcard: () => void;
}) {
  const [note, setNote] = useState(annotation.note);
  const cardRef = useRef<HTMLDivElement>(null);
  const position = usePlacement(cardRef, anchor, true);
  const quote = annotationQuote(annotation);
  const page = annotation.target.page;

  const close = useCallback(() => {
    if (note.trim() !== annotation.note.trim()) onNote(note.trim());
    onClose();
  }, [annotation.note, note, onClose, onNote]);

  useOutsidePointer(true, [cardRef], close);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <div
      aria-label="Marca"
      className={styles.card}
      data-placed={position ? "true" : undefined}
      data-reader-chrome-ignore=""
      ref={cardRef}
      role="dialog"
      style={position ?? { left: -9999, top: -9999 }}
    >
      <header className={styles.cardHeader}>
        <span className={styles.cardDot} data-color={annotation.color} />
        <span>
          {annotation.target.kind === "region" ? "Zona marcada" : "Resaltado"}
          {page !== null ? ` · página ${page}` : ""}
        </span>
      </header>
      {quote ? <blockquote className={styles.cardQuote}>{quote}</blockquote> : null}
      <div aria-label="Color" className={styles.cardSwatches} role="group">
        <Swatches
          current={annotation.color}
          label={(color) => `Cambiar a ${highlightColorLabels[color].toLocaleLowerCase("es")}`}
          onPick={onColor}
        />
      </div>
      <textarea
        aria-label="Nota"
        autoFocus={autoFocusNote}
        className={`pliegue-input ${styles.cardNote}`}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Añade una nota…"
        rows={3}
        value={note}
      />
      <footer className={styles.cardActions}>
        <Button onClick={onPostcard} size="sm" variant="secondary">
          <Icon name="share" size={16} />
          Postal
        </Button>
        <Button onClick={onDelete} size="sm" variant="danger">
          <Icon name="trash" size={16} />
          Quitar
        </Button>
        <Button onClick={close} size="sm">
          Listo
        </Button>
      </footer>
    </div>
  );
}

// ---- Barra del recorte ----------------------------------------------------------------------

export type RegionAction = { color: HighlightColor; kind: "highlight" } | { kind: "cancel" } | { kind: "note" } | { kind: "postcard" };

/** Lo que se hace con la zona recién recortada de una página. */
export function RegionToolbar({ anchor, onAction }: { anchor: DOMRect; onAction: (action: RegionAction) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const position = usePlacement(barRef, anchor, true);

  return (
    <div
      aria-label="Zona recortada"
      className={styles.toolbar}
      data-placed={position ? "true" : undefined}
      data-reader-chrome-ignore=""
      ref={barRef}
      role="toolbar"
      style={position ?? { left: -9999, top: -9999 }}
    >
      <button className={`${styles.toolbarButton} ${styles.toolbarPrimary}`} onClick={() => onAction({ kind: "postcard" })} type="button">
        <Icon name="share" size={18} />
        <span>Crear postal</span>
      </button>
      <span aria-hidden="true" className={styles.divider} />
      <Swatches
        label={(color) => `Marcar la zona en ${highlightColorLabels[color].toLocaleLowerCase("es")}`}
        onPick={(color) => onAction({ color, kind: "highlight" })}
      />
      <button className={styles.toolbarButton} onClick={() => onAction({ kind: "note" })} type="button">
        <Icon name="note" size={18} />
        <span>Nota</span>
      </button>
      <button aria-label="Descartar el recorte" className={styles.toolbarButton} onClick={() => onAction({ kind: "cancel" })} title="Descartar" type="button">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
