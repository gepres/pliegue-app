"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { readingAnchorAttribute as anchorAttribute } from "./reading-anchor";

/**
 * El sitio de lectura en el texto recompuesto (EPUB, DOCX, el modo Lectura del PDF), para no
 * perderlo al cambiar de vista ni de tamaño de ventana.
 *
 * Pasar a la traducción, al original o a las dos en paralelo cambia la altura de todo: el mismo
 * desplazamiento en píxeles caía unos párrafos más allá. Cada bloque lleva un
 * `data-reading-anchor` que es el mismo en todas las vistas —su sección o su página y su
 * posición en ella—; mientras se lee se anota cuál cruza la línea de lectura y por dónde, y al
 * cambiar de vista o de ancho se vuelve a él.
 */

interface Place {
  /** Cuánto del bloque queda ya por encima de la línea de lectura, de 0 a 1. */
  fraction: number;
  id: string;
}

/** La línea de lectura: un poco por debajo de lo alto de la ventana, bajo la barra del lector. */
const lineOffset = 120;

/** Lo que tarda en asentarse la ventana al cambiar de tamaño antes de volver al sitio. */
const resizeSettle = 200;

/**
 * `layoutKey` cambia cuando cambia la vista. `scrollerOf` da el elemento que se desplaza; sin
 * él, se desplaza la página.
 */
export function useReadingPlace(
  rootRef: RefObject<HTMLElement | null>,
  layoutKey: string,
  scrollerOf?: (root: HTMLElement) => HTMLElement | null,
) {
  const placeRef = useRef<Place | null>(null);
  const keyRef = useRef(layoutKey);
  const scrollerOfRef = useRef(scrollerOf);

  useEffect(() => {
    scrollerOfRef.current = scrollerOf;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = scrollerOfRef.current?.(root) ?? null;
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    let settle = 0;
    // Mientras la ventana cambia de tamaño, el navegador avisa de desplazamientos con la
    // maquetación a medio rehacer: medidos entonces, el sitio derivaba unos párrafos.
    let resizing = false;

    function measure() {
      frame = 0;
      if (!root || resizing) return;
      const place = placeAt(root, readingLine(scroller));
      if (place) placeRef.current = place;
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const onResize = () => {
      resizing = true;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        resizing = false;
        if (root) returnTo(root, placeRef.current, scroller);
        schedule();
      }, resizeSettle);
    };

    schedule();
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
    };
  }, [rootRef]);

  useLayoutEffect(() => {
    if (keyRef.current === layoutKey) return;
    keyRef.current = layoutKey;
    const root = rootRef.current;
    if (root) returnTo(root, placeRef.current, scrollerOfRef.current?.(root) ?? null);
  }, [layoutKey, rootRef]);
}

function readingLine(scroller: HTMLElement | null) {
  return (scroller?.getBoundingClientRect().top ?? 0) + lineOffset;
}

/** Desplaza lo justo para que el punto de lectura vuelva a la línea de lectura. */
function returnTo(root: HTMLElement, place: Place | null, scroller: HTMLElement | null) {
  if (!place) return;
  const element = root.querySelector<HTMLElement>(`[${anchorAttribute}="${CSS.escape(place.id)}"]`);
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const delta = rect.top + place.fraction * rect.height - readingLine(scroller);
  if (Math.abs(delta) < 1) return;
  if (scroller) scroller.scrollTop += delta;
  else window.scrollBy({ behavior: "instant", top: delta });
}

/**
 * El bloque que cruza la línea de lectura. Se busca por el punto de la pantalla, no recorriendo
 * los bloques: un libro tiene miles. Si la línea cae en el hueco entre dos, se baja un poco.
 */
function placeAt(root: HTMLElement, line: number): Place | null {
  const bounds = root.getBoundingClientRect();
  // Hacia la izquierda, que en paralelo es la columna del original; en varios puntos, porque el
  // texto va centrado en su medida y el margen cambia con la ventana.
  const columns = [0.25, 0.35, 0.15].map((share) => bounds.left + bounds.width * share);
  for (let y = line; y < line + 240; y += 12) {
    for (const x of columns) {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${anchorAttribute}]`);
      const id = element?.getAttribute(anchorAttribute);
      if (!element || !id || !root.contains(element)) continue;
      const rect = element.getBoundingClientRect();
      return { fraction: Math.min(1, Math.max(0, (line - rect.top) / Math.max(1, rect.height))), id };
    }
  }
  return null;
}
