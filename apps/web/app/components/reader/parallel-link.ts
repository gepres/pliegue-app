"use client";

import { useEffect, type RefObject } from "react";

import {
  blockSpanToLayer,
  foldLetters,
  layerOffsetToBlock,
  layerSpanToBlock,
  locateBlocks,
  pairSentences,
  segmentAt,
  segmentsWithin,
  type FoldedText,
  type ParallelSegment,
  type ParallelSide,
  type TextSpan,
} from "../../library/parallel-text";
import { offsetWithin, rangeFromOffsets, supportsHighlights } from "./annotation-highlights";

/**
 * Original y traducción, uno al lado del otro: al pasar el ratón por una frase, o al
 * seleccionar, se resalta su pareja en el otro lado.
 *
 * El contrato con la vista es el DOM:
 * - cada bloque enlazado lleva `data-parallel-key`, igual en los dos lados, y
 *   `data-parallel-side` («source» o «target»), y su texto es el del bloque;
 * - en la página original de un PDF el texto está en la capa de pdf.js, que no sabe de bloques:
 *   la página lleva una caja por bloque, con su texto en `data-parallel-text`, y ese texto se
 *   busca en la capa. Si no se encuentra, se resalta la caja entera.
 */

const highlightName = "pliegue-parallel";
const linkedSelector = "[data-parallel-side]";
const pageSelector = "[data-page-number]";
const layerSelector = ".textLayer";

/**
 * Un tono que no es de ninguna marca (ámbar, verde, azul, rosa): lo resaltado aquí es solo una
 * guía de lectura y no debe confundirse con lo subrayado. Va en una hoja adoptada por la misma
 * razón que los resaltados: el analizador de CSS del bundler aún no conoce `::highlight()`.
 */
let highlightSheet: CSSStyleSheet | null = null;

function installHighlightStyle() {
  if (!highlightSheet) {
    highlightSheet = new CSSStyleSheet();
    highlightSheet.replaceSync(`::highlight(${highlightName}) { background-color: rgb(124 92 224 / 26%); }`);
  }
  if (!document.adoptedStyleSheets.includes(highlightSheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
  }
}

/** Lo que se resalta: unas parejas de un bloque, en uno o en los dos lados. */
interface Mark {
  indices: readonly number[];
  key: string;
  sides: readonly ParallelSide[];
}

const bothSides: readonly ParallelSide[] = ["source", "target"];

function otherSide(side: ParallelSide): ParallelSide {
  return side === "source" ? "target" : "source";
}

function sameMark(left: Mark | null, right: Mark | null) {
  if (left === right) return true;
  if (!left || !right || left.key !== right.key || left.sides.length !== right.sides.length) return false;
  return left.indices.length === right.indices.length && left.indices.every((value, index) => value === right.indices[index]);
}

function elementOf(node: Node | null) {
  return node instanceof Element ? node : (node?.parentElement ?? null);
}

/** Una caja de la página original de un PDF: su texto se busca en la capa de pdf.js. */
function isBox(element: HTMLElement) {
  return element.dataset.parallelText !== undefined;
}

function blockText(element: HTMLElement) {
  return element.dataset.parallelText ?? element.textContent ?? "";
}

/** El punto del texto bajo el puntero, con la API que tenga el navegador. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const probe = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof probe.caretPositionFromPoint === "function") {
    const position = probe.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  const range = probe.caretRangeFromPoint?.(x, y) ?? null;
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

interface LayerIndex {
  /** Dónde empieza cada caja en la capa, en letras plegadas; -1 si no está. */
  blocks: Map<HTMLElement, { at: number; folded: FoldedText }>;
  folded: FoldedText;
  signature: string;
  text: string;
}

/**
 * Resalta la pareja de lo que hay bajo el puntero o de lo seleccionado dentro de `root`.
 * `languages` a `null` lo apaga: fuera de la vista en paralelo no hay nada que enlazar.
 */
export function useParallelLink(
  rootRef: RefObject<HTMLElement | null>,
  languages: { source: string; target: string } | null,
) {
  const source = languages?.source ?? null;
  const target = languages?.target ?? null;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !source || !target || !supportsHighlights()) return;
    installHighlightStyle();
    const container = root;

    const segmentCache = new Map<string, { segments: ParallelSegment[]; source: string; target: string }>();
    const layerCache = new WeakMap<HTMLElement, LayerIndex>();
    let activeBoxes = new Set<HTMLElement>();
    let hovered: Mark | null = null;
    let selecting = false;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;

    function linked(key: string, side: ParallelSide) {
      return container.querySelector<HTMLElement>(
        `[data-parallel-side="${side}"][data-parallel-key="${CSS.escape(key)}"]`,
      );
    }

    /** Las parejas de frases de un bloque; se recalculan solo si cambia alguno de sus textos. */
    function segmentsOf(key: string) {
      const sourceElement = linked(key, "source");
      const targetElement = linked(key, "target");
      if (!sourceElement || !targetElement) return [];
      const sourceText = blockText(sourceElement);
      const targetText = blockText(targetElement);
      const cached = segmentCache.get(key);
      if (cached && cached.source === sourceText && cached.target === targetText) return cached.segments;
      const segments = pairSentences(sourceText, targetText, { source: source ?? undefined, target: target ?? undefined });
      segmentCache.set(key, { segments, source: sourceText, target: targetText });
      return segments;
    }

    /** Dónde está el texto de cada caja de una página dentro de su capa de pdf.js. */
    function indexLayer(layer: HTMLElement): LayerIndex | null {
      const page = layer.closest(pageSelector);
      if (!page) return null;
      const boxes = [...page.querySelectorAll<HTMLElement>("[data-parallel-text]")];
      if (boxes.length === 0) return null;
      const text = layer.textContent ?? "";
      const signature = boxes.map((box) => `${box.dataset.parallelKey}:${box.dataset.parallelText?.length}`).join("|");
      const cached = layerCache.get(layer);
      if (cached && cached.text === text && cached.signature === signature) return cached;

      const folded = foldLetters(text);
      const blocks = boxes.map((box) => foldLetters(box.dataset.parallelText ?? ""));
      const positions = locateBlocks(folded, blocks);
      const index: LayerIndex = {
        blocks: new Map(boxes.map((box, position) => [box, { at: positions[position] ?? -1, folded: blocks[position]! }])),
        folded,
        signature,
        text,
      };
      layerCache.set(layer, index);
      return index;
    }

    function layerOf(box: HTMLElement) {
      return box.closest(pageSelector)?.querySelector<HTMLElement>(layerSelector) ?? null;
    }

    /** El rango de un tramo de un bloque; en una caja, el tramo se busca en la capa de texto. */
    function spanRange(element: HTMLElement, span: TextSpan) {
      if (!isBox(element)) return rangeFromOffsets(element, span.start, span.end);
      const layer = layerOf(element);
      const index = layer ? indexLayer(layer) : null;
      const block = index?.blocks.get(element);
      if (!layer || !index || !block || block.at < 0) return null;
      const mapped = blockSpanToLayer(block.folded, index.folded, block.at, span);
      return mapped ? rangeFromOffsets(layer, mapped.start, mapped.end) : null;
    }

    function paint(marks: readonly Mark[]) {
      const ranges: Range[] = [];
      const boxes = new Set<HTMLElement>();
      for (const mark of marks) {
        const segments = segmentsOf(mark.key);
        for (const side of mark.sides) {
          const element = linked(mark.key, side);
          if (!element) continue;
          for (const index of mark.indices) {
            const span = segments[index]?.[side];
            const range = span ? spanRange(element, span) : null;
            if (range) ranges.push(range);
            else if (isBox(element)) boxes.add(element);
          }
        }
      }
      CSS.highlights.set(highlightName, new Highlight(...ranges));
      for (const box of activeBoxes) if (!boxes.has(box)) delete box.dataset.parallelActive;
      for (const box of boxes) box.dataset.parallelActive = "true";
      activeBoxes = boxes;
    }

    /** El bloque y la posición de su texto que hay bajo el puntero, si hay alguno. */
    function pointAt(x: number, y: number): { key: string; offset: number | null; side: ParallelSide } | null {
      const element = document.elementFromPoint(x, y);
      if (!element || !container.contains(element)) return null;

      const block = element.closest<HTMLElement>(linkedSelector);
      if (block && !isBox(block) && container.contains(block)) {
        const key = block.dataset.parallelKey;
        const side = block.dataset.parallelSide as ParallelSide | undefined;
        if (!key || !side) return null;
        const caret = caretAt(x, y);
        const offset = caret && block.contains(caret.node) ? offsetWithin(block, caret.node, caret.offset) : null;
        return { key, offset, side };
      }

      // La página original de un PDF: una letra de la capa de texto…
      const page = element.closest(pageSelector);
      if (!page || !container.contains(page)) return null;
      const layer = page.querySelector<HTMLElement>(layerSelector);
      if (layer && element !== layer && layer.contains(element)) {
        const caret = caretAt(x, y);
        const index = caret && layer.contains(caret.node) ? indexLayer(layer) : null;
        if (caret && index) {
          const layerOffset = offsetWithin(layer, caret.node, caret.offset);
          for (const [box, located] of index.blocks) {
            const offset = layerOffsetToBlock(located.folded, index.folded, located.at, layerOffset);
            if (offset !== null && box.dataset.parallelKey) return { key: box.dataset.parallelKey, offset, side: "source" };
          }
        }
      }
      // …o el hueco de un bloque, entre sus renglones.
      for (const box of page.querySelectorAll<HTMLElement>("[data-parallel-text]")) {
        const rect = box.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && box.dataset.parallelKey) {
          return { key: box.dataset.parallelKey, offset: null, side: "source" };
        }
      }
      return null;
    }

    function hoverMark(point: { key: string; offset: number | null; side: ParallelSide }): Mark | null {
      const segments = segmentsOf(point.key);
      if (segments.length === 0) return null;
      // Sin letra debajo —entre dos renglones— se queda lo que ya estaba resaltado del bloque; si
      // era de otro, el bloque entero.
      if (point.offset === null) {
        return hovered?.key === point.key ? hovered : { indices: segments.map((_, index) => index), key: point.key, sides: bothSides };
      }
      const index = segmentAt(segments, point.side, point.offset);
      return index < 0 ? null : { indices: [index], key: point.key, sides: bothSides };
    }

    /** Las parejas de lo seleccionado, para resaltarlas en el otro lado; `null` si no hay selección. */
    function selectionMarks(): Mark[] | null {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return null;
      const ancestor = elementOf(range.commonAncestorContainer);
      if (!ancestor) return null;

      const localSpan = (element: HTMLElement, length: number): TextSpan => ({
        end: element.contains(range.endContainer) ? offsetWithin(element, range.endContainer, range.endOffset) : length,
        start: element.contains(range.startContainer) ? offsetWithin(element, range.startContainer, range.startOffset) : 0,
      });
      const marks: Mark[] = [];

      const own = ancestor.closest<HTMLElement>(linkedSelector);
      const blocks = own && !isBox(own) ? [own] : [...ancestor.querySelectorAll<HTMLElement>(linkedSelector)];
      for (const element of blocks) {
        if (isBox(element) || !range.intersectsNode(element)) continue;
        const key = element.dataset.parallelKey;
        const side = element.dataset.parallelSide as ParallelSide | undefined;
        if (!key || !side) continue;
        const indices = segmentsWithin(segmentsOf(key), side, localSpan(element, element.textContent?.length ?? 0));
        if (indices.length > 0) marks.push({ indices, key, sides: [otherSide(side)] });
      }

      const ownLayer = ancestor.closest<HTMLElement>(layerSelector);
      const layers = ownLayer ? [ownLayer] : [...ancestor.querySelectorAll<HTMLElement>(layerSelector)];
      for (const layer of layers) {
        if (!range.intersectsNode(layer)) continue;
        const index = indexLayer(layer);
        if (!index) continue;
        const span = localSpan(layer, index.text.length);
        for (const [box, located] of index.blocks) {
          const key = box.dataset.parallelKey;
          const within = key ? layerSpanToBlock(located.folded, index.folded, located.at, span) : null;
          if (!key || !within) continue;
          const indices = segmentsWithin(segmentsOf(key), "source", within);
          if (indices.length > 0) marks.push({ indices, key, sides: ["target"] });
        }
      }

      return marks;
    }

    function markUnderPointer() {
      const point = pointer ? pointAt(pointer.x, pointer.y) : null;
      return point ? hoverMark(point) : null;
    }

    function update() {
      frame = 0;
      // Mientras hay algo seleccionado manda la selección: lo propio ya lo pinta el navegador.
      const selected = selectionMarks();
      if (selected) {
        selecting = true;
        hovered = null;
        paint(selected);
        return;
      }
      const next = markUnderPointer();
      if (!selecting && sameMark(next, hovered)) return;
      selecting = false;
      hovered = next;
      paint(next ? [next] : []);
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const onPointerMove = (event: PointerEvent) => {
      // Es una ayuda del ratón: en una pantalla táctil, un toque ya es seleccionar o pasar página.
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onPointerLeave = () => {
      pointer = null;
      schedule();
    };

    container.addEventListener("pointermove", onPointerMove, { passive: true });
    container.addEventListener("pointerleave", onPointerLeave);
    // Al desplazarse, bajo el puntero quieto pasa otro texto. El visor del PDF se desplaza dentro
    // de `root` y el resto de formatos, con la página.
    container.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("selectionchange", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("scroll", schedule);
      document.removeEventListener("selectionchange", schedule);
      CSS.highlights.delete(highlightName);
      for (const box of activeBoxes) delete box.dataset.parallelActive;
    };
  }, [rootRef, source, target]);
}
