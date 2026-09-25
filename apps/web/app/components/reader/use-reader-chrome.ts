"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Desplazamiento mínimo, en píxeles, que cuenta como intención de leer o de volver. */
const scrollIntent = 14;
/** Franja superior e inferior de la pantalla que, al acercar el puntero, trae las barras. */
const revealEdge = 84;

/**
 * Barras del lector que se apartan al leer y vuelven cuando se las busca.
 *
 * Se esconden al avanzar en el texto y reaparecen al retroceder, al acercar el puntero a un
 * borde, al tocar la página en una pantalla táctil o al llevar el foco del teclado a una de
 * ellas. `pinned` las fija visibles: con un menú o un panel abierto, que las barras se
 * fueran dejaría ese menú flotando sin el botón que lo abrió.
 *
 * Escucha el desplazamiento en fase de captura sobre el documento porque el lector de PDF
 * se desplaza dentro de su propio contenedor, y `scroll` no burbujea.
 */
export function useReaderChrome(pinned: boolean) {
  const [hidden, setHidden] = useState(false);
  const positions = useRef(new WeakMap<object, number>());

  useEffect(() => {
    if (pinned) return;

    let frame = 0;
    let pending: EventTarget | null = null;

    function read(target: EventTarget | null) {
      if (target === document || target === null) return window.scrollY;
      return target instanceof HTMLElement ? target.scrollTop : 0;
    }

    function evaluate() {
      frame = 0;
      const target = pending ?? document;
      const key = target === document ? document : (target as object);
      const top = read(target);
      // Sin lectura previa se toma el principio: el primer desplazamiento ya cuenta.
      const previous = positions.current.get(key) ?? 0;
      positions.current.set(key, top);

      const delta = top - previous;
      if (top < 48) setHidden(false);
      else if (delta > scrollIntent) setHidden(true);
      else if (delta < -scrollIntent) setHidden(false);
      else positions.current.set(key, previous);
    }

    function onScroll(event: Event) {
      const target = event.target;
      // Los paneles laterales y los menús también se desplazan: no deben mover las barras.
      if (target instanceof HTMLElement && target.closest("[data-reader-chrome-ignore]")) return;
      pending = target;
      if (!frame) frame = window.requestAnimationFrame(evaluate);
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      if (event.clientY < revealEdge || event.clientY > window.innerHeight - revealEdge) {
        setHidden(false);
      }
    }

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, [pinned]);

  const show = useCallback(() => setHidden(false), []);

  /**
   * Un toque en la página alterna las barras, como en los lectores de libros. Solo con el
   * dedo: con ratón, un clic suele ser el principio de una selección de texto.
   */
  const onStagePointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, [role='slider'], summary")) return;
    if (window.getSelection()?.toString()) return;
    setHidden((current) => !current);
  }, []);

  return { hidden: pinned ? false : hidden, onStagePointerUp, show };
}

/** Pantalla completa del documento, con el estado real del navegador. */
export function useFullscreen() {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // Se comprueba tras montar: en el servidor no hay `document` y el valor inicial debe
    // coincidir con el HTML que llega.
    const frame = window.requestAnimationFrame(() =>
      setSupported(Boolean(document.fullscreenEnabled)),
    );
    const sync = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  return { active, supported, toggle };
}

/** ¿El evento de teclado viene de un sitio donde se escribe? Entonces no es un atajo. */
export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}
