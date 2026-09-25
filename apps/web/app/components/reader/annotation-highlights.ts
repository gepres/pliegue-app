"use client";

import { useEffect, useRef, type RefObject } from "react";

import {
  anchorText,
  describeTextRange,
  highlightColors,
  type AnnotationTarget,
  type HighlightColor,
  type ReaderAnnotation,
} from "../../library/annotations";

/**
 * Resaltados sobre el texto del lector con la API de resaltados de CSS: se registran rangos y
 * el navegador los pinta, sin tocar el DOM. Así conviven con la capa de texto de pdf.js y con
 * React, que no sabría qué hacer con `<mark>` metidos por fuera en su árbol.
 *
 * Cada vista marca con `data-annotation-scope` el elemento cuyo texto cuenta: la capa de
 * texto de una página (`pdf-layer:12`), una página del modo Lectura (`pdf-reading:12`) o el
 * documento entero en los formatos sin páginas (`document`).
 */

export type TextTarget = Extract<AnnotationTarget, { kind: "text" }>;

export function highlightName(color: HighlightColor) {
  return `pliegue-${color}`;
}

export function supportsHighlights() {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/**
 * Los colores de los resaltados. Van aquí y no en `globals.css` porque el analizador de CSS del
 * bundler (lightningcss) aún no conoce `::highlight()`: conserva la regla, pero la da por
 * «Parsing CSS source code failed» en cada compilación. Translúcidos para que se lean sobre el
 * papel, sobre el tema oscuro y sobre la página dibujada del PDF, cuya capa de texto es invisible.
 */
const highlightBackgrounds: Record<HighlightColor, string> = {
  amber: "rgb(255 196 0 / 42%)",
  blue: "rgb(59 142 232 / 32%)",
  green: "rgb(92 184 92 / 36%)",
  rose: "rgb(236 95 140 / 32%)",
};

let highlightSheet: CSSStyleSheet | null = null;

/** Añade a la página, una sola vez, la hoja con los colores de los resaltados. */
function installHighlightStyles() {
  if (!highlightSheet) {
    highlightSheet = new CSSStyleSheet();
    highlightSheet.replaceSync(
      highlightColors
        .map((color) => `::highlight(${highlightName(color)}) { background-color: ${highlightBackgrounds[color]}; }`)
        .join("\n"),
    );
  }
  if (!document.adoptedStyleSheets.includes(highlightSheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
  }
}

function scopeOf(node: Node | null) {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>("[data-annotation-scope]") ?? null;
}

/** Caracteres de `scope` que hay antes de un punto del DOM. */
function offsetWithin(scope: Element, node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(scope, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** El rango que ocupan los caracteres `start`–`end` del texto de `scope`. */
export function rangeFromOffsets(scope: Element, start: number, end: number) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let consumed = 0;
  let started = false;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < consumed + length) {
      range.setStart(node, start - consumed);
      started = true;
    }
    if (started && end <= consumed + length) {
      range.setEnd(node, end - consumed);
      return range;
    }
    consumed += length;
  }

  return null;
}

export interface SelectionCapture {
  page: number | null;
  quote: string;
  rect: DOMRect;
  /** `null` si la selección cruza páginas o vistas: se puede copiar, no resaltar. */
  target: TextTarget | null;
}

/** Lo seleccionado dentro de `root`, con su posición para guardarlo como marca. */
export function captureSelection(root: HTMLElement): SelectionCapture | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const rawQuote = selection.toString();
  if (!rawQuote.trim()) return null;

  const rect = range.getBoundingClientRect();
  const scope = scopeOf(range.startContainer);
  const pageValue = scope?.dataset.annotationPage;
  const page = pageValue ? Number(pageValue) : null;
  const quote = rawQuote.replaceAll(/\s+/g, " ").trim();

  if (!scope || scope !== scopeOf(range.endContainer) || !scope.dataset.annotationScope) {
    return { page, quote, rect, target: null };
  }

  const text = scope.textContent ?? "";
  let start = offsetWithin(scope, range.startContainer, range.startOffset);
  let end = offsetWithin(scope, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  if (start >= end) return null;

  return {
    page,
    quote,
    rect,
    target: {
      ...describeTextRange(text, start, end),
      display: quote,
      kind: "text",
      page,
      scope: scope.dataset.annotationScope,
    },
  };
}

function findScope(scopes: Map<string, HTMLElement>, target: TextTarget) {
  const exact = scopes.get(target.scope);
  if (exact) return exact;
  // Hecha en la otra vista del mismo PDF: se busca la cita en la página equivalente.
  if (target.page === null) return null;
  return scopes.get(`pdf-layer:${target.page}`) ?? scopes.get(`pdf-reading:${target.page}`) ?? null;
}

/**
 * Pinta las marcas de texto dentro de `root` y las vuelve a pintar cuando su contenido cambia:
 * pdf.js monta y desmonta la capa de texto de cada página al desplazarse y al hacer zoom.
 * Devuelve los rangos vigentes, para saber qué marca hay bajo un clic.
 */
export function useAnnotationHighlights(
  rootRef: RefObject<HTMLElement | null>,
  annotations: readonly ReaderAnnotation[],
) {
  const rangesRef = useRef(new Map<string, Range>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !supportsHighlights()) return;
    installHighlightStyles();
    let frame = 0;

    function sync() {
      frame = 0;
      if (!root) return;
      const scopes = new Map<string, HTMLElement>();
      for (const element of root.querySelectorAll<HTMLElement>("[data-annotation-scope]")) {
        if (element.dataset.annotationScope) scopes.set(element.dataset.annotationScope, element);
      }

      const texts = new Map<HTMLElement, string>();
      const byColor = new Map<HighlightColor, Range[]>();
      const ranges = new Map<string, Range>();

      for (const annotation of annotations) {
        const target = annotation.target;
        if (target.kind !== "text") continue;
        const scope = findScope(scopes, target);
        if (!scope) continue;
        let text = texts.get(scope);
        if (text === undefined) {
          text = scope.textContent ?? "";
          texts.set(scope, text);
        }
        // La posición guardada solo vale en su vista; en la otra se busca la cita.
        const sameView = scope.dataset.annotationScope === target.scope;
        const anchored = anchorText(text, sameView ? target : { ...target, end: -1, start: -1 });
        if (!anchored) continue;
        const range = rangeFromOffsets(scope, anchored.start, anchored.end);
        if (!range) continue;
        ranges.set(annotation.id, range);
        byColor.set(annotation.color, [...(byColor.get(annotation.color) ?? []), range]);
      }

      for (const color of highlightColors) {
        CSS.highlights.set(highlightName(color), new Highlight(...(byColor.get(color) ?? [])));
      }
      rangesRef.current = ranges;
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(sync);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { characterData: true, childList: true, subtree: true });
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      for (const color of highlightColors) CSS.highlights.delete(highlightName(color));
    };
  }, [annotations, rootRef]);

  return rangesRef;
}

/** La marca de texto que hay bajo un punto de la pantalla, si hay alguna. */
export function annotationAtPoint(ranges: ReadonlyMap<string, Range>, x: number, y: number) {
  for (const [id, range] of ranges) {
    for (const rect of range.getClientRects()) {
      if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) return id;
    }
  }
  return null;
}
